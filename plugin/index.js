const { app, action, core, imaging } = require("photoshop");
const { storage } = require("uxp");

const SERVER_URLS = ["http://127.0.0.1:5000", "http://localhost:5000"];
const HEALTH_POLL_MS = 3000;
const PROGRESS_POLL_MS = 450;
const MAX_HISTORY = 8;
const STORAGE_KEYS = {
  history: "oddity.history.v2",
  presets: "oddity.presets.v2",
};

const MODE_CONFIG = {
  generate: {
    title: "Fresh scene",
    placeholder: "Describe the composition, atmosphere, lens language, and edits you want.",
    context: "Text-to-image can create on a new layer or replace the current canvas.",
    action: "Generate",
    suggestions: [
      "Cinematic window light, subtle grain, editorial realism",
      "Glossy product shot with deep charcoal backdrop and reflected rim light",
      "Architectural concept frame with crisp perspective and restrained teal ambience",
    ],
    usesCanvas: false,
    lockDimensions: false,
  },
  inpaint: {
    title: "Selection repair",
    placeholder: "Describe what should replace the selected area while respecting the surrounding scene.",
    context: "Best with an active selection or mask. The current server uses the Photoshop document as the source image.",
    action: "Inpaint",
    suggestions: [
      "Remove the distraction and rebuild matching stone texture with soft evening light",
      "Replace the object with clean fabric folds and consistent shadow direction",
      "Repair the skin area naturally, preserving pore detail and local color",
    ],
    usesCanvas: true,
    lockDimensions: true,
  },
  outpaint: {
    title: "Canvas expansion",
    placeholder: "Describe how the scene should continue beyond the current crop.",
    context: "Expand the canvas in Photoshop first, then use this mode to extend the scene into the new space.",
    action: "Expand",
    suggestions: [
      "Continue the skyline with layered fog, distant towers, and dawn haze",
      "Extend the studio set with brushed concrete floor and practical lights",
      "Reveal more negative space on the left with subtle environment continuation",
    ],
    usesCanvas: true,
    lockDimensions: true,
  },
  img2img: {
    title: "Guided remix",
    placeholder: "Describe the transformation while retaining the source composition and lighting.",
    context: "The active Photoshop document becomes the source image. Lower strength keeps more of the original structure.",
    action: "Remix",
    suggestions: [
      "Preserve composition, shift palette to moody tungsten and add crisp specular detail",
      "Convert to premium matte illustration while keeping silhouette and framing",
      "Keep facial identity and pose, upgrade wardrobe styling and cinematic color",
    ],
    usesCanvas: true,
    lockDimensions: true,
  },
};

const STATUS_COPY = {
  offline: { label: "Offline", narrative: "Waiting for the local server to respond.", footer: "Server offline", pill: "offline" },
  starting: { label: "Starting", narrative: "Loading local model components and warming the pipeline.", footer: "Server warming up", pill: "starting" },
  ready: { label: "Ready", narrative: "Local engine is online and ready to render.", footer: "Ready for generation", pill: "ready" },
  typing: { label: "Composing", narrative: "Direction is being refined before the next render.", footer: "Prompt in progress", pill: "typing" },
  generating: { label: "Generating", narrative: "Sampling locally on your machine.", footer: "Generating locally", pill: "generating" },
  success: { label: "Ready", narrative: "A new render is ready for review and routing.", footer: "Output ready", pill: "success" },
  error: { label: "Attention", narrative: "The last request needs a smaller or cleaner prompt run.", footer: "Generation needs revision", pill: "error" },
};

const DEFAULT_PRESETS = [
  { id: "faithful-repair", name: "Faithful Repair", description: "Selection-safe edits with restrained guidance and strong structure retention.", params: { mode: "inpaint", width: 1024, height: 1024, steps: 24, guidance: 3.5, strength: 0.4, seed: -1, route: "new_layer" } },
  { id: "cinema-boost", name: "Cinema Boost", description: "Adds contrast, mood, and richer atmosphere without oversharpening.", params: { mode: "img2img", width: 1024, height: 1024, steps: 28, guidance: 4.0, strength: 0.62, seed: -1, route: "new_layer" } },
  { id: "clean-product", name: "Clean Product", description: "Quiet studio renders with crisp edges and controlled reflections.", params: { mode: "generate", width: 1024, height: 1024, steps: 26, guidance: 3.0, strength: 0.75, seed: -1, route: "new_layer" } },
];

const $ = (id) => document.getElementById(id);

const dom = {};

