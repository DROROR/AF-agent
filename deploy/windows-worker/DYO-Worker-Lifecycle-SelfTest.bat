@echo off
REM Thin launcher for DYO-Worker-Lifecycle-SelfTest.ps1 - see README-FIRST.txt.
REM Real, destructive lifecycle check: terminates the CURRENT worker process
REM (never After Effects/ae-mcp, never the Scheduled Task) and proves the
REM supervisor restarts it on its own. Only run this when no DYO job is
REM currently in progress - the script itself also checks this and refuses
REM to run if a job appears active.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-Lifecycle-SelfTest.ps1"

echo.
pause
