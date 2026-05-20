import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type LongTermMemoryDocument = LongTermMemory & Document;

/**
 * Persistent key/value facts remembered across sessions for a given user.
 * Examples: "user prefers formal tone", "user works in finance", "user's name is Alice"
 */
@Schema({ timestamps: true, collection: 'long_term_memories' })
export class LongTermMemory {
  /** Owner of this memory — typically a userId or session identifier */
  @Prop({ required: true, index: true })
  userId: string;

  /** Short label for the fact, e.g. "preferred_tone" */
  @Prop({ required: true })
  key: string;

  /** The stored fact value */
  @Prop({ required: true })
  value: string;

  /** How the fact was created: 'auto' (extracted by agent) | 'manual' (API) */
  @Prop({ default: 'auto' })
  source: string;

  /** Rough confidence of the fact (0–1), set by extraction model */
  @Prop({ default: 1 })
  confidence: number;
}

export const LongTermMemorySchema = SchemaFactory.createForClass(LongTermMemory);
// Unique index so upsert by userId+key is idempotent
LongTermMemorySchema.index({ userId: 1, key: 1 }, { unique: true });
