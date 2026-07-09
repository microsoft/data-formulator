---
description: "When you spot tech debt, stale references, or outdated content — fix it in the same turn. Do not defer."
applyTo: "**"
lastReviewed: 2026-05-29
---

# No Deferred Debt

**Always-on rationale**: debt surfaces in any context (script run, doc audit, file edit, command output). The "fix in same turn" discipline must fire whenever debt is observed, not only when working on specific file types. A scoped glob would create the failure mode it's designed to prevent.

If a turn surfaces tech debt — stale references, dead links, outdated content, dead-letter prompts, hardcoded names that no longer exist — fix it in the same turn. Do not log it as "non-blocking" or "follow-up workstream." The cheapest moment to fix the debt is the moment it surfaced.

## Rule

When any of the following appears in a turn's output:

- A `grep`/`Select-String` surfaces references to artifacts I just deleted
- A regen reveals stale counts in a manifest
- A file lookup returns a path that no longer exists
- A doc enumerates skills/instructions/prompts that are gone
- A script hardcodes names I just renamed or removed
- A link in a markdown file points to something that 404s locally
- A `description` or `applyTo` references concepts no longer in the brain

**Fix it before declaring the turn done.** Do not write "non-blocking, deferred to next pass" unless the debt is genuinely architectural and requires its own decision cycle (in which case open an explicit decision artifact — ADR draft, proposal, or HANDOFF entry naming the *specific* decision the deferral is waiting on).

"I'll fix it in the next session" is not an acceptable reason. The context is already loaded. The diff is already small. The reviewer is already in the file.

## When deferral IS legitimate

| Deferral reason | Acceptable? |
|---|---|
| "Not in scope of this turn" | No — if I spotted it, it's in scope now |
| "Needs user decision" | Yes — but write the specific question in HANDOFF.md or a proposal, don't just leave the debt |
| "Requires architectural redesign" | Yes — open ADR draft naming the question, don't leave a silent broken state |
| "Would take more than 10 minutes" | Borderline — if it's mechanical, do it; if genuinely complex, name the deferral concretely with timeline |
| "Documentation update only" | No — docs that lie are debt |
| "Test data" | No — test data with dead refs makes tests untrustworthy |

## Anti-patterns

| Came out | Correction |
|---|---|
| "Known tech debt (non-blocking, deferred)" with no decision-blocker named | Either fix it or name the specific decision waiting |
| Logging debt in commit message and shipping the broken state | The commit message names the debt; the next commit pays it. Don't ship debt with attribution. |
| Spotting a broken link mid-task and skipping past it because "different task" | Same task. The link is now your responsibility because you saw it. |

## Origin + relation

Codified 2026-05-24 from Alyva_Master heir-side discipline (FOUR-REPOS-COMPARISON.md Tier A §0.1 row 3). Composes with [lint-discipline](lint-discipline.instructions.md): lint-discipline covers files I touched; this rule covers debt I surfaced regardless of whether I touched its file.

## Would Revise If — falsification deadlines

- **Date-based**: 2026-08-23 (90 days from adoption). If by then the rule has produced no observed change in deferral-language in commits or HANDOFF entries, sunset.
- **Event-based**: at 10 brain-touching turns where the rule had opportunity to fire (debt surfaced mid-turn), audit. If bypassed ≥3 times with "non-blocking deferred" framing and no decision-blocker named, sunset.
- **Scope-creep**: if the rule turns single-file fixes into rabbit holes that consistently double the turn's scope ("fix now" overhead > "fix later" cost) ≥3 times in a quarter, narrow the rule or codify a batching exception.
