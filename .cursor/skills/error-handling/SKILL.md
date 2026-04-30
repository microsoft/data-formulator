---
name: error-handling
description: 统一错误处理系统。在添加 API 端点、修改错误处理、添加前端 API 调用、编写错误相关测试时使用。
---

# Error Handling Skill

Unified error handling system for DF. Use when adding API endpoints, modifying error handling, or adding frontend API calls.

> **Prerequisites**: Read `dev-guides/7-unified-error-handling.md` before changing API error behavior.
> Read `dev-guides/2-log-sanitization.md` when the work involves logging, credentials, external services, or DataLoaders.
> If your work introduces new error handling patterns or conventions, update this file and related dev-guides accordingly.

## Architecture Overview

```
Frontend                              Backend
────────                              ───────
apiClient.ts                          errors.py
├── apiRequest()    ←── JSON ────     ├── ErrorCode (enum)
├── streamRequest() ←── NDJSON ──     └── AppError (exception)
└── parseStreamLine()
                                      error_handler.py
errorCodes.ts                         ├── register_error_handlers(app)
└── getErrorMessage()                 ├── classify_and_wrap_llm_error()
                                      └── stream_error_event()
errorHandler.ts
└── handleApiError()                  security/sanitize.py
                                      └── classify_llm_error() (internal)
MessageSnackbar ← dfSlice.messages
```

## Protocol Snapshot

Use this contract for all new or reworked DF APIs:

| Scenario | HTTP | Shape |
|----------|------|-------|
| Non-streaming success | `200` | `{"status": "success", "data": ...}` |
| Non-streaming business/validation error | `200` | `{"status": "error", "error": {"code", "message", "retry", "request_id"}}` |
| Non-streaming auth/authorization error | `401` / `403` | same structured error body |
| Streaming preflight error | `200` | `application/json` + `{"status": "error", "error": ...}` |
| Streaming in-flight fatal error | `200` | NDJSON line: `{"type": "error", "error": ...}` |
| No Flask route / too large / unhandled crash | `404` / `413` / `500` | transport-level error |

Do not use HTTP `400`/`422` for application validation errors in new code.
Do not convert in-flight NDJSON errors to `status: "error"`; once the stream has
started, event `type` is the protocol discriminator.

## Backend: Adding a New API Endpoint

### HTTP Status Code Policy

**Application-controlled business and validation errors return HTTP 200** with
`status: "error"` in the body. Only these use non-200:
- `401`/`403` — auth errors (`AUTH_REQUIRED`, `AUTH_EXPIRED`, `ACCESS_DENIED`)
- `404` — no matching Flask route
- `413` — WSGI body limit exceeded
- `500` — unhandled exception (program bug)

### Non-streaming endpoint

```python
from data_formulator.errors import AppError, ErrorCode
from data_formulator.error_handler import json_ok

@bp.route('/my-endpoint', methods=['POST'])
def my_endpoint():
    content = request.get_json()
    if not content.get('required_field'):
        raise AppError(ErrorCode.INVALID_REQUEST, "Missing required_field")

    try:
        result = do_work(content)
    except SomeBusinessError as e:
        raise AppError(ErrorCode.DATA_LOAD_ERROR, "Failed to load data") from e
    except Exception as e:
        from data_formulator.error_handler import classify_and_wrap_llm_error
        raise classify_and_wrap_llm_error(e) from e

    return json_ok(result)
# Global handler returns: HTTP 200 + {"status": "error", "error": {code, message, retry}}
# Auth errors (AUTH_REQUIRED/AUTH_EXPIRED/ACCESS_DENIED) return 401/403
```

Existing routes may still return legacy-compatible `{"status": "error", "message": "..."}`
or `error_message` bodies. Do not add new HTTP 4xx/5xx status tuples for business
validation errors.

### Streaming endpoint

Validation MUST be outside the generator. Failures return 200 JSON (not NDJSON).

