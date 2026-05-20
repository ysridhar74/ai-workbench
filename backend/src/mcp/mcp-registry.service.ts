/* eslint-disable @typescript-eslint/no-explicit-any */
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { DynamicTool } from '@langchain/core/tools';
import * as fs from 'fs';
import * as path from 'path';
import { McpServerConfig, McpTool, McpServerStatus } from './mcp.types';

interface ServerEntry {
  config: McpServerConfig;
  client: Client | null;
  connected: boolean;
  error?: string;
}

@Injectable()
export class McpRegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpRegistryService.name);

  /** All tools indexed by tool name (serverName__toolName) */
  private readonly tools = new Map<string, McpTool>();

  /** Server state indexed by server name */
  private readonly servers = new Map<string, ServerEntry>();

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    await this.loadServers();
  }

  async onModuleDestroy() {
    await this.disconnectAll();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Startup
  // ─────────────────────────────────────────────────────────────────────────

  private async loadServers() {
    const configPath = path.join(process.cwd(), 'config', 'mcp-servers.json');
    if (!fs.existsSync(configPath)) {
      this.logger.warn('No mcp-servers.json found — MCP registry is empty');
      return;
    }

    const serverConfigs = this.parseConfig(configPath);

    await Promise.allSettled(
      serverConfigs
        .filter((s) => s.enabled)
        .map((s) => this.connectServer(s)),
    );

    this.logger.log(
      `MCP registry ready — ${this.tools.size} tool(s) across ${this.servers.size} server(s)`,
    );
  }

  private parseConfig(configPath: string): McpServerConfig[] {
    const raw = fs.readFileSync(configPath, 'utf-8');
    // Expand ${ENV_VAR} placeholders
    const expanded = raw.replace(/\$\{(\w+)\}/g, (_m: string, key: string): string =>
      this.config.get<string>(key) ?? key,
    );
    return JSON.parse(expanded) as McpServerConfig[];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Connect / disconnect individual servers
  // ─────────────────────────────────────────────────────────────────────────

  async connectServer(serverConfig: McpServerConfig): Promise<void> {
    // Remove any existing tools for this server first
    this.removeServerTools(serverConfig.name);

    const entry: ServerEntry = {
      config: serverConfig,
      client: null,
      connected: false,
    };
    this.servers.set(serverConfig.name, entry);

    try {
      const client = new Client(
        { name: 'ai-workbench', version: '1.0.0' },
        { capabilities: {} },
      );

      const transport = this.buildTransport(serverConfig);
      await client.connect(transport);

      entry.client = client;
      entry.connected = true;

      const { tools } = await client.listTools();

      for (const t of tools) {
        const toolName = `${serverConfig.name}__${t.name}`;
        const mcpTool: McpTool = {
          name: toolName,
          description: `[${serverConfig.name}] ${t.description ?? t.name}`,
          server: serverConfig.name,
          inputSchema: t.inputSchema as Record<string, unknown>,
          execute: async (args) => {
            const timeout = serverConfig.timeout ?? 30_000;
            return Promise.race([
              client.callTool({ name: t.name, arguments: args }).then((r) => r.content),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error(`Tool call timed out after ${timeout}ms`)), timeout),
              ),
            ]);
          },
        };
        this.tools.set(toolName, mcpTool);
      }

      this.logger.log(
        `Connected MCP server "${serverConfig.name}" (${serverConfig.transport}) — ${tools.length} tool(s)`,
      );
    } catch (err) {
      entry.error = err.message;
      this.logger.error(
        `Failed to connect MCP server "${serverConfig.name}": ${err.message}`,
      );
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const entry = this.servers.get(name);
    if (!entry) return;

    try {
      await entry.client?.close();
    } catch {}

    this.removeServerTools(name);
    this.servers.delete(name);
    this.logger.log(`Disconnected MCP server "${name}"`);
  }

  private async disconnectAll() {
    for (const [name] of this.servers) {
      await this.disconnectServer(name);
    }
  }

  private removeServerTools(serverName: string) {
    for (const [key] of this.tools) {
      if (key.startsWith(`${serverName}__`)) {
        this.tools.delete(key);
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Transport factory
  // ─────────────────────────────────────────────────────────────────────────

  private buildTransport(server: McpServerConfig) {
    switch (server.transport) {
      case 'stdio': {
        if (!server.command) throw new Error(`stdio server "${server.name}" requires "command"`);
        return new StdioClientTransport({
          command: server.command,
          args: server.args ?? [],
          env: server.env ? { ...process.env, ...server.env } as Record<string, string> : undefined,
        });
      }

      case 'streamable-http': {
        if (!server.url) throw new Error(`streamable-http server "${server.name}" requires "url"`);
        return new StreamableHTTPClientTransport(
          new URL(server.url),
          {
            requestInit: server.headers
              ? { headers: server.headers }
              : undefined,
          },
        );
      }

      case 'sse': {
        if (!server.url) throw new Error(`sse server "${server.name}" requires "url"`);
        return new SSEClientTransport(
          new URL(server.url),
          server.headers
            ? { requestInit: { headers: server.headers } }
            : undefined,
        );
      }

      default:
        throw new Error(`Unknown transport type "${(server as any).transport}"`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Hot reload — re-read config file and reconnect changed servers
  // ─────────────────────────────────────────────────────────────────────────

  async reload(): Promise<void> {
    const configPath = path.join(process.cwd(), 'config', 'mcp-servers.json');
    if (!fs.existsSync(configPath)) {
      this.logger.warn('mcp-servers.json not found during reload');
      return;
    }

    const serverConfigs = this.parseConfig(configPath);

    // Disconnect servers that are no longer in config or are disabled
    const newNames = new Set(serverConfigs.filter((s) => s.enabled).map((s) => s.name));
    for (const [name] of this.servers) {
      if (!newNames.has(name)) await this.disconnectServer(name);
    }

    // Connect new / reconnect updated servers
    await Promise.allSettled(
      serverConfigs
        .filter((s) => s.enabled)
        .map((s) => this.connectServer(s)),
    );

    this.logger.log(`MCP registry reloaded — ${this.tools.size} tool(s)`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LangChain tool adapter
  // ─────────────────────────────────────────────────────────────────────────

  getLangChainTools(): DynamicTool[] {
    return Array.from(this.tools.values()).map((mcpTool) => {
      const schemaHint = this.buildSchemaHint(mcpTool.inputSchema);
      const description =
        `${mcpTool.description}. ` +
        `Input must be a JSON string with this shape: ${schemaHint}`;

      return new DynamicTool({
        name: mcpTool.name,
        description,
        func: async (input: string): Promise<string> => {
          try {
            let args: Record<string, unknown> = {};
            try {
              const parsed = JSON.parse(input);
              args = typeof parsed === 'object' && parsed !== null ? parsed : { path: input };
            } catch {
              args =
                input.trim().startsWith('/') || input.trim().startsWith('~')
                  ? { path: input.trim() }
                  : { input: input.trim() };
            }
            const result = await mcpTool.execute(args);
            return typeof result === 'string' ? result : JSON.stringify(result);
          } catch (err) {
            return `Error calling ${mcpTool.name}: ${err.message}`;
          }
        },
      });
    });
  }

  private buildSchemaHint(schema: Record<string, unknown>): string {
    try {
      const props = (schema as any)?.properties ?? {};
      const required: string[] = (schema as any)?.required ?? [];
      const hint: Record<string, string> = {};
      for (const [key, val] of Object.entries(props)) {
        const type = (val as any)?.type ?? 'string';
        hint[key] = required.includes(key) ? `${type} (required)` : `${type} (optional)`;
      }
      return JSON.stringify(hint);
    } catch {
      return '{}';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Inspection API
  // ─────────────────────────────────────────────────────────────────────────

  listTools(): Omit<McpTool, 'execute'>[] {
    return Array.from(this.tools.values()).map(({ execute: _exec, ...rest }) => rest);
  }

  listServers(): McpServerStatus[] {
    return Array.from(this.servers.values()).map((entry) => ({
      name: entry.config.name,
      description: entry.config.description,
      transport: entry.config.transport,
      enabled: entry.config.enabled,
      connected: entry.connected,
      toolCount: Array.from(this.tools.keys()).filter((k) =>
        k.startsWith(`${entry.config.name}__`),
      ).length,
      url: entry.config.url,
      command: entry.config.command,
      error: entry.error,
    }));
  }

  getToolCount(): number {
    return this.tools.size;
  }
}
