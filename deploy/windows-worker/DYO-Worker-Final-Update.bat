@echo off
REM Thin launcher for DYO-Worker-Final-Update.ps1 - see FINAL-UPDATE-README.txt.
REM For a computer that has ALREADY completed DYO-Worker-Setup.bat once.
REM You do not need to type anything into a terminal, and you will NOT be
REM asked for a registration code. Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-Final-Update.ps1"

echo.
pause
