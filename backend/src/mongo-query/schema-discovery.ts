/**
 * Schema Discovery — ported from mcp-servers/mongodb-query
 *
 * Samples documents from MongoDB collections and infers field paths, types, and examples.
 * Used as context for the LLM pipeline generator.
 */

import { Db, Document } from 'mongodb';

export interface FieldInfo {
  path: string;
  types: string[];
  examples: unknown[];
  isArray: boolean;
  nullable: boolean;
}

export interface CollectionSchema {
  collection: string;
  documentCount: number;
  sampleSize: number;
  fields: FieldInfo[];
  discoveredAt: string;
}

function detectType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return 'date';
  if (typeof value === 'object' && value !== null && (value as any).constructor?.name === 'ObjectId') return 'objectId';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value;
}

function walkDocument(
  doc: Document,
  fieldMap: Map<string, FieldInfo>,
  prefix = '',
  inArray = false,
  depth = 0,
): void {
  if (depth > 8) return;

  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id') continue;

    const path = prefix ? `${prefix}.${key}` : key;
    const type = detectType(value);

    if (!fieldMap.has(path)) {
      fieldMap.set(path, { path, types: [], examples: [], isArray: inArray, nullable: false });
    }
    const info = fieldMap.get(path)!;

    if (type === 'null') {
      info.nullable = true;
    } else if (!info.types.includes(type)) {
      info.types.push(type);
    }

    if (type !== 'null' && type !== 'object' && type !== 'array' && info.examples.length < 5) {
      const str = String(value);
      if (!info.examples.map(String).includes(str)) {
        info.examples.push(value);
      }
    }

    if (type === 'object' && value !== null) {
      walkDocument(value as Document, fieldMap, path, inArray, depth + 1);
    }

    if (type === 'array' && Array.isArray(value)) {
      const arrPath = `${path}[]`;
      for (const item of value.slice(0, 10)) {
        const itemType = detectType(item);
        if (itemType === 'object' && item !== null) {
          walkDocument(item as Document, fieldMap, arrPath, true, depth + 1);
        } else {
          if (!fieldMap.has(arrPath)) {
            fieldMap.set(arrPath, { path: arrPath, types: [], examples: [], isArray: true, nullable: false });
          }
          const arrInfo = fieldMap.get(arrPath)!;
          if (itemType !== 'null' && !arrInfo.types.includes(itemType)) {
            arrInfo.types.push(itemType);
          }
          if (itemType !== 'null' && arrInfo.examples.length < 5) {
            const str = String(item);
            if (!arrInfo.examples.map(String).includes(str)) {
              arrInfo.examples.push(item);
            }
          }
        }
      }
    }
  }
}

// Internal collections to skip when discovering schemas
const INTERNAL_COLLECTIONS = new Set([
  'rag_documents',
  'agent_runs',
  'skills',
  'long_term_memories',
  'entity_memories',
  'chats',
]);

export async function discoverCollectionSchema(
  db: Db,
  collectionName: string,
  sampleSize = 200,
): Promise<CollectionSchema> {
  const collection = db.collection(collectionName);
  const documentCount = await collection.estimatedDocumentCount();

  const sample = documentCount > sampleSize
    ? await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray()
    : await collection.find({}).limit(sampleSize).toArray();

  const fieldMap = new Map<string, FieldInfo>();
  for (const doc of sample) {
    walkDocument(doc, fieldMap);
  }

  const fields = Array.from(fieldMap.values()).sort((a, b) => a.path.localeCompare(b.path));

  return {
    collection: collectionName,
    documentCount,
    sampleSize: sample.length,
    fields,
    discoveredAt: new Date().toISOString(),
  };
}

export async function discoverAllSchemas(
  db: Db,
  sampleSize = 200,
): Promise<CollectionSchema[]> {
  const collections = await db.listCollections().toArray();
  const names = collections
    .map(c => c.name)
    .filter(name => !INTERNAL_COLLECTIONS.has(name) && !name.startsWith('system.'));

  const schemas: CollectionSchema[] = [];
  for (const name of names) {
    try {
      const schema = await discoverCollectionSchema(db, name, sampleSize);
      schemas.push(schema);
    } catch {
      // skip collections that fail to sample
    }
  }
  return schemas;
}

export function formatSchemaForPrompt(schema: CollectionSchema): string {
  const lines: string[] = [
    `Collection: ${schema.collection}  (${schema.documentCount.toLocaleString()} documents, sampled ${schema.sampleSize})`,
    'Fields:',
  ];
  for (const field of schema.fields) {
    const types = field.types.length > 0 ? field.types.join(' | ') : 'unknown';
    const nullable = field.nullable ? ' | null' : '';
    const exStr = field.examples.length > 0
      ? `  e.g. ${field.examples.slice(0, 3).map(e => JSON.stringify(e)).join(', ')}`
      : '';
    lines.push(`  ${field.path}: ${types}${nullable}${exStr}`);
  }
  return lines.join('\n');
}

export function formatSchemasForPrompt(schemas: CollectionSchema[]): string {
  return schemas.map(formatSchemaForPrompt).join('\n\n');
}
