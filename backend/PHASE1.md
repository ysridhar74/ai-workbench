# Phase 1 — Getting Started

## What's built

| Module | What it does |
|--------|-------------|
| **NestJS app** | TypeScript backend, runs on Node.js |
| **MongoDB (Mongoose)** | Connects to Atlas; stores skills and agent run logs |
| **Skill Registry** | Loads skills from MongoDB; seeds 2 starter skills on first boot |
| **LlmService** | Calls any LLM via OpenAI-compatible API (direct or via LiteLLM proxy) |
| **ChatService** | Runs a full agent turn: skill lookup → context assembly → LLM call → persist run |
| **ObservabilityService** | Records input tokens, output tokens, cost per request to MongoDB + LangSmith |

## Setup

### 1. Install dependencies
```bash
cd backend
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
# Fill in MONGODB_URI, LLM_MODEL, ANTHROPIC_API_KEY (or OPENAI_API_KEY), LANGCHAIN_API_KEY
```

### 3. Start the backend
```bash
npm run start:dev
```

You should see:
```
🚀 AI Workbench backend running on http://localhost:3001/api/v1
   LLM model : claude-3-5-sonnet-20241022
   LangSmith : enabled
```

And in the Skill Registry logs:
```
Seeded skill: "general-assistant"
Seeded skill: "summarizer"
Skill registry ready — 2 skill(s) loaded
```

## API endpoints

### List skills
```
GET /api/v1/skills
```

### Chat (standard)
```
POST /api/v1/chat
Content-Type: application/json

{
  "message": "Explain what a vector database is in simple terms",
  "skill": "general-assistant"
}
```

Response includes `metrics` with input tokens, output tokens, cost, and duration:
```json
{
  "content": "...",
  "skill": "general-assistant",
  "model": "claude-3-5-sonnet-20241022",
  "metrics": {
    "inputTokens": 412,
    "outputTokens": 318,
    "totalTokens": 730,
    "costUsd": 0.006006,
    "durationMs": 1240,
    "summary": "↑ 412 tokens  ↓ 318 tokens  ≈ $0.006006  1240ms"
  },
  "runId": "a1b2c3d4-..."
}
```

### Chat (streaming)
```
POST /api/v1/chat/stream
Content-Type: application/json

{
  "message": "Summarise the history of the internet",
  "skill": "summarizer"
}
```

Response is Server-Sent Events. Each event is:
- `{ "type": "chunk", "content": "..." }` — a token chunk
- `{ "type": "done", "runId": "...", "model": "...", "metrics": { ... } }` — final metrics
- `[DONE]` — stream end marker

## LangSmith dashboard

Every request creates a trace at https://smith.langchain.com under the project
set in `LANGCHAIN_PROJECT`. Each trace shows the full prompt, response, token
counts, latency, and cost.

## Adding a new skill

Add an entry to `src/skills/definitions/starter-skills.ts` and restart the
backend. The Skill Registry will auto-seed it into MongoDB.

## Phase 2 preview

Next: LangGraph agent runner, MCP Registry, tool dispatch, and the LangChain
RAG pipeline with MongoDB Atlas Vector Search.
