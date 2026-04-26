# Agent 知识系统与推理日志

> 状态：设计文档
> 最后更新：2026-04-26

## 目标

为 Agent 系统增加两大能力：

1. **推理日志（Reasoning Log）**：独立于应用日志，结构化记录每次 Agent 会话的完整推理路径——输入上下文、每轮思考/工具调用/决策、输出结果。用于开发调试、prompt 调优和未来的经验提炼。

2. **知识系统（Knowledge Base）**：由 Rules、Skills、Experiences 三部分组成，存储在用户 workspace 同级目录，Agent 在推理时可搜索并注入上下文，减少重复沟通。人和 Agent 均可维护。

两者的关系：推理日志是原始数据，经验是从日志中提炼的结晶。

## 当前状态

| 组件 | 已有 | 不足 |
|---|---|---|
| Agent 日志 | `logging.getLogger(__name__)` 文本日志，混在应用日志中 | 无结构化推理链路；无法按会话/按步骤查看；日志级别频繁切换（`logger.setLevel`） |
| Agent Rules | `AgentRulesDialog` 提供纯文本 exploration rules 和 coding rules，通过 API 参数传入 Agent | 仅两个自由文本框；无分类/文件管理；无法被 Agent 主动搜索 |
| Skills | 无 | — |
| Experiences | 无 | — |
| 路径安全 | `ConfinedDir` + `Workspace.get_file_path()` | 知识目录需要同样的安全约束 |

## 设计原则

1. **推理日志独立存储**。不污染应用 logger，不受日志级别影响。开发者可以随时审查完整推理链路。
2. **知识是文件**。每条 Rule / Skill / Experience 都是一个 Markdown 文件，人和 Agent 都能直接编辑。
3. **目录结构严格**。Rules 扁平、Skills 和 Experiences 各允许一级子目录，不允许更深嵌套。
4. **搜索内置**。Agent 通过统一的 `search_knowledge()` 工具搜索三类知识，不需要自己拼路径。
5. **路径安全**。所有知识文件访问通过 `ConfinedDir` 约束，用户只能访问自己的知识目录。
6. **渐进式实施**。推理日志先落地（对开发最有价值），知识系统按 Rules → Skills → Experiences 逐步实现。

---

## Part 1：推理日志（Reasoning Log）

### 设计思路

推理日志不是给终端用户看的 UI 功能，而是给开发者用的调试工具。它以 JSONL（每行一个 JSON）格式记录 Agent 每次会话的完整推理链路，便于事后分析。

### 存储位置

```text
~/.data_formulator/
└── users/
    └── <safe_identity_id>/
        └── agent-logs/                          ← 推理日志根目录
            └── <date>/                          ← 按日期分目录，便于清理
                └── <session_id>-<agent_type>.jsonl
```

单个文件对应一次 Agent 会话（一次 `/api/agent/data-agent-streaming` 请求）。文件名包含 session_id 和 agent 类型，便于查找。

### 日志格式

每行是一个 JSON 对象，通过 `step_type` 区分不同阶段：

```text
{"step_type": "session_start", "ts": "...", "agent": "DataAgent", "session_id": "...", "user_question": "...", "input_tables": [...], "model": "...", "rules_injected": [...]}
{"step_type": "context_built", "ts": "...", "system_prompt_tokens": 1200, "user_msg_tokens": 800, "total_tables": 3, "primary_tables": ["orders"]}
{"step_type": "llm_request", "ts": "...", "iteration": 1, "messages_count": 3, "tools_available": ["think", "explore", "inspect_source_data"]}
{"step_type": "llm_response", "ts": "...", "iteration": 1, "latency_ms": 2300, "finish_reason": "tool_calls", "tool_calls": [{"name": "explore", "purpose": "检查订单表的时间范围"}]}
{"step_type": "tool_execution", "ts": "...", "iteration": 1, "tool": "explore", "code": "...", "stdout": "...", "latency_ms": 500}
{"step_type": "llm_response", "ts": "...", "iteration": 1, "finish_reason": "stop", "action": {"action": "visualize", "display_instruction": "..."}}
{"step_type": "action_execution", "ts": "...", "iteration": 1, "action": "visualize", "status": "ok", "output_rows": 25, "chart_type": "bar"}
{"step_type": "session_end", "ts": "...", "status": "success", "total_iterations": 2, "total_llm_calls": 4, "total_latency_ms": 8500}
```

### 关键字段说明

