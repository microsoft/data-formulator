<#
.SYNOPSIS
    Merges the Agency Integration Starter into an existing project repository.

.DESCRIPTION
    Additively installs the starter's Agency profiles, MCP configuration, local
    skills/agents, docs, and VS Code recommendations into a target repo WITHOUT
    overwriting the project's own history:

      - copies additive files (docs, skills, agents, scripts) only when they do
        not already exist in the target (use -Force to overwrite),
      - appends any missing starter patterns to the target's .gitignore,
      - deep-merges .mcp.json and .vscode/extensions.json (existing values kept),
      - appends starter profiles to an existing agency.toml.

    The script is safe by default: without -Apply it runs as a DRY RUN and only
    prints the PLAN. Re-run with -Apply to write changes.

    Not copied into target projects: agency/VERSION.json (a machine-specific tool
    snapshot) and the root-level README.md (the maintainer overview of this
    starter). The project-facing README is agency/README.md.

.PARAMETER TargetPath
    REQUIRED. Path to the target project repo to install into. Must be an
    initialized git repository and must not be the starter repo itself.

.PARAMETER Apply
    Write the changes. When omitted, the script runs as a dry run (plan only).

.PARAMETER Force
    Overwrite additive files that already exist in the target. Without this,
    existing files are left untouched and reported as "skip existing".

.EXAMPLE
    ./Install-AgencyStarter.ps1 -TargetPath C:/Development/my-project
    Dry run: prints the plan without changing the target repo.

.EXAMPLE
    ./Install-AgencyStarter.ps1 -TargetPath C:/Development/my-project -Apply
    Applies the merge into the target repo.

.EXAMPLE
    ./Install-AgencyStarter.ps1 -TargetPath C:/Development/my-project -Apply -Force
    Applies the merge and overwrites existing additive files with starter copies.

.NOTES
    Requirements: Windows PowerShell or pwsh, and git on PATH (used for repo
    detection and the .vscode/extensions.json merge). Run
    agency/scripts/verify-tooling.ps1 -Install first if git is missing.

    After running, review the target repo's `git status` before committing.
#>
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter(Mandatory = $true)]
    [string]$TargetPath,

    [switch]$Apply,
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$starterRoot = $PSScriptRoot
$targetRoot = (Resolve-Path -Path $TargetPath).Path

if ($targetRoot -eq $starterRoot) {
    throw "TargetPath resolves to the starter repo itself ($starterRoot). Choose a different target repo."
}

