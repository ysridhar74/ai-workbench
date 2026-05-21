/**
 * Schema Discovery
 *
 * Samples documents from each MongoDB collection and infers a rich schema:
 * - Nested field paths (e.g. "address.city", "contacts[].email")
 * - Field types (string, number, boolean, date, objectId, array, object, null)
 * - Value examples (up to 5 distinct values per field, for enum-like fields)
 * - Array element types
 * - Collection document counts
 *
 * The resulting schema is used as context for the LLM pipeline generator
 * so it knows exactly what fields exist before writing a query.
 */

import { Db, Document } from 'mongodb';

export interface FieldInfo {
  path: string;         // dot-notation path, e.g. "contacts[].email"
  types: string[];      // all observed types at this path
  examples: unknown[];  // up to 5 distinct non-null sample values
  isArray: boolean;     // true if this field is inside an array
  nullable: boolean;    // true if null was observed
}

export interface CollectionSchema {
  collection: string;
  documentCount: number;
  sampleSize: number;
  fields: FieldInfo[];
  discoveredAt: string;
}

// Detect the type of a value
function detectType(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (value instanceof Date) return 'date';
  // MongoDB ObjectId-like objects
  if (typeof value === 'object' && value !== null && value.constructor?.name === 'ObjectId') return 'objectId';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'object') return 'object';
  return typeof value; // string | number | boolean
}

// Recursively walk a document and collect field paths + sample values
function walkDocument(
  doc: Document,
  fieldMap: Map<string, FieldInfo>,
  prefix = '',
  inArray = false,
  depth = 0,
): void {
  if (depth > 8) return; // prevent runaway recursion on deeply nested docs

  for (const [key, value] of Object.entries(doc)) {
    if (key === '_id') continue; // skip _id from field map (handled separately)

    const path = prefix ? `${prefix}.${key}` : key;
    const type = detectType(value);

    // Get or create field info
    if (!fieldMap.has(path)) {
      fieldMap.set(path, { path, types: [], examples: [], isArray: inArray, nullable: false });
    }
    const info = fieldMap.get(path)!;

    // Track type
    if (type === 'null') {
      info.nullable = true;
    } else if (!info.types.includes(type)) {
      info.types.push(type);
    }

    // Collect example values (up to 5 distinct)
    if (type !== 'null' && type !== 'object' && type !== 'array' && info.examples.length < 5) {
      const str = String(value);
      if (!info.examples.map(String).includes(str)) {
        info.examples.push(value);
      }
    }

    // Recurse into objects
    if (type === 'object' && value !== null) {
      walkDocument(value as Document, fieldMap, path, inArray, depth + 1);
    }

    // Recurse into arrays — use array path notation "field[]"
    if (type === 'array' && Array.isArray(value)) {
      const arrPath = `${path}[]`;
      for (const item of value.slice(0, 10)) { // sample first 10 array items
        const itemType = detectType(item);
        if (itemType === 'object' && item !== null) {
          walkDocument(item as Document, fieldMap, arrPath, true, depth + 1);
        } else {
          // Scalar array — record the element type at path[]
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

// Discover the schema of a single collection
export async function discoverCollectionSchema(
  db: Db,
  collectionName: string,
  sampleSize = 200,
): Promise<CollectionSchema> {
  const collection = db.collection(collectionName);
  const documentCount = await collection.estimatedDocumentCount();

  // Sample documents — use $sample for random sampling
  const sample = documentCount > sampleSize
    ? await collection.aggregate([{ $sample: { size: sampleSize } }]).toArray()
    : await collection.find({}).limit(sampleSize).toArray();

  const fieldMap = new Map<string, FieldInfo>();

  for (const doc of sample) {
    walkDocument(doc, fieldMap);
  }

  // Sort fields by path for readability
  const fields = Array.from(fieldMap.values()).sort((a, b) => a.path.localeCompare(b.path));

  return {
    collection: collectionName,
    documentCount,
    sampleSize: sample.length,
    fields,
    discoveredAt: new Date().toISOString(),
  };
}

// Discover schemas for all collections (or a subset)
export async function discoverAllSchemas(
  db: Db,
  sampleSize = 200,
  excludeCollections: string[] = [],
): Promise<CollectionSchema[]> {
  const collections = await db.listCollections().toArray();
  const names = collections
    .map(c => c.name)
    .filter(name =>
      !excludeCollections.includes(name) &&
      !name.startsWith('system.') &&
      name !== 'rag_documents' &&    // skip workbench-internal collections
      name !== 'agent_runs' &&
      name !== 'skills' &&
      name !== 'long_term_memories' &&
      name !== 'entity_memories',
    );

  const schemas: CollectionSchema[] = [];
  for (const name of names) {
    try {
      const schema = await discoverCollectionSchema(db, name, sampleSize);
      schemas.push(schema);
    } catch (err) {
      console.error(`[schema-discovery] Failed to sample collection "${name}":`, err);
    }
  }
  return schemas;
}

// Format a schema as a compact human+LLM-readable text block
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

// Format multiple schemas for prompt context
export function formatSchemasForPrompt(schemas: CollectionSchema[]): string {
  return schemas.map(formatSchemaForPrompt).join('\n\n');
}