| step_type | 含义 | 关键字段 |
|---|---|---|
| `session_start` | 会话开始 | user_question, input_tables, model, rules_injected, knowledge_injected |
| `context_built` | 上下文构建完成 | token 数量统计、注入的知识条目 |
| `llm_request` | 发送 LLM 请求 | iteration, messages_count, tools |
| `llm_response` | 收到 LLM 响应 | latency_ms, finish_reason, tool_calls 或 action |
| `tool_execution` | 工具执行结果 | tool 名、输入摘要、输出摘要、latency_ms |
| `action_execution` | 用户可见 action 执行 | action 类型、status、错误信息 |
| `repair_attempt` | 代码修复尝试 | attempt 次数、原始错误、修复后 status |
| `knowledge_search` | Agent 搜索知识库 | query、匹配结果数、注入的条目 |
| `session_end` | 会话结束 | 总迭代数、总 LLM 调用数、总耗时 |

### 实现方式

新增一个 `ReasoningLogger` 类，生命周期绑定到单次 Agent 会话：

```text
class ReasoningLogger:
    def __init__(self, user_home: Path, agent_type: str, session_id: str):
        log_dir = ConfinedDir(user_home / "agent-logs" / today_str())
        self._file = log_dir.resolve(f"{session_id}-{agent_type}.jsonl", mkdir_parents=True)
        self._fd = open(self._file, "a", encoding="utf-8")

    def log(self, step_type: str, **kwargs):
        record = {"step_type": step_type, "ts": utc_now_iso(), **kwargs}
        self._fd.write(json.dumps(record, ensure_ascii=False, default=str) + "\n")
        self._fd.flush()

    def close(self):
        self._fd.close()
```

在 Agent 内部的关键位置调用 `self.reasoning_log.log(...)`：

- `DataAgent.__init__` → 创建 `ReasoningLogger`
- `DataAgent._build_initial_messages` → `context_built`
- `DataAgent._call_llm` → `llm_request` + `llm_response`
- `DataAgent._execute_tool` → `tool_execution`
- `DataAgent._execute_visualize` → `action_execution`
- `DataAgent.run` 末尾 → `session_end`

### 开关与级别

通过唯一的环境变量 `DF_AGENT_LOG` 控制，三档：

| 值 | 行为 | 适用场景 |
|---|---|---|
| `off` | 完全不写日志文件，`log()` 调用为 no-op | 生产环境不需要调试时 |
| `on`（默认） | 写结构化摘要（messages_count、token 估算、tool 名等），不记录完整 messages 内容 | 日常开发、线上排查 |
| `verbose` | 记录完整 messages 内容，经过 `log_sanitizer` 清洗后写入 | 深度调试 prompt / Agent 行为 |

不设其他配置项。保留天数硬编码 30 天，Agent 启动时 best-effort 清理过期目录，不阻塞请求。

### 安全约束

- 日志中不能包含 API key、凭证、连接串。
- `on` 模式下只记录结构化摘要，不含用户数据原文。
- `verbose` 模式下完整内容必须经过 `log_sanitizer` 清洗后才写入。
- 日志文件通过 `ConfinedDir` 约束到用户目录下。

---

## Part 2：知识系统（Knowledge Base）

### 总体架构

```text
~/.data_formulator/
└── users/
    └── <safe_identity_id>/
        └── knowledge/                           ← 知识库根目录
            ├── rules/                           ← 规则（扁平，不允许子目录）
            │   ├── computation-standards.md
            │   ├── date-format.md
            │   └── coding-conventions.md
            │
            ├── skills/                          ← 技能（允许一级子目录）
            │   ├── data-cleaning/
            │   │   ├── handle-missing-values.md
            │   │   └── normalize-dates.md
            │   └── visualization/
            │       ├── choose-chart-type.md
            │       └── color-palette-guide.md
            │
            └── experiences/                     ← 经验（允许一级子目录）
                ├── sales-analysis/
                │   ├── quarterly-trend.md
                │   └── regional-comparison.md
                └── user-behavior/
                    └── cohort-retention.md
```

### 三类知识的区别

| 维度 | Rules | Skills | Experiences |
|---|---|---|---|
| **定义** | 硬性约束和编码规范。Agent 必须遵守 | 可复用的分析方法和技巧模板 | 从成功分析中提炼的具体案例和洞察 |
| **目录结构** | 扁平，只有文件 | 一级子目录分类 | 一级子目录分类 |
| **典型内容** | "ROI = (revenue - cost) / cost"、"日期格式 YYYY-MM-DD" | "如何做 cohort 分析"、"时间序列分解步骤" | "上次分析销售数据发现 Q3 异常是因为促销活动" |
| **注入方式** | 全量注入 system prompt（数量少、内容短） | 按相关性搜索，注入匹配的条目 | 按相关性搜索，注入匹配的条目 |
| **维护者** | 人为主，Agent 可建议 | 人和 Agent 均可 | Agent 为主，人可编辑 |
| **来源** | 用户手写或从 AgentRulesDialog 迁移 | 用户创建或 Agent 从分析模式中总结 | Agent 从成功的推理日志中总结 |

### 文件格式

每个知识文件是 Markdown，带 YAML front matter：

