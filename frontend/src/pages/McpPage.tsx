import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Server, Plus, RefreshCw, Wifi, WifiOff, Trash2, RotateCcw, ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { mcpApi } from '@/api/client';
import type { McpServerStatus, McpTool } from '@/types';

function ServerCard({ server, onDisconnect, onReconnect }: {
  server: McpServerStatus;
  onDisconnect: (name: string) => void;
  onReconnect: (name: string) => void;
}) {
  const [showTools, setShowTools] = useState(false);
  const { data: allTools = [] } = useQuery<McpTool[]>({ queryKey: ['mcp-tools'], queryFn: mcpApi.listTools });
  const serverTools = allTools.filter(t => t.server === server.name);

  return (
    <Card className={cn(!server.connected && 'opacity-75')}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={cn(
              'w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0',
              server.connected ? 'bg-green-100' : 'bg-muted',
            )}>
              {server.connected
                ? <Wifi className="w-4 h-4 text-green-600" />
                : <WifiOff className="w-4 h-4 text-muted-foreground" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-semibold text-sm">{server.name}</p>
                <Badge variant={server.connected ? 'success' : 'outline'} className="text-[10px]">
                  {server.connected ? 'connected' : 'disconnected'}
                </Badge>
                <Badge variant="secondary" className="text-[10px] font-mono">{server.transport}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{server.description}</p>
              {server.url && <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{server.url}</p>}
              {server.command && <p className="text-xs font-mono text-muted-foreground mt-0.5">{server.command}</p>}
              {server.error && <p className="text-xs text-destructive mt-1">{server.error}</p>}
            </div>
          </div>

          <div className="flex gap-1 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onReconnect(server.name)} title="Reconnect">
              <RotateCcw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 hover:text-destructive" onClick={() => onDisconnect(server.name)} title="Disconnect">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>

        {/* Tools */}
        {serverTools.length > 0 && (
          <div className="mt-3">
            <button
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setShowTools(v => !v)}
            >
              {showTools ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              <Wrench className="w-3 h-3" />
              {server.toolCount} tool{server.toolCount !== 1 ? 's' : ''}
            </button>
            {showTools && (
              <div className="mt-2 space-y-1">
                {serverTools.map(tool => (
                  <div key={tool.name} className="flex items-start gap-2 px-2 py-1.5 rounded-md bg-muted/50 text-xs">
                    <span className="font-mono font-medium text-violet-600 flex-shrink-0">{tool.name.replace(`${server.name}__`, '')}</span>
                    <span className="text-muted-foreground line-clamp-1">{tool.description.replace(`[${server.name}] `, '').split('. Input')[0]}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function McpPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', transport: 'streamable-http', url: '', command: '', args: '', token: '' });

  const { data: servers = [], isLoading } = useQuery<McpServerStatus[]>({
    queryKey: ['mcp-servers'],
    queryFn: mcpApi.listServers,
    refetchInterval: 10_000,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['mcp-servers'] });
    qc.invalidateQueries({ queryKey: ['mcp-tools'] });
  };

  const reloadMutation = useMutation({
    mutationFn: mcpApi.reload,
    onSuccess: invalidate,
  });

  const disconnectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.disconnectServer(name),
    onSuccess: invalidate,
  });

  const reconnectMutation = useMutation({
    mutationFn: (name: string) => mcpApi.reconnectServer(name),
    onSuccess: invalidate,
  });

  const connectMutation = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: form.name,
        description: form.description,
        transport: form.transport,
      };
      if (form.transport === 'stdio') {
        body.command = form.command;
        body.args = form.args.split(' ').filter(Boolean);
      } else {
        body.url = form.url;
        if (form.token) body.headers = { Authorization: `Bearer ${form.token}` };
      }
      return mcpApi.connectServer(body);
    },
    onSuccess: () => { setShowAdd(false); invalidate(); },
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [key]: e.target.value })),
  });

  const totalTools = servers.reduce((acc, s) => acc + s.toolCount, 0);
  const connected = servers.filter(s => s.connected).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-3 flex items-center gap-4">
        <Server className="w-4 h-4 text-primary" />
        <h1 className="font-semibold text-sm">MCP Servers</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{connected}/{servers.length} connected · {totalTools} tools</span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => reloadMutation.mutate()} disabled={reloadMutation.isPending}>
            <RefreshCw className={cn('w-3.5 h-3.5', reloadMutation.isPending && 'animate-spin')} />
            Reload Config
          </Button>
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="w-3.5 h-3.5" /> Add Server
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center py-16">
            <Server className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No MCP servers configured</p>
            <p className="text-xs text-muted-foreground mt-1">Add a server or edit config/mcp-servers.json and reload.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {servers.map(server => (
              <ServerCard
                key={server.name}
                server={server}
                onDisconnect={(name) => disconnectMutation.mutate(name)}
                onReconnect={(name) => reconnectMutation.mutate(name)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Add server dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Connect MCP Server</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 p-6 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium">Name</label>
                <Input placeholder="my-server" className="text-sm" {...field('name')} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium">Transport</label>
                <Select value={form.transport} onValueChange={v => setForm(f => ({ ...f, transport: v }))}>
                  <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                    <SelectItem value="sse">SSE (legacy)</SelectItem>
                    <SelectItem value="stdio">stdio (local)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium">Description</label>
              <Input placeholder="What does this server do?" className="text-sm" {...field('description')} />
            </div>

            {form.transport !== 'stdio' ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium">URL</label>
                  <Input placeholder="http://my-server:8080/mcp" className="text-sm font-mono" {...field('url')} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Bearer Token (optional)</label>
                  <Input placeholder="sk-..." type="password" className="text-sm font-mono" {...field('token')} />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Command</label>
                  <Input placeholder="npx" className="text-sm font-mono" {...field('command')} />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Args (space separated)</label>
                  <Input placeholder="-y @modelcontextprotocol/server-filesystem /tmp" className="text-sm font-mono" {...field('args')} />
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={() => connectMutation.mutate()} disabled={!form.name || connectMutation.isPending}>
              {connectMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
