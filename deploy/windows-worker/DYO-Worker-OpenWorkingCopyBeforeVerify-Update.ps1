<#
.SYNOPSIS
  DYO Windows Worker - open-working-copy-before-verify fix, for an
  ALREADY-REGISTERED install. Double-click
  DYO-Worker-OpenWorkingCopyBeforeVerify-Update.bat instead of running
  this file directly.

.DESCRIPTION
  Ships the Worker-side fix for the real 2026-09-11 incident (job
  47b0b42f-bbec-4ee5-a6f1-0132591a4a89): a CREATE_PREVIEW job failed with
  "aeProjectItemIndex 3 does not resolve to any composition in this
  project" while After Effects was actually sitting on Untitled/Home with
  no session working copy open at all. The real root cause: composition
  verification (shared by CREATE_PREVIEW and final RENDER) never opened
  or checked the AE project itself - it asked AE to list compositions
  against whatever project happened to already be open, on the same
  unenforced assumption already fixed for scene-editing jobs (EXECUTE_FRAME)
  in an earlier update.

  This update makes composition verification explicitly (re-)open the
  session's own real working copy and independently confirm AE's own
  self-reported open project matches it exactly - BEFORE ever resolving a
  composition or invoking aerender. If AE is on the wrong project (or no
  project at all), CREATE_PREVIEW/RENDER now fail immediately with a
  clear, honest reason instead of the previous confusing error, and never
  proceed to render.

  This is a strictly ADDITIVE, verification-stage-only change:
    - No new capability, no new allowlisted tool, no new job type - this
      still runs inside the existing CREATE_PREVIEW/RENDER operations,
      using the SAME fixed, versioned open-project script (buildOpenProjectScript)
      INSPECT_TEMPLATE and EXECUTE_FRAME already use.
    - Never mutates, saves, or edits project content - opening a project is
      not an edit, and this never runs inside an UndoGroup for any
      content change; nothing here calls app.project.save().
    - Never touches the immutable source .aep - this verification step has
      no sourceProjectPath parameter at all; the only path it is ever
      given is the session's own derived working-copy path.
    - Never touches any scene-editing or asset-mapping operation - this
      update has nothing to do with either of them.

  This script itself never runs CREATE_PREVIEW, RENDER, or EXECUTE_FRAME,
  never connects to ae-mcp, and never opens or touches any After Effects
  project - it only updates program files and restarts the worker. The
  worker's own heartbeat (visible in the log tail this script prints at
  the end) is what confirms Worker/AE/MCP status afterward - nothing here
  fabricates or pre-checks that. The fixed verification only runs the next
  time the dashboard dispatches CREATE_PREVIEW or RENDER.

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
Write-Host "  DYO Windows Worker - Open Working Copy Before Verify Fix Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer so Complete Preview and final Render always confirm the"
Write-Host "correct session working copy is actually open in After Effects before"
Write-Host "verifying a composition or rendering - never whatever project happens"
Write-Host "to already be open. It does not ask for a registration code, does not"
Write-Host "change which DYO Worker this computer is, and does not open, modify,"
Write-Host "or run anything against the immutable source .aep."
Write-Host ""

# ---- Step 1: confirm this is actually an already-registered install ----
#
# Never silently falls through to registering a new worker identity if
# credentials are missing - that would create a duplicate worker server-
# side. An operator/client who needs first-time setup must use the full
# DYO Worker setup package instead, which is the only one that ever asks
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
  Write-Host "Re-download the full DYO Worker Open-Working-Copy-Before-Verify update package and try again."
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
  Write-Host "Check your internet connection and re-run DYO-Worker-OpenWorkingCopyBeforeVerify-Update.bat."
  exit 1
}
Write-CheckResult $true "Runtime dependencies are up to date"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-OpenWorkingCopyBeforeVerify-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 3: restart DYO Worker so the update takes effect ----
#
# Restarts (stop, then start) the SAME task DYO-Worker-Setup.ps1 already
# registered - re-registering it is not required, since nothing about the
# task's action/trigger/settings changed, only the program files
# underneath it. Never touches worker-credentials.json or .env. Does NOT
# run CREATE_PREVIEW, RENDER, EXECUTE_FRAME, or anything else against
# ae-mcp/aerender itself - the worker's own next heartbeat (within 15
# seconds) is what confirms real Worker/AE/MCP status, visible in the log
# tail below. The fixed verification only runs the next time the
# dashboard dispatches CREATE_PREVIEW or RENDER.
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
Write-Host "DYO Worker is running with the open-working-copy-before-verify fix,"
Write-Host "using the same DYO Worker identity this computer already had - no new"
Write-Host "registration was created. No After Effects project was opened, changed,"
Write-Host "or run against by this update itself. Complete Preview and Render will"
Write-Host "now always confirm the correct session working copy is open before"
Write-Host "verifying a composition, the next time either is dispatched from the"
Write-Host "dashboard."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
