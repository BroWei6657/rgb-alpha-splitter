const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ndiBridge", {
  getStatus: () => ipcRenderer.invoke("ndi:getStatus"),
  findSources: () => ipcRenderer.invoke("ndi:findSources"),
  connect: (sourceId) => ipcRenderer.invoke("ndi:connect", sourceId),
  disconnect: () => ipcRenderer.invoke("ndi:disconnect"),
  getFrame: (afterSequence) => ipcRenderer.invoke("ndi:getFrame", afterSequence),
  getReceiverStatus: () => ipcRenderer.invoke("ndi:getReceiverStatus"),
  listDisplays: () => ipcRenderer.invoke("display:list"),
  configureOutput: (options) => ipcRenderer.invoke("output:configure", options),
  openOutput: (options) => ipcRenderer.invoke("output:open", options),
  closeOutput: (kind) => ipcRenderer.invoke("output:close", kind),
  getOutputStatus: () => ipcRenderer.invoke("output:getStatus"),
  publishLocalFrame: (frame) => ipcRenderer.invoke("frame:publishLocal", frame),
  publishLocalFrameFast: (frame) => ipcRenderer.send("frame:publishLocalFast", frame),
  activateLocalSource: () => ipcRenderer.invoke("source:activateLocal"),
  getAppInfo: () => ipcRenderer.invoke("app:getInfo"),
  getLocales: () => ipcRenderer.invoke("i18n:getCatalogs"),
  getEngineStatus: () => ipcRenderer.invoke("engine:getStatus"),
  getLogStatus: () => ipcRenderer.invoke("log:getStatus"),
  openLogDirectory: () => ipcRenderer.invoke("log:openDirectory"),
  writeLog: (entry) => ipcRenderer.invoke("log:write", entry),
  getSignalConfig: () => ipcRenderer.invoke("signal:getConfig"),
  setSignalConfig: (config) => ipcRenderer.invoke("signal:setConfig", config),
  setGpuRuntimeConfig: (config) => ipcRenderer.invoke("gpu:setRuntimeConfig", config),
  startUrl: (options) => ipcRenderer.invoke("url:start", options),
  stopUrl: () => ipcRenderer.invoke("url:stop"),
  getUrlStatus: () => ipcRenderer.invoke("url:getStatus"),
  refreshUrl: () => ipcRenderer.invoke("url:refresh"),
  setUrlViewport: (viewport) => ipcRenderer.invoke("url:setViewport", viewport),
  setUrlInteraction: (enabled) => ipcRenderer.invoke("url:setInteraction", enabled),
  setUrlTransparent: (enabled) => ipcRenderer.invoke("url:setTransparent", enabled),
  sendUrlInput: (input) => ipcRenderer.send("url:input", input),
  onUrlStatus: (callback) => ipcRenderer.on("url:status", (_event, status) => callback(status)),
  onClockTick: (callback) => {
    ipcRenderer.on("clock:tick", () => {
      try {
        callback();
      } finally {
        ipcRenderer.send("clock:ack");
      }
    });
  }
});
