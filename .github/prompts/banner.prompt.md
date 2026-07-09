---
description: "Generate a 1200×300 SVG banner for a document — title, subtitle, watermark category, on-brand for Alex — ACT Edition"
lastReviewed: 2026-05-26
---

# Banner

Generate an SVG banner for the top of a markdown document. Wraps the `generate-banner.cjs` muscle and the `alex-banner-generation` skill.

Skill: [alex-banner-generation](../skills/alex-banner-generation/SKILL.md). Muscle: `.github/skills/alex-banner-generation/scripts/generate-banner.cjs`.

## When to Use

- Adding a hero banner to a new README, PLAN, ROADMAP, or release artifact
- Branded section header for documentation sites
- Visual identity for a doc the user will share externally

## Watermark Categories (must pick one)

| Watermark | Use For |
| --- | --- |
| `ACT` | Critical-thinking artifacts, framework docs |
| `EDITION` | Edition-specific docs, release notes |
| `DOCS` | General documentation |
| `RELEASE` | CHANGELOG, release artifacts |
| `PLAN` | PLAN.md, roadmaps, design docs |
| `NOTE` | Working notes, drafts, session handoffs |

## Steps

1. **Pick the title** — ≤ 32 characters. Keep it punchy. Project name or doc category usually wins.
2. **Pick the subtitle** — ≤ 80 characters. One-line value statement (what the doc is FOR, not what it contains).
3. **Pick the watermark** from the table above. If unsure, pick `DOCS`.
4. **Choose output path** (default: `assets/banner-<slug>.svg`). Slug derived from title if omitted.
5. **Run**:

   ```sh
   node .github/skills/alex-banner-generation/scripts/generate-banner.cjs \
     --title "Project Name" \
     --subtitle "One-line value statement" \
     --watermark DOCS \
     --output assets/banner-readme.svg
   ```

6. **Embed in markdown**:

   ```markdown
   ![Project banner](assets/banner-readme.svg)

   # Project Name
   ```

7. **Verify** — open the SVG in browser or VS Code preview. Title should be readable, subtitle should not overflow, watermark should be in the right corner.

## Boundaries

- **Watermark whitelist is enforced.** Custom watermarks are rejected by the muscle. If you need a new category, add it to the muscle's `ALLOWED_WATERMARKS` list (governance change, not a per-banner choice).
- **No PNG conversion.** The muscle outputs SVG only. Convert to PNG with `npx svgexport` if needed (separate workflow).
- **Pastel-color variants live in the Mall.** If you need a non-Edition aesthetic (e.g. `document-banner-pastel`), install from the Plugin Mall -- don't shoehorn this muscle.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
