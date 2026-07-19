const { app, BrowserWindow, ipcMain, Menu, powerSaveBlocker, screen, session, shell } = require("electron");
const dns = require("dns").promises;
const net = require("net");
const { pathToFileURL } = require("url");
const fs = require("fs");
const os = require("os");
const path = require("path");
const logger = require("./logger");
const { loadLocaleBundle } = require("./src/locale-loader");
const isPerformanceTest = process.argv.includes("--performance-test");
const isSoakTest = process.argv.includes("--soak-test");
const isSmokeTest = process.argv.includes("--smoke-test") || isPerformanceTest || isSoakTest;
const logStatus = logger.initialize({
  packaged: app.isPackaged,
  appRoot: __dirname,
  localAppData: process.env.LOCALAPPDATA || path.dirname(app.getPath("userData"))
});
logger.write("info", "lifecycle", "startup", { version: app.getVersion(), platform: process.platform, logFallback: logStatus.fallback });
process.on("uncaughtException", (error) => {
  logger.write("error", "process", "uncaught_exception", null, error);
  process.exitCode = 1;
  if (app.isReady()) app.exit(1);
});
process.on("unhandledRejection", (reason) => {
  logger.write("error", "process", "unhandled_rejection", null, reason instanceof Error ? reason : String(reason));
});
const processCachePath = path.join(app.getPath("temp"), "rgb-alpha-splitter-cache", String(process.pid));
fs.mkdirSync(processCachePath, { recursive: true });

// Live output must continue while the control window is minimized or occluded.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.commandLine.appendSwitch("disk-cache-dir", processCachePath);
app.commandLine.appendSwitch("disk-cache-size", "67108864");
app.commandLine.appendSwitch("disable-gpu-shader-disk-cache");

let mainWindow;
let nativeNdi = null;
let rendererRecoveryTimes = [];
const outputWindows = { rgb: null, alpha: null };
const outputMetrics = {
  rgb: { fps: 0, updatedAt: 0 },
  alpha: { fps: 0, updatedAt: 0 }
};
let powerSaveBlockerId = null;
let rendererClock = null;
let rendererClockReady = true;
let rendererClockSuspended = false;
let rendererClockLastSent = 0;
let gpuMetricsLastAt = 0;
let gpuMetricsLastFrames = 0n;
let gpuRecoveryInProgress = false;
let lastPerformanceLogAt = 0;
let urlSourceWindow = null;
let lastUrlLoggedState = "stopped";
let urlMonitor = null;
let urlPreviewTimer = null;
let urlInteractionEnabled = false;
let urlTransparentBackground = true;
let urlInputCommandQueue = Promise.resolve();
let urlInputFailureLogged = false;
let urlCursorProbeAt = 0;
let sourceGeneration = 0;
let activeSource = { type: "test", generation: 0 };
let signalConfig = {
  sourcePrimaries: "rec709",
  sourceRange: "full",
  outputPrimaries: "rec709",
  outputRange: "limited",
  transfer: "gamma24",
  outputResolution: "1920x1080",
  outputWidth: 1920,
  outputHeight: 1080,
  outputFrameRate: "30",
  frameRateN: 30,
  frameRateD: 1,
  scanMode: "progressive",
  fieldOrder: "none",
  scalingMode: "fit",
  cropRect: { x: 0, y: 0, width: 1, height: 1 },
  gpuPreference: "high-performance",
  gpuAdapterLuid: "",
  previewPolicy: "lightweight",
  syncMode: "stable",
  alphaGain: 1,
  invertAlpha: false,
  autoColor: true,
  manualColorLocked: false,
  formatPreset: "1080p30"
};
let engineStatus = {
  requestedBackend: "auto",
  backend: "compatibility",
  gpuAvailable: false,
  reason: "Native shared-texture presentation is not initialized; compatibility backend is active."
};
let urlSourceStatus = { active: false, state: "stopped", url: null, width: 0, height: 0, fps: 0, actualFps: 0, frozenMs: 0, hasAlpha: false };

function getLocaleBundle() {
  const localesDirectory = app.isPackaged ? path.join(process.resourcesPath, "locales") : path.join(__dirname, "locales");
  return {
    ...loadLocaleBundle(localesDirectory),
    systemLocale: app.getLocale()
  };
}

