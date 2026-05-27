# MongoDB Atlas AI Chatbot — Architecture & Implementation Guide

> **Stack:** TypeScript · LangChain · LangGraph · MongoDB Atlas  
> **Pattern:** Agentic Text-to-MQL + RAG + Atlas Full-Text Search via LangGraph Tools  
> **Purpose:** This document is a coding specification. Use it to implement a natural language chatbot that queries MongoDB Atlas using an agentic tool-routing architecture.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Approach Comparison](#2-approach-comparison)
3. [Decision Matrix](#3-decision-matrix)
4. [Project Structure](#4-project-structure)
5. [Environment Setup](#5-environment-setup)
6. [MongoDB Connection](#6-mongodb-connection)
7. [Tool Implementations](#7-tool-implementations)
   - [schema_inspector](#71-schema_inspector)
   - [query_executor](#72-query_executor)
   - [aggregation_runner](#73-aggregation_runner)
   - [vector_search](#74-vector_search)
   - [atlas_text_search](#75-atlas_text_search)
   - [result_formatter](#76-result_formatter)
8. [LangGraph Agent](#8-langgraph-agent)
9. [System Prompt](#9-system-prompt)
10. [Streaming Chat Interface](#10-streaming-chat-interface)
11. [RAG Ingestion Pipeline](#11-rag-ingestion-pipeline)
12. [Atlas Index Configurations](#12-atlas-index-configurations)
13. [MQL Validation & Security](#13-mql-validation--security)
14. [Error Handling](#14-error-handling)
15. [Testing](#15-testing)

---

## 1. Overview

Build a LangGraph ReAct agent that answers natural language questions by routing to the correct MongoDB query strategy. The agent exposes all three approaches as tools and selects the right one based on the user's intent.

```
User Question
     │
     ▼
LangGraph ReAct Agent (claude-sonnet / gpt-4o)
     │
     ├── schema_inspector    → inspect collection schema before querying
     ├── query_executor      → Text-to-MQL: structured find() queries
     ├── aggregation_runner  → Text-to-MQL: aggregation pipelines
     ├── vector_search       → RAG: semantic similarity via $vectorSearch
     ├── atlas_text_search   → Full-text: keyword/fuzzy via $search
     └── result_formatter    → format raw results into natural language
     │
     ▼
MongoDB Atlas (MQL · Vector Search · Full-Text Search)
```

### ReAct Loop (7 Steps)

1. **Receive** — user submits natural language question
2. **Reason** — LLM determines intent (filter? aggregate? semantic? keyword?)
3. **Inspect Schema** — calls `schema_inspector` to learn collection structure
4. **Select Tool** — picks the appropriate query tool
5. **Execute** — runs the tool against MongoDB Atlas
6. **Observe / Retry** — checks results; retries with corrected query if error
7. **Format & Stream** — formats final answer and streams to user

---

## 2. Approach Comparison

| Attribute | Text-to-MQL | RAG + Vector Search | Atlas Full-Text Search |
|---|---|---|---|
| **Best For** | Structured data, analytics | Unstructured text, semantic search | Keyword/fuzzy/autocomplete |
| **Data Type** | Orders, users, products | Articles, descriptions, notes | Names, tags, text fields |
| **Query Type** | Filter, aggregate, join | Similarity, Q&A | Keyword, phrase, fuzzy |
| **Accuracy** | Very high for structured data | High for semantic intent | High for keyword matching |
| **Latency** | Low (1–2 LLM + 1 DB call) | Medium (embed + search + LLM) | Very low (single DB call) |
| **Infrastructure** | None extra | Embedding model + vector index | Atlas Search index |
| **Example Questions** | "Top 5 customers by spend" | "Find jackets like a parka" | "Search bluetooth headphones" |

---

## 3. Decision Matrix

| Query / Scenario | Text-to-MQL | RAG + Vector | Atlas Search |
|---|---|---|---|
| Filter by field value (status, date, price) | ✅ Best choice | ❌ Not suitable | ⚠️ Text fields only |
| Aggregation — group, count, sum, average | ✅ Best choice | ❌ Not suitable | ❌ Not suitable |
| Join multiple collections ($lookup) | ✅ Best choice | ❌ Not suitable | ❌ Not suitable |
| Semantic similarity ("find items like X") | ❌ Not suitable | ✅ Best choice | ⚠️ Keyword only |
| Q&A over unstructured documents | ❌ Not suitable | ✅ Best choice | ⚠️ Partial |
| Fuzzy / typo-tolerant keyword search | ❌ Not suitable | ✅ Works well | ✅ Best choice |
| Autocomplete / search-as-you-type | ❌ Not suitable | ⚠️ Slow | ✅ Best choice |
| Real-time analytics / ranking top-N | ✅ Best choice | ❌ Not suitable | ❌ Not suitable |
| Mixed: structured + unstructured data | 🔀 Combine all 3 | 🔀 Combine all 3 | 🔀 Combine all 3 |

---

## 4. Project Structure

```
mongo-ai-chatbot/
├── src/
│   ├── db/
│   │   └── client.ts              # MongoDB connection singleton
│   ├── tools/
│   │   ├── schemaInspector.ts     # schema_inspector tool
│   │   ├── queryExecutor.ts       # query_executor tool
│   │   ├── aggregationRunner.ts   # aggregation_runner tool
│   │   ├── vectorSearch.ts        # vector_search tool
│   │   ├── atlasTextSearch.ts     # atlas_text_search tool
│   │   ├── resultFormatter.ts     # result_formatter tool
│   │   └── index.ts               # barrel export
│   ├── agent/
│   │   ├── systemPrompt.ts        # system prompt builder
│   │   └── mongoAgent.ts          # LangGraph ReAct agent
│   ├── ingestion/
│   │   └── embedDocuments.ts      # RAG ingestion pipeline
│   ├── validation/
│   │   └── mqlValidator.ts        # MQL safety validator
│   └── index.ts                   # entry point / chat loop
├── .env
├── package.json
└── tsconfig.json
```

---

## 5. Environment Setup

### package.json dependencies

```json
{
  "dependencies": {
    "@langchain/anthropic": "^0.3.0",
    "@langchain/core": "^0.3.0",
    "@langchain/langgraph": "^0.2.0",
    "@langchain/openai": "^0.3.0",
    "mongodb": "^6.0.0",
    "zod": "^3.22.0",
    "dotenv": "^16.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0"
  }
}
```

### .env

```env
# MongoDB
MONGODB_URI=mongodb+srv://<user>:<password>@cluster0.xxxxx.mongodb.net/
MONGODB_DB_NAME=your_database

# LLM — use one
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...

# Embeddings (for RAG / vector search)
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
```

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "outDir": "dist",
    "esModuleInterop": true
  },
  "include": ["src/**/*"]
}
```

---

## 6. MongoDB Connection

```typescript
// src/db/client.ts
import { MongoClient, Db } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

let client: MongoClient | null = null;

export async function getDb(): Promise<Db> {
  if (!client) {
    // IMPORTANT: Always use a read-only MongoDB user for the agent
    client = new MongoClient(process.env.MONGODB_URI!, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    });
    await client.connect();
  }
  return client.db(process.env.MONGODB_DB_NAME!);
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
  }
}
```

---

## 7. Tool Implementations

### 7.1 schema_inspector

Purpose: Called first before any query. Retrieves sample documents and index info so the LLM understands the collection structure before generating MQL.

```typescript
// src/tools/schemaInspector.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDb } from "../db/client.js";

export const schemaInspectorTool = tool(
  async ({ collectionName, sampleSize = 3 }) => {
    try {
      const db = await getDb();
      const collection = db.collection(collectionName);

      const [sampleDocs, indexes, count] = await Promise.all([
        collection.find({}).limit(sampleSize).toArray(),
        collection.indexes(),
        collection.estimatedDocumentCount(),
      ]);

      // Derive field types from sample docs
      const fieldTypes: Record<string, string> = {};
      if (sampleDocs.length > 0) {
        for (const [key, value] of Object.entries(sampleDocs[0])) {
          fieldTypes[key] = value instanceof Date
            ? "Date"
            : Array.isArray(value)
            ? "Array"
            : typeof value;
        }
      }

      return JSON.stringify({
        collectionName,
        estimatedDocumentCount: count,
        fieldTypes,
        sampleDocuments: sampleDocs,
        indexes: indexes.map((i) => ({ name: i.name, key: i.key })),
      }, null, 2);
    } catch (err: any) {
      return `Error inspecting schema: ${err.message}`;
    }
  },
  {
    name: "schema_inspector",
    description: `ALWAYS call this tool FIRST before generating any query.
Retrieves collection schema by fetching sample documents, field types, 
indexes, and document count. Use the returned schema to generate accurate 
MQL filters or aggregation pipelines.`,
    schema: z.object({
      collectionName: z.string().describe("MongoDB collection name to inspect"),
      sampleSize: z.number().optional().default(3).describe("Number of sample docs to fetch (default 3)"),
    }),
  }
);
```

---

### 7.2 query_executor

Purpose: Executes generated MQL find() queries. Use for simple filtering, field comparisons, date ranges, and sorted lookups.

```typescript
// src/tools/queryExecutor.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDb } from "../db/client.js";
import { validateMql } from "../validation/mqlValidator.js";

export const queryExecutorTool = tool(
  async ({ collectionName, filter, projection, sort, limit, skip }) => {
    try {
      // Validate MQL before execution (security)
      const filterObj = JSON.parse(filter);
      const validationError = validateMql(filterObj);
      if (validationError) return `MQL validation failed: ${validationError}`;

      const db = await getDb();
      const collection = db.collection(collectionName);

      const projectionObj = projection ? JSON.parse(projection) : {};
      const sortObj = sort ? JSON.parse(sort) : {};
      const limitVal = Math.min(limit ?? 20, 100); // Hard cap at 100

      const results = await collection
        .find(filterObj, { projection: projectionObj })
        .sort(sortObj)
        .skip(skip ?? 0)
        .limit(limitVal)
        .toArray();

      return JSON.stringify({
        collectionName,
        filter: filterObj,
        count: results.length,
        results,
      }, null, 2);
    } catch (err: any) {
      return `Query execution error: ${err.message}. Check the filter JSON syntax and field names.`;
    }
  },
  {
    name: "query_executor",
    description: `Execute a MongoDB find() query using a generated MQL filter.
Use for: filtering by field values, date ranges, status checks, ID lookups,
sorted result sets. 
Generate filter as a valid JSON MQL object using operators like:
$eq, $ne, $gt, $gte, $lt, $lte, $in, $nin, $and, $or, $regex
For dates use ISO strings: { "createdAt": { "$gte": "2024-01-01T00:00:00Z" } }
Do NOT use $where or $function operators.`,
    schema: z.object({
      collectionName: z.string().describe("Target collection name"),
      filter: z.string().describe('JSON string MQL filter. Example: {"status":"active","price":{"$gte":100}}'),
      projection: z.string().optional().describe('JSON string of fields to return. Example: {"name":1,"email":1,"_id":0}'),
      sort: z.string().optional().describe('JSON string sort order. Example: {"createdAt":-1}'),
      limit: z.number().optional().default(20).describe("Max results to return (default 20, max 100)"),
      skip: z.number().optional().default(0).describe("Number of results to skip for pagination"),
    }),
  }
);
```

---

### 7.3 aggregation_runner

Purpose: Executes MongoDB aggregation pipelines. Use for grouping, counting, averaging, ranking, joining collections, and complex analytics.

```typescript
// src/tools/aggregationRunner.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDb } from "../db/client.js";

export const aggregationRunnerTool = tool(
  async ({ collectionName, pipeline }) => {
    try {
      const db = await getDb();
      const collection = db.collection(collectionName);

      const parsedPipeline = JSON.parse(pipeline);

      // Ensure pipeline has a $limit stage to prevent runaway queries
      const hasLimit = parsedPipeline.some(
        (stage: any) => "$limit" in stage
      );
      if (!hasLimit) {
        parsedPipeline.push({ $limit: 100 });
      }

      const results = await collection
        .aggregate(parsedPipeline, { maxTimeMS: 30000 })
        .toArray();

      return JSON.stringify({
        collectionName,
        pipelineStages: parsedPipeline.map((s: any) => Object.keys(s)[0]),
        count: results.length,
        results,
      }, null, 2);
    } catch (err: any) {
      return `Aggregation error: ${err.message}. Review the pipeline JSON syntax and stage operators.`;
    }
  },
  {
    name: "aggregation_runner",
    description: `Run a MongoDB aggregation pipeline for complex queries.
Use for: grouping by field, counting documents, computing averages/sums/min/max,
joining collections with $lookup, unwinding arrays, date-based bucketing,
top-N rankings, faceted search results.
Pipeline must be a valid JSON array of stage objects.
Common stages: $match, $group, $sort, $limit, $skip, $project, $lookup, $unwind, $count, $facet
Example for top customers:
[{"$group":{"_id":"$customerId","totalSpend":{"$sum":"$amount"}}},{"$sort":{"totalSpend":-1}},{"$limit":5}]`,
    schema: z.object({
      collectionName: z.string().describe("Target collection name"),
      pipeline: z.string().describe("JSON array string of aggregation pipeline stages"),
    }),
  }
);
```

---

### 7.4 vector_search

Purpose: Semantic similarity search using MongoDB Atlas $vectorSearch. Use when the user wants to find items by meaning, not exact keywords.

```typescript
// src/tools/vectorSearch.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { OpenAIEmbeddings } from "@langchain/openai";
import { getDb } from "../db/client.js";

const embeddings = new OpenAIEmbeddings({
  model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1536"),
});

export const vectorSearchTool = tool(
  async ({ collectionName, query, indexName, limit, filter }) => {
    try {
      // Embed the user's query using the same model used at ingestion
      const queryVector = await embeddings.embedQuery(query);

      const db = await getDb();
      const collection = db.collection(collectionName);

      const pipeline: any[] = [
        {
          $vectorSearch: {
            index: indexName,
            path: "embedding",          // Field storing the vector
            queryVector,
            numCandidates: (limit ?? 10) * 10, // Oversample for better recall
            limit: limit ?? 10,
            ...(filter ? { filter: JSON.parse(filter) } : {}),
          },
        },
        {
          $project: {
            embedding: 0,               // Exclude the embedding vector from results
            score: { $meta: "vectorSearchScore" },
          },
        },
      ];

      const results = await collection.aggregate(pipeline).toArray();

      return JSON.stringify({
        collectionName,
        query,
        indexName,
        count: results.length,
        results,
      }, null, 2);
    } catch (err: any) {
      return `Vector search error: ${err.message}`;
    }
  },
  {
    name: "vector_search",
    description: `Perform semantic similarity search using Atlas Vector Search ($vectorSearch).
Use for: finding semantically similar items, "find products like X", Q&A over 
documents, recommendation queries based on meaning/context.
Do NOT use for: exact field matches, numerical comparisons, aggregations.
Requires: collection must have an Atlas Vector Search index and an "embedding" field.`,
    schema: z.object({
      collectionName: z.string().describe("Collection with vector embeddings"),
      query: z.string().describe("Natural language query to embed and search by"),
      indexName: z.string().describe('Name of the Atlas Vector Search index (e.g. "vector_index")'),
      limit: z.number().optional().default(10).describe("Number of similar results to return"),
      filter: z.string().optional().describe("Optional MQL pre-filter JSON to narrow the vector search scope"),
    }),
  }
);
```

---

### 7.5 atlas_text_search

Purpose: Keyword and fuzzy full-text search using Atlas Search ($search). Use for search-bar style queries, typo-tolerant name lookups, and autocomplete.

```typescript
// src/tools/atlasTextSearch.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getDb } from "../db/client.js";

export const atlasTextSearchTool = tool(
  async ({ collectionName, query, searchFields, indexName, fuzzy, limit }) => {
    try {
      const db = await getDb();
      const collection = db.collection(collectionName);

      // Build the $search stage based on search type
      const searchStage = fuzzy
        ? {
            $search: {
              index: indexName ?? "default",
              text: {
                query,
                path: searchFields ?? { wildcard: "*" },
                fuzzy: { maxEdits: 2, prefixLength: 3 }, // Typo tolerance
              },
              highlight: { path: searchFields?.[0] ?? "name" },
            },
          }
        : {
            $search: {
              index: indexName ?? "default",
              text: {
                query,
                path: searchFields ?? { wildcard: "*" },
              },
            },
          };

      const pipeline = [
        searchStage,
        {
          $project: {
            score: { $meta: "searchScore" },
            highlights: { $meta: "searchHighlights" },
            _id: 1,
            name: 1,        // Adjust to your collection fields
            description: 1,
          },
        },
        { $limit: limit ?? 10 },
      ];

      const results = await collection.aggregate(pipeline).toArray();

      return JSON.stringify({
        collectionName,
        query,
        fuzzy,
        count: results.length,
        results,
      }, null, 2);
    } catch (err: any) {
      return `Atlas Search error: ${err.message}`;
    }
  },
  {
    name: "atlas_text_search",
    description: `Perform full-text keyword search using Atlas Search ($search stage).
Use for: keyword search, fuzzy/typo-tolerant name matching, phrase search,
autocomplete queries, search-bar style interactions.
Do NOT use for: numerical filters, aggregations, semantic/meaning-based search.
Requires: collection must have an Atlas Search index configured.`,
    schema: z.object({
      collectionName: z.string().describe("Target collection"),
      query: z.string().describe("Keyword or phrase to search for"),
      searchFields: z.array(z.string()).optional().describe('Fields to search. Example: ["name","description","tags"]'),
      indexName: z.string().optional().default("default").describe('Atlas Search index name (default: "default")'),
      fuzzy: z.boolean().optional().default(false).describe("Enable fuzzy/typo-tolerant matching (maxEdits: 2)"),
      limit: z.number().optional().default(10).describe("Max results to return"),
    }),
  }
);
```

---

### 7.6 result_formatter

Purpose: Formats raw MongoDB results into clean, human-readable tables or summaries. Call this after any query tool when the result set needs to be presented clearly.

```typescript
// src/tools/resultFormatter.ts
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const resultFormatterTool = tool(
  async ({ rawResults, formatType, title }) => {
    try {
      const data = JSON.parse(rawResults);
      const results = data.results ?? data;

      if (!Array.isArray(results) || results.length === 0) {
        return "No results found for your query.";
      }

      if (formatType === "table") {
        const keys = Object.keys(results[0]).filter((k) => k !== "_id" && k !== "embedding");
        const header = `| ${keys.join(" | ")} |`;
        const separator = `| ${keys.map(() => "---").join(" | ")} |`;
        const rows = results.map(
          (r) => `| ${keys.map((k) => String(r[k] ?? "").substring(0, 50)).join(" | ")} |`
        );
        return `**${title ?? "Results"}**\n\n${header}\n${separator}\n${rows.join("\n")}`;
      }

      if (formatType === "summary") {
        return `**${title ?? "Summary"}**\n\nFound ${results.length} result(s):\n${
          results
            .slice(0, 5)
            .map((r, i) => `${i + 1}. ${JSON.stringify(r, null, 2)}`)
            .join("\n")
        }`;
      }

      // Default: JSON pretty print
      return JSON.stringify(results, null, 2);
    } catch (err: any) {
      return `Formatting error: ${err.message}`;
    }
  },
  {
    name: "result_formatter",
    description: `Format raw MongoDB query results into a readable response.
Call this after query_executor, aggregation_runner, vector_search, or atlas_text_search
to present data as a markdown table or plain summary.`,
    schema: z.object({
      rawResults: z.string().describe("JSON string of raw results from a query tool"),
      formatType: z.enum(["table", "summary", "json"]).default("table").describe("Output format"),
      title: z.string().optional().describe("Optional heading for the results block"),
    }),
  }
);
```

---

### Tool Barrel Export

```typescript
// src/tools/index.ts
export { schemaInspectorTool } from "./schemaInspector.js";
export { queryExecutorTool } from "./queryExecutor.js";
export { aggregationRunnerTool } from "./aggregationRunner.js";
export { vectorSearchTool } from "./vectorSearch.js";
export { atlasTextSearchTool } from "./atlasTextSearch.js";
export { resultFormatterTool } from "./resultFormatter.js";

export const allTools = [
  (await import("./schemaInspector.js")).schemaInspectorTool,
  (await import("./queryExecutor.js")).queryExecutorTool,
  (await import("./aggregationRunner.js")).aggregationRunnerTool,
  (await import("./vectorSearch.js")).vectorSearchTool,
  (await import("./atlasTextSearch.js")).atlasTextSearchTool,
  (await import("./resultFormatter.js")).resultFormatterTool,
];
```

---

## 8. LangGraph Agent

```typescript
// src/agent/mongoAgent.ts
import { ChatAnthropic } from "@langchain/anthropic";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { allTools } from "../tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";

const model = new ChatAnthropic({
  model: "claude-sonnet-4-20250514",
  temperature: 0,           // Use 0 for deterministic query generation
  maxTokens: 4096,
});

export const mongoAgent = createReactAgent({
  llm: model,
  tools: allTools,
  messageModifier: buildSystemPrompt(),
});

// Main chat function with streaming
export async function chat(userQuestion: string): Promise<string> {
  const stream = await mongoAgent.stream(
    {
      messages: [new HumanMessage(userQuestion)],
    },
    {
      streamMode: "values",
      recursionLimit: 10,   // Prevent infinite tool-calling loops
    }
  );

  let finalResponse = "";

  for await (const chunk of stream) {
    const lastMessage = chunk.messages[chunk.messages.length - 1];

    if (lastMessage._getType() === "ai") {
      if (lastMessage.tool_calls?.length > 0) {
        // Optional: log tool calls for debugging
        console.log(`[Tool] ${lastMessage.tool_calls[0].name}`);
      } else if (lastMessage.content) {
        finalResponse = typeof lastMessage.content === "string"
          ? lastMessage.content
          : JSON.stringify(lastMessage.content);
      }
    }
  }

  return finalResponse;
}
```

---

## 9. System Prompt

> **Important:** The system prompt is the single most important factor in query accuracy. Customize the collection list and field descriptions for your specific database schema.

```typescript
// src/agent/systemPrompt.ts
export function buildSystemPrompt(): string {
  return `You are a MongoDB Atlas query expert assistant. You help users query data 
using natural language by generating accurate MongoDB queries and returning results.

## Available Collections
<!-- CUSTOMIZE THIS SECTION FOR YOUR DATABASE -->
- **orders**: Customer orders. Fields: _id (ObjectId), customerId (ObjectId), 
  status (string: "pending"|"shipped"|"delivered"|"cancelled"), 
  totalAmount (number), items (array), createdAt (Date), updatedAt (Date)
- **customers**: Customer profiles. Fields: _id (ObjectId), name (string), 
  email (string), phone (string), address (object), createdAt (Date)
- **products**: Product catalog. Fields: _id (ObjectId), name (string), 
  description (string), price (number), stock (number), category (string), 
  tags (array), embedding (array — vector field for semantic search)

## Tool Selection Rules

1. **ALWAYS call schema_inspector FIRST** before generating any query to verify 
   field names and types. Never assume field names.

2. **Use query_executor** when the question involves:
   - Filtering by field value, date range, status, ID
   - Simple lookups with sorting and limiting
   - Questions like: "show me", "list", "find", "get"

3. **Use aggregation_runner** when the question involves:
   - Counting, summing, averaging, grouping
   - Top-N rankings, joins across collections
   - Questions like: "how many", "total", "average", "top 5", "by category"

4. **Use vector_search** when the question involves:
   - Finding similar items by meaning or description
   - Semantic queries: "similar to", "like", "related to", "recommend"

5. **Use atlas_text_search** when the question involves:
   - Keyword or phrase search in text fields
   - Fuzzy name lookups with possible typos
   - Search-bar style: "search for", "find products containing"

6. **Use result_formatter** after retrieving results to present them as a 
   clean markdown table or summary.

## Query Generation Rules

- Always limit results: default 20, max 100 unless asked for more
- For dates, always use ISO 8601: { "$gte": "2024-01-01T00:00:00Z" }
- For ObjectId fields use string representation: { "_id": "507f1f77bcf86cd799439011" }
- If a query returns an error, inspect the error message and try with corrected syntax
- Never use $where, $function, or mapReduce — these are blocked for security
- Prefer $lookup over multiple separate queries when joining collections

## Response Format

- Present results as markdown tables when there are multiple rows
- For single results, use a clear summary with key fields highlighted
- Always state how many results were found
- If no results found, suggest alternative query approaches`;
}
```

---

## 10. Streaming Chat Interface

```typescript
// src/index.ts
import * as readline from "readline";
import { chat } from "./agent/mongoAgent.js";
import { closeDb } from "./db/client.js";
import dotenv from "dotenv";
dotenv.config();

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  console.log("MongoDB AI Chatbot — type 'exit' to quit\n");

  const askQuestion = () => {
    rl.question("You: ", async (input) => {
      const question = input.trim();

      if (question.toLowerCase() === "exit") {
        await closeDb();
        rl.close();
        return;
      }

      if (!question) {
        askQuestion();
        return;
      }

      try {
        process.stdout.write("Assistant: ");
        const response = await chat(question);
        console.log(response);
        console.log();
      } catch (err: any) {
        console.error(`Error: ${err.message}`);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main();
```

---

## 11. RAG Ingestion Pipeline

Run this script once (and re-run when data changes) to generate and store embeddings for vector search.

```typescript
// src/ingestion/embedDocuments.ts
import { OpenAIEmbeddings } from "@langchain/openai";
import { getDb, closeDb } from "../db/client.js";
import dotenv from "dotenv";
dotenv.config();

const embeddings = new OpenAIEmbeddings({
  model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? "1536"),
});

// Customize: which collection to embed and which fields to concatenate for embedding
const COLLECTION_NAME = "products";
const FIELDS_TO_EMBED = ["name", "description", "category", "tags"];
const BATCH_SIZE = 100;

async function embedCollection() {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);

  // Only process documents that don't already have embeddings
  const cursor = collection.find({ embedding: { $exists: false } });
  const totalCount = await collection.countDocuments({ embedding: { $exists: false } });

  console.log(`Embedding ${totalCount} documents in ${COLLECTION_NAME}...`);

  let batch: any[] = [];
  let processed = 0;

  for await (const doc of cursor) {
    batch.push(doc);

    if (batch.length >= BATCH_SIZE) {
      await processBatch(batch, collection);
      processed += batch.length;
      console.log(`Progress: ${processed}/${totalCount}`);
      batch = [];
    }
  }

  // Process remaining docs
  if (batch.length > 0) {
    await processBatch(batch, collection);
    processed += batch.length;
  }

  console.log(`Done. Embedded ${processed} documents.`);
  await closeDb();
}

async function processBatch(docs: any[], collection: any) {
  // Concatenate text fields into a single string for embedding
  const texts = docs.map((doc) =>
    FIELDS_TO_EMBED
      .map((field) => {
        const val = doc[field];
        return Array.isArray(val) ? val.join(", ") : String(val ?? "");
      })
      .filter(Boolean)
      .join(". ")
  );

  // Generate embeddings in batch (more efficient than one at a time)
  const vectors = await embeddings.embedDocuments(texts);

  // Write embeddings back to MongoDB
  const bulkOps = docs.map((doc, i) => ({
    updateOne: {
      filter: { _id: doc._id },
      update: { $set: { embedding: vectors[i], embeddedAt: new Date() } },
    },
  }));

  await collection.bulkWrite(bulkOps, { ordered: false });
}

embedCollection().catch(console.error);
```

---

## 12. Atlas Index Configurations

Create these indexes in the MongoDB Atlas UI or via the Atlas CLI before running the agent.

### 12.1 Atlas Vector Search Index

Create this in Atlas UI: **Atlas Search → Create Index → JSON Editor**

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    },
    {
      "type": "filter",
      "path": "category"
    },
    {
      "type": "filter",
      "path": "price"
    }
  ]
}
```

- **Index name:** `vector_index`
- **Collection:** `products` (or whichever collection has embeddings)
- **numDimensions:** must match your embedding model (1536 for text-embedding-3-small)

### 12.2 Atlas Full-Text Search Index

```json
{
  "mappings": {
    "dynamic": false,
    "fields": {
      "name": {
        "type": "string",
        "analyzer": "lucene.standard"
      },
      "description": {
        "type": "string",
        "analyzer": "lucene.standard"
      },
      "category": {
        "type": "string",
        "analyzer": "lucene.keyword"
      },
      "tags": {
        "type": "string",
        "analyzer": "lucene.standard"
      }
    }
  }
}
```

- **Index name:** `default`
- **Collection:** `products`

### 12.3 Regular MongoDB Indexes (for MQL performance)

Run these in mongosh or Compass:

```javascript
// orders collection
db.orders.createIndex({ customerId: 1 });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ createdAt: -1 });
db.orders.createIndex({ customerId: 1, createdAt: -1 });

// customers collection
db.customers.createIndex({ email: 1 }, { unique: true });
db.customers.createIndex({ createdAt: -1 });

// products collection
db.products.createIndex({ category: 1 });
db.products.createIndex({ price: 1 });
db.products.createIndex({ stock: 1 });
```

---

## 13. MQL Validation & Security

```typescript
// src/validation/mqlValidator.ts

// Operators that allow arbitrary code execution — always blocked
const BLOCKED_OPERATORS = [
  "$where",
  "$function",
  "$accumulator",
];

// Only allow queries against whitelisted collections
const ALLOWED_COLLECTIONS = [
  "orders",
  "customers",
  "products",
  // Add your collection names here
];

export function validateMql(filter: Record<string, any>): string | null {
  const filterStr = JSON.stringify(filter);

  for (const op of BLOCKED_OPERATORS) {
    if (filterStr.includes(op)) {
      return `Blocked operator detected: ${op}. This operator is not permitted.`;
    }
  }

  return null; // null means valid
}

export function validateCollectionName(name: string): string | null {
  if (!ALLOWED_COLLECTIONS.includes(name)) {
    return `Collection "${name}" is not in the allowed list: ${ALLOWED_COLLECTIONS.join(", ")}`;
  }
  return null;
}

export function validatePipeline(pipeline: any[]): string | null {
  const pipelineStr = JSON.stringify(pipeline);

  for (const op of BLOCKED_OPERATORS) {
    if (pipelineStr.includes(op)) {
      return `Blocked operator in pipeline: ${op}`;
    }
  }

  // Ensure there's a $limit stage or we'll add one automatically
  const hasLimit = pipeline.some((stage) => "$limit" in stage);
  if (!hasLimit) {
    pipeline.push({ $limit: 100 });
  }

  return null;
}
```

---

## 14. Error Handling

```typescript
// Error handling patterns for all tools

// Pattern 1: JSON parse errors (malformed LLM output)
try {
  const parsed = JSON.parse(llmGeneratedJson);
} catch {
  return "Invalid JSON generated. Please retry with correct syntax.";
}

// Pattern 2: MongoDB timeout
const result = await collection
  .aggregate(pipeline, { maxTimeMS: 30_000 })
  .toArray();

// Pattern 3: Empty results — return helpful message
if (results.length === 0) {
  return JSON.stringify({
    count: 0,
    results: [],
    suggestion: "No documents matched. Try broadening the filter or checking field names.",
  });
}

// Pattern 4: Agent recursion limit — set in agent config
const stream = await mongoAgent.stream(query, {
  recursionLimit: 10,  // Prevents infinite tool-call loops
});
```

---

## 15. Testing

### Example test questions by approach

```typescript
// Test Text-to-MQL
const mqlQuestions = [
  "Show me all orders with status 'pending'",
  "How many orders were placed in the last 30 days?",
  "What are the top 5 customers by total spend?",
  "List all products with stock less than 10",
  "Show orders placed between January and March 2024",
];

// Test RAG / Vector Search
const vectorQuestions = [
  "Find products similar to a cozy winter jacket",
  "Recommend products for outdoor camping",
  "What products are related to wireless audio?",
];

// Test Atlas Full-Text Search
const textSearchQuestions = [
  "Search for products containing 'bluetooth'",
  "Find customers named 'Jon Smith' (fuzzy)",
  "Search for products in the 'electronics' category",
];

// Test Aggregations
const aggregationQuestions = [
  "What is the average order value by month?",
  "Group products by category and show the count",
  "Which customer has placed the most orders?",
  "Show me revenue by product category for this year",
];
```

### Run a test

```typescript
// Quick test runner
import { chat } from "./src/agent/mongoAgent.js";

const testQuestions = [
  "How many orders do we have in total?",
  "What are the top 3 best-selling products?",
  "Find products similar to wireless headphones",
  "Search for customers named Johnson",
];

for (const q of testQuestions) {
  console.log(`\nQ: ${q}`);
  const answer = await chat(q);
  console.log(`A: ${answer}`);
}
```

---

## Key Implementation Notes for Copilot

1. **Always inspect schema first** — the `schema_inspector` tool call before any query is non-negotiable. Bake this into the system prompt as a hard rule.

2. **Use temperature 0** for the LLM when generating MQL — deterministic output produces more reliable query syntax.

3. **Read-only MongoDB user** — create a dedicated Atlas user with `readAnyDatabase` role only. Never use an admin connection for the agent.

4. **Validate before execute** — run `validateMql()` on every generated filter before sending it to MongoDB. Block `$where` and `$function` at minimum.

5. **Hard result caps** — always enforce a `$limit` in aggregations and a `.limit()` cap on find queries. The default cap should be 20, with a hard max of 100.

6. **Embedding consistency** — the embedding model used at ingestion and at query time must be identical. Mixing models produces incorrect similarity scores.

7. **Index before querying** — Atlas Vector Search and Atlas Full-Text Search require indexes to be created in the Atlas UI before the tools will work. Regular MQL performance also depends on the indexes in section 12.3.

8. **LangSmith tracing** — add `LANGCHAIN_TRACING_V2=true` and `LANGCHAIN_API_KEY` to your `.env` to trace every agent step in LangSmith for debugging.
