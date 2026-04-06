# Oddity UI Spec

## 1. Design System

- Color palette:
  - Backgrounds: `#0a0a0b`, `#111113`, `#18181c`, `#1f1f25`, `#26262e`
  - Surfaces: `rgba(20,27,35,0.92)`, `rgba(26,35,48,0.90)`, `rgba(34,44,59,0.94)`, `rgba(38,51,68,0.96)`
  - Borders: `rgba(255,255,255,0.07)` default, `rgba(255,255,255,0.12)` raised, `rgba(124,110,245,0.4)` focus
  - Text: `#f0f0f2` strong, `#9898a8` primary, `#5c5c6e` secondary
  - Accents: indigo `#7C6EF5`, teal `#5DE4C7`, amber `#FFBF69`, error `#F05252`, success `#3ECF8E`
  - Model family badges: Flux `#7C8CFF`, SDXL `#49DCB1`, SD3 `#FFBF69`
- Typography:
  - Font stack: `'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
  - Sizes: `8 / 9 / 10 / 11 / 12 / 13 / 14px`
  - Heading weight: `600`
  - Labels use `0.08em`–`0.12em` tracking and uppercase
- Spacing:
  - Base unit: `4px`
  - Scale: `4, 6, 8, 10, 12, 14, 16`
  - Core card padding: `10px 12px`
  - Compact card padding: `8px 10px`
- Animation:
  - Fast: `150ms ease`
  - Base: `200ms ease`
  - Principles: no bouncing, no large transforms, use opacity and glow primarily

## 2. Full Panel States

- Idle:
  - Status pill is teal, label says "IDLE", sub says "Server ready — select a model to begin"
  - Stage surface shows placeholder
- Model Loading:
  - Status pill shifts to "LOADING" with amber tone
  - Sub-label: "Loading [FAMILY] pipeline..."
- Ready:
  - Status pill says the family name (e.g. "FLUX", "SDXL"), sub mentions current model
  - Generate button enabled when prompt is entered
- Generating:
  - Status pill becomes indigo, label shows family name
  - Primary button pulses, progress bar fills
  - Stats panel shows speed, ETA, batch
- Output ready:
  - Stage becomes compare surface
  - Before/After controls activate
  - Apply button enables
- Error:
  - Status pill turns red
  - Humanized message strip appears
- Offline:
  - Muted red status pill
  - Waiting for local server message

## 3. Component Library

### Header
- Logo mark: 22px gradient square with glowing core
- Logo text: "Oddity AI" uppercase
- Logo sub: model-aware subtitle
- Model Library icon button: opens model library view
- Status pill: tonal dot with label

### Model Selector Card
- Visible in Parameters section
- Dropdown grouped by model family (optgroup)
- Family badge shows color-coded model family name
- Sub-label shows selected model name or prompt to select

### Model Library (Separate View)
- Full-panel view toggled by library icon button
- Back button returns to main view
- **Shared Components section**: cards showing CLIP-L, T5-XXL, etc. with download status
- **Per-family sections**: header with family badge + VRAM requirements
- **Model cards**: name, description, size, status badge, download button
  - Ready (green border), Partial (amber), Not downloaded (default)
  - Download button triggers backend download with progress overlay

### Download Progress Overlay
- Sticky bottom overlay in library view
- Shows item name, progress bar, bytes downloaded
- Auto-dismisses on completion

### Tabs
- Generate, Inpaint, Expand, History
- Active tab has indigo glow and gradient bottom border

### Prompt Area
- Textarea with character counter
- Helper text below

### Parameters
- Strength, Guidance, Steps, Resolution sliders in 2-column grid
- Values auto-set from model defaults when model is selected

### Generate Button
- Full-width gradient button (indigo → teal)
- Pulse animation during generation

### VRAM Bar
- Bottom strip showing GPU memory usage

### History Strip
- Thumbnail strip at bottom with auto-save

## 4. View Architecture

Two views in the panel:

1. **Main View** (`data-view="main"`) — generation workflow
2. **Library View** (`data-view="library"`) — model management

Switching is controlled by `body[data-view]` CSS attribute.

## 5. Responsive Behavior

- Narrow `240px`: single column, compact cards
- Standard `320px`: single-column working mode
- Wide `480px+`: expanded layout with larger history

## 6. API Endpoints

- `GET /health` — server status, current model, GPU info
- `GET /registry` — full model registry with download status
- `GET /models` — ready-to-use models only
- `POST /models/download` — trigger model + deps download
- `GET /models/download/progress` — download progress
- `POST /generate` — text-to-image
- `POST /img2img` — image-to-image
- `POST /inpaint` — inpainting with mask
- `GET /progress` — generation progress
- `POST /unload` — free GPU memory