const SIGNAL_PRESETS = Object.freeze({
  "720p50": { width: 1280, height: 720, frameRateN: 50, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "720p59.94": { width: 1280, height: 720, frameRateN: 60000, frameRateD: 1001, scanMode: "progressive", fieldOrder: "none" },
  "1080p23.976": { width: 1920, height: 1080, frameRateN: 24000, frameRateD: 1001, scanMode: "progressive", fieldOrder: "none" },
  "1080p24": { width: 1920, height: 1080, frameRateN: 24, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "1080p25": { width: 1920, height: 1080, frameRateN: 25, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "1080p29.97": { width: 1920, height: 1080, frameRateN: 30000, frameRateD: 1001, scanMode: "progressive", fieldOrder: "none" },
  "1080p30": { width: 1920, height: 1080, frameRateN: 30, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "1080p50": { width: 1920, height: 1080, frameRateN: 50, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "1080p59.94": { width: 1920, height: 1080, frameRateN: 60000, frameRateD: 1001, scanMode: "progressive", fieldOrder: "none" },
  "1080p60": { width: 1920, height: 1080, frameRateN: 60, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "1080i50": { width: 1920, height: 1080, frameRateN: 25, frameRateD: 1, scanMode: "interlaced", fieldOrder: "tff" },
  "1080i59.94": { width: 1920, height: 1080, frameRateN: 30000, frameRateD: 1001, scanMode: "interlaced", fieldOrder: "tff" },
  "2160p25": { width: 3840, height: 2160, frameRateN: 25, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "2160p29.97": { width: 3840, height: 2160, frameRateN: 30000, frameRateD: 1001, scanMode: "progressive", fieldOrder: "none" },
  "2160p30": { width: 3840, height: 2160, frameRateN: 30, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "2160p50": { width: 3840, height: 2160, frameRateN: 50, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" },
  "2160p59.94": { width: 3840, height: 2160, frameRateN: 60000, frameRateD: 1001, scanMode: "progressive", fieldOrder: "none" },
  "2160p60": { width: 3840, height: 2160, frameRateN: 60, frameRateD: 1, scanMode: "progressive", fieldOrder: "none" }
});
const OUTPUT_RESOLUTIONS = Object.freeze({
  "1280x720": { width: 1280, height: 720, label: "1280 x 720" },
  "1920x1080": { width: 1920, height: 1080, label: "1920 x 1080" },
  "3840x2160": { width: 3840, height: 2160, label: "3840 x 2160" },
  "custom": { width: 1920, height: 1080, label: "自定义" }
});
const OUTPUT_FRAME_RATES = Object.freeze({
  "23.976": { frameRateN: 24000, frameRateD: 1001 }, "24": { frameRateN: 24, frameRateD: 1 },
  "25": { frameRateN: 25, frameRateD: 1 }, "29.97": { frameRateN: 30000, frameRateD: 1001 },
  "30": { frameRateN: 30, frameRateD: 1 }, "50": { frameRateN: 50, frameRateD: 1 },
  "59.94": { frameRateN: 60000, frameRateD: 1001 }, "60": { frameRateN: 60, frameRateD: 1 }
});

function activateSource(type) {
  sourceGeneration += 1;
  activeSource = { type, generation: sourceGeneration };
  logger.write("info", "source", "activated", { type, generation: sourceGeneration });
  return activeSource;
}

function isTrustedSender(event) {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents);
}

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const parts = address.split(".").map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168);
  }
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

async function isPrivateHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!normalized) return false;
  if (normalized === "localhost" || normalized.endsWith(".localhost") || normalized.endsWith(".local")) return true;
  if (net.isIP(normalized)) return isPrivateIp(normalized);
  try {
    const addresses = await dns.lookup(normalized, { all: true });
    return addresses.some((item) => isPrivateIp(item.address));
  } catch (_) {
    return false;
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();

function findNdiRuntime() {
  const sdkDir = process.env.NDI_SDK_DIR;
  const candidates = process.platform === "darwin"
    ? [
        sdkDir && path.join(sdkDir, "lib", "macOS", "libndi.dylib"),
        "/Library/NDI SDK for Apple/lib/macOS/libndi.dylib",
        "/Library/NDI/lib/libndi.dylib",
        "/usr/local/lib/libndi.dylib",
        "/opt/homebrew/lib/libndi.dylib"
      ].filter(Boolean)
    : [
        "C:\\Program Files\\NDI\\NDI 6 Runtime\\v6\\Processing.NDI.Lib.x64.dll",
        "C:\\Program Files\\NDI\\NDI 5 Runtime\\v5\\Processing.NDI.Lib.x64.dll"
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadNativeNdi() {
  const addonPath = path.join(__dirname, "native", "ndi-node.node");
  const runtimePath = findNdiRuntime();
  if (runtimePath) {
    const runtimeDir = path.dirname(runtimePath);
    if (process.platform === "darwin") {
      process.env.DYLD_LIBRARY_PATH = `${runtimeDir}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ""}`;
      process.env.DYLD_FALLBACK_LIBRARY_PATH = `${runtimeDir}${path.delimiter}${process.env.DYLD_FALLBACK_LIBRARY_PATH || ""}`;
    } else {
      process.env.PATH = `${runtimeDir}${path.delimiter}${process.env.PATH || ""}`;
    }
  }
  if (fs.existsSync(addonPath)) {
    try {
      nativeNdi = require(addonPath);
      if (typeof nativeNdi.getEngineCapabilities === "function") {
        const capabilities = nativeNdi.getEngineCapabilities();
        engineStatus = {
          ...engineStatus,
          gpuAvailable: Boolean(capabilities.gpuSharedTexture),
          backend: capabilities.gpuSharedTexture ? "gpu" : "compatibility",
          platformBackend: capabilities.platformBackend,
          reason: capabilities.reason || engineStatus.reason
        };
      }
    } catch (error) {
      console.error("Failed to load the NDI native module:", error);
    }
  }
}

function sendUrlStatus(update) {
  urlSourceStatus = { ...urlSourceStatus, ...update };
  if (urlSourceStatus.state !== lastUrlLoggedState) {
    logger.write(urlSourceStatus.state === "error" ? "error" : "info", "url", "state", {
      state: urlSourceStatus.state, frozenMs: urlSourceStatus.frozenMs || 0, error: urlSourceStatus.error || ""
    });
    lastUrlLoggedState = urlSourceStatus.state;
  }
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("url:status", urlSourceStatus);
  return urlSourceStatus;
}

function configureNativeGpu() {
  if (nativeNdi && typeof nativeNdi.configureSync === "function") {
    nativeNdi.configureSync({ mode: signalConfig.syncMode, frameRateN: signalConfig.frameRateN, frameRateD: signalConfig.frameRateD });
  }
  if (!nativeNdi || typeof nativeNdi.configureGpuPresenter !== "function" || !engineStatus.gpuAvailable) return false;
  const primariesMode = signalConfig.sourcePrimaries === signalConfig.outputPrimaries ? 0 : signalConfig.sourcePrimaries === "rec709" ? 1 : -1;
  const configured = nativeNdi.configureGpuPresenter({
    outputWidth: signalConfig.outputWidth,
    outputHeight: signalConfig.outputHeight,
    scalingMode: ({ fit: 0, fill: 1, stretch: 2, crop: 3 })[signalConfig.scalingMode] || 0,
    cropRect: signalConfig.cropRect,
    sourceLimited: signalConfig.sourceRange === "limited" ? 1 : 0,
    outputLimited: signalConfig.outputRange === "limited" ? 1 : 0,
    primariesMode,
    matrixMode: signalConfig.sourcePrimaries === "rec2020" ? 1 : 0,
    frameRateN: signalConfig.frameRateN,
    frameRateD: signalConfig.frameRateD,
    alphaGain: signalConfig.alphaGain,
    invertAlpha: signalConfig.invertAlpha ? 1 : 0,
    scanMode: signalConfig.scanMode === "interlaced" ? 1 : 0,
    fieldOrder: signalConfig.fieldOrder === "bff" ? 1 : 0,
    previewPolicy: ({ full: 0, lightweight: 1, paused: 2 })[signalConfig.previewPolicy] ?? 1
  });
  return configured;
}

function attachExistingGpuOutputs() {
  if (!nativeNdi || typeof nativeNdi.attachGpuOutput !== "function") return true;
  for (const kind of ["rgb", "alpha"]) {
    const win = outputWindows[kind];
    if (!win || win.isDestroyed()) continue;
    const attached = nativeNdi.attachGpuOutput(kind, win.getNativeWindowHandle());
    if (!attached.success) return false;
  }
  configureNativeGpu();
  return true;
}

function recoverNativeGpu(reasonPrefix = "D3D11 device recovery") {
  if (gpuRecoveryInProgress || !nativeNdi || typeof nativeNdi.recoverGpuPresenter !== "function") return false;
  gpuRecoveryInProgress = true;
  try {
    if (typeof nativeNdi.setGpuAdapterPreference === "function") {
      nativeNdi.setGpuAdapterPreference({ preference: signalConfig.gpuPreference, luid: signalConfig.gpuAdapterLuid });
    }
    const recovered = nativeNdi.recoverGpuPresenter();
    if (!recovered.success || !attachExistingGpuOutputs()) {
      engineStatus = { ...engineStatus, backend: "compatibility", gpuAvailable: false,
        reason: `${reasonPrefix} failed: ${recovered.reason || "output reattachment failed"}` };
      logger.write("error", "gpu", "recovery_failed", { reason: engineStatus.reason });
      return false;
    }
    engineStatus = { ...engineStatus, backend: "gpu", gpuAvailable: true, reason: recovered.reason };
    logger.write("info", "gpu", "recovered", { reason: recovered.reason || reasonPrefix });
    gpuMetricsLastAt = 0;
    gpuMetricsLastFrames = 0n;
    return true;
  } finally {
    gpuRecoveryInProgress = false;
  }
}

function refreshGpuMetrics() {
  if (!engineStatus.gpuAvailable || !nativeNdi || typeof nativeNdi.getGpuPresenterStatus !== "function") return;
  const now = Date.now();
  if (now - gpuMetricsLastAt < 500) return;
  const status = nativeNdi.getGpuPresenterStatus();
  const frames = BigInt(status.submittedFrames || 0);
  if (gpuMetricsLastAt) {
    const fps = Number(frames - gpuMetricsLastFrames) * 1000 / (now - gpuMetricsLastAt);
    for (const kind of ["rgb", "alpha"]) outputMetrics[kind] = { fps: Math.max(0, fps), updatedAt: now };
  }
  gpuMetricsLastAt = now;
  gpuMetricsLastFrames = frames;
  if (now - lastPerformanceLogAt >= 60000) {
    lastPerformanceLogAt = now;
    logger.write("info", "performance", "summary", {
      fps: outputMetrics.rgb.fps.toFixed(1), queue: status.queueDepth || 0,
      overwritten: status.overwrittenFrames || 0, uploadMs: Number(status.uploadMs || 0).toFixed(2),
      renderMs: Number(status.renderMs || 0).toFixed(2), presentMs: Number(status.presentMs || 0).toFixed(2),
      p95Ms: Number(status.p95FrameMs || 0).toFixed(2)
    });
  }
  if (Number(status.consecutiveFailures || 0) >= 3 && !recoverNativeGpu("D3D11 consecutive presentation failures")) {
    for (const kind of ["rgb", "alpha"]) {
      if (nativeNdi && typeof nativeNdi.detachGpuOutput === "function") nativeNdi.detachGpuOutput(kind);
      const win = outputWindows[kind];
      if (win && !win.isDestroyed()) setTimeout(() => recreateCompatibilityOutput(kind), 0);
    }
  }
}

function stopUrlSource() {
  if (urlMonitor) {
    clearInterval(urlMonitor);
    urlMonitor = null;
  }
  if (urlPreviewTimer) {
    clearInterval(urlPreviewTimer);
    urlPreviewTimer = null;
  }
  const win = urlSourceWindow;
  urlSourceWindow = null;
  urlInteractionEnabled = false;
  urlInputCommandQueue = Promise.resolve();
  urlInputFailureLogged = false;
  urlCursorProbeAt = 0;
  if (win && !win.isDestroyed()) win.destroy();
  if (urlSourceStatus.active) logger.write("info", "url", "stopped");
  return sendUrlStatus({ active: false, state: "stopped", url: null, interactive: false, cursor: "default" });
}

function normalizeUrlInput(value) {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  if (/^https?:\/\//i.test(raw) || /^data:/i.test(raw)) return raw;
  if (/^\/\//.test(raw)) return `https:${raw}`;
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

const URL_CURSOR_TYPES = new Set([
  "default", "pointer", "crosshair", "text", "wait", "help", "e-resize", "n-resize", "ne-resize",
  "nw-resize", "s-resize", "se-resize", "sw-resize", "w-resize", "ns-resize", "ew-resize",
  "nesw-resize", "nwse-resize", "col-resize", "row-resize", "move", "vertical-text", "cell",
  "context-menu", "alias", "progress", "no-drop", "copy", "none", "not-allowed", "zoom-in",
  "zoom-out", "grab", "grabbing", "all-scroll"
]);

function normalizeUrlCursor(type) {
  const aliases = {
    hand: "pointer",
    pointer: "default",
    nodrop: "no-drop",
    null: "default",
    "drag-drop-none": "no-drop",
    "drag-drop-move": "move",
    "drag-drop-copy": "copy",
    "drag-drop-link": "alias",
    "m-panning": "all-scroll",
    "m-panning-vertical": "ns-resize",
    "m-panning-horizontal": "ew-resize",
    "ns-no-resize": "not-allowed",
    "ew-no-resize": "not-allowed",
    "nesw-no-resize": "not-allowed",
    "nwse-no-resize": "not-allowed",
    custom: "default"
  };
  const normalized = aliases[type] || type;
  return URL_CURSOR_TYPES.has(normalized) ? normalized : "default";
}

function normalizeUrlCssCursor(type) {
  return URL_CURSOR_TYPES.has(type) ? type : "default";
}

function ensureUrlInputDebugger(win) {
  if (!win || win.isDestroyed()) return false;
  try {
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach();
    return true;
  } catch (error) {
    logger.write("error", "url", "input_debugger_attach_failed", { message: error.message });
    return false;
  }
}

function cdpInputModifiers(modifiers) {
  const values = new Set(Array.isArray(modifiers) ? modifiers : []);
  return (values.has("alt") ? 1 : 0) |
    (values.has("control") ? 2 : 0) |
    (values.has("command") ? 4 : 0) |
    (values.has("shift") ? 8 : 0);
}

function cdpVirtualKeyCode(key, code) {
  const named = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18, Escape: 27, " ": 32,
    PageUp: 33, PageDown: 34, End: 35, Home: 36, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39,
    ArrowDown: 40, Insert: 45, Delete: 46, Meta: 91
  };
  if (named[key]) return named[key];
  if (/^Key[A-Z]$/.test(code || "")) return code.charCodeAt(3);
  if (/^Digit[0-9]$/.test(code || "")) return code.charCodeAt(5);
  if (typeof key === "string" && key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

function cdpEditCommands(input) {
  const modifiers = new Set(Array.isArray(input.modifiers) ? input.modifiers : []);
  if (!modifiers.has("control") && !modifiers.has("command")) return undefined;
  const key = String(input.key || "").toLowerCase();
  if (key === "a") return ["SelectAll"];
  if (key === "c") return ["Copy"];
  if (key === "x") return ["Cut"];
  if (key === "v") return ["Paste"];
  if (key === "z") return [modifiers.has("shift") ? "Redo" : "Undo"];
  if (key === "y") return ["Redo"];
  return undefined;
}

async function startUrlSource(options = {}) {
  if (!nativeNdi || typeof nativeNdi.publishBgraFrame !== "function") {
    throw new Error("URL frame publisher is unavailable. Rebuild the native module first.");
  }
  const rawUrl = normalizeUrlInput(options.url);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error("ERR_URL_INVALID");
  }
  const allowed = parsed.protocol === "http:" || parsed.protocol === "https:" ||
    (isSmokeTest && parsed.protocol === "data:");
  if (!allowed) throw new Error("ERR_URL_PROTOCOL");
  const width = Math.min(4096, Math.max(64, Number(options.width) || 1920));
  const height = Math.min(2160, Math.max(64, Number(options.height) || 1080));
  const fps = Math.min(60, Math.max(1, Number(options.fps) || 30));
  const transparentBackground = options.transparentBackground !== false;
  const allowLan = options.allowLan === true;
  const useGpuTexture = engineStatus.gpuAvailable && options.forceCompatibility !== true;

  stopUrlSource();
  urlTransparentBackground = transparentBackground;
  if (nativeNdi) nativeNdi.disconnect();
  const source = activateSource("url");
  logger.write("info", "url", "loading", { url: rawUrl, width, height, fps });
  if (!allowLan && await isPrivateHost(parsed.hostname)) {
    activateSource("test");
    throw new Error("URL points to localhost or a private network. Enable LAN URL access to continue.");
  }
  const urlSession = session.fromPartition(`url-source-${source.generation}`, { cache: false });
  const hostPolicyCache = new Map();
  urlSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  urlSession.setPermissionCheckHandler(() => false);
  urlSession.webRequest.onBeforeRequest({ urls: ["*://*/*"] }, async (details, callback) => {
    try {
      const requestUrl = new URL(details.url);
      if (requestUrl.protocol !== "http:" && requestUrl.protocol !== "https:") return callback({ cancel: true });
      if (!allowLan) {
        const cached = hostPolicyCache.get(requestUrl.hostname);
        let blocked = cached && Date.now() - cached.checkedAt < 10000 ? cached.blocked : undefined;
        if (blocked === undefined) {
          blocked = await isPrivateHost(requestUrl.hostname);
          hostPolicyCache.set(requestUrl.hostname, { blocked, checkedAt: Date.now() });
        }
        if (blocked) return callback({ cancel: true });
      }
      callback({ cancel: false });
    } catch (_) {
      callback({ cancel: true });
    }
  });
  urlSession.on("will-download", (event, item) => {
    event.preventDefault();
    item.cancel();
  });
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    transparent: true,
    frame: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: useGpuTexture ? { useSharedTexture: true } : true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      session: urlSession
    }
  });
  win.setBackgroundColor("#00000000");
  urlSourceWindow = win;
  urlInputCommandQueue = Promise.resolve();
  urlInputFailureLogged = false;
  urlCursorProbeAt = 0;
  win.webContents.setAudioMuted(true);
  win.webContents.on("cursor-changed", (_event, type) => {
    if (win !== urlSourceWindow || !urlInteractionEnabled) return;
    const cursor = normalizeUrlCursor(type);
    if (cursor === "default") return;
    if (cursor !== urlSourceStatus.cursor) sendUrlStatus({ cursor });
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, targetUrl) => {
    let protocol = "";
    try { protocol = new URL(targetUrl).protocol; } catch (_) { event.preventDefault(); return; }
    if (protocol !== "http:" && protocol !== "https:" && !(isSmokeTest && protocol === "data:")) {
      event.preventDefault();
    }
  });
  if (typeof win.webContents.setFrameRate === "function") win.webContents.setFrameRate(fps);
  let gpuFallbackStarted = false;
  let previewCapturePending = false;
  let lastPreviewCaptureAt = 0;
  const publishPreviewBitmap = (capture) => {
    const size = capture.getSize();
    if (!size.width || !size.height || win !== urlSourceWindow) return false;
    const bitmap = capture.toBitmap();
    nativeNdi.publishBgraFrame(bitmap, size.width, size.height, fps, 1);
    urlSourceStatus.width = size.width;
    urlSourceStatus.height = size.height;
    return true;
  };
  const requestPreviewCapture = () => {
    if (!useGpuTexture || previewCapturePending || win !== urlSourceWindow || win.isDestroyed()) return;
    const now = Date.now();
    if (now - lastPreviewCaptureAt < 1000 / Math.max(1, Math.min(15, fps))) return;
    previewCapturePending = true;
    lastPreviewCaptureAt = now;
    setTimeout(() => {
      if (win !== urlSourceWindow || win.isDestroyed()) {
        previewCapturePending = false;
        return;
      }
      win.webContents.capturePage().then((capture) => {
        publishPreviewBitmap(capture);
      }).catch(() => {}).finally(() => { previewCapturePending = false; });
    }, 0);
  };
  win.webContents.on("paint", (event, _dirty, image) => {
    if (win !== urlSourceWindow || win.isDestroyed() || activeSource.generation !== source.generation) {
      if (event.texture && typeof event.texture.release === "function") event.texture.release();
      return;
    }
    if (event.texture) {
      try {
        const submitted = nativeNdi.submitGpuSharedTexture(event.texture.textureInfo.sharedTextureHandle);
        if (!submitted.success && !gpuFallbackStarted) {
          gpuFallbackStarted = true;
          sendUrlStatus({ state: "loading", backend: "compatibility", error: submitted.reason });
          setTimeout(() => startUrlSource({ ...options, forceCompatibility: true }).catch((error) =>
            sendUrlStatus({ state: "error", error: error.message })), 0);
        }
        urlSourceStatus.frameCount = Number(urlSourceStatus.frameCount || 0) + 1;
        urlSourceStatus.lastFrameAt = Date.now();
      } finally {
        event.texture.release();
      }
      requestPreviewCapture();
      return;
    }
    const size = image.getSize();
    if (!size.width || !size.height) return;
    try {
      if (!publishPreviewBitmap(image)) return;
      urlSourceStatus.frameCount = Number(urlSourceStatus.frameCount || 0) + 1;
      urlSourceStatus.lastFrameAt = Date.now();
    } catch (error) {
      sendUrlStatus({ state: "error", error: error.message });
    }
  });
  win.webContents.on("did-finish-load", async () => {
    if (win !== urlSourceWindow) return;
    if (transparentBackground) {
      await win.webContents.insertCSS("html,body{background:transparent !important;}").catch(() => {});
    }
    if (typeof win.webContents.invalidate === "function") win.webContents.invalidate();
    await applyUrlTransparentBackground(urlTransparentBackground, false);
    let natural = null;
    try {
      natural = await win.webContents.executeJavaScript(`(() => {
        const image = document.images.length === 1 ? document.images[0] : null;
        const video = document.querySelector("video");
        if (image && image.naturalWidth) return { type: "image", width: image.naturalWidth, height: image.naturalHeight };
        if (video && video.videoWidth) return { type: "video", width: video.videoWidth, height: video.videoHeight };
        return { type: "page", width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight };
      })()`);
    } catch (_) {
      natural = { type: "page", width, height };
    }
    sendUrlStatus({ active: true, state: "running", naturalSize: natural, detectedSignal: {
      width: natural.width || width, height: natural.height || height, frameRateN: fps, frameRateD: 1,
      pixelFormat: "BGRA", primaries: "rec709", range: "full", detectionSource: "browser",
      confidence: natural.type === "page" ? "low" : "medium"
    }, error: null });
  });
  win.webContents.on("did-fail-load", (_event, code, description, validatedUrl, isMainFrame) => {
    if (isMainFrame) {
      logger.write("error", "url", "load_failed", { code, description, url: validatedUrl });
      sendUrlStatus({ active: false, state: "error", error: `${description} (${code})`, url: validatedUrl });
    }
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    if (win === urlSourceWindow) {
      logger.write("error", "url", "renderer_gone", { reason: details.reason, exitCode: details.exitCode });
      sendUrlStatus({ active: false, state: "error", error: `URL renderer exited: ${details.reason}` });
    }
  });
  win.on("closed", () => {
    if (win === urlSourceWindow) {
      urlSourceWindow = null;
      sendUrlStatus({ active: false, state: "stopped", url: null });
    }
  });
  sendUrlStatus({ active: true, state: "loading", url: rawUrl, width, height, fps, actualFps: 0,
    frozenMs: 0, frameCount: 0, lastFrameAt: Date.now(), generation: source.generation,
    hasAlpha: transparentBackground, transparentBackground, allowLan, backend: useGpuTexture ? "gpu" : "compatibility",
    interactive: false, cursor: "default", error: null });
  try {
    await win.loadURL(rawUrl);
  } catch (error) {
    if (win === urlSourceWindow) stopUrlSource();
    throw error;
  }
  let previousFrames = 0;
  urlMonitor = setInterval(() => {
    if (win !== urlSourceWindow || win.isDestroyed() || activeSource.generation !== source.generation) return;
    const now = Date.now();
    const frameCount = Number(urlSourceStatus.frameCount || 0);
    const actualFps = frameCount - previousFrames;
    previousFrames = frameCount;
    const frozenMs = Math.max(0, now - Number(urlSourceStatus.lastFrameAt || now));
    const state = frozenMs > 2500 ? "frozen" : "running";
    sendUrlStatus({ actualFps, frozenMs, state });
  }, 1000);
  return urlSourceStatus;
}

function sendUrlInputEvent(input) {
  if (!urlInteractionEnabled || !urlSourceWindow || urlSourceWindow.isDestroyed()) return false;
  if (!input || typeof input !== "object") return false;
  const allowedTypes = new Set(["mouseMove", "mouseDown", "mouseUp", "mouseWheel", "keyDown", "keyUp", "char"]);
  if (!allowedTypes.has(input.type)) return false;
  if (["mouseDown", "mouseUp"].includes(input.type) && input.button !== "left") return false;
  if (input.type === "mouseMove" && (Number(input.buttons) & ~1)) return false;
  const win = urlSourceWindow;
  if (!ensureUrlInputDebugger(win)) return false;
  const x = Math.max(0, Math.round(Number(input.x) || 0));
  const y = Math.max(0, Math.round(Number(input.y) || 0));
  const modifiers = cdpInputModifiers(input.modifiers);
  let method = "Input.dispatchMouseEvent";
  let params;
  if (input.type === "mouseMove") {
    const pressed = (Number(input.buttons) & 1) !== 0;
    params = { type: "mouseMoved", x, y, button: pressed ? "left" : "none", buttons: pressed ? 1 : 0, modifiers, pointerType: "mouse" };
  } else if (input.type === "mouseDown" || input.type === "mouseUp") {
    const pressed = input.type === "mouseDown";
    params = { type: pressed ? "mousePressed" : "mouseReleased", x, y, button: "left", buttons: pressed ? 1 : 0,
      clickCount: 1, modifiers, pointerType: "mouse" };
  } else if (input.type === "mouseWheel") {
    const clampDelta = (value) => Math.max(-10000, Math.min(10000, Number.isFinite(Number(value)) ? Number(value) : 0));
    const scale = Number(input.deltaMode) === 1 ? 16 : Number(input.deltaMode) === 2 ? Math.max(1, urlSourceStatus.height || 1) : 1;
    params = { type: "mouseWheel", x, y, deltaX: clampDelta(input.deltaX) * scale,
      deltaY: clampDelta(input.deltaY) * scale, modifiers, pointerType: "mouse" };
  } else if (input.type === "char") {
    method = "Input.insertText";
    params = { text: typeof input.key === "string" ? input.key : "" };
  } else {
    method = "Input.dispatchKeyEvent";
    const key = typeof input.key === "string" ? input.key : "";
    const code = typeof input.code === "string" ? input.code : "";
    const virtualKeyCode = cdpVirtualKeyCode(key, code);
    params = { type: input.type === "keyDown" ? "keyDown" : "keyUp", key, code, modifiers,
      windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode };
    const commands = input.type === "keyDown" ? cdpEditCommands(input) : undefined;
    if (commands) params.commands = commands;
  }
  const probeCursor = input.type === "mouseMove" && Date.now() - urlCursorProbeAt >= 50;
  if (probeCursor) urlCursorProbeAt = Date.now();
  urlInputCommandQueue = urlInputCommandQueue.then(() => {
    if (win !== urlSourceWindow || win.isDestroyed() || !win.webContents.debugger.isAttached()) return undefined;
    return win.webContents.debugger.sendCommand(method, params).then(async () => {
      if (!probeCursor || win !== urlSourceWindow || !urlInteractionEnabled) return;
      const result = await win.webContents.debugger.sendCommand("Runtime.evaluate", {
        expression: `(() => {
          const element = document.elementFromPoint(${x}, ${y});
          if (!element) return "default";
          const cursor = getComputedStyle(element).cursor;
          if (cursor && cursor !== "auto") return cursor;
          if (element.closest('textarea,input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]),[contenteditable="true"]')) return "text";
          if (element.closest('a[href]')) return "pointer";
          return "default";
        })()`,
        returnByValue: true
      });
      const cursor = normalizeUrlCssCursor(result && result.result && result.result.value);
      if (cursor !== urlSourceStatus.cursor) sendUrlStatus({ cursor });
    });
  }).catch((error) => {
    if (!urlInputFailureLogged) {
      urlInputFailureLogged = true;
      logger.write("error", "url", "input_dispatch_failed", { method, message: error.message });
    }
  });
  return true;
}

async function applyUrlTransparentBackground(enabled, notify = true) {
  urlTransparentBackground = Boolean(enabled);
  if (!urlSourceWindow || urlSourceWindow.isDestroyed()) return false;
  const background = urlTransparentBackground ? "transparent" : "#ffffff";
  try {
    await urlSourceWindow.webContents.executeJavaScript(`
      (() => {
        const styleId = "__rgbAlphaSplitterBackground";
        let style = document.getElementById(styleId);
        if (!style) {
          style = document.createElement("style");
          style.id = styleId;
          (document.head || document.documentElement).appendChild(style);
        }
        style.textContent = "html,body{background:${background} !important;}";
      })()
    `, true);
    urlSourceWindow.setBackgroundColor(urlTransparentBackground ? "#00000000" : "#ffffff");
    if (typeof urlSourceWindow.webContents.invalidate === "function") urlSourceWindow.webContents.invalidate();
    sendUrlStatus({ hasAlpha: urlTransparentBackground, transparentBackground: urlTransparentBackground });
    return true;
  } catch (_) {
    return false;
  }
}

async function probeGpuSharedTexture() {
  if (!nativeNdi || typeof nativeNdi.probeSharedTexture !== "function" || process.platform !== "win32") {
    return { success: false, reason: "No native shared-texture probe is available for this platform." };
  }
  const probeWindow = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      offscreen: { useSharedTexture: true },
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false
    }
  });
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (!probeWindow.isDestroyed()) probeWindow.destroy();
      resolve(result);
    };
    const timeout = setTimeout(() => finish({ success: false, reason: "Electron did not provide a shared texture within 5 seconds." }), 5000);
    probeWindow.webContents.on("paint", (event) => {
      const texture = event.texture;
      if (!texture) return;
      try {
        const result = nativeNdi.probeSharedTexture(texture.textureInfo.sharedTextureHandle);
        clearTimeout(timeout);
        finish({ ...result, pixelFormat: texture.textureInfo.pixelFormat });
      } finally {
        texture.release();
      }
    });
    probeWindow.loadURL("data:text/html,<body style='margin:0;background:%23f00'></body>").catch((error) => {
      clearTimeout(timeout);
      finish({ success: false, reason: error.message });
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    show: !isSmokeTest,
    width: 1440,
    height: 920,
    minWidth: 760,
    minHeight: 760,
    backgroundColor: "#0d1012",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  });
  mainWindow.setMenuBarVisibility(false);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (!app.isPackaged) return;
    const devToolsShortcut = input.key === "F12" ||
      ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i");
    if (devToolsShortcut) event.preventDefault();
  });

  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.write("error", "renderer", "process_gone", { reason: details.reason, exitCode: details.exitCode });
    if (details.reason === "clean-exit" || mainWindow.isDestroyed()) return;
    const now = Date.now();
    rendererRecoveryTimes = rendererRecoveryTimes.filter((time) => now - time < 60000);
    if (rendererRecoveryTimes.length >= 3) return;
    rendererRecoveryTimes.push(now);
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.reload();
    }, 1000);
  });
  mainWindow.on("closed", () => {
    stopUrlSource();
    for (const kind of ["rgb", "alpha"]) {
      const outputWindow = outputWindows[kind];
      if (outputWindow && !outputWindow.isDestroyed()) outputWindow.close();
    }
    mainWindow = null;
  });

  mainWindow.loadFile("index.html");
  mainWindow.webContents.on("did-finish-load", () => {
    rendererClockReady = true;
  });
  if (isSmokeTest) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        for (let attempt = 0; attempt < 80; ++attempt) {
          const ready = await mainWindow.webContents.executeJavaScript(`document.body.dataset.appReady === "true"`);
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const localFramePublished = await mainWindow.webContents.executeJavaScript(`
          (() => {
            const width = 320;
            const height = 180;
            const data = new Uint8Array(width * height * 4);
            for (let index = 0; index < data.length; index += 4) {
              const pixel = index / 4;
              data[index] = pixel % width;
              data[index + 1] = Math.floor(pixel / width);
              data[index + 2] = 96;
              data[index + 3] = pixel % 256;
            }
            return window.ndiBridge.publishLocalFrame({
              width, height, frameRateN: 30, frameRateD: 1, data
            });
          })()
        `);
        if (!localFramePublished) throw new Error("Local frame IPC publication failed.");
        await mainWindow.webContents.executeJavaScript(`
          document.getElementById("fullscreenBtn").click()
        `);
        for (let attempt = 0; attempt < 20 && (!outputWindows.rgb || !outputWindows.alpha); ++attempt) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const rgbTestWindow = outputWindows.rgb;
        const alphaTestWindow = outputWindows.alpha;
        if (!rgbTestWindow || !alphaTestWindow) {
          throw new Error("The all-output fullscreen action did not create both output windows.");
        }
        const waitForLoad = (win) => new Promise((resolve) => {
          if (!win.webContents.isLoading()) resolve();
          else win.webContents.once("did-finish-load", resolve);
        });
        await Promise.all([waitForLoad(rgbTestWindow), waitForLoad(alphaTestWindow)]);
        await new Promise((resolve) => setTimeout(resolve, 150));
        const beforeBackgroundFrame = nativeNdi.getSharedFrame(0n);
        const beforeSequence = beforeBackgroundFrame ? BigInt(beforeBackgroundFrame.sequence) : 0n;
        mainWindow.showInactive();
        mainWindow.minimize();
        await new Promise((resolve) => setTimeout(resolve, 1600));
        const afterBackgroundFrame = nativeNdi.getSharedFrame(beforeSequence);
        const afterSequence = afterBackgroundFrame ? BigInt(afterBackgroundFrame.sequence) : beforeSequence;
        const backgroundPublishedFrames = Number(afterSequence - beforeSequence);
        const minimizedOutputFps = {
          rgb: outputMetrics.rgb.fps,
          alpha: outputMetrics.alpha.fps
        };
        if (!isPerformanceTest && (backgroundPublishedFrames < 15 || minimizedOutputFps.rgb < 15 || minimizedOutputFps.alpha < 15)) {
          const rendererDiagnostics = await mainWindow.webContents.executeJavaScript(`({
            ready: document.body.dataset.appReady,
            localPublish: document.body.dataset.localPublish,
            signal: document.getElementById("signalState")?.textContent,
            logs: Array.from(document.querySelectorAll("#eventLog li")).slice(0, 5).map((item) => item.textContent)
          })`);
          throw new Error(`Background frame cadence failed: ${backgroundPublishedFrames} frames, ` +
            `RGB ${minimizedOutputFps.rgb} fps, Alpha ${minimizedOutputFps.alpha} fps; ` +
            `source ${JSON.stringify(activeSource)}, renderer ${JSON.stringify(rendererDiagnostics)}.`);
        }
        rendererClockSuspended = true;
        rendererClockReady = false;
        const smokeSavedRate = { outputFrameRate: signalConfig.outputFrameRate, frameRateN: signalConfig.frameRateN, frameRateD: signalConfig.frameRateD };
        signalConfig.outputFrameRate = "60"; signalConfig.frameRateN = 60; signalConfig.frameRateD = 1; configureNativeGpu();
        await new Promise((resolve) => setTimeout(resolve, 100));
        let nativePublishedFrames = 0;
        const nativeTestWidth = Math.min(4096, Math.max(64, Number(process.env.NDI_TEST_WIDTH) || 320));
        const nativeTestHeight = Math.min(2160, Math.max(64, Number(process.env.NDI_TEST_HEIGHT) || 180));
        const nativePublisher = setInterval(() => {
          nativeNdi.publishTestFrame(nativeTestWidth, nativeTestHeight);
          nativePublishedFrames += 1;
        }, 16);
        await new Promise((resolve) => setTimeout(resolve, 1600));
        clearInterval(nativePublisher);
        const nativeCadenceOutputFps = {
          rgb: outputMetrics.rgb.fps,
          alpha: outputMetrics.alpha.fps
        };
        if (!isPerformanceTest && (nativeCadenceOutputFps.rgb < 45 || nativeCadenceOutputFps.alpha < 45)) {
          throw new Error(`Native shared-frame cadence failed: RGB ${nativeCadenceOutputFps.rgb} fps, ` +
            `Alpha ${nativeCadenceOutputFps.alpha} fps.`);
        }
        const repeatStatusBefore = nativeNdi.getGpuPresenterStatus();
        const repeatBefore = BigInt(repeatStatusBefore.submittedFrames || 0);
        await new Promise((resolve) => setTimeout(resolve, 1100));
        const repeatStatusAfter = nativeNdi.getGpuPresenterStatus();
        const repeatAfter = BigInt(repeatStatusAfter.submittedFrames || 0);
        const repeatedOutputFrames = Number(repeatAfter - repeatBefore);
        if (!isPerformanceTest && repeatedOutputFrames < 50) throw new Error(`GPU frame repetition failed: ${repeatedOutputFrames} frames in 1.1s; ` +
          `before=${JSON.stringify(repeatStatusBefore, (_key, value) => typeof value === "bigint" ? value.toString() : value)}, ` +
          `after=${JSON.stringify(repeatStatusAfter, (_key, value) => typeof value === "bigint" ? value.toString() : value)}, ` +
          `engine=${JSON.stringify(engineStatus)}.`);
        Object.assign(signalConfig, smokeSavedRate); configureNativeGpu();
        rendererClockSuspended = false;
        rendererClockReady = true;
        const sharedOutputs = await Promise.all([rgbTestWindow, alphaTestWindow].map(async (win) => {
          const state = await win.webContents.executeJavaScript(`({
            title: document.title,
            width: document.getElementById("outputCanvas")?.width,
            height: document.getElementById("outputCanvas")?.height,
            sharedReader: Boolean(window.ndiOutput)
          })`);
          const capture = await win.webContents.capturePage();
          const bitmap = capture.toBitmap();
          let checksum = 0;
          for (let index = 0; index < bitmap.length; index += 997) checksum = (checksum + bitmap[index]) >>> 0;
          return { ...state, captureSize: capture.getSize(), checksum };
        }));
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.setSize(1166, 900);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const controlPlaneResult = JSON.parse(await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const appInfo = await window.ndiBridge.getAppInfo();
            const locales = await window.ndiBridge.getLocales();
            const engine = await window.ndiBridge.getEngineStatus();
            const signal = await window.ndiBridge.getSignalConfig();
            const first = await window.ndiBridge.activateLocalSource();
            const second = await window.ndiBridge.activateLocalSource();
            const frame = { width: 1, height: 1, frameRateN: 30, frameRateD: 1, hasAlpha: true,
              data: new Uint8Array([255, 0, 0, 128]) };
            const staleAccepted = await window.ndiBridge.publishLocalFrame({ ...frame, generation: first.generation });
            const currentAccepted = await window.ndiBridge.publishLocalFrame({ ...frame, generation: second.generation });
            const broadcast = await window.ndiBridge.setSignalConfig({ outputResolution: "1920x1080", outputFrameRate: "59.94", scanMode: "interlaced-tff",
              sourcePrimaries: "rec2020", sourceRange: "limited", outputPrimaries: "rec709", outputRange: "limited" });
            const crop = await window.ndiBridge.setSignalConfig({ outputResolution: "1920x1080", outputFrameRate: "30", scanMode: "progressive",
              scalingMode: "crop", cropRect: { x: .2, y: .1, width: .6, height: .7 }, sourcePrimaries: "rec709", sourceRange: "full" });
            await window.ndiBridge.setSignalConfig({ outputResolution: "1920x1080", outputFrameRate: "30", scanMode: "progressive", sourcePrimaries: "rec709",
              sourceRange: "full", outputPrimaries: "rec709", outputRange: "limited" });
            const invalidPresets = Object.entries(signal.presets).filter(([, preset]) =>
              !preset.width || !preset.height || !preset.frameRateN || !preset.frameRateD ||
              !["progressive", "interlaced"].includes(preset.scanMode));
            const gpuRuntimeAccepted = await window.ndiBridge.setGpuRuntimeConfig({ alphaGain: 1.25, invertAlpha: true, previewPolicy: "lightweight" });
            await window.ndiBridge.setGpuRuntimeConfig({ alphaGain: 1, invertAlpha: false, previewPolicy: "lightweight" });
            const lowLatency = await window.ndiBridge.setSignalConfig({ ...signal.config, syncMode: "low-latency" });
            const stableSync = await window.ndiBridge.setSignalConfig({ ...signal.config, syncMode: "stable" });
            const logStatus = await window.ndiBridge.getLogStatus();
            const checker = document.getElementById("showCheckerboard");
            checker.checked = false;
            checker.dispatchEvent(new Event("change", { bubbles: true }));
            const checkerOffBackground = getComputedStyle(document.getElementById("sourceCanvas")).backgroundColor;
            checker.checked = true;
            checker.dispatchEvent(new Event("change", { bubbles: true }));
            const checkerOnBackground = getComputedStyle(document.getElementById("sourceCanvas")).backgroundColor;
            const syncControl = document.getElementById("syncMode");
            syncControl.value = "low-latency";
            syncControl.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 50));
            syncControl.value = "stable";
            syncControl.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 50));
            const eventLogText = document.getElementById("eventLog").textContent;
            const panelIndexes = Object.fromEntries(Array.from(document.querySelectorAll("[data-inspector-panel]")).map((panel) => [
              panel.dataset.inspectorPanel, Array.from(panel.querySelectorAll(".section-index")).map((element) => element.textContent.trim())
            ]));
            return JSON.stringify({ appInfo, engine, presetCount: Object.keys(signal.presets).length, invalidPresets,
              staleAccepted, currentAccepted, broadcast, crop, gpuRuntimeAccepted, lowLatency, stableSync, logStatus,
              checkerPreview: { checkerOffBackground, checkerOnBackground }, panelIndexes,
              localeSupport: locales.languages.map((language) => language.id).join(",") === "zh-CN,en-US" &&
                Object.keys(locales.catalogs["zh-CN"]).length === Object.keys(locales.catalogs["en-US"]).length &&
                document.getElementById("languageMode").options.length === 3,
              detailedEventLog: (eventLogText.includes("NDI 同步模式已切换：低延迟") && eventLogText.includes("NDI 同步模式已切换：稳定同步")) ||
                (eventLogText.includes("NDI Sync Mode changed: Low latency") && eventLogText.includes("NDI Sync Mode changed: Stable sync")),
              cropHandleCount: document.querySelectorAll(".crop-handle").length,
              narrowLayout: {
                workspaceColumns: getComputedStyle(document.querySelector(".workspace")).gridTemplateColumns.trim().split(/\\s+/).length,
                horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
              },
              uiUpgrade: ["outputResolution","outputFrameRate","scanMode","scalingMode","refreshUrlBtn","urlInteractionBtn","cropOverlay","cropLockBtn","restoreAutoColorBtn","gpuPreference","previewPolicy","metricGpuAdapter","themeMode","languageMode","inspectorTabInput","inspectorTabSignal","inspectorTabOutput","inspectorTabDiagnostics","inspectorInputPanel","inspectorSignalPanel","inspectorOutputPanel","inspectorDiagnosticsPanel","diagnosticsSection","diagnosticChartMetric","diagnosticChart","openLogsBtn","syncMode","metricClockSource"].every(id => Boolean(document.getElementById(id))) &&
                document.querySelectorAll("[data-diagnostic-metric]").length === 6 &&
                document.querySelectorAll("[data-diagnostic-track]").length === 6,
              cropLockPlacement: Boolean(document.querySelector("#cropSelection #cropLockBtn"))
            }, (_key, value) => typeof value === "bigint" ? value.toString() : value);
          })()
        `));
        if (controlPlaneResult.appInfo.version !== app.getVersion() || controlPlaneResult.staleAccepted ||
            !controlPlaneResult.currentAccepted || controlPlaneResult.presetCount < 10 || !controlPlaneResult.localeSupport ||
            controlPlaneResult.broadcast.scanMode !== "interlaced" || controlPlaneResult.invalidPresets.length ||
            controlPlaneResult.crop.scalingMode !== "crop" || !controlPlaneResult.gpuRuntimeAccepted || !controlPlaneResult.uiUpgrade ||
            controlPlaneResult.cropHandleCount !== 8 || controlPlaneResult.lowLatency.syncMode !== "low-latency" ||
            controlPlaneResult.stableSync.syncMode !== "stable" || !controlPlaneResult.logStatus.available ||
            controlPlaneResult.checkerPreview.checkerOffBackground === controlPlaneResult.checkerPreview.checkerOnBackground ||
            controlPlaneResult.checkerPreview.checkerOnBackground !== "rgba(0, 0, 0, 0)" || !controlPlaneResult.detailedEventLog ||
            JSON.stringify(controlPlaneResult.panelIndexes) !== JSON.stringify({ input: ["01", "01", "02"], signal: ["01", "02"], output: ["01"], diagnostics: ["01"] }) ||
            controlPlaneResult.narrowLayout.workspaceColumns !== 2 || controlPlaneResult.narrowLayout.horizontalOverflow ||
            !controlPlaneResult.cropLockPlacement) {
          throw new Error(`Control-plane validation failed: ${JSON.stringify(controlPlaneResult)}`);
        }
        const gpuSharedTextureProbe = await probeGpuSharedTexture();
        const videoConverterResult = nativeNdi.testVideoConverters();
        if (videoConverterResult.passed !== videoConverterResult.total ||
            (engineStatus.gpuAvailable && (videoConverterResult.gpuPassed !== videoConverterResult.total || !videoConverterResult.gpuP216Queued))) {
          throw new Error(`NDI converter validation failed: ${JSON.stringify(videoConverterResult)}`);
        }
        let privateUrlBlocked = false;
        try {
          await startUrlSource({ url: "127.0.0.1:9/", width: 320, height: 180, fps: 30, allowLan: false });
        } catch (error) {
          privateUrlBlocked = /private network|localhost/.test(error.message);
        }
        if (!privateUrlBlocked) throw new Error("URL private-network policy did not reject localhost.");
        let externalUrlResult = null;
        const externalSmokeUrl = String(process.env.NDI_SMOKE_URL || "").trim();
        if (externalSmokeUrl) {
          const beforeExternal = nativeNdi.getSharedFrame(0n);
          const beforeExternalSequence = beforeExternal ? BigInt(beforeExternal.sequence) : 0n;
          try {
            await mainWindow.webContents.executeJavaScript(`
              (async () => {
                document.getElementById("urlModeBtn").click();
                document.getElementById("urlInput").value = ${JSON.stringify(externalSmokeUrl)};
                document.getElementById("urlTransparent").checked = false;
                document.getElementById("urlAllowLan").checked = false;
                document.getElementById("loadUrlBtn").click();
              })()
            `);
            let externalFrame = null;
            for (let attempt = 0; attempt < 80 && (!externalFrame || urlSourceStatus.state !== "running"); ++attempt) {
              await new Promise((resolve) => setTimeout(resolve, 100));
              externalFrame = nativeNdi.getSharedFrame(beforeExternalSequence);
            }
            if (!externalFrame || urlSourceStatus.state !== "running") {
              throw new Error(`External URL did not reach running state: ${urlSourceStatus.error || urlSourceStatus.state}`);
            }
            urlInteractionEnabled = true;
            let externalInteraction = null;
            if (process.env.NDI_SMOKE_INTERACTION === "1") {
              const target = await urlSourceWindow.webContents.executeJavaScript(`(() => {
                const element = Array.from(document.querySelectorAll('#kw,input[type="search"],input[type="text"],textarea,[contenteditable="true"]'))
                  .find((item) => {
                    const rect = item.getBoundingClientRect();
                    const style = getComputedStyle(item);
                    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
                    return rect.width > 8 && rect.height > 8 && rect.bottom > 0 && rect.right > 0 &&
                      style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0 &&
                      (hit === item || item.contains(hit));
                  });
                if (!element) return null;
                window.__rgbAlphaSmokeTarget = element;
                const rect = element.getBoundingClientRect();
                return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2),
                  tag: element.tagName, expectedCursor: getComputedStyle(element).cursor,
                  beforeValue: String('value' in element ? element.value : element.textContent).slice(0, 100) };
              })()`);
              if (!target) throw new Error("External URL has no visible text input for interaction validation.");
              sendUrlInputEvent({ type: "mouseMove", x: target.x, y: target.y, buttons: 0, modifiers: [] });
              sendUrlInputEvent({ type: "mouseDown", x: target.x, y: target.y, button: "left", modifiers: [] });
              sendUrlInputEvent({ type: "mouseUp", x: target.x, y: target.y, button: "left", modifiers: [] });
              sendUrlInputEvent({ type: "keyDown", key: "x", code: "KeyX", modifiers: [] });
              sendUrlInputEvent({ type: "char", key: "x", code: "KeyX", modifiers: [] });
              sendUrlInputEvent({ type: "keyUp", key: "x", code: "KeyX", modifiers: [] });
              await new Promise((resolve) => setTimeout(resolve, 160));
              const afterValue = await urlSourceWindow.webContents.executeJavaScript(`String(
                'value' in window.__rgbAlphaSmokeTarget ? window.__rgbAlphaSmokeTarget.value : window.__rgbAlphaSmokeTarget.textContent
              ).slice(0, 100)`);
              externalInteraction = { ...target, afterValue, cursor: urlSourceStatus.cursor };
              const expectedCursor = target.expectedCursor === "pointer" ? "pointer" :
                target.expectedCursor === "text" || target.tag === "INPUT" || target.tag === "TEXTAREA" ? "text" : "default";
              if (afterValue === target.beforeValue || urlSourceStatus.cursor !== expectedCursor) {
                throw new Error(`External URL native interaction failed: ${JSON.stringify(externalInteraction)}`);
              }
            }
            let lastExternalSequence = BigInt(externalFrame.sequence);
            let externalSamples = 0;
            let blankExternalFrames = 0;
            const externalChecksums = new Set();
            const externalPreviewProbe = mainWindow.webContents.executeJavaScript(`
              (async () => {
                const canvas = document.getElementById("sourceCanvas");
                const context = canvas.getContext("2d");
                const dimensions = new Set();
                let blankSamples = 0;
                for (let attempt = 0; attempt < 500; ++attempt) {
                  await new Promise((resolve) => setTimeout(resolve, 10));
                  dimensions.add(canvas.width + "x" + canvas.height);
                  const points = [[0, 0], [canvas.width >> 1, canvas.height >> 1],
                    [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]];
                  let visible = false;
                  for (const [x, y] of points) {
                    if (context.getImageData(Math.max(0, x), Math.max(0, y), 1, 1).data[3] !== 0) {
                      visible = true;
                      break;
                    }
                  }
                  if (!visible) blankSamples += 1;
                }
                return { blankSamples, dimensions: Array.from(dimensions) };
              })()
            `);
            for (let attempt = 0; attempt < 500; ++attempt) {
              sendUrlInputEvent({ type: "mouseMove", x: 480 + (attempt % 3), y: 270, buttons: 0, modifiers: [] });
              await new Promise((resolve) => setTimeout(resolve, 10));
              const frame = nativeNdi.getSharedFrame(lastExternalSequence);
              if (!frame || !frame.data) continue;
              lastExternalSequence = BigInt(frame.sequence);
              const bytes = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data);
              const pixelCount = Math.floor(bytes.length / 4);
              const pixelStride = Math.max(1, Math.floor(pixelCount / 4096));
              let checksum = 0;
              let visibleAlpha = false;
              for (let pixel = 0; pixel < pixelCount; pixel += pixelStride) {
                const index = pixel * 4;
                checksum = (checksum + bytes[index] + index) >>> 0;
                visibleAlpha = visibleAlpha || bytes[index + 3] !== 0;
              }
              externalChecksums.add(checksum);
              externalSamples += 1;
              if (!visibleAlpha) blankExternalFrames += 1;
            }
            const previewProbe = await externalPreviewProbe;
            externalUrlResult = {
              url: externalSmokeUrl,
              state: urlSourceStatus.state,
              width: Number(externalFrame.width),
              height: Number(externalFrame.height),
              samples: externalSamples,
              blankFrames: blankExternalFrames,
              previewBlankSamples: previewProbe.blankSamples,
              previewDimensions: previewProbe.dimensions,
              uniqueChecksums: externalChecksums.size,
              interactionForwarded: urlInteractionEnabled,
              nativeInteraction: externalInteraction
            };
            if (blankExternalFrames || previewProbe.blankSamples || previewProbe.dimensions.length !== 1) {
              throw new Error(`External URL preview stability failed: ${JSON.stringify(externalUrlResult)}`);
            }
            if (process.env.NDI_SMOKE_SCREENSHOT_PATH) {
              const screenshot = await mainWindow.webContents.capturePage();
              fs.writeFileSync(process.env.NDI_SMOKE_SCREENSHOT_PATH, screenshot.toPNG());
            }
          } finally {
            stopUrlSource();
          }
        }
        const urlBefore = nativeNdi.getSharedFrame(0n);
        const urlBeforeSequence = urlBefore ? BigInt(urlBefore.sequence) : 0n;
        const smokePage = "data:text/html," + encodeURIComponent(`<!doctype html><style>
          html,body{margin:0;width:100%;height:100%;background:transparent;overflow:hidden}
          .shape{position:absolute;inset:20px;background:rgba(255,40,80,.45);animation:pulse .2s infinite alternate}
          button,a,summary{cursor:pointer} input{cursor:text}
          #wheel-target{position:absolute;left:200px;top:20px;width:100px;height:100px;overflow:auto;background:rgba(40,120,255,.35)}
          #wheel-spacer{height:800px}
          @keyframes pulse{to{transform:translateX(2px)}}
        </style><div class=shape></div><button id="interaction-target" style="position:absolute;left:40px;top:20px;width:120px;height:32px">Click</button>
          <label style="position:absolute;left:40px;top:62px"><input id="checkbox-target" type="checkbox">Check</label>
          <input id="keyboard-target" style="position:absolute;left:40px;top:92px;width:120px;height:24px" value="">
          <select id="select-target" style="position:absolute;left:40px;top:126px;width:120px;height:24px"><option value="one">One</option><option value="two">Two</option></select>
          <details id="details-target" style="position:absolute;left:40px;top:154px"><summary>Details</summary><span>Open</span></details>
          <div id="wheel-target"><div id="wheel-spacer"></div></div><script>
           document.body.dataset.leftClicks = "0";
           document.body.dataset.trustedClicks = "0";
           document.body.dataset.checkboxChanges = "0";
           document.body.dataset.trustedCheckboxChanges = "0";
           document.body.dataset.wheelEvents = "0";
           document.getElementById("interaction-target").addEventListener("click", (event) => {
             document.body.dataset.leftClicks = String(Number(document.body.dataset.leftClicks) + 1);
             if (event.isTrusted) document.body.dataset.trustedClicks = String(Number(document.body.dataset.trustedClicks) + 1);
           });
           document.getElementById("checkbox-target").addEventListener("change", (event) => {
             document.body.dataset.checkboxChanges = String(Number(document.body.dataset.checkboxChanges) + 1);
             if (event.isTrusted) document.body.dataset.trustedCheckboxChanges = String(Number(document.body.dataset.trustedCheckboxChanges) + 1);
           });
           document.getElementById("wheel-target").addEventListener("wheel", () => {
             document.body.dataset.wheelEvents = String(Number(document.body.dataset.wheelEvents) + 1);
           });
         </script>`);
        await startUrlSource({ url: smokePage, width: 320, height: 180, fps: 30, transparentBackground: true });
        let urlFrame = null;
        for (let attempt = 0; attempt < 40 && (!urlFrame || !urlFrame.hasAlpha); ++attempt) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          urlFrame = nativeNdi.getSharedFrame(urlBeforeSequence);
        }
        if (!urlFrame || Number(urlFrame.width) !== 320 || Number(urlFrame.height) !== 180 || !urlFrame.hasAlpha) {
          let minAlpha = 255;
          let maxAlpha = 0;
          if (urlFrame && urlFrame.data) {
            for (let index = 3; index < urlFrame.data.length; index += 4) {
              minAlpha = Math.min(minAlpha, urlFrame.data[index]);
              maxAlpha = Math.max(maxAlpha, urlFrame.data[index]);
            }
          }
          throw new Error(`URL offscreen source did not publish the expected RGBA shared frame: ` +
            `${urlFrame ? `${urlFrame.width}x${urlFrame.height}, alpha ${minAlpha}..${maxAlpha}` : "no frame"}.`);
        }
        const urlModeResult = {
          published: true,
          width: Number(urlFrame.width),
          height: Number(urlFrame.height),
          hasAlpha: Boolean(urlFrame.hasAlpha),
          sequence: String(urlFrame.sequence)
        };
        await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const status = await window.ndiBridge.getUrlStatus();
            document.getElementById("urlModeBtn").click();
            document.getElementById("urlInput").value = status.url;
            document.getElementById("loadUrlBtn").click();
            await new Promise((resolve) => setTimeout(resolve, 120));
          })()
        `);
        const urlInteractionResult = JSON.parse(await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const scaling = document.getElementById("scalingMode");
            scaling.value = "crop";
            scaling.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 80));
            const lock = document.getElementById("cropLockBtn");
            lock.click();
            await new Promise((resolve) => setTimeout(resolve, 40));
            const interaction = document.getElementById("urlInteractionBtn");
            const available = !interaction.disabled && lock.getAttribute("aria-pressed") === "true";
            interaction.click();
            await new Promise((resolve) => setTimeout(resolve, 80));
            return JSON.stringify({ available, accepted: interaction.getAttribute("aria-pressed") === "true", cropLocked: lock.getAttribute("aria-pressed") === "true", lockIcon: lock.classList.contains("is-locked") });
          })()
        `));
        if (!urlInteractionResult.available || !urlInteractionResult.accepted || !urlInteractionResult.cropLocked || !urlInteractionResult.lockIcon) {
          throw new Error(`URL interaction gating failed: ${JSON.stringify(urlInteractionResult)}`);
        }
        sendUrlInputEvent({ type: "mouseMove", x: 80, y: 36, buttons: 0, modifiers: [] });
        await new Promise((resolve) => setTimeout(resolve, 80));
        urlInteractionResult.pointerCursor = urlSourceStatus.cursor;
        urlInteractionResult.previewPointerCursor = await mainWindow.webContents.executeJavaScript(
          "getComputedStyle(document.getElementById('sourceCanvas')).cursor"
        );
        sendUrlInputEvent({ type: "mouseDown", x: 80, y: 36, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseUp", x: 80, y: 36, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseDown", x: 48, y: 72, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseUp", x: 48, y: 72, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseMove", x: 80, y: 104, buttons: 0, modifiers: [] });
        await new Promise((resolve) => setTimeout(resolve, 80));
        urlInteractionResult.textCursor = urlSourceStatus.cursor;
        urlInteractionResult.previewTextCursor = await mainWindow.webContents.executeJavaScript(
          "getComputedStyle(document.getElementById('sourceCanvas')).cursor"
        );
        sendUrlInputEvent({ type: "mouseDown", x: 80, y: 104, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseUp", x: 80, y: 104, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "keyDown", key: "a", code: "KeyA", modifiers: [] });
        sendUrlInputEvent({ type: "char", key: "a", code: "KeyA", modifiers: [] });
        sendUrlInputEvent({ type: "keyUp", key: "a", code: "KeyA", modifiers: [] });
        sendUrlInputEvent({ type: "keyDown", key: "a", code: "KeyA", modifiers: ["control"] });
        sendUrlInputEvent({ type: "keyUp", key: "a", code: "KeyA", modifiers: ["control"] });
        sendUrlInputEvent({ type: "keyDown", key: "c", code: "KeyC", modifiers: ["control"] });
        sendUrlInputEvent({ type: "keyUp", key: "c", code: "KeyC", modifiers: ["control"] });
        sendUrlInputEvent({ type: "keyDown", key: "ArrowRight", code: "ArrowRight", modifiers: [] });
        sendUrlInputEvent({ type: "keyUp", key: "ArrowRight", code: "ArrowRight", modifiers: [] });
        sendUrlInputEvent({ type: "keyDown", key: "b", code: "KeyB", modifiers: [] });
        sendUrlInputEvent({ type: "char", key: "b", code: "KeyB", modifiers: [] });
        sendUrlInputEvent({ type: "keyUp", key: "b", code: "KeyB", modifiers: [] });
        sendUrlInputEvent({ type: "keyDown", key: "v", code: "KeyV", modifiers: ["control"] });
        sendUrlInputEvent({ type: "keyUp", key: "v", code: "KeyV", modifiers: ["control"] });
        sendUrlInputEvent({ type: "mouseDown", x: 80, y: 166, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseUp", x: 80, y: 166, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseDown", x: 80, y: 138, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "mouseUp", x: 80, y: 138, button: "left", modifiers: [] });
        sendUrlInputEvent({ type: "keyDown", key: "ArrowDown", code: "ArrowDown", modifiers: [] });
        sendUrlInputEvent({ type: "keyUp", key: "ArrowDown", code: "ArrowDown", modifiers: [] });
        sendUrlInputEvent({ type: "keyDown", key: "Enter", code: "Enter", modifiers: [] });
        sendUrlInputEvent({ type: "keyUp", key: "Enter", code: "Enter", modifiers: [] });
        const wheelForwarded = sendUrlInputEvent({ type: "mouseWheel", x: 240, y: 60, deltaX: 0, deltaY: 120, deltaZ: 0, deltaMode: 0, modifiers: [] });
        const rightMoveForwarded = sendUrlInputEvent({ type: "mouseMove", x: 80, y: 60, buttons: 2, modifiers: [] });
        const rightInputForwarded = sendUrlInputEvent({ type: "mouseDown", x: 80, y: 60, button: "right", modifiers: [] });
        await new Promise((resolve) => setTimeout(resolve, 240));
        const componentState = await urlSourceWindow.webContents.executeJavaScript(`({
          leftClickCount: Number(document.body.dataset.leftClicks || 0),
          trustedClickCount: Number(document.body.dataset.trustedClicks || 0),
          checkboxChecked: document.getElementById("checkbox-target").checked,
          checkboxChanges: Number(document.body.dataset.checkboxChanges || 0),
          trustedCheckboxChanges: Number(document.body.dataset.trustedCheckboxChanges || 0),
          keyboardValue: document.getElementById("keyboard-target").value,
          detailsOpen: document.getElementById("details-target").open,
          selectValue: document.getElementById("select-target").value
        })`);
        const wheelState = await urlSourceWindow.webContents.executeJavaScript("({ events: Number(document.body.dataset.wheelEvents || 0), scrollTop: document.getElementById('wheel-target').scrollTop })");
        await mainWindow.webContents.executeJavaScript("document.getElementById('urlInteractionBtn').click()");
        Object.assign(urlInteractionResult, componentState);
        urlInteractionResult.wheelForwarded = wheelForwarded;
        urlInteractionResult.wheelEvents = wheelState.events;
        urlInteractionResult.wheelScrollTop = wheelState.scrollTop;
        urlInteractionResult.rightMoveForwarded = rightMoveForwarded;
        urlInteractionResult.rightInputForwarded = rightInputForwarded;
        if (componentState.leftClickCount < 1 || componentState.trustedClickCount < 1 || !componentState.checkboxChecked ||
            componentState.checkboxChanges < 1 || componentState.trustedCheckboxChanges < 1 || componentState.keyboardValue !== "aba" ||
            !componentState.detailsOpen || componentState.selectValue !== "two" || urlInteractionResult.pointerCursor !== "pointer" ||
            urlInteractionResult.previewPointerCursor !== "pointer" || urlInteractionResult.textCursor !== "text" ||
            urlInteractionResult.previewTextCursor !== "text" || !wheelForwarded || wheelState.events < 1 || wheelState.scrollTop <= 0 ||
            rightMoveForwarded || rightInputForwarded) {
          throw new Error(`URL input relay failed: ${JSON.stringify(urlInteractionResult)}`);
        }
        const urlNonCropResult = JSON.parse(await mainWindow.webContents.executeJavaScript(`
          (async () => {
            const scaling = document.getElementById("scalingMode");
            const interaction = document.getElementById("urlInteractionBtn");
            scaling.value = "fit";
            scaling.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 80));
            const available = !interaction.disabled;
            interaction.click();
            await new Promise((resolve) => setTimeout(resolve, 80));
            const accepted = interaction.getAttribute("aria-pressed") === "true";
            interaction.click();
            return JSON.stringify({ available, accepted });
          })()
        `));
        if (!urlNonCropResult.available || !urlNonCropResult.accepted) {
          throw new Error(`URL non-crop interaction gating failed: ${JSON.stringify(urlNonCropResult)}`);
        }
        const urlTransparentResult = {};
        await mainWindow.webContents.executeJavaScript(`
          (() => {
            const transparent = document.getElementById("urlTransparent");
            transparent.checked = false;
            transparent.dispatchEvent(new Event("change", { bubbles: true }));
          })()
        `);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const offStatus = await mainWindow.webContents.executeJavaScript("window.ndiBridge.getUrlStatus()");
        urlTransparentResult.off = offStatus.transparentBackground === false;
        urlTransparentResult.offBackground = await urlSourceWindow.webContents.executeJavaScript("getComputedStyle(document.body).backgroundColor");
        await mainWindow.webContents.executeJavaScript(`
          (() => {
            const transparent = document.getElementById("urlTransparent");
            transparent.checked = true;
            transparent.dispatchEvent(new Event("change", { bubbles: true }));
          })()
        `);
        await new Promise((resolve) => setTimeout(resolve, 80));
        const onStatus = await mainWindow.webContents.executeJavaScript("window.ndiBridge.getUrlStatus()");
        urlTransparentResult.on = onStatus.transparentBackground === true;
        urlTransparentResult.onBackground = await urlSourceWindow.webContents.executeJavaScript("getComputedStyle(document.body).backgroundColor");
        if (!urlTransparentResult.off || !urlTransparentResult.on || urlTransparentResult.offBackground === urlTransparentResult.onBackground) {
          throw new Error(`URL transparent-background toggle failed: ${JSON.stringify(urlTransparentResult)}`);
        }
        const refreshBeforeSequence = BigInt(urlFrame.sequence);
        const urlRefreshRequested = await mainWindow.webContents.executeJavaScript(`window.ndiBridge.refreshUrl()`);
        let refreshedFrame = null;
        for (let attempt = 0; attempt < 40 && !refreshedFrame; ++attempt) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          refreshedFrame = nativeNdi.getSharedFrame(refreshBeforeSequence);
        }
        if (!urlRefreshRequested || !refreshedFrame) throw new Error("URL manual refresh did not produce a new frame.");
        const gpuUrlPresenterStatus = nativeNdi.getGpuPresenterStatus();
        stopUrlSource();
        let soakResult = null;
        if (isSoakTest) {
          const durationMs = Math.max(10000, Number(process.env.NDI_SOAK_DURATION_MS) || 30 * 60 * 1000);
          const soakWidth = Math.min(4096, Math.max(64, Number(process.env.NDI_TEST_WIDTH) || 1920));
          const soakHeight = Math.min(2160, Math.max(64, Number(process.env.NDI_TEST_HEIGHT) || 1080));
          signalConfig.outputFrameRate = "60"; signalConfig.frameRateN = 60; signalConfig.frameRateD = 1; configureNativeGpu();
          let published = 0;
          let minimumRgbFps = Number.POSITIVE_INFINITY;
          let minimumAlphaFps = Number.POSITIVE_INFINITY;
          const workingSetKb = () => app.getAppMetrics().reduce((sum, metric) =>
            sum + Number(metric.memory && metric.memory.workingSetSize || 0), 0);
          const initialWorkingSetKb = workingSetKb();
          let peakWorkingSetKb = initialWorkingSetKb;
          const presenterBeforeSoak = nativeNdi.getGpuPresenterStatus();
          const publisher = setInterval(() => {
            nativeNdi.publishTestFrame(soakWidth, soakHeight);
            published += 1;
          }, 16);
          const startedAt = Date.now();
          while (Date.now() - startedAt < durationMs) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            if (Date.now() - startedAt > 2000) {
              minimumRgbFps = Math.min(minimumRgbFps, outputMetrics.rgb.fps);
              minimumAlphaFps = Math.min(minimumAlphaFps, outputMetrics.alpha.fps);
            }
            peakWorkingSetKb = Math.max(peakWorkingSetKb, workingSetKb());
          }
          clearInterval(publisher);
          const presenterAfterSoak = nativeNdi.getGpuPresenterStatus();
          const presentedFrames = Number(BigInt(presenterAfterSoak.submittedFrames || 0) -
            BigInt(presenterBeforeSoak.submittedFrames || 0));
          const averageOutputFps = presentedFrames * 1000 / durationMs;
          soakResult = { durationMs, resolution: `${soakWidth}x${soakHeight}`, published,
            minimumRgbFps, minimumAlphaFps, averageOutputFps, initialWorkingSetKb,
            peakWorkingSetKb, finalWorkingSetKb: workingSetKb(), presenter: presenterAfterSoak };
          if (averageOutputFps < 59.4 || minimumRgbFps < 50 || minimumAlphaFps < 50 ||
              Number(presenterAfterSoak.consecutiveFailures || 0) > 0) {
            throw new Error(`Soak output cadence failed: ${JSON.stringify(soakResult)}`);
          }
        }
        const rendererResult = await mainWindow.webContents.executeJavaScript(`
          Promise.all([
            window.ndiBridge.getReceiverStatus(),
            window.ndiBridge.listDisplays()
          ]).then(([receiver, displays]) => JSON.stringify({
            receiver,
            displays,
            signalState: document.getElementById("signalState")?.textContent,
            canvasCount: document.querySelectorAll("canvas").length,
            webglReady: Boolean(document.getElementById("rgbCanvas")?.getContext("webgl"))
          }, (_key, value) => typeof value === "bigint" ? value.toString() : value))
        `);
        const result = {
          ...JSON.parse(rendererResult),
          localFramePublished,
          allFullscreenCreated: true,
          defaultMenuHidden: Menu.getApplicationMenu() === null && !mainWindow.isMenuBarVisible(),
          mainWindowMinimized: mainWindow.isMinimized(),
          backgroundPublishedFrames,
          minimizedOutputFps,
          nativePublishedFrames,
          nativeTestResolution: `${nativeTestWidth}x${nativeTestHeight}`,
          nativeCadenceOutputFps,
          repeatedOutputFrames,
          sharedOutputs,
          controlPlaneResult,
          privateUrlBlocked,
          gpuSharedTextureProbe,
          videoConverterResult,
          externalUrlResult,
          soakResult,
          urlModeResult,
          urlInteractionResult,
          urlNonCropResult,
          urlTransparentResult
          ,urlRefreshRequested
          ,gpuUrlPresenterStatus
        };
        const serializedResult = JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value);
        console.log(`SMOKE_RESULT ${serializedResult}`);
        if (process.env.NDI_SMOKE_RESULT_PATH) {
          fs.writeFileSync(process.env.NDI_SMOKE_RESULT_PATH, JSON.stringify(result, (_key, value) => typeof value === "bigint" ? value.toString() : value, 2), "utf8");
        }
      } catch (error) {
        console.error("SMOKE_FAILED", error);
        if (process.env.NDI_SMOKE_RESULT_PATH) {
          fs.writeFileSync(process.env.NDI_SMOKE_RESULT_PATH, JSON.stringify({
            error: error && error.stack ? error.stack : String(error)
          }, null, 2), "utf8");
        }
        process.exitCode = 1;
      } finally {
        try {
          await mainWindow.webContents.executeJavaScript(`
            Array.from(document.querySelectorAll("canvas")).forEach((canvas) => {
              const gl = canvas.getContext("webgl");
              const extension = gl && gl.getExtension("WEBGL_lose_context");
              if (extension) extension.loseContext();
            })
          `);
        } catch (_) {
          // The smoke result is already captured; cleanup is best-effort.
        }
        for (const kind of ["rgb", "alpha"]) {
          const outputWindow = outputWindows[kind];
          if (nativeNdi && typeof nativeNdi.detachGpuOutput === "function") nativeNdi.detachGpuOutput(kind);
          if (outputWindow && !outputWindow.isDestroyed()) outputWindow.destroy();
        }
        if (nativeNdi && typeof nativeNdi.shutdownGpuPresenter === "function") nativeNdi.shutdownGpuPresenter();
        mainWindow.destroy();
        setTimeout(() => app.quit(), 100);
      }
    });
  }
}

function placeOutputWindow(outputWindow, displayId, fullscreen) {
  const display = screen.getAllDisplays().find((item) => String(item.id) === String(displayId)) ||
    screen.getPrimaryDisplay();
  if (outputWindow.isDestroyed()) return false;
  outputWindow.setFullScreen(false);
  outputWindow.setBounds(display.bounds);
  if (fullscreen) outputWindow.setFullScreen(true);
  outputWindow.show();
  return true;
}

function createOutputWindow(kind, displayId, fullscreen, visible = true) {
  const existing = outputWindows[kind];
  if (existing && !existing.isDestroyed()) {
    if (visible) {
      placeOutputWindow(existing, displayId, fullscreen);
      existing.focus();
    }
    return existing;
  }

  const title = kind === "rgb" ? "RGB Output" : "Alpha Output";
  const gpuOutput = engineStatus.gpuAvailable;
  const outputWindow = new BrowserWindow({
    title,
    width: 1280,
    height: 720,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    paintWhenInitiallyHidden: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, gpuOutput ? "gpu-output-preload.js" : "output-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: gpuOutput,
      backgroundThrottling: false,
      devTools: !app.isPackaged
    }
  });
  outputWindow.setMenuBarVisibility(false);
  outputWindow.webContents.on("before-input-event", (event, input) => {
    if (!app.isPackaged) return;
    const devToolsShortcut = input.key === "F12" ||
      ((input.control || input.meta) && input.shift && input.key.toLowerCase() === "i");
    if (devToolsShortcut) event.preventDefault();
  });
  outputWindows[kind] = outputWindow;
  if (engineStatus.gpuAvailable && nativeNdi && typeof nativeNdi.attachGpuOutput === "function") {
    const attached = nativeNdi.attachGpuOutput(kind, outputWindow.getNativeWindowHandle());
    if (!attached.success) {
      engineStatus = { ...engineStatus, backend: "compatibility", gpuAvailable: false, reason: attached.reason };
      setTimeout(() => {
        for (const outputKind of ["rgb", "alpha"]) recreateCompatibilityOutput(outputKind);
      }, 0);
    } else {
      configureNativeGpu();
    }
  }
  outputWindow.on("resize", () => {
    if (nativeNdi && typeof nativeNdi.resizeGpuOutput === "function") nativeNdi.resizeGpuOutput(kind);
  });
  outputWindow.on("enter-full-screen", () => {
    if (nativeNdi && typeof nativeNdi.resizeGpuOutput === "function") setTimeout(() => nativeNdi.resizeGpuOutput(kind), 50);
  });
  outputWindow.on("leave-full-screen", () => {
    if (nativeNdi && typeof nativeNdi.resizeGpuOutput === "function") setTimeout(() => nativeNdi.resizeGpuOutput(kind), 50);
  });
  const outputPageUrl = pathToFileURL(path.join(__dirname, "output.html")).href;
  outputWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  outputWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const normalized = targetUrl.split("?")[0];
    if (normalized !== outputPageUrl) event.preventDefault();
  });
  outputWindow.on("close", () => {
    if (nativeNdi && typeof nativeNdi.detachGpuOutput === "function") nativeNdi.detachGpuOutput(kind);
  });
  outputWindow.on("closed", () => {
    if (outputWindows[kind] === outputWindow) outputWindows[kind] = null;
  });
  outputWindow.loadFile("output.html", { query: { kind, backend: engineStatus.gpuAvailable ? "gpu" : "compatibility" } });
  outputWindow.webContents.once("did-finish-load", () => {
    if (visible) placeOutputWindow(outputWindow, displayId, fullscreen);
  });
  return outputWindow;
}

function recreateCompatibilityOutput(kind) {
  const current = outputWindows[kind];
  if (!current || current.isDestroyed()) return;
  const bounds = current.getBounds();
  const fullscreen = current.isFullScreen();
  const visible = current.isVisible();
  const display = screen.getDisplayMatching(bounds);
  outputWindows[kind] = null;
  current.destroy();
  createOutputWindow(kind, String(display.id), fullscreen, visible);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  powerSaveBlockerId = powerSaveBlocker.start("prevent-app-suspension");
  try {
    os.setPriority(0, os.constants.priority.PRIORITY_ABOVE_NORMAL);
  } catch (error) {
    console.warn("Unable to raise the process priority:", error.message);
  }
  loadNativeNdi();
  logger.write("info", "engine", "native_loaded", { available: Boolean(nativeNdi), backend: engineStatus.backend, reason: engineStatus.reason });
  createWindow();
  for (const eventName of ["display-added", "display-removed", "display-metrics-changed"]) {
    screen.on(eventName, (_event, display) => logger.write("info", "display", eventName.replaceAll("-", "_"), {
      id: display && display.id, width: display && display.bounds && display.bounds.width,
      height: display && display.bounds && display.bounds.height
    }));
  }
  rendererClock = setInterval(() => {
    refreshGpuMetrics();
    if (!mainWindow || mainWindow.isDestroyed() || rendererClockSuspended) return;
    const now = Date.now();
    if (!rendererClockReady && now - rendererClockLastSent < 50) return;
    rendererClockReady = false;
    rendererClockLastSent = now;
    try {
      mainWindow.webContents.send("clock:tick");
    } catch (error) {
      rendererClockReady = true;
      logger.write("warn", "renderer", "clock_send_failed", { message: error.message });
    }
  }, 1000 / 60);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("child-process-gone", (_event, details) => {
  logger.write("error", "process", "child_gone", {
    type: details.type, reason: details.reason, exitCode: details.exitCode, name: details.name
  });
});

app.on("second-instance", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

app.on("before-quit", () => {
  logger.write("info", "lifecycle", "shutdown");
  for (const kind of ["rgb", "alpha"]) {
    if (nativeNdi && typeof nativeNdi.detachGpuOutput === "function") nativeNdi.detachGpuOutput(kind);
  }
  if (nativeNdi && typeof nativeNdi.shutdownGpuPresenter === "function") nativeNdi.shutdownGpuPresenter();
});

app.on("window-all-closed", () => {
  if (rendererClock) {
    clearInterval(rendererClock);
    rendererClock = null;
  }
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
  }
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("ndi:getStatus", () => {
  const runtimePath = findNdiRuntime();
  return {
    available: Boolean(nativeNdi),
    runtime: runtimePath ? "NDI Runtime installed" : "NDI Runtime missing",
    reason: nativeNdi ? null : "未加载 native/ndi-node.node，NDI 接收模块尚未编译接入。",
    sdk: runtimePath ? path.basename(path.dirname(runtimePath)) : null
  };
});

ipcMain.on("clock:ack", (event) => {
  if (!rendererClockSuspended && mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents) {
    rendererClockReady = true;
  }
});

ipcMain.handle("ndi:findSources", async () => {
  if (!nativeNdi) return [];
  return nativeNdi.findSources();
});

ipcMain.handle("ndi:connect", async (event, sourceId) => {
  if (!isTrustedSender(event)) throw new Error("Unauthorized IPC sender.");
  if (!nativeNdi) throw new Error("NDI native bridge is not available.");
  stopUrlSource();
  const source = activateSource("ndi");
  const connected = nativeNdi.connect(sourceId);
  logger.write(connected && connected.id ? "info" : "error", "ndi", connected && connected.id ? "connected" : "connect_failed", { sourceId });
  return { ...connected, generation: source.generation };
});

ipcMain.handle("ndi:disconnect", async () => {
  if (!nativeNdi) return true;
  logger.write("info", "ndi", "disconnected");
  return nativeNdi.disconnect();
});

ipcMain.handle("ndi:getFrame", (_event, afterSequence) => {
  if (!nativeNdi) return null;
  const frame = nativeNdi.getFrame(BigInt(afterSequence || 0));
  return frame ? { ...frame, ...signalConfig, sourceType: activeSource.type, generation: activeSource.generation,
    detectedSignal: activeSource.type === "url" && urlSourceStatus.detectedSignal ? urlSourceStatus.detectedSignal : frame.detectedSignal,
    backend: engineStatus.backend } : null;
});

function publishLocalFrameFromRenderer(event, frame) {
  if (!isTrustedSender(event)) return false;
  if (!nativeNdi || !frame || !frame.data) return false;
  if (frame.generation !== undefined && Number(frame.generation) !== activeSource.generation &&
      !(isSmokeTest && Number(frame.generation) === 0)) return false;
  if (activeSource.type !== "local" && !isSmokeTest) return false;
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 2160) return false;
  const bytes = frame.data instanceof Uint8Array
    ? Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
    : Buffer.from(frame.data);
  return nativeNdi.publishFrame(
    bytes,
    width,
    height,
    Boolean(frame.hasAlpha),
    Number(frame.frameRateN || 30),
    Number(frame.frameRateD || 1)
  );
}

ipcMain.handle("frame:publishLocal", (event, frame) => publishLocalFrameFromRenderer(event, frame));
ipcMain.on("frame:publishLocalFast", (event, frame) => {
  publishLocalFrameFromRenderer(event, frame);
});

ipcMain.handle("url:start", async (event, options) => {
  if (!isTrustedSender(event)) throw new Error("Unauthorized IPC sender.");
  return startUrlSource(options);
});
ipcMain.handle("url:stop", (event) => {
  if (!isTrustedSender(event)) return false;
  stopUrlSource();
  if (activeSource.type === "url") activateSource("test");
  return true;
});
ipcMain.handle("url:getStatus", () => urlSourceStatus);
ipcMain.handle("url:refresh", (event) => {
  if (!isTrustedSender(event) || !urlSourceWindow || urlSourceWindow.isDestroyed()) return false;
  urlSourceStatus.lastFrameAt = Date.now();
  sendUrlStatus({ state: "loading", frozenMs: 0, actualFps: 0 });
  urlSourceWindow.webContents.reloadIgnoringCache();
  return true;
});
ipcMain.handle("url:setViewport", (event, viewport) => {
  if (!isTrustedSender(event) || !urlSourceWindow || urlSourceWindow.isDestroyed()) return false;
  const width = Math.min(4096, Math.max(64, Number(viewport && viewport.width) || urlSourceStatus.width || 1920));
  const height = Math.min(2160, Math.max(64, Number(viewport && viewport.height) || urlSourceStatus.height || 1080));
  urlSourceWindow.setContentSize(width, height);
  sendUrlStatus({ width, height, viewportMode: viewport && viewport.mode || "custom" });
  urlSourceWindow.webContents.invalidate();
  return true;
});
ipcMain.handle("url:setInteraction", (event, enabled) => {
  if (!isTrustedSender(event) || !urlSourceWindow || urlSourceWindow.isDestroyed()) return false;
  const requested = Boolean(enabled);
  urlInteractionEnabled = requested && ensureUrlInputDebugger(urlSourceWindow);
  if (!urlInteractionEnabled && urlSourceWindow.webContents.debugger.isAttached()) {
    try { urlSourceWindow.webContents.debugger.detach(); } catch (_) {}
  }
  sendUrlStatus({ interactive: urlInteractionEnabled, cursor: "default" });
  logger.write("info", "url", "interaction", { enabled: urlInteractionEnabled });
  return urlInteractionEnabled;
});
ipcMain.handle("url:setTransparent", async (event, enabled) => {
  if (!isTrustedSender(event)) return false;
  return applyUrlTransparentBackground(enabled);
});
ipcMain.on("url:input", (event, input) => {
  if (!isTrustedSender(event)) return;
  sendUrlInputEvent(input);
});
ipcMain.handle("source:activateLocal", (event) => {
  if (!isTrustedSender(event)) throw new Error("Unauthorized IPC sender.");
  stopUrlSource();
  if (nativeNdi) nativeNdi.disconnect();
  return activateSource("local");
});
ipcMain.handle("app:getInfo", () => ({ version: app.getVersion(), platform: process.platform }));
ipcMain.handle("i18n:getCatalogs", (event) => {
  if (!isTrustedSender(event)) throw new Error("Unauthorized IPC sender.");
  try {
    return getLocaleBundle();
  } catch (error) {
    logger.write("error", "i18n", "catalog_load_failed", { message: error.message });
    throw error;
  }
});
ipcMain.handle("log:getStatus", (event) => {
  if (!isTrustedSender(event)) throw new Error("Unauthorized IPC sender.");
  return logger.getStatus();
});
ipcMain.handle("log:openDirectory", async (event) => {
  if (!isTrustedSender(event)) return false;
  return (await shell.openPath(logger.getStatus().directory)) === "";
});
ipcMain.handle("log:write", (event, entry) => {
  if (!isTrustedSender(event) || !entry || typeof entry !== "object") return false;
  return logger.write(entry.level, entry.category, entry.event, entry.fields);
});
ipcMain.handle("engine:getStatus", () => ({ ...engineStatus, activeSource, signalConfig,
  presenter: nativeNdi && typeof nativeNdi.getGpuPresenterStatus === "function" ? nativeNdi.getGpuPresenterStatus() : null }));
ipcMain.handle("signal:getConfig", () => ({ config: signalConfig, presets: SIGNAL_PRESETS,
  resolutions: OUTPUT_RESOLUTIONS, frameRates: OUTPUT_FRAME_RATES,
  adapters: nativeNdi && typeof nativeNdi.getGpuAdapters === "function" ? nativeNdi.getGpuAdapters() : [] }));
ipcMain.handle("signal:setConfig", (event, nextConfig) => {
  if (!isTrustedSender(event) || !nextConfig) throw new Error("Invalid signal configuration request.");
  const resolutionKey = OUTPUT_RESOLUTIONS[nextConfig.outputResolution] ? nextConfig.outputResolution : signalConfig.outputResolution;
  const resolutionTemplate = OUTPUT_RESOLUTIONS[resolutionKey];
  const resolution = resolutionKey === "custom" ? {
    width: Math.min(4096, Math.max(64, Number(nextConfig.customOutputWidth) || signalConfig.outputWidth)),
    height: Math.min(2160, Math.max(64, Number(nextConfig.customOutputHeight) || signalConfig.outputHeight))
  } : resolutionTemplate;
  const rateKey = OUTPUT_FRAME_RATES[nextConfig.outputFrameRate] ? nextConfig.outputFrameRate : signalConfig.outputFrameRate;
  const rate = OUTPUT_FRAME_RATES[rateKey];
  const allowedScanModes = resolution.height === 1080 ? new Set(["progressive", "interlaced-tff", "interlaced-bff"]) : new Set(["progressive"]);
  const scanSelection = allowedScanModes.has(nextConfig.scanMode) ? nextConfig.scanMode : "progressive";
  const allowedScalingModes = new Set(["fit", "fill", "stretch", "crop"]);
  const rawCrop = nextConfig.cropRect || signalConfig.cropRect;
  const cropRect = {
    x: Math.min(1, Math.max(0, Number(rawCrop.x) || 0)),
    y: Math.min(1, Math.max(0, Number(rawCrop.y) || 0)),
    width: Math.min(1, Math.max(0.001, Number(rawCrop.width) || 1)),
    height: Math.min(1, Math.max(0.001, Number(rawCrop.height) || 1))
  };
  cropRect.width = Math.min(cropRect.width, 1 - cropRect.x);
  cropRect.height = Math.min(cropRect.height, 1 - cropRect.y);
  const allowedPrimaries = new Set(["rec709", "rec2020"]);
  const allowedRanges = new Set(["full", "limited"]);
  const allowedGpuPreferences = new Set(["high-performance", "system", "specific"]);
  const allowedPreviewPolicies = new Set(["full", "lightweight", "paused"]);
  const allowedSyncModes = new Set(["stable", "low-latency"]);
  const previousAdapter = `${signalConfig.gpuPreference}:${signalConfig.gpuAdapterLuid}`;
  signalConfig = {
    ...signalConfig,
    sourcePrimaries: allowedPrimaries.has(nextConfig.sourcePrimaries) ? nextConfig.sourcePrimaries : signalConfig.sourcePrimaries,
    sourceRange: allowedRanges.has(nextConfig.sourceRange) ? nextConfig.sourceRange : signalConfig.sourceRange,
    outputPrimaries: allowedPrimaries.has(nextConfig.outputPrimaries) ? nextConfig.outputPrimaries : signalConfig.outputPrimaries,
    outputRange: allowedRanges.has(nextConfig.outputRange) ? nextConfig.outputRange : signalConfig.outputRange,
    transfer: "gamma24",
    outputResolution: resolutionKey,
    outputWidth: resolution.width,
    outputHeight: resolution.height,
    outputFrameRate: rateKey,
    frameRateN: rate.frameRateN,
    frameRateD: rate.frameRateD,
    scanMode: scanSelection === "progressive" ? "progressive" : "interlaced",
    fieldOrder: scanSelection === "interlaced-bff" ? "bff" : scanSelection === "interlaced-tff" ? "tff" : "none",
    scanSelection,
    scalingMode: allowedScalingModes.has(nextConfig.scalingMode) ? nextConfig.scalingMode : signalConfig.scalingMode,
    cropRect,
    gpuPreference: allowedGpuPreferences.has(nextConfig.gpuPreference) ? nextConfig.gpuPreference : signalConfig.gpuPreference,
    gpuAdapterLuid: typeof nextConfig.gpuAdapterLuid === "string" ? nextConfig.gpuAdapterLuid.slice(0, 32) : signalConfig.gpuAdapterLuid,
    previewPolicy: allowedPreviewPolicies.has(nextConfig.previewPolicy) ? nextConfig.previewPolicy : signalConfig.previewPolicy,
    syncMode: allowedSyncModes.has(nextConfig.syncMode) ? nextConfig.syncMode : signalConfig.syncMode,
    autoColor: nextConfig.autoColor !== false,
    manualColorLocked: Boolean(nextConfig.manualColorLocked),
    formatPreset: `${resolution.height}${scanSelection === "progressive" ? "p" : "i"}${rateKey}`
  };
  const nextAdapter = `${signalConfig.gpuPreference}:${signalConfig.gpuAdapterLuid}`;
  if (previousAdapter !== nextAdapter && engineStatus.gpuAvailable && nativeNdi &&
      typeof nativeNdi.setGpuAdapterPreference === "function") {
    nativeNdi.setGpuAdapterPreference({ preference: signalConfig.gpuPreference, luid: signalConfig.gpuAdapterLuid });
    recoverNativeGpu("GPU adapter switch");
  } else {
    configureNativeGpu();
  }
  for (const kind of ["rgb", "alpha"]) {
    const win = outputWindows[kind];
    if (win && !win.isDestroyed()) win.webContents.send("signal:config", signalConfig);
  }
  return signalConfig;
});

ipcMain.handle("gpu:setRuntimeConfig", (event, runtimeConfig) => {
  if (!isTrustedSender(event) || !runtimeConfig) return false;
  signalConfig.alphaGain = Math.min(3, Math.max(0, Number(runtimeConfig.alphaGain) || 0));
  signalConfig.invertAlpha = runtimeConfig.invertAlpha === true;
  if (["full", "lightweight", "paused"].includes(runtimeConfig.previewPolicy)) {
    signalConfig.previewPolicy = runtimeConfig.previewPolicy;
  }
  configureNativeGpu();
  return true;
});

ipcMain.handle("ndi:getReceiverStatus", () => {
  if (!nativeNdi) {
    return {
      connected: false,
      connections: 0,
      receivedVideoFrames: 0,
      droppedVideoFrames: 0,
      queuedVideoFrames: 0,
      lastFrameAgeMs: -1
    };
  }
  return nativeNdi.getStatus();
});

ipcMain.handle("display:list", () => screen.getAllDisplays().map((display, index) => ({
  id: String(display.id),
  name: display.label || "",
  ordinal: index + 1,
  primary: display.id === screen.getPrimaryDisplay().id,
  bounds: display.bounds
})));

ipcMain.handle("output:configure", (_event, options) => {
  const title = options && options.title;
  const displayId = options && String(options.displayId || "");
  const outputWindow = BrowserWindow.getAllWindows().find((win) =>
    win !== mainWindow && !win.isDestroyed() && win.getTitle() === title
  );
  if (!outputWindow) return false;
  return placeOutputWindow(outputWindow, displayId, Boolean(options.fullscreen));
});

ipcMain.handle("output:open", (_event, options) => {
  const kind = options && options.kind;
  if (kind !== "rgb" && kind !== "alpha") return false;
  createOutputWindow(kind, options.displayId, Boolean(options.fullscreen), !isSmokeTest);
  return true;
});

ipcMain.handle("output:close", (_event, kind) => {
  const outputWindow = outputWindows[kind];
  if (!outputWindow || outputWindow.isDestroyed()) return true;
  outputWindow.close();
  return true;
});

ipcMain.handle("output:getStatus", () => ({
  rgb: Boolean(outputWindows.rgb && !outputWindows.rgb.isDestroyed()),
  alpha: Boolean(outputWindows.alpha && !outputWindows.alpha.isDestroyed()),
  rgbFps: Date.now() - outputMetrics.rgb.updatedAt < 2500 ? outputMetrics.rgb.fps : 0,
  alphaFps: Date.now() - outputMetrics.alpha.updatedAt < 2500 ? outputMetrics.alpha.fps : 0,
  presenter: nativeNdi && typeof nativeNdi.getGpuPresenterStatus === "function" ? nativeNdi.getGpuPresenterStatus() : null
}));

ipcMain.on("output:metrics", (event, metrics) => {
  const kind = metrics && metrics.kind;
  const outputWindow = outputWindows[kind];
  if (!outputWindow || outputWindow.isDestroyed() || event.sender !== outputWindow.webContents) return;
  outputMetrics[kind] = {
    fps: Math.max(0, Number(metrics.fps) || 0),
    updatedAt: Date.now()
  };
});
