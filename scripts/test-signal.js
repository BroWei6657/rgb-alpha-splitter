const assert = require("assert");

const m709to2020 = [
  [0.6274, 0.3293, 0.0433],
  [0.0691, 0.9195, 0.0114],
  [0.0164, 0.0880, 0.8956]
];
const m2020to709 = [
  [1.6605, -0.5876, -0.0728],
  [-0.1246, 1.1329, -0.0083],
  [-0.0182, -0.1006, 1.1187]
];

function multiply(matrix, value) {
  return matrix.map((row) => row.reduce((sum, coefficient, index) => sum + coefficient * value[index], 0));
}

function convert(value, matrix) {
  const linear = value.map((channel) => Math.pow(Math.max(0, channel), 2.4));
  return multiply(matrix, linear).map((channel) => Math.pow(Math.min(1, Math.max(0, channel)), 1 / 2.4));
}

function encodeLimited(value) {
  return value.map((channel) => channel * 219 / 255 + 16 / 255);
}

function decodeLimited(value) {
  return value.map((channel) => (channel - 16 / 255) / (219 / 255));
}

for (const sample of [[0, 0, 0], [1, 1, 1], [0.18, 0.5, 0.82]]) {
  const ranged = decodeLimited(encodeLimited(sample));
  ranged.forEach((channel, index) => assert(Math.abs(channel - sample[index]) < 1e-9));
  const roundTrip = convert(convert(sample, m709to2020), m2020to709);
  roundTrip.forEach((channel, index) => assert(Math.abs(channel - sample[index]) < 0.003));
}

const alpha = 0.37;
assert.strictEqual(alpha, 0.37, "Color conversion must not modify alpha.");
console.log("Signal conversion reference tests passed.");
