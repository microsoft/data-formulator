# 21. DataLoadingAgent 扩展、知识体系演进与上下文压缩

> 状态：部分已实现  
> 最后更新：2026-05-03（rules 统一注入重构）  
> 前置文档：  
> - `design-docs/15-agent-knowledge-reasoning-log.md`（知识系统）  
> - `design-docs/15.3-agent-knowledge-injection-and-search-plan.md`（注入与搜索规划）  
> - `dev-guides/3-data-loader-development.md`（DataLoader 开发规范）  
> - `dev-guides/10-agent-knowledge-reasoning-log.md`（知识系统开发规范）  
> - `dev-guides/11-catalog-metadata-sync.md`（Catalog 同步）  

---

## 1. 背景与动机

### 1.1 DataLoadingAgent 缺少数据源发现能力

当前 `DataLoadingAgent`（`agent_data_loading_chat.py`）能处理上传文件、文本/图片提取、示例数据集加载，但**无法帮助用户从已连接的外部数据源中挑选表**。用户要从 PostgreSQL、Superset、S3 等 connector 中选表，只能通过手动操作前端侧栏。

同时，`DataAgent` 已经拥有 `search_data_tables` 和 `read_catalog_metadata` 工具，可以搜索 workspace + connector catalog，但它定位是分析/可视化 Agent，不应承担"推荐并导入数据"的职责。

需求：**让用户能用自然语言描述分析目标，由 Agent 推荐最合适的数据表、给出导入建议（筛选、排序、行数限制），用户确认后再实际导入。**

### 1.2 知识体系的分类困惑

当前知识库分为 `rules`、`skills`、`experiences` 三类。其中 skills 和 experiences 在存储格式、搜索方式、body 长度限制上完全一致，用户在写的时候也不会区分。

决定合并 `skills` + `experiences` 为统一的 `kb/` 目录，`rules/` 保持独立。详见 `design-docs/21.1-knowledge-directory-merge.md`。

### 1.3 缺少上下文预算管理

随着 connector catalog、rules、skills/experiences、线程历史一起增长，Agent 上下文容易逼近 100K-200K token 上限。当前只有局部截断（表样例行、catalog 搜索结果、metadata 读取结果各自有字符限制），没有全局预算控制。

### 1.4 试错经验未被利用

DataAgent 在 agentic loop 中可能经历多次代码修复（repair），但修复过程中发现的 pattern（如"某列名经常被误认为另一个名字"）没有被自动记录和复用。

---

## 2. DataLoadingAgent 扩展

### 2.1 设计目标

- Agent 能搜索所有数据来源（workspace 已导入表、connector catalog、上传预览 sheet、示例数据集）
- Agent 能推荐"用哪些表、怎么筛选"，但**不能静默导入——必须由用户确认**
- 前端展示 Agent 推荐的导入计划，用户可修改筛选/排序/行数后点击 Load
- 复用现有 `IMPORT_DATA` / `CREATE_TABLE` 路由，不新建导入后端

### 2.2 统一数据候选模型

Agent 侧不区分 Excel/DB/S3 的差异，统一为"候选数据"：

| 字段 | 说明 |
|------|------|
| `candidate_id` | 唯一标识（如 `workspace:sales_data` 或 `connector:pg_prod:public.orders`） |
| `kind` | `workspace` / `connector` / `upload_staged` / `sample` |
| `status` | `imported` / `not_imported` / `staged` |
| `display_name` | 前端显示名 |
| `source_id` | connector ID（kind=connector 时） |
| `table_key` / `source_table` | 数据源侧表标识 |
| `columns` / `row_count` / `description` / `tags` | 元数据摘要 |

这不是一个新的持久化模型，而是 Agent 工具返回的**运行时视图**，由现有 workspace metadata + catalog cache + 上传预览三方合成。

### 2.3 新增工具

在 `DataLoadingAgent.TOOLS` 中新增：