```python
from data_formulator.errors import AppError, ErrorCode
from data_formulator.error_handler import (
    classify_and_wrap_llm_error,
    stream_error_event,
    stream_preflight_error,
)

@bp.route('/my-stream', methods=['POST'])
def my_stream():
    # Validation outside generator — failures return 200 JSON
    if not request.is_json:
        return stream_preflight_error(
            AppError(ErrorCode.INVALID_REQUEST, "Invalid request")
        )

    content = request.get_json()
    client = get_client(content['model'])

    def generate():
        try:
            for event in agent.run(...):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except Exception as e:
            yield stream_error_event(classify_and_wrap_llm_error(e))

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson')
```

Streaming runtime errors intentionally use `{"type": "error", "error": ...}`.
They cannot use a top-level `status` envelope because the HTTP response and NDJSON
event stream have already started.

## Frontend: Consuming an API

### Non-streaming

```typescript
import { apiRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';

try {
    const { data } = await apiRequest<ResponseType>(getUrls().MY_ENDPOINT, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
    });
    // use data
} catch (e) {
    handleApiError(e, 'MyComponent');
}
```

### Streaming

```typescript
import { streamRequest } from '../app/apiClient';
import { handleApiError } from '../app/errorHandler';

try {
    for await (const event of streamRequest(url, options, abortController.signal)) {
        switch (event.type) {
            case 'text_delta':
                // process text
                break;
            case 'error':
                // error arrived mid-stream — show inline in component
                break;
            case 'done':
                break;
        }
    }
} catch (e) {
    handleApiError(e, 'MyComponent');
}
```

### With callbacks

```typescript
handleApiError(e, 'MyComponent', {
    onAuth: () => redirectToLogin(),        // AUTH_REQUIRED / AUTH_EXPIRED
    onRetryable: () => retryOperation(),    // LLM_RATE_LIMIT / LLM_TIMEOUT
    silent: true,                           // don't show Snackbar (component handles display)
});
```

### Migration and special cases

New or reworked DF API consumers should use `apiRequest()` / `streamRequest()`
and `handleApiError()`. Existing `fetchWithIdentity()` calls can remain during
incremental migration, but they must inspect `body.status === "error"` for
application failures instead of relying only on `!response.ok`.

Do not apply the normal JSON API protocol mechanically to file downloads / CSV
streaming, SPA fallback, OIDC redirect flows, frontend fetches to third-party
URLs, or errors after a streaming response has already started. Check the route's
protocol first, then preserve safe error bodies and avoid `str(exc)` exposure.

## Adding a New Error Code

1. **Backend** — Add to `py-src/data_formulator/errors.py` `ErrorCode`:
   ```python
   MY_NEW_ERROR = "MY_NEW_ERROR"
   ```
   No HTTP mapping needed — defaults to HTTP 200. Only add to `ERROR_CODE_HTTP_STATUS` if it's an auth code.

2. **Frontend mapping** — Add to `src/app/errorCodes.ts` `ERROR_CODE_I18N_MAP`:
   ```typescript
   MY_NEW_ERROR: 'errors.myNewError',
   ```

3. **Translations** — Add to both locale files:
   - `src/i18n/locales/en/errors.json`: `"myNewError": "English message"`
   - `src/i18n/locales/zh/errors.json`: `"myNewError": "中文消息"`

## Migrated Endpoints Reference

All streaming endpoints are now on the unified protocol:

| Endpoint | Format | Notes |
|----------|--------|-------|
| `/data-agent-streaming` | NDJSON + `stream_error_event()` | Emits top-level `type` events; errors use `{type:"error", error:{...}}` |
| `/get-recommendation-questions` | NDJSON + `stream_error_event()` | Was `error: {json}` prefix |
| `/generate-report-chat` | Pure NDJSON + `stream_error_event()` | Was SSE `data: {json}` prefix. Frontend parser has backward-compat `data: ` fallback |
| `/data-loading-chat` | NDJSON, `classify_llm_error()` for safe messages | `str(e)` removed |
| `/clean-data-stream` | NDJSON + `stream_error_event()` | Was `\n{json}\n` format |

