# Quick Start Guide: Next.js Wrapper for Data Formulator

This guide will help you set up the Next.js wrapper in **under 30 minutes**.

---

## Prerequisites

- Node.js 18+ and yarn/npm
- Python 3.12+
- Data Formulator repository cloned

---

## Step 1: Create Next.js App (5 minutes)

```bash
# Navigate to your workspace
cd /path/to/your/workspace

# Create new Next.js app
npx create-next-app@latest data-formulator-chat \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*"

cd data-formulator-chat
```

---

## Step 2: Install Dependencies (5 minutes)

```bash
# Core dependencies
yarn add zustand @tanstack/react-query @tanstack/react-query-devtools
yarn add react-hook-form @hookform/resolvers zod
yarn add react-dropzone
yarn add react-markdown remark-gfm
yarn add vega vega-lite react-vega
yarn add class-variance-authority clsx tailwind-merge
yarn add lucide-react

# Initialize shadcn/ui
npx shadcn-ui@latest init

# When prompted:
# - Style: Default
# - Base color: Slate
# - CSS variables: Yes

# Add essential shadcn components
npx shadcn-ui@latest add button card input textarea scroll-area separator toast
```

---

## Step 3: Set Up Environment (2 minutes)

Create `.env.local`:
```bash
NEXT_PUBLIC_PYTHON_BACKEND_URL=http://localhost:5000
```

Create `next.config.js`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async rewrites() {
    return [
      {
        source: '/api/proxy/:path*',
        destination: `${process.env.NEXT_PUBLIC_PYTHON_BACKEND_URL || 'http://localhost:5000'}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
```

---

## Step 4: Create Core Files (10 minutes)

### 4.1 API Client (`lib/api.ts`)

```typescript
export interface ModelConfig {
  endpoint: string;
  model: string;
  api_key: string;
  api_base?: string;
  api_version?: string;
}

export interface TableData {
  name: string;
  rows: Record<string, any>[];
}

export interface DeriveDataRequest {
  token: string;
  model: ModelConfig;
  input_tables: TableData[];
  chart_type: string;
  chart_encodings: Record<string, any>;
  extra_prompt: string;
  language: 'python' | 'sql';
}

export class DataFormulatorAPI {
  private baseUrl: string;

  constructor() {
    this.baseUrl = '/api/proxy';
  }

  async deriveData(request: DeriveDataRequest) {
    const response = await fetch(`${this.baseUrl}/agent/derive-data`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return response.json();
  }

  async testModel(model: ModelConfig) {
    const response = await fetch(`${this.baseUrl}/agent/test-model`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    });
    return response.json();
  }
}

export const api = new DataFormulatorAPI();
```

### 4.2 Chat Store (`lib/store.ts`)

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  type?: 'text' | 'chart';
  data?: any;
}

interface ChatStore {
  messages: Message[];
  addMessage: (message: Omit<Message, 'id'>) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set) => ({
      messages: [],
      addMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, { ...message, id: crypto.randomUUID() }],
        })),
      clearMessages: () => set({ messages: [] }),
    }),
    { name: 'chat-store' }
  )
);
```

### 4.3 Main Chat Page (`app/page.tsx`)

```typescript
'use client';

import { useState } from 'react';
import { useChatStore } from '@/lib/store';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Send } from 'lucide-react';

