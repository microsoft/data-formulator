---
name: ai-memory-setup
description: "Detect, resolve, and manage the Alex_ACT_Memory shared memory bus. Fires on bootstrap, session start (announcements), and feedback writes."
lastReviewed: 2026-05-28
---

# AI-Memory Setup

Alex_ACT_Memory is a shared git repo (sibling clone at `../Alex_ACT_Memory`) where ACT heirs exchange feedback, announcements, knowledge, and profile data. This skill covers resolution, bootstrapping, and ongoing read/write operations.

## Resolution Algorithm (3-state)

The `_registry.cjs` script resolves the memory bus in this order:

1. **Sibling exists**: `../Alex_ACT_Memory/.git` is present → use it, pull updates (best-effort)
2. **Clone from remote**: sibling absent, remote URL configured → `git clone`
3. **Scaffold**: clone fails or no remote → create minimal local repo

Resolution always succeeds (scaffold is the floor). Heirs never need to configure cloud drives or pin paths.

## Folder Structure

```text
../Alex_ACT_Memory/
  README.md
  announcements/           # Fleet-wide release notes and guidance
    README.md
  feedback/                # Heir friction reports
    README.md
  knowledge/               # Shared knowledge packages
    index.json
    README.md
  profile/                 # Per-user profiles
    default/README.md
    <username>/user-profile.json
  insights/                # Analytical insights
  docs/
    MIGRATION.md           # OneDrive → git migration guide
```

## Operations

### Detect (session start)

On every session start, resolve the memory bus via `resolveMemoryBus(repoRoot)`. If found:

1. Check `announcements/` for unread files
2. Report any new announcements to the user (one line each)
3. Do NOT read or report feedback (that's the Supervisor's job)

If resolution fails completely (should not happen — scaffold is the floor): note silently, do not prompt.

### Bootstrap (first time)

Handled automatically by `bootstrap-heir.cjs`. The script calls `resolveMemoryBus(targetAbs)` which clones or scaffolds as needed. No user interaction required.

To manually resolve:

```bash
node .github/scripts/_registry.cjs --resolve .
```

### Write Feedback

When the heir observes friction worth surfacing:

1. Resolve memory bus
2. Write one markdown file to `feedback/`
3. Filename format: `YYYY-MM-DD-<heir-id>-<short-slug>.md`
4. Strip project specifics per `cross-project-isolation.instructions.md`
5. Commit and push (best-effort; push may fail without remote)

### Read Announcements

On session start (triggered by `greeting-checkin.instructions.md`):

1. Resolve memory bus
2. List files in `announcements/` (skip README.md)
3. For each unread file, report the title and date
4. Do NOT delete announcement files (they persist for all heirs)

### Profile

User profiles live at `profile/<username>/user-profile.json`. Read via `readProfile(memoryRoot)`, write via `writeProfile(memoryRoot, profile)`.

## Programmatic API (`_registry.cjs`)

| Function | Purpose |
| --- | --- |
| `resolveMemoryBus(repoRoot?)` | Returns `{ root, level, message }` — always succeeds |
| `scaffoldMemoryRepo(memoryPath)` | Creates minimal folder structure + git init |
| `readProfile(memoryRoot)` | Returns user profile object or null |
| `writeProfile(memoryRoot, profile)` | Writes profile + best-effort commit/push |

### CLI

```bash
node .github/scripts/_registry.cjs --resolve [dir]     # Resolve memory bus
node .github/scripts/_registry.cjs --profile [dir]     # Read user profile
```

## Migration from OneDrive-based AI-Memory

Users upgrading from Edition <3.0.0 need a one-time migration:

1. Clone `Alex_ACT_Memory` as a sibling: `git clone https://github.com/fabioc-aloha/Alex_ACT_Memory.git ../Alex_ACT_Memory`
2. Copy content from old `<cloud-drive>/AI-Memory/` to the new repo
3. Remove `ai_memory_root` and `ai_memory_exclude` from `cognitive-config.json`
4. Full guide: `../Alex_ACT_Memory/docs/MIGRATION.md`

## Anti-Patterns

| Anti-pattern | Correction |
| --- | --- |
| Hardcoding an absolute path to memory | Use `resolveMemoryBus()` — it handles all three states |
| Writing feedback without stripping project context | Always apply `cross-project-isolation` before writing |
| Reading feedback as a heir | Feedback is for the Supervisor; heirs read announcements only |
| Calling `scaffoldMemoryRepo` directly | Use `resolveMemoryBus()` which handles the full fallback chain |
| Expecting OneDrive/iCloud/Dropbox discovery | Removed in Edition 3.0.0; memory bus is git-only now |

## Falsifiability

- This skill has failed if heirs report memory bus resolution errors within 30 days of following the setup procedure
- The 3-state algorithm is wrong if `scaffoldMemoryRepo` produces repos that can't later accept a remote and sync
- The bootstrap sequence is stale if `_registry.cjs` exports change and this skill references obsolete functions
