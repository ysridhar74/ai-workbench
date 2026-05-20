import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, AgentRunDocument } from '../db/schemas/agent-run.schema';

export interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
  langsmithTraceId?: string;
}

// Per-token pricing in USD (update as providers change pricing)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 0.000003,  output: 0.000015  },
  'claude-3-5-haiku-20241022':  { input: 0.0000008, output: 0.000004  },
  'claude-3-opus-20240229':     { input: 0.000015,  output: 0.000075  },
  'gpt-4o':                     { input: 0.000005,  output: 0.000015  },
  'gpt-4o-mini':                { input: 0.00000015,output: 0.0000006 },
  'gpt-4-turbo':                { input: 0.00001,   output: 0.00003   },
};

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
  ) {}

  /**
   * Calculate USD cost from token counts and model name.
   * Falls back to 0 if the model isn't in the pricing table.
   */
  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return pricing.input * inputTokens + pricing.output * outputTokens;
  }

  /**
   * Persist a completed agent run to MongoDB.
   */
  async recordRun(params: {
    skill: string;
    input: string;
    output: string;
    metrics: RunMetrics;
    userId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const runId = uuidv4();

    await this.runModel.create({
      runId,
      skill: params.skill,
      input: params.input,
      output: params.output,
      durationMs: params.metrics.durationMs,
      status: 'completed',
      inputTokens: params.metrics.inputTokens,
      outputTokens: params.metrics.outputTokens,
      totalTokens: params.metrics.totalTokens,
      costUsd: params.metrics.costUsd,
      langsmithTraceId: params.metrics.langsmithTraceId ?? null,
      model: params.metrics.model,
      userId: params.userId ?? null,
      metadata: params.metadata ?? {},
    });

    this.logger.log(
      `Run recorded — skill: ${params.skill} | model: ${params.metrics.model} | ` +
      `tokens: ${params.metrics.inputTokens}↑ ${params.metrics.outputTokens}↓ | ` +
      `cost: $${params.metrics.costUsd.toFixed(6)} | duration: ${params.metrics.durationMs}ms`,
    );

    return runId;
  }

  /**
   * Format metrics as a compact summary string for API responses.
   */
  formatMetricsSummary(metrics: RunMetrics): string {
    return (
      `↑ ${metrics.inputTokens} tokens  ↓ ${metrics.outputTokens} tokens  ` +
      `≈ $${metrics.costUsd.toFixed(6)}  ${metrics.durationMs}ms`
    );
  }
}
