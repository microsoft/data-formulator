# ISSUE-001: DataAgent 工具调用次数过多导致跨表查询失败

> 状态：仅剩 1 项待修复（C: primary_tables），其余全部已修复
> 日期：2026-04-23
> 最后审查：2026-05-01
> 影响范围：DataAgent（`py-src/data_formulator/agents/data_agent.py`）
> 开发者文档：`dev-guides/12-sandbox-session.md`

---

## 1. 问题现象

用户加载两张表（如"业务员业绩"和"仓库结存数量金额"），提出跨表分析问题：

> "业务员业绩排名前10的人负责的产品，在库存中有对应的剩余商品吗？"

DataAgent 的行为：

1. 先询问 clarification（可选）
2. 用户选择 "Continue exploring"
3. Agent 连续调用 `explore()` 工具 7-9 次，每次都从 `import pandas as pd` 开始
4. 达到 `max_tool_rounds = 8` 上限
5. 返回空结果或报错，未产出任何可视化

前端表现为重复显示"运行代码中...: import pandas as pd..."多次后无结果。

---

## 2. 根因分析

问题由**多层因素叠加**造成，按因果链排列：

### 2.1 根因层：初始上下文信息不足

#### 问题 A：初始上下文只有骨架，没有数据 ✅ 已修复

`build_lightweight_table_context`（`agents/context.py:75`）生成的初始信息只有列名和类型：

```
Table: 仓库结存数量金额 (file: data/仓库结存数量金额.csv, 500 rows)
  Columns: 仓库(str), 商品(str), 数量(int), 金额(float)
```

**没有** sample rows、**没有**数值统计。LLM 完全不知道数据长什么样，被迫先调工具"看一眼"。

#### 问题 B：`inspect_source_data` 返回被截断到 500 字符 ✅ 已修复

`handle_inspect_source_data`（`agents/context.py:161`）：

```python
return content[:500] + "..." if len(content) > 500 else content
```

`generate_data_summary` 生成的完整摘要包含 Schema（每字段：名称+类型+7个示例值）和 Sample Data（5行）。一张 8 列的表，仅 Schema 部分就约 800 字符。500 字符截断在第 4-5 个字段处，Sample Data 完全丢失。

LLM 看到截断的 `...` 后，知道信息不全，主动调 `explore()` 补查。

#### 问题 C：`primary_tables` 默认只包含当前选中的一张表 ⬜ 待修复

前端 `SimpleChartRecBox.tsx:177-185`：

```typescript
const defaultPrimaryTableIds = React.useMemo(() => {
    if (currentTable.derive && !currentTable.anchored) {
        return currentTable.derive.source.filter(...);
    }
    // Source table: just this table
    return rootTables.some(t => t.id === currentTable.id) ? [currentTable.id] : [];
}, [currentTable, rootTables]);
```

如果用户当前选中"仓库结存数量金额"表，`primary_tables` **只有这一张**。后端据此生成分层上下文：

```
[PRIMARY TABLE]
  仓库结存数量金额 ...  ← LLM 的注意力焦点

[OTHER AVAILABLE TABLES]
  业务员业绩 ...         ← 容易被忽略
```

系统提示词说 "Prioritize these (primary tables)"，LLM 倾向于只深入分析 primary table。

### 2.2 放大层：sandbox 执行模型

#### 问题 D：explore() 每次调用 namespace 隔离 ✅ 已修复

##### 什么是 namespace

Sandbox 执行 `explore()` 中用户代码时，使用一个 Python dict 作为执行上下文（namespace），
所有 `import`、变量赋值（`df1 = ...`）、函数定义等都存在这个 dict 里。它等价于一个
Python 交互式会话的全局作用域。

##### 当前行为

`local_sandbox.py:174`：

```python
namespace = {**allowed_objects}  # 全新 namespace，上次的变量全丢
```

每次 `explore()` 调用都会创建一个**全新的 namespace**——只包含预设的 `allowed_objects`
（pandas、numpy 等白名单库），**上一次 explore() 中用户定义的所有变量全部丢失**。

这意味着：如果 LLM 在第 1 次 `explore()` 中定义了 `df1 = pd.read_csv(...)`，
第 2 次 `explore()` 中直接使用 `df1` 会得到 `NameError: name 'df1' is not defined`。

##### 为什么这会浪费 tool rounds

