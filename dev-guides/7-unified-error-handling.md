# 统一错误处理开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-30
> **适用范围**: 后端 API route、流式端点、前端 API 调用、错误码/i18n、错误相关测试
> **核心原则**: 业务/校验错误一律 HTTP 200，仅认证/授权和不可控传输错误使用非 200

## 0. 协议总览（必须遵守）

所有新建或重构的 DF API 必须先按响应类型选择协议，不要混用：

| 场景 | HTTP 状态码 | 响应格式 | 说明 |
|------|-------------|----------|------|
| 非流式成功 | `200` | `{"status": "success", "data": ...}` | 使用 `json_ok(data)` |
| 非流式业务/校验错误 | `200` | `{"status": "error", "error": {"code", "message", "retry"}}` | 使用 `raise AppError(...)` |
| 非流式认证/授权错误 | `401` / `403` | `{"status": "error", "error": {"code", "message", "retry"}}` | 仅 `AUTH_REQUIRED` / `AUTH_EXPIRED` / `ACCESS_DENIED` |
| 流式预检成功 | `200` | `application/x-ndjson` 事件流 | 进入 generator 前完成校验 |
| 流式预检错误 | `200` | `application/json` + `{"status": "error", "error": ...}` | 使用 `stream_preflight_error(AppError(...))` |
| 流式运行中错误 | `200` | NDJSON 行：`{"type": "error", "error": ...}` | 使用 `stream_error_event(...)`；流已建立后不能再改 HTTP 状态或返回整体 JSON body |
| 无匹配 Flask route | `404` | `/api/` 返回 JSON error；非 API 可能走 SPA fallback | 由 Flask/global handler 处理 |
| 请求体过大 | `413` | JSON error | 由 WSGI/Flask handler 处理 |
| 未捕获异常 | `500` | JSON error | 表示程序 bug 或意外服务端异常 |

禁止事项：

- 新代码不要用 HTTP `400`/`422` 表达业务校验错误；使用 HTTP `200` + `status: "error"`。
- 不要把已建立的 NDJSON 流中错误改成 `{"status": "error", ...}`；流事件必须靠 `type` 区分。
- 不要在响应体中暴露 `str(exc)`、secret、token、连接串、文件系统敏感路径或堆栈。

## 1. 核心契约

DF 的非流式 JSON API 和流式预检错误以 **body `status` 字段为主要判据**。已建立的 NDJSON 流以事件 `type` 字段为判据。HTTP 状态码仅用于认证/授权或不可控传输层信号。

| 层级 | 规范 |
|------|------|
| HTTP 状态码 | 业务/校验错误 → `200`；认证/授权错误 → `401`/`403`；不可控错误 → `404`/`413`/`500` |
| 应用层 body | 非流式/流预检：成功 → `"status": "success"`；失败 → `"status": "error"` |
| 结构化错误 | 必须使用 `error: { code, message, retry }` |
| 成功数据 | 必须包裹在 `data` 字段中：`{"status": "success", "data": {...}}` |
| 流内事件 | 已建立的 NDJSON 流使用 `type` 区分事件；fatal error → `{"type": "error", "error": {...}}` |

### 1.1 HTTP 状态码策略

| HTTP 状态码 | 使用场景 | 由谁返回 |
|-------------|----------|----------|
| `200` | 成功响应与非认证/授权业务错误 | `json_ok()` / `_handle_app_error()` |
| `401` | `AUTH_REQUIRED` / `AUTH_EXPIRED` | `_handle_app_error()` |
| `403` | `ACCESS_DENIED` | `_handle_app_error()` |
| `404` | Flask 路由无匹配 | Flask 内置 |
| `413` | WSGI body 超限 | Flask 内置 |
| `500` | 未捕获异常（程序 bug） | `_handle_unexpected()` |

**设计理由**：
- 与流式 API（始终 HTTP 200）保持一致
- 避免代理/WAF/监控将业务错误误判为基础设施故障
- 前端非流式调用通过 `body.status === "error"` 检测错误；流式调用通过 NDJSON `type === "error"` 检测流内错误

### 1.2 两种 API 协议对比

