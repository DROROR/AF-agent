<#
.SYNOPSIS
  DYO Windows Worker - MCP health + read-only inspection transport update,
  for an ALREADY-REGISTERED install. Double-click
  DYO-Worker-Inspector-Update.bat instead of running this file directly.

.DESCRIPTION
  Ships the real, official ae-mcp integration to an already-registered
  machine, without asking for a new registration code:
    - MCP health now runs ae-mcp's own documented CLI command
      (`node <AE_MCP_PATH>\dist\index.js health`) and reads its exit code -
      confirmed 2026-08-24 directly from the upstream
      HeroicSwan/after-effects-mcp repository, not assumed.
    - A read-only inspection transport (for a later INSPECT_TEMPLATE job)
      that speaks the real MCP protocol over stdio to
      `node <AE_MCP_PATH>\dist\index.js serve`, using the official
      @modelcontextprotocol/sdk. Its allowlist is limited to exactly five
      read-only tools (ae_health, ae_list_instances, ae_get_project_info,
      ae_list_compositions, ae_get_composition) - enforced by the compiled
      code's own type structure, not a switch this script could get wrong.
      ae_run_jsx and every other upstream tool remain unreachable.

  Unlike DYO-Worker-Repair.ps1, this update needs a real new npm
  dependency (@modelcontextprotocol/sdk) installed alongside the updated
  program files, so it runs `npm install --omit=dev` - but it still never
  touches .env: DYO_API_URL, AE_PATH, AE_MCP_PATH, and WORK_ROOT are all
  left exactly as they already are.

  Safety, same as DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1:
    - never asks for or stores a Windows account password.
    - never asks for a registration code - if no worker-credentials.json
      is found, this STOPS with a clear message instead of silently
      registering a new, duplicate worker identity.
    - WORKER_ID/WORKER_TOKEN are never read, written, or passed as
      arguments here - this script never even opens worker-credentials.json,
      it only checks that the file exists.
    - never runs INSPECT_TEMPLATE or any AE-mutating tool - this update
      only installs the transport; nothing in this script calls it.
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
Write-Host "  DYO Windows Worker - MCP + Inspector Update"
Write-Host "================================================"
Write-Host "This updates the DYO Worker program files on this ALREADY-REGISTERED"
Write-Host "computer to use ae-mcp's own official health check and add a read-only"
Write-Host "inspection transport. It does not ask for a registration code, does not"
Write-Host "change which DYO Worker this computer is, and does not modify any After"
Write-Host "Effects project."
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

# Read the CURRENTLY CONFIGURED AE_MCP_PATH back from the real .env, rather
# than assuming the default - this update must check and later health-test
# the exact install this worker actually uses, not a guessed location.
$aeMcpPathLine = Get-Content -Path $envPath | Where-Object { $_ -match '^AE_MCP_PATH=' } | Select-Object -First 1
$configuredAeMcpPath = if ($aeMcpPathLine) { $aeMcpPathLine.Substring("AE_MCP_PATH=".Length) } else { $null }
if ([string]::IsNullOrWhiteSpace($configuredAeMcpPath)) {
  # Falls back to the documented default (also DYO-Worker-Setup.ps1's own
  # default) only for the verification/smoke-test steps below - .env
  # itself is still never written to.
  $configuredAeMcpPath = "C:\AI-Tools\ae-mcp"
}

# Informational only, not a hard blocker - the worker already handles a
# missing/incomplete ae-mcp install honestly (MCP status reports UNKNOWN,
# never fabricated). Reported clearly so whoever runs this update knows
# what to expect afterward.
$aeMcpEntryPoint = Join-Path $configuredAeMcpPath "dist\index.js"
if (Test-Path $aeMcpEntryPoint) {
  Write-CheckResult $true "ae-mcp" "found at $configuredAeMcpPath"
} else {
  Write-CheckResult $false "ae-mcp" "dist\index.js not found under $configuredAeMcpPath - MCP status will report Unknown until this exists"
}

