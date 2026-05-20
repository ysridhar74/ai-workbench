import { Module, Global } from '@nestjs/common';
import { McpRegistryService } from './mcp-registry.service';
import { McpController } from './mcp.controller';

@Global()
@Module({
  controllers: [McpController],
  providers: [McpRegistryService],
  exports: [McpRegistryService],
})
export class McpModule {}
