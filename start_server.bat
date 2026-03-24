@echo off
echo ============================================================
echo   Oddity - FLUX.1-dev-SRPO Server
echo ============================================================
echo.

cd /d "%~dp0"

REM Use the venv interpreter directly so the project folder can be renamed safely.
if not exist "backend\venv\Scripts\python.exe" (
    echo [ERROR] Virtual environment not found. Run setup.bat first.
    pause
    exit /b 1
)

echo Starting server on http://127.0.0.1:5000 ...
echo Press Ctrl+C to stop.
echo.

backend\venv\Scripts\python.exe backend\server.py
pause
