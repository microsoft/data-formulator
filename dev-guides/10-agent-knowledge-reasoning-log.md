# Agent 知识系统与推理日志 — 开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-27
> **适用范围**: 后端 Agent、知识库路由、推理日志、前端知识面板、保存经验流程

## 1. 架构概述

Agent 知识系统由三部分组成：

| 组件 | 位置 | 职责 |
|------|------|------|
| **KnowledgeStore** | `py-src/data_formulator/knowledge/store.py` | 知识文件的 CRUD、搜索、路径安全 |
| **ReasoningLogger** | `py-src/data_formulator/agents/reasoning_log.py` | Agent 会话的结构化 JSONL 日志 |
| **ExperienceDistillAgent** | `py-src/data_formulator/agents/agent_experience_distill.py` | 从推理日志蒸馏出可复用的经验文档 |

### 知识分类

| 类别 | 目录 | 用途 | 注入目标 Agent |
|------|------|------|----------------|
| `rules` | `knowledge/rules/` | 用户自定义编码/探索规则 | DataAgent, DataTransformationAgent, DataRecAgent |
| `skills` | `knowledge/skills/` | 数据清洗/加载技巧 | DataAgent, DataLoadingAgent |
| `experiences` | `knowledge/experiences/` | 分析经验总结 | DataAgent, InteractiveExploreAgent, ChartInsightAgent |

### 文件格式

知识文件为 Markdown + YAML front matter：

```markdown
---
title: 示例规则
tags: [pandas, 编码]
created: "2026-04-27T12:00:00Z"
---

规则正文内容...
```

## 2. KnowledgeStore

### 路径安全

KnowledgeStore 使用 `ConfinedDir` 确保所有文件操作限制在 `user_home/knowledge/` 目录内。

```python
from data_formulator.knowledge.store import KnowledgeStore

store = KnowledgeStore(user_home_path)
items = store.list_all("rules")
content = store.read("rules", "my-rule.md")
store.write("rules", "new-rule.md", content)
store.delete("rules", "old-rule.md")
results = store.search("pandas groupby", categories=["rules", "skills"])
```

### API 路由

所有知识 API 在 `py-src/data_formulator/routes/knowledge.py`，Blueprint 前缀 `/api/knowledge`。

| 端点 | 方法 | 说明 |
|------|------|------|
| `/<category>/list` | GET | 列出某类别所有知识条目 |
| `/<category>/read` | POST | 读取单个知识文件内容 |
| `/<category>/write` | POST | 创建/更新知识文件 |
| `/<category>/delete` | POST | 删除知识文件 |
| `/search` | POST | 跨类别搜索知识 |
| `/distill` | POST | 从推理日志蒸馏经验 |

## 3. 推理日志（ReasoningLogger）

### 开关

通过环境变量 `DF_AGENT_LOG` 控制：

| 值 | 行为 |
|----|------|
| `off`（默认） | 不写日志 |
| `on` | 写入 JSONL 到 `user_home/agent-logs/` |

### 日志事件类型

| 事件 | 字段 | 说明 |
|------|------|------|
| `session_start` | agent, session_id, user_question, input_tables, model, rules_injected, knowledge_injected | 会话开始 |
| `context_built` | system_prompt_tokens, user_msg_tokens, knowledge_rules_injected, knowledge_injected | 上下文构建完成 |
| `knowledge_search` | source, query, table_names, results_count, results | 知识搜索（自动/工具调用） |
| `llm_call` | iteration, prompt_tokens, completion_tokens, latency_ms, finish_reason | LLM 调用记录 |
| `action_*` | 因 action 而异 | Agent 执行的具体动作 |
| `session_end` | status, iterations, total_time_ms | 会话结束 |

## 4. Agent 知识集成

### 集成模式

**模式 A — 系统提示词注入（Rules）**

适用于编码/分析类 Agent。在 `__init__` 时从 KnowledgeStore 加载所有 rules，拼接到系统提示词。

```python
# DataTransformationAgent / DataRecAgent 模式
knowledge_rules = _load_knowledge_rules(knowledge_store)
combined_rules = _combine_rules(agent_coding_rules, knowledge_rules)
# combined_rules 注入到 [AGENT CODING RULES] 区块
```

**模式 B — 上下文注入（Experiences / Skills）**

适用于探索/洞察类 Agent。在 `run()` 时搜索相关知识，注入到用户消息或上下文。

```python
# InteractiveExploreAgent / ChartInsightAgent / DataLoadingAgent 模式
relevant = self._knowledge_store.search(query, categories=["experiences"], max_results=3)
# 注入到 context 或 system prompt
```

**模式 C — 工具调用（DataAgent）**

DataAgent 同时使用注入和工具：
1. `__init__` 注入 Rules 到系统提示词
2. `_build_initial_messages()` 自动搜索并注入 Skills/Experiences
3. 提供 `search_knowledge` / `read_knowledge` 工具供 LLM 按需调用

### 路由层传递

所有 Agent 实例化通过 `routes/agents.py` 中的 `_get_knowledge_store(identity_id)` 获取 KnowledgeStore：

```python
from data_formulator.knowledge.store import KnowledgeStore

def _get_knowledge_store(identity_id: str) -> KnowledgeStore | None:
    try:
        from data_formulator.datalake.workspace import get_user_home
        return KnowledgeStore(get_user_home(identity_id))
    except Exception:
        return None
```

## 5. 前端

### 知识面板

- 组件：`src/views/KnowledgePanel.tsx`
- 状态管理：`src/app/useKnowledgeStore.ts`（React hooks，非 Redux）
- API 客户端：`src/api/knowledgeApi.ts`

### 保存为经验

- 组件：`src/views/SaveExperienceButton.tsx`
- 放置位置：派生表结果卡片上（`DataThreadCards.tsx`）
- 成功后通过 `window.dispatchEvent(new CustomEvent('knowledge-changed'))` 通知知识面板刷新

### 跨组件刷新

`useKnowledgeStore` 监听 `knowledge-changed` 自定义事件，自动刷新对应类别：

```typescript
window.dispatchEvent(new CustomEvent('knowledge-changed', {
    detail: { category: 'experiences' }
}));
```

### i18n

知识系统的所有前端用户可见文本使用 `common.json` 的 `knowledge` 命名空间。

## 6. 新模块开发清单

添加新 Agent 或修改知识集成时：

- [ ] 确定该 Agent 需要注入哪些知识类别（Rules / Skills / Experiences）
- [ ] 在 Agent `__init__` 添加 `knowledge_store` 参数
- [ ] 在 `routes/agents.py` 对应路由传入 `_get_knowledge_store(identity_id)`
- [ ] 选择集成模式：A（系统提示词）/ B（上下文注入）/ C（工具调用）
- [ ] 知识搜索失败时静默降级（`try/except` + `logger.warning`）
- [ ] 路径安全：通过 KnowledgeStore，不直接操作文件系统
- [ ] 如涉及推理日志：使用 ReasoningLogger，尊重 `DF_AGENT_LOG` 开关
- [ ] i18n：新增的用户可见文本添加到 `en/common.json` 和 `zh/common.json`

## 7. 安全约束

| 约束 | 实现 |
|------|------|
| 路径遍历防护 | KnowledgeStore 内部 ConfinedDir |
| 文件名清洗 | `_sanitize_filename()` 过滤危险字符 |
| 日志不含凭证 | ReasoningLogger 不记录 API key |
| 搜索结果限制 | `max_results` 参数防止过大响应 |
| 环境变量控制 | `DF_AGENT_LOG=off` 默认禁用日志 |
