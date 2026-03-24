"""
Oddity — FLUX.1-dev-SRPO Local Inference Server
Serves image generation/editing requests from the Photoshop UXP plugin.
"""

import asyncio
import base64
import gc
import io
import logging
import os
import sys
import time
import threading
from pathlib import Path
from contextlib import asynccontextmanager

import torch
import accelerate  # Force accelerate presence for diffusers cpu_offload check
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

MODEL_DIR = os.environ.get(
    "FLUX_MODEL_DIR",
    "Shakker-Labs/AWPortrait-FL",  # Ungated FLUX.1-dev base components
)
ROOT_DIR = Path(__file__).resolve().parent.parent
ASSETS_DIR = ROOT_DIR / "downloads" / "assets"
MODELS_PATH = Path(os.environ.get("ODDITY_MODELS_PATH", str(ASSETS_DIR / "models" / "unet" / "flux")))
CLIP_L_PATH = Path(os.environ.get("ODDITY_CLIP_L_PATH", str(ASSETS_DIR / "models" / "clip" / "clip_l.safetensors")))
T5_PATH = Path(os.environ.get("ODDITY_T5_PATH", str(ASSETS_DIR / "models" / "clip" / "t5xxl_fp16.safetensors")))
VAE_PATH = Path(os.environ.get("ODDITY_VAE_PATH", str(ASSETS_DIR / "models" / "vae" / "ae.safetensors")))
HOST = os.environ.get("ODDITY_HOST", os.environ.get("BANANA_HOST", "127.0.0.1"))
PORT = int(os.environ.get("ODDITY_PORT", os.environ.get("BANANA_PORT", "5000")))

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
model_status = "not_loaded"
current_loaded_model_name = None
current_progress = {"step": 0, "total": 0, "preview": None, "status": "idle"}
progress_lock = threading.Lock()
pipeline_lock = threading.Lock()


# ---------------------------------------------------------------------------
# Model loading
# ---------------------------------------------------------------------------

def load_base_pipeline():
    """Load the base FLUX pipeline components natively using local Comfy files where possible."""
    global pipeline, model_status
    model_status = "loading_base"
    log.info("Checking for local ComfyUI components...")
    try:
        from huggingface_hub import snapshot_download
        from diffusers import FluxPipeline, AutoencoderKL, FlowMatchEulerDiscreteScheduler, FluxTransformer2DModel
        from transformers import CLIPTextModel, T5EncoderModel, T5Config, CLIPTokenizer, T5TokenizerFast, CLIPTextConfig
        from safetensors.torch import load_file
        import torch
        import time

        # Check for local CLIP-L
        has_local_clip = CLIP_L_PATH.exists()
        
        # Explicitly allow ONLY the required small folders and configs. 
        # This prevents accidental matching of massive 30GB+ files in the repo root.
        allow_patterns = [
            "scheduler/*",
            "tokenizer/*",
            "tokenizer_2/*",
            "transformer/config.json",
            "model_index.json"
        ]
        if not has_local_clip:
            allow_patterns.append("text_encoder/*")

        # Download strictly allowed folders
        log.info("Downloading lightweight configs from HuggingFace...")
        base_dir = snapshot_download(
            MODEL_DIR,
            allow_patterns=allow_patterns
        )
        
        log.info("Loading Base Configs and Tokenizers...")
        tokenizer = CLIPTokenizer.from_pretrained(base_dir, subfolder="tokenizer")
        tokenizer_2 = T5TokenizerFast.from_pretrained(base_dir, subfolder="tokenizer_2")
        scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(base_dir, subfolder="scheduler")
        
        if has_local_clip:
            log.info(f"Loading local CLIP-L from {CLIP_L_PATH}...")
            clip_config_dir = snapshot_download(MODEL_DIR, allow_patterns=["text_encoder/config.json"])
            clip_config = CLIPTextConfig.from_pretrained(clip_config_dir + "/text_encoder")
            text_encoder = CLIPTextModel._from_config(clip_config)
            
            # OpenAI clip models from Comfy might have 'text_model.' prefix or lack it.
            sd = load_file(CLIP_L_PATH)
            if not any(k.startswith("text_model.") for k in sd.keys()):
                # Sometimes Comfy removes the prefix. If so, add it back for transformers compatibility.
                sd = {f"text_model.{k}": v for k, v in sd.items()}
            text_encoder.load_state_dict(sd, strict=False)
            text_encoder.to(torch.bfloat16)
        else:
            log.info("Downloading/Loading default CLIP-L from HuggingFace...")
            text_encoder = CLIPTextModel.from_pretrained(base_dir, subfolder="text_encoder", torch_dtype=torch.bfloat16)

        log.info("Loading VAE from ComfyUI...")
        t0 = time.time()
        vae_dir = snapshot_download(MODEL_DIR, allow_patterns=["vae/config.json"])
        vae = AutoencoderKL.from_single_file(
            str(VAE_PATH),
            config=vae_dir + "/vae",
            torch_dtype=torch.bfloat16
        )
        log.info(f"Loaded VAE in {time.time() - t0:.2f}s")

        log.info("Loading T5 from ComfyUI... (This may take 15-30s based on disk speed)")
        t0 = time.time()
        t5_dir = snapshot_download(MODEL_DIR, allow_patterns=["text_encoder_2/config.json"])
        t5_config = T5Config.from_pretrained(t5_dir + "/text_encoder_2")
        text_encoder_2 = T5EncoderModel._from_config(t5_config)
        text_encoder_2.load_state_dict(load_file(str(T5_PATH)))
        text_encoder_2.to(torch.bfloat16)
        log.info(f"Loaded T5 model in {time.time() - t0:.2f}s")

        log.info("Building Transformer skeleton from config...")
        transformer_config = FluxTransformer2DModel.load_config(base_dir + "/transformer")
        transformer = FluxTransformer2DModel.from_config(transformer_config)
        transformer.to(torch.bfloat16)

        log.info("Building Pipeline...")
        pipe = FluxPipeline(
            scheduler=scheduler,
            text_encoder=text_encoder,
            tokenizer=tokenizer,
            text_encoder_2=text_encoder_2,
            tokenizer_2=tokenizer_2,
            vae=vae,
            transformer=transformer
        )
        
        pipe.enable_model_cpu_offload()
        pipeline = pipe
        model_status = "ready_base"
        log.info("Base pipeline ready. Waiting for a model to be selected.")
    except Exception as e:
        log.exception(f"Failed to load base pipeline: {e}")
        model_status = "error"