| 工具名 | 职责 | 数据来源 |
|--------|------|---------|
| `search_data_candidates` | 跨所有数据来源搜索候选表 | 复用 `handle_search_data_tables`（workspace + catalog cache）+ 示例数据集列表 + scratch 中的上传预览 |
| `read_candidate_metadata` | 读取候选表的详细元数据 | 复用 `handle_read_catalog_metadata`（connector）或 workspace metadata（已导入） |
| `preview_candidate` | 预览候选表的样例数据 | 复用 connector `preview-data` API 或 workspace `read_data_as_df().head()` |
| `propose_load_plan` | 生成导入建议并展示给用户 | Agent 输出结构化 JSON，前端渲染确认 UI |

### 2.4 导入确认流程

```
用户："帮我找订单相关的数据来做分析"
  │
  ▼
Agent 调用 search_data_candidates("订单", scope="all")
  → 返回候选列表：workspace 已有 order_items，connector 有 pg_prod:public.orders / pg_prod:public.customers
  │
  ▼
Agent 调用 read_candidate_metadata(connector:pg_prod:public.orders)
  → 返回列信息、行数、描述
  │
  ▼
Agent 调用 propose_load_plan({
    candidates: [
        {id: "connector:pg_prod:public.orders", filters: [{column: "created_at", op: "GTE", value: "2025-01-01"}], row_limit: 50000},
        {id: "connector:pg_prod:public.customers", row_limit: -1},
    ],
    reasoning: "订单表筛最近一年数据（约 5 万行），客户表全量导入用于关联"
})
  │
  ▼
前端渲染：
  ┌─────────────────────────────────────────┐
  │ Agent 建议载入以下数据：                   │
  │                                           │
  │ ☑ orders (pg_prod)                        │
  │   筛选: created_at >= 2025-01-01          │
  │   行数限制: 50,000                         │
  │                                           │
  │ ☑ customers (pg_prod)                     │
  │   全量导入                                 │
  │                                           │
  │ [修改筛选]  [Load All]  [取消]             │
  └─────────────────────────────────────────┘
  │
  用户点击 Load All
  │
  ▼
前端调用现有 IMPORT_DATA API（逐表）
```

### 2.5 与现有 show_user_data_preview 的关系

`show_user_data_preview` 继续用于文件/文本/示例数据的预览。`propose_load_plan` 是新增工具，专门用于 connector 表的推荐+确认流程。两者通过不同的 `action.type` 区分：

- `preview_table`：用户端预览，可点 Load 载入单表
- `load_plan`：Agent 推荐的多表导入计划，用户可批量确认

---

## 3. 知识目录结构 ✅ 已实现

> **已完成**，详见 `design-docs/21.1-knowledge-directory-merge.md` 和 `dev-guides/10-agent-knowledge-reasoning-log.md`。
>
> 合并 `skills` + `experiences` 为 `experiences/` 目录，`rules/` 保持独立。搜索自动跳过 `alwaysApply=true` 的 rules。

### 3.3 未来考虑：高频知识升级为 rule

当一条 experiences 条目被 Agent 反复命中时（`hit_count >= 5`），可以建议用户将其提炼为 rule：

- 前端 KnowledgePanel 标 badge 提示"此条知识被频繁引用"
- 用户确认后，由精简版 distill agent 提取约束生成 rule 候选
- 升级后原 kb 条目可选择保留或归档

---

## 4. 知识预加载与动态注入

### 4.1 现状

当前 `DataAgent._build_initial_messages()` 中的知识搜索是同步的：先搜索 kb，注入 top 5 摘要到首条 user message，然后才发起第一次 LLM 调用。

同时 LLM 在 agentic loop 中可以随时调用 `search_knowledge` / `read_knowledge` 工具按需获取知识。

### 4.2 三层注入策略

将知识注入分为三层，兼顾速度和精度。以用户问"帮我分析各区域的 ROI"为例：

**Layer 1：预热层（后台线程，不阻塞主线程）**

```
用户消息到达后端
    │
    ├─→ 【主线程】构建 table context、thread context（正常流程）
    │
    └─→ 【后台线程】立刻启动知识搜索
         query = "分析各区域ROI" + ["sales_data", "regions"]
         搜索 kb/ 下所有知识条目
         → 命中 "ROI 计算经验.md"（score=85）
         → 命中 "区域数据处理注意事项.md"（score=60）
```