`max_tool_rounds`（当前 12）限制了 LLM 与工具之间来回交互的总次数。每调用一次
`explore()` / `inspect()` / `think()` / `visualize()` 等工具都消耗 1 轮。

由于 namespace 不保留，LLM 被迫在**每次 `explore()` 中重复所有前置操作**
（import、read_csv、数据清洗），导致大量 tool rounds 被浪费在重复劳动上：

```
轮次 1: explore()
  import pandas as pd
  df1 = pd.read_csv('业务员业绩.csv')
  print(df1.head())                           → 输出前5行，✅ 成功

轮次 2: explore()
  top10 = df1.nlargest(10, '销售额')          → 💥 NameError: 'df1' is not defined
                                                 （df1 在轮次 1 结束时已被丢弃）

轮次 3: explore()  ← LLM 看到报错，被迫重新加载
  import pandas as pd                          ← 重复 import
  df1 = pd.read_csv('业务员业绩.csv')          ← 重复读文件
  top10 = df1.nlargest(10, '销售额')
  print(top10['产品'].tolist())                → ✅ 成功

轮次 4: explore()
  df2 = pd.read_csv('仓库结存.csv')
  result = df2[df2['商品'].isin(top10['产品'])]  → 💥 NameError: 'top10' is not defined

轮次 5: explore()  ← 再次被迫从头来
  import pandas as pd                          ← 第三次 import
  df1 = pd.read_csv('业务员业绩.csv')          ← 第三次读表 A
  top10 = df1.nlargest(10, '销售额')           ← 第二次算 top10
  df2 = pd.read_csv('仓库结存.csv')            ← 第二次读表 B
  result = df2[df2['商品'].isin(top10['产品'])]
  print(result)                                → ✅ 终于成功
```

本来 1-2 轮就能完成的工作，因为 namespace 隔离消耗了 5 轮。对于更复杂的多表分析，
这种膨胀会更严重，轻松超过 `max_tool_rounds` 上限导致整个查询失败。

##### 与 Jupyter Notebook 的对比

| | Jupyter Notebook | 当前 explore() |
|---|---|---|
| 变量生命周期 | Kernel 存活期间保留 | 每次调用后丢弃 |
| 分步编码 | 自然：Cell 1 定义变量，Cell 2 直接用 | 不可能：每次都要从头写 |
| 跨表分析 | 分步加载、分步处理 | 必须把全部逻辑塞进一次调用 |

##### 当前缓解措施

系统提示词已明确告知 LLM namespace 不保留：

> "each call runs in a fresh namespace — variables do NOT persist between calls.
> Combine all related operations into a single explore() call."

这使得 LLM 会主动把所有操作合并到一次 `explore()` 中，避免分步调用。
对于大多数场景已经足够，但对于特别复杂的多步分析（代码量大、需要观察中间结果
再决定下一步）仍然受限。

##### 影响范围

并非所有 agent 都受此问题影响。关键区别在于 agent 是否有 **agentic loop**
（LLM 自主决定调什么工具、调多少次）以及是否会**跨调用复用变量**：

| Agent | 调用模式 | 受影响 | 原因 |
|---|---|---|---|
| **DataAgent** | agentic loop（`_get_next_action`，最多 12 轮），LLM 可多次调用 `explore()` | **是** | LLM 倾向分步探索，期望复用前次定义的 DataFrame 等变量 |
| **DataLoadingAgent** | agentic loop（`max_iterations=10`），LLM 可多次调用 `execute_python` | **是** | 同上，多步数据处理时 LLM 会尝试复用变量 |
| DataTransformationAgent | 重试循环：LLM 生成完整代码 → 执行 → 失败则重新生成 | 否 | 每次执行的是独立完整的代码，不依赖前次变量 |
| DataRecAgent | 同上，重试模式 | 否 | 同上 |
| 其他 agent | 不调用 sandbox | 否 | 无 sandbox 交互 |

#### 问题 E：`max_tool_rounds = 8` 不够用 ✅ 部分修复（当前 12，设计目标 15）

对于上述跨表场景，inspect(×2) + explore(×4-6) + think(×1) 轻松超过 8 轮。

### 2.3 诱导层：系统提示词鼓励多次调用

```
Call tools as many times as needed.
Always call this (think) before visualize.
```

