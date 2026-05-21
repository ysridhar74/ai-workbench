/**
 * MongoDB Query MCP Server
 *
 * Exposes MongoDB querying capability as MCP tools so any agent
 * (AI Workbench, Claude Desktop, etc.) can query your collections
 * using natural language.
 *
 * Tools:
 *   list_collections       — list all queryable collections with counts
 *   discover_schema        — sample a collection and infer its full schema
 *   get_schema             — return cached schema (fast, no DB sampling)
 *   ask_collection         — NL question → pipeline → results (one shot)
 *   run_pipeline           — execute a raw aggregation pipeline (validated)
 *   get_sample_documents   — return N raw documents from a collection
 *
 * Environment variables:
 *   MONGODB_URI            — MongoDB connection string (required)
 *   MONGODB_DB             — Database name (required)
 *   OPENAI_API_KEY         — LLM API key for pipeline generation (required)
 *   ANTHROPIC_API_KEY      — Alternative: Anthropic key (uses OpenAI-compat endpoint)
 *   LLM_MODEL              — Model to use (default: gpt-4o)
 *   LLM_BASE_URL           — Optional LiteLLM proxy base URL
 *   QUERY_TIMEOUT_MS       — Max execution time per query (default: 30000)
 *   SAMPLE_SIZE            — Docs to sample per collection for schema (default: 200)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { connect, disconnect, getDb, getSchemas, getSchemaForCollection, getCacheInfo, executePipeline, findDocuments } from './db.js';
import { formatSchemaForPrompt, formatSchemasForPrompt } from './schema-discovery.js';
import { PipelineGenerator } from './pipeline-generator.js';
import { validatePipeline, serializePipeline, MAX_RESULT_LIMIT } from './pipeline-validator.js';

// ── Config ────────────────────────────────────────────────────────────────────

const MONGODB_URI    = process.env.MONGODB_URI ?? '';
const MONGODB_DB     = process.env.MONGODB_DB ?? process.env.MONGODB_DATABASE ?? '';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? '';
const LLM_MODEL      = process.env.LLM_MODEL ?? 'gpt-4o';
const LLM_BASE_URL   = process.env.LLM_BASE_URL;
const QUERY_TIMEOUT  = parseInt(process.env.QUERY_TIMEOUT_MS ?? '30000', 10);
const SAMPLE_SIZE    = parseInt(process.env.SAMPLE_SIZE ?? '200', 10);

// Print env state for diagnostics (mask secrets)
console.error('[mongodb-query-mcp] Config:');
console.error(`  MONGODB_URI    = ${MONGODB_URI ? MONGODB_URI.replace(/:\/\/[^@]+@/, '://<credentials>@') : '❌ NOT SET'}`);
console.error(`  MONGODB_DB     = ${MONGODB_DB || '❌ NOT SET'}`);
console.error(`  OPENAI_API_KEY = ${OPENAI_API_KEY ? '✓ set' : '❌ NOT SET'}`);
console.error(`  LLM_MODEL      = ${LLM_MODEL}`);
console.error(`  LLM_BASE_URL   = ${LLM_BASE_URL ?? '(direct provider)'}`);

const missing: string[] = [];
if (!MONGODB_URI) missing.push('MONGODB_URI');
if (!MONGODB_DB)  missing.push('MONGODB_DB (or MONGODB_DATABASE)');
if (!OPENAI_API_KEY) missing.push('OPENAI_API_KEY (or ANTHROPIC_API_KEY)');

if (missing.length > 0) {
  console.error(`[mongodb-query-mcp] FATAL: Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'mongodb-query',
  version: '1.0.0',
});

const generator = new PipelineGenerator(OPENAI_API_KEY, LLM_BASE_URL, LLM_MODEL);

// ── Helper: format result for MCP response ────────────────────────────────────

function toMcpText(data: unknown): string {
  return typeof data === 'string' ? data : JSON.stringify(data, null, 2);
}

function formatExecutionResult(result: {
  rows: unknown[];
  rowCount: number;
  durationMs: number;
  collection: string;
  pipeline: object[];
  explanation?: string;
  warnings?: string[];
}): string {
  const parts: string[] = [];

  if (result.explanation) {
    parts.push(`## Summary\n${result.explanation}`);
  }

  parts.push(
    `## Query Details`,
    `- Collection: ${result.collection}`,
    `- Rows returned: ${result.rowCount}`,
    `- Execution time: ${result.durationMs}ms`,
  );

  if (result.warnings && result.warnings.length > 0) {
    parts.push(`\n⚠️ Warnings:\n${result.warnings.map(w => `- ${w}`).join('\n')}`);
  }

  parts.push(`\n## Pipeline\n\`\`\`json\n${serializePipeline(result.pipeline)}\n\`\`\``);
  parts.push(`\n## Results\n\`\`\`json\n${JSON.stringify(result.rows, null, 2)}\n\`\`\``);

  return parts.join('\n');
}

// ── Tool: list_collections ────────────────────────────────────────────────────

server.tool(
  'list_collections',
  'List all queryable MongoDB collections with their document counts and whether their schema has been discovered. Call this first to know what data is available.',
  {},
  async () => {
    try {
      // Use the shared connection established at startup
      const database = getDb();
      const allCollections = await database.listCollections().toArray();
      const cacheInfo = getCacheInfo();
      const results = [];

      for (const col of allCollections) {
        const name = col.name;
        if (name.startsWith('system.')) continue;

        let docCount: number | null = null;
        try {
          docCount = await database.collection(name).estimatedDocumentCount();
        } catch {}

        results.push({
          collection: name,
          documentCount: docCount,
          schemaDiscovered: cacheInfo.collections.includes(name),
        });
      }

      const summary = [
        `## Available Collections (${results.length})`,
        `Database: ${MONGODB_DB}`,
        `Schema cache last refreshed: ${cacheInfo.lastDiscoveredAt ?? 'never — run discover_schema to analyse collections'}`,
        '',
        ...results.map(r =>
          `- **${r.collection}** — ${r.documentCount?.toLocaleString() ?? '?'} documents${r.schemaDiscovered ? ' ✓ schema known' : ''}`
        ),
      ].join('\n');

      return { content: [{ type: 'text', text: summary }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error listing collections: ${String(err)}` }], isError: true };
    }
  },
);

// ── Tool: discover_schema ─────────────────────────────────────────────────────

server.tool(
  'discover_schema',
  'Sample documents from one or all MongoDB collections and infer their full nested schema (field names, types, example values). Must be run before ask_collection can generate accurate queries. Results are cached for the session.',
  {
    collection: z.string().optional().describe('Specific collection name to discover. Omit to discover all collections.'),
    sampleSize: z.number().optional().describe(`Number of documents to sample per collection (default: ${SAMPLE_SIZE}, max: 1000)`),
    forceRefresh: z.boolean().optional().describe('Force re-sampling even if schema is already cached'),
  },
  async ({ collection, sampleSize, forceRefresh }) => {
    try {
      const size = Math.min(sampleSize ?? SAMPLE_SIZE, 1000);

      let schemas;
      if (collection) {
        const schema = await getSchemaForCollection(collection, forceRefresh ?? false);
        schemas = [schema];
      } else {
        schemas = await getSchemas(forceRefresh ?? false);
      }

      const formatted = schemas.map(s => {
        const text = formatSchemaForPrompt(s);
        return `${text}\n`;
      }).join('\n---\n\n');

      const summary = [
        `## Schema Discovery Complete`,
        `Discovered ${schemas.length} collection(s) using sample size: ${size}`,
        '',
        formatted,
        '',
        `✅ You can now use ask_collection to query these collections in natural language.`,
      ].join('\n');

      return { content: [{ type: 'text', text: summary }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Schema discovery failed: ${String(err)}` }], isError: true };
    }
  },
);

// ── Tool: get_schema ──────────────────────────────────────────────────────────

server.tool(
  'get_schema',
  'Return the cached schema for one or all collections. Fast — does not sample the database. Returns nothing if discover_schema has not been run yet.',
  {
    collection: z.string().optional().describe('Specific collection name. Omit for all cached schemas.'),
  },
  async ({ collection }) => {
    try {
      const cacheInfo = getCacheInfo();

      if (cacheInfo.collections.length === 0) {
        return {
          content: [{
            type: 'text',
            text: 'No schemas cached yet. Run discover_schema first.',
          }],
        };
      }

      const schemas = await getSchemas(false);
      const relevant = collection
        ? schemas.filter(s => s.collection === collection)
        : schemas;

      if (relevant.length === 0) {
        return {
          content: [{
            type: 'text',
            text: `No cached schema for "${collection}". Run discover_schema with collection="${collection}" first.`,
          }],
        };
      }

      const text = [
        `## Cached Schemas (last discovered: ${cacheInfo.lastDiscoveredAt})`,
        '',
        formatSchemasForPrompt(relevant),
      ].join('\n');

      return { content: [{ type: 'text', text: text }] };
    } catch (err) {
      return { content: [{ type: 'text', text: `Error fetching schema: ${String(err)}` }], isError: true };
    }
  },
);

// ── Tool: ask_collection ──────────────────────────────────────────────────────

server.tool(
  'ask_collection',
  'Ask a natural language question about a MongoDB collection. Automatically generates and executes the optimal aggregation pipeline. Returns results as JSON. Requires discover_schema to have been run at least once.',
  {
    collection: z.string().describe('The collection name to query'),
    question: z.string().describe('Natural language question, e.g. "Show me all active trading partners in Germany grouped by industry"'),
    limit: z.number().optional().describe(`Maximum number of results to return (default: 100, max: ${MAX_RESULT_LIMIT})`),
  },
  async ({ collection, question, limit }) => {
    try {
      // Ensure schema is available — auto-discover if needed
      let schemas = await getSchemas(false);
      if (!schemas.some(s => s.collection === collection)) {
        console.error(`[mongodb-query-mcp] Schema not cached for "${collection}" — auto-discovering...`);
        await getSchemaForCollection(collection, true);
        schemas = await getSchemas(false);
      }

      // Generate pipeline
      const generated = await generator.generate(question, schemas, collection);

      // Validate
      const validation = validatePipeline(generated.pipeline);
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `Pipeline validation failed:\n${validation.errors.join('\n')}\n\nGenerated pipeline:\n${serializePipeline(generated.pipeline)}`,
          }],
          isError: true,
        };
      }

      // Override limit if user specified one
      if (limit !== undefined) {
        const limitIdx = validation.pipeline.findIndex(s => Object.keys(s).includes('$limit'));
        const capLimit = Math.min(limit, MAX_RESULT_LIMIT);
        if (limitIdx >= 0) {
          (validation.pipeline[limitIdx] as Record<string, unknown>)['$limit'] = capLimit;
        } else {
          validation.pipeline.push({ $limit: capLimit });
        }
      }

      // Execute
      const result = await executePipeline(collection, validation.pipeline, QUERY_TIMEOUT);

      return {
        content: [{
          type: 'text',
          text: formatExecutionResult({
            ...result,
            explanation: generated.explanation,
            warnings: validation.warnings,
          }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Query failed: ${String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: run_pipeline ────────────────────────────────────────────────────────

server.tool(
  'run_pipeline',
  'Execute a raw MongoDB aggregation pipeline against a collection. The pipeline is validated for safety (read-only, result cap) before execution. Use this when you want to run a specific pipeline rather than generate one from natural language.',
  {
    collection: z.string().describe('The collection name to run the pipeline against'),
    pipeline: z.string().describe('MongoDB aggregation pipeline as a JSON array string, e.g. [{"$match":{"status":"active"}},{"$limit":10}]'),
  },
  async ({ collection, pipeline: pipelineStr }) => {
    try {
      // Parse pipeline
      let rawPipeline: unknown;
      try {
        rawPipeline = JSON.parse(pipelineStr);
      } catch {
        return {
          content: [{ type: 'text', text: `Invalid JSON in pipeline: ${pipelineStr.slice(0, 200)}` }],
          isError: true,
        };
      }

      // Validate
      const validation = validatePipeline(rawPipeline);
      if (!validation.valid) {
        return {
          content: [{
            type: 'text',
            text: `Pipeline validation failed:\n${validation.errors.map(e => `- ${e}`).join('\n')}`,
          }],
          isError: true,
        };
      }

      // Execute
      const result = await executePipeline(collection, validation.pipeline, QUERY_TIMEOUT);

      return {
        content: [{
          type: 'text',
          text: formatExecutionResult({ ...result, warnings: validation.warnings }),
        }],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Pipeline execution failed: ${String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Tool: get_sample_documents ────────────────────────────────────────────────

server.tool(
  'get_sample_documents',
  'Return a sample of raw documents from a collection. Useful for understanding the actual data shape and values before writing queries.',
  {
    collection: z.string().describe('The collection name'),
    limit: z.number().optional().describe('Number of documents to return (default: 5, max: 20)'),
    filter: z.string().optional().describe('Optional MongoDB filter as JSON object string, e.g. {"status":"active"}'),
  },
  async ({ collection, limit, filter: filterStr }) => {
    try {
      let filter: Record<string, unknown> = {};
      if (filterStr) {
        try {
          filter = JSON.parse(filterStr);
        } catch {
          return {
            content: [{ type: 'text', text: `Invalid filter JSON: ${filterStr}` }],
            isError: true,
          };
        }
      }

      const docs = await findDocuments(
        collection,
        filter,
        {},
        Math.min(limit ?? 5, 20),
      );

      const text = [
        `## Sample Documents from "${collection}" (${docs.length} shown)`,
        '',
        `\`\`\`json`,
        JSON.stringify(docs, null, 2),
        `\`\`\``,
      ].join('\n');

      return { content: [{ type: 'text', text: text }] };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Failed to fetch sample documents: ${String(err)}` }],
        isError: true,
      };
    }
  },
);

// ── Startup ───────────────────────────────────────────────────────────────────

async function main() {
  try {
    await connect(MONGODB_URI, MONGODB_DB);

    // Pre-warm schema cache on startup (non-blocking)
    getSchemas(false)
      .then(schemas => {
        console.error(`[mongodb-query-mcp] Schema cache warmed: ${schemas.length} collections`);
      })
      .catch(err => {
        console.error(`[mongodb-query-mcp] Schema pre-warm failed (non-fatal): ${err}`);
      });

    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('[mongodb-query-mcp] Server running on stdio transport');
  } catch (err) {
    console.error('[mongodb-query-mcp] Startup failed:', err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => { await disconnect(); process.exit(0); });
process.on('SIGINT',  async () => { await disconnect(); process.exit(0); });

main();
