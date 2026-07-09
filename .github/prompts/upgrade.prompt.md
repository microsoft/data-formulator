---
description: "Pull the latest Edition into this heir — apply directly, summarize, surface notable changes"
lastReviewed: 2026-05-26
---

# Upgrade

Run `upgrade-self.cjs --apply` and report what changed. The script uses an atomic backup-install-recover strategy: it renames `.github/` to a dated backup, installs a fresh Edition brain, then recovers heir-owned files into their original paths. This eliminates partial-sync corruption. Apply, then summarize.

## Steps

1. **Verify heir** — confirm `.github/.act-heir.json` exists. If not, refuse and suggest bootstrap.

2. **Apply** — execute directly:

   ```bash
   node .github/scripts/upgrade-self.cjs --apply
   ```

   Capture stdout/stderr.

3. **If the script refuses** — handle the known cases:
   - **Major bump**: stop, surface the version jump (e.g., `0.x → 1.x`), and ask the user if they want to re-run with `--allow-major`. Do NOT add `--allow-major` automatically.
   - **Backup already exists**: tell the user to remove the `.github-backup-YYYYMMDD/` directory and retry.
   - **Refusal for any other reason** (downgrade, missing marker, clone failure): stop and surface the script's error.

4. **Summarize the result** in plain English:
   - **Version bump**: current → new
   - **Heir-owned files recovered**: N (these are local/ artifacts, `.act-heir.json`, episodic memory, etc.)
   - **Relocated to local/**: N (heir-added artifacts that lived in Edition-owned paths, now moved to `local/` so future upgrades don't clobber them)
   - **Backup location**: `.github-backup-YYYYMMDD/`

5. **Surface anything notable**:
   - If any heir-owned files failed to recover (count mismatch between "to recover" and "recovered"), flag as a problem
   - If relocations happened, list them so the user knows their files moved paths
   - Remind the user the backup directory exists and can be deleted once satisfied

6. **Stage but do NOT commit** — show `git status` and let the user pick the commit message. Suggest: `chore: upgrade to Alex_ACT_Edition vX.Y.Z`.

## Refuse if

- Major bump without explicit user consent (the script enforces this; don't bypass it)
- The script reports heir-owned files under `local/` were not recovered (recovery failure is a bug)

## Why apply-first instead of dry-run-then-confirm?

The script's own safeguards (heir-owned recovery, backup before overwrite, major-bump gate, downgrade refusal) already make it safe. Dry-run adds friction without safety. Apply directly, then summarize. If the user disagrees with what landed, the backup directory is right there for manual recovery, and `git checkout -- .github/` restores the git-tracked state.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
