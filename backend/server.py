"""
Oddity — Multi-Model Local Inference Server
Serves image generation/editing requests from the Photoshop UXP plugin.
Supports Flux, SDXL, SD3, and any diffusers-compatible model family.
"""

import asyncio
import base64
import gc
import io
import json
import logging
import os
import shutil
import sys
import time
import threading
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Optional, Dict, Any

import torch
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

ROOT_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / "downloads" / "assets"
MODELS_DIR = Path(os.environ.get("ODDITY_MODELS_DIR", str(ASSETS_DIR / "models")))
COMPONENTS_DIR = Path(os.environ.get("ODDITY_COMPONENTS_DIR", str(ASSETS_DIR / "components")))
REGISTRY_PATH = Path(__file__).resolve().parent / "model_registry.json"

HOST = os.environ.get("ODDITY_HOST", "127.0.0.1")
PORT = int(os.environ.get("ODDITY_PORT", "5000"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger("oddity")

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------

pipeline = None
pipeline_type = None  # "flux", "sdxl", "sd3", "flux_fill", "sdxl_inpaint"
model_status = "idle"  # idle | loading | ready | generating | error
current_loaded_model_id = None
current_loaded_family = None
loaded_components: Dict[str, Any] = {}  # component_id -> loaded object

current_progress = {"step": 0, "total": 0, "preview": None, "status": "idle"}
download_progress = {"active": False, "item": "", "bytes_downloaded": 0, "bytes_total": 0, "percent": 0, "status": "idle"}
cancel_requested = False

progress_lock = threading.Lock()
pipeline_lock = threading.Lock()
download_lock = threading.Lock()

# ---------------------------------------------------------------------------
# Registry helpers
# ---------------------------------------------------------------------------

def load_registry() -> dict:
    """Load the model registry from disk."""
    if not REGISTRY_PATH.exists():
        log.error(f"Model registry not found at {REGISTRY_PATH}")
        return {"families": {}, "components": {}}
    with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_model_path(family_id: str, model_filename: str) -> Path:
    """Get the expected path for a model checkpoint."""
    return MODELS_DIR / family_id / "checkpoints" / model_filename


def get_component_path(component_id: str, registry: dict) -> Path:
    """Get the expected path for a shared or family-specific component."""
    comp = registry["components"].get(component_id, {})
    subfolder = comp.get("subfolder", "")
    filename = comp.get("filename", "")
    family = comp.get("family_specific")
    if family:
        return COMPONENTS_DIR / family / subfolder / filename
    return COMPONENTS_DIR / "shared" / subfolder / filename


def scan_local_models(registry: dict) -> dict:
    """Scan disk to determine which models and components are actually present."""
    status = {"families": {}, "components": {}}

    # Check components
    for comp_id, comp_info in registry.get("components", {}).items():
        comp_path = get_component_path(comp_id, registry)
        status["components"][comp_id] = {
            "present": comp_path.exists(),
            "path": str(comp_path),
            "size_gb": comp_info.get("size_gb", 0),
        }

    # Check model checkpoints
    for fam_id, fam_info in registry.get("families", {}).items():
        fam_status = {"models": {}}
        for model in fam_info.get("models", []):
            model_path = get_model_path(fam_id, model["filename"])
            fam_status["models"][model["id"]] = {
                "present": model_path.exists(),
                "path": str(model_path),
                "size_gb": model.get("size_gb", 0),
            }
        status["families"][fam_id] = fam_status

    return status


def check_model_ready(family_id: str, model_id: str, registry: dict) -> dict:
    """Check if a model and all its required components are present."""
    family = registry["families"].get(family_id)
    if not family:
        return {"ready": False, "missing": [f"Unknown family: {family_id}"]}

    model_info = None
    for m in family.get("models", []):
        if m["id"] == model_id:
            model_info = m
            break

    if not model_info:
        return {"ready": False, "missing": [f"Unknown model: {model_id}"]}

    missing = []

    # Check checkpoint
    cp_path = get_model_path(family_id, model_info["filename"])
    if not cp_path.exists():
        missing.append({"type": "model", "id": model_id, "filename": model_info["filename"]})

    # Check required components (skip if model has integrated components)
    if not model_info.get("integrated_components"):
        for comp_id in family.get("requires_components", []):
            comp_path = get_component_path(comp_id, registry)
            if not comp_path.exists():
                missing.append({"type": "component", "id": comp_id})

    return {"ready": len(missing) == 0, "missing": missing}


# ---------------------------------------------------------------------------
# Download manager
# ---------------------------------------------------------------------------

def download_file(url: str, dest: Path, label: str = ""):
    """Download a single file with progress tracking."""
    global download_progress
    import urllib.request

    dest.parent.mkdir(parents=True, exist_ok=True)

    # Use a temp file to avoid partial downloads being treated as complete
    temp_dest = dest.with_suffix(dest.suffix + ".downloading")

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Oddity/1.0"})
        with urllib.request.urlopen(req) as response:
            total = int(response.headers.get("Content-Length", 0))
            downloaded = 0
            chunk_size = 1024 * 1024  # 1 MB chunks

            with download_lock:
                download_progress.update({
                    "active": True,
                    "item": label or dest.name,
                    "bytes_downloaded": 0,
                    "bytes_total": total,
                    "percent": 0,
                    "status": "downloading",
                })

            with open(temp_dest, "wb") as f:
                while True:
                    chunk = response.read(chunk_size)
                    if not chunk:
                        break
                    f.write(chunk)
                    downloaded += len(chunk)
                    pct = int((downloaded / total) * 100) if total > 0 else 0
                    with download_lock:
                        download_progress.update({
                            "bytes_downloaded": downloaded,
                            "percent": pct,
                        })

        # Move temp to final destination
        if dest.exists():
            dest.unlink()
        temp_dest.rename(dest)

        with download_lock:
            download_progress.update({"status": "complete", "percent": 100})

        log.info(f"Downloaded {label or dest.name} ({downloaded / 1024 / 1024:.1f} MB)")
        return True

    except Exception as e:
        if temp_dest.exists():
            temp_dest.unlink()
        with download_lock:
            download_progress.update({"status": f"error: {e}", "active": False})
        log.error(f"Download failed for {label}: {e}")
        return False


def download_model_and_deps(family_id: str, model_id: str, registry: dict):
    """Download a model checkpoint and all its required components."""
    global download_progress

    family = registry["families"].get(family_id)
    if not family:
        raise ValueError(f"Unknown family: {family_id}")

    model_info = None
    for m in family.get("models", []):
        if m["id"] == model_id:
            model_info = m
            break
    if not model_info:
        raise ValueError(f"Unknown model: {model_id}")

    items_to_download = []

    # Check if checkpoint needs downloading
    cp_path = get_model_path(family_id, model_info["filename"])
    if not cp_path.exists() and model_info.get("download_url"):
        items_to_download.append({
            "url": model_info["download_url"],
            "dest": cp_path,
            "label": f"{model_info['name']} checkpoint",
        })

    # Check required components
    if not model_info.get("integrated_components"):
        for comp_id in family.get("requires_components", []):
            comp = registry["components"].get(comp_id, {})
            comp_path = get_component_path(comp_id, registry)
            if not comp_path.exists() and comp.get("download_url"):
                items_to_download.append({
                    "url": comp["download_url"],
                    "dest": comp_path,
                    "label": comp.get("display_name", comp_id),
                })

    if not items_to_download:
        log.info(f"All files for {model_info['name']} are already present.")
        with download_lock:
            download_progress.update({"active": False, "status": "complete"})
        return

    for item in items_to_download:
        success = download_file(item["url"], item["dest"], item["label"])
        if not success:
            raise RuntimeError(f"Failed to download {item['label']}")

    with download_lock:
        download_progress.update({"active": False, "status": "complete"})


# ---------------------------------------------------------------------------
# Pipeline factory
# ---------------------------------------------------------------------------

def unload_pipeline():
    """Fully unload the current pipeline and free GPU memory."""
    global pipeline, pipeline_type, current_loaded_model_id, current_loaded_family, loaded_components

    if pipeline is not None:
        log.info("Unloading current pipeline...")
        del pipeline
        pipeline = None

    pipeline_type = None
    current_loaded_model_id = None
    current_loaded_family = None
    loaded_components.clear()

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.synchronize()

    log.info("Pipeline unloaded, GPU memory freed.")


def build_pipeline(family_id: str, model_id: str, registry: dict, for_inpaint: bool = False):
    """Build and load a diffusers pipeline for the given model."""
    global pipeline, pipeline_type, current_loaded_model_id, current_loaded_family, model_status

    family = registry["families"].get(family_id)
    if not family:
        raise ValueError(f"Unknown model family: {family_id}")

    model_info = None
    for m in family.get("models", []):
        if m["id"] == model_id:
            model_info = m
            break
    if not model_info:
        raise ValueError(f"Unknown model: {model_id}")

    # Check if we're already loaded
    if current_loaded_model_id == model_id and pipeline is not None:
        if for_inpaint and pipeline_type not in ("flux_fill", "sdxl_inpaint", "sd15_inpaint"):
            pass  # Need to reload for inpaint
        elif not for_inpaint and pipeline_type in ("flux_fill", "sdxl_inpaint", "sd15_inpaint"):
            pass  # Need to reload for generation
        else:
            return  # Already loaded correctly

    # If switching families, fully unload first
    if current_loaded_family and current_loaded_family != family_id:
        unload_pipeline()

    model_status = "loading"
    target_type = family.get("pipeline_type", family_id)

    if for_inpaint and family.get("supports_inpaint"):
        target_type = family.get("inpaint_pipeline_type", target_type)

    log.info(f"Building pipeline: family={family_id}, model={model_id}, type={target_type}")
    t0 = time.time()

    try:
        cp_path = get_model_path(family_id, model_info["filename"])
        if not cp_path.exists():
            raise FileNotFoundError(f"Model checkpoint not found: {cp_path}")

        if target_type in ("flux", "flux_fill"):
            _build_flux_pipeline(family_id, model_info, cp_path, registry, target_type)
        elif target_type in ("sdxl", "sdxl_inpaint"):
            _build_sdxl_pipeline(family_id, model_info, cp_path, registry, target_type)
        elif target_type == "sd3":
            _build_sd3_pipeline(family_id, model_info, cp_path, registry)
        elif target_type in ("sd15", "sd15_inpaint"):
            _build_sd15_pipeline(family_id, model_info, cp_path, registry, target_type)
        else:
            raise ValueError(f"Unsupported pipeline type: {target_type}")

        pipeline_type = target_type
        current_loaded_model_id = model_id
        current_loaded_family = family_id
        model_status = "ready"
        log.info(f"✓ Pipeline ready in {time.time() - t0:.2f}s ({target_type} / {model_info['name']})")

    except Exception as e:
        model_status = "error"
        log.exception(f"Failed to build pipeline: {e}")
        raise


def _build_flux_pipeline(family_id: str, model_info: dict, cp_path: Path, registry: dict, target_type: str):
    """Build a Flux or Flux Fill pipeline."""
    global pipeline

    from diffusers import FluxPipeline, FluxFillPipeline, FluxTransformer2DModel, AutoencoderKL, FlowMatchEulerDiscreteScheduler
    from transformers import CLIPTextModel, T5EncoderModel, CLIPTokenizer, T5TokenizerFast, CLIPTextConfig, T5Config
    from safetensors.torch import load_file
    from huggingface_hub import snapshot_download

    # We need a reference HF repo for configs (tokenizer, scheduler config, etc.)
    config_repo = "Shakker-Labs/AWPortrait-FL"

    log.info("Downloading lightweight configs from HuggingFace...")
    allow_patterns = [
        "scheduler/*",
        "tokenizer/*",
        "tokenizer_2/*",
        "transformer/config.json",
        "text_encoder/config.json",
        "text_encoder_2/config.json",
        "vae/config.json",
        "model_index.json",
    ]
    base_dir = snapshot_download(config_repo, allow_patterns=allow_patterns)

    # Tokenizers & scheduler
    tokenizer = CLIPTokenizer.from_pretrained(base_dir, subfolder="tokenizer")
    tokenizer_2 = T5TokenizerFast.from_pretrained(base_dir, subfolder="tokenizer_2")
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(base_dir, subfolder="scheduler")

    # CLIP-L
    clip_path = get_component_path("clip_l", registry)
    if clip_path.exists():
        log.info(f"Loading local CLIP-L from {clip_path}...")
        clip_config = CLIPTextConfig.from_pretrained(base_dir + "/text_encoder")
        text_encoder = CLIPTextModel._from_config(clip_config)
        sd = load_file(str(clip_path))
        if not any(k.startswith("text_model.") for k in sd.keys()):
            sd = {f"text_model.{k}": v for k, v in sd.items()}
        text_encoder.load_state_dict(sd, strict=False)
        text_encoder.to(torch.bfloat16)
        del sd
    else:
        log.info("Downloading CLIP-L from HuggingFace...")
        text_encoder = CLIPTextModel.from_pretrained(base_dir, subfolder="text_encoder", torch_dtype=torch.bfloat16)

    # T5-XXL
    t5_path = get_component_path("t5xxl_fp16", registry)
    if t5_path.exists():
        log.info(f"Loading local T5 from {t5_path}...")
        t5_config = T5Config.from_pretrained(base_dir + "/text_encoder_2")
        text_encoder_2 = T5EncoderModel._from_config(t5_config)
        text_encoder_2.load_state_dict(load_file(str(t5_path)))
        text_encoder_2.to(torch.bfloat16)
    else:
        raise FileNotFoundError(f"T5-XXL encoder not found at {t5_path}. Please download it first.")

    # VAE
    vae_path = get_component_path("flux_vae", registry)
    if vae_path.exists():
        log.info(f"Loading local VAE from {vae_path}...")
        vae = AutoencoderKL.from_single_file(str(vae_path), config=base_dir + "/vae", torch_dtype=torch.bfloat16)
    else:
        raise FileNotFoundError(f"Flux VAE not found at {vae_path}. Please download it first.")

    # Transformer
    log.info(f"Loading transformer weights from {cp_path}...")
    transformer_config = FluxTransformer2DModel.load_config(base_dir + "/transformer")
    transformer = FluxTransformer2DModel.from_config(transformer_config)
    state_dict = load_file(str(cp_path))
    transformer.load_state_dict(state_dict, strict=False)
    transformer.to(torch.bfloat16)
    del state_dict

    # Build pipeline
    PipeClass = FluxFillPipeline if target_type == "flux_fill" else FluxPipeline
    pipe = PipeClass(
        scheduler=scheduler,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        text_encoder_2=text_encoder_2,
        tokenizer_2=tokenizer_2,
        vae=vae,
        transformer=transformer,
    )

    pipe.enable_model_cpu_offload()
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass  # Not all pipeline classes support this

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    pipeline = pipe


def _build_sdxl_pipeline(family_id: str, model_info: dict, cp_path: Path, registry: dict, target_type: str):
    """Build an SDXL or SDXL Inpaint pipeline from a single-file checkpoint."""
    global pipeline

    if target_type == "sdxl_inpaint":
        from diffusers import StableDiffusionXLInpaintPipeline as PipeClass
    else:
        from diffusers import StableDiffusionXLPipeline as PipeClass

    log.info(f"Loading SDXL from single file: {cp_path}...")
    pipe = PipeClass.from_single_file(
        str(cp_path),
        torch_dtype=torch.float16,
        use_safetensors=True,
    )

    # Load custom VAE if present
    vae_path = get_component_path("sdxl_vae", registry)
    if vae_path.exists():
        from diffusers import AutoencoderKL
        log.info(f"Loading custom SDXL VAE from {vae_path}...")
        vae = AutoencoderKL.from_single_file(str(vae_path), torch_dtype=torch.float16)
        pipe.vae = vae

    pipe.enable_model_cpu_offload()
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    pipeline = pipe


def _build_sd3_pipeline(family_id: str, model_info: dict, cp_path: Path, registry: dict):
    """Build an SD3 pipeline from a single-file checkpoint."""
    global pipeline

    from diffusers import StableDiffusion3Pipeline

    log.info(f"Loading SD3 from single file: {cp_path}...")
    pipe = StableDiffusion3Pipeline.from_single_file(
        str(cp_path),
        torch_dtype=torch.float16,
        use_safetensors=True,
    )

    pipe.enable_model_cpu_offload()
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    pipeline = pipe


def _build_sd15_pipeline(family_id: str, model_info: dict, cp_path: Path, registry: dict, target_type: str):
    """Build a Stable Diffusion 1.5 or SD 1.5 Inpaint pipeline from a single-file checkpoint."""
    global pipeline

    if target_type == "sd15_inpaint":
        from diffusers import StableDiffusionInpaintPipeline as PipeClass
    else:
        from diffusers import StableDiffusionPipeline as PipeClass

    log.info(f"Loading SD 1.5 from single file: {cp_path}...")
    pipe = PipeClass.from_single_file(
        str(cp_path),
        torch_dtype=torch.float16,
        use_safetensors=True,
    )

    # Load custom VAE if present
    vae_path = get_component_path("sd15_vae", registry)
    if vae_path.exists():
        from diffusers import AutoencoderKL
        log.info(f"Loading custom SD 1.5 VAE from {vae_path}...")
        vae = AutoencoderKL.from_single_file(str(vae_path), torch_dtype=torch.float16)
        pipe.vae = vae

    pipe.enable_model_cpu_offload()
    try:
        pipe.enable_attention_slicing()
    except Exception:
        pass

    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    pipeline = pipe


# ---------------------------------------------------------------------------
# Progress callback
# ---------------------------------------------------------------------------

def make_progress_callback(total_steps: int):
    """Create a callback for tracking diffusion progress."""
    def callback(pipe, step, timestep, callback_kwargs):
        global cancel_requested
        if cancel_requested:
            cancel_requested = False
            raise RuntimeError("Generation cancelled by user")
        with progress_lock:
            current_progress["step"] = step + 1
            current_progress["total"] = total_steps
            current_progress["status"] = "generating"
        return callback_kwargs
    return callback


# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class GenerateRequest(BaseModel):
    family: str = Field(..., description="Model family: flux, sdxl, sd3")
    model_id: str = Field(..., description="Model ID from registry")
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)
    num_steps: int = Field(default=20, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0.0, le=30.0)
    seed: int = Field(default=-1)
    batch_size: int = Field(default=1, ge=1, le=4)


class Img2ImgRequest(BaseModel):
    family: str = Field(..., description="Model family: flux, sdxl, sd3")
    model_id: str = Field(..., description="Model ID from registry")
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    image: str = Field(..., description="Base64-encoded input image (PNG/JPEG)")
    strength: float = Field(default=0.75, ge=0.01, le=1.0)
    num_steps: int = Field(default=20, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0.0, le=30.0)
    seed: int = Field(default=-1)
    batch_size: int = Field(default=1, ge=1, le=4)


class InpaintRequest(BaseModel):
    family: str = Field(..., description="Model family: flux, sdxl, sd3, sd15")
    model_id: str = Field(..., description="Model ID from registry")
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    image: str = Field(..., description="Base64-encoded source image")
    mask: str = Field(..., description="Base64-encoded mask image (white = inpaint area)")
    strength: float = Field(default=0.85, ge=0.01, le=1.0)
    num_steps: int = Field(default=28, ge=1, le=100)
    guidance_scale: float = Field(default=7.5, ge=0.0, le=30.0)
    seed: int = Field(default=-1)
    batch_size: int = Field(default=1, ge=1, le=4)


class DownloadRequest(BaseModel):
    family: str = Field(..., description="Model family: flux, sdxl, sd3")
    model_id: str = Field(..., description="Model ID from registry")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def image_to_base64(img: Image.Image, fmt: str = "PNG") -> str:
    """Convert PIL Image to base64 string."""
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def base64_to_image(b64: str) -> Image.Image:
    """Convert base64 string to PIL Image."""
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    data = base64.b64decode(b64)
    return Image.open(io.BytesIO(data)).convert("RGB")


def base64_to_mask(b64: str) -> Image.Image:
    """Convert base64 string to grayscale mask image."""
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    data = base64.b64decode(b64)
    return Image.open(io.BytesIO(data)).convert("L")


def round_to_multiple(val: int, multiple: int = 8) -> int:
    """Round dimension to nearest multiple (required for VAE)."""
    return max(multiple, (val // multiple) * multiple)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Server starts idle — no models loaded."""
    log.info("Oddity server started. No models loaded — waiting for user selection.")
    # Ensure base directory structure exists
    for subdir in ["flux/checkpoints", "sdxl/checkpoints", "sd3/checkpoints", "sd15/checkpoints"]:
        (MODELS_DIR / subdir).mkdir(parents=True, exist_ok=True)
    for subdir in ["shared/clip", "shared/vae", "flux/vae", "sdxl/vae", "sd3/vae", "sd15/vae"]:
        (COMPONENTS_DIR / subdir).mkdir(parents=True, exist_ok=True)
    
    # Auto-migrate old Flux models if they exist
    _migrate_legacy_models()
    
    yield
    log.info("Shutting down server...")


def _migrate_legacy_models():
    """Migrate models from the old flat folder structure to the new per-family layout."""
    old_flux_dir = ASSETS_DIR / "models" / "unet" / "flux"
    new_flux_dir = MODELS_DIR / "flux" / "checkpoints"
    
    if old_flux_dir.exists() and old_flux_dir != new_flux_dir:
        for f in old_flux_dir.glob("*.safetensors"):
            dest = new_flux_dir / f.name
            if not dest.exists():
                log.info(f"Migrating legacy model: {f.name} -> {dest}")
                try:
                    shutil.copy2(str(f), str(dest))
                except Exception as e:
                    log.warning(f"Could not migrate {f.name}: {e}")

    # Migrate old component files
    old_clip = ASSETS_DIR / "models" / "clip" / "clip_l.safetensors"
    new_clip = COMPONENTS_DIR / "shared" / "clip" / "clip_l.safetensors"
    if old_clip.exists() and not new_clip.exists():
        new_clip.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(old_clip), str(new_clip))
        log.info("Migrated legacy CLIP-L")

    old_t5 = ASSETS_DIR / "models" / "clip" / "t5xxl_fp16.safetensors"
    new_t5 = COMPONENTS_DIR / "shared" / "clip" / "t5xxl_fp16.safetensors"
    if old_t5.exists() and not new_t5.exists():
        new_t5.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(old_t5), str(new_t5))
        log.info("Migrated legacy T5-XXL")

    old_vae = ASSETS_DIR / "models" / "vae" / "ae.safetensors"
    new_vae = COMPONENTS_DIR / "flux" / "vae" / "ae.safetensors"
    if old_vae.exists() and not new_vae.exists():
        new_vae.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(old_vae), str(new_vae))
        log.info("Migrated legacy Flux VAE")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Oddity",
    description="Local multi-model AI inference server for Photoshop",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    """Server health and model status."""
    gpu_info = {}
    if torch.cuda.is_available():
        gpu_info = {
            "name": torch.cuda.get_device_name(0),
            "vram_total_gb": round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 1),
            "vram_used_gb": round(torch.cuda.memory_allocated(0) / 1024**3, 1),
            "vram_reserved_gb": round(torch.cuda.memory_reserved(0) / 1024**3, 1),
        }
    return {
        "status": "ok",
        "model_status": model_status,
        "current_model": current_loaded_model_id,
        "current_family": current_loaded_family,
        "pipeline_type": pipeline_type,
        "gpu": gpu_info,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/registry")
async def get_registry():
    """Return the full model registry with local download status."""
    registry = load_registry()
    local_status = scan_local_models(registry)

    # Enrich registry with download status
    result = {"families": {}, "components": {}}

    for fam_id, fam_info in registry.get("families", {}).items():
        fam_result = {**fam_info, "models": []}
        for model in fam_info.get("models", []):
            model_status_info = local_status.get("families", {}).get(fam_id, {}).get("models", {}).get(model["id"], {})
            # Check if all required components are present
            readiness = check_model_ready(fam_id, model["id"], registry)
            fam_result["models"].append({
                **model,
                "downloaded": model_status_info.get("present", False),
                "ready": readiness["ready"],
                "missing_deps": readiness.get("missing", []),
            })
        result["families"][fam_id] = fam_result

    for comp_id, comp_info in registry.get("components", {}).items():
        comp_status = local_status.get("components", {}).get(comp_id, {})
        result["components"][comp_id] = {
            **comp_info,
            "downloaded": comp_status.get("present", False),
        }

    return result


@app.get("/models")
async def list_models():
    """List available models that are ready to use (downloaded + deps present)."""
    registry = load_registry()
    models = []
    for fam_id, fam_info in registry.get("families", {}).items():
        for model in fam_info.get("models", []):
            readiness = check_model_ready(fam_id, model["id"], registry)
            if readiness["ready"]:
                models.append({
                    "family": fam_id,
                    "family_display": fam_info.get("display_name", fam_id),
                    "id": model["id"],
                    "name": model["name"],
                    "filename": model["filename"],
                    "default_steps": model.get("default_steps", 20),
                    "default_guidance": model.get("default_guidance", 7.5),
                    "is_inpaint_model": model.get("is_inpaint_model", False),
                    "badge_color": fam_info.get("badge_color", "#7C8CFF"),
                })
    return models


@app.post("/models/download")
async def download_model(req: DownloadRequest):
    """Start downloading a model and its dependencies in the background."""
    registry = load_registry()

    with download_lock:
        if download_progress.get("active"):
            raise HTTPException(status_code=409, detail="A download is already in progress.")

    # Validate request
    family = registry["families"].get(req.family)
    if not family:
        raise HTTPException(status_code=400, detail=f"Unknown family: {req.family}")

    model_info = None
    for m in family.get("models", []):
        if m["id"] == req.model_id:
            model_info = m
            break
    if not model_info:
        raise HTTPException(status_code=400, detail=f"Unknown model: {req.model_id}")

    def _do_download():
        try:
            download_model_and_deps(req.family, req.model_id, registry)
        except Exception as e:
            log.error(f"Download failed: {e}")
            with download_lock:
                download_progress.update({"active": False, "status": f"error: {e}"})

    thread = threading.Thread(target=_do_download, daemon=True)
    thread.start()

    return {"status": "started", "model": req.model_id}


@app.get("/models/download/progress")
async def get_download_progress():
    """Check the current download progress."""
    with download_lock:
        return dict(download_progress)


@app.get("/progress")
async def get_progress():
    """Current generation progress."""
    with progress_lock:
        return dict(current_progress)


@app.post("/generate")
async def generate(req: GenerateRequest):
    """Text-to-image generation."""
    registry = load_registry()

    # Build/switch pipeline
    try:
        with pipeline_lock:
            build_pipeline(req.family, req.model_id, registry, for_inpaint=False)
    except FileNotFoundError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline load failed: {e}")

    width = round_to_multiple(req.width)
    height = round_to_multiple(req.height)
    import random as _random
    base_seed = req.seed if req.seed >= 0 else _random.randint(0, 2**32 - 1)

    # Generate a list of seeds for batch diversity
    batch_seeds = [base_seed + i for i in range(req.batch_size)]
    generator = torch.Generator("cpu").manual_seed(base_seed)

    log.info(f"Generating: '{req.prompt[:80]}...' @ {width}x{height}, "
             f"steps={req.num_steps}, cfg={req.guidance_scale}, seed={base_seed}, batch={req.batch_size}")

    with progress_lock:
        current_progress.update({"step": 0, "total": req.num_steps, "status": "generating"})

    try:
        # For true batch diversity, generate each image with its own seed
        all_images = []
        for i, s in enumerate(batch_seeds):
            gen = torch.Generator("cpu").manual_seed(s)
            imgs = await asyncio.to_thread(
                _run_generate, req.prompt, req.negative_prompt,
                width, height, req.num_steps, req.guidance_scale, gen, 1
            )
            all_images.extend(imgs)

        b64_images = [image_to_base64(img) for img in all_images]

        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "idle"})

        return {
            "images": b64_images,
            "width": all_images[0].width,
            "height": all_images[0].height,
            "seeds": batch_seeds,
            "format": "png",
        }

    except Exception as e:
        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "error"})
        log.exception("Generation failed")
        raise HTTPException(status_code=500, detail=str(e))


