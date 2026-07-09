---
description: "Prevent credentials, tokens, and connection strings from leaking into server-side log messages; require sanitize_params/sanitize_url/redact_token utilities"
applyTo: "py-src/**/*.py"
lastReviewed: 2026-07-09
---

# Log Sanitization (Data Formulator)

Ported from `.cursor/rules/log-sanitization.mdc`. Complements [`df-error-response-safety.instructions.md`](df-error-response-safety.instructions.md) (client responses); this file covers logging.

Server-side logs must never contain passwords, tokens, API keys, or credentials in plain text.

## Defense in Depth

1. **Layer 1 — explicit utilities** (call-site): `sanitize_url()`, `sanitize_params()`, `redact_token()` from `security/log_sanitizer.py`.
2. **Layer 2 — `SensitiveDataFilter`** (global): a `logging.Filter` on all handlers, registered in `configure_logging()`, auto-redacts patterns that slip through. Layer 1 is primary; Layer 2 is the safety net — both required.

## When to Use Each Utility

| Data type                                                  | Utility                   |
| ---------------------------------------------------------- | ------------------------- |
| Dict with password/secret/token keys                       | `sanitize_params(params)` |
| URL (may embed `user:pass@host` or sensitive query params) | `sanitize_url(url)`       |
| Bearer/access token                                        | `redact_token(token)`     |
| Normal string, no secrets                                  | Nothing needed            |

## Rules

1. Never log raw `params`/`config` dicts that may contain `password`/`secret`/`api_key`/`token`/`connection_string` keys — use `sanitize_params()`.
2. Never log full tokens or API keys — use `redact_token()`.
3. Prefer `type(exc).__name__` over `str(exc)` at warning/info level when the exception may carry a connection string or upstream body; use `exc_info=True` for full tracebacks at ERROR level.
4. Use `sanitize_url()` for any URL from config/env (issuer, JWKS, database, API base URLs).
5. Use `%s`-style logging, not f-strings, so the filter can intercept arguments before formatting.

## Anti-Patterns

| Anti-pattern                                     | Correction                                                     |
| ------------------------------------------------ | -------------------------------------------------------------- |
| `log.info(f"Connecting with {params}")`          | `log.info("Connecting with %s", sanitize_params(params))`      |
| `logger.warning("Failed for %s", discovery_url)` | `logger.warning("Failed for %s", sanitize_url(discovery_url))` |
| `logger.debug("Using token %s", token)`          | `logger.debug("Using token %s", redact_token(token))`          |

## Disabling for Local Debug

`LOG_SANITIZE=false` disables the global filter for local debugging only — never in production or CI.

## New Credential Key Checklist

When a module introduces a new credential key name (e.g. `custom_auth_token`): add it to `SENSITIVE_KEYS` in `security/log_sanitizer.py`, add a regex to `_SENSITIVE_KEY_NAMES` if needed, and run `python -m pytest tests/backend/security/test_log_sanitizer.py`.

## Would Revise If

Revise if `security/log_sanitizer.py` adds a new utility not reflected in the "When to Use Each Utility" table, or if `docs/dev-guides/2-log-sanitization.md` changes the defense-in-depth architecture without this file being updated in the same change.
