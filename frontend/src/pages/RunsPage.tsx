import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, ChevronDown, History, Wrench, Database, Clock, Coins } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn, formatDate, formatDuration, formatCost, formatTokens } from '@/lib/utils';
import { runsApi, skillsApi } from '@/api/client';
import type { AgentRun, RunStats, ToolStep } from '@/types';

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StepRow({ step }: { step: ToolStep }) {
  const [open, setOpen] = useState(false);
  const isRag = step.tool === 'search_knowledge_base';
  return (
    <div className="border rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-muted/30 transition-colors"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        {isRag ? <Database className="w-3 h-3 text-blue-500" /> : <Wrench className="w-3 h-3 text-violet-500" />}
        <span className={cn('font-mono font-semibold', isRag ? 'text-blue-600' : 'text-violet-600')}>{step.tool}</span>
      </button>
      {open && (
        <div className="border-t px-3 py-2 space-y-2 bg-white text-xs">
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Input</p>
            <pre className="bg-muted rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap">
              {typeof step.input === 'string' ? step.input : JSON.stringify(step.input, null, 2)}
            </pre>
          </div>
          {step.output && (
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">Output</p>
              <pre className="bg-muted rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap max-h-40">
                {step.output.slice(0, 800)}{step.output.length > 800 ? '\n…' : ''}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RunRow({ run }: { run: AgentRun }) {
  const [expanded, setExpanded] = useState(false);
  const ragCalls = (run.steps || []).filter(s => s.tool === 'search_knowledge_base').length;

  return (
    <div className="border rounded-xl overflow-hidden bg-white animate-fade-in">
      <button
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/20 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="w-4 h-4 text-muted-foreground" /> : <ChevronRight className="w-4 h-4 text-muted-foreground" />}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <Badge variant="secondary" className="text-[10px] py-0">{run.skill}</Badge>
            {run.steps?.length > 0 && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Wrench className="w-2.5 h-2.5" />{run.steps.length} tool{run.steps.length > 1 ? 's' : ''}
              </span>
            )}
            {ragCalls > 0 && (
              <span className="text-[10px] text-blue-600 flex items-center gap-1">
                <Database className="w-2.5 h-2.5" />{ragCalls} RAG
              </span>
            )}
          </div>
          <p className="text-sm text-foreground truncate">{run.input}</p>
        </div>

        <div className="flex items-center gap-4 text-xs text-muted-foreground flex-shrink-0">
          <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{formatDuration(run.durationMs)}</span>
          {run.totalTokens > 0 && <span className="flex items-center gap-1"><Coins className="w-3 h-3" />{formatTokens(run.totalTokens)}</span>}
          <span>{formatDate(run.createdAt)}</span>
        </div>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-4 bg-gray-50">
          {/* Response */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Response</p>
            <div className="bg-white rounded-lg border p-3 text-sm leading-relaxed max-h-48 overflow-y-auto">
              {run.output || <span className="text-muted-foreground italic">No output</span>}
            </div>
          </div>

          {/* Steps */}
          {run.steps?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Tool Calls</p>
              <div className="space-y-2">
                {run.steps.map((step, i) => <StepRow key={i} step={step} />)}
              </div>
            </div>
          )}

          {/* Metadata */}
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>Model: <span className="font-mono text-foreground">{run.model}</span></span>
            {run.inputTokens > 0 && <span>↑ {run.inputTokens} / ↓ {run.outputTokens}</span>}
            {run.costUsd > 0 && <span>Cost: {formatCost(run.costUsd)}</span>}
            <span>ID: <span className="font-mono">{run.runId}</span></span>
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_SIZE = 20;

export function RunsPage() {
  const [skillFilter, setSkillFilter] = useState('');
  const [page, setPage] = useState(0);

  const { data: skills = [] } = useQuery({ queryKey: ['skills'], queryFn: skillsApi.list });

  const { data: statsData } = useQuery<RunStats>({
    queryKey: ['runs-stats'],
    queryFn: () => runsApi.stats(),
  });

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['runs', skillFilter, page],
    queryFn: () => runsApi.list({ skill: skillFilter || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  });

  const runs: AgentRun[] = runsData?.runs ?? [];
  const total: number = runsData?.total ?? 0;
  const stats = statsData;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-3 flex items-center gap-4">
        <History className="w-4 h-4 text-primary" />
        <h1 className="font-semibold text-sm">Run History</h1>
        <div className="ml-auto flex items-center gap-2">
          <Select value={skillFilter} onValueChange={v => { setSkillFilter(v); setPage(0); }}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="All skills" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All skills</SelectItem>
              {skills.map((s: { name: string }) => <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-4 gap-4">
            <StatCard label="Total Runs" value={String(stats.totalRuns)} />
            <StatCard label="Total Tokens" value={formatTokens(stats.totalTokens)} />
            <StatCard label="Total Cost" value={formatCost(stats.totalCostUsd)} />
            <StatCard label="Avg Duration" value={formatDuration(stats.avgDurationMs)} />
          </div>
        )}

        {/* Breakdowns */}
        {stats && (stats.bySkill.length > 0 || stats.byModel.length > 0) && (
          <div className="grid grid-cols-2 gap-4">
            {stats.bySkill.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs">By Skill</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {stats.bySkill.map(s => (
                    <div key={s.skill} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{s.skill}</span>
                      <div className="flex gap-3 text-muted-foreground">
                        <span>{s.count} runs</span>
                        <span>{formatCost(s.totalCostUsd)}</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
            {stats.byModel.length > 0 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-xs">By Model</CardTitle></CardHeader>
                <CardContent className="space-y-1.5">
                  {stats.byModel.map(m => (
                    <div key={m.model} className="flex items-center justify-between text-xs">
                      <span className="font-mono">{m.model ?? '—'}</span>
                      <div className="flex gap-3 text-muted-foreground">
                        <span>{m.count} runs</span>
                        <span>{formatTokens(m.totalTokens)} tok</span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Run list */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">{total} run{total !== 1 ? 's' : ''}</p>
          </div>

          {isLoading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-muted animate-pulse" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-12">No runs yet. Start a chat to see history here.</p>
          ) : (
            <div className="space-y-2">
              {runs.map(run => <RunRow key={run._id} run={run} />)}
            </div>
          )}

          {/* Pagination */}
          {total > PAGE_SIZE && (
            <div className="flex items-center justify-between mt-4">
              <Button variant="outline" size="sm" onClick={() => setPage(p => p - 1)} disabled={page === 0}>Previous</Button>
              <span className="text-xs text-muted-foreground">Page {page + 1} of {Math.ceil(total / PAGE_SIZE)}</span>
              <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={(page + 1) * PAGE_SIZE >= total}>Next</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
