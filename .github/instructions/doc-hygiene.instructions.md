---
description: "Routing pointer to doc-hygiene skill — fires on doc-audit / doc-quality / drift / hygiene file patterns and delegates to the skill body. The skill itself owns the anti-drift rules, count elimination, and living-document maintenance protocol."
applyTo: "**/*doc*audit*,**/*doc*quality*,**/*drift*,**/*hygiene*"
lastReviewed: 2026-05-26
---

# Doc Hygiene

Routing-only instruction. The matching `applyTo` patterns trigger this file on doc-audit / doc-quality / drift / hygiene work; this file's job is to ensure the [doc-hygiene skill](../skills/doc-hygiene/SKILL.md) loads. The skill body carries every rule.

If this instruction grows substantive always-on rules of its own, move them to the skill instead and keep this file as the routing trigger.

## Would Revise If

Revise by **2026-08-26** (90 days) or sooner if any of the following fires:

- The `applyTo` patterns fail to fire on real doc-hygiene work ≥2 times in a quarter (description-match discovery alone proves insufficient)
- This file accumulates substantive rules that should be in the skill (drift from routing-only purpose)
- The skill is retired or renamed without this routing pointer being updated
