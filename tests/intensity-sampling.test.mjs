import assert from "node:assert/strict";
import test from "node:test";

import { buildExtremaPreservingSeries } from "../src/intensity-sampling.js";

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
