export interface McpServerConfig {
  name: string;
  description: string;
  enabled: boolean;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  url?: string;
  tools: string[];
}

export interface McpTool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  // The actual callable function bound to the MCP connection
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}
