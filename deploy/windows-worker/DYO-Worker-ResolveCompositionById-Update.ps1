<#
.SYNOPSIS
  DYO Windows Worker - resolve-composition-by-durable-id fix, for an
  ALREADY-REGISTERED install. Double-click
  DYO-Worker-ResolveCompositionById-Update.bat instead of running this
  file directly.

.DESCRIPTION
  Ships the Worker-side fix for the real 2026-09-11 incident (job
  47b0b42f-bbec-4ee5-a6f1-0132591a4a89): a read-only diagnostic failed
  with "aeProjectItemIndex 48 resolved to composition 'Pre-comp 5',
  expected 'Scene 1'". Root cause: a composition's own recorded position
  in the After Effects project panel is not permanent - creating the
  Landscape/Reels master composition inserts a new item and shifts the
  position of every composition that comes after it, and nothing
  previously re-checked a composition's own recorded position after that
  happened.

  This update makes Complete Preview, final Render, and every read-only
  composition-inspection capability re-locate the correct composition by
  its own real, permanent After Effects identity before ever trusting a
  possibly-outdated recorded position - so a composition that has moved
  is still found correctly, and if it genuinely no longer exists, the job
  now fails with an honest, specific reason instead of silently reporting
  on or rendering the wrong one.

  This is a strictly ADDITIVE, verification-stage-only change:
    - No new capability, no new allowlisted tool, no new job type - this
      still runs inside the existing CREATE_PREVIEW/RENDER/
      INSPECT_SCENE_EVIDENCE operations, using one new fixed, versioned,
      read-only script alongside the ones already in place.
    - Never mutates, saves, or edits project content.
    - Never touches the immutable source .aep.
    - Never touches any scene-editing or asset-mapping operation - this
      update has nothing to do with either of them.

  This script itself never runs CREATE_PREVIEW, RENDER, or
  INSPECT_SCENE_EVIDENCE, never connects to ae-mcp, and never opens or
  touches any After Effects project - it only updates program files and
  restarts the worker. The worker's own heartbeat (visible in the log
  tail this script prints at the end) is what confirms Worker/AE/MCP
  status afterward. The fixed resolution only runs the next time the
  dashboard dispatches one of those operations.

  Includes `npm install` (like every prior *-Update.ps1 in this folder) so
  this update is correct and self-contained regardless of exactly which
  prior update this computer has already received. Still never touches
  .env: DYO_API_URL, AE_PATH, AE_MCP_PATH, AERENDER_PATH, and WORK_ROOT are
  all left exactly as they already are.

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
Write-Host "  DYO Windows Worker - Resolve Composition By Durable Id Fix Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer so Complete Preview, Render, and composition inspection always"
Write-Host "find the correct composition even if its position in the After Effects"
Write-Host "project panel has shifted. It does not ask for a registration code,"
Write-Host "does not change which DYO Worker this computer is, and does not open,"
Write-Host "modify, or run anything against the immutable source .aep."
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
  Write-Host "has never been registered, please use the full DYO Worker setup package instead."
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
  Write-Host "Re-download the full DYO Worker Resolve-Composition-By-Durable-Id update package and try again."
  exit 1
}
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-ResolveCompositionById-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-ResolveCompositionById-Update.bat again. If this keeps happening, contact DYO."
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
Write-Host "DYO Worker is running with the resolve-composition-by-durable-id fix,"
Write-Host "using the same DYO Worker identity this computer already had - no new"
Write-Host "registration was created. No After Effects project was opened, changed,"
Write-Host "or run against by this update itself."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