```markdown
---
title: ROI 计算标准
tags: [computation, finance]
created: 2026-04-26
updated: 2026-04-26
source: manual              # manual | agent_summarized
---

ROI（投资回报率）的计算方式：

ROI = (revenue - cost) / cost

所有涉及 ROI 的分析必须使用此公式，不要使用 revenue / cost。
```

front matter 字段：

| 字段 | 必需 | 说明 |
|---|---|---|
| `title` | 是 | 标题，用于搜索和展示 |
| `tags` | 否 | 标签列表，辅助搜索 |
| `created` | 是 | 创建日期 |
| `updated` | 是 | 最后更新日期 |
| `source` | 否 | 来源：`manual`（人工）或 `agent_summarized`（Agent 提炼） |
| `source_session` | 否 | 当 source=agent_summarized 时，关联的推理日志 session_id |
| `relevance` | 否 | Skills/Experiences 可选的领域标签，如 `["sales", "time-series"]` |

### 目录结构约束

后端通过 `KnowledgeStore` 类强制执行目录深度：

```text
class KnowledgeStore:
    """管理用户知识库的读写和搜索。"""

    def __init__(self, user_home: Path):
        self._root = ConfinedDir(user_home / "knowledge")
        self._rules = ConfinedDir(self._root.root / "rules")
        self._skills = ConfinedDir(self._root.root / "skills")
        self._experiences = ConfinedDir(self._root.root / "experiences")

    def validate_path(self, category: str, relative_path: str):
        """检查路径是否符合该分类的深度限制。"""
        parts = Path(relative_path).parts
        if category == "rules":
            # rules: 只允许文件，不允许子目录
            if len(parts) != 1:
                raise ValueError("Rules 不允许子目录")
        elif category in ("skills", "experiences"):
            # skills / experiences: 最多一级子目录
            if len(parts) > 2:
                raise ValueError(f"{category} 最多允许一级子目录")
        if not relative_path.endswith(".md"):
            raise ValueError("知识文件必须是 .md 格式")
```

### 知识搜索

Agent 通过 `search_knowledge` 工具搜索知识库。搜索策略：

```text
search_knowledge(query, categories=["rules", "skills", "experiences"]):
    """
    搜索用户知识库。

    1. 解析所有符合条件的 .md 文件的 front matter（title, tags）
    2. 按 query 对 title、tags、文件名、正文前 200 字进行子串匹配
    3. 返回匹配的条目（title、category、path、摘要前 500 字）
    4. 按匹配度排序，限制返回数量
    """
    results = []

    for category in categories:
        jail = self._get_jail(category)
        for md_file in jail.root.rglob("*.md"):
            front_matter, body = parse_front_matter(md_file)
            title = front_matter.get("title", md_file.stem)
            tags = front_matter.get("tags", [])
            searchable = f"{title} {' '.join(tags)} {md_file.stem} {body[:200]}"

            if query_matches(query, searchable):
                results.append({
                    "category": category,
                    "title": title,
                    "tags": tags,
                    "path": str(md_file.relative_to(jail.root)),
                    "snippet": body[:500],
                    "source": front_matter.get("source", "manual"),
                })

    return sorted(results, key=relevance_score, reverse=True)[:max_results]
```

搜索结果不包含完整文件内容（避免 context 过大）。Agent 可通过 `read_knowledge` 工具读取完整内容。

### 知识注入策略

不同类型的知识注入方式不同：

**Rules — 全量注入**

Rules 数量少（预期 5-20 条）、内容短，每次 Agent 调用时全量拼入 system prompt：

```text
DataAgent 构建 system prompt 时:
    rules = knowledge_store.list_all("rules")
    if rules:
        system_prompt += "\n\n## User Rules\n"
        for rule in rules:
            system_prompt += f"\n### {rule.title}\n{rule.body}\n"
```

这替代了当前 `agent_exploration_rules` 和 `agent_coding_rules` 的纯文本方案。为保持向后兼容，如果用户仍通过 `AgentRulesDialog` 传入了文本 rules，也继续注入。

**Skills 和 Experiences — 按需搜索注入**

Skills 和 Experiences 数量可能较多，不能全量注入。Agent 在以下时机搜索：

1. **会话开始时**：根据 user_question 和 input_tables 的表名/列名自动搜索一次
2. **Agent 主动搜索**：Agent 可通过 `search_knowledge` 工具在推理过程中按需搜索

```text
DataAgent._build_initial_messages 时:
    # 自动搜索相关知识
    query_terms = extract_keywords(user_question, table_names)
    relevant = knowledge_store.search(query_terms, categories=["skills", "experiences"])

    if relevant:
        context += "\n\n[RELEVANT KNOWLEDGE]\n"
        for item in relevant[:5]:  # 最多注入 5 条
            context += f"\n### [{item.category}] {item.title}\n{item.snippet}\n"
```

