@echo off
REM Stops DYO Worker and removes ONLY the "DYO Video Worker" automatic
REM startup task - no other Windows scheduled task or app is touched.
REM Your saved credentials are kept unless you explicitly confirm below.
setlocal
set "WORK_ROOT=C:\DYO-Agent"
set "TASK_NAME=DYO Video Worker"

echo ================================================
echo   DYO Worker - Uninstall automatic startup
echo ================================================
echo This will:
echo   1. Stop DYO Worker if it is running
echo   2. Remove the "%TASK_NAME%" automatic-startup task only
echo      (no other scheduled task or program on this computer is touched)
echo.
echo It will NOT remove the DYO Worker program files unless you ask below.
echo.

echo Stopping DYO Worker...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$task = Get-ScheduledTask -TaskName '%TASK_NAME%' -ErrorAction SilentlyContinue; " ^
  "if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName '%TASK_NAME%' }; " ^
  "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*DYO-Agent*index.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"

echo Removing the "%TASK_NAME%" automatic-startup task...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$task = Get-ScheduledTask -TaskName '%TASK_NAME%' -ErrorAction SilentlyContinue; " ^
  "if ($task) { Unregister-ScheduledTask -TaskName '%TASK_NAME%' -Confirm:$false; Write-Host '[OK] Automatic-startup task removed.' } else { Write-Host 'No automatic-startup task was found (already removed, or setup was never completed).' }"

echo.
choice /c YN /m "Also delete your saved DYO Worker credentials (you would need a new registration code to reconnect this computer later)"
if errorlevel 2 goto :keepCredentials

if exist "%WORK_ROOT%\state\worker-credentials.json" (
  del /f /q "%WORK_ROOT%\state\worker-credentials.json"
  echo [OK] Saved credentials deleted.
) else (
  echo No saved credentials were found.
)
goto :done

:keepCredentials
echo Saved credentials were kept. If you reinstall later without a new
echo registration code, DYO Worker will keep using this same identity.

:done
echo.
echo DYO Worker will no longer start automatically. Program files were left
echo in place at C:\DYO-Agent\app - you can delete that folder by hand if
echo you want to remove them too.
echo.
pause