两件事同时干，知识搜索不拖慢 table context 的构建。

**Layer 2：首轮补注入（0.5 秒超时）**

```
主线程构建完 table context / thread context
    │
    检查后台搜索完成了吗？
    │
    ├─→ 完成（通常 < 50ms）
    │   → 把搜索结果摘要塞进发给 LLM 的第一条 user message：
    │     "[RELEVANT KNOWLEDGE]
    │      [kb] ROI 计算经验: ROI = 净利润/投资成本，注意排除...
    │      [kb] 区域数据处理注意事项: 区域名需要统一大小写..."
    │
    └─→ 没完成（极端情况，比如知识库很大）
        → 等最多 0.5 秒，超时则跳过
        → 搜索结果缓存在 Agent 实例上，供 Layer 3 使用
    │
    ▼
    发起第一次 LLM 调用（LLM 从第一轮就能看到相关知识）
```

0.5 秒超时的依据：当前 `KnowledgeStore.search()` 在知识库 < 100 条时通常 < 50ms。即使将来加 DuckDB 或 embedding 搜索，500ms 也是合理上限。LLM 首次请求的网络延迟本身 > 1s，所以 0.5s 等待不会显著增加端到端延迟。

**Layer 3：动态工具注入（LLM 主动调用，已有机制）**

```
LLM 在 agentic loop 中推理
    │
    LLM 觉得需要更多信息（比如具体的毛利率计算方法）
    │
    调用 search_knowledge("ROI 毛利率 净利率")
    → 返回更精准的结果（LLM 已经看过数据，知道具体要什么）
    │
    调用 read_knowledge("kb", "financial/roi-margin-guide.md")
    → 返回完整知识正文
    │
    LLM 结合完整知识生成最终分析
```

**三层对比**：

| 层 | 时机 | 精度 | 成本 |
|----|------|------|------|
| Layer 1+2 | LLM 第一轮推理前 | 中——只靠用户原始 query 匹配 | 零（不消耗 tool round） |
| Layer 3 | LLM 推理过程中 | 高——LLM 已理解意图，精准搜索 | 每次消耗 1 个 tool round（上限 12 轮） |

大部分简单场景 Layer 2 注入的摘要就够了；复杂场景 LLM 再通过 Layer 3 精准获取。

### 4.3 为什么不全部依赖 Layer 3

全靠 LLM 主动搜索有两个问题：
1. LLM 不一定知道用户有知识库，也不一定会主动调用搜索工具
2. 每次工具调用都消耗一个 tool round，在 `max_tool_rounds=12` 的限制下很宝贵

Layer 1/2 的预注入确保 LLM 从第一次推理就能看到相关知识，减少不必要的工具调用。

### 4.4 搜索策略与召回优先级 ✅ 已实现

> **已完成**。`_match_score` 改为分词 + 多字段加权匹配，`_tokenize_query` 支持 CJK/ASCII 混合拆分，`search()` 新增 `table_names` 参数。
> DataAgent 的 `_search_relevant_knowledge` 把 table_names 作为独立参数传入，不再拼接到 query 字符串中。
> DataLoadingAgent 改为使用最近一条用户消息作为搜索 query。
>
> 详见 `dev-guides/10-agent-knowledge-reasoning-log.md` §3 搜索算法。

#### 4.4.4 后续演进

当知识库增长到数百条以上，每次遍历文件性能不足时，可将相同算法迁移到 DuckDB 内存索引执行（`15.3` 已规划），算法不变，只换执行引擎。中文分词可引入 `jieba`，只需改 `_tokenize_query`。

---

## 5. 试错经验自动建议（部分已实现）

### 5.1 动机

DataAgent 在 agentic loop 中可能经历多次代码修复（repair）。这些修复 pattern 很有价值——它们暴露了 LLM 容易犯的错误、数据命名的歧义、业务逻辑的陷阱。

### 5.2 已实现：数据采集 + 提炼管线 ✅

试错数据的完整采集和提炼链路已经到位：