### Agent 工具定义

为 Agent 增加两个知识相关工具：

```text
Tool: search_knowledge
    description: "搜索用户的知识库（rules、skills、experiences），返回匹配的条目摘要"
    parameters:
        query: string      # 搜索关键词
        categories: array   # 可选，限定搜索分类
    returns: 匹配条目列表（title, category, snippet）

Tool: read_knowledge
    description: "读取一条知识的完整内容"
    parameters:
        category: string    # rules / skills / experiences
        path: string        # 从 search_knowledge 返回的路径
    returns: 完整的 Markdown 内容
```

这两个工具遵循与 `explore`、`inspect_source_data` 相同的模式——Agent 内部工具，不直接向用户展示。

---

## Part 3：经验提炼（Experience Distillation）

### 流程

```text
用户完成一次满意的分析
    ↓
前端展示"保存为经验"按钮
    ↓
用户确认 → 调用后端 /api/knowledge/distill-experience
    ↓
后端取出该分析的推理日志
    ↓
调用 LLM 总结为经验文档
    ↓
写入 knowledge/experiences/ 目录
    ↓
前端知识面板刷新
```

### 经验提炼 Agent

这是一个新的轻量 Agent，输入是推理日志，输出是结构化的经验文档：

```text
class ExperienceDistillAgent:
    """从推理日志提炼经验。"""

    SYSTEM_PROMPT = """
    你是一个数据分析经验总结专家。给定一次数据分析的完整推理日志，
    提炼出一条可复用的经验。经验应包含：

    1. 标题：简短描述这个经验
    2. 场景：什么情况下适用
    3. 方法：具体的分析步骤或技巧
    4. 要点：关键发现或需要注意的地方
    5. 标签：用于搜索的关键词

    输出格式为 Markdown with YAML front matter。
    """

    def run(self, reasoning_log: list[dict], user_question: str) -> str:
        # 只提取日志中的关键信息，不传完整 messages
        summary = self._extract_log_summary(reasoning_log)
        prompt = f"用户问题：{user_question}\n\n推理过程：\n{summary}"
        response = self.client.get_completion(...)
        return response  # Markdown 内容
```

### 经验管理 API

```text
POST /api/knowledge/distill-experience
    body: { session_id, user_question, model, category_hint? }
    → 从推理日志提炼经验，保存到 knowledge/experiences/
    → model: 必填，LLM 配置对象（与 data-agent-streaming 相同格式）

POST /api/knowledge/list
    body: { category: "rules" | "skills" | "experiences" }
    → 列出该分类下的所有条目

POST /api/knowledge/read
    body: { category, path }
    → 读取某条知识的完整内容

POST /api/knowledge/write
    body: { category, path, content }
    → 创建或更新一条知识

POST /api/knowledge/delete
    body: { category, path }
    → 删除一条知识

POST /api/knowledge/search
    body: { query, categories? }
    → 搜索知识库
```

所有 API 都通过 `get_identity_id()` 确定用户，通过 `ConfinedDir` 约束访问范围。

---

## Part 4：前端设计

### 知识面板入口

在 `DataSourceSidebar` 的同级位置增加一个"知识"Tab。侧边栏变成两个 Tab：

```text
┌──────────────────────────┐
│  [数据源]  [知识库]       │  ← Tab 切换
├──────────────────────────┤
│                          │
│  当选中"知识库" Tab 时:   │
│                          │
│  ▸ Rules (3)             │  ← 扁平列表
│    ├ computation-standards│
│    ├ date-format          │
│    └ coding-conventions   │
│                          │
│  ▸ Skills (4)            │  ← 一级分类
│    ▸ data-cleaning (2)   │
│    │ ├ handle-missing     │
│    │ └ normalize-dates    │
│    ▸ visualization (2)   │
│      ├ choose-chart-type  │
│      └ color-palette      │
│                          │
│  ▸ Experiences (3)       │  ← 一级分类
│    ▸ sales-analysis (2)  │
│    └ user-behavior (1)   │
│                          │
│  [+ 新建] [搜索]         │
│                          │
└──────────────────────────┘
```

### 知识编辑

点击某条知识打开编辑器（复用 `AgentRulesDialog` 中的 `react-simple-code-editor` 或类似的 Markdown 编辑组件）。编辑器支持：

- 查看 / 编辑 Markdown 内容
- 编辑 front matter 中的 tags
- 保存 / 删除
- 查看来源（手动创建 / Agent 提炼）

### 经验保存入口

在 DataAgent 完成一次分析（`present` action）后，前端在结果卡片上增加一个"保存为经验"按钮。点击后：

1. 弹出确认对话框，可选择子目录和编辑标题
2. 调用 `/api/knowledge/distill-experience`
3. Agent 提炼完成后在知识面板中显示新条目

