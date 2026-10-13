# 前后端流式通信协议

> **维护者**: DF 核心团队  
> **最后更新**: 2026-10-13  
> **适用范围**: 所有 NDJSON 流式端点（`/api/agent/analyst-streaming`、`/api/workflows/run`）

## 1. 协议总览

所有流式端点统一使用 **NDJSON**（Newline-Delimited JSON）协议：

- **Content-Type**: `application/x-ndjson`
- **每行**: 一个完整的 JSON 对象，以 `\n` 结尾
- **编码**: UTF-8，`ensure_ascii=False`
- **HTTP 状态码**: 流式端点始终返回 `200`。预检失败返回 `200 application/json`
  的统一错误 envelope；流建立后的错误通过流内事件传递。

```
{"type": "thinking_text", "content": "..."}\n
{"type": "warning", "warning": {"message": "..."}}\n
{"type": "error", "error": {"code": "...", "message": "..."}}\n
```

> **禁止**: 使用 SSE `data: ` 前缀、混合 MIME 类型、在流中返回非 JSON 行。

## 2. 事件类型

### 2.1 业务事件（各端点自定义）

业务事件的 `type` 值由各端点定义，前端按端点消费。

| 端点 | 事件 type | 说明 |
|------|-----------|------|
| `/api/agent/analyst-streaming` | `"thinking_text"`, `"tool_start"`, `"tool_result"`, `"skill_loaded"`, `"context_info"`, `"action"`, `"text_delta"`, `"result"`, `"data_operation_result"`, `"terminal_started"`, `"terminal_running"`, `"terminal_result"` | `AnalystAgent` 运行过程事件；`text_delta` 带 `channel`（如 `"report"`，报告正文流） |
| `/api/agent/analyst-streaming` | `"completion"`, `"interact"` | 终止事件：运行结束 / 暂停等待用户回复 |
| `/api/workflows/run` | `"workflow_state"`, `"activity"`, `"action"`, `"text_delta"`, `"terminal_running"`, `"terminal_result"` | Workflow 运行状态与报告流 |
| （两端点通用） | `"heartbeat"` | 空闲时的保活行，前端忽略 |
| （跨端点通用） | `"thinking_text"` | Agent 推理/思考过程文本（参见 2.4） |

`analyst-streaming` 的 `interact` 事件用于暂停运行。`ask_user` action（`analyst/skills/meta/skill.py`）
产生结构化多问题格式，后端和前端都以 `questions[]` 为唯一澄清问题结构。问题与选项均不带 ID ——
通过它们在数组中的位置来对应。Agent 外壳（`AnalystAgent._route_skill_events`）会在 `interact`
事件上补充恢复所需的 `trajectory` 和 `completed_step_count`。

```json
{
  "type": "interact",
  "thought": "...",
  "questions": [
    {
      "text": "Which metric should I use?",
      "responseType": "single_choice",
      "required": true,
      "options": [{"label": "Revenue"}, {"label": "Orders"}]
    }
  ],
  "trajectory": [],
  "completed_step_count": 2
}
```

字段约定：

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `questions` | array | 是 | 本轮所有需要用户回复的问题 |
| `questions[].text` | string | 否* | 英文 fallback 或 LLM 生成的问题文本（`text` 与 `text_code` 至少一个） |
| `questions[].text_code` | string | 否 | 固定后端问题文案的 i18n key |
| `questions[].text_params` | object | 否 | `text_code` 的插值参数 |
| `questions[].responseType` | `"single_choice"` / `"multi_choice"` / `"free_text"` | 是 | 取值非法时后端按是否有 options 推断 |
| `questions[].required` | boolean | 是 | 默认 `true`；可选的说明/跟进问题为 `false` |
| `questions[].options` | array | 否 | 选项对象数组 `{label, label_code?}`（LLM 给出的字符串会被规范化为对象） |
| `questions[].options[].label` | string | 否* | 英文 fallback 或 LLM 生成的选项文本（`label` 与 `label_code` 至少一个） |
| `questions[].options[].label_code` | string | 否 | 固定后端选项文案的 i18n key |

