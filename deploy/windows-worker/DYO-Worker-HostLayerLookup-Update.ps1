<#
.SYNOPSIS
  DYO Windows Worker - Preview Timing TARGETED HOST-LAYER LOOKUP fix, for
  an ALREADY-REGISTERED install. Double-click
  DYO-Worker-HostLayerLookup-Update.bat instead of running this file
  directly.

.DESCRIPTION
  Fixes a real 2026-09-10 incident (session a7fee3d9): even after the
  prior manifest-graph update, "Analyze Preview Timing" still reported
  "Could not determine which layer in 'comp-210' hosts 'comp-1' - the
  Worker's own layer scan did not complete: ae_run_jsx failed: MCP error
  -32001: Request timed out." The manifest already proves the real
  composition path exists - the remaining expensive operation was trying
  to obtain one edge's placement timing by classifying/constructing a
  result object for EVERY layer of a large parent composition such as
  "!Render" (~40+ layers), even in the prior lightweight "discovery +
  early exit" mode. That per-layer classification cost alone, not merely
  the property reads a caller could already opt out of, was the real
  bottleneck.

  This update ships a genuinely different, minimal Worker-side operation:
  a targeted host-layer lookup that, for one already manifest-confirmed
  parent -> child composition edge, scans ONLY the parent's own immediate
  layers and does ZERO classification/object-construction work for a
  non-matching layer (only the cheapest possible check - is this layer's
  source the composition we're looking for). It performs the full timing
  property reads (stretch, time remapping, opacity) only for actual
  matches, and never breaks early, so every real placement of a
  possibly-duplicated child composition is reported - never silently
  narrowed to the first. It never builds or returns the parent's full
  layer list.

  This is a strictly ADDITIVE change:
    - No new capability, no new allowlisted tool, no new job type - this
      still runs inside the existing read-only INSPECT_SCENE_EVIDENCE
      operation.
    - Never writes, saves, or mutates anything - this lookup is read-only,
      same as every other operation in this job type.
    - Never touches any scene-editing or asset-mapping operation - this
      update has nothing to do with any of them.

  This script itself never runs INSPECT_SCENE_EVIDENCE, never connects to
  ae-mcp, and never opens or touches any After Effects project - it only
  updates program files and restarts the worker. The worker's own
  heartbeat (visible in the log tail this script prints at the end) is
  what confirms Worker/AE/MCP status afterward - nothing here fabricates
  or pre-checks that.

  Includes `npm install` (like every prior *-Update.ps1 in this folder) so
  this update is correct and self-contained regardless of exactly which
  prior update this computer has already received. Still never touches
  .env: DYO_API_URL, AE_PATH, AE_MCP_PATH, and WORK_ROOT are all left
  exactly as they already are.

  Safety, same as every prior *-Update.ps1 in this folder:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - never runs any AE-touching operation at all - this update only
      installs the fix; nothing in this script calls it.
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
Write-Host "  DYO Windows Worker - Preview Timing Host-Layer Lookup Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer with a fix for the Preview Timing Analysis feature's"
Write-Host "composition-edge timing lookup. It does not ask for a registration code,"
Write-Host "does not change which DYO Worker this computer is, and does not open,"
Write-Host "modify, or run anything against any After Effects project."
Write-Host ""

# ---- Step 1: confirm this is actually an already-registered install ----
#
# Never silently falls through to registering a new worker identity if
# credentials are missing - that would create a duplicate worker server-
# side. An operator/client who needs first-time setup must run
# DYO-Worker-Setup.bat instead, which is the only script that ever asks
# for a registration code.
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
  Write-Host "Re-download the full DYO Worker Host-Layer Lookup update package and try again."
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
  Write-Host "Check your internet connection and re-run DYO-Worker-HostLayerLookup-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-HostLayerLookup-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 3: restart DYO Worker so the update takes effect ----
#
# Restarts (stop, then start) the SAME task DYO-Worker-Setup.ps1 already
# registered - re-registering it is not required, since nothing about the
# task's action/trigger/settings changed, only the program files
# underneath it. Never touches worker-credentials.json or .env. Does NOT
# run INSPECT_SCENE_EVIDENCE, ae-mcp health, or anything else against
# ae-mcp itself - the worker's own next heartbeat (within 15 seconds) is
# what confirms real Worker/AE/MCP status, visible in the log tail below.
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
Write-Host "DYO Worker is running with the Preview Timing host-layer lookup fix, using"
Write-Host "the same DYO Worker identity this computer already had - no new"
Write-Host "registration was created. No After Effects project was opened, changed,"
Write-Host "or run against by this update."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