| | 普通 JSON API | NDJSON Streaming API |
|---|---|---|
| 成功 HTTP 状态码 | `200` | `200` |
| 错误 HTTP 状态码 | `200`（业务）/ `401`/`403`（认证） | 流中 → 200（已建立）；预检 → `200` |
| 成功 body | `{"status": "success", "data": {...}}` | NDJSON 业务事件流 |
| 错误 body | `{"status": "error", "error": {...}}` | NDJSON `{"type": "error", "error": {...}}` |
| 预检错误 | 同上 | `200 application/json` + `{"status": "error", ...}` |
| 前端入口 | `apiRequest()` | `streamRequest()` |

## 2. 后端非流式 API

### 2.1 新代码标准（Phase 2+）

使用 `json_ok()` 返回成功响应，`raise AppError()` 返回错误响应。

```python
from data_formulator.errors import AppError, ErrorCode
from data_formulator.error_handler import json_ok

@bp.route("/my-endpoint", methods=["POST"])
def my_endpoint():
    content = request.get_json()
    if not content.get("table_name"):
        raise AppError(ErrorCode.INVALID_REQUEST, "table_name is required")

    try:
        data = do_work(content)
    except SomeKnownError as exc:
        raise AppError(ErrorCode.DATA_LOAD_ERROR, "Failed to load data") from exc

    return json_ok(data)
```

成功响应（HTTP 200）：

```json
{"status": "success", "data": {...}}
```

错误响应（HTTP 200，认证错误除外）：

```json
{
  "status": "error",
  "error": {
    "code": "INVALID_REQUEST",
    "message": "table_name is required",
    "retry": false
  }
}
```

### 2.2 `ERROR_CODE_HTTP_STATUS` 映射

定义在 `py-src/data_formulator/errors.py`，`AppError.get_http_status()` 方法使用此映射。

**仅认证/授权错误使用非 200：**

| 错误码 | HTTP | 用途 |
|--------|------|------|
| `AUTH_REQUIRED` | 401 | 未登录 |
| `AUTH_EXPIRED` | 401 | Token 过期 |
| `ACCESS_DENIED` | 403 | 权限不足 |

**所有其他 `ErrorCode`（业务错误、LLM 错误、数据错误等）统一返回 HTTP 200**，
错误信息通过 body `status: "error"` + `error: {...}` 传递。

不在映射中的自定义 `ErrorCode` 也默认 HTTP 200。

### 2.3 `json_ok()` 用法

```python
from data_formulator.error_handler import json_ok

# 基本用法
return json_ok({"tables": ["a", "b"]})

# 自定义 HTTP 状态码（极少用）
return json_ok({"id": 1}, status_code=201)
```

### 2.4 历史格式处理

Phase 2 迁移后，`apiRequest()` / `parseApiResponse()` **不再兼容**旧响应格式。
以下格式只允许作为历史背景出现在旧提交或归档设计文档中：

```python
return jsonify({"status": "ok", "data": data})
return jsonify({"status": "error", "message": "Table name is required"})
return jsonify({"status": "error", "error_message": "Model request failed"})
return jsonify({"error": "Something failed"})
```

如果现有 route 仍返回这些格式，必须先迁移到 `json_ok()` / `AppError`，再让前端通过
`apiRequest()` 消费。不要为了兼容历史 route 放宽 `parseApiResponse()`。

### 2.5 禁止事项

```python
# BAD: 新代码不要用裸 jsonify 返回成功响应
return jsonify({"status": "ok", "data": data})  # → 用 json_ok(data)

# BAD: 不要直接暴露原始异常文本
return jsonify({"status": "error", "message": str(exc)})

# BAD: 新代码不要新增无 status 的临时错误格式
return jsonify({"error": "Something failed"})

# BAD: 不要在 json_ok 成功路径手动指定 HTTP 错误码
return json_ok(data), 400  # json_ok 已返回 (Response, status_code)
```

## 3. 后端流式 API

流式端点使用 NDJSON，详见 `dev-guides/1-streaming-protocol.md`。

基本要求：

- `mimetype="application/x-ndjson"`
- 每行一个 JSON 对象，以 `\n` 结尾
- 流内 fatal error 使用 `stream_error_event()`
- 非致命降级使用 `stream_warning_event()` 或 `collect_stream_warning()`
- 用户可见异常消息不得使用 `str(exc)`

### 3.1 流建立前校验

使用 `stream_preflight_error()` 返回错误。**始终返回 HTTP 200**，与非流式 API 行为一致。

