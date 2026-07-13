const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const packageLock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const version = packageJson.version;

if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Invalid SemVer version: ${version}`);
if (packageLock.version !== version || packageLock.packages?.[""]?.version !== version) {
  throw new Error("package.json and package-lock.json versions do not match.");
}
if (!changelog.includes(`## [${version}]`)) throw new Error(`CHANGELOG.md has no ${version} entry.`);
if (packageJson.name !== "rgb-alpha-splitter" || packageJson.build?.productName !== "RGB Alpha Splitter") {
  throw new Error("Package and visible product branding are inconsistent.");
}
if (packageJson.build?.win?.artifactName !== "RGB-Alpha-Splitter-Setup-${version}.${ext}") {
  throw new Error("Windows installer naming is inconsistent with the version policy.");
}
console.log(`Version ${version} is consistent.`);
