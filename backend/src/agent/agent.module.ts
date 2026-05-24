import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentRun, AgentRunSchema } from '../db/schemas/agent-run.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { UiRendererService } from './ui-renderer.service';
import { ExcelProcessorService } from './excel-processor.service';
import { ResultClassifierService } from './result-classifier.service';
import { LlmModule } from '../llm/llm.module';
import { SkillsModule } from '../skills/skills.module';
import { RagModule } from '../rag/rag.module';
import { MemoryModule } from '../memory/memory.module';
import { MongoQueryModule } from '../mongo-query/mongo-query.module';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentRun.name, schema: AgentRunSchema }]),
    LlmModule,
    SkillsModule,
    RagModule,
    MemoryModule,
    MongoQueryModule,
    UsersModule,
  ],
  providers: [AgentService, UiRendererService, ExcelProcessorService, ResultClassifierService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}
