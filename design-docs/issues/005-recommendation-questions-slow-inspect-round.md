# ISSUE-005: 推荐问题生成（get-recommendation-questions）延迟过高

> 状态：已分析，待优化
> 日期：2026-04-26
> 影响范围：`InteractiveExploreAgent`（`py-src/data_formulator/agents/agent_interactive_explore.py`）、前端 `SimpleChartRecBox.tsx`

---

## 1. 问题现象

用户在前端点击💡灯泡图标请求 AI 推荐探索问题后，需要等待 **46-62 秒** 才能看到结果。
期间界面显示加载动画，但没有任何中间进度反馈，体感非常慢。

日志中观察到的实际耗时（3 次采样）：

| # | 请求到达 | HTTP 200 返回 | 总耗时 |
|---|---------|-------------|-------|
| 1 | 22:42:00.962 | 22:42:46.374 | **~46s** |
| 2 | 23:35:04.062 | 23:36:05.808 | **~62s** |
| 3 | 23:36:34.354 | 23:37:27.954 | **~54s** |

---

## 2. 链路全景

```
用户点击💡
  → getIdeasFromAgent()                        [SimpleChartRecBox.tsx:357]
  → fetch(GET_RECOMMENDATION_QUESTIONS)        [SimpleChartRecBox.tsx:398]
  → Flask route get_recommendation_questions() [routes/agents.py:760]
  → InteractiveExploreAgent.run()              [agent_interactive_explore.py:100]
      ├─ build_lightweight_table_context()     [context.py:75]       ~100ms  ✅
      ├─ _run_inspect_round()                  [本文件:198]          20-40s  ⚠️ 主瓶颈
      │    └─ 最多 3 轮同步非流式 LLM 调用
      │         每轮：LLM 决策(10-20s) → 工具执行(瞬间) → 结果回传
      └─ streaming LLM call                    [本文件:181]          10-20s  正常
  → NDJSON 流返回前端
  → 前端逐行解析显示推荐
```

---

## 3. 各阶段耗时分析

### 3.1 前端 → 后端（<100ms）— 无问题

用户点击灯泡 → `getIdeasFromAgent()` 立刻构建 JSON body 并 fetch。
日志中请求到达与 Agent 启动之间仅 30-60ms。

### 3.2 `build_lightweight_table_context()`（~100ms）— 无问题

读取 parquet，构建轻量表结构摘要。具体产出内容（`context.py:75-164`）：

| 信息项 | 内容 | 来源 |
|-------|------|------|
| 表头 | 表名、文件名、行数 | `workspace.read_data_as_df()` |
| 列定义 | 所有列名 + 简化类型（int/float/str/datetime/bool） | `df.columns` + `df[col].dtype` |
| 样本行 | **前 3 行**（`df.head(3).to_string()`） | DataFrame |
| 数值统计 | **前 8 个数值列**的 min / max / mean | `df[col].min()` / `.max()` / `.mean()` |

示例输出：

```
Table: 产品利润 (file: 产品利润.parquet, 1,234 rows)
  Columns: 产品名(str), 类别(str), 销售额(float), 利润(float), 地区(str)
  Sample (first 3 rows):
    产品名   类别  销售额  利润  地区
    笔记本A  电子  12000  3600  华东
    打印机B  办公  4500   1200  华北
    显示器C  电子  8900   2670  华南
  Numeric stats:
    销售额: min=120, max=98000, mean=8543.21
    利润: min=-500, max=35000, mean=2156.78
```

### 3.3 `_run_inspect_round()` — 主瓶颈（20-40s）

```python
# agent_interactive_explore.py:198-277
def _run_inspect_round(self, messages, input_tables):
    max_rounds = 3
    tools = [INSPECT_TOOL]
    for _ in range(max_rounds):
        response = self._call_llm_with_tools(messages, tools)  # 同步非流式
        # ... 如果 LLM 调用了 inspect_source_data → 执行 → 追加结果 → 继续循环
```

#### 3.3.1 每轮的实际流程

1. **LLM 决策**（10-20s）：把完整 messages（system prompt + 轻量上下文 + 前几轮 inspect 结果）
   发给 LLM，LLM 决定是否调用 `inspect_source_data` 工具
2. **工具执行**（瞬间）：如果 LLM 调用了工具，执行 `handle_inspect_source_data()` → `generate_data_summary()`
3. **结果追加**：把工具结果放回 messages，进入下一轮

#### 3.3.2 inspect 工具收集的具体内容

`handle_inspect_source_data()`（`context.py:167-207`）调用 `generate_data_summary()`（`agent_utils.py:309-441`），
产出**详细数据摘要**：

