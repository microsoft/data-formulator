<!-- markdownlint-disable MD013 -->

# Setup GitHub EMU And Agency

Use this guide on a new machine or new project before relying on Agency MCPs,
Microsoft internal plugins, or M365 tools.

## Prerequisites

- Windows Terminal or standalone PowerShell for authentication flows.
- Windows App Installer / `winget` for automatic dependency installation.
- Internet access to Microsoft install endpoints, GitHub, Azure CLI, npm, and
  VS Code Marketplace.
- Microsoft GitHub EMU account. The username is usually `<alias>_microsoft`.

The helper can install Git, GitHub CLI, Azure CLI, Node.js 24+, VS Code, Azure
Functions Core Tools, and recommended extensions when `winget` is available.
If a tool installs but is not immediately visible on `PATH`, open a new terminal
and rerun the helper.

Avoid doing first-time auth in the VS Code integrated terminal if browser or
device-code prompts fail to appear. Native terminals handle interactive auth more
reliably.

## One-Command Local Dependency Install

From the repo root, run:

```powershell
./agency/scripts/verify-tooling.ps1 -Install
```

This installs missing/common dependencies where possible: Git, Agency CLI, Azure
CLI, GitHub CLI, Node.js 24+ and npm, VS Code, Azure Functions Core Tools,
recommended VS Code extensions, and common Azure CLI extensions.

MCP servers are configured through `.mcp.json` and `agency.toml`. The starter
installer merges those config files into an existing project; Agency provides the
built-in server proxies at runtime.

Run verification-only mode any time:

```powershell
./agency/scripts/verify-tooling.ps1
```

Refresh the tool version snapshot after installs or upgrades:

```powershell
./agency/scripts/verify-tooling.ps1 -UpdateVersionFile
```

## Install Agency CLI Manually

The Microsoft internal Agency install guide's documented one-liner has this
shape:

```powershell
iex "& { $(irm aka.ms/InstallTool.ps1)} Agency"
```

[verify-tooling.ps1](../scripts/verify-tooling.ps1) uses an equivalent
download-then-run form instead of piping the remote script straight into
`Invoke-Expression` (the one-liner above is fine to type interactively
yourself, but automated security scanning — this starter is submitted to the
Agency Playground marketplace — flags raw `iex`/`irm` piping as a dangerous
code pattern when it appears in a script that runs unattended):

```powershell
$installerPath = Join-Path ([System.IO.Path]::GetTempPath()) "InstallTool.ps1"
Invoke-WebRequest -Uri "https://aka.ms/InstallTool.ps1" -OutFile $installerPath -UseBasicParsing
& $installerPath Agency
Remove-Item -Path $installerPath -Force -ErrorAction SilentlyContinue
```

Restart the terminal, then verify:

```powershell
agency --version
```

## Sign In To Microsoft GitHub EMU

Use Agency's marketplace install path because it verifies EMU auth and configures
GitHub auth for internal plugin access:

```powershell
agency marketplace add --marketplace curated --engine copilot --fix-git-auth
```

Or run the project helper:

```powershell
./agency/scripts/verify-tooling.ps1 -ConfigureAuth
```

When prompted, sign in as your Microsoft EMU account, for example:

```text
<alias>_microsoft
```

The command should:

- launch GitHub device login,
- refresh SAML SSO authorization,
- configure Git credential helper integration, and
- install the curated marketplace for Copilot.

Verify the active GitHub account:

```powershell
gh auth status
```

If you also use a personal GitHub account for the repo, switch accounts as
needed:

```powershell
gh auth switch -u <personal-account>
gh auth switch -u <alias>_microsoft
```

## Install Agency VS Code Integration

From the repo folder:

```powershell
agency vscode install
agency vscode update
```

Reload VS Code, then run:

```powershell
code --list-extensions | Select-String -Pattern "microsoft.agency"
```

In VS Code, use the Command Palette:

```text
Agency: Refresh MCP Servers
Agency: Copilot CLI
```

## Install Azure Tooling

Recommended VS Code extensions are listed in [.vscode/extensions.json](../../.vscode/extensions.json). Install them from VS Code or with:

```powershell
$extensions = @(
  "microsoft.agency",
  "ms-azuretools.vscode-azurefunctions",
  "ms-azuretools.vscode-azureresourcegroups",
  "ms-azuretools.vscode-azurestaticwebapps",
  "ms-azuretools.vscode-bicep",
  "ms-azuretools.vscode-cosmosdb"
)

foreach ($extension in $extensions) {
  code --install-extension $extension --force
}
```

Install Azure Functions Core Tools if the project uses Azure Functions:

```powershell
npm install -g azure-functions-core-tools@4
func --version
```

Install common Azure CLI extensions:

```powershell
$extensions = @(
  "resource-graph",
  "application-insights",
  "containerapp",
  "azure-devops",
  "staticwebapp"
)

foreach ($extension in $extensions) {
  az extension add --name $extension --upgrade --only-show-errors
}
```

## Verify Project Profiles

Run:

```powershell
./agency/scripts/verify-tooling.ps1
agency copilot --profile project-ops --prompt "List MCP servers and exit. Do not call tools."
```

For M365 context, use a separate explicit check:

```powershell
agency copilot --profile project-context --prompt "List available M365 MCP servers and exit. Do not read content."
```

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `winget` is missing | Install App Installer from Microsoft Store, or install dependencies manually |
| Newly installed tool is still missing | Open a new terminal and rerun `./agency/scripts/verify-tooling.ps1 -Install` |
| Curated marketplace says no EMU account found | Re-run `agency marketplace add --marketplace curated --engine copilot --fix-git-auth` and sign in as `<alias>_microsoft` |
| Git push to personal repo fails after EMU login | Run `gh auth switch -u <personal-account>` before pushing |
| Browser/device login fails from VS Code terminal | Repeat the command from Windows Terminal or standalone PowerShell |
| MCP servers do not appear in VS Code | Run `Agency: Refresh MCP Servers`, then reload VS Code |
| `func` is missing | Install `azure-functions-core-tools@4` globally with npm |

## Consent Reminder

M365 MCPs can read work content. Do not fetch transcripts, mail, Teams messages,
OneDrive files, SharePoint pages, or M365 Copilot grounded content unless the
user explicitly asks for that content.
