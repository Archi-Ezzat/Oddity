# Installing Oddity

## Recommended User Installation

Oddity can be installed without Adobe UXP Developer Tool.

### Plugin Installation

1. Close Photoshop.
2. Right-click `install_plugin.bat` and run it as Administrator.
3. Wait for the installer to copy the current `Oddity` plugin into Photoshop's plug-ins folder.
4. Re-open Photoshop 2025.
5. Launch Oddity from `Plugins > Oddity AI`.

This is the simplest installation path for users working from the project folder on Windows.

## Local Backend Setup

The Photoshop panel also needs the local inference backend.

1. Run `setup.bat`.
2. Run:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1
```

Optional supported downloads:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1 -DownloadMissing
```

3. Start the server:

```powershell
start_server.bat
```

4. Keep the server window running while using the plugin.

## Optional Packaged Installation

A packaged `.ccx` installer is still a valid distribution format, but it must be rebuilt from the current plugin source before release. Renaming an old `.ccx` file is not enough, because Adobe reads the plugin name and id from the manifest inside the package.

## Developer Installation

If you want to run the plugin directly from source while iterating on UI or code:

1. Run `setup.bat`.
2. Run `powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1`.
3. Run `start_server.bat`.
4. Load `plugin/manifest.json` with Adobe UXP Developer Tool.

## Notes

- End users do not need UXP Developer Tool if they use `install_plugin.bat` or a freshly packaged `.ccx`.
- Large model files are intentionally excluded from the repository.
- The local backend must be running before generation will work.
