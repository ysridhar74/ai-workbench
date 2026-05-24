import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, PersonaType } from '../db/schemas/user.schema';
import { PERSONA_CONFIG, PersonaConfig } from './persona.config';

export interface UserWithPersona {
  userId: string;
  name: string;
  email: string;
  persona: PersonaType;
  personaConfig: PersonaConfig;
  enabled: boolean;
  preferences: Record<string, unknown>;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async findAll(): Promise<UserWithPersona[]> {
    const users = await this.userModel.find({ enabled: true }).lean();
    return users.map((u) => this.withPersonaConfig(u as User));
  }

  async findById(userId: string): Promise<UserWithPersona | null> {
    const user = await this.userModel.findOne({ userId }).lean();
    if (!user) return null;
    return this.withPersonaConfig(user as User);
  }

  async upsert(data: Partial<User> & { userId: string }): Promise<UserWithPersona> {
    const user = await this.userModel
      .findOneAndUpdate({ userId: data.userId }, { $set: data }, { upsert: true, new: true })
      .lean();
    return this.withPersonaConfig(user as User);
  }

  async updatePersona(userId: string, persona: PersonaType): Promise<UserWithPersona | null> {
    const user = await this.userModel
      .findOneAndUpdate({ userId }, { $set: { persona } }, { new: true })
      .lean();
    if (!user) return null;
    return this.withPersonaConfig(user as User);
  }

  private withPersonaConfig(user: User): UserWithPersona {
    return {
      userId: user.userId,
      name: user.name,
      email: user.email,
      persona: user.persona,
      personaConfig: PERSONA_CONFIG[user.persona],
      enabled: user.enabled,
      preferences: user.preferences ?? {},
    };
  }
}
