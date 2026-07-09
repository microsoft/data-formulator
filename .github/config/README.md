# `.github/config/`

Brain-runtime configuration files. Read by always-on instructions and slash prompts.

## Ownership

| File | Owner | Behavior on upgrade | Read by |
|------|-------|---------------------|---------|
| `edition-manifest.json` | Edition | Overwritten | `.github/scripts/build-edition-manifest.cjs` (generator), `.github/scripts/upgrade-self.cjs`, `.github/skills/greeting-checkin/scripts/heir-doctor.cjs` |
| `welcome-baseline.json` | Edition | Overwritten | `.github/prompts/configure-vscode.prompt.md`, `.github/prompts/configure-vscode-verify.prompt.md` |
| `heir-workspace-settings-baseline.json` | Edition | Overwritten (per-key applied to heir `.vscode/settings.json` via merger) | `.github/scripts/shared/workspace-settings-merger.cjs`, called by `.github/scripts/bootstrap-heir.cjs` (init) and `.github/scripts/upgrade-self.cjs` (upgrade) |
| `cognitive-config.json` | Heir | First-installed, then frozen | `knowledge-coverage.instructions.md` (e.g. `showConfidenceBadge`), `feedback.prompt.md`, `initialize.prompt.md`, `mall-contribute.prompt.md`, `.github/scripts/_registry.cjs` (shared memory bus resolution) |
| `README.md` | Edition | Overwritten | This file |

## How the workspace-settings merger applies the heir baseline

`.vscode/settings.json` itself is `HEIR_OWNED` — Edition never writes it wholesale. The merger applies each key in `heir-workspace-settings-baseline.json` according to its `mergeMode` (defined in the baseline file alongside `settings`):

| Mode | Behaviour | Use when |
|---|---|---|
| `enforce` (default — used when `mergeMode` omits the key) | Object → deep-merge sub-keys; scalar → overwrite if differs | The brain holds the opinion. Heir customisations to sub-keys baseline doesn't list are preserved; baseline sub-keys are always present. |
| `set-if-absent` | Skip wholesale if heir already has the key (under any value, including object/scalar/null) | The brain wants to pin a safe default on fresh installs but respect heir per-repo overrides on upgrade. |

The merger surfaces both applied changes (`changes`) and respected overrides (`skipped`) so the bootstrap and upgrade scripts can report exactly what happened to the heir.

## Sync policy lives in code, not config

The edition-owned vs heir-owned glob lists used to live in `.github/config/sync-policy.json`. They moved inline to `.github/scripts/_registry.cjs` as the `EDITION_OWNED` and `HEIR_OWNED` exports. Policy now lives with the scripts that consume it (`bootstrap-heir.cjs`, `upgrade-self.cjs`, `heir-doctor.cjs`) — one source of truth, no risk of code-vs-config drift.

## Adding Your Own Configs

If you author a local instruction or skill that needs a config file, drop it in `.github/config/local/` so Edition upgrades never touch it. Heir-owned by convention.

## Notes

- The Edition copy of `cognitive-config.json` is a template rendered by `bootstrap-heir.cjs` on first install. Once a heir has its own copy, Edition upgrades leave it alone (declared `HEIR_OWNED` in `_registry.cjs`).
- VS Code editor assets (markdown preview theme, workspace settings, recommended extensions) belong in `.vscode/`, not here. Edition ships `.vscode/markdown-light.css` (edition-owned, refreshed on `/upgrade`) for Mermaid-friendly markdown preview; activate it via `"markdown.styles": [".vscode/markdown-light.css"]` in your settings. The `/polish-mermaid-setup` prompt documents the activation step.
