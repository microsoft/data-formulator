---
description: "Consistent git practices, recovery patterns, and safe operations"
applyTo: "**/.*git*,**/.github/**"
lastReviewed: 2026-05-26
---

# Git Workflow

Consistent practices for version control operations.

## Activation

This instruction activates on git-related files. The skill (`.github/skills/git-workflow/SKILL.md`) contains:

- Commit message conventions
- Branch hygiene
- Recovery patterns (reset, revert, reflog)
- Safe operation checklists

## Quick Reference

### Commit Messages

```
type(scope): brief description

- Detailed change
- Another change
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Recovery Commands

| Situation | Command |
|-----------|---------|
| Undo last commit (keep changes) | `git reset --soft HEAD~1` |
| Undo last commit (discard changes) | `git reset --hard HEAD~1` |
| Find lost commit | `git reflog` |
| Undo pushed commit | `git revert <sha>` |

### Safety Rules

1. **Never force-push to shared branches** (main, develop)
2. **Commit before risky operations** (rebase, reset)
3. **Use `--dry-run` first** when unsure

## Would Revise If

Revise by **2026-08-26** (90 days) or sooner if any of the following fires:

- The recovery commands or safety rules fail to prevent ≥2 git mishaps (lost commits, force-push to shared, accidental hard-reset) within a quarter
- The conventional-commit type list (`feat`, `fix`, `docs`, etc.) drifts from heir/Edition practice ≥3 times in observed commits
- The `applyTo` glob misroutes (fires on non-git work or misses real git work) ≥2 times in a quarter
