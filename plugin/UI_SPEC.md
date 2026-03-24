# Oddity UI Spec

## 1. Design System

- Color palette:
  - Backgrounds: `#0C0F13`, `#10151B`, `#151B23`, `#1A2330`
  - Surfaces: `rgba(20,27,35,0.92)`, `rgba(26,35,48,0.90)`, `rgba(34,44,59,0.94)`, `rgba(38,51,68,0.96)`
  - Borders: `rgba(255,255,255,0.08)` default, `rgba(255,255,255,0.14)` raised, `rgba(102,210,255,0.58)` focus
  - Text: `#F6F8FB` strong, `#DBE4EF` primary, `#9DACBE` secondary, `#738295` tertiary
  - Accents: indigo `#7C8CFF`, teal `#49DCB1`, amber `#FFBF69`, error `#FF7A88`, utility blue `#66D2FF`
- Typography:
  - Font stack: `"Segoe UI Variable", "SF Pro Text", "Adobe Clean", "Inter", "Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif`
  - Sizes: `10 / 11 / 12 / 13 / 14 / 15 / 16px`
  - Heading weight: `620-650`
  - Labels use `0.08em` tracking and uppercase
- Spacing:
  - Base unit: `4px`
  - Scale: `4, 8, 12, 16, 20, 24, 28`
  - Core card padding: `16px`
  - Compact card padding: `12px`
- Elevation:
  - Level 0: `inset 0 1px 0 rgba(255,255,255,0.04)`
  - Level 1: `0 10px 30px rgba(0,0,0,0.24)` plus subtle inset
  - Level 2: `0 18px 42px rgba(0,0,0,0.34)` plus subtle inset
  - Focus glow: `0 0 0 1px rgba(102,210,255,0.22), 0 0 0 4px rgba(102,210,255,0.12)`
- Icon style:
  - Recommendation: 1.75px stroke icons with rounded joins, sized at `14-16px`
  - Good source: Lucide, bundled at build time only
  - Current implementation uses text badges and lettermarks to stay runtime-light in UXP
- Animation:
  - Fast: `140ms cubic-bezier(0.22, 1, 0.36, 1)`
  - Base: `220ms cubic-bezier(0.22, 1, 0.36, 1)`
  - Slow reveal: `420ms cubic-bezier(0.19, 1, 0.22, 1)`
  - Principles: no bouncing, no large transforms, use opacity, glow, and 1-2px lift only

## 2. Full Panel States

- Idle / Ready:
  - Status pill is teal and narrative says the local engine is ready
  - Stage surface shows "Compose a prompt to begin"
- Prompt entry:
  - Status pill shifts to `Composing`
  - Composer card border moves to teal accent
  - Character meter updates live
- Generating:
  - Status pill becomes indigo
  - Primary button pulses
  - Story orbit advances via conic ring and three milestones: `Brief`, `Sample`, `Refine`
  - Frame caption moves through `Preparing request`, `% sampled`, then ready
- Output ready:
  - Stage becomes compare surface
  - Split, Before, After controls activate
  - Apply button enables and route selector determines destination
- History expanded:
  - Recent renders appear as thumbnail cards with prompt, mode, time, and seed
  - Clicking restores prompt, parameters, preview, and compare source
- Settings expanded:
  - Width, height, steps, seed, guidance, and strength appear in a single card
  - Canvas-driven modes dim width and height because dimensions come from Photoshop
- Error:
  - Status pill turns red and message strip appears
  - Stage copy becomes a soft retry message rather than an alarm
- Offline / Starting:
  - Offline uses muted red
  - Starting uses amber and the narrative references local model warmup

## 3. Component Library

- Primary action button:
  - Height `46px`, radius `14px`
  - Gradient fill from teal to indigo
  - Hover lift `-1px`
  - Loading state uses pulse animation, no spinner
- Prompt text area:
  - Min height `118px`
  - Background `rgba(8,12,16,0.24)`
  - Focus ring uses the system focus glow token
  - Character count sits in an inline pill
  - Suggestion chips sit below the field
- Sliders:
  - Track height `6px`
  - Thumb size `16px`
  - Guidance and strength values echo on the right
  - Labels: `Loose / Balanced / Literal` and `Preserve / Balance / Rebuild`
- Layer routing selector:
  - Compact select field in the top status grid
  - Routes: `New Layer`, `Replace Canvas`, `Mask Review Layer`
- Thumbnail history strip:
  - Card size `68px` thumb + content column
  - Active state uses indigo border and tinted background
- Status pill:
  - 26px tall
  - Dot beacon built in via pseudo-element
  - Tones: offline red, starting amber, ready teal, generating indigo, error red
- Before / After comparison:
  - Default is split view when a source image exists
  - Split handle is a vertical rail with a capsule grip
- Preset card:
  - 14px radius, 12px padding
  - Active preset uses teal tint and glow

## 4. Micro-Interactions

- Pressing Generate:
  - Button enters a subtle pulse, orbit ring wakes up, caption changes from shortcut hint to source hint
- Generation progress:
  - No progress bar
  - A conic orbit ring fills while milestone cards advance from active to complete
- Success reveal:
  - Output image fades in and the frame caption flips to `Preview ready` or `Split compare ready`
- Error:
  - The panel does not shake or flash
  - It swaps in a red-tinted retry strip and calm explanatory copy
- History click:
  - Restores preview instantly, swaps mode, reapplies parameters, and surfaces a short success strip

## 5. Responsive Behavior

- Narrow `240px`:
  - Mode chips wrap to two columns
  - Status grid and actions collapse to one column
  - Drawers stay mostly closed by default
  - Stage height reduces to `176px`
- Standard `320px`:
  - Single-column working mode
  - Presets stay open, settings and history are collapsible
  - App shell is capped to `600px` max height
- Wide `480px+`:
  - Top strip becomes a two-column band
  - Main body becomes a two-column layout
  - History stays visible by default
  - Stage layout splits compare frame and story panel side by side
