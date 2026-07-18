const fs = require("fs");
const path = require("path");

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_CATALOG_BYTES = 256 * 1024;
const MAX_LANGUAGES = 32;
const LOCALE_ID_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const LOCALE_FILE_PATTERN = /^[A-Za-z0-9._-]+\.txt$/;
const MESSAGE_KEY_PATTERN = /^[a-z][A-Za-z0-9]*(?:[._-][A-Za-z0-9]+)*$/;

function readUtf8File(filePath, maxBytes) {
  const stats = fs.statSync(filePath);
  if (!stats.isFile() || stats.size > maxBytes) {
    throw new Error(`Locale file is invalid or exceeds ${maxBytes} bytes: ${path.basename(filePath)}`);
  }
  return fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
}

function dataLines(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
}

function parseManifest(text) {
  const seen = new Set();
  return dataLines(text).map((line, index) => {
    const separator = line.indexOf("=");
    const pipe = line.lastIndexOf("|");
    if (separator <= 0 || pipe <= separator + 1 || pipe === line.length - 1) {
      throw new Error(`Invalid locale manifest entry on line ${index + 1}.`);
    }
    const id = line.slice(0, separator).trim();
    const label = line.slice(separator + 1, pipe).trim();
    const file = line.slice(pipe + 1).trim();
    if (!LOCALE_ID_PATTERN.test(id) || !label || label.length > 64 || !LOCALE_FILE_PATTERN.test(file) || path.basename(file) !== file) {
      throw new Error(`Unsafe locale manifest entry on line ${index + 1}.`);
    }
    if (seen.has(id)) throw new Error(`Duplicate locale id: ${id}`);
    seen.add(id);
    return { id, label, file };
  });
}

function parseCatalog(text, fileName) {
  const messages = Object.create(null);
  for (const [index, line] of dataLines(text).entries()) {
    const separator = line.indexOf("=");
    if (separator <= 0) throw new Error(`Invalid message entry in ${fileName} on data line ${index + 1}.`);
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/\\n/g, "\n");
    if (!MESSAGE_KEY_PATTERN.test(key) || key.length > 128 || value.length > 2048) {
      throw new Error(`Unsafe message entry in ${fileName} on data line ${index + 1}.`);
    }
    if (Object.hasOwn(messages, key)) throw new Error(`Duplicate message key in ${fileName}: ${key}`);
    messages[key] = value;
  }
  return messages;
}

function loadLocaleBundle(localesDirectory) {
  const root = path.resolve(localesDirectory);
  const manifestPath = path.join(root, "languages.txt");
  const languages = parseManifest(readUtf8File(manifestPath, MAX_MANIFEST_BYTES));
  if (!languages.length || languages.length > MAX_LANGUAGES) throw new Error("Locale manifest must contain between 1 and 32 languages.");

  const catalogs = Object.create(null);
  for (const language of languages) {
    const catalogPath = path.resolve(root, language.file);
    if (path.dirname(catalogPath) !== root) throw new Error(`Locale file escapes the locale directory: ${language.file}`);
    catalogs[language.id] = parseCatalog(readUtf8File(catalogPath, MAX_CATALOG_BYTES), language.file);
  }

  const fallbackLocale = catalogs["zh-CN"] ? "zh-CN" : languages[0].id;
  const fallbackKeys = Object.keys(catalogs[fallbackLocale]).sort();
  for (const language of languages) {
    const keys = Object.keys(catalogs[language.id]).sort();
    if (keys.length !== fallbackKeys.length || keys.some((key, index) => key !== fallbackKeys[index])) {
      throw new Error(`Locale key set does not match ${fallbackLocale}: ${language.id}`);
    }
  }
  return { languages: languages.map(({ id, label }) => ({ id, label })), catalogs, fallbackLocale };
}

module.exports = { loadLocaleBundle, parseCatalog, parseManifest };
