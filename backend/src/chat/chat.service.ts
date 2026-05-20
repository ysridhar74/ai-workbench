import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { traceable } from 'langsmith/traceable';
import { LlmService, LlmMessage } from '../llm/llm.service';
import { SkillsService } from '../skills/skills.service';
import { ObservabilityService } from '../observability/observability.service';
import { ChatRequestDto } from './chat.dto';

export interface ChatResult {
  content: string;
  skill: string;
  model: string;
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
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly llm: LlmService,
    private readonly skills: SkillsService,
    private readonly observability: ObservabilityService,
  ) {}

  /**
   * Non-streaming chat: runs the full agent turn and returns the result.
   * The entire function is wrapped in a LangSmith trace via `traceable`.
   */
  async chat(dto: ChatRequestDto): Promise<ChatResult> {
    const skillName = dto.skill ?? 'general-assistant';
    const skill = await this.skills.findByName(skillName);
    if (!skill) throw new NotFoundException(`Skill "${skillName}" not found or disabled`);

    const startMs = Date.now();

    // Build message array: system prompt + optional history + user message
    const messages: LlmMessage[] = [
      { role: 'system', content: this.skills.buildSystemPrompt(skill) },
      ...(dto.history ?? []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: dto.message },
    ];

    // Wrap in LangSmith traceable — this creates a trace in the LangSmith dashboard
    const tracedComplete = traceable(
      async (msgs: LlmMessage[]) => this.llm.complete(msgs, { model: skill.preferredModel ?? undefined }),
      { name: `skill:${skillName}`, metadata: { skill: skillName, userId: dto.userId } },
    );

    const llmResponse = await tracedComplete(messages);
    const durationMs = Date.now() - startMs;

    const costUsd = this.observability.calculateCost(
      llmResponse.model,
      llmResponse.inputTokens,
      llmResponse.outputTokens,
    );

    const metrics = {
      inputTokens: llmResponse.inputTokens,
      outputTokens: llmResponse.outputTokens,
      totalTokens: llmResponse.totalTokens,
      costUsd,
      durationMs,
    };

    const runId = await this.observability.recordRun({
      skill: skillName,
      input: dto.message,
      output: llmResponse.content,
      metrics: { ...metrics, model: llmResponse.model },
      userId: dto.userId,
    });

    return {
      content: llmResponse.content,
      skill: skillName,
      model: llmResponse.model,
      metrics: {
        ...metrics,
        summary: this.observability.formatMetricsSummary({ ...metrics, model: llmResponse.model }),
      },
      runId,
    };
  }

  /**
   * Streaming chat — yields text chunks as Server-Sent Events.
   * Persists the completed run to MongoDB and LangSmith after streaming ends.
   */
  async *chatStream(dto: ChatRequestDto): AsyncGenerator<string> {
    const skillName = dto.skill ?? 'general-assistant';
    const skill = await this.skills.findByName(skillName);
    if (!skill) throw new NotFoundException(`Skill "${skillName}" not found or disabled`);

    const startMs = Date.now();

    const messages: LlmMessage[] = [
      { role: 'system', content: this.skills.buildSystemPrompt(skill) },
      ...(dto.history ?? []).map(h => ({ role: h.role, content: h.content })),
      { role: 'user', content: dto.message },
    ];

    let fullContent = '';
    let finalMetrics: { model: string; inputTokens: number; outputTokens: number; totalTokens: number } | null = null;

    for await (const event of this.llm.stream(messages, { model: skill.preferredModel ?? undefined })) {
      if (!event.done && event.chunk) {
        fullContent += event.chunk;
        // SSE format: "data: <chunk>\n\n"
        yield `data: ${JSON.stringify({ type: 'chunk', content: event.chunk })}\n\n`;
      }

      if (event.done && event.metrics) {
        finalMetrics = event.metrics;
      }
    }

    if (finalMetrics) {
      const durationMs = Date.now() - startMs;
      const costUsd = this.observability.calculateCost(
        finalMetrics.model,
        finalMetrics.inputTokens,
        finalMetrics.outputTokens,
      );

      const runId = await this.observability.recordRun({
        skill: skillName,
        input: dto.message,
        output: fullContent,
        metrics: { ...finalMetrics, costUsd, durationMs },
        userId: dto.userId,
      });

      const summary = this.observability.formatMetricsSummary({ ...finalMetrics, costUsd, durationMs });

      // Send final metadata event so the UI can display token/cost info
      yield `data: ${JSON.stringify({
        type: 'done',
        runId,
        model: finalMetrics.model,
        metrics: {
          inputTokens: finalMetrics.inputTokens,
          outputTokens: finalMetrics.outputTokens,
          totalTokens: finalMetrics.totalTokens,
          costUsd,
          durationMs,
          summary,
        },
      })}\n\n`;
    }

    yield 'data: [DONE]\n\n';
  }
}
