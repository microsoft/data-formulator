# Agent 知识系统与推理日志

> 状态：已实现，设计文档已瘦身
> 最后更新：2026-05
> 开发规范：`dev-guides/10-agent-knowledge-reasoning-log.md`

## 结论

Agent 知识系统、推理日志、经验提炼和前端知识面板已经落地。原始设计中的实现细节已经迁移到 `dev-guides/10-agent-knowledge-reasoning-log.md`，本文只保留目标、最终架构、实现状态和未完成事项索引。

已通过后端回归验证：

```bash
python -m pytest \
  tests/backend/agents/test_reasoning_logger.py \
  tests/backend/knowledge/test_knowledge_store.py \
  tests/backend/routes/test_knowledge_routes.py \
  tests/backend/agents/test_agent_knowledge_integration.py -q
```

当前结果：`103 passed`。

## 目标回顾

本设计最初要为 Agent 系统增加两类能力：

1. **推理日志（Reasoning Log）**：独立于应用 logger，以 JSONL 结构化记录 DataAgent 会话关键路径，用于开发调试、prompt 调优和后续经验提炼。
2. **知识系统（Knowledge Base）**：以 Markdown 文件形式管理 `rules`、`skills`、`experiences`，供 Agent 注入、搜索和读取。

两者关系：推理日志是调试和审计原始材料；经验是从用户确认的分析上下文中提炼出的可复用知识。

## 最终架构

| 能力 | 实现位置 | 状态 |
|---|---|---|
| `ConfinedDir` 扩展 API | `security/path_safety.py` | 已实现 |
| 推理日志 | `agents/reasoning_log.py` | 已实现 |
| DataAgent 推理日志埋点 | `agents/data_agent.py` | 已实现 |
| 知识存储 | `knowledge/store.py` | 已实现 |
| 知识 API | `routes/knowledge.py` | 已实现 |
| DataAgent 知识注入和工具 | `agents/data_agent.py` | 已实现 |
| 其他 Agent 知识集成 | `agents/agent_*.py` | 已实现 |
| 经验提炼 Agent | `agents/agent_experience_distill.py` | 已实现 |
| 前端 API client | `src/api/knowledgeApi.ts` | 已实现 |
| 前端知识状态管理 | `src/app/useKnowledgeStore.ts` | 已实现 |
| 知识面板 | `src/views/KnowledgePanel.tsx` | 已实现 |
| Rules 快捷编辑器迁移 | `src/views/AgentRulesDialog.tsx` | 已实现 |
| 保存为经验入口 | `SaveExperienceButton.tsx`、`DataThreadCards.tsx` | 已实现 |
| 侧栏知识入口 | `src/views/DataSourceSidebar.tsx` | 已实现 |

## 已落地的关键行为

### 推理日志

`ReasoningLogger` 写入 `DATA_FORMULATOR_HOME/agent-logs/<date>/<safe_identity_id>/<session_id>-<agent_type>.jsonl`。

`DF_AGENT_LOG` 支持 `off`（默认）/ `on`（结构化摘要）/ `verbose`（完整 kwargs + 脱敏）。

DataAgent 已记录 `session_start`、`context_built`、`knowledge_search`、`llm_request`、`llm_response`、`tool_execution`、`action_execution`、`repair_attempt`、`session_end` 等事件。

### 知识系统

存储在 `<user_home>/knowledge/{rules,skills,experiences}/`。目录约束：rules 只允许 `file.md`，skills/experiences 最多 `folder/file.md`。

知识 API：`POST /api/knowledge/{limits,list,read,write,delete,search,distill-experience}`。

### Agent 集成

- DataAgent：注入 always-apply rules + 自动搜索 + `search_knowledge` / `read_knowledge` 工具
- DataTransformationAgent、DataRecAgent：注入 always rules
- DataLoadingAgent：搜索 skills
- InteractiveExploreAgent、ChartInsightAgent：搜索 experiences

知识不可用时优雅降级。

### 经验提炼

前端只在 leaf derived table 上展示保存入口。`experience_context` 从当前可见链构建，排除已删除节点。

## 与原设计的差异

以下差异以代码实现为准，已写入 `dev-guides/10-agent-knowledge-reasoning-log.md`：

- `DF_AGENT_LOG` 默认 `off`（非原设计的 `on`）
- `on` 模式记录 `user_question` / `query`（原设计要求不记录原文）
- 知识 API 用 POST body 参数（非 REST `/<category>/list`）
- 推理日志用 `llm_request` / `llm_response`（非 `llm_call`）
- Rules 支持 `description` 和 `alwaysApply` front matter
- 前端用 `useKnowledgeStore` hook（非 Redux slice）
- 保存经验从前端可见上下文提炼（不读取推理日志）

## 未完成事项

### 小改进（`15.2`）

见 `design-docs/15.2-knowledge-system-followup-improvements.md`：

1. ~~搜索策略改进~~ — 已实现（分词 + 多词加权匹配）
2. `test_relevant_knowledge_injected` 断言需加强
3. `list_all` / `search` 文件读取风格统一（低优先级）
4. 推理日志 `on` 模式内容策略（产品/安全取舍）

### 架构演进（`15.3`）

见 `design-docs/15.3-agent-knowledge-injection-and-search-plan.md`：

- Agent 注入矩阵对齐（部分 Agent 缺少 always rules）
- DuckDB 知识索引
- `KnowledgeSearchService` 共享搜索服务
- `KnowledgeOrchestratorAgent` 任务编排
- 上下文压缩与自动记忆（未来规划）

## 关联文档

- `dev-guides/10-agent-knowledge-reasoning-log.md`
- `design-docs/15.2-knowledge-system-followup-improvements.md`
- `design-docs/15.3-agent-knowledge-injection-and-search-plan.md`
