const { app, action, core, imaging } = require("photoshop");
const { storage } = require("uxp");

const SERVER_URLS = ["http://127.0.0.1:5000", "http://localhost:5000"];
const HEALTH_POLL_MS = 3000;
const PROGRESS_POLL_MS = 450;
const DOWNLOAD_POLL_MS = 800;
const MAX_HISTORY = 8;
const STORAGE_KEYS = {
  history: "oddity.history.v3",
};

const MODE_CONFIG = {
  generate: { label: "Generate", usesCanvas: false, modeBadge: "TXT", canvasLabel: "Text-to-image generation" },
  inpaint: { label: "Inpaint", usesCanvas: true, modeBadge: "MASK", canvasLabel: "Repair details inside the active selection" },
  outpaint: { label: "Expand", usesCanvas: true, modeBadge: "EXP", canvasLabel: "Expand the Photoshop canvas before generating" },
};

const dom = {};
const state = {
  currentMode: "generate",
  compareMode: "after",
  isGenerating: false,
  modelReady: false,
  serverConnected: false,
  serverUrl: SERVER_URLS[0],
  beforeImage: null,
  lastGeneratedImage: null,
  history: loadStored(STORAGE_KEYS.history, []),
  healthInterval: null,
  progressInterval: null,
  downloadInterval: null,
  progressStartedAt: 0,
  progressLastStep: 0,
  historyFlashTimer: null,
  messageTimer: null,
  currentView: "main", // "main" | "library"
  registry: null,
  readyModels: [],
};

function $(id) {
  return document.getElementById(id);
}

function bindDom() {
  Object.assign(dom, {
    body: document.body,
    logoMark: $("logoMark"),
    logoSub: $("logoSub"),
    statusPill: $("statusPill"),
    statusLabel: $("statusLabel"),
    canvasArea: $("canvasArea"),
    canvasLabel: $("canvasLabel"),
    canvasPlaceholder: $("canvasPlaceholder"),
    beforeImage: $("beforeImage"),
    previewImage: $("previewImage"),
    dimensionBadge: $("dimensionBadge"),
    modeBadge: $("modeBadge"),
    beforeBtn: $("beforeBtn"),
    afterBtn: $("afterBtn"),
    tabGenerate: $("tabGenerate"),
    tabInpaint: $("tabInpaint"),
    tabExpand: $("tabExpand"),
    tabHistory: $("tabHistory"),
    activePromptCard: $("activePromptCard"),
    activePromptText: $("activePromptText"),
    promptInput: $("promptInput"),
    charCount: $("charCount"),
    progressArea: $("progressArea"),
    progressPct: $("progressPct"),
    progressFill: $("progressFill"),
    progressSub: $("progressSub"),
    generationStats: $("generationStats"),
    speedValue: $("speedValue"),
    etaValue: $("etaValue"),
    batchValue: $("batchValue"),
    cancelBtn: $("cancelBtn"),
    strengthCard: $("strengthCard"),
    strengthLabel: $("strengthLabel"),
    settingStrength: $("settingStrength"),
    strengthValue: $("strengthValue"),
    strengthHint: $("strengthHint"),
    settingGuidance: $("settingGuidance"),
    guidanceValue: $("guidanceValue"),
    settingSteps: $("settingSteps"),
    stepsValue: $("stepsValue"),
    resolutionCard: $("resolutionCard"),
    detailLabel: $("detailLabel"),
    settingResolution: $("settingResolution"),
    resolutionValue: $("resolutionValue"),
    detailHint: $("detailHint"),
    settingSeed: $("settingSeed"),
    seedDice: $("seedDice"),
    layerRouting: $("layerRouting"),
    refreshBtn: $("refreshBtn"),
    applyBtn: $("applyBtn"),
    generateBtn: $("generateBtn"),
    generateLabel: $("generateLabel"),
    errorMessage: $("errorMessage"),
    gpuInfo: $("gpuInfo"),
    vramFill: $("vramFill"),
    historyStrip: $("historyStrip"),
    saveHistoryBtn: $("saveHistoryBtn"),
    settingModel: $("settingModel"),
    modelFamilyBadge: $("modelFamilyBadge"),
    modelSelectorSub: $("modelSelectorSub"),
    // Library view
    viewMain: $("viewMain"),
    viewLibrary: $("viewLibrary"),
    viewLibraryBtn: $("viewLibraryBtn"),
    libraryBackBtn: $("libraryBackBtn"),
    libraryFamilies: $("libraryFamilies"),
    componentList: $("componentList"),
    downloadOverlay: $("downloadOverlay"),
    downloadLabel: $("downloadLabel"),
    downloadFill: $("downloadFill"),
    downloadSub: $("downloadSub"),
  });
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
    console.warn(`Unable to save ${key}`, error);
  }
}

