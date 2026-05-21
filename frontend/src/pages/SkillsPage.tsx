import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Sparkles, Plus, Pencil, Power, PowerOff, RefreshCw, ChevronDown, ChevronRight,
  Cpu, Tag, AlignLeft, Wrench, Save, X, Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { skillsApi } from '@/api/client';
import type { Skill } from '@/types';

const MODELS = [
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-haiku-4-5',
];

const CATEGORIES = ['general', 'productivity', 'research', 'coding', 'data', 'custom'];

const CATEGORY_COLORS: Record<string, string> = {
  general:      'bg-blue-100 text-blue-700',
  productivity: 'bg-violet-100 text-violet-700',
  research:     'bg-amber-100 text-amber-700',
  coding:       'bg-green-100 text-green-700',
  data:         'bg-cyan-100 text-cyan-700',
  custom:       'bg-rose-100 text-rose-700',
};

interface SkillFormState {
  name: string;
  description: string;
  promptTemplate: string;
  preferredModel: string;
  category: string;
  enabled: boolean;
}

const EMPTY_FORM: SkillFormState = {
  name: '',
  description: '',
  promptTemplate: '',
  preferredModel: 'gpt-4o-mini',
  category: 'general',
  enabled: true,
};

// ── Skill card ───────────────────────────────────────────────────────────────

