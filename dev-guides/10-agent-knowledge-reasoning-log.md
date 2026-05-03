# Agent 知识系统与推理日志开发规范

> **维护者**: DF 核心团队  
> **最后更新**: 2026-04-28  
> **适用范围**: 后端 Agent、知识库路由、推理日志、前端知识面板、保存经验流程

本规范记录已经落地的 Agent 知识系统、推理日志和经验提炼实现。设计背景和历史计划见 `design-docs/15-agent-knowledge-reasoning-log.md`；仍未完成的后续优化见 `design-docs/15.2-knowledge-system-followup-improvements.md`。

## 1. 架构概览

Agent 知识系统由三部分组成：

| 组件 | 位置 | 职责 |
|---|---|---|
| `KnowledgeStore` | `py-src/data_formulator/knowledge/store.py` | 用户知识文件的 CRUD、搜索、front matter 解析、路径安全和内容长度限制 |
| `ReasoningLogger` | `py-src/data_formulator/agents/reasoning_log.py` | DataAgent 会话的结构化 JSONL 调试日志 |
| `ExperienceDistillAgent` | `py-src/data_formulator/agents/agent_experience_distill.py` | 从前端传入的 `experience_context` 提炼可复用经验文档 |

知识库存储在当前用户 home 下：

```text
<user_home>/
└── knowledge/
    ├── rules/
    └── experiences/
```

`rules` 只允许扁平 `.md` 文件；`experiences` 最多允许一级子目录。所有知识文件访问必须通过 `KnowledgeStore`，不要在调用方直接拼接 `Path(user_home) / "knowledge" / user_input`。

## 2. 知识文件格式

知识文件是 Markdown + YAML front matter：

```markdown
---
title: ROI 计算标准
tags: [finance, computation]
created: 2026-04-27
updated: 2026-04-27
source: manual
---

ROI = (revenue - cost) / cost
```

通用字段：

| 字段 | 说明 |
|---|---|
| `title` | 标题。缺失时列表和搜索会退回文件名 stem |
| `tags` | 搜索标签。应使用数组 |
| `created` / `updated` | 日期或时间戳 |
| `source` | `manual` 或 `agent_summarized` |
| `source_context` | 经验提炼来源上下文 ID，可选 |

Rules 额外支持：

| 字段 | 说明 |
|---|---|
| `description` | 规则短描述，最多 `KNOWLEDGE_LIMITS["rule_description_max"]` 字符 |
| `alwaysApply` | `true` 时总是注入 Agent prompt；`false` 时只通过相关知识搜索注入 |

`KnowledgeStore.write()` 会在缺少 front matter 时补一个最小头部，并按 `KNOWLEDGE_LIMITS` 校验正文长度。

## 3. KnowledgeStore

典型用法：

```python
from data_formulator.knowledge.store import KnowledgeStore

store = KnowledgeStore(user_home_path)
items = store.list_all("rules")
content = store.read("rules", "roi.md")
store.write("experiences", "cleaning/missing-values.md", content)
store.delete("experiences", "sales/quarterly-trend.md")
results = store.search("missing values", categories=["experiences"])
```

必须遵守：

- 只使用 `rules`、`experiences` 两个 category。
- 所有知识文件必须是 `.md`。
- `rules` 路径只能是 `file.md`；`experiences` 路径最多是 `folder/file.md`。
- 路径穿越、绝对路径和 symlink 逃逸由 `ConfinedDir` 拦截。
- 搜索结果只返回摘要，完整内容通过 `read()` 读取。

当前搜索实现是大小写不敏感的子串匹配，匹配 title、tags、文件名 stem 和正文前 200 字，并按 title > tags > filename > body 加权。它还不是分词加权搜索；长 query 自动注入命中率有限，见 `design-docs/15.2-knowledge-system-followup-improvements.md`。

## 4. Knowledge API

所有知识 API 在 `py-src/data_formulator/routes/knowledge.py`，Blueprint 前缀为 `/api/knowledge`。所有 application error 遵循统一错误协议：HTTP 200 + `status: "error"`。

