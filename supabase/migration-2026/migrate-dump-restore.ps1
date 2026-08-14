param(
  [switch]$SkipDump,
  [string]$DumpDir = ""
)

$ErrorActionPreference = "Stop"

function Find-Command($Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $postgresBin = "C:\Program Files\PostgreSQL\18\bin\$Name.exe"
  if (Test-Path -LiteralPath $postgresBin) {
    return $postgresBin
  }

  throw "$Name is required. Install PostgreSQL client tools before running this migration."
}

function Invoke-Checked($FilePath, $Arguments) {
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$FilePath failed with exit code $LASTEXITCODE"
  }
}

function Require-Env($Name) {
  if (-not [Environment]::GetEnvironmentVariable($Name, "Process")) {
    throw "Set `$env:$Name before running this migration."
  }
}

function Remove-SupabaseManagedSchemaStatements($Source, $Destination) {
  Get-Content -LiteralPath $Source | Where-Object {
    $_ -notmatch "^CREATE SCHEMA public;$" -and
    $_ -notmatch "^COMMENT ON SCHEMA public IS " -and
    $_ -notmatch "^CREATE TRIGGER ff_apply_pick_schedule_before_insert " -and
    $_ -notmatch "^CREATE TRIGGER ff_notify_new_suspect_after_insert "
  } | Set-Content -LiteralPath $Destination
}

$pgDump = Find-Command "pg_dump"
$psql = Find-Command "psql"
Require-Env "OLD_DB_URL"
Require-Env "NEW_DB_URL"

$root = $PSScriptRoot
$appPublicTables = @(
  "public.ff_profiles",
  "public.ff_picks",
  "public.ff_nfl_schedule",
  "public.ff_archive_players"
)

if ($SkipDump) {
  if (-not $DumpDir) {
    throw "Pass -DumpDir when using -SkipDump."
  }
  $out = (Resolve-Path -LiteralPath $DumpDir).Path
} else {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $out = Join-Path $root "out\$stamp"
  New-Item -ItemType Directory -Force -Path $out | Out-Null
}

$schema = Join-Path $out "schema.sql"
$schemaRestore = Join-Path $out "schema.restore.sql"
$data = Join-Path $out "data.sql"
$prefixSql = Join-Path $root "020_after_restore_prefix_public_objects.sql"
$verifySql = Join-Path $root "030_verify_destination.sql"

if (-not $SkipDump) {
  Write-Host "Dumping source fantasy football schema..."
  $schemaArgs = @(
    "--dbname", $env:OLD_DB_URL,
    "--file", $schema,
    "--schema-only",
    "--no-owner",
    "--no-privileges"
  )
  foreach ($table in $appPublicTables) {
    $schemaArgs += @("--table", $table)
  }
  Invoke-Checked $pgDump $schemaArgs

  Write-Host "Dumping source app data and Auth users..."
  $dataArgs = @(
    "--dbname", $env:OLD_DB_URL,
    "--file", $data,
    "--data-only",
    "--table", "auth.users",
    "--table", "auth.identities",
    "--no-owner",
    "--no-privileges"
  )
  foreach ($table in $appPublicTables) {
    $dataArgs += @("--table", $table)
  }
  Invoke-Checked $pgDump $dataArgs
}

Write-Host "Preparing schema for a Supabase destination..."
Remove-SupabaseManagedSchemaStatements $schema $schemaRestore

Write-Host "Restoring into destination and prefixing repo-owned public objects..."
Invoke-Checked $psql @(
  "--single-transaction",
  "--variable", "ON_ERROR_STOP=1",
  "--file", $schemaRestore,
  "--command", "SET session_replication_role = replica",
  "--file", $data,
  "--file", $prefixSql,
  "--file", $verifySql,
  "--dbname", $env:NEW_DB_URL
)

Write-Host "Restore complete. Dump files are in $out"
