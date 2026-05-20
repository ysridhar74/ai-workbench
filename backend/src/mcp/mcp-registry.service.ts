/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DynamicTool } from '@langchain/core/tools';
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

    // Expand ${ENV_VAR} placeholders — config.get may return undefined, fall back to the key name
    const expanded = raw.replace(/\$\{(\w+)\}/g, (_match: string, key: string): string => {
      return this.config.get<string>(key) ?? key;
    });

    const servers: McpServerConfig[] = JSON.parse(expanded);

    for (const server of servers) {
      if (!server.enabled) continue;
      try {
        await this.connectServer(server);
      } catch (err) {
        this.logger.error(`Failed to connect MCP server "${server.name}": ${err.message}`);
      }
    }

    this.logger.log(
      `MCP registry ready — ${this.tools.size} tool(s) across ${this.clients.size} server(s)`,
    );
  }

  private async connectServer(server: McpServerConfig) {
    if (server.transport !== 'stdio' || !server.command) return;

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

  /**
   * Return all registered MCP tools as LangChain DynamicTool instances.
   * DynamicTool accepts a plain string input, avoiding the deep generic
   * inference that triggers TS2589 with structured tool types.
   * The agent passes JSON-stringified args; we parse them before calling MCP.
   */
  getLangChainTools(): DynamicTool[] {
    return Array.from(this.tools.values()).map(
      (mcpTool) =>
        new DynamicTool({
          name: mcpTool.name,
          description: mcpTool.description,
          func: async (input: string): Promise<string> => {
            try {
              // The LLM may pass a JSON string or a plain string
              let args: Record<string, unknown> = {};
              try {
                args = JSON.parse(input);
              } catch {
                args = { input };
              }
              const result = await mcpTool.execute(args);
              return typeof result === 'string' ? result : JSON.stringify(result);
            } catch (err) {
              return `Error calling ${mcpTool.name}: ${err.message}`;
            }
          },
        }),
    );
  }

  /** List all available tools (for the /agent/tools API endpoint) */
  listTools(): Omit<McpTool, 'execute'>[] {
    return Array.from(this.tools.values()).map(({ execute: _exec, ...rest }) => rest);
  }

  getToolCount(): number {
    return this.tools.size;
  }
}
