@echo off
REM Thin launcher for DYO-Worker-ResolveCompositionById-Update.ps1 - see
REM RESOLVECOMPOSITIONBYID-UPDATE-README.txt. For a computer that has
REM ALREADY completed DYO-Worker-Setup.bat once. You do not need to type
REM anything into a terminal, and you will NOT be asked for a
REM registration code. Just double-click this file.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Worker-ResolveCompositionById-Update.ps1"

echo.
pause
