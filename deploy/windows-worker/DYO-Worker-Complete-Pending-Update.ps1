<#
.SYNOPSIS
  DYO Windows Worker - complete an update that stopped part-way, and start
  exactly one DYO Worker. Double-click DYO-Worker-Complete-Pending-Update.bat
  instead of running this file directly.

.DESCRIPTION
  REAL 2026-09-15 FAILURE THIS RECOVERS FROM: DYO-Worker-RemoteDiagnostics-Update
  stopped the worker, copied the new program files, and then aborted while
  checking runtime dependencies:

    node.exe : npm notice
    CategoryInfo: NotSpecified   FullyQualifiedErrorId: NativeCommandError

  Windows PowerShell 5.1 turns anything a native program writes to stderr into
  an error record - even when that output is redirected - and the installer runs
  with $ErrorActionPreference = "Stop", so npm's harmless "npm notice" line
  terminated it before it could verify the files or start the worker again.

  This script finishes that update WITHOUT copying anything:
    1. Checks this computer's existing registration, .env and Scheduled Task
       are present (never opens worker-credentials.json or .env).
    2. Refuses if any DYO Worker process is already running, or if the
       maintenance flag is present.
    3. Proves the installed program files are byte-identical to the verified
       release (SHA-256 of the key files, and BUILD_INFO.json's commit).
    4. Runs npm through cmd.exe with its output redirected INSIDE cmd, so
       PowerShell never sees a native stderr stream, and then proves the
       runtime dependencies really load.
    5. Starts the existing "DYO Video Worker" Scheduled Task - the same startup
       mechanism the installer uses - and waits for exactly ONE supervisor and
       exactly ONE worker process, stable across two checks.

  If any check fails it stops and changes nothing further. It never registers
  this computer again, never asks for a registration code, never reads or writes
  worker-credentials.json or .env, and never opens, changes, saves or renders any
  After Effects project (including the immutable source .aep).

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent"
)

$ErrorActionPreference = "Stop"

$TaskName = "DYO Video Worker"
$ExpectedCommit = "b29653e23c3e764d55437d4a072b5446e0c7cac0"

# SHA-256 of the key files of the verified release (DYO-QA-Worker-MutationTimeouts.zip).
$ExpectedFileHashes = [ordered]@{
  "BUILD_INFO.json"                                   = "2056EEB82D3C18E54610018442D70BD838933EF5965124F5783C748F52C07DCC"
  "package.json"                                      = "3FD168F69310A678E5C04AB3653B9E198066B7ACF834325B59AEF2AB12517A44"
  "package-lock.json"                                 = "F0CBB26F21FF19BAF8F7D97CED547F7915B8D4FF17118E1A1C9338DF61905E44"
  "dist\index.js"                                     = "EF9CA79B3301B6A442DB372AE3C512406FC1F51623E866F723447BB130F56DEF"
  "dist\supervisor\index.js"                          = "EE948A382DF391BAFE7A88EE681F47660A8F4E4E5EA191B24423B0340F576FDE"
  "dist\execution\heroic-swan-ae-mutation-client.js"  = "70000E00A57703BE249A46D71B4AB46FEB94289A7AD1497227D3B443B9CCEB81"
  "dist\execution\jsx-templates.js"                   = "F9B8350DD1A622347CFF1FEE0E7342C41CB062F2E778D5EF08F6B1A88FC24A59"
  "dist\execution\execute-scene-edit-executor.js"     = "BC95079503FA4B2364641BA7ECE14127ABF7A676233E5312817B6C51879AF999"
  "dist\runtime\persist-checkpoint-with-retry.js"     = "607E54930DD086AAFAD7B5490E035A4E8DAFCE10B221355A53B24CBF0C00B586"
  "dist\workspace\working-copy.js"                    = "5BF948F7B25189078974318321F36A875F1506882EBCE80EA198552F64ED6D9E"
}

# Same narrow command-line matching as DYO-Worker-RemoteDiagnostics-Update.ps1:
# never matches ae-mcp (absolute path + "serve"), never any other node.exe.
$SupervisorPattern = [regex]::Escape("dist\supervisor\index.js")
$WorkerChildPattern = [regex]::Escape("--env-file=.env dist\index.js")

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) { Write-Host "$mark $Label - $Detail" } else { Write-Host "$mark $Label" }
}

