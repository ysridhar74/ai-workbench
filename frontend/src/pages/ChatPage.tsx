import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Square, ChevronDown, ChevronRight, Wrench, Database, Bot, Sparkles, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import { githubGist } from 'react-syntax-highlighter/dist/esm/styles/hljs';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('sql', sql);
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { skillsApi, streamAgent } from '@/api/client';
import { useChatStore } from '@/store/chatStore';
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

// ── Markdown renderer ────────────────────────────────────────────────────────

// Split markdown into segments: fenced code blocks vs everything else
type Segment = { type: 'markdown'; text: string } | { type: 'code'; lang: string; code: string };

function splitCodeBlocks(content: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```(\w*)\r?\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'markdown', text: content.slice(last, match.index) });
    }
    segments.push({ type: 'code', lang: match[1] || 'text', code: match[2] });
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    segments.push({ type: 'markdown', text: content.slice(last) });
  }
  return segments;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const supported = ['python','javascript','typescript','bash','json','sql'];
  const language = supported.includes(lang) ? lang : 'text';
  return (
    <div className="my-3 rounded-lg border border-border" style={{ maxWidth: '100%' }}>
      <div className="bg-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center">
        <span>{lang || 'code'}</span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <SyntaxHighlighter
          language={language}
          style={githubGist}
          useInlineStyles={true}
          customStyle={{
            margin: 0,
            padding: '14px',
            fontSize: '12.5px',
            lineHeight: '1.6',
            background: '#f8f9fa',
            borderRadius: 0,
            whiteSpace: 'pre',
          }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const segments = splitCodeBlocks(content);
  return (
    <div>
      {segments.map((seg, i) =>
        seg.type === 'code' ? (
          <CodeBlock key={i} lang={seg.lang} code={seg.code} />
        ) : (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm]}
            components={{
              p: ({ children }) => <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>,
              h1: ({ children }) => <h1 className="text-lg font-bold mt-4 mb-2 text-foreground">{children}</h1>,
              h2: ({ children }) => <h2 className="text-base font-bold mt-4 mb-2 text-foreground">{children}</h2>,
              h3: ({ children }) => <h3 className="text-sm font-semibold mt-3 mb-1.5 text-foreground">{children}</h3>,
              h4: ({ children }) => <h4 className="text-sm font-semibold mt-2 mb-1 text-foreground">{children}</h4>,
              ul: ({ children }) => <ul className="list-disc pl-5 mb-3 space-y-1">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{children}</ol>,
              li: ({ children }) => <li className="text-sm leading-relaxed">{children}</li>,
              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
              em: ({ children }) => <em className="italic">{children}</em>,
              hr: () => <hr className="my-4 border-border" />,
              blockquote: ({ children }) => (
                <blockquote className="border-l-4 border-primary/30 pl-4 py-1 my-3 bg-muted/40 rounded-r text-muted-foreground italic">
                  {children}
                </blockquote>
              ),
              table: ({ children }) => (
                <div className="overflow-x-auto my-3">
                  <table className="w-full border-collapse text-sm">{children}</table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-muted">{children}</thead>,
              tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
              tr: ({ children }) => <tr className="border-b border-border">{children}</tr>,
              th: ({ children }) => (
                <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide border border-border">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="px-3 py-2 text-sm border border-border">{children}</td>
              ),
              code: ({ children }) => (
                <code className="bg-muted rounded px-1.5 py-0.5 text-[12px] font-mono text-foreground">
                  {children}
                </code>
              ),
            }}
          >
            {seg.text}
          </ReactMarkdown>
        )
      )}
    </div>
  );
}

// ── User message — detects code and renders accordingly ──────────────────────

function UserContent({ content }: { content: string }) {
  // Detect if the content is primarily code (contains newlines + code-like patterns)
  const lines = content.split('\n');
  const looksLikeCode = lines.length > 3 && (
    content.includes('def ') ||
    content.includes('function ') ||
    content.includes('import ') ||
    content.includes('const ') ||
    content.includes('class ') ||
    content.includes('    ') || // indented code
    content.includes('\t') ||
    /[{};()=>]/.test(content)
  );

  if (looksLikeCode) {
    return (
      <div className="text-left">
        <p className="text-xs text-primary-foreground/70 mb-2 font-medium">Code</p>
        <pre className="text-xs font-mono leading-relaxed whitespace-pre-wrap break-words overflow-x-auto max-w-full">
          {content}
        </pre>
      </div>
    );
  }

  return <span className="leading-relaxed">{content}</span>;
}

// ── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.role === 'user';

  if (isUser) {
    return (
      <div className="w-full flex justify-end px-6 py-2 animate-fade-in">
        <div className="max-w-[78%] min-w-0">
          <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm">
            <UserContent content={msg.content} />
          </div>
        </div>
      </div>
    );
  }

  // Assistant message — full width left-aligned
  return (
    <div className="w-full flex gap-3 px-6 py-2 animate-fade-in">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center mt-0.5">
        <Bot className="w-4 h-4 text-white" />
      </div>

      {/* Content — takes remaining width, never grows wider than parent */}
      <div className="min-w-0 flex-1 space-y-2" style={{ width: 0 }}>
        <div className="text-sm text-foreground">
          {msg.isStreaming && !msg.content ? (
            <span className="flex gap-1 items-center h-5 mt-1">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </span>
          ) : msg.isStreaming ? (
            <pre className="text-sm font-sans leading-relaxed whitespace-pre-wrap break-words">
              {msg.content}
            </pre>
          ) : (
            <div className="text-left">
              <MarkdownContent content={msg.content} />
            </div>
          )}
        </div>

        {/* Tool trace */}
        {msg.steps && msg.steps.length > 0 && (
          <ToolTrace steps={msg.steps} ragChunksUsed={msg.ragChunksUsed} />
        )}

        {/* Metrics row */}
        {msg.metrics && (
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
            {msg.metrics.durationMs > 0 && <span>{(msg.metrics.durationMs / 1000).toFixed(1)}s</span>}
            {msg.metrics.totalTokens > 0 && <span>{msg.metrics.totalTokens} tokens</span>}
            {msg.metrics.costUsd > 0 && <span>${msg.metrics.costUsd.toFixed(5)}</span>}
            {msg.runId && <span className="font-mono opacity-40">{msg.runId.slice(0, 8)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Smart textarea input ──────────────────────────────────────────────────────

function ChatInput({
  value,
  onChange,
  onSubmit,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 240) + 'px';
  }, [value]);

  // Detect if pasted/typed content looks like code
  const looksLikeCode = value.split('\n').length > 3 && (
    value.includes('def ') || value.includes('function ') ||
    value.includes('import ') || value.includes('const ') ||
    value.includes('class ') || value.includes('    ') || value.includes('\t') ||
    /[{};=>]/.test(value)
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  };

  return (
    <div className={cn(
      'relative flex-1 rounded-xl border bg-white transition-colors',
      looksLikeCode ? 'border-violet-200 bg-gray-50' : 'border-input',
    )}>
      {looksLikeCode && (
        <div className="absolute top-2 right-3 text-[10px] text-violet-500 font-mono font-medium pointer-events-none">
          code detected
        </div>
      )}
      <textarea
        ref={ref}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Message the agent… (Enter to send, Shift+Enter for newline)"
        disabled={disabled}
        rows={1}
        className={cn(
          'w-full resize-none bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground',
          'min-h-[44px] max-h-[240px]',
          looksLikeCode ? 'font-mono text-xs' : 'font-sans',
        )}
      />
    </div>
  );
}

// ── Chat Page ─────────────────────────────────────────────────────────────────

const USER_ID = 'user1'; // TODO: real auth

export function ChatPage() {
  const {
    messages,
    selectedSkill,
    useRag,
    useTools,
    addMessage,
    updateLastAssistant,
    clearMessages,
    setSelectedSkill,
    setUseRag,
    setUseTools,
  } = useChatStore();

  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: skills = [] } = useQuery<Skill[]>({
    queryKey: ['skills'],
    queryFn: skillsApi.list,
  });

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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

          {/* Clear chat */}
          {messages.length > 0 && (
            <button
              onClick={clearMessages}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border bg-muted border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors"
              title="Clear chat"
            >
              <Trash2 className="w-3 h-3" />
              Clear
            </button>
          )}

          {/* RAG toggle */}
          <button
            onClick={() => setUseRag(!useRag)}
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
            onClick={() => setUseTools(!useTools)}
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
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 w-full">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
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
                  onClick={() => setInput(suggestion)}
                  className="text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-muted transition-colors"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-1 pb-2 w-full">
          {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}

          {/* Live tool indicator */}
          {activeTool && (
            <div className="flex gap-3 px-6 py-3">
              <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center flex-shrink-0">
                <Bot className="w-4 h-4 text-white" />
              </div>
              <div className="bg-white border rounded-2xl rounded-tl-sm px-4 py-3">
                <LiveToolBadge tool={activeTool} />
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input bar */}
      <div className="flex-shrink-0 bg-white border-t px-6 py-3">
        <div className="flex gap-2 items-end">
          <ChatInput
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={isStreaming}
          />

          {isStreaming ? (
            <Button size="icon" variant="destructive" onClick={handleStop} className="flex-shrink-0 mb-0.5">
              <Square className="w-4 h-4" />
            </Button>
          ) : (
            <Button size="icon" onClick={handleSubmit} disabled={!input.trim()} className="flex-shrink-0 mb-0.5">
              <Send className="w-4 h-4" />
            </Button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          Skill: <span className="font-medium">{selectedSkill}</span> · Shift+Enter for newline
        </p>
      </div>
    </div>
  );
}