### 与现有 AgentRulesDialog 的关系

`AgentRulesDialog` 的 exploration rules 和 coding rules 迁移到知识系统的 Rules 分类下。保持 `AgentRulesDialog` 作为快捷入口不变，但底层存储从 Redux + session state 改为知识文件系统。

迁移策略：

- 如果用户已有 `agentRules.coding` 或 `agentRules.exploration` 内容，首次使用时自动迁移为 Rules 文件
- `AgentRulesDialog` 变成知识系统 Rules 的 UI 视图之一

---

## Part 5：统一路径安全策略

### 现状审计：手写检查散落在各处

当前代码中存在两种路径安全实现：

**模式 A — `ConfinedDir`（统一原语，已有但使用率低）**

| 调用位置 | 用法 |
|---|---|
| `local_folder_data_loader.py` | `self._jail = ConfinedDir(self.root_dir)`，通过 `self._jail / source_table` 访问文件 |
| `security/path_safety.py` | 定义了 `ConfinedDir` 类本身 |

目前整个 `py-src/` 中**只有 `local_folder_data_loader.py` 一个业务模块**真正使用了 `ConfinedDir`。

**模式 B — 手写 `resolve()` + `relative_to()`（散落在各模块，逻辑重复）**

| 调用位置 | 手写代码模式 |
|---|---|
| `agent_data_loading_chat.py` `_tool_read_file` | `target = (workspace_path / rel_path).resolve()` → `target.relative_to(workspace_path)` |
| `agent_data_loading_chat.py` `_tool_list_directory` | 同上，完全相同的 4 行代码 |
| `agent_data_loading_chat.py` `_preview_scratch_files` | 同上，又复制了一遍 |
| `routes/agents.py` `scratch_serve` | `target = (scratch_dir / filename).resolve()` → `target.relative_to(scratch_dir.resolve())` |
| `datalake/workspace.py` `get_file_path` | `result.resolve().relative_to(data_dir.resolve())` |
| `datalake/workspace.py` `__init__` | `resolved.is_relative_to(root_resolved)` |
| `cached_azure_blob_workspace.py` `_cache_path` | `(self._cache_dir / filename).resolve()` → `resolved.is_relative_to(self._cache_dir.resolve())` |

**问题**：

1. **逻辑重复**：相同的 3-4 行安全检查代码在至少 7 个位置手写，违反 DRY。
2. **不一致**：有的用 `relative_to()`（Python 3.8 风格，抛异常），有的用 `is_relative_to()`（Python 3.9+ 风格，返回 bool）。
3. **遗漏风险**：`_tool_write_file` 只写到 `scratch_dir / filename`，用了 `_secure_filename` 但**没有 `resolve()` + `relative_to()` 检查**。如果 `_secure_filename` 的清洗有遗漏，就是一个路径穿越口。
4. **base 路径多次 resolve**：`_preview_scratch_files` 中对 `workspace._path` 做了 `resolve()`，但同一个会话里 `_execute_tool` 也 resolve 了一次，不同调用链中 base 路径可能被 resolve 到不同值（TOCTOU 风险，`dev-guides/8-path-safety.md` R3 已经警告过）。
5. **scratch_upload 没有路径检查**：`routes/agents.py` 的 `scratch_upload()` 用 `werkzeug.secure_filename` 清洗文件名后直接写入，没有额外的 `ConfinedDir` 或 `relative_to` 守卫。虽然 `secure_filename` 已经很安全，但这是唯一的防线，没有纵深。

### 统一方案：一切通过 `ConfinedDir`

**原则：任何接受用户可控路径的代码，都必须通过 `ConfinedDir` 实例访问文件系统，禁止裸 `Path(root) / user_input` 拼接。**

#### 1. Workspace 增加 `confined_*` 属性

`Workspace` 类在初始化时创建几个常用的 `ConfinedDir` 实例，供所有调用者使用：

```text
class Workspace:
    def __init__(self, ...):
        ...
        self._confined_root = ConfinedDir(self._path, mkdir=False)
        self._confined_data = ConfinedDir(self._path / "data")
        self._confined_scratch = ConfinedDir(self._path / "scratch")

    @property
    def confined_root(self) -> ConfinedDir:
        return self._confined_root

    @property
    def confined_data(self) -> ConfinedDir:
        return self._confined_data

    @property
    def confined_scratch(self) -> ConfinedDir:
        return self._confined_scratch
```

#### 2. Agent 工具统一改用 `ConfinedDir`

当前 `agent_data_loading_chat.py` 中所有手写检查替换为：

```text
# BEFORE — 每个工具方法手写 4 行
def _tool_read_file(self, args, workspace_path):
    target = (workspace_path / rel_path).resolve()
    try:
        target.relative_to(workspace_path)
    except ValueError:
        return {"error": "Access denied"}

# AFTER — 一行
def _tool_read_file(self, args):
    try:
        target = self.workspace.confined_root.resolve(rel_path)
    except ValueError:
        return {"error": "Access denied: path outside workspace"}
```

