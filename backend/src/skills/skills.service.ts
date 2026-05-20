import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Skill, SkillDocument } from '../db/schemas/skill.schema';

export interface CreateSkillDto {
  name: string;
  description: string;
  promptTemplate: string;
  tools?: string[];
  preferredModel?: string;
  enabled?: boolean;
  category?: string;
}

@Injectable()
export class SkillsService {
  constructor(
    @InjectModel(Skill.name) private readonly skillModel: Model<SkillDocument>,
  ) {}

  async findAll(enabledOnly = true): Promise<Skill[]> {
    return this.skillModel.find(enabledOnly ? { enabled: true } : {}).lean();
  }

  async findByName(name: string): Promise<Skill | null> {
    return this.skillModel.findOne({ name }).lean();
  }

  async findById(id: string): Promise<Skill> {
    const skill = await this.skillModel.findById(id).lean();
    if (!skill) throw new NotFoundException(`Skill "${id}" not found`);
    return skill;
  }

  async create(dto: CreateSkillDto): Promise<Skill> {
    return this.skillModel.create(dto);
  }

  async update(name: string, dto: Partial<CreateSkillDto>): Promise<Skill> {
    const skill = await this.skillModel
      .findOneAndUpdate({ name }, dto, { new: true })
      .lean();
    if (!skill) throw new NotFoundException(`Skill "${name}" not found`);
    return skill;
  }

  async disable(name: string): Promise<void> {
    await this.update(name, { enabled: false });
  }

  /**
   * Build the system prompt for a skill, optionally injecting context variables.
   */
  buildSystemPrompt(skill: Skill, vars: Record<string, string> = {}): string {
    let prompt = skill.promptTemplate;
    for (const [key, value] of Object.entries(vars)) {
      prompt = prompt.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return prompt;
  }
}
