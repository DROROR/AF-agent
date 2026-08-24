@echo off
REM Runs the DYO Worker with logging. This is what the "DYO Video Worker"
REM Scheduled Task actually executes (see DYO-Worker-Setup.ps1) - kept as a
REM plain, ordinary .bat file rather than a single inline cmd.exe /c string
REM specifically to avoid cmd.exe's fragile nested-quote parsing. Safe to
REM double-click directly too, for troubleshooting - it behaves the same
REM either way, and rotates the previous run's log before starting.
REM
REM Deliberately does NOT pipe through format-status.js the way
REM DYO-Worker-Start.bat does for a human watching a window. In cmd.exe,
REM `cmd1 | cmd2` sets %ERRORLEVEL% to cmd2's exit code, not cmd1's -
REM format-status.js just reads stdin to EOF and exits 0 normally whether
REM the worker upstream exited 0 or crashed, so a real worker crash was
REM being silently reported to Task Scheduler as success, and
REM RestartCount/RestartInterval (see DYO-Worker-Setup.ps1) never fired.
REM This writes the worker's own raw structured (JSON) log lines directly
REM and forwards its real exit code - acceptable for unattended background
REM execution, where nobody is watching the window anyway.
setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"
if exist "logs\worker.log" move /y "logs\worker.log" "logs\worker.log.previous" >nul

node --env-file=.env dist\index.js >> "logs\worker.log" 2>&1
exit /b %ERRORLEVEL%