```python
from data_formulator.errors import AppError, ErrorCode
from data_formulator.error_handler import stream_preflight_error

if not request.is_json:
    return stream_preflight_error(
        AppError(ErrorCode.INVALID_REQUEST, "Invalid request format")
    )
```

前端 `streamRequest()` 通过检测 `content-type: application/json`（而非
`application/x-ndjson`）识别预检失败并抛出 `ApiRequestError`。

### 3.2 流运行中错误

```python
from data_formulator.error_handler import (
    classify_and_wrap_llm_error,
    stream_error_event,
)

def generate():
    try:
        for event in agent.run(...):
            yield json.dumps(event, ensure_ascii=False) + "\n"
    except Exception as exc:
        logger.exception("stream endpoint failed")
        yield stream_error_event(classify_and_wrap_llm_error(exc))
```

## 4. 前端消费规范

### 4.1 新代码必须使用统一客户端

```typescript
import { apiRequest, streamRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';

// 非流式 API
try {
    const { data } = await apiRequest<MyData>(url, options);
    // use data
} catch (error) {
    handleApiError(error, 'my-component');
}

// 流式 API
try {
    for await (const event of streamRequest(url, options, abortController.signal)) {
        if (event.type === 'error') {
            // Inline/component-level handling if the stream context matters.
            break;
        }
    }
} catch (error) {
    handleApiError(error, 'my-component');
}
```

### 4.2 `apiRequest()` 的错误检测

`apiRequest()` 使用双层检测：

1. **HTTP 层**：`!response.ok`（非 2xx）→ 抛出 `ApiRequestError(code: 'HTTP_ERROR')`。仅在认证错误（401/403）或不可控传输错误时触发。
2. **Body 层**：`body.status === 'error'` → 抛出 `ApiRequestError` 并携带结构化错误信息。**这是业务错误的主要检测路径**。

由于大部分应用错误返回 HTTP 200，前端实际通过 body `status` 字段判断成功/失败。

### 4.3 `parseApiResponse()` 兼容性

`parseApiResponse()` 只接受当前统一格式：

- `status: "success"` + `data`（Phase 2+）
- `status: "error"` + `error: { code, message, retry, request_id? }`

旧的 `status: "ok"`、`error_message`、裸 `message` 会被视为 malformed response。
未迁移 route 必须在调用点自行兼容，不能要求 `apiRequest()` 放宽协议。

### 4.4 空 catch 策略

不是所有 `.catch(() => {})` 都是 bug，但必须能解释：

| 场景 | 处理 |
|------|------|
| 用户主动操作失败 | 必须通知用户，例如 `addMessages` 或 `handleApiError()` |
| 后台 best-effort 加载 | 可以静默，但要加注释说明为何可忽略 |
| RTK thunk rejected | 必须有 `.rejected` handler，按 `error.name` 区分 `AbortError`（静默）、`TimeoutError`（超时提示）和业务错误（通用提示），参见 `fetchChartInsight` |
| `AbortError` | 可直接忽略 |

### 4.5 API 加载状态必须显式建模

新增或重构前端 API 调用时，不要用 `!data` / `data == null` 推断 loading。
请求状态必须显式区分 `idle`、`loading`、`success`、`empty`、`error`，避免失败后
UI 因为没有 data 而继续显示 spinner。

对于组件内局部状态，优先使用 `src/app/loadableState.ts`：

```typescript
import { handleApiError } from '../app/errorHandler';
import { LoadableState, errorLoadable, loadingLoadable, successLoadable } from '../app/loadableState';

const [catalogByConnector, setCatalogByConnector] =
    useState<Record<string, LoadableState<CatalogCache>>>({});

setCatalogByConnector(prev => ({
    ...prev,
    [connectorId]: loadingLoadable(prev[connectorId]),
}));

try {
    const { data } = await apiRequest(...);
    setCatalogByConnector(prev => ({
        ...prev,
        [connectorId]: successLoadable(data, value => value.items.length === 0),
    }));
} catch (error) {
    setCatalogByConnector(prev => ({
        ...prev,
        [connectorId]: errorLoadable(error, { items: [] }),
    }));
    handleApiError(error, 'my-component');
}
```

UI 渲染必须基于 `state.status`：

- `loading` → spinner / disabled control
- `error` → 错误或空状态，不继续显示 spinner
- `empty` → 空状态文案
- `success` → 正常数据

### 4.6 特例边界

