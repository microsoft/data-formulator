# Next.js TypeScript Wrapper Plan for Data Formulator

## Executive Summary

This plan outlines the strategy to create a modern TypeScript wrapper around Data Formulator using Next.js 14+ (App Router), shadcn/ui, and Tailwind CSS. The goal is to create a clean, embeddable web chat interface that can be deployed on Vercel with minimal configuration while maintaining the core functionality of Data Formulator.

---

## 1. Project Architecture Overview

### 1.1 Current Architecture
- **Backend**: Flask (Python) server with REST API endpoints
- **Frontend**: React + Vite + Material-UI + Redux Toolkit
- **Data Processing**: Python agents using LiteLLM for various AI operations
- **Database**: DuckDB for large dataset handling (optional)
- **Visualization**: Vega-Lite charts via react-vega

### 1.2 Target Architecture
```
┌─────────────────────────────────────────────────────────────┐
│                     Next.js Application                      │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Frontend (App Router + shadcn/ui + Tailwind)          │ │
│  │  - Chat Interface                                       │ │
│  │  - Data Visualization                                   │ │
│  │  - File Upload/Data Loading                            │ │
│  └────────────────────────────────────────────────────────┘ │
│                           │                                  │
│                           ▼                                  │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Next.js API Routes (/api/*)                           │ │
│  │  - Proxy to Python Backend                             │ │
│  │  - Session Management                                   │ │
│  │  - Authentication (future)                              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Python Backend (Flask)                          │
│  - Agent Routes (/api/agent/*)                              │
│  - Table Routes (/api/tables/*)                             │
│  - Core AI/ML Processing                                     │
│  - Can be deployed separately or as serverless functions    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

### 2.1 Frontend Stack
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript 5+
- **UI Library**: shadcn/ui (Radix UI primitives)
- **Styling**: Tailwind CSS 3+
- **State Management**: 
  - Zustand (lightweight alternative to Redux)
  - React Query/TanStack Query for server state
- **Charts**: 
  - Vega-Lite with custom wrapper
  - Or recharts (if Vega-Lite integration is complex)
- **File Upload**: react-dropzone
- **Forms**: react-hook-form + zod validation
- **Markdown**: react-markdown
- **Code Highlighting**: shiki or prism-react-renderer

### 2.2 Backend Integration
- **API Client**: Native fetch with TypeScript types
- **Streaming**: Server-Sent Events (SSE) or WebSocket for real-time updates
- **Python Backend**: 
  - Option A: Keep Flask backend, deploy on separate service (Railway, Fly.io, Cloud Run)
  - Option B: Wrap Python agents in Next.js API routes using Python child processes
  - **Recommended**: Option A for simplicity

### 2.3 Deployment
- **Frontend**: Vercel (optimal for Next.js)
- **Backend**: 
  - Railway.app (simple Python deployment)
  - Google Cloud Run (containerized)
  - Fly.io (edge deployment)
  - AWS Lambda + API Gateway (serverless)

---

## 3. Implementation Plan

### Phase 1: Project Setup & Infrastructure (Week 1)

#### 3.1 Initialize Next.js Project
```bash
# Create new Next.js app with TypeScript
npx create-next-app@latest data-formulator-next --typescript --tailwind --app --use-yarn

# Navigate to project
cd data-formulator-next

# Install core dependencies
yarn add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-select
yarn add class-variance-authority clsx tailwind-merge lucide-react
yarn add zustand @tanstack/react-query
yarn add react-hook-form zod @hookform/resolvers
yarn add react-dropzone
yarn add react-markdown remark-gfm rehype-raw
yarn add vega vega-lite react-vega

# Dev dependencies
yarn add -D @types/node @types/react @types/react-dom
```

#### 3.2 Initialize shadcn/ui
```bash
# Initialize shadcn/ui
npx shadcn-ui@latest init

