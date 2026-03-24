import os
import gc
import torch
from pathlib import Path
from huggingface_hub import snapshot_download
from diffusers import FluxPipeline, AutoencoderKL, FluxTransformer2DModel, FlowMatchEulerDiscreteScheduler
from transformers import CLIPTextModel, T5EncoderModel, CLIPTokenizer, T5TokenizerFast
from safetensors.torch import load_file

def load_local_flux():
    print("Downloading lightweight configs and CLIP text encoder (approx 300MB)...")
    base_dir = snapshot_download(
        "Shakker-Labs/AWPortrait-FL",
        ignore_patterns=["transformer/*", "vae/*", "text_encoder_2/*"]
    )
    
    print("Loading Base Configs and Tokenizers...")
    tokenizer = CLIPTokenizer.from_pretrained(base_dir, subfolder="tokenizer")
    tokenizer_2 = T5TokenizerFast.from_pretrained(base_dir, subfolder="tokenizer_2")
    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(base_dir, subfolder="scheduler")
    text_encoder = CLIPTextModel.from_pretrained(base_dir, subfolder="text_encoder", torch_dtype=torch.bfloat16)

    print("Loading VAE from ComfyUI...")
    # Get config by downloading just the VAE config json
    vae_dir = snapshot_download("Shakker-Labs/AWPortrait-FL", allow_patterns=["vae/config.json"])
    vae = AutoencoderKL.from_config(vae_dir + "/vae")
    vae.load_state_dict(load_file("Z:/Comfy/models/vae/ae.safetensors"))
    vae.to(torch.bfloat16)

    print("Loading T5 from ComfyUI...")
    t5_dir = snapshot_download("Shakker-Labs/AWPortrait-FL", allow_patterns=["text_encoder_2/config.json"])
    # We must use T5Config
    from transformers import T5Config
    t5_config = T5Config.from_pretrained(t5_dir + "/text_encoder_2")
    text_encoder_2 = T5EncoderModel._from_config(t5_config)
    text_encoder_2.load_state_dict(load_file("Z:/Comfy/models/clip/t5xxl_fp16.safetensors"))
    text_encoder_2.to(torch.bfloat16)

    print("Building Pipeline (without Transformer)...")
    pipe = FluxPipeline(
        scheduler=scheduler,
        text_encoder=text_encoder,
        tokenizer=tokenizer,
        text_encoder_2=text_encoder_2,
        tokenizer_2=tokenizer_2,
        vae=vae,
        transformer=None
    )
    
    print("Success! Pipeline built without 34GB download.")

if __name__ == "__main__":
    load_local_flux()
