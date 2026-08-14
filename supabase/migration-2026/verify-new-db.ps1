$ErrorActionPreference = "Stop"

function Find-Psql {
  $command = Get-Command "psql" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $postgresBin = "C:\Program Files\PostgreSQL\18\bin\psql.exe"
  if (Test-Path -LiteralPath $postgresBin) {
    return $postgresBin
  }

  throw "psql is required. Install PostgreSQL client tools first."
}

if (-not $env:NEW_DB_URL) {
  throw "NEW_DB_URL is not set in this PowerShell window. Run .\test-db-url.ps1 -Name NEW first."
}

& (Find-Psql) `
  "--set" "ON_ERROR_STOP=1" `
  "--file" (Join-Path $PSScriptRoot "030_verify_destination.sql") `
  "--dbname" $env:NEW_DB_URL

if ($LASTEXITCODE -ne 0) {
  throw "Verification failed."
}
