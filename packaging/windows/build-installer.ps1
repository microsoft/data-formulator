[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PayloadDir,
    [string]$OutputDir = 'release',
    [string]$Bootstrapper,
    [string]$Compiler = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    [switch]$Unsigned,
    [string]$SignCommand
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$payload = (Resolve-Path -LiteralPath $PayloadDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $payload 'Data Formulator.exe'))) {
    throw 'Payload is missing Data Formulator.exe'
}
if (-not (Test-Path -LiteralPath $Compiler)) { throw "Inno Setup compiler not found: $Compiler" }
if ($Unsigned -and $SignCommand) { throw 'Choose unsigned CI output or a signing command, not both' }
if (-not $Unsigned -and (-not $SignCommand -or -not $SignCommand.Contains('$f'))) {
    throw 'Release builds require -SignCommand with the Inno Setup $f filename placeholder'
}

$metadataText = & uv run --no-sync python (Join-Path $root 'packaging/desktop_metadata.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not determine application version' }
$metadata = ($metadataText -join "`n") | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutputDir | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDir).Path
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("data-formulator-setup-" + [guid]::NewGuid())
New-Item -ItemType Directory $temporary | Out-Null
try {
    if (-not $Bootstrapper) {
        $Bootstrapper = Join-Path $temporary 'MicrosoftEdgeWebview2Setup.exe'
        Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $Bootstrapper
    }
    $Bootstrapper = (Resolve-Path -LiteralPath $Bootstrapper).Path
    $signature = Get-AuthenticodeSignature -LiteralPath $Bootstrapper
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
        throw 'WebView2 bootstrapper must have a valid Microsoft signature'
    }
    if (-not $Unsigned) {
        foreach ($binary in Get-ChildItem -LiteralPath $payload -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.pyd' }) {
            if ((Get-AuthenticodeSignature -LiteralPath $binary.FullName).Status -ne 'Valid') {
                throw "Unsigned or invalid payload binary: $($binary.FullName)"
            }
        }
    }
    $stagedPayload = Join-Path $temporary 'payload'
    Copy-Item -LiteralPath $payload -Destination $stagedPayload -Recurse
    Get-ChildItem -LiteralPath $stagedPayload -Filter 'CodeSignSummary-*.md' -Recurse -File | Remove-Item -Force
    Set-Content -LiteralPath (Join-Path $stagedPayload '.data-formulator-payload') -Value $metadata.version -Encoding utf8
    $arguments = @(
        "/DPayloadDir=$stagedPayload", "/DOutputDir=$output", "/DBootstrapper=$Bootstrapper",
        "/DAppVersion=$($metadata.version)", "/DWindowsVersion=$($metadata.windows_version)"
    )
    if ($Unsigned) { $arguments += '/DUnsignedBuild=1' }
    else { $arguments += "/Sdfrelease=$SignCommand" }
    & $Compiler @arguments (Join-Path $PSScriptRoot 'data-formulator.iss')
    if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed: $LASTEXITCODE" }
    $suffix = if ($Unsigned) { '-unsigned' } else { '' }
    $installer = Join-Path $output "Data-Formulator-$($metadata.version)-Windows-x64-Setup$suffix.exe"
    if (-not $Unsigned -and (Get-AuthenticodeSignature -LiteralPath $installer).Status -ne 'Valid') {
        throw 'Final installer signature is invalid'
    }
    $digest = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$installer.sha256" -Value "$digest  $([IO.Path]::GetFileName($installer))" -Encoding ascii
    $files = @(Get-ChildItem -LiteralPath $stagedPayload -Recurse -File -Force | ForEach-Object {
        @{
            path = [IO.Path]::GetRelativePath($stagedPayload, $_.FullName).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    @{
        version = $metadata.windows_version
        files = $files
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$installer.payload.json" -Encoding utf8
    Write-Output $installer
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}