function Stop-Here {
  param([string]$Reason)
  Write-Host ""
  Write-Host "[NEEDS ATTENTION] $Reason"
  Write-Host "Nothing was started or changed. Send this window's text to DYO."
  exit 1
}

function Get-DyoSupervisorProcesses {
  $found = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match $SupervisorPattern })
  return ,$found
}

function Get-DyoWorkerChildProcesses {
  $found = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match $WorkerChildPattern })
  return ,$found
}

# Runs a command through cmd.exe with ALL of its output redirected inside cmd,
# so Windows PowerShell never receives a native stderr stream it could turn into
# a terminating NativeCommandError. Returns the command's own exit code.
function Invoke-QuietNativeCommand {
  param([string]$CommandLine, [string]$LogPath)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & cmd.exe /d /c "$CommandLine > `"$LogPath`" 2>&1"
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

Write-Host "================================================"
Write-Host "  DYO Worker - complete the pending update"
Write-Host "================================================"
Write-Host "Copies no files, keeps this computer's DYO Worker identity and .env,"
Write-Host "and never opens or changes any After Effects project."
Write-Host ""

# ---- 1. Existing install, identity and startup task ----
if (-not (Test-Path (Join-Path $WorkRoot "state\worker-credentials.json"))) {
  Stop-Here "No saved DYO Worker registration was found - refusing to continue rather than create a new identity."
}
Write-CheckResult $true "Existing DYO Worker registration found - it will be kept"

if (-not (Test-Path (Join-Path $InstallDir ".env"))) {
  Stop-Here "No .env was found at $InstallDir."
}
Write-CheckResult $true "Existing configuration found - it will not be changed"

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -eq $task) {
  Stop-Here "The `"$TaskName`" startup task was not found."
}
Write-CheckResult $true "Startup task found" $TaskName

if (Test-Path (Join-Path $WorkRoot "state\maintenance.flag")) {
  Stop-Here "A maintenance flag is present ($WorkRoot\state\maintenance.flag) - another update or repair may be in progress."
}
Write-CheckResult $true "No maintenance in progress"

# ---- 2. Nothing may already be running (exactly-one guarantee) ----
$supervisors = @(Get-DyoSupervisorProcesses)
$children = @(Get-DyoWorkerChildProcesses)
if ($supervisors.Count -gt 0 -or $children.Count -gt 0) {
  Stop-Here "DYO Worker processes are already running (supervisor: $($supervisors.Count), worker: $($children.Count)) - not starting another."
}
Write-CheckResult $true "No DYO Worker process is running"

# ---- 3. The installed program files are exactly the verified release ----
$buildInfoPath = Join-Path $InstallDir "BUILD_INFO.json"
if (-not (Test-Path $buildInfoPath)) {
  Stop-Here "BUILD_INFO.json is missing from $InstallDir."
}
$installedCommit = (Get-Content -Path $buildInfoPath -Raw | ConvertFrom-Json).commit
if ($installedCommit -ne $ExpectedCommit) {
  Stop-Here "Installed build is $installedCommit, expected $ExpectedCommit."
}
Write-CheckResult $true "Installed build" $installedCommit

foreach ($relative in $ExpectedFileHashes.Keys) {
  $path = Join-Path $InstallDir $relative
  if (-not (Test-Path $path)) {
    Stop-Here "Installed file is missing: $path"
  }
  $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash
  if ($actual -ne $ExpectedFileHashes[$relative]) {
    Stop-Here "Installed file does not match the verified release: $relative (SHA-256 $actual)"
  }
}
Write-CheckResult $true "Installed program files match the verified release exactly" "$($ExpectedFileHashes.Count) files"

# ---- 4. Runtime dependencies, without PowerShell native-stderr handling ----
$logDir = Join-Path $InstallDir "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$npmLog = Join-Path $logDir "complete-pending-update-npm.log"