def switch_transformer(model_name: str):
    """Swap the transformer weights dynamically."""
    global pipeline, current_loaded_model_name, model_status
    
    model_path = MODELS_PATH / model_name
    if not model_path.exists():
        raise FileNotFoundError(f"Model {model_name} not found at {model_path}")
        
    if current_loaded_model_name == model_name:
        return # Already loaded
        
    with pipeline_lock:
        model_status = "loading_weights"
        log.info(f"Loading weights for {model_name}... (This may take 15-30s)")
        
        import time
        t0 = time.time()
        from safetensors.torch import load_file
        state_dict = load_file(str(model_path))
        pipeline.transformer.load_state_dict(state_dict, strict=False)
        
        del state_dict
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            
        current_loaded_model_name = model_name
        model_status = "ready"
        log.info(f"✓ Model {model_name} loaded and ready in {time.time() - t0:.2f}s!")


# ---------------------------------------------------------------------------
# Progress callback
# ---------------------------------------------------------------------------

def make_progress_callback(total_steps: int):
    """Create a callback for tracking diffusion progress."""
    def callback(pipe, step, timestep, callback_kwargs):
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
    model_name: str = Field(..., description="Filename of the model to use")
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    width: int = Field(default=1024, ge=256, le=2048)
    height: int = Field(default=1024, ge=256, le=2048)
    num_steps: int = Field(default=20, ge=1, le=50)
    guidance_scale: float = Field(default=3.5, ge=1.0, le=20.0)
    seed: int = Field(default=-1)


class Img2ImgRequest(BaseModel):
    model_name: str = Field(..., description="Filename of the model to use")
    prompt: str = Field(..., min_length=1, max_length=2000)
    negative_prompt: str = Field(default="", max_length=2000)
    image: str = Field(..., description="Base64-encoded input image (PNG/JPEG)")
    strength: float = Field(default=0.75, ge=0.01, le=1.0)
    num_steps: int = Field(default=20, ge=1, le=50)
    guidance_scale: float = Field(default=3.5, ge=1.0, le=20.0)
    seed: int = Field(default=-1)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def image_to_base64(img: Image.Image, format: str = "PNG") -> str:
    """Convert PIL Image to base64 string."""
    buf = io.BytesIO()
    img.save(buf, format=format)
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def base64_to_image(b64: str) -> Image.Image:
    """Convert base64 string to PIL Image."""
    # Strip data URL prefix if present
    if "," in b64:
        b64 = b64.split(",", 1)[1]
    data = base64.b64decode(b64)
    return Image.open(io.BytesIO(data)).convert("RGB")


