[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Installer,
    [string]$Reports = 'build/installer-test',
    [switch]$RequireSignatures
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (Test-Path 'HKCU:\Software\Microsoft\Data Formulator\Installer') {
    throw 'Use a clean test account; refusing to replace an existing installed application'
}
$installerPath = (Resolve-Path -LiteralPath $Installer).Path
$manifest = Get-Content -LiteralPath "$installerPath.payload.json" -Raw | ConvertFrom-Json
if (-not $manifest.files -or @($manifest.files).Count -eq 0) { throw 'Payload manifest is empty' }
$root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
New-Item -ItemType Directory -Force $Reports | Out-Null
$reportsPath = (Resolve-Path -LiteralPath $Reports).Path
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("dfi-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$installPath = Join-Path $temporary 'app'
New-Item -ItemType Directory $temporary | Out-Null
$dataHome = Join-Path $temporary 'data'
New-Item -ItemType Directory $dataHome | Out-Null
$sentinel = Join-Path $dataHome 'installer-retention-test.txt'
$sentinelValue = [guid]::NewGuid().ToString()
Set-Content -LiteralPath $sentinel -Value $sentinelValue -Encoding ascii
$completed = $false

function Invoke-Setup([string]$Executable, [string[]]$Arguments, [int]$ExpectedExitCode = 0) {
    $process = Start-Process -FilePath $Executable -ArgumentList $Arguments -PassThru
    if (-not $process.WaitForExit(600000)) {
        $process.Kill($true)
        throw 'Installer operation exceeded 10 minutes'
    }
    if ($process.ExitCode -ne $ExpectedExitCode) {
        throw "Installer operation returned $($process.ExitCode); expected $ExpectedExitCode"
    }
}

function Assert-Payload([string]$Directory) {
    $expected = @{}
    foreach ($file in $manifest.files) {
        if ($expected.ContainsKey($file.path)) { throw "Duplicate payload path: $($file.path)" }
        $expected[$file.path] = $file.sha256
    }
    $installedFiles = @(Get-ChildItem -LiteralPath $Directory -Recurse -File -Force)
    if ($installedFiles.Count -ne $expected.Count) { throw 'Installed payload file count differs from the manifest' }
    foreach ($file in $installedFiles) {
        $relative = [IO.Path]::GetRelativePath($Directory, $file.FullName).Replace('\', '/')
        if (-not $expected.ContainsKey($relative)) { throw "Unexpected installed file: $relative" }
        if ((Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $expected[$relative]) {
            throw "Installed file differs from the packaged payload: $relative"
        }
    }
}

function Assert-DataRetained {
    if (-not (Test-Path -LiteralPath $sentinel) -or
        (Get-Content -LiteralPath $sentinel -Raw).Trim() -ne $sentinelValue) {
        throw 'Installation lifecycle modified retained application data'
    }
}

try {
    if ($RequireSignatures -and (Get-AuthenticodeSignature -LiteralPath $installerPath).Status -ne 'Valid') {
        throw 'Installer signature is invalid'
    }
    $longInstallPath = Join-Path $temporary ('x' * 150)
    $longPathLog = Join-Path $reportsPath 'long-path.log'
    Invoke-Setup $installerPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$longInstallPath`"", "/LOG=`"$longPathLog`"") 7
    if ((Get-Content -LiteralPath $longPathLog -Raw) -notmatch 'installation path is too long') {
        throw 'Overlong installation did not report the expected path error'
    }
    if (Test-Path -LiteralPath $longInstallPath) { throw 'Overlong installation wrote application files' }
    $timer = [Diagnostics.Stopwatch]::StartNew()
    Invoke-Setup $installerPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installPath`"", "/LOG=`"$reportsPath\install.log`"")
    $timer.Stop()
    $version = (Get-ItemProperty 'HKCU:\Software\Microsoft\Data Formulator\Installer').Version
    if ($version -ne $manifest.version) { throw 'Installed version differs from the payload manifest' }
    $payload = Join-Path $installPath "versions\$version"
    $exe = Join-Path $payload 'Data Formulator.exe'
    if (-not (Test-Path -LiteralPath $exe)) { throw 'Installed application is missing' }
    Assert-Payload $payload
    Assert-DataRetained
    $uninstaller = Join-Path $installPath 'unins000.exe'
    if ($RequireSignatures) {
        foreach ($binary in Get-ChildItem -LiteralPath $installPath -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.pyd' }) {
            if ((Get-AuthenticodeSignature -LiteralPath $binary.FullName).Status -ne 'Valid') {
                throw "Installed signature is invalid: $($binary.FullName)"
            }
        }
    }
    foreach ($binary in Get-ChildItem -LiteralPath $installPath -Recurse -File | Where-Object { $_.Extension -in '.exe', '.dll', '.pyd' }) {
        $zone = Get-Content -LiteralPath $binary.FullName -Stream Zone.Identifier -ErrorAction SilentlyContinue
        if ($zone -match 'ZoneId=[34]') { throw "Installed binary retains Internet-zone metadata: $($binary.FullName)" }
    }
    & uv run --no-sync python (Join-Path $root 'packaging/test_desktop.py') --exe $exe --data-home $dataHome --reports (Join-Path $reportsPath 'runtime')
    if ($LASTEXITCODE -ne 0) { throw 'Installed application smoke test failed' }
    @{ installSeconds = $timer.Elapsed.TotalSeconds; version = $version; signed = [bool]$RequireSignatures } |
        ConvertTo-Json | Set-Content (Join-Path $reportsPath 'installation.json')
    Invoke-Setup $installerPath @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=`"$installPath`"", "/LOG=`"$reportsPath\reinstall.log`"")
    Assert-Payload $payload
    Assert-DataRetained
    & uv run --no-sync python (Join-Path $root 'packaging/test_desktop.py') --exe $exe --data-home $dataHome --reports (Join-Path $reportsPath 'reinstalled-runtime')
    if ($LASTEXITCODE -ne 0) { throw 'Reinstalled application smoke test failed' }
    Invoke-Setup $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$reportsPath\uninstall.log`"")
    Assert-DataRetained
    if (Test-Path -LiteralPath $exe) { throw 'Uninstall left the application executable behind' }
    if (Test-Path 'HKCU:\Software\Microsoft\Data Formulator\Installer') { throw 'Uninstall left installer registration behind' }
    $completed = $true
    Write-Output "PASS: install, native GUI, reinstall and uninstall; reports: $reportsPath"
} finally {
    try {
        $uninstaller = Join-Path $installPath 'unins000.exe'
        if (Test-Path -LiteralPath $uninstaller) {
            Invoke-Setup $uninstaller @('/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/LOG=`"$reportsPath\cleanup.log`"")
        }
        Remove-Item -LiteralPath $temporary -Recurse -Force
    } catch {
        if ($completed) { throw }
        Write-Warning "Cleanup failed; preserving the original test failure. Temporary files remain at ${temporary}: $_"
    }
}