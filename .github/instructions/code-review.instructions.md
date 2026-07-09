---
description: "Code review quality gate protocols and feedback guidelines"
applyTo: "**/*review*,**/*audit*,**/*pr*"
lastReviewed: 2026-05-26
---

# Code Review Guidelines Procedural Memory

---

Full protocol in `.github/skills/code-review/SKILL.md`.

## Quick Reference

1. **Catch bugs** before they reach users
2. **Improve code quality** through collaborative refinement
3. **Share knowledge** across the team
4. **Maintain consistency** in codebase style and patterns
5. **Document decisions** through review comments
| Reviewer                               | Author                         |
| -------------------------------------- | ------------------------------ |
| Assume positive intent                 | Be open to feedback            |
| Ask questions, don't demand            | Explain your reasoning         |
| Focus on the code, not the person      | Don't take feedback personally |
| Offer alternatives, not just criticism | Acknowledge good suggestions   |

## Would Revise If

Revise by **2026-08-26** (90 days) or sooner if any of the following fires:

- The dual-column reviewer/author table fails to defuse ≥2 contentious reviews in a quarter (the framing is too vague)
- code-review is invoked but reviewers bypass the table guidance ≥3 times (signal the instruction is decorative, not load-bearing)
- The `applyTo` glob (`**/*review*,**/*audit*,**/*pr*`) misroutes onto non-review work ≥2 times in a quarter (over-fire)
- The full protocol in the skill drifts such that this instruction's quick-reference contradicts it (re-sync or delete this file)