const state = {
  currentMode: "generate",
  isGenerating: false,
  serverConnected: false,
  modelReady: false,
  appStatus: "offline",
  lastGeneratedImage: null,
  beforeImage: null,
  history: loadStored(STORAGE_KEYS.history, []),
  presets: mergePresets(loadStored(STORAGE_KEYS.presets, [])),
  activePresetId: "clean-product",
  compareMode: "after",
  progressInterval: null,
  healthInterval: null,
  messageTimer: null,
  widthMode: "standard",
  serverUrl: SERVER_URLS[0],
  drawerState: { presets: true, settings: false, history: false },
};

function bindDom() {
  Object.assign(dom, {
    body: document.body,
    statusPill: $("statusPill"),
    statusNarrative: $("statusNarrative"),
    statusText: $("statusText"),
    footerMeta: $("footerMeta"),
    queueValue: $("queueValue"),
    gpuInfo: $("gpuInfo"),
    settingModel: $("settingModel"),
    layerRouting: $("layerRouting"),
    modeGenerate: $("modeGenerate"),
    modeInpaint: $("modeInpaint"),
    modeOutpaint: $("modeOutpaint"),
    modeEdit: $("modeEdit"),
    modeTitle: $("modeTitle"),
    promptInput: $("promptInput"),
    contextNote: $("contextNote"),
    charCount: $("charCount"),
    clearPromptBtn: $("clearPromptBtn"),
    suggestionRow: $("suggestionRow"),
    compareSplitBtn: $("compareSplitBtn"),
    compareBeforeBtn: $("compareBeforeBtn"),
    compareAfterBtn: $("compareAfterBtn"),
    compareFrame: $("compareFrame"),
    compareSlider: $("compareSlider"),
    compareHandle: $("compareHandle"),
    previewImage: $("previewImage"),
    beforeImage: $("beforeImage"),
    emptyBadge: $("emptyBadge"),
    emptyHeadline: $("emptyHeadline"),
    emptyDetail: $("emptyDetail"),
    frameStatus: $("frameStatus"),
    seedEcho: $("seedEcho"),
    storyPanel: $("storyPanel"),
    storyPercent: $("storyPercent"),
    storyLabel: $("storyLabel"),
    progressText: $("progressText"),
    storyNodeBrief: $("storyNodeBrief"),
    storyNodeSample: $("storyNodeSample"),
    storyNodeRefine: $("storyNodeRefine"),
    generateBtn: $("generateBtn"),
    generateLabel: $("generateLabel"),
    generateCaption: $("generateCaption"),
    applyBtn: $("applyBtn"),
    errorMessage: $("errorMessage"),
    togglePresetBtn: $("togglePresetBtn"),
    toggleHistoryBtn: $("toggleHistoryBtn"),
    toggleSettingsBtn: $("toggleSettingsBtn"),
    togglePresetDrawer: $("togglePresetDrawer"),
    toggleSettingsDrawer: $("toggleSettingsDrawer"),
    toggleHistoryDrawer: $("toggleHistoryDrawer"),
    presetDrawer: $("presetDrawer"),
    settingsDrawer: $("settingsDrawer"),
    historyDrawer: $("historyDrawer"),
    presetList: $("presetList"),
    historyList: $("historyList"),
    savePresetBtn: $("savePresetBtn"),
    settingWidth: $("settingWidth"),
    settingHeight: $("settingHeight"),
    settingSteps: $("settingSteps"),
    settingSeed: $("settingSeed"),
    settingGuidance: $("settingGuidance"),
    guidanceValue: $("guidanceValue"),
    settingStrength: $("settingStrength"),
    strengthValue: $("strengthValue"),
    strengthField: $("strengthField"),
    widthField: $("widthField"),
    heightField: $("heightField"),
    settingsNote: $("settingsNote"),
  });
}

function validateDom() {
  const required = [
    "body",
    "promptInput",
    "generateBtn",
    "applyBtn",
    "statusPill",
    "statusNarrative",
    "statusText",
    "settingModel",
    "layerRouting",
  ];
  const missing = required.filter((key) => !dom[key]);
  if (missing.length) {
    throw new Error(`Missing DOM nodes: ${missing.join(", ")}`);
  }
}

function loadStored(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch (error) {
    return fallback;
  }
}

function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.warn(`Unable to persist ${key}`, error);
  }
}

function mergePresets(customPresets) {
  return [...DEFAULT_PRESETS, ...(Array.isArray(customPresets) ? customPresets : [])];
}

function persistState() {
  const customPresets = state.presets.filter((preset) => !DEFAULT_PRESETS.some((item) => item.id === preset.id));
  saveStored(STORAGE_KEYS.presets, customPresets);
  saveStored(STORAGE_KEYS.history, state.history);
}

