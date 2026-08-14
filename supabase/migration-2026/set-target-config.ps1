param(
  [string]$PublishableKey = ""
)

$ErrorActionPreference = "Stop"

if (-not $PublishableKey) {
  $PublishableKey = Read-Host "Paste the NEW Supabase publishable key"
}

if (-not $PublishableKey.StartsWith("sb_publishable_")) {
  throw "That did not look like a Supabase publishable key."
}

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path
$templatePath = Join-Path $PSScriptRoot "supabase-config.target.example.js"
$configPath = Join-Path $repoRoot "js\supabase-config.js"

$content = Get-Content -LiteralPath $templatePath -Raw
$content = $content.Replace("PASTE_NEW_PUBLISHABLE_KEY_HERE", $PublishableKey)
Set-Content -LiteralPath $configPath -Value $content

Write-Host "js\supabase-config.js now points at vkoczgzizzppdrpvpemh and _2026_* tables."
