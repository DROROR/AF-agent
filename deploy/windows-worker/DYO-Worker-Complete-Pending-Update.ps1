<#
.SYNOPSIS
  DYO Windows Worker - complete an update that stopped part-way, replace a
  stale (non-heartbeating) DYO Worker, and start exactly one healthy DYO
  Worker. Double-click DYO-Worker-Complete-Pending-Update.bat instead of
  running this file directly.

.DESCRIPTION
  REAL 2026-09-15 FAILURE THIS RECOVERS FROM: DYO-Worker-RemoteDiagnostics-Update
  stopped the worker, copied the new program files, and then aborted while
  checking runtime dependencies ("node.exe : npm notice ... NativeCommandError"):
  Windows PowerShell 5.1 turns a native program's stderr into a terminating
  error under $ErrorActionPreference = "Stop".

  REAL 2026-09-15 FALSE-HEALTHY CHECK THIS REPLACES: the first version of this
  script refused to do anything because one supervisor and one worker process
  existed - but those processes had sent no heartbeat for 15 minutes (the
  dashboard showed the worker OFFLINE). A running process is not a healthy
  worker. An existing DYO Worker now blocks recovery ONLY when its own log
  proves it is heartbeating NOW: a "heartbeat succeeded" line (server status
  ONLINE) written by that exact worker process ID during a 60-second
  observation window - it heartbeats every ~15 s. A heartbeat from before the
  window does not count, so a worker that hung moments ago is not "healthy".

  Steps (every check stops the script before anything further is changed):
    1. Checks this computer's registration, .env and Scheduled Task exist
       (never opens worker-credentials.json or .env).
    2. Proves the installed program files are the verified release (SHA-256 of
       key files + BUILD_INFO.json commit) BEFORE touching any process.
    3. Identifies the DYO process tree by its exact command lines. Refuses if
       there is more than one tree. Watches it for 60 seconds: if it is
       heartbeating, nothing is stopped.
    4. For a stale tree: refuses if After Effects or aerender runs inside that
       tree, or if the worker log shows a job claimed without completing; saves
       the logs as evidence; re-checks it did not heartbeat in the meantime;
       then stops exactly that tree (PID + start time re-verified at the kill).
    5. Runs npm through cmd.exe (no PowerShell native-stderr handling) and
       proves the runtime dependencies load.
    6. Starts the existing "DYO Video Worker" Scheduled Task, requires exactly
       one supervisor and one worker process, then waits for two fresh
       heartbeats from that new process reporting ONLINE / AE ONLINE /
       MCP ONLINE, and prints the build commit the running worker reports.

  It never registers this computer again, never reads or writes
  worker-credentials.json or .env, never changes a project, session or plan,
  and never opens, changes, saves or renders any After Effects project
  (including the immutable source .aep). After Effects itself is never stopped.

.PARAMETER InstallDir
  Where the DYO Worker program files are installed.

.PARAMETER WorkRoot
  Local folder for worker state.

.PARAMETER AcknowledgeUnfinishedJobId
  Only when DYO has confirmed on the server that this exact job is no longer
  active: lets a stale tree whose log shows that one job claimed-but-unfinished
  be stopped. Any other unfinished job still blocks.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = "C:\DYO-Agent\app",
  [string]$WorkRoot = "C:\DYO-Agent",
  [string]$AcknowledgeUnfinishedJobId = ""
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

# The worker heartbeats every 15 s. A process that writes no successful
# heartbeat during a 60 s observation window (four intervals) is not healthy.
$StaleObservationSeconds = 60
$StartTimeoutSeconds = 120
$OnlineTimeoutSeconds = 240

# Same narrow command-line matching as DYO-Worker-RemoteDiagnostics-Update.ps1:
# never matches ae-mcp (absolute path + "serve"), never any other node.exe.
$SupervisorPattern = [regex]::Escape("dist\supervisor\index.js")
$WorkerChildPattern = [regex]::Escape("--env-file=.env dist\index.js")
$SystemProcessIdFloor = 4
# Never stopped by this script, even inside a stale tree - refuse instead.
$ProtectedDescendantNames = @("AfterFX.exe", "aerender.exe")

