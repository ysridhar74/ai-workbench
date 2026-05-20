import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { ChatPage } from './pages/ChatPage';
import { RagPage } from './pages/RagPage';
import { RunsPage } from './pages/RunsPage';
import { McpPage } from './pages/McpPage';
import { MemoryPage } from './pages/MemoryPage';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<ChatPage />} />
            <Route path="rag" element={<RagPage />} />
            <Route path="runs" element={<RunsPage />} />
            <Route path="mcp" element={<McpPage />} />
            <Route path="memory" element={<MemoryPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
