param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("OLD", "NEW")]
  [string]$Name
)

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

function Read-PostgresUrl($Url) {
  $schemeMatch = [regex]::Match($Url, "^(?<scheme>postgres(?:ql)?)://(?<rest>.+)$")
  if (-not $schemeMatch.Success) {
    throw "That did not look like a PostgreSQL connection string."
  }

  $scheme = $schemeMatch.Groups["scheme"].Value
  $rest = $schemeMatch.Groups["rest"].Value
  $at = $rest.LastIndexOf("@")
  if ($at -lt 0) {
    throw "The connection string did not include a host."
  }

  $userInfo = $rest.Substring(0, $at)
  $hostAndPath = $rest.Substring($at + 1)
  $credentialSeparator = $userInfo.IndexOf(":")
  if ($credentialSeparator -lt 0) {
    throw "The connection string did not include a password."
  }

  $rawUser = $userInfo.Substring(0, $credentialSeparator)
  $rawPassword = $userInfo.Substring($credentialSeparator + 1)
  $slash = $hostAndPath.IndexOf("/")
  if ($slash -lt 0) {
    throw "The connection string did not include a database name."
  }

  $hostPort = $hostAndPath.Substring(0, $slash)
  $pathAndQuery = $hostAndPath.Substring($slash + 1)
  $querySeparator = $pathAndQuery.IndexOf("?")
  if ($querySeparator -ge 0) {
    $database = $pathAndQuery.Substring(0, $querySeparator)
    $query = $pathAndQuery.Substring($querySeparator)
  } else {
    $database = $pathAndQuery
    $query = ""
  }

  if ($hostPort.StartsWith("[")) {
    $endBracket = $hostPort.IndexOf("]")
    if ($endBracket -lt 0) {
      throw "The connection string has an invalid host."
    }
    $dbHost = $hostPort.Substring(0, $endBracket + 1)
    $port = $hostPort.Substring($endBracket + 1).TrimStart(":")
  } else {
    $lastColon = $hostPort.LastIndexOf(":")
    if ($lastColon -lt 0) {
      $dbHost = $hostPort
      $port = "5432"
    } else {
      $dbHost = $hostPort.Substring(0, $lastColon)
      $port = $hostPort.Substring($lastColon + 1)
    }
  }

  if ($port -notmatch "^\d+$") {
    throw "The connection string has an invalid port."
  }

  $decodedUser = [Uri]::UnescapeDataString($rawUser)
  $decodedPassword = [Uri]::UnescapeDataString($rawPassword)
  $encodedUser = [Uri]::EscapeDataString($decodedUser)
  $encodedPassword = [Uri]::EscapeDataString($decodedPassword)
  $normalizedUrl = "{0}://{1}:{2}@{3}:{4}/{5}{6}" -f $scheme, $encodedUser, $encodedPassword, $dbHost, $port, $database, $query

  return @{
    Host = $dbHost.Trim("[", "]")
    Port = $port
    Database = $database
    User = $decodedUser
    Password = $decodedPassword
    Url = $normalizedUrl
  }
}

$url = Read-Host "Paste the $Name database connection string"
$db = Read-PostgresUrl $url

$env:PGHOST = $db.Host
$env:PGPORT = $db.Port
$env:PGDATABASE = $db.Database
$env:PGUSER = $db.User
$env:PGPASSWORD = $db.Password

Write-Host "Testing $Name database host $env:PGHOST as $env:PGUSER..."
& (Find-Psql) -c "select now();"

if ($LASTEXITCODE -ne 0) {
  throw "Connection test failed."
}

Set-Item -Path "env:${Name}_DB_URL" -Value $db.Url
Write-Host "$Name database connection works. `$env:${Name}_DB_URL is set in this PowerShell window."