# Add core components
npx shadcn-ui@latest add button
npx shadcn-ui@latest add card
npx shadcn-ui@latest add dialog
npx shadcn-ui@latest add dropdown-menu
npx shadcn-ui@latest add input
npx shadcn-ui@latest add select
npx shadcn-ui@latest add textarea
npx shadcn-ui@latest add toast
npx shadcn-ui@latest add tabs
npx shadcn-ui@latest add table
npx shadcn-ui@latest add scroll-area
npx shadcn-ui@latest add separator
npx shadcn-ui@latest add badge
npx shadcn-ui@latest add progress
npx shadcn-ui@latest add skeleton
```

#### 3.3 Project Structure
```
data-formulator-next/
├── app/
│   ├── layout.tsx                 # Root layout
│   ├── page.tsx                   # Landing/chat page
│   ├── api/                       # API routes (proxy to Python)
│   │   ├── agent/
│   │   │   ├── derive-data/route.ts
│   │   │   ├── refine-data/route.ts
│   │   │   ├── clean-data-stream/route.ts
│   │   │   └── ...
│   │   ├── tables/
│   │   │   └── ...
│   │   └── session/route.ts
│   └── chat/
│       └── page.tsx               # Main chat interface
├── components/
│   ├── ui/                        # shadcn components
│   ├── chat/
│   │   ├── ChatInterface.tsx
│   │   ├── ChatMessage.tsx
│   │   ├── ChatInput.tsx
│   │   └── ChatSidebar.tsx
│   ├── data/
│   │   ├── DataUpload.tsx
│   │   ├── DataTable.tsx
│   │   └── DataPreview.tsx
│   ├── visualization/
│   │   ├── ChartRenderer.tsx
│   │   ├── VegaChart.tsx
│   │   └── ChartControls.tsx
│   └── shared/
│       ├── LoadingSpinner.tsx
│       ├── ErrorBoundary.tsx
│       └── CodeBlock.tsx
├── lib/
│   ├── api/
│   │   ├── client.ts             # API client with typed endpoints
│   │   ├── types.ts              # TypeScript types from Python API
│   │   └── streaming.ts          # SSE handler
│   ├── store/
│   │   ├── chatStore.ts          # Zustand store for chat state
│   │   ├── dataStore.ts          # Zustand store for data state
│   │   └── uiStore.ts            # Zustand store for UI state
│   └── utils/
│       ├── cn.ts                 # Class name utility
│       └── format.ts             # Data formatting utilities
├── types/
│   ├── api.ts                    # API response/request types
│   ├── chat.ts                   # Chat-related types
│   └── data.ts                   # Data-related types
├── hooks/
│   ├── useChat.ts                # Custom hook for chat
│   ├── useDataProcessing.ts      # Custom hook for data processing
│   └── useVisualization.ts       # Custom hook for visualizations
└── public/
    └── assets/
```

---

### Phase 2: Core API Integration (Week 2)

#### 4.1 Create TypeScript Types from Python API

Create `types/api.ts`:
```typescript
// Model configuration
export interface ModelConfig {
  id: string;
  endpoint: 'openai' | 'azure' | 'anthropic' | 'gemini' | 'ollama';
  model: string;
  api_key: string;
  api_base?: string;
  api_version?: string;
}

// Session management
export interface SessionResponse {
  status: 'ok' | 'error';
  session_id: string;
}

// Data types
export interface TableData {
  name: string;
  rows: Record<string, any>[];
}

export interface ChartEncoding {
  x?: string;
  y?: string;
  color?: string;
  size?: string;
  // ... other Vega-Lite encodings
}

// Agent responses
export interface AgentResult {
  status: 'ok' | 'error';
  content?: any;
  code?: string;
  dialog?: any[];
  explanation?: string;
}

export interface DeriveDataRequest {
  token: string;
  model: ModelConfig;
  input_tables: TableData[];
  chart_type: string;
  chart_encodings: ChartEncoding;
  extra_prompt: string;
  language: 'python' | 'sql';
  max_repair_attempts?: number;
  agent_coding_rules?: string;
}

export interface DeriveDataResponse {
  token: string;
  status: 'ok' | 'error';
  results: AgentResult[];
}