function escapeHtml(text) {
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function shorten(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function getPromptValue() {
  if (!dom.promptInput) return "";
  return typeof dom.promptInput.value === "string" ? dom.promptInput.value : "";
}

function snapshotSettings() {
  return {
    mode: state.currentMode,
    width: parseInt(dom.settingWidth.value, 10),
    height: parseInt(dom.settingHeight.value, 10),
    steps: parseInt(dom.settingSteps.value, 10),
    guidance: parseFloat(dom.settingGuidance.value),
    strength: parseFloat(dom.settingStrength.value),
    seed: parseInt(dom.settingSeed.value, 10),
    route: dom.layerRouting.value,
    model: dom.settingModel.value,
  };
}

function applySettingsSnapshot(settings) {
  if (!settings) return;
  if (settings.mode && MODE_CONFIG[settings.mode]) setMode(settings.mode);
  if (settings.width) dom.settingWidth.value = settings.width;
  if (settings.height) dom.settingHeight.value = settings.height;
  if (settings.steps) dom.settingSteps.value = settings.steps;
  if (typeof settings.guidance === "number") dom.settingGuidance.value = settings.guidance;
  if (typeof settings.strength === "number") dom.settingStrength.value = settings.strength;
  if (typeof settings.seed === "number") dom.settingSeed.value = settings.seed;
  if (settings.route) dom.layerRouting.value = settings.route;
  if (settings.model && [...dom.settingModel.options].some((option) => option.value === settings.model)) {
    dom.settingModel.value = settings.model;
  }
  syncNumericUI();
  updateApplyLabel();
}

function setAppStatus(status, override = {}) {
  const copy = { ...STATUS_COPY[status], ...override };
  state.appStatus = status;
  dom.body.dataset.status = status;
  dom.statusPill.textContent = copy.label;
  dom.statusPill.className = `status-pill ${copy.pill || status}`;
  dom.statusNarrative.textContent = copy.narrative;
  dom.statusText.textContent = copy.footer;
}

function setFooterMeta(text) {
  dom.footerMeta.textContent = text;
}

function setQueueState(text) {
  dom.queueValue.textContent = text;
  setFooterMeta(`Queue ${text.toLowerCase()}`);
}

function showMessage(message, tone = "neutral", duration = 3800) {
  clearTimeout(state.messageTimer);
  dom.errorMessage.textContent = message;
  dom.errorMessage.className = "message-strip is-visible";
  if (tone === "error") dom.errorMessage.classList.add("is-error");
  if (tone === "success") dom.errorMessage.classList.add("is-success");
  if (duration > 0) {
    state.messageTimer = setTimeout(() => {
      dom.errorMessage.className = "message-strip";
    }, duration);
  }
}

function clearMessage() {
  clearTimeout(state.messageTimer);
  dom.errorMessage.className = "message-strip";
  dom.errorMessage.textContent = "";
}

function renderSuggestions() {
  const config = MODE_CONFIG[state.currentMode];
  dom.suggestionRow.innerHTML = "";
  config.suggestions.forEach((text) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "suggestion-chip";
    button.textContent = shorten(text, 42);
    button.title = text;
    button.addEventListener("click", () => {
      dom.promptInput.value = text;
      updatePromptState();
      dom.promptInput.focus();
    });
    dom.suggestionRow.appendChild(button);
  });
}

function updatePromptState() {
  const length = getPromptValue().length;
  dom.charCount.textContent = length;
  if (!state.isGenerating && state.modelReady) {
    setAppStatus(length > 0 ? "typing" : state.lastGeneratedImage ? "success" : "ready");
  }
  updateGenerateAvailability();
}

function updateGenerateAvailability() {
  const canGenerate = Boolean(getPromptValue().trim()) && Boolean(dom.settingModel.value) && state.modelReady && !state.isGenerating;
  dom.generateBtn.disabled = !canGenerate;
}

function updateApplyLabel() {
  const labels = {
    new_layer: "Apply to new layer",
    replace_canvas: "Replace canvas",
    new_mask: "Place mask review layer",
  };
  dom.applyBtn.textContent = labels[dom.layerRouting.value] || "Apply result";
}

function syncNumericUI() {
  dom.guidanceValue.textContent = Number(dom.settingGuidance.value).toFixed(1);
  dom.strengthValue.textContent = Number(dom.settingStrength.value).toFixed(2);
}

function updateModeUI() {
  const config = MODE_CONFIG[state.currentMode];
  dom.body.dataset.mode = state.currentMode;
  dom.modeGenerate.classList.toggle("active", state.currentMode === "generate");
  dom.modeInpaint.classList.toggle("active", state.currentMode === "inpaint");
  dom.modeOutpaint.classList.toggle("active", state.currentMode === "outpaint");
  dom.modeEdit.classList.toggle("active", state.currentMode === "img2img");
  dom.modeTitle.textContent = config.title;
  dom.promptInput.placeholder = config.placeholder;
  dom.contextNote.textContent = config.context;
  dom.generateLabel.textContent = config.action;
  dom.generateCaption.textContent = config.usesCanvas ? "Uses active document" : "Ctrl/Cmd + Enter";
  dom.strengthField.style.display = config.usesCanvas ? "grid" : "none";
  dom.settingWidth.disabled = config.lockDimensions;
  dom.settingHeight.disabled = config.lockDimensions;
  dom.widthField.style.opacity = config.lockDimensions ? "0.56" : "1";
  dom.heightField.style.opacity = config.lockDimensions ? "0.56" : "1";
  dom.settingsNote.textContent = config.usesCanvas
    ? "Document-driven modes use the active Photoshop canvas as the source surface."
    : "Generation mode creates a new image at the selected dimensions.";
  renderSuggestions();
  updateCompareUI();
  updateGenerateAvailability();
}

function setMode(mode) {
  if (!MODE_CONFIG[mode]) return;
  state.currentMode = mode;
  updateModeUI();
}

function updateWidthMode() {
  const width = window.innerWidth;
  state.widthMode = width < 280 ? "narrow" : width >= 480 ? "wide" : "standard";
  dom.body.dataset.width = state.widthMode;
  applyDrawerState();
}

function setDrawerOpen(drawer, drawerButton, iconButton, isOpen) {
  drawer.classList.toggle("is-open", isOpen);
  drawerButton.setAttribute("aria-expanded", String(isOpen));
  iconButton.setAttribute("aria-expanded", String(isOpen));
  const label = drawer.querySelector(".drawer-state");
  if (label) label.textContent = isOpen ? "Open" : "Closed";
}

function applyDrawerState() {
  const presetsOpen = state.widthMode === "narrow" ? state.drawerState.presets : true;
  const historyOpen = state.widthMode === "wide" ? true : state.drawerState.history;
  const settingsOpen = state.drawerState.settings;
  setDrawerOpen(dom.presetDrawer, dom.togglePresetDrawer, dom.togglePresetBtn, presetsOpen);
  setDrawerOpen(dom.historyDrawer, dom.toggleHistoryDrawer, dom.toggleHistoryBtn, historyOpen);
  setDrawerOpen(dom.settingsDrawer, dom.toggleSettingsDrawer, dom.toggleSettingsBtn, settingsOpen);
}

function toggleDrawer(name) {
  state.drawerState[name] = !state.drawerState[name];
  applyDrawerState();
}

function updateCompareUI() {
  const canCompare = Boolean(state.beforeImage && state.lastGeneratedImage);
  dom.compareFrame.classList.toggle("has-before", Boolean(state.beforeImage));
  dom.compareFrame.classList.toggle("has-preview", Boolean(state.lastGeneratedImage));
  dom.compareFrame.classList.toggle("can-compare", canCompare);

  if (!canCompare && state.compareMode === "split") {
    state.compareMode = "after";
  }

  dom.compareFrame.dataset.compare = canCompare ? state.compareMode : "after";
  dom.compareFrame.style.setProperty("--split-point", `${dom.compareSlider.value}%`);
  dom.compareHandle.style.left = `${dom.compareSlider.value}%`;
  dom.compareSplitBtn.classList.toggle("active", state.compareMode === "split");
  dom.compareBeforeBtn.classList.toggle("active", state.compareMode === "before");
  dom.compareAfterBtn.classList.toggle("active", state.compareMode === "after");
  dom.compareSplitBtn.classList.toggle("is-disabled", !canCompare);
  dom.compareBeforeBtn.classList.toggle("is-disabled", !canCompare);
}

function setCompareMode(mode) {
  if ((mode === "split" || mode === "before") && !(state.beforeImage && state.lastGeneratedImage)) return;
  state.compareMode = mode;
  updateCompareUI();
}

function updateStageEmpty(copy) {
  dom.emptyBadge.textContent = copy.badge;
  dom.emptyHeadline.textContent = copy.headline;
  dom.emptyDetail.textContent = copy.detail;
}

function setStoryProgress(step, total) {
  const ratio = total > 0 ? Math.max(0, Math.min(1, step / total)) : 0;
  const percentage = Math.round(ratio * 100);
  dom.storyPercent.textContent = `${percentage}%`;
  dom.storyPanel.style.setProperty("--story-progress-angle", `${Math.max(12, Math.round(360 * ratio))}deg`);

  const nodes = [dom.storyNodeBrief, dom.storyNodeSample, dom.storyNodeRefine];
  nodes.forEach((node) => node.classList.remove("is-active", "is-complete"));

  if (ratio <= 0.2) {
    dom.storyNodeBrief.classList.add("is-active");
    dom.storyLabel.textContent = "Preparing brief";
  } else if (ratio <= 0.74) {
    dom.storyNodeBrief.classList.add("is-complete");
    dom.storyNodeSample.classList.add("is-active");
    dom.storyLabel.textContent = "Sampling locally";
  } else if (ratio < 1) {
    dom.storyNodeBrief.classList.add("is-complete");
    dom.storyNodeSample.classList.add("is-complete");
    dom.storyNodeRefine.classList.add("is-active");
    dom.storyLabel.textContent = "Refining detail";
  } else {
    nodes.forEach((node) => node.classList.add("is-complete"));
    dom.storyLabel.textContent = "Review ready";
  }
}

function setStoryIdle() {
  dom.storyPanel.style.setProperty("--story-progress-angle", "12deg");
  dom.storyPercent.textContent = "0%";
  dom.storyLabel.textContent = "Ready";
  dom.progressText.textContent = "Local model standing by.";
  dom.storyNodeBrief.className = "story-node is-active";
  dom.storyNodeSample.className = "story-node";
  dom.storyNodeRefine.className = "story-node";
}

function pushHistoryEntry(result, seed) {
  const entry = {
    id: `history-${Date.now()}`,
    prompt: getPromptValue().trim(),
    mode: state.currentMode,
    timestamp: Date.now(),
    image: result.image,
    beforeImage: state.beforeImage,
    seed,
    settings: snapshotSettings(),
  };
  state.history = [entry, ...state.history].slice(0, MAX_HISTORY);
  persistState();
  renderHistory();
}

function restoreHistoryEntry(entry) {
  if (!entry) return;
  applySettingsSnapshot(entry.settings);
  dom.promptInput.value = entry.prompt;
  state.beforeImage = entry.beforeImage || null;
  state.lastGeneratedImage = { base64: entry.image };
  dom.previewImage.src = `data:image/png;base64,${entry.image}`;
  if (entry.beforeImage) dom.beforeImage.src = `data:image/png;base64,${entry.beforeImage}`;
  dom.seedEcho.textContent = `Seed ${entry.seed}`;
  dom.frameStatus.textContent = `${MODE_CONFIG[entry.mode].action} restored`;
  setCompareMode(entry.beforeImage ? "split" : "after");
  updatePromptState();
  setAppStatus("success", { narrative: "History state restored with prompt and parameters." });
  updateStageEmpty({
    badge: "History restore",
    headline: "Render restored for review",
    detail: "Prompt, mode, and tuning were restored from local history.",
  });
  updateCompareUI();
  renderHistory();
  showMessage("History item restored.", "success");
}

function renderHistory() {
  dom.historyList.innerHTML = "";
  if (!state.history.length) {
    const empty = document.createElement("div");
    empty.className = "history-meta";
    empty.textContent = "No renders yet. Your last local outputs will appear here.";
    dom.historyList.appendChild(empty);
    return;
  }

  state.history.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    if (state.lastGeneratedImage && state.lastGeneratedImage.base64 === entry.image) {
      button.classList.add("is-active");
    }
    button.innerHTML = `
      <div class="history-thumb">
        <img src="data:image/png;base64,${entry.image}" alt="History preview" />
      </div>
      <div>
        <div class="history-prompt">${escapeHtml(shorten(entry.prompt || "Untitled render", 68))}</div>
        <div class="history-meta">${escapeHtml(MODE_CONFIG[entry.mode].action)}  |  ${new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}  |  Seed ${entry.seed}</div>
      </div>
    `;
    button.addEventListener("click", () => restoreHistoryEntry(entry));
    dom.historyList.appendChild(button);
  });
}

