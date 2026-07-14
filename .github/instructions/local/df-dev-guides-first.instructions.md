---
description: "Require reading the relevant docs/dev-guides/ document before implementing a feature touching that area, and updating dev-guides/skills/instructions when a change introduces a new cross-cutting convention"
applyTo: "**"
lastReviewed: 2026-07-09
---

# Dev Guides First (Data Formulator)

**Always-on rationale**: this gate applies before starting _any_ substantive Data Formulator implementation, regardless of which file is opened first — the relevant guide must be checked before code is written, not after. Ported from `.cursor/rules/dev-guides-first.mdc`.

## Before Starting Any Development

Read the matching guide in `docs/dev-guides/` before implementing or designing a new feature, module, or significant change:

| Guide                                        | When to read                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `1-streaming-protocol.md`                    | Streaming endpoints or NDJSON protocol                                                    |
| `2-log-sanitization.md`                      | Logging, credentials, external services, DataLoaders                                      |
| `3-data-loader-development.md`               | `ExternalDataLoader`, `DataConnector`, connector routes                                   |
| `4-authentication-oidc-tokenstore.md`        | OIDC, TokenStore, `AUTH_MODE`, SSO                                                        |
| `6-i18n-language-injection.md`               | Agent prompts/routes, backend user-visible messages, frontend i18n                        |
| `7-unified-error-handling.md`                | API errors, frontend API calls, streaming error events, error tests                       |
| `8-path-safety.md`                           | Backend file access, downloads, Workspace paths, Agent tools, DataLoaders, sandbox config |
| `10-agent-knowledge-reasoning-log.md`        | Agent knowledge injection, KnowledgeStore, reasoning logs                                 |
| `11-catalog-metadata-sync.md`                | Catalog sync, `catalog_cache`, metadata merge, catalog browsing                           |
| `12-sandbox-session.md`                      | Sandbox execution, Agent tool-calling loops, namespace management                         |
| `13-unified-row-limits.md`                   | Row limits, `MAX_IMPORT_ROWS`, DataLoader size parameter                                  |
| `14-model-capability-runtime-degradation.md` | LLM client calls, capability checks, `reasoning_effort`, vision degradation               |
| `15-dataframe-serialization.md`              | DataFrame→JSON serialization, Agent result rows, table API responses                      |

Also check `.cursor/rules/` (or its `.github/instructions/df-*` port) and `.cursor/skills/` (or `.github/skills/`) for related conventions before starting.

## After Introducing a New Convention

Before considering the task complete:

1. Update the relevant existing dev-guide, or create a new one (`docs/dev-guides/<next-number>-<topic>.md`) for a new cross-cutting convention.
2. Update or create the matching Skill (`.github/skills/<name>/SKILL.md` and/or `.cursor/skills/<name>/SKILL.md`) if it affects a reusable workflow.
3. Update or create the matching Instruction/Rule (`df-*.instructions.md` and/or `.cursor/rules/*.mdc`) if it adds a file-scoped constraint.

## Anti-Patterns

| Anti-pattern                                                                             | Correction                                                         |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Implementing a streaming/auth/i18n/error-handling change without reading its guide first | Read the guide table above before writing code                     |
| Introducing a new convention and only mentioning it needs docs in the final response     | Update the guide/skill/rule in the same change, not as a follow-up |

## Would Revise If

Revise if `docs/dev-guides/` renumbers or removes a guide referenced in the table above and this file isn't updated in the same change, or if a new guide is added and not reflected here within the same PR that introduces it.
