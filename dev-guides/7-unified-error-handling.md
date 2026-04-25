# 统一错误处理开发规范

> **维护者**: DF 核心团队
> **最后更新**: 2026-04-26
> **适用范围**: 后端 API route、流式端点、前端 API 调用、错误码/i18n、错误相关测试

## 1. 核心契约

DF 的应用层错误通过响应体表达，而不是通过 HTTP 状态码表达。

| 层级 | 规范 |
|------|------|
| HTTP 传输层 | 应用可控错误返回 HTTP `200` |
| 应用层 | 响应体使用 `status: "error"` 表示失败 |
| 结构化错误 | 新代码推荐 `error: { code, message, retry }` |
| 旧格式兼容 | 已有 route 可以保留 `message` / `error_message`，但不得再返回 `, 4xx` / `, 5xx` |

只有应用代码无法正常构造业务响应时才使用非 200：

- `404`: URL 没有匹配到 Flask route。非 `/api/` 路径继续走 SPA fallback。
- `413`: WSGI/Flask 在 route 执行前拒绝过大的请求体。
- `500`: 未捕获异常逃逸到全局兜底处理器，表示服务端 bug。

## 2. 后端非流式 API

### 2.1 新代码推荐

新 endpoint 或需要错误分类、重试提示、i18n 的路径应使用 `AppError`。

```python
from data_formulator.errors import AppError, ErrorCode

@bp.route("/my-endpoint", methods=["POST"])
def my_endpoint():
    content = request.get_json()
    if not content.get("table_name"):
        raise AppError(ErrorCode.INVALID_REQUEST, "table_name is required")

    try:
        data = do_work(content)
    except SomeKnownError as exc:
        raise AppError(ErrorCode.DATA_LOAD_ERROR, "Failed to load data") from exc

    return jsonify({"status": "ok", "data": data})
```

`register_error_handlers()` 会把 `AppError` 序列化为：

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

HTTP 状态码仍为 `200`。

### 2.2 旧 route 最小迁移格式

已有 route 可以保留简单 body，只要不再返回 HTTP 4xx/5xx：

```python
# OK: legacy-compatible application error
return jsonify({"status": "error", "message": "Table name is required"})

# OK: existing agent-compatible format
return jsonify({"status": "error", "error_message": "Model request failed"})
```

这些格式仍属于当前兼容规范。前端 `apiClient.ts` 会从 `error.message`、`message`、`error_message` 中提取用户可见消息。

### 2.3 禁止事项

```python
# BAD: 应用层错误不返回 HTTP 400/500
return jsonify({"status": "error", "message": "Table name is required"}), 400

# BAD: 不要直接暴露原始异常文本
return jsonify({"status": "error", "message": str(exc)})

# BAD: 新代码不要新增无 status 的临时错误格式
return jsonify({"error": "Something failed"})
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

校验失败时返回普通 JSON，不创建 NDJSON 流：

```python
from data_formulator.errors import ErrorCode

if not request.is_json:
    return jsonify({"status": "error", "error": {
        "code": ErrorCode.INVALID_REQUEST,
        "message": "Invalid request format",
        "retry": False,
    }})
```

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
        yield stream_error_event(classify_and_wrap_llm_error(exc), token=token)
```

## 4. 前端消费规范

### 4.1 新代码优先使用统一客户端

```typescript
import { apiRequest, streamRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';

try {
    const { data } = await apiRequest<MyData>(url, options);
    // use data
} catch (error) {
    handleApiError(error, 'my-component');
}

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

### 4.2 `!response.ok` 的定位

在全 200 模式下，`!response.ok` 只捕获真正的传输层或框架层问题，例如 `404`、`413`、未捕获 `500`、代理错误。业务失败必须看 body：

明确口径：`!response.ok` 可以保留，但只能兜底传输层/框架层错误；业务错误必须检查
`body.status === "error"`。

```typescript
const body = await response.json();
if (body.status === 'error') {
    // application-level failure
}
```

已有直接 `fetchWithIdentity()` 消费者可以保留 `!response.ok` 作为防御层，但不能只依赖它判断业务失败。

### 4.3 空 catch 策略

不是所有 `.catch(() => {})` 都是 bug，但必须能解释：

| 场景 | 处理 |
|------|------|
| 用户主动操作失败 | 必须通知用户，例如 `addMessages` 或 `handleApiError()` |
| 后台 best-effort 加载 | 可以静默，但要加注释说明为何可忽略 |
| RTK thunk rejected | 必须有 `.rejected` handler，过滤 `AbortError` |
| `AbortError` | 可直接忽略 |

## 5. 错误码和 i18n

新增结构化错误码时同步修改：

1. `py-src/data_formulator/errors.py`: 添加 `ErrorCode`
2. `src/app/errorCodes.ts`: 添加 `ERROR_CODE_I18N_MAP`
3. `src/i18n/locales/en/errors.json`: 添加英文文案
4. `src/i18n/locales/zh/errors.json`: 添加中文文案

前端通过 `getErrorMessage(apiError)` 优先使用本地 i18n，缺失时回退到后端英文 `message`。

普通后端固定消息如果不是 `AppError` 体系，优先参考 `dev-guides/6-i18n-language-injection.md` 的 `message_code` / `content_code` 规则。

## 6. 错误分类工具

| 文件 | 工具 | 用途 |
|------|------|------|
| `py-src/data_formulator/errors.py` | `ErrorCode`, `AppError` | 结构化应用错误 |
| `py-src/data_formulator/error_handler.py` | `register_error_handlers()` | 全局错误处理和 `X-Request-Id` |
| `py-src/data_formulator/error_handler.py` | `classify_and_wrap_llm_error()` | LLM/外部 API 异常安全分类 |
| `py-src/data_formulator/error_handler.py` | `stream_error_event()` | NDJSON error 事件 |
| `py-src/data_formulator/routes/tables.py` | `classify_and_raise_db_error()` | 表/工作区错误分类 |
| `py-src/data_formulator/data_connector.py` | `classify_and_raise_connector_error()` | 连接器错误分类 |

`sanitize_db_error_message()`、`_sanitize_error()`、`safe_error_response()` 等 legacy wrapper 仅为兼容保留，新代码不要调用。

## 7. 测试要求

后端测试：

- `AppError` 路径断言 HTTP `200` 和 `body.status == "error"`
- `404`、`413`、未捕获 `500` 保持非 200
- 流式端点运行中错误断言 NDJSON `type: "error"`
- 错误响应不得包含原始 secret、token、连接串或内部异常文本

前端测试：

- `parseApiResponse()` 覆盖结构化错误和 legacy `message` / `error_message`
- `streamRequest()` 覆盖 `200 application/json` 预检错误和 NDJSON error 事件
- `handleApiError()` 覆盖 `AbortError`、auth 回调、retry 回调、silent 模式
- `errorCodes.ts` 覆盖已知 code 翻译和未知 code fallback

## 8. 新 endpoint checklist

- [ ] 应用层错误返回 HTTP `200`
- [ ] body 至少包含 `status: "error"`
- [ ] 新代码优先使用 `AppError` / `ErrorCode`
- [ ] 流式 endpoint 使用 `application/x-ndjson`
- [ ] 流式 fatal error 使用 `stream_error_event()`
- [ ] 不在响应体中暴露 `str(exc)`
- [ ] 用户触发失败有前端反馈
- [ ] 相关错误路径有测试
