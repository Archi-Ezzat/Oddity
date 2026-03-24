# GitHub Publish

Target remote:

- `https://github.com/Archi-Ezzat/Oddity`

## What is already prepared

- Project name updated to `Oddity`
- Heavy files and model weights excluded through `.gitignore`
- `downloads/` contains:
  - `assets.manifest.json`
  - `check_and_download.ps1`
  - `SOFTWARE_LINKS.md`
  - `CHECKLIST.generated.md`

## Create the remote repository

Create an empty GitHub repository named `Oddity` under `Archi-Ezzat`.

## Push commands

```powershell
git init -b main
git add .
git commit -m "Rename project to Oddity and add bootstrap tooling"
git remote add origin https://github.com/Archi-Ezzat/Oddity.git
git push -u origin main
```

## Rename the project root folder

The current root folder can only be renamed after Photoshop, the UXP debugger, and the backend server are closed.

Run this from `Z:\Projects` after closing those processes:

```powershell
Rename-Item -Path "Z:\Projects\PhotoshopBanana" -NewName "Oddity"
```
