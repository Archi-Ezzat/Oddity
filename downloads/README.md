# Downloads Bootstrap

This folder is the portability layer for another PC.

## Files

- `assets.manifest.json`: required and optional local assets
- `check_and_download.ps1`: checks what exists, shows a checklist, and downloads supported missing files
- `SOFTWARE_LINKS.md`: manual software and model source links
- `CHECKLIST.generated.md`: generated after running the checker and intentionally not tracked in Git

## Usage

Check only:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1
```

Check and download supported missing assets:

```powershell
powershell -ExecutionPolicy Bypass -File downloads\check_and_download.ps1 -DownloadMissing
```

## Expected local asset layout

```text
downloads/
  assets/
    models/
      clip/
        clip_l.safetensors
        t5xxl_fp16.safetensors
      vae/
        ae.safetensors
      unet/
        flux/
          *.safetensors
```
