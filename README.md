# Oddity

Oddity is a local-first AI image editing panel for Adobe Photoshop 2025. It combines a UXP plugin with a multi-model backend so prompt-driven editing, image-to-image generation, inpainting, outpainting, and result routing happen on the user's machine instead of in a hosted web app.

## Overview

Oddity is designed for artists and retouchers who want modern AI editing inside Photoshop without giving up local control. The panel is built around five ideas:

- local inference instead of cloud-bound generation
- Photoshop-native workflow instead of an external companion app
- professional parameter control instead of one-click black-box output
- multi-model support — Flux, SDXL, SD3, and any diffusers-compatible model
- on-demand asset management — models and components are downloaded only when needed

## Supported Model Families

| Family | Pipeline | Min VRAM | Key Models |
|--------|----------|----------|------------|
| FLUX | FluxPipeline | 8 GB | FLUX.1 Dev, FLUX.1 Schnell, FLUX.2 Klein 9B, FLUX.1 Fill |
| SDXL | StableDiffusionXLPipeline | 6 GB | SDXL Base, SDXL Turbo, Lightning, Juggernaut XL, RealVisXL, DreamShaper XL, Pony V6 |
| SD3 | StableDiffusion3Pipeline | 10 GB | SD3 Medium, SD3.5 Medium, SD3.5 Large, SD3.5 Large Turbo |
| SD 1.5 | StableDiffusionPipeline | 4 GB | SD 1.5 Base, Realistic Vision V6, DreamShaper 8, Deliberate V3 |

## Core Capabilities

- text-to-image generation with any supported model
- document-driven image-to-image editing
- inpainting with mask support (Flux Fill, SDXL Inpaint)
- outpainting / image extension
- in-panel prompt composition and preset recall
- parameter control for steps, guidance, seed, and strength
- output routing to a new layer, canvas replacement, or mask review layer
- model library with on-demand download and auto-organization
- local model health, queue, and GPU telemetry
- generation history with prompt and preview recovery

## Project Structure

- `plugin/` Photoshop UXP panel source
- `backend/` local FastAPI inference server with multi-model support
- `backend/model_registry.json` defines all supported model families and download sources
- `downloads/` asset manifest, checklist generator, and source links
- `bootstrap.bat` guided local setup entry point
- `install_plugin.bat` direct Windows installer for Photoshop

## Installation

### Recommended User Installation

You do not need Adobe UXP Developer Tool to use Oddity from this project folder.

1. Close Photoshop.
2. Run `install_plugin.bat` as Administrator.
3. Run `setup.bat` if the machine is not prepared yet.
4. Start the local backend:

```powershell
start_server.bat
```

5. Open Photoshop 2025.
6. Launch Oddity from `Plugins > Oddity AI`.
7. Open the **Model Library** in the plugin to download your first model.

### Developer Installation

If you are running the plugin from source while developing:

1. Prepare Python:

```powershell
setup.bat
```

2. Start the local backend:

```powershell
start_server.bat
```

3. Load the panel from source with Adobe UXP Developer Tool:

- add `plugin/manifest.json`
- load or reload the plugin in Photoshop 2025

## Model Management

Models are organized by family under `downloads/assets/models/`:

```
downloads/assets/
├── models/
│   ├── flux/checkpoints/
│   ├── sdxl/checkpoints/
│   ├── sd3/checkpoints/
│   └── sd15/checkpoints/
└── components/
    ├── shared/clip/       (CLIP-L, CLIP-G, T5-XXL — shared across families)
    ├── shared/vae/
    ├── flux/vae/
    ├── sdxl/vae/
    ├── sd3/vae/
    └── sd15/vae/
```

**On-demand downloads:** When you select a model in the plugin's Model Library, the backend automatically downloads the checkpoint and any required components (text encoders, VAE). Components shared across model families (e.g., CLIP-L) are only downloaded once.

**Manual placement:** You can also manually place `.safetensors` files in the correct folder. The server will detect them on the next refresh.

## GPU Optimization

The backend starts with **zero models loaded** — no VRAM is consumed until you select a model. Key optimizations:

- Lazy loading: pipeline is built only when first needed
- CPU offload: keeps components on CPU until inference
- Attention slicing: reduces peak VRAM by ~30%
- Full cleanup: when switching model families, the old pipeline is fully unloaded before loading the new one

## Distribution

Oddity has three practical distribution modes:

- direct plugin-folder installation through `install_plugin.bat`
- `.ccx` direct distribution for private users and testing
- Adobe Creative Cloud Marketplace for public release and update management

Right now, the simplest user-facing path is `install_plugin.bat` plus the local backend setup.

## Notes

- Heavy model files and machine-specific artifacts are intentionally excluded from Git.
- The backend defaults to repo-local assets under `downloads/assets/`.
- Models and components are downloaded on-demand via the Model Library in the plugin.
