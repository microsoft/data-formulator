---
description: "Backend Python test conventions (pytest) — file location, structure, markers, and required error-handling test cases for tests/backend/"
applyTo: "tests/backend/**/*.py"
lastReviewed: 2026-07-09
---

# Backend Test Conventions (Data Formulator)

Ported from `.cursor/rules/backend-test-conventions.mdc`. Canonical source: [`docs/dev-guides/7-unified-error-handling.md`](../../docs/dev-guides/7-unified-error-handling.md) for error-test requirements.

## File Location & Naming

- Place tests under `tests/backend/unit/`, `tests/backend/integration/`, `tests/backend/contract/`, or by domain (`routes/`, `errors/`, `agents/`, `data/`, `security/`, `auth/`).
- Name files `test_<feature_or_module>.py`. Shared fixtures go in `tests/backend/fixtures/`.

## Conventions

| Rule              | Detail                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| Module marker     | Always add `pytestmark = [pytest.mark.backend]` at module level                               |
| Grouping          | Group related tests in `Test*`-prefixed classes                                               |
| Data-driven cases | Use `pytest.mark.parametrize`, not repetitive copy-pasted tests                               |
| Isolation         | Unit tests must not depend on Flask, network, or external services; mock with `unittest.mock` |
| Naming            | One behavior per test, named `test_<what>_<condition>`                                        |
| Running           | Use `python -m pytest tests/backend/ -q` (quiet), not `-v`                                    |

## Required Error-Handling Test Cases

Application errors return **HTTP 200** with `status: "error"`. Only auth errors (401/403) and uncontrolled transport failures (404/413/500) use non-200. When adding/changing a route, cover:

1. `AppError` scenarios — assert HTTP 200 + correct `ErrorCode` in body.
2. Auth errors — assert non-200 (401/403) for `AUTH_REQUIRED`/`AUTH_EXPIRED`/`ACCESS_DENIED`.
3. Unexpected exceptions — assert the global handler returns 500.
4. Streaming endpoints — assert NDJSON error events (`type: "error"`) appear in the response lines.
5. Test fixture must call `register_error_handlers(app)`.

See `tests/backend/errors/test_errors.py` and `test_error_handler.py` for reference implementations.

## Anti-Patterns

| Anti-pattern                                          | Correction                                                |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `def test_it_works():` with no marker, no parametrize | Add `pytestmark`, use `parametrize` for data-driven cases |
| Asserting only the happy path on a new route          | Add the 5 required error-handling cases above             |
| Unit test that hits a real network/DB call            | Mock with `unittest.mock.patch` / `MagicMock`             |

## Would Revise If

Revise if `docs/dev-guides/7-unified-error-handling.md` changes the HTTP status policy and this file isn't updated in the same change, or if `tests/backend/` restructures its domain subfolders and the "File Location" table goes stale.
