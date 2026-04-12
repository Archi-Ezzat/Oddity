const { app, action, core, imaging } = require("photoshop");
const { storage } = require("uxp");

const SERVER_URLS = ["http://127.0.0.1:5000", "http://localhost:5000"];
const HEALTH_POLL_MS = 3000;
const PROGRESS_POLL_MS = 450;
const DOWNLOAD_POLL_MS = 800;
const MAX_HISTORY = 8;
const STORAGE_KEYS = {
  history: "oddity.history.v3",
  savedPrompts: "oddity.savedPrompts.v1",
  activeStyle: "oddity.activeStyle.v1",
  serverUrl: "oddity.serverUrl.v1",
};

const state = {
  isGenerating: false,
  modelReady: false,
  serverConnected: false,
  serverUrl: loadStored(STORAGE_KEYS.serverUrl, SERVER_URLS[0]),
  isSettingsOpen: false,
  batchSize: 1,
  activeGridIndex: 0,
  gridImages: [],
  history: loadStored(STORAGE_KEYS.history, []),
  healthInterval: null,
  progressInterval: null,
  downloadInterval: null,
  selectionInterval: null,
  progressStartedAt: 0,
  progressLastStep: 0,
  historyFlashTimer: null,
  messageTimer: null,
  currentView: "main", // "main" | "library"
  registry: null,
  readyModels: [],
  hasSelection: false,
  mode: "generate", // "generate" | "inpaint"
};

const dom = {};

function $(id) {
  return document.getElementById(id);
}

