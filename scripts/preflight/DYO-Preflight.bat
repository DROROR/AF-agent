@echo off
REM Thin launcher for DYO-Preflight.ps1 - read-only preflight, no arguments required.
REM Pass-through arguments so -ApiUrl / -AeMcpPath / -TemplatesRoot still work, e.g.:
REM   DYO-Preflight.bat -ApiUrl https://your-real-domain.example

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0DYO-Preflight.ps1" %*