function renderPresets() {
  dom.presetList.innerHTML = "";
  state.presets.forEach((preset) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "preset-card";
    if (preset.id === state.activePresetId) button.classList.add("is-active");
    button.innerHTML = `
      <div class="preset-head">
        <div>
          <div class="preset-name">${escapeHtml(preset.name)}</div>
          <div class="preset-desc">${escapeHtml(preset.description)}</div>
        </div>
        <span class="preset-chip"></span>
      </div>
    `;
    button.addEventListener("click", () => {
      state.activePresetId = preset.id;
      applySettingsSnapshot(preset.params);
      renderPresets();
      showMessage(`Preset "${preset.name}" loaded.`, "success");
    });
    dom.presetList.appendChild(button);
  });
}

function saveCurrentPreset() {
  const timestamp = new Date();
  const preset = {
    id: `custom-${timestamp.getTime()}`,
    name: `Custom ${timestamp.getHours().toString().padStart(2, "0")}:${timestamp.getMinutes().toString().padStart(2, "0")}`,
    description: `${MODE_CONFIG[state.currentMode].action} preset saved inside the UXP panel.`,
    params: snapshotSettings(),
  };
  state.presets = [preset, ...state.presets].slice(0, 10);
  state.activePresetId = preset.id;
  persistState();
  renderPresets();
  showMessage("Current settings saved as a preset.", "success");
}

