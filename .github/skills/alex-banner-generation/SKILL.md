---
name: "alex-banner-generation"
description: "Generate on-brand Alex — ACT Edition SVG banners for documents (READMEs, plans, notes, release artifacts)"
lastReviewed: 2026-05-26
---

# Alex Banner Generation

Generate visually consistent SVG banners for any document in this heir using the Alex — ACT Edition brand template.

## When to Use

- User asks for a banner, header image, or document decoration
- Creating a significant new document (README, PLAN-*.md, ROADMAP, CHANGELOG)
- User mentions adding a "header" or "branded image" to a doc

> **Looking for a lighter, hand-authored variant?** The Mall ships [`document-banner-pastel`](https://github.com/fabioc-aloha/Alex_Skill_Mall/blob/main/plugins/media-graphics/document-banner-pastel/SKILL.md) -- pastel 1200x240 banners with content-specific iconography (tracks / hub-and-spokes / mockup / badge / symbol). Use that pattern for branding, education, or audience-facing docs; use this muscle for technical artifacts that need brand-stamped consistency.

## Brand Constants (do not change)

| Element | Value |
|---|---|
| Dimensions | 1200 × 300 px |
| Background | `#0f172a` (Slate 900) |
| Accent bar | 4px wide, `#6366f1` (Indigo 500) |
| Series label | `ALEX · ACT EDITION` |
| Title | 56px / weight 700 / `#f1f5f9` |
| Subtitle | 18px / weight 600 / `#94a3b8` |
| Watermark | ~100px / weight 800 / `#f1f5f9` / 10% opacity |

## Watermark Categories

Pick the one that matches the document's role:

| Watermark | Use For |
|---|---|
| `ACT` | Critical-thinking content, ACT framework artifacts, manifestos |
| `EDITION` | Top-level repo identity (root README, ABOUT) |
| `DOCS` | User guides, tutorials, reference material |
| `RELEASE` | CHANGELOGs, release notes, version stamps |
| `PLAN` | Planning docs, roadmaps, milestone trackers |
| `NOTE` | Session notes, ad-hoc memos |

If no category fits, ask the user before inventing one — the muscle rejects unknown watermarks.

## Procedure

### Step 1 — Gather inputs

Ask the user only for what's missing. Defaults:

- **Title** — the document's name. Keep ≤ 32 chars (the muscle enforces this).
- **Subtitle** — a single-line purpose statement, ≤ 80 chars. Lift it from the doc's first paragraph or its north-star sentence; don't invent.
- **Watermark** — pick from the table above based on doc role.
- **Filename** — defaults to `assets/banner-<title-slug>.svg`. Override with `--out` if the user wants a specific path.

### Step 2 — Generate

```sh
node .github/skills/alex-banner-generation/scripts/generate-banner.cjs \
  --title "Document Title" \
  --subtitle "One-line purpose statement." \
  --watermark PLAN
```

Add `--force` to overwrite an existing file. Add `--out path/to/banner.svg` for a non-default location.

The muscle exits 0 on success, 1 on validation errors (length, watermark whitelist), 2 on filesystem errors (file exists without `--force`).

### Step 3 — Embed in the document

Add this line just under the document's H1:

```markdown
![Banner](assets/banner-<slug>.svg)
```

The muscle prints the exact embed line; copy it verbatim.

## Subtitle Craft (the LLM-judgment part)

The muscle takes whatever subtitle you pass — quality is your job. Good subtitles:

- State the document's **purpose**, not its contents (`"Critical thinking made operational."` not `"This document explains ACT."`)
- Are one clause, not a sentence list
- End with a period
- Avoid hype ("revolutionary", "ultimate") and meta language ("this document")
- Match the document's actual first paragraph — don't promise things the doc doesn't deliver

If you're not sure the subtitle is right, show two options to the user before generating.

## Validation Checklist

Before declaring done:

- [ ] File written under `assets/`
- [ ] Watermark matches the document's role (not just convenient)
- [ ] Title ≤ 32 chars, subtitle ≤ 80 chars (else the muscle rejects)
- [ ] Embed line added under the document's H1
- [ ] Renders in VS Code preview without errors

## PNG Conversion (optional)

GitHub renders SVG banners natively in `README.md` and most surfaces, so SVG is preferred. If a downstream tool needs PNG:

```sh
# Via mermaid-cli's bundled chrome (already a dependency):
npx svgexport assets/banner-foo.svg assets/banner-foo.png 1200:300
```

Don't ship PNGs unless required — they double the asset weight and can drift from the SVG source.

## Boundaries

- The muscle does not pick the watermark or write the subtitle — that is an LLM/skill judgment call.
- The muscle does not edit the source markdown — embedding the banner in the doc is a separate step.
- Custom colors / fonts / dimensions are not supported. If the user wants a non-template design, generate raw SVG manually rather than forking the muscle.

## Falsifiability

Revisit this skill by **2026-08-26** (90 days) or sooner if any of the following fires:

- Banners shipped via this skill are aesthetically rejected by the user ≥3 times in a quarter
- The SVG pipeline renders incorrectly in >10% of target environments (GitHub, VS Code preview, browsers) over any 30-day window
- The muscle adds new template categories without a corresponding entry being added to this skill within the same change
- Users request customization the skill forbids (custom colors/fonts/dimensions) ≥3 times in a quarter — signal the brand constants are too tight