同理：`_tool_list_directory`、`_tool_write_file`、`_preview_scratch_files` 等全部改用。

#### 3. 路由层统一改用 `ConfinedDir`

```text
# BEFORE — routes/agents.py scratch_serve
scratch_dir = workspace._path / "scratch"
target = (scratch_dir / filename).resolve()
target.relative_to(scratch_dir.resolve())

# AFTER
target = workspace.confined_scratch.resolve(filename)
```

#### 4. `cached_azure_blob_workspace.py` 改用 `ConfinedDir`

```text
# BEFORE
def _cache_path(self, filename):
    resolved = (self._cache_dir / filename).resolve()
    if not resolved.is_relative_to(self._cache_dir.resolve()):
        raise ValueError(...)

# AFTER
class CachedAzureBlobWorkspace:
    def __init__(self, ...):
        self._cache_jail = ConfinedDir(self._cache_dir, mkdir=True)

    def _cache_path(self, filename):
        return self._cache_jail.resolve(filename)
```

#### 5. 用户级目录也统一用 `ConfinedDir`

`get_user_home(identity_id)` 返回的路径，所有下游都应通过 `ConfinedDir` 访问：

```text
user_home = get_user_home(identity_id)

# 知识库
knowledge_jail = ConfinedDir(user_home / "knowledge")

# 推理日志
logs_jail = ConfinedDir(user_home / "agent-logs")

# Workspace — 已有，通过 Workspace.confined_* 访问

# Connectors
connectors_jail = ConfinedDir(user_home / "connectors")
```

#### 6. `ConfinedDir` 需要增强的 API

当前 `ConfinedDir` 只有 `resolve()` 和 `write()`。统一使用后需要补充：

```text
class ConfinedDir:
    # 已有
    def resolve(self, relative, *, mkdir_parents=False) -> Path: ...
    def write(self, relative, data: bytes) -> Path: ...

    # 需要新增
    def read_text(self, relative, encoding="utf-8") -> str:
        """读取文本文件。"""
        return self.resolve(relative).read_text(encoding)

    def write_text(self, relative, content: str, encoding="utf-8") -> Path:
        """写入文本文件（自动创建父目录）。"""
        target = self.resolve(relative, mkdir_parents=True)
        target.write_text(content, encoding)
        return target

    def exists(self, relative) -> bool:
        """检查文件/目录是否存在。"""
        try:
            return self.resolve(relative).exists()
        except ValueError:
            return False

    def iterdir(self, relative="") -> Iterator[Path]:
        """列出子目录内容（结果都在 jail 内）。"""
        target = self.resolve(relative) if relative else self._root
        yield from target.iterdir()

    def rglob(self, pattern, relative="") -> Iterator[Path]:
        """递归搜索文件。"""
        target = self.resolve(relative) if relative else self._root
        yield from target.rglob(pattern)

    def unlink(self, relative) -> None:
        """删除文件。"""
        self.resolve(relative).unlink()
```

这样所有的文件操作——读、写、列目录、搜索、删除——都经过 `ConfinedDir` 的入口检查，不可能绕过。

### 完整的安全层次

```text
用户输入（filename / relative_path / blob key）
    │
    ▼
safe_data_filename() / secure_filename()     ← 第一层：输入清洗
    │
    ▼
ConfinedDir.resolve()                        ← 第二层：路径约束（三重防御）
    │                                           ① 拒绝绝对路径
    │                                           ② 拒绝 ".." 段
    │                                           ③ resolve + is_relative_to
    ▼
安全的 Path 对象
    │
    ▼
Workspace.confined_* / KnowledgeStore / ReasoningLogger
                                             ← 第三层：业务语义约束
                                                （知识目录深度限制、
                                                  日志只追加不覆盖等）
```

### 迁移清单

| 文件 | 当前方式 | 改为 | 优先级 |
|---|---|---|---|
| `agent_data_loading_chat.py` `_tool_read_file` | 手写 resolve+relative_to | `workspace.confined_root.resolve()` | 高 |
| `agent_data_loading_chat.py` `_tool_list_directory` | 手写 resolve+relative_to | `workspace.confined_root.resolve()` | 高 |
| `agent_data_loading_chat.py` `_tool_write_file` | `_secure_filename` 无纵深 | `workspace.confined_scratch.resolve()` | 高 |
| `agent_data_loading_chat.py` `_preview_scratch_files` | 手写 resolve+relative_to | `workspace.confined_root.resolve()` | 高 |
| `routes/agents.py` `scratch_serve` | 手写 resolve+relative_to | `workspace.confined_scratch.resolve()` | 高 |
| `routes/agents.py` `scratch_upload` | `secure_filename` 无纵深 | `workspace.confined_scratch.resolve()` | 中 |
| `datalake/workspace.py` `get_file_path` | 手写 resolve+relative_to | `self._confined_data.resolve()` | 中 |
| `cached_azure_blob_workspace.py` `_cache_path` | 手写 resolve+is_relative_to | `self._cache_jail.resolve()` | 中 |
| **新增** `KnowledgeStore` | — | `ConfinedDir(user_home / "knowledge" / category)` | Phase 2 |
| **新增** `ReasoningLogger` | — | `ConfinedDir(user_home / "agent-logs" / date)` | Phase 1 |

