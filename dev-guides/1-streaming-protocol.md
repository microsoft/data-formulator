# 前后端流式通信协议

> **维护者**: DF 核心团队  
> **最后更新**: 2026-04-30  
> **适用范围**: 所有 `/api/agent/*` 流式端点

## 1. 协议总览

所有流式端点统一使用 **NDJSON**（Newline-Delimited JSON）协议：

- **Content-Type**: `application/x-ndjson`
- **每行**: 一个完整的 JSON 对象，以 `\n` 结尾
- **编码**: UTF-8，`ensure_ascii=False`
- **HTTP 状态码**: 流式端点始终返回 `200`。预检失败返回 `200 application/json`
  的统一错误 envelope；流建立后的错误通过流内事件传递。

```
{"type": "question", "text": "...", "goal": "...", "tag": "..."}\n
{"type": "warning", "warning": {"message": "..."}}\n
{"type": "error", "error": {"code": "...", "message": "..."}}\n
```

> **禁止**: 使用 SSE `data: ` 前缀、混合 MIME 类型、在流中返回非 JSON 行。

## 2. 事件类型

### 2.1 业务事件（各端点自定义）

业务事件的 `type` 值由各端点定义，前端按端点消费。

| 端点 | 事件 type | 说明 |
|------|-----------|------|
| `data-agent-streaming` | `"text_delta"`, `"completion"`, `"clarify"` 等 | 顶层 `type` 事件 |
| `get-recommendation-questions` | `"question"` | 探索建议问题 |
| `generate-report-chat` | `"text_delta"`, `"embed_chart"`, `"embed_table"` | 报告生成流 |
| `data-loading-chat` | `"text_delta"`, `"tool_call"`, `"tool_result"`, `"done"` | 数据加载对话 |
| `clean-data-stream` | 各种 agent 事件 | 数据清洗流 |
| （跨端点通用） | `"thinking_text"` | Agent 推理/思考过程文本（参见 2.4） |

`data-agent-streaming` 的 `result.type === "clarify"` 使用结构化多问题格式。后端和前端都以
`questions[]` 为唯一澄清问题结构。问题与选项均不带 ID —— 通过它们在数组中的位置来对应。

```json
{
  "type": "clarify",
  "questions": [
    {
      "text": "Which metric should I use?",
      "responseType": "single_choice",
      "options": ["Revenue", "Orders"]
    }
  ],
  "trajectory": [],
  "completed_step_count": 2
}
```

字段约定：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `questions` | array | 是 | 本轮所有需要用户澄清的问题，最多 3 个 |
| `questions[].text` | string | 是 | 英文 fallback 或 LLM 生成的问题文本 |
| `questions[].text_code` | string | 否 | 固定后端问题文案的 i18n key，例如 `agent.clarifyExhausted` |
| `questions[].text_params` | object | 否 | `text_code` 的插值参数 |
| `questions[].responseType` | `"single_choice"` / `"free_text"` | 否 | 默认按是否有 options 推断 |
| `questions[].options` | array | 否 | 单选选项；可以是字符串数组或 `{label, label_code?}` 对象数组 |
| `questions[].options[].label` | string | 是 | 英文 fallback 或 LLM 生成的选项文本 |
| `questions[].options[].label_code` | string | 否 | 固定后端选项文案的 i18n key |

恢复请求只需把已经组装好的用户回复作为普通的 `user_question` 字段传回，前端负责把
点选 + 自由输入合并成形如 `1. <a1>; 2. <a2>\n<freeform>` 的字符串：

```json
{
  "trajectory": [],
  "user_question": "1. Revenue; 2. Last 12 months\nFocus on growth rate.",
  "completed_step_count": 2
}
```

后端把 `user_question` 作为普通的 user 消息追加到 trajectory，再交给 LLM 继续推理。
不再有专用的 `clarification_responses` / `auto_select` / `[USER CLARIFICATION]` 包装层。

### 2.2 错误事件（统一格式）

当流中发生致命错误时，后端 yield 一个 error 事件并终止流。

