@echo off
REM Stops the running DYO Worker (whether it was started automatically at
REM logon, or manually via DYO-Worker-Start.bat). Does NOT remove your
REM saved credentials or the automatic-startup task - the worker will start
REM normally again next time you log in. To remove those too, use
REM DYO-Worker-Uninstall.bat instead.
setlocal
set "TASK_NAME=DYO Video Worker"

echo Stopping DYO Worker...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$task = Get-ScheduledTask -TaskName '%TASK_NAME%' -ErrorAction SilentlyContinue; " ^
  "$stoppedAny = $false; " ^
  "if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName '%TASK_NAME%'; Write-Host '[OK] Stopped the automatic background worker.'; $stoppedAny = $true }; " ^
  "$manualProcs = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*DYO-Agent*index.js*' }; " ^
  "foreach ($p in $manualProcs) { Write-Host ('[OK] Stopped a manually-started copy (process ' + $p.ProcessId + ').'); Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue; $stoppedAny = $true }; " ^
  "if (-not $stoppedAny) { Write-Host 'DYO Worker was not running.' }"

echo.
echo Your saved credentials and automatic-startup settings were not changed.
echo DYO Worker will start normally again the next time you log into Windows.
echo.
pause