- "as many times as needed"：没有节制引导
- "Always call think"：强制多一轮交互
- think 工具本身在前端被 `result.tool !== "think"` 过滤，不产生可见步骤

---

## 3. 因果关系图

```
信息不足（A+B+C）
  │
  ├→ LLM 被迫调 inspect/explore 看数据
  │     │
  │     ├→ inspect 被截断（B）→ 还是要 explore 补查
  │     │
  │     └→ explore namespace 不保留（D）→ 每次重复读文件
  │           │
  │           └→ 消耗大量 tool rounds
  │
  ├→ primary_tables 只有一张（C）→ LLM 先深入分析 primary 再看 other
  │                                   → 更多 explore 轮次
  │
  └→ 系统提示词鼓励多次调用 → LLM 没有"尽快产出 action"的压力
        │
        └→ 8 轮用完（E）→ 失败，无输出
```

---

## 4. 修复方案

按优先级排列，优先修复根因层：

### P0：丰富初始上下文（解决 A）✅ 已修复

**文件**：`agents/context.py` — `build_lightweight_table_context`

在初始 message 中直接包含：
- Top-5 sample rows（`df.head(5).to_string()`）
- 数值列的 mean / min / max 统计

**预期效果**：对于简单查询，LLM 可以零工具调用直接产出 visualize。

**修复情况**：函数已重构，现在包含 `df.head(max_sample_rows).to_string()` 输出的样本行和 `df.describe()` 输出的数值统计信息。

### P0：放宽 inspect_source_data 字符限制（解决 B）✅ 已修复（实现方式与设计略有不同）

**文件**：`agents/context.py` — `handle_inspect_source_data`

将 500 字符限制提高到 3000 字符。一张 8 列表的完整 Schema + Sample Data 约 1500 字符，3000 可以覆盖大多数表。

**修复情况**：原来的 `content[:500]` 一刀切截断已被**完全移除**，现在直接返回 `generate_data_summary(...)` 的完整结果。但样本数据受 `TABLE_SAMPLE_CHAR_LIMIT = 1000`（而非设计中的 3000）预算约束。核心问题（500 字符截断导致信息丢失）已解决。

### P1：系统提示词优化（解决诱导层）✅ 已修复

**文件**：`agents/data_agent.py` — `SYSTEM_PROMPT`

关键修改：
1. 删除 "Call tools as many times as needed"
2. 删除 "Always call think before visualize"
3. 新增 "The initial context already includes sample rows and statistics — if the data is straightforward, proceed directly to your action"
4. 新增 "Combine all related operations into a single explore() call"
5. 明确说明 explore() 的执行模型（namespace 是否保留）

**修复情况**：以上 5 项提示词优化均已应用到系统提示词中。

### P1：提高 max_tool_rounds（解决 E）✅ 部分修复

**文件**：`agents/data_agent.py` — `_get_next_action`

从 8 提高到 15，给复杂查询留足空间。配合提示词优化后，实际消耗预计 2-5 轮。

**修复情况**：`max_tool_rounds` 已从 8 提高到 **12**（而非设计中的 15）。配合提示词优化，实际消耗已大幅减少，12 轮对大多数场景足够。

### P2：think 工具改为可选 ✅ 已修复

**文件**：`agents/data_agent.py` — `TOOLS` + `SYSTEM_PROMPT`

将 "Always call think before visualize" 改为可选。所有 action JSON 已有 `thought` 字段，think 工具的推理内容在前端被过滤（`result.tool !== "think"`），不产生可见步骤，属于冗余交互。

**修复情况**：think 工具已从强制调用改为可选（"You may optionally call think..."）。

### P3：explore() namespace 持久化（解决 D）✅ 已修复

**文件**：`sandbox/local_sandbox.py` + `agents/data_agent.py` + `agents/agent_data_loading_chat.py`

**目标**：在同一个 agent turn（一次用户请求的完整处理过程）内，让多次 `explore()` 调用
共享同一个 Python namespace，使变量在调用间存活（类似 Jupyter kernel）。turn 结束时清理。

**期望效果**：

```
轮次 1: explore()
  df1 = pd.read_csv('业务员业绩.csv')
  print(df1.head())                           → ✅ df1 保留在 namespace 中

轮次 2: explore()
  top10 = df1.nlargest(10, '销售额')          → ✅ 直接使用 df1，无需重新读取
  print(top10)

轮次 3: explore()
  df2 = pd.read_csv('仓库结存.csv')
  result = df2[df2['商品'].isin(top10['产品'])] → ✅ 直接使用 top10
  print(result)
```

