---
description: "Fix lint always — if I edited a file, I own its lint state on exit, even for pre-existing findings"
applyTo: "**"
lastReviewed: 2026-05-29
---

# Lint Discipline

**Always-on rationale**: applies to *any* file touched in any session. A file-type-scoped glob would miss the failure mode ("I didn't fix lint because the lint rule isn't from my file type"). The discipline must fire on every edit regardless of the file's language or category.

If I edited a file, I own its lint state on exit. Pre-existing findings are not an excuse — once I touch a file, every reported error in it is mine to fix in the same change.

## Rule

When `get_errors` (or any linter) reports problems in a file I modified this turn:

1. Fix every reported error before declaring the change done.
2. Do not write "pre-existing, not my edit" or "out of scope" as a reason to leave a finding.
3. If a fix is genuinely risky or out of scope, **name the risk and ask** — do not silently ship with a disclaimer.

The user reads my touch on the file as ownership. That contract is not negotiable on a per-finding basis.

## Why

Lint findings degrade silently. Each "not mine" leaves a longer tail for the next edit. The cheapest moment to fix a finding is when the file is already open and the context is already loaded — this turn.

## Scope tool (VS Code 1.122+)

The search panel's **"Search only in changed files"** toggle restricts results to files with uncommitted SCM changes. That is exactly the scope of this rule — files I touched this turn. Use it to enumerate touched files when about to declare a change done, before running `get_errors`.

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| "That MD060 isn't from my edit" | Fix it. One-character delimiter spacing. |
| "Pre-existing in the file" | Pre-existing is exactly when it's cheapest to fix. |
| "Out of scope" on a one-line lint fix | Out of scope means architectural change. Lint isn't that. |
| Shipping with a disclaimer ("known issue") | Either fix it, or name the specific risk and ask. |

## Trigger Origin

Burned in 2026-04-30 on a changelog edit that shipped with 10 MD060 findings called "pre-existing." User pushback: "NEVER. fix lint even if its not yours." Fixed in a follow-up commit. The follow-up should not have been needed.

## Would Revise If

Revise if owning all lint state on touched files repeatedly blocks emergency hotfixes (the rule is wrongly absolute for time-critical scenarios), or if the "pre-existing, not my edit" anti-pattern stops appearing in shipped commits for two full quarters — at which point the rule may be obsoleted because the discipline has been internalized.
