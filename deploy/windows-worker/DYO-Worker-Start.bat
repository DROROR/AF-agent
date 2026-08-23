@echo off
REM Manual/troubleshooting start. Normal daily use does not need this file -
REM DYO Worker starts automatically at Windows logon once DYO-Worker-Setup.bat
REM has been run (see the "DYO Video Worker" Scheduled Task it creates).
setlocal
set "INSTALL_DIR=C:\DYO-Agent\app"
set "TASK_NAME=DYO Video Worker"

if not exist "%INSTALL_DIR%\dist\index.js" (
  echo DYO Worker is not installed yet.
  echo Please run DYO-Worker-Setup.bat first.
  echo.
  pause
  exit /b 1
)

for /f "usebackq delims=" %%S in (`powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-ScheduledTask -TaskName '%TASK_NAME%' -ErrorAction SilentlyContinue).State -eq 'Running'"`) do set "TASK_RUNNING=%%S"

if /i "%TASK_RUNNING%"=="True" (
  echo DYO Worker already appears to be running automatically in the background
  echo ^(it starts by itself when you log into Windows^).
  echo.
  echo Starting it again here would run a second, separate copy - you normally
  echo don't need to do this.
  echo.
  choice /c YN /m "Start another copy anyway, for troubleshooting"
  if errorlevel 2 exit /b 0
  echo.
)

echo ================================================
echo   DYO Worker
echo ================================================
echo Keep this window open - the worker only runs while this window is open.
echo To stop it: press Ctrl+C, close this window, or run DYO-Worker-Stop.bat.
echo.

cd /d "%INSTALL_DIR%"
node --env-file=.env dist\index.js | node dist\format-status.js

echo.
echo DYO Worker has stopped.
pause