Write-Host "Checking runtime dependencies (only needs internet access if something is missing)..."
Push-Location $InstallDir
try {
  $npmExit = Invoke-QuietNativeCommand -CommandLine "npm install --omit=dev --no-audit --no-fund" -LogPath $npmLog
  if ($npmExit -eq 0) {
    Write-CheckResult $true "npm install completed" "log: $npmLog"
  } else {
    Write-Host "[WARNING] npm install exited with code $npmExit (log: $npmLog) - checking whether the installed dependencies still load..."
  }

  # A throwaway module under InstallDir (so package resolution finds
  # InstallDir\node_modules), loading exactly the runtime packages the worker
  # imports. A file avoids fragile quoting of `node -e` through cmd.exe.
  $loadLog = Join-Path $logDir "complete-pending-update-deps.log"
  $checkModule = Join-Path $logDir "complete-pending-update-deps-check.mjs"
  Set-Content -Path $checkModule -Encoding ASCII -Value @(
    'await import("pino");',
    'await import("zod");',
    'await import("@modelcontextprotocol/sdk/types.js");',
    'await import("@modelcontextprotocol/sdk/client/index.js");',
    'await import("@modelcontextprotocol/sdk/client/stdio.js");',
    'console.log("runtime dependencies load");'
  )
  $loadExit = Invoke-QuietNativeCommand -CommandLine "node `"$checkModule`"" -LogPath $loadLog
  Remove-Item -Path $checkModule -Force -ErrorAction SilentlyContinue
} finally {
  Pop-Location
}
if ($loadExit -ne 0) {
  Stop-Here "The worker's runtime dependencies do not load (log: $loadLog). The worker was NOT started."
}
Write-CheckResult $true "Runtime dependencies load (pino, zod, @modelcontextprotocol/sdk)"

# ---- 5. Start exactly one DYO Worker through the existing startup task ----
Write-Host ""
Write-Host "Starting DYO Worker..."
$startedAt = Get-Date
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds(120)
$healthy = $false
while ((Get-Date) -lt $deadline) {
  $supervisors = @(Get-DyoSupervisorProcesses)
  $children = @(Get-DyoWorkerChildProcesses)
  if ($supervisors.Count -gt 1 -or $children.Count -gt 1) { break }
  if ($supervisors.Count -eq 1 -and $children.Count -eq 1) {
    Start-Sleep -Seconds 10
    $supervisorsAgain = @(Get-DyoSupervisorProcesses)
    $childrenAgain = @(Get-DyoWorkerChildProcesses)
    if ($supervisorsAgain.Count -eq 1 -and $childrenAgain.Count -eq 1 -and $childrenAgain[0].ProcessId -eq $children[0].ProcessId) {
      $healthy = $true
    }
    break
  }
  Start-Sleep -Seconds 2
}

$supervisors = @(Get-DyoSupervisorProcesses)
$children = @(Get-DyoWorkerChildProcesses)
if (-not $healthy) {
  Write-Host "[NEEDS ATTENTION] DYO Worker did not settle into exactly one process tree (supervisor: $($supervisors.Count), worker: $($children.Count))."
  Write-Host "Do not start it again by hand. Send this window's text to DYO."
  exit 1
}
Write-CheckResult $true "Exactly one DYO Worker is running" "supervisor PID $($supervisors[0].ProcessId), worker PID $($children[0].ProcessId)"

$logPath = Join-Path $InstallDir "logs\worker.log"
Start-Sleep -Seconds 5
if (Test-Path $logPath) {
  $startLine = Get-Content -Path $logPath -Tail 200 | Where-Object { $_ -match '"msg":"worker starting"' } | Select-Object -Last 1
  if ($startLine -and $startLine -match [regex]::Escape($ExpectedCommit)) {
    Write-CheckResult $true "The running worker reports the verified build" $ExpectedCommit
  } else {
    Write-Host "[WARNING] Could not yet confirm the build from worker.log - DYO will confirm it remotely."
  }
  Write-Host ""
  Write-Host "Latest worker log lines:"
  Get-Content -Path $logPath -Tail 5 | ForEach-Object { Write-Host "  $_" }
}

Write-Host ""
Write-Host "================================================"
Write-Host "  Done - reply `"recovered`" to DYO"
Write-Host "================================================"
exit 0
