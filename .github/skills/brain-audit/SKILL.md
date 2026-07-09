---
name: brain-audit
description: Perform a local brain audit for ACT Edition (and Supervisor) using deterministic QA plus targeted file review, then produce severity-ranked fixes. Pairs with extension-audit on the sibling surface side; the Marketplace surface routes there, not here.
lastReviewed: 2026-05-29
---

<!-- brain-qa: allow AlexMaster -- documents the 2026-05-18 retirement as a stale-architecture pattern to flag in audits -->

# Brain Audit

Run a local quality audit of the Edition brain (or Supervisor brain) and report issues with concrete, minimal fixes.

Sibling pair: this skill is the brain-side companion to the Supervisor's `extension-audit` skill. Each owns its own surface; together they cover the constellation.

## When to Use

- User asks to "audit the brain"
- Before release or migration
- After broad instruction/skill edits
- When behavior feels inconsistent with ACT principles

## Local Audit Protocol

1. Start from the `/audit-brain` prompt, which routes to the `brain-auditor` worker.
2. Gather local deterministic evidence from repository state:
   - frontmatter completeness and freshness (`lastReviewed`, required fields per artefact type)
   - cross-reference integrity (files referenced by prompts/instructions/skills exist)
   - sibling-repo xrefs: references to `../Alex_ACT_Memory/...` and `../Alex_ACT_Plugin_Mall/...` are valid; check the sibling repo if checked out, otherwise treat as out-of-band
   - stale-architecture flags: references to OneDrive / iCloud / Dropbox for AI-Memory discovery (removed in Extension v9.0.0), `heirs/registry.json` fleet self-registration (removed v9.0.0), AlexMaster as upstream authority (retired 2026-05-18) without an `<!-- brain-qa: allow ... -->` marker, OR Supervisor-side Mall operational artifacts removed in Supervisor's ADR-008 Phase 7b (Mall self-curation) on 2026-05-29 (any `scripts/store-sync.cjs` / `scripts/mall-*.cjs`, the Supervisor `mall/` folder, skills `store-evaluation`/`staleness-discipline`/`mall-source-inventory`/`store-adoption`, instruction `mall-source-maintenance`, prompts `/audit-mall`/`/add-store`/`/prune-store`/`/refresh-mall-sources`/`/scan-stores`, or the local `C:\Development\MALL\` folder \u2014 the Mall self-curates from its own repo)
3. Validate findings directly in affected files.
4. Report findings ordered by severity with exact file references.
5. Apply approved fixes, then rerun the same local evidence checks to confirm closure.

## Brain ↔ Surface Boundary

`Alex_ACT_Extension/brain/` is a verbatim copy of an Edition tag. Audit those contents against the **Edition repo at the bundled tag**, not against the live Extension working tree. Marketplace surface artefacts (manifest, walkthrough, wiki, host code) route to the Supervisor's `extension-audit` skill. If a finding straddles (e.g. a brain skill referenced by a wiki page was renamed), fix here and recommend the sibling skill for the surface side.

## Reporting Standard

Each finding includes:

- Severity (`high`, `medium`, `low`)
- File path
- Why it matters operationally
- Minimal fix

## Boundaries

- Local deterministic evidence is mandatory.
- Do not block audit completion on external model tokens.
- Separate "must-fix now" from "quality debt".

## Falsifiability

This skill needs revision if, within 90 days:

- High-severity findings from this audit repeatedly reappear after claimed fixes
- Deterministic checks pass but release regressions keep surfacing from unchanged audit gaps
- Audit reports cannot be mapped to concrete file edits

Track outcomes in `docs/ledgers/curation-log.md` when available.
