@echo off
REM Thin launcher for DYO-Worker-Setup.ps1 - see README-FIRST.txt.
REM You do not need to type anything into a terminal. Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-Setup.ps1"

echo.
pause