async function serverFetch(endpoint, options = {}) {
  const candidates = [state.serverUrl, ...SERVER_URLS.filter((url) => url !== state.serverUrl)];
  let lastError = null;

  for (const baseUrl of candidates) {
    try {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: response.statusText }));
        throw new Error(error.detail || `Server error: ${response.status}`);
      }

      state.serverUrl = baseUrl;
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach local server.");
}

async function loadModels() {
  try {
    const selected = dom.settingModel.value;
    const models = await serverFetch("/models");
    dom.settingModel.innerHTML = "";
    if (!models.length) {
      dom.settingModel.innerHTML = '<option value="">No local models found</option>';
      return;
    }

    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      dom.settingModel.appendChild(option);
    });

    if (selected && models.includes(selected)) {
      dom.settingModel.value = selected;
    } else if (models.length) {
      dom.settingModel.value = models[0];
    }

    updateGenerateAvailability();
  } catch (error) {
    dom.settingModel.innerHTML = '<option value="">Model list unavailable</option>';
    updateGenerateAvailability();
  }
}

async function checkHealth() {
  try {
    const data = await serverFetch("/health");
    state.serverConnected = true;
    state.modelReady = data.model_status === "ready" || data.model_status === "ready_base";

    if (state.modelReady) {
      setAppStatus(getPromptValue().trim() ? "typing" : state.lastGeneratedImage ? "success" : "ready", {
        narrative: data.current_model
          ? `Running ${data.current_model} locally with no cloud dependency.`
          : "Base pipeline is loaded locally. Select weights and generate.",
      });
    } else if ((data.model_status || "").includes("loading")) {
      setAppStatus("starting", { narrative: `Model status: ${data.model_status}. Local components are warming up.` });
    } else if (data.model_status === "error") {
      setAppStatus("error", { narrative: "The local model failed to load cleanly. Check the backend console." });
    } else {
      setAppStatus("starting", { narrative: `Model status: ${data.model_status}.` });
    }

    if (data.gpu && data.gpu.name) {
      dom.gpuInfo.textContent = `${data.gpu.vram_used_gb}/${data.gpu.vram_total_gb} GB`;
      setFooterMeta(`${data.gpu.name}  ${data.gpu.vram_used_gb}/${data.gpu.vram_total_gb} GB`);
    } else {
      dom.gpuInfo.textContent = "CPU / unknown";
      setFooterMeta("GPU telemetry unavailable");
    }

    updateGenerateAvailability();
  } catch (error) {
    state.serverConnected = false;
    state.modelReady = false;
    setAppStatus("offline");
    dom.gpuInfo.textContent = "--";
    setQueueState("Idle");
    updateGenerateAvailability();
  }
}

