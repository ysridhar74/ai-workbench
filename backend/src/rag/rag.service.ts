import { Injectable, Logger } from '@nestjs/common';
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
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private vectorStore: MongoDBAtlasVectorSearch | null = null;
  private mongoClient: MongoClient | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Lazy initializer — called by every public method before use.
   * Safe to call multiple times; initialization runs exactly once.
   */
  private ensureReady(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initialize();
    }
    return this.initPromise;
  }

  private async initialize(): Promise<void> {
    const mongoUri = this.config.getOrThrow<string>('MONGODB_URI');
    const dbName = this.config.get<string>('MONGODB_DB', 'ai_workbench');

    this.mongoClient = new MongoClient(mongoUri);
    await this.mongoClient.connect();

    const collection = this.mongoClient.db(dbName).collection('rag_chunks');

    const embeddings = new OpenAIEmbeddings({
      modelName: this.config.get<string>('EMBEDDING_MODEL', 'text-embedding-3-small'),
      openAIApiKey:
        this.config.get<string>('OPENAI_API_KEY') ||
        this.config.get<string>('EMBEDDING_API_KEY') ||
        'ollama',
      configuration: {
        baseURL:
          this.config.get<string>('EMBEDDING_BASE_URL') ||
          this.config.get<string>('LLM_BASE_URL') ||
          undefined,
      },
    } as any);

    this.vectorStore = new MongoDBAtlasVectorSearch(embeddings, {
      collection,
      indexName: this.config.get<string>('MONGODB_VECTOR_INDEX', 'rag_vector_index'),
      textKey: 'text',
      embeddingKey: 'embedding',
    });

    this.logger.log('RAG pipeline initialised — MongoDB Atlas Vector Search ready');
  }

  /**
   * Ingest plain text: split into chunks, embed, store in MongoDB.
   */
  async ingestText(
    text: string,
    metadata: { source: string; namespace?: string; [key: string]: unknown },
  ): Promise<IngestResult> {
    await this.ensureReady();

    const namespace = metadata.namespace ?? 'default';

    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: parseInt(this.config.get<string>('RAG_CHUNK_SIZE', '800')),
      chunkOverlap: parseInt(this.config.get<string>('RAG_CHUNK_OVERLAP', '100')),
    });

    const docs = await splitter.createDocuments([text], [{ ...metadata, namespace }]);

    await this.vectorStore!.addDocuments(docs);

    this.logger.log(
      `Ingested "${metadata.source}" → ${docs.length} chunk(s) in namespace "${namespace}"`,
    );

    return { namespace, chunksCreated: docs.length, source: metadata.source };
  }

  /**
   * Retrieve the top-k most relevant chunks for a query.
   */
  async retrieve(query: string, options: RetrieveOptions = {}): Promise<Document[]> {
    await this.ensureReady();

    const topK = options.topK ?? 4;
    const namespace = options.namespace ?? 'default';

    try {
      return await this.vectorStore!.similaritySearch(query, topK, {
        preFilter: { namespace: { $eq: namespace } },  // stored at root, not metadata.namespace
      });
    } catch (err) {
      this.logger.warn(`Vector search failed (index may not exist yet): ${err.message}`);
      return [];
    }
  }

  /**
   * Retrieve with similarity scores — useful for debugging relevance.
   */
  async retrieveWithScores(
    query: string,
    options: RetrieveOptions = {},
  ): Promise<[Document, number][]> {
    await this.ensureReady();

    const topK = options.topK ?? 4;
    const namespace = options.namespace ?? 'default';

    try {
      return await this.vectorStore!.similaritySearchWithScore(query, topK, {
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
    await this.ensureReady();

    const dbName = this.config.get<string>('MONGODB_DB', 'ai_workbench');
    const col = this.mongoClient!.db(dbName).collection('rag_chunks');
    const result = await col.deleteMany({ source, namespace });
    this.logger.log(
      `Deleted ${result.deletedCount} chunk(s) for "${source}" in namespace "${namespace}"`,
    );
  }
}