1. **后端**：`DataAgent._execute_visualize_with_repair()` 将每次执行尝试（包括初始执行、每轮 repair 的错误信息、失败代码摘要、修复代码摘要）记录到 `execution_attempts` 列表，通过 `transform_result` 传回前端。
2. **前端**：`SaveExperienceButton` 的 `buildExperienceContext()` 沿可见分析链回溯，收集 `dialog`（完整对话）、`interaction`（用户纠正、Agent 指令）、`result_summary`、`execution_attempts`（全部试错记录）。
3. **提炼**：`ExperienceDistillAgent` 解析 `execution_attempts` 中每次 attempt 的 `kind`、`status`、`error`、`failed_code_summary`、`repair_code_summary`，结合用户问题和对话上下文，提炼为方法论导向的经验文档。

用户手动点击"保存为经验"时，完整的试错过程已被采集和提炼。

### 5.3 待实现：自动弹窗提示

剩余工作是**让系统主动提示用户保存**，而非等用户自己发现并点击：

| 触发条件 | 优先级 | 状态 |
|------|:---:|:---:|
| repair_count >= 2 时，在结果卡片旁主动显示"建议保存为经验"提示 | P2 | 待开发 |
| 用户手动修改了 Agent 的代码后 | P2 | 待开发 |
| 使用了 clarify action 才搞清需求 | P3 | 待开发 |
| 同类错误跨会话出现 2+ 次（需 reasoning log 稳定） | P3 | 待开发 |

实现思路：后端在 `execution_attempts` 中已有足够信息判断 repair 次数；前端只需在渲染结果卡片时检查 `executionAttempts` 长度，满足条件时在 `SaveExperienceButton` 旁显示高亮提示或 badge，无需新增后端 API。

---

## 6. 上下文预算管理

### 6.1 问题分析

以 200K context window（当前主流模型上限）为基准，各组成部分的 token 占用估算：

| 组件 | 典型占用 | 膨胀风险 |
|------|---------|---------|
| System prompt + CHART_CREATION_GUIDE | ~3K tokens | 低——固定长度 |
| alwaysApply rules | 每条 ~100-500 tokens | 中——规则数量增长 |
| 表上下文（lightweight） | 每张表 ~500-2K tokens | 高——表多、列宽时膨胀 |
| Focused thread | 每步 ~200-500 tokens | 中——多步分析链 |
| Peripheral threads | 每线程 ~100 tokens | 低——已是最小化摘要 |
| 知识注入（skills/experiences） | top 5 × ~300 tokens | 低——搜索结果已截断 |
| 工具结果（explore stdout 等） | 每次 ~1-8K tokens | 高——多次工具调用累积 |
| trajectory 历史 | 每轮 ~1-3K tokens | 高——多轮对话累积 |
| 图片（chart thumbnail、附件） | 每张 ~85-250 tokens（low detail） | 中——多张图片 |

最危险的场景：10 张表 × 30 列 + 10 轮工具调用 + 5 步线程 + 10 条 rules = 可能达到 80K-120K tokens，接近或超过部分模型上限。

### 6.2 分块预算方案

建议给各组件分配固定预算上限，超出时触发裁剪：

| 组件 | 预算上限 | 超出策略 |
|------|---------|---------|
| System prompt + guides | 8K tokens | 固定，不裁剪 |
| Rules（alwaysApply） | 4K tokens | 超出时只注入前 N 条 + 提示"部分规则已省略" |
| Primary table context | 每张 3K tokens | 超出时减少样例行/数值统计 |
| Other table context | 每张 500 tokens | 超出时只保留表名+列名，去掉样例和统计 |
| Focused thread | 8K tokens | 超出时对早期步骤只保留一行摘要 |
| Peripheral threads | 2K tokens | 超出时只保留线程计数 |
| 知识注入 | 3K tokens | 已有 max_results=5 + snippet 截断 |
| 工具结果（单次） | 8K tokens | 已有 stdout 截断 |
| trajectory 累积 | 40K tokens | 超出时压缩早期轮次（见 §6.3） |
| **总 soft limit** | **120K tokens** | 预留 80K 给模型输出+工具输入+安全余量 |

### 6.3 Trajectory 压缩

当 trajectory（对话历史 + 工具调用结果）累积超过 40K tokens 时，对早期轮次执行压缩：

