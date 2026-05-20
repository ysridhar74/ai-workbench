import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type AgentRunDocument = AgentRun & Document;

@Schema({ timestamps: true, collection: 'agent_runs' })
export class AgentRun {
  @Prop({ required: true })
  runId: string;

  @Prop({ required: true })
  skill: string;

  @Prop({ required: true })
  input: string;

  @Prop({ default: '' })
  output: string;

  @Prop({ default: 0 })
  durationMs: number;

  @Prop({ default: 'completed' })
  status: string;

  @Prop({ default: 0 })
  inputTokens: number;

  @Prop({ default: 0 })
  outputTokens: number;

  @Prop({ default: 0 })
  totalTokens: number;

  @Prop({ default: 0 })
  costUsd: number;

  @Prop({ type: String, default: null })
  langsmithTraceId: string | null;

  @Prop({ type: String, default: null })
  model: string | null;

  @Prop({ type: String, default: null })
  userId: string | null;

  @Prop({ type: Object, default: {} })
  metadata: Record<string, unknown>;

  /** Ordered list of tool calls made during the run */
  @Prop({ type: [Object], default: [] })
  steps: Array<{ tool: string; input: unknown; output: string }>;
}

export const AgentRunSchema = SchemaFactory.createForClass(AgentRun);
AgentRunSchema.index({ userId: 1, createdAt: -1 });
AgentRunSchema.index({ skill: 1, createdAt: -1 });
AgentRunSchema.index({ createdAt: -1 });