$WorkerLogPath = Join-Path $InstallDir "logs\worker.log"
$PreviousWorkerLogPath = "$WorkerLogPath.previous"
$script:StaleTreeStopped = $false

function Write-CheckResult {
  param([bool]$Ok, [string]$Label, [string]$Detail = "")
  $mark = if ($Ok) { "[OK]" } else { "[NEEDS ATTENTION]" }
  if ($Detail) { Write-Host "$mark $Label - $Detail" } else { Write-Host "$mark $Label" }
}

function Stop-Here {
  param([string]$Reason)
  Write-Host ""
  Write-Host "[NEEDS ATTENTION] $Reason"
  if ($script:StaleTreeStopped) {
    Write-Host "The stale (non-heartbeating) DYO Worker was stopped; no new worker was started."
  } else {
    Write-Host "No process was stopped or started."
  }
  Write-Host "Do not start DYO Worker by hand. Send this window's text to DYO."
  exit 1
}

function Get-NowUnixMs {
  return [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

function Get-ProcessStartUnixMs {
  param($Process)
  # Small tolerance for clock granularity; log lines are always written after start.
  return ([DateTimeOffset]$Process.CreationDate).ToUnixTimeMilliseconds() - 2000
}

function Test-IsDyoWorkerProcess {
  param($CandidateProcess)
  if ($null -eq $CandidateProcess) { return $false }
  if ($CandidateProcess.ProcessId -le $SystemProcessIdFloor) { return $false }
  if ($CandidateProcess.Name -ne "node.exe") { return $false }
  $cmd = $CandidateProcess.CommandLine
  if (-not $cmd) { return $false }
  return ($cmd -match $SupervisorPattern -or $cmd -match $WorkerChildPattern)
}

# REAL 2026-09-15 BUG (recovery v1/v2): `return ,$found` plus the callers'
# own @(...) nested the result, so .Count was always 1 even with ZERO DYO
# processes. Plain pipeline output gives callers the real count.
function Get-DyoSupervisorProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match $SupervisorPattern }
}

function Get-DyoWorkerChildProcesses {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -match $WorkerChildPattern }
}

function Get-LiveProcessById {
  param([int]$TargetProcessId)
  return Get-CimInstance Win32_Process -Filter "ProcessId=$TargetProcessId" -ErrorAction SilentlyContinue
}

# All descendants of one process from a single snapshot. A candidate created
# before its supposed parent is a reused PID, not a real child.
function Get-ProcessDescendants {
  param([int]$RootProcessId, $Snapshot)
  $result = New-Object System.Collections.Generic.List[object]
  $root = $Snapshot | Where-Object { $_.ProcessId -eq $RootProcessId } | Select-Object -First 1
  if ($null -eq $root) { return ,$result }
  $queue = New-Object System.Collections.Generic.Queue[object]
  $queue.Enqueue($root)
  $seen = @{ ([int]$root.ProcessId) = $true }
  while ($queue.Count -gt 0) {
    $parent = $queue.Dequeue()
    foreach ($candidate in $Snapshot) {
      if ($candidate.ParentProcessId -ne $parent.ProcessId) { continue }
      if ($seen.ContainsKey([int]$candidate.ProcessId)) { continue }
      if ($candidate.CreationDate -lt $parent.CreationDate) { continue }
      $seen[[int]$candidate.ProcessId] = $true
      $result.Add($candidate)
      $queue.Enqueue($candidate)
    }
  }
  return ,$result
}

