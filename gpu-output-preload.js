const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ndiOutput", Object.freeze({
  getFrame() {
    return null;
  },
  reportMetrics(kind, fps) {
    ipcRenderer.send("output:metrics", { kind, fps });
  },
  getSignalConfig() {
    return ipcRenderer.invoke("signal:getConfig");
  },
  onSignalConfig(callback) {
    ipcRenderer.on("signal:config", (_event, config) => callback(config));
  },
  onBackendFallback(callback) {
    ipcRenderer.on("backend:fallback", (_event, reason) => callback(reason));
  }
}));
