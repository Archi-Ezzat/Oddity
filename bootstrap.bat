@echo off
setlocal
title Oddity Bootstrap

echo ==========================================
echo   Oddity Bootstrap
echo ==========================================
echo.
echo [1/3] Setting up Python environment...
call "%~dp0setup.bat"
if errorlevel 1 goto :fail

echo.
echo [2/3] Checking local assets...
powershell -ExecutionPolicy Bypass -File "%~dp0downloads\check_and_download.ps1"
if errorlevel 1 goto :fail

echo.
echo [3/3] Start the backend when ready:
echo   "%~dp0start_server.bat"
echo.
echo Bootstrap complete.
exit /b 0

:fail
echo.
echo Bootstrap failed.
exit /b 1