其他 `interact` 变体：数据加载计划选择（附带 `data_operation`，选项带 `value` = plan id）、
连接器表单（`form`）、终端命令审批（`terminal_request`）。前端在 `SimpleChartRecBox.tsx`
中按字段分别处理，带 `questions[]` 的 `interact` 统一走澄清面板。

恢复请求只需把已经组装好的用户回复作为普通的 `user_question` 字段传回，前端
（`src/app/clarification.ts` 的 `formatClarificationResponses()`）负责把点选 + 自由输入合并成形如
`1. <a1>; 2. <a2>\n<freeform>` 的字符串：

```json
{
  "trajectory": [],
  "user_question": "1. Revenue; 2. Last 12 months\nFocus on growth rate.",
  "completed_step_count": 2
}
```

后端把 `user_question` 作为普通的 user 消息追加到 trajectory，再交给 LLM 继续推理。
带 `trajectory` 恢复时 `user_question` 不能为空。数据加载计划选择和终端审批分别额外携带
`interaction_response`（`{operation_id, plan_id}` 或 `{operation_id, action: "elaborate"}`）和
`terminal_response`（`{request_id, decision: "approve" | "reject"}`）。

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

`stream_error_event()` 返回的已是以 `\n` 结尾的 NDJSON 字符串，route 直接 yield。

`AnalystAgent` 自身遇到运行终止类错误（如 LLM API 失败）时，还会 yield 一种 Agent 级 error 事件：
`{"type": "error", "message": "...", "message_code": "agent.llmApiError"}`（见 `AnalystAgent._error_event`）。
skill handler yield 的 error 事件属于可恢复的内部重试信号，会被 `_route_skill_events` 丢弃，不进入流。
前端同时兼容这两种 error 形态（有 `error` 对象时用 `getErrorMessage()`，否则用
`translateBackend(message, message_code, message_params)`）。

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
# 方式 1: 在 generator 中直接 yield
from data_formulator.error_handler import stream_warning_event
yield stream_warning_event("Table unavailable", message_code="TABLE_READ_FAILED")

# 方式 2: 在非 generator 函数中收集（适合深层 helper 函数）
from data_formulator.error_handler import collect_stream_warning
collect_stream_warning("Table unavailable", message_code="TABLE_READ_FAILED")
# → 由 route 层的 _with_warnings() wrapper 自动刷新到流中
```

当前使用方式 2 的位置：`agents/agent_utils.py`（`TABLE_READ_FAILED`）和 `agents/context.py`（`TABLE_INSPECT_FAILED`）。

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

1. **LLM 伴随内容**：当 LLM 在 tool_calls 旁返回文本 content 时，`AnalystAgent` 将其作为 `thinking_text` 事件输出。
2. **模型原生推理链保持**：部分推理模型（当前为 DeepSeek V4）在响应中返回 `reasoning_content` 字段，该字段在多轮对话中必须回传至 assistant 消息。`AnalystAgent` 和 `WorkflowAgent` 通过 `agent_utils.attach_reasoning_content()` 和 `accumulate_reasoning_content()` 统一处理。该内容只回传给模型，不作为 `thinking_text` 输出。

**后端生成**：

```python
# LLM 响应中的伴随文本（与 tool_calls 一起返回）
if tool_calls:
    if content.strip():
        yield {"type": "thinking_text", "content": content.strip()}
