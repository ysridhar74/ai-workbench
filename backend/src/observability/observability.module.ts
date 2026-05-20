import { Module, Global, OnModuleInit, Logger } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { AgentRun, AgentRunSchema } from '../db/schemas/agent-run.schema';
import { ObservabilityService } from './observability.service';
import { ObservabilityController } from './observability.controller';

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: AgentRun.name, schema: AgentRunSchema }]),
  ],
  controllers: [ObservabilityController],
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule implements OnModuleInit {
  private readonly logger = new Logger(ObservabilityModule.name);

  constructor(private readonly config: ConfigService) {}

  onModuleInit() {
    const enabled = this.config.get<string>('LANGCHAIN_TRACING_V2') === 'true';
    const project = this.config.get<string>('LANGCHAIN_PROJECT', 'ai-workbench');

    if (enabled) {
      // LangSmith reads these env vars automatically when tracing is enabled
      this.logger.log(`LangSmith tracing enabled — project: "${project}"`);
    } else {
      this.logger.warn('LangSmith tracing disabled (set LANGCHAIN_TRACING_V2=true to enable)');
    }
  }
}