| 端点 | 方法 | 请求体 | 说明 |
|---|---|---|---|
| `/api/knowledge/limits` | POST | `{}` | 返回知识正文和 rule 描述长度限制 |
| `/api/knowledge/list` | POST | `{ category }` | 列出某类知识条目 |
| `/api/knowledge/read` | POST | `{ category, path }` | 读取单个知识文件完整内容 |
| `/api/knowledge/write` | POST | `{ category, path, content }` | 创建或更新知识文件 |
| `/api/knowledge/delete` | POST | `{ category, path }` | 删除知识文件 |
| `/api/knowledge/search` | POST | `{ query, categories? }` | 跨类别搜索知识 |
| `/api/knowledge/distill-experience` | POST | `{ experience_context, model, category_hint? }` | 提炼并保存经验 |

路由通过 `get_identity_id()` 和 `get_user_home(identity_id)` 定位当前用户目录。不要让前端传入用户目录、workspace 目录或绝对路径。

## 5. 推理日志

`ReasoningLogger` 是开发调试工具，不是用户可见功能。日志写入：

```text
DATA_FORMULATOR_HOME/
└── agent-logs/
    └── <date>/
        └── <safe_identity_id>/
            └── <session_id>-<agent_type>.jsonl
```

开关由 `DF_AGENT_LOG` 控制：

| 值 | 行为 |
|---|---|
| `off`（默认） | 不创建文件，`log()` 为 no-op |
| `on` | 写结构化摘要，防御性剥离 `messages` 字段 |
| `verbose` | 写更完整的 kwargs，并通过 `log_sanitizer.sanitize_params()` 脱敏 |

DataAgent 当前记录的主要事件：

| 事件 | 说明 |
|---|---|
| `session_start` | 会话开始，包含问题、表名、模型和文本 rules 摘要 |
| `context_built` | 初始上下文构建完成，包含 token 估算和注入知识摘要 |
| `knowledge_search` | 自动知识注入或工具搜索 |
| `llm_request` | 发送 LLM 请求前的计数和工具列表 |
| `llm_response` | LLM 响应延迟、finish_reason 和工具调用摘要 |
| `tool_execution` | Agent 内部工具执行结果摘要 |
| `action_execution` | 用户可见 action 执行结果 |
| `repair_attempt` | 代码修复尝试摘要 |
| `session_end` | 会话结束状态、迭代次数、LLM 调用次数和耗时 |

注意：当前 `on` 模式仍会记录 `user_question` / `query` 等问题文本；如果新增埋点涉及 credentials、连接串、tokens 或原始数据正文，必须先脱敏或只记录摘要。

## 6. Agent 知识集成

路由层通过 `routes/agents.py` 的 `_get_knowledge_store(identity_id)` 创建 `KnowledgeStore`，并传给对应 Agent。知识不可用时必须优雅降级，不能影响原有 Agent 流程。

### 模式 A：Rules 系统提示词注入

适用于 DataAgent、DataTransformationAgent、DataRecAgent。只把 `alwaysApply != false` 的 rules 注入系统提示词；非 always-apply rules 通过搜索注入。

### 模式 B：Library 知识上下文注入

适用于 DataAgent、DataLoadingAgent、InteractiveExploreAgent、ChartInsightAgent。运行时搜索相关 `experiences` 条目，把摘要注入上下文。`KnowledgeStore.search()` 自动跳过 `alwaysApply=true` 的 rules，避免与 system prompt 重复注入。

### 模式 C：DataAgent 工具调用

DataAgent 提供两个内部工具：

- `search_knowledge(query, categories?)`：返回匹配条目的 category、title、path、snippet。
- `read_knowledge(category, path)`：读取完整 Markdown 内容。

工具错误应返回安全、简短的文本结果，并在服务端日志中记录异常类型；不要把 traceback 或内部路径返回给 LLM/用户。

## 7. 经验提炼

前端只在当前可见分析链的 leaf derived table 上展示“保存为经验”按钮。leaf table 的判断标准是：该表是 derived table，且没有其他未 anchored derived table 从它继续派生。

`SaveExperienceButton` 构建 `experience_context` 时，从触发保存的 leaf table 沿当前 Redux 中仍存在的链向上回溯，只收集当前可见链上的：

