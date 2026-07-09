---
description: "Require test coverage for every new feature/bugfix, and a diagnose-before-modify protocol when a test fails — never edit test code just to make it pass"
applyTo: "**"
lastReviewed: 2026-07-09
---

# Test-Driven Workflow (Data Formulator)

**Always-on rationale**: the "never silently modify a failing test" protocol must be checked any time a test fails during any kind of work, not only when a `test_*` file happens to be open — the trigger is an _event_ (test failure), not a file pattern. Ported from `.cursor/rules/test-driven-workflow.mdc` (source content is in Chinese, kept as-is).

## 1. Tests First

New features and bug fixes MUST ship with tests, not business code alone:

| Work type   | Requirement                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| New feature | Write (or at least co-write) tests describing expected behavior, then implement until they pass |
| Bug fix     | Write a reproduction test first, confirm it fails, then fix until it passes                     |
| Refactor    | Confirm coverage exists before refactoring; confirm all tests still pass after                  |

Run relevant tests after implementing: backend `python -m pytest tests/backend/ -q`; frontend `yarn test`.

## 2. Test Protection — Never Silently Modify a Failing Test

When a test fails, do **not** edit the test code just to make it pass. Instead:

1. **Reproduce and locate** — run the failing test, confirm the failure.
2. **Diagnose** — classify as (A) the test itself is wrong (bad assertion/setup), (B) the implementation has a bug, or (C) the spec changed and the test is stale.
3. **Propose** — give at least two options (fix the test / fix the implementation / update the spec) with impact and risk for each.
4. **Wait for confirmation** — the user decides which option to apply before you make the change.

**Absolutely forbidden**: changing test code the moment it goes red without diagnosis; deleting or `@pytest.mark.skip`-ing a failing test to "resolve" it; changing assertion values to match a wrong implementation.

## 3. Precise Changes Only

Don't refactor unrelated passing tests, don't change existing assertion logic unless explicitly asked, and don't "improve" test code that isn't part of the current task.

## Anti-Patterns

| Anti-pattern                                                       | Correction                                                 |
| ------------------------------------------------------------------ | ---------------------------------------------------------- |
| Test goes red → immediately edit the assertion                     | Diagnose (A/B/C) and propose options first                 |
| `@pytest.mark.skip` on a failing test to unblock a PR              | Fix or classify the failure; skipping hides the regression |
| Refactoring a passing, unrelated test while fixing a different one | Touch only the tests relevant to the current task          |

## Would Revise If

Revise if this diagnose-first protocol is shown to slow down genuinely trivial test-typo fixes (e.g. a renamed function the test still references by its old name) — in that narrow case, a fast-path exception may be worth adding.