async function captureCanvas() {
  const doc = app.activeDocument;
  if (!doc) throw new Error("Open a Photoshop document first.");

  let base64Image = null;

  await core.executeAsModal(async () => {
    const imageObj = await imaging.getPixels({
      documentID: doc.id,
      componentSize: 8,
      applyAlpha: true,
    });

    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("oddity_capture.png", { overwrite: true });

    await action.batchPlay([
      {
        _obj: "save",
        as: {
          _obj: "PNGFormat",
          PNGInterlaceType: { _enum: "PNGInterlaceType", _value: "PNGInterlaceNone" },
          compression: 6,
        },
        in: { _path: tempFile.nativePath, _kind: "local" },
        copy: true,
        lowerCase: true,
        embedProfiles: false,
      },
    ], { modalBehavior: "execute" });

    const fileData = await tempFile.read({ format: storage.formats.binary });
    const bytes = new Uint8Array(fileData);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
    base64Image = btoa(binary);
    imageObj.imageData.dispose();
  }, { commandName: "Oddity: Capture Canvas" });

  return base64Image;
}

async function applyAsNewLayer(base64Png, layerName = "Oddity Result") {
  const doc = app.activeDocument;
  if (!doc) throw new Error("Open a Photoshop document first.");

  await core.executeAsModal(async () => {
    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("oddity_result.png", { overwrite: true });
    const binary = atob(base64Png);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    await tempFile.write(bytes.buffer, { format: storage.formats.binary });

    await action.batchPlay([
      {
        _obj: "placeEvent",
        null: { _path: tempFile.nativePath, _kind: "local" },
        freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
        offset: {
          _obj: "offset",
          horizontal: { _unit: "pixelsUnit", _value: 0 },
          vertical: { _unit: "pixelsUnit", _value: 0 },
        },
      },
    ], { modalBehavior: "execute" });

    const newLayer = doc.activeLayers[0];
    if (newLayer) newLayer.name = layerName;
  }, { commandName: "Oddity: Apply Layer" });
}