function bindDom() {
  Object.assign(dom, {
    body: document.body,
    logoMark: $("logoMark"),
    statusPill: $("statusPill"),
    statusLabel: $("statusLabel"),
    canvasArea: $("canvasArea"),
    canvasLabel: $("canvasLabel"),
    canvasPlaceholder: $("canvasPlaceholder"),
    previewGrid: $("previewGrid"),
    dimensionBadge: $("dimensionBadge"),
    modeBadge: $("modeBadge"),
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
    variationRow: $("variationRow"),
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
    // Phase 2: Style & Prompts
    styleChips: $("styleChips"),
    advancedToggle: $("advancedToggle"),
    advancedArea: $("advancedArea"),
    toggleArrow: $("toggleArrow"),
    negativePromptInput: $("negativePromptInput"),
    savePromptBtn: $("savePromptBtn"),
    savedPrompts: $("savedPrompts"),
    // Settings Settings
    settingsToggleBtn: $("settingsToggleBtn"),
    settingsPanel: $("settingsPanel"),
    serverUrlInput: $("serverUrlInput"),
    connectBtn: $("connectBtn"),
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
  if (tone === "neutral") dom.errorMessage.classList.add("is-neutral");
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
  dom.logoMark.classList.toggle("is-generating", kind === "generating");
}

function getPromptValue() {
  return typeof dom.promptInput.value === "string" ? dom.promptInput.value : "";
}

function updateButtons() {
  // Preserve fill mode label
  if (!state.isGenerating) {
    dom.generateLabel.textContent = state.hasSelection ? "Generate Fill" : "Generate";
  }
  dom.generateBtn.classList.toggle("generating", state.isGenerating);
  dom.applyBtn.disabled = !state.gridImages.length || state.isGenerating;
  dom.refreshBtn.disabled = state.isGenerating;
  dom.cancelBtn.classList.toggle("visible", state.isGenerating);
  dom.activePromptCard.classList.toggle("visible", state.isGenerating);
  dom.progressArea.classList.toggle("visible", state.isGenerating);
  dom.generationStats.classList.toggle("visible", state.isGenerating);
}

function updateGenerateAvailability() {
  const hasPrompt = Boolean(getPromptValue().trim());
  const hasModel = Boolean(dom.settingModel.value);
  dom.generateBtn.disabled = !(hasPrompt && hasModel && state.serverConnected && !state.isGenerating);
}

function updateDimensionBadge(width, height) {
  dom.dimensionBadge.textContent = `${width} × ${height}`;
}

function updateCharCount() {
  const len = getPromptValue().length;
  dom.charCount.textContent = String(len);
}

function getModelResolution(model) {
  // SD 1.5 models work best at 512×512
  // SDXL, Flux, SD3 work best at 1024×1024
  if (!model) return { width: 1024, height: 1024 };
  if (model.family === "sd15") return { width: 512, height: 512 };
  return { width: 1024, height: 1024 };
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
    if (model.default_steps) {
      // automated parameter
    }
    if (model.default_guidance !== undefined) {
      // automated parameter
    }
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
    
    // Check if this history entry is currently active
    const isActive = state.gridImages && state.gridImages.length > 0 && 
                     state.gridImages[state.activeGridIndex] &&
                     state.gridImages[state.activeGridIndex].base64 === entry.image;
                     
    if (isActive) button.classList.add("active");
    
    button.title = entry.prompt || "Generation";
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
  plus.addEventListener("click", () => showMessage("History is recorded automatically."));
  dom.historyStrip.appendChild(plus);
}

function restoreHistory(entry) {
  dom.promptInput.value = entry.prompt || "";
  state.batchSize = 1;
  dom.variationRow.querySelectorAll(".var-btn").forEach(b => {
    b.classList.toggle("active", b.dataset.val === "1");
  });

  if (entry.modelValue) {
    const options = [...dom.settingModel.options];
    const match = options.find((o) => o.value === entry.modelValue);
    if (match) dom.settingModel.value = entry.modelValue;
  }

  state.gridImages = [{ base64: entry.image, width: entry.width, height: entry.height, seed: entry.seed }];
  state.activeGridIndex = 0;
  
  renderGrid();
  updateDimensionBadge(entry.width || 1024, entry.height || 1024);
  updateModelBadge();
  updateCharCount();
  updateButtons();
  
  // Flash effect on canvas area to show something was restored
  dom.canvasArea.style.opacity = "0.5";
  setTimeout(() => dom.canvasArea.style.opacity = "1", 150);
  
  showMessage("History item restored.", "success");
}

function pushHistory(imageEntry) {
  const entry = {
    id: `history-${Date.now()}`,
    image: imageEntry.base64,
    prompt: getPromptValue().trim(),
    seed: imageEntry.seed,
    width: imageEntry.width,
    height: imageEntry.height,
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
  // If user has a custom URL, try it first. Otherwise fall back to defaults.
  const candidates = [state.serverUrl, ...SERVER_URLS].filter((url, i, self) => self.indexOf(url) === i);
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

      // If we connected to a fallback successfully, stick with it? 
      // Actually, if it's explicitly set by user, they probably want that one.
      return response.json();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Unable to reach server. Check your connection settings.");
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
// Selection detection
// ---------------------------------------------------------------------------

async function checkSelection() {
  if (state.isGenerating) return; // Don't change mode mid-generation
  try {
    const doc = app.activeDocument;
    if (!doc) {
      if (state.hasSelection) {
        state.hasSelection = false;
        state.mode = "generate";
        dom.modeBadge.textContent = "TXT";
        dom.generateLabel.textContent = "Generate";
        dom.canvasLabel.textContent = "No active selection";
        document.body.classList.remove("fill-mode");
      }
      return;
    }
    const hasSel = doc.selection.bounds !== null;
    if (hasSel !== state.hasSelection) {
      state.hasSelection = hasSel;
      state.mode = hasSel ? "inpaint" : "generate";
      dom.modeBadge.textContent = hasSel ? "FILL" : "TXT";
      dom.generateLabel.textContent = hasSel ? "Generate Fill" : "Generate";
      dom.canvasLabel.textContent = hasSel ? "Selection active — ready to fill" : "No active selection";
      document.body.classList.toggle("fill-mode", hasSel);
      // Update resolution badge based on document size when selection changes
      if (hasSel) {
        updateDimensionBadge(doc.width, doc.height);
      }
    }
  } catch (e) {
    // Selection API may throw if no document is open or selection is invalid
    if (state.hasSelection) {
      state.hasSelection = false;
      state.mode = "generate";
      dom.modeBadge.textContent = "TXT";
      dom.generateLabel.textContent = "Generate";
      document.body.classList.remove("fill-mode");
    }
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
  // Capture the current Photoshop selection as a mask image
  // White = selected area (where AI will generate), Black = keep as-is
  const doc = app.activeDocument;
  if (!doc) throw new Error("Open a Photoshop document first.");

  let base64Mask = null;

  await core.executeAsModal(async () => {
    const w = doc.width;
    const h = doc.height;

    // Step 1: Create a temporary document at the same size
    const tempDoc = await app.documents.add({
      width: w,
      height: h,
      resolution: doc.resolution,
      mode: "RGBColorMode",
      fill: "black",
      name: "_oddity_mask_temp",
    });

    try {
      // Step 2: Go back to original doc and save selection to clipboard
      await app.activeDocument = doc;

      // Save selection as alpha channel
      await action.batchPlay([
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _ref: "channel", _enum: "channel", _value: "transparencyEnum" },
        },
      ], { modalBehavior: "execute" });

      // Select All + Copy in the original to get the selection shape
      // Instead, we use a different approach:
      // Go to the temp doc, load selection from the original document, fill white

      // Switch to temp doc
      await app.activeDocument = tempDoc;

      // Fill entire document with black background first (already done by fill: "black")
      // Now load the selection from the original doc
      // We do this by: select all in temp, then load selection from original

      // Load selection from original document
      await action.batchPlay([
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          from: {
            _ref: "channel",
            _enum: "channel",
            _value: "transparencyEnum",
          },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { modalBehavior: "execute" });

      // Fill the selection with white
      await action.batchPlay([
        {
          _obj: "fill",
          using: { _enum: "fillContents", _value: "white" },
          opacity: { _unit: "percentUnit", _value: 100 },
          mode: { _enum: "blendMode", _value: "normal" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { modalBehavior: "execute" });

      // Deselect
      await action.batchPlay([
        {
          _obj: "set",
          _target: [{ _ref: "channel", _property: "selection" }],
          to: { _enum: "ordinal", _value: "none" },
          _options: { dialogOptions: "dontDisplay" },
        },
      ], { modalBehavior: "execute" });

      // Save temp doc as PNG
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
    } finally {
      // Close temp document without saving
      await tempDoc.closeWithoutSaving();
      // Switch back to original
      await app.activeDocument = doc;
    }
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
  dom.batchValue.textContent = `${state.batchSize}`;

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

function renderGrid() {
  dom.previewGrid.innerHTML = "";
  dom.previewGrid.className = `preview-grid grid-${state.gridImages.length}`;
  
  if (state.gridImages.length === 0) {
    dom.canvasArea.classList.remove("has-after");
    dom.previewGrid.innerHTML = "";
    return;
  }
  
  dom.canvasArea.classList.add("has-after");
  
  state.gridImages.forEach((img, index) => {
    const item = document.createElement("div");
    item.className = `grid-item ${index === state.activeGridIndex ? "selected" : ""}`;
    item.innerHTML = `<img src="data:image/png;base64,${img.base64}" alt="Variation ${index + 1}">`;
    item.addEventListener("click", () => {
      state.activeGridIndex = index;
      renderGrid();
      renderHistory(); 
    });
    dom.previewGrid.appendChild(item);
  });
}

async function runGeneration() {
  if (state.isGenerating) return;
  const rawPrompt = getPromptValue().trim();
  if (!rawPrompt) {
    showMessage("Enter a prompt before generating.", "error");
    return;
  }
  // Apply style prefix if a style is selected
  const prompt = getStyledPrompt(rawPrompt);
  const model = getSelectedModel();
  if (!model) {
    showMessage("No model selected. Open the Model Library to download one.", "error");
    return;
  }

  // Check if we should do inpainting (selection exists)
  const isInpaint = state.hasSelection;

  clearMessage();
  state.isGenerating = true;
  state.gridImages = [];
  state.activeGridIndex = 0;
  renderGrid();
  
  dom.applyBtn.disabled = true;
  const familyLabel = model.family_display || model.family.toUpperCase();
  const modeLabel = isInpaint ? "Filling selection" : `Preparing ${state.batchSize} variations`;
  setStatus("generating", familyLabel, modeLabel);
  dom.activePromptText.textContent = prompt;
  updateButtons();

  try {
    startProgressPolling();
    const res = getModelResolution(model);
    let result;

    if (isInpaint) {
      // --- INPAINT / FILL MODE ---
      showMessage("Capturing canvas and selection mask...", "neutral", 0);
      const canvasImage = await captureCanvas();
      const maskImage = await captureMask();
      clearMessage();

      const negPrompt = dom.negativePromptInput ? dom.negativePromptInput.value.trim() : "";

      const body = {
        family: model.family,
        model_id: model.id,
        prompt,
        negative_prompt: negPrompt,
        image: canvasImage,
        mask: maskImage,
        strength: 0.85,
        num_steps: model.default_steps || 20,
        guidance_scale: model.default_guidance || 7.5,
        seed: -1,
        batch_size: state.batchSize,
      };

      result = await serverFetch("/inpaint", { method: "POST", body: JSON.stringify(body) });
    } else {
      // --- TEXT-TO-IMAGE MODE ---
      const negPrompt = dom.negativePromptInput ? dom.negativePromptInput.value.trim() : "";

      const body = {
        family: model.family,
        model_id: model.id,
        prompt,
        negative_prompt: negPrompt,
        width: res.width,
        height: res.height,
        num_steps: model.default_steps || 20,
        guidance_scale: model.default_guidance || 7.5,
        seed: -1,
        batch_size: state.batchSize,
      };

      result = await serverFetch("/generate", { method: "POST", body: JSON.stringify(body) });
    }

    state.gridImages = result.images.map((base64, i) => ({
      base64,
      width: result.width,
      height: result.height,
      seed: result.seeds[i]
    }));
    state.activeGridIndex = 0;
    
    renderGrid();
    updateDimensionBadge(result.width, result.height);
    
    // push history for each result
    state.gridImages.forEach(img => pushHistory(img));
    
    setStatus("ready", familyLabel, isInpaint ? "Fill complete" : "Render ready");
    dom.applyBtn.disabled = false;
    showMessage(isInpaint ? "Fill complete — click Apply to place on new layer." : "Generation complete.", "success");
  } catch (error) {
    const message = humanizeError(error.message);
    if (message.includes("cancelled")) {
      setStatus("ready", familyLabel, "Generation cancelled");
      showMessage("Generation cancelled.", "neutral");
    } else {
      setStatus("error", "ERROR", message);
      showMessage(message, "error", 5200);
    }
  } finally {
    stopProgressPolling();
    state.isGenerating = false;
    updateButtons();
    updateGenerateAvailability();
    await checkHealth();
  }
}

async function applyResult() {
  const activeImage = state.gridImages[state.activeGridIndex];
  if (!activeImage) return;
  
  dom.applyBtn.disabled = true;
  try {
    await applyAsNewLayer(activeImage.base64, "Oddity Result");
    showMessage("Result applied as a new layer.", "success");
  } catch (error) {
    showMessage(`Apply failed: ${error.message}`, "error", 5200);
  } finally {
    dom.applyBtn.disabled = false;
  }
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

  dom.variationRow.querySelectorAll(".var-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      dom.variationRow.querySelectorAll(".var-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      state.batchSize = parseInt(btn.dataset.val, 10) || 1;
    });
  });

  dom.settingModel.addEventListener("change", () => {
    updateModelBadge();
    updateNegativePromptForModel();
  });
  
  dom.refreshBtn.addEventListener("click", async () => {
    await checkHealth();
    await loadModels();
    showMessage("Model status refreshed.", "success", 1800);
  });
  dom.generateBtn.addEventListener("click", runGeneration);
  dom.applyBtn.addEventListener("click", applyResult);
  dom.cancelBtn.addEventListener("click", async () => {
    if (!state.isGenerating) return;
    try {
      await serverFetch("/cancel", { method: "POST" });
      showMessage("Cancelling generation...", "neutral");
    } catch (e) {
      showMessage("Could not cancel — generation may have already finished.", "error", 3000);
    }
  });

  // Escape key to cancel
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.isGenerating) {
      dom.cancelBtn.click();
    }
  });

  // View switching
  dom.viewLibraryBtn.addEventListener("click", () => switchView("library"));
  dom.libraryBackBtn.addEventListener("click", () => switchView("main"));

  // Advanced toggle (negative prompt)
  if (dom.advancedToggle) {
    dom.advancedToggle.addEventListener("click", () => {
      dom.advancedToggle.classList.toggle("open");
      dom.advancedArea.classList.toggle("visible");
    });
  }

  // Save prompt button
  if (dom.savePromptBtn) {
    dom.savePromptBtn.addEventListener("click", () => {
      const text = getPromptValue().trim();
      if (!text) {
        showMessage("Type a prompt to save it.", "error", 2000);
        return;
      }
      const saved = loadSavedPrompts();
      if (saved.includes(text)) {
        showMessage("This prompt is already saved.", "neutral", 2000);
        return;
      }
      saved.unshift(text);
      if (saved.length > 20) saved.pop();
      saveSavedPrompts(saved);
      renderSavedPrompts();
      showMessage("Prompt saved!", "success", 1500);
    });
  }

  // Settings panel toggle
  if (dom.settingsToggleBtn) {
    dom.settingsToggleBtn.addEventListener("click", () => {
      state.isSettingsOpen = !state.isSettingsOpen;
      dom.settingsPanel.classList.toggle("visible", state.isSettingsOpen);
      dom.settingsToggleBtn.classList.toggle("active", state.isSettingsOpen);
    });
  }

  // Connect button — save URL and reconnect
  if (dom.connectBtn) {
    dom.connectBtn.addEventListener("click", () => {
      let url = dom.serverUrlInput.value.trim();
      if (!url) {
        url = SERVER_URLS[0]; // Reset to default
        dom.serverUrlInput.value = url;
      }
      // Strip trailing slash
      url = url.replace(/\/+$/, "");
      state.serverUrl = url;
      saveStored(STORAGE_KEYS.serverUrl, url);
      dom.serverUrlInput.value = url;
      showMessage(`Connecting to ${url}...`, "neutral", 2000);
      // Immediately try to connect
      checkHealth().then(() => {
        if (state.serverConnected) {
          showMessage(`Connected to ${url}`, "success", 3000);
          loadModels();
        } else {
          showMessage(`Could not reach ${url}`, "error", 4000);
        }
      });
    });
  }

  // Also allow Enter key in the URL input
  if (dom.serverUrlInput) {
    dom.serverUrlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        dom.connectBtn.click();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Prompt Library, Styles & Saved Prompts
// ---------------------------------------------------------------------------

let promptLibrary = null;
let activeStyleIndex = -1;

async function loadPromptLibrary() {
  try {
    const resp = await fetch("./prompt_library.json");
    promptLibrary = await resp.json();
    renderStyleChips();
    // Restore last active style
    const savedStyle = loadStored(STORAGE_KEYS.activeStyle, -1);
    if (savedStyle >= 0 && promptLibrary.styles[savedStyle]) {
      setActiveStyle(savedStyle);
    }
  } catch (e) {
    console.warn("Could not load prompt library", e);
  }
}

function renderStyleChips() {
  if (!promptLibrary || !dom.styleChips) return;
  dom.styleChips.innerHTML = "";
  
  // Add "None" chip
  const noneChip = document.createElement("button");
  noneChip.className = `style-chip${activeStyleIndex === -1 ? " active" : ""}`;
  noneChip.type = "button";
  noneChip.textContent = "None";
  noneChip.addEventListener("click", () => setActiveStyle(-1));
  dom.styleChips.appendChild(noneChip);

  promptLibrary.styles.forEach((style, i) => {
    const chip = document.createElement("button");
    chip.className = `style-chip${i === activeStyleIndex ? " active" : ""}`;
    chip.type = "button";
    chip.innerHTML = `<img src="${style.icon}" class="style-icon" aria-hidden="true" /> ${style.name}`;
    chip.addEventListener("click", () => setActiveStyle(i));
    dom.styleChips.appendChild(chip);
  });
}

function setActiveStyle(index) {
  activeStyleIndex = index;
  saveStored(STORAGE_KEYS.activeStyle, index);
  renderStyleChips();
}

function getStyledPrompt(rawPrompt) {
  if (activeStyleIndex < 0 || !promptLibrary) return rawPrompt;
  const style = promptLibrary.styles[activeStyleIndex];
  if (!style) return rawPrompt;
  return style.prefix + rawPrompt;
}

function updateNegativePromptForModel() {
  if (!promptLibrary || !dom.negativePromptInput) return;
  const model = getSelectedModel();
  if (!model) return;
  const family = model.family || "sd15";
  const defaultNeg = promptLibrary.negative_defaults[family] || "";
  // Only auto-fill if the user hasn't typed anything custom
  if (!dom.negativePromptInput.value.trim()) {
    dom.negativePromptInput.value = defaultNeg;
  }
}

// Saved prompts
function loadSavedPrompts() {
  return loadStored(STORAGE_KEYS.savedPrompts, []);
}

function saveSavedPrompts(prompts) {
  saveStored(STORAGE_KEYS.savedPrompts, prompts);
}

function renderSavedPrompts() {
  if (!dom.savedPrompts) return;
  const prompts = loadSavedPrompts();
  if (prompts.length === 0) {
    dom.savedPrompts.innerHTML = '<div class="saved-prompts-empty">No saved prompts yet</div>';
    return;
  }
  dom.savedPrompts.innerHTML = "";
  prompts.forEach((text, i) => {
    const item = document.createElement("div");
    item.className = "saved-prompt-item";
    item.innerHTML = `
      <div class="saved-prompt-text">${escapeHtml(text)}</div>
      <button class="saved-prompt-del" type="button" title="Delete">
        <svg viewBox="-3 0 32 32" xmlns="http://www.w3.org/2000/svg">
          <path d="M282,211 L262,211 C261.448,211 261,210.553 261,210 C261,209.448 261.448,209 262,209 L282,209 C282.552,209 283,209.448 283,210 C283,210.553 282.552,211 282,211 L282,211 Z M281,231 C281,232.104 280.104,233 279,233 L265,233 C263.896,233 263,232.104 263,231 L263,213 L281,213 L281,231 L281,231 Z M269,206 C269,205.447 269.448,205 270,205 L274,205 C274.552,205 275,205.447 275,206 L275,207 L269,207 L269,206 L269,206 Z M283,207 L277,207 L277,205 C277,203.896 276.104,203 275,203 L269,203 C267.896,203 267,203.896 267,205 L267,207 L261,207 C259.896,207 259,207.896 259,209 L259,211 C259,212.104 259.896,213 261,213 L261,231 C261,233.209 262.791,235 265,235 L279,235 C281.209,235 283,233.209 283,231 L283,213 C284.104,213 285,212.104 285,211 L285,209 C285,207.896 284.104,207 283,207 L283,207 Z M272,231 C272.552,231 273,230.553 273,230 L273,218 C273,217.448 272.552,217 272,217 C271.448,217 271,217.448 271,218 L271,230 C271,230.553 271.448,231 272,231 L272,231 Z M267,231 C267.552,231 268,230.553 268,230 L268,218 C268,217.448 267.552,217 267,217 C266.448,217 266,217.448 266,218 L266,230 C266,230.553 266.448,231 267,231 L267,231 Z M277,231 C277.552,231 278,230.553 278,230 L278,218 C278,217.448 277.552,217 277,217 C276.448,217 276,217.448 276,218 L276,230 C276,230.553 276.448,231 277,231 L277,231 Z" fill="currentColor" transform="translate(-259.000000, -203.000000)"/>
        </svg>
      </button>
    `;
    item.querySelector(".saved-prompt-text").addEventListener("click", () => {
      dom.promptInput.value = text;
      updateCharCount();
    });
    item.querySelector(".saved-prompt-del").addEventListener("click", (e) => {
      e.stopPropagation();
      const updated = loadSavedPrompts().filter((_, idx) => idx !== i);
      saveSavedPrompts(updated);
      renderSavedPrompts();
    });
    dom.savedPrompts.appendChild(item);
  });
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function init() {
  bindDom();
  renderHistory();
  initEvents();
  renderGrid();
  updateButtons();
  updateCharCount();
  // Pre-fill server URL input from saved state
  if (dom.serverUrlInput) {
    dom.serverUrlInput.value = state.serverUrl;
  }
  checkHealth();
  loadModels();
  loadPromptLibrary();
  renderSavedPrompts();
  state.healthInterval = setInterval(checkHealth, HEALTH_POLL_MS);
  // Poll for Photoshop selection changes
  state.selectionInterval = setInterval(checkSelection, 2000);
  checkSelection();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
