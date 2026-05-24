import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Layout } from './components/Layout';
import { UserSelector } from './components/UserSelector';
import { ChatPage } from './pages/ChatPage';
import { RagPage } from './pages/RagPage';
import { RunsPage } from './pages/RunsPage';
import { McpPage } from './pages/McpPage';
import { MemoryPage } from './pages/MemoryPage';
import { SkillsPage } from './pages/SkillsPage';
import { useUserStore } from './store/userStore';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

function AppRoutes() {
  const currentUser = useUserStore((s) => s.currentUser);

  if (!currentUser) {
    return <UserSelector />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<ChatPage />} />
          <Route path="rag" element={<RagPage />} />
          <Route path="runs" element={<RunsPage />} />
          <Route path="mcp" element={<McpPage />} />
          <Route path="memory" element={<MemoryPage />} />
          <Route path="skills" element={<SkillsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>
  );
}
