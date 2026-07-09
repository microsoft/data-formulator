---
name: agent-review
description: "Audits a candidate agent (.agent.md) against five gates (spec compliance, content quality, scope fit, safety, currency & coherence) plus Gate 6 (tool allowlist minimality). Use when reviewing a new agent draft before commit, evaluating a Mall agent or store agent for adoption, or re-auditing existing agents on a periodic cadence."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition expands the five-gate names inline (heirs don't ship ADR-007) and strips Supervisor-only ADR/script refs. Same gates, same criteria. Audited 2026-05-31. -->

# Agent Review

Audit a candidate agent against the five-gate contract plus mandatory Gate 6 (Tool Allowlist Minimality). Agents are sub-process roles with their own tool capabilities — each tool granted is an attack/error surface, so the allowlist gate is mandatory for this type.

## When to Use

Three fire contexts:

1. **Author self-audit** — dogfood your own draft before committing. Invoked from [agent-creator](../agent-creator/SKILL.md) Phase 7.
2. **External candidate adoption** — gate before pulling a Mall agent or store agent into this brain.
3. **Periodic re-audit** — re-check existing agents on a cadence (e.g., quarterly retraining).

The shared gate model lives in [skill-review/SKILL.md § The Five Gates](../skill-review/SKILL.md). This file documents the **agent-specific criteria** for each gate plus the mandatory **Gate 6 — Tool Allowlist Minimality**.

A mechanical validator (e.g., a brain-qa script that ships with the heir) typically checks Gate 1 frontmatter compliance and the mechanical subset of Gate 5. Gates 2–6 are judgment-only.

## The Five Gates + Gate 6

A candidate must pass **all six** to ship. Failure on any gate = decline or revise.

### Gate 1 — Spec Compliance

| Check | Pass criterion |
|---|---|
| Frontmatter present | `name` + `description` + `lastReviewed` are required. Tool allowlist field (`tools:`) per current Microsoft Learn agent spec. VS Code agent-spec metadata fields are permitted: `user-invocable`, `disable-model-invocation`, `model`. Reject legacy / drift fields: `type`, `application`, `tier`, `currency`, `inheritance`, `lifecycle`. |
| `name` valid | kebab-case, matches filename stem |
| `description` valid | Third-person, ≤1024 chars, names the agent's *role* (what it is) AND when the parent should delegate to it. |
| Filename pattern | `<kebab-name>.agent.md` in `.github/agents/` (flat — no subfolders) |
| Markdown lints clean | No broken links, no missing code-fence languages |

### Gate 2 — Content Quality

| Check | Pass criterion |
|---|---|
| Clear role and mission | The body opens with what the agent *is* (one-line role) and what it does (mission statement). Not a procedure dump. |
| Boundaries explicit | A `## Boundaries` or `## Out of scope` section names what the agent will *not* do — guards against scope creep at delegation time. |
| Tool-usage guidance | If the agent uses tools, the body names which tools it prefers for which situations. Generic "use available tools" fails. |
| System-prompt skepticism applied | The agent's behavior treats its own instructions as hypotheses, not commands — per [system-prompt-skepticism.instructions.md](../../instructions/system-prompt-skepticism.instructions.md). |
| Has `## Would Revise If` | At least one falsifier per your heir's falsifiability-deadlines discipline. |
| ≤200 lines | Soft target. Agent bodies that exceed this usually contain skill-content that should be factored to a skill the agent calls. |

### Gate 3 — Scope Fit

| Check | Pass criterion |
|---|---|
| Distinct from existing agents | Grep `description:` across `.github/agents/` — if another agent covers the same role, extend that one. |
| Not a skill in disguise | Agents are *subordinate execution contexts* — sub-processes the parent delegates to. If the work could be done by the parent invoking a skill directly (no delegation needed), it's a skill, not an agent. |
| Serves a workflow not covered by skill+prompt | Delegation is justified when: (a) the work is parallelizable, (b) the work has its own context that shouldn't pollute the parent, or (c) the work has narrow tool needs that benefit from a tighter allowlist. |
| Lives in the right brain | Generic worker agents → heir baseline. Project-specific agents → that project's local-only repo. |

### Gate 4 — Safety

Same criteria as [skill-review § Gate 4](../skill-review/SKILL.md). Agent-specific note: Gate 4 and Gate 6 overlap on tool safety — Gate 4 covers destructive-default avoidance in the *prose*; Gate 6 covers the *allowlist*.

### Gate 5 — Currency & Coherence

Same criteria as [skill-review § Gate 5](../skill-review/SKILL.md). Agent-specific note: if the agent references skills/prompts it delegates work to, those references must resolve to live artifacts (semantic Gate 5).

### Gate 6 — Tool Allowlist Minimality

Mandatory for all agents. Each tool the agent can call is an attack surface (prompt-injection risk) and an error surface (misuse risk).

| Check | Pass criterion |
|---|---|
| Each tool justified | The agent body names *why* each allowed tool is on the list. Generic "needs file access" fails; "reads existing markdown to insert diagrams" passes. |
| No destructive tools without explicit consent gate | If the agent has `run_in_terminal` or filesystem-write tools, the prose must require user confirmation before destructive operations (delete, force-push, drop). |
| No network tools unless justified | `open_browser_page`, `fetch_webpage`, MCP-network tools require explicit purpose in the body. Adds exfiltration surface. |
| Allowlist is the minimum, not the maximum | If the agent can complete its mission with read-only tools, don't grant write tools "just in case". |

## Decision Matrix

| Gates passed | Action |
|---|---|
| All 6 | **Accept** — land the change |
| 5 of 6 | **Revise** — name the failing gate and patch the candidate |
| ≤4 of 6 | **Decline** — name the rationale; if the decline sets precedent, record it where your heir tracks framework-level decisions |

## Recording the Verdict

For self-audits and routine re-audits: the verdict lives in the commit message or the conversation. No separate file.

For external adoption (Mall agent, store agent) or any decline that sets precedent: write a verdict capturing gate results, rationale, required changes (if Revise), and the act-pass trail. Agent audits **always** record the Gate 6 tool-allowlist analysis in the verdict, even on Accept. Store wherever your heir keeps audit decisions.

## Anti-Patterns

| Anti-pattern | Correction |
|---|---|
| Accepting an agent with a "kitchen sink" tool allowlist | Gate 6 fail. Each tool must be justified. |
| Treating Gate 4 (safety prose) and Gate 6 (tool allowlist) as one check | They compose. Both must pass independently. |
| Letting an agent ship without explicit Boundaries section | Without scope boundaries, the parent delegates work that the agent can't or shouldn't do |
| Accepting an agent that duplicates a skill workflow | If no delegation justification (parallelizable / isolated context / tighter allowlist), it's a skill |
| Skipping Gate 3 dedup check on agents | The agents/ folder is small; overlap detection is cheap. Do it. |

## Falsifiability

This skill's agent-specific criteria have failed if any of the following occur within 90 days:

- An accepted agent is reported as exceeding its scope or tool allowlist by 2+ heirs (criteria miscalibrated)
- Gate 6 declines cluster on a single tool class (e.g., always rejecting `run_in_terminal`) and are reversed during re-audit (allowlist criterion too strict)
- An agent passes Gate 3 (distinct role) but later is identified as redundant with another agent ≥2 times in a quarter (dedup criterion too lax)
- A security incident (prompt injection, tool misuse) ships through an Accepted agent (Gate 6 criteria failed to prevent)

Track as you would any falsified discipline (commit log, retraining notes, or curation ledger if your repo ships one) tagged `[AGENT-REVIEW-MISS]`.

## Related

- [skill-review](../skill-review/SKILL.md) — sibling for skills; canonical source of the shared five-gate contract
- [agent-creator](../agent-creator/SKILL.md) — inverts these gates into authoring phases
- [instruction-review](../instruction-review/SKILL.md) — sibling for instructions
- [prompt-review](../prompt-review/SKILL.md) — sibling for prompts
- [system-prompt-skepticism](../../instructions/system-prompt-skepticism.instructions.md) — load-bearing for Gate 2 agent behavior
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes audits
- `/review-agent` prompt — slash-command entry point