Non-streaming endpoints:

| Endpoint | Error Format | Notes |
|----------|-------------|-------|
| `/chart-insight` | `AppError` → HTTP 200 + `{status:"error", error:{code,message,retry}}` | **Fully migrated**. Frontend uses `fetchChartInsight` rejected reducer. |
| All migrated endpoints | `AppError` → HTTP 200 + unified error body | credentials, knowledge, sessions, tables, agents |
| `/derive-data`, `/refine-data`, `/sort-data`, `/process-data-on-load`, `/test-model` | `json_ok()` / `AppError` | Migrated to new format |

## Empty Catch Policy

Not all `.catch(() => {})` are bugs. Use this decision tree:

1. **User-initiated action** (delete, refresh, submit) → **Must notify**: dispatch `addMessages` with error
2. **Background/best-effort fetch** (connector list on mount, session list) → **OK to swallow**, but add a comment: `.catch(() => { /* connector list is best-effort */ })`
3. **RTK thunks** → **Always add `.rejected` handler** with `addMessages`. Discriminate by `action.error?.name`: `AbortError` (silent), `TimeoutError` (timeout message with config seconds), other (generic warning). See `fetchChartInsight` in `dfSlice.tsx` for reference.
4. **AbortError** → Always filter out: `if (action.error?.name !== 'AbortError')`

## Frontend Stream Parsing Pattern

When consuming a migrated streaming endpoint, check for **both** new and legacy formats:

```typescript
const data = JSON.parse(line);
// New unified format (from stream_error_event)
if (data.type === 'error') {
    const errMsg = data.error?.message || data.error_message || 'Unknown error';
    // show to user...
}
// Legacy format (backward compat during migration)
if (data.status === 'error') {
    const errMsg = data.error_message || 'Unknown error';
    // show to user...
}
```

## Backend: Database/Workspace Errors (tables.py)

For table CRUD endpoints, use the specialized classifier:

```python
from data_formulator.routes.tables import classify_and_raise_db_error

@tables_bp.route('/my-table-op', methods=['POST'])
def my_table_op():
    try:
        result = workspace.do_something()
        return jsonify({"status": "success", "data": result})
    except Exception as e:
        classify_and_raise_db_error(e)
```

`classify_and_raise_db_error` maps common DB errors to appropriate `AppError` codes
(returned as HTTP 200 by the global handler, except ACCESS_DENIED → 403):
- "Table does not exist" → `TABLE_NOT_FOUND` (HTTP 200)
- "Table already exists" → `INVALID_REQUEST` (HTTP 200)
- "Permission denied" → `ACCESS_DENIED` (HTTP 403)
- Other → `CONNECTOR_ERROR` (HTTP 200)

## Backend: Connector Errors (data_connector.py)

For connector endpoints, use:

```python
from data_formulator.data_connector import classify_and_raise_connector_error

except Exception as e:
    classify_and_raise_connector_error(e, operation="preview")
```

Connector/DataLoader classification is intentionally simple and lives in
`data_formulator.data_loader.connector_errors`. It maps common failures to a
small stable set: `INVALID_REQUEST`, `CONNECTOR_AUTH_FAILED`, `AUTH_EXPIRED`,
`ACCESS_DENIED`, `DB_CONNECTION_FAILED`, `DB_QUERY_ERROR`, `DATA_LOAD_ERROR`,
or `CONNECTOR_ERROR`. Do not add endpoint-local string matching unless the
classifier cannot reasonably cover the category.

All JSON errors include `error.request_id` and an `X-Request-Id` response
header. Show/copy this ID for users when reporting backend failures; do not
show raw exception text in production.

## Debugging Error Propagation

When an error isn't reaching the frontend:

