(function startOverlayLinkLab() {
  "use strict";

  const WIDTH = 320;
  const HEIGHT = 180;
  const core = window.OverlayTransport;
  const timing = core.calculateTiming();
  const elements = {
    pattern: document.getElementById("patternSelect"),
    gain: document.getElementById("gainRange"),
    gainValue: document.getElementById("gainValue"),
    motion: document.getElementById("motionToggle"),
    invert: document.getElementById("invertToggle"),
    fault: document.getElementById("faultToggle"),
    run: document.getElementById("runButton"),
    reset: document.getElementById("resetButton"),
    statusDot: document.getElementById("statusDot"),
    linkStatus: document.getElementById("linkStatus"),
    frameCounter: document.getElementById("frameCounter"),
    simFps: document.getElementById("simFps"),
    validation: document.getElementById("validationList"),
    transport: document.getElementById("transportCanvas"),
    fill: document.getElementById("fillCanvas"),
    key: document.getElementById("keyCanvas"),
    composite: document.getElementById("compositeCanvas")
  };

  const fillSource = document.createElement("canvas");
  const keySource = document.createElement("canvas");
  fillSource.width = keySource.width = WIDTH;
  fillSource.height = keySource.height = HEIGHT;
  const fillSourceContext = fillSource.getContext("2d", { willReadFrequently: true });
  const keySourceContext = keySource.getContext("2d", { willReadFrequently: true });
  const transportContext = elements.transport.getContext("2d");
  const fillContext = elements.fill.getContext("2d");
  const keyContext = elements.key.getContext("2d");
  const compositeContext = elements.composite.getContext("2d");

  let running = true;
  let frameSequence = 0;
  let lastRenderAt = 0;
  let fpsWindowStart = performance.now();
  let fpsFrames = 0;
  let simulatedTime = 0;

  document.getElementById("tmdsMetric").textContent = `${timing.tmdsGbps.toFixed(2)} Gb/s`;
  document.getElementById("bufferMetric").textContent = `${(timing.lineBufferBytes / 1024).toFixed(1)} KiB`;
  document.getElementById("latencyMetric").textContent = `${timing.sourceLineDurationUs.toFixed(1)}-${(timing.sourceLineDurationUs * 2).toFixed(1)} us`;

  function roundedRect(context, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    context.beginPath();
    context.moveTo(x + r, y);
    context.arcTo(x + width, y, x + width, y + height, r);
    context.arcTo(x + width, y + height, x, y + height, r);
    context.arcTo(x, y + height, x, y, r);
    context.arcTo(x, y, x + width, y, r);
    context.closePath();
  }

  function drawBaseFill(time) {
    const shift = elements.motion.checked ? Math.sin(time * 0.0012) * 16 : 0;
    const gradient = fillSourceContext.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, "#12333d");
    gradient.addColorStop(0.48, "#256674");
    gradient.addColorStop(0.5, "#d7e4e4");
    gradient.addColorStop(1, "#31505d");
    fillSourceContext.fillStyle = gradient;
    fillSourceContext.fillRect(0, 0, WIDTH, HEIGHT);

    fillSourceContext.globalAlpha = 0.24;
    fillSourceContext.fillStyle = "#f2b94b";
    for (let x = -100; x < WIDTH + 100; x += 48) {
      fillSourceContext.fillRect(x + shift, 0, 18, HEIGHT);
    }
    fillSourceContext.globalAlpha = 1;

    fillSourceContext.fillStyle = "#0b1216";
    fillSourceContext.fillRect(0, HEIGHT - 24, WIDTH, 24);
    fillSourceContext.fillStyle = "#45c6d4";
    fillSourceContext.fillRect(0, HEIGHT - 24, 76, 24);
    fillSourceContext.fillStyle = "#071216";
    fillSourceContext.font = "600 10px Segoe UI";
    fillSourceContext.fillText("LIVE", 24, HEIGHT - 9);
    fillSourceContext.fillStyle = "#edf1f2";
    fillSourceContext.fillText("OVERLAY LINK / RGB FILL", 88, HEIGHT - 9);
  }

  function drawLowerThird(time) {
    const travel = elements.motion.checked ? (Math.sin(time * 0.0015) + 1) * 12 : 12;
    roundedRect(fillSourceContext, 22 + travel, 112, 238, 43, 4);
    fillSourceContext.fillStyle = "#102027";
    fillSourceContext.fill();
    fillSourceContext.fillStyle = "#f2b94b";
    fillSourceContext.fillRect(22 + travel, 112, 8, 43);
    fillSourceContext.fillStyle = "#f3f6f6";
    fillSourceContext.font = "600 15px Segoe UI";
    fillSourceContext.fillText("KEY / FILL OVERLAY", 42 + travel, 132);
    fillSourceContext.fillStyle = "#9db0b6";
    fillSourceContext.font = "11px Segoe UI";
    fillSourceContext.fillText("Single HDMI transport", 42 + travel, 147);

    roundedRect(keySourceContext, 22 + travel, 112, 238, 43, 4);
    keySourceContext.fillStyle = "#ffffff";
    keySourceContext.fill();
  }

  function drawScoreboard(time) {
    const pulse = elements.motion.checked ? 0.82 + Math.sin(time * 0.003) * 0.18 : 1;
    roundedRect(fillSourceContext, 202, 18, 98, 46, 4);
    fillSourceContext.fillStyle = "#151b20";
    fillSourceContext.fill();
    fillSourceContext.fillStyle = "#45c6d4";
    fillSourceContext.fillRect(202, 18, 7, 46);
    fillSourceContext.fillStyle = "#f5f7f7";
    fillSourceContext.font = "600 12px Segoe UI";
    fillSourceContext.fillText("HKG  2", 218, 39);
    fillSourceContext.fillStyle = "#f2b94b";
    fillSourceContext.fillText("TOK  1", 218, 56);

    keySourceContext.globalAlpha = pulse;
    roundedRect(keySourceContext, 202, 18, 98, 46, 4);
    keySourceContext.fillStyle = "#ffffff";
    keySourceContext.fill();
    keySourceContext.globalAlpha = 1;
  }

  function drawCornerBug(time) {
    const x = elements.motion.checked ? 24 + Math.sin(time * 0.001) * 8 : 24;
    fillSourceContext.save();
    fillSourceContext.translate(x, 24);
    fillSourceContext.rotate(-0.08);
    fillSourceContext.fillStyle = "#f2b94b";
    fillSourceContext.fillRect(0, 0, 52, 30);
    fillSourceContext.fillStyle = "#102027";
    fillSourceContext.font = "700 11px Segoe UI";
    fillSourceContext.fillText("OLK", 14, 19);
    fillSourceContext.restore();

    keySourceContext.save();
    keySourceContext.translate(x, 24);
    keySourceContext.rotate(-0.08);
    keySourceContext.fillStyle = "#ffffff";
    keySourceContext.fillRect(0, 0, 52, 30);
    keySourceContext.restore();
  }

  function makeSources(time) {
    fillSourceContext.clearRect(0, 0, WIDTH, HEIGHT);
    keySourceContext.clearRect(0, 0, WIDTH, HEIGHT);
    keySourceContext.fillStyle = "#000000";
    keySourceContext.fillRect(0, 0, WIDTH, HEIGHT);
    drawBaseFill(time);

    if (elements.pattern.value === "scoreboard") drawScoreboard(time);
    else if (elements.pattern.value === "corner-bug") drawCornerBug(time);
    else drawLowerThird(time);

    const fill = fillSourceContext.getImageData(0, 0, WIDTH, HEIGHT).data;
    const keyRgba = keySourceContext.getImageData(0, 0, WIDTH, HEIGHT).data;
    const key = new Uint8ClampedArray(WIDTH * HEIGHT);
    const gain = Number(elements.gain.value);
    for (let index = 0; index < key.length; index += 1) {
      const sample = Math.min(255, Math.round(keyRgba[index * 4] * gain));
      key[index] = elements.invert.checked ? 255 - sample : sample;
    }
    return { fill, key };
  }

  function drawKey(key) {
    const rgba = new Uint8ClampedArray(key.length * 4);
    for (let index = 0; index < key.length; index += 1) {
      const offset = index * 4;
      rgba[offset] = key[index];
      rgba[offset + 1] = key[index];
      rgba[offset + 2] = key[index];
      rgba[offset + 3] = 255;
    }
    keyContext.putImageData(new ImageData(rgba, WIDTH, HEIGHT), 0, 0);
  }

  function drawComposite(fill, key, time) {
    const rgba = new Uint8ClampedArray(fill.length);
    const horizon = 78 + Math.sin(time * 0.0005) * 6;
    for (let y = 0; y < HEIGHT; y += 1) {
      for (let x = 0; x < WIDTH; x += 1) {
        const pixel = y * WIDTH + x;
        const offset = pixel * 4;
        const alpha = key[pixel] / 255;
        const lane = Math.floor((x + y * 0.6) / 42) % 2;
        const background = y < horizon
          ? [34 + lane * 18, 60 + lane * 12, 72 + lane * 14]
          : [20 + lane * 10, 27 + lane * 9, 31 + lane * 8];
        rgba[offset] = Math.round(fill[offset] * alpha + background[0] * (1 - alpha));
        rgba[offset + 1] = Math.round(fill[offset + 1] * alpha + background[1] * (1 - alpha));
        rgba[offset + 2] = Math.round(fill[offset + 2] * alpha + background[2] * (1 - alpha));
        rgba[offset + 3] = 255;
      }
    }
    compositeContext.putImageData(new ImageData(rgba, WIDTH, HEIGHT), 0, 0);
  }

  function renderValidation(duplicateMismatches, payloadCheck) {
    const rows = timing.checks.map((check) => ({ label: check.label, pass: check.pass }));
    rows.push({ label: "垂直重复行逐字节一致", pass: duplicateMismatches === 0, value: `${duplicateMismatches} errors` });
    rows.push({ label: "拆包后 FILL / KEY 与源数据一致", pass: payloadCheck.pass, value: `${payloadCheck.mismatches} errors` });
    elements.validation.replaceChildren(...rows.map((row) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const result = document.createElement("strong");
      label.textContent = row.label;
      result.textContent = row.value || (row.pass ? "PASS" : "FAIL");
      if (!row.pass) result.className = "failed";
      item.append(label, result);
      return item;
    }));
  }

  function renderFrame(time) {
    const source = makeSources(time);
    const packed = core.packFrame(source.fill, source.key, WIDTH, HEIGHT);
    if (elements.fault.checked) {
      const faultX = WIDTH + 94;
      const faultY = 112;
      packed.data[(faultY * packed.width + faultX) * 4] ^= 0xff;
    }
    const unpacked = core.unpackFrame(packed.data, packed.width, packed.height);
    const payloadCheck = core.comparePayload(source.fill, source.key, unpacked.fill, unpacked.key);
    transportContext.putImageData(new ImageData(packed.data, packed.width, packed.height), 0, 0);
    fillContext.putImageData(new ImageData(unpacked.fill, WIDTH, HEIGHT), 0, 0);
    drawKey(unpacked.key);
    drawComposite(unpacked.fill, unpacked.key, time);
    renderValidation(unpacked.duplicateMismatches, payloadCheck);

    const healthy = unpacked.duplicateMismatches === 0 && payloadCheck.pass;
    elements.statusDot.classList.toggle("fault", !healthy);
    elements.linkStatus.textContent = healthy ? "链路完整" : "检测到数据错误";
    frameSequence += 1;
    elements.frameCounter.textContent = `Frame ${String(frameSequence).padStart(6, "0")}`;
    fpsFrames += 1;
  }

  function animate(now) {
    if (running && now - lastRenderAt >= 33) {
      simulatedTime = elements.motion.checked ? now : simulatedTime;
      renderFrame(simulatedTime);
      lastRenderAt = now;
    }
    if (now - fpsWindowStart >= 1000) {
      elements.simFps.textContent = `${(fpsFrames * 1000 / (now - fpsWindowStart)).toFixed(1)} sim fps`;
      fpsFrames = 0;
      fpsWindowStart = now;
    }
    requestAnimationFrame(animate);
  }

  function rerender() {
    const gainText = `${Number(elements.gain.value).toFixed(2)}x`;
    elements.gainValue.textContent = gainText;
    elements.gain.setAttribute("aria-valuetext", gainText);
    renderFrame(simulatedTime);
  }

  elements.run.addEventListener("click", () => {
    running = !running;
    elements.run.textContent = running ? "暂停" : "运行";
    if (!running) renderFrame(simulatedTime);
  });
  elements.reset.addEventListener("click", () => {
    elements.pattern.value = "lower-third";
    elements.gain.value = "1";
    elements.motion.checked = true;
    elements.invert.checked = false;
    elements.fault.checked = false;
    running = true;
    frameSequence = 0;
    elements.run.textContent = "暂停";
    rerender();
  });
  [elements.pattern, elements.gain, elements.motion, elements.invert, elements.fault]
    .forEach((control) => control.addEventListener("input", rerender));

  renderFrame(0);
  requestAnimationFrame(animate);
})();
