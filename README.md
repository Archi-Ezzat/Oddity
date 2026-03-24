# Oddity

Local-first AI image editing for Adobe Photoshop 2025, powered by a FLUX-based offline backend and a UXP panel.

## What is in this repo

- `plugin/`: the UXP panel source loaded by Adobe UXP Developer Tools
- `backend/`: the local FastAPI inference server
- `downloads/`: asset checklist, download manifest, and bootstrap script for another machine
- `Claude/`: reference proposal files kept for design comparison

## Quick start

Fastest setup:

- run `bootstrap.bat`

Manual setup:

1. Install Python and create the local environment:
   - run `setup.bat`
2. Check and download missing local assets:
   - run `powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1`
   - optional auto-download for supported assets:
   - run `powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1 -DownloadMissing`
3. Start the backend:
   - run `start_server.bat`
4. Load the panel in Adobe UXP Developer Tools:
   - add `plugin/manifest.json`
   - load or reload the plugin

## Notes

- Heavy files are intentionally excluded from Git.
- The backend now defaults to repo-local assets under `downloads/assets/`.
- Transformer weight files are user-selectable; keep at least one `.safetensors` model under `downloads/assets/models/unet/flux/`.

## GitHub upload

This repo is prepared to push to `https://github.com/Archi-Ezzat/Oddity` once that remote exists and local Git authentication is available.
