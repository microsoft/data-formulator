---
description: "Read-only audit of user-level VS Code/Copilot settings compliance"
lastReviewed: 2026-06-30
---

# Configure VS Code — Verify

Use this to verify fleet policy compliance on a machine without changing any settings.

For a WORKSPACE-scope audit (`.vscode/` assets, discovery-location keys), use `/configure-workspace-verify`.

## Objective

Audit user-scope VS Code settings against the central baseline and report drift. Project-specific overrides belong in workspace `.vscode/settings.json` and are audited by `/configure-workspace-verify`.

## Source of truth

The baseline lives in `.github/config/welcome-baseline.json` (`settings` object). Both `/configure-vscode` (apply) and `/configure-vscode-verify` (this audit) load from the same file — update once.

## Read-Only Steps

1. Load the baseline from `.github/config/welcome-baseline.json` (`settings` object).
2. Resolve the user settings path for the current OS:
   - Windows: `%APPDATA%\Code\User\settings.json`
   - macOS: `~/Library/Application Support/Code/User/settings.json`
   - Linux: `~/.config/Code/User/settings.json`
3. Read `settings.json` as-is.
4. Compare each baseline key/value pair.
5. Classify each key:
   - `compliant` (value matches)
   - `drift` (key exists but value differs)
   - `missing` (key absent)
6. Report compliance summary and drift table.
7. Recommend running `/configure-vscode` only if drift or missing keys are found.

## Reference Commands (read-only audit)

Three shells, one payload. Pick the one for your OS.

### macOS / Linux (bash, zsh)

```bash
baseline_file=.github/config/welcome-baseline.json
if [[ "$OSTYPE" == "darwin"* ]]; then
  user_settings="$HOME/Library/Application Support/Code/User/settings.json"
else
  user_settings="$HOME/.config/Code/User/settings.json"
fi
node -e "
const fs = require('fs');
const b = JSON.parse(fs.readFileSync('$baseline_file', 'utf8')).settings;
const c = fs.existsSync('$user_settings') ? JSON.parse(fs.readFileSync('$user_settings', 'utf8')) : {};
const drift = [], missing = [], compliant = [];
for (const k of Object.keys(b)) {
  if (!(k in c)) missing.push(k);
  else if (JSON.stringify(c[k]) !== JSON.stringify(b[k])) drift.push({ k, expected: b[k], actual: c[k] });
  else compliant.push(k);
}
console.log('Compliance:', compliant.length + '/' + Object.keys(b).length);
console.log('Drift:', drift.length);
console.log('Missing:', missing.length);
if (drift.length) console.log('Drifted:', JSON.stringify(drift, null, 2));
if (missing.length) console.log('Missing keys:', missing);
"
```

### Windows (PowerShell)

```powershell
$baseline = Get-Content '.github\config\welcome-baseline.json' -Raw | ConvertFrom-Json -AsHashtable
$userSettings = Join-Path $env:APPDATA 'Code\User\settings.json'
$current = if (Test-Path $userSettings) { Get-Content -Path $userSettings -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$drift = @(); $missing = @(); $compliant = @()
foreach ($k in $baseline.settings.Keys) {
  if (-not $current.ContainsKey($k)) { $missing += $k }
  elseif (($current[$k] | ConvertTo-Json -Depth 30 -Compress) -ne ($baseline.settings[$k] | ConvertTo-Json -Depth 30 -Compress)) { $drift += [pscustomobject]@{ key=$k; expected=$baseline.settings[$k]; actual=$current[$k] } }
  else { $compliant += $k }
}
Write-Host ("Compliance: {0}/{1}" -f $compliant.Count, $baseline.settings.Count)
Write-Host ("Drift: {0}" -f $drift.Count)
Write-Host ("Missing: {0}" -f $missing.Count)
if ($drift.Count) { $drift | Format-Table -AutoSize }
if ($missing.Count) { Write-Host ("Missing keys: {0}" -f ($missing -join ', ')) }
```

Both commands are read-only — they never write to `settings.json`.

## Output Format

```text
Compliance: <X>/<N> keys
Drift: <count>
Missing: <count>

Drifted keys:
- key: expected=<...>, actual=<...>

Missing keys:
- key: expected=<...>

Recommendation:
- No action required | Run /configure-vscode to apply baseline
```

## Guardrails

- Do not modify files.
- User-scope only (never evaluate workspace `.vscode/settings.json` for policy compliance; workspace settings are the project override layer).
- Treat unknown extra keys as informational only, not non-compliance.

## Would Revise If

Revisit this prompt by **2026-08-26** (90 days) or sooner if any of the following fires: the workflow it invokes ceases to produce its intended output (skill body changed but prompt steps stale); the visible markers / verification steps in its body are consistently skipped; or the slash-command name is no longer discoverable in the prompt picker.
