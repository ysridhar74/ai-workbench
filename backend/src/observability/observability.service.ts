import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { v4 as uuidv4 } from 'uuid';
import { AgentRun, AgentRunDocument } from '../db/schemas/agent-run.schema';
import { ToolStep } from '../agent/agent.service';

export interface RunMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  model: string;
  langsmithTraceId?: string;
}

export interface RunListOptions {
  userId?: string;
  skill?: string;
  limit?: number;
  offset?: number;
  /** ISO date string — return runs after this date */
  from?: string;
  /** ISO date string — return runs before this date */
  to?: string;
}

export interface RunStats {
  totalRuns: number;
  totalTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
  bySkill: Array<{ skill: string; count: number; totalCostUsd: number }>;
  byModel: Array<{ model: string; count: number; totalTokens: number }>;
}

// Per-token pricing in USD (update as providers change pricing)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-3-5-sonnet-20241022': { input: 0.000003,   output: 0.000015  },
  'claude-3-5-haiku-20241022':  { input: 0.0000008,  output: 0.000004  },
  'claude-3-opus-20240229':     { input: 0.000015,   output: 0.000075  },
  'gpt-4o':                     { input: 0.000005,   output: 0.000015  },
  'gpt-4o-mini':                { input: 0.00000015, output: 0.0000006 },
  'gpt-4-turbo':                { input: 0.00001,    output: 0.00003   },
};

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(
    private readonly config: ConfigService,
    @InjectModel(AgentRun.name) private readonly runModel: Model<AgentRunDocument>,
  ) {}

  // ─────────────────────────────────────────────────────────────────────────
  // Cost + formatting helpers
  // ─────────────────────────────────────────────────────────────────────────

  calculateCost(model: string, inputTokens: number, outputTokens: number): number {
    const pricing = MODEL_PRICING[model];
    if (!pricing) return 0;
    return pricing.input * inputTokens + pricing.output * outputTokens;
  }

  formatMetricsSummary(metrics: RunMetrics): string {
    return (
      `↑ ${metrics.inputTokens} tokens  ↓ ${metrics.outputTokens} tokens  ` +
      `≈ $${metrics.costUsd.toFixed(6)}  ${metrics.durationMs}ms`
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Write
  // ─────────────────────────────────────────────────────────────────────────

  async recordRun(params: {
    skill: string;
    input: string;
    output: string;
    metrics: RunMetrics;
    userId?: string;
    metadata?: Record<string, unknown>;
    steps?: ToolStep[];
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
      steps: params.steps ?? [],
    });

    this.logger.log(
      `Run recorded — skill: ${params.skill} | model: ${params.metrics.model} | ` +
      `tokens: ${params.metrics.inputTokens}↑ ${params.metrics.outputTokens}↓ | ` +
      `cost: $${params.metrics.costUsd.toFixed(6)} | duration: ${params.metrics.durationMs}ms`,
    );

    return runId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Read — list & detail
  // ─────────────────────────────────────────────────────────────────────────

  /** Paginated list of runs, newest first */
  async listRuns(options: RunListOptions = {}): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runs: any[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const limit = Math.min(options.limit ?? 20, 100);
    const offset = options.offset ?? 0;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: Record<string, any> = {};
    if (options.userId) filter.userId = options.userId;
    if (options.skill)  filter.skill  = options.skill;
    if (options.from || options.to) {
      filter.createdAt = {};
      if (options.from) filter.createdAt.$gte = new Date(options.from);
      if (options.to)   filter.createdAt.$lte = new Date(options.to);
    }

    const [runs, total] = await Promise.all([
      this.runModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean()
        .exec(),
      this.runModel.countDocuments(filter),
    ]);

    return { runs, total, limit, offset };
  }

  /** Single run by runId */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async getRun(runId: string): Promise<any> {
    const run = await this.runModel.findOne({ runId }).lean().exec();
    if (!run) throw new NotFoundException(`Run "${runId}" not found`);
    return run;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Read — aggregate stats
  // ─────────────────────────────────────────────────────────────────────────

  async getStats(options: { userId?: string; from?: string; to?: string } = {}): Promise<RunStats> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matchStage: Record<string, any> = {};
    if (options.userId) matchStage.userId = options.userId;
    if (options.from || options.to) {
      matchStage.createdAt = {};
      if (options.from) matchStage.createdAt.$gte = new Date(options.from);
      if (options.to)   matchStage.createdAt.$lte = new Date(options.to);
    }

    const [totals, bySkill, byModel] = await Promise.all([
      // Overall totals
      this.runModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalRuns:    { $sum: 1 },
            totalTokens:  { $sum: '$totalTokens' },
            totalCostUsd: { $sum: '$costUsd' },
            avgDurationMs: { $avg: '$durationMs' },
          },
        },
      ]),

      // Breakdown by skill
      this.runModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id:          '$skill',
            count:        { $sum: 1 },
            totalCostUsd: { $sum: '$costUsd' },
          },
        },
        { $project: { _id: 0, skill: '$_id', count: 1, totalCostUsd: 1 } },
        { $sort: { count: -1 } },
      ]),

      // Breakdown by model
      this.runModel.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id:         '$model',
            count:       { $sum: 1 },
            totalTokens: { $sum: '$totalTokens' },
          },
        },
        { $project: { _id: 0, model: '$_id', count: 1, totalTokens: 1 } },
        { $sort: { count: -1 } },
      ]),
    ]);

    const t = totals[0] ?? { totalRuns: 0, totalTokens: 0, totalCostUsd: 0, avgDurationMs: 0 };

    return {
      totalRuns:    t.totalRuns,
      totalTokens:  t.totalTokens,
      totalCostUsd: t.totalCostUsd,
      avgDurationMs: Math.round(t.avgDurationMs ?? 0),
      bySkill,
      byModel,
    };
  }
}
