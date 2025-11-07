# Data Formulator Next.js Wrapper - Executive Summary

## Overview

This repository now contains a complete implementation plan to create a modern TypeScript wrapper around Data Formulator using Next.js, shadcn/ui, and Tailwind CSS. The goal is to create an embeddable chat interface deployable on Vercel with minimal configuration.

---

## 📚 Documentation Structure

### 1. **NEXTJS_WRAPPER_PLAN.md** - Comprehensive Technical Plan
   - **What**: Complete architectural design and implementation roadmap
   - **Who**: For architects and senior developers
   - **When to use**: Before starting implementation to understand the full scope
   - **Key sections**:
     - Architecture overview
     - Technology stack decisions
     - 6-week implementation timeline
     - Component structure
     - API integration strategy
     - Deployment options

### 2. **NEXTJS_QUICKSTART.md** - Get Started in 30 Minutes
   - **What**: Step-by-step guide to set up a basic working prototype
   - **Who**: For developers who want to start coding immediately
   - **When to use**: To validate the approach or build a quick proof of concept
   - **Key sections**:
     - Prerequisites
     - Project initialization
     - Basic chat interface
     - Testing connectivity
     - Troubleshooting

### 3. **DEPLOYMENT_GUIDE.md** - Production Deployment
   - **What**: Complete guide for deploying to production
   - **Who**: For DevOps engineers and deployment teams
   - **When to use**: When ready to deploy to staging/production
   - **Key sections**:
     - 4 deployment options (Vercel+Railway, Cloud Run, Fly.io, etc.)
     - Environment configuration
     - Security checklist
     - Cost estimation
     - Monitoring setup

### 4. **EXAMPLE_IMPLEMENTATIONS.md** - Ready-to-Use Code
   - **What**: Copy-paste-ready React components and utilities
   - **Who**: For frontend developers building the UI
   - **When to use**: During active development for reference implementations
   - **Key sections**:
     - Complete chat interface components
     - Data upload with preview
     - Chart rendering
     - Streaming handlers
     - Custom hooks
     - State management

---

## 🎯 Quick Decision Matrix

### Choose Your Path:

| Your Goal | Start Here | Then Go To |
|-----------|------------|------------|
| **Understand the architecture** | NEXTJS_WRAPPER_PLAN.md | All others |
| **Build a quick prototype** | NEXTJS_QUICKSTART.md | EXAMPLE_IMPLEMENTATIONS.md |
| **Deploy to production** | DEPLOYMENT_GUIDE.md | NEXTJS_WRAPPER_PLAN.md (security) |
| **Implement specific features** | EXAMPLE_IMPLEMENTATIONS.md | NEXTJS_WRAPPER_PLAN.md (context) |

---

## 🏗️ Architecture at a Glance

```
┌─────────────────────────────────────────┐
│   User's Browser / Embedded iframe      │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  Next.js Frontend (Vercel)              │
│  • Chat Interface (shadcn/ui)           │
│  • Data Upload                          │
│  • Vega-Lite Charts                     │
│  • State: Zustand + React Query         │
└─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│  Python Backend (Railway/Cloud Run)     │
│  • Flask API                            │
│  • AI Agents (LiteLLM)                  │
│  • Data Processing                      │
└─────────────────────────────────────────┘
```

---

## 🚀 Implementation Timeline

### Week 1: Setup & Foundation
- Initialize Next.js project
- Install shadcn/ui and dependencies
- Create TypeScript types
- Set up API client structure

### Week 2: API Integration
- Create proxy API routes
- Implement session management
- Test core endpoints
- Set up error handling

### Week 3: Chat Interface
- Build chat UI components
- Implement message rendering
- Add file upload
- Create sidebar navigation

### Week 4: Visualization
- Integrate Vega-Lite charts
- Add data table views
- Implement code highlighting
- Create chart interactions

### Week 5: Deployment
- Deploy Python backend
- Deploy Next.js to Vercel
- Configure environment variables
- End-to-end testing

### Week 6: Polish & Testing
- Add loading states
- Improve error messages
- Write unit tests
- Performance optimization

**Total**: 6 weeks for production-ready application  
**MVP**: 2-3 weeks for basic functionality

---

## 💻 Technology Stack

### Frontend
- **Framework**: Next.js 14+ (App Router)
- **Language**: TypeScript 5+
- **UI**: shadcn/ui + Tailwind CSS
- **State**: Zustand + React Query
- **Charts**: Vega-Lite
- **Forms**: react-hook-form + zod

### Backend
- **Existing**: Python Flask (keep as-is)
- **AI**: LiteLLM (supports OpenAI, Anthropic, etc.)
- **Database**: DuckDB (optional)

### Deployment
- **Frontend**: Vercel
- **Backend**: Railway (recommended) or Cloud Run
- **Estimated Cost**: $45-70/month for production

---

## 🎨 Key Features

### Chat-First Interface
- ✅ Natural language queries
- ✅ Inline data upload
- ✅ Real-time visualizations
- ✅ Streaming responses
- ✅ Code inspection

### Data Handling
- ✅ CSV, TSV, JSON support
- ✅ Drag & drop upload
- ✅ Data preview
- ✅ Multi-table joins
- ✅ Data cleaning

### Visualizations
- ✅ Interactive Vega-Lite charts
- ✅ Export to PNG
- ✅ Fullscreen mode
- ✅ Multiple chart types

### Developer Experience
- ✅ Full TypeScript support
- ✅ Component library (shadcn/ui)
- ✅ Hot reload
- ✅ Easy deployment

---

## 🔒 Security Considerations

