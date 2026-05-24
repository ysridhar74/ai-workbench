// ── Agent ────────────────────────────────────────────────────────────────────

export interface ToolStep {
  tool: string;
  input: unknown;
  output: string;
}

export interface AgentMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  durationMs: number;
  summary: string;
}

export interface AgentResult {
  content: string;
  skill: string;
  model: string;
  toolCallCount: number;
  ragChunksUsed: number;
  steps: ToolStep[];
  metrics: AgentMetrics;
  runId: string;
}

// ── Generative UI ─────────────────────────────────────────────────────────────

export interface UIComponent {
  id: string;
  componentType: string; // e.g. "DataTable", "BarChart", "StatsDashboard", "EntityCard"
  props: unknown;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  steps?: ToolStep[];
  metrics?: AgentMetrics;
  runId?: string;
  isStreaming?: boolean;
  toolCallCount?: number;
  ragChunksUsed?: number;
  /** Generative UI components emitted by the model for this message */
  uiComponents?: UIComponent[];
}

// SSE stream event types
export type StreamEvent =
  | { type: 'chunk'; content: string }
  | { type: 'tool_call'; tool: string; input: unknown }
  | { type: 'tool_result'; tool: string; output: string }
  | { type: 'ui_component'; id: string; componentType: string; props: unknown }
  | { type: 'content_replace'; content: string }
  | { type: 'done'; runId: string; model: string; toolCallCount: number; ragChunksUsed: number; metrics: { durationMs: number; costUsd: number; summary: string } }
  | { type: 'error'; message: string };

// ── Users & Personas ─────────────────────────────────────────────────────────

export type PersonaType = 'broker' | 'underwriter' | 'claims';

export interface QuickAction {
  label: string;
  prompt: string;
  icon: string;
}

export interface PersonaConfig {
  persona: PersonaType;
  displayName: string;
  description: string;
  color: string;
  skill: string;
  ragNamespace: string;
  defaultDatabase: string;
  quickActions: QuickAction[];
}

export interface User {
  userId: string;
  name: string;
  email: string;
  persona: PersonaType;
  personaConfig: PersonaConfig;
  enabled: boolean;
  preferences: Record<string, unknown>;
}

// ── Skills ───────────────────────────────────────────────────────────────────

export interface Skill {
  _id: string;
  name: string;
  description: string;
  promptTemplate: string;
  tools: string[];
  preferredModel: string | null;
  enabled: boolean;
  category: string;
}

// ── RAG ──────────────────────────────────────────────────────────────────────

export interface IngestResult {
  namespace: string;
  chunksCreated: number;
  source: string;
}

export interface RetrieveResult {
  query: string;
  namespace: string;
  results: Array<{ text: string; score: number; metadata: Record<string, unknown> }>;
}

// ── Runs ─────────────────────────────────────────────────────────────────────

export interface AgentRun {
  _id: string;
  runId: string;
  skill: string;
  input: string;
  output: string;
  durationMs: number;
  status: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  model: string;
  userId: string | null;
  steps: ToolStep[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RunStats {
  totalRuns: number;
  totalTokens: number;
  totalCostUsd: number;
  avgDurationMs: number;
  bySkill: Array<{ skill: string; count: number; totalCostUsd: number }>;
  byModel: Array<{ model: string; count: number; totalTokens: number }>;
}

// ── MCP ──────────────────────────────────────────────────────────────────────

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

export interface McpTool {
  name: string;
  description: string;
  server: string;
  inputSchema: Record<string, unknown>;
}

// ── Memory ───────────────────────────────────────────────────────────────────

export interface MemoryFact {
  _id: string;
  userId: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryEntity {
  _id: string;
  userId: string;
  entityType: string;
  name: string;
  attributes: Record<string, unknown>;
  mentions: string[];
  createdAt: string;
}