function Write-Step([string]$Message) {
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Plan([string]$Message) {
    Write-Host "PLAN: $Message" -ForegroundColor Yellow
}

function Invoke-Write([string]$Message, [scriptblock]$Action) {
    if ($Apply) {
        Write-Step $Message
        & $Action
    }
    else {
        Write-Plan $Message
    }
}

function Copy-AdditiveFile([string]$RelativePath) {
    $source = Join-Path $starterRoot $RelativePath
    $target = Join-Path $targetRoot $RelativePath

    if (-not (Test-Path $source)) {
        throw "Starter file missing: $RelativePath"
    }

    if ((Test-Path $target) -and -not $Force) {
        Write-Plan "skip existing $RelativePath"
        return
    }

    Invoke-Write "copy $RelativePath" {
        New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
        Copy-Item -Path $source -Destination $target -Force:$Force
    }
}

function Merge-GitIgnore {
    $source = Join-Path $starterRoot ".gitignore"
    $target = Join-Path $targetRoot ".gitignore"
    $sourceLines = Get-Content $source
    $targetLines = if (Test-Path $target) { Get-Content $target } else { @() }
    $missing = @($sourceLines | Where-Object { $_ -and ($_ -notin $targetLines) })

    if ($missing.Count -eq 0) {
        Write-Host "OK: .gitignore already contains starter patterns" -ForegroundColor Green
        return
    }

    Invoke-Write "append $($missing.Count) starter .gitignore pattern(s)" {
        if (-not (Test-Path $target)) {
            New-Item -ItemType File -Path $target -Force | Out-Null
        }

        Add-Content -Path $target -Value ""
        Add-Content -Path $target -Value "# Agency Integration Starter"
        Add-Content -Path $target -Value $missing
    }
}

function Merge-JsonObjectFile([string]$RelativePath) {
    $source = Join-Path $starterRoot $RelativePath
    $target = Join-Path $targetRoot $RelativePath

    if (-not (Test-Path $target)) {
        Copy-AdditiveFile $RelativePath
        return
    }

    $sourceJson = Get-Content $source -Raw | ConvertFrom-Json
    $targetJson = Get-Content $target -Raw | ConvertFrom-Json
    $changed = $false

    $changed = Merge-JsonObject -Source $sourceJson -Target $targetJson

    if (-not $changed) {
        Write-Host "OK: $RelativePath already contains starter values" -ForegroundColor Green
        return
    }

    Invoke-Write "merge $RelativePath" {
        $targetJson | ConvertTo-Json -Depth 20 | Set-Content -Path $target -Encoding utf8
    }
}

function Assert-JsonObjectFile([string]$Path, [string]$DisplayPath) {
    try {
        $value = Get-Content $Path -Raw | ConvertFrom-Json
    }
    catch {
        throw "Invalid JSON in $DisplayPath. Fix it before applying the starter. $($_.Exception.Message)"
    }

    if (-not (Test-JsonObject $value)) {
        throw "Invalid JSON in $DisplayPath. The root value must be an object."
    }
}

function Test-JsonObject($Value) {
    $null -ne $Value -and $Value -is [pscustomobject]
}

function Merge-JsonObject($Source, $Target) {
    $changed = $false

    foreach ($property in $Source.PSObject.Properties) {
        $name = $property.Name
        $sourceValue = $property.Value

        if (-not ($Target.PSObject.Properties.Name -contains $name)) {
            $Target | Add-Member -NotePropertyName $name -NotePropertyValue $sourceValue
            $changed = $true
            continue
        }

        $targetValue = $Target.$name

        if ((Test-JsonObject $sourceValue) -and (Test-JsonObject $targetValue)) {
            if (Merge-JsonObject -Source $sourceValue -Target $targetValue) {
                $changed = $true
            }
            continue
        }

        if ($sourceValue -is [System.Array] -and $targetValue -is [System.Array]) {
            # VS Code extension IDs (and similar identifiers) are case-insensitive.
            # A plain `Select-Object -Unique` is case-sensitive and would add a
            # near-duplicate entry when the target already has the same value
            # in different casing (observed with GitHub.vscode-pull-request-github
            # vs. github.vscode-pull-request-github). Dedupe case-insensitively
            # for strings, keeping the target's existing casing.
            $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
            $combined = @()
            foreach ($item in (@($targetValue) + @($sourceValue))) {
                $key = if ($item -is [string]) { $item } else { $item | ConvertTo-Json -Compress -Depth 20 }
                if ($seen.Add($key)) {
                    $combined += $item
                }
            }
            if (@($combined).Count -ne @($targetValue).Count) {
                $Target.$name = $combined
                $changed = $true
            }
        }
    }

    return $changed
}

function Merge-TomlByAppend([string]$RelativePath) {
    # This parser recognizes single-bracket TOML table headers ([profiles.x.y])
    # split on top-level [ lines. It does not recognize double-bracket
    # array-of-tables headers ([[profiles.x.y]]); this starter's agency.toml
    # intentionally uses inline table arrays (`default = [ { ... }, { ... } ]`)
    # instead, specifically so this merge logic can stay simple. If a future
    # edit introduces [[ ]] syntax, update this function's section-splitting
    # regex before relying on it to merge that content.
    $source = Join-Path $starterRoot $RelativePath
    $target = Join-Path $targetRoot $RelativePath

    if (-not (Test-Path $target)) {
        Copy-AdditiveFile $RelativePath
        return
    }

    $sourceText = Get-Content $source -Raw
    $targetText = Get-Content $target -Raw
    $changed = $false

    if ($targetText -notmatch '(?m)^\[mcps\][ \t]*$') {
        Invoke-Write "append starter MCP base config to agency.toml" {
            Add-Content -Path $target -Value ""
            Add-Content -Path $target -Value "[mcps]"
            Add-Content -Path $target -Value "include_mcps_from_workspace = false"
        }
        $changed = $true
        $targetText = if ($Apply) { Get-Content $target -Raw } else { $targetText + "`n[mcps]`ninclude_mcps_from_workspace = false`n" }
    }
    elseif ($targetText -notmatch '(?m)^include_mcps_from_workspace[ \t]*=') {
        Invoke-Write "add include_mcps_from_workspace = false to agency.toml" {
            $currentText = Get-Content $target -Raw
            $newline = if ($currentText.Contains("`r`n")) { "`r`n" } else { "`n" }
            $header = [regex]'(?m)^(\[mcps\][ \t]*)$'
            $updated = $header.Replace($currentText, ('$1' + $newline + 'include_mcps_from_workspace = false'), 1)
            Set-Content -Path $target -Value $updated -NoNewline
        }
        $changed = $true
        $targetText = if ($Apply) {
            Get-Content $target -Raw
        }
        else {
            $targetText -replace '(?m)^(\[mcps\][ \t]*)$', "`$1`ninclude_mcps_from_workspace = false"
        }
    }
    elseif ($targetText -match '(?m)^include_mcps_from_workspace\s*=\s*true\s*$') {
        Invoke-Write "set agency.toml include_mcps_from_workspace = false" {
            $updated = (Get-Content $target -Raw) -replace '(?m)^include_mcps_from_workspace\s*=\s*true\s*$', 'include_mcps_from_workspace = false'
            Set-Content -Path $target -Value $updated -NoNewline
        }
        $changed = $true
        $targetText = if ($Apply) { Get-Content $target -Raw } else { $targetText -replace '(?m)^include_mcps_from_workspace\s*=\s*true\s*$', 'include_mcps_from_workspace = false' }
    }

    $sourceLines = $sourceText -split "`r?`n"
    $sections = @()
    $currentHeader = $null
    $currentLines = @()

    foreach ($line in $sourceLines) {
        if ($line -match '^\[(profiles\.[^\]]+)\]\s*$') {
            if ($currentHeader) {
                $sections += [pscustomobject]@{ Header = $currentHeader; Text = ($currentLines -join "`n") }
            }

            $currentHeader = $matches[1]
            $currentLines = @($line)
            continue
        }

        if ($line -match '^\[') {
            if ($currentHeader) {
                $sections += [pscustomobject]@{ Header = $currentHeader; Text = ($currentLines -join "`n") }
                $currentHeader = $null
                $currentLines = @()
            }
            continue
        }

        if ($currentHeader) {
            $currentLines += $line
        }
    }

    if ($currentHeader) {
        $sections += [pscustomobject]@{ Header = $currentHeader; Text = ($currentLines -join "`n") }
    }

    $missingSections = @($sections | Where-Object { $targetText -notmatch "(?m)^\[$([regex]::Escape($_.Header))\]\s*$" })

    if ($missingSections.Count -eq 0 -and -not $changed) {
        Write-Host "OK: agency.toml already appears to contain starter profiles" -ForegroundColor Green
        return
    }

    if ($missingSections.Count -gt 0) {
        Invoke-Write "append $($missingSections.Count) starter agency.toml profile section(s)" {
            Add-Content -Path $target -Value ""
            Add-Content -Path $target -Value "# Agency Integration Starter profiles"
            foreach ($section in $missingSections) {
                Add-Content -Path $target -Value ""
                Add-Content -Path $target -Value $section.Text
            }
        }
    }

    if ($missingSections.Count -eq 0 -and $changed) {
        Write-Host "OK: agency.toml starter profiles already present" -ForegroundColor Green
    }
}

function Get-VsCodeExtensionsState {
    $relativePath = ".vscode/extensions.json"

    Push-Location $targetRoot
    try {
        git check-ignore -q -- $relativePath
        $ignored = ($LASTEXITCODE -eq 0)
        $tracked = [bool](git ls-files -- $relativePath)
    }
    finally {
        Pop-Location
    }

    return [pscustomobject]@{
        Ignored = $ignored
        Tracked = $tracked
    }
}

function Merge-VsCodeExtensions {
    $relativePath = ".vscode/extensions.json"
    $state = Get-VsCodeExtensionsState

    if ($state.Ignored -and ($state.Tracked -eq $false)) {
        Write-Plan ".vscode/extensions.json is ignored by target repo; document or force-add manually if desired"
        return
    }

    Merge-JsonObjectFile $relativePath
}

function Assert-GitRepo([string]$Path) {
    $gitDir = Join-Path $Path ".git"
    if (-not (Test-Path $gitDir)) {
        throw "Target is not a git repository: $Path"
    }
}

function Assert-CommandAvailable([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name is required on PATH for this installer (used for repo detection and .vscode/extensions.json merge). Run agency/scripts/verify-tooling.ps1 -Install first."
    }
}

function Assert-InstallPreflight([string[]]$AdditiveFiles) {
    $requiredSources = @($AdditiveFiles) + @(
        ".gitignore",
        ".mcp.json",
        ".vscode/extensions.json",
        "agency.toml"
    )

    foreach ($relativePath in $requiredSources) {
        $source = Join-Path $starterRoot $relativePath
        if (-not (Test-Path $source -PathType Leaf)) {
            throw "Starter file missing: $relativePath"
        }
    }

    Assert-JsonObjectFile -Path (Join-Path $starterRoot ".mcp.json") -DisplayPath "starter .mcp.json"
    Assert-JsonObjectFile -Path (Join-Path $starterRoot ".vscode/extensions.json") -DisplayPath "starter .vscode/extensions.json"

    $targetMcp = Join-Path $targetRoot ".mcp.json"
    if (Test-Path $targetMcp -PathType Leaf) {
        Assert-JsonObjectFile -Path $targetMcp -DisplayPath "target .mcp.json"
    }

    $vscodeState = Get-VsCodeExtensionsState
    $targetVsCode = Join-Path $targetRoot ".vscode/extensions.json"
    if ((-not $vscodeState.Ignored -or $vscodeState.Tracked) -and (Test-Path $targetVsCode -PathType Leaf)) {
        Assert-JsonObjectFile -Path $targetVsCode -DisplayPath "target .vscode/extensions.json"
    }
}

Assert-CommandAvailable "git"
Assert-GitRepo $targetRoot

Write-Step "Agency Integration Starter installer"
Write-Host "Starter: $starterRoot"
Write-Host "Target : $targetRoot"
Write-Host "Mode   : $(if ($Apply) { 'APPLY' } else { 'DRY RUN' })"

# agency/VERSION.json is intentionally excluded from this list: it is a
# machine-specific tool snapshot. Copying the starter's own snapshot into a
# target repo would misrepresent what was actually verified there. Target
# repos generate their own via `verify-tooling.ps1 -UpdateVersionFile`.
# agency.toml, .mcp.json, and .vscode/extensions.json are also excluded here
# because they go through their own merge functions below instead of a raw copy.
# The root-level README.md is intentionally excluded too: it is the all-up
# maintainer overview of this starter repo, not project-facing content. The
# project-facing doc is agency/README.md (which IS copied). Do not add the root
# README.md to this list.
$additiveFiles = @(
    "Install-AgencyStarter.ps1",
    "agency/README.md",
    "agency/scripts/verify-tooling.ps1",
    "agency/docs/tooling-guide.md",
    "agency/docs/agency-mcp-capabilities.md",
    "agency/docs/project-agent-roster.md",
    "agency/docs/project-mcp-capabilities.md",
    "agency/docs/m365-transcript-access.md",
    "agency/docs/plugin-adoption-checklist.md",
    "agency/docs/setup-github-emu-agency.md",
    "agency/docs/whats-new.md",
    ".github/skills/local/project-agency-operations/SKILL.md",
    ".github/skills/local/project-incident-response/SKILL.md",
    ".github/skills/local/project-fabric-operations/SKILL.md",
    ".github/skills/local/project-capability-adoption/SKILL.md",
    ".github/skills/local/project-foundry-operations/SKILL.md",
    ".github/agents/local/project-tool-access-manager.agent.md",
    ".github/agents/local/project-ado-planner.agent.md",
    ".github/agents/local/project-docs-researcher.agent.md",
    ".github/agents/local/project-feedback-coordinator.agent.md",
    ".github/agents/local/project-meeting-note-taker.agent.md",
    ".github/agents/local/project-owner-map-reviewer.agent.md",
    ".github/agents/local/project-servicetree-planner.agent.md",
    ".github/agents/local/project-status-reporter.agent.md",
    ".github/agents/local/project-triager.agent.md",
    ".github/agents/local/project-remediation-router.agent.md",
    ".github/agents/local/project-document-comprehension-reviewer.agent.md",
    ".editorconfig",
    ".gitattributes"
)

Assert-InstallPreflight -AdditiveFiles $additiveFiles

foreach ($file in $additiveFiles) {
    Copy-AdditiveFile $file
}

Merge-GitIgnore
Merge-JsonObjectFile ".mcp.json"
Merge-TomlByAppend "agency.toml"
Merge-VsCodeExtensions

Write-Step "Done"
if (-not $Apply) {
    Write-Host "Dry run only. Re-run with -Apply to write changes." -ForegroundColor Yellow
}