| 信息项 | 内容 | 与轻量上下文的关系 |
|-------|------|-------------------|
| 表头 | 表名、文件路径、行数×列数 | **重复** |
| 表描述 | 来自 workspace metadata 的自然语言描述 | **新增** |
| Schema | 每列：名称、类型、**7 个代表性 unique 值**（排序后取首尾） | **核心增量** — 轻量上下文无此信息 |
| 列描述 | 来自 workspace metadata 的列级说明 | **新增** |
| 样本行 | 前 5 行（`df.head(5).to_string()`） | 比轻量上下文多 2 行 |

Schema 示例（`get_field_summary()`，`agent_utils.py:269-307`）：

```
  - 产品名 -- type: object, values: 打印机B, 显示器C, ..., 笔记本A
  - 类别 -- type: object, values: 办公, 电子
  - 销售额 -- type: float64, values: 120.0, 450.0, 1200.0, ..., 78000.0, 98000.0
  - 地区 -- type: object, values: 华东, 华北, 华南, 华中, ..., 西北
```

结果截断限制：≤3 张表 → **5000 字符**，>3 张表 → **3000 字符**。

#### 3.3.3 典型三轮调用场景（2 张表）

| 轮次 | LLM 行为 | 耗时 | 新增信息 |
|------|---------|------|---------|
| Round 1 | 看到轻量上下文 → 调用 `inspect_source_data(["产品利润"])` | 10-20s (LLM) + ~0s (工具) | 产品利润表的 unique 值分布 + 描述 |
| Round 2 | 看到 Round 1 结果 → 调用 `inspect_source_data(["销售记录"])` | 10-20s (LLM) + ~0s (工具) | 销售记录表的 unique 值分布 + 描述 |
| Round 3 | 看到所有内容 → **不调用工具** → break | 10-20s (LLM) | **无** — 纯决策开销，100% 浪费 |

**总耗时 30-60s**，其中最后一轮完全浪费。

#### 3.3.4 轻量上下文 vs. Inspect 信息对比

| 信息维度 | 轻量上下文（已有） | Inspect 新增 |
|---------|------------------|-------------|
| 表名 / 文件名 / 行数 | ✅ | ✅（重复） |
| 所有列名 + 类型 | ✅ | ✅（重复） |
| 样本行 | ✅ 3 行 | 5 行（多 2 行） |
| 数值统计（min/max/mean） | ✅ 前 8 列 | ❌ 反而没有 |
| **每列 unique 值分布** | ❌ | ✅ 7 个代表值 |
| **列描述（metadata）** | ❌ | ✅ |
| **表描述（metadata）** | ❌ | ✅ |

**结论：inspect 的核心增量只有三项** — 每列 unique 值分布、列描述、表描述。
其余内容与轻量上下文重复或反而不如轻量上下文（缺少 min/max/mean）。

#### 3.3.5 效率问题分析

1. **每轮收集的信息量太少**：LLM 倾向于每次只 inspect 一张表（"先看一张再决定是否看下一张"），
   即使工具定义的 `table_names` 支持数组。N 张表 → N+1 轮 LLM 调用。

2. **"决策"开销远大于"执行"开销**：每轮瓶颈在 LLM 决策（10-20s），
   工具执行（纯 Python 读 parquet + 计算）仅需毫秒级。且 messages 越来越长，
   后面轮次因 prompt 更长而更慢。

3. **最后一轮 100% 浪费**：无论前面调用了几次工具，最后一轮总是
   "LLM 判断不需要更多信息 → 不调用工具 → break"，白白消耗 10-20s。

4. **增量信息可零成本获取**：inspect 的核心增量（每列 unique 值分布、元数据描述）
   完全可以在 `build_lightweight_table_context()` 中直接计算（纯 Python，
   几十毫秒），无需通过 LLM tool call 来"发现"。

### 3.4 最终 streaming LLM call（10-20s）— 正常

inspect round 结束后才开始流式生成推荐问题。这一步延迟正常。

---

## 4. 根因总结

| 因素 | 影响 |
|------|------|
| `_run_inspect_round` 最多 3 轮同步 LLM 调用 | 20-40s 的纯等待，无任何前端反馈 |
| LLM 每轮只 inspect 1 张表 | N 张表 → N+1 轮调用，线性增长 |
| 最后一轮必定为空轮 | 10-20s 纯浪费（LLM 只是判断"不需要更多信息"） |
| inspect 增量信息可零成本计算 | unique 值分布 + metadata 描述可直接嵌入轻量上下文 |
| `build_lightweight_table_context` 已含 3 行样本 + 数值统计 | inspect round 的必要性存疑——轻量 context 可能已足够 |
| 前端无 inspect 阶段进度提示 | 用户体感更差 |