// ... more types for all endpoints
```

#### 4.2 Create API Client

Create `lib/api/client.ts`:
```typescript
import type { 
  SessionResponse, 
  ModelConfig,
  DeriveDataRequest,
  DeriveDataResponse 
} from '@/types/api';

const PYTHON_BACKEND_URL = process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || 'http://localhost:5000';

class DataFormulatorAPI {
  private baseUrl: string;
  private sessionId: string | null = null;

  constructor(baseUrl: string = PYTHON_BACKEND_URL) {
    this.baseUrl = baseUrl;
  }

  async getSession(): Promise<SessionResponse> {
    const response = await fetch(`${this.baseUrl}/api/get-session-id`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: this.sessionId })
    });
    const data = await response.json();
    this.sessionId = data.session_id;
    return data;
  }

  async deriveData(request: DeriveDataRequest): Promise<DeriveDataResponse> {
    const response = await fetch(`${this.baseUrl}/api/agent/derive-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });
    return response.json();
  }

  // Streaming endpoint
  async cleanDataStream(
    request: any,
    onChunk: (chunk: any) => void
  ): Promise<void> {
    const response = await fetch(`${this.baseUrl}/api/agent/clean-data-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request)
    });

    const reader = response.body?.getReader();
    const decoder = new TextDecoder();

    if (!reader) throw new Error('No reader available');

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      const chunk = decoder.decode(value);
      const lines = chunk.split('\n').filter(Boolean);
      
      for (const line of lines) {
        try {
          const data = JSON.parse(line);
          onChunk(data);
        } catch (e) {
          console.error('Failed to parse chunk:', e);
        }
      }
    }
  }

  // ... implement all other endpoints
}

export const apiClient = new DataFormulatorAPI();
```

#### 4.3 Create Next.js API Routes (Proxy Layer)

Create `app/api/agent/derive-data/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';

const PYTHON_BACKEND_URL = process.env.PYTHON_BACKEND_URL || 'http://localhost:5000';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/agent/derive-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
```

---

### Phase 3: Chat Interface UI (Week 3)

#### 5.1 Create Zustand Store for Chat

Create `lib/store/chatStore.ts`:
```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  data?: any; // For chart data, tables, etc.
  type?: 'text' | 'chart' | 'table' | 'code';
}

interface Thread {
  id: string;
  messages: Message[];
  title: string;
  createdAt: Date;
}

interface ChatState {
  threads: Thread[];
  currentThreadId: string | null;
  
  // Actions
  createThread: (title: string) => void;
  addMessage: (threadId: string, message: Omit<Message, 'id' | 'timestamp'>) => void;
  setCurrentThread: (threadId: string) => void;
  deleteThread: (threadId: string) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      threads: [],
      currentThreadId: null,
      
      createThread: (title) => {
        const newThread: Thread = {
          id: crypto.randomUUID(),
          title,
          messages: [],
          createdAt: new Date(),
        };
        set((state) => ({
          threads: [...state.threads, newThread],
          currentThreadId: newThread.id,
        }));
      },
      
      addMessage: (threadId, message) => {
        set((state) => ({
          threads: state.threads.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  messages: [
                    ...thread.messages,
                    {
                      ...message,
                      id: crypto.randomUUID(),
                      timestamp: new Date(),
                    },
                  ],
                }
              : thread
          ),
        }));
      },
      
      setCurrentThread: (threadId) => set({ currentThreadId: threadId }),
      
      deleteThread: (threadId) =>
        set((state) => ({
          threads: state.threads.filter((t) => t.id !== threadId),
          currentThreadId: state.currentThreadId === threadId ? null : state.currentThreadId,
        })),
    }),
    { name: 'chat-store' }
  )
);
```

#### 5.2 Create Chat Components

Create `components/chat/ChatInterface.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { useChatStore } from '@/lib/store/chatStore';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { ChatSidebar } from './ChatSidebar';
import { ScrollArea } from '@/components/ui/scroll-area';

