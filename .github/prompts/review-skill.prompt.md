---
description: "Audit a candidate skill (.github/skills/<name>/SKILL.md) using skill-review's five-gate process. For instructions/prompts/agents use /review-instruction, /review-prompt, /review-agent."
lastReviewed: 2026-05-26
---

# /review-skill

Run the [skill-review](../skills/skill-review/SKILL.md) skill on the candidate identified in the user's request (a file path, a Mall unit, or a heir-proposed adoption).

Steps:

1. Locate the candidate (read the artifact file or the proposal)
2. Run the trimmed [act-pass](../instructions/act-pass.instructions.md)
3. Apply the five gates from skill-review's SKILL.md (Spec, Quality, Scope, Safety, Currency & Coherence)
4. Produce the verdict using the output template in SKILL.md
5. Save the verdict where your heir keeps audit decisions (commit message for routine self-audit; dedicated file for external adoption)

If the verdict is **Decline** and the decline sets a precedent, record it in your heir's decision-record location.

**Would revise if**: the [skill-review](../skills/skill-review/SKILL.md) gates change, or new skill-adoption patterns emerge that the current 5-gate contract doesn't cover. Re-evaluate by 2026-08-26.