- `dialog`
- `interaction`
- `result_summary`
- `execution_attempts`

用户已删除的中间节点不会进入经验上下文。`execution_attempts` 只携带失败/修复代码的结构化摘要，不应携带失败代码或修复代码原文。

后端 `/api/knowledge/distill-experience` 使用前端提交的 `experience_context` 调用 `ExperienceDistillAgent`，然后写入 `knowledge/experiences/`。`ExperienceDistillAgent` 的 prompt 引导提取可复用的通用方法论，而非特定案例细节。这个端点不读取管理员推理日志。

## 8. 前端实现约定

相关模块：

| 模块 | 职责 |
|---|---|
| `src/api/knowledgeApi.ts` | Knowledge API client，使用 `fetchWithIdentity` |
| `src/app/useKnowledgeStore.ts` | 知识面板状态管理，使用 React hooks，不走 Redux |
| `src/views/KnowledgePanel.tsx` | 知识树、搜索、编辑、删除 |
| `src/views/AgentRulesDialog.tsx` | knowledge-backed rules 快捷编辑器 |
| `src/views/SaveExperienceButton.tsx` | 保存为经验入口和 `experience_context` 构建 |
| `src/views/DataThreadCards.tsx` | 仅对 leaf derived table 渲染保存经验入口 |
| `src/views/DataSourceSidebar.tsx` | 知识库侧栏入口 |

所有用户可见文本必须走 i18n。知识系统当前使用 `common.json` 的 `knowledge.*` key，新增 key 时必须同步更新 `src/i18n/locales/en/common.json` 和 `src/i18n/locales/zh/common.json`。

跨组件刷新使用自定义事件：

```typescript
window.dispatchEvent(new CustomEvent('knowledge-changed', {
    detail: { category: 'experiences' },
}));
```

`useKnowledgeStore` 监听该事件并刷新指定类别。

## 9. 新模块清单

添加新 Agent 或修改知识集成时：

- [ ] 明确该 Agent 需要 `rules`、`experiences` 中哪些类别。
- [ ] 在 Agent 构造函数中添加可选 `knowledge_store` 参数。
- [ ] 在 `routes/agents.py` 对应路由中传入 `_get_knowledge_store(identity_id)`。
- [ ] 选择集成模式：Rules 注入、上下文注入或 DataAgent 工具调用。
- [ ] 搜索失败时优雅降级，并用 `logger.warning(..., exc_info=True)` 记录。
- [ ] 通过 `KnowledgeStore` 访问知识文件，不直接操作 `knowledge/` 文件系统。
- [ ] 涉及推理日志时尊重 `DF_AGENT_LOG` 开关，并避免记录敏感信息。
- [ ] 涉及前端文本时同步 i18n key。
- [ ] 为新行为添加聚焦测试；后端至少运行相关 `pytest`。

## 10. 测试

后端相关测试：

```bash
python -m pytest \
  tests/backend/agents/test_reasoning_logger.py \
  tests/backend/knowledge/test_knowledge_store.py \
  tests/backend/routes/test_knowledge_routes.py \
  tests/backend/agents/test_agent_knowledge_integration.py -q
```

前端相关流程当前主要依赖手动验证和通用 `yarn test`。修改 `KnowledgePanel`、`SaveExperienceButton` 或 leaf-table 逻辑时，至少手动覆盖：

- 创建、编辑、删除 rules / experiences。
- 搜索知识条目。
- 多步 DataAgent 分析后只在最终 leaf table 显示保存经验按钮。
- 删除中间 table 后，保存经验上下文不包含已删除节点。
- 经验保存成功后知识面板自动刷新。

## 11. 已知后续优化

以下事项尚未完全落地，不应在新代码中假定已经完成：

- `KnowledgeStore.search()` 仍是整串子串匹配，不是分词加权匹配。
- `test_relevant_knowledge_injected` 仍允许无命中兜底，搜索注入效果需要加强测试。
- `KnowledgeStore.list_all()` / `search()` 内部仍有 `Path.read_text()` 风格不统一问题，安全影响低但建议改成 `jail.read_text(rel)`。
