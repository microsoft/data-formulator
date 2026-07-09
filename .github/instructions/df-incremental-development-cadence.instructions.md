---
description: "Enforce step-by-step implementation of multi-step tasks — design-doc check, tests, and i18n keys completed after each step, not swept at the end"
applyTo: "**"
lastReviewed: 2026-07-09
---

# Incremental Development Cadence (Data Formulator)

**Always-on rationale**: the step-by-step cadence must be checked at every logical unit of a multi-step task, regardless of file type — the failure mode (batching everything to the end) can only be caught by an always-on gate. Ported from `.cursor/rules/incremental-development-cadence.mdc`.

Multi-step tasks MUST be implemented **one step at a time**. After each logical unit (function, endpoint, component), complete all cross-cutting concerns before moving on.

## After Each Step

| Step | Action                                                                                           |
| ---- | ------------------------------------------------------------------------------------------------ |
| 1    | Verify against the design doc (`design-docs/` or issue spec); raise deviations before continuing |
| 2    | Add tests for the just-implemented code; run and confirm green                                   |
| 3    | Add i18n keys (`en` + `zh`) immediately if user-visible text was introduced                      |
| 4    | Update docs immediately if a new cross-cutting convention was introduced                         |

## Anti-Patterns

| Anti-pattern                                                          | Correction                                                       |
| --------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Implementing 3+ functions/endpoints before writing any tests          | Test after each unit, not in a batch at the end                  |
| Sweeping all i18n keys in a final pass after all code is done         | Add `en`+`zh` keys the moment user-visible text is introduced    |
| Checking design docs only after the entire implementation is complete | Check per step, before continuing to the next                    |
| Mentioning "tests and i18n still needed" only in the final response   | Tests and i18n are part of "done" for that step, not a follow-up |

## Would Revise If

Revise if this cadence is applied to single-step trivial changes and creates unnecessary ceremony (narrow the "multi-step task" trigger), or if the per-step test-and-i18n requirement is bypassed 3+ times in a quarter without pushback (rule isn't load-bearing in practice).
