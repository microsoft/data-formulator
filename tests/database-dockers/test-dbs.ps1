<#
.SYNOPSIS
Manage local Docker services for data-loader integration tests.

.EXAMPLE
.\tests\database-dockers\test-dbs.ps1 start core

.EXAMPLE
.\tests\database-dockers\test-dbs.ps1 seed-cosmos

.EXAMPLE
.\tests\database-dockers\test-dbs.ps1 test mongodb
#>

[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "seed-cosmos", "test", "config")]
    [string]$Command = "start",

    [Parameter(Position = 1)]
    [ValidateSet("core", "heavy", "all", "mysql", "postgres", "mongodb", "bigquery", "cosmosdb", "superset")]
    [string]$Target = "core",

    [switch]$Build,

    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$PytestArgs
)

$ErrorActionPreference = "Stop"

$ComposeFile = Join-Path $PSScriptRoot "docker-compose.test.yml"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path

$ServiceGroups = @{
    core = @("mysql", "postgres", "mongodb", "bigquery")
    heavy = @("cosmosdb", "superset")
    all = @("mysql", "postgres", "mongodb", "bigquery", "cosmosdb", "superset")
}

$TestPaths = @{
    mysql = "tests/database-dockers/mysql"
    postgres = "tests/database-dockers/postgres"
    mongodb = "tests/database-dockers/mongodb"
    bigquery = "tests/database-dockers/bigquery"
    cosmosdb = "tests/database-dockers/cosmosdb"
    superset = "tests/database-dockers/superset"
}

function Get-Profiles {
    param([string]$Name)
    switch ($Name) {
        "core" { return @("core") }
        "heavy" { return @("heavy") }
        "all" { return @("core", "heavy") }
        default { return @($Name) }
    }
}

function Get-Services {
    param([string]$Name)
    if ($ServiceGroups.ContainsKey($Name)) {
        return $ServiceGroups[$Name]
    }
    return @($Name)
}

function Get-ProfileArgs {
    param([string]$Name)
    $items = @()
    foreach ($profile in Get-Profiles $Name) {
        $items += @("--profile", $profile)
    }
    return $items
}

function Invoke-Compose {
    param([object[]]$ComposeArgs)
    & docker compose -f $ComposeFile @ComposeArgs
    if ($LASTEXITCODE -ne 0) {
        throw "docker compose failed with exit code $LASTEXITCODE"
    }
}

function Set-TestEnv {
    if (-not $env:PG_HOST) { $env:PG_HOST = "localhost" }
    if (-not $env:PG_PORT) { $env:PG_PORT = "5433" }
    if (-not $env:PG_USER) { $env:PG_USER = "postgres" }
    if (-not $env:PG_PASSWORD) { $env:PG_PASSWORD = "postgres" }
    if (-not $env:PG_DATABASE) { $env:PG_DATABASE = "testdb" }

    if (-not $env:MONGO_HOST) { $env:MONGO_HOST = "localhost" }
    if (-not $env:MONGO_PORT) { $env:MONGO_PORT = "27018" }
    if (-not $env:MONGO_USERNAME) { $env:MONGO_USERNAME = "testuser" }
    if (-not $env:MONGO_PASSWORD) { $env:MONGO_PASSWORD = "testpass" }
    if (-not $env:MONGO_DATABASE) { $env:MONGO_DATABASE = "testdb" }

    if (-not $env:BQ_PROJECT_ID) { $env:BQ_PROJECT_ID = "test-project" }
    if (-not $env:BQ_HTTP_ENDPOINT) { $env:BQ_HTTP_ENDPOINT = "http://localhost:9050" }

    if (-not $env:COSMOS_ENDPOINT) { $env:COSMOS_ENDPOINT = "https://localhost:8081" }
    if (-not $env:COSMOS_KEY) {
        $env:COSMOS_KEY = "C2y6yDjf5/R+ob0N8A7Cgv30VRDJIWEHLM+4QDU5DE2nQ9nDuVTqobD4b8mGGyPMbIZnqyMsEcaGQy67XIw/Jw=="
    }
    if (-not $env:COSMOS_DATABASE) { $env:COSMOS_DATABASE = "testdb" }
}

function Start-Services {
    param([string]$Name)
    $args = @(Get-ProfileArgs $Name) + @("up", "-d")
    if ($Build) {
        $args += "--build"
    }
    $args += "--wait"
    Invoke-Compose $args
}

function Stop-Services {
    param([string]$Name)
    $services = Get-Services $Name
    Invoke-Compose (@("stop") + $services)
}

function Seed-Cosmos {
    Set-TestEnv
    Push-Location $RepoRoot
    try {
        python "tests/database-dockers/cosmosdb/seed_data.py" --endpoint $env:COSMOS_ENDPOINT --key $env:COSMOS_KEY
        if ($LASTEXITCODE -ne 0) {
            throw "Cosmos DB seed failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Get-TestTargets {
    param([string]$Name)
    $services = Get-Services $Name
    $paths = @()
    foreach ($service in $services) {
        if ($TestPaths.ContainsKey($service)) {
            $paths += $TestPaths[$service]
        }
    }
    return $paths
}

Set-TestEnv

switch ($Command) {
    "start" {
        Start-Services $Target
        if ($Target -in @("cosmosdb", "heavy", "all")) {
            Seed-Cosmos
        }
    }
    "stop" {
        Stop-Services $Target
    }
    "restart" {
        Stop-Services $Target
        Start-Services $Target
        if ($Target -in @("cosmosdb", "heavy", "all")) {
            Seed-Cosmos
        }
    }
    "status" {
        Invoke-Compose @("ps", "-a")
    }
    "logs" {
        $services = Get-Services $Target
        Invoke-Compose (@("logs", "--tail", "200", "-f") + $services)
    }
    "seed-cosmos" {
        Seed-Cosmos
    }
    "test" {
        Start-Services $Target
        if ($Target -in @("cosmosdb", "heavy", "all")) {
            Seed-Cosmos
        }
        $paths = Get-TestTargets $Target
        Push-Location $RepoRoot
        try {
            $pytest = @("-m", "pytest") + $paths + @("-q") + $PytestArgs
            python @pytest
            if ($LASTEXITCODE -ne 0) {
                throw "pytest failed with exit code $LASTEXITCODE"
            }
        }
        finally {
            Pop-Location
        }
    }
    "config" {
        Invoke-Compose ((Get-ProfileArgs "all") + @("config"))
    }
}
