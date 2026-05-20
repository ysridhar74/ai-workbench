import { useState, useRef, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Link, FileText, Trash2, RefreshCw, FolderOpen, Search, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { ragApi } from '@/api/client';

function StatusMsg({ type, msg }: { type: 'success' | 'error'; msg: string }) {
  return (
    <div className={cn(
      'flex items-start gap-2 text-sm rounded-lg px-3 py-2 animate-fade-in',
      type === 'success' ? 'bg-green-50 text-green-800 border border-green-200' : 'bg-red-50 text-red-800 border border-red-200',
    )}>
      {type === 'success' ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />}
      {msg}
    </div>
  );
}

export function RagPage() {
  const qc = useQueryClient();
  const [namespace, setNamespace] = useState('default');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // File upload state
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // URL ingest state
  const [urlInput, setUrlInput] = useState('');

  // Text ingest state
  const [textInput, setTextInput] = useState('');
  const [textSource, setTextSource] = useState('');

  // Retrieve test
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ text: string; score: number }>>([]);

  const { data: namespaces = [] } = useQuery({
    queryKey: ['rag-namespaces'],
    queryFn: ragApi.listNamespaces,
  });

  const { data: sourcesData, isLoading: sourcesLoading } = useQuery({
    queryKey: ['rag-sources', namespace],
    queryFn: () => ragApi.listSources(namespace),
  });

  const showStatus = (type: 'success' | 'error', msg: string) => {
    setStatus({ type, msg });
    setTimeout(() => setStatus(null), 5000);
  };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['rag-namespaces'] });
    qc.invalidateQueries({ queryKey: ['rag-sources', namespace] });
  };

  // File ingest
  const fileMutation = useMutation({
    mutationFn: (file: File) => ragApi.ingestFile(file, namespace),
    onSuccess: (data) => { showStatus('success', `Ingested "${data.source}" → ${data.chunksCreated} chunks`); invalidate(); },
    onError: (e: Error) => showStatus('error', e.message),
  });

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(f => fileMutation.mutate(f));
  }, [fileMutation]);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  // URL ingest
  const urlMutation = useMutation({
    mutationFn: () => ragApi.ingestUrl(urlInput, namespace),
    onSuccess: (data) => { showStatus('success', `Ingested "${data.source}" → ${data.chunksCreated} chunks`); setUrlInput(''); invalidate(); },
    onError: (e: Error) => showStatus('error', e.message),
  });

  // Text ingest
  const textMutation = useMutation({
    mutationFn: () => ragApi.ingestText({ text: textInput, source: textSource || 'manual-text', namespace }),
    onSuccess: (data) => { showStatus('success', `Ingested → ${data.chunksCreated} chunks`); setTextInput(''); setTextSource(''); invalidate(); },
    onError: (e: Error) => showStatus('error', e.message),
  });

  // Delete source
  const deleteMutation = useMutation({
    mutationFn: (source: string) => ragApi.deleteSource(source, namespace),
    onSuccess: () => { showStatus('success', 'Source deleted'); invalidate(); },
    onError: (e: Error) => showStatus('error', e.message),
  });

  // Retrieve test
  const retrieveMutation = useMutation({
    mutationFn: () => ragApi.retrieve(query, namespace),
    onSuccess: (data) => setResults(data.results),
    onError: (e: Error) => showStatus('error', e.message),
  });

  const sources: string[] = sourcesData?.sources ?? [];
  const isBusy = fileMutation.isPending || urlMutation.isPending || textMutation.isPending;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 bg-white border-b px-6 py-3 flex items-center gap-4">
        <FolderOpen className="w-4 h-4 text-primary" />
        <h1 className="font-semibold text-sm">Knowledge Base</h1>

        <div className="ml-auto flex items-center gap-3">
          <Select value={namespace} onValueChange={setNamespace}>
            <SelectTrigger className="w-40 h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {['default', ...namespaces.filter((n: string) => n !== 'default')].map((n: string) => (
                <SelectItem key={n} value={n}>{n}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="w-32 h-8 text-xs"
            placeholder="New namespace…"
            onKeyDown={e => { if (e.key === 'Enter') { setNamespace((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = ''; } }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-5">
        {status && <StatusMsg type={status.type} msg={status.msg} />}

        {/* Ingest section */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Ingest Documents</CardTitle>
            <CardDescription className="text-xs">Add content to namespace: <span className="font-mono font-medium text-foreground">{namespace}</span></CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="file">
              <TabsList className="h-8 text-xs">
                <TabsTrigger value="file" className="text-xs">File Upload</TabsTrigger>
                <TabsTrigger value="url" className="text-xs">URL</TabsTrigger>
                <TabsTrigger value="text" className="text-xs">Plain Text</TabsTrigger>
              </TabsList>

              {/* File */}
              <TabsContent value="file" className="mt-4">
                <div
                  className={cn(
                    'border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer',
                    dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40 hover:bg-muted/30',
                    isBusy && 'opacity-50 pointer-events-none',
                  )}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm font-medium mb-1">Drop files here or click to browse</p>
                  <p className="text-xs text-muted-foreground">Supports PDF, DOCX, TXT — up to 50MB</p>
                  {fileMutation.isPending && (
                    <div className="mt-3 flex items-center justify-center gap-2 text-sm text-primary">
                      <RefreshCw className="w-4 h-4 animate-spin" /> Ingesting…
                    </div>
                  )}
                </div>
                <input ref={fileInputRef} type="file" className="hidden" accept=".pdf,.docx,.txt" multiple onChange={e => handleFiles(e.target.files)} />
              </TabsContent>

              {/* URL */}
              <TabsContent value="url" className="mt-4">
                <div className="flex gap-2">
                  <Input
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    placeholder="https://docs.example.com/guide"
                    className="flex-1 text-sm"
                    onKeyDown={e => { if (e.key === 'Enter') urlMutation.mutate(); }}
                  />
                  <Button onClick={() => urlMutation.mutate()} disabled={!urlInput || urlMutation.isPending} size="sm">
                    {urlMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Link className="w-4 h-4" />}
                    Ingest
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-2">Fetches the page, strips HTML, and chunks the text.</p>
              </TabsContent>

              {/* Text */}
              <TabsContent value="text" className="mt-4 space-y-2">
                <Input
                  value={textSource}
                  onChange={e => setTextSource(e.target.value)}
                  placeholder="Source name (e.g. product-faq)"
                  className="text-sm"
                />
                <textarea
                  value={textInput}
                  onChange={e => setTextInput(e.target.value)}
                  placeholder="Paste your text here…"
                  className="w-full h-32 rounded-md border border-input bg-background px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                />
                <Button onClick={() => textMutation.mutate()} disabled={!textInput || textMutation.isPending} size="sm">
                  {textMutation.isPending ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
                  Ingest Text
                </Button>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Sources list */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm">Ingested Sources</CardTitle>
                <CardDescription className="text-xs mt-0.5">{sources.length} document{sources.length !== 1 ? 's' : ''} in <span className="font-mono">{namespace}</span></CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => qc.invalidateQueries({ queryKey: ['rag-sources', namespace] })}>
                <RefreshCw className={cn('w-3 h-3', sourcesLoading && 'animate-spin')} />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {sources.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">No documents ingested yet.</p>
            ) : (
              <div className="space-y-2">
                {sources.map(source => (
                  <div key={source} className="flex items-center gap-3 py-2 px-3 rounded-lg border bg-white hover:bg-muted/20 group">
                    <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-sm font-mono flex-1 truncate">{source}</span>
                    <button
                      onClick={() => { if (confirm(`Delete "${source}"?`)) deleteMutation.mutate(source); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-destructive/10 hover:text-destructive transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Retrieve test */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Test Retrieval</CardTitle>
            <CardDescription className="text-xs">Run a similarity search to verify what the agent would find.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Enter a test query…"
                className="flex-1 text-sm"
                onKeyDown={e => { if (e.key === 'Enter') retrieveMutation.mutate(); }}
              />
              <Button onClick={() => retrieveMutation.mutate()} disabled={!query || retrieveMutation.isPending} size="sm">
                <Search className="w-4 h-4" /> Search
              </Button>
            </div>

            {results.length > 0 && (
              <div className="space-y-2 mt-2">
                {results.map((r, i) => (
                  <div key={i} className="rounded-lg border p-3 bg-white text-xs space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-muted-foreground">#{i + 1}</span>
                      <Badge variant="secondary" className="text-[10px]">{Math.round(r.score * 100)}% match</Badge>
                    </div>
                    <p className="text-muted-foreground leading-relaxed line-clamp-4">{r.text}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