function showMessage(message, tone = "neutral", duration = 4200) {
  clearTimeout(state.messageTimer);
  dom.errorMessage.textContent = message;
  dom.errorMessage.className = "message-inline visible";
  if (tone === "error") dom.errorMessage.classList.add("is-error");
  if (tone === "success") dom.errorMessage.classList.add("is-success");
  if (duration > 0) {
    state.messageTimer = setTimeout(() => {
      dom.errorMessage.className = "message-inline";
      dom.errorMessage.textContent = "";
    }, duration);
  }
}

function clearMessage() {
  clearTimeout(state.messageTimer);
  dom.errorMessage.className = "message-inline";
  dom.errorMessage.textContent = "";
}

function setStatus(kind, label, subline) {
  dom.body.dataset.status = kind;
  dom.statusPill.className = `status-pill is-${kind}`;
  dom.statusLabel.textContent = label;
  dom.logoSub.textContent = subline;
  dom.logoMark.classList.toggle("is-generating", kind === "generating");
}

function getPromptValue() {
  return typeof dom.promptInput.value === "string" ? dom.promptInput.value : "";
}

function getEffectiveMode() {
  return state.currentMode;
}

function updateCharCount() {
  dom.charCount.textContent = getPromptValue().length;
  updateGenerateAvailability();
}

function syncSliders() {
  dom.strengthValue.textContent = `${dom.settingStrength.value}%`;
  dom.guidanceValue.textContent = (Number(dom.settingGuidance.value) / 10).toFixed(1);
  dom.stepsValue.textContent = dom.settingSteps.value;
  dom.resolutionValue.textContent = dom.settingResolution.disabled ? "AUTO" : dom.settingResolution.value;
}

function updateCanvasState() {
  dom.body.dataset.compare = state.compareMode;
  dom.canvasArea.classList.toggle("has-before", Boolean(state.beforeImage));
  dom.canvasArea.classList.toggle("has-after", Boolean(state.lastGeneratedImage));
  dom.beforeBtn.classList.toggle("active", state.compareMode === "before");
  dom.afterBtn.classList.toggle("active", state.compareMode === "after");
  dom.beforeBtn.classList.toggle("is-disabled", !state.beforeImage);
  if (!state.beforeImage && state.compareMode === "before") {
    state.compareMode = "after";
  }
}

function updateButtons() {
  const mode = getEffectiveMode();
  dom.generateLabel.textContent = MODE_CONFIG[mode].label;
  dom.generateBtn.classList.toggle("generating", state.isGenerating);
  dom.applyBtn.disabled = !state.lastGeneratedImage || state.isGenerating;
  dom.refreshBtn.disabled = state.isGenerating;
  dom.cancelBtn.classList.toggle("visible", state.isGenerating);
  dom.activePromptCard.classList.toggle("visible", state.isGenerating);
  dom.progressArea.classList.toggle("visible", state.isGenerating);
  dom.generationStats.classList.toggle("visible", state.isGenerating);
}

function updateTabState() {
  dom.tabGenerate.classList.toggle("active", state.currentMode === "generate");
  dom.tabInpaint.classList.toggle("active", state.currentMode === "inpaint");
  dom.tabExpand.classList.toggle("active", state.currentMode === "outpaint");
}

