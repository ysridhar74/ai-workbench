import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

export type PersonaType = 'broker' | 'underwriter' | 'claims';

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, unique: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  email: string;

  @Prop({ required: true, enum: ['broker', 'underwriter', 'claims'] })
  persona: PersonaType;

  @Prop({ default: true })
  enabled: boolean;

  @Prop({ type: Object, default: {} })
  preferences: Record<string, unknown>;
}

export const UserSchema = SchemaFactory.createForClass(User);
