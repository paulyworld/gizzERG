import assert from "node:assert/strict";
import test from "node:test";
import {
  estimateSpeedMps,
  intensityToGrade,
  routePointAt,
  sampleTerrainRoute,
} from "../src/terrain-model.js";

const profile = {
  duration_s: 120,
  cues: [
    { t: 0, label: "warm", ftp_pct: 0.45 },
    { t: 30, label: "climb", ftp_pct: 1.0 },
    { t: 80, label: "break", ftp_pct: 0.5 },
  ],
};

test("intensityToGrade maps intensity around a baseline and clamps", () => {
  assert.equal(intensityToGrade(0.55), 0);
  assert.equal(intensityToGrade(1.0, { maxGrade: 8 }), 8);
  assert.equal(intensityToGrade(0.2, { minGrade: -3 }), -3);
});

test("estimateSpeedMps slows down on steeper grades for the same power", () => {
  const flat = estimateSpeedMps(220, 0, { riderWeightKg: 75 });
  const climb = estimateSpeedMps(220, 8, { riderWeightKg: 75 });

  assert.ok(flat > climb);
  assert.ok(climb > 0);
});

test("sampleTerrainRoute accumulates distance and positive elevation", () => {
  const route = sampleTerrainRoute(profile, {
    sampleStepS: 10,
    smoothingWindowS: 0,
    ftp: 250,
    riderWeightKg: 75,
  });

  assert.equal(route.durationS, 120);
  assert.ok(route.samples.length > 5);
  assert.ok(route.distanceM > 0);
  assert.ok(route.elevationGainM > 0);
  assert.equal(route.samples[0].distanceM, 0);
});

test("sampleTerrainRoute smooths sudden intensity changes", () => {
  const unsmoothed = sampleTerrainRoute(profile, { sampleStepS: 10, smoothingWindowS: 0 });
  const smoothed = sampleTerrainRoute(profile, { sampleStepS: 10, smoothingWindowS: 60 });
  const climbStart = unsmoothed.samples.find((sample) => sample.timeS === 30);
  const smoothedClimbStart = smoothed.samples.find((sample) => sample.timeS === 30);

  assert.ok(climbStart.gradePercent > smoothedClimbStart.gradePercent);
});

test("routePointAt interpolates along distance", () => {
  const route = sampleTerrainRoute(profile, { sampleStepS: 10, smoothingWindowS: 0 });
  const midpoint = routePointAt(route, route.distanceM / 2);

  assert.ok(midpoint.distanceM > 0);
  assert.ok(midpoint.timeS > 0);
  assert.ok(Number.isFinite(midpoint.gradePercent));
});