function updateModeUI() {
  const mode = getEffectiveMode();
  const usesCanvas = MODE_CONFIG[mode].usesCanvas;
  dom.body.dataset.mode = mode;
  updateTabState();
  dom.modeBadge.textContent = MODE_CONFIG[mode].modeBadge;
  dom.canvasLabel.textContent = MODE_CONFIG[mode].canvasLabel;

  dom.settingStrength.disabled = false;
  dom.strengthCard.classList.remove("is-disabled");
  dom.strengthHint.textContent = mode === "outpaint" ? "Blend" : "Denoising";

  dom.settingResolution.disabled = usesCanvas;
  dom.resolutionCard.classList.toggle("is-disabled", usesCanvas);
  dom.detailLabel.textContent = usesCanvas ? "Canvas" : "Resolution";
  dom.detailHint.textContent = usesCanvas ? "From Doc" : "Square";

  syncSliders();
  updateGenerateAvailability();
}

function updateGenerateAvailability() {
  const hasPrompt = Boolean(getPromptValue().trim());
  const hasModel = Boolean(dom.settingModel.value);
  dom.generateBtn.disabled = !(hasPrompt && hasModel && state.serverConnected && !state.isGenerating);
}

function updateDimensionBadge(width, height) {
  dom.dimensionBadge.textContent = `${width} × ${height}`;
}

function randomSeed() {
  dom.settingSeed.value = String(Math.floor(Math.random() * 9999999));
}

// ---------------------------------------------------------------------------
// Model selector
// ---------------------------------------------------------------------------

function getSelectedModel() {
  const val = dom.settingModel.value;
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch (e) {
    return null;
  }
}

function updateModelBadge() {
  const model = getSelectedModel();
  if (model) {
    dom.modelFamilyBadge.textContent = model.family_display || model.family.toUpperCase();
    dom.modelFamilyBadge.style.background = model.badge_color || "#7C8CFF";
    dom.modelSelectorSub.textContent = model.name;
    // Apply model defaults to sliders
    if (model.default_steps) {
      dom.settingSteps.value = String(model.default_steps);
    }
    if (model.default_guidance !== undefined) {
      dom.settingGuidance.value = String(Math.round(model.default_guidance * 10));
    }
    syncSliders();
  } else {
    dom.modelFamilyBadge.textContent = "—";
    dom.modelFamilyBadge.style.background = "rgba(255,255,255,0.08)";
    dom.modelSelectorSub.textContent = "Select a model to start generating";
  }
  updateGenerateAvailability();
}

// ---------------------------------------------------------------------------
// View switching
// ---------------------------------------------------------------------------

function switchView(view) {
  state.currentView = view;
  dom.body.dataset.view = view;
  if (view === "library") {
    loadRegistry();
  }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function renderHistory() {
  dom.historyStrip.innerHTML = "";

  state.history.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hist-thumb";
    if (state.lastGeneratedImage && state.lastGeneratedImage.base64 === entry.image) {
      button.classList.add("active");
    }
    button.title = entry.prompt || MODE_CONFIG[entry.mode]?.label || "Generation";
    button.innerHTML = `<div class="hist-thumb-inner"><img src="data:image/png;base64,${entry.image}" alt="History preview"></div>`;
    button.addEventListener("click", () => restoreHistory(entry));
    dom.historyStrip.appendChild(button);
  });

  const plus = document.createElement("button");
  plus.type = "button";
  plus.className = "hist-add";
  plus.id = "saveHistoryBtn";
  plus.textContent = "+";
  plus.title = "History is recorded automatically";
  plus.addEventListener("click", () => {
    showMessage("History is recorded automatically after each successful render.");
  });
  dom.historyStrip.appendChild(plus);
  dom.saveHistoryBtn = plus;
}

function restoreHistory(entry) {
  state.currentMode = entry.tabMode || entry.mode;
  dom.promptInput.value = entry.prompt || "";
  dom.settingStrength.value = String(entry.strength || 72);
  dom.settingGuidance.value = String(entry.guidance || 75);
  dom.settingSteps.value = String(entry.steps || 28);
  dom.settingResolution.value = String(entry.resolution || 1024);
  dom.settingSeed.value = String(entry.seed ?? -1);
  dom.layerRouting.value = entry.route || "new_layer";
  
  // Restore model selection if available
  if (entry.modelValue) {
    const options = [...dom.settingModel.options];
    const match = options.find((o) => o.value === entry.modelValue);
    if (match) dom.settingModel.value = entry.modelValue;
  }
  
  state.beforeImage = entry.beforeImage || null;
  state.lastGeneratedImage = { base64: entry.image, width: entry.width, height: entry.height };
  dom.previewImage.src = `data:image/png;base64,${entry.image}`;
  if (entry.beforeImage) {
    dom.beforeImage.src = `data:image/png;base64,${entry.beforeImage}`;
    state.compareMode = "before";
  } else {
    state.compareMode = "after";
  }
  updateDimensionBadge(entry.width || 1024, entry.height || 1024);
  updateModelBadge();
  updateModeUI();
  updateCharCount();
  updateCanvasState();
  showMessage("History item restored.", "success");
}

