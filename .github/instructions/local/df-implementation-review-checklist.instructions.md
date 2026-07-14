---
description: "Require a structural maintainer-style review of the uncommitted diff after any substantive implementation, before the final response"
applyTo: "**"
lastReviewed: 2026-07-09
---

# Implementation Review Checklist (Data Formulator)

**Always-on rationale**: this review must fire after every substantive implementation regardless of which layer (frontend/backend/tests/docs) the change touched — the gate is on the _shape of the task_ (a completed implementation), not on any single file type. Ported from `.cursor/rules/implementation-review-checklist.mdc`.

After any substantive implementation, before the final response, review the uncommitted diff from a maintainer/code-review perspective — do not only verify that the feature works.

## Required Checks

| Check                              | What to verify                                                                                                             |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Blast radius                       | `git diff --stat` and relevant diffs reflect the actual scope of the change                                                |
| Responsibility boundaries          | Frontend UI, API route, service/helper, storage/session, and tests each own the right part of the behavior                 |
| API semantics                      | Endpoint names/methods/response shapes/side effects match the product action; similar UI actions call the same backend API |
| Frontend/backend state consistency | After mutations, Redux/local state, backend session/token/vault state, and subsequent list/status APIs agree               |
| Duplication                        | Two paths clearing the same state or repeating the same API flow → extract a shared helper/route                           |
| Regression surfaces                | Refresh/reload/list/status paths respect new flags or state, not just the primary click path                               |
| Tests                              | Focused tests exist for the changed contract, including at least one regression-path test where practical                  |
| Docs/rules sync                    | `docs/dev-guides/`, `.cursor/rules/`/`df-*.instructions.md`, or skills are updated if a cross-cutting convention changed   |

## Reporting

Fix clear issues found during this review before finalizing. If a trade-off remains, call it out explicitly in the final response with the risk and why it was left as-is.

## Anti-Patterns

| Anti-pattern                                                                       | Correction                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Declaring done once the happy path works                                           | Run the full checklist above before the final response  |
| Silently leaving a known trade-off unmentioned                                     | State the risk and rationale explicitly in the response |
| Two components each independently duplicating the same API-clear/state-reset logic | Extract one shared helper/route                         |

## Would Revise If

Revise if this checklist is applied to a trivial one-line fix and produces reviewer fatigue (narrow the "substantive implementation" trigger), or if 3+ regressions ship from a category this checklist claims to catch within a quarter.
