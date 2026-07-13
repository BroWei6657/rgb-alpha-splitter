const { spawnSync } = require("child_process");
const path = require("path");
const os = require("os");
const fs = require("fs");

const root = path.resolve(__dirname, "..");
const electron = require("electron");
const cases = [[1920, 1080], [3840, 2160]];
const results = [];

for (const [width, height] of cases) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), `ndi-perf-${width}x${height}-`));
  const run = spawnSync(electron, [".", "--performance-test", `--user-data-dir=${userData}`], {
    cwd: root,
    env: { ...process.env, NDI_TEST_WIDTH: String(width), NDI_TEST_HEIGHT: String(height) },
    encoding: "utf8",
    timeout: 120000
  });
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  const match = output.match(/SMOKE_RESULT (\{.*\})/);
  if (!match || run.status !== 0) throw new Error(`Performance case ${width}x${height} failed:\n${output}`);
  const result = JSON.parse(match[1]);
  const presenter = result.controlPlaneResult?.engine?.presenter || result.gpuUrlPresenterStatus || {};
  results.push({ resolution: result.nativeTestResolution, published: result.nativePublishedFrames,
    rgbFps: result.nativeCadenceOutputFps.rgb, alphaFps: result.nativeCadenceOutputFps.alpha,
    adapter: presenter.adapterName || "unknown",
    uploadMs: presenter.uploadMs || 0,
    renderMs: presenter.renderMs || 0,
    presentMs: presenter.presentMs || 0,
    p95FrameMs: presenter.p95FrameMs || 0,
    overwrittenFrames: Number(presenter.overwrittenFrames || 0),
    presentationFailures: Number(presenter.presentationFailures || 0) });
}

console.log(JSON.stringify({ backend: "d3d11-gpu", results }, null, 2));