export function ChatInterface() {
  const { threads, currentThreadId } = useChatStore();
  const currentThread = threads.find(t => t.id === currentThreadId);

  return (
    <div className="flex h-screen">
      <ChatSidebar />
      
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="border-b px-6 py-4">
          <h1 className="text-2xl font-bold">
            {currentThread?.title || 'Data Formulator'}
          </h1>
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-6 py-4">
          {currentThread?.messages.map((message) => (
            <ChatMessage key={message.id} message={message} />
          ))}
        </ScrollArea>

        {/* Input */}
        <div className="border-t px-6 py-4">
          <ChatInput />
        </div>
      </div>
    </div>
  );
}
```

Create `components/chat/ChatMessage.tsx`:
```typescript
'use client';

import { Card } from '@/components/ui/card';
import { ChartRenderer } from '@/components/visualization/ChartRenderer';
import { DataTable } from '@/components/data/DataTable';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { cn } from '@/lib/utils/cn';
import ReactMarkdown from 'react-markdown';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  data?: any;
  type?: 'text' | 'chart' | 'table' | 'code';
}

interface ChatMessageProps {
  message: Message;
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div className={cn('mb-4 flex', isUser ? 'justify-end' : 'justify-start')}>
      <Card className={cn(
        'max-w-[80%] p-4',
        isUser ? 'bg-primary text-primary-foreground' : 'bg-muted'
      )}>
        {/* Text content */}
        {message.type === 'text' && (
          <ReactMarkdown className="prose dark:prose-invert">
            {message.content}
          </ReactMarkdown>
        )}

        {/* Chart */}
        {message.type === 'chart' && message.data && (
          <ChartRenderer spec={message.data} />
        )}

        {/* Table */}
        {message.type === 'table' && message.data && (
          <DataTable data={message.data} />
        )}

        {/* Code */}
        {message.type === 'code' && (
          <CodeBlock code={message.content} language="python" />
        )}

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground mt-2">
          {new Date(message.timestamp).toLocaleTimeString()}
        </div>
      </Card>
    </div>
  );
}
```

Create `components/chat/ChatInput.tsx`:
```typescript
'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useChatStore } from '@/lib/store/chatStore';
import { useChat } from '@/hooks/useChat';
import { Send, Paperclip } from 'lucide-react';

const formSchema = z.object({
  message: z.string().min(1, 'Message cannot be empty'),
});

export function ChatInput() {
  const { currentThreadId, addMessage } = useChatStore();
  const { sendMessage, isLoading } = useChat();
  
  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: { message: '' },
  });

  const onSubmit = async (values: z.infer<typeof formSchema>) => {
    if (!currentThreadId) return;

    // Add user message
    addMessage(currentThreadId, {
      role: 'user',
      content: values.message,
      type: 'text',
    });

    // Clear input
    form.reset();

    // Send to API and get response
    await sendMessage(currentThreadId, values.message);
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-2">
      <Button type="button" variant="outline" size="icon">
        <Paperclip className="h-4 w-4" />
      </Button>
      
      <Textarea
        {...form.register('message')}
        placeholder="Ask about your data..."
        className="min-h-[60px]"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.handleSubmit(onSubmit)();
          }
        }}
      />
      
      <Button type="submit" disabled={isLoading}>
        <Send className="h-4 w-4" />
      </Button>
    </form>
  );
}
```

---

### Phase 4: Data Handling & Visualization (Week 4)

#### 6.1 Data Upload Component

Create `components/data/DataUpload.tsx`:
```typescript
'use client';

import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Upload } from 'lucide-react';
import { useDataStore } from '@/lib/store/dataStore';

