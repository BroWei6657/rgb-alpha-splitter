(function () {
  const unavailableReason = "未检测到 Electron preload 注入的 window.ndiBridge";

  function unavailable() {
    return {
      available: false,
      runtime: "Browser",
      reason: unavailableReason,
      sdk: null
    };
  }

  async function invoke(name, fallback, ...args) {
    const bridge = window.ndiBridge;
    if (!bridge || typeof bridge[name] !== "function") return fallback();
    return bridge[name](...args);
  }

  window.ndiClient = {
    async getStatus() {
      return invoke("getStatus", unavailable);
    },

    async findSources() {
      return invoke("findSources", () => []);
    },

    async connect(sourceId) {
      return invoke("connect", () => {
        throw new Error(unavailableReason);
      }, sourceId);
    },

    async disconnect() {
      return invoke("disconnect", () => true);
    },

    async getFrame(afterSequence) {
      return invoke("getFrame", () => null, afterSequence);
    },

    async getReceiverStatus() {
      return invoke("getReceiverStatus", () => ({
        connected: false,
        connections: 0,
        receivedVideoFrames: 0,
        droppedVideoFrames: 0,
        queuedVideoFrames: 0,
        lastFrameAgeMs: -1
      }));
    },

    async listDisplays() {
      return invoke("listDisplays", () => [{
        id: "browser",
        name: "浏览器窗口",
        primary: true,
        bounds: null
      }]);
    },

    async configureOutput(options) {
      return invoke("configureOutput", () => false, options);
    },

    async openOutput(options) {
      return invoke("openOutput", () => false, options);
    },

    async closeOutput(kind) {
      return invoke("closeOutput", () => true, kind);
    },

    async getOutputStatus() {
      return invoke("getOutputStatus", () => ({ rgb: false, alpha: false }));
    },

    async publishLocalFrame(frame) {
      return invoke("publishLocalFrame", () => false, frame);
    },

    publishLocalFrameFast(frame) {
      const bridge = window.ndiBridge;
      if (!bridge || typeof bridge.publishLocalFrameFast !== "function") return false;
      bridge.publishLocalFrameFast(frame);
      return true;
    },

    async activateLocalSource() {
      return invoke("activateLocalSource", () => ({ type: "local", generation: 0 }));
    },

    async getAppInfo() {
      return invoke("getAppInfo", () => ({ version: "browser", platform: "browser" }));
    },

    async getEngineStatus() {
      return invoke("getEngineStatus", () => ({ backend: "browser", gpuAvailable: false }));
    },

    async getLogStatus() {
      return invoke("getLogStatus", () => ({ available: false, directory: "Browser" }));
    },

    async openLogDirectory() {
      return invoke("openLogDirectory", () => false);
    },

    writeLog(entry) {
      return invoke("writeLog", () => false, entry);
    },

    async getSignalConfig() {
      return invoke("getSignalConfig", () => ({ config: {}, presets: {} }));
    },

    async setSignalConfig(config) {
      return invoke("setSignalConfig", () => config, config);
    },

    async setGpuRuntimeConfig(config) {
      return invoke("setGpuRuntimeConfig", () => false, config);
    },

    async startUrl(options) {
      return invoke("startUrl", () => { throw new Error("URL mode requires the Electron desktop app."); }, options);
    },

    async stopUrl() {
      return invoke("stopUrl", () => true);
    },

    async getUrlStatus() {
      return invoke("getUrlStatus", () => ({ active: false, state: "stopped" }));
    },

    async refreshUrl() {
      return invoke("refreshUrl", () => false);
    },

    async setUrlViewport(viewport) {
      return invoke("setUrlViewport", () => false, viewport);
    },

    onUrlStatus(callback) {
      const bridge = window.ndiBridge;
      if (bridge && typeof bridge.onUrlStatus === "function") bridge.onUrlStatus(callback);
    },

    onClockTick(callback) {
      const bridge = window.ndiBridge;
      if (bridge && typeof bridge.onClockTick === "function") {
        bridge.onClockTick(callback);
        return;
      }
      setInterval(callback, 1000 / 60);
    }
  };
})();
