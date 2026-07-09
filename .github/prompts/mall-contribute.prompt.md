---
description: "Propose a local skill for contribution to the Plugin Mall — strip project specifics, format as a Mall-compatible proposal, submit via feedback channel"
lastReviewed: 2026-05-31
---

# Contribute a Skill to the Plugin Mall

Propose a local skill (from `.github/skills/local/`) for inclusion in the Alex ACT Plugin Mall so other heirs can benefit from it.

## Steps

1. **Identify the candidate skill.** If the user named one, locate it under `.github/skills/local/`. If not, list local skills and ask which one to propose.

2. **Validate generalizability.** The skill must pass this test: "Would a brand-new heir on a completely different project find this useful on day 1?" If the skill is locked to one vertical, one framework, or one team's workflow, it belongs in `local/`, not the Mall.

3. **Strip project specifics** per `cross-project-isolation.instructions.md`:
   - Remove file paths with project structure (replace with generic descriptors)
   - Remove project/repo/product names (anonymize or omit)
   - Remove domain-specific identifiers (account IDs, ticket numbers)
   - Generalize niche tech references (`a vector database`, not `PineconeDB v3.2 on our staging cluster`)
   - Keep: skill/instruction names, categories, severity, abstract patterns, ACT references

4. **Rewrite into the Mall plugin layout.** Post-[ADR-008](https://github.com/fabioc-aloha/Alex_ACT_Supervisor/blob/main/docs/adrs/ADR-008-mall-self-curation.md) Phase 5a, the Mall reads plugin metadata from per-plugin frontmatter and surfaces it in `catalog/index.json` (schema 3.0) via the Mall's own self-curation pipeline — contributors do NOT author `plugin.json` or `CATALOG.json` entries directly. Produce two artifacts:

   **SKILL.md** — the generalized skill body with proper frontmatter. The Mall's catalog renderer reads these fields to populate the catalog entry:

   ```yaml
   ---
   name: <kebab-case-name>
   description: <one sentence: what it does AND when it fires>
   lastReviewed: <YYYY-MM-DD>
   ---
   ```

   The skill body follows the standard ACT skill structure (Trigger / Steps / Anti-patterns / Related).

   **README.md** — plain-language summary for human browsing:

   ```markdown
   # <Title>

   <2-3 sentence description of what the skill does and why it's useful.>

   ## Source

   Contributed from real project experience by an ACT-Edition heir.

   ## Skills

   - `SKILL.md` — <one-line summary>

   ## Install

   See `/mall-install <name>` (Phase 5b; manual install per [mall-installation.instructions.md](../instructions/mall-installation.instructions.md) until then).
   ```

   The Mall's self-curation pipeline (per [ADR-008](https://github.com/fabioc-aloha/Alex_ACT_Supervisor/blob/main/docs/adrs/ADR-008-mall-self-curation.md)) computes the catalog entry's `{ name, store, shape, trust_score, version, description_short, source_url, provenance, adapted_from }` fields from these two files. The Supervisor's editorial review (per `mall-curation` skill) decides whether the proposal lands in the curated `plugin-mall` store (provenance:true, +50 trust bonus) or gets routed elsewhere.

5. **Suggest a category** for the Mall maintainer to slot the plugin under. Use one of: `academic-research`, `ai-agents`, `architecture-patterns`, `cloud-infrastructure`, `code-quality`, `communication-people`, `converters`, `data-analytics`, `devops-process`, `documentation`, `domain-expertise`, `media-graphics`, `platform-tooling`, `reasoning-metacognition`, `security-privacy`, `supervisor-fleet`.

6. **Write the proposal to the feedback channel.** Create a markdown file at `../Alex_ACT_Memory/feedback/<YYYY-MM-DD>-mall-proposal-<name>.md` with this structure:

   ```markdown
   ---
   category: feature-request
   severity: low
   skill: mall-contribute
   date: <YYYY-MM-DD>
   ---

   # Mall Contribution Proposal: <Title>

   ## Summary

   <One paragraph: what the skill does, why it generalizes.>

   ## Suggested category

   <one of the 16 Mall categories listed above>

   ## Proposed README.md

   <paste>

   ## Proposed SKILL.md

   <paste>

   ## Generalizability Evidence

   - <Why this applies beyond the originating project>
   - <What class of tasks it serves>
   ```

7. **Report result.** Confirm the proposal was written and explain what happens next: the user's Supervisor (if running) or the user themselves will triage the proposal and decide whether to promote it to the Mall.

## Notes

- Resolve the shared memory bus via `resolveMemoryBus()` (sibling `../Alex_ACT_Memory`). CLI: `node .github/scripts/_registry.cjs --resolve .`
- If the memory bus is not set up, offer to run `/initialize` first.
- Never submit a skill that contains PII, credentials, or project-identifying information.
- The Supervisor evaluates proposals against the Mall's 5-dimension scorecard (maintenance, adoption, license, fit, documentation). Writing a quality proposal with clear generalizability evidence increases acceptance odds.
- Token cost estimate: count characters in the SKILL.md body, divide by 4.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
