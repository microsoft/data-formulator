---
description: "Audit installed Mall plugins for upstream drift, then update or remove with explicit user consent"
lastReviewed: 2026-06-10
---

# /mall-refresh

Audit this heir's installed Mall plugins for upstream drift, then apply updates and removals only after explicit consent.

Per [PLAN-mall-automation v3 / ADR-008](https://github.com/fabioc-aloha/Alex_ACT_Supervisor/blob/main/docs/adrs/ADR-008-mall-self-curation.md), the Mall catalog has a `(store, name, version)` identity. The drift script matches local plugins against `(store, name)` and reports version skew, deprecation, or unmanaged status.

## Steps

1. **Run the mechanical drift check**:

   ```bash
   node .github/scripts/audit-mall-drift.cjs --json
   ```

   The script finds the catalog automatically: sibling `../Alex_Skill_Mall/` first, then `~/Alex_Skill_Mall/`, then `~/Development/Alex_Skill_Mall/` (Mac/Linux), then `C:/Development/Alex_Skill_Mall/` (Windows), then the GitHub raw HTTPS fallback. Pass `--no-network` to disable the HTTPS fallback if the heir is offline by policy. Pass `--catalog=<path>` to override discovery.

2. **If no actionable drift** (`UPDATED_UPSTREAM`, `DEPRECATED_UPSTREAM`, `UNMANAGED_LOCAL_PLUGIN` all zero):
   - Report "all local Mall plugins are in sync" and stop.

3. **Summarize the proposed actions** from the JSON report's `rows[]`:
   - `IN_SYNC`: plugin matches upstream version (informational, no action).
   - `UPDATED_UPSTREAM`: upstream has a newer version than the heir's recorded `version_at_install`. Refer to `version_upstream` and `source_url` for the fetch target.
   - `DEPRECATED_UPSTREAM`: plugin (store, name) is no longer in the catalog; candidate for removal.
   - `UNMANAGED_LOCAL_PLUGIN`: local folder without `.install.json` or `plugin.json`, OR a legacy `plugin.json` whose name appears in multiple stores without disambiguation. Manual review needed.

4. **Ask for explicit approval before any write**:
   - Updates: ask once for batch approval (list all `UPDATED_UPSTREAM` plugins with their `<old> -> <new>` version deltas).
   - Removals: ask per plugin name. Never remove in bulk without explicit yes.

5. **If approved, apply updates for each `UPDATED_UPSTREAM` plugin**:
   - The drift report carries `source_url` (a GitHub tree URL pinned to the upstream SHA at the new version).
   - Refresh the plugin's artefacts from that source per the install path convention in [mall-installation.instructions.md](../instructions/mall-installation.instructions.md). For each shape (skill / instruction / prompt / agent), overwrite the heir's `local/<name>/` files with the upstream content.
   - Rewrite `.install.json` to record the new `version_at_install`, `source_url`, and `installed_at` timestamp. This becomes the new drift baseline.

6. **If approved, remove each `DEPRECATED_UPSTREAM` plugin**:
   - Delete the plugin directory under `.github/skills/local/<name>/` (and any instruction / prompt / agent siblings the plugin installed per its README).
   - If the plugin's README does not document install paths, ask the user before deleting only the skills directory.

7. **Handle `UNMANAGED_LOCAL_PLUGIN` safely**:
   - Do NOT delete automatically.
   - If the `delta` field says "appears in N stores", surface the candidate stores from the catalog and ask the user to add `"store": "<store-name>"` to the local `plugin.json` (or recreate it as `.install.json`).
   - Otherwise treat as custom local content and ask whether to keep or remove.

8. **Re-run the drift check** and report the final state:

   ```bash
   node .github/scripts/audit-mall-drift.cjs
   ```

   All previously-flagged rows should now be `IN_SYNC` (or absent, for the removals).

## Falsifiability

- The script's `--catalog` discovery order is wrong if heirs consistently clone the Mall to a path the script doesn't try; surface real reports and extend the discovery list.
- The `(store, name)` identity is wrong if the same plugin needs separate identity per `version` (multi-version-installed) — re-evaluate when `/mall-install` ships and exposes pin-multiple workflows in Phase 5b.
- The HTTPS fallback assumption is wrong if heirs run in air-gapped environments by default; add a config switch to make `--no-network` the default in those environments.
