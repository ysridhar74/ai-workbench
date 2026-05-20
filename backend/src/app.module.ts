import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillsModule } from './skills/skills.module';
import { LlmModule } from './llm/llm.module';
import { ChatModule } from './chat/chat.module';
import { ObservabilityModule } from './observability/observability.module';
import { McpModule } from './mcp/mcp.module';
import { RagModule } from './rag/rag.module';
import { AgentModule } from './agent/agent.module';

@Module({
  imports: [
    // Config — loads .env automatically
    ConfigModule.forRoot({ isGlobal: true }),

    // MongoDB via Atlas
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>('MONGODB_URI'),
        dbName: config.get<string>('MONGODB_DB', 'ai_workbench'),
      }),
      inject: [ConfigService],
    }),

    // Core infrastructure (global)
    ObservabilityModule,
    McpModule,

    // Feature modules
    LlmModule,
    SkillsModule,
    RagModule,
    ChatModule,
    AgentModule,
  ],
})
export class AppModule {}