---

## 5. 优化方案

### 方案 A（推荐）：彻底消除 inspect round — 将增量信息嵌入轻量上下文

根据 §3.3.4 的对比分析，inspect 的核心增量只有三项，均可零成本获取：

1. **每列 unique 值分布**：在 `build_lightweight_table_context()` 中调用
   `get_field_summary()` 或等价逻辑，为每列计算 7 个代表性 unique 值
2. **表描述**：从 `workspace.get_metadata()` 读取
3. **列描述**：从 `workspace.get_metadata().tables[name].columns` 读取

改造 `build_lightweight_table_context()` 使其产出**完整上下文**，然后直接删除
`_run_inspect_round()` 和 `INSPECT_TOOL` 定义。

**预期收益**：**省掉全部 20-40s**，整个请求从 46-62s 降至 10-20s（仅剩最终 streaming 调用）
**风险**：极低 — 所有数据都来自同一个 parquet + metadata，只是改变了获取时机
**复杂度**：低 — 仅修改 `context.py` 和 `agent_interactive_explore.py`

### 方案 B：减少 inspect round 次数（低风险，效果明显但不彻底）

如果暂不重构轻量上下文，可将 `max_rounds` 从 3 降为 1，或根据表数量动态决定：
- 单表场景：0 轮（`build_lightweight_table_context` 已含样本数据，足够推荐）
- 多表场景：1 轮

**预期收益**：节省 10-20s（去掉 1-2 轮同步 LLM 调用）
**风险**：推荐质量可能略降，但轻量 context 已含列名+类型+3 行样本

### 方案 C：inspect round 期间流式反馈（体感优化）

在 `_run_inspect_round` 执行期间，向前端 yield 进度事件：

```json
{"type": "thinking", "content": "正在检查表结构..."}
{"type": "thinking", "content": "正在分析 产品利润 表的数据分布..."}
```

前端 `getIdeasFromAgent` 已有 `setThinkingBuffer` 机制，可直接利用。

**预期收益**：总耗时不变，但用户看到进度反馈，体感改善
**风险**：需改造 `run()` 方法的 generator 模式

### 方案 D：合并为单次带工具的 streaming call（复杂度较高）

将 inspect round 和最终生成合并为 **一次 streaming LLM 调用**，让 LLM 在生成过程中
按需调用 `inspect_source_data` 工具。这需要在 streaming 中处理 tool_call 事件。

**预期收益**：
- LLM 一边推理一边输出，前端立刻看到思考过程
- 总延迟可能降低（减少 prompt re-processing 开销）

**风险**：
- streaming + tool_call 的实现复杂度较高
- 不同 LLM provider 对 streaming tool call 的支持不一
- 需要修改前端解析逻辑

### 方案 E：缓存 inspect 结果（辅助优化）

如果同一表的数据未变，缓存 `generate_data_summary()` 的结果（以表名+行数+schema 为 key）。
减少重复调用时 inspect 工具的执行时间。但由于瓶颈在 LLM 调用而非工具执行，此方案单独效果有限。

---

## 6. 推荐实施顺序

1. **方案 A**（首选）：将 inspect 增量信息嵌入 `build_lightweight_table_context()`，
   彻底移除 inspect round。预期将总延迟从 46-62s 降至 10-20s。
2. **方案 C**（可选搭配）：如果最终 streaming 调用仍需 15s+ 才出首字，
   加入 thinking 进度提示改善体感。
3. **方案 D**（长期备选）：如果未来需要 LLM 动态决定 inspect 哪些表
   （如表数量 >10 的大 workspace），再考虑 streaming tool call 方案。

---

## 7. 相关代码定位

| 文件 | 关键位置 | 说明 |
|------|---------|------|
| `py-src/data_formulator/agents/agent_interactive_explore.py` | `_run_inspect_round()` L198-277 | 同步 LLM inspect 调用（主瓶颈） |
| `py-src/data_formulator/agents/agent_interactive_explore.py` | `run()` L100-196 | Agent 主入口 |
| `py-src/data_formulator/agents/context.py` | `build_lightweight_table_context()` L75 | 轻量上下文构建 |
| `py-src/data_formulator/agents/context.py` | `handle_inspect_source_data()` L167 | inspect 工具执行 |
| `py-src/data_formulator/routes/agents.py` | `get_recommendation_questions()` L760 | 后端路由 |
| `src/views/SimpleChartRecBox.tsx` | `getIdeasFromAgent()` L357-493 | 前端触发与流解析 |
| `src/app/useFormulateData.ts` | `streamIdeas()` L189 | 另一个前端触发入口 |
