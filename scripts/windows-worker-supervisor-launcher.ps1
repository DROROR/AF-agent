<#
.SYNOPSIS
  Hidden launcher for the DYO Worker supervisor. This is what the "DYO
  Video Worker" Scheduled Task's Action actually runs (via
  `powershell.exe -WindowStyle Hidden -File <this file>`) - see
  DYO-Worker-Setup.ps1/DYO-Worker-Repair.ps1/DYO-Worker-Final-Update.ps1's
  shared Register-DyoWorkerTaskDefinition.

.DESCRIPTION
  Fixed and deterministic - takes no external input, does exactly one
  thing every time: rotate the previous run's log (same behavior
  run-worker.bat always had - once per real Task Scheduler launch, not
  per worker-child restart, so ordinary crash/restart history stays in
  one continuous log instead of being wiped on every restart), then start
  the real Node supervisor (dist\supervisor\index.js) with
  CreateNoWindow=$true/UseShellExecute=$false - so even if `-WindowStyle
  Hidden` above ever failed to suppress THIS script's own console (a
  documented PowerShell quirk: it can briefly flash before hiding), the
  supervisor's own node.exe process never allocates a console window of
  its own at all. This is the actual fix for "closing a visible console
  window can kill production DYO Worker" - there is no window to close.

  Blocks until the supervisor exits, then forwards its real exit code -
  same contract run-worker.bat always had for Task Scheduler's own
  LastTaskResult, so nothing about update-time restart verification
  changes.
#>

$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

$logPath = Join-Path $PSScriptRoot "logs\worker.log"
if (Test-Path $logPath) {
  Move-Item -Path $logPath -Destination "$logPath.previous" -Force
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "dist\supervisor\index.js"
$psi.WorkingDirectory = $PSScriptRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true

$proc = [System.Diagnostics.Process]::Start($psi)
$proc.WaitForExit()
exit $proc.ExitCode
