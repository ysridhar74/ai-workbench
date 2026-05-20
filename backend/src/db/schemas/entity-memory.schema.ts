import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EntityMemoryDocument = EntityMemory & Document;

/**
 * Structured records for named entities extracted from conversation.
 * Examples: people, projects, companies, products, locations.
 */
@Schema({ timestamps: true, collection: 'entity_memories' })
export class EntityMemory {
  /** Owner of this memory */
  @Prop({ required: true, index: true })
  userId: string;

  /** Entity type: 'person' | 'project' | 'company' | 'product' | 'location' | 'other' */
  @Prop({ required: true })
  entityType: string;

  /** Canonical name of the entity, e.g. "Alice Smith", "Project Phoenix" */
  @Prop({ required: true })
  name: string;

  /**
   * Accumulated facts about this entity as a free-form JSON object.
   * e.g. { "role": "CTO", "company": "Acme", "notes": "Prefers async comms" }
   */
  @Prop({ type: Object, default: {} })
  attributes: Record<string, unknown>;

  /** Full conversation excerpts that mentioned this entity (for context) */
  @Prop({ type: [String], default: [] })
  mentions: string[];
}

export const EntityMemorySchema = SchemaFactory.createForClass(EntityMemory);
EntityMemorySchema.index({ userId: 1, entityType: 1, name: 1 }, { unique: true });