function pushHistory(result, seed, width, height) {
  const entry = {
    id: `history-${Date.now()}`,
    image: result.image,
    prompt: getPromptValue().trim(),
    mode: getEffectiveMode(),
    tabMode: state.currentMode,
    seed,
    width,
    height,
    beforeImage: state.beforeImage,
    strength: Number(dom.settingStrength.value),
    guidance: Number(dom.settingGuidance.value),
    steps: Number(dom.settingSteps.value),
    resolution: Number(dom.settingResolution.value),
    route: dom.layerRouting.value,
    modelValue: dom.settingModel.value,
  };
  state.history = [entry, ...state.history].slice(0, MAX_HISTORY);
  saveStored(STORAGE_KEYS.history, state.history);
  renderHistory();
}

// ---------------------------------------------------------------------------
// Server communication
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Model listing
// ---------------------------------------------------------------------------

async function loadModels() {
  try {
    const models = await serverFetch("/models");
    state.readyModels = models;
    const previousValue = dom.settingModel.value;
    dom.settingModel.innerHTML = "";
    
    if (!models.length) {
      dom.settingModel.innerHTML = '<option value="">No models ready — open Library to download</option>';
      updateModelBadge();
      return;
    }

    // Group by family
    const grouped = {};
    models.forEach((m) => {
      if (!grouped[m.family]) grouped[m.family] = { display: m.family_display, models: [] };
      grouped[m.family].models.push(m);
    });

    Object.entries(grouped).forEach(([famId, group]) => {
      const optgroup = document.createElement("optgroup");
      optgroup.label = group.display;
      group.models.forEach((m) => {
        const option = document.createElement("option");
        option.value = JSON.stringify({ family: m.family, family_display: m.family_display, id: m.id, name: m.name, default_steps: m.default_steps, default_guidance: m.default_guidance, badge_color: m.badge_color });
        option.textContent = `${m.name}${m.is_inpaint_model ? " (Inpaint)" : ""}`;
        optgroup.appendChild(option);
      });
      dom.settingModel.appendChild(optgroup);
    });

    // Restore previous selection or select first
    if (previousValue) {
      const options = [...dom.settingModel.querySelectorAll("option")];
      const match = options.find((o) => o.value === previousValue);
      if (match) {
        dom.settingModel.value = previousValue;
      }
    }
    if (!dom.settingModel.value) {
      dom.settingModel.value = dom.settingModel.querySelector("option")?.value || "";
    }
    updateModelBadge();
  } catch (error) {
    dom.settingModel.innerHTML = '<option value="">Model list unavailable</option>';
    updateModelBadge();
  }
}

// ---------------------------------------------------------------------------
// Registry & Library
// ---------------------------------------------------------------------------

async function loadRegistry() {
  try {
    const registry = await serverFetch("/registry");
    state.registry = registry;
    renderLibrary(registry);
  } catch (error) {
    console.warn("Failed to load registry:", error);
    dom.libraryFamilies.innerHTML = '<div class="library-empty">Could not load registry. Is the server running?</div>';
  }
}