async function replaceCanvas(base64Png) {
  await applyAsNewLayer(base64Png, "Oddity Result");
  await core.executeAsModal(async () => {
    await action.batchPlay([{ _obj: "flattenImage" }], { modalBehavior: "execute" });
  }, { commandName: "Oddity: Flatten Result" });
}

function humanizeError(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("out of memory") || lower.includes("cuda") || lower.includes("vram")) {
    return "VRAM limit reached. Lower dimensions, steps, or strength and try again.";
  }
  if (lower.includes("capture canvas")) {
    return "Photoshop could not capture the current document. Check that a document is open and visible.";
  }
  return message;
}

function startProgressPolling() {
  stopProgressPolling();
  state.progressInterval = setInterval(async () => {
    try {
      const progress = await serverFetch("/progress");
      if (progress.status === "generating" && progress.total > 0) {
        setStoryProgress(progress.step, progress.total);
        dom.progressText.textContent = `Step ${progress.step} of ${progress.total} on the local model.`;
        dom.frameStatus.textContent = `${Math.round((progress.step / progress.total) * 100)}% sampled`;
        setQueueState("Running");
      }
    } catch (error) {
      console.warn("Progress polling error", error);
    }
  }, PROGRESS_POLL_MS);
}

function stopProgressPolling() {
  if (state.progressInterval) {
    clearInterval(state.progressInterval);
    state.progressInterval = null;
  }
}

async function runGeneration() {
  if (state.isGenerating || !state.modelReady) return;
  const prompt = getPromptValue().trim();
  if (!prompt) {
    showMessage("Enter a prompt before generating.", "error");
    return;
  }
  if (!dom.settingModel.value) {
    showMessage("No local model is selected yet. Wait a moment for the model list to load.", "error");
    return;
  }

  clearMessage();
  state.isGenerating = true;
  dom.generateBtn.disabled = true;
  dom.applyBtn.disabled = true;
  state.beforeImage = null;
  setAppStatus("generating", { narrative: "Sampling locally on your machine." });
  setQueueState("Running");
  setStoryProgress(0, 1);
  updateStageEmpty({
    badge: "Generation active",
    headline: "Rendering locally",
    detail: "No cloud call is being made. The panel is driving the local FLUX server directly.",
  });
  dom.frameStatus.textContent = "Preparing request";
  dom.seedEcho.textContent = "Seed auto";

  try {
    let sourceBase64 = null;
    if (MODE_CONFIG[state.currentMode].usesCanvas) {
      dom.progressText.textContent = "Capturing the active Photoshop document.";
      dom.frameStatus.textContent = "Capturing document";
      sourceBase64 = await captureCanvas();
      state.beforeImage = sourceBase64;
      dom.beforeImage.src = `data:image/png;base64,${sourceBase64}`;
    }

    startProgressPolling();

    const payload = snapshotSettings();
    const body = MODE_CONFIG[state.currentMode].usesCanvas
      ? {
          model_name: payload.model,
          prompt,
          image: sourceBase64,
          strength: payload.strength,
          num_steps: payload.steps,
          guidance_scale: payload.guidance,
          seed: payload.seed,
        }
      : {
          model_name: payload.model,
          prompt,
          width: payload.width,
          height: payload.height,
          num_steps: payload.steps,
          guidance_scale: payload.guidance,
          seed: payload.seed,
        };

    const endpoint = MODE_CONFIG[state.currentMode].usesCanvas ? "/img2img" : "/generate";
    const result = await serverFetch(endpoint, { method: "POST", body: JSON.stringify(body) });

    state.lastGeneratedImage = { base64: result.image, width: result.width, height: result.height };
    dom.previewImage.src = `data:image/png;base64,${result.image}`;
    dom.applyBtn.disabled = false;
    dom.seedEcho.textContent = `Seed ${result.seed}`;
    dom.frameStatus.textContent = MODE_CONFIG[state.currentMode].usesCanvas ? "Split compare ready" : "Preview ready";
    setStoryProgress(1, 1);
    dom.progressText.textContent = `Render finished with seed ${result.seed}.`;
    setAppStatus("success", { narrative: "A local render is ready for review and routing." });
    setQueueState("Idle");
    updateStageEmpty({
      badge: "Review ready",
      headline: "Output prepared for comparison",
      detail: "Use Split to compare with the source, or route the result directly back into Photoshop.",
    });

    setCompareMode(state.beforeImage ? "split" : "after");
    updateCompareUI();
    pushHistoryEntry(result, result.seed);
  } catch (error) {
    const message = humanizeError(error.message);
    setAppStatus("error", { narrative: message });
    setQueueState("Idle");
    dom.progressText.textContent = message;
    dom.frameStatus.textContent = "Generation interrupted";
    updateStageEmpty({
      badge: "Retry gently",
      headline: "The render could not finish cleanly.",
      detail: "Reduce resolution, steps, or transformation strength and try again.",
    });
    showMessage(message, "error", 5200);
  } finally {
    stopProgressPolling();
    state.isGenerating = false;
    updateGenerateAvailability();
  }
}

