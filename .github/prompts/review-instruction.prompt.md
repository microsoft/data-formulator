---
description: "Audit a candidate instruction (.instructions.md) using instruction-review's five-gate process (plus Gate 6 for always-on)"
lastReviewed: 2026-05-26
---

# /review-instruction

Run the [instruction-review](../skills/instruction-review/SKILL.md) skill on the candidate identified in the user's request (a file path, a Mall instruction, or a heir-proposed adoption).

Steps:

1. Locate the candidate (read the artifact file or the proposal)
2. Run the trimmed [act-pass](../instructions/act-pass.instructions.md)
3. Apply the five gates from instruction-review's SKILL.md (Spec, Quality, Scope, Safety, Currency & Coherence)
4. If `applyTo: "**"` or pattern matches a meaningful fraction of typical work, also apply Gate 6 (Token Budget)
5. Produce the verdict using the output template in SKILL.md
6. Save the verdict where your heir keeps audit decisions (commit message for routine self-audit; dedicated file for external adoption)

If the verdict is **Decline** and the decline sets a precedent (a class of candidate we expect to see again), record it in your heir's decision-record location.

**Would revise if**: the [instruction-review](../skills/instruction-review/SKILL.md) gates change (especially Gate 6 token budget for always-on), or new instruction-adoption patterns emerge that the contract doesn't cover. Re-evaluate by 2026-08-26.
