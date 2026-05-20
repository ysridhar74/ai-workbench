import {
  Controller, Get, Post, Delete, Param,
  Body, HttpCode, BadRequestException,
} from '@nestjs/common';
import { McpRegistryService } from './mcp-registry.service';
import { McpServerConfig } from './mcp.types';
import { IsString, IsNotEmpty } from 'class-validator';

class ConnectServerDto {
  @IsString() @IsNotEmpty() name: string;
  @IsString() @IsNotEmpty() description: string;
  @IsString() @IsNotEmpty() transport: string;
  url?: string;
  command?: string;
  args?: string[];
  headers?: Record<string, string>;
  timeout?: number;
}

@Controller('mcp')
export class McpController {
  constructor(private readonly registry: McpRegistryService) {}

  /**
   * GET /api/v1/mcp/servers
   * List all configured servers with their connection status.
   */
  @Get('servers')
  listServers() {
    return { servers: this.registry.listServers() };
  }

  /**
   * GET /api/v1/mcp/tools
   * List all tools currently available across all connected servers.
   */
  @Get('tools')
  listTools() {
    return { tools: this.registry.listTools() };
  }

  /**
   * POST /api/v1/mcp/reload
   * Re-read mcp-servers.json and reconnect all servers.
   * Use this after editing the config file without restarting the backend.
   */
  @Post('reload')
  @HttpCode(200)
  async reload() {
    await this.registry.reload();
    return {
      message: 'MCP registry reloaded',
      servers: this.registry.listServers(),
      toolCount: this.registry.getToolCount(),
    };
  }

  /**
   * POST /api/v1/mcp/servers
   * Dynamically connect a new MCP server without editing the config file.
   * Useful for the frontend to add servers at runtime.
   *
   * Body: McpServerConfig (transport, url or command, etc.)
   */
  @Post('servers')
  @HttpCode(200)
  async connectServer(@Body() dto: ConnectServerDto) {
    const validTransports = ['stdio', 'streamable-http', 'sse'];
    if (!validTransports.includes(dto.transport)) {
      throw new BadRequestException(
        `Invalid transport "${dto.transport}". Must be one of: ${validTransports.join(', ')}`,
      );
    }

    if (dto.transport === 'stdio' && !dto.command) {
      throw new BadRequestException('stdio transport requires "command"');
    }
    if ((dto.transport === 'streamable-http' || dto.transport === 'sse') && !dto.url) {
      throw new BadRequestException(`${dto.transport} transport requires "url"`);
    }

    const config: McpServerConfig = {
      name: dto.name,
      description: dto.description,
      enabled: true,
      transport: dto.transport as McpServerConfig['transport'],
      url: dto.url,
      command: dto.command,
      args: dto.args,
      headers: dto.headers,
      timeout: dto.timeout,
      tools: [],
    };

    await this.registry.connectServer(config);

    // Clear agent cache so new tools are picked up on next run
    return {
      message: `Server "${dto.name}" connected`,
      servers: this.registry.listServers(),
      toolCount: this.registry.getToolCount(),
    };
  }

  /**
   * DELETE /api/v1/mcp/servers/:name
   * Disconnect and remove a server from the registry.
   */
  @Delete('servers/:name')
  @HttpCode(200)
  async disconnectServer(@Param('name') name: string) {
    await this.registry.disconnectServer(name);
    return {
      message: `Server "${name}" disconnected`,
      servers: this.registry.listServers(),
      toolCount: this.registry.getToolCount(),
    };
  }

  /**
   * POST /api/v1/mcp/servers/:name/reconnect
   * Disconnect and reconnect a specific server (e.g. after a crash).
   */
  @Post('servers/:name/reconnect')
  @HttpCode(200)
  async reconnectServer(@Param('name') name: string) {
    const servers = this.registry.listServers();
    const existing = servers.find((s) => s.name === name);
    if (!existing) {
      throw new BadRequestException(`Server "${name}" not found in registry`);
    }

    // Reconnect using the stored config
    await this.registry.disconnectServer(name);

    // Re-read from file to get the freshest config for this server
    await this.registry.reload();

    return {
      message: `Server "${name}" reconnected`,
      servers: this.registry.listServers(),
    };
  }
}
