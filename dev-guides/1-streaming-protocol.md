# 前后端流式通信协议

> **维护者**: DF 核心团队  
> **最后更新**: 2026-04-24  
> **适用范围**: 所有 `/api/agent/*` 流式端点

## 1. 协议总览

所有流式端点统一使用 **NDJSON**（Newline-Delimited JSON）协议：

- **Content-Type**: `application/x-ndjson`
- **每行**: 一个完整的 JSON 对象，以 `\n` 结尾
- **编码**: UTF-8，`ensure_ascii=False`
- **HTTP 状态码**: 流式端点始终返回 `200`（错误通过流内事件传递）

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
| `data-agent-streaming` | 包裹在 `{token, status, result}` 中 | Legacy 格式，result 内含 `type` |
| `get-recommendation-questions` | `"question"` | 探索建议问题 |
| `generate-report-chat` | `"text_delta"`, `"embed_chart"`, `"embed_table"` | 报告生成流 |
| `data-loading-chat` | `"text_delta"`, `"tool_call"`, `"tool_result"`, `"done"` | 数据加载对话 |
| `clean-data-stream` | 各种 agent 事件 | 数据清洗流 |

`data-agent-streaming` 的 `result.type === "clarify"` 使用结构化多问题格式。后端和前端都以
`questions[]` 为唯一澄清问题结构，不再新增顶层 `message/options/option_codes` 协议。

```json
{
  "type": "clarify",
  "questions": [
    {
      "id": "metric",
      "text": "Which metric should I use?",
      "responseType": "single_choice",
      "required": true,
      "options": [
        {"id": "revenue", "label": "Revenue"}
      ]
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
| `questions[].id` | string | 是 | 问题 ID，用于绑定回答 |
| `questions[].text` | string | 是 | 英文 fallback 或 LLM 生成的问题文本 |
| `questions[].text_code` | string | 否 | 固定后端问题文案的 i18n key，例如 `agent.clarifyExhausted` |
| `questions[].text_params` | object | 否 | `text_code` 的插值参数 |
| `questions[].responseType` | `"single_choice"` / `"free_text"` | 否 | 默认由前端按是否有 options 推断；后端建议显式发送 |
| `questions[].required` | boolean | 否 | 默认 `true` |
| `questions[].options` | array | 否 | 单选选项；每个问题的选项只属于该问题 |
| `questions[].options[].id` | string | 否 | 选项 ID；缺失时前端可生成，但后端建议提供 |
| `questions[].options[].label` | string | 是 | 英文 fallback 或 LLM 生成的选项文本 |
| `questions[].options[].label_code` | string | 否 | 固定后端选项文案的 i18n key |
| `auto_select` | object | 否 | 单题自动选择配置，用于工具轮数耗尽后的倒计时继续 |

工具轮数耗尽的继续提示必须保持为单题澄清，并额外带：

```json
{
  "auto_select": {
    "question_id": "continue_after_tool_rounds",
    "option_id": "continue",
    "timeout_ms": 60000
  }
}
```

前端据此显示倒计时并自动选择继续选项。多问题澄清不得自动提交。

恢复请求发送结构化回答：

```json
{
  "trajectory": [],
  "clarification_responses": [
    {
      "question_id": "metric",
      "answer": "Revenue",
      "option_id": "revenue",
      "source": "option"
    },
    {
      "question_id": "__freeform__",
      "answer": "Use revenue for the last 12 months.",
      "source": "freeform"
    }
  ],
  "completed_step_count": 2
}
```

`source` 可为：

| source | 说明 |
|--------|------|
| `option` | 用户选择了某个问题下的选项 |
| `free_text` | 用户填写了某个 `responseType: "free_text"` 问题 |
| `freeform` | 用户跳过选项，在澄清面板底部直接用自然语言说明；此时 `question_id` 使用 `__freeform__` |

Route 层负责把 `clarification_responses[]` 格式化成 LLM 可读的 `[USER CLARIFICATION]`
文本并追加到 trajectory。前端不发送旧的 `clarification_response` 字符串字段。

### 2.2 错误事件（统一格式）

当流中发生致命错误时，后端 yield 一个 error 事件并终止流。

```json
{
  "type": "error",
  "error": {
    "code": "LLM_RATE_LIMIT",
    "message": "请求过于频繁，请稍后重试",
    "retry": true
  },
  "token": "abc-123"
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `type` | `"error"` | 是 | 固定值 |
| `error.code` | string | 是 | 机器可读错误码（见 `errors.py` `ErrorCode`） |
| `error.message` | string | 是 | 安全的用户可读消息 |
| `error.retry` | boolean | 是 | 前端是否应显示重试按钮 |
| `error.detail` | string | 否 | 仅 DEBUG 模式，服务端调试信息 |
| `token` | string | 否 | 请求 token，用于前端匹配 |

**后端生成**:

```python
from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error

# LLM 异常 → 安全分类 → error 事件
yield stream_error_event(classify_and_wrap_llm_error(e), token=token)

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
| `/data-agent-streaming` | `x-ndjson` | route `json.dumps({token,status,result})` | `stream_error_event` | ✅ `_with_warnings` |
| `/refine-data` | `x-ndjson` | route `json.dumps({token,status,result})` | `stream_error_event` | ✅ `_with_warnings` |
| `/get-recommendation-questions` | `x-ndjson` | route 累积碎片 → `_try_parse_explore_line` | `stream_error_event` | ✅ `_with_warnings` |
| `/generate-report-chat` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ✅ `_with_warnings` |
| `/data-loading-chat` | `x-ndjson` | route `json.dumps(event)` | `stream_error_event` | ✅ `_with_warnings` |
| `/clean-data-stream` | `x-ndjson` | agent 直接 yield | `stream_error_event` | ✅ `_with_warnings` |

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
