const fs = require("fs");
const path = require("path");

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 7;
const LEVELS = new Set(["debug", "info", "warn", "error"]);
const SAFE_KEY = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;

let logDirectory = null;
let logFile = null;
let fallback = false;
let initialized = false;

function tryDirectory(directory) {
  try {
    fs.mkdirSync(directory, { recursive: true });
    const probe = path.join(directory, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, "", { flag: "w" });
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

function initialize({ packaged, appRoot, localAppData }) {
  if (initialized) return getStatus();
  const preferred = packaged ? path.join(path.dirname(process.execPath), "logs") : path.join(appRoot, "logs");
  const fallbackDirectory = path.join(localAppData, "RGB Alpha Splitter", "logs");
  logDirectory = tryDirectory(preferred) ? preferred : fallbackDirectory;
  fallback = logDirectory !== preferred;
  if (!tryDirectory(logDirectory)) throw new Error("No writable application log directory is available.");
  logFile = path.join(logDirectory, "application.log");
  initialized = true;
  return getStatus();
}

function redactString(value) {
  const text = String(value).slice(0, 512).replace(/[\r\n\t]+/g, " ");
  try {
    const parsed = new URL(text);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = "";
      parsed.password = "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    }
    if (parsed.protocol === "data:" || parsed.protocol === "blob:") return `${parsed.protocol}[redacted]`;
  } catch (_) {}
  return text.replace(/(token|password|secret|authorization)=([^ ]+)/gi, "$1=[redacted]");
}

function compactFields(fields) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const values = [];
  for (const [key, value] of Object.entries(fields).slice(0, 20)) {
    if (!SAFE_KEY.test(key) || value === undefined || value === null) continue;
    const normalized = typeof value === "number" || typeof value === "boolean" ? String(value) : redactString(value);
    values.push(`${key}=${JSON.stringify(normalized)}`);
  }
  return values.length ? ` ${values.join(" ")}` : "";
}

function rotateIfNeeded(extraBytes) {
  let size = 0;
  try { size = fs.statSync(logFile).size; } catch (_) {}
  if (size + extraBytes <= MAX_FILE_BYTES) return;
  for (let index = MAX_FILES - 1; index >= 1; --index) {
    const source = index === 1 ? logFile : `${logFile}.${index - 1}`;
    const destination = `${logFile}.${index}`;
    try { if (fs.existsSync(destination)) fs.unlinkSync(destination); } catch (_) {}
    try { if (fs.existsSync(source)) fs.renameSync(source, destination); } catch (_) {}
  }
}

function write(level, category, event, fields = null, error = null) {
  if (!initialized) return false;
  const safeLevel = LEVELS.has(level) ? level : "info";
  const safeCategory = SAFE_KEY.test(category || "") ? category : "app";
  const safeEvent = SAFE_KEY.test(event || "") ? event : "event";
  let line = `${new Date().toISOString()} ${safeLevel.toUpperCase()} ${process.type || "main"} ${safeCategory} ${safeEvent}${compactFields(fields)}`;
  if (error) line += ` error=${JSON.stringify(redactString(error.stack || error.message || error))}`;
  line += "\n";
  try {
    rotateIfNeeded(Buffer.byteLength(line));
    fs.appendFileSync(logFile, line, "utf8");
    return true;
  } catch (_) {
    return false;
  }
}

function getStatus() {
  return { available: initialized, directory: logDirectory, file: logFile, fallback, maxFiles: MAX_FILES, maxFileBytes: MAX_FILE_BYTES };
}

module.exports = { initialize, write, getStatus };
