import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Brain, Plus, Trash2, RefreshCw, User, Tag, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatDate } from '@/lib/utils';
import { memoryApi } from '@/api/client';
import type { MemoryFact, MemoryEntity } from '@/types';

const USER_ID = 'user1';

const ENTITY_COLORS: Record<string, string> = {
  person: 'bg-blue-100 text-blue-800',
  project: 'bg-violet-100 text-violet-800',
  company: 'bg-amber-100 text-amber-800',
  product: 'bg-green-100 text-green-800',
  location: 'bg-rose-100 text-rose-800',
  other: 'bg-gray-100 text-gray-800',
};

function EntityCard({ entity, onDelete }: { entity: MemoryEntity; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const colorClass = ENTITY_COLORS[entity.entityType] ?? ENTITY_COLORS.other;
  const attrs = Object.entries(entity.attributes ?? {});

  return (
    <div className="border rounded-xl bg-white overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colorClass}`}>
          {entity.entityType}
        </span>
        <span className="font-medium text-sm flex-1">{entity.name}</span>
        <button
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          {attrs.length} attr{attrs.length !== 1 ? 's' : ''}
        </button>
        <button onClick={onDelete} className="p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {open && (
        <div className="border-t px-4 py-3 bg-gray-50 space-y-3">
          {attrs.length > 0 && (
            <div className="grid grid-cols-2 gap-2 text-xs">
              {attrs.map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted-foreground">{k}: </span>
                  <span className="font-medium">{String(v)}</span>
                </div>
              ))}
            </div>
          )}
          {entity.mentions?.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Mentions</p>
              <div className="space-y-1">
                {entity.mentions.slice(-3).map((m, i) => (
                  <p key={i} className="text-xs text-muted-foreground italic">"{m}"</p>
                ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">Added {formatDate(entity.createdAt)}</p>
        </div>
      )}
    </div>
  );
}

export function MemoryPage() {
  const qc = useQueryClient();
  const [showAddFact, setShowAddFact] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const { data: facts = [], isLoading: factsLoading } = useQuery<MemoryFact[]>({
    queryKey: ['memory-facts', USER_ID],
    queryFn: () => memoryApi.getFacts(USER_ID),
  });

  const { data: entities = [], isLoading: entitiesLoading } = useQuery<MemoryEntity[]>({
    queryKey: ['memory-entities', USER_ID],
    queryFn: () => memoryApi.getEntities(USER_ID),
  });

  const { data: context } = useQuery({
    queryKey: ['memory-context', USER_ID],
    queryFn: () => memoryApi.getContext(USER_ID),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['memory-facts', USER_ID] });
    qc.invalidateQueries({ queryKey: ['memory-entities', USER_ID] });
    qc.invalidateQueries({ queryKey: ['memory-context', USER_ID] });
  };

  const addFactMutation = useMutation({
    mutationFn: () => memoryApi.upsertFact({ userId: USER_ID, key: newKey, value: newValue }),
    onSuccess: () => { setShowAddFact(false); setNewKey(''); setNewValue(''); invalidate(); },
  });

  const deleteFactMutation = useMutation({
    mutationFn: (key: string) => memoryApi.deleteFact(USER_ID, key),
    onSuccess: invalidate,
  });

  const deleteEntityMutation = useMutation({
    mutationFn: ({ entityType, name }: { entityType: string; name: string }) =>
      memoryApi.deleteEntity(USER_ID, entityType, name),
    onSuccess: invalidate,
  });

  const clearAllMutation = useMutation({
    mutationFn: () => memoryApi.clearAll(USER_ID),
    onSuccess: invalidate,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-3 flex items-center gap-4">
        <Brain className="w-4 h-4 text-primary" />
        <h1 className="font-semibold text-sm">Memory</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <User className="w-3 h-3" /> {USER_ID}
        </div>
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={() => { if (confirm('Clear ALL memory for this user?')) clearAllMutation.mutate(); }}
            disabled={clearAllMutation.isPending}
          >
            <Trash2 className="w-3.5 h-3.5" /> Clear All
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        <Tabs defaultValue="facts">
          <TabsList>
            <TabsTrigger value="facts">
              Facts <Badge variant="secondary" className="ml-1.5 text-[10px]">{facts.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="entities">
              Entities <Badge variant="secondary" className="ml-1.5 text-[10px]">{entities.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="context">System Prompt</TabsTrigger>
          </TabsList>

          {/* Facts */}
          <TabsContent value="facts" className="mt-4 space-y-3">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setShowAddFact(true)}>
                <Plus className="w-3.5 h-3.5" /> Add Fact
              </Button>
            </div>

            {factsLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-12 rounded-lg bg-muted animate-pulse" />)}</div>
            ) : facts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No facts stored yet. They&apos;ll appear here after conversations.</p>
            ) : (
              <div className="space-y-2">
                {facts.map(fact => (
                  <div key={fact._id} className="flex items-center gap-3 px-4 py-3 rounded-xl border bg-white group">
                    <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="text-xs font-mono font-semibold text-muted-foreground w-36 flex-shrink-0 truncate">{fact.key}</span>
                    <span className="text-sm flex-1">{fact.value}</span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {fact.source === 'auto' && (
                        <Badge variant="secondary" className="text-[10px] py-0">auto</Badge>
                      )}
                      <span className="text-[10px] text-muted-foreground">{Math.round(fact.confidence * 100)}%</span>
                      <button
                        onClick={() => deleteFactMutation.mutate(fact.key)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Entities */}
          <TabsContent value="entities" className="mt-4">
            {entitiesLoading ? (
              <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />)}</div>
            ) : entities.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-10">No entities extracted yet. Mention people, projects, or companies in chat.</p>
            ) : (
              <div className="space-y-2">
                {entities.map(entity => (
                  <EntityCard
                    key={entity._id}
                    entity={entity}
                    onDelete={() => deleteEntityMutation.mutate({ entityType: entity.entityType, name: entity.name })}
                  />
                ))}
              </div>
            )}
          </TabsContent>

          {/* Context preview */}
          <TabsContent value="context" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">System Prompt Fragment</CardTitle>
                <CardDescription className="text-xs">This is injected into every agent run for {USER_ID}.</CardDescription>
              </CardHeader>
              <CardContent>
                {context?.systemFragment ? (
                  <pre className="text-xs bg-muted rounded-lg p-4 whitespace-pre-wrap font-mono leading-relaxed">
                    {context.systemFragment}
                  </pre>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">No memory context yet.</p>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Add fact dialog */}
      <Dialog open={showAddFact} onOpenChange={setShowAddFact}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader><DialogTitle>Add Memory Fact</DialogTitle></DialogHeader>
          <div className="space-y-3 p-6 pt-2">
            <div className="space-y-1">
              <label className="text-xs font-medium">Key</label>
              <Input placeholder="preferred_tone" className="text-sm font-mono" value={newKey} onChange={e => setNewKey(e.target.value)} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Value</label>
              <Input placeholder="concise and technical" className="text-sm" value={newValue} onChange={e => setNewValue(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddFact(false)}>Cancel</Button>
            <Button onClick={() => addFactMutation.mutate()} disabled={!newKey || !newValue || addFactMutation.isPending}>
              {addFactMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
