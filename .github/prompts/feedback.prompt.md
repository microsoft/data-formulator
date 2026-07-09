---
description: "File feedback to the user (and their Supervisor, if any) via the shared memory bus — guided through stripping rules and file naming"
lastReviewed: 2026-05-29
---

# Feedback

Capture friction, bugs, feature ideas, or success notes from this session and write them to `../Alex_ACT_Memory/feedback/` so they propagate to the user (and their Supervisor, if they run one).

## Steps

1. **Ask the user what to surface** — bug, friction, feature request, or success. Capture the gist in their own words.
2. **Classify**:
   - `category`: `bug` | `friction` | `feature-request` | `success`
   - `severity`: `low` | `medium` | `high` | `critical`
   - `skill`: name of the skill if specific to one, otherwise empty
3. **Resolve the shared memory bus** via `resolveMemoryBus()` (sibling `../Alex_ACT_Memory`). CLI: `node .github/scripts/_registry.cjs --resolve .`. If the sibling doesn't exist, it will be cloned or scaffolded automatically.
4. **Strip per `cross-project-isolation.instructions.md`** before writing:
   - No file paths from the heir project
   - No client names, domain entities, or business specifics
   - No code snippets longer than 5 lines
   - No configuration values, connection strings, endpoints
   - No PII (contact info, names + identifiers, health/financial data)
5. **Write the file** at `../Alex_ACT_Memory/feedback/YYYY-MM-DD-<heir-id>-<short-slug>.md` with frontmatter:

   ```yaml
   ---
   heir_id: <from .github/.act-heir.json>
   edition_version: <from marker>
   date: <today ISO date>
   category: <classification>
   severity: <classification>
   skill: <skill-name-or-empty>
   ---
   ```

   Body sections (only these two):

   ```markdown
   ## What happened
   <abstract description, no project specifics>

   ## Expected behavior
   <what should have happened>
   ```

6. **Confirm** the file path back to the user. Note that if they have no Supervisor, this serves as a personal log they can review later.

## Refuse if

- The feedback requires project-specific context to make sense after stripping (ask the user to abstract the pattern)
- The marker (`.github/.act-heir.json`) is missing — bootstrap is incomplete

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
