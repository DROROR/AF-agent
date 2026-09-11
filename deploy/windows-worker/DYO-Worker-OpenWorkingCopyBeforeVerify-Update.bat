@echo off
REM Thin launcher for DYO-Worker-OpenWorkingCopyBeforeVerify-Update.ps1 - see
REM OPENWORKINGCOPYBEFOREVERIFY-UPDATE-README.txt. For a computer that has
REM ALREADY completed DYO-Worker-Setup.bat once. You do not need to type
REM anything into a terminal, and you will NOT be asked for a registration
REM code. Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-OpenWorkingCopyBeforeVerify-Update.ps1"

echo.
pause
