/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MongoQueryService
 *
 * Multi-database MongoDB query service. Manages a pool of named MongoClient
 * connections defined in config/mongo-databases.json. Each "database" entry
 * has its own URI + db name and can point to a completely different cluster.
 *
 * Agent tools always require a `database` parameter so the LLM picks the
 * right connection. The tool descriptions list all registered databases so
 * the LLM knows what's available without having to call list first.
 *
 * Adding a new application database:
 *   1. Add an entry to config/mongo-databases.json (enabled: true)
 *   2. Add any new env vars to .env
 *   3. Restart the backend — no code changes needed
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { MongoClient, Db } from 'mongodb';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

import {
  CollectionSchema,
  discoverAllSchemas,
  discoverCollectionSchema,
  formatSchemaForPrompt,
  formatSchemasForPrompt,
} from './schema-discovery';
import { validatePipeline, serializePipeline, MAX_RESULT_LIMIT } from './pipeline-validator';

// ── Config types ───────────────────────────────────────────────────────────────

interface MongoDatabaseConfig {
  name: string;       // unique identifier used in tool calls, e.g. "crm"
  label: string;      // human-readable label, e.g. "CRM"
  description: string;
  uri: string;
  database: string;
  enabled: boolean;
  readOnly?: boolean; // default true — safety guard
}

interface DatabaseEntry {
  config: MongoDatabaseConfig;
  client: MongoClient;
  db: Db;
  /** Schema cache keyed by collection name */
  schemaCache: Map<string, CollectionSchema>;
  lastDiscoveredAt: Date | null;
}

// ── Few-shot examples ─────────────────────────────────────────────────────────

const FEW_SHOT_EXAMPLES = `
## EXAMPLE 1 — Simple filter + sort
Question: "Show me all active trading partners in Germany"
Pipeline:
[
  { "$match": { "status": "active", "country": "Germany" } },
  { "$sort": { "name": 1 } },
  { "$limit": 100 }
]

## EXAMPLE 2 — Count by field (group)
Question: "How many trading partners per country?"
Pipeline:
[
  { "$group": { "_id": "$country", "count": { "$sum": 1 } } },
  { "$sort": { "count": -1 } },
  { "$project": { "country": "$_id", "count": 1, "_id": 0 } }
]

## EXAMPLE 3 — Filter on array size
Question: "Trading partners that have more than 5 contacts"
Pipeline:
[
  { "$addFields": { "contactCount": { "$size": { "$ifNull": ["$contacts", []] } } } },
  { "$match": { "contactCount": { "$gt": 5 } } },
  { "$project": { "name": 1, "country": 1, "contactCount": 1 } },
  { "$sort": { "contactCount": -1 } }
]

## EXAMPLE 4 — Unwind array and group
Question: "Count contacts by role across all trading partners"
Pipeline:
[
  { "$unwind": { "path": "$contacts", "preserveNullAndEmptyArrays": true } },
  { "$group": { "_id": "$contacts.role", "count": { "$sum": 1 } } },
  { "$sort": { "count": -1 } },
  { "$project": { "role": "$_id", "count": 1, "_id": 0 } }
]

## EXAMPLE 5 — Date range filter
Question: "Trading partners created in the last 30 days"
Pipeline:
[
  { "$match": { "createdAt": { "$gte": { "$dateSubtract": { "startDate": "$$NOW", "unit": "day", "amount": 30 } } } } },
  { "$sort": { "createdAt": -1 } },
  { "$project": { "name": 1, "country": 1, "createdAt": 1 } }
]

## EXAMPLE 6 — Aggregation with sum/avg
Question: "Average contract value by industry"
Pipeline:
[
  { "$group": {
    "_id": "$industry",
    "avgContractValue": { "$avg": "$contractValue" },
    "totalPartners": { "$sum": 1 }
  }},
  { "$sort": { "avgContractValue": -1 } },
  { "$project": { "industry": "$_id", "avgContractValue": { "$round": ["$avgContractValue", 2] }, "totalPartners": 1, "_id": 0 } }
]

## EXAMPLE 7 — Regex search in nested array
Question: "Find entities where any contact has a gmail address"
Pipeline:
[
  { "$match": { "contacts.email": { "$regex": "@gmail\\.com$", "$options": "i" } } },
  { "$project": { "name": 1, "contacts": 1 } }
]

## EXAMPLE 8 — Top N per group
Question: "Top 3 trading partners by contract value in each country"
Pipeline:
[
  { "$sort": { "contractValue": -1 } },
  { "$group": { "_id": "$country", "topPartners": { "$push": { "name": "$name", "contractValue": "$contractValue" } } } },
  { "$project": { "country": "$_id", "topPartners": { "$slice": ["$topPartners", 3] }, "_id": 0 } },
  { "$sort": { "country": 1 } }
]
`;

