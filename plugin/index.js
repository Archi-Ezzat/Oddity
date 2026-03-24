const { app, action, core, imaging } = require("photoshop");
const { storage } = require("uxp");

const SERVER_URLS = ["http://127.0.0.1:5000", "http://localhost:5000"];
const HEALTH_POLL_MS = 3000;
const PROGRESS_POLL_MS = 450;
const MAX_HISTORY = 8;
const STORAGE_KEYS = {
  history: "oddity.history.v3",
};

const MODE_CONFIG = {
  generate: { label: "Generate", usesCanvas: false, modeBadge: "TXT", canvasLabel: "No active selection" },
  img2img: { label: "Remix", usesCanvas: true, modeBadge: "IMG", canvasLabel: "Active document is source" },
  inpaint: { label: "Inpaint", usesCanvas: true, modeBadge: "MASK", canvasLabel: "Use the active selection as your repair guide" },
  outpaint: { label: "Expand", usesCanvas: true, modeBadge: "EXP", canvasLabel: "Expand the Photoshop canvas before generating" },
};

const dom = {};
const state = {
  currentMode: "generate",
  sourceMode: "txt2img",
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
  progressStartedAt: 0,
  progressLastStep: 0,
  historyFlashTimer: null,
  messageTimer: null,
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
    chipImg2Img: $("chipImg2Img"),
    chipTxt2Img: $("chipTxt2Img"),
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
  if (state.currentMode === "generate") {
    return state.sourceMode === "img2img" ? "img2img" : "generate";
  }
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

function updateChipState() {
  const forcedCanvasMode = state.currentMode !== "generate";
  dom.chipImg2Img.classList.toggle("active", forcedCanvasMode || state.sourceMode === "img2img");
  dom.chipTxt2Img.classList.toggle("active", !forcedCanvasMode && state.sourceMode === "txt2img");
  dom.chipTxt2Img.classList.toggle("is-disabled", forcedCanvasMode);
}

function updateModeUI() {
  const mode = getEffectiveMode();
  const usesCanvas = MODE_CONFIG[mode].usesCanvas;
  dom.body.dataset.mode = mode;
  updateTabState();
  updateChipState();
  dom.modeBadge.textContent = MODE_CONFIG[mode].modeBadge;
  dom.canvasLabel.textContent = MODE_CONFIG[mode].canvasLabel;

  dom.settingStrength.disabled = mode === "generate";
  dom.strengthCard.classList.toggle("is-disabled", mode === "generate");
  dom.strengthHint.textContent = mode === "generate" ? "Inactive" : "Denoising";

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
  dom.generateBtn.disabled = !(hasPrompt && hasModel && state.modelReady && !state.isGenerating);
}

function updateDimensionBadge(width, height) {
  dom.dimensionBadge.textContent = `${width} × ${height}`;
}

function randomSeed() {
  dom.settingSeed.value = String(Math.floor(Math.random() * 9999999));
}

function renderHistory() {
  dom.historyStrip.innerHTML = "";

  state.history.forEach((entry) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "hist-thumb";
    if (state.lastGeneratedImage && state.lastGeneratedImage.base64 === entry.image) {
      button.classList.add("active");
    }
    button.title = entry.prompt || MODE_CONFIG[entry.mode].label;
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
  state.sourceMode = entry.sourceMode || (entry.mode === "generate" ? "txt2img" : "img2img");
  dom.promptInput.value = entry.prompt || "";
  dom.settingStrength.value = String(entry.strength || 72);
  dom.settingGuidance.value = String(entry.guidance || 75);
  dom.settingSteps.value = String(entry.steps || 28);
  dom.settingResolution.value = String(entry.resolution || 1024);
  dom.settingSeed.value = String(entry.seed ?? -1);
  dom.layerRouting.value = entry.route || "new_layer";
  if (entry.model && [...dom.settingModel.options].some((option) => option.value === entry.model)) {
    dom.settingModel.value = entry.model;
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
    sourceMode: state.sourceMode,
    seed,
    width,
    height,
    beforeImage: state.beforeImage,
    strength: Number(dom.settingStrength.value),
    guidance: Number(dom.settingGuidance.value),
    steps: Number(dom.settingSteps.value),
    resolution: Number(dom.settingResolution.value),
    route: dom.layerRouting.value,
    model: dom.settingModel.value,
  };
  state.history = [entry, ...state.history].slice(0, MAX_HISTORY);
  saveStored(STORAGE_KEYS.history, state.history);
  renderHistory();
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
    const models = await serverFetch("/models");
    dom.settingModel.innerHTML = "";
    if (!models.length) {
      dom.settingModel.innerHTML = '<option value="">No local models found</option>';
      updateGenerateAvailability();
      return;
    }

    models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      dom.settingModel.appendChild(option);
    });

    if (!dom.settingModel.value) {
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

    if (data.model_status === "error") {
      setStatus("error", "ERROR", "Model failed to load");
    } else if ((data.model_status || "").includes("loading")) {
      setStatus("starting", "STARTING", `Model status: ${data.model_status}`);
    } else if (state.isGenerating) {
      setStatus("generating", "FLUX", `Sampling locally on ${data.current_model || "selected weights"}`);
    } else if (state.modelReady) {
      setStatus("ready", "LOCAL", data.current_model || "Base pipeline loaded locally");
    } else {
      setStatus("starting", "STARTING", data.model_status || "Warming up");
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
    return "VRAM limit reached. Lower resolution, steps, or strength and try again.";
  }
  if (lower.includes("capture") || lower.includes("document")) {
    return "Photoshop could not capture the current document. Make sure a document is open.";
  }
  return message;
}

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

async function runGeneration() {
  if (state.isGenerating || !state.modelReady) return;
  const prompt = getPromptValue().trim();
  if (!prompt) {
    showMessage("Enter a prompt before generating.", "error");
    return;
  }
  if (!dom.settingModel.value) {
    showMessage("No local model is selected yet.", "error");
    return;
  }

  clearMessage();
  state.isGenerating = true;
  state.lastGeneratedImage = null;
  dom.previewImage.removeAttribute("src");
  dom.applyBtn.disabled = true;
  const mode = getEffectiveMode();
  const usesCanvas = MODE_CONFIG[mode].usesCanvas;
  setStatus("generating", "FLUX", `Preparing ${MODE_CONFIG[mode].label.toLowerCase()} request`);
  dom.activePromptText.textContent = prompt;
  updateButtons();
  updateModeUI();
  updateCanvasState();

  try {
    let sourceBase64 = null;
    let width = Number(dom.settingResolution.value);
    let height = Number(dom.settingResolution.value);

    if (usesCanvas) {
      sourceBase64 = await captureCanvas();
      state.beforeImage = sourceBase64;
      dom.beforeImage.src = `data:image/png;base64,${sourceBase64}`;
      dom.progressSub.textContent = "Capturing the active Photoshop document.";
    } else {
      state.beforeImage = null;
      dom.beforeImage.removeAttribute("src");
    }

    updateCanvasState();
    startProgressPolling();

    const body = usesCanvas
      ? {
          model_name: dom.settingModel.value,
          prompt,
          image: sourceBase64,
          strength: Number(dom.settingStrength.value) / 100,
          num_steps: Number(dom.settingSteps.value),
          guidance_scale: Number(dom.settingGuidance.value) / 10,
          seed: parseInt(dom.settingSeed.value, 10) || -1,
        }
      : {
          model_name: dom.settingModel.value,
          prompt,
          width,
          height,
          num_steps: Number(dom.settingSteps.value),
          guidance_scale: Number(dom.settingGuidance.value) / 10,
          seed: parseInt(dom.settingSeed.value, 10) || -1,
        };

    const endpoint = usesCanvas ? "/img2img" : "/generate";
    const result = await serverFetch(endpoint, { method: "POST", body: JSON.stringify(body) });

    state.lastGeneratedImage = { base64: result.image, width: result.width, height: result.height };
    dom.previewImage.src = `data:image/png;base64,${result.image}`;
    state.compareMode = "after";
    updateDimensionBadge(result.width, result.height);
    updateCanvasState();
    pushHistory(result, result.seed, result.width, result.height);
    setStatus("ready", "LOCAL", `Render ready · seed ${result.seed}`);
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
  if (mode !== "generate") {
    state.sourceMode = "img2img";
  }
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

function initEvents() {
  dom.promptInput.addEventListener("input", updateCharCount);
  dom.promptInput.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runGeneration();
    }
  });

  dom.chipImg2Img.addEventListener("click", () => {
    if (state.currentMode !== "generate") return;
    state.sourceMode = "img2img";
    updateModeUI();
  });
  dom.chipTxt2Img.addEventListener("click", () => {
    if (state.currentMode !== "generate") return;
    state.sourceMode = "txt2img";
    updateModeUI();
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
  dom.refreshBtn.addEventListener("click", async () => {
    await checkHealth();
    await loadModels();
    showMessage("Local model status refreshed.", "success", 1800);
  });
  dom.generateBtn.addEventListener("click", runGeneration);
  dom.applyBtn.addEventListener("click", applyResult);
  dom.cancelBtn.addEventListener("click", () => {
    showMessage("Cancel is not available in the current backend yet.", "error", 4200);
  });
}

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
