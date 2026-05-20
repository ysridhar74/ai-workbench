import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentRun, AgentRunSchema } from '../db/schemas/agent-run.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { LlmModule } from '../llm/llm.module';
import { SkillsModule } from '../skills/skills.module';
import { RagModule } from '../rag/rag.module';
import { MemoryModule } from '../memory/memory.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentRun.name, schema: AgentRunSchema }]),
    LlmModule,
    SkillsModule,
    RagModule,
    MemoryModule,
  ],
  providers: [AgentService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}
