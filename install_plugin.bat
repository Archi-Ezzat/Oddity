@echo off
setlocal

title Oddity Installer

echo ============================================================
echo   Oddity - Photoshop Plugin Installer
echo ============================================================
echo.

set "PLUGIN_SRC=%~dp0plugin"
set "PS_PLUGIN_DIR=C:\Program Files\Adobe\Adobe Photoshop 2025\Plug-ins"
set "OLD_PLUGIN_DEST=%PS_PLUGIN_DIR%\PhotoshopBanana"
set "PLUGIN_DEST=%PS_PLUGIN_DIR%\Oddity"

echo Source:      %PLUGIN_SRC%
echo Destination: %PLUGIN_DEST%
echo.

if not exist "%PLUGIN_SRC%\manifest.json" (
    echo [ERROR] Plugin source not found.
    echo         Expected: %PLUGIN_SRC%\manifest.json
    pause
    exit /b 1
)

if not exist "%PS_PLUGIN_DIR%" (
    echo [ERROR] Photoshop plugin directory not found:
    echo         %PS_PLUGIN_DIR%
    pause
    exit /b 1
)

echo Removing old installed copies if they exist...
if exist "%OLD_PLUGIN_DEST%" rmdir /S /Q "%OLD_PLUGIN_DEST%"
if exist "%PLUGIN_DEST%" rmdir /S /Q "%PLUGIN_DEST%"

echo.
echo Copying plugin files...
robocopy "%PLUGIN_SRC%" "%PLUGIN_DEST%" /E /NFL /NDL /NJH /NJS /NC /NS > nul
if errorlevel 8 (
    echo [ERROR] Failed to copy plugin files.
    echo         Try running this installer as Administrator.
    pause
    exit /b 1
)

echo.
echo ============================================================
echo   Oddity installed successfully.
echo ============================================================
echo.
echo Next steps:
echo   1. Run setup.bat if this machine is not prepared yet.
echo   2. Run powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1
echo   3. Run start_server.bat
echo   4. Restart Photoshop 2025
echo   5. Open Plugins ^> Oddity AI
echo.
pause
