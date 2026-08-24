<#
.SYNOPSIS
  DYO Windows Worker - smallest-possible MCP health fix for an ALREADY-
  INSTALLED, ALREADY-REGISTERED worker. Double-click
  DYO-Worker-MCP-Repair.bat instead of running this file directly.

.DESCRIPTION
  Ships ONE fix: corrects how the worker finds ae-mcp's real heartbeat file,
  confirmed against the real upstream HeroicSwan/after-effects-mcp
  implementation (2026-08-24). The previous behavior guessed a single fixed
  path and got it wrong twice - missing ae-mcp's leading dot in ".ae-mcp",
  and assuming only one "default" instance ever exists. The worker itself
  now resolves ae-mcp's real data root (os.homedir() + ".ae-mcp") and
  discovers every `instances/*/instance.json` under it - see
  apps/worker/src/health/mcp-instance-file-adapter.ts.

  This fix needs no new dependency and no .env change at all - the
  corrected default is entirely in the compiled worker code. So, unlike
  DYO-Worker-Repair.ps1 (the general repair/update script), this:
    - does NOT run `npm install` (nothing new to install).
    - does NOT touch .env in any way (DYO_API_URL, AE_PATH, AE_MCP_PATH,
      WORK_ROOT all stay exactly as they already are).
    - only replaces the installed `dist\` program files, then restarts the
      "DYO Video Worker" Scheduled Task so the new code takes effect.

  Safety, same as DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - installed files remain restricted (via NTFS ACLs) to the current
      Windows user and SYSTEM.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state - only used to locate worker-credentials.json.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent"
)

$ErrorActionPreference = "Stop"

# Must match DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1 exactly - this
# restarts the same OS-level Scheduled Task, it does not create a second
# one and has nothing to do with the worker's own identity.
$TaskName = "DYO Video Worker"

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) {
    Write-Host "$mark $Label - $Detail"
  } else {
    Write-Host "$mark $Label"
  }
}

Write-Host "================================================"
Write-Host "  DYO Windows Worker - MCP Health Fix"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer to fix how it finds ae-mcp's status. It does not ask for a"
Write-Host "registration code and does not change which DYO Worker this computer is."
Write-Host ""

# ---- Step 1: confirm this is actually an already-registered install ----
#
# Never silently falls through to registering a new worker identity if
# credentials are missing - see DYO-Worker-Repair.ps1 for the full
# rationale (identical here).
if (-not (Test-Path $InstallDir)) {
  Write-Host "[NEEDS ATTENTION] $InstallDir was not found."
  Write-Host "This computer has not run DYO-Worker-Setup.bat yet. Please run that first -"
  Write-Host "this script only updates an existing install, it does not create one."
  exit 1
}

$credentialsPath = Join-Path $WorkRoot "state\worker-credentials.json"
if (-not (Test-Path $credentialsPath)) {
  Write-Host "[NEEDS ATTENTION] No saved worker registration was found at:"
  Write-Host "  $credentialsPath"
  Write-Host ""
  Write-Host "This script only updates an already-registered computer - it never registers"
  Write-Host "a new one, to avoid creating a duplicate DYO Worker identity. If this computer"
  Write-Host "has never been registered, please run DYO-Worker-Setup.bat instead."
  exit 1
}
Write-CheckResult $true "Existing DYO Worker registration found - it will be kept"

$envPath = Join-Path $InstallDir ".env"
if (-not (Test-Path $envPath)) {
  Write-Host "[NEEDS ATTENTION] No .env was found at:"
  Write-Host "  $envPath"
  Write-Host "This does not look like a complete install. Please run DYO-Worker-Setup.bat again."
  exit 1
}
Write-CheckResult $true "Existing configuration found - it will not be changed"

# ---- Step 2: update ONLY the compiled program files (no .env, no npm install) ----

Write-Host ""
Write-Host "Updating DYO Worker program files..."

$sourceDist = Join-Path $PSScriptRoot "worker-app\dist"
if (-not (Test-Path (Join-Path $sourceDist "index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app\dist folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker MCP fix package and try again."
  exit 1
}

$destDist = Join-Path $InstallDir "dist"
Copy-Item -Path (Join-Path $sourceDist "*") -Destination $destDist -Recurse -Force
Write-CheckResult $true "Updated DYO Worker program files"

# ---- Step 3: restart the existing Scheduled Task so the fix takes effect ----
#
# Restarts (stop, then start) the SAME task DYO-Worker-Setup.ps1 already
# registered - never re-registers or renames it, and never touches
# worker-credentials.json or .env.
Write-Host ""
Write-Host "Restarting DYO Worker..."

$existingTask = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if (-not $existingTask) {
  Write-Host "[NEEDS ATTENTION] The `"$TaskName`" automatic-startup task was not found."
  Write-Host "Program files were updated, but automatic startup could not be restarted."
  Write-Host "Please run DYO-Worker-Repair.bat (the full repair) instead, or contact DYO."
  exit 1
}

if ($existingTask.State -eq "Running") {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
}
Start-ScheduledTask -TaskName $TaskName
Start-Sleep -Seconds 5

Write-CheckResult $true "DYO Worker restarted with the updated program files"

Write-Host ""
Write-Host "================================================"
Write-Host "  MCP health fix complete"
Write-Host "================================================"
Write-Host "DYO Worker is running with the corrected ae-mcp detection, using the same"
Write-Host "DYO Worker identity this computer already had - no new registration was created."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
