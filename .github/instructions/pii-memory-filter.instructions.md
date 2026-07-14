---
description: "PII filter at memory write boundaries — prevent sensitive data from entering persistent storage tiers"
applyTo: "**"
lastReviewed: 2026-07-11
---

# PII Memory Filter

**Always-on rationale**: persistent-storage writes can happen on any turn (memory tool, file creation, announcement). The PII filter must fire before every write boundary regardless of the surrounding context; a scoped glob would let writes from non-matching contexts bypass the check.

Always-active unconscious behavior. Self-monitor before every write to persistent storage.

## Write Boundaries

This filter applies whenever you write to ANY persistent tier:

| Tier | Write Mechanism | Auto-Loaded? |
|------|-----------------|--------------|
| User Memory | `memory create /memories/` | Yes (200 lines) |
| Repo Memory | `memory create /memories/repo/` | No |
| Session Memory | `memory create /memories/session/` | No |
| Shared Memory | File creation in `../Alex_ACT_Memory/` | No |
| Feedback | File creation in `../Alex_ACT_Memory/feedback/` | No |

For tier *selection* (where content goes), see [memory-triggers.instructions.md § Memory Tier Selection](memory-triggers.instructions.md). This filter constrains *what* may be written; MT constrains *where*.

## Never Write These Categories

Before writing to ANY persistent tier, verify the content does NOT contain:

| Category | Examples | Risk |
|----------|----------|------|
| **Contact info** | Phone numbers, email addresses, physical addresses | L3 identity exposure |
| **Date of birth** | DOB, age calculations, birth year | L3 identity exposure |
| **Health data** | Diagnoses, medications, symptoms, lab values, provider names | L4 — no memory tier is appropriate |
| **Financial data** | Account numbers, balances, income, SSN, tax IDs | L4 — no memory tier is appropriate |
| **Credentials** | API keys, tokens, passwords, connection strings | L4 — use SecretStorage only |
| **File paths with usernames** | `C:\Users\username\...` | L2 identity leakage |
| **Client names** | Employer clients, project clients in fleet context | L3 confidential business data |

## Allowed Content Per Tier

| Tier | Allowed | Not Allowed |
|------|---------|-------------|
| **User Memory** | Workflow preferences, communication style, tool patterns | Any PII, project-specific data |
| **Repo Memory** | Build commands, code conventions, architecture facts | Credentials, user identity |
| **Session Memory** | Task context, file references, in-progress state | Health data, financial data |
| **Shared memory knowledge** | Patterns, insights, technical knowledge | Contact info, health data |
| **Shared memory announcements** | Upgrade notices, breaking changes | No PII by design |
| **Shared memory feedback** | Skill name + category + severity (structured schema only) | Free-text context with domain data |

## Self-Check Protocol

Before writing to persistent storage, ask:

1. **Would I be comfortable if this appeared in a GitHub issue?** If no → don't write it.
2. **Does this contain a name + another identifier?** Name alone is L2. Name + phone/DOB/health = L3/L4.
3. **Is this about the person or about the work?** Work patterns are fine. Personal attributes are not.

## If PII Is Requested

When the user asks to store something containing PII:

- **Contact info** → With user approval, store only in `../Alex_ACT_Memory/profile/<username>/user-profile.encrypted.json` (L3, encrypted, on-demand only, never auto-loaded)
- **Health data** → Decline. Explain no memory tier is appropriate for L4 health data.
- **Credentials** → Direct to VS Code SecretStorage or environment variables
- **Work patterns** → Generalize: "prefers TDD" not "wrote 47 tests on Tuesday"

## Would Revise If

Revise if the never-write list catches PII so rarely that the cost of the always-on filter exceeds its protection value, if the per-tier allowed/not-allowed table has obvious gaps in real PII categories arising in heir work, or if a documented PII leak occurs through a category the filter should have caught (post-mortem the gap, then extend the table).
