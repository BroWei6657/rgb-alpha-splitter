const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const minutes = Math.max(0.2, Number(process.argv[2]) || 30);
const root = path.resolve(__dirname, "..");
const electron = require("electron");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ndi-soak-"));
const run = spawnSync(electron, [".", "--soak-test", `--user-data-dir=${userData}`], {
  cwd: root,
  env: { ...process.env, NDI_SOAK_DURATION_MS: String(minutes * 60 * 1000), NDI_TEST_WIDTH: "1920", NDI_TEST_HEIGHT: "1080" },
  encoding: "utf8",
  timeout: (minutes + 2) * 60 * 1000
});
const output = `${run.stdout || ""}\n${run.stderr || ""}`;
const match = output.match(/SMOKE_RESULT (\{.*\})/);
if (!match || run.status !== 0) throw new Error(`Soak test failed:\n${output}`);
const result = JSON.parse(match[1]);
console.log(JSON.stringify(result.soakResult, null, 2));
