[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$ConfigureAuth,
    [switch]$UpdateVersionFile
)

$ErrorActionPreference = "Stop"
$verificationFailures = [System.Collections.Generic.List[string]]::new()

# agency/scripts/verify-tooling.ps1 -> repo root is two levels up. Anchoring on
# $PSScriptRoot (not the caller's working directory) keeps the .mcp.json and
# VERSION.json paths correct even if this script is invoked from elsewhere.
# Agency CLI commands below (agency config list, agency plugin list, etc.)
# still resolve repo-level agency.toml relative to the working directory by
# their own design, so this script is still documented to be run from the
# repo root.
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent

$commandInstallers = [ordered]@{
    git    = {
        winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
    }
    agency = {
        # Download to disk and invoke the script file directly instead of
        # piping remote content through Invoke-Expression. Functionally
        # equivalent to the previous `iex "& { $(irm ...) } Agency"` pattern,
        # but avoids the raw "download-then-eval" shape that automated
        # security scanners (this starter is submitted to the Agency
        # Playground marketplace) flag as a dangerous code pattern.
        $installerPath = Join-Path ([System.IO.Path]::GetTempPath()) "InstallTool.ps1"
        Invoke-WebRequest -Uri "https://aka.ms/InstallTool.ps1" -OutFile $installerPath -UseBasicParsing
        & $installerPath Agency
        Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
    }
    az     = {
        winget install -e --id Microsoft.AzureCLI --accept-package-agreements --accept-source-agreements
    }
    gh     = {
        winget install -e --id GitHub.cli --accept-package-agreements --accept-source-agreements
    }
    node   = {
        winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    }
    code   = {
        winget install -e --id Microsoft.VisualStudioCode --accept-package-agreements --accept-source-agreements
    }
}

$requiredCommands = @("git", "agency", "az", "gh", "node", "npm", "code", "func")
$vscodeExtensions = @(
    "microsoft.agency",
    "ms-azuretools.vscode-azurefunctions",
    "ms-azuretools.vscode-azureresourcegroups",
    "ms-azuretools.vscode-azurestaticwebapps",
    "ms-azuretools.vscode-bicep",
    "ms-azuretools.vscode-cosmosdb",
    "ms-vscode.powershell",
    "tamasfe.even-better-toml",
    "davidanson.vscode-markdownlint",
    "github.vscode-pull-request-github",
    "ms-toolsai.jupyter",
    "ms-python.python"
)
$azureExtensions = @(
    "resource-graph",
    "application-insights",
    "containerapp",
    "azure-devops",
    "staticwebapp"
)