**压缩策略**：
- 保留最近 3 轮的完整内容
- 对更早的轮次，将工具结果替换为一行摘要：`[explore: 计算了 ROI 分布，发现 Q3 最高]`
- 保留所有用户消息原文（用户意图不可丢失）
- 保留所有 action 结果的关键信息（表名、图表类型、行数）

**实现位置**：在 `DataAgent._get_next_action()` 构建 messages 前检查估算 token 数。当前已有 `len(text) // 4` 的粗估计，可复用。

**不做的事**：不引入额外的 LLM 调用做摘要压缩（成本太高、延迟太大）。用确定性规则裁剪即可。

### 6.4 Token 估算

当前各 Agent 用 `len(text) // 4` 做粗略估算。建议统一为一个 helper：

接口：`estimate_tokens(text: str) -> int`

实现：对纯英文使用 `len(text) // 4`；对中文/混合文本使用 `len(text) // 2`（中文每字约 1-2 token）。足够做预算控制，不需要真正的 tokenizer。

### 6.5 Reasoning log 记录

在 `context_built` 事件中增加各块的 token 估算：

```json
{
    "event": "context_built",
    "budget": {
        "system_prompt": 3200,
        "rules": 1800,
        "table_context": 12000,
        "thread_context": 4500,
        "knowledge": 1200,
        "trajectory": 8000,
        "total_estimated": 30700,
        "budget_limit": 120000,
        "any_truncated": false
    }
}
```

这为后续调优提供数据基础，不需要在日志中记录原文。

---

## 7. 不引入主 Agent 的理由

讨论中考虑过是否需要一个"主 Agent"（Supervisor/Router），在用户每次请求时先判断意图再分发给子 Agent。

### 7.1 为什么暂不需要

**现有入口天然有上下文**：
- 用户在上传弹窗里聊天 → `DataLoadingAgent`
- 用户在分析线程里问问题 → `DataAgent`
- 用户点"保存经验" → `ExperienceDistillAgent`
- 用户打开规则面板 → Knowledge API

**主 Agent 的代价**：
- 每次请求多一次 LLM 推理（~1-2s 延迟）
- 需要注入足够上下文让 router 判断（但又不能注入太多，否则浪费）
- 如果 router 判断错误，整个请求走错 Agent，用户体验更差

### 7.2 替代方案：轻量意图路由

如果未来确实需要统一入口，建议先用确定性规则 + 小模型分类器：

1. 根据请求来源页面/组件确定 Agent（90% 场景）
2. 对不确定的场景，用一个轻量 classifier（无需注入数据上下文，只看用户消息），输出 intent 枚举
3. intent 枚举：`data_loading` / `data_analysis` / `knowledge_write` / `rule_create` / `experience_distill` / `general_chat`

classifier 不需要 GPT-4 级别模型，可以用很小的模型或甚至规则引擎。

---

## 8. 实施优先级

| 优先级 | 事项 | 工作量 | 价值 | 状态 |
|--------|------|--------|------|------|
| **P0** | DataLoadingAgent 接入 connector 搜索/预览/导入确认 | 中 | 高——核心缺失功能 | 待开发 |
| **P1** | 知识搜索算法改进（分词 + 多字段加权 + CJK 混合拆分） | 小 | 高——修复自动注入零命中问题 | ✅ 已完成 |
| **P1** | alwaysApply rules 统一注入（`format_rules_block()` + 消除 6 Agent 重复代码） | 小 | 中——代码质量，全 Agent 一致性 | ✅ 已完成 |
| **P1** | 知识预加载改并发（后台线程 + 0.5s 超时 + 降级） | 小 | 中——减少首次延迟 | 待开发 |
| **P1** | 知识目录合并 skills+experiences → experiences（`21.1`） | 小 | 中——消除分类困惑，简化代码 | ✅ 已完成 |
| **P2** | 高频 kb 条目升级建议（hit_count >= 5 时提示升级为 rule） | 小 | 中——知识库自进化 | 待开发 |
| **P2** | 试错经验自动建议（repair_count >= 2 时提示保存） | 小 | 高——最有价值的经验来源 | ⚡ 管线已完成，仅剩前端自动提示 |
| **P2** | 上下文分块预算管理 | 中 | 高——防止上下文爆炸 | 待开发 |
| **P3** | trajectory 压缩（确定性裁剪早期轮次） | 中 | 中——长对话场景 | 待开发 |
| **P3** | 跨会话 error pattern 检测 | 中 | 中——需 reasoning log 稳定 | 待开发 |
| **P3** | 轻量意图路由器（确定性规则 + 可选 classifier） | 中 | 中——统一入口场景 | 待开发 |

