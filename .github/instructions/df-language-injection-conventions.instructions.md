---
description: "Language injection conventions for LLM Agent prompts — how to inject the user's language into system prompts and handle Python-side user-visible messages"
applyTo: "py-src/data_formulator/agents/**/*.py,py-src/data_formulator/routes/agents.py"
lastReviewed: 2026-07-09
---

# Language Injection Conventions (Data Formulator)

Ported from `.cursor/rules/language-injection-conventions.mdc`. Canonical source: [`docs/dev-guides/6-i18n-language-injection.md`](../../docs/dev-guides/6-i18n-language-injection.md). Related skill: [`language-injection`](../skills/language-injection/SKILL.md).

Language flows per-request: `Frontend i18n → Accept-Language header → get_language_instruction() → system prompt`.

## Rules

| #   | Rule                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1   | User-facing LLM output MUST inject language via `get_language_instruction(mode=...)` in the route handler                         |
| 2   | Mode: `"full"` for text-heavy agents, `"compact"` for code-generation agents and short-text endpoints                             |
| 3   | Inject into the **system prompt only** via `inject_language_instruction()` from `agent_language.py` — never into user messages    |
| 4   | Do NOT inject for non-user-facing calls (health checks, internal tool calls)                                                      |
| 5   | Do NOT duplicate — skip if upstream messages already contain a language instruction                                               |
| 6   | Do NOT use env vars, global interceptors, or hardcoded language strings — route handlers use `get_language_instruction(mode=...)` |
| 7   | New language → add to `LANGUAGE_DISPLAY_NAMES` in `agents/agent_language.py` + locale files in `src/i18n/locales/<lang>/`         |

## Python-Side User-Visible Messages (`message_code` pattern)

For fixed Python strings shown in the UI (error messages, clarify options, completion summaries): do NOT translate in Python. Keep the English string as the default value, add a `message_code` (or `content_code`/`error_code`) key like `"agent.someKey"`, optionally `message_params` for interpolation. The frontend translates via `translateBackend(fallback, code, params)`.

```python
# ✅ GOOD — backend returns code, frontend translates
yield {"type": "error", "message": "Output DataFrame is empty (0 rows).", "message_code": "agent.emptyDataframe"}
```

## Anti-Patterns

| Anti-pattern                                                          | Correction                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `yield {"message": translate_in_python("empty_df", lang)}`            | Return the English fallback + `message_code`; let the frontend translate |
| Hardcoded `"回答请使用中文"` in a prompt                              | Use `get_language_instruction(mode=...)`                                 |
| Injecting language into the user message instead of the system prompt | Inject via `inject_language_instruction()` on the system prompt only     |

## Would Revise If

Revise if `agents/agent_language.py` changes its public API (`build_language_instruction`, `inject_language_instruction`) and this file isn't updated in the same change.
