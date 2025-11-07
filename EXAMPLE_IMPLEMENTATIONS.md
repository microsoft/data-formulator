# Example Implementations: Next.js Wrapper Components

This document provides complete, copy-paste-ready implementations of key components.

---

## Table of Contents

1. [Complete Chat Interface](#1-complete-chat-interface)
2. [Data Upload with Preview](#2-data-upload-with-preview)
3. [Chart Visualization Component](#3-chart-visualization-component)
4. [Streaming Response Handler](#4-streaming-response-handler)
5. [Custom Hooks](#5-custom-hooks)
6. [API Client](#6-api-client)
7. [State Management](#7-state-management)

---

## 1. Complete Chat Interface

### `components/chat/ChatInterface.tsx`

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import { useDataStore } from '@/lib/store/dataStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatHeader } from './ChatHeader';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Loader2 } from 'lucide-react';

export function ChatInterface() {
  const { currentThread, messages, isProcessing } = useChatStore();
  const { datasets } = useDataStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex h-screen flex-col">
      <ChatHeader />
      
      <Separator />

      {/* Messages Area */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="mx-auto max-w-4xl space-y-4">
          {/* Welcome Message */}
          {messages.length === 0 && (
            <Card className="p-8 text-center">
              <h2 className="mb-4 text-2xl font-bold">Welcome to Data Formulator</h2>
              <p className="mb-6 text-muted-foreground">
                Upload your data and ask questions to generate insights and visualizations.
              </p>
              <div className="grid gap-4 md:grid-cols-3">
                <Card className="p-4 hover:bg-muted/50 transition cursor-pointer">
                  <h3 className="font-semibold mb-2">📊 Visualize Data</h3>
                  <p className="text-sm text-muted-foreground">
                    "Create a bar chart showing sales by region"
                  </p>
                </Card>
                <Card className="p-4 hover:bg-muted/50 transition cursor-pointer">
                  <h3 className="font-semibold mb-2">🔍 Analyze Trends</h3>
                  <p className="text-sm text-muted-foreground">
                    "What are the top 5 products by revenue?"
                  </p>
                </Card>
                <Card className="p-4 hover:bg-muted/50 transition cursor-pointer">
                  <h3 className="font-semibold mb-2">🧹 Clean Data</h3>
                  <p className="text-sm text-muted-foreground">
                    "Remove duplicates and missing values"
                  </p>
                </Card>
              </div>
            </Card>
          )}

          {/* Messages */}
          {messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}

          {/* Processing Indicator */}
          {isProcessing && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Processing your request...</span>
            </div>
          )}
        </div>
      </ScrollArea>

      <Separator />

      {/* Input Area */}
      <div className="p-4">
        <div className="mx-auto max-w-4xl">
          {datasets.length === 0 && (
            <div className="mb-4 rounded-lg bg-yellow-50 dark:bg-yellow-950 p-3 text-sm text-yellow-800 dark:text-yellow-200">
              💡 Tip: Upload data first to start analyzing
            </div>
          )}
          <ChatInput />
        </div>
      </div>
    </div>
  );
}
```

### `components/chat/ChatHeader.tsx`

```typescript
'use client';

import { Button } from '@/components/ui/button';
import { useChatStore } from '@/lib/store/chatStore';
import { useDataStore } from '@/lib/store/dataStore';
import { DataUploadDialog } from '@/components/data/DataUploadDialog';
import { ModelSelector } from '@/components/settings/ModelSelector';
import { Menu, Upload, Settings, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function ChatHeader() {
  const { clearMessages } = useChatStore();
  const { datasets } = useDataStore();

  return (
    <div className="flex items-center justify-between border-b p-4">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold">Data Formulator</h1>
        {datasets.length > 0 && (
          <span className="rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
            {datasets.length} dataset{datasets.length > 1 ? 's' : ''} loaded
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <DataUploadDialog>
          <Button variant="outline" size="sm">
            <Upload className="mr-2 h-4 w-4" />
            Upload Data
          </Button>
        </DataUploadDialog>

        <ModelSelector />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={clearMessages}>
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Chat
            </DropdownMenuItem>
            <DropdownMenuItem>
              <Settings className="mr-2 h-4 w-4" />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
```

---

## 2. Data Upload with Preview

### `components/data/DataUploadDialog.tsx`

```typescript
'use client';

import { useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useDataStore } from '@/lib/store/dataStore';
import { useToast } from '@/components/ui/use-toast';
import { Upload, FileText, Link as LinkIcon } from 'lucide-react';
import Papa from 'papaparse';

interface DataUploadDialogProps {
  children: React.ReactNode;
}

export function DataUploadDialog({ children }: DataUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<any[]>([]);
  const [fileName, setFileName] = useState('');
  const { addDataset } = useDataStore();
  const { toast } = useToast();

  const onDrop = async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;

    setFileName(file.name);

    try {
      const text = await file.text();
      
      if (file.name.endsWith('.json')) {
        const data = JSON.parse(text);
        setPreview(Array.isArray(data) ? data : [data]);
      } else if (file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
        const delimiter = file.name.endsWith('.tsv') ? '\t' : ',';
        Papa.parse(text, {
          header: true,
          delimiter,
          skipEmptyLines: true,
          complete: (results) => {
            setPreview(results.data);
          },
          error: (error) => {
            toast({
              title: 'Parse Error',
              description: error.message,
              variant: 'destructive',
            });
          },
        });
      }
    } catch (error) {
      toast({
        title: 'Upload Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/tab-separated-values': ['.tsv'],
      'application/json': ['.json'],
    },
    maxFiles: 1,
  });

  const handleConfirm = () => {
    if (preview.length > 0) {
      addDataset({
        name: fileName,
        rows: preview,
      });
      toast({
        title: 'Data Uploaded',
        description: `Successfully loaded ${preview.length} rows from ${fileName}`,
      });
      setOpen(false);
      setPreview([]);
      setFileName('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
        <DialogHeader>
          <DialogTitle>Upload Data</DialogTitle>
          <DialogDescription>
            Upload a CSV, TSV, or JSON file, paste data, or provide a URL
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="file" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="file">
              <Upload className="mr-2 h-4 w-4" />
              File Upload
            </TabsTrigger>
            <TabsTrigger value="paste">
              <FileText className="mr-2 h-4 w-4" />
              Paste Data
            </TabsTrigger>
            <TabsTrigger value="url">
              <LinkIcon className="mr-2 h-4 w-4" />
              From URL
            </TabsTrigger>
          </TabsList>

          <TabsContent value="file" className="space-y-4">
            <div
              {...getRootProps()}
              className="rounded-lg border-2 border-dashed p-8 text-center cursor-pointer hover:border-primary transition"
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              {isDragActive ? (
                <p>Drop the file here...</p>
              ) : (
                <>
                  <p className="mb-2">Drag & drop a data file here</p>
                  <p className="text-sm text-muted-foreground">
                    or click to select a file
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Supports CSV, TSV, JSON (max 50MB)
                  </p>
                </>
              )}
            </div>

            {preview.length > 0 && (
              <div className="space-y-2">
                <h3 className="font-semibold">
                  Preview ({preview.length} rows)
                </h3>
                <div className="overflow-auto max-h-[300px] rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted">
                      <tr>
                        {Object.keys(preview[0]).map((key) => (
                          <th key={key} className="p-2 text-left font-semibold">
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.slice(0, 10).map((row, i) => (
                        <tr key={i} className="border-t">
                          {Object.values(row).map((val: any, j) => (
                            <td key={j} className="p-2">
                              {String(val)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button onClick={handleConfirm} className="w-full">
                  Load Data
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="paste">
            <Textarea
              placeholder="Paste your CSV, TSV, or JSON data here..."
              className="min-h-[300px] font-mono text-sm"
            />
            <Button className="w-full mt-4">Parse Data</Button>
          </TabsContent>

          <TabsContent value="url">
            <div className="space-y-4">
              <input
                type="url"
                placeholder="https://example.com/data.csv"
                className="w-full rounded-lg border p-2"
              />
              <Button className="w-full">Fetch Data</Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 3. Chart Visualization Component

### `components/visualization/ChartRenderer.tsx`

```typescript
'use client';

import { VegaLite } from 'react-vega';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Download, Maximize2, Code } from 'lucide-react';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CodeBlock } from '@/components/shared/CodeBlock';
import type { VisualizationSpec } from 'vega-embed';

interface ChartRendererProps {
  spec: VisualizationSpec;
  code?: string;
  explanation?: string;
}

export function ChartRenderer({ spec, code, explanation }: ChartRendererProps) {
  const [showCode, setShowCode] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const handleDownload = async () => {
    try {
      const canvas = document.querySelector('canvas');
      if (canvas) {
        const url = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'chart.png';
        link.href = url;
        link.click();
      }
    } catch (error) {
      console.error('Download failed:', error);
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
          <h3 className="text-sm font-semibold">Visualization</h3>
          <div className="flex gap-1">
            {code && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCode(!showCode)}
              >
                <Code className="h-4 w-4" />
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={handleDownload}>
              <Download className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFullscreen(true)}>
              <Maximize2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="p-4">
          <VegaLite spec={spec} actions={false} />
        </div>

        {explanation && (
          <div className="border-t bg-muted/50 p-4 text-sm">
            <p className="font-semibold mb-2">Explanation:</p>
            <p className="text-muted-foreground">{explanation}</p>
          </div>
        )}

        {showCode && code && (
          <div className="border-t p-4">
            <CodeBlock code={code} language="python" />
          </div>
        )}
      </Card>

      <Dialog open={fullscreen} onOpenChange={setFullscreen}>
        <DialogContent className="max-w-[90vw] max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>Fullscreen View</DialogTitle>
          </DialogHeader>
          <div className="overflow-auto">
            <VegaLite
              spec={{ ...spec, width: 'container', height: 600 }}
              actions={false}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

---

## 4. Streaming Response Handler

### `lib/api/streaming.ts`

```typescript
export interface StreamChunk {
  type: 'delta' | 'data' | 'error' | 'done';
  content?: string;
  data?: any;
  error?: string;
}

export async function handleStreamingResponse(
  url: string,
  body: any,
  onChunk: (chunk: StreamChunk) => void,
  onComplete?: () => void,
  onError?: (error: Error) => void
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No reader available');
    }

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        onChunk({ type: 'done' });
        onComplete?.();
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      
      // Keep the last incomplete line in the buffer
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const data = JSON.parse(line);
          
          if (data.status === 'error') {
            onChunk({ type: 'error', error: data.result || data.error_message });
          } else if (data.type === 'delta') {
            onChunk({ type: 'delta', content: data.content });
          } else {
            onChunk({ type: 'data', data: data.result || data });
          }
        } catch (e) {
          console.error('Failed to parse chunk:', line, e);
        }
      }
    }
  } catch (error) {
    console.error('Streaming error:', error);
    onError?.(error as Error);
    onChunk({ type: 'error', error: (error as Error).message });
  }
}

// Usage example:
// await handleStreamingResponse(
//   '/api/agent/clean-data-stream',
//   requestBody,
//   (chunk) => {
//     if (chunk.type === 'delta') {
//       // Append text
//       updateMessage(chunk.content);
//     } else if (chunk.type === 'data') {
//       // Final data received
//       setFinalData(chunk.data);
//     }
//   },
//   () => console.log('Stream complete'),
//   (error) => console.error('Stream error:', error)
// );
```

---

## 5. Custom Hooks

### `hooks/useChat.ts`

```typescript
'use client';

import { useState } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import { useDataStore } from '@/lib/store/dataStore';
import { api } from '@/lib/api/client';
import { useToast } from '@/components/ui/use-toast';

export function useChat() {
  const [isProcessing, setIsProcessing] = useState(false);
  const { addMessage } = useChatStore();
  const { datasets } = useDataStore();
  const { toast } = useToast();

  const sendMessage = async (content: string) => {
    setIsProcessing(true);

    try {
      // Add user message
      addMessage({
        role: 'user',
        content,
        type: 'text',
      });

      // Get model config (simplified - implement proper selection)
      const modelConfig = {
        endpoint: 'openai',
        model: 'gpt-4',
        api_key: process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
      };

      // Call derive-data endpoint
      const response = await api.deriveData({
        token: crypto.randomUUID(),
        model: modelConfig,
        input_tables: datasets,
        chart_type: '',
        chart_encodings: {},
        extra_prompt: content,
        language: 'python',
      });

      if (response.status === 'ok' && response.results[0]) {
        const result = response.results[0];

        if (result.status === 'ok') {
          // Add chart message
          addMessage({
            role: 'assistant',
            content: result.explanation || 'Here is your visualization',
            type: 'chart',
            data: result.content,
            metadata: {
              code: result.code,
            },
          });
        } else {
          // Add error message
          addMessage({
            role: 'assistant',
            content: `Error: ${result.content}`,
            type: 'text',
          });
        }
      }
    } catch (error) {
      console.error('Chat error:', error);
      
      addMessage({
        role: 'assistant',
        content: `Sorry, I encountered an error: ${(error as Error).message}`,
        type: 'text',
      });

      toast({
        title: 'Error',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return {
    sendMessage,
    isProcessing,
  };
}
```

### `hooks/useDataProcessing.ts`

```typescript
'use client';

import { useState } from 'react';
import { api } from '@/lib/api/client';
import { useDataStore } from '@/lib/store/dataStore';

export function useDataProcessing() {
  const [isLoading, setIsLoading] = useState(false);
  const { datasets, updateDataset } = useDataStore();

  const cleanData = async (datasetName: string, instructions: string) => {
    setIsLoading(true);
    
    try {
      const dataset = datasets.find(d => d.name === datasetName);
      if (!dataset) throw new Error('Dataset not found');

      const result = await api.cleanData({
        token: crypto.randomUUID(),
        model: {
          endpoint: 'openai',
          model: 'gpt-4',
          api_key: process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
        },
        prompt: instructions,
        artifacts: [{ type: 'data', data: dataset.rows }],
        dialog: [],
      });

      if (result.status === 'ok' && result.result[0]) {
        updateDataset(datasetName, {
          rows: result.result[0].content,
        });
        return result.result[0];
      }
    } catch (error) {
      console.error('Clean data error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  const transformData = async (
    prompt: string,
    chartType: string,
    encodings: Record<string, any>
  ) => {
    setIsLoading(true);

    try {
      const result = await api.deriveData({
        token: crypto.randomUUID(),
        model: {
          endpoint: 'openai',
          model: 'gpt-4',
          api_key: process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
        },
        input_tables: datasets,
        chart_type: chartType,
        chart_encodings: encodings,
        extra_prompt: prompt,
        language: 'python',
      });

      return result;
    } catch (error) {
      console.error('Transform data error:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    cleanData,
    transformData,
    isLoading,
  };
}
```

---

## 6. Complete API Client

### `lib/api/client.ts`

```typescript
import type {
  ModelConfig,
  TableData,
  DeriveDataRequest,
  DeriveDataResponse,
} from '@/types/api';

class DataFormulatorAPI {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || '/api/proxy';
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    return response.json();
  }

  async getSession(): Promise<{ status: string; session_id: string }> {
    const data = await this.request<{ status: string; session_id: string }>(
      '/get-session-id',
      {
        method: 'POST',
        body: JSON.stringify({ session_id: this.sessionId }),
      }
    );
    this.sessionId = data.session_id;
    return data;
  }

  async testModel(model: ModelConfig) {
    return this.request('/agent/test-model', {
      method: 'POST',
      body: JSON.stringify({ model }),
    });
  }

  async deriveData(request: DeriveDataRequest): Promise<DeriveDataResponse> {
    return this.request('/agent/derive-data', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async refineData(request: any) {
    return this.request('/agent/refine-data', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async cleanData(request: any) {
    return this.request('/agent/clean-data', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async getRecommendations(request: any) {
    return this.request('/agent/get-recommendation-questions', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }

  async generateReport(request: any) {
    return this.request('/agent/generate-report-stream', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  }
}

export const api = new DataFormulatorAPI();
```

---

## 7. Complete State Management

### `lib/store/chatStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  type: 'text' | 'chart' | 'table' | 'code';
  data?: any;
  metadata?: {
    code?: string;
    explanation?: string;
    timestamp?: Date;
  };
}

interface ChatState {
  messages: Message[];
  isProcessing: boolean;
  
  addMessage: (message: Omit<Message, 'id'>) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  deleteMessage: (id: string) => void;
  clearMessages: () => void;
  setProcessing: (isProcessing: boolean) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      messages: [],
      isProcessing: false,

      addMessage: (message) =>
        set((state) => ({
          messages: [
            ...state.messages,
            {
              ...message,
              id: crypto.randomUUID(),
              metadata: {
                ...message.metadata,
                timestamp: new Date(),
              },
            },
          ],
        })),

      updateMessage: (id, updates) =>
        set((state) => ({
          messages: state.messages.map((msg) =>
            msg.id === id ? { ...msg, ...updates } : msg
          ),
        })),

      deleteMessage: (id) =>
        set((state) => ({
          messages: state.messages.filter((msg) => msg.id !== id),
        })),

      clearMessages: () => set({ messages: [] }),

      setProcessing: (isProcessing) => set({ isProcessing }),
    }),
    {
      name: 'chat-store',
      partialize: (state) => ({ messages: state.messages }),
    }
  )
);
```

### `lib/store/dataStore.ts`

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Dataset {
  name: string;
  rows: Record<string, any>[];
  metadata?: {
    columns?: string[];
    rowCount?: number;
    uploadedAt?: Date;
  };
}

interface DataState {
  datasets: Dataset[];
  
  addDataset: (dataset: Dataset) => void;
  updateDataset: (name: string, updates: Partial<Dataset>) => void;
  removeDataset: (name: string) => void;
  clearDatasets: () => void;
}

export const useDataStore = create<DataState>()(
  persist(
    (set) => ({
      datasets: [],

      addDataset: (dataset) =>
        set((state) => ({
          datasets: [
            ...state.datasets,
            {
              ...dataset,
              metadata: {
                columns: Object.keys(dataset.rows[0] || {}),
                rowCount: dataset.rows.length,
                uploadedAt: new Date(),
                ...dataset.metadata,
              },
            },
          ],
        })),

      updateDataset: (name, updates) =>
        set((state) => ({
          datasets: state.datasets.map((ds) =>
            ds.name === name ? { ...ds, ...updates } : ds
          ),
        })),

      removeDataset: (name) =>
        set((state) => ({
          datasets: state.datasets.filter((ds) => ds.name !== name),
        })),

      clearDatasets: () => set({ datasets: [] }),
    }),
    { name: 'data-store' }
  )
);
```

---

## Usage Examples

### Example 1: Send a message and get a chart

```typescript
import { useChat } from '@/hooks/useChat';

function MyComponent() {
  const { sendMessage, isProcessing } = useChat();

  const handleSubmit = async () => {
    await sendMessage('Create a bar chart showing sales by month');
  };

  return (
    <button onClick={handleSubmit} disabled={isProcessing}>
      {isProcessing ? 'Processing...' : 'Generate Chart'}
    </button>
  );
}
```

### Example 2: Upload and preview data

```typescript
import { DataUploadDialog } from '@/components/data/DataUploadDialog';
import { Button } from '@/components/ui/button';

function MyComponent() {
  return (
    <DataUploadDialog>
      <Button>Upload CSV</Button>
    </DataUploadDialog>
  );
}
```

### Example 3: Render a chart

```typescript
import { ChartRenderer } from '@/components/visualization/ChartRenderer';

function MyComponent() {
  const vegaSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    data: { values: [{ a: 'A', b: 28 }, { a: 'B', b: 55 }] },
    mark: 'bar',
    encoding: {
      x: { field: 'a', type: 'nominal' },
      y: { field: 'b', type: 'quantitative' },
    },
  };

  return <ChartRenderer spec={vegaSpec} />;
}
```

---

## Best Practices

1. **Error Handling**: Always wrap API calls in try-catch blocks
2. **Loading States**: Show loading indicators during async operations
3. **Optimistic Updates**: Update UI immediately, then sync with server
4. **Type Safety**: Use TypeScript interfaces for all API requests/responses
5. **Accessibility**: Use semantic HTML and ARIA labels
6. **Performance**: Lazy load heavy components (Vega charts, code editors)
7. **Security**: Never expose API keys in client-side code
8. **Testing**: Write unit tests for hooks and components

---

## Next Steps

1. Copy these components into your Next.js project
2. Install missing dependencies
3. Adjust imports based on your project structure
4. Test each component individually
5. Integrate into your main chat interface
6. Add error handling and loading states
7. Style according to your design system

---

**Ready to build!** 🚀

These components provide a solid foundation for your Data Formulator wrapper. Customize them to fit your specific needs.
