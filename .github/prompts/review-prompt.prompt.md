---
description: "Audit a candidate prompt (.prompt.md) using prompt-review's five-gate process"
lastReviewed: 2026-05-26
---

# /review-prompt

Run the [prompt-review](../skills/prompt-review/SKILL.md) skill on the candidate identified in the user's request (a file path, a Mall prompt, or a heir-proposed adoption).

Steps:

1. Locate the candidate (read the artifact file or the proposal)
2. Run the trimmed [act-pass](../instructions/act-pass.instructions.md)
3. Apply the five gates from prompt-review's SKILL.md (Spec, Quality, Scope, Safety, Currency & Coherence)
4. Produce the verdict using the output template in SKILL.md
5. Save the verdict where your heir keeps audit decisions (commit message for routine self-audit; dedicated file for external adoption)

If the verdict is **Decline** and the decline sets a precedent, record it in your heir's decision-record location.

**Would revise if**: the [prompt-review](../skills/prompt-review/SKILL.md) gates change (especially Gate 1 spec when Microsoft Learn prompt-files spec updates), or new prompt-adoption patterns emerge that the contract doesn't cover. Re-evaluate by 2026-08-26.
