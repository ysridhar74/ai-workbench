import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { McpServerConfig, McpTool } from './mcp.types';

@Injectable()
export class McpRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpRegistryService.name);
  private readonly tools = new Map<string, McpTool>();
  private readonly clients = new Map<string, Client>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.loadServers();
  }

  async onModuleDestroy() {
    for (const [name, client] of this.clients) {
      try {
        await client.close();
        this.logger.log(`Disconnected MCP server: ${name}`);
      } catch {}
    }
  }

  private async loadServers() {
    const configPath = path.join(process.cwd(), 'config', 'mcp-servers.json');
    if (!fs.existsSync(configPath)) {
      this.logger.warn('No mcp-servers.json found — MCP registry is empty');
      return;
    }

    const raw = fs.readFileSync(configPath, 'utf-8');
    const servers: McpServerConfig[] = JSON.parse(
      // Expand env variable placeholders like ${MCP_FILESYSTEM_ROOT}
      raw.replace(/\$\{(\w+)\}/g, (_, key) => this.config.get<string>(key, key)),
    );

    for (const server of servers) {
      if (!server.enabled) continue;
      try {
        await this.connectServer(server);
      } catch (err) {
        this.logger.error(`Failed to connect MCP server "${server.name}": ${err.message}`);
      }
    }

    this.logger.log(`MCP registry ready — ${this.tools.size} tool(s) across ${this.clients.size} server(s)`);
  }

  private async connectServer(server: McpServerConfig) {
    if (server.transport === 'stdio' && server.command) {
      const transport = new StdioClientTransport({
        command: server.command,
        args: server.args ?? [],
      });

      const client = new Client(
        { name: 'ai-workbench', version: '1.0.0' },
        { capabilities: {} },
      );

      await client.connect(transport);
      this.clients.set(server.name, client);

      // Fetch the server's tool manifest
      const { tools } = await client.listTools();

      for (const t of tools) {
        const mcpTool: McpTool = {
          name: `${server.name}__${t.name}`,
          description: `[${server.name}] ${t.description ?? t.name}`,
          server: server.name,
          inputSchema: t.inputSchema as Record<string, unknown>,
          execute: async (args) => {
            const result = await client.callTool({ name: t.name, arguments: args });
            return result.content;
          },
        };
        this.tools.set(mcpTool.name, mcpTool);
      }

      this.logger.log(`Connected MCP server "${server.name}" — ${tools.length} tool(s)`);
    }
  }

  /** Return all registered MCP tools as LangChain-compatible tool objects */
  getLangChainTools() {
    return Array.from(this.tools.values()).map((mcpTool) =>
      tool(
        async (args: Record<string, unknown>) => {
          try {
            const result = await mcpTool.execute(args);
            return typeof result === 'string' ? result : JSON.stringify(result);
          } catch (err) {
            return `Error calling ${mcpTool.name}: ${err.message}`;
          }
        },
        {
          name: mcpTool.name,
          description: mcpTool.description,
          schema: z.object({}).passthrough(), // Accept any args; MCP server validates
        },
      ),
    );
  }

  /** List all available tools (for UI / API display) */
  listTools(): Omit<McpTool, 'execute'>[] {
    return Array.from(this.tools.values()).map(({ execute: _, ...rest }) => rest);
  }

  getToolCount(): number {
    return this.tools.size;
  }
}
