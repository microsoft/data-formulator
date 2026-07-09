---
name: skill-creator
description: "Create skills that pass skill-review's five gates by construction — intent capture, prior-art scan, draft against gates, dogfood self-review. Use when authoring a new skill, refactoring an existing one, or adopting a Mall unit into this brain."
lastReviewed: 2026-05-31
---

<!-- intentional divergence from Supervisor: Edition replaces Supervisor-only path (`docs/references/skill-spec-industry-baseline.md`) with inline summary, and "adopted as Supervisor's" with "adopted by ACT". Same five gates. Audited 2026-05-31. -->

# Skill Creator

Author skills that pass [`skill-review`](../skill-review/SKILL.md)'s five gates by construction. The five gates are the quality bar; invert them, and you build to standard the first time.

This skill teaches the spec-aligned shape — agentskills.io / Anthropic / Microsoft converge on `name` + `description` as the only required fields, with ACT discipline fields layered alongside.

## Three-level loading (the cost model)

Anthropic's architectural framing, adopted by ACT:

| Level | When loaded | Token cost | Content |
|---|---|---|---|
| **L1 — Metadata** | Always (startup) | ~100 tok/skill | Frontmatter `name`, `description`. Pre-loaded into system prompt for discovery. |
| **L2 — Body** | When triggered | <5k tok | SKILL.md body. Read when `description` matches the request. |
| **L3 — Bundled** | On demand | Effectively unlimited | `references/`, `scripts/`, `assets/`, `examples/`. Zero context cost until accessed. Scripts emit output, not code. |

Implication: every line in SKILL.md competes with conversation context once the skill fires. Bundled files are nearly free. **When in doubt, bundle.**

## When to Use

