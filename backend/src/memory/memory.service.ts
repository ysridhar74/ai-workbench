/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  LongTermMemory,
  LongTermMemoryDocument,
} from '../db/schemas/long-term-memory.schema';
import {
  EntityMemory,
  EntityMemoryDocument,
} from '../db/schemas/entity-memory.schema';

export interface MemoryContext {
  /** Formatted string to prepend to system prompt */
  systemFragment: string;
  /** Raw long-term facts for the user */
  longTermFacts: Array<{ key: string; value: string }>;
  /** Raw entities for the user */
  entities: Array<{ entityType: string; name: string; attributes: Record<string, unknown> }>;
}

export interface ExtractionResult {
  facts: Array<{ key: string; value: string; confidence: number }>;
  entities: Array<{
    entityType: string;
    name: string;
    attributes: Record<string, unknown>;
    mention: string;
  }>;
}

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(
    @InjectModel(LongTermMemory.name)
    private readonly ltmModel: Model<LongTermMemoryDocument>,
    @InjectModel(EntityMemory.name)
    private readonly entityModel: Model<EntityMemoryDocument>,
    private readonly config: ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Long-term memory CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /** Upsert a single fact for a user */
  async upsertFact(
    userId: string,
    key: string,
    value: string,
    source = 'manual',
    confidence = 1,
  ): Promise<void> {
    await this.ltmModel.findOneAndUpdate(
      { userId, key },
      { $set: { value, source, confidence } },
      { upsert: true, new: true },
    );
  }

  /** Get all facts for a user */
  async getFacts(userId: string): Promise<LongTermMemoryDocument[]> {
    return this.ltmModel.find({ userId }).lean().exec() as any;
  }

  /** Delete a specific fact */
  async deleteFact(userId: string, key: string): Promise<void> {
    await this.ltmModel.deleteOne({ userId, key });
  }

  /** Delete all facts for a user */
  async clearFacts(userId: string): Promise<void> {
    await this.ltmModel.deleteMany({ userId });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Entity memory CRUD
  // ─────────────────────────────────────────────────────────────────────────

  /** Upsert an entity — merges attributes, appends mention */
  async upsertEntity(
    userId: string,
    entityType: string,
    name: string,
    attributes: Record<string, unknown> = {},
    mention?: string,
  ): Promise<void> {
    const update: any = {
      $set: { [`attributes`]: {} }, // will be overridden below
    };

    // Build $set for each attribute key to merge instead of replace
    const setOps: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(attributes)) {
      setOps[`attributes.${k}`] = v;
    }

    const pushOps: any = {};
    if (mention) {
      pushOps['mentions'] = { $each: [mention], $slice: -20 }; // keep last 20 mentions
    }

    await this.entityModel.findOneAndUpdate(
      { userId, entityType, name },
      {
        ...(Object.keys(setOps).length ? { $set: setOps } : {}),
        ...(mention ? { $push: pushOps } : {}),
      },
      { upsert: true, new: true },
    );
  }

  /** Get all entities for a user, optionally filtered by type */
  async getEntities(
    userId: string,
    entityType?: string,
  ): Promise<EntityMemoryDocument[]> {
    const filter: any = { userId };
    if (entityType) filter.entityType = entityType;
    return this.entityModel.find(filter).lean().exec() as any;
  }

  /** Delete a specific entity */
  async deleteEntity(userId: string, entityType: string, name: string): Promise<void> {
    await this.entityModel.deleteOne({ userId, entityType, name });
  }

  /** Delete all entities for a user */
  async clearEntities(userId: string): Promise<void> {
    await this.entityModel.deleteMany({ userId });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Memory context builder — called before each agent run
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load all memory for a userId and build a system prompt fragment.
   * Returns an empty fragment if there is no memory yet.
   */
  async buildContext(userId: string): Promise<MemoryContext> {
    const [facts, entities] = await Promise.all([
      this.getFacts(userId),
      this.getEntities(userId),
    ]);

    if (facts.length === 0 && entities.length === 0) {
      return { systemFragment: '', longTermFacts: [], entities: [] };
    }

    const lines: string[] = ['## What you know about this user'];

    if (facts.length > 0) {
      lines.push('\n### Persistent facts');
      for (const f of facts) {
        lines.push(`- ${f.key}: ${f.value}`);
      }
    }

    if (entities.length > 0) {
      lines.push('\n### Known entities');
      for (const e of entities) {
        const attrs = Object.entries(e.attributes ?? {})
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(', ');
        lines.push(`- [${e.entityType}] ${e.name}${attrs ? ` (${attrs})` : ''}`);
      }
    }

    lines.push('\nUse this context to personalise your responses without the user needing to repeat themselves.');

    return {
      systemFragment: lines.join('\n'),
      longTermFacts: facts.map((f) => ({ key: f.key, value: f.value })),
      entities: entities.map((e) => ({
        entityType: e.entityType,
        name: e.name,
        attributes: e.attributes,
      })),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Auto-extraction — called after each agent run to learn from conversation
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ask the LLM to extract memorable facts and entities from the latest
   * user message and assistant response, then persist them.
   *
   * This runs fire-and-forget (errors are swallowed) so it never blocks the
   * agent response.
   */
  async extractAndStore(
    userId: string,
    userMessage: string,
    assistantResponse: string,
  ): Promise<void> {
    try {
      const model = this.config.get<string>('LLM_MODEL', 'gpt-4o-mini');
      const llm = new ChatOpenAI({
        modelName: model,
        temperature: 0,
        openAIApiKey:
          this.config.get<string>('OPENAI_API_KEY') ||
          this.config.get<string>('ANTHROPIC_API_KEY') ||
          this.config.get<string>('LLM_API_KEY') ||
          'ollama',
        configuration: {
          baseURL: this.config.get<string>('LLM_BASE_URL') || undefined,
        },
      } as any);

      const systemPrompt = `You are a memory extraction assistant. Given a conversation turn, extract:
1. Persistent facts about the user (preferences, role, constraints, goals).
2. Named entities mentioned (people, projects, companies, products, locations).

Respond ONLY with valid JSON matching this exact schema:
{
  "facts": [
    { "key": "snake_case_label", "value": "string", "confidence": 0.0-1.0 }
  ],
  "entities": [
    {
      "entityType": "person|project|company|product|location|other",
      "name": "canonical name",
      "attributes": { "key": "value" },
      "mention": "verbatim excerpt that mentioned this entity (max 80 chars)"
    }
  ]
}

Rules:
- Only extract information that would be useful to remember in future conversations.
- Skip generic/ephemeral information (e.g. "user said hello").
- Return { "facts": [], "entities": [] } if nothing is worth remembering.
- Confidence < 0.6 should be omitted entirely.`;

      const userPrompt = `User message: ${userMessage.slice(0, 500)}

Assistant response: ${assistantResponse.slice(0, 500)}

Extract memorable facts and entities.`;

      const result = await llm.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const raw = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      // Strip markdown code fences if present
      const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      const extracted: ExtractionResult = JSON.parse(jsonStr);

      // Persist facts
      for (const fact of extracted.facts ?? []) {
        if (fact.confidence >= 0.6) {
          await this.upsertFact(userId, fact.key, fact.value, 'auto', fact.confidence);
        }
      }

      // Persist entities
      for (const entity of extracted.entities ?? []) {
        await this.upsertEntity(
          userId,
          entity.entityType,
          entity.name,
          entity.attributes ?? {},
          entity.mention,
        );
      }

      const factCount = (extracted.facts ?? []).filter((f) => f.confidence >= 0.6).length;
      const entityCount = (extracted.entities ?? []).length;
      if (factCount + entityCount > 0) {
        this.logger.debug(
          `Memory extracted for "${userId}": ${factCount} fact(s), ${entityCount} entity(ies)`,
        );
      }
    } catch (err) {
      // Non-critical — log and move on
      this.logger.warn(`Memory extraction failed for "${userId}": ${err.message}`);
    }
  }
}
