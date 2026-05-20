import { Module, Global } from '@nestjs/common';
import { McpRegistryService } from './mcp-registry.service';

@Global()
@Module({
  providers: [McpRegistryService],
  exports: [McpRegistryService],
})
export class McpModule {}