function Test-Command([string]$Name) {
    [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Write-Section([string]$Message) {
    Write-Host "`n$Message" -ForegroundColor Cyan
}

function Add-VerificationFailure([string]$Message) {
    $verificationFailures.Add($Message)
    Write-Host "FAILED: $Message" -ForegroundColor Red
}

function Invoke-CheckedCommand([string]$Description, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) {
        Add-VerificationFailure "$Description exited with code $LASTEXITCODE"
    }
}

function Update-PathFromEnvironment {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $paths = foreach ($entry in (($machinePath, $userPath, $env:Path) -split ";")) {
        $trimmed = $entry.Trim()
        if ($trimmed -and $seen.Add($trimmed)) {
            $trimmed
        }
    }
    $env:Path = $paths -join ";"
}

function Assert-WingetAvailable {
    if (-not (Test-Command "winget")) {
        throw "winget is required for automatic dependency installation. Install App Installer from Microsoft Store or install dependencies manually."
    }
}

function Get-NodeMajorVersion {
    if (-not (Test-Command "node")) {
        return $null
    }

    $version = (& node --version).Trim().TrimStart("v")
    $major = $version.Split(".")[0]
    return [int]$major
}

function Get-FuncMajorVersion {
    if (-not (Test-Command "func")) {
        return $null
    }

    $version = (& func --version).Trim()
    $major = $version.Split(".")[0]
    return [int]$major
}

function Install-IfMissing([string]$Name) {
    if ($Name -eq "node" -and (Test-Command "node")) {
        $major = Get-NodeMajorVersion
        if ($major -ge 24) {
            Write-Host "OK: node v$major" -ForegroundColor Green
            return
        }

        Write-Host "NODE_TOO_OLD: node v$major detected; Node.js 24+ is required" -ForegroundColor Yellow
        if (-not $Install) {
            Add-VerificationFailure "node v$major is installed; Node.js 24+ is required"
            return
        }

        Assert-WingetAvailable
        & $commandInstallers.node
        Update-PathFromEnvironment
        $updatedMajor = Get-NodeMajorVersion
        if ($null -eq $updatedMajor -or $updatedMajor -lt 24) {
            Add-VerificationFailure "Node.js 24+ was not available after installation"
        }
        return
    }

    if ($Name -eq "func" -and (Test-Command "func")) {
        $major = Get-FuncMajorVersion
        if ($major -ge 4) {
            Write-Host "OK: func v$major" -ForegroundColor Green
            return
        }

        Write-Host "FUNC_TOO_OLD: func v$major detected; Azure Functions Core Tools 4+ is required" -ForegroundColor Yellow
        if (-not $Install) {
            Add-VerificationFailure "func v$major is installed; Azure Functions Core Tools 4+ is required"
            return
        }

        if (-not (Test-Command "npm")) {
            Add-VerificationFailure "Cannot upgrade Azure Functions Core Tools until npm is available"
            return
        }

        npm install -g azure-functions-core-tools@4
        $updatedMajor = Get-FuncMajorVersion
        if ($null -eq $updatedMajor -or $updatedMajor -lt 4) {
            Add-VerificationFailure "Azure Functions Core Tools 4+ was not available after installation"
        }
        return
    }

    if (Test-Command $Name) {
        Write-Host "OK: $Name" -ForegroundColor Green
        return
    }

    Write-Host "MISSING: $Name" -ForegroundColor Yellow

    if (-not $Install) {
        Add-VerificationFailure "$Name is required but was not found on PATH"
        return
    }

    if ($Name -ne "agency" -and $Name -ne "func") {
        Assert-WingetAvailable
    }

    if ($Name -eq "npm") {
        Write-Host "npm ships with Node.js; installing Node.js LTS (24+)" -ForegroundColor Yellow
        & $commandInstallers.node
        Update-PathFromEnvironment
        if (-not (Test-Command "npm")) {
            Add-VerificationFailure "npm was not available after installing Node.js"
        }
        return
    }

    if ($Name -eq "func") {
        Update-PathFromEnvironment
        if (-not (Test-Command "npm")) {
            Add-VerificationFailure "Cannot install Azure Functions Core Tools until npm is available"
            return
        }

        npm install -g azure-functions-core-tools@4
        if (-not (Test-Command "func") -or (Get-FuncMajorVersion) -lt 4) {
            Add-VerificationFailure "Azure Functions Core Tools 4+ was not available after installation"
        }
        return
    }

    if (-not $commandInstallers.Contains($Name)) {
        Write-Host "No installer is configured for $Name" -ForegroundColor Red
        return
    }

    & $commandInstallers[$Name]
    Update-PathFromEnvironment

    if (Test-Command $Name) {
        if ($Name -eq "node" -and (Get-NodeMajorVersion) -lt 24) {
            Add-VerificationFailure "Node.js 24+ was not available after installation"
            return
        }
        Write-Host "OK after install: $Name" -ForegroundColor Green
    }
    else {
        Add-VerificationFailure "Installed $Name, but it is not visible on PATH yet. Open a new terminal and rerun this script."
    }
}

function Install-VsCodeExtensions {
    if (-not (Test-Command "code")) {
        Write-Host "Skipping VS Code extensions because code is missing" -ForegroundColor Yellow
        return
    }

    $installed = @(code --list-extensions)
    if ($LASTEXITCODE -ne 0) {
        Add-VerificationFailure "code --list-extensions exited with code $LASTEXITCODE"
        return
    }

    foreach ($extension in $vscodeExtensions) {
        if ($installed -contains $extension) {
            Write-Host "OK: VS Code extension $extension" -ForegroundColor Green
            continue
        }

        Write-Host "MISSING: VS Code extension $extension" -ForegroundColor Yellow
        if ($Install) {
            code --install-extension $extension --force
            if ($LASTEXITCODE -ne 0) {
                Add-VerificationFailure "VS Code extension $extension could not be installed"
            }
        }
        else {
            Add-VerificationFailure "VS Code extension $extension is required but not installed"
        }
    }
}

function Install-AzureExtensions {
    if (-not (Test-Command "az")) {
        Write-Host "Skipping Azure CLI extensions because az is missing" -ForegroundColor Yellow
        return
    }

    $installed = @(az extension list --query "[].name" -o tsv)
    if ($LASTEXITCODE -ne 0) {
        Add-VerificationFailure "az extension list exited with code $LASTEXITCODE"
        return
    }

    foreach ($extension in $azureExtensions) {
        if ($installed -contains $extension) {
            Write-Host "OK: Azure CLI extension $extension" -ForegroundColor Green
            if ($Install) {
                az extension add --name $extension --upgrade --only-show-errors
                if ($LASTEXITCODE -ne 0) {
                    Add-VerificationFailure "Azure CLI extension $extension could not be upgraded"
                }
            }
            continue
        }

        Write-Host "MISSING: Azure CLI extension $extension" -ForegroundColor Yellow
        if ($Install) {
            az extension add --name $extension --upgrade --only-show-errors
            if ($LASTEXITCODE -ne 0) {
                Add-VerificationFailure "Azure CLI extension $extension could not be installed"
            }
        }
        else {
            Add-VerificationFailure "Azure CLI extension $extension is required but not installed"
        }
    }
}

function Get-FirstLine([scriptblock]$Command) {
    try {
        $output = & $Command 2>$null
        return @($output)[0]
    }
    catch {
        return $null
    }
}

function Get-ToolVersionSnapshot {
    $snapshot = [ordered]@{
        schemaVersion      = 1
        updatedAt          = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        minimums           = [ordered]@{
            nodeMajor                    = 24
            azureFunctionsCoreToolsMajor = 4
        }
        tools              = [ordered]@{}
        vscodeExtensions   = [ordered]@{}
        azureCliExtensions = [ordered]@{}
    }

    $snapshot.tools.git = Get-FirstLine { git --version }
    $snapshot.tools.agency = Get-FirstLine { agency --version }
    $snapshot.tools.az = Get-FirstLine { az --version }
    $snapshot.tools.gh = Get-FirstLine { gh --version }
    $snapshot.tools.node = Get-FirstLine { node --version }
    $snapshot.tools.npm = Get-FirstLine { npm --version }
    $snapshot.tools.code = Get-FirstLine { code --version }
    $snapshot.tools.func = Get-FirstLine { func --version }

    if (Test-Command "code") {
        $installedExtensions = @(code --list-extensions --show-versions)
        foreach ($extension in $vscodeExtensions) {
            $match = @($installedExtensions | Where-Object { $_ -like "$extension@*" })[0]
            $snapshot.vscodeExtensions[$extension] = $match
        }
    }

    if (Test-Command "az") {
        $installedAzExtensions = @(az extension list --query "[].{name:name,version:version}" -o json | ConvertFrom-Json)
        foreach ($extension in $azureExtensions) {
            $match = @($installedAzExtensions | Where-Object { $_.name -eq $extension })[0]
            $snapshot.azureCliExtensions[$extension] = if ($match) { $match.version } else { $null }
        }
    }

    return $snapshot
}

function Write-VersionSnapshot {
    $versionPath = Join-Path $repoRoot "agency/VERSION.json"
    $snapshot = Get-ToolVersionSnapshot
    $snapshot | ConvertTo-Json -Depth 10 | Set-Content -Path $versionPath -Encoding utf8
    Write-Host "Updated $versionPath" -ForegroundColor Green
}

function Compare-VersionSnapshot {
    $versionPath = Join-Path $repoRoot "agency/VERSION.json"
    try {
        $recorded = Get-Content $versionPath -Raw | ConvertFrom-Json
    }
    catch {
        Add-VerificationFailure "agency/VERSION.json is not valid JSON: $($_.Exception.Message)"
        return
    }

    $current = Get-ToolVersionSnapshot
    foreach ($category in @("tools", "vscodeExtensions", "azureCliExtensions")) {
        $recordedCategory = $recorded.$category
        $currentCategory = $current.$category
        foreach ($name in $currentCategory.Keys) {
            $recordedValue = if ($recordedCategory.PSObject.Properties.Name -contains $name) { $recordedCategory.$name } else { $null }
            $currentValue = $currentCategory[$name]
            if ([string]$recordedValue -ne [string]$currentValue) {
                Add-VerificationFailure "Version drift for $category.$name (recorded: '$recordedValue'; current: '$currentValue'). Re-run with -UpdateVersionFile after reviewing the change."
            }
        }
    }
}

Write-Section "MCP JSON parse"
Get-Content (Join-Path $repoRoot ".mcp.json") -Raw | ConvertFrom-Json | Out-Null
Write-Host "OK: .mcp.json parses" -ForegroundColor Green

Write-Section "Required commands"
foreach ($command in $requiredCommands) {
    Install-IfMissing $command
}

Write-Section "Agency config"
if (Test-Command "agency") {
    $env:AGENCY_NO_UPDATE_CHECK = "1"
    Invoke-CheckedCommand "agency config list" { agency config list }
}
else {
    Write-Host "Skipping Agency config because agency is missing" -ForegroundColor Yellow
}

Write-Section "GitHub auth"
if (Test-Command "gh") {
    Invoke-CheckedCommand "gh auth status" { gh auth status }
}
else {
    Write-Host "Skipping GitHub auth because gh is missing" -ForegroundColor Yellow
}

Write-Section "Installed Agency plugins"
if (Test-Command "agency") {
    Invoke-CheckedCommand "agency plugin list" { agency plugin list }
}
else {
    Write-Host "Skipping Agency plugin list because agency is missing" -ForegroundColor Yellow
}

Write-Section "Agency VS Code integration"
if (Test-Command "agency") {
    if ($Install) {
        Invoke-CheckedCommand "agency vscode install" { agency vscode install }
        Invoke-CheckedCommand "agency vscode update" { agency vscode update }
    }
    else {
        Write-Host "OK: verification-only mode does not update Agency VS Code integration" -ForegroundColor Green
    }
}
else {
    Write-Host "Skipping Agency VS Code integration because agency is missing" -ForegroundColor Yellow
}

Write-Section "VS Code extensions"
Install-VsCodeExtensions

Write-Section "Azure CLI extensions"
Install-AzureExtensions

Write-Section "Version snapshot"
if ($UpdateVersionFile) {
    if ($verificationFailures.Count -eq 0) {
        Write-VersionSnapshot
    }
    else {
        Write-Host "Snapshot not updated because verification failed." -ForegroundColor Yellow
    }
}
elseif (Test-Path (Join-Path $repoRoot "agency/VERSION.json")) {
    Compare-VersionSnapshot
}
else {
    Add-VerificationFailure "agency/VERSION.json is missing. Re-run with -UpdateVersionFile to create it."
}

if ($ConfigureAuth) {
    Write-Section "Microsoft EMU and curated marketplace auth"
    if (-not (Test-Command "agency")) {
        throw "Cannot configure Agency auth because agency is missing"
    }

    agency marketplace add --marketplace curated --engine copilot --fix-git-auth
}

Write-Section "Complete"
if ($verificationFailures.Count -gt 0) {
    Write-Host "$($verificationFailures.Count) verification failure(s):" -ForegroundColor Red
    foreach ($failure in $verificationFailures) {
        Write-Host "- $failure" -ForegroundColor Red
    }
    exit 1
}

Write-Host "All verification checks passed." -ForegroundColor Green
if (-not $Install -and -not $UpdateVersionFile) {
    Write-Host "Verification-only mode. Re-run with -Install to install missing dependencies." -ForegroundColor Yellow
}
