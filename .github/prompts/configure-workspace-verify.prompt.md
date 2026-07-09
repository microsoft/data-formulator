---
description: "Read-only audit of workspace VS Code settings and .vscode/ assets against the heir-workspace baseline"
lastReviewed: 2026-06-30
---

# Configure VS Code Workspace — Verify

Use this to audit `.vscode/` compliance on a heir without changing anything. To apply, use `/configure-workspace`.

Workspace settings are the project-specific override layer over user-scope settings.

## Objective

Report drift between the workspace's `.vscode/` and the heir-workspace baseline:

- Which `vscode_assets` are present / missing
- Which `bootstrap_templates` (`.vscode/` prefix) are present / missing
- Which `heir-workspace-settings-baseline.json` keys are compliant / drifted / missing in `.vscode/settings.json`

## Source of truth

Same as `/configure-workspace`: baseline + manifest + marker.

## Read-Only Steps

1. Verify `.github/.act-heir.json` exists. If absent, refuse.
2. Read `edition_version` from the marker.
3. Read `vscode_assets` and `bootstrap_templates` from `.github/config/edition-manifest.json`.
4. For each `vscode_asset`: check whether `.vscode/<asset>` exists.
5. For each `bootstrap_template` with `.vscode/` prefix: check whether the file exists.
6. Load `heir-workspace-settings-baseline.json` and compare each key against `.vscode/settings.json` (respect `mergeMode`).
7. Report compliance summary + drift table + missing list + recommendation.

## Reference Commands (read-only audit)

### macOS / Linux (bash, zsh)

```bash
[ -f .github/.act-heir.json ] || { echo "Not a heir workspace. Refusing."; exit 1; }
node -e "
const fs = require('fs');
const manifest = JSON.parse(fs.readFileSync('.github/config/edition-manifest.json','utf8'));
const baseline = JSON.parse(fs.readFileSync('.github/config/heir-workspace-settings-baseline.json','utf8'));
const mergeMode = baseline.mergeMode || {};
const settings = fs.existsSync('.vscode/settings.json') ? JSON.parse(fs.readFileSync('.vscode/settings.json','utf8')) : {};
const marker = JSON.parse(fs.readFileSync('.github/.act-heir.json','utf8'));
const assets = manifest.vscode_assets || [];
const assetsMissing = assets.filter(a => !fs.existsSync('.vscode/' + a));
const templates = (manifest.bootstrap_templates || []).filter(t => t.startsWith('.vscode/'));
const templatesMissing = templates.filter(t => !fs.existsSync(t));
const drift = [], missing = [], compliant = [];
for (const [k, v] of Object.entries(baseline.settings || {})) {
  const mode = mergeMode[k] || 'enforce';
  if (mode === 'set-if-absent') { compliant.push(k + ' (set-if-absent)'); continue; }
  if (!(k in settings)) { missing.push(k); continue; }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const cur = settings[k] || {};
    const subDrift = Object.entries(v).filter(([sk, sv]) => JSON.stringify(cur[sk]) !== JSON.stringify(sv));
    if (subDrift.length === 0) compliant.push(k);
    else subDrift.forEach(([sk]) => drift.push(k + '.' + sk));
  } else if (JSON.stringify(settings[k]) !== JSON.stringify(v)) {
    drift.push(k);
  } else {
    compliant.push(k);
  }
}
console.log('Edition version (marker):', marker.edition_version);
console.log('vscode_assets present:', (assets.length - assetsMissing.length) + ' / missing: ' + assetsMissing.length + (assetsMissing.length ? ' -> ' + assetsMissing.join(', ') : ''));
console.log('bootstrap_templates (.vscode/) present:', (templates.length - templatesMissing.length) + ' / missing: ' + templatesMissing.length + (templatesMissing.length ? ' -> ' + templatesMissing.join(', ') : ''));
console.log('settings compliance:', compliant.length + ' / drift: ' + drift.length + ' / missing: ' + missing.length);
if (drift.length) console.log('  drifted:', drift.join(', '));
if (missing.length) console.log('  missing:', missing.join(', '));
const needFix = assetsMissing.length + templatesMissing.length + drift.length + missing.length;
console.log('Recommendation:', needFix ? 'Run /configure-workspace' : 'No action required');
"
```

