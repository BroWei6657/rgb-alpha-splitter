(function () {
  const DEFAULT_WIDTH = 960;
  const DEFAULT_HEIGHT = 540;
  const MAX_LOG_ITEMS = 80;
  const t = (key, values) => window.i18n ? window.i18n.t(key, values) : key;

  const elements = {
    sourceCanvas: document.getElementById("sourceCanvas"),
    rgbCanvas: document.getElementById("rgbCanvas"),
    alphaCanvas: document.getElementById("alphaCanvas"),
    sourceWrap: document.getElementById("sourceWrap"),
    hiddenVideo: document.getElementById("hiddenVideo"),
    hiddenImage: document.getElementById("hiddenImage"),
    bridgeState: document.getElementById("bridgeState"),
    signalState: document.getElementById("signalState"),
    frameRate: document.getElementById("frameRate"),
    sourceState: document.getElementById("sourceState"),
    engineState: document.getElementById("engineState"),
    versionState: document.getElementById("versionState"),
    sourceMeta: document.getElementById("sourceMeta"),
    ndiSourceSelect: document.getElementById("ndiSourceSelect"),
    ndiModeBtn: document.getElementById("ndiModeBtn"),
    urlModeBtn: document.getElementById("urlModeBtn"),
    ndiModePanel: document.getElementById("ndiModePanel"),
    urlModePanel: document.getElementById("urlModePanel"),
    urlInput: document.getElementById("urlInput"),
    urlViewportMode: document.getElementById("urlViewportMode"),
    urlViewportCustom: document.getElementById("urlViewportCustom"),
    urlViewportWidth: document.getElementById("urlViewportWidth"),
    urlViewportHeight: document.getElementById("urlViewportHeight"),
    urlPageType: document.getElementById("urlPageType"),
    urlTransparent: document.getElementById("urlTransparent"),
    urlAllowLan: document.getElementById("urlAllowLan"),
    loadUrlBtn: document.getElementById("loadUrlBtn"),
    refreshUrlBtn: document.getElementById("refreshUrlBtn"),
    stopUrlBtn: document.getElementById("stopUrlBtn"),
    urlHint: document.getElementById("urlHint"),
    ndiHint: document.getElementById("ndiHint"),
    refreshNdiBtn: document.getElementById("refreshNdiBtn"),
    connectNdiBtn: document.getElementById("connectNdiBtn"),
    disconnectBtn: document.getElementById("disconnectBtn"),
    autoReconnect: document.getElementById("autoReconnect"),
    testPatternBtn: document.getElementById("testPatternBtn"),
    fileInput: document.getElementById("fileInput"),
    alphaGain: document.getElementById("alphaGain"),
    alphaGainValue: document.getElementById("alphaGainValue"),
    invertAlpha: document.getElementById("invertAlpha"),
    showCheckerboard: document.getElementById("showCheckerboard"),
    rgbWindowBtn: document.getElementById("rgbWindowBtn"),
    alphaWindowBtn: document.getElementById("alphaWindowBtn"),
    fullscreenBtn: document.getElementById("fullscreenBtn"),
    rgbDisplaySelect: document.getElementById("rgbDisplaySelect"),
    alphaDisplaySelect: document.getElementById("alphaDisplaySelect"),
    autoFullscreen: document.getElementById("autoFullscreen"),
    snapshotBtn: document.getElementById("snapshotBtn"),
    clearLogBtn: document.getElementById("clearLogBtn"),
    eventLog: document.getElementById("eventLog"),
    metricInput: document.getElementById("metricInput"),
    metricResolution: document.getElementById("metricResolution"),
    metricFrameTime: document.getElementById("metricFrameTime"),
    metricRuntime: document.getElementById("metricRuntime"),
    metricConnections: document.getElementById("metricConnections"),
    metricReceived: document.getElementById("metricReceived"),
    metricDropped: document.getElementById("metricDropped"),
    metricQueue: document.getElementById("metricQueue"),
    metricRgbOutputFps: document.getElementById("metricRgbOutputFps"),
    metricAlphaOutputFps: document.getElementById("metricAlphaOutputFps"),
    metricGpuAdapter: document.getElementById("metricGpuAdapter"),
    metricGpuQueue: document.getElementById("metricGpuQueue"),
    metricGpuOverwritten: document.getElementById("metricGpuOverwritten"),
    metricGpuP95: document.getElementById("metricGpuP95"),
    metricReconnects: document.getElementById("metricReconnects")
    ,metricSyncMode: document.getElementById("metricSyncMode")
    ,metricClockSource: document.getElementById("metricClockSource")
    ,metricClockJitter: document.getElementById("metricClockJitter")
    ,metricPresentSkew: document.getElementById("metricPresentSkew")
    ,themeMode: document.getElementById("themeMode")
    ,languageMode: document.getElementById("languageMode")
    ,diagnosticsSection: document.getElementById("diagnosticsSection")
    ,openLogsBtn: document.getElementById("openLogsBtn")
    ,logPathState: document.getElementById("logPathState")
    ,diagnosticChartMetric: document.getElementById("diagnosticChartMetric")
    ,diagnosticChart: document.getElementById("diagnosticChart")
    ,diagnosticMetricInputs: Array.from(document.querySelectorAll("[data-diagnostic-metric]"))
    ,inspectorTabs: Array.from(document.querySelectorAll("[data-inspector-tab]"))
    ,inspectorPanels: Array.from(document.querySelectorAll("[data-inspector-panel]"))
    ,outputResolution: document.getElementById("outputResolution")
    ,outputFrameRate: document.getElementById("outputFrameRate")
    ,customOutputResolution: document.getElementById("customOutputResolution")
    ,customOutputWidth: document.getElementById("customOutputWidth")
    ,customOutputHeight: document.getElementById("customOutputHeight")
    ,scanMode: document.getElementById("scanMode")
    ,scalingMode: document.getElementById("scalingMode")
    ,sourcePrimaries: document.getElementById("sourcePrimaries")
    ,sourceRange: document.getElementById("sourceRange")
    ,outputPrimaries: document.getElementById("outputPrimaries")
    ,outputRange: document.getElementById("outputRange")
    ,gpuPreference: document.getElementById("gpuPreference")
    ,previewPolicy: document.getElementById("previewPolicy")
    ,syncMode: document.getElementById("syncMode")
    ,signalHint: document.getElementById("signalHint")
    ,restoreAutoColorBtn: document.getElementById("restoreAutoColorBtn")
    ,colorDetectionState: document.getElementById("colorDetectionState")
    ,cropControls: document.getElementById("cropControls")
    ,cropLeft: document.getElementById("cropLeft")
    ,cropTop: document.getElementById("cropTop")
    ,cropRight: document.getElementById("cropRight")
    ,cropBottom: document.getElementById("cropBottom")
    ,cropLockAspect: document.getElementById("cropLockAspect")
    ,resetCropBtn: document.getElementById("resetCropBtn")
    ,cropOverlay: document.getElementById("cropOverlay")
    ,cropSelection: document.getElementById("cropSelection")
  };

  const ctx = {
    source: elements.sourceCanvas.getContext("2d")
  };

  function createSplitRenderer(canvas, mode) {
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      preserveDrawingBuffer: false
    });
    if (!gl) throw new Error(t("error.webglUnsupported"));

    const compile = (type, source) => {
      const shader = gl.createShader(type);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(shader) || t("error.shaderCompile"));
      }
      return shader;
    };

    const program = gl.createProgram();
    gl.attachShader(program, compile(gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      attribute vec2 a_uv;
      varying vec2 v_uv;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_uv = a_uv;
      }
    `));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_frame;
      uniform float u_gain;
      uniform float u_invert;
      uniform float u_source_limited;
      uniform float u_output_limited;
      uniform float u_primaries_mode;
      uniform float u_scaling_mode;
      uniform float u_source_aspect;
      uniform float u_output_aspect;
      uniform vec4 u_crop_rect;
      varying vec2 v_uv;
      vec4 sample_frame() {
        vec2 q = v_uv;
        if (u_scaling_mode < 0.5) {
          if (u_output_aspect > u_source_aspect) { float c=u_source_aspect/u_output_aspect; if(abs(v_uv.x-.5)>c*.5)return vec4(0.0); q.x=(v_uv.x-(1.0-c)*.5)/c; }
          else { float c=u_output_aspect/u_source_aspect; if(abs(v_uv.y-.5)>c*.5)return vec4(0.0); q.y=(v_uv.y-(1.0-c)*.5)/c; }
        } else if (u_scaling_mode < 1.5) {
          if (u_output_aspect > u_source_aspect) q.y=(v_uv.y-.5)*(u_source_aspect/u_output_aspect)+.5;
          else q.x=(v_uv.x-.5)*(u_output_aspect/u_source_aspect)+.5;
        } else if (u_scaling_mode > 2.5) q=u_crop_rect.xy+v_uv*u_crop_rect.zw;
        return texture2D(u_frame, q);
      }
      vec3 decode_range(vec3 value) {
        return u_source_limited > 0.5 ? clamp((value - vec3(16.0 / 255.0)) / (219.0 / 255.0), 0.0, 1.0) : value;
      }
      vec3 convert_primaries(vec3 value) {
        if (abs(u_primaries_mode) < 0.5) return value;
        vec3 linear = pow(max(value, vec3(0.0)), vec3(2.4));
        mat3 m709to2020 = mat3(0.6274,0.0691,0.0164, 0.3293,0.9195,0.0880, 0.0433,0.0114,0.8956);
        mat3 m2020to709 = mat3(1.6605,-0.1246,-0.0182, -0.5876,1.1329,-0.1006, -0.0728,-0.0083,1.1187);
        linear = u_primaries_mode > 0.0 ? m709to2020 * linear : m2020to709 * linear;
        return pow(clamp(linear, 0.0, 1.0), vec3(1.0 / 2.4));
      }
      vec3 encode_range(vec3 value) {
        return u_output_limited > 0.5 ? value * (219.0 / 255.0) + vec3(16.0 / 255.0) : value;
      }
      void main() {
        vec4 pixel = sample_frame();
        float alpha = clamp(pixel.a * u_gain, 0.0, 1.0);
        alpha = mix(alpha, 1.0 - alpha, u_invert);
        ${mode === "rgb"
          ? "gl_FragColor = vec4(encode_range(convert_primaries(decode_range(pixel.rgb))), 1.0);"
          : "gl_FragColor = vec4(alpha, alpha, alpha, 1.0);"}
      }
    `));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || t("error.programLink"));
    }

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
      -1,  1, 0, 0,
       1, -1, 1, 1,
       1,  1, 1, 0
    ]), gl.STATIC_DRAW);

    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "a_position");
    const uv = gl.getAttribLocation(program, "a_uv");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 16, 8);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.uniform1i(gl.getUniformLocation(program, "u_frame"), 0);
    const gainUniform = gl.getUniformLocation(program, "u_gain");
    const invertUniform = gl.getUniformLocation(program, "u_invert");
    const sourceLimitedUniform = gl.getUniformLocation(program, "u_source_limited");
    const outputLimitedUniform = gl.getUniformLocation(program, "u_output_limited");
    const primariesModeUniform = gl.getUniformLocation(program, "u_primaries_mode");
    const scalingModeUniform = gl.getUniformLocation(program, "u_scaling_mode");
    const sourceAspectUniform = gl.getUniformLocation(program, "u_source_aspect");
    const outputAspectUniform = gl.getUniformLocation(program, "u_output_aspect");
    const cropRectUniform = gl.getUniformLocation(program, "u_crop_rect");
    let textureWidth = 0;
    let textureHeight = 0;

    return {
      render(source, gain, invert, colorConfig) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        if (textureWidth !== source.width || textureHeight !== source.height) {
          textureWidth = source.width;
          textureHeight = source.height;
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        } else {
          gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
        }
        gl.uniform1f(gainUniform, gain);
        gl.uniform1f(invertUniform, invert ? 1 : 0);
        gl.uniform1f(sourceLimitedUniform, colorConfig.sourceRange === "limited" ? 1 : 0);
        gl.uniform1f(outputLimitedUniform, colorConfig.outputRange === "limited" ? 1 : 0);
        const primariesMode = colorConfig.sourcePrimaries === colorConfig.outputPrimaries ? 0 :
          colorConfig.sourcePrimaries === "rec709" ? 1 : -1;
        gl.uniform1f(primariesModeUniform, primariesMode);
        gl.uniform1f(scalingModeUniform, ({ fit: 0, fill: 1, stretch: 2, crop: 3 })[colorConfig.scalingMode] ?? 0);
        gl.uniform1f(sourceAspectUniform, source.width / source.height);
        gl.uniform1f(outputAspectUniform, canvas.width / canvas.height);
        const crop = colorConfig.cropRect || { x: 0, y: 0, width: 1, height: 1 };
        gl.uniform4f(cropRectUniform, crop.x, crop.y, crop.width, crop.height);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
    };
  }

  const splitRenderers = {
    rgb: createSplitRenderer(elements.rgbCanvas, "rgb"),
    alpha: createSplitRenderer(elements.alphaCanvas, "alpha")
  };

  const state = {
    mode: "test",
    bridgeAvailable: false,
    ndiSources: [],
    ndiConnectedSource: null,
    frame: 0,
    framesThisSecond: 0,
    lastFpsTime: performance.now(),
    lastFrameStarted: performance.now(),
    objectUrl: null,
    rgbOutput: false,
    alphaOutput: false,
    alphaGain: 1,
    invertAlpha: false,
    lastFrameMs: 0,
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    lastNdiSequence: "0",
    ndiFramePending: false,
    ndiHasFrame: false,
    ndiHasAlpha: false,
    frameDirty: true,
    lastMediaTime: -1,
    imageDrawn: false,
    placeholderDrawn: false,
    selectedNdiSourceId: null,
    ndiConnectedAt: 0,
    lastNdiFrameAt: 0,
    lastReconnectAt: -10000,
    reconnectAttempts: 0,
    watchdogPending: false,
    lastPreviewPollAt: 0,
    localPublishPending: 0,
    lastLocalPublishAt: -1000,
    lastLocalSourceAt: -1000,
    lastPreviewRenderAt: -1000
    ,localGeneration: 0
    ,signalConfig: { sourcePrimaries: "rec709", sourceRange: "full", outputPrimaries: "rec709", outputRange: "limited",
      outputResolution: "1920x1080", outputFrameRate: "30", scanSelection: "progressive", scalingMode: "fit",
      cropRect: { x: 0, y: 0, width: 1, height: 1 }, gpuPreference: "high-performance",
      gpuAdapterLuid: "", previewPolicy: "lightweight", autoColor: true, manualColorLocked: false }
    ,detectedSignal: null
    ,currentSourceKey: "test"
    ,lastDetectedSignature: ""
    ,nextLocalSourceAt: 0
    ,nextLocalPublishAt: 0
    ,localPublishedFrames: 0
  };

  const DIAGNOSTIC_HISTORY_LENGTH = 60;
  const DIAGNOSTIC_METRICS = {
    rgbFps: { label: "RGB FPS", unit: "fps", precision: 1 },
    alphaFps: { label: "Alpha FPS", unit: "fps", precision: 1 },
    p95FrameMs: { labelKey: "metric.p95Label", unit: "ms", precision: 2 },
    tickJitterUs: { labelKey: "metric.clockJitterLabel", unit: "us", precision: 0 },
    presentSkewUs: { labelKey: "metric.presentSkewLabel", unit: "us", precision: 0 },
    gpuQueue: { labelKey: "metric.gpuQueueLabel", unit: "", precision: 0 }
  };
  const diagnosticHistory = Object.fromEntries(Object.keys(DIAGNOSTIC_METRICS).map((key) => [key, []]));

  function updatePreviewDimensions() {
    const outputsActive = state.rgbOutput || state.alphaOutput;
    const lightweight = outputsActive && state.signalConfig.previewPolicy === "lightweight";
    const outputWidth = lightweight ? Math.min(854, Number(state.signalConfig.outputWidth || state.width)) :
      Number(state.signalConfig.outputWidth || state.width);
    const outputHeight = lightweight ? Math.max(1, Math.round(outputWidth *
      Number(state.signalConfig.outputHeight || state.height) / Number(state.signalConfig.outputWidth || state.width))) :
      Number(state.signalConfig.outputHeight || state.height);
    for (const canvas of [elements.rgbCanvas, elements.alphaCanvas]) {
      if (canvas.width !== outputWidth) canvas.width = outputWidth;
      if (canvas.height !== outputHeight) canvas.height = outputHeight;
    }
  }

  function resizePipeline(width, height) {
    if (!width || !height || (state.width === width && state.height === height)) return;
    state.width = width;
    state.height = height;
    elements.sourceCanvas.width = width;
    elements.sourceCanvas.height = height;
    updatePreviewDimensions();
    state.frameDirty = true;
    elements.metricResolution.textContent = `${width} x ${height}`;
  }

  function log(message, level = "info") {
    const item = document.createElement("li");
    const now = new Date();
    item.textContent = `[${now.toLocaleTimeString()}] ${message}`;
    item.dataset.level = level;
    elements.eventLog.prepend(item);
    while (elements.eventLog.children.length > MAX_LOG_ITEMS) {
      elements.eventLog.lastElementChild.remove();
    }
    window.ndiClient.writeLog({ level, category: "ui", event: "status", fields: { message } }).catch(() => {});
  }

  function localizedError(error) {
    const code = error && error.message;
    if (code === "ERR_URL_INVALID") return t("error.invalidUrl");
    if (code === "ERR_URL_PROTOCOL") return t("error.urlProtocol");
    return code || String(error || "");
  }

  function applyTheme(mode) {
    const selected = ["system", "light", "dark"].includes(mode) ? mode : "system";
    document.documentElement.dataset.theme = selected;
    elements.themeMode.value = selected;
    localStorage.setItem("themeMode", selected);
  }

  let activeInspectorPanel = "input";

  function formatDiagnosticValue(value, metric, includeUnit = true) {
    const formatted = Number(value || 0).toFixed(metric.precision);
    return includeUnit && metric.unit ? `${formatted} ${metric.unit}` : formatted;
  }

  function selectedDiagnosticMetrics() {
    return elements.diagnosticMetricInputs.filter((input) => input.checked).map((input) => input.value);
  }

  function initializeDiagnosticCharts() {
    elements.diagnosticChart.replaceChildren();
    const namespace = "http://www.w3.org/2000/svg";
    for (const [key, metric] of Object.entries(DIAGNOSTIC_METRICS)) {
      const metricLabel = metric.label || t(metric.labelKey);
      const track = document.createElement("section");
      track.className = "diagnostic-chart-track";
      track.dataset.diagnosticTrack = key;
      track.hidden = true;

      const header = document.createElement("div");
      header.className = "diagnostic-chart-track-head";
      const title = document.createElement("strong");
      title.textContent = metricLabel;
      const summary = document.createElement("span");
      for (const [labelKey, dataKey] of [["chart.current", "chartCurrent"], ["chart.minimum", "chartMin"], ["chart.maximum", "chartMax"]]) {
        if (summary.childNodes.length) summary.append(" · ");
        summary.append(`${t(labelKey)} `);
        const value = document.createElement("b");
        value.dataset[dataKey] = "";
        value.textContent = "0";
        summary.append(value);
      }
      header.append(title, summary);

      const svg = document.createElementNS(namespace, "svg");
      svg.setAttribute("viewBox", "0 0 300 64");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", t("chart.aria", { metric: metricLabel }));
      for (const y of [16, 32, 48]) {
        const line = document.createElementNS(namespace, "line");
        line.setAttribute("x1", "0");
        line.setAttribute("y1", String(y));
        line.setAttribute("x2", "300");
        line.setAttribute("y2", String(y));
        line.classList.add("diagnostic-chart-grid-line");
        svg.append(line);
      }
      const polyline = document.createElementNS(namespace, "polyline");
      polyline.dataset.chartLine = "";
      polyline.setAttribute("points", "");
      polyline.setAttribute("vector-effect", "non-scaling-stroke");
      svg.append(polyline);
      track.append(header, svg);
      elements.diagnosticChart.append(track);
    }
  }

  function renderDiagnosticCharts() {
    if (activeInspectorPanel !== "diagnostics") return;
    const selected = new Set(selectedDiagnosticMetrics());
    for (const [key, metric] of Object.entries(DIAGNOSTIC_METRICS)) {
      const track = elements.diagnosticChart.querySelector(`[data-diagnostic-track="${key}"]`);
      track.hidden = !selected.has(key);
      if (track.hidden) continue;
      const samples = diagnosticHistory[key] || [];
      const values = samples.length ? samples : [0];
      const minimum = Math.min(...values);
      const maximum = Math.max(...values);
      const dataRange = maximum - minimum;
      const padding = dataRange > 0 ? dataRange * 0.1 : Math.max(1, Math.abs(maximum) * 0.1);
      const scaleMinimum = Math.max(0, minimum - padding);
      const scaleMaximum = maximum + padding;
      const scaleRange = Math.max(1, scaleMaximum - scaleMinimum);
      const points = values.map((value, index) => {
        const x = values.length === 1 ? 300 : index * 300 / (values.length - 1);
        const y = 58 - ((value - scaleMinimum) / scaleRange) * 52;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      }).join(" ");
      track.querySelector("[data-chart-line]").setAttribute("points", points);
      track.querySelector("[data-chart-current]").textContent = formatDiagnosticValue(values[values.length - 1], metric);
      track.querySelector("[data-chart-min]").textContent = formatDiagnosticValue(minimum, metric, false);
      track.querySelector("[data-chart-max]").textContent = formatDiagnosticValue(maximum, metric, false);
    }
  }

  function recordDiagnosticMetrics(status, presenter) {
    const values = {
      rgbFps: Number(status.rgbFps || 0),
      alphaFps: Number(status.alphaFps || 0),
      p95FrameMs: Number(presenter.p95FrameMs || 0),
      tickJitterUs: Number(presenter.tickJitterUs || 0),
      presentSkewUs: Number(presenter.pairedPresentSkewUs || 0),
      gpuQueue: Number(presenter.queueDepth || 0)
    };
    for (const [key, value] of Object.entries(values)) {
      const history = diagnosticHistory[key];
      history.push(Number.isFinite(value) ? value : 0);
      if (history.length > DIAGNOSTIC_HISTORY_LENGTH) history.shift();
    }
    renderDiagnosticCharts();
  }

  function setActiveInspectorPanel(panel, persist = true) {
    const allowed = new Set(["input", "signal", "output", "diagnostics"]);
    const selected = allowed.has(panel) ? panel : "input";
    activeInspectorPanel = selected;
    for (const button of elements.inspectorTabs) {
      const active = button.dataset.inspectorTab === selected;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const panelElement of elements.inspectorPanels) {
      panelElement.hidden = panelElement.dataset.inspectorPanel !== selected;
    }
    if (persist) localStorage.setItem("inspectorPanel", selected);
    renderDiagnosticCharts();
  }

  function setPill(element, text, tone) {
    element.textContent = text;
    element.classList.remove("ok", "warn", "error");
    if (tone) element.classList.add(tone);
  }

  function clearObjectUrl() {
    if (state.objectUrl) {
      URL.revokeObjectURL(state.objectUrl);
      state.objectUrl = null;
    }
  }

  function setMode(mode, label) {
    state.mode = mode;
    setPill(elements.sourceState, label, mode === "ndi" || mode === "url" ? "ok" : "warn");
    elements.metricInput.textContent = label;
  }

  function setInputMode(mode) {
    const urlMode = mode === "url";
    elements.ndiModePanel.hidden = urlMode;
    elements.urlModePanel.hidden = !urlMode;
    elements.ndiModeBtn.classList.toggle("active", !urlMode);
    elements.urlModeBtn.classList.toggle("active", urlMode);
    localStorage.setItem("inputMode", mode);
  }

  async function stopUrlSource(switchToTest = false) {
    await window.ndiClient.stopUrl();
    if (state.mode === "url" && switchToTest) startTestPattern(false);
  }

  async function startUrlSource() {
    const url = elements.urlInput.value.trim();
    if (!url) {
      log(t("log.enterUrl"), "warn");
      return;
    }
    const viewportMode = elements.urlViewportMode.value;
    const width = viewportMode === "custom" ? Number(elements.urlViewportWidth.value) : Number(state.signalConfig.outputWidth || 1920);
    const height = viewportMode === "custom" ? Number(elements.urlViewportHeight.value) : Number(state.signalConfig.outputHeight || 1080);
    try {
      await window.ndiClient.disconnect();
      const status = await window.ndiClient.startUrl({
        url,
        width,
        height,
        fps: Number(state.signalConfig.frameRateN || 30) / Number(state.signalConfig.frameRateD || 1),
        viewportMode,
        transparentBackground: elements.urlTransparent.checked
        ,allowLan: elements.urlAllowLan.checked
      });
      clearObjectUrl();
      elements.hiddenVideo.pause();
      elements.hiddenVideo.removeAttribute("src");
      elements.hiddenImage.removeAttribute("src");
      state.ndiConnectedSource = null;
      state.selectedNdiSourceId = null;
      state.lastNdiSequence = "0";
      state.ndiHasFrame = false;
      state.placeholderDrawn = true;
      resizePipeline(width, height);
      setMode("url", url);
      setPill(elements.signalState, t("status.urlLoading"), "warn");
      state.currentSourceKey = `url:${url}`;
      elements.sourceMeta.textContent = `${width} x ${height} · ${Number(status.fps || 30).toFixed(2)} fps`;
      localStorage.setItem("urlInput", url);
      log(t("log.loadingUrl", { url }));
    } catch (error) {
      setPill(elements.signalState, t("status.urlLoadFailed"), "error");
      const message = localizedError(error);
      elements.urlHint.textContent = message;
      log(t("log.urlLoadFailed", { message }), "error");
    }
  }

  function handleUrlStatus(status) {
    if (!status) return;
    if (status.state === "running" && state.mode === "url") {
      setPill(elements.signalState, t("status.urlNormal"), "ok");
      elements.urlHint.textContent = t("status.urlContent", { fps: Number(status.actualFps || 0).toFixed(0) });
      if (status.naturalSize) {
        const pageType = t(`page.${status.naturalSize.type}`);
        elements.urlPageType.textContent = `${pageType} · ${status.naturalSize.width} x ${status.naturalSize.height}`;
        if (elements.urlViewportMode.value === "natural" && status.naturalSize.type !== "page") {
          window.ndiClient.setUrlViewport({ mode: "natural", width: status.naturalSize.width, height: status.naturalSize.height });
        }
      }
      if (status.detectedSignal) applyDetectedSignal(status.detectedSignal);
    } else if (status.state === "frozen" && state.mode === "url") {
      setPill(elements.signalState, t("status.urlFrozen"), "error");
      elements.urlHint.textContent = t("status.urlFrozenHint", { seconds: Math.max(1, Math.round(Number(status.frozenMs || 0) / 1000)) });
    } else if (status.state === "error") {
      setPill(elements.signalState, t("status.urlError"), "error");
      elements.urlHint.textContent = status.error || t("status.urlRenderError");
      log(t("log.urlRenderFailed", { message: elements.urlHint.textContent }), "error");
    }
  }

  function updateAlphaControls() {
    state.alphaGain = Number(elements.alphaGain.value);
    state.invertAlpha = elements.invertAlpha.checked;
    elements.alphaGainValue.textContent = `${state.alphaGain.toFixed(2)}x`;
    localStorage.setItem("alphaGain", String(state.alphaGain));
    localStorage.setItem("invertAlpha", String(state.invertAlpha));
    if (state.signalConfig) {
      state.signalConfig.alphaGain = state.alphaGain;
      state.signalConfig.invertAlpha = state.invertAlpha;
      window.ndiClient.setGpuRuntimeConfig({
        alphaGain: state.alphaGain,
        invertAlpha: state.invertAlpha,
        previewPolicy: state.signalConfig.previewPolicy || "lightweight"
      }).catch(() => {});
    }
    state.frameDirty = true;
  }

  function restoreSettings() {
    const alphaGain = localStorage.getItem("alphaGain");
    const invertAlpha = localStorage.getItem("invertAlpha");
    const showCheckerboard = localStorage.getItem("showCheckerboard");
    const autoReconnect = localStorage.getItem("autoReconnect");
    const autoFullscreen = localStorage.getItem("autoFullscreen");
    const inputMode = localStorage.getItem("inputMode");
    const urlInput = localStorage.getItem("urlInput");
    const urlAllowLan = localStorage.getItem("urlAllowLan");
    const themeMode = localStorage.getItem("themeMode") || "system";
    const inspectorPanel = localStorage.getItem("inspectorPanel") || "input";
    let diagnosticChartMetrics;
    try {
      diagnosticChartMetrics = JSON.parse(localStorage.getItem("diagnosticChartMetrics") || "null");
    } catch (_) {
      diagnosticChartMetrics = null;
    }
    if (!Array.isArray(diagnosticChartMetrics) || !diagnosticChartMetrics.some((key) => DIAGNOSTIC_METRICS[key])) {
      const legacyMetric = localStorage.getItem("diagnosticChartMetric");
      diagnosticChartMetrics = DIAGNOSTIC_METRICS[legacyMetric] ? [legacyMetric] : ["rgbFps", "alphaFps"];
    }
    if (alphaGain !== null) elements.alphaGain.value = alphaGain;
    if (invertAlpha !== null) elements.invertAlpha.checked = invertAlpha === "true";
    if (showCheckerboard !== null) elements.showCheckerboard.checked = showCheckerboard === "true";
    if (autoReconnect !== null) elements.autoReconnect.checked = autoReconnect === "true";
    if (autoFullscreen !== null) elements.autoFullscreen.checked = autoFullscreen === "true";
    if (urlInput) elements.urlInput.value = urlInput;
    if (urlAllowLan !== null) elements.urlAllowLan.checked = urlAllowLan === "true";
    applyTheme(themeMode);
    for (const input of elements.diagnosticMetricInputs) input.checked = diagnosticChartMetrics.includes(input.value);
    setActiveInspectorPanel(inspectorPanel, false);
    setInputMode(inputMode === "url" ? "url" : "ndi");
    updateAlphaControls();
    updateCheckerboard();
  }

  function updateCheckerboard() {
    elements.sourceWrap.classList.toggle("checker", elements.showCheckerboard.checked);
    localStorage.setItem("showCheckerboard", String(elements.showCheckerboard.checked));
  }

  function controlValueLabel(control) {
    return control.selectedOptions && control.selectedOptions.length ? control.selectedOptions[0].textContent.trim() : control.value;
  }

  function toggleStateLabel(checked) {
    return checked ? t("state.on") : t("state.off");
  }

  function cropStateLabel() {
    const crop = state.signalConfig.cropRect || { x: 0, y: 0, width: 1, height: 1 };
    return t("crop.summary", {
      left: (crop.x * 100).toFixed(1), top: (crop.y * 100).toFixed(1),
      width: (crop.width * 100).toFixed(1), height: (crop.height * 100).toFixed(1)
    });
  }

  function updateReliabilitySettings() {
    localStorage.setItem("autoReconnect", String(elements.autoReconnect.checked));
    localStorage.setItem("autoFullscreen", String(elements.autoFullscreen.checked));
    localStorage.setItem("rgbDisplayId", elements.rgbDisplaySelect.value);
    localStorage.setItem("alphaDisplayId", elements.alphaDisplaySelect.value);
  }

  async function populateDisplays() {
    const displays = await window.ndiClient.listDisplays();
    for (const select of [elements.rgbDisplaySelect, elements.alphaDisplaySelect]) {
      select.innerHTML = "";
      for (const display of displays) {
        const suffix = display.primary ? t("option.primaryDisplay") : "";
        const displayName = display.id === "browser" ? t("source.browser") : display.name || t("option.display", { number: display.ordinal || 1 });
        select.add(new Option(`${displayName}${suffix}`, display.id));
      }
    }
    const rgbSaved = localStorage.getItem("rgbDisplayId");
    const alphaSaved = localStorage.getItem("alphaDisplayId");
    if (rgbSaved && displays.some((display) => display.id === rgbSaved)) {
      elements.rgbDisplaySelect.value = rgbSaved;
    }
    if (alphaSaved && displays.some((display) => display.id === alphaSaved)) {
      elements.alphaDisplaySelect.value = alphaSaved;
    }
  }

  async function refreshBridgeStatus() {
    const status = await window.ndiClient.getStatus();
    state.bridgeAvailable = Boolean(status.available);
    elements.metricRuntime.textContent = status.runtime || "Browser";
    if (status.available) {
      setPill(elements.bridgeState, t("status.bridgeReady", { sdk: status.sdk ? ` ${status.sdk}` : "" }), "ok");
      elements.ndiHint.textContent = t("hint.ndiSearchReady");
    } else {
      setPill(elements.bridgeState, t("status.bridgeDisabled"), "warn");
      elements.ndiHint.textContent = t("hint.ndiBridgeMissing");
      elements.ndiHint.title = "";
    }
    elements.connectNdiBtn.disabled = !state.bridgeAvailable;
    return status;
  }

  async function refreshNdiSources() {
    elements.refreshNdiBtn.disabled = true;
    elements.connectNdiBtn.disabled = true;
    elements.ndiSourceSelect.innerHTML = "";
    const loading = new Option(t("option.searchingNdi"), "");
    elements.ndiSourceSelect.add(loading);

    try {
      await refreshBridgeStatus();
      const sources = await window.ndiClient.findSources();
      state.ndiSources = sources;
      elements.ndiSourceSelect.innerHTML = "";

      if (!sources.length) {
        elements.ndiSourceSelect.add(new Option(state.bridgeAvailable ? t("option.noNdiSources") : t("option.ndiUnavailable"), ""));
        log(state.bridgeAvailable ? t("log.ndiNotFound") : t("log.ndiSearchSkipped"), "warn");
        return;
      }

      for (const source of sources) {
        const label = source.name || source.id || "Unnamed NDI Source";
        elements.ndiSourceSelect.add(new Option(label, source.id || label));
      }
      log(t("log.ndiSourcesFound", { count: sources.length }));
    } catch (error) {
      elements.ndiSourceSelect.innerHTML = "";
      elements.ndiSourceSelect.add(new Option(t("option.ndiSearchFailed"), ""));
      log(t("log.ndiSearchFailed", { message: error.message }), "error");
    } finally {
      elements.refreshNdiBtn.disabled = false;
      elements.connectNdiBtn.disabled = !state.bridgeAvailable;
    }
  }

  async function connectNdiSource(id, reconnecting = false) {
    if (!id) {
      log(t("log.selectNdi"), "warn");
      return;
    }

    try {
      await window.ndiClient.stopUrl();
      clearObjectUrl();
      elements.hiddenVideo.pause();
      elements.hiddenVideo.removeAttribute("src");
      elements.hiddenImage.removeAttribute("src");
      state.ndiConnectedSource = await window.ndiClient.connect(id);
      state.currentSourceKey = `ndi:${id}`;
      state.selectedNdiSourceId = id;
      state.lastNdiSequence = "0";
      if (!reconnecting) {
        state.ndiHasFrame = false;
        state.placeholderDrawn = false;
      }
      state.ndiConnectedAt = performance.now();
      state.lastNdiFrameAt = 0;
      setMode("ndi", state.ndiConnectedSource.name || id);
      setPill(elements.signalState, reconnecting ? t("status.waitingRecovery") : t("status.waitingSignal"), "warn");
      elements.sourceMeta.textContent = reconnecting ? t("preview.waitingReconnect") : t("preview.waitingVideo");
      log(t("log.ndiConnected", { prefix: reconnecting ? t("log.reconnecting") : t("log.connecting"), source: elements.metricInput.textContent }));
    } catch (error) {
      log(t("log.ndiConnectFailed", { prefix: reconnecting ? t("log.reconnectNdi") : t("log.connectNdi"), message: error.message }), "error");
      if (!reconnecting) setPill(elements.signalState, t("status.connectionFailed"), "error");
    }
  }

  async function connectNdi() {
    await connectNdiSource(elements.ndiSourceSelect.value);
  }

  async function disconnectInput() {
    if (state.mode === "ndi") {
      await window.ndiClient.disconnect();
    } else if (state.mode === "url") {
      await window.ndiClient.stopUrl();
    }
    state.ndiConnectedSource = null;
    state.selectedNdiSourceId = null;
    state.ndiHasFrame = false;
    setPill(elements.signalState, t("status.signalIdle"), null);
    startTestPattern(false);
    log(t("log.disconnected"));
  }

  function startTestPattern(stopRemote = true) {
    if (stopRemote) {
      window.ndiClient.disconnect().catch(() => {});
      window.ndiClient.stopUrl().catch(() => {});
    }
    window.ndiClient.activateLocalSource().then((source) => {
      state.localGeneration = Number(source.generation || 0);
    }).catch((error) => log(t("log.sourceSwitchFailed", { message: error.message }), "error"));
    clearObjectUrl();
    elements.hiddenVideo.pause();
    elements.hiddenVideo.removeAttribute("src");
    elements.hiddenImage.removeAttribute("src");
    resizePipeline(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    state.currentSourceKey = "test";
    applyDetectedSignal({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT, frameRateN: 30, frameRateD: 1,
      pixelFormat: "RGBA", primaries: "rec709", range: "full", detectionSource: t("source.builtinTest"), confidence: "high" });
    state.frameDirty = true;
    setMode("test", t("source.test"));
    setPill(elements.signalState, t("status.localSignal"), "ok");
    elements.sourceMeta.textContent = t("preview.testSignal", { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
  }

  async function loadLocalFile(file) {
    if (!file) return;
    await window.ndiClient.disconnect().catch(() => {});
    await window.ndiClient.stopUrl().catch(() => {});
    const localSource = await window.ndiClient.activateLocalSource();
    state.localGeneration = Number(localSource.generation || 0);
    clearObjectUrl();
    state.objectUrl = URL.createObjectURL(file);

    if (file.type.startsWith("image/")) {
      elements.hiddenVideo.pause();
      elements.hiddenVideo.removeAttribute("src");
      elements.hiddenImage.src = state.objectUrl;
      elements.hiddenImage.onload = () => {
        state.currentSourceKey = `file:${file.name}`;
        applyDetectedSignal({ width: elements.hiddenImage.naturalWidth, height: elements.hiddenImage.naturalHeight,
          frameRateN: 1, frameRateD: 1, pixelFormat: file.type || "image", primaries: "rec709", range: "full",
          detectionSource: t("source.browserMedia"), confidence: "medium" });
        state.imageDrawn = false;
        setMode("image", file.name);
        setPill(elements.signalState, t("status.localSignal"), "ok");
        elements.sourceMeta.textContent = t("preview.imageSignal", { width: elements.hiddenImage.naturalWidth, height: elements.hiddenImage.naturalHeight });
        log(t("log.imageLoaded", { name: file.name }));
      };
      return;
    }

    elements.hiddenImage.removeAttribute("src");
    elements.hiddenVideo.src = state.objectUrl;
    elements.hiddenVideo.onerror = () => {
      log(t("log.videoDecodeFailed", { name: file.name }), "error");
      startTestPattern();
    };

    try {
      await elements.hiddenVideo.play();
      setMode("video", file.name);
      const w = elements.hiddenVideo.videoWidth || DEFAULT_WIDTH;
      const h = elements.hiddenVideo.videoHeight || DEFAULT_HEIGHT;
      state.currentSourceKey = `file:${file.name}`;
      applyDetectedSignal({ width: w, height: h, frameRateN: 30, frameRateD: 1, pixelFormat: file.type || "video",
        primaries: "rec709", range: "full", detectionSource: t("source.browserMedia"), confidence: "low" });
      setPill(elements.signalState, t("status.localSignal"), "ok");
      resizePipeline(w, h);
      state.lastMediaTime = -1;
      elements.sourceMeta.textContent = t("preview.videoSignal", { width: w, height: h });
      log(t("log.videoLoaded", { name: file.name }));
    } catch (error) {
      log(t("log.videoPlayFailed", { message: error.message }), "error");
    }
  }

  function drawTestPattern() {
    const t = state.frame / 60;
    const width = state.width;
    const height = state.height;
    ctx.source.clearRect(0, 0, width, height);

    for (let x = 0; x < width; x += 80) {
      ctx.source.fillStyle = x % 160 === 0 ? "#ff5f7a" : "#20b8a6";
      ctx.source.globalAlpha = 0.26;
      ctx.source.fillRect(x, 0, 40, height);
    }

    const cx = width * 0.5 + Math.sin(t * 0.85) * 210;
    const cy = height * 0.5 + Math.cos(t * 0.7) * 110;
    const alpha = 0.25 + (Math.sin(t * 1.4) + 1) * 0.35;

    ctx.source.globalAlpha = alpha;
    ctx.source.fillStyle = "#ffffff";
    ctx.source.beginPath();
    ctx.source.arc(cx, cy, 150, 0, Math.PI * 2);
    ctx.source.fill();

    ctx.source.globalAlpha = 0.72;
    ctx.source.fillStyle = "#f0b64d";
    ctx.source.fillRect(130 + Math.sin(t) * 60, 130, 320, 180);

    ctx.source.globalAlpha = 0.9;
    ctx.source.font = "700 56px Segoe UI, Arial";
    ctx.source.fillStyle = "#eef3f4";
    ctx.source.fillText("RGB ALPHA TEST", 94, 420);
    ctx.source.font = "28px Segoe UI, Arial";
    ctx.source.globalAlpha = 0.62;
    ctx.source.fillText("RGB + Alpha split preview", 98, 462);
    ctx.source.globalAlpha = 1;
  }

  function drawMediaElement(element) {
    const sw = element.videoWidth || element.naturalWidth || DEFAULT_WIDTH;
    const sh = element.videoHeight || element.naturalHeight || DEFAULT_HEIGHT;
    resizePipeline(sw, sh);
    const width = state.width;
    const height = state.height;
    ctx.source.clearRect(0, 0, width, height);
    const scale = Math.min(width / sw, height / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.source.drawImage(element, (width - dw) / 2, (height - dh) / 2, dw, dh);
  }

  function drawNdiPlaceholder() {
    ctx.source.clearRect(0, 0, state.width, state.height);
    ctx.source.fillStyle = "#071014";
    ctx.source.fillRect(0, 0, state.width, state.height);
    ctx.source.fillStyle = "#20b8a6";
    ctx.source.font = "700 42px Segoe UI, Arial";
    ctx.source.fillText("NDI CONNECTED", 96, 238);
    ctx.source.fillStyle = "rgba(238,243,244,0.72)";
    ctx.source.font = "24px Segoe UI, Arial";
    ctx.source.fillText(t("preview.waitingNdi"), 98, 286);
  }

  function splitFrame() {
    splitRenderers.rgb.render(elements.sourceCanvas, state.alphaGain, state.invertAlpha, state.signalConfig);
    splitRenderers.alpha.render(elements.sourceCanvas, state.alphaGain, state.invertAlpha, state.signalConfig);
    state.frameDirty = false;
  }

  function requestNdiFrame() {
    if (state.ndiFramePending) return;
    const now = performance.now();
    const outputsActive = state.rgbOutput || state.alphaOutput;
    if (outputsActive && state.signalConfig.previewPolicy === "paused") return;
    if (outputsActive && state.signalConfig.previewPolicy === "lightweight" && now - state.lastPreviewPollAt < 66) return;
    state.lastPreviewPollAt = now;
    state.ndiFramePending = true;
    window.ndiClient.getFrame(state.lastNdiSequence).then((frame) => {
      if (!frame || (state.mode !== "ndi" && state.mode !== "url")) return;
      const width = Number(frame.width);
      const height = Number(frame.height);
      resizePipeline(width, height);
      const bytes = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data);
      const pixels = new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      ctx.source.putImageData(new ImageData(pixels, width, height), 0, 0);
      state.lastNdiSequence = String(frame.sequence);
      state.ndiHasFrame = true;
      state.ndiHasAlpha = Boolean(frame.hasAlpha);
      if (frame.detectedSignal) applyDetectedSignal(frame.detectedSignal);
      state.lastNdiFrameAt = performance.now();
      setPill(elements.signalState, state.mode === "url" ? t("status.urlNormal") : t("status.ndiNormal"), "ok");
      state.frameDirty = true;
      const fps = frame.frameRateD ? frame.frameRateN / frame.frameRateD : 0;
      elements.sourceMeta.textContent = t("preview.liveSignal", {
        width, height, fps: fps.toFixed(2), alpha: state.ndiHasAlpha ? t("preview.hasAlpha") : t("preview.noAlpha")
      });
    }).catch((error) => {
      log(t("log.ndiFrameFailed", { message: error.message }), "error");
    }).finally(() => {
      state.ndiFramePending = false;
    });
  }

  async function runWatchdog() {
    if (state.watchdogPending || state.mode !== "ndi") return;
    state.watchdogPending = true;
    try {
      const status = await window.ndiClient.getReceiverStatus();
      if (state.mode !== "ndi") return;
      elements.metricConnections.textContent = String(status.connections || 0);
      elements.metricReceived.textContent = Number(status.receivedVideoFrames || 0).toLocaleString();
      elements.metricDropped.textContent = Number(status.droppedVideoFrames || 0).toLocaleString();
      elements.metricQueue.textContent = String(status.queuedVideoFrames || 0);

      const now = performance.now();
      const age = status.lastFrameAgeMs >= 0
        ? Number(status.lastFrameAgeMs)
        : state.lastNdiFrameAt
          ? now - state.lastNdiFrameAt
          : now - state.ndiConnectedAt;
      if (age > 2000) {
        setPill(elements.signalState, t("status.signalInterrupted", { seconds: Math.floor(age / 1000) }), "error");
      }

      const canReconnect = elements.autoReconnect.checked &&
        state.selectedNdiSourceId && age > 5000 && now - state.lastReconnectAt > 10000;
      if (canReconnect) {
        state.lastReconnectAt = now;
        state.reconnectAttempts += 1;
        elements.metricReconnects.textContent = String(state.reconnectAttempts);
        await connectNdiSource(state.selectedNdiSourceId, true);
      }
    } catch (error) {
      log(t("log.ndiMonitorFailed", { message: error.message }), "error");
    } finally {
      state.watchdogPending = false;
    }
  }

  function publishLocalFrame(now, force = false) {
    if (state.mode === "ndi" || state.mode === "url" || state.localPublishPending >= 2 || (!state.rgbOutput && !state.alphaOutput)) return;
    const interval = 1000 * Number(state.signalConfig.frameRateD || 1) / Number(state.signalConfig.frameRateN || 30);
    if (!force && now + 0.5 < state.nextLocalPublishAt) return;
    state.nextLocalPublishAt = force ? now + interval : Math.max(now + interval * 0.25, state.nextLocalPublishAt + interval);
    state.lastLocalPublishAt = now;
    state.localPublishPending += 1;
    const image = ctx.source.getImageData(0, 0, state.width, state.height);
    const published = window.ndiClient.publishLocalFrameFast({
      width: state.width,
      height: state.height,
      frameRateN: Number(state.signalConfig.frameRateN || 30),
      frameRateD: Number(state.signalConfig.frameRateD || 1),
      data: new Uint8Array(image.data.buffer)
      ,generation: state.localGeneration
      ,hasAlpha: false
    });
    if (published) state.localPublishedFrames += 1;
    document.body.dataset.localPublish = `${published}:${state.localGeneration}:${state.localPublishedFrames}`;
    state.localPublishPending = Math.max(0, state.localPublishPending - 1);
  }

  async function updateSignalConfig() {
    state.signalConfig = await window.ndiClient.setSignalConfig({
      outputResolution: elements.outputResolution.value,
      customOutputWidth: Number(elements.customOutputWidth.value),
      customOutputHeight: Number(elements.customOutputHeight.value),
      outputFrameRate: elements.outputFrameRate.value,
      scanMode: elements.scanMode.value,
      scalingMode: elements.scalingMode.value,
      cropRect: state.signalConfig.cropRect,
      sourcePrimaries: elements.sourcePrimaries.value,
      sourceRange: elements.sourceRange.value,
      outputPrimaries: elements.outputPrimaries.value,
      outputRange: elements.outputRange.value,
      gpuPreference: elements.gpuPreference.value.startsWith("adapter:") ? "specific" : elements.gpuPreference.value,
      gpuAdapterLuid: elements.gpuPreference.value.startsWith("adapter:") ? elements.gpuPreference.value.slice(8) : "",
      previewPolicy: elements.previewPolicy.value,
      syncMode: elements.syncMode.value,
      autoColor: state.signalConfig.autoColor,
      manualColorLocked: state.signalConfig.manualColorLocked
    });
    localStorage.setItem("signalConfig", JSON.stringify(state.signalConfig));
    localStorage.setItem(`sourceGeometry:${state.currentSourceKey}`, JSON.stringify({
      scalingMode: state.signalConfig.scalingMode, cropRect: state.signalConfig.cropRect
    }));
    renderSignalHint();
    elements.scanMode.value = state.signalConfig.scanSelection || "progressive";
    elements.customOutputResolution.hidden = state.signalConfig.outputResolution !== "custom";
    updatePreviewDimensions();
    const interlaceAllowed = state.signalConfig.outputHeight === 1080;
    for (const option of elements.scanMode.options) option.disabled = option.value !== "progressive" && !interlaceAllowed;
    const cropEnabled = state.signalConfig.scalingMode === "crop";
    elements.cropControls.hidden = !cropEnabled;
    elements.cropOverlay.hidden = !cropEnabled;
    renderCropOverlay();
    state.frameDirty = true;
  }

  function sourceColorKey() {
    return `sourceColor:${state.currentSourceKey}`;
  }

  function renderSignalHint() {
    const formatLabel = state.signalConfig.formatPreset || `${state.signalConfig.outputWidth || state.width}x${state.signalConfig.outputHeight || state.height} @ ${state.signalConfig.outputFrameRate || 30} fps`;
    elements.signalHint.textContent = `${controlValueLabel(elements.outputPrimaries)} ${controlValueLabel(elements.outputRange)} SDR · ${formatLabel}`;
  }

  function renderDetectionState() {
    if (state.signalConfig.manualColorLocked) {
      elements.colorDetectionState.textContent = t("status.manualLocked");
      return;
    }
    if (!state.detectedSignal) {
      elements.colorDetectionState.textContent = t("status.waitingInput");
      return;
    }
    let detectionSource = state.detectedSignal.detectionSource;
    if (state.mode === "test") detectionSource = t("source.builtinTest");
    else if (state.mode === "image" || state.mode === "video") detectionSource = t("source.browserMedia");
    else if (!detectionSource) detectionSource = t("source.pixelFormatInference");
    elements.colorDetectionState.textContent = `${detectionSource} · ${t(`detection.${state.detectedSignal.confidence || "low"}`)}`;
  }

  function parseMetadataColor(metadata) {
    if (!metadata || typeof DOMParser === "undefined") return null;
    try {
      const documentNode = new DOMParser().parseFromString(metadata, "application/xml");
      if (documentNode.querySelector("parsererror")) return null;
      const values = Array.from(documentNode.querySelectorAll("*")).flatMap((node) =>
        [node.textContent, ...Array.from(node.attributes).map((attribute) => `${attribute.name}=${attribute.value}`)]
      ).join(" ").toLowerCase();
      const primaries = /(?:rec|bt)[ ._-]?2020/.test(values) ? "rec2020" : /(?:rec|bt)[ ._-]?709/.test(values) ? "rec709" : null;
      const range = /(?:range|levels?)[ =:_-]*(?:full|pc|jpeg)/.test(values) ? "full" :
        /(?:range|levels?)[ =:_-]*(?:limited|video|tv)/.test(values) ? "limited" : null;
      return primaries || range ? { primaries, range, detectionSource: t("detection.ndiXml"), confidence: "high" } : null;
    } catch (_) {
      return null;
    }
  }

  function applyDetectedSignal(detected, force = false) {
    if (!detected) return;
    const metadataColor = parseMetadataColor(detected.metadata);
    const signature = `${state.currentSourceKey}|${detected.width}x${detected.height}|${detected.frameRateN}/${detected.frameRateD}|${detected.pixelFormat}|${metadataColor ? `${metadataColor.primaries}/${metadataColor.range}` : "none"}`;
    if (!force && signature === state.lastDetectedSignature) return;
    state.lastDetectedSignature = signature;
    state.detectedSignal = detected;
    const savedGeometry = JSON.parse(localStorage.getItem(`sourceGeometry:${state.currentSourceKey}`) || "null");
    if (savedGeometry) {
      state.signalConfig.scalingMode = savedGeometry.scalingMode || state.signalConfig.scalingMode;
      state.signalConfig.cropRect = savedGeometry.cropRect || state.signalConfig.cropRect;
      elements.scalingMode.value = state.signalConfig.scalingMode;
    }
    const inferred = {
      primaries: metadataColor && metadataColor.primaries || detected.primaries || "rec709",
      range: metadataColor && metadataColor.range || detected.range || (/UYVY|UYVA|P216|PA16|NV12|I420|YV12/i.test(detected.pixelFormat || "") ? "limited" : "full"),
      detectionSource: metadataColor && metadataColor.detectionSource || detected.detectionSource || t("source.pixelFormatInference"),
      confidence: metadataColor && metadataColor.confidence || detected.confidence || "low"
    };
    const saved = JSON.parse(localStorage.getItem(sourceColorKey()) || "null");
    if (saved && saved.manualColorLocked) {
      state.signalConfig.manualColorLocked = true;
      state.signalConfig.autoColor = false;
      elements.sourcePrimaries.value = saved.sourcePrimaries;
      elements.sourceRange.value = saved.sourceRange;
      renderDetectionState();
    } else if (!state.signalConfig.manualColorLocked) {
      state.signalConfig.autoColor = true;
      elements.sourcePrimaries.value = inferred.primaries;
      elements.sourceRange.value = inferred.range;
      state.detectedSignal = { ...state.detectedSignal, detectionSource: inferred.detectionSource, confidence: inferred.confidence };
      renderDetectionState();
    }
    updateSignalConfig().catch((error) => log(t("log.autoSignalFailed", { message: error.message }), "error"));
  }

  function cropFromInputs() {
    const left = Math.min(99.9, Math.max(0, Number(elements.cropLeft.value) || 0)) / 100;
    const top = Math.min(99.9, Math.max(0, Number(elements.cropTop.value) || 0)) / 100;
    const right = Math.min(99.9, Math.max(0, Number(elements.cropRight.value) || 0)) / 100;
    const bottom = Math.min(99.9, Math.max(0, Number(elements.cropBottom.value) || 0)) / 100;
    state.signalConfig.cropRect = { x: left, y: top, width: Math.max(0.001, 1 - left - right), height: Math.max(0.001, 1 - top - bottom) };
    renderCropOverlay();
  }

  function cropSourceDimensions() {
    return {
      width: Math.max(1, Number(state.detectedSignal && state.detectedSignal.width) || state.width),
      height: Math.max(1, Number(state.detectedSignal && state.detectedSignal.height) || state.height)
    };
  }

  function renderCropOverlay() {
    const rect = state.signalConfig.cropRect || { x: 0, y: 0, width: 1, height: 1 };
    elements.cropSelection.style.left = `${rect.x * 100}%`;
    elements.cropSelection.style.top = `${rect.y * 100}%`;
    elements.cropSelection.style.width = `${rect.width * 100}%`;
    elements.cropSelection.style.height = `${rect.height * 100}%`;
    elements.cropLeft.value = (rect.x * 100).toFixed(1);
    elements.cropTop.value = (rect.y * 100).toFixed(1);
    elements.cropRight.value = ((1 - rect.x - rect.width) * 100).toFixed(1);
    elements.cropBottom.value = ((1 - rect.y - rect.height) * 100).toFixed(1);
    const label = elements.cropSelection.querySelector(".crop-size-label");
    const source = cropSourceDimensions();
    if (label) label.textContent = `${Math.round(source.width * rect.width)} × ${Math.round(source.height * rect.height)}`;
  }

  function bindCropEditor() {
    let drag = null;
    const sizeLabel = document.createElement("span");
    sizeLabel.className = "crop-size-label";
    elements.cropSelection.append(sizeLabel);
    for (const handle of ["n", "ne", "e", "se", "s", "sw", "w", "nw"]) {
      const node = document.createElement("span");
      node.className = "crop-handle";
      node.dataset.handle = handle;
      node.setAttribute("aria-hidden", "true");
      elements.cropSelection.append(node);
    }
    const position = (event) => {
      const bounds = elements.cropOverlay.getBoundingClientRect();
      return { x: Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width)),
        y: Math.min(1, Math.max(0, (event.clientY - bounds.top) / bounds.height)) };
    };
    elements.cropOverlay.addEventListener("pointerdown", (event) => {
      const start = position(event);
      const rect = { ...state.signalConfig.cropRect };
      const handleNode = event.target.closest && event.target.closest(".crop-handle");
      drag = { start, original: rect, handle: handleNode && handleNode.dataset.handle,
        move: !handleNode && elements.cropSelection.contains(event.target) };
      elements.cropOverlay.setPointerCapture(event.pointerId);
    });
    elements.cropOverlay.addEventListener("pointermove", (event) => {
      if (!drag) return;
      const point = position(event);
      let rect;
      if (drag.move) {
        rect = { ...drag.original, x: Math.min(1 - drag.original.width, Math.max(0, drag.original.x + point.x - drag.start.x)),
          y: Math.min(1 - drag.original.height, Math.max(0, drag.original.y + point.y - drag.start.y)) };
      } else if (drag.handle) {
        const original = drag.original;
        let left = original.x;
        let top = original.y;
        let right = original.x + original.width;
        let bottom = original.y + original.height;
        const source = cropSourceDimensions();
        const minWidth = Math.min(1, 8 / source.width);
        const minHeight = Math.min(1, 8 / source.height);
        if (drag.handle.includes("w")) left = Math.min(right - minWidth, point.x);
        if (drag.handle.includes("e")) right = Math.max(left + minWidth, point.x);
        if (drag.handle.includes("n")) top = Math.min(bottom - minHeight, point.y);
        if (drag.handle.includes("s")) bottom = Math.max(top + minHeight, point.y);
        left = Math.max(0, left); top = Math.max(0, top); right = Math.min(1, right); bottom = Math.min(1, bottom);
        if (elements.cropLockAspect.checked) {
          const pixelAspect = Number(state.signalConfig.outputWidth || 1920) / Number(state.signalConfig.outputHeight || 1080);
          const normalizedAspect = pixelAspect * source.height / source.width;
          if (drag.handle.length === 2) {
            const anchorX = drag.handle.includes("w") ? original.x + original.width : original.x;
            const anchorY = drag.handle.includes("n") ? original.y + original.height : original.y;
            let width = Math.max(minWidth, Math.abs(point.x - anchorX));
            let height = Math.max(minHeight, Math.abs(point.y - anchorY));
            if (width / height > normalizedAspect) height = width / normalizedAspect;
            else width = height * normalizedAspect;
            width = Math.min(width, drag.handle.includes("w") ? anchorX : 1 - anchorX);
            height = Math.min(height, drag.handle.includes("n") ? anchorY : 1 - anchorY);
            if (width / height > normalizedAspect) width = height * normalizedAspect;
            else height = width / normalizedAspect;
            left = drag.handle.includes("w") ? anchorX - width : anchorX;
            right = drag.handle.includes("w") ? anchorX : anchorX + width;
            top = drag.handle.includes("n") ? anchorY - height : anchorY;
            bottom = drag.handle.includes("n") ? anchorY : anchorY + height;
          } else if (drag.handle === "e" || drag.handle === "w") {
            let width = right - left;
            let height = width / normalizedAspect;
            const center = original.y + original.height / 2;
            height = Math.min(height, 2 * Math.min(center, 1 - center));
            width = height * normalizedAspect;
            if (drag.handle === "w") left = right - width; else right = left + width;
            top = center - height / 2; bottom = center + height / 2;
          } else {
            let height = bottom - top;
            let width = height * normalizedAspect;
            const center = original.x + original.width / 2;
            width = Math.min(width, 2 * Math.min(center, 1 - center));
            height = width / normalizedAspect;
            if (drag.handle === "n") top = bottom - height; else bottom = top + height;
            left = center - width / 2; right = center + width / 2;
          }
        }
        rect = { x: left, y: top, width: Math.max(minWidth, right - left), height: Math.max(minHeight, bottom - top) };
      } else {
        let width = Math.abs(point.x - drag.start.x);
        let height = Math.abs(point.y - drag.start.y);
        if (elements.cropLockAspect.checked && width > 0.001) {
          const targetAspect = Number(state.signalConfig.outputWidth || 1920) / Number(state.signalConfig.outputHeight || 1080);
          const source = cropSourceDimensions();
          height = Math.min(1, width * source.width / (targetAspect * source.height));
        }
        rect = { x: point.x >= drag.start.x ? drag.start.x : drag.start.x - width,
          y: point.y >= drag.start.y ? drag.start.y : drag.start.y - height, width, height };
        rect.x = Math.min(1 - rect.width, Math.max(0, rect.x));
        rect.y = Math.min(1 - rect.height, Math.max(0, rect.y));
      }
      if (rect.width >= 0.001 && rect.height >= 0.001) state.signalConfig.cropRect = rect;
      renderCropOverlay();
    });
    const finish = () => {
      if (!drag) return;
      drag = null;
      updateSignalConfig()
        .then(() => log(t("log.cropUpdated", { crop: cropStateLabel() })))
        .catch((error) => log(t("log.cropFailed", { message: error.message }), "error"));
    };
    elements.cropOverlay.addEventListener("pointerup", finish);
    elements.cropOverlay.addEventListener("pointercancel", finish);
  }

  async function initializeSystemInfo() {
    const [appInfo, engine, signal, logs] = await Promise.all([
      window.ndiClient.getAppInfo(), window.ndiClient.getEngineStatus(), window.ndiClient.getSignalConfig(), window.ndiClient.getLogStatus()
    ]);
    elements.versionState.textContent = `v${appInfo.version}`;
    setPill(elements.engineState, engine.backend === "gpu" ? t("status.gpuBackend") : t("status.compatibilityBackend"), engine.backend === "gpu" ? "ok" : "warn");
    elements.engineState.title = engine.reason || "";
    for (const [value, resolution] of Object.entries(signal.resolutions || {})) {
      elements.outputResolution.add(new Option(value === "custom" ? t("option.custom") : resolution.label, value));
    }
    for (const value of Object.keys(signal.frameRates || {})) elements.outputFrameRate.add(new Option(`${value} fps`, value));
    for (const adapter of signal.adapters || []) {
      if (adapter.software) continue;
      const memoryGb = Number(adapter.dedicatedMemory || 0) / 1024 / 1024 / 1024;
      elements.gpuPreference.add(new Option(`${adapter.name}${memoryGb ? ` (${memoryGb.toFixed(1)} GB)` : ""}`, `adapter:${adapter.luid}`));
    }
    const saved = JSON.parse(localStorage.getItem("signalConfig") || "null");
    const config = { ...signal.config, ...(saved || {}) };
    for (const key of ["outputResolution", "outputFrameRate", "scalingMode", "sourcePrimaries", "sourceRange", "outputPrimaries", "outputRange", "previewPolicy", "syncMode"]) {
      if (config[key] && elements[key]) elements[key].value = config[key];
    }
    elements.gpuPreference.value = config.gpuPreference === "specific" && config.gpuAdapterLuid ?
      `adapter:${config.gpuAdapterLuid}` : config.gpuPreference || "high-performance";
    elements.scanMode.value = config.scanSelection || "progressive";
    state.signalConfig = config;
    elements.customOutputWidth.value = String(config.outputWidth || 1920);
    elements.customOutputHeight.value = String(config.outputHeight || 1080);
    elements.logPathState.dataset.fallback = String(Boolean(logs.fallback));
    elements.logPathState.textContent = logs.fallback ? t("state.userLogs") : t("state.installLogs");
    elements.logPathState.title = logs.directory || "";
    await updateSignalConfig();
  }

  function updateMetrics(now) {
    if (now - state.lastFpsTime >= 1000) {
      elements.frameRate.textContent = t("status.previewFps", { fps: state.framesThisSecond });
      state.framesThisSecond = 0;
      state.lastFpsTime = now;
    }
    elements.metricFrameTime.textContent = `${state.lastFrameMs.toFixed(1)} ms`;
    elements.metricResolution.textContent = `${state.width} x ${state.height}`;
  }

  function tick(now) {
    const started = performance.now();
    const outputsActive = state.rgbOutput || state.alphaOutput;
    const previewPaused = outputsActive && state.signalConfig.previewPolicy === "paused";
    const localInterval = 1000 * Number(state.signalConfig.frameRateD || 1) / Number(state.signalConfig.frameRateN || 30);
    const localSourceDue = !outputsActive || now + 0.5 >= state.nextLocalSourceAt;
    if (localSourceDue) state.nextLocalSourceAt = Math.max(now + localInterval * 0.25, state.nextLocalSourceAt + localInterval);
    let sourceUpdated = false;

    if (state.mode === "test" && localSourceDue) {
      drawTestPattern();
      state.frameDirty = true;
      state.lastLocalSourceAt = now;
      sourceUpdated = true;
    } else if (state.mode === "video" && localSourceDue && elements.hiddenVideo.readyState >= 2) {
      if (elements.hiddenVideo.currentTime !== state.lastMediaTime) {
        state.lastMediaTime = elements.hiddenVideo.currentTime;
        drawMediaElement(elements.hiddenVideo);
        state.frameDirty = true;
        state.lastLocalSourceAt = now;
        sourceUpdated = true;
      }
    } else if (state.mode === "image" && elements.hiddenImage.complete && elements.hiddenImage.naturalWidth) {
      if (!state.imageDrawn) {
        drawMediaElement(elements.hiddenImage);
        state.imageDrawn = true;
        state.frameDirty = true;
        sourceUpdated = true;
      }
    } else if (state.mode === "ndi" || state.mode === "url") {
      requestNdiFrame();
      if (!state.ndiHasFrame && !state.placeholderDrawn) {
        drawNdiPlaceholder();
        state.placeholderDrawn = true;
        state.frameDirty = true;
        sourceUpdated = true;
      }
    }

    if (sourceUpdated) publishLocalFrame(now);
    if (state.frameDirty && !previewPaused) {
      const lightweight = outputsActive && state.signalConfig.previewPolicy === "lightweight";
      const previewDue = !lightweight || now - state.lastPreviewRenderAt >= 66 || !sourceUpdated;
      if (previewDue) {
        splitFrame();
        state.lastPreviewRenderAt = now;
        state.framesThisSecond += 1;
      } else {
        state.frameDirty = false;
      }
    } else if (previewPaused) {
      state.frameDirty = false;
    }
    state.frame += 1;
    state.lastFrameMs = performance.now() - started;
    updateMetrics(now);
  }

  async function openOutput(kind, forceFullscreen = false) {
    const title = kind === "rgb" ? "RGB Output" : "Alpha Output";
    const displayId = kind === "rgb" ? elements.rgbDisplaySelect.value : elements.alphaDisplaySelect.value;
    const opened = await window.ndiClient.openOutput({
      kind,
      displayId,
      fullscreen: forceFullscreen || elements.autoFullscreen.checked
    });
    if (!opened) {
      log(t("log.desktopOnly", { title }), "error");
      return false;
    }
    if (kind === "rgb") state.rgbOutput = true;
    else state.alphaOutput = true;
    if (state.mode !== "ndi" && state.mode !== "url") publishLocalFrame(performance.now(), true);
    log(t("log.outputOpened", { title }));
    return true;
  }

  async function requestOutputFullscreen() {
    const [rgbOpened, alphaOpened] = await Promise.all([
      openOutput("rgb", true),
      openOutput("alpha", true)
    ]);
    state.rgbOutput = rgbOpened;
    state.alphaOutput = alphaOpened;
    if (rgbOpened || alphaOpened) log(t("log.allOutputsOpened"));
  }

  async function refreshOutputStatus() {
    const status = await window.ndiClient.getOutputStatus();
    const outputsChanged = state.rgbOutput !== Boolean(status.rgb) || state.alphaOutput !== Boolean(status.alpha);
    state.rgbOutput = Boolean(status.rgb);
    state.alphaOutput = Boolean(status.alpha);
    elements.metricRgbOutputFps.textContent = Number(status.rgbFps || 0).toFixed(1);
    elements.metricAlphaOutputFps.textContent = Number(status.alphaFps || 0).toFixed(1);
    const presenter = status.presenter || {};
    elements.metricGpuAdapter.textContent = presenter.adapterName || t("status.compatibilityBackend");
    elements.metricGpuAdapter.title = presenter.adapterLuid || presenter.lastError || "";
    elements.metricGpuQueue.textContent = String(Number(presenter.queueDepth || 0));
    elements.metricGpuOverwritten.textContent = Number(presenter.overwrittenFrames || 0).toLocaleString();
    elements.metricGpuP95.textContent = `${Number(presenter.p95FrameMs || 0).toFixed(2)} ms`;
    elements.metricSyncMode.textContent = presenter.frameSyncActive ? t("state.frameSync") : t("state.lowLatency");
    elements.metricClockSource.textContent = presenter.clockSource || "host-monotonic";
    elements.metricClockJitter.textContent = `${Number(presenter.tickJitterUs || 0).toFixed(0)} us`;
    elements.metricPresentSkew.textContent = `${Number(presenter.pairedPresentSkewUs || 0).toFixed(0)} us`;
    recordDiagnosticMetrics(status, presenter);
    if (outputsChanged) updatePreviewDimensions();
  }

  async function refreshLocalizedUi() {
    initializeDiagnosticCharts();
    renderDiagnosticCharts();
    const customResolution = Array.from(elements.outputResolution.options).find((option) => option.value === "custom");
    if (customResolution) customResolution.textContent = t("option.custom");
    if (elements.logPathState.dataset.fallback) {
      elements.logPathState.textContent = elements.logPathState.dataset.fallback === "true" ? t("state.userLogs") : t("state.installLogs");
    }
    renderDetectionState();
    renderSignalHint();
    if (state.mode === "test") {
      setMode("test", t("source.test"));
      setPill(elements.signalState, t("status.localSignal"), "ok");
      elements.sourceMeta.textContent = t("preview.testSignal", { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
    } else if (state.mode === "image") {
      setPill(elements.signalState, t("status.localSignal"), "ok");
      elements.sourceMeta.textContent = t("preview.imageSignal", { width: state.width, height: state.height });
    } else if (state.mode === "video") {
      setPill(elements.signalState, t("status.localSignal"), "ok");
      elements.sourceMeta.textContent = t("preview.videoSignal", { width: state.width, height: state.height });
    }
    elements.frameRate.textContent = t("status.previewFps", { fps: state.framesThisSecond });
    const [engine, urlStatus] = await Promise.all([
      window.ndiClient.getEngineStatus(), window.ndiClient.getUrlStatus()
    ]);
    setPill(elements.engineState, engine.backend === "gpu" ? t("status.gpuBackend") : t("status.compatibilityBackend"), engine.backend === "gpu" ? "ok" : "warn");
    elements.engineState.title = engine.reason || "";
    await refreshBridgeStatus();
    await populateDisplays();
    if (state.mode === "url") handleUrlStatus(urlStatus);
    await refreshOutputStatus();
  }

  function saveSnapshot() {
    // Re-render synchronously because WebGL uses a non-persistent drawing buffer.
    state.frameDirty = true;
    splitFrame();
    const link = document.createElement("a");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `alpha-split-${timestamp}.png`;
    link.href = elements.rgbCanvas.toDataURL("image/png");
    link.click();
    log(t("log.snapshotSaved", { name: link.download }));
  }

  function bindEvents() {
    elements.themeMode.addEventListener("change", () => {
      applyTheme(elements.themeMode.value);
      log(t("log.themeChanged", { value: controlValueLabel(elements.themeMode) }));
    });
    window.addEventListener("i18n:changed", () => {
      refreshLocalizedUi()
        .then(() => log(t("log.languageChanged", { value: controlValueLabel(elements.languageMode) })))
        .catch((error) => log(t("log.signalFailed", { message: error.message }), "warn"));
    });
    for (const button of elements.inspectorTabs) {
      button.addEventListener("click", () => setActiveInspectorPanel(button.dataset.inspectorTab));
    }
    for (const input of elements.diagnosticMetricInputs) {
      input.addEventListener("change", () => {
        let selected = selectedDiagnosticMetrics();
        if (!selected.length) {
          input.checked = true;
          selected = [input.value];
        }
        localStorage.setItem("diagnosticChartMetrics", JSON.stringify(selected));
        renderDiagnosticCharts();
      });
    }
    elements.openLogsBtn.addEventListener("click", () => window.ndiClient.openLogDirectory());
    elements.ndiModeBtn.addEventListener("click", async () => {
      if (state.mode === "url") await stopUrlSource(true);
      setInputMode("ndi");
      log(t("log.inputNdi"));
    });
    elements.urlModeBtn.addEventListener("click", () => {
      setInputMode("url");
      log(t("log.inputUrl"));
    });
    elements.urlAllowLan.addEventListener("change", () => {
      localStorage.setItem("urlAllowLan", String(elements.urlAllowLan.checked));
      log(t("log.lanAccess", { value: toggleStateLabel(elements.urlAllowLan.checked) }));
    });
    elements.urlTransparent.addEventListener("change", () => {
      log(t("log.transparentBackground", { value: toggleStateLabel(elements.urlTransparent.checked) }));
    });
    elements.loadUrlBtn.addEventListener("click", startUrlSource);
    elements.refreshUrlBtn.addEventListener("click", async () => {
      const refreshed = await window.ndiClient.refreshUrl();
      if (refreshed) log(t("log.urlRefreshed"));
    });
    elements.stopUrlBtn.addEventListener("click", () => stopUrlSource(true));
    elements.urlViewportMode.addEventListener("change", () => {
      elements.urlViewportCustom.hidden = elements.urlViewportMode.value !== "custom";
      log(t("log.viewportMode", { value: controlValueLabel(elements.urlViewportMode) }));
    });
    for (const input of [elements.urlViewportWidth, elements.urlViewportHeight]) {
      input.addEventListener("change", async () => {
        if (elements.urlViewportMode.value === "custom") {
          const width = Number(elements.urlViewportWidth.value);
          const height = Number(elements.urlViewportHeight.value);
          try {
            await window.ndiClient.setUrlViewport({ mode: "custom", width, height });
            log(t("log.viewportUpdated", { width, height }));
          } catch (error) {
            log(t("log.viewportFailed", { message: error.message }), "error");
          }
        }
      });
    }
    elements.urlInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") startUrlSource();
    });
    const signalControls = new Map([
      [elements.outputResolution, "control.outputResolution"], [elements.outputFrameRate, "control.outputFrameRate"],
      [elements.scanMode, "control.scanMode"], [elements.scalingMode, "control.scalingMode"],
      [elements.outputPrimaries, "control.outputPrimaries"], [elements.outputRange, "control.outputRange"],
      [elements.gpuPreference, "control.gpuPreference"], [elements.previewPolicy, "control.previewPolicy"],
      [elements.syncMode, "control.syncMode"]
    ]);
    for (const [control, label] of signalControls) {
      control.addEventListener("change", async () => {
        try {
          await updateSignalConfig();
          log(t("log.controlChanged", { label: t(label), value: controlValueLabel(control) }));
        } catch (error) {
          log(t("log.signalFailed", { message: error.message }), "error");
        }
      });
    }
    for (const input of [elements.customOutputWidth, elements.customOutputHeight]) {
      input.addEventListener("change", async () => {
        try {
          await updateSignalConfig();
          log(t("log.customResolution", { width: elements.customOutputWidth.value, height: elements.customOutputHeight.value }));
        } catch (error) {
          log(t("log.customResolutionFailed", { message: error.message }), "error");
        }
      });
    }
    for (const control of [elements.sourcePrimaries, elements.sourceRange]) {
      control.addEventListener("change", async () => {
        state.signalConfig.autoColor = false;
        state.signalConfig.manualColorLocked = true;
        localStorage.setItem(sourceColorKey(), JSON.stringify({ manualColorLocked: true,
          sourcePrimaries: elements.sourcePrimaries.value, sourceRange: elements.sourceRange.value }));
        elements.colorDetectionState.textContent = t("status.manualLocked");
        try {
          await updateSignalConfig();
          log(t("log.inputColorLocked", { primaries: controlValueLabel(elements.sourcePrimaries), range: controlValueLabel(elements.sourceRange) }));
        } catch (error) {
          log(t("log.signalFailed", { message: error.message }), "error");
        }
      });
    }
    elements.restoreAutoColorBtn.addEventListener("click", () => {
      localStorage.removeItem(sourceColorKey());
      state.signalConfig.autoColor = true;
      state.signalConfig.manualColorLocked = false;
      applyDetectedSignal(state.detectedSignal, true);
      log(t("log.autoColorRestored"));
    });
    for (const input of [elements.cropLeft, elements.cropTop, elements.cropRight, elements.cropBottom]) {
      input.addEventListener("change", async () => {
        cropFromInputs();
        try {
          await updateSignalConfig();
          log(t("log.cropUpdated", { crop: cropStateLabel() }));
        } catch (error) {
          log(t("log.cropFailed", { message: error.message }), "error");
        }
      });
    }
    elements.resetCropBtn.addEventListener("click", () => {
      state.signalConfig.cropRect = { x: 0, y: 0, width: 1, height: 1 };
      renderCropOverlay();
      updateSignalConfig()
        .then(() => log(t("log.cropRestored")))
        .catch((error) => log(t("log.cropFailed", { message: error.message }), "error"));
    });
    elements.cropLockAspect.addEventListener("change", () => log(t("log.cropAspect", { value: toggleStateLabel(elements.cropLockAspect.checked) })));
    bindCropEditor();
    elements.refreshNdiBtn.addEventListener("click", refreshNdiSources);
    elements.connectNdiBtn.addEventListener("click", connectNdi);
    elements.disconnectBtn.addEventListener("click", disconnectInput);
    elements.testPatternBtn.addEventListener("click", () => {
      startTestPattern();
      log(t("log.testStarted"));
    });
    elements.fileInput.addEventListener("change", (event) => loadLocalFile(event.target.files && event.target.files[0]));
    elements.alphaGain.addEventListener("input", updateAlphaControls);
    elements.alphaGain.addEventListener("change", () => log(t("log.alphaGain", { value: state.alphaGain.toFixed(2) })));
    elements.invertAlpha.addEventListener("change", () => {
      updateAlphaControls();
      log(t("log.alphaInvert", { value: toggleStateLabel(elements.invertAlpha.checked) }));
    });
    elements.showCheckerboard.addEventListener("change", () => {
      updateCheckerboard();
      log(t("log.checkerboard", { value: toggleStateLabel(elements.showCheckerboard.checked) }));
    });
    elements.autoReconnect.addEventListener("change", () => {
      updateReliabilitySettings();
      log(t("log.autoReconnect", { value: toggleStateLabel(elements.autoReconnect.checked) }));
    });
    elements.autoFullscreen.addEventListener("change", () => {
      updateReliabilitySettings();
      log(t("log.autoFullscreen", { value: toggleStateLabel(elements.autoFullscreen.checked) }));
    });
    elements.rgbDisplaySelect.addEventListener("change", () => {
      updateReliabilitySettings();
      log(t("log.rgbDisplay", { value: controlValueLabel(elements.rgbDisplaySelect) }));
    });
    elements.alphaDisplaySelect.addEventListener("change", () => {
      updateReliabilitySettings();
      log(t("log.alphaDisplay", { value: controlValueLabel(elements.alphaDisplaySelect) }));
    });
    elements.rgbWindowBtn.addEventListener("click", async () => {
      state.rgbOutput = await openOutput("rgb");
    });
    elements.alphaWindowBtn.addEventListener("click", async () => {
      state.alphaOutput = await openOutput("alpha");
    });
    elements.fullscreenBtn.addEventListener("click", requestOutputFullscreen);
    elements.snapshotBtn.addEventListener("click", saveSnapshot);
    elements.clearLogBtn.addEventListener("click", () => {
      elements.eventLog.innerHTML = "";
    });
    window.addEventListener("focus", () => {
      populateDisplays().catch((error) => log(t("log.displayRefreshFailed", { message: error.message }), "warn"));
    });
  }

  async function boot() {
    await window.i18n.initialize();
    elements.frameRate.textContent = t("status.previewFps", { fps: 0 });
    initializeDiagnosticCharts();
    restoreSettings();
    bindEvents();
    await initializeSystemInfo();
    await populateDisplays();
    startTestPattern();
    await refreshNdiSources();
    window.ndiClient.onUrlStatus(handleUrlStatus);
    document.body.dataset.appReady = "true";
    log(t("log.startup"));
    tick(performance.now());
    window.ndiClient.onClockTick(() => {
      try {
        tick(performance.now());
      } catch (error) {
        log(t("log.renderClockFailed", { message: error.message }), "error");
      }
    });
    setInterval(runWatchdog, 1000);
    setInterval(refreshOutputStatus, 1000);
  }

  boot();
})();
