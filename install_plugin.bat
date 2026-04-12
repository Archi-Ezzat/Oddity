@echo off
setlocal enabledelayedexpansion

title Oddity Installer

echo ============================================================
echo   Oddity - Photoshop Plugin Installer
echo ============================================================
echo.

set "PLUGIN_SRC=%~dp0plugin"

if not exist "%PLUGIN_SRC%\manifest.json" (
    echo [ERROR] Plugin source not found.
    echo         Expected: %PLUGIN_SRC%\manifest.json
    pause
    exit /b 1
)

set "FOUND_PS=0"

for /d %%D in ("C:\Program Files\Adobe\Adobe Photoshop *") do (
    if exist "%%D\Photoshop.exe" (
        echo Found Photoshop at: %%D
        set "FOUND_PS=1"
        set "OLD_PLUGIN_DEST=%%D\Plug-ins\PhotoshopBanana"
        set "PLUGIN_DEST=%%D\Plug-ins\Oddity"
        
        echo Removing old installed copies if they exist...
        if exist "!OLD_PLUGIN_DEST!" rmdir /S /Q "!OLD_PLUGIN_DEST!"
        if exist "!PLUGIN_DEST!" rmdir /S /Q "!PLUGIN_DEST!"
        
        echo Copying plugin files to !PLUGIN_DEST!...
        robocopy "%PLUGIN_SRC%" "!PLUGIN_DEST!" /E /NFL /NDL /NJH /NJS /NC /NS > nul
        if errorlevel 8 (
            echo [ERROR] Failed to copy plugin files to !PLUGIN_DEST!
            echo         Try running this installer as Administrator.
        ) else (
            echo - Successfully installed to %%D
        )
        echo.
    )
)

if "%FOUND_PS%"=="0" (
    echo [WARNING] No Photoshop Plug-ins folder found. Skipping Plug-ins copy.
    echo.
)

REM Also deploy to UXP External plugins cache (where UXP Developer Tool loads from)
set "UXP_DEST=%APPDATA%\Adobe\UXP\Plugins\External\Oddity"
if exist "%UXP_DEST%" (
    echo Updating UXP External plugin cache at %UXP_DEST%...
    robocopy "%PLUGIN_SRC%" "%UXP_DEST%" /MIR /NFL /NDL /NJH /NJS /NC /NS > nul
    if errorlevel 8 (
        echo [WARNING] Failed to update UXP cache.
    ) else (
        echo - UXP cache updated successfully.
    )
) else (
    echo [INFO] No existing UXP External cache found, skipping.
)
echo.

echo ============================================================
echo   Checking and downloading required assets...
echo ============================================================
powershell -ExecutionPolicy Bypass -File "%~dp0downloads\check_and_download.ps1" -DownloadMissing
if errorlevel 1 (
    echo [WARNING] There was an issue checking or downloading assets.
)

echo.
echo ============================================================
echo   Installation complete!
echo ============================================================
echo.
echo Next steps:
echo   1. Make sure you have run setup.bat to install Python dependencies.
echo   2. Run start_server.bat
echo   3. Restart Photoshop
echo   4. Open Plugins ^> Oddity AI
echo.
pause
