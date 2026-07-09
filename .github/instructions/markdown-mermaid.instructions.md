---
description: "Markdown and Mermaid — author markdown, render diagrams, prevent silent failures, lint clean, sanitize user content"
applyTo: "**/*.md,**/*mermaid*"
lastReviewed: 2026-04-30
---

# Markdown & Mermaid — Routing

Multiple skills cover this domain. Pick the one that matches the work — they don't overlap.

| When working on | Use |
|---|---|
| Authoring markdown, choosing a diagram type, GitHub Pastel palette, ATACCU workflow | [markdown-mermaid](../skills/markdown-mermaid/SKILL.md) |
| Mermaid renders blank or garbled (timeline / gitGraph / gantt with colons) | [markdown-mermaid § Mode Fragility](../skills/markdown-mermaid/SKILL.md) |
| Writing markdown that has to pass `markdownlint` on first attempt | [lint-discipline.instructions.md](lint-discipline.instructions.md) |

`markdown-mermaid` is the primary reference (including the Mode Fragility section). For lint discipline see `lint-discipline.instructions.md`.

## Would Revise If

Revise if the When-Working-On routing table produces consistent misroutes (wrong skill fires for the actual work), if the `markdown-mermaid` skill body ceases to be the primary reference because newer renderer behavior outpaces it, or if Mermaid renderer updates invalidate the Mode Fragility gotchas the skill documents.
