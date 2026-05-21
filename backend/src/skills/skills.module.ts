import { Module, OnModuleInit, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Skill, SkillSchema } from '../db/schemas/skill.schema';
import { SkillsService } from './skills.service';
import { SkillsController } from './skills.controller';
import { STARTER_SKILLS } from './definitions/starter-skills';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Skill.name, schema: SkillSchema }]),
  ],
  providers: [SkillsService],
  controllers: [SkillsController],
  exports: [SkillsService],
})
export class SkillsModule implements OnModuleInit {
  private readonly logger = new Logger(SkillsModule.name);

  constructor(private readonly skillsService: SkillsService) {}

  /**
   * Seed the starter skills into MongoDB on first boot if they don't exist.
   */
  async onModuleInit() {
    for (const skill of STARTER_SKILLS) {
      const exists = await this.skillsService.findByName(skill.name);
      if (!exists) {
        await this.skillsService.create(skill);
        this.logger.log(`Seeded skill: "${skill.name}"`);
      } else {
        // Always sync the prompt template so changes here take effect on restart
        await this.skillsService.update(skill.name, {
          promptTemplate: skill.promptTemplate,
          description: skill.description,
        });
        this.logger.log(`Updated skill: "${skill.name}"`);
      }
    }
    const all = await this.skillsService.findAll();
    this.logger.log(`Skill registry ready — ${all.length} skill(s) loaded`);
  }
}
