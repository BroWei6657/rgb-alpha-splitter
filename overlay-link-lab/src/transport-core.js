(function attachOverlayTransport(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.OverlayTransport = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createOverlayTransport() {
  "use strict";

  const PROTOCOL = Object.freeze({
    id: "OLK-HDMI-1.0",
    sourceWidth: 1920,
    sourceHeight: 1080,
    sourceTotalWidth: 2200,
    sourceTotalHeight: 1125,
    sourcePixelClockHz: 148_500_000,
    transportWidth: 3840,
    transportHeight: 2160,
    transportTotalWidth: 4400,
    transportTotalHeight: 2250,
    transportPixelClockHz: 594_000_000,
    frameRateN: 60,
    frameRateD: 1,
    bitsPerComponent: 8,
    colorFormat: "RGB 4:4:4",
    hdcp: false
  });

  function assertPositiveInteger(value, name) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
  }

  function validateFrame(buffer, expectedLength, name) {
    if (!buffer || typeof buffer.length !== "number" || buffer.length !== expectedLength) {
      throw new RangeError(`${name} must contain exactly ${expectedLength} samples.`);
    }
  }

  function calculateTiming(protocol = PROTOCOL) {
    const frameRate = protocol.frameRateN / protocol.frameRateD;
    const frameDurationUs = 1_000_000 / frameRate;
    const sourceLineDurationUs = protocol.sourceTotalWidth / protocol.sourcePixelClockHz * 1_000_000;
    const transportLineDurationUs = protocol.transportTotalWidth / protocol.transportPixelClockHz * 1_000_000;
    const activePayloadGbps = protocol.transportWidth * protocol.transportHeight * frameRate * 24 / 1e9;
    const tmdsGbps = protocol.transportPixelClockHz * 10 * 3 / 1e9;
    const outputTmdsGbps = protocol.sourcePixelClockHz * 10 * 3 / 1e9;
    const lineBufferBytes = 2 * protocol.sourceWidth * (3 + 1);
    const checks = [
      {
        id: "active-width",
        label: "传输有效宽度 = 2 x 输出宽度",
        pass: protocol.transportWidth === protocol.sourceWidth * 2
      },
      {
        id: "active-height",
        label: "传输有效高度 = 2 x 输出高度",
        pass: protocol.transportHeight === protocol.sourceHeight * 2
      },
      {
        id: "total-width",
        label: "传输总宽度 = 2 x 输出总宽度",
        pass: protocol.transportTotalWidth === protocol.sourceTotalWidth * 2
      },
      {
        id: "total-height",
        label: "传输总高度 = 2 x 输出总高度",
        pass: protocol.transportTotalHeight === protocol.sourceTotalHeight * 2
      },
      {
        id: "clock-ratio",
        label: "传输像素时钟 = 4 x 输出像素时钟",
        pass: protocol.transportPixelClockHz === protocol.sourcePixelClockHz * 4
      },
      {
        id: "line-period",
        label: "两条传输行时长 = 一条输出行时长",
        pass: Math.abs(transportLineDurationUs * 2 - sourceLineDurationUs) < 1e-9
      },
      {
        id: "hdmi-bandwidth",
        label: "TMDS 速率不超过 HDMI 2.0 的 18 Gb/s",
        pass: tmdsGbps <= 18
      }
    ];

    return Object.freeze({
      frameRate,
      frameDurationUs,
      sourceLineDurationUs,
      transportLineDurationUs,
      activePayloadGbps,
      tmdsGbps,
      outputTmdsGbps,
      dualOutputTmdsGbps: outputTmdsGbps * 2,
      lineBufferBytes,
      checks
    });
  }

  function packFrame(fillRgba, keyPlane, width, height) {
    assertPositiveInteger(width, "width");
    assertPositiveInteger(height, "height");
    const pixels = width * height;
    validateFrame(fillRgba, pixels * 4, "fillRgba");
    validateFrame(keyPlane, pixels, "keyPlane");

    const transportWidth = width * 2;
    const transportHeight = height * 2;
    const transport = new Uint8ClampedArray(transportWidth * transportHeight * 4);

    for (let sourceY = 0; sourceY < height; sourceY += 1) {
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const transportY = sourceY * 2 + repeat;
        let fillDestination = transportY * transportWidth * 4;
        let keyDestination = fillDestination + width * 4;

        for (let sourceX = 0; sourceX < width; sourceX += 1) {
          const sourcePixel = sourceY * width + sourceX;
          const sourceOffset = sourcePixel * 4;
          transport[fillDestination] = fillRgba[sourceOffset];
          transport[fillDestination + 1] = fillRgba[sourceOffset + 1];
          transport[fillDestination + 2] = fillRgba[sourceOffset + 2];
          transport[fillDestination + 3] = 255;
          fillDestination += 4;

          const key = keyPlane[sourcePixel];
          transport[keyDestination] = key;
          transport[keyDestination + 1] = key;
          transport[keyDestination + 2] = key;
          transport[keyDestination + 3] = 255;
          keyDestination += 4;
        }
      }
    }

    return Object.freeze({
      width: transportWidth,
      height: transportHeight,
      data: transport
    });
  }

  function unpackFrame(transportRgba, transportWidth, transportHeight) {
    assertPositiveInteger(transportWidth, "transportWidth");
    assertPositiveInteger(transportHeight, "transportHeight");
    if (transportWidth % 2 !== 0 || transportHeight % 2 !== 0) {
      throw new RangeError("Transport dimensions must be even.");
    }
    validateFrame(transportRgba, transportWidth * transportHeight * 4, "transportRgba");

    const width = transportWidth / 2;
    const height = transportHeight / 2;
    const fill = new Uint8ClampedArray(width * height * 4);
    const key = new Uint8ClampedArray(width * height);
    let duplicateMismatches = 0;

    for (let y = 0; y < height; y += 1) {
      const firstRow = y * 2 * transportWidth * 4;
      const duplicateRow = firstRow + transportWidth * 4;
      for (let x = 0; x < transportWidth * 4; x += 1) {
        if (transportRgba[firstRow + x] !== transportRgba[duplicateRow + x]) {
          duplicateMismatches += 1;
        }
      }

      for (let x = 0; x < width; x += 1) {
        const targetPixel = y * width + x;
        const targetOffset = targetPixel * 4;
        const fillOffset = firstRow + x * 4;
        const keyOffset = firstRow + (width + x) * 4;
        fill[targetOffset] = transportRgba[fillOffset];
        fill[targetOffset + 1] = transportRgba[fillOffset + 1];
        fill[targetOffset + 2] = transportRgba[fillOffset + 2];
        fill[targetOffset + 3] = 255;
        key[targetPixel] = transportRgba[keyOffset];
      }
    }

    return Object.freeze({ width, height, fill, key, duplicateMismatches });
  }

  function comparePayload(expectedFill, expectedKey, actualFill, actualKey) {
    if (expectedFill.length !== actualFill.length || expectedKey.length !== actualKey.length) {
      return Object.freeze({ pass: false, mismatches: Infinity, maxError: 255 });
    }

    let mismatches = 0;
    let maxError = 0;
    for (let offset = 0; offset < expectedFill.length; offset += 4) {
      for (let channel = 0; channel < 3; channel += 1) {
        const error = Math.abs(expectedFill[offset + channel] - actualFill[offset + channel]);
        if (error !== 0) mismatches += 1;
        if (error > maxError) maxError = error;
      }
    }
    for (let index = 0; index < expectedKey.length; index += 1) {
      const error = Math.abs(expectedKey[index] - actualKey[index]);
      if (error !== 0) mismatches += 1;
      if (error > maxError) maxError = error;
    }

    return Object.freeze({ pass: mismatches === 0, mismatches, maxError });
  }

  return Object.freeze({
    PROTOCOL,
    calculateTiming,
    packFrame,
    unpackFrame,
    comparePayload
  });
});
