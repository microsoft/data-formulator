---
description: "Frontend TypeScript test conventions (Vitest) — file location mirroring src/, structure, and style for tests/frontend/"
applyTo: "tests/frontend/**/*.test.{ts,tsx}"
lastReviewed: 2026-07-09
---

# Frontend Test Conventions (Data Formulator)

Ported from `.cursor/rules/frontend-test-conventions.mdc`.

## File Location & Naming

Place tests under `tests/frontend/unit/` mirroring `src/` (e.g. `tests/frontend/unit/data/` for `src/data/`). Name files `<functionOrFeature>.test.ts` (or `.test.tsx` for React rendering tests).

## Conventions

| Rule                  | Detail                                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------- |
| Explicit imports      | Import `describe`, `it`, `expect` from `vitest` even though globals are enabled                          |
| Rendering tests       | Use `@testing-library/react` + `@testing-library/jest-dom`                                               |
| Prefer pure functions | Test exported pure functions over internal component state; extract complex logic into a testable helper |
| Grouping              | Group with `describe`; use section comments for clarity                                                  |
| Assertions            | One assertion per `it` where possible; name as `should <expected behavior>`                              |
| Independence          | No shared mutable state between `it` blocks; no reaching into `node_modules` internals                   |

## Anti-Patterns

| Anti-pattern                                                   | Correction                                                           |
| -------------------------------------------------------------- | -------------------------------------------------------------------- |
| `test('works', () => {...})` — no `describe`, vague name       | Wrap in `describe('functionName', ...)`, name as `should <behavior>` |
| Testing internal component state instead of an exported helper | Extract the logic to a pure function and test that                   |
| Shared mutable fixtures across `it` blocks                     | Reset/re-create fixtures per test                                    |

## Would Revise If

Revise if `tests/frontend/unit/` stops mirroring `src/` 1:1 (structural convention changes) and this file isn't updated in the same change.
