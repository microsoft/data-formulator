---
description: "Apply baseline VS Code workspace-scope settings and refresh Edition-owned .vscode/ assets for the current heir"
lastReviewed: 2026-06-30
---

# Configure VS Code Workspace

Use this when:

- A heir's `.vscode/` is missing files (e.g. `markdown-light.css` not present after cloning a heir repo where `.vscode/` was git-ignored or partially deleted)
- The workspace settings discovery keys (`chat.agentSkillsLocations`, `chat.permissions.default`) are absent from `.vscode/settings.json`
- You want to refresh workspace assets without running the full `ACT: Upgrade Brain` cycle

For VS Code USER-scope settings (per-machine), use `/configure-vscode`.
For verification only, use `/configure-workspace-verify`.

## Objective

Bring the workspace `.vscode/` into compliance with the heir-workspace baseline. Workspace settings intentionally override user-scope settings for this project:

1. Refresh EDITION_OWNED assets listed in `vscode_assets` (e.g. `markdown-light.css`) — overwrite always.
2. Seed HEIR_OWNED bootstrap templates with `.vscode/` prefix if missing (`extensions.json`, `settings.json`).
3. Per-key merge `heir-workspace-settings-baseline.json` into `.vscode/settings.json` (deep-merge for objects, scalar-replace for scalars, respect `mergeMode`).

## Source of truth

- Baseline: `.github/config/heir-workspace-settings-baseline.json` (workspace-scope settings + `mergeMode`)
- Manifest: `.github/config/edition-manifest.json` (lists `vscode_assets` + `bootstrap_templates`)
- Marker: `.github/.act-heir.json` (carries `edition_version` for source fetch)
- Source files: GitHub raw at the pinned `v<edition_version>` tag (post-ADR-009 static-fetch pattern)

## Apply Steps

1. Verify `.github/.act-heir.json` exists. If absent, refuse — this prompt only operates on heirs.
2. Read `edition_version` from the marker.
3. Read `vscode_assets` and `bootstrap_templates` from `.github/config/edition-manifest.json`.
4. For each entry in `vscode_assets`: fetch from `https://raw.githubusercontent.com/fabioc-aloha/Alex_ACT_Edition/v<edition_version>/.vscode/<asset>` and write to `.vscode/<asset>` (overwrite).
5. For each entry in `bootstrap_templates` that begins with `.vscode/`: fetch from the same source and write only if the destination is absent.
6. Load `heir-workspace-settings-baseline.json` and per-key merge into `.vscode/settings.json` (respect `mergeMode`).
7. Report what was refreshed / seeded / merged.

## Reference Commands

Three shells, one workflow. Pick the one for your OS.

### macOS / Linux (bash, zsh)

```bash
[ -f .github/.act-heir.json ] || { echo "Not a heir workspace (no .github/.act-heir.json). Refusing."; exit 1; }
version=$(node -e "console.log(JSON.parse(require('fs').readFileSync('.github/.act-heir.json','utf8')).edition_version)")
manifest=.github/config/edition-manifest.json
base_url="https://raw.githubusercontent.com/fabioc-aloha/Alex_ACT_Edition/v$version"
mkdir -p .vscode

# 1. Refresh vscode_assets (overwrite always)
for asset in $(node -e "console.log((JSON.parse(require('fs').readFileSync('$manifest','utf8')).vscode_assets||[]).join('\n'))"); do
  curl -fsSL "$base_url/.vscode/$asset" -o ".vscode/$asset" && echo "Refreshed: .vscode/$asset"
done

# 2. Seed bootstrap_templates with .vscode/ prefix (only if missing)
for tpl in $(node -e "console.log((JSON.parse(require('fs').readFileSync('$manifest','utf8')).bootstrap_templates||[]).filter(t=>t.startsWith('.vscode/')).join('\n'))"); do
  if [ -f "$tpl" ]; then
    echo "Preserved: $tpl"
  else
    curl -fsSL "$base_url/$tpl" -o "$tpl" && echo "Seeded: $tpl"
  fi
done

# 3. Merge heir-workspace-settings-baseline into .vscode/settings.json
node -e "
const fs = require('fs');
const baseline = JSON.parse(fs.readFileSync('.github/config/heir-workspace-settings-baseline.json','utf8'));
const settingsFile = '.vscode/settings.json';
if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{}');
const current = JSON.parse(fs.readFileSync(settingsFile,'utf8'));
const mergeMode = baseline.mergeMode || {};
const changes = [];
for (const [k, v] of Object.entries(baseline.settings || {})) {
  const mode = mergeMode[k] || 'enforce';
  if (mode === 'set-if-absent' && Object.prototype.hasOwnProperty.call(current, k)) continue;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const cur = (current[k] && typeof current[k] === 'object' && !Array.isArray(current[k])) ? current[k] : {};
    current[k] = { ...cur };
    for (const [sk, sv] of Object.entries(v)) {
      if (current[k][sk] !== sv) { current[k][sk] = sv; changes.push(\`\${k}.\${sk}\`); }
    }
  } else if (current[k] !== v) {
    current[k] = v; changes.push(k);
  }
}
fs.writeFileSync(settingsFile, JSON.stringify(current, null, 2) + '\n');
console.log('Merged ' + changes.length + ' keys into .vscode/settings.json' + (changes.length ? ': ' + changes.join(', ') : ' (already current)'));
"
```

