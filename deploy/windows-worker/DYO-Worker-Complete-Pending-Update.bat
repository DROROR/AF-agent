@echo off
REM Thin launcher for DYO-Worker-Complete-Pending-Update.ps1 - see
REM COMPLETE-PENDING-UPDATE-README.txt. Finishes an update that stopped during
REM the runtime dependency check and starts exactly one DYO Worker. It copies no
REM program files, keeps this computer's registration and .env, and never opens
REM an After Effects project. Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-Complete-Pending-Update.ps1"

echo.
pause
