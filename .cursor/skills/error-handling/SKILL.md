# Error Handling Skill

DF 统一错误处理体系。在新增 API 端点、修改错误处理、添加前端 API 调用时使用。

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

## Backend: Adding a New API Endpoint

### Non-streaming endpoint

```python
from data_formulator.errors import AppError, ErrorCode

@bp.route('/my-endpoint', methods=['POST'])
def my_endpoint():
    content = request.get_json()
    if not content.get('required_field'):
        raise AppError(ErrorCode.INVALID_REQUEST, "Missing required_field", status_code=400)

    try:
        result = do_work(content)
    except SomeBusinessError as e:
        raise AppError(ErrorCode.DATA_LOAD_ERROR, "Failed to load data", status_code=500) from e
    except Exception as e:
        # LLM errors → classify_and_wrap_llm_error
        from data_formulator.error_handler import classify_and_wrap_llm_error
        raise classify_and_wrap_llm_error(e) from e

    return jsonify({"status": "ok", "data": result})
```

### Streaming endpoint

```python
from data_formulator.errors import AppError, ErrorCode
from data_formulator.error_handler import stream_error_event, classify_and_wrap_llm_error

@bp.route('/my-stream', methods=['POST'])
def my_stream():
    def generate():
        try:
            for event in agent.run(...):
                yield json.dumps(event, ensure_ascii=False) + "\n"
        except AppError as e:
            yield stream_error_event(e, token=token)
        except Exception as e:
            yield stream_error_event(classify_and_wrap_llm_error(e), token=token)

    return Response(stream_with_context(generate()), mimetype='application/x-ndjson')
```

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

## Adding a New Error Code

1. **Backend** — Add to `py-src/data_formulator/errors.py` `ErrorCode`:
   ```python
   MY_NEW_ERROR = "MY_NEW_ERROR"
   ```

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
| `/data-agent-streaming` | NDJSON + `stream_error_event()` | Wraps events in `{token, status, result}` for OK; `{type:"error", error:{...}}` for errors |
| `/get-recommendation-questions` | NDJSON + `stream_error_event()` | Was `error: {json}` prefix |
| `/generate-report-chat` | Pure NDJSON + `stream_error_event()` | Was SSE `data: {json}` prefix. Frontend parser has backward-compat `data: ` fallback |
| `/data-loading-chat` | NDJSON, `classify_llm_error()` for safe messages | `str(e)` removed |
| `/clean-data-stream` | NDJSON + `stream_error_event()` | Was `\n{json}\n` format |

Non-streaming endpoints (`derive-data`, `refine-data`, `sort-data`, `process-data-on-load`, `test-model`)
all include `error_message` in error responses for frontend consumption.

## Empty Catch Policy

Not all `.catch(() => {})` are bugs. Use this decision tree:

1. **User-initiated action** (delete, refresh, submit) → **Must notify**: dispatch `addMessages` with error
2. **Background/best-effort fetch** (connector list on mount, session list) → **OK to swallow**, but add a comment: `.catch(() => { /* connector list is best-effort */ })`
3. **RTK thunks** → **Always add `.rejected` handler** with `addMessages` (use `type: 'warning'` for non-critical, `type: 'error'` for critical)
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

`classify_and_raise_db_error` maps common DB errors to appropriate `AppError` codes:
- "Table does not exist" → `TABLE_NOT_FOUND` (404)
- "Table already exists" → `INVALID_REQUEST` (409)
- "Permission denied" → `ACCESS_DENIED` (403)
- etc.

## Backend: Connector Errors (data_connector.py)

For connector endpoints, use:

```python
from data_formulator.data_connector import classify_and_raise_connector_error

except Exception as e:
    classify_and_raise_connector_error(e)
```

Maps auth/connection/validation errors to `AppError` with safe messages.

## Debugging Error Propagation

When an error isn't reaching the frontend:

1. **Check backend logs** — Is the error logged? If not, there's a silent `except: pass` somewhere
2. **Check response format** — Use browser DevTools Network tab to inspect the raw response:
   - Non-streaming: Should be `{"status": "error", "error": {"code": ..., "message": ...}}`
   - Streaming: Look for a line `{"type": "error", "error": {"code": ..., "message": ...}}`
3. **Check Content-Type** — Streaming must be `application/x-ndjson`, not `application/json` or `text/event-stream`
4. **Check frontend parser** — Is the consumer looking for `data.type === 'error'`? Or is it only checking `data.status === 'error'`?
5. **Check global handler** — Verify `register_error_handlers(app)` is called in `app.py`
6. **Check blueprint handlers** — Blueprint-level `errorhandler(Exception)` takes priority over global handlers. The `agent_bp.errorhandler(Exception)` has been removed; verify no new blueprint handlers have been added.

## Key Files

| File | Purpose |
|------|---------|
| `py-src/data_formulator/errors.py` | `ErrorCode` enum + `AppError` exception |
| `py-src/data_formulator/error_handler.py` | Global handlers, `classify_and_wrap_llm_error`, `stream_error_event` |
| `py-src/data_formulator/routes/tables.py` | `classify_and_raise_db_error` (database/workspace errors) |
| `py-src/data_formulator/data_connector.py` | `classify_and_raise_connector_error` (connector errors) |
| `py-src/data_formulator/security/sanitize.py` | `classify_llm_error` (internal), `sanitize_error_message` |
| `src/app/apiClient.ts` | `apiRequest`, `streamRequest`, `parseStreamLine`, `ApiRequestError` |
| `src/app/errorHandler.ts` | `handleApiError` |
| `src/app/errorCodes.ts` | `ERROR_CODE_I18N_MAP`, `getErrorMessage` |
| `src/i18n/locales/{en,zh}/errors.json` | Error message translations |
