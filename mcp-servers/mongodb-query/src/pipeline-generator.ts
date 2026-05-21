/**
 * Pipeline Generator
 *
 * Takes a natural language question + collection schema context and uses
 * an LLM to generate a valid MongoDB aggregation pipeline.
 *
 * Strategy:
 * 1. Build a system prompt that explains the task + injects the schema
 * 2. Provide few-shot examples that cover common patterns
 * 3. Ask the LLM for ONLY a JSON pipeline array — no explanation
 * 4. Parse and return the pipeline
 *
 * The LLM is used ONLY for language → pipeline translation.
 * Execution happens in the pipeline executor against real MongoDB.
 */

import OpenAI from 'openai';
import { CollectionSchema, formatSchemaForPrompt } from './schema-discovery.js';

export interface GeneratedPipeline {
  pipeline: object[];
  explanation: string;       // human-readable explanation of what the pipeline does
  collectionsUsed: string[]; // which collections the pipeline references
}

// ── Few-shot examples ────────────────────────────────────────────────────────
// These teach the LLM the expected output format and common patterns.
// Covers: filter, group, sort, lookup, unwind, project, addFields, limit

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

## EXAMPLE 3 — Filter on nested array field size
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

## EXAMPLE 6 — Aggregation with sum/avg on numeric field
Question: "Average contract value by industry"
Pipeline:
[
  { "$group": {
    "_id": "$industry",
    "avgContractValue": { "$avg": "$contractValue" },
    "totalPartners": { "$sum": 1 },
    "totalValue": { "$sum": "$contractValue" }
  }},
  { "$sort": { "avgContractValue": -1 } },
  { "$project": { "industry": "$_id", "avgContractValue": { "$round": ["$avgContractValue", 2] }, "totalPartners": 1, "totalValue": 1, "_id": 0 } }
]

## EXAMPLE 7 — Search text in nested array
Question: "Find entities where any contact has a gmail address"
Pipeline:
[
  { "$match": { "contacts.email": { "$regex": "@gmail\\.com$", "$options": "i" } } },
  { "$project": { "name": 1, "contacts": { "$filter": { "input": "$contacts", "as": "c", "cond": { "$regexMatch": { "input": "$$c.email", "regex": "@gmail\\.com$", "options": "i" } } } } } }
]

## EXAMPLE 8 — Top N per group (facet pattern)
Question: "Top 3 trading partners by contract value in each country"
Pipeline:
[
  { "$sort": { "contractValue": -1 } },
  { "$group": { "_id": "$country", "topPartners": { "$push": { "name": "$name", "contractValue": "$contractValue" } } } },
  { "$project": { "country": "$_id", "topPartners": { "$slice": ["$topPartners", 3] }, "_id": 0 } },
  { "$sort": { "country": 1 } }
]
`;

// ── System prompt builder ────────────────────────────────────────────────────

function buildSystemPrompt(schemas: CollectionSchema[]): string {
  const schemaText = schemas.map(formatSchemaForPrompt).join('\n\n---\n\n');

  return `You are a MongoDB aggregation pipeline expert. Your ONLY job is to convert natural language questions into valid MongoDB aggregation pipelines.

RULES — you MUST follow every one:
1. Output ONLY a JSON array starting with [ and ending with ] — no markdown, no explanation, no \`\`\` fences
2. The pipeline must be valid MongoDB aggregation syntax
3. ONLY use field names that exist in the schema below — never invent field names
4. For array fields shown as "field[]", use $unwind or $filter/$map as appropriate
5. Always add a $limit stage (max 500) unless the question explicitly asks for all records
6. Prefer $project to remove unnecessary fields from output
7. Use $ifNull to handle optional/nullable fields safely
8. For date comparisons use $dateSubtract with $$NOW rather than hardcoded dates
9. Use $toString, $toDouble, $toDate for type coercion when needed
10. Never use $out, $merge, $currentOp, or any write operation — READ ONLY

AVAILABLE COLLECTIONS AND SCHEMAS:
${schemaText}

FEW-SHOT EXAMPLES:
${FEW_SHOT_EXAMPLES}

When the question is ambiguous, generate the most useful interpretation.
When asked for a "list", default to $limit: 100.
When asked for counts/totals/averages, use $group with appropriate accumulators.
Output the pipeline JSON array on a single line or pretty-printed — both are fine.`;
}

