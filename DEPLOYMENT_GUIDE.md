# Deployment Guide: Next.js + Python Backend

This guide covers deploying the complete Data Formulator Chat application to production.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         User Browser                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Vercel (Next.js Frontend)                       │
│  - Static Site Generation (SSG) for landing pages           │
│  - Client-side rendering for chat interface                 │
│  - API routes for session management                        │
│  - Edge functions for caching                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│         Railway/Cloud Run (Python Backend)                   │
│  - Flask app with AI agents                                 │
│  - DuckDB for large data (optional)                         │
│  - LiteLLM for model API calls                              │
└─────────────────────────────────────────────────────────────┘
```

---

## Option 1: Vercel + Railway (Recommended)

**Best for**: Quick setup, automatic deployments, excellent DX

### Part A: Deploy Python Backend to Railway

#### 1. Prepare Python App

Create `railway.toml` in your Data Formulator root:

```toml
[build]
builder = "NIXPACKS"
buildCommand = "pip install -e ."

[deploy]
startCommand = "python -m data_formulator --port $PORT --disable-database --disable-display-keys"
healthcheckPath = "/api/hello"
healthcheckTimeout = 100
restartPolicyType = "ON_FAILURE"
restartPolicyMaxRetries = 10

[env]
PYTHON_VERSION = "3.12"
```

Create `.railwayignore`:
```
node_modules/
dist/
.next/
.git/
*.log
```

#### 2. Deploy to Railway

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Link to new project or existing
railway link

# Add environment variables
railway variables set OPENAI_API_KEY=your-key-here
railway variables set OPENAI_ENABLED=true
railway variables set OPENAI_MODELS=gpt-4,gpt-3.5-turbo
# Add other model providers as needed

# Deploy
railway up

# Get the URL
railway domain
# This will give you something like: https://your-app.railway.app
```

#### 3. Test Deployment

```bash
curl https://your-app.railway.app/api/hello
```

### Part B: Deploy Next.js Frontend to Vercel

#### 1. Prepare Next.js App

Create `vercel.json`:

```json
{
  "framework": "nextjs",
  "buildCommand": "yarn build",
  "devCommand": "yarn dev",
  "installCommand": "yarn install"
}
```

Update `next.config.js`:

```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
        ],
      },
    ];
  },

  async rewrites() {
    // Only use in development - use direct API calls in production
    if (process.env.NODE_ENV === 'development') {
      return [
        {
          source: '/api/proxy/:path*',
          destination: 'http://localhost:5000/api/:path*',
        },
      ];
    }
    return [];
  },
};

module.exports = nextConfig;
```

#### 2. Deploy to Vercel

**Method 1: CLI**
```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel

# Set environment variable
vercel env add NEXT_PUBLIC_PYTHON_BACKEND_URL production

# Enter your Railway URL when prompted:
# https://your-app.railway.app

# Deploy to production
vercel --prod
```

**Method 2: GitHub Integration (Recommended)**

1. Push your Next.js code to GitHub:
```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/your-username/data-formulator-chat.git
git push -u origin main
```

