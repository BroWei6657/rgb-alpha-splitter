const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { loadLocaleBundle } = require("../src/locale-loader");

const bundle = loadLocaleBundle(path.join(__dirname, "..", "locales"));
assert.strictEqual(bundle.fallbackLocale, "zh-CN");
assert.deepStrictEqual(bundle.languages.map((language) => language.id), ["zh-CN", "en-US"]);
assert.strictEqual(bundle.catalogs["zh-CN"]["nav.input"], "输入");
assert.strictEqual(bundle.catalogs["en-US"]["nav.input"], "Input");
assert.strictEqual(
  Object.keys(bundle.catalogs["zh-CN"]).length,
  Object.keys(bundle.catalogs["en-US"]).length
);
const indexSource = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const appSource = fs.readFileSync(path.join(__dirname, "..", "src", "app.js"), "utf8");
const referencedKeys = new Set([
  ...Array.from(indexSource.matchAll(/data-i18n(?:-[a-z-]+)?="([^"]+)"/g), (match) => match[1]),
  ...Array.from(appSource.matchAll(/\bt\("([^"]+)"/g), (match) => match[1]),
  "detection.high", "detection.medium", "detection.low"
]);
for (const key of referencedKeys) {
  assert.ok(Object.hasOwn(bundle.catalogs["zh-CN"], key), `Missing zh-CN key: ${key}`);
  assert.ok(Object.hasOwn(bundle.catalogs["en-US"], key), `Missing en-US key: ${key}`);
}
console.log(`i18n catalogs: ${bundle.languages.length} languages, ${Object.keys(bundle.catalogs["zh-CN"]).length} keys`);
