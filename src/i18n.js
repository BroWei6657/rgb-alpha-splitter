(function () {
  const STORAGE_KEY = "languageMode";
  const DEFAULT_LOCALE = "zh-CN";
  let bundle = { languages: [], catalogs: {}, fallbackLocale: DEFAULT_LOCALE, systemLocale: DEFAULT_LOCALE };
  let mode = localStorage.getItem(STORAGE_KEY) || "system";
  let activeLocale = DEFAULT_LOCALE;

  function resolveLocale(requestedMode) {
    const available = bundle.languages.map((language) => language.id);
    const requested = requestedMode === "system" ? bundle.systemLocale : requestedMode;
    if (available.includes(requested)) return requested;
    const base = String(requested || "").split("-")[0].toLowerCase();
    return available.find((id) => id.split("-")[0].toLowerCase() === base) || bundle.fallbackLocale || available[0] || DEFAULT_LOCALE;
  }

  function interpolate(message, values) {
    return String(message).replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key) =>
      Object.hasOwn(values || {}, key) ? String(values[key]) : match);
  }

  function t(key, values = {}) {
    const catalog = bundle.catalogs[activeLocale] || {};
    const fallback = bundle.catalogs[bundle.fallbackLocale] || {};
    return interpolate(catalog[key] ?? fallback[key] ?? key, values);
  }

  function apply(root = document) {
    root.querySelectorAll("[data-i18n]").forEach((element) => {
      element.textContent = t(element.dataset.i18n);
    });
    for (const attribute of ["aria-label", "placeholder", "title"]) {
      const datasetName = `i18n${attribute.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("")}`;
      root.querySelectorAll(`[data-i18n-${attribute}]`).forEach((element) => {
        element.setAttribute(attribute, t(element.dataset[datasetName]));
      });
    }
    document.documentElement.lang = activeLocale;
  }

  function populateSelector() {
    const selector = document.getElementById("languageMode");
    if (!selector) return;
    selector.replaceChildren(new Option(t("language.system"), "system"));
    for (const language of bundle.languages) selector.add(new Option(language.label, language.id));
    selector.value = mode === "system" || bundle.languages.some((language) => language.id === mode) ? mode : "system";
  }

  function setMode(nextMode, notify = true) {
    mode = nextMode === "system" || bundle.languages.some((language) => language.id === nextMode) ? nextMode : "system";
    activeLocale = resolveLocale(mode);
    localStorage.setItem(STORAGE_KEY, mode);
    apply();
    populateSelector();
    if (notify) window.dispatchEvent(new CustomEvent("i18n:changed", { detail: { mode, locale: activeLocale } }));
    return activeLocale;
  }

  async function loadFromHttp() {
    const manifest = await fetch("./locales/languages.txt", { cache: "no-store" }).then((response) => response.text());
    const languages = manifest.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
      const separator = line.indexOf("=");
      const pipe = line.lastIndexOf("|");
      return { id: line.slice(0, separator).trim(), label: line.slice(separator + 1, pipe).trim(), file: line.slice(pipe + 1).trim() };
    });
    const catalogs = {};
    await Promise.all(languages.map(async (language) => {
      const text = await fetch(`./locales/${encodeURIComponent(language.file)}`, { cache: "no-store" }).then((response) => response.text());
      catalogs[language.id] = Object.fromEntries(text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#")).map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/\\n/g, "\n")];
      }));
    }));
    return { languages: languages.map(({ id, label }) => ({ id, label })), catalogs, fallbackLocale: DEFAULT_LOCALE, systemLocale: navigator.language };
  }

  async function initialize() {
    try {
      bundle = window.ndiBridge && typeof window.ndiBridge.getLocales === "function"
        ? await window.ndiBridge.getLocales()
        : await loadFromHttp();
    } catch (error) {
      console.error("Failed to load locale catalogs:", error);
    }
    if (!bundle || !Array.isArray(bundle.languages) || !bundle.languages.length) {
      document.documentElement.lang = DEFAULT_LOCALE;
      return { mode: "system", locale: DEFAULT_LOCALE, available: false };
    }
    setMode(mode, false);
    const selector = document.getElementById("languageMode");
    if (selector) selector.addEventListener("change", () => setMode(selector.value));
    return { mode, locale: activeLocale, available: true };
  }

  window.i18n = { initialize, t, apply, setMode, get mode() { return mode; }, get locale() { return activeLocale; } };
})();
