---
description: "Consolidate session learning — extract new patterns into skills, instructions, prompts, or memory"
lastReviewed: 2026-05-26
---

# /meditate

Run the meditation protocol. Transform working memory into permanent architecture.

## Steps

1. Load skill: [meditation](../skills/meditation/SKILL.md)
2. **Review** the session — problems solved, mistakes made, patterns that emerged
3. **Extract** only what's *new and portable* — grep existing skills, instructions, and memory before writing anything
4. **Route** each pattern to the right artifact (skill / instruction / prompt / muscle / memory tier)
5. **Write** with concrete examples, correct frontmatter, and a trigger section
6. If session is ending, write a handoff to repo-root `HANDOFF.md`
7. Report what was persisted (and what was deliberately *not* persisted because it was already covered)
8. **Compact** — run `/compact` to discard transcript noise. The persisted artifacts are now the canonical record of this session. This is irreversible by design; consolidation succeeded, raw data is redundant.

## Anti-pattern guard

If after step 2 nothing new emerged, say so, then still run `/compact` at step 8. Routine execution is exactly what a session-end compact is for — the system working as intended is not a reason to skip the cleanup.

**Would revise if**: the [meditation](../skills/meditation/SKILL.md) skill changes its consolidation protocol, or the `/compact` step becomes optional. Re-evaluate 2026-08-26.
