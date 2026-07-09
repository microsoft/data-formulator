---
description: "Unified error-handling protocol across backend (Flask) and frontend (TypeScript) — HTTP status policy, JSON/NDJSON shapes, and required API-consumption helpers"
applyTo: "py-src/**/*.py,src/**/*.{ts,tsx}"
lastReviewed: 2026-07-09
---

# Unified Error Protocol (Data Formulator)

Ported from `.cursor/rules/unified-error-protocol.mdc`. Canonical source: [`docs/dev-guides/7-unified-error-handling.md`](../../docs/dev-guides/7-unified-error-handling.md). Related skill: [`error-handling`](../skills/error-handling/SKILL.md).

## HTTP Status Code Policy

All application-controlled errors return **HTTP 200** with `status: "error"` in the body — for both non-streaming JSON APIs and streaming pre-flight errors. Non-200 is reserved for: `401`/`403` (auth), `404` (no Flask route), `413` (body too large), `500` (unhandled exception).

| Scenario                     | Shape                                                                   |
| ---------------------------- | ----------------------------------------------------------------------- |
| Non-streaming success        | `{"status": "success", "data": {...}}`                                  |
| Non-streaming error          | `{"status": "error", "error": {"code", "message", "retry", "detail"?}}` |
| Streaming pre-flight failure | HTTP 200 + `application/json` via `stream_preflight_error()`            |
| Streaming in-stream error    | NDJSON line `{"type": "error", "error": {...}}`                         |
| Streaming in-stream warning  | NDJSON line `{"type": "warning", "warning": {...}}`                     |

## Backend

```python
from data_formulator.errors import AppError, ErrorCode
from data_formulator.error_handler import json_ok, stream_preflight_error, stream_error_event, classify_and_wrap_llm_error

return json_ok(data)                                              # non-streaming success
raise AppError(ErrorCode.TABLE_NOT_FOUND, "Table not found")       # non-streaming error
return stream_preflight_error(AppError(ErrorCode.INVALID_REQUEST, "Bad input"))  # streaming pre-flight
yield stream_error_event(classify_and_wrap_llm_error(e))           # streaming in-stream
```

## Frontend

API consumers MUST use `apiRequest()` / `streamRequest()` from `../app/apiClient` plus `handleApiError()` from `../app/errorHandler`. Raw `fetchWithIdentity()` is reserved for file downloads, blob/CSV responses, OIDC/SPA redirects, and third-party URLs.

RTK thunks always need a `.rejected` handler that pushes a message unless the error is an `AbortError`.

## Prohibited Patterns

| Layer    | Anti-pattern                                     | Correction                                                          |
| -------- | ------------------------------------------------ | ------------------------------------------------------------------- |
| Backend  | `return jsonify({"status": "ok", "data": data})` | `json_ok(data)`                                                     |
| Backend  | `return jsonify({"error_message": str(e)})`      | `raise AppError(...)`                                               |
| Backend  | Bare `except:` or `except Exception: pass`       | Always log or propagate                                             |
| Frontend | `.catch(() => {})` with no comment               | Add a comment explaining why (best-effort), or use `handleApiError` |
| Frontend | Raw `fetch()` for `/api/` URLs                   | `fetchWithIdentity` (identity headers + 401 retry)                  |
| Frontend | RTK thunk with no `.rejected` handler            | Add `.addCase(thunk.rejected, ...)` with `addMessages`              |

## Adding a New Error Code

1. Add to `py-src/data_formulator/errors.py` `ErrorCode` (no HTTP mapping needed — defaults to 200).
2. Add to `src/app/errorCodes.ts` `ERROR_CODE_I18N_MAP`.
3. Add translations to both `src/i18n/locales/en/errors.json` and `zh/errors.json`.

## Would Revise If

Revise if `docs/dev-guides/7-unified-error-handling.md` changes the HTTP status policy or JSON/NDJSON shapes and this file isn't updated in the same change, or if a new streaming endpoint ships using a format other than `application/x-ndjson` without this file noting the exception.
