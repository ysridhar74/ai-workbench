import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAIEmbeddings } from '@langchain/openai';
import { MongoDBAtlasVectorSearch } from '@langchain/mongodb';
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { Document } from '@langchain/core/documents';
import { DynamicTool } from '@langchain/core/tools';
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
   * Returns a LangChain DynamicTool that the ReAct agent can call to search
   * the knowledge base. The agent decides when to call it — Option 3 pattern.
   *
   * Input: plain string query, or JSON {"query":"...","namespace":"..."}
   * Only chunks above RAG_SCORE_THRESHOLD (default 0.70) are returned.
   * If nothing scores high enough, returns a clear "no results" message
   * so the agent knows to rely on its own knowledge instead.
   */
  asLangChainTool(defaultNamespace = 'default'): DynamicTool {
    const scoreThreshold = parseFloat(
      this.config.get<string>('RAG_SCORE_THRESHOLD', '0.70'),
    );

    return new DynamicTool({
      name: 'search_knowledge_base',
      description:
        'Search the internal knowledge base for relevant information. ' +
        'Call this when the user asks about topics that may be covered in company documents, ' +
        'product documentation, or any ingested knowledge. ' +
        'Input: a JSON string {"query": "your search query", "namespace": "default"} ' +
        'or just a plain search query string.',
      func: async (input: string): Promise<string> => {
        try {
          let query = input.trim();
          let namespace = defaultNamespace;

          // Parse JSON input if provided
          try {
            const parsed = JSON.parse(input);
            if (parsed.query) query = parsed.query;
            if (parsed.namespace) namespace = parsed.namespace;
          } catch {
            // plain string — use as-is
          }

          const results = await this.retrieveWithScores(query, { namespace, topK: 4 });

          // Filter by score threshold (Option 1 as a safety layer inside Option 3)
          const relevant = results.filter(([, score]) => score >= scoreThreshold);

          if (relevant.length === 0) {
            return `No relevant results found in the knowledge base for: "${query}". Answer from your own knowledge.`;
          }

          // Format results for the model
          return relevant
            .map(([doc, score], i) =>
              `[Result ${i + 1}] (relevance: ${(score * 100).toFixed(0)}%)\n` +
              `Source: ${doc.metadata?.source ?? 'unknown'}\n` +
              `${doc.pageContent}`,
            )
            .join('\n\n---\n\n');
        } catch (err) {
          return `Knowledge base search failed: ${err.message}`;
        }
      },
    });
  }

  /**
   * Ingest a PDF from a Buffer — extracts text with pdf-parse, then chunks + embeds.
   */
  async ingestPdf(
    buffer: Buffer,
    metadata: { source: string; namespace?: string; [key: string]: unknown },
  ): Promise<IngestResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse = require('pdf-parse');
    const parsed = await pdfParse(buffer);
    const text: string = parsed.text ?? '';
    if (!text.trim()) throw new Error('PDF contained no extractable text');
    return this.ingestText(text, metadata);
  }

  /**
   * Ingest a DOCX from a Buffer — extracts text with mammoth, then chunks + embeds.
   */
  async ingestDocx(
    buffer: Buffer,
    metadata: { source: string; namespace?: string; [key: string]: unknown },
  ): Promise<IngestResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    const text: string = result.value ?? '';
    if (!text.trim()) throw new Error('DOCX contained no extractable text');
    return this.ingestText(text, metadata);
  }

  /**
   * Ingest a web page — fetches the URL and strips HTML tags, then chunks + embeds.
   */
  async ingestUrl(
    url: string,
    metadata: { namespace?: string; [key: string]: unknown } = {},
  ): Promise<IngestResult> {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'AI-Workbench-RAG/1.0' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
    const html = await response.text();
    // Strip tags, collapse whitespace
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();
    if (!text) throw new Error('URL returned no usable text content');
    return this.ingestText(text, { source: url, ...metadata });
  }

  /**
   * List all distinct sources ingested in a namespace.
   */
  async listSources(namespace = 'default'): Promise<string[]> {
    await this.ensureReady();
    const dbName = this.config.get<string>('MONGODB_DB', 'ai_workbench');
    const col = this.mongoClient!.db(dbName).collection('rag_chunks');
    return col.distinct('source', { namespace }) as Promise<string[]>;
  }

  /**
   * List all distinct namespaces in the RAG store.
   */
  async listNamespaces(): Promise<string[]> {
    await this.ensureReady();
    const dbName = this.config.get<string>('MONGODB_DB', 'ai_workbench');
    const col = this.mongoClient!.db(dbName).collection('rag_chunks');
    return col.distinct('namespace') as Promise<string[]>;
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
