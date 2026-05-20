import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type SkillDocument = Skill & Document;

@Schema({ timestamps: true, collection: 'skills' })
export class Skill {
  @Prop({ required: true, unique: true })
  name: string;

  @Prop({ required: true })
  description: string;

  @Prop({ required: true })
  promptTemplate: string;

  @Prop({ type: [String], default: [] })
  tools: string[];

  @Prop({ default: null })
  preferredModel: string | null;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ default: 'general' })
  category: string;
}

export const SkillSchema = SchemaFactory.createForClass(Skill);
