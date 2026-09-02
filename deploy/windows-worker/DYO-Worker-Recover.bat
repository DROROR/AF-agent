@echo off
REM Thin launcher for DYO-Worker-Recover.ps1 - one-click recovery to the
REM last known-working DYO Worker build. Does not ask for a registration
REM code and does not change any credentials/configuration.
REM Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-Recover.ps1"

echo.
pause