function renderLibrary(registry) {
  // Render components
  dom.componentList.innerHTML = "";
  Object.entries(registry.components || {}).forEach(([compId, comp]) => {
    const card = document.createElement("div");
    card.className = `library-component-card ${comp.downloaded ? "is-downloaded" : "is-missing"}`;
    card.innerHTML = `
      <div class="lcc-info">
        <div class="lcc-name">${comp.display_name}</div>
        <div class="lcc-detail">${comp.size_gb} GB${comp.shared ? " · Shared" : ""}</div>
      </div>
      <div class="lcc-status">${comp.downloaded ? "✓ Ready" : "Not downloaded"}</div>
    `;
    dom.componentList.appendChild(card);
  });

  // Render families
  dom.libraryFamilies.innerHTML = "";
  Object.entries(registry.families || {}).forEach(([famId, fam]) => {
    const section = document.createElement("div");
    section.className = "library-family-section";

    let modelsHtml = "";
    (fam.models || []).forEach((model) => {
      const statusClass = model.ready ? "is-ready" : model.downloaded ? "is-partial" : "is-not-downloaded";
      const statusText = model.ready ? "Ready" : model.downloaded ? "Missing dependencies" : "Not downloaded";
      const canDownload = !model.ready && (model.download_url || (model.missing_deps || []).some((d) => d.type === "component"));
      const hasUrl = model.download_url || (model.missing_deps || []).every((d) => d.type === "component");

      modelsHtml += `
        <div class="library-model-card ${statusClass}" data-family="${famId}" data-model-id="${model.id}">
          <div class="lmc-top">
            <div class="lmc-name">${model.name}</div>
            <span class="lmc-badge" style="background:${fam.badge_color}">${fam.display_name}</span>
          </div>
          <div class="lmc-desc">${model.description || ""}</div>
          <div class="lmc-bottom">
            <span class="lmc-size">${model.size_gb ? model.size_gb + " GB" : ""}</span>
            <span class="lmc-status">${statusText}</span>
            ${canDownload && hasUrl ? `<button class="lmc-download-btn" data-family="${famId}" data-model-id="${model.id}" type="button">Download</button>` : ""}
            ${!canDownload && !model.ready && !hasUrl ? `<span class="lmc-manual">Manual download required</span>` : ""}
          </div>
        </div>
      `;
    });

    section.innerHTML = `
      <div class="library-section-label">
        <span class="lsl-badge" style="background:${fam.badge_color}">${fam.display_name}</span>
        <span class="lsl-desc">${fam.description || ""}</span>
      </div>
      <div class="library-section-info">
        VRAM: ${fam.min_vram_gb}GB min · ${fam.recommended_vram_gb}GB recommended
      </div>
      <div class="library-model-list">${modelsHtml}</div>
    `;
    dom.libraryFamilies.appendChild(section);
  });

  // Bind download buttons
  document.querySelectorAll(".lmc-download-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const family = btn.dataset.family;
      const modelId = btn.dataset.modelId;
      startModelDownload(family, modelId);
    });
  });
}

async function startModelDownload(family, modelId) {
  try {
    await serverFetch("/models/download", {
      method: "POST",
      body: JSON.stringify({ family, model_id: modelId }),
    });
    showDownloadOverlay(true);
    startDownloadPolling();
  } catch (error) {
    showMessage(`Download failed: ${error.message}`, "error", 5000);
  }
}

function showDownloadOverlay(visible) {
  dom.downloadOverlay.classList.toggle("visible", visible);
}

function startDownloadPolling() {
  stopDownloadPolling();
  state.downloadInterval = setInterval(async () => {
    try {
      const progress = await serverFetch("/models/download/progress");
      dom.downloadLabel.textContent = `Downloading: ${progress.item || "..."}`;
      dom.downloadFill.style.width = `${progress.percent || 0}%`;
      
      const mb = Math.round((progress.bytes_downloaded || 0) / 1024 / 1024);
      const totalMb = Math.round((progress.bytes_total || 0) / 1024 / 1024);
      dom.downloadSub.textContent = totalMb > 0 ? `${mb} / ${totalMb} MB (${progress.percent}%)` : `${mb} MB downloaded`;
      
      if (!progress.active || progress.status === "complete") {
        stopDownloadPolling();
        showDownloadOverlay(false);
        showMessage("Download complete! Model is now available.", "success");
        await loadModels();
        await loadRegistry();
      } else if (progress.status && progress.status.startsWith("error")) {
        stopDownloadPolling();
        showDownloadOverlay(false);
        showMessage(`Download failed: ${progress.status}`, "error", 6000);
      }
    } catch (error) {
      console.warn("Download polling failed", error);
    }
  }, DOWNLOAD_POLL_MS);
}

