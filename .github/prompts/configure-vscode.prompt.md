---
description: "Apply baseline VS Code user-scope settings for fleet policy compliance"
lastReviewed: 2026-06-30
---

# Configure VS Code

Use this on first session setup (or when moving to a new machine) to apply a stable user-level VS Code policy.

For a first-session **orientation tour** (identity, what's loaded, where to start), use `/welcome` instead.
For WORKSPACE-scope settings + `.vscode/` assets (`markdown-light.css`, discovery-location keys), use `/configure-workspace`.

## Objective

Produce and apply a portable settings payload at user scope so every machine starts from the same safe defaults. Workspace settings remain the project-specific override layer and are handled by `/configure-workspace`.

## Source of truth

The baseline payload lives in `.github/config/welcome-baseline.json` (`settings` object). Both `/configure-vscode` (apply) and `/configure-vscode-verify` (audit) load from the same file — update once.

## Apply Steps

1. Load the baseline from `.github/config/welcome-baseline.json` (`settings` object).

2. Detect user settings path:
   - Windows: `%APPDATA%\Code\User\settings.json`
   - macOS: `~/Library/Application Support/Code/User/settings.json`
   - Linux: `~/.config/Code/User/settings.json`

3. Merge each baseline key/value into existing user settings (do not overwrite unrelated keys).

4. Verify applied keys by reading back values.

5. Report exactly which keys changed and which were already compliant.

## Reference Commands

Three shells, one payload. Pick the one for your OS.

### macOS / Linux (bash, zsh)

```bash
baseline_file=.github/config/welcome-baseline.json
if [[ "$OSTYPE" == "darwin"* ]]; then
  user_settings="$HOME/Library/Application Support/Code/User/settings.json"
else
  user_settings="$HOME/.config/Code/User/settings.json"
fi
mkdir -p "$(dirname "$user_settings")"
[ -f "$user_settings" ] || echo '{}' > "$user_settings"
node -e "
const fs = require('fs');
const b = JSON.parse(fs.readFileSync('$baseline_file', 'utf8')).settings;
const c = JSON.parse(fs.readFileSync('$user_settings', 'utf8'));
for (const k of Object.keys(b)) c[k] = b[k];
fs.writeFileSync('$user_settings', JSON.stringify(c, null, 2));
"
```

### Windows (PowerShell)

```powershell
$baseline = Get-Content '.github\config\welcome-baseline.json' -Raw | ConvertFrom-Json -AsHashtable
$userSettings = Join-Path $env:APPDATA 'Code\User\settings.json'
if (-not (Test-Path $userSettings)) { '{}' | Set-Content -Path $userSettings -Encoding UTF8 }
$current = Get-Content -Path $userSettings -Raw | ConvertFrom-Json -AsHashtable
foreach ($k in $baseline.settings.Keys) { $current[$k] = $baseline.settings[$k] }
$current | ConvertTo-Json -Depth 30 | Set-Content -Path $userSettings -Encoding UTF8
```

All three are non-destructive merges — unrelated user-scope keys are preserved.

## Guardrails

- User-scope only. Do not write these keys to workspace `.vscode/settings.json` — workspace-scope is owned by `/configure-workspace` and may override user settings for a particular project.
- Stable settings only — the baseline file is the source of truth; do not inline payload here.
- Preserve all unrelated existing user settings.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