1. **Check backend logs** — Is the error logged? If not, there's a silent `except: pass` somewhere
2. **Check response format** — Use browser DevTools Network tab to inspect the raw response:
   - Non-streaming: Should include `{"status": "error", ...}`. New structured paths use `error: {"code": ..., "message": ...}`; legacy-compatible paths may use `message` / `error_message`.
   - Streaming: Look for a line `{"type": "error", "error": {"code": ..., "message": ...}}`
3. **Check Content-Type** — Streaming must be `application/x-ndjson`, not `application/json` or `text/event-stream`
4. **Check frontend parser** — Is the consumer looking for `data.type === 'error'`? Or is it only checking `data.status === 'error'`?
5. **Check global handler** — Verify `register_error_handlers(app)` is called in `app.py`
6. **Check blueprint handlers** — Blueprint-level `errorhandler(Exception)` takes priority over global handlers. The `agent_bp.errorhandler(Exception)` has been removed; verify no new blueprint handlers have been added.

## Log Sanitization (Sensitive Data in Server Logs)

Server-side logs must never leak passwords, tokens, API keys, or connection strings.
The project uses a defense-in-depth approach with two layers.

### Layer 1: Explicit Utilities (call-site)

```python
from data_formulator.security.log_sanitizer import (
    sanitize_url, sanitize_params, redact_token,
)

# Dict with credentials → sanitize_params()
log.info("Connecting with: %s", sanitize_params(params))

# URL that may embed credentials → sanitize_url()
logger.info("Issuer: %s", sanitize_url(issuer_url))

# Token/API key → redact_token()
logger.debug("Token: %s", redact_token(token))
```

### Layer 2: SensitiveDataFilter (global safety net)

Registered in `app.py:configure_logging()`. Automatically redacts:
- URL credentials (`://user:pass@host`)
- `Bearer` tokens
- `password=xxx`, `api_key=xxx`, `secret=xxx` patterns
- JWT-like base64 strings
- Python dict repr with sensitive keys

Disable with `LOG_SANITIZE=false` for local debugging only.

### When to Use What

| Data | Utility | Why not just filter? |
|------|---------|---------------------|
| `dict` with password keys | `sanitize_params()` | Filter can't identify arbitrary password values in dict repr |
| URL from config/env | `sanitize_url()` | Explicit is clearer; filter is backup |
| Token/key value | `redact_token()` | Explicit is clearer; filter is backup |
| Normal text | Nothing | Filter handles edge cases |

### New Module Checklist

When adding a module that handles credentials or external services:

1. Audit all `logger.*()` calls for credential/URL/token logging
2. Use `sanitize_params()` for dicts, `sanitize_url()` for URLs, `redact_token()` for tokens
3. Prefer `type(exc).__name__` over `str(exc)` in warning-level logs
4. If introducing new credential key names, add to `SENSITIVE_KEYS` in `log_sanitizer.py`

## Key Files

| File | Purpose |
|------|---------|
| `py-src/data_formulator/errors.py` | `ErrorCode` enum + `AppError` exception |
| `py-src/data_formulator/error_handler.py` | Global handlers, `classify_and_wrap_llm_error`, `stream_error_event` |
| `py-src/data_formulator/security/log_sanitizer.py` | `sanitize_url`, `sanitize_params`, `redact_token`, `SensitiveDataFilter` |
| `py-src/data_formulator/routes/tables.py` | `classify_and_raise_db_error` (database/workspace errors) |
| `py-src/data_formulator/data_connector.py` | `classify_and_raise_connector_error` (connector errors) |
| `py-src/data_formulator/security/sanitize.py` | `classify_llm_error` (internal), `sanitize_error_message` |
| `src/app/apiClient.ts` | `apiRequest`, `streamRequest`, `parseStreamLine`, `ApiRequestError` |
| `src/app/errorHandler.ts` | `handleApiError` |
| `src/app/errorCodes.ts` | `ERROR_CODE_I18N_MAP`, `getErrorMessage` |
| `src/i18n/locales/{en,zh}/errors.json` | Error message translations |
