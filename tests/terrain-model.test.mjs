import assert from "node:assert/strict";
import test from "node:test";
import {
  blendTerrainIntensityAt,
  estimatePowerForSpeedW,
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

test("estimatePowerForSpeedW increases with grade and drag", () => {
  const flat = estimatePowerForSpeedW(8, 0, { riderWeightKg: 75 });
  const climb = estimatePowerForSpeedW(8, 6, { riderWeightKg: 75 });
  const aero = estimatePowerForSpeedW(8, 0, { riderWeightKg: 75, dragArea: 0.9 });

  assert.ok(climb > flat);
  assert.ok(aero > flat);
});

test("sampleTerrainRoute accumulates distance and positive elevation gain", () => {
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

test("sampleTerrainRoute keeps net elevation separate from gain", () => {
  const route = sampleTerrainRoute({
    duration_s: 90,
    cues: [
      { t: 0, ftp_pct: 1.0 },
      { t: 30, ftp_pct: 0.35 },
      { t: 60, ftp_pct: 0.35 },
    ],
  }, {
    sampleStepS: 10,
    smoothingWindowS: 0,
    minGrade: -6,
  });
  const peak = Math.max(...route.samples.map((sample) => sample.elevationM));
  const finish = route.samples.at(-1).elevationM;

  assert.ok(peak > finish);
  assert.ok(route.elevationGainM > Math.max(0, finish));
});

test("sampleTerrainRoute can use a derived intensity curve", () => {
  const route = sampleTerrainRoute({
    duration_s: 30,
    cues: [
      { t: 0, ftp_pct: 0.45 },
      { t: 10, ftp_pct: 0.45 },
    ],
    derived_intensity_curve: {
      model_version: "test",
      points: [
        { t: 0, intensity: 1.0 },
        { t: 10, intensity: 1.0 },
      ],
    },
  }, { sampleStepS: 10, smoothingWindowS: 0, intensitySource: "derived" });

  assert.ok(route.samples.find((sample) => sample.timeS === 10).gradePercent > 0);
});

test("sampleTerrainRoute can force authored cues over derived intensity", () => {
  const route = sampleTerrainRoute({
    duration_s: 30,
    cues: [
      { t: 0, ftp_pct: 0.45 },
      { t: 10, ftp_pct: 0.45 },
    ],
    derived_intensity_curve: {
      model_version: "test",
      points: [
        { t: 0, intensity: 1.0 },
        { t: 10, intensity: 1.0 },
      ],
    },
  }, { sampleStepS: 10, smoothingWindowS: 0, intensitySource: "cues" });

  assert.ok(route.samples.find((sample) => sample.timeS === 10).gradePercent < 0);
});

test("sampleTerrainRoute can blend derived intensity with authored cues", () => {
  const route = sampleTerrainRoute({
    duration_s: 20,
    cues: [
      { t: 0, ftp_pct: 0.4 },
      { t: 10, ftp_pct: 0.4 },
    ],
    derived_intensity_curve: {
      model_version: "test",
      points: [
        { t: 0, intensity: 1.0 },
        { t: 10, intensity: 1.0 },
      ],
    },
  }, { sampleStepS: 10, smoothingWindowS: 0, intensitySource: "blended", intensityBlend: 0.5 });

  assert.equal(route.samples.find((sample) => sample.timeS === 10).intensity, 0.7);
});

test("terrain overrides cap, floor, anchor, and manual override blended intensity", () => {
  const blendedProfile = {
    duration_s: 40,
    cues: [{ t: 0, ftp_pct: 0.4 }],
    derived_intensity_curve: {
      model_version: "test",
      points: [{ t: 0, intensity: 1.0 }],
    },
    terrain_overrides: [
      { start_s: 10, end_s: 10, type: "cap", max_intensity: 0.55 },
      { start_s: 20, end_s: 20, type: "floor", min_intensity: 0.9 },
      { start_s: 30, end_s: 30, type: "anchor", intensity: 0.5, weight: 0.5 },
      { start_s: 40, end_s: 40, type: "manual-override", intensity: 1.25 },
    ],
  };

  assert.equal(blendTerrainIntensityAt(blendedProfile, 10, { sampleStepS: 10, intensityBlend: 0.5 }), 0.55);
  assert.equal(blendTerrainIntensityAt(blendedProfile, 20, { sampleStepS: 10, intensityBlend: 0.5 }), 0.9);
  assert.equal(blendTerrainIntensityAt(blendedProfile, 30, { sampleStepS: 10, intensityBlend: 0.5 }), 0.6);
  assert.equal(blendTerrainIntensityAt(blendedProfile, 40, { sampleStepS: 10, intensityBlend: 0.5 }), 1.25);
});

test("drop event allows over-FTP intensity while schema safety bounds stay at 2.0", () => {
  const dropProfile = {
    duration_s: 20,
    cues: [{ t: 0, ftp_pct: 0.5 }],
    derived_intensity_curve: {
      model_version: "test",
      points: [{ t: 0, intensity: 0.5 }],
    },
    terrain_overrides: [
      { start_s: 10, end_s: 10, type: "event", event: "drop", intensity: 1.35 },
      { start_s: 20, end_s: 20, type: "event", event: "drop", intensity: 2.4 },
    ],
  };

  assert.equal(blendTerrainIntensityAt(dropProfile, 10, { sampleStepS: 10 }), 1.35);
  assert.equal(blendTerrainIntensityAt(dropProfile, 20, { sampleStepS: 10 }), 2.0);
});

test("crescendo event ramps inside its window but does not sustain afterward", () => {
  const crescendoProfile = {
    duration_s: 30,
    cues: [{ t: 0, ftp_pct: 0.45 }],
    derived_intensity_curve: {
      model_version: "test",
      points: [{ t: 0, intensity: 0.45 }],
    },
    terrain_overrides: [
      { start_s: 10, end_s: 20, type: "event", event: "crescendo", intensity: 1.2 },
    ],
  };

  assert.equal(blendTerrainIntensityAt(crescendoProfile, 10, { sampleStepS: 5 }), 0.45);
  assert.equal(blendTerrainIntensityAt(crescendoProfile, 20, { sampleStepS: 5 }), 1.2);
  assert.equal(blendTerrainIntensityAt(crescendoProfile, 30, { sampleStepS: 5 }), 0.45);
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