---

## 9. 关键设计决策记录

| 编号 | 决策 | 理由 |
|------|------|------|
| D1 | DataLoadingAgent 扩展而非新建 DataPickerAgent | 避免职责割裂；DataLoadingAgent 已有文件/文本/示例处理能力，扩展它覆盖 connector 选表更自然 |
| D2 | 导入操作必须用户确认，Agent 只推荐 | 静默导入大量数据有安全和性能风险；用户需要控制筛选条件和行数限制 |
| D3 | skills + experiences 合并为 `experiences/` 目录，rules 独立 | 消除用户分类负担；详见 `21.1-knowledge-directory-merge.md` |
| D4 | 不引入 kind 分类字段 | 合并目录就是为了消除分类负担；再分类和三目录本质一样 |
| D5 | 知识预加载使用后台线程 + 0.5s 超时 | 不阻塞第一次 LLM 调用；超时后有 Layer 3 工具注入兜底 |
| D6 | 不引入主 Agent | 现有 UI 入口已天然区分 Agent；多一次 LLM 调用增加延迟 |
| D7 | 上下文压缩使用确定性裁剪，不用 LLM 摘要 | LLM 摘要成本高、延迟大；确定性裁剪可预测、可测试 |
| D8 | 试错经验只建议保存，不自动写入知识库 | 用户应确认经验的准确性和通用性 |
| D9 | 搜索算法使用分词+加权而非引入外部搜索引擎 | 改动集中在 `_match_score` 一处，零依赖、API 不变、所有调用方自动受益 |
| D10 | 英文停用词硬编码而非依赖外部库 | 项目只支持中/英两种 UI 语言；中文的瓶颈是分词非停用词；引入依赖成本不匹配 |
| D11 | CJK/ASCII 混合 token 自动拆分 | 中英混合查询常见（如"帮我分析ROI"），拆分后 ASCII 部分可独立匹配知识标题 |
| D12 | rules 注入集中在 `KnowledgeStore.format_rules_block()` | 消除 6 个 Agent 的重复注入代码；支持传入预加载数据避免二次读盘；内部处理异常，调用方无需 try/except |

---

## 10. 关联文档

- `design-docs/15-agent-knowledge-reasoning-log.md` — 知识系统设计
- `design-docs/15.2-knowledge-system-followup-improvements.md` — 搜索策略等待改进项
- `design-docs/15.3-agent-knowledge-injection-and-search-plan.md` — 注入矩阵与 DuckDB 搜索规划
- `design-docs/21.1-knowledge-directory-merge.md` — 知识目录合并详细方案
- `dev-guides/3-data-loader-development.md` — DataLoader 开发规范
- `dev-guides/10-agent-knowledge-reasoning-log.md` — 知识系统开发规范
- `dev-guides/11-catalog-metadata-sync.md` — Catalog 同步
- `dev-guides/12-sandbox-session.md` — SandboxSession 与跨 turn 持久化
- `py-src/data_formulator/agents/agent_data_loading_chat.py` — DataLoadingAgent
- `py-src/data_formulator/agents/data_agent.py` — DataAgent
- `py-src/data_formulator/agents/context.py` — 共享上下文构建
- `py-src/data_formulator/knowledge/store.py` — KnowledgeStore
- `py-src/data_formulator/datalake/catalog_cache.py` — Catalog 缓存搜索
- `src/views/DataLoadingChat.tsx` — 前端数据加载对话
- `src/views/KnowledgePanel.tsx` — 知识面板
- `src/views/SaveExperienceButton.tsx` — 保存经验入口
