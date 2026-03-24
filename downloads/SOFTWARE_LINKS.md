# Software Links

Official links used to bootstrap another machine:

- Python downloads: https://www.python.org/downloads/
- PyTorch local install guide: https://docs.pytorch.org/get-started/locally/
- Adobe Photoshop UXP docs: https://developer.adobe.com/photoshop/uxp/
- Adobe UXP Developer Tool guide: https://developer.adobe.com/photoshop/uxp/2022/guides/devtool/
- UXP Developer Tool installation notes: https://adobedocs.github.io/uxp-photoshop/guides/devtool/installation/
- ComfyUI repository: https://github.com/comfyanonymous/ComfyUI

Model and asset source pages:

- Base config repo used by the backend: https://huggingface.co/Shakker-Labs/AWPortrait-FL
- FLUX.2 klein 9B checkpoint: https://huggingface.co/black-forest-labs/FLUX.2-klein-9B/blob/main/flux-2-klein-9b.safetensors
- FLUX VAE source page: https://huggingface.co/StableDiffusionVN/Flux/blob/main/Vae/flux_vae.safetensors
- FLUX Fill source page: https://huggingface.co/black-forest-labs/FLUX.1-Fill-dev
- FLUX text encoders: https://huggingface.co/comfyanonymous/flux_text_encoders
- Reference T5 repo: https://huggingface.co/google/flan-t5-xxl/tree/main

Manual reminder:

- Some transformer `.safetensors` files in your current machine are user-provided local weights. If a file in `downloads/assets.manifest.json` has an empty `sourceUrl`, fill it in once you confirm the exact source page.
- For Oddity, do not pull the sharded `google/flan-t5-xxl` weight set unless you are changing the backend. The current backend expects the single-file `t5xxl_fp16.safetensors` from `comfyanonymous/flux_text_encoders`.
