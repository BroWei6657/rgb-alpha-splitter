(function () {
  const kind = new URLSearchParams(location.search).get("kind") === "alpha" ? "alpha" : "rgb";
  let gpuMode = new URLSearchParams(location.search).get("backend") === "gpu";
  document.title = kind === "alpha" ? "Alpha Output" : "RGB Output";

  if (gpuMode) {
    document.body.dataset.backend = "gpu";
    window.ndiOutput.onBackendFallback(() => {});
    return;
  }

  const canvas = document.getElementById("outputCanvas");
  const gl = canvas.getContext("webgl", {
    alpha: false,
    antialias: false,
    depth: false,
    desynchronized: true,
    preserveDrawingBuffer: false
  });
  if (!gl) throw new Error("WebGL is required for the independent output renderer.");

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) || "Output shader compilation failed.");
    }
    return shader;
  }

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
    uniform sampler2D u_previous;
    uniform float u_gain;
    uniform float u_invert;
    uniform float u_source_limited;
    uniform float u_output_limited;
    uniform float u_primaries_mode;
    uniform float u_interlaced;
    uniform float u_field_parity;
    uniform float u_texel_y;
    uniform float u_scaling_mode;
    uniform float u_source_aspect;
    uniform float u_output_aspect;
    uniform vec4 u_crop_rect;
    varying vec2 v_uv;
    vec4 source_pixel() {
      vec2 sample_uv = v_uv;
      if (u_scaling_mode < 0.5) {
        if (u_output_aspect > u_source_aspect) {
          float content = u_source_aspect / u_output_aspect;
          if (v_uv.x < (1.0-content)*0.5 || v_uv.x > (1.0+content)*0.5) return vec4(0.0);
          sample_uv.x = (v_uv.x - (1.0-content)*0.5) / content;
        } else {
          float content = u_output_aspect / u_source_aspect;
          if (v_uv.y < (1.0-content)*0.5 || v_uv.y > (1.0+content)*0.5) return vec4(0.0);
          sample_uv.y = (v_uv.y - (1.0-content)*0.5) / content;
        }
      } else if (u_scaling_mode < 1.5) {
        if (u_output_aspect > u_source_aspect) sample_uv.y = (v_uv.y - 0.5) * (u_source_aspect / u_output_aspect) + 0.5;
        else sample_uv.x = (v_uv.x - 0.5) * (u_output_aspect / u_source_aspect) + 0.5;
      } else if (u_scaling_mode > 2.5) {
        sample_uv = u_crop_rect.xy + v_uv * u_crop_rect.zw;
      }
      vec4 current = texture2D(u_frame, sample_uv);
      if (u_interlaced < 0.5) return current;
      float line = floor(sample_uv.y / u_texel_y);
      if (mod(line, 2.0) == u_field_parity) return current;
      vec4 previous = texture2D(u_previous, sample_uv);
      vec4 bob = 0.5 * (texture2D(u_frame, sample_uv - vec2(0.0, u_texel_y)) + texture2D(u_frame, sample_uv + vec2(0.0, u_texel_y)));
      float motion = step(0.035, length(current.rgb - previous.rgb));
      return mix(current, bob, motion);
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
      vec4 pixel = source_pixel();
      float alpha = clamp(pixel.a * u_gain, 0.0, 1.0);
      alpha = mix(alpha, 1.0 - alpha, u_invert);
      ${kind === "alpha"
        ? "gl_FragColor = vec4(alpha, alpha, alpha, 1.0);"
        : "gl_FragColor = vec4(encode_range(convert_primaries(decode_range(pixel.rgb))), 1.0);"}
    }
  `));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Output shader link failed.");
  }

  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
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

  const textures = [gl.createTexture(), gl.createTexture()];
  for (const texture of textures) {
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.uniform1i(gl.getUniformLocation(program, "u_frame"), 0);
  gl.uniform1i(gl.getUniformLocation(program, "u_previous"), 1);
  const gainUniform = gl.getUniformLocation(program, "u_gain");
  const invertUniform = gl.getUniformLocation(program, "u_invert");
  const sourceLimitedUniform = gl.getUniformLocation(program, "u_source_limited");
  const outputLimitedUniform = gl.getUniformLocation(program, "u_output_limited");
  const primariesModeUniform = gl.getUniformLocation(program, "u_primaries_mode");
  const interlacedUniform = gl.getUniformLocation(program, "u_interlaced");
  const fieldParityUniform = gl.getUniformLocation(program, "u_field_parity");
  const texelYUniform = gl.getUniformLocation(program, "u_texel_y");
  const scalingModeUniform = gl.getUniformLocation(program, "u_scaling_mode");
  const sourceAspectUniform = gl.getUniformLocation(program, "u_source_aspect");
  const outputAspectUniform = gl.getUniformLocation(program, "u_output_aspect");
  const cropRectUniform = gl.getUniformLocation(program, "u_crop_rect");
  let signalConfig = { sourcePrimaries: "rec709", sourceRange: "full", outputPrimaries: "rec709", outputRange: "limited", scanMode: "progressive" };

  function applySignalConfig(config) {
    signalConfig = { ...signalConfig, ...(config || {}) };
    gl.useProgram(program);
    gl.uniform1f(sourceLimitedUniform, signalConfig.sourceRange === "limited" ? 1 : 0);
    gl.uniform1f(outputLimitedUniform, signalConfig.outputRange === "limited" ? 1 : 0);
    const mode = signalConfig.sourcePrimaries === signalConfig.outputPrimaries ? 0 : signalConfig.sourcePrimaries === "rec709" ? 1 : -1;
    gl.uniform1f(primariesModeUniform, mode);
    gl.uniform1f(scalingModeUniform, ({ fit: 0, fill: 1, stretch: 2, crop: 3 })[signalConfig.scalingMode] ?? 0);
    gl.uniform1f(outputAspectUniform, Number(signalConfig.outputWidth || 1920) / Number(signalConfig.outputHeight || 1080));
    const crop = signalConfig.cropRect || { x: 0, y: 0, width: 1, height: 1 };
    gl.uniform4f(cropRectUniform, crop.x, crop.y, crop.width, crop.height);
  }
  window.ndiOutput.getSignalConfig().then((result) => applySignalConfig(result.config));
  window.ndiOutput.onSignalConfig(applySignalConfig);

  function updateAlphaSettings() {
    const gain = Number(localStorage.getItem("alphaGain") || 1);
    const invert = localStorage.getItem("invertAlpha") === "true";
    gl.useProgram(program);
    gl.uniform1f(gainUniform, gain);
    gl.uniform1f(invertUniform, invert ? 1 : 0);
  }
  updateAlphaSettings();
  window.addEventListener("storage", (event) => {
    if (event.key === "alphaGain" || event.key === "invertAlpha") updateAlphaSettings();
  });

  let sequence = "0";
  let textureWidth = 0;
  let textureHeight = 0;
  let renderedFrames = 0;
  let lastMetricsAt = performance.now();
  let currentTextureIndex = 0;
  let texturesReady = false;
  let secondFieldTimer = null;
  let pollDelayMs = 8;

  function drawField(parity) {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[currentTextureIndex]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textures[1 - currentTextureIndex]);
    gl.uniform1f(fieldParityUniform, parity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    renderedFrames += 1;
  }

  function render(frame) {
    const width = Number(frame.width);
    const height = Number(frame.height);
    const pixels = frame.data instanceof Uint8Array ? frame.data : new Uint8Array(frame.data);
    const outputWidth = Number(signalConfig.outputWidth || width);
    const outputHeight = Number(signalConfig.outputHeight || height);
    if (canvas.width !== outputWidth || canvas.height !== outputHeight) {
      canvas.width = outputWidth;
      canvas.height = outputHeight;
    }
    gl.viewport(0, 0, outputWidth, outputHeight);
    gl.uniform1f(sourceAspectUniform, width / height);
    currentTextureIndex = 1 - currentTextureIndex;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textures[currentTextureIndex]);
    if (textureWidth !== width || textureHeight !== height) {
      textureWidth = width;
      textureHeight = height;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      gl.bindTexture(gl.TEXTURE_2D, textures[1 - currentTextureIndex]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      texturesReady = true;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    }
    applySignalConfig(frame);
    const interlaced = frame.scanMode === "interlaced";
    gl.uniform1f(interlacedUniform, interlaced ? 1 : 0);
    gl.uniform1f(texelYUniform, 1 / height);
    if (secondFieldTimer) clearTimeout(secondFieldTimer);
    drawField(frame.fieldOrder === "bff" ? 1 : 0);
    if (interlaced && texturesReady) {
      const fieldDelay = 500 * Number(frame.frameRateD || 1) / Number(frame.frameRateN || 25);
      secondFieldTimer = setTimeout(() => drawField(frame.fieldOrder === "bff" ? 0 : 1), fieldDelay);
    }
    sequence = String(frame.sequence);
    const sourceFps = Number(frame.frameRateN || 60) / Number(frame.frameRateD || 1);
    pollDelayMs = Math.max(4, Math.min(16, 500 / sourceFps));
  }

  function pump() {
    const frame = window.ndiOutput && window.ndiOutput.getFrame(sequence);
    if (frame) render(frame);
    const now = performance.now();
    if (now - lastMetricsAt >= 1000) {
      const fps = renderedFrames * 1000 / (now - lastMetricsAt);
      window.ndiOutput.reportMetrics(kind, Number(fps.toFixed(1)));
      renderedFrames = 0;
      lastMetricsAt = now;
    }
  }

  canvas.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    setTimeout(() => location.reload(), 1000);
  });
  function schedulePump() {
    pump();
    setTimeout(schedulePump, pollDelayMs);
  }
  window.ndiOutput.onBackendFallback(() => {
    if (!gpuMode) return;
    gpuMode = false;
    schedulePump();
  });
  if (!gpuMode) schedulePump();
})();
