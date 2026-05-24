import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Send, Square, ChevronDown, ChevronRight, Wrench, Database, Bot, Sparkles, Trash2, Copy, Check, Download, FileSpreadsheet, Printer } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter';
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python';
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript';
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript';
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash';
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json';
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql';
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml';
import { githubGist } from 'react-syntax-highlighter/dist/esm/styles/hljs';

SyntaxHighlighter.registerLanguage('python', python);
SyntaxHighlighter.registerLanguage('javascript', javascript);
SyntaxHighlighter.registerLanguage('typescript', typescript);
SyntaxHighlighter.registerLanguage('bash', bash);
SyntaxHighlighter.registerLanguage('json', json);
SyntaxHighlighter.registerLanguage('sql', sql);
SyntaxHighlighter.registerLanguage('xml', xml);
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { skillsApi, streamAgent } from '@/api/client';
import { useChatStore } from '@/store/chatStore';
import { useUserStore } from '@/store/userStore';
import type { ChatMessage, ToolStep, Skill } from '@/types';
import { UIComponentBlock } from '@/components/ui-components';

// ── Utility: file download ────────────────────────────────────────────────────

function downloadText(content: string, filename: string, mime = 'text/plain') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadCsvAsXlsx(csvText: string, filename: string) {
  // Build a minimal XLSX using SheetJS loaded from CDN via dynamic import workaround
  // We inline a simple CSV→Excel via data URI trick: open CSV directly as xlsx
  // For a proper xlsx we use the blob approach with the xlsx library loaded lazily
  import('https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' as never).then((XLSX: any) => {
    const wb = XLSX.utils.book_new();
    const rows = csvText.trim().split('\n').map((row: string) =>
      row.split(',').map((cell: string) => cell.replace(/^"|"$/g, '').replace(/""/g, '"'))
    );
    const ws = XLSX.utils.aoa_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, filename);
  }).catch(() => {
    // Fallback: download as CSV if SheetJS fails
    downloadText(csvText, filename.replace('.xlsx', '.csv'), 'text/csv');
  });
}

// ── CopyButton ─────────────────────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copy"
      className={cn(
        'flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-colors',
        copied
          ? 'bg-green-600 text-white'
          : 'bg-slate-700 hover:bg-slate-600 text-slate-300',
        className,
      )}
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

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
type Segment =
  | { type: 'markdown'; text: string }
  | { type: 'code'; lang: string; code: string }
  | { type: 'html'; code: string }
  | { type: 'csv'; code: string }
  | { type: 'mermaid'; code: string }
  | { type: 'json'; code: string };

function splitCodeBlocks(content: string): Segment[] {
  const segments: Segment[] = [];
  const fence = /```(\w*)\r?\n([\s\S]*?)```/g;
  let last = 0;
  let match;
  while ((match = fence.exec(content)) !== null) {
    if (match.index > last) {
      segments.push({ type: 'markdown', text: content.slice(last, match.index) });
    }
    const lang = (match[1] || 'text').toLowerCase();
    const code = match[2];
    if (lang === 'html') {
      segments.push({ type: 'html', code });
    } else if (lang === 'csv') {
      segments.push({ type: 'csv', code });
    } else if (lang === 'mermaid') {
      segments.push({ type: 'mermaid', code });
    } else if (lang === 'json') {
      segments.push({ type: 'json', code });
    } else {
      segments.push({ type: 'code', lang, code });
    }
    last = match.index + match[0].length;
  }
  if (last < content.length) {
    segments.push({ type: 'markdown', text: content.slice(last) });
  }
  return segments;
}

// ── HTML Preview Block ───────────────────────────────────────────────────────

// Inject a postMessage reporter into the HTML so the iframe can tell us its height
function injectHeightReporter(html: string): string {
  const script = `
<script>
(function() {
  function report() {
    var h = document.documentElement.scrollHeight || document.body.scrollHeight;
    window.parent.postMessage({ type: 'iframe-height', height: h }, '*');
  }
  // Report on load, and again after a delay for charts/JS
  window.addEventListener('load', function() {
    report();
    setTimeout(report, 300);
    setTimeout(report, 800);
    setTimeout(report, 1500);
  });
  // Also observe DOM changes (e.g. chart renders after fetch)
  if (window.ResizeObserver) {
    new ResizeObserver(report).observe(document.body);
  }
})();
<\/script>`;
  // Inject before </body> or </html>, or append at end
  if (html.includes('</body>')) return html.replace('</body>', script + '</body>');
  if (html.includes('</html>')) return html.replace('</html>', script + '</html>');
  return html + script;
}