### Development
- Environment variables for secrets
- Input validation with Zod
- CORS configuration

### Production
- HTTPS only (automatic on Vercel)
- Rate limiting
- API key rotation
- No persistent storage by default
- CSP headers
- Sanitized error messages

---

## 📊 Success Criteria

### MVP Requirements
- [ ] User can upload CSV/JSON data
- [ ] User can ask questions in natural language
- [ ] System generates visualizations
- [ ] User can refine visualizations
- [ ] Charts are interactive
- [ ] Deployed on Vercel
- [ ] Clean, modern UI
- [ ] Mobile responsive

### Performance Targets
- ⚡ First Contentful Paint < 1.5s
- ⚡ Time to Interactive < 3s
- ⚡ API response time < 5s
- ⚡ Chart render time < 500ms

### Quality Targets
- 📊 TypeScript coverage: 100%
- 🧪 Test coverage: >80%
- ♿ Accessibility: WCAG 2.1 AA
- 📱 Mobile responsive

---

## 🛠️ Development Workflow

### 1. Initial Setup (Day 1)
```bash
# Create Next.js app
npx create-next-app@latest data-formulator-chat --typescript --tailwind --app

# Install dependencies
cd data-formulator-chat
yarn add zustand @tanstack/react-query react-hook-form zod vega vega-lite react-vega

# Initialize shadcn/ui
npx shadcn-ui@latest init
npx shadcn-ui@latest add button card dialog input textarea scroll-area
```

### 2. Start Development (Day 1-2)
```bash
# Terminal 1: Python backend
cd /path/to/data-formulator
python -m data_formulator --port 5000

# Terminal 2: Next.js frontend
cd /path/to/data-formulator-chat
yarn dev
```

### 3. Build MVP (Week 1-2)
- Copy components from EXAMPLE_IMPLEMENTATIONS.md
- Wire up API endpoints
- Test basic chat flow
- Add data upload

### 4. Deploy to Staging (Week 3)
```bash
# Deploy Python to Railway
railway up

# Deploy Next.js to Vercel
vercel --prod
```

### 5. Polish & Launch (Week 4-6)
- Add error handling
- Improve loading states
- Write tests
- Performance optimization
- Production deployment

---

## 📦 Deliverables

### Phase 1: MVP (2-3 weeks)
- ✅ Basic chat interface
- ✅ Data upload (CSV/JSON)
- ✅ Simple visualizations
- ✅ Deployed to Vercel staging

### Phase 2: Production (4-6 weeks)
- ✅ Full feature parity with original app
- ✅ Streaming responses
- ✅ Multi-table support
- ✅ Report generation
- ✅ Production deployment
- ✅ Documentation

### Phase 3: Enhancements (Optional)
- ⚠️ Authentication (Auth.js)
- ⚠️ Real-time collaboration
- ⚠️ Custom chart templates
- ⚠️ Mobile app (React Native)

---

## 🔗 Embedding Options

### Option 1: Standalone Web App
```typescript
// Deploy to your-app.vercel.app
// Access directly at https://your-app.vercel.app/chat
```

### Option 2: iframe Embedding
```html
<iframe 
  src="https://your-app.vercel.app/chat?embed=true"
  width="100%"
  height="600px"
  frameborder="0"
></iframe>
```

### Option 3: React Component
```typescript
import { EmbeddableChat } from '@your-org/data-formulator-next';

<EmbeddableChat 
  theme="dark"
  apiUrl="https://your-backend.railway.app"
/>
```

### Option 4: Web Component
```html
<data-formulator-chat
  api-url="https://your-backend.railway.app"
  theme="dark"
></data-formulator-chat>

<script src="https://your-app.vercel.app/embed.js"></script>
```

---

## 🆘 Getting Help

### Resources
- **Original Data Formulator**: [GitHub Repo](https://github.com/microsoft/data-formulator)
- **Discord Community**: [Join Here](https://discord.gg/mYCZMQKYZb)
- **Next.js Docs**: https://nextjs.org/docs
- **shadcn/ui**: https://ui.shadcn.com

### Common Issues
- **Python backend not connecting**: Check `NEXT_PUBLIC_PYTHON_BACKEND_URL`
- **CORS errors**: Ensure Flask-CORS is installed
- **Build failures**: Clear `.next` cache and rebuild
- **Deployment issues**: Check environment variables in Vercel dashboard

---

## 🎉 Next Steps

1. **Read**: Start with NEXTJS_QUICKSTART.md to build a prototype
2. **Review**: Read NEXTJS_WRAPPER_PLAN.md for full context
3. **Code**: Use EXAMPLE_IMPLEMENTATIONS.md as reference
4. **Deploy**: Follow DEPLOYMENT_GUIDE.md for production
5. **Share**: Give feedback to improve this plan!

---

## 📝 Notes

### What's Different from Original?
- **UI**: Material-UI → shadcn/ui
- **State**: Redux → Zustand + React Query
- **Build**: Vite → Next.js
- **Focus**: Complex UI → Simple chat interface
- **Deployment**: Self-hosted → Vercel + Railway

### What Stays the Same?
- ✅ Python backend agents (core logic)
- ✅ Vega-Lite visualizations
- ✅ Data transformation logic
- ✅ AI prompt engineering
- ✅ Multi-model support (OpenAI, Anthropic, etc.)

---

## 🏁 Ready to Start?

Open **NEXTJS_QUICKSTART.md** and follow the 30-minute setup guide!

---

**Created**: November 7, 2025  
**Version**: 1.0  
**Status**: ✅ Ready for Implementation  
**Estimated Effort**: 6 weeks (MVP in 2-3 weeks)