- Authoring a new skill in `.github/skills/`
- Refactoring an existing skill (scope shift, split, merge)
- Adopting a Mall unit into this brain (adapt, don't copy verbatim)

## When **not** to use

- Editing an instruction (`.github/instructions/*.instructions.md`) — instructions are always-on rules, not invokable skills. Different artifact.
- Writing a one-off prompt (`.github/prompts/*.prompt.md`) — verb-prompts pair with noun-skills; prompt-only goes through a lighter path.
- Authoring a Mall unit — Mall skills target external delivery surfaces (Claude, Cursor, antigravity). Different authoring path.

## The Seven Phases

Each phase inverts one of the five gates. Author against the phase, pass the gate.

### Phase 1 — Intent capture + evals

Before any drafting, answer in writing:

1. **What does this skill enable that the agent currently can't do well?** One sentence. If the sentence contains "and" or "+", you have two skills — split.
2. **When should it fire?** Concrete trigger phrases or contexts. Not abstract categories.
3. **What's the output?** A file? A decision? A modified artifact? Be specific.

**Evals before body (Anthropic's strongest authoring rule).** Before writing the SKILL.md body, write 2-3 representative tasks the skill must handle and run the agent **without** the skill. Document specific failures. Those failures are the eval set; the skill body exists to make them pass. Iterate body against evals, not against imagined use.

Output of this phase: a 3-line intent bullet list + a short eval list at the top of a draft `SKILL.md`. Delete both before commit — the act of answering forces clarity.

### Phase 2 — Prior-art scan

Before writing, look. Two channels (ordered by precedence):

| Channel | How | What you're looking for |
| --- | --- | --- |
| Existing brain | `ls .github/skills/` + `grep -r description: .github/instructions/` | Overlap with existing artifacts (Gate 2 dedup risk) |
| Mall inventory | Check the Mall catalog per `mall-installation.instructions.md` | Existing Mall units that cover this — *adopt rather than author* |

Decision matrix:

| Finding | Action |
| --- | --- |
| Existing brain artifact covers ≥70% | **Extend the existing one**, don't create a new artifact |
| Mall unit covers it cleanly | **Adopt the Mall unit** (retarget frontmatter), don't write from scratch |
| Partial coverage in Mall or brain | **Author the new skill, cite the partial coverage in `Related`** |
| Nothing exists | **Author from scratch** — this is the legitimate gap |

If the prior-art scan changes your intent (Phase 1) — *go back and revise*. Drafting on the wrong intent wastes the rest.

### Phase 3 — Draft against Gate 1 (Spec)

Use the frontmatter template at [`references/frontmatter-spec.md`](references/frontmatter-spec.md). Spec-aligned shape:

```yaml
---
name: <kebab-name>            # required — matches folder, ≤64 chars, lowercase + hyphens
description: "..."             # required — third-person, ≤1024 chars, names what + when
lastReviewed: YYYY-MM-DD       # brain-qa enforced, drives the review queue
---
```

**Description discipline** (Anthropic, load-bearing because L1 metadata is the discovery mechanism):

- Third person: "Processes Excel files", not "I can help you process Excel files"
- Specific: includes exact package names, tool names, trigger phrases
- Both halves: *what the skill does* + *when to use it*

| Good | Bad |
|---|---|
| `"Extract text and tables from PDF files. Use when the user mentions PDFs, forms, or document extraction."` | `"Helps with documents"` |
| `"Detect stale Mall stores using deterministic freshness checks. Use during /audit-mall or when triaging upstream drift."` | `"Mall freshness helper"` |

File location: `.github/skills/<kebab-name>/SKILL.md`. Folder name matches `name` frontmatter. Anthropic recommends **gerund form** for new skills (`processing-`, `analyzing-`, `converting-`); existing noun-form skills (`skill-review`, `mall-curation`) stay as-is — no forced rename.

### Phase 4 — Draft against Gate 2 (Quality)

| Quality criterion | How you author for it |
| --- | --- |
| Behavioral, not encyclopedic | Every section title is a verb or instruction. "What X Is" sections are anti-patterns. |
| Visible markers / falsifiability | Include a `## Would Revise If` block with at least one concrete falsifier (date, count, observable event). |
| ≤500 lines | Anthropic spec cap. Bundle long reference content into `references/<topic>.md` rather than inlining (see Phase 6). |
| Single responsibility | One verb in the title. If you need "and", split. |
| No duplicate content | Cross-reference, don't restate. Link to the five-gates checklist; don't paste it. |
| Consistent terminology | Pick one term per concept ("field" / "box" / "element" — pick one), use it throughout. |
| Time-sensitive info | Avoid "as of August 2025" phrasing. Use "Current method" + collapsed "Old patterns" sections instead. |

### Phase 5 — Draft against Gate 3 (Scope)

Routing — where does this skill live?

| Target | Route |
| --- | --- |
| Generic, helpful to many projects | File in this heir's `.github/skills/` |
| Project-specific helper, no reuse | Not a skill — it's a project script or a one-off prompt |
| External surface (Claude / Cursor / antigravity catalog) | Not an ACT skill — author a Mall unit instead |

### Phase 6 — Draft against Gate 4 (Safety) + bundle resources

Safety checks (inversion of Gate 4):

- No destructive defaults. Anything that deletes, force-pushes, or overwrites requires `confirm()` or explicit user approval **in the SKILL.md prose**, not just in linked scripts.
- No hardcoded credentials, no PII, no real client names.
- If the skill reads external content (URLs, files), specify how it sanitizes before use.
- Reversible: a user can disable the skill (delete its folder, or move it out of `.github/skills/`) without breaking the brain.

**Bundled resources — the under-used pattern.** Most Supervisor skills are SKILL.md-only. They shouldn't be. Use subfolders when content is read-on-demand rather than always-loaded:

| Subfolder | Put here | Don't put here |
| --- | --- | --- |
| `references/` | Domain knowledge the skill *consults* (checklists, specs, frameworks, taxonomies). Markdown only. | Behavioral rules — those go in SKILL.md prose. |
| `scripts/` | Executable helpers the skill invokes (Node, PowerShell, Python). | One-shot project scripts unrelated to the skill itself. |
| `assets/` | Output templates the skill produces (skeleton files, report templates, examples). | Working drafts, generated outputs. |
| `examples/` | Worked examples showing the skill applied. | Test fixtures (those go in `scripts/test/`). |

See [`references/bundled-resources.md`](references/bundled-resources.md) for the full pattern guide. The goal is the SKILL.md stays ≤500 lines while domain knowledge expands freely in references/.

**Script discipline** (Anthropic, applies when the skill bundles `scripts/`):

- **Solve, don't punt** — handle errors inside the script; don't let the script fail and ask the model to recover
- **No voodoo constants** — every magic number gets an inline comment. `REQUEST_TIMEOUT = 30  # HTTP requests typically complete within 30s` not `TIMEOUT = 47  # ?`
- **Forward slashes always** — even on Windows. `scripts/foo.cjs`, not `scripts\foo.cjs`
- **Specify install commands** — don't assume packages are present; document `npm install x` or `pip install y`
- **MCP tool names** — fully qualified (`ServerName:tool_name`), not bare

### Phase 7 — Dogfood self-audit

Before committing, run [`skill-review`](../skill-review/SKILL.md)'s five gates on your own draft. For routine self-audit the verdict lives in the commit message; for an external candidate (Mall unit, store skill) write the verdict per `skill-review/SKILL.md § Recording the Verdict`. Writing it down, not just thinking it, is what surfaces the gaps. If any gate fails, fix and re-run.

Also write 2-3 test prompts:

- **Should-fire prompts**: 2-3 user phrasings the skill must catch (drive the `description` field's keyword set)
- **Should-not-fire prompts**: 2-3 phrasings that look adjacent but shouldn't trigger (guards against over-triggering)

Keep these in your draft notes. They are not part of the shipped skill, but they prove the description field is calibrated. If a should-fire prompt doesn't visibly match the description, the description needs more "pushy" keywords. If a should-not-fire prompt does match, tighten the description.

## Optional Phase 8 — Description optimization

After the skill has been used ≥3 times, revisit the `description` field. If the agent had to be invoked manually each time, the description undertriggers — add keywords from the should-fire prompts. If unrelated invocations fired the skill, it overtriggers — narrow the description.

## Anti-Patterns

| Anti-pattern | Correction |
| --- | --- |
| Writing the skill before the intent capture | Phase 1 is cheap and prevents wasted Phase 3-6 work |
| Skipping evals before drafting | Anthropic's strongest rule. Without evals, the body solves imagined problems. |
| Skipping the prior-art scan because "I know what's there" | The Mall has 14k units. You don't know what's there. |
| Restating the five gates inside the new skill | Cross-link to `skill-review`. Single source of truth. |
| Bundling resources prematurely (empty `references/` folder) | Add a subfolder only when there's real content to put in it. Empty bundling is decoration. |
| Self-auditing without writing the verdict | The verdict template forces honesty. Skipping it lets fuzzy self-assessment slip through. |
| Author and dogfood in the same pass without a break | Read the draft cold. If you wrote it five minutes ago, you can't audit it fairly. |
| Vague description ("Helps with X") | Specific + trigger phrases. Description is the discovery field — no keywords = no discovery. |
| Too many alternatives in body ("use pypdf or pdfplumber or pymupdf") | One default + one escape hatch. Decision fatigue defeats the skill. |
| Deeply nested references (`SKILL.md → A.md → B.md → C.md`) | Keep references one level deep. Deeper nesting causes partial reads. |
| Reference file >100 lines without table-of-contents | Add a TOC block at the top. |
| Verbose explanations of what the model already knows | Ask "does this paragraph justify its token cost?" Cut if no. |
| Windows-style paths in scripts (`scripts\foo.cjs`) | Forward slashes always. |

## Falsifiability — Would Revise If

This skill's design has failed if any of the following occur within 90 days of stabilization:

- **Event-based**: ≥2 skills authored using this guide fail `skill-review` Gate 1 or Gate 2 on first self-audit (the phases didn't internalize the gates).
- **Date-based**: 2026-08-26 — if no new skills have been authored via this guide by that date, the skill is decorative, not load-bearing. Sunset this skill.

## Related

- [skill-review](../skill-review/SKILL.md) — the five gates this skill inverts (single source of truth)
- [instruction-creator](../instruction-creator/SKILL.md) — sibling for instructions
- [prompt-creator](../prompt-creator/SKILL.md) — sibling for prompts
- [agent-creator](../agent-creator/SKILL.md) — sibling for agents
- [meditation](../meditation/SKILL.md) — extracting patterns *from* session work into new skills
- [act-pass](../../instructions/act-pass.instructions.md) — required for medium-stakes skill authoring
