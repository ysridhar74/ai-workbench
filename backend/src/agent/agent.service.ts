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
import { AgentRequestDto } from './agent.dto';

export interface AgentResult {
  content: string;
  skill: string;
  model: string;
  toolCallCount: number;
  ragChunksUsed: number;
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

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly skills: SkillsService,
    private readonly mcpRegistry: McpRegistryService,
    private readonly ragService: RagService,
    private readonly observability: ObservabilityService,
  ) {}

  async run(dto: AgentRequestDto): Promise<AgentResult> {
    const skillName = dto.skill ?? 'general-assistant';
    const skill = await this.skills.findByName(skillName);
    if (!skill) throw new NotFoundException(`Skill "${skillName}" not found`);

    const startMs = Date.now();
    const model = skill.preferredModel ?? this.config.getOrThrow<string>('LLM_MODEL');

    // ── 1. RAG context retrieval ────────────────────────────────────────────
    let ragContext = '';
    let ragChunksUsed = 0;
    if (dto.useRag !== false) {
      const chunks = await this.ragService.retrieve(dto.message, {
        namespace: dto.namespace ?? 'default',
        topK: 4,
      });
      ragChunksUsed = chunks.length;
      if (chunks.length > 0) {
        ragContext =
          '\n\n## Relevant context from knowledge base\n' +
          chunks.map((c, i) => `[${i + 1}] ${c.pageContent}`).join('\n\n');
      }
    }

    // ── 2. Build system prompt (skill template + RAG context) ───────────────
    const systemPrompt = this.skills.buildSystemPrompt(skill) + ragContext;

    // ── 3. Build LangChain message history ──────────────────────────────────
    const messageHistory = (dto.history ?? []).map((h) =>
      h.role === 'user'
        ? new HumanMessage(h.content)
        : new AIMessage(h.content),
    );

    // ── 4. Configure LLM (OpenAI-compat, works with Ollama + LiteLLM) ───────
    const llm = new ChatOpenAI({
      modelName: model,
      temperature: 0.7,
      openAIApiKey:
        this.config.get<string>('OPENAI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY') ||
        this.config.get<string>('LLM_API_KEY') ||
        'ollama',
      configuration: {
        baseURL: this.config.get<string>('LLM_BASE_URL') || undefined,
      },
    });

    // ── 5. Get MCP tools ─────────────────────────────────────────────────────
    const tools = dto.useTools !== false ? this.mcpRegistry.getLangChainTools() : [];

    // ── 6. Create LangGraph ReAct agent ─────────────────────────────────────
    // createReactAgent builds a StateGraph with:
    //   __start__ → call_model → (tool_node | __end__)
    //   tool_node loops back to call_model until no more tool calls
    const agent = createReactAgent({ llm, tools });

    // ── 7. Run the agent inside a LangSmith trace ───────────────────────────
    const tracedRun = traceable(
      async () => {
        const result = await agent.invoke({
          messages: [
            new SystemMessage(systemPrompt),
            ...messageHistory,
            new HumanMessage(dto.message),
          ],
        });
        return result;
      },
      {
        name: `agent:${skillName}`,
        metadata: { skill: skillName, userId: dto.userId, ragChunksUsed },
      },
    );

    const agentResult = await tracedRun();

    // ── 8. Extract final response and token usage ───────────────────────────
    const messages = agentResult.messages as (HumanMessage | AIMessage | SystemMessage)[];
    const lastAi = [...messages].reverse().find((m) => m._getType() === 'ai');
    const finalContent =
      typeof lastAi?.content === 'string'
        ? lastAi.content
        : JSON.stringify(lastAi?.content ?? '');

    // Count tool calls in the message history
    const toolCallCount = messages.filter(
      (m) => m._getType() === 'tool',
    ).length;

    // Extract token usage from the last AI message metadata if available
    const usageMeta = (lastAi as any)?.response_metadata?.usage ?? (lastAi as any)?.usage_metadata ?? {};
    const inputTokens: number = usageMeta.input_tokens ?? usageMeta.prompt_tokens ?? 0;
    const outputTokens: number = usageMeta.output_tokens ?? usageMeta.completion_tokens ?? 0;
    const totalTokens = inputTokens + outputTokens;

    const durationMs = Date.now() - startMs;
    const costUsd = this.observability.calculateCost(model, inputTokens, outputTokens);

    const metrics = { inputTokens, outputTokens, totalTokens, costUsd, durationMs };

    // ── 9. Persist run to MongoDB ────────────────────────────────────────────
    const runId = await this.observability.recordRun({
      skill: skillName,
      input: dto.message,
      output: finalContent,
      metrics: { ...metrics, model },
      userId: dto.userId,
      metadata: { ragChunksUsed, toolCallCount },
    });

    return {
      content: finalContent,
      skill: skillName,
      model,
      toolCallCount,
      ragChunksUsed,
      metrics: {
        ...metrics,
        summary: this.observability.formatMetricsSummary({ ...metrics, model }),
      },
      runId,
    };
  }

  /** Streaming version — yields SSE events */
  async *runStream(dto: AgentRequestDto): AsyncGenerator<string> {
    const skillName = dto.skill ?? 'general-assistant';
    const skill = await this.skills.findByName(skillName);
    if (!skill) throw new NotFoundException(`Skill "${skillName}" not found`);

    const startMs = Date.now();
    const model = skill.preferredModel ?? this.config.getOrThrow<string>('LLM_MODEL');

    // RAG retrieval
    let ragContext = '';
    let ragChunksUsed = 0;
    if (dto.useRag !== false) {
      const chunks = await this.ragService.retrieve(dto.message, {
        namespace: dto.namespace ?? 'default',
        topK: 4,
      });
      ragChunksUsed = chunks.length;
      if (chunks.length > 0) {
        ragContext =
          '\n\n## Relevant context from knowledge base\n' +
          chunks.map((c, i) => `[${i + 1}] ${c.pageContent}`).join('\n\n');
      }
    }

    const systemPrompt = this.skills.buildSystemPrompt(skill) + ragContext;
    const messageHistory = (dto.history ?? []).map((h) =>
      h.role === 'user' ? new HumanMessage(h.content) : new AIMessage(h.content),
    );

    const llm = new ChatOpenAI({
      modelName: model,
      temperature: 0.7,
      streaming: true,
      openAIApiKey:
        this.config.get<string>('OPENAI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY') ||
        this.config.get<string>('LLM_API_KEY') ||
        'ollama',
      configuration: {
        baseURL: this.config.get<string>('LLM_BASE_URL') || undefined,
      },
    });

    const tools = dto.useTools !== false ? this.mcpRegistry.getLangChainTools() : [];
    const agent = createReactAgent({ llm, tools });

    let fullContent = '';
    let toolCallCount = 0;

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
      // Stream text chunks from the LLM
      if (event.event === 'on_chat_model_stream') {
        const chunk = event.data?.chunk?.content;
        if (chunk && typeof chunk === 'string') {
          fullContent += chunk;
          yield `data: ${JSON.stringify({ type: 'chunk', content: chunk })}\n\n`;
        }
      }

      // Notify when a tool is being called
      if (event.event === 'on_tool_start') {
        toolCallCount++;
        yield `data: ${JSON.stringify({
          type: 'tool_call',
          tool: event.name,
          input: event.data?.input,
        })}\n\n`;
      }

      // Notify when tool result comes back
      if (event.event === 'on_tool_end') {
        yield `data: ${JSON.stringify({
          type: 'tool_result',
          tool: event.name,
        })}\n\n`;
      }
    }

    // Persist and send final metrics
    const durationMs = Date.now() - startMs;
    const costUsd = this.observability.calculateCost(model, 0, 0); // tokens not available in stream

    const runId = await this.observability.recordRun({
      skill: skillName,
      input: dto.message,
      output: fullContent,
      metrics: { model, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd, durationMs },
      userId: dto.userId,
      metadata: { ragChunksUsed, toolCallCount },
    });

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