@Injectable()
export class MongoQueryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MongoQueryService.name);

  /** Pool of active database connections keyed by config name */
  private readonly pool = new Map<string, DatabaseEntry>();

  private llm!: OpenAI;
  private llmModel!: string;

  constructor(private readonly config: ConfigService) {}

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit() {
    // Set up LLM client
    const apiKey =
      this.config.get<string>('OPENAI_API_KEY') ||
      this.config.get<string>('ANTHROPIC_API_KEY') ||
      '';
    const baseUrl = this.config.get<string>('LLM_BASE_URL');
    this.llmModel = this.config.get<string>('LLM_MODEL') ?? 'gpt-4o';
    this.llm = new OpenAI({ apiKey, baseURL: baseUrl });

    // Load and connect all enabled databases
    await this.loadDatabases();
  }

  async onModuleDestroy() {
    for (const [name, entry] of this.pool) {
      try {
        await entry.client.close();
        this.logger.log(`Disconnected database "${name}"`);
      } catch {}
    }
    this.pool.clear();
  }

  // ── Config loading ─────────────────────────────────────────────────────────

  private async loadDatabases() {
    const configPath = path.join(process.cwd(), 'config', 'mongo-databases.json');
    if (!fs.existsSync(configPath)) {
      this.logger.warn('config/mongo-databases.json not found — no extra databases registered');
      return;
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    // Expand ${ENV_VAR} placeholders
    const expanded = raw.replace(/\$\{(\w+)\}/g, (_m, key: string) =>
      this.config.get<string>(key) ?? '',
    );
    const configs: MongoDatabaseConfig[] = JSON.parse(expanded);

    await Promise.allSettled(
      configs.filter(c => c.enabled).map(c => this.connectDatabase(c)),
    );

    this.logger.log(
      `MongoQueryService ready — ${this.pool.size} database(s) connected: ${[...this.pool.keys()].join(', ')}`,
    );

    // Pre-warm schema caches (non-blocking)
    for (const [name, entry] of this.pool) {
      this.warmSchemaCache(name, entry).catch(() => {});
    }
  }

  private async connectDatabase(cfg: MongoDatabaseConfig): Promise<void> {
    try {
      const client = new MongoClient(cfg.uri, {
        serverSelectionTimeoutMS: 10_000,
        connectTimeoutMS: 10_000,
      });
      await client.connect();
      const db = client.db(cfg.database);

      this.pool.set(cfg.name, {
        config: cfg,
        client,
        db,
        schemaCache: new Map(),
        lastDiscoveredAt: null,
      });

      this.logger.log(`Connected database "${cfg.name}" → ${cfg.database}`);
    } catch (err: any) {
      this.logger.error(`Failed to connect database "${cfg.name}": ${err.message}`);
    }
  }

  private async warmSchemaCache(name: string, entry: DatabaseEntry): Promise<void> {
    const schemas = await discoverAllSchemas(entry.db);
    entry.schemaCache.clear();
    for (const s of schemas) entry.schemaCache.set(s.collection, s);
    entry.lastDiscoveredAt = new Date();
    this.logger.log(`Schema cache warmed for "${name}" — ${schemas.length} collection(s)`);
  }

  // ── Connection resolution ──────────────────────────────────────────────────

  private getEntry(dbName: string): DatabaseEntry {
    const entry = this.pool.get(dbName);
    if (!entry) {
      const available = [...this.pool.keys()].join(', ');
      throw new Error(
        `Database "${dbName}" is not registered or not enabled. Available: ${available || 'none'}`,
      );
    }
    return entry;
  }

  /** Summary of all registered databases for use in tool descriptions */
  private registeredDatabasesSummary(): string {
    if (this.pool.size === 0) return 'No databases registered yet.';
    return [...this.pool.values()]
      .map(e => `"${e.config.name}" (${e.config.label}) — ${e.config.description}`)
      .join('; ');
  }

  /** Enum of valid database names for Zod schema */
  private databaseNames(): string[] {
    return [...this.pool.keys()];
  }

  // ── Schema helpers ─────────────────────────────────────────────────────────

  private async getSchemas(entry: DatabaseEntry, forceRefresh = false): Promise<CollectionSchema[]> {
    if (!forceRefresh && entry.schemaCache.size > 0) {
      return Array.from(entry.schemaCache.values());
    }
    const schemas = await discoverAllSchemas(entry.db);
    entry.schemaCache.clear();
    for (const s of schemas) entry.schemaCache.set(s.collection, s);
    entry.lastDiscoveredAt = new Date();
    return schemas;
  }

  private async getSchemaForCollection(
    entry: DatabaseEntry,
    collection: string,
    forceRefresh = false,
  ): Promise<CollectionSchema> {
    if (!forceRefresh && entry.schemaCache.has(collection)) {
      return entry.schemaCache.get(collection)!;
    }
    const schema = await discoverCollectionSchema(entry.db, collection);
    entry.schemaCache.set(collection, schema);
    entry.lastDiscoveredAt = new Date();
    return schema;
  }

  // ── LLM pipeline generation ────────────────────────────────────────────────

  private buildSystemPrompt(schemas: CollectionSchema[], dbLabel: string): string {
    const schemaText = schemas.map(formatSchemaForPrompt).join('\n\n---\n\n');
    return `You are a MongoDB aggregation pipeline expert for the "${dbLabel}" database. Your ONLY job is to convert natural language questions into valid MongoDB aggregation pipelines.

RULES:
1. Output ONLY a JSON array starting with [ and ending with ] — no markdown, no explanation
2. The pipeline must be valid MongoDB aggregation syntax
3. ONLY use field names that exist in the schema below
4. Always add a $limit stage (max ${MAX_RESULT_LIMIT})
5. Never use $out, $merge, or any write operation — READ ONLY
6. Use $ifNull for optional/nullable fields
7. For date comparisons use $dateSubtract with $$NOW

AVAILABLE COLLECTIONS AND SCHEMAS:
${schemaText}

FEW-SHOT EXAMPLES:
${FEW_SHOT_EXAMPLES}`;
  }

  private async generatePipeline(
    question: string,
    schemas: CollectionSchema[],
    dbLabel: string,
  ): Promise<object[]> {
    const response = await this.llm.chat.completions.create({
      model: this.llmModel,
      temperature: 0,
      messages: [
        { role: 'system', content: this.buildSystemPrompt(schemas, dbLabel) },
        { role: 'user', content: question },
      ],
      response_format: { type: 'json_object' },
    });

    let raw = response.choices[0]?.message?.content?.trim() ?? '';
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
      if (Array.isArray(parsed.pipeline)) return parsed.pipeline;
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    } catch {
      raw = raw.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) return JSON.parse(match[0]);
    }
    throw new Error(`LLM returned invalid pipeline JSON: ${raw.slice(0, 300)}`);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async listDatabases(): Promise<string> {
    if (this.pool.size === 0) {
      return 'No databases are currently registered. Add entries to config/mongo-databases.json and restart.';
    }
    const lines = [...this.pool.values()].map(e => {
      const cached = e.schemaCache.size;
      const refreshed = e.lastDiscoveredAt?.toISOString() ?? 'never';
      return `- **${e.config.name}** (${e.config.label}): ${e.config.description} | ${cached} collections cached | last refreshed: ${refreshed}`;
    });
    return [`## Registered Databases (${this.pool.size})`, '', ...lines].join('\n');
  }

  async listCollections(dbName: string): Promise<string> {
    const entry = this.getEntry(dbName);
    const allCollections = await entry.db.listCollections().toArray();
    const results: Array<{ collection: string; documentCount: number | null; schemaDiscovered: boolean }> = [];

    for (const col of allCollections) {
      if (col.name.startsWith('system.')) continue;
      let docCount: number | null = null;
      try { docCount = await entry.db.collection(col.name).estimatedDocumentCount(); } catch {}
      results.push({
        collection: col.name,
        documentCount: docCount,
        schemaDiscovered: entry.schemaCache.has(col.name),
      });
    }

    return [
      `## Collections in "${dbName}" (${entry.config.label}) — ${results.length} total`,
      `Schema cache last refreshed: ${entry.lastDiscoveredAt?.toISOString() ?? 'never'}`,
      '',
      ...results.map(r =>
        `- **${r.collection}** — ${r.documentCount?.toLocaleString() ?? '?'} documents${r.schemaDiscovered ? ' ✓ schema known' : ''}`
      ),
    ].join('\n').replace('(e.config.label)', `(${entry.config.label})`);
  }

  async discoverSchema(dbName: string, collection?: string, forceRefresh = false): Promise<string> {
    const entry = this.getEntry(dbName);
    let schemas: CollectionSchema[];
    if (collection) {
      schemas = [await this.getSchemaForCollection(entry, collection, forceRefresh)];
    } else {
      schemas = await this.getSchemas(entry, forceRefresh);
    }
    return [
      `## Schema Discovery — "${dbName}" (${entry.config.label})`,
      `Discovered ${schemas.length} collection(s)`,
      '',
      schemas.map(s => formatSchemaForPrompt(s)).join('\n\n---\n\n'),
      '',
      `✅ Ready to query with mongo_ask_collection.`,
    ].join('\n');
  }

  async getSchema(dbName: string, collection?: string): Promise<string> {
    const entry = this.getEntry(dbName);
    if (entry.schemaCache.size === 0) {
      return `No schemas cached for "${dbName}" yet — will auto-discover on first query.`;
    }
    const schemas = collection
      ? (entry.schemaCache.has(collection) ? [entry.schemaCache.get(collection)!] : [])
      : Array.from(entry.schemaCache.values());
    if (schemas.length === 0) {
      return `No cached schema for collection "${collection}" in "${dbName}".`;
    }
    return [
      `## Schema for "${dbName}" (${entry.config.label})`,
      `Last refreshed: ${entry.lastDiscoveredAt?.toISOString()}`,
      '',
      formatSchemasForPrompt(schemas),
    ].join('\n');
  }

  async askCollection(dbName: string, collection: string, question: string, limit?: number): Promise<string> {
    const entry = this.getEntry(dbName);

    // Auto-discover schema if not cached
    if (!entry.schemaCache.has(collection)) {
      await this.getSchemaForCollection(entry, collection, true);
    }
    const schemas = await this.getSchemas(entry, false);
    const relevant = schemas.filter(s => s.collection === collection);

    const rawPipeline = await this.generatePipeline(question, relevant, entry.config.label);
    const validation = validatePipeline(rawPipeline);
    if (!validation.valid) {
      return `Pipeline validation failed:\n${validation.errors.join('\n')}\n\nGenerated pipeline:\n${serializePipeline(rawPipeline)}`;
    }

    if (limit !== undefined) {
      const capLimit = Math.min(limit, MAX_RESULT_LIMIT);
      const idx = validation.pipeline.findIndex(s => Object.keys(s).includes('$limit'));
      if (idx >= 0) (validation.pipeline[idx] as any)['$limit'] = capLimit;
      else validation.pipeline.push({ $limit: capLimit });
    }

    const result = await this.runPipelineInternal(entry, collection, validation.pipeline);
    return this.formatResult({ ...result, db: dbName, dbLabel: entry.config.label, warnings: validation.warnings });
  }

  async runRawPipeline(dbName: string, collection: string, pipelineJson: string): Promise<string> {
    const entry = this.getEntry(dbName);
    let raw: unknown;
    try { raw = JSON.parse(pipelineJson); } catch {
      return `Invalid pipeline JSON: ${pipelineJson.slice(0, 200)}`;
    }
    const validation = validatePipeline(raw);
    if (!validation.valid) {
      return `Pipeline validation failed:\n${validation.errors.map(e => `- ${e}`).join('\n')}`;
    }
    const result = await this.runPipelineInternal(entry, collection, validation.pipeline);
    return this.formatResult({ ...result, db: dbName, dbLabel: entry.config.label, warnings: validation.warnings });
  }

  async getSampleDocuments(dbName: string, collection: string, limit = 5, filterJson?: string): Promise<string> {
    const entry = this.getEntry(dbName);
    let filter: Record<string, unknown> = {};
    if (filterJson) {
      try { filter = JSON.parse(filterJson); } catch {
        return JSON.stringify({ error: `Invalid filter JSON: ${filterJson}` });
      }
    }
    const rawDocs = await entry.db.collection(collection).find(filter).limit(Math.min(limit, 20)).toArray();
    const rows = this.sanitizeDocs(rawDocs) as Record<string, unknown>[];

    // Return structured JSON so the result classifier can render a QueryResult component
    return JSON.stringify({
      database: dbName,
      collection,
      count: rows.length,
      rows,
    });
  }

  // ── BSON sanitizer ─────────────────────────────────────────────────────────

  /**
   * Recursively converts BSON/MongoDB driver types to plain JSON-safe values.
   * Without this, ObjectId / Date / Decimal128 objects crash the frontend renderer
   * because they serialize as { _bsontype: "ObjectId", id: <Buffer> } etc.
   */
  private sanitize(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    // MongoDB driver ObjectId
    if (typeof value === 'object' && (value as any)._bsontype === 'ObjectId') {
      return (value as any).toString();
    }
    // Native Date
    if (value instanceof Date) {
      return value.toISOString();
    }
    // Decimal128, Long → numeric string
    if (typeof value === 'object' && (value as any)._bsontype === 'Decimal128') {
      return (value as any).toString();
    }
    if (typeof value === 'object' && (value as any)._bsontype === 'Long') {
      return (value as any).toNumber();
    }
    // Binary blobs → base64 string
    if (typeof value === 'object' && (value as any)._bsontype === 'Binary') {
      return (value as any).buffer?.toString('base64') ?? '';
    }
    // Recurse into arrays
    if (Array.isArray(value)) {
      return value.map(v => this.sanitize(v));
    }
    // Recurse into plain objects
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.sanitize(v);
      }
      return out;
    }
    return value;
  }

  private sanitizeDocs(docs: unknown[]): unknown[] {
    return docs.map(d => this.sanitize(d)) as unknown[];
  }

  // ── Private execution ──────────────────────────────────────────────────────

  private async runPipelineInternal(
    entry: DatabaseEntry,
    collectionName: string,
    pipeline: object[],
    timeoutMs = 30_000,
  ): Promise<{ rows: unknown[]; rowCount: number; durationMs: number; collection: string; pipeline: object[] }> {
    const exists = await entry.db.listCollections({ name: collectionName }).toArray();
    if (exists.length === 0) throw new Error(`Collection "${collectionName}" does not exist in "${entry.config.name}"`);

    const start = Date.now();
    const rawRows = await entry.db.collection(collectionName).aggregate(pipeline, {
      maxTimeMS: timeoutMs,
      allowDiskUse: true,
    }).toArray();
    const rows = this.sanitizeDocs(rawRows);

    return { rows, rowCount: rows.length, durationMs: Date.now() - start, collection: collectionName, pipeline };
  }

  private formatResult(result: {
    rows: unknown[];
    rowCount: number;
    durationMs: number;
    collection: string;
    pipeline: object[];
    db: string;
    dbLabel: string;
    warnings?: string[];
  }): string {
    // Return structured JSON so the result classifier can render a QueryResult component.
    // The LLM still sees this string — the structure provides enough context for it to
    // describe the results, while the classifier extracts rows for the UI.
    return JSON.stringify({
      database: result.db,
      collection: result.collection,
      count: result.rowCount,
      durationMs: result.durationMs,
      warnings: result.warnings ?? [],
      rows: result.rows,
    });
  }

  // ── LangChain tools ────────────────────────────────────────────────────────

  getLangChainTools(): any[] {
    // Build a dynamic description that lists all registered databases
    // so the LLM knows what's available without calling list_databases first
    const dbSummary = this.registeredDatabasesSummary();
    const dbNames = this.databaseNames();

    // If no DBs registered yet, return minimal set
    if (dbNames.length === 0) {
      return [
        new DynamicStructuredTool<any>({
          name: 'mongo_list_databases',
          description: 'List all registered MongoDB databases available for querying.',
          schema: z.object({}),
          func: async () => this.listDatabases(),
        }),
      ];
    }

    const dbEnum = dbNames.length > 0
      ? z.enum(dbNames as [string, ...string[]]).describe(`Which database to query. Available: ${dbSummary}`)
      : z.string().describe('Database name');

    return [
      // ── List all registered databases ───────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'mongo_list_databases',
        description: `List all registered MongoDB databases with their connection status and schema cache info. Registered: ${dbSummary}`,
        schema: z.object({}),
        func: async () => {
          try { return await this.listDatabases(); }
          catch (err: any) { return `Error: ${err.message}`; }
        },
      }),

      // ── List collections in a database ──────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'mongo_list_collections',
        description: `List all collections with document counts for a specific database. Registered databases: ${dbSummary}`,
        schema: z.object({ database: dbEnum }),
        func: async ({ database }) => {
          try { return await this.listCollections(database); }
          catch (err: any) { return `Error: ${err.message}`; }
        },
      }),

      // ── Discover schema ──────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'mongo_discover_schema',
        description: 'Sample documents from a MongoDB collection and infer its schema. Call before querying an unfamiliar collection.',
        schema: z.object({
          database: dbEnum,
          collection: z.string().optional().describe('Collection name. Omit to discover all collections.'),
          forceRefresh: z.boolean().optional().describe('Force re-sampling even if schema is cached.'),
        }),
        func: async ({ database, collection, forceRefresh }) => {
          try { return await this.discoverSchema(database, collection, forceRefresh ?? false); }
          catch (err: any) { return `Error: ${err.message}`; }
        },
      }),

      // ── Natural language query ───────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'mongo_ask_collection',
        description: `Ask a natural language question about a MongoDB collection. Auto-generates and executes the best aggregation pipeline. Use for queries, counts, aggregations, analytics. Registered databases: ${dbSummary}`,
        schema: z.object({
          database: dbEnum,
          collection: z.string().describe('The collection name to query'),
          question: z.string().describe('Natural language question, e.g. "Show me all active trading partners grouped by country"'),
          limit: z.number().optional().describe(`Maximum rows to return (default: 100, max: ${MAX_RESULT_LIMIT})`),
        }),
        func: async ({ database, collection, question, limit }) => {
          try { return await this.askCollection(database, collection, question, limit); }
          catch (err: any) { return `Error: ${err.message}`; }
        },
      }),

      // ── Raw pipeline execution ───────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'mongo_run_pipeline',
        description: 'Execute a raw MongoDB aggregation pipeline (read-only, validated). Use when you want to run a specific hand-crafted pipeline.',
        schema: z.object({
          database: dbEnum,
          collection: z.string().describe('The collection name'),
          pipeline: z.string().describe('MongoDB aggregation pipeline as a JSON array string'),
        }),
        func: async ({ database, collection, pipeline }) => {
          try { return await this.runRawPipeline(database, collection, pipeline); }
          catch (err: any) { return `Error: ${err.message}`; }
        },
      }),

      // ── Sample documents ─────────────────────────────────────────────────
      new DynamicStructuredTool<any>({
        name: 'mongo_get_sample_documents',
        description: 'Return sample raw documents from a collection to understand its data shape before writing queries.',
        schema: z.object({
          database: dbEnum,
          collection: z.string().describe('The collection name'),
          limit: z.number().optional().describe('Number of documents to return (default: 5, max: 20)'),
          filter: z.string().optional().describe('Optional MongoDB filter as JSON object string, e.g. {"status":"active"}'),
        }),
        func: async ({ database, collection, limit, filter }) => {
          try { return await this.getSampleDocuments(database, collection, limit, filter); }
          catch (err: any) { return `Error: ${err.message}`; }
        },
      }),
    ];
  }
}
