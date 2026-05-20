import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from '@langchain/core/documents';
import { MongoClient } from 'mongodb';

export interface IngestResult {
  namespace: string;
  chunksCreated: number;
  source: string;
}

export interface RetrieveOptions {
  namespace?: string;
  topK?: number;
  minScore?: number;
}

@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private vectorStore: MongoDBAtlasVectorSearch;
  private embeddings: OpenAIEmbeddings;
  private mongoClient: MongoClient;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const mongoUri = this.config.getOrThrow<string>('MONGODB_URI');
    const dbName = this.config.get<string>('MONGODB_DB', 'ai_workbench');

    this.mongoClient = new MongoClient(mongoUri);
    await this.mongoClient.connect();

    const collection = this.mongoClient.db(dbName).collection('rag_chunks');

    // Embeddings — uses the same OpenAI-compat base URL as the LLM if set,
    // so it works with Ollama (nomic-embed-text) or OpenAI text-embedding-3-small
    this.embeddings = new OpenAIEmbeddings({
      modelName: this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small'),
      openAIApiKey:
        this.config.get<string>('OPENAI_API_KEY') ||
        this.config.get<string>('EMBEDDING_API_KEY') ||
        'ollama',
      configuration: {
        baseURL: this.config.get<string>('EMBEDDING_BASE_URL') ||
                 this.config.get<string>('LLM_BASE_URL') ||
                 undefined,
      },
    });

    this.vectorStore = new MongoDBAtlasVectorSearch(this.embeddings, {
      collection,
      indexName: this.config.get<string>('MONGODB_VECTOR_INDEX', 'rag_vector_index'),
      textKey: 'text',
      embeddingKey: 'embedding',
    });

    this.logger.log('RAG pipeline initialised — MongoDB Atlas Vector Search ready');
  }

  /**
   * Ingest a plain-text document: split into chunks, embed, store in MongoDB.
   */
  async ingestText(
    text: string,
    metadata: { source: string; namespace?: string; [key: string]: unknown },
  ): Promise<IngestResult> {
    const namespace = metadata.namespace ?? 'default';

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: parseInt(this.config.get<string>('RAG_CHUNK_SIZE', '800')),
      chunkOverlap: parseInt(this.config.get<string>('RAG_CHUNK_OVERLAP', '100')),
    });

    const docs = await splitter.createDocuments(
      [text],
      [{ ...metadata, namespace }],
    );

    await this.vectorStore.addDocuments(docs);

    this.logger.log(`Ingested "${metadata.source}" → ${docs.length} chunk(s) in namespace "${namespace}"`);

    return {
      namespace,
      chunksCreated: docs.length,
      source: metadata.source,
    };
  }

  /**
   * Retrieve the top-k most relevant chunks for a query.
   */
  async retrieve(query: string, options: RetrieveOptions = {}): Promise<Document[]> {
    const topK = options.topK ?? 4;
    const namespace = options.namespace ?? 'default';

    try {
      // Filter by namespace using MongoDB pre-filter
      const results = await this.vectorStore.similaritySearch(query, topK, {
        preFilter: { namespace: { $eq: namespace } },
      });
      return results;
    } catch (err) {
      // If the vector index doesn't exist yet, return empty rather than crashing
      this.logger.warn(`Vector search failed (index may not exist yet): ${err.message}`);
      return [];
    }
  }

  /**
   * Retrieve with similarity scores (useful for debugging relevance).
   */
  async retrieveWithScores(
    query: string,
    options: RetrieveOptions = {},
  ): Promise<[Document, number][]> {
    const topK = options.topK ?? 4;
    const namespace = options.namespace ?? 'default';

    try {
      return await this.vectorStore.similaritySearchWithScore(query, topK, {
        preFilter: { namespace: { $eq: namespace } },
      });
    } catch (err) {
      this.logger.warn(`Vector search failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Delete all chunks for a given source document.
   */
  async deleteSource(source: string, namespace = 'default'): Promise<void> {
    const mongoUri = this.config.getOrThrow<string>('MONGODB_URI');
    const dbName = this.config.get<string>('MONGODB_DB', 'ai_workbench');
    const col = this.mongoClient.db(dbName).collection('rag_chunks');
    const result = await col.deleteMany({ 'metadata.source': source, 'metadata.namespace': namespace });
    this.logger.log(`Deleted ${result.deletedCount} chunks for source "${source}" in namespace "${namespace}"`);
  }
}
