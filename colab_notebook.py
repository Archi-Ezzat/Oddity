# ============================================================================
# Oddity AI — Google Colab Backend Setup
# ============================================================================
# Copy each section below into separate Colab cells.
# Run them in order from top to bottom.
# ============================================================================

# ===================== CELL 1: Install Dependencies ========================
# !pip install -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
# !pip install -q diffusers transformers accelerate safetensors
# !pip install -q fastapi uvicorn pyngrok pillow pydantic
# !pip install -q huggingface_hub

# ===================== CELL 2: Upload server.py ============================
# Option A: Upload from your local machine
# from google.colab import files
# uploaded = files.upload()  # Upload server.py and model_registry.json
#
# Option B: Mount Google Drive (recommended for persistence)
# from google.colab import drive
# drive.mount('/content/drive')
# Then copy your backend files:
# !cp /content/drive/MyDrive/Oddity/backend/server.py /content/
# !cp /content/drive/MyDrive/Oddity/backend/model_registry.json /content/

# ===================== CELL 3: Setup ngrok =================================
# Sign up free at https://ngrok.com and get your auth token
# Then paste it below:
#
# NGROK_AUTH_TOKEN = "YOUR_NGROK_TOKEN_HERE"
#
# from pyngrok import ngrok
# ngrok.set_auth_token(NGROK_AUTH_TOKEN)
# public_url = ngrok.connect(5000)
# print(f"\n{'='*60}")
# print(f"  ODDITY PUBLIC URL: {public_url}")
# print(f"{'='*60}")
# print(f"\nPaste this URL into your Photoshop plugin's Connection Settings!")

# ===================== CELL 4: Start the server ============================
# import os
# os.environ["ODDITY_HOST"] = "0.0.0.0"
# os.environ["ODDITY_PORT"] = "5000"
# os.environ["ODDITY_MODELS_DIR"] = "/content/models"
# os.environ["ODDITY_COMPONENTS_DIR"] = "/content/components"
#
# # Create directory structure
# !mkdir -p /content/models/flux/checkpoints
# !mkdir -p /content/models/sdxl/checkpoints
# !mkdir -p /content/models/sd3/checkpoints
# !mkdir -p /content/models/sd15/checkpoints
# !mkdir -p /content/components/shared/clip
# !mkdir -p /content/components/shared/vae
# !mkdir -p /content/components/flux/vae
# !mkdir -p /content/components/sdxl/vae
#
# # Run the server (this will block — keep this cell running)
# !cd /content && python server.py


# ============================================================================
# QUICK START — All-in-one cell (uncomment everything below)
# ============================================================================

"""
# --- 1. Install ---
!pip install -q torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
!pip install -q diffusers transformers accelerate safetensors
!pip install -q fastapi uvicorn pyngrok pillow pydantic huggingface_hub

# --- 2. Upload your backend files ---
# Upload server.py and model_registry.json to /content/
from google.colab import files
print("Upload server.py and model_registry.json from your Oddity backend folder:")
uploaded = files.upload()

# --- 3. Create model directories ---
import os
os.makedirs("/content/models/flux/checkpoints", exist_ok=True)
os.makedirs("/content/models/sdxl/checkpoints", exist_ok=True)
os.makedirs("/content/models/sd3/checkpoints", exist_ok=True)
os.makedirs("/content/models/sd15/checkpoints", exist_ok=True)
os.makedirs("/content/components/shared/clip", exist_ok=True)
os.makedirs("/content/components/shared/vae", exist_ok=True)
os.makedirs("/content/components/flux/vae", exist_ok=True)
os.makedirs("/content/components/sdxl/vae", exist_ok=True)

# --- 4. Set environment variables ---
os.environ["ODDITY_HOST"] = "0.0.0.0"
os.environ["ODDITY_PORT"] = "5000"
os.environ["ODDITY_MODELS_DIR"] = "/content/models"
os.environ["ODDITY_COMPONENTS_DIR"] = "/content/components"

# --- 5. Start ngrok tunnel ---
NGROK_AUTH_TOKEN = "PASTE_YOUR_NGROK_TOKEN_HERE"  # <-- CHANGE THIS

from pyngrok import ngrok
ngrok.set_auth_token(NGROK_AUTH_TOKEN)
public_url = ngrok.connect(5000)
print(f"\\n{'='*60}")
print(f"  YOUR ODDITY SERVER URL: {public_url}")
print(f"{'='*60}")
print(f"\\nCopy this URL and paste it into your Photoshop plugin's")
print(f"Connection Settings (gear icon) then click Connect.\\n")

# --- 6. Start server (this blocks — keep running) ---
!cd /content && python server.py
"""
