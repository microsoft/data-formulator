---
description: "Initialize this workspace as an ACT heir — bootstrap the brain or finish a partial install (path-1 quick register)"
lastReviewed: 2026-05-26
---

# Initialize

Make this workspace a registered ACT heir. Detects the workspace state and runs the right path: full bootstrap on a fresh repo, quick-register when Edition content is already present but the marker is missing.

The marker (`.github/.act-heir.json`) is the *only* file that makes a repo a heir. Without it, fleet-inventory won't see this repo and `upgrade-self.cjs` will refuse to run.

## State Detection

Before any writes, classify the workspace:

| State | Signal | Path |
|---|---|---|
| **A — Fresh** | No `.github/` directory at all | Full bootstrap |
| **B — Edition content, no marker, clean** | `.github/copilot-instructions.md` exists, no `.act-heir.json`, no local modifications to Edition-owned files | Full bootstrap (safe overwrite) |
| **C — Edition content, no marker, dirty** | Same as B but at least one Edition-owned file is locally modified per git | Quick register (path-1: copy only missing files + render marker) |
| **D — Already a heir** | `.github/.act-heir.json` exists | Refuse, suggest `/upgrade` |

To detect dirty state in B vs C: run `git status --porcelain .github/` and check whether any reported files match the `EDITION_OWNED` globs inlined in `.github/scripts/_registry.cjs`.

## Inputs to Gather

1. **Edition checkout location**. Look in this order:
   - `/tmp/edition/.github/scripts/bootstrap-heir.cjs`
   - `~/Development/Alex_ACT_Edition/.github/scripts/bootstrap-heir.cjs`
   - Any sibling directory of the current workspace named `Alex_ACT_Edition`
   - If none found, ask the user to run:

     ```bash
     git clone --depth 1 https://github.com/fabioc-aloha/Alex_ACT_Edition.git /tmp/edition
     ```

2. **`heir-id`**. Derive from `git remote get-url origin` (slug after the last `/`, strip `.git`). If no remote, ask the user. Validate: lowercase alphanumeric + hyphens, 2–64 chars.

3. **`heir-name`** (optional, defaults to `heir-id`). Ask once if it differs.

4. **`repo-url`** (optional). Read from git remote.

5. **`owner`** (optional). Parse from `repo-url` (the part before the slug for github.com URLs).

## Path A or B — Full Bootstrap

```bash
node <edition-path>/.github/scripts/bootstrap-heir.cjs \
  --target . \
  --heir-id <slug> \
  --heir-name "<display name>" \
  --repo-url <url> \
  --owner <handle>
```

1. Run dry-run first (omit `--apply`). Summarize: file count, marker fields.
2. Confirm with user.
3. Re-run with `--apply`.
4. Run `node .github/skills/greeting-checkin/scripts/heir-doctor.cjs` -- must exit 0.
5. **Shared memory**: The bootstrap script auto-resolves the `Alex_ACT_Memory` sibling repo (clone or scaffold). If it reports a scaffold, suggest the user clone the shared memory repo:
   - Run: `git clone https://github.com/fabioc-aloha/Alex_ACT_Memory.git ../Alex_ACT_Memory`
   - Or verify resolution: `node .github/scripts/_registry.cjs --resolve .`
6. Stage but do NOT commit. Suggest commit message: `chore: bootstrap as Alex_ACT_Edition heir`.

## Path C — Quick Register (path-1)

The workspace already has Edition content with local modifications. Running the bootstrap script directly would silently overwrite those modifications. Instead:

1. **Inventory what's missing**. For each path in Edition's `EDITION_OWNED` globs (inlined in `.github/scripts/_registry.cjs`), check whether it exists in the target. Build the missing-files list.

2. **Inventory what's diverged**. For each path that exists in both, hash both copies. Files that differ are heir-modified Edition content — they will be silently clobbered on the next `upgrade-self.cjs --apply`. List them.

3. **Render the marker** at `.github/.act-heir.json` with `notes` set to:

   > Registered retroactively (path-1 quick register). N edition-owned files diverge locally and will be overwritten on next upgrade-self. Move heir-specific content into `local/` overlays before upgrading.

4. **Copy only the missing files** from Edition into the target. Do not touch existing files.

5. Run `node .github/skills/greeting-checkin/scripts/heir-doctor.cjs` — must exit 0.

6. Stage but do NOT commit. Suggest commit message: `chore: register as ACT heir (path-1 quick register)`.

7. Surface the divergence list to the user with a clear next step: *"These N files are locally modified copies of Edition-owned content. Before your next `/upgrade`, move heir-specific changes into `local/` overlays. Otherwise the next upgrade will silently overwrite them."*

## Path D — Already a Heir

Refuse. Read `.github/.act-heir.json` and report `heir_id` + `edition_version`. Direct the user to `/upgrade` instead.

## Pre-flight Checks (all paths except D)

- Workspace is a git repo (`.git/` exists). If not, suggest `git init` first so `heir-id` can be derived from the remote.
- No active merge or rebase (`git status` shows clean state machine). If mid-conflict, refuse and ask user to resolve first.
- Working tree state (clean vs. dirty) is established before any writes — needed to distinguish path B from path C.

## Refuse if

- The marker already exists (path D).
- The user explicitly disagrees with the chosen path after seeing the dry-run summary.
- Edition checkout cannot be located and the user declines to clone it.
- `heir-id` cannot be derived and the user does not provide one.

## Anti-patterns

- **Don't run bootstrap blindly on path C**. The script overwrites without checking — losing the user's local modifications silently.
- **Don't skip the divergence list on path C**. The whole point of path-1 is *acknowledged* migration debt, not hidden debt.
- **Don't auto-commit**. Bootstrap is a meaningful event; the user picks the message and timing.
- **Don't normalize line endings or run formatters during install**. The bootstrap script handles file copy verbatim; downstream tools will adjust on first edit.

## Why a single prompt for four states?

The states are mechanically distinct (different commands, different safety rails) but operationally one question: *"make this workspace a heir."* Splitting into `/bootstrap` and `/quick-register` would force the user to diagnose state before invoking — that's the prompt's job.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