def round_to_multiple(val: int, multiple: int = 8) -> int:
    """Round dimension to nearest multiple (required for VAE)."""
    return max(multiple, (val // multiple) * multiple)


# ---------------------------------------------------------------------------
# App lifecycle
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load model on startup in a background thread."""
    thread = threading.Thread(target=load_base_pipeline, daemon=True)
    thread.start()
    yield
    log.info("Shutting down server...")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Oddity",
    description="Local FLUX.1-dev-SRPO inference server for Photoshop",
    version="1.0.0",
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
        "current_model": current_loaded_model_name,
        "models_path": str(MODELS_PATH),
        "gpu": gpu_info,
        "cuda_available": torch.cuda.is_available(),
    }


@app.get("/models")
async def list_models():
    """List available .safetensors models."""
    if not hasattr(MODELS_PATH, "exists") or not MODELS_PATH.exists():
        return []
    models = [f.name for f in MODELS_PATH.glob("*.safetensors")]
    return models


@app.get("/progress")
async def get_progress():
    """Current generation progress."""
    with progress_lock:
        return dict(current_progress)


@app.post("/generate")
async def generate(req: GenerateRequest):
    """Text-to-image generation."""
    if pipeline is None:
        raise HTTPException(
            status_code=503,
            detail=f"Base model not ready. Current status: {model_status}",
        )
        
    try:
        switch_transformer(req.model_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    width = round_to_multiple(req.width)
    height = round_to_multiple(req.height)
    seed = req.seed if req.seed >= 0 else int(time.time()) % (2**32)
    generator = torch.Generator("cpu").manual_seed(seed)

    log.info(f"Generating: '{req.prompt[:80]}...' @ {width}x{height}, "
             f"steps={req.num_steps}, cfg={req.guidance_scale}, seed={seed}")

    with progress_lock:
        current_progress.update({"step": 0, "total": req.num_steps, "status": "generating"})

    try:
        # Run inference in thread pool to avoid blocking the event loop
        result = await asyncio.to_thread(
            _run_generate, req.prompt, req.negative_prompt,
            width, height, req.num_steps, req.guidance_scale, generator,
        )
        b64 = image_to_base64(result)

        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "idle"})

        return {
            "image": b64,
            "width": result.width,
            "height": result.height,
            "seed": seed,
            "format": "png",
        }

    except Exception as e:
        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "error"})
        log.exception("Generation failed")
        raise HTTPException(status_code=500, detail=str(e))


def _run_generate(prompt, negative_prompt, width, height, steps, guidance, generator):
    """Synchronous generation (runs in thread)."""
    output = pipeline(
        prompt=prompt,
        width=width,
        height=height,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        callback_on_step_end=make_progress_callback(steps),
    )
    return output.images[0]


@app.post("/img2img")
async def img2img(req: Img2ImgRequest):
    """Image-to-image editing."""
    if pipeline is None:
        raise HTTPException(
            status_code=503,
            detail=f"Base model not ready. Current status: {model_status}",
        )
        
    try:
        switch_transformer(req.model_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    try:
        input_image = base64_to_image(req.image)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid image data: {e}")

    # Resize to nearest multiple of 8
    w = round_to_multiple(input_image.width)
    h = round_to_multiple(input_image.height)
    if w != input_image.width or h != input_image.height:
        input_image = input_image.resize((w, h), Image.LANCZOS)

    seed = req.seed if req.seed >= 0 else int(time.time()) % (2**32)
    generator = torch.Generator("cpu").manual_seed(seed)

    log.info(f"Img2Img: '{req.prompt[:80]}...' @ {w}x{h}, "
             f"strength={req.strength}, steps={req.num_steps}, seed={seed}")

    with progress_lock:
        current_progress.update({"step": 0, "total": req.num_steps, "status": "generating"})

    try:
        result = await asyncio.to_thread(
            _run_img2img, req.prompt, req.negative_prompt, input_image,
            req.strength, req.num_steps, req.guidance_scale, generator,
        )
        b64 = image_to_base64(result)

        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "idle"})

        return {
            "image": b64,
            "width": result.width,
            "height": result.height,
            "seed": seed,
            "format": "png",
        }

    except Exception as e:
        with progress_lock:
            current_progress.update({"step": 0, "total": 0, "status": "error"})
        log.exception("Img2Img failed")
        raise HTTPException(status_code=500, detail=str(e))


def _run_img2img(prompt, negative_prompt, image, strength, steps, guidance, generator):
    """Synchronous img2img (runs in thread)."""
    # FLUX pipeline supports img2img via the `image` parameter
    output = pipeline(
        prompt=prompt,
        image=image,
        strength=strength,
        num_inference_steps=steps,
        guidance_scale=guidance,
        generator=generator,
        callback_on_step_end=make_progress_callback(steps),
    )
    return output.images[0]


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
