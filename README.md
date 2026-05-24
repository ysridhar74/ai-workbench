# AI Workbench

An agentic AI platform for internal company use. Provides a chat interface backed by a LangChain ReAct agent with skills, RAG, long-term memory, MCP tools, multi-database querying, and generative UI components.

---

## Architecture overview

```
frontend/          React + Vite + Tailwind — chat UI with generative UI rendering
backend/           NestJS + LangChain + LangSmith — agent, skills, RAG, memory, tools
config/            mongo-databases.json — plug-and-play multi-DB configuration
```

**Backend modules**

| Module | What it does |
|---|---|
| `agent` | LangChain ReAct agent, SSE streaming, generative UI render tools |
| `skills` | Skill registry — prompt templates stored in MongoDB, seeded on boot |
| `llm` | LLM client — OpenAI-compatible or Azure OpenAI, driven by env vars |
| `rag` | RAG pipeline — MongoDB Atlas Vector Search, document ingestion |
| `memory` | Long-term user memory — extracts and injects context across sessions |
| `mcp` | MCP tool registry — loads and exposes MCP server tools to the agent |
| `mongo-query` | Native multi-database querying — registered via `config/mongo-databases.json` |
| `observability` | Records every agent run (tokens, cost, duration) to MongoDB + LangSmith |

---

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 20 or 22 LTS | `node --version` to check |
| npm | 10+ | Comes with Node |
| MongoDB Atlas | Any | Free M0 tier works for development |
| LLM API key | — | OpenAI, Anthropic, Azure OpenAI, or a LiteLLM proxy |

---

## New machine setup

### 1. Clone the repository

```bash
git clone <repo-url>
cd "AI Workbench"
```

### 2. Install backend dependencies

```bash
cd backend
npm ci
```

> Use `npm ci` (not `npm install`) on new machines and in CI. It installs the exact tree from `package-lock.json` and fails if the lockfile is out of sync — preventing accidental version drift.

### 3. Configure the backend environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values:

```env
# MongoDB — get from Atlas → Connect → Drivers
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=ai_workbench

# LLM provider — choose one block below

# Option A: OpenAI direct
LLM_MODEL=gpt-4o
OPENAI_API_KEY=sk-...

# Option B: Anthropic direct
LLM_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_API_KEY=sk-ant-...

# Option C: Azure OpenAI
LLM_PROVIDER=azure
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_INSTANCE_NAME=my-company-openai   # resource name only, not full URL
AZURE_OPENAI_DEPLOYMENT=gpt-4o                 # deployment name from Azure AI Studio
AZURE_OPENAI_API_VERSION=2024-02-01

# Option D: LiteLLM proxy (routes any provider)
LLM_MODEL=anthropic/claude-3-5-sonnet
LLM_BASE_URL=http://localhost:4000
LLM_API_KEY=any-key

# Embeddings (for RAG)
EMBEDDING_MODEL=text-embedding-3-small
OPENAI_API_KEY=sk-...   # used for embeddings unless EMBEDDING_API_KEY is set separately

# LangSmith observability (optional but recommended)
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=ls__...
LANGCHAIN_PROJECT=ai-workbench-dev
```

### 4. Set up MongoDB Atlas Vector Search (for RAG)

1. Open your Atlas cluster → **Search** → **Create Search Index**
2. Choose **Atlas Vector Search** (not full-text search)
3. Select the `ai_workbench` database and `rag_documents` collection
4. Use this index definition:

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 1536,
      "similarity": "cosine"
    }
  ]
}
```

5. Name the index `rag_vector_index` (or set `MONGODB_VECTOR_INDEX` in `.env` to match your name)

### 5. Start the backend

```bash
# Development (auto-reloads on file changes)
npm run start:dev