export function DataUpload() {
  const { addDataset } = useDataStore();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    for (const file of acceptedFiles) {
      const text = await file.text();
      
      // Parse CSV/TSV/JSON
      let data;
      if (file.name.endsWith('.json')) {
        data = JSON.parse(text);
      } else if (file.name.endsWith('.csv') || file.name.endsWith('.tsv')) {
        // Use Papa Parse or similar
        data = parseCSV(text, file.name.endsWith('.tsv'));
      }

      addDataset({
        name: file.name,
        rows: data,
      });
    }
  }, [addDataset]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'text/tab-separated-values': ['.tsv'],
      'application/json': ['.json'],
    },
  });

  return (
    <Card {...getRootProps()} className="p-8 text-center cursor-pointer hover:bg-muted/50 transition">
      <input {...getInputProps()} />
      <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
      {isDragActive ? (
        <p>Drop the files here...</p>
      ) : (
        <div>
          <p className="mb-2">Drag & drop data files here</p>
          <p className="text-sm text-muted-foreground">or click to select files</p>
          <p className="text-xs text-muted-foreground mt-2">
            Supports CSV, TSV, JSON
          </p>
        </div>
      )}
    </Card>
  );
}

function parseCSV(text: string, isTSV: boolean): any[] {
  // Simplified CSV parser - use Papa Parse in production
  const delimiter = isTSV ? '\t' : ',';
  const lines = text.split('\n');
  const headers = lines[0].split(delimiter);
  
  return lines.slice(1).map(line => {
    const values = line.split(delimiter);
    return headers.reduce((obj, header, i) => {
      obj[header.trim()] = values[i]?.trim();
      return obj;
    }, {} as Record<string, string>);
  });
}
```

#### 6.2 Chart Renderer

Create `components/visualization/ChartRenderer.tsx`:
```typescript
'use client';

import { VegaLite } from 'react-vega';
import { Card } from '@/components/ui/card';
import type { VisualizationSpec } from 'vega-embed';

interface ChartRendererProps {
  spec: VisualizationSpec;
  width?: number;
  height?: number;
}

export function ChartRenderer({ spec, width = 600, height = 400 }: ChartRendererProps) {
  return (
    <Card className="p-4">
      <VegaLite 
        spec={{
          ...spec,
          width,
          height,
        }} 
        actions={false}
      />
    </Card>
  );
}
```

---

### Phase 5: Deployment Configuration (Week 5)

#### 7.1 Environment Variables

Create `.env.local`:
```bash
# Python Backend URL
NEXT_PUBLIC_PYTHON_BACKEND_URL=http://localhost:5000

# For production
# NEXT_PUBLIC_PYTHON_BACKEND_URL=https://your-python-backend.railway.app
```

Create `.env.example`:
```bash
NEXT_PUBLIC_PYTHON_BACKEND_URL=http://localhost:5000
```

#### 7.2 Vercel Configuration

Create `vercel.json`:
```json
{
  "framework": "nextjs",
  "buildCommand": "yarn build",
  "devCommand": "yarn dev",
  "installCommand": "yarn install",
  "env": {
    "NEXT_PUBLIC_PYTHON_BACKEND_URL": "@python-backend-url"
  }
}
```

#### 7.3 Python Backend Deployment

**Option A: Railway**
Create `railway.toml`:
```toml
[build]
builder = "NIXPACKS"

[deploy]
startCommand = "python -m data_formulator --port $PORT --disable-database"
healthcheckPath = "/api/hello"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10

[[env]]
key = "PYTHON_VERSION"
value = "3.12"
```

**Option B: Docker (for Cloud Run/Fly.io)**
Create `Dockerfile`:
```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY py-src/ ./py-src/
COPY pyproject.toml .
COPY MANIFEST.in .

RUN pip install -e .

ENV PORT=8080
EXPOSE 8080