以下路径不能简单套普通 JSON API 规范，评审时先确认具体协议：

| 场景 | 规范 |
|------|------|
| 文件下载 / CSV streaming | 成功响应可能是文件流或下载响应；错误响应仍应尽量使用安全的 `status: "error"` body |
| SPA fallback | 非 `/api/` 路径没有匹配 Flask route 时继续返回前端入口 |
| OIDC redirect flow | 部分错误需要通过 redirect query param 传回前端展示 |
| 外部 URL fetch | 前端请求第三方 URL 时，`!response.ok` 属于第三方传输语义，不适用 DF API 约定 |
| 已建立的流式响应 | 流运行中出错只能通过 NDJSON `type: "error"` 事件传递，不能再修改 HTTP 状态码 |
| 流预检错误 | `stream_preflight_error()` 始终返回 HTTP 200 + `application/json` |

### 4.7 LLM / Agent 前端 timeout 策略

用户可见的 LLM / Agent 请求不要硬编码短 timeout。timeout 来源必须可解释：

| 请求类型 | timeout 来源 |
|----------|--------------|
| 用户可见 LLM / Agent 请求 | `state.config.formulateTimeoutSeconds` |
| 长链路 Agent + 多工具循环 | `formulateTimeoutSeconds * N`，必须在代码旁说明原因 |
| 模型连通性检查 | 独立健康检查 timeout，可以短于推理 timeout |
| 数据库 / connector connect | 独立连接 timeout，并显示连接超时文案 |
| best-effort preview / debounce | 可短超时或无提示，但必须注释说明 |

系统 timeout 应与用户取消区分。推荐使用 `AbortController.abort(reason)` 传入
`DOMException(..., "TimeoutError")`，rejected reducer 通过 `action.error.name`
区分：

| `action.error.name` | 含义 | 处理 |
|---|---|---|
| `TimeoutError` | 系统超时 | 显示 warning，文案包含配置秒数或任务名称 |
| `AbortError` | 用户取消或组件卸载 | 可静默 |
| 其他错误 | API / 业务错误 | 使用 `getErrorMessage()` 或本地 i18n 文案提示 |

当前已知待清理项：`fetchCodeExpl` 和 `fetchFieldSemanticType` 仍使用 20s
硬编码 timeout。新增同类代码不要复制该模式。

## 5. 错误码和 i18n

新增结构化错误码时同步修改：

1. `py-src/data_formulator/errors.py`: 添加 `ErrorCode` 常量（无需添加 HTTP 映射，默认 200）
2. `src/app/errorCodes.ts`: 添加 `ERROR_CODE_I18N_MAP`
3. `src/i18n/locales/en/errors.json`: 添加英文文案
4. `src/i18n/locales/zh/errors.json`: 添加中文文案

前端通过 `getErrorMessage(apiError)` 优先使用本地 i18n，缺失时回退到后端英文 `message`。

普通后端固定消息如果不是 `AppError` 体系，优先参考 `dev-guides/6-i18n-language-injection.md` 的 `message_code` / `content_code` 规则。

## 6. 错误分类工具

| 文件 | 工具 | 用途 |
|------|------|------|
| `py-src/data_formulator/errors.py` | `ErrorCode`, `AppError`, `ERROR_CODE_HTTP_STATUS` | 结构化应用错误（仅 auth 映射非 200） |
| `py-src/data_formulator/error_handler.py` | `register_error_handlers()` | 全局错误处理和 `X-Request-Id` |
| `py-src/data_formulator/error_handler.py` | `json_ok()` | 统一成功响应 helper |
| `py-src/data_formulator/error_handler.py` | `stream_preflight_error()` | 流预检错误 helper（HTTP 200） |
| `py-src/data_formulator/error_handler.py` | `classify_and_wrap_llm_error()` | LLM/外部 API 异常安全分类 |
| `py-src/data_formulator/error_handler.py` | `stream_error_event()` | NDJSON error 事件 |
| `py-src/data_formulator/routes/tables.py` | `classify_and_raise_db_error()` | 表/工作区错误分类 |
| `py-src/data_formulator/data_loader/connector_errors.py` | `classify_connector_error()` | DataLoader/connector 简单错误分类 |
| `py-src/data_formulator/data_connector.py` | `classify_and_raise_connector_error()` | 连接器路由兼容入口 |