def _run_generate(prompt, negative_prompt, width, height, steps, guidance, generator, batch_size):
    """Synchronous text-to-image generation."""
    kwargs = {
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "generator": generator,
        "num_images_per_prompt": batch_size,
        "callback_on_step_end": make_progress_callback(steps),
    }
    # SDXL, SD3, and SD 1.5 support negative_prompt; Flux does not
    if pipeline_type in ("sdxl", "sdxl_inpaint", "sd3", "sd15", "sd15_inpaint") and negative_prompt:
        kwargs["negative_prompt"] = negative_prompt

    output = pipeline(**kwargs)
    return output.images


@app.post("/img2img")
async def img2img(req: Img2ImgRequest):
    """Image-to-image editing."""
    registry = load_registry()

    try:
        with pipeline_lock:
            build_pipeline(req.family, req.model_id, registry, for_inpaint=False)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline load failed: {e}")

    try:
        input_image = base64_to_image(req.image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    w = round_to_multiple(input_image.width)
    h = round_to_multiple(input_image.height)
    if w != input_image.width or h != input_image.height:
        input_image = input_image.resize((w, h), Image.LANCZOS)

    import random as _random
    seed = req.seed if req.seed >= 0 else _random.randint(0, 2**32 - 1)
    generator = torch.Generator("cpu").manual_seed(seed)

    log.info(f"Img2Img: '{req.prompt[:80]}...' @ {w}x{h}, "
             f"strength={req.strength}, steps={req.num_steps}, seed={seed}")

    with progress_lock:
        current_progress.update({"step": 0, "total": req.num_steps, "status": "generating"})

    try:
        result_images = await asyncio.to_thread(
            _run_img2img, req.prompt, req.negative_prompt, input_image,
            req.strength, req.num_steps, req.guidance_scale, generator, req.batch_size
        )
        b64_images = [image_to_base64(img) for img in result_images]

        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "idle"})

        return {
            "images": b64_images,
            "width": result_images[0].width,
            "height": result_images[0].height,
            "seeds": [seed] * len(b64_images),
            "format": "png",
        }

    except Exception as e:
        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "error"})
        log.exception("Img2Img failed")
        raise HTTPException(status_code=500, detail=str(e))