```

**前端处理**（`SimpleChartRecBox.tsx`）：

- 累积 `thinking_text` 内容，暂存为待展示的 thought
- 尚无工具/行动步骤时，显示"正在思考..."进度项
- 当后续出现 `tool_start` 等行动事件时，将累积的 thinking 作为该步骤的一部分展示
- thinking 内容不应触发 snackbar 或错误提示

**与其他事件的关系**：

- `thinking_text` 是非致命、非阻塞事件，不影响流的继续
- 可以与 `tool_start`、`tool_result`、`text_delta` 交替出现

## 3. Route 层职责

Route 层（`routes/agents.py`、`routes/workflows.py`）是后端流式协议的**序列化边界**：

### 3.1 序列化规则

| Agent 输出 | Route 层处理 | 最终输出 |
|---|---|---|
| `yield dict` | `json.dumps(event, ensure_ascii=False) + '\n'` | 标准 NDJSON 行 |
| `stream_error_event()` / `stream_warning_event()` 返回的字符串 | 直接 yield | 标准 NDJSON 行 |

> **原则**: Agent 层不负责 NDJSON 序列化，Route 层统一处理。Agent 只 yield Python dict。

### 3.2 Warning 注入与后台执行

`analyst-streaming` 的 `generate()` 先经 `_with_warnings()` 包裹，再交给
`_cancellable_agent_stream()`：

```python
return Response(
    stream_with_context(_cancellable_agent_stream(_with_warnings(generate()))),
    mimetype='application/x-ndjson',
)
```

- `_with_warnings()`：深层代码（agent helpers）中调用 `collect_stream_warning()` 收集的 warning 会在每个 chunk 之前自动刷新到流中。
- `_cancellable_agent_stream()`：在后台线程中运行生成器；队列空闲 0.5 秒输出一行 `heartbeat`；生成器抛出的异常转为 `stream_error_event`；客户端断开时设置取消信号，中止正在执行的数据源查询。

`/api/workflows/run` 同样在后台线程中执行，空闲 1 秒输出 `heartbeat`。客户端断开后运行继续，
状态写入 checkpoint；该端点未使用 `_with_warnings()`。

## 4. 前端消费规范

### 4.1 标准解析器

`src/app/apiClient.ts` 提供 `parseStreamLine()` 和 `streamRequest()` 作为标准工具。当前流式消费方
（`SimpleChartRecBox.tsx` → `analyst-streaming`，`WorkflowPanel.tsx` → `workflows/run`）均使用
`streamRequest()`。**新端点必须使用这些函数**。

`streamRequest()` 在流开始前处理两类错误：HTTP 非 2xx，以及 `200 application/json` 的预检错误 envelope，
均抛出 `ApiRequestError`。

### 4.2 事件处理顺序

```typescript
for await (const data of streamRequest(url, options, signal)) {
    // 1. 先检查 error — 终止当前流处理
    if (data.type === 'error') {
        dispatch(dfActions.addMessages({ type: 'error', ... }));
        return;
    }

    // 2. 再检查 warning — 显示通知，继续处理
    if (data.type === 'warning') {
        dispatch(dfActions.addMessages({ type: 'warning', ... }));
        continue;
    }

    // 3. 处理业务事件
    ...
}
```

### 4.3 禁止事项

- **禁止** `catch(() => {})` 静默吞掉错误
- **禁止** 假设流中只有业务事件（必须处理 error 和 warning）
- **禁止** 在前端做 `data: ` 前缀剥离（后端保证发送纯 NDJSON）

## 5. 端点格式对照表

| 端点 | MIME | 序列化方式 | error 格式 | warning 支持 |
|------|------|------------|------------|-------------|
| `/api/agent/analyst-streaming` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ✅ `_with_warnings` |
| `/api/workflows/run` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ❌ |

## 6. 新增端点 Checklist

添加新的流式端点时，请确认：

- [ ] `mimetype='application/x-ndjson'`
- [ ] 使用 `stream_with_context(_with_warnings(generate()))` 包裹
- [ ] `generate()` 中的 `except` 使用 `stream_error_event(classify_and_wrap_llm_error(e))`
- [ ] 流建立前的校验失败使用 `stream_preflight_error()` 返回 `200 application/json` + `{"status": "error", ...}`，不创建 NDJSON 流
- [ ] Agent yield 的是 dict（Route 层负责 `json.dumps`）
- [ ] 前端使用 `streamRequest()` 消费，并处理 `type: "error"` 和 `type: "warning"`
- [ ] 不在响应体中使用 `str(e)` / `str(exc)`
- [ ] 如需暂停等待用户回复，使用 `interact` 事件和结构化 `questions[]`，resume 时通过 `trajectory` + `user_question` 回传
