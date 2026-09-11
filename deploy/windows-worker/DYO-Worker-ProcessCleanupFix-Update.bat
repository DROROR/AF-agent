@echo off
REM Thin launcher for DYO-Worker-ProcessCleanupFix-Update.ps1 - see
REM PROCESSCLEANUPFIX-UPDATE-README.txt. For a computer that has ALREADY
REM completed DYO-Worker-Setup.bat once. You do not need to type anything
REM into a terminal, and you will NOT be asked for a registration code.
REM Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-ProcessCleanupFix-Update.ps1"

echo.
pause
