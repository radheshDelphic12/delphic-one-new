<#
.SYNOPSIS
  Run the whole Delphic stack locally for development.

.DESCRIPTION
  * Postgres in Docker  (compose `db` service  -> localhost:5434)
  * API server (nodemon) -> http://localhost:4000  (hot reload)
  * Client (Vite)        -> http://localhost:5173  (hot reload, proxies /api -> :4000)

  The API and client each open in their OWN PowerShell window so you can watch
  live progress from both. Close those windows (or run `.\start-platform.ps1 -Down`)
  to stop them.

.EXAMPLE
  .\start-platform.ps1                    # db + migrate, then launch server + client windows
  .\start-platform.ps1 -Restore          # restore newest backup-*.dump (real-like data), migrate, launch
  .\start-platform.ps1 -Restore -RestoreFile .\backup-2026-09-01-113412.dump
  .\start-platform.ps1 -Seed             # instead: run the synthetic CSV seed chain
  .\start-platform.ps1 -Fresh            # wipe the DB volume, migrate, CSV-seed, launch
  .\start-platform.ps1 -DbOnly           # set the DB up (with -Restore/-Seed) then stop
  .\start-platform.ps1 -Down             # stop the db container and the dev servers
#>
[CmdletBinding()]
param(
  [switch]$Seed,
  [switch]$Fresh,
  [switch]$Restore,
  [string]$RestoreFile,
  [switch]$DbOnly,
  [switch]$Down
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Step($msg) { Write-Host "`n> $msg" -ForegroundColor Cyan }

$pgUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { 'postgres' }

if ($Fresh) { $Seed = $true }
if ($Restore -and $Seed) { throw '-Restore and -Seed/-Fresh are mutually exclusive - pick one data source' }

if ($Down) {
  Step 'Stopping the db container'
  docker compose stop db
  Step 'Stopping dev servers on :4000 and :5173 (if any)'
  foreach ($p in 4000, 5173) {
    Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique |
      ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
  }
  return
}

# 1. Postgres -----------------------------------------------------------------
if ($Fresh) {
  Step 'Wiping the Postgres volume (-Fresh)'
  docker compose down -v
}

Step 'Starting Postgres (compose service: db)'
docker compose up -d db

Step 'Waiting for Postgres to accept connections'
$ready = $false
for ($i = 1; $i -le 60; $i++) {
  docker compose exec -T db pg_isready -U $pgUser *> $null
  if ($LASTEXITCODE -eq 0) { $ready = $true; Write-Host "  ready after ${i}s"; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { throw 'Postgres did not come up in 60s' }

# 2. Dependencies + Prisma client ----------------------------------------------
if (-not (Test-Path node_modules) -or -not (Test-Path server/node_modules) -or -not (Test-Path client/node_modules)) {
  Step 'Installing workspace dependencies (npm install)'
  npm install
}

Step 'Generating Prisma client'
npm run generate --workspace server

# 3. Restore from dump (optional) -----------------------------------------
if ($Restore) {
  if (-not $RestoreFile) {
    $RestoreFile = Get-ChildItem -Path $root -Filter 'backup-*.dump' |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
  }
  if (-not $RestoreFile -or -not (Test-Path $RestoreFile)) {
    throw "No dump found. Put a 'backup-*.dump' (pg_dump -Fc) in the repo root, or pass -RestoreFile <path>."
  }
  Step "Restoring database from dump: $RestoreFile"
  $ts = Get-Date -Format 'yyyyMMdd-HHmmss'
  $safety = "pre-restore-safety-$ts.dump"
  docker compose exec -T -e PGUSER=$pgUser db sh -c 'pg_dump -Fc -f /tmp/safety.dump requirement_dashboard' 2>$null
  if ($LASTEXITCODE -eq 0) {
    docker compose cp db:/tmp/safety.dump $safety
    Write-Host "  safety snapshot: $safety"
  } else {
    Write-Host '  (no safety snapshot - current DB is missing or empty)'
  }
  docker compose cp $RestoreFile db:/tmp/restore.dump
  $restoreCmd = 'dropdb --if-exists --force requirement_dashboard && createdb requirement_dashboard && pg_restore -d requirement_dashboard --no-owner --no-privileges /tmp/restore.dump'
  docker compose exec -T -e PGUSER=$pgUser db sh -c $restoreCmd
  if ($LASTEXITCODE -ne 0) { throw "restore failed (exit $LASTEXITCODE)" }
}

# 4. Migrations -----------------------------------------------------------------
Step 'Applying migrations (prisma migrate deploy)'
npm run migrate:deploy --workspace server

# 5. CSV seed (optional) ---------------------------------------------------
if ($Seed) {
  Step 'Seeding: team roster -> LeadMinds accounts -> Jira requirements -> vendors'
  npm run seed --workspace server
  npm run seed:accounts --workspace server
  npm run seed:jira --workspace server
  npm run seed:vendors --workspace server
}

if ($DbOnly) {
  Step 'Database ready. -DbOnly: not starting dev servers.'
  Write-Host '  Postgres : localhost:5434'
  Write-Host '  Start app later with:  npm run dev:server   and   npm run dev:client'
  return
}

# 6. Dev servers (each in its own window) ----------------------------------
Step 'Launching API (:4000) and client (:5173) in separate windows'
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root'; `$host.UI.RawUI.WindowTitle = 'Delphic API :4000'; npm run dev:server"
)
Start-Process powershell -ArgumentList @(
  '-NoExit', '-Command',
  "Set-Location '$root'; `$host.UI.RawUI.WindowTitle = 'Delphic client :5173'; npm run dev:client"
)

Write-Host ''
Write-Host '  Client : http://localhost:5173'          -ForegroundColor Green
Write-Host '  API    : http://localhost:4000/api/v1/health'
Write-Host '  DB     : localhost:5434  (Prisma Studio: npm run studio --workspace server)'
Write-Host ''
Write-Host '  Stop everything:  .\start-platform.ps1 -Down' -ForegroundColor Yellow