2. Go to [Vercel Dashboard](https://vercel.com/dashboard)
3. Click "Import Project"
4. Select your GitHub repository
5. Configure:
   - **Framework Preset**: Next.js
   - **Environment Variables**:
     - `NEXT_PUBLIC_PYTHON_BACKEND_URL` = `https://your-app.railway.app`
6. Click "Deploy"

#### 3. Configure Custom Domain (Optional)

1. In Vercel dashboard, go to Settings > Domains
2. Add your custom domain (e.g., `chat.yourdomain.com`)
3. Follow DNS configuration instructions

---

## Option 2: Vercel + Google Cloud Run

**Best for**: Better control, containerization, GCP ecosystem

### Part A: Deploy Python Backend to Cloud Run

#### 1. Create Dockerfile

Create `Dockerfile` in Data Formulator root:

```dockerfile
FROM python:3.12-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application
COPY py-src/ ./py-src/
COPY pyproject.toml .
COPY MANIFEST.in .
COPY README.md .

# Install package
RUN pip install -e .

# Set environment
ENV PORT=8080
ENV PYTHONUNBUFFERED=1

EXPOSE 8080

# Run the app
CMD exec python -m data_formulator --port $PORT --disable-database --disable-display-keys
```

Create `.dockerignore`:

```
node_modules/
dist/
.next/
.git/
*.log
venv/
__pycache__/
*.pyc
```

#### 2. Build and Deploy

```bash
# Set project ID
export PROJECT_ID=your-gcp-project-id
export SERVICE_NAME=data-formulator-api

# Build image
gcloud builds submit --tag gcr.io/$PROJECT_ID/$SERVICE_NAME

# Deploy to Cloud Run
gcloud run deploy $SERVICE_NAME \
  --image gcr.io/$PROJECT_ID/$SERVICE_NAME \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "OPENAI_API_KEY=your-key,OPENAI_ENABLED=true,OPENAI_MODELS=gpt-4" \
  --memory 2Gi \
  --cpu 2 \
  --timeout 300 \
  --max-instances 10

# Get the URL
gcloud run services describe $SERVICE_NAME --region us-central1 --format='value(status.url)'
```

#### 3. Configure Environment Variables

```bash
gcloud run services update $SERVICE_NAME \
  --region us-central1 \
  --set-env-vars "OPENAI_API_KEY=your-key,OPENAI_ENABLED=true,OPENAI_MODELS=gpt-4,ANTHROPIC_API_KEY=your-key,ANTHROPIC_ENABLED=true,ANTHROPIC_MODELS=claude-3-5-sonnet-20241022"
```

### Part B: Deploy Next.js to Vercel

Same as Option 1, but use your Cloud Run URL for `NEXT_PUBLIC_PYTHON_BACKEND_URL`:

```bash
vercel env add NEXT_PUBLIC_PYTHON_BACKEND_URL production
# Enter: https://data-formulator-api-xxxxx-uc.a.run.app
```

---

## Option 3: All-in-One Vercel Deployment

**Best for**: Simplicity, single platform

⚠️ **Note**: This requires wrapping Python in Next.js API routes, which may have cold start issues.

### 1. Install Python Runtime for Vercel

```bash
yarn add @vercel/python
```

### 2. Create Vercel Configuration

Create `vercel.json`:

```json
{
  "functions": {
    "api/python/*.py": {
      "runtime": "python3.12",
      "maxDuration": 60
    }
  }
}
```

### 3. Create Python API Route

Create `api/python/derive-data.py`:

```python
from http.server import BaseHTTPRequestHandler
import json
import sys
import os

# Add the py-src directory to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../../py-src'))

from data_formulator.agents.agent_py_data_transform import PythonDataTransformationAgent
from data_formulator.agents.client_utils import Client

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        content_length = int(self.headers['Content-Length'])
        post_data = self.rfile.read(content_length)
        data = json.loads(post_data.decode('utf-8'))
        
        # Process request
        client = Client(
            data['model']['endpoint'],
            data['model']['model'],
            data['model']['api_key']
        )
        
        agent = PythonDataTransformationAgent(client=client, exec_python_in_subprocess=False)
        results = agent.run(
            data['input_tables'],
            data['extra_prompt'],
            data['chart_type'],
            data['chart_encodings'],
            []
        )
        
        # Send response
        self.send_response(200)
        self.send_header('Content-type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps({
            'token': data['token'],
            'status': 'ok',
            'results': results
        }).encode())
```

⚠️ **Limitations of this approach**:
- Cold starts (3-5 seconds)
- 60-second timeout limit
- Limited memory
- No WebSocket/SSE support
- **Not recommended for production**

---

## Option 4: Fly.io (Python + Next.js)

**Best for**: Global edge deployment, low latency

### Deploy Both Together

Create `fly.toml`:

```toml
app = "data-formulator-chat"
primary_region = "sea"

[build]
  dockerfile = "Dockerfile.flyio"

[env]
  PORT = "8080"
  NODE_ENV = "production"

[[services]]
  http_checks = []
  internal_port = 8080
  processes = ["app"]
  protocol = "tcp"
  script_checks = []

  [[services.ports]]
    force_https = true
    handlers = ["http"]
    port = 80

  [[services.ports]]
    handlers = ["tls", "http"]
    port = 443

  [[services.tcp_checks]]
    grace_period = "1s"
    interval = "15s"
    restart_limit = 0
    timeout = "2s"

[resources]
  memory = "2gb"
  cpu_kind = "shared"
  cpus = 2
```

Create `Dockerfile.flyio`:

```dockerfile
# Build Next.js
FROM node:18-alpine AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

# Build Python + Next.js runtime
FROM python:3.12-slim
WORKDIR /app

# Install Node.js
RUN apt-get update && apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Copy Python app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY py-src/ ./py-src/
COPY pyproject.toml .
RUN pip install -e .

# Copy Next.js build
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules

# Start script
COPY start.sh .
RUN chmod +x start.sh

ENV PORT=8080
EXPOSE 8080

CMD ["./start.sh"]
```

Create `start.sh`:

```bash
#!/bin/bash

# Start Python backend in background
python -m data_formulator --port 5000 --disable-database &

# Wait for Python to start
sleep 5

# Start Next.js
cd /app && PORT=8080 node_modules/.bin/next start
```

Deploy:

```bash
fly launch
fly deploy
fly secrets set OPENAI_API_KEY=your-key
```

---

## Environment Variables Reference

### Next.js Frontend

```bash
# Required
NEXT_PUBLIC_PYTHON_BACKEND_URL=https://your-backend-url.com

# Optional
NEXT_PUBLIC_ANALYTICS_ID=your-analytics-id
NEXT_PUBLIC_SENTRY_DSN=your-sentry-dsn
```

### Python Backend

```bash
# Model Providers (at least one required)
OPENAI_ENABLED=true
OPENAI_API_KEY=sk-...
OPENAI_MODELS=gpt-4,gpt-3.5-turbo

ANTHROPIC_ENABLED=true
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODELS=claude-3-5-sonnet-20241022,claude-3-opus-20240229

AZURE_ENABLED=true
AZURE_API_KEY=...
AZURE_API_BASE=https://your-resource.openai.azure.com
AZURE_API_VERSION=2024-02-15-preview
AZURE_MODELS=gpt-4

# Optional
DISABLE_DATABASE=true
DISABLE_DISPLAY_KEYS=true
EXEC_PYTHON_IN_SUBPROCESS=false
```

---

## Monitoring & Observability

### 1. Add Sentry for Error Tracking

```bash
# Next.js
yarn add @sentry/nextjs

# Initialize
npx @sentry/wizard@latest -i nextjs
```

### 2. Add Vercel Analytics

```bash
yarn add @vercel/analytics
```

In `app/layout.tsx`:
```typescript
import { Analytics } from '@vercel/analytics/react';

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
```

### 3. Railway Metrics

Railway provides built-in metrics:
- CPU usage
- Memory usage
- Request latency
- Error rates

Access via Railway dashboard > Metrics tab

---

## Cost Estimation

### Free Tier (Development)

| Service | Free Tier |
|---------|-----------|
| Vercel | 100GB bandwidth, unlimited requests |
| Railway | $5 free credit/month |
| Cloud Run | 2 million requests/month |

**Total**: ~$0-5/month for low usage

### Production (Medium Traffic)

| Service | Cost |
|---------|------|
| Vercel Pro | $20/month |
| Railway (1GB RAM) | ~$15/month |
| Cloud Run (avg) | ~$10-30/month |
| **Total** | **~$45-70/month** |

---

## Security Checklist

- [ ] Environment variables set (never commit secrets)
- [ ] HTTPS enabled (automatic on Vercel/Railway)
- [ ] Rate limiting enabled (use Vercel Edge Config)
- [ ] CORS configured properly
- [ ] Input validation on all endpoints
- [ ] API keys rotated regularly
- [ ] Error messages sanitized (no stack traces to client)
- [ ] Database disabled for stateless deployment
- [ ] CSP headers configured
- [ ] Dependencies updated regularly

---

## Troubleshooting

### Issue: "Failed to connect to Python backend"

**Solution**:
```bash
# Check Python backend is running
curl https://your-backend-url.com/api/hello

# Check environment variable
echo $NEXT_PUBLIC_PYTHON_BACKEND_URL

# Verify CORS is enabled
# In agent_routes.py, add:
from flask_cors import CORS
CORS(app)
```

### Issue: "Cold start timeout on Vercel Python"

**Solution**: Use separate Python deployment (Railway/Cloud Run), not Vercel Python runtime.

### Issue: "Railway out of memory"

**Solution**: Upgrade Railway plan or optimize memory usage:
```bash
railway up --service-plan starter  # $5/month
```

### Issue: "Next.js build fails on Vercel"

**Solution**:
```bash
# Clear cache
rm -rf .next node_modules
yarn install
yarn build

# Or in Vercel dashboard:
# Settings > General > Clear Build Cache
```

---

## Rollback Procedure

### Vercel

```bash
# List deployments
vercel list

# Promote previous deployment
vercel promote <deployment-url>
```

### Railway

```bash
# List deployments
railway status

# Rollback
railway rollback
```

---

## Next Steps After Deployment

1. **Set up monitoring**: Sentry, Vercel Analytics
2. **Configure custom domain**: Point DNS to Vercel
3. **Add authentication**: Implement Auth.js if needed
4. **Enable caching**: Use Vercel Edge Config for API responses
5. **Load testing**: Use Artillery or k6 to test performance
6. **Documentation**: Write API docs for team

---

## Support

- **Vercel**: https://vercel.com/docs
- **Railway**: https://docs.railway.app
- **Cloud Run**: https://cloud.google.com/run/docs
- **Data Formulator**: https://github.com/microsoft/data-formulator

---

**Recommended Stack**: Vercel (Next.js) + Railway (Python)  
**Deploy Time**: ~15 minutes  
**Estimated Cost**: $45-70/month for production
