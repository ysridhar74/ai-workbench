export interface McpServerConfig {
  name: string;
  description: string;
  enabled: boolean;

  /**
   * Transport type:
   *  - 'stdio'            — local process, command + args required
   *  - 'streamable-http'  — modern HTTP/SSE MCP server (MCP spec 2025-03-26), url required
   *  - 'sse'              — legacy SSE-only MCP server, url required
   */
  transport: 'stdio' | 'streamable-http' | 'sse';

  // stdio only
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // http / sse only
  url?: string;

  /**
   * Optional HTTP headers sent on every request (e.g. Authorization).
   * Values support ${ENV_VAR} expansion.
   */
  headers?: Record<string, string>;

  /** Timeout in ms for each tool call (default: 30000) */
  timeout?: number;

  tools: string[];
}

export interface McpTool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface McpServerStatus {
  name: string;
  description: string;
  transport: string;
  enabled: boolean;
  connected: boolean;
  toolCount: number;
  url?: string;
  command?: string;
  error?: string;
}
