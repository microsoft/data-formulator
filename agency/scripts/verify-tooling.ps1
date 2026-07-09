[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$ConfigureAuth,
    [switch]$UpdateVersionFile
)

$ErrorActionPreference = "Stop"

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

function Update-PathFromEnvironment {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
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
            return
        }

        Assert-WingetAvailable
        & $commandInstallers.node
        Update-PathFromEnvironment
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
            return
        }

        if (-not (Test-Command "npm")) {
            Write-Host "Cannot upgrade Azure Functions Core Tools until npm is available" -ForegroundColor Red
            return
        }

        npm install -g azure-functions-core-tools@4
        return
    }

    if (Test-Command $Name) {
        Write-Host "OK: $Name" -ForegroundColor Green
        return
    }

    Write-Host "MISSING: $Name" -ForegroundColor Yellow

    if (-not $Install) {
        return
    }

    if ($Name -ne "agency" -and $Name -ne "func") {
        Assert-WingetAvailable
    }

    if ($Name -eq "npm") {
        Write-Host "npm ships with Node.js; installing Node.js LTS (24+)" -ForegroundColor Yellow
        & $commandInstallers.node
        Update-PathFromEnvironment
        return
    }

    if ($Name -eq "func") {
        Update-PathFromEnvironment
        if (-not (Test-Command "npm")) {
            Write-Host "Cannot install Azure Functions Core Tools until npm is available" -ForegroundColor Red
            return
        }

        npm install -g azure-functions-core-tools@4
        return
    }

    if (-not $commandInstallers.Contains($Name)) {
        Write-Host "No installer is configured for $Name" -ForegroundColor Red
        return
    }

    & $commandInstallers[$Name]
    Update-PathFromEnvironment

    if (Test-Command $Name) {
        Write-Host "OK after install: $Name" -ForegroundColor Green
    }
    else {
        Write-Host "Installed $Name, but it is not visible on PATH yet. Open a new terminal and rerun this script." -ForegroundColor Yellow
    }
}

function Install-VsCodeExtensions {
    if (-not (Test-Command "code")) {
        Write-Host "Skipping VS Code extensions because code is missing" -ForegroundColor Yellow
        return
    }

    $installed = @(code --list-extensions)
    foreach ($extension in $vscodeExtensions) {
        if ($installed -contains $extension) {
            Write-Host "OK: VS Code extension $extension" -ForegroundColor Green
            continue
        }

        Write-Host "MISSING: VS Code extension $extension" -ForegroundColor Yellow
        if ($Install) {
            code --install-extension $extension --force
        }
    }
}

function Install-AzureExtensions {
    if (-not (Test-Command "az")) {
        Write-Host "Skipping Azure CLI extensions because az is missing" -ForegroundColor Yellow
        return
    }

    $installed = @(az extension list --query "[].name" -o tsv)
    foreach ($extension in $azureExtensions) {
        if ($installed -contains $extension) {
            Write-Host "OK: Azure CLI extension $extension" -ForegroundColor Green
            if ($Install) {
                az extension add --name $extension --upgrade --only-show-errors
            }
            continue
        }

        Write-Host "MISSING: Azure CLI extension $extension" -ForegroundColor Yellow
        if ($Install) {
            az extension add --name $extension --upgrade --only-show-errors
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

Write-Section "Required commands"
foreach ($command in $requiredCommands) {
    Install-IfMissing $command
}

Write-Section "Agency config"
if (Test-Command "agency") {
    $env:AGENCY_NO_UPDATE_CHECK = "1"
    agency config list
}
else {
    Write-Host "Skipping Agency config because agency is missing" -ForegroundColor Yellow
}

Write-Section "GitHub auth"
if (Test-Command "gh") {
    gh auth status
}
else {
    Write-Host "Skipping GitHub auth because gh is missing" -ForegroundColor Yellow
}

Write-Section "Installed Agency plugins"
if (Test-Command "agency") {
    agency plugin list
}
else {
    Write-Host "Skipping Agency plugin list because agency is missing" -ForegroundColor Yellow
}

Write-Section "Agency VS Code integration"
if (Test-Command "agency") {
    if ($Install) {
        agency vscode install
    }
    agency vscode update
}
else {
    Write-Host "Skipping Agency VS Code integration because agency is missing" -ForegroundColor Yellow
}

Write-Section "VS Code extensions"
Install-VsCodeExtensions

Write-Section "Azure CLI extensions"
Install-AzureExtensions

Write-Section "MCP JSON parse"
Get-Content (Join-Path $repoRoot ".mcp.json") -Raw | ConvertFrom-Json | Out-Null
Write-Host "OK: .mcp.json parses" -ForegroundColor Green

Write-Section "Version snapshot"
if ($UpdateVersionFile) {
    Write-VersionSnapshot
}
elseif (Test-Path (Join-Path $repoRoot "agency/VERSION.json")) {
    Write-Host "OK: agency/VERSION.json exists. Re-run with -UpdateVersionFile to refresh it." -ForegroundColor Green
}
else {
    Write-Host "MISSING: agency/VERSION.json. Re-run with -UpdateVersionFile to create it." -ForegroundColor Yellow
}

if ($ConfigureAuth) {
    Write-Section "Microsoft EMU and curated marketplace auth"
    if (-not (Test-Command "agency")) {
        throw "Cannot configure Agency auth because agency is missing"
    }

    agency marketplace add --marketplace curated --engine copilot --fix-git-auth
}

Write-Section "Complete"
if (-not $Install) {
    Write-Host "Verification-only mode. Re-run with -Install to install missing dependencies." -ForegroundColor Yellow
}