# Same identity-verified stop as the installer: same PID, same creation time,
# still node.exe with a DYO Worker command line - anything else is left alone.
function Stop-OneProcessTree {
  param($TargetProcess, [string]$Label)
  $targetId = $TargetProcess.ProcessId
  if ($targetId -le $SystemProcessIdFloor) {
    Write-Host "[OK] Refusing to touch PID $targetId - system process IDs are never DYO Worker"
    return $true
  }
  $live = Get-LiveProcessById -TargetProcessId $targetId
  if ($null -eq $live) {
    Write-Host "[OK] $Label (PID $targetId) had already exited"
    return $true
  }
  if ($live.CreationDate -ne $TargetProcess.CreationDate -or -not (Test-IsDyoWorkerProcess -CandidateProcess $live)) {
    Write-Host "[OK] PID $targetId is no longer the DYO Worker process it was (Windows reuses process IDs) - leaving it alone"
    return $true
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    & taskkill /F /T /PID $targetId 2>&1 | Out-Null
  } catch {
    # Reported via the liveness re-check below.
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Start-Sleep -Milliseconds 500
  $stillLive = Get-LiveProcessById -TargetProcessId $targetId
  if ($null -ne $stillLive -and (Test-IsDyoWorkerProcess -CandidateProcess $stillLive) -and $stillLive.CreationDate -eq $TargetProcess.CreationDate) {
    Write-Host "[NEEDS ATTENTION] $Label (PID $targetId) is still running after being asked to stop"
    return $false
  }
  Write-Host "[OK] Stopped $Label (PID $targetId)"
  return $true
}

function Wait-ForNoDyoWorkerProcesses {
  param([int]$TimeoutSeconds = 30)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ((@(Get-DyoSupervisorProcesses)).Count -eq 0 -and (@(Get-DyoWorkerChildProcesses)).Count -eq 0) { return $true }
    Start-Sleep -Seconds 1
  }
  return ((@(Get-DyoSupervisorProcesses)).Count -eq 0 -and (@(Get-DyoWorkerChildProcesses)).Count -eq 0)
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

# The worker's own pino JSON lines that matter here, from worker.log and the
# log rotated away at the last Scheduled Task launch. Each carries "pid" (the
# worker process that wrote it) and "time" (epoch milliseconds).
function Read-WorkerLogEvents {
  $events = New-Object System.Collections.Generic.List[object]
  foreach ($path in @($PreviousWorkerLogPath, $WorkerLogPath)) {
    if (-not (Test-Path $path)) { continue }
    foreach ($line in @(Get-Content -Path $path -Tail 5000 -ErrorAction SilentlyContinue)) {
      if ($line -notmatch '"msg":"(heartbeat succeeded|heartbeat failed, will retry|job claimed|job completed|worker starting)"') { continue }
      try { $entry = $line | ConvertFrom-Json } catch { continue }
      $events.Add($entry)
    }
  }
  return ,$events
}

function Get-MatchingEvents {
  param($Events, [int]$ProcessIdToMatch, [int64]$SinceMs, [string]$Message)
  $matched = @($Events | Where-Object {
      ($ProcessIdToMatch -le 0 -or [int]$_.pid -eq $ProcessIdToMatch) -and [int64]$_.time -ge $SinceMs -and $_.msg -eq $Message
    } | Sort-Object { [int64]$_.time })
  return ,$matched
}

function Format-EventAge {
  param($LogEvent)
  if ($null -eq $LogEvent) { return "never" }
  $seconds = [math]::Round(((Get-NowUnixMs) - [int64]$LogEvent.time) / 1000)
  return "$seconds s ago"
}

function Get-ReportedCommit {
  param($Events, [int]$ProcessIdToMatch, [int64]$SinceMs)
  $starts = Get-MatchingEvents -Events $Events -ProcessIdToMatch $ProcessIdToMatch -SinceMs $SinceMs -Message "worker starting"
  if ($starts.Count -eq 0) { return $null }
  $info = $starts[-1].buildInfo
  if ($null -eq $info) { return "(no build info)" }
  return [string]$info.commit
}

# A healthy worker = a "heartbeat succeeded" line from THIS process, written at
# or after NotBeforeMs (the start of the observation window), with the server
# reporting it ONLINE.
function Get-FreshHeartbeat {
  param($Events, $ChildProcess, [int64]$NotBeforeMs)
  $sinceMs = [math]::Max($NotBeforeMs, (Get-ProcessStartUnixMs $ChildProcess))
  $beats = Get-MatchingEvents -Events $Events -ProcessIdToMatch $ChildProcess.ProcessId -SinceMs $sinceMs -Message "heartbeat succeeded"
  if ($beats.Count -eq 0) { return $null }
  $last = $beats[-1]
  if ($last.status -ne "ONLINE") { return $null }
  return $last
}

Write-Host "================================================"
Write-Host "  DYO Worker - complete the pending update"
Write-Host "================================================"
Write-Host "Copies no program files, keeps this computer's DYO Worker identity and"
Write-Host ".env, and never opens, changes or stops After Effects or any project."
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
if ($null -eq (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)) {
  Stop-Here "The `"$TaskName`" startup task was not found."
}
Write-CheckResult $true "Startup task found" $TaskName
if (Test-Path (Join-Path $WorkRoot "state\maintenance.flag")) {
  Stop-Here "A maintenance flag is present ($WorkRoot\state\maintenance.flag) - another update or repair may be in progress."
}
Write-CheckResult $true "No maintenance in progress"

# ---- 2. The installed program files are exactly the verified release ----
$buildInfoPath = Join-Path $InstallDir "BUILD_INFO.json"
if (-not (Test-Path $buildInfoPath)) { Stop-Here "BUILD_INFO.json is missing from $InstallDir." }
$installedCommit = (Get-Content -Path $buildInfoPath -Raw | ConvertFrom-Json).commit
if ($installedCommit -ne $ExpectedCommit) { Stop-Here "Installed build is $installedCommit, expected $ExpectedCommit." }
Write-CheckResult $true "Installed build" $installedCommit
foreach ($relative in $ExpectedFileHashes.Keys) {
  $path = Join-Path $InstallDir $relative
  if (-not (Test-Path $path)) { Stop-Here "Installed file is missing: $path" }
  $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash
  if ($actual -ne $ExpectedFileHashes[$relative]) {
    Stop-Here "Installed file does not match the verified release: $relative (SHA-256 $actual)"
  }
}
Write-CheckResult $true "Installed program files match the verified release exactly" "$($ExpectedFileHashes.Count) files"

# ---- 3. Identify the existing DYO process tree and whether it is heartbeating ----
$supervisors = @(Get-DyoSupervisorProcesses)
$children = @(Get-DyoWorkerChildProcesses)
if ($supervisors.Count -gt 1 -or $children.Count -gt 1) {
  Stop-Here "More than one DYO Worker process tree exists (supervisor: $($supervisors.Count), worker: $($children.Count)) - refusing to guess which one to stop."
}

if ($supervisors.Count -eq 0 -and $children.Count -eq 0) {
  Write-CheckResult $true "No DYO Worker process is running"
} else {
  foreach ($proc in @($supervisors + $children)) {
    Write-Host "  Found PID $($proc.ProcessId) (parent $($proc.ParentProcessId)), started $($proc.CreationDate): $($proc.CommandLine)"
  }
  Write-Host "Checking whether this DYO Worker is heartbeating (up to $StaleObservationSeconds seconds)..."
  $healthyBeat = $null
  $observationStartMs = Get-NowUnixMs
  $deadline = (Get-Date).AddSeconds($StaleObservationSeconds)
  while ($true) {
    $currentSupervisors = @(Get-DyoSupervisorProcesses)
    $currentChildren = @(Get-DyoWorkerChildProcesses)
    if ($currentSupervisors.Count -gt 1 -or $currentChildren.Count -gt 1) {
      Stop-Here "A second DYO Worker process appeared while checking - refusing to guess which one to stop."
    }
    if ($currentChildren.Count -eq 1) {
      $healthyBeat = Get-FreshHeartbeat -Events (Read-WorkerLogEvents) -ChildProcess $currentChildren[0] -NotBeforeMs $observationStartMs
      if ($null -ne $healthyBeat) { break }
    }
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds 5
  }

  $supervisors = @(Get-DyoSupervisorProcesses)
  $children = @(Get-DyoWorkerChildProcesses)
  $events = Read-WorkerLogEvents

  if ($null -ne $healthyBeat -and $children.Count -eq 1) {
    $runningCommit = Get-ReportedCommit -Events $events -ProcessIdToMatch $children[0].ProcessId -SinceMs (Get-ProcessStartUnixMs $children[0])
    Write-CheckResult $true "DYO Worker is already running and heartbeating - nothing was stopped" "worker PID $($children[0].ProcessId), last heartbeat $(Format-EventAge $healthyBeat): $($healthyBeat.status) | AE $($healthyBeat.aeStatus) | MCP $($healthyBeat.mcpStatus)"
    if ($runningCommit -eq $ExpectedCommit) {
      Write-CheckResult $true "The running worker reports the verified build" $runningCommit
    } else {
      Write-Host "[NEEDS ATTENTION] The running worker reports build $runningCommit, expected $ExpectedCommit. Send this window's text to DYO."
      exit 1
    }
    exit 0
  }

  # --- Stale: prove it is safe to stop exactly this tree ---
  $root = if ($supervisors.Count -eq 1) { $supervisors[0] } else { $children[0] }
  $child = if ($children.Count -eq 1) { $children[0] } else { $null }
  if ($null -ne $child -and $supervisors.Count -eq 1 -and $child.ParentProcessId -ne $supervisors[0].ProcessId) {
    Stop-Here "The DYO worker process (PID $($child.ProcessId)) is not a child of the DYO supervisor (PID $($supervisors[0].ProcessId)) - refusing to guess."
  }

  $snapshot = @(Get-CimInstance Win32_Process)
  $descendants = Get-ProcessDescendants -RootProcessId $root.ProcessId -Snapshot $snapshot
  foreach ($descendant in $descendants) {
    if ($ProtectedDescendantNames -contains $descendant.Name) {
      Stop-Here "$($descendant.Name) (PID $($descendant.ProcessId)) runs inside the stale DYO Worker tree - stopping that tree could close it and lose work."
    }
  }

  $treeStartMs = Get-ProcessStartUnixMs $root
  $lastBeat = $null
  $lastFailure = $null
  if ($null -ne $child) {
    $childBeats = Get-MatchingEvents -Events $events -ProcessIdToMatch $child.ProcessId -SinceMs (Get-ProcessStartUnixMs $child) -Message "heartbeat succeeded"
    if ($childBeats.Count -gt 0) { $lastBeat = $childBeats[-1] }
    $childFailures = Get-MatchingEvents -Events $events -ProcessIdToMatch $child.ProcessId -SinceMs (Get-ProcessStartUnixMs $child) -Message "heartbeat failed, will retry"
    if ($childFailures.Count -gt 0) { $lastFailure = $childFailures[-1] }
    $staleCommit = Get-ReportedCommit -Events $events -ProcessIdToMatch $child.ProcessId -SinceMs (Get-ProcessStartUnixMs $child)
    Write-Host "  Stale worker PID $($child.ProcessId): build it reported at start: $(if ($staleCommit) { $staleCommit } else { 'no start line in the log' })"
  }
  Write-Host "  Last successful heartbeat from it: $(Format-EventAge $lastBeat); last failed heartbeat: $(Format-EventAge $lastFailure)"
  if ($null -ne $lastFailure) { Write-Host "  Last heartbeat error: $($lastFailure.error)" }
  Write-CheckResult $true "The existing DYO Worker is NOT heartbeating" "no successful heartbeat from it while watching for $StaleObservationSeconds s"

  # Any job this tree (any worker process since the supervisor started) claimed but never completed.
  $claimed = Get-MatchingEvents -Events $events -ProcessIdToMatch 0 -SinceMs $treeStartMs -Message "job claimed"
  $completed = Get-MatchingEvents -Events $events -ProcessIdToMatch 0 -SinceMs $treeStartMs -Message "job completed"
  $completedIds = @($completed | ForEach-Object { [string]$_.jobId })
  $unfinished = @($claimed | Where-Object { $completedIds -notcontains [string]$_.jobId } | ForEach-Object { [string]$_.jobId } | Select-Object -Unique)
  if ($unfinished.Count -gt 0) {
    if ($unfinished.Count -eq 1 -and $AcknowledgeUnfinishedJobId -and $unfinished[0] -eq $AcknowledgeUnfinishedJobId) {
      Write-Host "[OK] Job $($unfinished[0]) was claimed without completing; DYO confirmed it is no longer active on the server"
    } else {
      Stop-Here "The worker log shows job(s) claimed but never completed: $($unfinished -join ', ') - it may still be running."
    }
  } else {
    Write-CheckResult $true "No active job in the stale DYO Worker" "no claimed-but-unfinished job in its log, no After Effects or aerender in its process tree"
  }

  # Evidence first: the next Scheduled Task launch rotates worker.log away.
  $evidenceDir = Join-Path $InstallDir ("logs\stale-worker-evidence-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Path $evidenceDir | Out-Null
  foreach ($logFile in @($WorkerLogPath, $PreviousWorkerLogPath)) {
    if (Test-Path $logFile) { Copy-Item -Path $logFile -Destination $evidenceDir -Force }
  }
  @($root) + @($descendants) | Select-Object ProcessId, ParentProcessId, Name, CreationDate, CommandLine |
    Format-List | Out-String -Width 400 | Set-Content -Path (Join-Path $evidenceDir "stale-process-tree.txt")
  Write-CheckResult $true "Saved the stale worker's logs and process tree" $evidenceDir

  # Last race check: never stop a worker that heartbeated since we decided it was stale.
  if ($null -ne $child) {
    $recheckChild = Get-LiveProcessById -TargetProcessId $child.ProcessId
    if ($null -ne $recheckChild -and $recheckChild.CreationDate -eq $child.CreationDate -and $null -ne (Get-FreshHeartbeat -Events (Read-WorkerLogEvents) -ChildProcess $recheckChild -NotBeforeMs $observationStartMs)) {
      Stop-Here "The DYO Worker heartbeated just now - it is not stale, so it was not stopped."
    }
  }

  Write-Host "Stopping the stale DYO Worker..."
  $script:StaleTreeStopped = $true
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  # Supervisor FIRST: a supervisor whose child is stopped first spawns a replacement.
  foreach ($proc in $supervisors) { [void](Stop-OneProcessTree -TargetProcess $proc -Label "stale DYO Worker supervisor") }
  foreach ($proc in $children) { [void](Stop-OneProcessTree -TargetProcess $proc -Label "stale DYO Worker process") }
  if (-not (Wait-ForNoDyoWorkerProcesses -TimeoutSeconds 30)) {
    Stop-Here "DYO Worker processes are still running after stopping the stale tree - not starting another."
  }
  Write-CheckResult $true "The stale DYO Worker has stopped"
}

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
  Stop-Here "The worker's runtime dependencies do not load (log: $loadLog)."
}
Write-CheckResult $true "Runtime dependencies load (pino, zod, @modelcontextprotocol/sdk)"

# ---- 5. Start exactly one DYO Worker through the existing startup task ----
Write-Host ""
Write-Host "Starting DYO Worker..."
$startedAtMs = Get-NowUnixMs
Start-ScheduledTask -TaskName $TaskName

$deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
$treeUp = $false
while ((Get-Date) -lt $deadline) {
  $supervisors = @(Get-DyoSupervisorProcesses)
  $children = @(Get-DyoWorkerChildProcesses)
  if ($supervisors.Count -gt 1 -or $children.Count -gt 1) {
    Stop-Here "More than one DYO Worker process started (supervisor: $($supervisors.Count), worker: $($children.Count))."
  }
  if ($supervisors.Count -eq 1 -and $children.Count -eq 1) { $treeUp = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $treeUp) {
  Stop-Here "DYO Worker did not start one supervisor and one worker process within $StartTimeoutSeconds s (supervisor: $($supervisors.Count), worker: $($children.Count))."
}
Write-CheckResult $true "Exactly one DYO Worker process tree started" "supervisor PID $($supervisors[0].ProcessId), worker PID $($children[0].ProcessId)"

# ---- 6. Fresh heartbeats: ONLINE | AE ONLINE | MCP ONLINE from the new process ----
Write-Host "Waiting for fresh heartbeats (up to $OnlineTimeoutSeconds seconds)..."
$deadline = (Get-Date).AddSeconds($OnlineTimeoutSeconds)
$lastBeat = $null
$online = $false
while ((Get-Date) -lt $deadline) {
  $supervisors = @(Get-DyoSupervisorProcesses)
  $children = @(Get-DyoWorkerChildProcesses)
  if ($supervisors.Count -gt 1 -or $children.Count -gt 1) {
    Write-Host "[NEEDS ATTENTION] More than one DYO Worker process is running (supervisor: $($supervisors.Count), worker: $($children.Count)). Send this window's text to DYO."
    exit 1
  }
  if ($children.Count -eq 1) {
    $sinceMs = [math]::Max($startedAtMs, (Get-ProcessStartUnixMs $children[0]))
    $beats = Get-MatchingEvents -Events (Read-WorkerLogEvents) -ProcessIdToMatch $children[0].ProcessId -SinceMs $sinceMs -Message "heartbeat succeeded"
    if ($beats.Count -gt 0) { $lastBeat = $beats[-1] }
    if ($beats.Count -ge 2 -and $lastBeat.status -eq "ONLINE" -and $lastBeat.aeStatus -eq "ONLINE" -and $lastBeat.mcpStatus -eq "ONLINE") {
      $online = $true
      break
    }
  }
  Start-Sleep -Seconds 5
}

if ($null -eq $lastBeat) {
  Write-Host "[NEEDS ATTENTION] The new DYO Worker has not sent a successful heartbeat within $OnlineTimeoutSeconds s. It was left running. Send this window's text to DYO."
  if (Test-Path $WorkerLogPath) { Get-Content -Path $WorkerLogPath -Tail 15 | ForEach-Object { Write-Host "  $_" } }
  exit 1
}
if (-not $online) {
  Write-Host "[NEEDS ATTENTION] The new DYO Worker is heartbeating but reports $($lastBeat.status) | AE $($lastBeat.aeStatus) | MCP $($lastBeat.mcpStatus). It was left running. Send this window's text to DYO."
  exit 1
}
Write-CheckResult $true "Fresh heartbeats" "$($lastBeat.status) | AE $($lastBeat.aeStatus) | MCP $($lastBeat.mcpStatus) (worker PID $($children[0].ProcessId), last $(Format-EventAge $lastBeat))"

$runningCommit = Get-ReportedCommit -Events (Read-WorkerLogEvents) -ProcessIdToMatch $children[0].ProcessId -SinceMs $startedAtMs
if ($runningCommit -ne $ExpectedCommit) {
  Write-Host "[NEEDS ATTENTION] The running worker reports build $runningCommit, expected $ExpectedCommit. Send this window's text to DYO."
  exit 1
}
Write-CheckResult $true "The running worker reports build" $runningCommit

Write-Host ""
Write-Host "================================================"
Write-Host "  Done - reply `"recovered`" to DYO"
Write-Host "================================================"
exit 0
