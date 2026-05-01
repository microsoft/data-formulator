# Agent 知识系统与推理日志

> 状态：已实现，设计文档已瘦身  
> 最后更新：2026-04-28  
> 开发规范：`dev-guides/10-agent-knowledge-reasoning-log.md`  
> 后续改进：`design-docs/15.2-knowledge-system-followup-improvements.md`

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


| 能力                   | 实现位置                                                                 | 状态  |
| -------------------- | -------------------------------------------------------------------- | --- |
| `ConfinedDir` 扩展 API | `py-src/data_formulator/security/path_safety.py`                     | 已实现 |
| 推理日志                 | `py-src/data_formulator/agents/reasoning_log.py`                     | 已实现 |
| DataAgent 推理日志埋点     | `py-src/data_formulator/agents/data_agent.py`                        | 已实现 |
| 知识存储                 | `py-src/data_formulator/knowledge/store.py`                          | 已实现 |
| 知识 API               | `py-src/data_formulator/routes/knowledge.py`                         | 已实现 |
| 知识 API 注册            | `py-src/data_formulator/app.py`                                      | 已实现 |
| DataAgent 知识注入和工具    | `py-src/data_formulator/agents/data_agent.py`                        | 已实现 |
| 其他 Agent 知识集成        | `py-src/data_formulator/agents/agent_*.py`                           | 已实现 |
| 经验提炼 Agent           | `py-src/data_formulator/agents/agent_experience_distill.py`          | 已实现 |
| 前端 API client        | `src/api/knowledgeApi.ts`                                            | 已实现 |
| 前端知识状态管理             | `src/app/useKnowledgeStore.ts`                                       | 已实现 |
| 知识面板                 | `src/views/KnowledgePanel.tsx`                                       | 已实现 |
| Rules 快捷编辑器迁移        | `src/views/AgentRulesDialog.tsx`                                     | 已实现 |
| 保存为经验入口              | `src/views/SaveExperienceButton.tsx`、`src/views/DataThreadCards.tsx` | 已实现 |
| 侧栏知识入口               | `src/views/DataSourceSidebar.tsx`                                    | 已实现 |


## 已落地的关键行为

### 推理日志

`ReasoningLogger` 写入：

```text
DATA_FORMULATOR_HOME/
└── agent-logs/
    └── <date>/
        └── <safe_identity_id>/
            └── <session_id>-<agent_type>.jsonl
```

`DF_AGENT_LOG` 支持：


| 值         | 行为                     |
| --------- | ---------------------- |
| `off`（默认） | 不写日志                   |
| `on`      | 写结构化摘要                 |
| `verbose` | 写调用方传入的更完整 kwargs，并做脱敏 |


DataAgent 已记录 `session_start`、`context_built`、`knowledge_search`、`llm_request`、`llm_response`、`tool_execution`、`action_execution`、`repair_attempt`、`session_end` 等事件。

### 知识系统

用户知识库存储在：

```text
<user_home>/knowledge/
├── rules/
├── skills/
└── experiences/
```

目录约束：

- `rules`: 只允许 `file.md`
- `skills`: 最多 `folder/file.md`
- `experiences`: 最多 `folder/file.md`

所有读写均通过 `KnowledgeStore` 和 `ConfinedDir`。知识 API 使用：

```text
POST /api/knowledge/limits
POST /api/knowledge/list
POST /api/knowledge/read
POST /api/knowledge/write
POST /api/knowledge/delete
POST /api/knowledge/search
POST /api/knowledge/distill-experience
```

### Agent 集成

当前落地模式：

- DataAgent：注入 always-apply rules，自动搜索相关 rules/skills/experiences，并提供 `search_knowledge` / `read_knowledge` 工具。
- DataTransformationAgent、DataRecAgent：注入 rules。
- DataLoadingAgent：搜索 skills。
- InteractiveExploreAgent、ChartInsightAgent：搜索 experiences。

知识不可用时必须优雅降级，不影响原有 Agent 流程。

### 经验提炼

保存经验使用前端提交的当前可见 `experience_context`，不读取管理员推理日志。前端只在当前分析链最后一个 leaf derived table 上展示保存入口。

`experience_context` 包含当前可见链上的 `dialog`、`interaction`、`result_summary`、`execution_attempts`。如果用户删除了中间 table，被删除节点不会进入经验上下文。

## 与原设计的差异

以下差异以代码实现为准，已经写入 `dev-guides/10-agent-knowledge-reasoning-log.md`：

- `DF_AGENT_LOG` 默认值是 `off`，不是原设计中的 `on`。
- `verbose` 模式支持记录并脱敏调用方传入的完整 kwargs；DataAgent 当前埋点没有把完整 `messages` 传给 logger，因此不会自动记录完整 conversation。
- `on` 模式当前会记录 `session_start.user_question` 和 `knowledge_search.query` 等问题文本；这与原设计中“on 模式不记录用户数据原文”的严格表述不同，当前开发规范已按实际实现说明。
- 知识 API 实现为 `/api/knowledge/list|read|write|delete|search` 的 POST body 参数形式，不是 `/<category>/list` REST 形式。
- 推理日志事件实际使用 `llm_request` / `llm_response`，不是统一的 `llm_call`。
- Rules 支持 `description` 和 `alwaysApply` front matter 字段。
- 前端知识状态使用 `useKnowledgeStore` React hook，不使用 Redux slice。
- 保存经验从前端可见上下文提炼，不依赖读取推理日志。

## 未完成事项

仍需保留并后续处理的事项见 `design-docs/15.2-knowledge-system-followup-improvements.md`：

1. `KnowledgeStore.search()` 仍是整串子串匹配，需要升级为分词加权匹配。
2. `test_relevant_knowledge_injected` 的断言仍有无命中兜底，需要在搜索修复后加强。
3. `KnowledgeStore.list_all()` / `search()` 内部读取风格尚未统一为 `jail.read_text(rel)`。
4. 推理日志 `on` 模式是否应继续记录 `user_question` / `query` 需要产品/安全取舍；如果恢复原设计的严格隐私目标，需要收紧 DataAgent 埋点并补测试。

“保存为经验按钮位置与 experience_context 边界”已经基本实现：`DataThreadCards.tsx` 只在 `isLeafDerivedTable()` 为 true 时渲染 `SaveExperienceButton`，`SaveExperienceButton.tsx` 会从当前可见 leaf chain 构建 `experience_context`。

## 文档处置

- 已迁移到开发规范：`dev-guides/10-agent-knowledge-reasoning-log.md`
- 已完成开发计划：`design-docs/15.1-agent-knowledge-reasoning-log-dev-plan.md`
- 仍需保留的 follow-up：`design-docs/15.2-knowledge-system-followup-improvements.md`
- 仍需保留的 follow-up：`design-docs/15.3-agent-knowledge-injection-and-search-plan.md`

如果后续完成 `15.2` `15.3` 的未完成项，可以把对应最终规范补进 `dev-guides/10`，然后删除 。

## 关联文档

- `dev-guides/10-agent-knowledge-reasoning-log.md`
- `design-docs/15.1-agent-knowledge-reasoning-log-dev-plan.md`
- `design-docs/15.2-knowledge-system-followup-improvements.md`
- `dev-guides/8-path-safety.md`
- `dev-guides/2-log-sanitization.md`
- `dev-guides/7-unified-error-handling.md`
- `dev-guides/6-i18n-language-injection.md`

