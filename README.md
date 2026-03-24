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

## Installation

### 1. Prepare Python

Run:

```powershell
setup.bat
```

### 2. Check Required Assets

Run a checklist pass:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1
```

To auto-download supported missing assets:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1 -DownloadMissing
```

Oddity expects local assets under:

```text
downloads/assets/models/clip/
downloads/assets/models/vae/
downloads/assets/models/unet/flux/
```

### 3. Start the Local Backend

Run:

```powershell
start_server.bat
```

The server listens on `127.0.0.1:5000` by default.

### 4. Load the Photoshop Panel

1. Open Adobe UXP Developer Tools.
2. Add `plugin/manifest.json`.
3. Load or reload the plugin in Photoshop 2025.

## Fresh-Machine Bootstrap

If you are moving the project to another PC, run:

```powershell
bootstrap.bat
```

The bootstrap flow creates the Python environment, checks the asset manifest, and points you to the backend start step. The generated checklist report is written to `downloads/CHECKLIST.generated.md`.

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
