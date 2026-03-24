@echo off
echo ============================================================
echo   Oddity - Setup
echo ============================================================
echo.

REM Navigate to project root
cd /d "%~dp0"

REM Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found in PATH. Please install Python 3.10+.
    pause
    exit /b 1
)

echo [1/3] Creating Python virtual environment...
if not exist "backend\venv" (
    python -m venv backend\venv
    echo       Virtual environment created.
) else (
    echo       Virtual environment already exists.
)

echo.
echo [2/3] Installing PyTorch with CUDA support...
call backend\venv\Scripts\activate.bat
pip install --upgrade pip >nul 2>&1
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
if errorlevel 1 (
    echo [WARN] cu128 failed, trying cu124...
    pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
)

echo.
echo [3/3] Installing remaining dependencies...
pip install -r backend\requirements.txt

echo.
echo ============================================================
echo   Setup complete!
echo.
echo   Next steps:
echo   1. Run downloads\check_and_download.ps1 to inspect and fetch missing assets
echo   2. Run start_server.bat to launch the backend
echo   3. Open Photoshop 2025 and use the Oddity panel
echo ============================================================
pause
