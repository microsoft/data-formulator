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

读取 parquet，构建轻量表结构摘要（表名、列名+类型、行数、3 行样本数据）。

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

问题：
- 最多 **3 轮同步、非流式** LLM 调用，每轮 10-20s
- 在整个 inspect round 期间，**前端收不到任何数据**（HTTP 连接已建立但 streaming 未开始 yield）
- 这是用户感知"很久才开始"的直接原因

### 3.4 最终 streaming LLM call（10-20s）— 正常

inspect round 结束后才开始流式生成推荐问题。这一步延迟正常。

---

## 4. 根因总结

| 因素 | 影响 |
|------|------|
| `_run_inspect_round` 最多 3 轮同步 LLM 调用 | 20-40s 的纯等待，无任何前端反馈 |
| `build_lightweight_table_context` 已含 3 行样本 | inspect round 的必要性存疑——轻量 context 可能已足够 |
| 前端无 inspect 阶段进度提示 | 用户体感更差 |

---

## 5. 优化方案

### 方案 A：减少 inspect round 次数（低风险，效果明显）

将 `max_rounds` 从 3 降为 1，或根据表数量动态决定：
- 单表场景：0 轮（`build_lightweight_table_context` 已含样本数据，足够推荐）
- 多表场景：1 轮

**预期收益**：节省 10-20s（去掉 1-2 轮同步 LLM 调用）
**风险**：推荐质量可能略降，但轻量 context 已含列名+类型+3 行样本

### 方案 B：inspect round 期间流式反馈（中等复杂度）

在 `_run_inspect_round` 执行期间，向前端 yield 进度事件：

```json
{"type": "thinking", "content": "正在检查表结构..."}
{"type": "thinking", "content": "正在分析 产品利润 表的数据分布..."}
```

前端 `getIdeasFromAgent` 已有 `setThinkingBuffer` 机制，可直接利用。

**预期收益**：总耗时不变，但用户看到进度反馈，体感改善
**风险**：需改造 `run()` 方法的 generator 模式

### 方案 C：合并为单次带工具的 streaming call（效果最好，复杂度较高）

将 inspect round 和最终生成合并为 **一次 streaming LLM 调用**，让 LLM 在生成过程中
按需调用 `inspect_source_data` 工具。这需要在 streaming 中处理 tool_call 事件。

**预期收益**：
- LLM 一边推理一边输出，前端立刻看到思考过程
- 总延迟可能降低（减少 prompt re-processing 开销）

**风险**：
- streaming + tool_call 的实现复杂度较高
- 不同 LLM provider 对 streaming tool call 的支持不一
- 需要修改前端解析逻辑

### 方案 D：缓存 inspect 结果（辅助优化）

如果同一表的数据未变，缓存 `generate_data_summary()` 的结果（以表名+行数+schema 为 key）。
减少重复调用时 inspect 工具的执行时间。但由于瓶颈在 LLM 调用而非工具执行，此方案单独效果有限。

---

## 6. 推荐实施顺序

1. **方案 A**（先做）：将 `max_rounds` 降为 1，单表场景考虑跳过 inspect round。立竿见影，低风险。
2. **方案 B**（搭配 A）：让 inspect round 期间有进度反馈。改善体感。
3. **方案 C**（长期）：如果方案 A+B 效果仍不满意，重构为单次 streaming tool call。

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