### 安全检查清单

| 场景 | 必须满足 |
|---|---|
| 任何 `Path(root) / user_input` | 改用 `ConfinedDir(root).resolve(user_input)` |
| Agent 工具文件读写 | 通过 `workspace.confined_*` 访问 |
| 知识文件读写 | 通过 `KnowledgeStore` 内部的 `ConfinedDir` |
| 推理日志写入 | 通过 `ReasoningLogger` 内部的 `ConfinedDir` |
| 路由层文件下载 | `send_file(confined.resolve(filename))` |
| Azure Blob 缓存 | 通过 `_cache_jail.resolve()` |
| 新模块开发 | **禁止**手写 `resolve() + relative_to()`，必须用 `ConfinedDir` |

### 共享知识（未来扩展）

当前所有知识都是用户级别的。未来如需组织级别的共享知识（如公司统一的分析规范），需要额外设计：

- 共享知识存储在 `~/.data_formulator/shared/knowledge/` 下
- 只有管理员可以写入，普通用户只读
- Agent 搜索时先搜用户知识，再搜共享知识
- 这是 Phase 4+ 的内容，不在首期范围

---

## Part 6：需要新增或修改的 Agent

### 现有 Agent 修改

| Agent | 文件 | 修改内容 |
|---|---|---|
| `DataAgent` | `data_agent.py` | 增加 `ReasoningLogger` 埋点；初始化时注入 Rules 和搜索 Skills/Experiences；增加 `search_knowledge` / `read_knowledge` 工具 |
| `InteractiveExploreAgent` | `agent_interactive_explore.py` | 搜索 Experiences 补充推荐问题的上下文 |
| `DataLoadingAgent` | `agent_data_loading_chat.py` | 搜索 Skills 中的数据清洗技巧 |
| `DataTransformationAgent` | `agent_data_transform.py` | 注入 Rules（计算规则、编码规范） |
| `DataRecAgent` | `agent_data_rec.py` | 注入 Rules |
| `ChartInsightAgent` | `agent_chart_insight.py` | 搜索 Experiences 获取分析上下文 |

### 新增 Agent

| Agent | 用途 |
|---|---|
| `ExperienceDistillAgent` | 从推理日志提炼经验文档 |

### 新增模块

| 模块 | 路径 | 职责 |
|---|---|---|
| `ReasoningLogger` | `py-src/data_formulator/agents/reasoning_log.py` | 推理日志的写入和清理 |
| `KnowledgeStore` | `py-src/data_formulator/knowledge/store.py` | 知识文件的 CRUD 和搜索 |
| `ExperienceDistillAgent` | `py-src/data_formulator/agents/agent_experience_distill.py` | 经验提炼 Agent |
| Knowledge API routes | `py-src/data_formulator/routes/knowledge.py` | `/api/knowledge/*` 端点 |
| `KnowledgePanel` | `src/views/KnowledgePanel.tsx` | 前端知识面板 |

---

## Part 7：数据流全景

### Agent 推理 + 知识检索流程

```text
用户提问 "分析订单的季度趋势"
    │
    ├─── 1. 路由层
    │    POST /api/agent/data-agent-streaming
    │    identity_id = get_identity_id()
    │    workspace = get_workspace(identity_id)
    │    knowledge = KnowledgeStore(get_user_home(identity_id))
    │
    ├─── 2. Agent 初始化
    │    DataAgent(client, workspace, knowledge_store=knowledge, ...)
    │    reasoning_log = ReasoningLogger(user_home, "DataAgent", session_id)
    │    reasoning_log.log("session_start", user_question=..., ...)
    │
    ├─── 3. 知识注入
    │    rules = knowledge.list_all("rules")
    │    → 全量注入 system prompt
    │
    │    relevant = knowledge.search("订单 季度 趋势", ["skills", "experiences"])
    │    → 注入前 5 条匹配的 skills/experiences 摘要
    │    reasoning_log.log("knowledge_search", query=..., results_count=...)
    │
    ├─── 4. Agent 推理循环
    │    for iteration in range(max_iterations):
    │        reasoning_log.log("llm_request", iteration=...)
    │        response = llm.call(messages, tools)
    │        reasoning_log.log("llm_response", latency_ms=..., ...)
    │
    │        if tool_call:
    │            # Agent 可能调用 search_knowledge 获取更多信息
    │            reasoning_log.log("tool_execution", tool=..., ...)
    │
    │        if action == "visualize":
    │            result = execute_visualize(...)
    │            reasoning_log.log("action_execution", ...)
    │
    ├─── 5. 会话结束
    │    reasoning_log.log("session_end", status=..., ...)
    │    reasoning_log.close()
    │
    └─── 6. 可选：用户点击"保存为经验"
         POST /api/knowledge/distill-experience
         → 读取推理日志
         → ExperienceDistillAgent 提炼
         → 写入 knowledge/experiences/
```

