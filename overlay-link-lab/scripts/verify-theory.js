"use strict";

const { PROTOCOL, calculateTiming } = require("../src/transport-core.js");

const timing = calculateTiming(PROTOCOL);
const report = {
  protocol: PROTOCOL.id,
  input: `${PROTOCOL.transportWidth}x${PROTOCOL.transportHeight}@${timing.frameRate}`,
  outputs: `2 x ${PROTOCOL.sourceWidth}x${PROTOCOL.sourceHeight}@${timing.frameRate}`,
  transportTmdsGbps: timing.tmdsGbps,
  dualOutputTmdsGbps: timing.dualOutputTmdsGbps,
  activePayloadGbps: Number(timing.activePayloadGbps.toFixed(6)),
  lineBufferBytes: timing.lineBufferBytes,
  estimatedPipelineLatencyUs: {
    minimum: Number(timing.sourceLineDurationUs.toFixed(3)),
    conservative: Number((timing.sourceLineDurationUs * 2).toFixed(3))
  },
  checks: timing.checks
};

console.log(JSON.stringify(report, null, 2));
if (!timing.checks.every((check) => check.pass)) process.exitCode = 1;
