import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AgentRun, AgentRunSchema } from '../db/schemas/agent-run.schema';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { LlmModule } from '../llm/llm.module';
import { SkillsModule } from '../skills/skills.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentRun.name, schema: AgentRunSchema }]),
    LlmModule,
    SkillsModule,
  ],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
