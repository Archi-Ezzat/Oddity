# Installing Oddity

## For End Users

You do not need Adobe UXP Developer Tool to install Oddity.

The recommended installation method is a packaged `.ccx` release:

1. Download `Oddity.ccx` from the release page.
2. Double-click the `.ccx` file.
3. Allow Adobe Creative Cloud to install the plugin.
4. Open Photoshop 2025.
5. Launch Oddity from the Plugins menu.

## For Developers

If you are running Oddity from source:

1. Run `setup.bat`.
2. Run `powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1`.
3. Run `start_server.bat`.
4. Load `plugin/manifest.json` using Adobe UXP Developer Tool.

## Notes

- End users should use `.ccx` packages, not the developer tool.
- The local backend must be running before generation will work.
- Large model files are intentionally excluded from the repository.
