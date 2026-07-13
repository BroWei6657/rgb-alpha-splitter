const fs = require("fs");
const path = require("path");
const { contextBridge, ipcRenderer } = require("electron");

const sdkDir = process.env.NDI_SDK_DIR;
const runtimeCandidates = process.platform === "darwin"
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
const runtimePath = runtimeCandidates.find((candidate) => fs.existsSync(candidate));
if (runtimePath) {
  const runtimeDir = path.dirname(runtimePath);
  if (process.platform === "darwin") {
    process.env.DYLD_LIBRARY_PATH = `${runtimeDir}${path.delimiter}${process.env.DYLD_LIBRARY_PATH || ""}`;
    process.env.DYLD_FALLBACK_LIBRARY_PATH = `${runtimeDir}${path.delimiter}${process.env.DYLD_FALLBACK_LIBRARY_PATH || ""}`;
  } else {
    process.env.PATH = `${runtimeDir}${path.delimiter}${process.env.PATH || ""}`;
  }
}

let nativeNdi = null;
try {
  nativeNdi = require(path.join(__dirname, "native", "ndi-node.node"));
} catch (error) {
  console.error("Unable to load the shared NDI frame reader:", error);
}

contextBridge.exposeInMainWorld("ndiOutput", Object.freeze({
  getFrame(afterSequence) {
    if (!nativeNdi) return null;
    return nativeNdi.getSharedFrame(BigInt(afterSequence || 0));
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