export default function Home() {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const { messages, addMessage } = useChatStore();

  const handleSend = async () => {
    if (!input.trim()) return;

    // Add user message
    addMessage({ role: 'user', content: input, type: 'text' });
    setInput('');
    setLoading(true);

    try {
      // Example: Test model connectivity
      const result = await api.testModel({
        endpoint: 'openai',
        model: 'gpt-4',
        api_key: process.env.NEXT_PUBLIC_OPENAI_API_KEY || '',
      });

      addMessage({
        role: 'assistant',
        content: JSON.stringify(result, null, 2),
        type: 'text',
      });
    } catch (error) {
      addMessage({
        role: 'assistant',
        content: 'Error: ' + (error as Error).message,
        type: 'text',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="flex h-screen flex-col">
      <div className="border-b p-4">
        <h1 className="text-2xl font-bold">Data Formulator Chat</h1>
      </div>

      <ScrollArea className="flex-1 p-4">
        {messages.map((msg) => (
          <Card
            key={msg.id}
            className={`mb-4 p-4 ${
              msg.role === 'user' ? 'ml-auto max-w-[80%] bg-primary text-primary-foreground' : 'max-w-[80%]'
            }`}
          >
            <pre className="whitespace-pre-wrap text-sm">{msg.content}</pre>
          </Card>
        ))}
        {loading && (
          <Card className="mb-4 max-w-[80%] p-4">
            <p className="text-sm text-muted-foreground">Processing...</p>
          </Card>
        )}
      </ScrollArea>

      <div className="border-t p-4">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about your data..."
            className="min-h-[60px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button onClick={handleSend} disabled={loading}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </main>
  );
}
```

### 4.4 Utils (`lib/utils.ts`)

```typescript
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

---

## Step 5: Start Development Servers (3 minutes)

### Terminal 1: Python Backend
```bash
cd /path/to/data-formulator
python -m venv venv
source venv/bin/activate  # or .\venv\Scripts\activate on Windows
pip install -e .
python -m data_formulator --port 5000
```

### Terminal 2: Next.js Frontend
```bash
cd /path/to/data-formulator-chat
yarn dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Step 6: Test Basic Functionality (5 minutes)

1. Open the app in your browser
2. Type a message and press Enter
3. Verify the message appears in the chat
4. Check that the Python backend is responding

---

## Next Steps

Now that you have a basic chat interface working, you can:

1. **Add Data Upload**: Implement file upload component
2. **Integrate Vega Charts**: Add chart rendering to messages
3. **Connect Real Agents**: Wire up derive-data, refine-data endpoints
4. **Add Streaming**: Implement SSE for real-time responses
5. **Polish UI**: Add sidebar, better message styling, etc.

Refer to `NEXTJS_WRAPPER_PLAN.md` for detailed implementation steps.

---

## Troubleshooting

### Issue: "Failed to fetch"
- Ensure Python backend is running on port 5000
- Check `NEXT_PUBLIC_PYTHON_BACKEND_URL` in `.env.local`
- Verify CORS is enabled (Flask-CORS should handle this)

### Issue: "Module not found"
```bash
# Clear cache and reinstall
rm -rf node_modules .next
yarn install
yarn dev
```

### Issue: Python backend not starting
```bash
# Check Python version
python --version  # Should be 3.12+

# Reinstall dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

---

## Deployment

### Deploy Python Backend to Railway

1. Install Railway CLI: `npm i -g @railway/cli`
2. Login: `railway login`
3. Create project: `railway init`
4. Deploy: `railway up`
5. Set environment variables in Railway dashboard

### Deploy Next.js to Vercel

1. Push code to GitHub
2. Import project in Vercel dashboard
3. Set `NEXT_PUBLIC_PYTHON_BACKEND_URL` to Railway URL
4. Deploy

---

## Minimal Working Example

If you want the absolute minimum to get started:

```bash
# 1. Create app
npx create-next-app@latest my-app --typescript --tailwind --app

# 2. Install only essentials
cd my-app
yarn add zustand

# 3. Create a simple chat page (see Step 4.3)

# 4. Start both servers
# Terminal 1: python -m data_formulator
# Terminal 2: yarn dev

# Done! You have a basic chat interface talking to Data Formulator
```

---

## Resources

- **Full Plan**: See `NEXTJS_WRAPPER_PLAN.md`
- **shadcn/ui Docs**: https://ui.shadcn.com
- **Next.js Docs**: https://nextjs.org/docs
- **Data Formulator**: https://github.com/microsoft/data-formulator

---

**Estimated Total Time**: ~30 minutes for basic setup  
**Recommended**: Follow full plan for production-ready implementation
