/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import { traceable } from 'langsmith/traceable';
import { SkillsService } from '../skills/skills.service';
import { McpRegistryService } from '../mcp/mcp-registry.service';
import { RagService } from '../rag/rag.service';
import { ObservabilityService } from '../observability/observability.service';
import { MemoryService } from '../memory/memory.service';
import { AgentRequestDto } from './agent.dto';

export interface ToolStep {
  tool: string;
  input: unknown;
  output: string;
}

export interface AgentResult {
  content: string;
  skill: string;
  model: string;
  toolCallCount: number;
  ragChunksUsed: number;
  /** Ordered list of every tool the agent called, with its input and output */
  steps: ToolStep[];
  metrics: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    costUsd: number;
    durationMs: number;
    summary: string;
  };
  runId: string;
}

/** Build ChatOpenAI instance — shared between run() and runStream() */
function buildLlm(config: ConfigService, model: string, streaming = false): ChatOpenAI {
  return new ChatOpenAI({
    modelName: model,
    temperature: 0.7,
    streaming,
    openAIApiKey:
      config.get<string>('OPENAI_API_KEY') ||
      config.get<string>('ANTHROPIC_API_KEY') ||
      config.get<string>('LLM_API_KEY') ||
      'ollama',
    configuration: {
      baseURL: config.get<string>('LLM_BASE_URL') || undefined,
    },
  } as any);
}

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);
  // Cache agents by model+toolCount key — recreated when tool count changes
  private readonly agentCache = new Map<string, any>();
  private readonly streamingAgentCache = new Map<string, any>();

  clearAgentCache() {
    this.agentCache.clear();
    this.streamingAgentCache.clear();
    this.logger.log('Agent cache cleared');
  }

  constructor(
    private readonly config: ConfigService,
    private readonly skills: SkillsService,
    private readonly mcpRegistry: McpRegistryService,
    private readonly ragService: RagService,
    private readonly observability: ObservabilityService,
    private readonly memory: MemoryService,
  ) {}

  async run(dto: AgentRequestDto): Promise<AgentResult> {
    const skillName = dto.skill ?? 'general-assistant';
    const skill = await this.skills.findByName(skillName);
    if (!skill) throw new NotFoundException(`Skill "${skillName}" not found`);

    const startMs = Date.now();
    const model = skill.preferredModel ?? this.config.getOrThrow<string>('LLM_MODEL');

    // ── 1. Build system prompt + message history ────────────────────────────
    const baseSystemPrompt = this.skills.buildSystemPrompt(skill);

    // Append RAG usage instructions when the tool is available
    const ragInstruction = dto.useRag !== false
      ? `\n\nKNOWLEDGE BASE: You have access to a search_knowledge_base tool. ALWAYS use it to look up information before answering questions about topics that may be documented. Do not answer from memory alone when the knowledge base might have relevant content.`
      : '';

    // Inject long-term memory context when a userId is present
    const memoryContext = dto.userId
      ? await this.memory.buildContext(dto.userId)
      : { systemFragment: '' };
    const systemPrompt = [
      baseSystemPrompt + ragInstruction,
      memoryContext.systemFragment,
    ].filter(Boolean).join('\n\n');

    const messageHistory = (dto.history ?? []).map((h) =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content),
    );

    // ── 2. Build tool list ──────────────────────────────────────────────────
    // RAG is now a tool the agent calls when it decides it needs knowledge —
    // not pre-injected on every request (Option 3 pattern)
    const mcpTools: any[] = dto.useTools !== false ? this.mcpRegistry.getLangChainTools() : [];
    const ragTool = dto.useRag !== false
      ? [this.ragService.asLangChainTool(dto.namespace ?? 'default')]
      : [];
    const tools: any[] = [...ragTool, ...mcpTools];

    // ── 3. Build agent (cached per model + tool fingerprint) ────────────────
    // Include rag/tools flags in the key so toggling them creates a fresh agent
    const cacheKey = `${model}:rag=${dto.useRag ?? true}:tools=${dto.useTools ?? true}:${tools.map((t) => t.name).join(',')}`;
    if (!this.agentCache.has(cacheKey)) {
      const llm = buildLlm(this.config, model);
      this.agentCache.set(cacheKey, createReactAgent({ llm, tools } as any));
    }
    const agent = this.agentCache.get(cacheKey);

    // ── 4. Run inside a LangSmith trace ─────────────────────────────────────
    const tracedRun = traceable(
      async () =>
        agent.invoke({
          messages: [
            new SystemMessage(systemPrompt),
            ...messageHistory,
            new HumanMessage(dto.message),
          ],
        }),
      { name: `agent:${skillName}`, metadata: { skill: skillName, userId: dto.userId } },
    );

    const agentResult = await tracedRun();

    // ── 5. Extract response + token usage ───────────────────────────────────
    const msgs: any[] = agentResult.messages ?? [];
    const lastAi = [...msgs].reverse().find((m: any) => m._getType?.() === 'ai');
    const finalContent =
      typeof lastAi?.content === 'string' ? lastAi.content : JSON.stringify(lastAi?.content ?? '');

    const toolMsgs = msgs.filter((m: any) => m._getType?.() === 'tool');
    const toolCallCount = toolMsgs.length;
    const ragChunksUsed = toolMsgs.filter((m: any) =>
      m.name === 'search_knowledge_base',
    ).length;

    // Build ordered steps: pair each AI tool_call with its tool result message
    const steps: ToolStep[] = [];
    for (const msg of msgs) {
      if (msg._getType?.() !== 'ai') continue;
      const toolCalls: any[] = msg.tool_calls ?? msg.additional_kwargs?.tool_calls ?? [];
      for (const tc of toolCalls) {
        const toolName: string = tc.name ?? tc.function?.name ?? 'unknown';
        const rawInput = tc.args ?? (() => {
          try { return JSON.parse(tc.function?.arguments ?? '{}'); } catch { return tc.function?.arguments ?? {}; }
        })();
        // Find the corresponding tool result by tool_call_id
        const resultMsg = toolMsgs.find(
          (t: any) => t.tool_call_id === tc.id,
        );
        const output: string = resultMsg
          ? (typeof resultMsg.content === 'string' ? resultMsg.content : JSON.stringify(resultMsg.content))
          : '';
        steps.push({ tool: toolName, input: rawInput, output });
      }
    }

    const usageMeta = lastAi?.response_metadata?.usage ?? lastAi?.usage_metadata ?? {};
    const inputTokens: number = usageMeta.input_tokens ?? usageMeta.prompt_tokens ?? 0;
    const outputTokens: number = usageMeta.output_tokens ?? usageMeta.completion_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;
    const durationMs = Date.now() - startMs;
    const costUsd = this.observability.calculateCost(model, inputTokens, outputTokens);
    const metrics = { inputTokens, outputTokens, totalTokens, costUsd, durationMs };

    // ── 6. Persist to MongoDB ────────────────────────────────────────────────
    const runId = await this.observability.recordRun({
      skill: skillName,
      input: dto.message,
      output: finalContent,
      metrics: { ...metrics, model },
      userId: dto.userId,
      metadata: { ragChunksUsed, toolCallCount },
      steps,
    });

    // ── 7. Fire-and-forget memory extraction ────────────────────────────────
    if (dto.userId && this.config.get<string>('MEMORY_EXTRACTION_ENABLED') !== 'false') {
      this.memory.extractAndStore(dto.userId, dto.message, finalContent).catch(() => {});
    }

    return {
      content: finalContent,
      skill: skillName,
      model,
      toolCallCount,
      ragChunksUsed,
      steps,
      metrics: {
        ...metrics,
        summary: this.observability.formatMetricsSummary({ ...metrics, model }),
      },
      runId,
    };
  }

  /** Streaming version — yields SSE events while the agent runs */
  async *runStream(dto: AgentRequestDto): AsyncGenerator<string> {
    const skillName = dto.skill ?? 'general-assistant';
    const skill = await this.skills.findByName(skillName);
    if (!skill) throw new NotFoundException(`Skill "${skillName}" not found`);

    const startMs = Date.now();
    const model = skill.preferredModel ?? this.config.getOrThrow<string>('LLM_MODEL');

    const baseSystemPrompt = this.skills.buildSystemPrompt(skill);

    const ragInstruction = dto.useRag !== false
      ? `\n\nKNOWLEDGE BASE: You have access to a search_knowledge_base tool. ALWAYS use it to look up information before answering questions about topics that may be documented. Do not answer from memory alone when the knowledge base might have relevant content.`
      : '';

    const memoryContext = dto.userId
      ? await this.memory.buildContext(dto.userId)
      : { systemFragment: '' };
    const systemPrompt = [
      baseSystemPrompt + ragInstruction,
      memoryContext.systemFragment,
    ].filter(Boolean).join('\n\n');

    const messageHistory = (dto.history ?? []).map((h) =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content),
    );

    const mcpTools: any[] = dto.useTools !== false ? this.mcpRegistry.getLangChainTools() : [];
    const ragTool = dto.useRag !== false
      ? [this.ragService.asLangChainTool(dto.namespace ?? 'default')]
      : [];
    const tools: any[] = [...ragTool, ...mcpTools];

    const cacheKey = `${model}:rag=${dto.useRag ?? true}:tools=${dto.useTools ?? true}:${tools.map((t) => t.name).join(',')}:stream`;
    if (!this.streamingAgentCache.has(cacheKey)) {
      const llm = buildLlm(this.config, model, true);
      this.streamingAgentCache.set(cacheKey, createReactAgent({ llm, tools } as any));
    }
    const agent = this.streamingAgentCache.get(cacheKey);

    let fullContent = '';
    let toolCallCount = 0;
    let ragChunksUsed = 0;

    const stream = await agent.streamEvents(
      {
        messages: [
          new SystemMessage(systemPrompt),
          ...messageHistory,
          new HumanMessage(dto.message),
        ],
      },
      { version: 'v2' },
    );

    for await (const event of stream) {
      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk?.content;
        if (chunk && typeof chunk === 'string') {
          fullContent += chunk;
          yield `data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`;
        }
      }
      if (event.event === 'on_tool_start') {
        toolCallCount++;
        if (event.name === 'search_knowledge_base') ragChunksUsed++;
        yield `data: ${JSON.stringify({ type: 'tool_call', tool: event.name, input: event.data?.input })}\n\n`;
      }
      if (event.event === 'on_tool_end') {
        const rawOutput = event.data?.output;
        const output = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput ?? '');
        yield `data: ${JSON.stringify({ type: 'tool_result', tool: event.name, output })}\n\n`;
      }
    }

    const durationMs = Date.now() - startMs;
    const costUsd = this.observability.calculateCost(model, 0, 0);

    const runId = await this.observability.recordRun({
      skill: skillName,
      input: dto.message,
      output: fullContent,
      metrics: { model, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd, durationMs },
      userId: dto.userId,
      metadata: { ragChunksUsed, toolCallCount },
    });

    // Fire-and-forget memory extraction
    if (dto.userId && this.config.get<string>('MEMORY_EXTRACTION_ENABLED') !== 'false') {
      this.memory.extractAndStore(dto.userId, dto.message, fullContent).catch(() => {});
    }

    yield `data: ${JSON.stringify({
      type: 'done',
      runId,
      model,
      toolCallCount,
      ragChunksUsed,
      metrics: { durationMs, costUsd, summary: `${toolCallCount} tool call(s) · ${ragChunksUsed} RAG chunk(s) · ${durationMs}ms` },
    })}\n\n`;

    yield 'data: [DONE]\n\n';
  }
}