function stopDownloadPolling() {
  if (state.downloadInterval) {
    clearInterval(state.downloadInterval);
    state.downloadInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

async function checkHealth() {
  try {
    const data = await serverFetch("/health");
    state.serverConnected = true;
    state.modelReady = data.model_status === "ready";

    if (data.model_status === "error") {
      setStatus("error", "ERROR", "Model failed to load");
    } else if (data.model_status === "loading") {
      const family = data.current_family ? data.current_family.toUpperCase() : "";
      setStatus("starting", "LOADING", `Loading ${family} pipeline...`);
    } else if (state.isGenerating) {
      const family = data.current_family ? data.current_family.toUpperCase() : "AI";
      setStatus("generating", family, `Sampling locally on ${data.current_model || "selected model"}`);
    } else if (data.model_status === "ready") {
      const family = data.current_family ? data.current_family.toUpperCase() : "LOCAL";
      setStatus("ready", family, data.current_model || "Model loaded locally");
    } else {
      setStatus("ready", "IDLE", "Server ready — select a model to begin");
    }

    if (data.gpu && data.gpu.name) {
      const total = Number(data.gpu.vram_total_gb) || 0;
      const used = Number(data.gpu.vram_used_gb) || 0;
      const pct = total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
      dom.gpuInfo.textContent = `${used} / ${total} GB`;
      dom.vramFill.style.width = `${pct}%`;
      dom.vramFill.style.background = pct > 85
        ? "linear-gradient(90deg, #f5a623, #f05252)"
        : "linear-gradient(90deg, #3ecf8e, #f5a623)";
    } else {
      dom.gpuInfo.textContent = "--";
      dom.vramFill.style.width = "0%";
    }

    updateGenerateAvailability();
  } catch (error) {
    state.serverConnected = false;
    state.modelReady = false;
    setStatus("offline", "OFFLINE", "Waiting for the local server");
    dom.gpuInfo.textContent = "--";
    dom.vramFill.style.width = "0%";
    updateGenerateAvailability();
  }
}

// ---------------------------------------------------------------------------
// Canvas capture
// ---------------------------------------------------------------------------

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

async function captureMask() {
  // Capture the current selection as a mask (white = selected, black = unselected)
  const doc = app.activeDocument;
  if (!doc) throw new Error("Open a Photoshop document first.");

  let base64Mask = null;

  await core.executeAsModal(async () => {
    // Create a temporary channel from selection
    try {
      // Save selection to channel, capture it, then remove
      await action.batchPlay([
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" },
        },
      ], { modalBehavior: "execute" });
    } catch (e) {
      // If no selection exists, create a full white mask
    }

    const tempFolder = await storage.localFileSystem.getTemporaryFolder();
    const tempFile = await tempFolder.createFile("oddity_mask.png", { overwrite: true });

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
    base64Mask = btoa(binary);
  }, { commandName: "Oddity: Capture Mask" });

  return base64Mask;
}

// ---------------------------------------------------------------------------
// Layer operations
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

function humanizeError(message) {
  const lower = String(message || "").toLowerCase();
  if (lower.includes("out of memory") || lower.includes("cuda") || lower.includes("vram")) {
    return "VRAM limit reached. Lower resolution, steps, or strength and try again.";
  }
  if (lower.includes("capture") || lower.includes("document")) {
    return "Photoshop could not capture the current document. Make sure a document is open.";
  }
  if (lower.includes("not found")) {
    return "Model file not found. Please download it from the Model Library first.";
  }
  return message;
}

// ---------------------------------------------------------------------------
// Progress tracking
// ---------------------------------------------------------------------------

function updateProgress(step, total) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  dom.progressPct.textContent = `${pct}%`;
  dom.progressFill.style.width = `${pct}%`;
  dom.batchValue.textContent = "1/1";

  const elapsed = Math.max(0.001, (Date.now() - state.progressStartedAt) / 1000);
  const speed = step > 0 ? step / elapsed : 0;
  const eta = speed > 0 ? Math.max(0, Math.round((total - step) / speed)) : 0;

  dom.speedValue.textContent = speed > 0 ? speed.toFixed(1) : "--";
  dom.etaValue.textContent = step < total && speed > 0 ? `${eta}s` : "--";
  dom.progressSub.textContent = `Step ${step} of ${total}${speed > 0 ? ` · ~${eta}s remaining · ${speed.toFixed(1)} it/s` : ""}`;
}