### Windows (PowerShell)

```powershell
if (-not (Test-Path '.github\.act-heir.json')) { Write-Error "Not a heir workspace. Refusing."; return }
$manifest = Get-Content '.github\config\edition-manifest.json' -Raw | ConvertFrom-Json
$baseline = Get-Content '.github\config\heir-workspace-settings-baseline.json' -Raw | ConvertFrom-Json -AsHashtable
$mergeMode = if ($baseline.ContainsKey('mergeMode')) { $baseline.mergeMode } else { @{} }
$settings = if (Test-Path '.vscode\settings.json') { Get-Content '.vscode\settings.json' -Raw | ConvertFrom-Json -AsHashtable } else { @{} }
$marker = Get-Content '.github\.act-heir.json' -Raw | ConvertFrom-Json

$assets = @($manifest.vscode_assets)
$assetsMissing = @($assets | Where-Object { -not (Test-Path ".vscode/$_") })
$templates = @($manifest.bootstrap_templates | Where-Object { $_ -like '.vscode/*' })
$templatesMissing = @($templates | Where-Object { -not (Test-Path $_) })

$drift = @(); $missing = @(); $compliant = @()
foreach ($k in $baseline.settings.Keys) {
    $mode = if ($mergeMode -and $mergeMode.ContainsKey($k)) { $mergeMode[$k] } else { 'enforce' }
    if ($mode -eq 'set-if-absent') { $compliant += "$k (set-if-absent)"; continue }
    if (-not $settings.ContainsKey($k)) { $missing += $k; continue }
    $desired = $baseline.settings[$k]
    if ($desired -is [System.Collections.IDictionary]) {
        $cur = if ($settings[$k] -is [System.Collections.IDictionary]) { $settings[$k] } else { @{} }
        $hasDrift = $false
        foreach ($sub in $desired.Keys) {
            if (($cur[$sub] | ConvertTo-Json -Depth 30 -Compress) -ne ($desired[$sub] | ConvertTo-Json -Depth 30 -Compress)) {
                $drift += "$k.$sub"; $hasDrift = $true
            }
        }
        if (-not $hasDrift) { $compliant += $k }
    } elseif (($settings[$k] | ConvertTo-Json -Depth 30 -Compress) -ne ($desired | ConvertTo-Json -Depth 30 -Compress)) {
        $drift += $k
    } else { $compliant += $k }
}

Write-Host ("Edition version (marker): {0}" -f $marker.edition_version)
Write-Host ("vscode_assets present: {0} / missing: {1}{2}" -f ($assets.Count - $assetsMissing.Count), $assetsMissing.Count, $(if ($assetsMissing.Count) { ' -> ' + ($assetsMissing -join ', ') } else { '' }))
Write-Host ("bootstrap_templates (.vscode/) present: {0} / missing: {1}{2}" -f ($templates.Count - $templatesMissing.Count), $templatesMissing.Count, $(if ($templatesMissing.Count) { ' -> ' + ($templatesMissing -join ', ') } else { '' }))
Write-Host ("settings compliance: {0} / drift: {1} / missing: {2}" -f $compliant.Count, $drift.Count, $missing.Count)
if ($drift.Count) { Write-Host ("  drifted: {0}" -f ($drift -join ', ')) }
if ($missing.Count) { Write-Host ("  missing: {0}" -f ($missing -join ', ')) }
$needFix = $assetsMissing.Count + $templatesMissing.Count + $drift.Count + $missing.Count
Write-Host ("Recommendation: {0}" -f $(if ($needFix) { 'Run /configure-workspace' } else { 'No action required' }))
```

Both commands are read-only — no files are modified.

## Output Format

```text
Edition version (marker): X.Y.Z
vscode_assets present: <P> / missing: <M> [-> list]
bootstrap_templates (.vscode/) present: <P> / missing: <M> [-> list]
settings compliance: <C> / drift: <D> / missing: <Mi>
  drifted: <list>
  missing: <list>
Recommendation: Run /configure-workspace | No action required
```

## Would Revise If

Same falsifier as `/configure-workspace`. Revisit by **2026-09-30** if the baseline / manifest / GitHub URL patterns change, or if audit results diverge from `bootstrap-heir.cjs` / `upgrade-self.cjs` reality.
