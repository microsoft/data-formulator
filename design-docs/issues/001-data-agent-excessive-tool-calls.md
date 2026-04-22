# ISSUE-001: DataAgent 工具调用次数过多导致跨表查询失败

> 状态：分析完成，待修复
> 日期：2026-04-23
> 影响范围：DataAgent（`py-src/data_formulator/agents/data_agent.py`）

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

#### 问题 A：初始上下文只有骨架，没有数据

`build_lightweight_table_context`（`agents/context.py:75`）生成的初始信息只有列名和类型：

```
Table: 仓库结存数量金额 (file: data/仓库结存数量金额.csv, 500 rows)
  Columns: 仓库(str), 商品(str), 数量(int), 金额(float)
```

**没有** sample rows、**没有**数值统计。LLM 完全不知道数据长什么样，被迫先调工具"看一眼"。

#### 问题 B：`inspect_source_data` 返回被截断到 500 字符

`handle_inspect_source_data`（`agents/context.py:161`）：

```python
return content[:500] + "..." if len(content) > 500 else content
```

`generate_data_summary` 生成的完整摘要包含 Schema（每字段：名称+类型+7个示例值）和 Sample Data（5行）。一张 8 列的表，仅 Schema 部分就约 800 字符。500 字符截断在第 4-5 个字段处，Sample Data 完全丢失。

LLM 看到截断的 `...` 后，知道信息不全，主动调 `explore()` 补查。

#### 问题 C：`primary_tables` 默认只包含当前选中的一张表

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

#### 问题 D：explore() 每次调用 namespace 隔离

`local_sandbox.py:174`：

```python
namespace = {**allowed_objects}  # 全新 namespace，上次的变量全丢
```

每次 `explore()` 都在全新 namespace 中执行，变量不保留。LLM 不知道这一点（系统提示词没说明），可能尝试分步编码——第 1 步读表 A，第 2 步用第 1 步的变量——但第 2 步发现变量不存在，被迫重新读。

对于跨表查询，典型的 explore 链：

```
#1: import pandas; df1 = pd.read_csv('业务员业绩.csv'); print(df1.head())
#2: import pandas; df1 = pd.read_csv('业务员业绩.csv'); print(df1.describe())
#3: import pandas; df1 = pd.read_csv('业务员业绩.csv'); top10 = df1.nlargest(10,'销售额'); print(top10)
#4: import pandas; df2 = pd.read_csv('仓库结存.csv'); print(df2.head())
#5: import pandas; df1 = ...; df2 = ...; merged = ...; print(merged)
... 每次都要重新 import + 重新 read_csv
```

#### 问题 E：`max_tool_rounds = 8` 不够用

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

### P0：丰富初始上下文（解决 A）

**文件**：`agents/context.py` — `build_lightweight_table_context`

在初始 message 中直接包含：
- Top-5 sample rows（`df.head(5).to_string()`）
- 数值列的 mean / min / max 统计

**预期效果**：对于简单查询，LLM 可以零工具调用直接产出 visualize。

### P0：放宽 inspect_source_data 字符限制（解决 B）

**文件**：`agents/context.py` — `handle_inspect_source_data`

将 500 字符限制提高到 3000 字符。一张 8 列表的完整 Schema + Sample Data 约 1500 字符，3000 可以覆盖大多数表。

### P1：系统提示词优化（解决诱导层）

**文件**：`agents/data_agent.py` — `SYSTEM_PROMPT`

关键修改：
1. 删除 "Call tools as many times as needed"
2. 删除 "Always call think before visualize"
3. 新增 "The initial context already includes sample rows and statistics — if the data is straightforward, proceed directly to your action"
4. 新增 "Combine all related operations into a single explore() call"
5. 明确说明 explore() 的执行模型（namespace 是否保留）

### P1：提高 max_tool_rounds（解决 E）

**文件**：`agents/data_agent.py` — `_get_next_action`

从 8 提高到 15，给复杂查询留足空间。配合提示词优化后，实际消耗预计 2-5 轮。

### P2：think 工具改为可选

**文件**：`agents/data_agent.py` — `TOOLS` + `SYSTEM_PROMPT`

将 "Always call think before visualize" 改为可选。所有 action JSON 已有 `thought` 字段，think 工具的推理内容在前端被过滤（`result.tool !== "think"`），不产生可见步骤，属于冗余交互。

### P3：explore() namespace 持久化（解决 D）

**文件**：`sandbox/local_sandbox.py` + `agents/data_agent.py`

方案：在同一个 agent turn 内，为 explore 调用分配一个专用 worker，通过 `persist_namespace` 标志让变量在调用间存活（类似 Jupyter kernel）。turn 结束时清理。

改动范围：
- Worker 协议扩展（支持 4-tuple 消息 + `__clear_ns__` 指令）
- 新增 `SandboxSession` 类
- DataAgent 在 `_get_next_action` 期间管理 session 生命周期

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