### 推理日志 → 经验 的数据流

```text
推理日志 (JSONL)              经验提炼 Agent              经验文件 (.md)
┌─────────────────┐          ┌──────────────┐          ┌──────────────────┐
│ session_start   │          │              │          │ ---              │
│ context_built   │    →     │  提取关键信息  │    →     │ title: 季度趋势  │
│ llm_request     │          │  调用 LLM     │          │ tags: [sales]   │
│ llm_response    │          │  生成 Markdown │          │ ---             │
│ tool_execution  │          │              │          │                 │
│ action_execution│          └──────────────┘          │ ## 场景          │
│ session_end     │                                    │ 分析订单数据时... │
└─────────────────┘                                    │ ## 方法          │
                                                       │ 1. 按季度聚合... │
                                                       │ ## 要点          │
                                                       │ 注意排除退货...  │
                                                       └──────────────────┘
```

---

## 实施计划

### Phase 1：推理日志

- 实现 `ReasoningLogger` 类（写入 + 清理）
- 在 `DataAgent` 中集成埋点
- 支持 `DF_AGENT_LOG` 环境变量（`off` / `on` / `verbose`，默认 `on`）
- 确保日志通过 `ConfinedDir` 约束到用户目录
- 确保不记录敏感信息（API key 等）

### Phase 2：知识存储后端

- 实现 `KnowledgeStore` 类（CRUD + 搜索 + 目录约束）
- 实现 `/api/knowledge/*` API 端点
- 编写安全测试（路径穿越、跨用户访问）
- 迁移 `AgentRulesDialog` 数据到 Rules 文件

### Phase 3：Agent 知识集成

- 在 `DataAgent` 中集成 Rules 全量注入
- 在 `DataAgent` 中增加 `search_knowledge` / `read_knowledge` 工具
- 在其他 Agent 中按需集成知识搜索
- 推理日志中记录知识搜索和注入信息

### Phase 4：经验提炼

- 实现 `ExperienceDistillAgent`
- 实现 `/api/knowledge/distill-experience` 端点
- 前端增加"保存为经验"按钮

### Phase 5：前端知识面板

- 实现 `KnowledgePanel` 组件（树状展示 + 搜索 + 编辑）
- 在侧边栏增加"知识库" Tab
- 知识编辑器（Markdown 编辑 + front matter 编辑）
- `AgentRulesDialog` 改为 Rules 的快捷视图

### Phase 6（未来）：高级功能

- 组织级共享知识
- 知识版本管理
- 知识有效性评估（哪些经验被 Agent 实际采用了）
- 推理日志可视化查看器

---

## 测试策略

### ReasoningLogger 测试

- 日志文件正确创建到 `agent-logs/<date>/` 目录
- JSONL 格式可正确解析
- `close()` 后文件可读
- 过期日志被清理
- 敏感信息不出现在日志中（verbose 模式下经过清洗）

### KnowledgeStore 测试

- CRUD 操作正确读写 `.md` 文件
- `validate_path()` 拒绝 Rules 的子目录
- `validate_path()` 允许 Skills/Experiences 的一级子目录
- `validate_path()` 拒绝 Skills/Experiences 的二级子目录
- `ConfinedDir` 拒绝 `..` 穿越
- 搜索按 title / tags / 文件名匹配
- 搜索只返回当前用户的知识

### Agent 集成测试

- Rules 被正确注入 system prompt
- `search_knowledge` 工具返回正确结果
- 无知识时 Agent 行为不受影响（优雅降级）
- 推理日志正确记录知识搜索和注入

### 安全测试

- 跨用户访问被拒绝
- 路径穿越被拒绝（`../`、绝对路径、符号链接）
- 超深度路径被拒绝
- API 端点要求有效 identity_id

---

## 关联文档

- `design-docs/14-unified-source-metadata-plan.md` — workspace 目录结构和安全隔离
- `design-docs/6-path-safety-confined-dir.md` — ConfinedDir 设计
- `dev-guides/8-path-safety.md` — 路径安全编码规范
- `dev-guides/2-log-sanitization.md` — 日志脱敏规范