### Windows (PowerShell)

```powershell
if (-not (Test-Path '.github\.act-heir.json')) { Write-Error "Not a heir workspace (no .github/.act-heir.json). Refusing."; return }
$marker = Get-Content '.github\.act-heir.json' -Raw | ConvertFrom-Json
$version = $marker.edition_version
$manifest = Get-Content '.github\config\edition-manifest.json' -Raw | ConvertFrom-Json
$baseUrl = "https://raw.githubusercontent.com/fabioc-aloha/Alex_ACT_Edition/v$version"
if (-not (Test-Path '.vscode')) { New-Item -ItemType Directory -Path '.vscode' | Out-Null }

# 1. Refresh vscode_assets (overwrite always)
foreach ($asset in @($manifest.vscode_assets)) {
    if (-not $asset) { continue }
    Invoke-WebRequest -Uri "$baseUrl/.vscode/$asset" -OutFile ".vscode/$asset" -UseBasicParsing
    Write-Host "Refreshed: .vscode/$asset"
}

# 2. Seed bootstrap_templates with .vscode/ prefix (only if missing)
foreach ($tpl in @($manifest.bootstrap_templates)) {
    if (-not $tpl -or -not $tpl.StartsWith('.vscode/')) { continue }
    if (Test-Path $tpl) { Write-Host "Preserved: $tpl"; continue }
    Invoke-WebRequest -Uri "$baseUrl/$tpl" -OutFile $tpl -UseBasicParsing
    Write-Host "Seeded: $tpl"
}

# 3. Merge heir-workspace-settings-baseline into .vscode/settings.json
$baseline = Get-Content '.github\config\heir-workspace-settings-baseline.json' -Raw | ConvertFrom-Json -AsHashtable
$settingsFile = '.vscode/settings.json'
if (-not (Test-Path $settingsFile)) { '{}' | Set-Content -Path $settingsFile -Encoding UTF8 }
$current = Get-Content $settingsFile -Raw | ConvertFrom-Json -AsHashtable
$mergeMode = if ($baseline.ContainsKey('mergeMode')) { $baseline.mergeMode } else { @{} }
$changes = @()
foreach ($k in $baseline.settings.Keys) {
    $mode = if ($mergeMode -and $mergeMode.ContainsKey($k)) { $mergeMode[$k] } else { 'enforce' }
    if ($mode -eq 'set-if-absent' -and $current.ContainsKey($k)) { continue }
    $desired = $baseline.settings[$k]
    if ($desired -is [System.Collections.IDictionary]) {
        if (-not $current.ContainsKey($k) -or -not ($current[$k] -is [System.Collections.IDictionary])) { $current[$k] = @{} }
        foreach ($sub in $desired.Keys) {
            if ($current[$k][$sub] -ne $desired[$sub]) { $current[$k][$sub] = $desired[$sub]; $changes += "$k.$sub" }
        }
    } elseif ($current[$k] -ne $desired) {
        $current[$k] = $desired; $changes += $k
    }
}
$current | ConvertTo-Json -Depth 30 | Set-Content -Path $settingsFile -Encoding UTF8
Write-Host ("Merged {0} keys into {1}{2}" -f $changes.Count, $settingsFile, $(if ($changes.Count) { ': ' + ($changes -join ', ') } else { ' (already current)' }))
```

All commands are idempotent — running twice is safe; only changed keys are reported.

## Guardrails

- Heir-only. Refuse if `.github/.act-heir.json` is absent.
- Workspace-scope only. Do not write user-scope keys to workspace `.vscode/`; use workspace settings only for project-specific overrides and Edition-owned workspace assets.
- Preserve all unrelated keys in `.vscode/settings.json`.
- `vscode_assets` (e.g. `markdown-light.css`) REFRESH on every invocation (EDITION_OWNED contract).
- `.vscode/extensions.json` and `.vscode/settings.json` files themselves are SEEDED only if missing (HEIR_OWNED contract).
- Per-key baseline merge respects `mergeMode` — `set-if-absent` keys (e.g. `chat.permissions.default`) are NOT overwritten if the heir already set them.
- Requires network access to GitHub raw URLs. For offline recovery, run `node .github/scripts/upgrade-self.cjs --apply` after restoring connectivity, or `ACT: Upgrade Brain` via the Extension.

## Would Revise If

Revisit by **2026-09-30** (90 days) or sooner if any of the following fires: the `heir-workspace-settings-baseline.json` shape changes; the `edition-manifest.json` `vscode_assets` or `bootstrap_templates` fields rename; the GitHub raw URL pattern for Edition releases changes; heirs report drift between this prompt's output and `bootstrap-heir.cjs` / `upgrade-self.cjs`.
