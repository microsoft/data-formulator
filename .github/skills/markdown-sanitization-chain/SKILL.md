---
name: "markdown-sanitization-chain"
description: "Render user-supplied markdown safely — marked.js → DOMPurify → Mermaid (order matters; skipping the sanitizer is XSS)"
lastReviewed: 2026-05-26
---

# Markdown Sanitization Chain

> Battle-tested via production XSS incident. The order of markdown → sanitize → diagram render is non-negotiable when content comes from users.

## When to Use

- An app renders markdown supplied by users (comments, docs UI, embedded editors)
- You're about to call `innerHTML` with markdown-derived HTML
- Mermaid or another diagram renderer runs in the browser
- Security review on a markdown-rendering surface

## Why It Matters

Markdown renderers (marked.js, markdown-it) convert markdown to HTML but **do not sanitize it**. Diagram renderers (Mermaid, PlantUML) execute after sanitizers run, which can re-introduce attack vectors. Order matters critically.

## The Rule

**Always: marked.js → DOMPurify → Mermaid (post-render).**

```text
1. Parse markdown to HTML        (marked.js)
2. Sanitize HTML                 (DOMPurify)
3. Insert sanitized HTML into DOM
4. Render diagrams on the now-sanitized DOM (Mermaid.run())
```

Never skip the sanitizer even if content is "trusted." Trust gets revoked when the threat model changes; the chain stays.

## Implementation

```javascript
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import mermaid from 'mermaid';

async function renderMarkdown(content, container) {
  // Step 1: parse markdown to HTML
  const rawHtml = marked.parse(content);

  // Step 2: sanitize BEFORE inserting into the DOM
  const cleanHtml = DOMPurify.sanitize(rawHtml, {
    ADD_TAGS: ['mermaid'], // allow mermaid tags through
  });

  // Step 3: insert sanitized HTML
  container.innerHTML = cleanHtml;

  // Step 4: render diagrams on sanitized DOM
  await mermaid.run({ nodes: container.querySelectorAll('.mermaid') });
}
```

## Common Mistakes

| Mistake | Consequence |
|---------|-------------|
| Skip DOMPurify ("it's internal content") | XSS from any content source |
| Sanitize after Mermaid renders | Mermaid-injected scripts execute |
| Use `innerHTML` without sanitization anywhere | Classic XSS |
| Trust localStorage / URL params | User-controlled XSS payloads |

## DOMPurify Configuration

```javascript
const config = {
  ADD_TAGS: ['mermaid'],            // preserve diagram tags
  ADD_ATTR: ['onclick'],            // only if absolutely needed
  FORBID_TAGS: ['style', 'script'], // explicit blocklist
  FORBID_ATTR: ['onerror', 'onload'],
};
```

## Verification Checklist

- [ ] Markdown parser runs first
- [ ] DOMPurify runs before DOM insertion
- [ ] Diagram renderer runs after sanitization
- [ ] No raw `innerHTML` without sanitization anywhere in the surface
- [ ] Tested with `<img src=x onerror=alert(1)>` payload

## Related

- [markdown-mermaid](../markdown-mermaid/SKILL.md) — markdown + Mermaid style guide
- [markdown-mermaid § Mode Fragility](../markdown-mermaid/SKILL.md) — silent render failures
- [lint-clean-markdown](../lint-clean-markdown/SKILL.md) — author-side hygiene

## Would Revise If

Revisit this skill by **2026-08-26** (90 days) or sooner if any of the following fires: DOMPurify or marked.js publishes a breaking change that invalidates the documented chain order; a real XSS payload bypasses the chain in production use; or Mermaid changes its render-time HTML interface in a way that makes the post-sanitization step unsafe.
