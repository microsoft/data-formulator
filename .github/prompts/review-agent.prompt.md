---
description: "Audit a candidate agent (.agent.md) using agent-review's six-gate process (Gate 6 = Tool Allowlist Minimality)"
lastReviewed: 2026-05-26
---

# /review-agent

Run the [agent-review](../skills/agent-review/SKILL.md) skill on the candidate identified in the user's request (a file path, a Mall agent, or a heir-proposed adoption).

Steps:

1. Locate the candidate (read the artifact file or the proposal)
2. Run the trimmed [act-pass](../instructions/act-pass.instructions.md)
3. Apply the five gates from agent-review's SKILL.md (Spec, Quality, Scope, Safety, Currency & Coherence)
4. Apply Gate 6 — Tool Allowlist Minimality — mandatory for all agents
5. Produce the verdict using the output template in SKILL.md; the verdict must record the Gate 6 tool-allowlist analysis even on Accept
6. Save the verdict where your heir keeps audit decisions (commit message for routine self-audit; dedicated file for external adoption)

If the verdict is **Decline** and the decline sets a precedent, record it in your heir's decision-record location.

**Would revise if**: the [agent-review](../skills/agent-review/SKILL.md) gates change (especially Gate 6 tool-allowlist minimality when VS Code agent spec updates), or new agent-adoption patterns emerge that the contract doesn't cover. Re-evaluate by 2026-08-26.
