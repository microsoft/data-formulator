---
description: "Knowledge consolidation — transform working memory into permanent architecture"
applyTo: "**/*meditat*,**/*consolidat*"
lastReviewed: 2026-05-29
---

<!-- intentional divergence from Supervisor: Edition omits the "Quarterly Retraining Integration" section — quarterly retraining ADRs are a Supervisor-curator activity, not heir work. Heirs run per-session meditation; quarterly ADRs live in Supervisor's docs/adrs/. Audited 2026-05-29. -->

# Meditation Protocol

Consolidate learning into permanent architecture. Transform session insights into durable knowledge.

## When to Meditate

- End of significant work session
- After solving a hard problem with reusable insights
- When user says "let's meditate" or "consolidate what we learned"
- Before long breaks from a project

## The Ritual

### 1. Review — What happened?

Scan the session:

- What problems did we solve?
- What mistakes did we make?
- What patterns emerged?
- What would help future sessions?

### 2. Extract — What's worth keeping?

| If pattern is... | Create |
|------------------|--------|
| Reusable domain knowledge | Skill (`.github/skills/*/SKILL.md`) |
| Always-on behavior | Instruction (`.github/instructions/*.instructions.md`) |
| Automatable task tied to one skill | Script in that skill's folder (`.github/skills/<skill>/scripts/<name>.cjs`) |
| Cross-cutting automation (used by multiple skills) | Script (`.github/scripts/<name>.cjs`) |
| Shared library code (imported by other scripts) | Library module (`.github/scripts/shared/<name>.cjs`) |
| Repeatable workflow | Prompt (`.github/prompts/*.prompt.md`) |
| User preference | User memory (`/memories/`) |
| Project convention | Repo memory (`/memories/repo/`) |

### 3. Write — Persist the knowledge

For skills and instructions:

- Use proper frontmatter (description, applyTo for instructions; name + description for skills; `lastReviewed` always)
- Include concrete examples, not just abstractions
- Add tables with real data (thresholds, trade-offs)
- Avoid the "capabilities list" anti-pattern

### 4. Chronicle — Record the session

Write to `.github/episodic/meditation-YYYY-MM-DD-<topic>.md`:

```markdown
# Meditation: <Topic>

**Date**: YYYY-MM-DD
**Session focus**: What we worked on
**Duration**: Approximate

## What We Accomplished
- [Key outcomes]

## Patterns Extracted
- [What became skills/instructions]

## Lessons Learned
- [Insights worth remembering]

## Open Questions
- [What remains unresolved]
```

### 5. Handoff — Enable session continuity

Write explicit state snapshot at session end to repo-root `HANDOFF.md`:

```markdown
# Session Handoff

Last updated: YYYY-MM-DD HH:MM

### State
- **In progress**: [What we were working on]
- **Blocked by**: [Any blockers or waiting items]
- **Next action**: [Specific next step]

### Context to reload
- [Key files to read]
- [Decisions made this session]
- [User preferences learned]
```

At session start, read the most recent meditation and surface: *"Last session we were working on X, blocked by Y. Ready to continue?"*

### 6. Post-Mortem — Learn from failures

When something went wrong, write structured analysis:

```markdown
## Failure Post-Mortem

### What happened
[Concrete description of the failure]

### Root cause
[The actual reason, not the symptom]

### Pattern
[The generalizable mistake type]

### Prevention
[How to avoid this class of error]
```

Tag failures in the chronicle for retrieval: `#failure #<category>`

## Quality Bar

A meditation is complete when:

- [ ] Key patterns are persisted (not just acknowledged)
- [ ] Chronicle captures session narrative
- [ ] Session handoff enables continuity
- [ ] Failures are analyzed, not just noted
- [ ] INDEX.md updated with new entries
- [ ] Future Alex can pick up where we left off
- [ ] No important insight lives only in context window

## Would Revise If

- Meditation rituals produce no actionable insights (skill extraction, pattern recognition, or architectural decisions) over a 90-day window
- Chronicles accumulate without being referenced in subsequent sessions (write-only knowledge)
- The time investment shows no measurable improvement in session continuity or decision quality
