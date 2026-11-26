@echo off
setlocal
title WHU Admission Assistant
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0backend-deployment\scripts\launch_app.ps1"
if errorlevel 1 (
    pause
    exit /b 1
)
exit /b 0