```json
{
  "type": "error",
  "error": {
    "code": "LLM_RATE_LIMIT",
    "message": "请求过于频繁，请稍后重试",
    "retry": true
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `"error"` | 是 | 固定值 |
| `error.code` | string | 是 | 机器可读错误码（见 `errors.py` `ErrorCode`） |
| `error.message` | string | 是 | 安全的用户可读消息 |
| `error.retry` | boolean | 是 | 前端是否应显示重试按钮 |
| `error.detail` | string | 否 | 仅 DEBUG 模式，服务端调试信息 |

流式事件不得携带通用业务 `token` 字段；请求追踪使用 `X-Request-Id` header。

**后端生成**:

```python
from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error

# LLM 异常 → 安全分类 → error 事件
yield stream_error_event(classify_and_wrap_llm_error(e))

# 已知业务异常
from data_formulator.errors import AppError, ErrorCode
yield stream_error_event(AppError(ErrorCode.TABLE_NOT_FOUND, "Table not found"))
```

### 2.3 警告事件（非致命，不中断流）

后端遇到非致命问题（如某张表不可读但不影响整体请求）时发送 warning 事件。

```json
{
  "type": "warning",
  "warning": {
    "message": "Table 'sales_data' unavailable — it may have been removed",
    "message_code": "TABLE_READ_FAILED",
    "detail": "FileNotFoundError: ..."
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `"warning"` | 是 | 固定值 |
| `warning.message` | string | 是 | 用户可读的警告消息 |
| `warning.message_code` | string | 否 | 机器可读的警告码 |
| `warning.detail` | string | 否 | 额外调试信息 |

**后端生成方式有两种**:

```python
# 方式 1: 在 generator 中直接 yield（适合 agent 的 run() 方法）
from data_formulator.error_handler import stream_warning_event
yield stream_warning_event("Table unavailable", message_code="TABLE_READ_FAILED")

# 方式 2: 在非 generator 函数中收集（适合深层 helper 函数）
from data_formulator.error_handler import collect_stream_warning
collect_stream_warning("Table unavailable", message_code="TABLE_READ_FAILED")
# → 由 route 层的 _with_warnings() wrapper 自动刷新到流中
```

**前端处理**: 收到 warning 事件后 dispatch `dfActions.addMessages` 显示为黄色 Snackbar，不中断当前流处理。

### 2.4 思考过程事件（`thinking_text`）

Agent 在执行过程中产生的推理/思考文本。前端应实时展示为可折叠的 thinking block，帮助用户理解 Agent 的决策过程。

```json
{
  "type": "thinking_text",
  "content": "Let me analyze the data structure to determine the best chart type..."
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `"thinking_text"` | 是 | 固定值 |
| `content` | string | 是 | Agent 的推理/思考文本片段（可增量追加） |

**事件来源**：

1. **Agent 层面的 think tool**：`DataAgent` 使用 `think` 工具时，将 tool message 以 `thinking_text` 事件输出。
2. **LLM 伴随内容**：当 LLM 在 tool_calls 旁返回文本 content 时，Route 层将其作为 `thinking_text` 事件输出。
3. **（Phase 2/3）模型原生推理**：Anthropic extended thinking 或 OpenAI reasoning tokens（`reasoning_content` 字段），由 `client_utils.py` 解析后输出为 `thinking_text` 事件。

**后端生成**：

```python
# Agent 的 think tool 输出
yield {"type": "thinking_text", "content": thought_msg}

# LLM 响应中的伴随文本（非 tool_calls 结果）
if content.strip():
    yield {"type": "thinking_text", "content": content.strip()}
```

**前端处理**：

- 累积 `thinking_text` 事件到 `thinkingSteps` 数组
- 在 UI 中显示为可折叠的思考过程面板（类似 ChatGPT thinking block）
- 当后续出现 `tool_start` 等行动事件时，将累积的 thinking 作为一个完整步骤展示
- thinking 内容不应触发 snackbar 或错误提示

**与其他事件的关系**：

- `thinking_text` 是非致命、非阻塞事件，不影响流的继续
- 可以与 `tool_start`、`tool_result`、`text_delta` 交替出现
- 如果流中只有 `thinking_text` 没有后续行动，前端应显示为"正在思考..."状态

## 3. Route 层职责

Route 层（`routes/agents.py`）是后端流式协议的**序列化边界**：

### 3.1 序列化规则

| Agent 输出 | Route 层处理 | 最终输出 |
|---|---|---|
| `yield dict` | `json.dumps(dict) + '\n'` | 标准 NDJSON 行 |
| `yield str`（LLM 文本碎片） | 累积 → 按 `\n` 拆行 → `json.loads` 验证 → `json.dumps` + `'\n'` | 标准 NDJSON 行 |

> **原则**: Agent 层不负责 NDJSON 序列化，Route 层统一处理。Agent 只 yield Python dict 或原始文本。

### 3.2 Warning 注入

所有流式端点的 `generate()` 函数通过 `_with_warnings()` wrapper 包裹：

```python
response = Response(
    stream_with_context(_with_warnings(generate())),
    mimetype='application/x-ndjson',
)
```

深层代码（agent helpers）中调用 `collect_stream_warning()` 收集的 warning 会在每个 chunk 之前自动刷新到流中。

## 4. 前端消费规范

### 4.1 标准解析器

`apiClient.ts` 提供 `parseStreamLine()` 和 `streamRequest()` 作为标准工具。**新端点应优先使用这些函数**。

### 4.2 手动解析（已有端点）

已有端点中手动解析 NDJSON 的代码应遵循以下模式：

```typescript
const parsed = JSON.parse(trimmed);

// 1. 先检查 error — 可能需要中断流
if (parsed.type === 'error') {
    dispatch(dfActions.addMessages([{ type: 'error', ... }]));
    return; // 或 continue，取决于语义
}

// 2. 再检查 warning — 显示通知，继续处理
if (parsed.type === 'warning') {
    dispatch(dfActions.addMessages([{ type: 'warning', ... }]));
    continue;
}

// 3. 处理业务事件
if (parsed.text) { ... }
```

### 4.3 禁止事项

- **禁止** `catch(() => {})` 静默吞掉错误
- **禁止** 假设流中只有业务事件（必须处理 error 和 warning）
- **禁止** 在前端做 `data: ` 前缀剥离（后端保证发送纯 NDJSON）

## 5. 端点格式对照表

| 端点 | MIME | 序列化方式 | error 格式 | warning 支持 |
|------|------|------------|------------|-------------|
| `/data-agent-streaming` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ✅ `_with_warnings` |
| `/get-recommendation-questions` | `x-ndjson` | route 累积碎片 → `_try_parse_explore_line` | `stream_error_event` | ✅ `_with_warnings` |
| `/generate-report-chat` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ✅ `_with_warnings` |
| `/data-loading-chat` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ✅ `_with_warnings` |
| `/clean-data-stream` | `x-ndjson` | agent 直接 yield | `stream_error_event` | ✅ `_with_warnings` |

> **注意**: `/refine-data` 曾出现在此表中，但实际实现为普通 JSON endpoint（`jsonify` 返回），不使用 NDJSON 流。已于 2026-04-30 Phase 0 盘点中确认并移除。详见 `design-docs/20` 附录 A.10。

## 6. 新增端点 Checklist

添加新的流式端点时，请确认：

- [ ] `mimetype='application/x-ndjson'`
- [ ] 使用 `stream_with_context(_with_warnings(generate()))` 包裹
- [ ] `generate()` 中的 `except` 使用 `stream_error_event(classify_and_wrap_llm_error(e))`
- [ ] 流建立前的校验失败返回 `200 application/json` + `{"status": "error", ...}`，不创建 NDJSON 流
- [ ] Agent yield 的是 dict（Route 层负责 `json.dumps`）
- [ ] 前端消费代码处理 `type: "error"` 和 `type: "warning"`
- [ ] 不在响应体中使用 `str(e)` / `str(exc)`
- [ ] 如返回 Data Agent `clarify`，使用结构化 `questions[]`，resume 使用 `clarification_responses[]`
