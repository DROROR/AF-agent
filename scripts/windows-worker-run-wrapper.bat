@echo off
REM Runs the DYO Worker with logging. This is what the "DYO Video Worker"
REM Scheduled Task actually executes (see DYO-Worker-Setup.ps1) - kept as a
REM plain, ordinary .bat file rather than a single inline cmd.exe /c string
REM specifically to avoid cmd.exe's fragile nested-quote parsing. Safe to
REM double-click directly too, for troubleshooting - it behaves the same
REM either way, and rotates the previous run's log before starting.
setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
if exist "logs\worker.log" move /y "logs\worker.log" "logs\worker.log.previous" >nul

node --env-file=.env dist\index.js | node dist\format-status.js >> "logs\worker.log" 2>&1