async function applyResult() {
  if (!state.lastGeneratedImage) return;
  dom.applyBtn.disabled = true;

  try {
    if (dom.layerRouting.value === "replace_canvas") {
      await replaceCanvas(state.lastGeneratedImage.base64);
      showMessage("Result replaced the canvas.", "success");
    } else if (dom.layerRouting.value === "new_mask") {
      await applyAsNewLayer(state.lastGeneratedImage.base64, "Oddity Mask Review");
      showMessage("Placed as a review layer for mask routing.", "success");
    } else {
      await applyAsNewLayer(state.lastGeneratedImage.base64);
      showMessage("Result added as a new layer.", "success");
    }
  } catch (error) {
    showMessage(`Apply failed: ${error.message}`, "error", 5200);
  } finally {
    dom.applyBtn.disabled = false;
  }
}

function initEventListeners() {
  dom.modeGenerate.addEventListener("click", () => setMode("generate"));
  dom.modeInpaint.addEventListener("click", () => setMode("inpaint"));
  dom.modeOutpaint.addEventListener("click", () => setMode("outpaint"));
  dom.modeEdit.addEventListener("click", () => setMode("img2img"));

  dom.promptInput.addEventListener("input", updatePromptState);
  dom.promptInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runGeneration();
    }
  });

  dom.clearPromptBtn.addEventListener("click", () => {
    dom.promptInput.value = "";
    updatePromptState();
    dom.promptInput.focus();
  });

  dom.settingGuidance.addEventListener("input", syncNumericUI);
  dom.settingStrength.addEventListener("input", syncNumericUI);
  dom.layerRouting.addEventListener("change", updateApplyLabel);
  dom.settingModel.addEventListener("change", updateGenerateAvailability);
  dom.compareSplitBtn.addEventListener("click", () => setCompareMode("split"));
  dom.compareBeforeBtn.addEventListener("click", () => setCompareMode("before"));
  dom.compareAfterBtn.addEventListener("click", () => setCompareMode("after"));
  dom.compareSlider.addEventListener("input", () => updateCompareUI());
  dom.generateBtn.addEventListener("click", runGeneration);
  dom.applyBtn.addEventListener("click", applyResult);
  dom.savePresetBtn.addEventListener("click", saveCurrentPreset);
  dom.togglePresetBtn.addEventListener("click", () => toggleDrawer("presets"));
  dom.toggleHistoryBtn.addEventListener("click", () => toggleDrawer("history"));
  dom.toggleSettingsBtn.addEventListener("click", () => toggleDrawer("settings"));
  dom.togglePresetDrawer.addEventListener("click", () => toggleDrawer("presets"));
  dom.toggleHistoryDrawer.addEventListener("click", () => toggleDrawer("history"));
  dom.toggleSettingsDrawer.addEventListener("click", () => toggleDrawer("settings"));
  window.addEventListener("resize", updateWidthMode);
}

function initStage() {
  setStoryIdle();
  updateStageEmpty({
    badge: "Local render",
    headline: "Compose a prompt to begin.",
    detail: "The panel keeps previews and generation controls inside Photoshop while FLUX runs on your machine.",
  });
  dom.applyBtn.disabled = true;
  updateCompareUI();
}

function init() {
  bindDom();
  validateDom();
  initEventListeners();
  renderHistory();
  renderPresets();
  syncNumericUI();
  updateWidthMode();
  updateApplyLabel();
  updateModeUI();
  updatePromptState();
  initStage();
  checkHealth();
  loadModels();
  state.healthInterval = setInterval(checkHealth, HEALTH_POLL_MS);
  setInterval(loadModels, 12000);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
