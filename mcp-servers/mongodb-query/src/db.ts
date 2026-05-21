/**
 * MongoDB connection manager
 *
 * Maintains a single MongoClient instance for the lifetime of the MCP server.
 * Schema cache is stored in-memory and refreshed on demand.
 */

import { MongoClient, Db } from 'mongodb';
import {
  CollectionSchema,
  discoverAllSchemas,
  discoverCollectionSchema,
} from './schema-discovery.js';

let client: MongoClient | null = null;
let db: Db | null = null;

// In-memory schema cache — keyed by collection name
const schemaCache = new Map<string, CollectionSchema>();
let lastDiscoveryAt: Date | null = null;

export async function connect(uri: string, dbName: string): Promise<Db> {
  if (db) return db;

  client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  });

  await client.connect();
  db = client.db(dbName);
  console.error(`[mongodb-query-mcp] Connected to MongoDB database: ${dbName}`);
  return db;
}

export function getDb(): Db {
  if (!db) throw new Error('MongoDB not connected. Call connect() first.');
  return db;
}

export async function disconnect(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    schemaCache.clear();
  }
}

// ── Schema cache ──────────────────────────────────────────────────────────────

export async function getSchemas(forceRefresh = false): Promise<CollectionSchema[]> {
  if (!forceRefresh && schemaCache.size > 0) {
    return Array.from(schemaCache.values());
  }

  const database = getDb();
  const schemas = await discoverAllSchemas(database);

  schemaCache.clear();
  for (const schema of schemas) {
    schemaCache.set(schema.collection, schema);
  }
  lastDiscoveryAt = new Date();

  return schemas;
}

export async function getSchemaForCollection(
  collectionName: string,
  forceRefresh = false,
): Promise<CollectionSchema> {
  if (!forceRefresh && schemaCache.has(collectionName)) {
    return schemaCache.get(collectionName)!;
  }

  const database = getDb();
  const schema = await discoverCollectionSchema(database, collectionName);
  schemaCache.set(collectionName, schema);
  lastDiscoveryAt = new Date();

  return schema;
}

export function getCacheInfo(): { collections: string[]; lastDiscoveredAt: string | null } {
  return {
    collections: Array.from(schemaCache.keys()),
    lastDiscoveredAt: lastDiscoveryAt?.toISOString() ?? null,
  };
}

// ── Pipeline executor ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  rows: unknown[];
  rowCount: number;
  durationMs: number;
  collection: string;
  pipeline: object[];
}

export async function executePipeline(
  collectionName: string,
  pipeline: object[],
  timeoutMs = 30_000,
): Promise<ExecutionResult> {
  const database = getDb();
  const collection = database.collection(collectionName);

  // Verify collection exists
  const collections = await database.listCollections({ name: collectionName }).toArray();
  if (collections.length === 0) {
    throw new Error(`Collection "${collectionName}" does not exist in the database`);
  }

  const start = Date.now();

  const cursor = collection.aggregate(pipeline, {
    maxTimeMS: timeoutMs,
    allowDiskUse: true,   // allow large sorts to spill to disk
  });

  const rows = await cursor.toArray();
  const durationMs = Date.now() - start;

  return {
    rows,
    rowCount: rows.length,
    durationMs,
    collection: collectionName,
    pipeline,
  };
}

// ── Simple find (for quick lookups, not aggregation) ─────────────────────────

export async function findDocuments(
  collectionName: string,
  filter: Record<string, unknown>,
  projection: Record<string, unknown>,
  limit: number,
): Promise<unknown[]> {
  const database = getDb();
  return database
    .collection(collectionName)
    .find(filter, { projection })
    .limit(Math.min(limit, 200))
    .toArray();
}
