[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$PayloadDir,
    [string]$OutputDir = 'release',
    [string]$Bootstrapper,
    [string]$Compiler = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    [switch]$Unsigned,
    [string]$SignCommand,
    [ValidateSet('PrepareUninstaller', 'AssembleInstaller', 'VerifyInstaller')][string]$SigningPhase,
    [string]$SignedUninstallerDir
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
. (Join-Path $PSScriptRoot 'signatures.ps1')
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$payload = (Resolve-Path -LiteralPath $PayloadDir).Path
if (-not (Test-Path -LiteralPath (Join-Path $payload 'Data Formulator.exe'))) {
    throw 'Payload is missing Data Formulator.exe'
}
if (@($Unsigned.IsPresent, [bool]$SignCommand, [bool]$SigningPhase).Where({ $_ }).Count -ne 1) {
    throw 'Choose exactly one of -Unsigned, -SignCommand, or -SigningPhase'
}
if ($SignCommand -and -not $SignCommand.Contains('$f')) {
    throw '-SignCommand requires the Inno Setup $f filename placeholder'
}
if ($SigningPhase -ne 'VerifyInstaller' -and -not (Test-Path -LiteralPath $Compiler)) {
    throw "Inno Setup compiler not found: $Compiler"
}
if ($SigningPhase -in 'PrepareUninstaller', 'AssembleInstaller' -and -not $SignedUninstallerDir) {
    throw 'External uninstaller signing requires -SignedUninstallerDir'
}
if ($SignedUninstallerDir -and $SigningPhase -notin 'PrepareUninstaller', 'AssembleInstaller') {
    throw '-SignedUninstallerDir is only used during uninstaller preparation and installer assembly'
}

$metadataText = & uv run --no-sync python (Join-Path $root 'packaging/desktop_metadata.py')
if ($LASTEXITCODE -ne 0) { throw 'Could not determine application version' }
$metadata = ($metadataText -join "`n") | ConvertFrom-Json
New-Item -ItemType Directory -Force $OutputDir | Out-Null
$output = (Resolve-Path -LiteralPath $OutputDir).Path
$suffix = if ($Unsigned) { '-unsigned' } else { '' }
$installer = Join-Path $output "Data-Formulator-$($metadata.version)-Windows-x64-Setup$suffix.exe"
if ($SigningPhase -ne 'VerifyInstaller' -and (Test-Path -LiteralPath $installer)) {
    throw "Refusing to overwrite an existing installer: $installer"
}
if ($SigningPhase -eq 'PrepareUninstaller') {
    New-Item -ItemType Directory -Force $SignedUninstallerDir | Out-Null
    if (@(Get-ChildItem -LiteralPath $SignedUninstallerDir -Force).Count -ne 0) {
        throw 'Uninstaller preparation requires an empty, isolated cache directory'
    }
}
if ($SignedUninstallerDir) {
    $SignedUninstallerDir = (Resolve-Path -LiteralPath $SignedUninstallerDir).Path
}
if ($SigningPhase -eq 'AssembleInstaller') {
    $uninstallers = @(Get-ChildItem -LiteralPath $SignedUninstallerDir -Filter '*.exe' -File)
    if ($uninstallers.Count -ne 1) { throw 'Expected exactly one externally signed uninstaller' }
    Assert-MicrosoftSignature $uninstallers[0].FullName
}
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("data-formulator-setup-" + [guid]::NewGuid())
New-Item -ItemType Directory $temporary | Out-Null
try {
    if ($SigningPhase -ne 'VerifyInstaller') {
        if (-not $Bootstrapper) {
            $Bootstrapper = Join-Path $temporary 'MicrosoftEdgeWebview2Setup.exe'
            Invoke-WebRequest -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $Bootstrapper
        }
        $Bootstrapper = (Resolve-Path -LiteralPath $Bootstrapper).Path
        $signature = Get-AuthenticodeSignature -LiteralPath $Bootstrapper
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
            throw 'WebView2 bootstrapper must have a valid Microsoft signature'
        }
    }
    if (-not $Unsigned) {
        Assert-MicrosoftSignature (Join-Path $payload 'Data Formulator.exe')
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
    $files = @(Get-ChildItem -LiteralPath $stagedPayload -Recurse -File -Force | ForEach-Object {
        @{
            path = [IO.Path]::GetRelativePath($stagedPayload, $_.FullName).Replace('\', '/')
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    $maxRelativePath = ($files | ForEach-Object {
        "versions\$($metadata.windows_version)\$($_.path)".Length
    } | Measure-Object -Maximum).Maximum
    if ($SigningPhase -ne 'VerifyInstaller') {
        $arguments = @(
            "/DPayloadDir=$stagedPayload", "/DOutputDir=$output", "/DBootstrapper=$Bootstrapper",
            "/DAppVersion=$($metadata.version)", "/DWindowsVersion=$($metadata.windows_version)",
            "/DMaxPayloadRelativePath=$maxRelativePath"
        )
        if ($Unsigned) { $arguments += '/DUnsignedBuild=1' }
        elseif ($SigningPhase) { $arguments += "/DExternalUninstallerDir=$SignedUninstallerDir" }
        else { $arguments += "/Sdfrelease=$SignCommand" }
        $PSNativeCommandUseErrorActionPreference = $false
        & $Compiler @arguments (Join-Path $PSScriptRoot 'data-formulator.iss') 2>&1 |
            Tee-Object -Variable compilerOutput | Out-Host
        $compilerExitCode = $LASTEXITCODE
        if ($SigningPhase -eq 'PrepareUninstaller') {
            $uninstallers = @(Get-ChildItem -LiteralPath $SignedUninstallerDir -Filter '*.exe' -File)
            $message = $compilerOutput -join "`n"
            if ($compilerExitCode -ne 2 -or $uninstallers.Count -ne 1 -or
                $message -notmatch 'Signed uninstaller mode is enabled' -or
                $message -notmatch 'and compile again' -or
                -not $message.Contains($uninstallers[0].FullName) -or
                (Get-AuthenticodeSignature -LiteralPath $uninstallers[0].FullName).Status -ne 'NotSigned') {
                throw "Unexpected uninstaller preparation result (compiler exit $compilerExitCode)"
            }
            if (Test-Path -LiteralPath $installer) { throw 'Preparation unexpectedly produced a setup executable' }
            Write-Output $uninstallers[0].FullName
            $global:LASTEXITCODE = 0
            return
        }
        if ($compilerExitCode -ne 0) { throw "Installer compilation failed: $compilerExitCode" }
        if ($SigningPhase -eq 'AssembleInstaller') {
            if (-not (Test-Path -LiteralPath $installer)) { throw 'Compilation did not produce an installer' }
            Write-Output $installer
            return
        }
    }
    if (-not $Unsigned) { Assert-MicrosoftSignature $installer }
    $digest = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath "$installer.sha256" -Value "$digest  $([IO.Path]::GetFileName($installer))" -Encoding ascii
    @{
        version = $metadata.windows_version
        files = $files
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath "$installer.payload.json" -Encoding utf8
    Write-Output $installer
} finally {
    Remove-Item -LiteralPath $temporary -Recurse -Force
}