// ── Explanation prompt ────────────────────────────────────────────────────────

function buildExplanationPrompt(question: string, pipeline: object[]): string {
  return `In 1-2 sentences, explain in plain English what this MongoDB aggregation pipeline does in response to the question "${question}".
Pipeline: ${JSON.stringify(pipeline)}
Be specific about what it filters, groups, or computes. Do not use technical MongoDB terms.`;
}

// ── Generator ────────────────────────────────────────────────────────────────

export class PipelineGenerator {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, baseUrl?: string, model?: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: baseUrl,
    });
    // Default to a capable model — can be overridden
    this.model = model ?? 'gpt-4o';
  }

  async generate(
    question: string,
    schemas: CollectionSchema[],
    targetCollection?: string,
  ): Promise<GeneratedPipeline> {
    if (schemas.length === 0) {
      throw new Error('No schemas available. Run discover_schema first.');
    }

    // If a specific collection is targeted, filter to just that schema
    const relevantSchemas = targetCollection
      ? schemas.filter(s => s.collection === targetCollection)
      : schemas;

    if (targetCollection && relevantSchemas.length === 0) {
      throw new Error(`Collection "${targetCollection}" not found in discovered schemas. Available: ${schemas.map(s => s.collection).join(', ')}`);
    }

    const systemPrompt = buildSystemPrompt(relevantSchemas);

    // Step 1: generate the pipeline
    const pipelineResponse = await this.client.chat.completions.create({
      model: this.model,
      temperature: 0,  // deterministic — we want exact valid JSON
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question },
      ],
      response_format: { type: 'json_object' },  // force JSON mode if supported
    });

    let rawContent = pipelineResponse.choices[0]?.message?.content?.trim() ?? '';

    // The model may return {"pipeline": [...]} or just [...] — handle both
    let pipeline: object[];
    try {
      const parsed = JSON.parse(rawContent);
      if (Array.isArray(parsed)) {
        pipeline = parsed;
      } else if (Array.isArray(parsed.pipeline)) {
        pipeline = parsed.pipeline;
      } else {
        // Try to find a JSON array in the response
        const match = rawContent.match(/\[[\s\S]*\]/);
        if (match) {
          pipeline = JSON.parse(match[0]);
        } else {
          throw new Error('Could not extract pipeline array from LLM response');
        }
      }
    } catch {
      // Last resort: strip markdown fences and retry
      rawContent = rawContent.replace(/```(?:json)?/g, '').replace(/```/g, '').trim();
      const match = rawContent.match(/\[[\s\S]*\]/);
      if (match) {
        pipeline = JSON.parse(match[0]);
      } else {
        throw new Error(`LLM returned invalid pipeline JSON: ${rawContent.slice(0, 300)}`);
      }
    }

    // Step 2: generate a human-readable explanation (non-blocking, best-effort)
    let explanation = '';
    try {
      const explResponse = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.3,
        max_tokens: 120,
        messages: [
          { role: 'user', content: buildExplanationPrompt(question, pipeline) },
        ],
      });
      explanation = explResponse.choices[0]?.message?.content?.trim() ?? '';
    } catch {
      explanation = 'Pipeline generated successfully.';
    }

    // Collect which collections are referenced (the main one + any $lookup targets)
    const collectionsUsed = new Set<string>();
    if (targetCollection) collectionsUsed.add(targetCollection);
    for (const stage of pipeline) {
      const lookup = (stage as Record<string, unknown>)['$lookup'];
      if (lookup && typeof lookup === 'object' && (lookup as Record<string, unknown>).from) {
        collectionsUsed.add(String((lookup as Record<string, unknown>).from));
      }
    }

    return {
      pipeline,
      explanation,
      collectionsUsed: Array.from(collectionsUsed),
    };
  }
}