function startProgressPolling() {
  stopProgressPolling();
  state.progressStartedAt = Date.now();
  state.progressLastStep = 0;
  state.progressInterval = setInterval(async () => {
    try {
      const progress = await serverFetch("/progress");
      if (progress.status === "generating" && progress.total > 0) {
        state.progressLastStep = progress.step;
        updateProgress(progress.step, progress.total);
      }
    } catch (error) {
      console.warn("Progress polling failed", error);
    }
  }, PROGRESS_POLL_MS);
}

function stopProgressPolling() {
  if (state.progressInterval) {
    clearInterval(state.progressInterval);
    state.progressInterval = null;
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

async function runGeneration() {
  if (state.isGenerating) return;
  const prompt = getPromptValue().trim();
  if (!prompt) {
    showMessage("Enter a prompt before generating.", "error");
    return;
  }
  const model = getSelectedModel();
  if (!model) {
    showMessage("No model selected. Open the Model Library to download one.", "error");
    return;
  }

  clearMessage();
  state.isGenerating = true;
  state.lastGeneratedImage = null;
  dom.previewImage.removeAttribute("src");
  dom.applyBtn.disabled = true;
  const mode = getEffectiveMode();
  const usesCanvas = MODE_CONFIG[mode].usesCanvas;
  const familyLabel = model.family_display || model.family.toUpperCase();
  setStatus("generating", familyLabel, `Preparing ${MODE_CONFIG[mode].label.toLowerCase()} request`);
  dom.activePromptText.textContent = prompt;
  updateButtons();
  updateModeUI();
  updateCanvasState();

  try {
    let sourceBase64 = null;
    let maskBase64 = null;
    let width = Number(dom.settingResolution.value);
    let height = Number(dom.settingResolution.value);

    if (usesCanvas) {
      sourceBase64 = await captureCanvas();
      state.beforeImage = sourceBase64;
      dom.beforeImage.src = `data:image/png;base64,${sourceBase64}`;
      dom.progressSub.textContent = "Capturing the active Photoshop document.";

      if (mode === "inpaint") {
        try {
          maskBase64 = await captureMask();
        } catch (e) {
          console.warn("Could not capture mask, using full image:", e);
        }
      }
    } else {
      state.beforeImage = null;
      dom.beforeImage.removeAttribute("src");
    }

    updateCanvasState();
    startProgressPolling();

    let endpoint;
    let body;

    if (mode === "inpaint" && maskBase64) {
      endpoint = "/inpaint";
      body = {
        family: model.family,
        model_id: model.id,
        prompt,
        image: sourceBase64,
        mask: maskBase64,
        strength: Number(dom.settingStrength.value) / 100,
        num_steps: Number(dom.settingSteps.value),
        guidance_scale: Number(dom.settingGuidance.value) / 10,
        seed: parseInt(dom.settingSeed.value, 10) || -1,
      };
    } else if (usesCanvas) {
      endpoint = "/img2img";
      body = {
        family: model.family,
        model_id: model.id,
        prompt,
        image: sourceBase64,
        strength: Number(dom.settingStrength.value) / 100,
        num_steps: Number(dom.settingSteps.value),
        guidance_scale: Number(dom.settingGuidance.value) / 10,
        seed: parseInt(dom.settingSeed.value, 10) || -1,
      };
    } else {
      endpoint = "/generate";
      body = {
        family: model.family,
        model_id: model.id,
        prompt,
        width,
        height,
        num_steps: Number(dom.settingSteps.value),
        guidance_scale: Number(dom.settingGuidance.value) / 10,
        seed: parseInt(dom.settingSeed.value, 10) || -1,
      };
    }

    const result = await serverFetch(endpoint, { method: "POST", body: JSON.stringify(body) });

    state.lastGeneratedImage = { base64: result.image, width: result.width, height: result.height };
    dom.previewImage.src = `data:image/png;base64,${result.image}`;
    state.compareMode = "after";
    updateDimensionBadge(result.width, result.height);
    updateCanvasState();
    pushHistory(result, result.seed, result.width, result.height);
    setStatus("ready", familyLabel, `Render ready · seed ${result.seed}`);
    dom.applyBtn.disabled = false;
    showMessage("Generation complete.", "success");
  } catch (error) {
    const message = humanizeError(error.message);
    setStatus("error", "ERROR", message);
    showMessage(message, "error", 5200);
  } finally {
    stopProgressPolling();
    state.isGenerating = false;
    updateButtons();
    updateModeUI();
    updateGenerateAvailability();
    await checkHealth();
  }
}

async function applyResult() {
  if (!state.lastGeneratedImage) return;
  dom.applyBtn.disabled = true;
  try {
    if (dom.layerRouting.value === "replace_canvas") {
      await replaceCanvas(state.lastGeneratedImage.base64);
      showMessage("Result replaced the active layer.", "success");
    } else if (dom.layerRouting.value === "new_mask") {
      await applyAsNewLayer(state.lastGeneratedImage.base64, "Oddity Mask Review");
      showMessage("Result added as a mask review layer.", "success");
    } else {
      await applyAsNewLayer(state.lastGeneratedImage.base64, "Oddity Result");
      showMessage("Result added as a new layer.", "success");
    }
  } catch (error) {
    showMessage(`Apply failed: ${error.message}`, "error", 5200);
  } finally {
    dom.applyBtn.disabled = false;
  }
}

function setCurrentMode(mode) {
  state.currentMode = mode;
  updateModeUI();
}

function flashHistoryTab() {
  clearTimeout(state.historyFlashTimer);
  dom.tabHistory.classList.add("active");
  state.historyFlashTimer = setTimeout(() => {
    updateTabState();
  }, 1200);
  dom.historyStrip.scrollIntoView({ block: "nearest", inline: "nearest" });
  showMessage(state.history.length ? "Tap a thumbnail below to restore a render." : "No history yet. Renders appear here after generation.");
}

// ---------------------------------------------------------------------------
// Event binding
// ---------------------------------------------------------------------------

function initEvents() {
  dom.promptInput.addEventListener("input", updateCharCount);
  dom.promptInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runGeneration();
    }
  });

  dom.tabGenerate.addEventListener("click", () => setCurrentMode("generate"));
  dom.tabInpaint.addEventListener("click", () => setCurrentMode("inpaint"));
  dom.tabExpand.addEventListener("click", () => setCurrentMode("outpaint"));
  dom.tabHistory.addEventListener("click", flashHistoryTab);

  dom.beforeBtn.addEventListener("click", () => {
    if (!state.beforeImage) return;
    state.compareMode = "before";
    updateCanvasState();
  });
  dom.afterBtn.addEventListener("click", () => {
    state.compareMode = "after";
    updateCanvasState();
  });

  dom.settingStrength.addEventListener("input", syncSliders);
  dom.settingGuidance.addEventListener("input", syncSliders);
  dom.settingSteps.addEventListener("input", syncSliders);
  dom.settingResolution.addEventListener("input", () => {
    syncSliders();
    updateDimensionBadge(dom.settingResolution.value, dom.settingResolution.value);
  });
  dom.seedDice.addEventListener("click", randomSeed);
  dom.settingModel.addEventListener("change", updateModelBadge);
  
  dom.refreshBtn.addEventListener("click", async () => {
    await checkHealth();
    await loadModels();
    showMessage("Model status refreshed.", "success", 1800);
  });
  dom.generateBtn.addEventListener("click", runGeneration);
  dom.applyBtn.addEventListener("click", applyResult);
  dom.cancelBtn.addEventListener("click", () => {
    showMessage("Cancel is not available in the current backend yet.", "error", 4200);
  });

  // View switching
  dom.viewLibraryBtn.addEventListener("click", () => switchView("library"));
  dom.libraryBackBtn.addEventListener("click", () => switchView("main"));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  bindDom();
  renderHistory();
  initEvents();
  syncSliders();
  updateDimensionBadge(dom.settingResolution.value, dom.settingResolution.value);
  updateModeUI();
  updateCanvasState();
  updateButtons();
  updateCharCount();
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
