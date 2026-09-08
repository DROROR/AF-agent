<#
.SYNOPSIS
  DYO Windows Worker - nested/direct human-mapping EXECUTE_FRAME execution
  update, for an ALREADY-REGISTERED install. Double-click
  DYO-Worker-NestedExecution-Update.bat instead of running this file
  directly.

.DESCRIPTION
  Ships the real, deterministic execution wiring for a human-added mapping
  (a mapping created through the dashboard's Add Mapping flow, with a real,
  verified AE layer target but no manifest-detected placeholder of its
  own) to an already-registered machine, without asking for a new
  registration code and without running any edit itself:
    - SET_TEXT/MAP_FOOTAGE can now be addressed either the existing way
      (a flat layerIndex within the scene's own composition) OR by a real,
      multi-step nested target that descends through one or more precomp
      compositions before reaching the final layer - e.g. a logo or
      branding-text layer that lives several precomp levels below the
      scene's own top composition.
    - Every step of a nested target is resolved directly via its own real
      AE project item index and independently verified (the real
      composition id AND, for every step but the last, that the hop layer
      really does still reference the next composition) before any
      mutation is attempted - a broken or stale path (the template
      changed since the target was verified) fails closed with a specific
      reason, it is never guessed or silently skipped.
    - The existing flat/manifest-linked SET_TEXT/MAP_FOOTAGE path is
      completely unchanged.

  This script itself never runs any edit, never connects to ae-mcp, and
  never opens or touches any After Effects project - it only updates
  program files and restarts the worker. The worker's own heartbeat
  (visible in the log tail this script prints at the end) is what confirms
  Worker/AE/MCP status afterward - nothing here fabricates or pre-checks
  that.

  Includes `npm install` so this update is correct and self-contained
  regardless of exactly which prior update this computer has already
  received. Still never touches .env: DYO_API_URL, AE_PATH, AE_MCP_PATH,
  and WORK_ROOT are all left exactly as they already are.

  Safety, same as DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1/
  DYO-Worker-Phase5-Update.ps1/DYO-Worker-TextLayerDiscovery-Update.ps1:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - never runs any edit, inspection, or other AE-touching operation -
      this update only installs the capability; nothing in this script
      calls it.
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

# Must match DYO-Worker-Setup.ps1 exactly - this restarts the same OS-level
# Scheduled Task, it does not create a second one and has nothing to do
# with the worker's own identity.
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
Write-Host "  DYO Windows Worker - Nested Execution Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer to add real execution support for human-added mappings (direct"
Write-Host "and nested AE targets). It does not ask for a registration code, does not"
Write-Host "change which DYO Worker this computer is, and does not open, modify, or"
Write-Host "run anything against any After Effects project."
Write-Host ""

# ---- Step 1: confirm this is actually an already-registered install ----
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

# ---- Step 2: update program files, including @modelcontextprotocol/sdk if not already present ----
Write-Host ""
Write-Host "Updating DYO Worker program files..."

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker Nested Execution update package and try again."
  exit 1
}
# .env is rewritten by nothing in this script - excluded here so a stale
# worker-app/.env template (there isn't one, but never rely on that
# implicitly) can never overwrite the real installed configuration.
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-NestedExecution-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-NestedExecution-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 3: restart DYO Worker so the update takes effect ----
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
Write-Host "  Update complete"
Write-Host "================================================"
Write-Host "DYO Worker is running with real execution support for human-added mappings"
Write-Host "wired in, using the same DYO Worker identity this computer already had - no"
Write-Host "new registration was created. No After Effects project was opened, changed,"
Write-Host "or run against by this update."
Write-Host ""
Write-Host "IMPORTANT: after this update, verify only ONE DYO Worker process is running"
Write-Host "(check Task Manager for a single node.exe under the DYO Video Worker task) -"
Write-Host "a prior update on this machine was once found running stale duplicate"
Write-Host "processes side by side. If in doubt, run DYO-Worker-Stop.bat then"
Write-Host "DYO-Worker-Start.bat once, then re-check."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
