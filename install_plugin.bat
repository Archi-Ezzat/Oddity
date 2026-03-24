@echo off
echo ============================================================
echo   Oddity - Plugin Installer
echo ============================================================
echo.

set "PLUGIN_SRC=%~dp0plugin"
set "PS_PLUGIN_DIR=C:\Program Files\Adobe\Adobe Photoshop 2025\Plug-ins"
set "PLUGIN_DEST=%PS_PLUGIN_DIR%\Oddity"

echo Source:      %PLUGIN_SRC%
echo Destination: %PLUGIN_DEST%
echo.

REM Check if Photoshop plugin dir exists
if not exist "%PS_PLUGIN_DIR%" (
    echo [ERROR] Photoshop plugin directory not found:
    echo         %PS_PLUGIN_DIR%
    pause
    exit /b 1
)

REM Create plugin folder
if not exist "%PLUGIN_DEST%" mkdir "%PLUGIN_DEST%"
if not exist "%PLUGIN_DEST%\icons" mkdir "%PLUGIN_DEST%\icons"

REM Copy plugin files
echo Copying plugin files...
copy /Y "%PLUGIN_SRC%\manifest.json" "%PLUGIN_DEST%\" > nul
copy /Y "%PLUGIN_SRC%\index.html" "%PLUGIN_DEST%\" > nul
copy /Y "%PLUGIN_SRC%\index.js" "%PLUGIN_DEST%\" > nul
copy /Y "%PLUGIN_SRC%\styles.css" "%PLUGIN_DEST%\" > nul

REM Copy icons if they exist
if exist "%PLUGIN_SRC%\icons\icon_24.png" (
    copy /Y "%PLUGIN_SRC%\icons\icon_24.png" "%PLUGIN_DEST%\icons\" > nul
)

echo.
echo ============================================================
echo   Plugin installed successfully!
echo   Restart Photoshop 2025 to load the plugin.
echo   Look for "Oddity AI" in the Plugins menu.
echo ============================================================
pause
