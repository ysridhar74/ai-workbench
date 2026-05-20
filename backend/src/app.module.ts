import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { SkillsModule } from './skills/skills.module';
import { LlmModule } from './llm/llm.module';
import { ChatModule } from './chat/chat.module';
import { ObservabilityModule } from './observability/observability.module';

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

    // Feature modules
    ObservabilityModule,
    LlmModule,
    SkillsModule,
    ChatModule,
  ],
})
export class AppModule {}