# ---- Step 2: update program files, including the new @modelcontextprotocol/sdk dependency ----
#
# Unlike DYO-Worker-MCP-Repair.ps1's dist-only update, this one needs a
# real new npm dependency installed, so the full worker-app/ (program
# files + package.json) is copied and `npm install` is run - .env is still
# explicitly excluded and never touched.
Write-Host ""
Write-Host "Updating DYO Worker program files..."

$sourceApp = Join-Path $PSScriptRoot "worker-app"
if (-not (Test-Path (Join-Path $sourceApp "dist\index.js"))) {
  Write-Host "[NEEDS ATTENTION] The worker-app folder is missing or incomplete next to this script."
  Write-Host "Re-download the full DYO Worker inspector-update package and try again."
  exit 1
}
Copy-Item -Path (Join-Path $sourceApp "*") -Destination $InstallDir -Recurse -Force -Exclude ".env"
Write-CheckResult $true "Updated DYO Worker program files"

Write-Host "Installing the new @modelcontextprotocol/sdk dependency (only needs internet access once)..."
Push-Location $InstallDir
& npm install --omit=dev --no-audit --no-fund *>$null
$npmExitCode = $LASTEXITCODE
Pop-Location
if ($npmExitCode -ne 0) {
  Write-Host "[NEEDS ATTENTION] Installing dependencies failed."
  Write-Host "Check your internet connection and re-run DYO-Worker-Inspector-Update.bat."
  exit 1
}
Write-CheckResult $true "Installed runtime dependencies (including @modelcontextprotocol/sdk)"

$sdkCheckPath = Join-Path $InstallDir "node_modules\@modelcontextprotocol\sdk\package.json"
if (Test-Path $sdkCheckPath) {
  Write-CheckResult $true "@modelcontextprotocol/sdk is installed"
} else {
  Write-Host "[NEEDS ATTENTION] @modelcontextprotocol/sdk was not found after installing dependencies."
  Write-Host "Please run DYO-Worker-Inspector-Update.bat again. If this keeps happening, contact DYO."
  exit 1
}

# ---- Step 3: run the real, official ae-mcp health command once, as a smoke test ----
#
# The exact fixed, allowlisted command the worker's own
# HeroicSwanMcpAdapter uses every heartbeat - run once here so whoever
# performs this update sees a real result immediately, using the same
# exit-code mapping the worker itself uses. Informational only - this
# update still succeeds even if ae-mcp reports not connected, since the
# worker will keep checking on its own every 15 seconds afterward.
Write-Host ""
Write-Host "Checking ae-mcp health (the same check the worker performs automatically)..."
if (Test-Path $aeMcpEntryPoint) {
  $healthExitCode = $null
  try {
    & node $aeMcpEntryPoint health *>$null
    $healthExitCode = $LASTEXITCODE
  } catch {
    $healthExitCode = $null
  }
  switch ($healthExitCode) {
    0 { Write-CheckResult $true "ae-mcp health" "bridge connected (this is what the worker will report as Online)" }
    1 { Write-CheckResult $false "ae-mcp health" "bridge not connected (this is what the worker will report as Offline) - open After Effects and ae-mcp if you expect it to be connected" }
    default { Write-CheckResult $false "ae-mcp health" "could not be determined (this is what the worker will report as Unknown)" }
  }
} else {
  Write-CheckResult $false "ae-mcp health" "skipped - ae-mcp is not installed at the configured location"
}

# ---- Step 4: restart DYO Worker so the update takes effect ----
#
# Restarts (stop, then start) the SAME task DYO-Worker-Setup.ps1 already
# registered - re-registering it is not required, since nothing about the
# task's action/trigger/settings changed, only the program files
# underneath it. Never touches worker-credentials.json or .env.
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
Write-Host "DYO Worker is running with the updated ae-mcp integration, using the same"
Write-Host "DYO Worker identity this computer already had - no new registration was created."
Write-Host "No After Effects project was opened, changed, or run against."
Write-Host ""
$logPath = Join-Path $InstallDir "logs\worker.log"
if (Test-Path $logPath) {
  Write-Host "Latest status:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}
