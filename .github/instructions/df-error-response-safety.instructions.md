---
description: "Prevent raw exception text from leaking into HTTP responses; require the AppError/error_handler unified error system for all new backend error paths"
applyTo: "py-src/**/*.py"
lastReviewed: 2026-07-09
---

# Error Response Safety (Data Formulator)

Ported from `.cursor/rules/error-response-safety.mdc`. Canonical source: [`docs/dev-guides/7-unified-error-handling.md`](../../docs/dev-guides/7-unified-error-handling.md).

Never return raw exception text (`str(e)`, `f"...{e}"`) in HTTP responses — exceptions may carry stack traces, file paths, connection strings, API keys, or internal IPs (CWE-209).

## Unified Error System

All application-controlled errors return **HTTP 200** with `status: "error"` in the body. Only auth errors (401/403) and uncontrolled transport errors (404/413/500) use non-200.

| Route type                      | Pattern                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Non-streaming                   | `raise AppError(ErrorCode.X, "safe message")`; wrap unknowns with `classify_and_wrap_llm_error(e)`          |
| Streaming                       | `yield stream_error_event(e)` inside the generator; `stream_preflight_error(...)` for pre-stream validation |
| DB/workspace (`tables.py`)      | `classify_and_raise_db_error(e)` — not the legacy `sanitize_db_error_message()`                             |
| Connector (`data_connector.py`) | `classify_and_raise_connector_error(e)` — not the legacy `_sanitize_error()`                                |

## Rules

1. Application errors → HTTP 200 + `status: "error"`; never expose exception details.
2. Auth errors → `AUTH_REQUIRED`/`AUTH_EXPIRED` → 401, `ACCESS_DENIED` → 403.
3. Transport errors (uncontrolled) → only 404 (no route), 413 (body limit), 500 (unhandled crash).
4. Streaming errors → always `stream_error_event()` for NDJSON error lines.
5. Always log the full exception server-side; `AppError.detail` only appears in responses when `app.debug is True`.
6. Never use naked `except:` — at minimum `except Exception:`, always logged.

## Anti-Patterns

| Anti-pattern                                                           | Correction                                                                   |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `return jsonify({"message": str(e)}), 500`                             | `raise AppError(ErrorCode.X, "safe message")`                                |
| `return jsonify({...}), 400` for a business/validation error           | Business/validation errors are HTTP 200 + `status: "error"`                  |
| `except: pass` (naked, silent)                                         | `except Exception as e: logger.warning(..., exc_info=e)`                     |
| Legacy `sanitize_db_error_message()` / `_sanitize_error()` in new code | Use `classify_and_raise_db_error()` / `classify_and_raise_connector_error()` |

## Would Revise If

Revise if `docs/dev-guides/7-unified-error-handling.md`'s HTTP status policy changes and this file isn't updated in the same change, or if a new legacy-wrapper function is added without also being listed here as deprecated.
