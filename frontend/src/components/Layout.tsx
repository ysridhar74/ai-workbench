import { NavLink, Outlet } from 'react-router-dom';
import { cn } from '@/lib/utils';
import {
  MessageSquare, Database, History, Server, Brain, Zap,
} from 'lucide-react';

const NAV = [
  { to: '/', label: 'Chat', icon: MessageSquare, end: true },
  { to: '/rag', label: 'Knowledge Base', icon: Database },
  { to: '/runs', label: 'Run History', icon: History },
  { to: '/mcp', label: 'MCP Servers', icon: Server },
  { to: '/memory', label: 'Memory', icon: Brain },
];

export function Layout() {
  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 border-r bg-white flex flex-col">
        {/* Logo */}
        <div className="px-5 py-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-primary flex items-center justify-center">
              <Zap className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold leading-none">AI Workbench</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">v1.0 · local</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-5 py-3 border-t">
          <p className="text-[11px] text-muted-foreground">Backend: localhost:3001</p>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