def _run_img2img(prompt, negative_prompt, image, strength, steps, guidance, generator, batch_size):
    """Synchronous img2img generation."""
    kwargs = {
        "prompt": prompt,
        "image": image,
        "strength": strength,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "generator": generator,
        "num_images_per_prompt": batch_size,
        "callback_on_step_end": make_progress_callback(steps),
    }
    if pipeline_type in ("sdxl", "sdxl_inpaint", "sd3", "sd15", "sd15_inpaint") and negative_prompt:
        kwargs["negative_prompt"] = negative_prompt

    output = pipeline(**kwargs)
    return output.images


@app.post("/inpaint")
async def inpaint(req: InpaintRequest):
    """Inpainting with mask support."""
    registry = load_registry()

    family = registry["families"].get(req.family)
    if not family or not family.get("supports_inpaint"):
        raise HTTPException(status_code=400, detail=f"Family '{req.family}' does not support inpainting.")

    try:
        with pipeline_lock:
            build_pipeline(req.family, req.model_id, registry, for_inpaint=True)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Pipeline load failed: {e}")

    try:
        input_image = base64_to_image(req.image)
        mask_image = base64_to_mask(req.mask)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image/mask data: {e}")

    w = round_to_multiple(input_image.width)
    h = round_to_multiple(input_image.height)
    if w != input_image.width or h != input_image.height:
        input_image = input_image.resize((w, h), Image.LANCZOS)
        mask_image = mask_image.resize((w, h), Image.LANCZOS)

    import random as _random
    seed = req.seed if req.seed >= 0 else _random.randint(0, 2**32 - 1)
    generator = torch.Generator("cpu").manual_seed(seed)

    log.info(f"Inpaint: '{req.prompt[:80]}...' @ {w}x{h}, "
             f"strength={req.strength}, steps={req.num_steps}, seed={seed}")

    with progress_lock:
        current_progress.update({"step": 0, "total": req.num_steps, "status": "generating"})

    try:
        result_images = await asyncio.to_thread(
            _run_inpaint, req.prompt, req.negative_prompt, input_image,
            mask_image, req.strength, req.num_steps, req.guidance_scale, generator, req.batch_size
        )
        b64_images = [image_to_base64(img) for img in result_images]

        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "idle"})

        return {
            "images": b64_images,
            "width": result_images[0].width,
            "height": result_images[0].height,
            "seeds": [seed] * len(b64_images),
            "format": "png",
        }

    except Exception as e:
        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "error"})
        log.exception("Inpaint failed")
        raise HTTPException(status_code=500, detail=str(e))


def _run_inpaint(prompt, negative_prompt, image, mask, strength, steps, guidance, generator, batch_size):
    """Synchronous inpainting generation."""
    kwargs = {
        "prompt": prompt,
        "image": image,
        "mask_image": mask,
        "strength": strength,
        "num_inference_steps": steps,
        "guidance_scale": guidance,
        "generator": generator,
        "num_images_per_prompt": batch_size,
        "callback_on_step_end": make_progress_callback(steps),
    }
    if pipeline_type in ("sdxl_inpaint", "sd15_inpaint") and negative_prompt:
        kwargs["negative_prompt"] = negative_prompt

    output = pipeline(**kwargs)
    return output.images


@app.post("/unload")
async def unload():
    """Unload the current model to free GPU memory."""
    with pipeline_lock:
        unload_pipeline()
    return {"status": "unloaded"}


@app.post("/cancel")
async def cancel_generation():
    """Request cancellation of the current generation."""
    global cancel_requested
    cancel_requested = True
    log.info("Cancel requested by user")
    return {"status": "cancelling"}


# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info(f"Starting Oddity server on {HOST}:{PORT}")
    uvicorn.run(
        "server:app",
        host=HOST,
        port=PORT,
        reload=False,
        log_level="info",
    )