function HtmlBlock({ code }: { code: string }) {
  const [showPreview, setShowPreview] = useState(true);
  const [height, setHeight] = useState(200);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'iframe-height' && e.data.height > 50) {
        setHeight(e.data.height + 24);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const onIframeLoad = () => {
    try {
      const doc = iframeRef.current?.contentDocument;
      const h = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight;
      if (h && h > 50) setHeight(h + 24);
    } catch {}
  };

  // Inject a print trigger into the page and call it
  const handlePrint = () => {
    const printable = code.replace('</body>', `
<script>window.onload = function() { window.print(); }<\/script>
</body>`);
    const w = window.open('', '_blank');
    if (w) { w.document.write(printable); w.document.close(); }
  };

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden" style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div className="bg-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
          html · live preview
        </span>
        <div className="flex items-center gap-1.5 ml-auto flex-wrap">
          <CopyButton text={code} />
          <button
            onClick={() => downloadText(code, 'page.html', 'text/html')}
            title="Download HTML"
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            <Download className="w-3 h-3" /> HTML
          </button>
          <button
            onClick={handlePrint}
            title="Print / Save as PDF"
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            <Printer className="w-3 h-3" /> PDF
          </button>
          <button
            onClick={() => setShowPreview(p => !p)}
            className="text-[10px] px-2 py-0.5 rounded bg-slate-600 hover:bg-slate-500 transition-colors"
          >
            {showPreview ? '{ } source' : '▶ preview'}
          </button>
        </div>
      </div>

      {/* Preview — srcdoc works correctly with sandbox */}
      {showPreview ? (
        <iframe
          ref={iframeRef}
          srcDoc={injectHeightReporter(code)}
          sandbox="allow-scripts allow-forms"
          onLoad={onIframeLoad}
          className="w-full border-0 bg-white block"
          style={{ height: `${height}px`, transition: 'height 0.2s ease' }}
          title="html-preview"
        />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <SyntaxHighlighter
            language="xml"
            style={githubGist}
            useInlineStyles={true}
            customStyle={{ margin: 0, padding: '14px', fontSize: '12.5px', lineHeight: '1.6', background: '#f8f9fa', borderRadius: 0, whiteSpace: 'pre' }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

const LANG_EXT: Record<string, string> = {
  python: 'py', javascript: 'js', typescript: 'ts', bash: 'sh',
  json: 'json', sql: 'sql', xml: 'xml', html: 'html', css: 'css',
  yaml: 'yaml', markdown: 'md', text: 'txt',
};

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const supported = ['python','javascript','typescript','bash','json','sql','xml'];
  const language = supported.includes(lang) ? lang : 'text';
  const ext = LANG_EXT[lang] || 'txt';

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden" style={{ maxWidth: '100%' }}>
      <div className="bg-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center justify-between gap-2">
        <span className="flex-shrink-0">{lang || 'code'}</span>
        <div className="flex items-center gap-1.5">
          <CopyButton text={code} />
          <button
            onClick={() => downloadText(code, `code.${ext}`)}
            title="Download"
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            <Download className="w-3 h-3" /> .{ext}
          </button>
        </div>
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

// ── CSV Table Block ───────────────────────────────────────────────────────────

function parseCsv(raw: string): string[][] {
  return raw.trim().split('\n').map(line => {
    const cols: string[] = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        cols.push(cur.trim()); cur = '';
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    return cols;
  });
}

function CsvBlock({ code }: { code: string }) {
  const rows = parseCsv(code);
  const headers = rows[0] ?? [];
  const data = rows.slice(1);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = sortCol === null ? data : [...data].sort((a, b) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    const numA = parseFloat(av), numB = parseFloat(bv);
    const cmp = (!isNaN(numA) && !isNaN(numB)) ? numA - numB : av.localeCompare(bv);
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (i: number) => {
    if (sortCol === i) setSortAsc(a => !a);
    else { setSortCol(i); setSortAsc(true); }
  };

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden" style={{ maxWidth: '100%' }}>
      {/* Header */}
      <div className="bg-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <FileSpreadsheet className="w-3 h-3 text-green-400" />
          csv · {data.length} rows × {headers.length} cols
        </span>
        <div className="flex items-center gap-1.5">
          <CopyButton text={code} />
          <button
            onClick={() => downloadText(code, 'data.csv', 'text/csv')}
            title="Download CSV"
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
          >
            <Download className="w-3 h-3" /> CSV
          </button>
          <button
            onClick={() => downloadCsvAsXlsx(code, 'data.xlsx')}
            title="Download Excel"
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors"
          >
            <FileSpreadsheet className="w-3 h-3" /> Excel
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto max-h-80 overflow-y-auto">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-slate-100 z-10">
            <tr>
              {headers.map((h, i) => (
                <th
                  key={i}
                  onClick={() => toggleSort(i)}
                  className="px-3 py-2 text-left font-semibold text-slate-700 border-b border-slate-200 whitespace-nowrap cursor-pointer hover:bg-slate-200 select-none"
                >
                  {h}
                  {sortCol === i && (
                    <span className="ml-1 text-primary">{sortAsc ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                {headers.map((_, ci) => (
                  <td key={ci} className="px-3 py-1.5 border-b border-slate-100 whitespace-nowrap text-slate-700">
                    {row[ci] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Mermaid Diagram Block ─────────────────────────────────────────────────────

function MermaidBlock({ code }: { code: string }) {
  const [showSource, setShowSource] = useState(false);

  // Build a self-contained HTML page that renders the Mermaid diagram
  const mermaidHtml = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { background: #fff; display: flex; align-items: flex-start; justify-content: center; padding: 16px; }
  .mermaid { max-width: 100%; }
</style>
</head>
<body>
<div class="mermaid">${code.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'default', securityLevel: 'loose' });
  mermaid.run().then(() => {
    var h = document.body.scrollHeight;
    window.parent.postMessage({ type: 'iframe-height', height: h }, '*');
    setTimeout(function() {
      h = document.body.scrollHeight;
      window.parent.postMessage({ type: 'iframe-height', height: h }, '*');
    }, 500);
  });
<\/script>
</body>
</html>`;

  const [height, setHeight] = useState(120);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.data?.type === 'iframe-height' && e.data.height > 50) {
        setHeight(e.data.height + 24);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden" style={{ maxWidth: '100%' }}>
      <div className="bg-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />
          mermaid · diagram
        </span>
        <div className="flex items-center gap-1.5">
          <CopyButton text={code} />
          <button
            onClick={() => setShowSource(s => !s)}
            className="text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            {showSource ? '▶ diagram' : '{ } source'}
          </button>
        </div>
      </div>
      {showSource ? (
        <div style={{ overflowX: 'auto' }}>
          <SyntaxHighlighter
            language="text"
            style={githubGist}
            useInlineStyles={true}
            customStyle={{ margin: 0, padding: '14px', fontSize: '12.5px', lineHeight: '1.6', background: '#f8f9fa', borderRadius: 0, whiteSpace: 'pre' }}
          >
            {code}
          </SyntaxHighlighter>
        </div>
      ) : (
        <iframe
          srcDoc={mermaidHtml}
          sandbox="allow-scripts"
          className="w-full border-0 bg-white block"
          style={{ height: `${height}px`, transition: 'height 0.3s ease' }}
          title="mermaid-diagram"
        />
      )}
    </div>
  );
}

// ── JSON Tree Viewer ──────────────────────────────────────────────────────────

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

function getType(val: JsonValue): string {
  if (val === null) return 'null';
  if (Array.isArray(val)) return 'array';
  return typeof val;
}

const TYPE_BADGE: Record<string, string> = {
  string:  'bg-emerald-50 text-emerald-700 border-emerald-200',
  number:  'bg-blue-50 text-blue-700 border-blue-200',
  boolean: 'bg-purple-50 text-purple-700 border-purple-200',
  null:    'bg-slate-100 text-slate-500 border-slate-200',
  array:   'bg-amber-50 text-amber-700 border-amber-200',
  object:  'bg-rose-50 text-rose-700 border-rose-200',
};

function JsonScalar({ value, type }: { value: JsonValue; type: string }) {
  if (type === 'string') {
    const str = String(value);
    // Detect URL
    if (/^https?:\/\//.test(str)) {
      return <a href={str} target="_blank" rel="noopener noreferrer" className="text-emerald-600 underline underline-offset-2 break-all">&quot;{str}&quot;</a>;
    }
    return <span className="text-emerald-600">&quot;{str}&quot;</span>;
  }
  if (type === 'boolean') return <span className="text-purple-600 font-medium">{String(value)}</span>;
  if (type === 'null')    return <span className="text-slate-400 font-medium italic">null</span>;
  if (type === 'number')  return <span className="text-blue-600">{String(value)}</span>;
  return <span>{String(value)}</span>;
}

interface JsonNodeProps {
  keyName?: string;
  value: JsonValue;
  depth: number;
  path: string;
  searchTerm: string;
  defaultExpanded: boolean;
  onCopyPath: (path: string) => void;
}

function JsonNode({ keyName, value, depth, path, searchTerm, defaultExpanded, onCopyPath }: JsonNodeProps) {
  const type = getType(value);
  const isComplex = type === 'object' || type === 'array';
  const [open, setOpen] = useState(defaultExpanded || depth < 2);

  const childKeys = isComplex
    ? (Array.isArray(value) ? value.map((_, i) => String(i)) : Object.keys(value as Record<string, JsonValue>))
    : [];
  const childCount = childKeys.length;

  const keyMatches = searchTerm && keyName?.toLowerCase().includes(searchTerm.toLowerCase());

  // For non-complex values, also check value match
  const valueStr = !isComplex ? String(value) : '';
  const valueMatches = searchTerm && valueStr.toLowerCase().includes(searchTerm.toLowerCase());

  const highlight = keyMatches || valueMatches;

  return (
    <div className={`text-[12.5px] leading-6 font-mono ${depth > 0 ? 'ml-4' : ''}`}>
      <div
        className={`flex items-start gap-1 group rounded px-1 -mx-1 hover:bg-slate-50 transition-colors ${highlight ? 'bg-yellow-50 hover:bg-yellow-100' : ''}`}
      >
        {/* Expand/collapse toggle */}
        {isComplex ? (
          <button
            onClick={() => setOpen(o => !o)}
            className="flex-shrink-0 w-4 h-6 flex items-center justify-center text-slate-400 hover:text-slate-700 transition-colors"
          >
            <span className="text-[10px]">{open ? '▾' : '▸'}</span>
          </button>
        ) : (
          <span className="flex-shrink-0 w-4" />
        )}

        {/* Key */}
        {keyName !== undefined && (
          <span
            className={`flex-shrink-0 font-semibold ${keyMatches ? 'bg-yellow-200 rounded px-0.5' : 'text-slate-700'}`}
          >
            {/^\d+$/.test(keyName) ? (
              <span className="text-slate-400">{keyName}</span>
            ) : (
              keyName
            )}
            <span className="text-slate-400 font-normal">: </span>
          </span>
        )}

        {/* Value / summary */}
        {isComplex ? (
          <span className="flex items-center gap-1.5 flex-1 min-w-0">
            {!open && (
              <span className="text-slate-400">
                {Array.isArray(value) ? '[' : '{'}
                <span className="text-slate-500 text-[11px] mx-1">{childCount} {Array.isArray(value) ? 'items' : 'keys'}</span>
                {Array.isArray(value) ? ']' : '}'}
              </span>
            )}
            {open && <span className="text-slate-400">{Array.isArray(value) ? '[' : '{'}</span>}
            {/* Type badge + count */}
            <span className={`text-[10px] px-1.5 py-0 rounded border font-sans font-medium ${TYPE_BADGE[type]}`}>
              {type} · {childCount}
            </span>
          </span>
        ) : (
          <span className={`flex-1 min-w-0 break-all ${valueMatches ? 'bg-yellow-200 rounded px-0.5' : ''}`}>
            <JsonScalar value={value} type={type} />
            <span className={`ml-1.5 text-[10px] px-1.5 py-0 rounded border font-sans font-medium ${TYPE_BADGE[type]}`}>
              {type}
              {type === 'string' && ` · ${(value as string).length}ch`}
            </span>
          </span>
        )}

        {/* Copy path button — appears on hover */}
        <button
          onClick={() => onCopyPath(path)}
          title={`Copy path: ${path}`}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-[10px] px-1.5 py-0 rounded bg-slate-200 hover:bg-slate-300 text-slate-600 transition-all ml-1 self-center font-sans"
        >
          {path || '$'}
        </button>
      </div>

      {/* Children */}
      {isComplex && open && (
        <div className="border-l border-slate-200 ml-[9px] pl-0">
          {childKeys.map(k => {
            const childVal = Array.isArray(value)
              ? (value as JsonValue[])[Number(k)]
              : (value as Record<string, JsonValue>)[k];
            const childPath = path ? `${path}.${k}` : k;
            return (
              <JsonNode
                key={k}
                keyName={k}
                value={childVal}
                depth={depth + 1}
                path={childPath}
                searchTerm={searchTerm}
                defaultExpanded={defaultExpanded}
                onCopyPath={onCopyPath}
              />
            );
          })}
        </div>
      )}

      {/* Closing bracket */}
      {isComplex && open && (
        <div className={`font-mono text-slate-400 text-[12.5px] ${depth > 0 ? 'ml-4' : ''} px-1`}>
          {Array.isArray(value) ? ']' : '}'}
        </div>
      )}
    </div>
  );
}

// ── JSON Smart Renderer ───────────────────────────────────────────────────────
// Analyses the JSON shape and picks the best visual: form, table, stat cards, or SVG chart.

type JsonObj = Record<string, JsonValue>;

// ── helpers ───────────────────────────────────────────────────────────────────

function isPlainObject(v: JsonValue): v is JsonObj {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function isArrayOfObjects(v: JsonValue): v is JsonObj[] {
  return Array.isArray(v) && v.length > 0 && v.every(isPlainObject);
}

function isArrayOfScalars(v: JsonValue): v is (string | number | boolean | null)[] {
  return Array.isArray(v) && v.every(x => x === null || typeof x !== 'object');
}

function detectShape(parsed: JsonValue): 'form' | 'table' | 'cards' | 'bar-chart' | 'scalar-list' {
  if (isArrayOfObjects(parsed)) {
    const keys = Object.keys(parsed[0]);
    const numericKeys = keys.filter(k => parsed.every(row => typeof row[k] === 'number'));
    if (numericKeys.length >= 1 && parsed.length >= 2 && parsed.length <= 30) return 'bar-chart';
    return 'table';
  }
  if (Array.isArray(parsed) && isArrayOfScalars(parsed)) return 'scalar-list';
  if (isPlainObject(parsed)) {
    const vals = Object.values(parsed);
    const allNumeric = vals.every(v => typeof v === 'number');
    if (allNumeric && vals.length >= 2 && vals.length <= 10) return 'cards';
    return 'form';
  }
  return 'form';
}

// ── FormView ─────────────────────────────────────────────────────────────────

// Renders a single scalar value with smart formatting
function FormFieldValue({ value, depth = 0 }: { value: JsonValue; depth?: number }) {
  if (value === null) return <span className="text-slate-400 italic text-sm">null</span>;
  if (typeof value === 'boolean') return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${value ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${value ? 'bg-emerald-500' : 'bg-red-400'}`} />
      {String(value)}
    </span>
  );
  if (typeof value === 'number') return (
    <span className="font-mono text-blue-700 bg-blue-50 px-2 py-0.5 rounded text-sm">{value.toLocaleString()}</span>
  );
  if (typeof value === 'string') {
    if (/^https?:\/\//.test(value))
      return <a href={value} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 break-all text-sm">{value}</a>;
    if (/^\d{4}-\d{2}-\d{2}/.test(value))
      return <span className="text-slate-700 text-sm font-medium">{new Date(value).toLocaleString()}</span>;
    if (value.length > 120)
      return <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded p-2 border mt-1">{value}</p>;
    return <span className="text-slate-800 text-sm">{value}</span>;
  }
  // Arrays of objects → compact table
  if (isArrayOfObjects(value) && depth < 3) {
    return (
      <div className="mt-1 rounded border border-slate-200 overflow-hidden">
        <TableView data={value} compact />
      </div>
    );
  }
  // Arrays of scalars → pill tags
  if (Array.isArray(value)) return (
    <div className="flex flex-wrap gap-1 mt-1">
      {(value as JsonValue[]).map((item, i) => (
        <span key={i} className="text-xs bg-slate-100 border border-slate-200 rounded-full px-2.5 py-0.5 text-slate-700">
          <FormFieldValue value={item} depth={depth + 1} />
        </span>
      ))}
    </div>
  );
    // Nested plain objects → go directly through FormView so they get grid+card treatment
  if (isPlainObject(value) && depth < 4) return (
    <div className="mt-1">
      <FormView data={value} depth={depth + 1} />
    </div>
  );
  return <span className="text-slate-500 text-xs font-mono">{JSON.stringify(value)}</span>;
}

// One labelled scalar field — compact, sits in the grid
function ScalarField({ label, value }: { label: string; value: JsonValue }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider truncate">{label}</span>
      <div className="text-sm text-slate-800 min-w-0">
        <FormFieldValue value={value} />
      </div>
    </div>
  );
}

// Collapsible section card — wraps a nested object or array-of-objects
const SECTION_ACCENTS = [
  'border-l-blue-400',
  'border-l-violet-400',
  'border-l-emerald-400',
  'border-l-amber-400',
  'border-l-rose-400',
  'border-l-cyan-400',
];

function SectionCard({ label, value, depth, index }: { label: string; value: JsonValue; depth: number; index: number }) {
  const accent = SECTION_ACCENTS[index % SECTION_ACCENTS.length];
  const [collapsed, setCollapsed] = useState(false);

  // Decide what to render in the card body
  const renderBody = () => {
    // Plain object → full grid+card FormView recursion
    if (isPlainObject(value)) {
      return <FormView data={value as JsonObj} depth={depth} />;
    }
    // Array of objects → compact table
    if (isArrayOfObjects(value)) {
      return (
        <div className="rounded border border-slate-200 overflow-hidden">
          <TableView data={value} compact />
        </div>
      );
    }
    // Anything else (scalar arrays, etc.)
    return <FormFieldValue value={value} depth={depth} />;
  };

  return (
    <div className={`rounded-lg border border-slate-200 border-l-4 ${accent} bg-white shadow-sm overflow-hidden`}>
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{label}</span>
        <span className="text-slate-400 text-xs">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="px-4 py-3">
          {renderBody()}
        </div>
      )}
    </div>
  );
}

// Classifies whether a value is "scalar" (should go in the flat grid) or
// "complex" (should get its own collapsible SectionCard)
function isScalarEntry(v: JsonValue): boolean {
  if (v === null) return true;
  if (typeof v !== 'object') return true;
  // Short scalar arrays (tags) → scalar
  if (Array.isArray(v) && v.every(x => x === null || typeof x !== 'object') && v.length <= 8) return true;
  return false;
}

function FormView({ data, depth = 0 }: { data: JsonObj; depth?: number }) {
  const entries = Object.entries(data);
  const toLabel = (key: string) => key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');

  const scalars  = entries.filter(([, v]) => isScalarEntry(v));
  const sections = entries.filter(([, v]) => !isScalarEntry(v));

  // Responsive grid: more columns when there are many short scalar fields
  const cols =
    scalars.length === 1 ? 'grid-cols-1' :
    scalars.length === 2 ? 'grid-cols-2' :
    scalars.length <= 4  ? 'grid-cols-2 sm:grid-cols-4' :
                           'grid-cols-2 sm:grid-cols-3';

  return (
    <div className="space-y-3">
      {/* Scalar fields in a responsive grid */}
      {scalars.length > 0 && (
        <div className={`grid ${cols} gap-x-6 gap-y-3`}>
          {scalars.map(([key, val]) => (
            <ScalarField key={key} label={toLabel(key)} value={val} />
          ))}
        </div>
      )}

      {/* Complex sections — each gets a collapsible card */}
      {sections.map(([key, val], i) => (
        <SectionCard key={key} label={toLabel(key)} value={val} depth={depth + 1} index={i} />
      ))}
    </div>
  );
}

// ── TableView ─────────────────────────────────────────────────────────────────

function TableView({ data, compact = false }: { data: JsonObj[]; compact?: boolean }) {
  const allKeys = Array.from(new Set(data.flatMap(Object.keys)));
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = sortCol === null ? data : [...data].sort((a, b) => {
    const av = a[sortCol] ?? '';
    const bv = b[sortCol] ?? '';
    const numA = parseFloat(String(av)), numB = parseFloat(String(bv));
    const cmp = (!isNaN(numA) && !isNaN(numB)) ? numA - numB : String(av).localeCompare(String(bv));
    return sortAsc ? cmp : -cmp;
  });

  const toggleSort = (k: string) => {
    if (sortCol === k) setSortAsc(a => !a);
    else { setSortCol(k); setSortAsc(true); }
  };

  const renderCell = (v: JsonValue) => {
    if (v === null || v === undefined) return <span className="text-slate-300">—</span>;
    if (typeof v === 'boolean') return (
      <span className={`inline-block w-2 h-2 rounded-full ${v ? 'bg-emerald-500' : 'bg-red-400'}`} title={String(v)} />
    );
    if (typeof v === 'number') return <span className="font-mono text-blue-700">{v.toLocaleString()}</span>;
    if (typeof v === 'string' && /^https?:\/\//.test(v)) return <a href={v} target="_blank" rel="noopener noreferrer" className="text-primary underline text-xs truncate max-w-[120px] block">{v}</a>;
    if (typeof v === 'object') return <span className="text-slate-400 text-xs italic">{Array.isArray(v) ? `[${(v as JsonValue[]).length}]` : '{…}'}</span>;
    const s = String(v);
    return <span title={s}>{s.length > 40 ? s.slice(0, 38) + '…' : s}</span>;
  };

  const px = compact ? 'px-2 py-1' : 'px-3 py-2';

  return (
    <div className={compact ? '' : 'overflow-x-auto'}>
      <table className="w-full text-xs border-collapse">
        <thead className="bg-slate-100 sticky top-0 z-10">
          <tr>
            {allKeys.map(k => (
              <th
                key={k}
                onClick={() => toggleSort(k)}
                className={`${px} text-left font-semibold text-slate-600 border-b border-slate-200 whitespace-nowrap cursor-pointer hover:bg-slate-200 select-none`}
              >
                {k.replace(/_/g, ' ')}
                {sortCol === k && <span className="ml-1 text-primary">{sortAsc ? '↑' : '↓'}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/80'}>
              {allKeys.map(k => (
                <td key={k} className={`${px} border-b border-slate-100 text-slate-700`}>
                  {renderCell(row[k] ?? null)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── StatCards ─────────────────────────────────────────────────────────────────

const CARD_COLORS = [
  { bg: 'bg-blue-50',   border: 'border-blue-200',   text: 'text-blue-700',   num: 'text-blue-800'   },
  { bg: 'bg-emerald-50',border: 'border-emerald-200', text: 'text-emerald-700',num: 'text-emerald-800'},
  { bg: 'bg-violet-50', border: 'border-violet-200',  text: 'text-violet-700', num: 'text-violet-800' },
  { bg: 'bg-amber-50',  border: 'border-amber-200',   text: 'text-amber-700',  num: 'text-amber-800'  },
  { bg: 'bg-rose-50',   border: 'border-rose-200',    text: 'text-rose-700',   num: 'text-rose-800'   },
  { bg: 'bg-cyan-50',   border: 'border-cyan-200',    text: 'text-cyan-700',   num: 'text-cyan-800'   },
];

function StatCards({ data }: { data: JsonObj }) {
  const entries = Object.entries(data).filter(([, v]) => typeof v === 'number');
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4">
      {entries.map(([key, val], i) => {
        const c = CARD_COLORS[i % CARD_COLORS.length];
        const label = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
        const num = val as number;
        return (
          <div key={key} className={`${c.bg} ${c.border} border rounded-xl p-4 flex flex-col gap-1`}>
            <span className={`text-[11px] font-semibold uppercase tracking-wide ${c.text}`}>{label}</span>
            <span className={`text-2xl font-bold ${c.num}`}>
              {Math.abs(num) >= 1_000_000
                ? (num / 1_000_000).toFixed(1) + 'M'
                : Math.abs(num) >= 1_000
                ? (num / 1_000).toFixed(1) + 'K'
                : num % 1 === 0 ? num.toLocaleString() : num.toFixed(2)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── SVG Bar Chart ─────────────────────────────────────────────────────────────

function SvgBarChart({ data }: { data: JsonObj[] }) {
  // Find label key (first string key) and numeric keys
  const keys = Object.keys(data[0]);
  const labelKey = keys.find(k => typeof data[0][k] === 'string') ?? keys[0];
  const numericKeys = keys.filter(k => data.every(row => typeof row[k] === 'number'));
  const [activeKey, setActiveKey] = useState(numericKeys[0] ?? '');

  const values = data.map(row => ({ label: String(row[labelKey] ?? ''), value: Number(row[activeKey] ?? 0) }));
  const maxVal = Math.max(...values.map(v => v.value), 1);

  // SVG layout constants
  const W = 600, H = 280;
  const padL = 56, padR = 16, padT = 20, padB = 64;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barW = Math.min(40, (chartW / values.length) * 0.6);
  const gap = chartW / values.length;

  // Y-axis ticks
  const tickCount = 4;
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (maxVal * i) / tickCount);

  const BAR_COLORS = ['#6366f1','#10b981','#f59e0b','#ef4444','#06b6d4','#8b5cf6','#ec4899'];

  return (
    <div className="p-3">
      {/* Series selector */}
      {numericKeys.length > 1 && (
        <div className="flex gap-2 mb-3 flex-wrap">
          {numericKeys.map((k, i) => (
            <button
              key={k}
              onClick={() => setActiveKey(k)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors font-medium ${activeKey === k ? 'border-transparent text-white' : 'border-slate-200 text-slate-600 bg-white hover:bg-slate-50'}`}
              style={activeKey === k ? { backgroundColor: BAR_COLORS[i % BAR_COLORS.length] } : {}}
            >
              {k.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 300 }}>
        {/* Grid lines */}
        {ticks.map((tick, i) => {
          const y = padT + chartH - (tick / maxVal) * chartH;
          return (
            <g key={i}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
                {tick >= 1000 ? `${(tick / 1000).toFixed(0)}K` : tick.toFixed(tick % 1 === 0 ? 0 : 1)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {values.map((item, i) => {
          const barH = (item.value / maxVal) * chartH;
          const x = padL + gap * i + gap / 2 - barW / 2;
          const y = padT + chartH - barH;
          const color = BAR_COLORS[i % BAR_COLORS.length];
          return (
            <g key={i}>
              <rect
                x={x} y={y} width={barW} height={Math.max(barH, 2)}
                rx={4} ry={4} fill={color} opacity={0.85}
              />
              {/* Value label on top */}
              {barH > 16 && (
                <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize={10} fill="#475569" fontWeight={600}>
                  {item.value >= 1000 ? `${(item.value / 1000).toFixed(1)}K` : item.value}
                </text>
              )}
              {/* X-axis label */}
              <text
                x={x + barW / 2}
                y={padT + chartH + 14}
                textAnchor="middle"
                fontSize={10}
                fill="#64748b"
                transform={`rotate(-25, ${x + barW / 2}, ${padT + chartH + 14})`}
              >
                {item.label.length > 12 ? item.label.slice(0, 11) + '…' : item.label}
              </text>
            </g>
          );
        })}

        {/* X-axis baseline */}
        <line x1={padL} x2={W - padR} y1={padT + chartH} y2={padT + chartH} stroke="#cbd5e1" strokeWidth={1.5} />
        {/* Y-axis */}
        <line x1={padL} x2={padL} y1={padT} y2={padT + chartH} stroke="#cbd5e1" strokeWidth={1.5} />

        {/* Active series label */}
        <text x={W / 2} y={H - 4} textAnchor="middle" fontSize={11} fill="#94a3b8">
          {activeKey.replace(/_/g, ' ')}
        </text>
      </svg>
    </div>
  );
}

// ── ScalarList ────────────────────────────────────────────────────────────────

function ScalarList({ data }: { data: (string | number | boolean | null)[] }) {
  return (
    <div className="p-4 flex flex-wrap gap-2">
      {data.map((item, i) => (
        <span key={i} className="text-sm bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 shadow-sm">
          {item === null ? <span className="italic text-slate-400">null</span> : String(item)}
        </span>
      ))}
    </div>
  );
}

// ── JsonSmartRenderer ─────────────────────────────────────────────────────────

function JsonSmartRenderer({ parsed }: { parsed: JsonValue }) {
  const shape = detectShape(parsed);

  if (shape === 'bar-chart') return <SvgBarChart data={parsed as JsonObj[]} />;
  if (shape === 'table')    return <div className="overflow-x-auto max-h-[480px] overflow-y-auto"><TableView data={parsed as JsonObj[]} /></div>;
  if (shape === 'cards')    return <StatCards data={parsed as JsonObj} />;
  if (shape === 'scalar-list') return <ScalarList data={parsed as (string | number | boolean | null)[]} />;
  // default: form
  return (
    <div className="p-4 max-h-[520px] overflow-y-auto">
      <FormView data={parsed as JsonObj} />
    </div>
  );
}

type JsonTab = 'smart' | 'tree' | 'raw';

function JsonTreeBlock({ code }: { code: string }) {
  const [parsed, parseError] = (() => {
    try { return [JSON.parse(code) as JsonValue, null]; }
    catch (e) { return [null, String(e)]; }
  })();

  const [tab, setTab] = useState<JsonTab>('smart');
  const [searchTerm, setSearchTerm] = useState('');
  const [expandAll, setExpandAll] = useState(false);
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [expandKey, setExpandKey] = useState(0);

  const type = parsed !== null ? getType(parsed) : 'unknown';
  const size = code.length;
  const formatted = parsed !== null ? JSON.stringify(parsed, null, 2) : code;

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path || '$');
    setCopiedPath(path || '$');
    setTimeout(() => setCopiedPath(null), 1500);
  };

  const handleExpandAll = (expand: boolean) => {
    setExpandAll(expand);
    setExpandKey(k => k + 1);
  };

  const countKeys = (v: JsonValue): number => {
    if (v === null || typeof v !== 'object') return 1;
    return Object.keys(v as object).reduce((acc, k) => {
      const child = Array.isArray(v) ? (v as JsonValue[])[Number(k)] : (v as Record<string, JsonValue>)[k];
      return acc + countKeys(child);
    }, Object.keys(v as object).length);
  };
  const totalKeys = parsed !== null ? countKeys(parsed) : 0;

  const TAB_STYLES = (active: boolean) =>
    `text-[10px] px-2.5 py-0.5 rounded font-sans transition-colors ${
      active ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-400 hover:text-slate-200'
    }`;

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden" style={{ maxWidth: '100%' }}>
      {/* Header toolbar */}
      <div className="bg-slate-800 px-3 py-1.5 text-[11px] font-mono text-slate-300 border-b border-slate-700 flex items-center gap-2 flex-wrap">
        {/* Label */}
        <span className="flex items-center gap-1.5 flex-shrink-0">
          <span className="w-2 h-2 rounded-full bg-yellow-400 inline-block" />
          <span>json · {totalKeys} values · {(size / 1024).toFixed(1)} KB</span>
        </span>

        {/* Tab switcher */}
        <div className="flex items-center gap-0.5 bg-slate-700 rounded p-0.5 ml-1">
          <button className={TAB_STYLES(tab === 'smart')} onClick={() => setTab('smart')}>✦ Smart</button>
          <button className={TAB_STYLES(tab === 'tree')}  onClick={() => setTab('tree')}>🌲 Tree</button>
          <button className={TAB_STYLES(tab === 'raw')}   onClick={() => setTab('raw')}>{ } Raw</button>
        </div>

        {/* Tree-only controls */}
        {tab === 'tree' && (
          <div className="flex items-center gap-1.5">
            <div className="min-w-[120px] max-w-[180px]">
              <input
                type="text"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="Filter…"
                className="w-full bg-slate-700 text-slate-200 placeholder-slate-500 text-[11px] px-2 py-0.5 rounded outline-none focus:ring-1 focus:ring-slate-500 font-sans"
              />
            </div>
            <button onClick={() => handleExpandAll(true)} className="text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors font-sans">+all</button>
            <button onClick={() => handleExpandAll(false)} className="text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 transition-colors font-sans">−all</button>
            {copiedPath && <span className="text-emerald-400 text-[10px] font-sans">✓ {copiedPath}</span>}
          </div>
        )}

        {/* Right actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          <CopyButton text={formatted} />
          <button
            onClick={() => downloadText(formatted, 'data.json', 'application/json')}
            className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors font-sans"
          >
            <Download className="w-3 h-3" /> JSON
          </button>
        </div>
      </div>

      {/* Parse error banner */}
      {parseError && (
        <div className="px-4 py-3 bg-red-50 text-red-700 text-xs font-mono border-b">
          ⚠ Invalid JSON: {parseError}
          <div className="mt-1 text-red-500 opacity-70">Showing raw text below</div>
        </div>
      )}

      {/* ── Smart view ── */}
      {(tab === 'smart' && !parseError) && (
        <div className="bg-white">
          <JsonSmartRenderer parsed={parsed!} />
        </div>
      )}

      {/* ── Tree view ── */}
      {(tab === 'tree' && !parseError) && (
        <div className="bg-white px-3 py-3 overflow-x-auto max-h-[520px] overflow-y-auto">
          <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100">
            <span className={`text-[11px] px-2 py-0.5 rounded border font-medium font-sans ${TYPE_BADGE[type]}`}>{type}</span>
            {searchTerm && (
              <span className="text-[11px] text-slate-500 font-sans">
                highlighting &ldquo;<strong>{searchTerm}</strong>&rdquo;
              </span>
            )}
          </div>
          <JsonNode
            key={expandKey}
            value={parsed!}
            depth={0}
            path=""
            searchTerm={searchTerm}
            defaultExpanded={expandAll}
            onCopyPath={handleCopyPath}
          />
        </div>
      )}

      {/* ── Raw view (or parse error fallback) ── */}
      {(tab === 'raw' || parseError) && (
        <div style={{ overflowX: 'auto' }}>
          <SyntaxHighlighter
            language="json"
            style={githubGist}
            useInlineStyles={true}
            customStyle={{ margin: 0, padding: '14px', fontSize: '12.5px', lineHeight: '1.6', background: '#f8f9fa', borderRadius: 0, whiteSpace: 'pre' }}
          >
            {formatted}
          </SyntaxHighlighter>
        </div>
      )}
    </div>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const segments = splitCodeBlocks(content);
  return (
    <div>
      {segments.map((seg, i) =>
        seg.type === 'html' ? (
          <HtmlBlock key={i} code={seg.code} />
        ) : seg.type === 'csv' ? (
          <CsvBlock key={i} code={seg.code} />
        ) : seg.type === 'mermaid' ? (
          <MermaidBlock key={i} code={seg.code} />
        ) : seg.type === 'json' ? (
          <JsonTreeBlock key={i} code={seg.code} />
        ) : seg.type === 'code' ? (
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

// ── Streaming indicator ───────────────────────────────────────────────────────

const THINKING_LABELS = [
  'Thinking…',
  'Working on it…',
  'Analysing…',
  'Generating…',
  'Crafting response…',
];

function StreamingIndicator({ content }: { content: string }) {
  const [labelIdx] = useState(() => Math.floor(Math.random() * THINKING_LABELS.length));
  const hasContent = content.length > 0;

  // Detect what kind of content is being generated
  const isGeneratingHtml = content.includes('```html') || content.includes('<!DOCTYPE') || content.includes('<html');
  const isGeneratingCode = !isGeneratingHtml && content.includes('```');
  const label = isGeneratingHtml
    ? 'Building UI…'
    : isGeneratingCode
    ? 'Writing code…'
    : THINKING_LABELS[labelIdx];

  // Count words so far for the progress hint
  const wordCount = hasContent ? content.trim().split(/\s+/).length : 0;

  return (
    <div className="flex flex-col gap-2">
      {/* Animated label */}
      <div className="flex items-center gap-2">
        <div className="flex gap-1">
          <span className="typing-dot" />
          <span className="typing-dot" />
          <span className="typing-dot" />
        </div>
        <span className="text-xs text-muted-foreground font-medium animate-pulse">
          {label}
        </span>
        {hasContent && (
          <span className="text-[10px] text-muted-foreground/60 ml-1">
            {wordCount} words
          </span>
        )}
      </div>

      {/* Live content preview — plain text, no parsing */}
      {hasContent && (
        <div className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap break-words opacity-70 max-h-48 overflow-hidden relative">
          {content.slice(-600)}
          {/* Fade out bottom */}
          <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-white to-transparent pointer-events-none" />
        </div>
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
          {msg.isStreaming ? (
            <StreamingIndicator content={msg.content} />
          ) : (
            <div className="text-left">
              {(() => {
                const text = msg.content.trim();
                if (!text) return null;
                const hasComponents = msg.uiComponents && msg.uiComponents.length > 0;
                // When UI components are present, only show text if it's a short
                // intro (≤ 160 chars, no newlines) — suppress full prose narration
                if (hasComponents) {
                  const isShortIntro = text.length <= 160 && !text.includes('\n');
                  if (!isShortIntro) return null;
                }
                return <MarkdownContent content={text} />;
              })()}
            </div>
          )}
        </div>

        {/* ── Generative UI Components ───────────────────────────────────── */}
        {msg.uiComponents && msg.uiComponents.length > 0 && (
          <div className="space-y-1">
            {msg.uiComponents.map(component => (
              <UIComponentBlock key={component.id} component={component} />
            ))}
          </div>
        )}

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

const PERSONA_COLORS: Record<string, string> = {
  broker: 'bg-blue-50 border-blue-200 text-blue-800',
  underwriter: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  claims: 'bg-amber-50 border-amber-200 text-amber-800',
};

const PERSONA_ICON: Record<string, string> = {
  broker: '🤝',
  underwriter: '🔍',
  claims: '📋',
};

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

  const currentUser = useUserStore((s) => s.currentUser);
  const setCurrentUser = useUserStore((s) => s.setCurrentUser);

  // Sync skill selector with persona default on first load
  useEffect(() => {
    if (currentUser && messages.length === 0) {
      setSelectedSkill(currentUser.personaConfig.skill);
    }
  }, [currentUser?.userId]);

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
      {
        message: text,
        skill: selectedSkill,
        userId: currentUser?.userId,
        namespace: currentUser?.personaConfig.ragNamespace,
        database: currentUser?.personaConfig.defaultDatabase,
        history,
        useRag,
        useTools,
      },
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
        onUIComponent: (id, componentType, props) => {
          updateLastAssistant(m => ({
            ...m,
            uiComponents: [...(m.uiComponents ?? []), { id, componentType, props }],
          }));
        },
        onContentReplace: (content) => {
          updateLastAssistant(m => ({ ...m, content }));
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
  }, [input, isStreaming, messages, selectedSkill, useRag, useTools, currentUser, addMessage, updateLastAssistant]);

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

        {/* Persona badge */}
        {currentUser && (
          <div className={cn(
            'flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border font-medium',
            PERSONA_COLORS[currentUser.persona] ?? 'bg-gray-50 border-gray-200 text-gray-700',
          )}>
            <span>{PERSONA_ICON[currentUser.persona] ?? '👤'}</span>
            <span>{currentUser.name}</span>
            <span className="opacity-60">·</span>
            <span>{currentUser.personaConfig.displayName}</span>
          </div>
        )}

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

          {/* Switch user */}
          <button
            onClick={() => setCurrentUser(null)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border bg-muted border-border text-muted-foreground hover:text-foreground transition-colors"
            title="Switch user"
          >
            <Bot className="w-3 h-3" />
            Switch
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden py-4 w-full">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-24 text-center px-6">
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4 text-2xl"
              style={{ background: currentUser?.personaConfig?.color ? `${currentUser.personaConfig.color}18` : undefined }}
            >
              {currentUser?.persona === 'broker' ? '🤝' : currentUser?.persona === 'underwriter' ? '🔍' : currentUser?.persona === 'claims' ? '📋' : <Sparkles className="w-6 h-6 text-primary" />}
            </div>
            <h2 className="text-lg font-semibold mb-1">
              Hi {currentUser?.name?.split(' ')[0] ?? 'there'}, how can I help?
            </h2>
            <p className="text-sm text-muted-foreground max-w-md">
              {currentUser?.personaConfig?.description ?? 'Ask anything. I can search your knowledge base, use tools, and remember context across sessions.'}
            </p>
            <div className="mt-6 flex flex-wrap gap-2 justify-center max-w-xl">
              {(currentUser?.personaConfig?.quickActions ?? []).map(action => (
                <button
                  key={action.label}
                  onClick={() => setInput(action.prompt)}
                  className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border bg-white hover:bg-muted transition-colors"
                >
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>

            {/* ── Dev: UI component preview ───────────────────────────── */}
            <button
              onClick={() => {
                addMessage({ id: 'dev-user', role: 'user', content: '🧪 UI component preview' });
                addMessage({
                  id: 'dev-assistant',
                  role: 'assistant',
                  content: 'Here is a preview of all available generative UI components:',
                  uiComponents: [
                    {
                      id: 'test-stats',
                      componentType: 'StatsDashboard',
                      props: {
                        title: 'Sales Overview',
                        stats: [
                          { label: 'Total Revenue', value: 1284500, unit: '$', icon: '💰', color: '#6366f1', delta: 12400 },
                          { label: 'Active Partners', value: 342, icon: '🤝', color: '#10b981', delta: 8 },
                          { label: 'Avg Contract Value', value: 24300, unit: '$', icon: '📄', color: '#f59e0b', delta: -1200 },
                          { label: 'Open Orders', value: 58, icon: '📦', color: '#f43f5e' },
                        ],
                      },
                    },
                    {
                      id: 'test-bar',
                      componentType: 'BarChart',
                      props: {
                        title: 'Trading Partners by Country',
                        data: [
                          { label: 'Germany', value: 84 },
                          { label: 'USA', value: 72 },
                          { label: 'France', value: 61 },
                          { label: 'UK', value: 55 },
                          { label: 'Netherlands', value: 43 },
                          { label: 'Spain', value: 38 },
                        ],
                      },
                    },
                    {
                      id: 'test-line',
                      componentType: 'LineChart',
                      props: {
                        title: 'Monthly Revenue Trend',
                        xLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                        series: [
                          { label: 'Revenue', data: [84000, 92000, 87000, 105000, 118000, 131000], color: '#6366f1' },
                          { label: 'Target', data: [90000, 90000, 95000, 100000, 110000, 120000], color: '#e2e8f0' },
                        ],
                      },
                    },
                    {
                      id: 'test-table',
                      componentType: 'DataTable',
                      props: {
                        title: 'Recent Agent Runs',
                        caption: 'Last 5 runs from the workbench database',
                        data: [
                          { skill: 'general-assistant', tokens: 1240, cost: '$0.00310', duration: '3.2s', status: 'success' },
                          { skill: 'html-builder', tokens: 3890, cost: '$0.00972', duration: '8.1s', status: 'success' },
                          { skill: 'general-assistant', tokens: 890, cost: '$0.00223', duration: '2.4s', status: 'success' },
                          { skill: 'summarizer', tokens: 2100, cost: '$0.00525', duration: '4.7s', status: 'success' },
                          { skill: 'general-assistant', tokens: 560, cost: '$0.00140', duration: '1.8s', status: 'error' },
                        ],
                      },
                    },
                    {
                      id: 'test-entity',
                      componentType: 'EntityCard',
                      props: {
                        title: 'Acme Corporation',
                        subtitle: 'Trading Partner · ID: TP-00412',
                        badge: 'Active',
                        badgeColor: '#10b981',
                        tags: ['Tier 1', 'Europe', 'Manufacturing'],
                        fields: {
                          Country: 'Germany',
                          Industry: 'Automotive',
                          'Contract Value': '$2.4M',
                          'Since': '2019-03-15',
                          'Primary Contact': 'Hans Müller',
                          'Email': 'h.muller@acme.de',
                          'Phone': '+49 89 1234567',
                          'Last Order': '2026-04-28',
                          'Open Invoices': 3,
                          'Credit Limit': '$500,000',
                        },
                      },
                    },
                    {
                      id: 'test-timeline',
                      componentType: 'Timeline',
                      props: {
                        title: 'Order Lifecycle',
                        events: [
                          { date: '2026-04-01', label: 'Order Placed', description: 'PO-8821 submitted by procurement', icon: '📝', color: '#6366f1' },
                          { date: '2026-04-03', label: 'Supplier Confirmed', description: 'Acme GmbH accepted the order', icon: '✅', color: '#10b981' },
                          { date: '2026-04-12', label: 'Shipped', description: 'Tracking: DHL 1Z999AA1012345678', icon: '🚚', color: '#f59e0b' },
                          { date: '2026-04-18', label: 'Delivered', description: 'Received at warehouse DE-MUC-03', icon: '📦', color: '#10b981' },
                          { date: '2026-04-20', label: 'Invoice Issued', description: 'INV-2026-00412 · €84,200', icon: '🧾', color: '#8b5cf6' },
                        ],
                      },
                    },
                    {
                      id: 'test-alert',
                      componentType: 'AlertPanel',
                      props: {
                        type: 'warning',
                        title: '3 contracts expiring this month',
                        message: 'The following partners have contracts due for renewal:',
                        items: ['Acme Corporation — expires 2026-05-31', 'GlobalTrade GmbH — expires 2026-05-28', 'Pacific Imports Ltd — expires 2026-05-15'],
                      },
                    },
                    {
                      id: 'test-kv',
                      componentType: 'KeyValueList',
                      props: {
                        title: 'Database Collections',
                        items: [
                          { key: 'strategies', value: '24 documents' },
                          { key: 'executions', value: '1,842 documents' },
                          { key: 'trading_partners', value: '342 documents' },
                          { key: 'orders', value: '12,450 documents' },
                          { key: 'invoices', value: '8,921 documents' },
                        ],
                      },
                    },
                  ],
                });
              }}
              className="mt-4 text-xs px-3 py-1.5 rounded-full border border-dashed border-slate-300 bg-white text-slate-400 hover:text-slate-600 hover:border-slate-400 transition-colors"
            >
              🧪 Preview UI components
            </button>
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
