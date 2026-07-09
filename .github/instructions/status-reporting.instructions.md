---
description: "Routing pointer to status-reporting skill — fires on status / report / update file patterns and delegates to the skill body. The skill itself owns the stakeholder templates and audience-adaptation discipline."
applyTo: "**/*status*,**/*report*,**/*update*"
lastReviewed: 2026-05-26
---

# Status Reporting

Routing-only instruction. The matching `applyTo` patterns trigger this file on status / report / update work; this file's job is to ensure the [status-reporting skill](../skills/status-reporting/SKILL.md) loads. The skill body carries every template and audience-fit rule.

If this instruction grows substantive always-on rules of its own, move them to the skill instead and keep this file as the routing trigger.

## Would Revise If

Revise by **2026-08-26** (90 days) or sooner if any of the following fires:

- The `applyTo` patterns fail to fire on real status-reporting work ≥2 times in a quarter
- This file accumulates substantive rules that should be in the skill (drift from routing-only purpose)
- The skill is retired or renamed without this routing pointer being updated