`sanitize_db_error_message()`、`_sanitize_error()`、`safe_error_response()` 等 legacy wrapper 仅为兼容保留，新代码不要调用。

### 6.1 全局兜底与 request_id

所有 `AppError`、`404`、`413`、未捕获 `500` 的 JSON 错误体都必须包含
`error.request_id`，同时响应头带 `X-Request-Id`。前端可把这个 ID 展示给用户，
用于定位后端日志。生产环境不要把未捕获异常的原始文本、traceback 或连接串返回给前端。

### 6.2 DataLoader/connector 分类

DataLoader/connector 只做简单实用分类，不为每个 SDK 维护专门错误树：

| 类别 | ErrorCode |
|------|-----------|
| 参数/请求问题 | `INVALID_REQUEST` |
| 数据源鉴权失败 | `CONNECTOR_AUTH_FAILED` |
| 登录过期 | `AUTH_EXPIRED` |
| 权限不足 | `ACCESS_DENIED` |
| 连接失败/超时 | `DB_CONNECTION_FAILED` |
| 查询语法或执行失败 | `DB_QUERY_ERROR` |
| 文件/资源/解析/导入失败 | `DATA_LOAD_ERROR` |
| 其他连接器异常 | `CONNECTOR_ERROR` |

顶层 connector 操作失败应抛 `AppError`；批量导入或自动连接这类局部失败可以保留
`status: "success"`，但局部项必须带结构化 `error: { code, message, retry }`。

## 7. 测试要求

后端测试：

- 非认证/授权 `AppError` 路径断言 HTTP 200 + body `status == "error"` + `error.code` 匹配
- 认证错误（AUTH_REQUIRED / AUTH_EXPIRED / ACCESS_DENIED）断言 HTTP 401/403
- `404`（无路由）、`413`（body 超限）、未捕获 `500` 保持相应非 200 状态码
- JSON 错误响应断言 `error.request_id` 与响应头 `X-Request-Id` 对齐
- 流式端点运行中错误断言 NDJSON `type: "error"`
- 错误响应不得包含原始 secret、token、连接串或内部异常文本

前端测试：

- `parseApiResponse()` 覆盖 `status: "success"`、结构化错误、`request_id`
- `parseApiResponse()` 断言 legacy `status: "ok"` / `error_message` 被拒绝
- `apiRequest()` 覆盖 HTTP 401/403、HTTP 200 body 错误、非 JSON 响应
- `streamRequest()` 覆盖 `200 application/json` 预检错误和 NDJSON error 事件
- `handleApiError()` 覆盖 `AbortError`、auth 回调、retry 回调、silent 模式
- `errorCodes.ts` 覆盖已知 code 翻译和未知 code fallback

### 7.1 自动化护栏现状

当前已有后端协议合约测试和前端 `apiClient` 测试。尚未落地的自动化护栏不要在
设计文档或评审中标记为已完成：

- `scripts/check_api_error_guardrails.py` 静态扫描脚本尚未实现。
- CI 尚未强制扫描裸 `jsonify({"error": ...})`、扁平 `status:"ok"`、业务代码直接
  `fetchWithIdentity().json()`、未说明的 LLM 硬编码 timeout。
- ESLint 自定义规则尚未强制禁止业务代码直接调用 `fetchWithIdentity()`。

## 8. 新 endpoint checklist

### 非流式 endpoint

- [ ] 成功响应使用 `json_ok(data)` → `{"status": "success", "data": ...}`
- [ ] 错误响应使用 `raise AppError(ErrorCode.XXX, "message")` → HTTP 200 + error body
- [ ] 认证错误自动返回 401/403，其他业务错误返回 200
- [ ] 不在响应体中暴露 `str(exc)`
- [ ] 前端使用 `apiRequest()` 消费
- [ ] 相关错误路径有 contract test
- [ ] 如调用 LLM / Agent，前端 timeout 来自统一配置或有明确特例说明

### 流式 endpoint

- [ ] `mimetype='application/x-ndjson'`
- [ ] 使用 `stream_with_context(_with_warnings(generate()))` 包裹
- [ ] 预检失败使用 `stream_preflight_error(AppError(...))`
- [ ] 流内错误使用 `stream_error_event(classify_and_wrap_llm_error(e))`
- [ ] 前端消费代码处理 `type: "error"` 和 `type: "warning"`
- [ ] 不在响应体中使用 `str(e)` / `str(exc)`
