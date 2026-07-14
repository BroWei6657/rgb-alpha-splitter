"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  PROTOCOL,
  calculateTiming,
  packFrame,
  unpackFrame,
  comparePayload
} = require("../src/transport-core.js");

function makeFixture(width, height) {
  const fill = new Uint8ClampedArray(width * height * 4);
  const key = new Uint8ClampedArray(width * height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    fill[offset] = pixel * 13 % 256;
    fill[offset + 1] = pixel * 29 % 256;
    fill[offset + 2] = pixel * 47 % 256;
    fill[offset + 3] = pixel * 61 % 256;
    key[pixel] = pixel * 17 % 256;
  }
  return { fill, key };
}

function testRoundTrip() {
  const width = 8;
  const height = 5;
  const fixture = makeFixture(width, height);
  const packed = packFrame(fixture.fill, fixture.key, width, height);
  assert.equal(packed.width, width * 2);
  assert.equal(packed.height, height * 2);

  const unpacked = unpackFrame(packed.data, packed.width, packed.height);
  assert.equal(unpacked.duplicateMismatches, 0);
  assert.deepEqual(Array.from(unpacked.key), Array.from(fixture.key));

  for (let offset = 0; offset < fixture.fill.length; offset += 4) {
    assert.equal(unpacked.fill[offset], fixture.fill[offset]);
    assert.equal(unpacked.fill[offset + 1], fixture.fill[offset + 1]);
    assert.equal(unpacked.fill[offset + 2], fixture.fill[offset + 2]);
    assert.equal(unpacked.fill[offset + 3], 255);
  }
  assert.equal(comparePayload(fixture.fill, fixture.key, unpacked.fill, unpacked.key).pass, true);
}

function testDuplicateCorruptionDetection() {
  const fixture = makeFixture(4, 3);
  const packed = packFrame(fixture.fill, fixture.key, 4, 3);
  packed.data[packed.width * 4 + 2] ^= 0xff;
  const unpacked = unpackFrame(packed.data, packed.width, packed.height);
  assert.equal(unpacked.duplicateMismatches, 1);
}

function testTimingProof() {
  const timing = calculateTiming(PROTOCOL);
  const protocolFile = JSON.parse(fs.readFileSync(
    path.join(__dirname, "..", "protocol", "olk-hdmi-1.0.json"),
    "utf8"
  ));
  assert.equal(timing.checks.every((check) => check.pass), true);
  assert.equal(timing.lineBufferBytes, 15_360);
  assert.equal(timing.tmdsGbps, 17.82);
  assert.equal(timing.dualOutputTmdsGbps, 8.91);
  assert.ok(Math.abs(timing.frameDurationUs - 16_666.6666667) < 0.001);
  assert.equal(protocolFile.id, PROTOCOL.id);
  assert.equal(protocolFile.transport.activeWidth, PROTOCOL.transportWidth);
  assert.equal(protocolFile.transport.activeHeight, PROTOCOL.transportHeight);
  assert.equal(protocolFile.transport.pixelClockHz, PROTOCOL.transportPixelClockHz);
  assert.equal(protocolFile.outputs.activeWidth, PROTOCOL.sourceWidth);
  assert.equal(protocolFile.outputs.activeHeight, PROTOCOL.sourceHeight);
  assert.equal(protocolFile.outputs.pixelClockHz, PROTOCOL.sourcePixelClockHz);
}

function testInvalidGeometry() {
  assert.throws(() => unpackFrame(new Uint8ClampedArray(12), 3, 1), /even/);
  assert.throws(() => packFrame(new Uint8ClampedArray(8), new Uint8ClampedArray(1), 2, 1), /exactly 2/);
}

testRoundTrip();
testDuplicateCorruptionDetection();
testTimingProof();
testInvalidGeometry();

console.log("transport-core: all protocol tests passed");