function SkillCard({
  skill,
  onEdit,
  onToggle,
  onDuplicate,
}: {
  skill: Skill;
  onEdit: () => void;
  onToggle: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const colorClass = CATEGORY_COLORS[skill.category] ?? CATEGORY_COLORS.custom;

  return (
    <Card className={cn('transition-opacity', !skill.enabled && 'opacity-60')}>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className={cn(
            'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
            skill.enabled ? 'bg-primary/10' : 'bg-muted',
          )}>
            <Sparkles className={cn('w-4 h-4', skill.enabled ? 'text-primary' : 'text-muted-foreground')} />
          </div>

          {/* Main info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-sm">{skill.name}</p>
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full', colorClass)}>
                {skill.category}
              </span>
              {!skill.enabled && (
                <Badge variant="outline" className="text-[10px]">disabled</Badge>
              )}
              {skill.preferredModel && (
                <span className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                  <Cpu className="w-3 h-3" />{skill.preferredModel}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{skill.description}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 flex-shrink-0">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDuplicate} title="Duplicate">
              <Copy className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit} title="Edit">
              <Pencil className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-7 w-7', skill.enabled ? 'hover:text-destructive' : 'hover:text-green-600')}
              onClick={onToggle}
              title={skill.enabled ? 'Disable' : 'Enable'}
            >
              {skill.enabled
                ? <PowerOff className="w-3.5 h-3.5" />
                : <Power className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* Expandable prompt preview */}
        <div className="mt-3">
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <AlignLeft className="w-3 h-3" />
            Prompt template
          </button>
          {expanded && (
            <pre className="mt-2 text-[11px] bg-muted rounded-lg p-3 whitespace-pre-wrap font-mono leading-relaxed max-h-48 overflow-y-auto">
              {skill.promptTemplate}
            </pre>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ── Skill form dialog ─────────────────────────────────────────────────────────

function SkillDialog({
  open,
  onClose,
  initial,
  isEdit,
  onSave,
  isSaving,
}: {
  open: boolean;
  onClose: () => void;
  initial: SkillFormState;
  isEdit: boolean;
  onSave: (form: SkillFormState) => void;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<SkillFormState>(initial);

  // Reset when dialog opens
  if (!open) return null;

  const set = (key: keyof SkillFormState) => (val: string | boolean) =>
    setForm(f => ({ ...f, [key]: val }));

  const isValid = form.name.trim() && form.description.trim() && form.promptTemplate.trim();

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit Skill' : 'Create Skill'}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 px-1 py-2">
          {/* Name + Category row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium flex items-center gap-1">
                <Tag className="w-3 h-3" /> Name
              </label>
              <Input
                placeholder="my-skill"
                className="text-sm font-mono"
                value={form.name}
                onChange={e => set('name')(e.target.value)}
                disabled={isEdit} // name is the identifier, can't change it
              />
              {isEdit && <p className="text-[10px] text-muted-foreground">Name cannot be changed after creation.</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Category</label>
              <Select value={form.category} onValueChange={set('category') as (v: string) => void}>
                <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-medium">Description</label>
            <Input
              placeholder="What does this skill do?"
              className="text-sm"
              value={form.description}
              onChange={e => set('description')(e.target.value)}
            />
          </div>

          {/* Model */}
          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1">
              <Cpu className="w-3 h-3" /> Preferred Model
            </label>
            <Select value={form.preferredModel || 'default'} onValueChange={v => set('preferredModel')(v === 'default' ? '' : v)}>
              <SelectTrigger className="text-sm font-mono"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Use server default</SelectItem>
                {MODELS.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Prompt template */}
          <div className="space-y-1">
            <label className="text-xs font-medium flex items-center gap-1">
              <AlignLeft className="w-3 h-3" /> System Prompt Template
            </label>
            <textarea
              value={form.promptTemplate}
              onChange={e => set('promptTemplate')(e.target.value)}
              placeholder={`You are a helpful assistant specialised in...\n\nGuidelines:\n- Be concise\n- ...`}
              className="w-full h-56 rounded-md border border-input bg-background px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-ring leading-relaxed"
            />
            <p className="text-[10px] text-muted-foreground">
              Use {'{{variable}}'} for dynamic substitution. The memory context is automatically appended.
            </p>
          </div>

          {/* Tools hint */}
          <div className="rounded-lg bg-muted/50 border px-3 py-2 flex items-start gap-2">
            <Wrench className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              MCP tools and RAG are toggled per-request from the Chat screen — not per skill.
              The agent will use whichever tools are active when you send a message.
            </p>
          </div>
        </div>

        <DialogFooter className="pt-2 border-t">
          <Button variant="outline" onClick={onClose}>
            <X className="w-4 h-4" /> Cancel
          </Button>
          <Button onClick={() => onSave(form)} disabled={!isValid || isSaving}>
            {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Save Changes' : 'Create Skill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Skills page ───────────────────────────────────────────────────────────────

export function SkillsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('__all__');
  const [showDisabled, setShowDisabled] = useState(false);

  const { data: allSkills = [], isLoading } = useQuery<Skill[]>({
    queryKey: ['skills-all'],
    queryFn: skillsApi.listAll,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['skills-all'] });
    qc.invalidateQueries({ queryKey: ['skills'] });
  };

  const createMutation = useMutation({
    mutationFn: (form: SkillFormState) => skillsApi.create({
      name: form.name.trim(),
      description: form.description.trim(),
      promptTemplate: form.promptTemplate.trim(),
      preferredModel: form.preferredModel || undefined,
      category: form.category,
      enabled: form.enabled,
    }),
    onSuccess: () => { setShowCreate(false); invalidate(); },
  });

  const updateMutation = useMutation({
    mutationFn: ({ name, form }: { name: string; form: SkillFormState }) =>
      skillsApi.update(name, {
        description: form.description.trim(),
        promptTemplate: form.promptTemplate.trim(),
        preferredModel: form.preferredModel || undefined,
        category: form.category,
        enabled: form.enabled,
      }),
    onSuccess: () => { setEditingSkill(null); invalidate(); },
  });

  const toggleMutation = useMutation({
    mutationFn: (skill: Skill) =>
      skillsApi.update(skill.name, { enabled: !skill.enabled }),
    onSuccess: invalidate,
  });

  // Filter
  const filtered = allSkills.filter(s => {
    if (!showDisabled && !s.enabled) return false;
    if (categoryFilter !== '__all__' && s.category !== categoryFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return s.name.includes(q) || s.description.toLowerCase().includes(q);
    }
    return true;
  });

  const enabledCount = allSkills.filter(s => s.enabled).length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-3 flex items-center gap-4">
        <Sparkles className="w-4 h-4 text-primary" />
        <h1 className="font-semibold text-sm">Skills</h1>
        <span className="text-xs text-muted-foreground">{enabledCount} enabled · {allSkills.length} total</span>

        <div className="ml-auto flex items-center gap-2">
          {/* Search */}
          <Input
            className="w-44 h-8 text-xs"
            placeholder="Search skills…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

          {/* Category filter */}
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All categories</SelectItem>
              {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>

          {/* Show disabled toggle */}
          <button
            onClick={() => setShowDisabled(v => !v)}
            className={cn(
              'text-xs px-2.5 py-1.5 rounded-md border transition-colors',
              showDisabled ? 'bg-muted border-border text-foreground' : 'bg-white border-border text-muted-foreground',
            )}
          >
            {showDisabled ? 'Hide disabled' : 'Show disabled'}
          </button>

          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5" /> New Skill
          </Button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Sparkles className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm font-medium">No skills found</p>
            <p className="text-xs text-muted-foreground mt-1">
              {allSkills.length === 0 ? 'Create your first skill to get started.' : 'Try adjusting the search or filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map(skill => (
              <SkillCard
                key={skill.name}
                skill={skill}
                onEdit={() => setEditingSkill(skill)}
                onToggle={() => toggleMutation.mutate(skill)}
                onDuplicate={() => {
                  setShowCreate(true);
                  // Pre-fill form via setTimeout to let dialog mount first
                  setTimeout(() => {}, 0);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create dialog */}
      {showCreate && (
        <SkillDialog
          open={showCreate}
          onClose={() => setShowCreate(false)}
          initial={EMPTY_FORM}
          isEdit={false}
          onSave={form => createMutation.mutate(form)}
          isSaving={createMutation.isPending}
        />
      )}

      {/* Edit dialog */}
      {editingSkill && (
        <SkillDialog
          open={!!editingSkill}
          onClose={() => setEditingSkill(null)}
          initial={{
            name: editingSkill.name,
            description: editingSkill.description,
            promptTemplate: editingSkill.promptTemplate,
            preferredModel: editingSkill.preferredModel ?? '',
            category: editingSkill.category ?? 'general',
            enabled: editingSkill.enabled,
          }}
          isEdit={true}
          onSave={form => updateMutation.mutate({ name: editingSkill.name, form })}
          isSaving={updateMutation.isPending}
        />
      )}
    </div>
  );
}