# Production
npm run build
npm start
```

Expected output:
```
AI Workbench backend running on http://localhost:3001/api/v1
LLM model : gpt-4o
LangSmith : enabled
Skill registry ready — 3 skill(s) loaded
MongoDB query service ready — 1 database(s) enabled
```

### 6. Install frontend dependencies

Open a new terminal:

```bash
cd frontend
npm ci
```

### 7. Start the frontend

```bash
npm run dev
```

The app opens at **http://localhost:3000**

---

## Connecting additional databases

The agent can query multiple MongoDB databases. Register them in `backend/config/mongo-databases.json`:

```json
[
  {
    "name": "crm",
    "label": "CRM",
    "description": "Customer and trading partner data",
    "uri": "${MONGODB_URI}",
    "database": "crm_db",
    "enabled": true,
    "readOnly": true
  }
]
```

Set `enabled: true` and restart the backend. The agent will discover the schema automatically and include the database in its query tools. URIs support `${ENV_VAR}` substitution — add the variable to `.env`.

---

## Adding a new skill

1. Open `backend/src/skills/definitions/starter-skills.ts`
2. Add an entry to the `STARTER_SKILLS` array:

```ts
{
  name: 'my-skill',
  description: 'What this skill does',
  promptTemplate: `You are a specialist in ...`,
  tools: [],
  category: 'general',
  enabled: true,
}
```

3. Restart the backend — the skill is auto-seeded into MongoDB.

---

## npm version pinning policy

All dependencies in this project are pinned to exact versions (no `^` or `~`). Both `backend/` and `frontend/` have an `.npmrc` with `save-exact=true` enforcing this for future installs.

**Why:** The company artifact repository mirrors npm with a 2-day propagation delay. Range specifiers like `^1.2.3` resolve to the latest available version at install time, which may be a package published within the last 2 days and not yet in the mirror — causing install failures.

**When upgrading a dependency:**
1. Check the publish date: `npm view <package>@<version> time --json`
2. Confirm the version was published more than 2 days ago
3. Update the exact version in `package.json` manually
4. Run `npm install` to update `package-lock.json`
5. Commit both files

Always commit `package-lock.json`. CI should use `npm ci`, not `npm install`.

---

## Environment variable reference

### Required

| Variable | Description |
|---|---|
| `MONGODB_URI` | MongoDB Atlas connection string |
| `MONGODB_DB` | Database name (default: `ai_workbench`) |
| `LLM_MODEL` | Model name (ignored when `LLM_PROVIDER=azure`) |
| `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` | API key for your LLM provider |

### Azure OpenAI (set `LLM_PROVIDER=azure`)

| Variable | Description |
|---|---|
| `AZURE_OPENAI_API_KEY` | Azure API key |
| `AZURE_OPENAI_INSTANCE_NAME` | Resource name (not the full URL) |
| `AZURE_OPENAI_DEPLOYMENT` | Deployment name from Azure AI Studio |
| `AZURE_OPENAI_API_VERSION` | API version (default: `2024-02-01`) |

### Optional

| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | _(openai-compatible)_ | Set to `azure` for Azure OpenAI |
| `LLM_BASE_URL` | _(direct)_ | LiteLLM proxy or Ollama base URL |
| `EMBEDDING_MODEL` | `text-embedding-3-small` | Model for RAG embeddings |
| `EMBEDDING_BASE_URL` | _(uses LLM_BASE_URL)_ | Separate base URL for embeddings |
| `EMBEDDING_API_KEY` | _(uses OPENAI_API_KEY)_ | Separate key for embeddings |
| `MONGODB_VECTOR_INDEX` | `rag_vector_index` | Atlas Vector Search index name |
| `RAG_CHUNK_SIZE` | `800` | Token size per RAG chunk |
| `RAG_CHUNK_OVERLAP` | `100` | Overlap between chunks |
| `RAG_SEED_DOCS` | `true` | Seed sample docs on startup |
| `MCP_FILESYSTEM_ROOT` | `/tmp/ai-workbench-files` | Filesystem MCP root directory |
| `LANGCHAIN_TRACING_V2` | `false` | Enable LangSmith tracing |
| `LANGCHAIN_API_KEY` | — | LangSmith API key |
| `LANGCHAIN_PROJECT` | `ai-workbench-dev` | LangSmith project name |
| `MEMORY_EXTRACTION_ENABLED` | `true` | Extract long-term memory from conversations |
| `PORT` | `3001` | Backend port |
| `CORS_ORIGIN` | `http://localhost:3000` | Frontend origin for CORS |

---

## Troubleshooting

**`npm ci` fails with `ENOTFOUND` or `E404`**
The package is not yet in the company artifact mirror. Wait until the version is at least 2 days old, or pin to an older version that is already mirrored.

**Backend starts but agent returns errors**
Check that your LLM API key is valid and the model name matches what your provider expects. For Azure, verify the deployment name and instance name are correct.

**RAG search returns no results**
The Atlas Vector Search index may not be created or may still be building. Check Atlas → Search → your index status. Also confirm `MONGODB_VECTOR_INDEX` matches the index name exactly.

**`Skill "X" not found`**
The skill wasn't seeded. Check backend startup logs for `Seeded skill:` lines. If missing, the `starter-skills.ts` entry may have a typo in the name field.

**Agent doesn't render UI components**
Open browser DevTools → Network → filter by `stream`. Look for `"type":"ui_component"` events in the SSE response. If events are present but nothing renders, check the `COMPONENT_REGISTRY` in `frontend/src/components/ui-components/index.tsx` has an entry for that `componentType`.
