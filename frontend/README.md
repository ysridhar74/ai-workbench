# AI Workbench — Frontend

React + TypeScript + Vite chat interface for the AI Workbench platform.

For full setup instructions see the [root README](../README.md).

## Quick start

```bash
npm ci
npm run dev       # http://localhost:3000
```

## Build for production

```bash
npm run build     # output to dist/
npm run preview   # preview the production build locally
```

## Key directories

```
src/
  api/            HTTP + SSE client (streamAgent, chat endpoints)
  components/
    ui-components/  Generative UI component registry (BarChart, DataTable, etc.)
  pages/          ChatPage, SkillsPage, RAGPage, MemoryPage
  types/          Shared TypeScript interfaces
```

## Adding a new generative UI component

1. Add a renderer function in `src/components/ui-components/index.tsx`
2. Register it in `COMPONENT_REGISTRY` with the same key the backend emits as `componentType`
3. The backend `UiRendererService` must have a matching `ui_render_*` tool that calls `emit('YourComponentType', props)`
