---
name: ai-memory-setup
description: "Detect, resolve, and manage the Alex_ACT_Memory shared memory bus. Fires on bootstrap, session start (announcements), and feedback writes."
lastReviewed: 2026-07-11
---

# AI-Memory Setup

Alex_ACT_Memory is a local-first repo (sibling clone at `../Alex_ACT_Memory`) where ACT heirs exchange feedback, announcements, knowledge, and optional encrypted profile data. A remote is optional and sharing is the user's decision. This skill covers resolution, bootstrapping, and ongoing read/write operations.

## Resolution Modes

`resolveMemoryBus(repoRoot)` is read-only by default: it returns the existing
`../Alex_ACT_Memory` sibling or `null`. It does not pull, clone, or scaffold.

Explicit setup callers may pass `{ mutate: true }`, enabling this sequence:

1. **Sibling exists**: use it and pull updates (best-effort)
2. **Clone from remote**: sibling absent and remote configured → `git clone`
3. **Scaffold**: clone fails or no remote → create a minimal local repo

The mutation gate preserves user control. Session checks do not create a remote,
clone, scaffold, or pull merely because Memory was mentioned.

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
  profile/                 # Protected encrypted profiles
    <username>/user-profile.encrypted.json
  insights/                # Analytical insights
  docs/
    MIGRATION.md           # OneDrive → git migration guide
```

## Operations

### Detect (session start)

On session start, resolve the existing sibling via `resolveMemoryBus(repoRoot)`. If found:

1. Check `announcements/` for unread files
2. Report any new announcements to the user (one line each)
3. Do NOT read or report feedback (that's the Supervisor's job)

If the sibling is absent: note silently, do not prompt or create it.

### Bootstrap (first time)

Handled only when bootstrap setup enables Memory. `bootstrap-heir.cjs` calls
`resolveMemoryBus(targetAbs, { mutate: SETUP_MEMORY })`; cloning or scaffolding
therefore occurs only when the setup flag is true.

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

User profiles live at `profile/<username>/user-profile.encrypted.json`. Read on demand via `readProfile(memoryRoot, { projectRoot })`; write locally via `writeProfile(memoryRoot, profile, { projectRoot })`. Both resolve `ALEX_ACT_MEMORY_PASSWORD` from the process environment, an explicit file, the authorized project's local `.env`, then the sibling Memory clone's local `.env`.

Every `.env` must be ignored and untracked in the repository that owns it. Edition verifies ignore status before reading. Project values override Memory values. Missing authorization returns no profile; wrong passwords or tampering fail closed. Profile functions never commit or push. The user decides whether to synchronize the encrypted envelope.

Explicit workflows may call `readMemorySecret(memoryRoot, variableName, { projectRoot })` for one exact variable. The API never enumerates or imports Memory `.env`, mutates `process.env`, prints values, or runs during greeting. Use project-local overrides, VS Code SecretStorage, or an enterprise secret manager when all heirs on the machine should not share a secret.

## Programmatic API (`_registry.cjs`)

| Function | Purpose |
| --- | --- |
| `resolveMemoryBus(repoRoot?, options?)` | Returns the sibling or null by default; `{ mutate: true }` enables pull/clone/scaffold |
| `scaffoldMemoryRepo(memoryPath)` | Creates minimal folder structure + git init |
| `readMemorySecret(memoryRoot, variableName, options?)` | Returns one exact named local secret using process/explicit/project/Memory precedence |
| `readProfile(memoryRoot, options?)` | Decrypts an authorized profile on demand, or returns null when absent/unavailable |
| `writeProfile(memoryRoot, profile, options?)` | Writes an encrypted envelope locally and atomically; never commits or pushes |

### CLI

```bash
node .github/scripts/_registry.cjs --resolve [dir]     # Resolve memory bus
node .github/scripts/_registry.cjs --profile [dir]     # Check authorized profile availability without printing content
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
| Hardcoding an absolute path to memory | Use read-only `resolveMemoryBus()`; opt into mutation only during explicit setup |
| Writing feedback without stripping project context | Always apply `cross-project-isolation` before writing |
| Reading feedback as a heir | Feedback is for the Supervisor; heirs read announcements only |
| Calling `scaffoldMemoryRepo` directly | Use `resolveMemoryBus(..., { mutate: true })` during explicit setup |
| Expecting OneDrive/iCloud/Dropbox discovery | Removed in Edition 3.0.0; memory bus is git-only now |
| Assuming Memory must have a remote | Local-only is valid; configuring or sharing a remote belongs to the user |
| Keeping secrets in tracked files or copying them across heirs | Use exact-name lookup from an ignored project or Memory `.env`, SecretStorage, or an enterprise secret manager |
| Importing every Memory `.env` variable | Request one exact variable for one explicit operation |
| Automatically loading a profile on greeting | Decrypt only when an authorized workflow explicitly needs it |

## Falsifiability

- This skill has failed if heirs report memory bus resolution errors within 30 days of following the setup procedure
- The 3-state algorithm is wrong if `scaffoldMemoryRepo` produces repos that can't later accept a remote and sync
- The bootstrap sequence is stale if `_registry.cjs` exports change and this skill references obsolete functions
