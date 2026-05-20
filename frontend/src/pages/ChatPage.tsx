import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Square, ChevronDown, ChevronRight, Wrench, Database, Bot, User, Sparkles } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { skillsApi, streamAgent } from '@/api/client';
import type { ChatMessage, ToolStep, Skill } from '@/types';

// ── Tool step trace component ────────────────────────────────────────────────

function ToolTrace({ steps, ragChunksUsed }: { steps: ToolStep[]; ragChunksUsed?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [openStep, setOpenStep] = useState<number | null>(null);

  if (!steps || steps.length === 0) return null;

  return (
    <div className="mt-2 rounded-lg border bg-muted/40 text-xs overflow-hidden">
      <button
        className="w-full flex items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <Wrench className="w-3 h-3" />
        <span className="font-medium">{steps.length} tool call{steps.length > 1 ? 's' : ''}</span>
        {ragChunksUsed != null && ragChunksUsed > 0 && (
          <span className="ml-1 flex items-center gap-1 text-blue-600">
            <Database className="w-3 h-3" /> {ragChunksUsed} RAG
          </span>
        )}
        <span className="ml-auto opacity-50">{expanded ? 'hide' : 'show'} trace</span>
      </button>

      {expanded && (
        <div className="border-t divide-y">
          {steps.map((step, i) => {
            const isRag = step.tool === 'search_knowledge_base';
            const isOpen = openStep === i;
            return (
              <div key={i} className="bg-white">
                <button
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                  onClick={() => setOpenStep(isOpen ? null : i)}
                >
                  {isOpen ? <ChevronDown className="w-3 h-3 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 flex-shrink-0" />}
                  <span className={cn(
                    'font-mono font-semibold',
                    isRag ? 'text-blue-600' : 'text-violet-600',
                  )}>
                    {step.tool}
                  </span>
                  {isRag && <Badge variant="secondary" className="text-[10px] py-0 h-4">RAG</Badge>}
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Input</p>
                      <pre className="bg-muted rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap">
                        {typeof step.input === 'string' ? step.input : JSON.stringify(step.input, null, 2)}
                      </pre>
                    </div>
                    {step.output && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1">Output</p>
                        <pre className="bg-muted rounded p-2 text-[11px] overflow-x-auto whitespace-pre-wrap max-h-48">
                          {step.output.slice(0, 1200)}{step.output.length > 1200 ? '\n…(truncated)' : ''}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Live streaming tool indicator ────────────────────────────────────────────

function LiveToolBadge({ tool }: { tool: string | null }) {
  if (!tool) return null;
  const isRag = tool === 'search_knowledge_base';
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground animate-fade-in">
      {isRag ? <Database className="w-3 h-3 text-blue-500 animate-pulse" /> : <Wrench className="w-3 h-3 text-violet-500 animate-pulse" />}
      <span className="font-mono">{tool}</span>
      <span className="opacity-60">running…</span>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  return (
    <div className={cn('flex gap-3 animate-fade-in', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      <div className={cn(
        'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold',
        isUser ? 'bg-slate-700' : 'bg-primary',
      )}>
        {isUser ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
      </div>

      {/* Content */}
      <div className={cn('max-w-[80%] space-y-1', isUser ? 'items-end flex flex-col' : '')}>
        <div className={cn(
          'rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : 'bg-white border shadow-sm rounded-tl-sm',
        )}>
          {msg.isStreaming && !msg.content ? (
            <span className="flex gap-1 items-center h-5">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          ) : (
            <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                code: ({ children, className }) => {
                  const isBlock = className?.includes('language-');
                  return isBlock
                    ? <pre className="bg-muted rounded p-3 overflow-x-auto text-xs my-2"><code>{children}</code></pre>
                    : <code className="bg-muted rounded px-1 py-0.5 text-xs font-mono">{children}</code>;
                },
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              }}
            >
              {msg.content}
            </ReactMarkdown>
            </div>
          )}
        </div>

        {/* Metrics row */}
        {msg.metrics && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground px-1">
            <span>{msg.metrics.durationMs ? `${(msg.metrics.durationMs / 1000).toFixed(1)}s` : ''}</span>
            {msg.metrics.totalTokens > 0 && <span>{msg.metrics.totalTokens} tokens</span>}
            {msg.metrics.costUsd > 0 && <span>${msg.metrics.costUsd.toFixed(5)}</span>}
            {msg.runId && <span className="font-mono opacity-50">{msg.runId.slice(0, 8)}</span>}
          </div>
        )}

        {/* Tool trace */}
        {!isUser && msg.steps && (
          <div className="w-full">
            <ToolTrace steps={msg.steps} ragChunksUsed={msg.ragChunksUsed} />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Chat Page ─────────────────────────────────────────────────────────────────

const USER_ID = 'user1'; // TODO: real auth

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedSkill, setSelectedSkill] = useState('general-assistant');
  const [useRag, setUseRag] = useState(true);
  const [useTools, setUseTools] = useState(true);
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: skills = [] } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: skillsApi.list,
  });

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const addMessage = useCallback((msg: ChatMessage) => {
    setMessages(prev => [...prev, msg]);
  }, []);

  const updateLastAssistant = useCallback((updater: (msg: ChatMessage) => ChatMessage) => {
    setMessages(prev => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (copy[i].role === 'assistant') { copy[i] = updater(copy[i]); break; }
      }
      return copy;
    });
  }, []);

  const handleSubmit = useCallback(() => {
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput('');
    setIsStreaming(true);
    setActiveTool(null);

    // Add user message
    const userMsg: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text };
    addMessage(userMsg);

    // Add empty assistant placeholder
    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId, role: 'assistant', content: '', isStreaming: true, steps: [],
    };
    addMessage(assistantMsg);

    // Build history (exclude the placeholder)
    const history = messages.map(m => ({ role: m.role, content: m.content }));

    const pendingSteps: { tool: string; input: unknown; output: string }[] = [];

    const stop = streamAgent(
      { message: text, skill: selectedSkill, userId: USER_ID, history, useRag, useTools },
      {
        onChunk: (chunk) => {
          updateLastAssistant(m => ({ ...m, content: m.content + chunk }));
        },
        onToolCall: (tool, toolInput) => {
          setActiveTool(tool);
          pendingSteps.push({ tool, input: toolInput, output: '' });
        },
        onToolResult: (tool, output) => {
          setActiveTool(null);
          const idx = [...pendingSteps].reverse().findIndex(s => s.tool === tool && s.output === '');
          if (idx !== -1) pendingSteps[pendingSteps.length - 1 - idx].output = output;
          updateLastAssistant(m => ({ ...m, steps: [...pendingSteps] }));
        },
        onDone: (data) => {
          setIsStreaming(false);
          setActiveTool(null);
          updateLastAssistant(m => ({
            ...m,
            isStreaming: false,
            runId: data.runId,
            toolCallCount: data.toolCallCount,
            ragChunksUsed: data.ragChunksUsed,
            metrics: {
              inputTokens: 0,
              outputTokens: 0,
              totalTokens: 0,
              costUsd: data.metrics.costUsd,
              durationMs: data.metrics.durationMs,
              summary: data.metrics.summary,
            },
            steps: [...pendingSteps],
          }));
        },
        onError: (err) => {
          setIsStreaming(false);
          setActiveTool(null);
          updateLastAssistant(m => ({
            ...m, isStreaming: false, content: m.content || `Error: ${err}`,
          }));
        },
      },
    );
    stopRef.current = stop;
  }, [input, isStreaming, messages, selectedSkill, useRag, useTools, addMessage, updateLastAssistant]);

  const handleStop = () => {
    stopRef.current?.();
    setIsStreaming(false);
    setActiveTool(null);
    updateLastAssistant(m => ({ ...m, isStreaming: false }));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(); }
  };

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h1 className="font-semibold text-sm">Agent Chat</h1>
        </div>

        <div className="flex items-center gap-3 ml-auto">
          {/* Skill selector */}
          <Select value={selectedSkill} onValueChange={setSelectedSkill}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Select skill" />
            </SelectTrigger>
            <SelectContent>
              {skills.map(s => (
                <SelectItem key={s.name} value={s.name}>{s.name}</SelectItem>
              ))}
              {skills.length === 0 && (
                <SelectItem value="general-assistant">general-assistant</SelectItem>
              )}
            </SelectContent>
          </Select>

          {/* RAG toggle */}
          <button
            onClick={() => setUseRag(v => !v)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors',
              useRag ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-muted border-border text-muted-foreground',
            )}
          >
            <Database className="w-3 h-3" />
            RAG {useRag ? 'on' : 'off'}
          </button>

          {/* Tools toggle */}
          <button
            onClick={() => setUseTools(v => !v)}
            className={cn(
              'flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border transition-colors',
              useTools ? 'bg-violet-50 border-violet-200 text-violet-700' : 'bg-muted border-border text-muted-foreground',
            )}
          >
            <Wrench className="w-3 h-3" />
            Tools {useTools ? 'on' : 'off'}
          </button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 px-6 py-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-24 text-center">
            <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
              <Sparkles className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold mb-1">How can I help?</h2>
            <p className="text-sm text-muted-foreground max-w-md">
              Ask anything. I can search your knowledge base, use tools, and remember context across sessions.
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center">
              {[
                'What is RAG and how does it work?',
                'List files in the workspace',
                'Summarize what you know about me',
              ].map(suggestion => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-muted transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-6 max-w-3xl mx-auto">
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}

          {/* Live tool indicator */}
          {activeTool && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-3">
                <LiveToolBadge tool={activeTool} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>

      {/* Input bar */}
      <div className="flex-shrink-0 bg-white border-t px-6 py-4">
        <div className="max-w-3xl mx-auto">
          <div className="flex gap-2 items-end">
            <div className="flex-1 relative">
              <Input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Message the agent… (Enter to send)"
                className="pr-4 py-3 h-auto text-sm resize-none"
                disabled={isStreaming}
              />
            </div>

            {isStreaming ? (
              <Button size="icon" variant="destructive" onClick={handleStop} className="flex-shrink-0">
                <Square className="w-4 h-4" />
              </Button>
            ) : (
              <Button size="icon" onClick={handleSubmit} disabled={!input.trim()} className="flex-shrink-0">
                <Send className="w-4 h-4" />
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Skill: <span className="font-medium">{selectedSkill}</span> · userId: <span className="font-mono">{USER_ID}</span>
          </p>
        </div>
      </div>
    </div>
  );
}