CMD ["python", "-m", "data_formulator", "--port", "8080", "--disable-database"]
```

---

## 4. Key Features & Implementation Details

### 4.1 Chat-First Interface
- **Primary View**: Chat interface with sidebar for thread management
- **Data Loading**: Inline file upload or paste data in chat
- **Visualizations**: Rendered inline in chat as messages
- **Code Inspection**: Collapsible code blocks with syntax highlighting

### 4.2 Simplified Workflow
1. User uploads data or pastes link
2. User asks question in natural language
3. System generates visualization/analysis
4. User can refine with follow-up questions
5. Export charts or create reports

### 4.3 Core API Endpoints to Wrap
Priority endpoints for MVP:
- ✅ `/api/get-session-id` - Session management
- ✅ `/api/agent/derive-data` - Generate visualizations
- ✅ `/api/agent/refine-data` - Refine existing charts
- ✅ `/api/agent/clean-data-stream` - Data cleaning (streaming)
- ✅ `/api/agent/get-recommendation-questions` - Get AI suggestions
- ⚠️ `/api/tables/*` - Optional if using database mode

### 4.4 State Management Strategy
- **Chat State**: Zustand (persisted to localStorage)
- **Server State**: TanStack Query for caching and revalidation
- **UI State**: Zustand for modals, sidebar, theme
- **Data State**: Zustand for uploaded datasets

---

## 5. Embedding Strategy

### 5.1 Standalone Chat Page
```typescript
// app/chat/page.tsx
export default function ChatPage() {
  return <ChatInterface />;
}
```

### 5.2 Embeddable Component
Create `components/EmbeddableChat.tsx`:
```typescript
'use client';

import { ChatInterface } from './chat/ChatInterface';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/queryClient';

export function EmbeddableChat({ 
  theme = 'light',
  apiUrl,
}: { 
  theme?: 'light' | 'dark';
  apiUrl?: string;
}) {
  return (
    <QueryClientProvider client={queryClient}>
      <div className={theme} data-api-url={apiUrl}>
        <ChatInterface />
      </div>
    </QueryClientProvider>
  );
}
```

### 5.3 iframe Embedding
```html
<!-- Embed in any website -->
<iframe 
  src="https://your-app.vercel.app/chat?embed=true"
  width="100%"
  height="600px"
  frameborder="0"
></iframe>
```

### 5.4 React Component Embedding
```typescript
// In another Next.js/React app
import { EmbeddableChat } from '@your-org/data-formulator-next';

export default function MyApp() {
  return (
    <div>
      <h1>My App</h1>
      <EmbeddableChat 
        theme="dark"
        apiUrl="https://your-python-backend.railway.app"
      />
    </div>
  );
}
```

---

## 6. Migration Strategy

### 6.1 What to Keep from Original
- ✅ Python backend agents (core logic)
- ✅ Vega-Lite chart specifications
- ✅ Data transformation logic
- ✅ AI prompt engineering

### 6.2 What to Replace
- ❌ Material-UI → shadcn/ui
- ❌ Redux Toolkit → Zustand + React Query
- ❌ Vite → Next.js
- ❌ Complex UI → Simplified chat interface
- ❌ SCSS → Tailwind CSS

### 6.3 Gradual Migration Path
1. **Phase 1**: Build Next.js app with API proxy to existing Flask backend
2. **Phase 2**: Implement chat UI and basic data upload
3. **Phase 3**: Add visualization rendering
4. **Phase 4**: Implement streaming responses
5. **Phase 5**: Add advanced features (reports, multi-table joins, etc.)
6. **Phase 6**: Optional - Rewrite Python agents in TypeScript/Edge Functions

---

## 7. Testing Strategy

### 7.1 Unit Tests
```bash
yarn add -D vitest @testing-library/react @testing-library/jest-dom
```

### 7.2 E2E Tests
```bash
yarn add -D @playwright/test
```

### 7.3 Test Coverage
- API client functions
- State management stores
- Chat message rendering
- Data upload and parsing
- Chart rendering

---

## 8. Performance Optimizations

### 8.1 Code Splitting
- Lazy load chart library
- Lazy load code editor
- Dynamic imports for heavy components

### 8.2 Caching Strategy
- React Query for API responses
- Service Worker for offline support
- CDN for static assets

### 8.3 Streaming
- SSE for real-time agent responses
- Incremental chart updates
- Progressive data loading

---

## 9. Security Considerations

### 9.1 API Security
- Environment variables for secrets
- Rate limiting on API routes
- Input validation with Zod
- CORS configuration

### 9.2 Data Privacy
- Client-side data processing when possible
- Session isolation
- No persistent storage by default
- Optional: Add authentication (Auth.js/NextAuth)

---

## 10. Timeline & Milestones

### Week 1: Setup & Infrastructure
- ✅ Initialize Next.js project
- ✅ Set up shadcn/ui
- ✅ Create project structure
- ✅ Set up TypeScript types

### Week 2: API Integration
- ✅ Create API client
- ✅ Create Next.js API routes
- ✅ Implement session management
- ✅ Test core endpoints

### Week 3: Chat UI
- ✅ Build chat interface
- ✅ Implement message rendering
- ✅ Add file upload
- ✅ Create sidebar

### Week 4: Visualization
- ✅ Integrate Vega-Lite
- ✅ Create chart renderer
- ✅ Add data table view
- ✅ Implement code blocks

### Week 5: Deployment
- ✅ Deploy Python backend
- ✅ Deploy Next.js to Vercel
- ✅ Configure environment variables
- ✅ Test end-to-end flow

### Week 6: Polish & Testing
- ✅ Add loading states
- ✅ Error handling
- ✅ Write tests
- ✅ Performance optimization

---

## 11. Future Enhancements

### 11.1 Authentication
- Integrate Auth.js (NextAuth)
- Support OAuth providers
- User session management

### 11.2 Collaboration
- Real-time collaboration (Socket.io)
- Shared chat threads
- Comments on visualizations

### 11.3 Advanced Features
- Custom chart templates
- Database connectors UI
- Report generation
- Export to PowerPoint/PDF

### 11.4 Mobile Support
- Responsive design
- Touch gestures
- Mobile-optimized charts

---

## 12. Success Criteria

### 12.1 MVP Requirements
- ✅ User can upload CSV/JSON data
- ✅ User can ask questions in natural language
- ✅ System generates visualizations
- ✅ User can refine visualizations
- ✅ Charts are interactive
- ✅ Deployed on Vercel
- ✅ Clean, modern UI

### 12.2 Performance Targets
- ⚡ First Contentful Paint < 1.5s
- ⚡ Time to Interactive < 3s
- ⚡ API response time < 5s (excluding AI processing)
- ⚡ Chart render time < 500ms

### 12.3 Quality Targets
- 📊 TypeScript coverage: 100%
- 🧪 Test coverage: >80%
- ♿ Accessibility: WCAG 2.1 AA
- 📱 Mobile responsive

---

## 13. Resources & References

### Documentation
- [Next.js App Router](https://nextjs.org/docs/app)
- [shadcn/ui Components](https://ui.shadcn.com/)
- [Tailwind CSS](https://tailwindcss.com/docs)
- [Vega-Lite](https://vega.github.io/vega-lite/)
- [Zustand](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [TanStack Query](https://tanstack.com/query/latest)

### Deployment
- [Vercel Docs](https://vercel.com/docs)
- [Railway Docs](https://docs.railway.app/)
- [Fly.io Docs](https://fly.io/docs/)

---

## 14. Getting Started Checklist

### Development Setup
- [ ] Clone Data Formulator repository
- [ ] Create new Next.js app in separate directory
- [ ] Install all dependencies
- [ ] Set up shadcn/ui
- [ ] Configure environment variables
- [ ] Start Python backend on localhost:5000
- [ ] Start Next.js dev server
- [ ] Test API connectivity

### First Features
- [ ] Implement session management
- [ ] Create basic chat UI
- [ ] Add file upload component
- [ ] Test data derivation endpoint
- [ ] Render first chart
- [ ] Add error handling

### Deployment
- [ ] Deploy Python backend to Railway
- [ ] Deploy Next.js to Vercel
- [ ] Configure environment variables
- [ ] Test production build
- [ ] Set up monitoring

---

## 15. Contact & Support

For questions or issues:
- Original Data Formulator: [GitHub Issues](https://github.com/microsoft/data-formulator/issues)
- Discord: [Data Formulator Community](https://discord.gg/mYCZMQKYZb)

---

**Last Updated**: November 7, 2025  
**Version**: 1.0  
**Status**: Ready for Implementation
