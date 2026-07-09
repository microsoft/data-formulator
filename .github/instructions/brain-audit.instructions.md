---
description: Brain audit routing -- run local deterministic QA on brain artefacts, validate findings in files, and prioritize fixes by severity.
applyTo: '**/*audit*brain*,**/*brain*qa*,**/*epistemic*qa*,**/*quality*review*'
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition omits the "Boundary with extension-audit" section, the step-6 routing rule, and the dated falsification deadline. Heirs don't ship the Supervisor-only `extension-audit` skill (Marketplace surface curation is Supervisor's duty 5), so the boundary is moot. Heir copy targets the brain-audit-only workflow. Audited 2026-05-31. -->

# Brain Audit Routing

For any brain-audit request:

1. Route through `/audit-brain` and run the `brain-auditor` worker first.
2. Use local deterministic evidence (frontmatter/schema consistency, manifest consistency, cross-reference integrity).
3. Validate each finding in the target file before proposing changes.
4. Apply minimal fixes to high-severity findings first, then medium, then low.
5. Rerun the same local evidence checks after edits.

The audit is complete only after findings are either fixed or explicitly documented as deferred with rationale.

References to the AI-Memory sibling repo at `../Alex_ACT_Memory/...` are valid xref destinations — a missing target in the local tree means *check the sibling repo*, not *broken link*. The sibling repo is checked out independently per heir.

## Would Revise If

Revise if the brain-auditor worker misses defect classes that manual review catches on the same audit pass, if local deterministic checks repeatedly disagree with file-validated findings (the muscle is unreliable), or if severity prioritization causes critical defects to ship while medium ones get fixed first.
