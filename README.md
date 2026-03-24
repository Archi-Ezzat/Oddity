# Oddity

Oddity is a local-first AI image editing panel for Adobe Photoshop 2025. It combines a UXP plugin with a FLUX-based backend so prompt-driven editing, image-to-image generation, selection-aware workflows, and result routing happen on the user's machine instead of in a hosted web app.

## Overview

Oddity is designed for artists and retouchers who want modern AI editing inside Photoshop without giving up local control. The panel is built around four ideas:

- local inference instead of cloud-bound generation
- Photoshop-native workflow instead of an external companion app
- professional parameter control instead of one-click black-box output
- portable setup through a checked manifest of missing assets and download sources

## Core Capabilities

- text-to-image generation
- document-driven image-to-image editing
- in-panel prompt composition and preset recall
- parameter control for steps, guidance, seed, and strength
- output routing to a new layer, canvas replacement, or mask review layer
- local model health, queue, and GPU telemetry
- generation history with prompt and preview recovery

## Project Structure

- `plugin/` Photoshop UXP panel source
- `backend/` local FastAPI inference server
- `downloads/` asset manifest, checklist generator, and source links for another machine
- `bootstrap.bat` guided local setup entry point
- `install_plugin.bat` direct Windows installer for Photoshop

## Installation

### Recommended User Installation

You do not need Adobe UXP Developer Tool to use Oddity from this project folder.

1. Close Photoshop.
2. Run `install_plugin.bat` as Administrator.
3. Run `setup.bat` if the machine is not prepared yet.
4. Run:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1
```

Optional supported downloads:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1 -DownloadMissing
```

5. Start the local backend:

```powershell
start_server.bat
```

6. Open Photoshop 2025.
7. Launch Oddity from `Plugins > Oddity AI`.

This is currently the simplest reliable user flow.

### Optional Packaged Installation

A `.ccx` package is still a valid release format, but it must be freshly packaged from the current plugin source. Renaming an old `.ccx` file does not update the plugin name or id inside Adobe.

### Developer Installation

If you are running the plugin from source while developing:

1. Prepare Python:

```powershell
setup.bat
```

2. Check required assets:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1
```

3. Start the local backend:

```powershell
start_server.bat
```

4. Load the panel from source with Adobe UXP Developer Tool:

- add `plugin/manifest.json`
- load or reload the plugin in Photoshop 2025

## Fresh-Machine Bootstrap

If you are moving the project to another PC, run:

```powershell
bootstrap.bat
```

The bootstrap flow creates the Python environment, checks the asset manifest, and points you to the backend start step. The generated checklist report is written to `downloads/CHECKLIST.generated.md`.

## Distribution

Oddity has three practical distribution modes:

- direct plugin-folder installation through `install_plugin.bat`
- `.ccx` direct distribution for private users and testing
- Adobe Creative Cloud Marketplace for public release and update management

Right now, the simplest user-facing path is `install_plugin.bat` plus the local backend setup.

## Positioning

Oddity sits in the same problem space as several top-tier AI imaging tools, but it is intentionally optimized for a different workflow:

- Adobe Photoshop Generative Fill and Firefly focus on tightly integrated cloud-assisted generation inside Photoshop.
- Topaz Photo AI focuses on AI-assisted enhancement, denoise, sharpening, and restoration workflows.
- Topaz Gigapixel focuses on high-end AI upscaling and detail recovery.
- Luminar Neo combines AI photo editing with generative tools such as GenErase and GenExpand in a standalone editor.

Oddity's differentiator is local, private generation inside a custom Photoshop UXP panel with editable parameters and project-portable asset management.

## Notes

- Heavy model files and machine-specific artifacts are intentionally excluded from Git.
- The backend defaults to repo-local assets under `downloads/assets/`.
- At least one compatible transformer `.safetensors` file should exist under `downloads/assets/models/unet/flux/`.
