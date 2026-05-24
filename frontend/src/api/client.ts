import axios from 'axios';

const BASE = '/api/v1';

export const api = axios.create({ baseURL: BASE });

// ── Agent ─────────────────────────────────────────────────────────────────

export const agentApi = {
  run: (body: {
    message: string;
    skill?: string;
    userId?: string;
    history?: Array<{ role: 'user' | 'assistant'; content: string }>;
    useRag?: boolean;
    useTools?: boolean;
    namespace?: string;
    database?: string;
  }) => api.post('/agent', body).then(r => r.data),

  listTools: () => api.get('/agent/tools').then(r => r.data),
};

// ── Skills ────────────────────────────────────────────────────────────────

export const skillsApi = {
  list: () => api.get('/skills').then(r => r.data.skills),
  listAll: () => api.get('/skills/all').then(r => r.data.skills),
  create: (body: unknown) => api.post('/skills', body).then(r => r.data.skill),
  update: (name: string, body: unknown) => api.patch(`/skills/${name}`, body).then(r => r.data.skill),
  disable: (name: string) => api.post(`/skills/${name}/disable`),
};

// ── RAG ───────────────────────────────────────────────────────────────────

export const ragApi = {
  ingestText: (body: { text: string; source: string; namespace?: string }) =>
    api.post('/rag/ingest/text', body).then(r => r.data),

  ingestFile: (file: File, namespace?: string) => {
    const fd = new FormData();
    fd.append('file', file);
    if (namespace) fd.append('namespace', namespace);
    return api.post('/rag/ingest/file', fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: undefined,
    }).then(r => r.data);
  },

  ingestUrl: (url: string, namespace?: string) =>
    api.post('/rag/ingest/url', { url, namespace }).then(r => r.data),

  retrieve: (query: string, namespace?: string) =>
    api.post('/rag/retrieve', { query, namespace }).then(r => r.data),

  listNamespaces: () => api.get('/rag/namespaces').then(r => r.data.namespaces as string[]),

  listSources: (namespace?: string) =>
    api.get('/rag/sources', { params: { namespace } }).then(r => r.data),

  deleteSource: (source: string, namespace?: string) =>
    api.delete('/rag/source', { params: { source, namespace } }).then(r => r.data),
};

// ── Runs ──────────────────────────────────────────────────────────────────

export const runsApi = {
  list: (params?: { userId?: string; skill?: string; limit?: number; offset?: number; from?: string; to?: string }) =>
    api.get('/runs', { params }).then(r => r.data),

  get: (runId: string) => api.get(`/runs/${runId}`).then(r => r.data),

  stats: (params?: { userId?: string; from?: string; to?: string }) =>
    api.get('/runs/stats', { params }).then(r => r.data),
};

// ── MCP ───────────────────────────────────────────────────────────────────

export const mcpApi = {
  listServers: () => api.get('/mcp/servers').then(r => r.data.servers),
  listTools: () => api.get('/mcp/tools').then(r => r.data.tools),
  reload: () => api.post('/mcp/reload').then(r => r.data),
  connectServer: (body: unknown) => api.post('/mcp/servers', body).then(r => r.data),
  disconnectServer: (name: string) => api.delete(`/mcp/servers/${name}`).then(r => r.data),
  reconnectServer: (name: string) => api.post(`/mcp/servers/${name}/reconnect`).then(r => r.data),
};

// ── Memory ────────────────────────────────────────────────────────────────

export const memoryApi = {
  getFacts: (userId: string) => api.get(`/memory/facts/${userId}`).then(r => r.data),
  upsertFact: (body: { userId: string; key: string; value: string }) =>
    api.post('/memory/facts', body).then(r => r.data),
  deleteFact: (userId: string, key: string) =>
    api.delete(`/memory/facts/${userId}/${key}`),
  clearFacts: (userId: string) => api.delete(`/memory/facts/${userId}`),

  getEntities: (userId: string, entityType?: string) =>
    api.get(`/memory/entities/${userId}`, { params: { entityType } }).then(r => r.data),
  deleteEntity: (userId: string, entityType: string, name: string) =>
    api.delete(`/memory/entities/${userId}/${entityType}/${name}`),
  clearEntities: (userId: string) => api.delete(`/memory/entities/${userId}`),

  getContext: (userId: string) => api.get(`/memory/context/${userId}`).then(r => r.data),
  clearAll: (userId: string) => api.delete(`/memory/${userId}`),
};

// ── Users ─────────────────────────────────────────────────────────────────

export const usersApi = {
  list: () => api.get('/users').then(r => r.data as import('@/types').User[]),
  get: (userId: string) => api.get(`/users/${userId}`).then(r => r.data as import('@/types').User),
};

// ── SSE Streaming ─────────────────────────────────────────────────────────

export function streamAgent(
  body: Parameters<typeof agentApi.run>[0] & { database?: string },
  callbacks: {
    onChunk: (text: string) => void;
    onToolCall: (tool: string, input: unknown) => void;
    onToolResult: (tool: string, output: string) => void;
    onUIComponent: (id: string, componentType: string, props: unknown) => void;
    onContentReplace: (content: string) => void;
    onDone: (data: { runId: string; model: string; toolCallCount: number; ragChunksUsed: number; metrics: { durationMs: number; costUsd: number; summary: string } }) => void;
    onError: (msg: string) => void;
  },
): () => void {
  const controller = new AbortController();

  fetch(`${BASE}/agent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      callbacks.onError(`HTTP ${res.status}`);
      return;
    }
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') break;
        try {
          const evt = JSON.parse(raw);
          if (evt.type === 'chunk') callbacks.onChunk(evt.content);
          else if (evt.type === 'tool_call') callbacks.onToolCall(evt.tool, evt.input);
          else if (evt.type === 'tool_result') callbacks.onToolResult(evt.tool, evt.output ?? '');
          else if (evt.type === 'ui_component') callbacks.onUIComponent(evt.id, evt.componentType, evt.props);
          else if (evt.type === 'content_replace') callbacks.onContentReplace(evt.content);
          else if (evt.type === 'done') callbacks.onDone(evt);
          else if (evt.type === 'error') callbacks.onError(evt.message);
        } catch { /* skip malformed lines */ }
      }
    }
  }).catch((err) => {
    if (err.name !== 'AbortError') callbacks.onError(err.message);
  });

  return () => controller.abort();
}