3 轮完成，无重复操作。

**改动范围**：

1. **Worker 协议扩展**（`local_sandbox.py`）
   - 当前协议为 3-tuple：`(code, allowed_objects, workspace_path)`
   - 扩展为 4-tuple：`(code, allowed_objects, workspace_path, persist_namespace)`
   - 当 `persist_namespace=True` 时，worker 不重建 namespace，而是复用上次的
   - 新增 `__clear_ns__` 指令，用于 turn 结束时清理持久化的 namespace

2. **新增 `SandboxSession` 类**（`local_sandbox.py`）
   - 封装一个绑定到特定 worker 的会话，持有该 worker 的 namespace 状态
   - 提供 `execute(code)` 方法（自动带 `persist_namespace=True`）
   - 提供 `close()` 方法（发送 `__clear_ns__`，释放 worker 回池）
   - 支持 context manager（`with SandboxSession(...) as session:`）

3. **DataAgent session 生命周期管理**（`data_agent.py`）
   - 在 `_get_next_action` 开始时创建 `SandboxSession`
   - 所有 `explore()` 调用通过 session 执行
   - `_get_next_action` 结束（无论成功/失败/超限）时关闭 session，清理 namespace
   - 保证不会跨用户请求泄漏变量

4. **DataLoadingAgent session 生命周期管理**（`agent_data_loading_chat.py`）
   - 同样具有 agentic loop（`max_iterations=10`），LLM 可多次调用 `execute_python`
   - 需要在 loop 开始时创建 `SandboxSession`，loop 结束时关闭
   - 改动方式与 DataAgent 一致

**安全考虑**：
- namespace 持久化范围严格限定在单次 agent turn 内，turn 结束必须清理
- 不同用户请求之间的 namespace 完全隔离
- worker 超时或异常时自动清理

**修复情况**：

- **Within-turn 持久化**（已实现）：`SandboxSession` 类（`local_sandbox.py`），Worker
  协议扩展为 4-tuple + `__clear_ns__`。DataAgent 和 DataLoadingAgent 均已接入 session。
- **Cross-turn 持久化**（已实现）：当 DataAgent 的 tool rounds 耗尽时，`save_namespace()`
  将 DataFrame（parquet）和标量（JSON manifest）序列化到用户 workspace 的
  `scratch/_explore_ns/` 目录。下次用户选择"继续探索"时，`restore_namespace()` 在新
  session 中恢复变量，然后清理磁盘文件。新对话开始时自动清理旧状态。

详见 `dev-guides/12-sandbox-session.md`。

---

## 5. 验证方法

### 测试场景

加载至少两张表，提出跨表分析问题：
- "业务员业绩排名前10的人负责的产品，在库存中有对应的剩余商品吗？"
- "对比两个季度的销售额变化"

### 验证指标

| 指标 | 修复前 | 修复后目标 |
|---|---|---|
| explore 调用次数 | 7-9 次 | ≤ 3 次 |
| 是否产出结果 | 否（超限） | 是 |
| 首次响应耗时 | >40s（然后失败） | <30s |
| 跨表查询成功率 | ~0% | >80% |

### 日志观察点

```
[DataAgent] Executed N tool call(s), looping back to LLM
[DataAgent] iteration X total=Y.YYs reason=ok
```

观察 N 值（单次 LLM 响应中的 tool call 数量）和总迭代次数。

---

## 6. 相关文件

| 文件 | 角色 |
|---|---|
| `py-src/data_formulator/agents/data_agent.py` | Agent 主逻辑、系统提示词、工具定义 |
| `py-src/data_formulator/agents/context.py` | 初始上下文构建、inspect_source_data 处理 |
| `py-src/data_formulator/agents/agent_utils.py` | `generate_data_summary` 生成完整表摘要 |
| `py-src/data_formulator/sandbox/local_sandbox.py` | Sandbox 执行、worker 池、namespace 管理 |
| `src/views/SimpleChartRecBox.tsx` | 前端表选择、primary_tables 计算、事件处理 |
| `py-src/data_formulator/routes/agents.py` | 路由层，接收前端参数传给 DataAgent |
