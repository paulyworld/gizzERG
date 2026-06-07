import assert from "node:assert/strict";
import test from "node:test";

import { applySymmetricSmoothing, buildExtremaPreservingSeries } from "../src/intensity-sampling.js";

test("buildExtremaPreservingSeries keeps valleys inside coarse windows", () => {
  const intensities = new Map([
    [0, 0.82],
    [10, 0.14],
    [20, 0.80],
    [30, 0.78],
  ]);
  const series = buildExtremaPreservingSeries({
    durationS: 30,
    sampleStepS: 30,
    candidateTimes: [10, 20],
    intensityAt: (time) => intensities.get(time) ?? 0.5,
  });

  assert.deepEqual(series, [
    { t: 0, intensity: 0.82 },
    { t: 10, intensity: 0.14 },
    { t: 30, intensity: 0.78 },
  ]);
});

test("buildExtremaPreservingSeries keeps peaks inside coarse windows", () => {
  const intensities = new Map([
    [0, 0.45],
    [8, 0.95],
    [20, 0.50],
  ]);
  const series = buildExtremaPreservingSeries({
    durationS: 20,
    sampleStepS: 20,
    candidateTimes: [8],
    intensityAt: (time) => intensities.get(time) ?? 0.5,
  });

  assert.deepEqual(series, [
    { t: 0, intensity: 0.45 },
    { t: 8, intensity: 0.95 },
    { t: 20, intensity: 0.50 },
  ]);
});

test("applySymmetricSmoothing returns input unchanged when window is 0", () => {
  const series = [
    { t: 0, intensity: 0.2 },
    { t: 5, intensity: 0.9 },
    { t: 10, intensity: 0.3 },
  ];
  assert.equal(applySymmetricSmoothing(series, 0), series);
});

test("applySymmetricSmoothing averages a spike across a centered window", () => {
  const series = [
    { t: 0,  intensity: 0.20 },
    { t: 5,  intensity: 0.20 },
    { t: 10, intensity: 1.00 },
    { t: 15, intensity: 0.20 },
    { t: 20, intensity: 0.20 },
  ];
  const smoothed = applySymmetricSmoothing(series, 10);
  // 10s window → ±5s. Anchor t=10 averages t=5,10,15 → (0.20+1.00+0.20)/3 = 0.4666...
  assert.equal(smoothed[2].t, 10);
  assert.ok(Math.abs(smoothed[2].intensity - 0.4666666666666667) < 1e-9);
  // Endpoints at t=0,20 are outside the ±5s window of the spike at t=10, so they stay at 0.20.
  assert.equal(smoothed[0].intensity, 0.20);
  assert.equal(smoothed[4].intensity, 0.20);
  // Time-coordinate is preserved.
  assert.deepEqual(smoothed.map((p) => p.t), [0, 5, 10, 15, 20]);
});

test("applySymmetricSmoothing handles non-uniform spacing without dropping points", () => {
  const series = [
    { t: 0,    intensity: 0.50 },
    { t: 1.2,  intensity: 0.95 },
    { t: 1.8,  intensity: 0.10 },
    { t: 50,   intensity: 0.50 },
  ];
  const smoothed = applySymmetricSmoothing(series, 4);
  // First three points are within 4s of each other and get averaged together.
  // Last point is isolated and stays unchanged.
  assert.equal(smoothed.length, 4);
  assert.equal(smoothed[3].intensity, 0.50);
});
