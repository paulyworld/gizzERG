import assert from "node:assert/strict";
import test from "node:test";

import { buildSubjectiveFeelCurve, musicalPressure } from "../src/subjective-intensity.js";
import { concertProfiles } from "../src/concert-profile.js";

test("musical pressure ranks dense distorted sections above smooth bright sections", () => {
  const metalPressure = musicalPressure({
    loudness: 0.82,
    spectral_centroid: 0.68,
    onset_density: 0.66,
    harmonic_ratio: 0.58,
    spectral_contrast: 0.72,
    spectral_change: 0.63,
  });
  const smoothVocalPressure = musicalPressure({
    loudness: 0.82,
    spectral_centroid: 0.78,
    onset_density: 0.32,
    harmonic_ratio: 0.72,
    spectral_contrast: 0.28,
    spectral_change: 0.22,
  });

  assert.ok(metalPressure > smoothVocalPressure);
});

test("subjective feel transform boosts local pressure peaks without replacing quiet drops", () => {
  const curve = buildSubjectiveFeelCurve({
    model_version: "test-v0.3",
    sample_step_s: 2,
    points: [
      {
        t: 0,
        intensity: 0.52,
        audio_features: {
          loudness: 0.65,
          spectral_centroid: 0.56,
          onset_density: 0.35,
          harmonic_ratio: 0.70,
          spectral_contrast: 0.30,
          spectral_change: 0.25,
        },
      },
      {
        t: 2,
        intensity: 0.54,
        audio_features: {
          loudness: 0.72,
          spectral_centroid: 0.62,
          onset_density: 0.70,
          harmonic_ratio: 0.52,
          spectral_contrast: 0.82,
          spectral_change: 0.70,
        },
      },
      {
        t: 4,
        intensity: 0.18,
        audio_features: {
          loudness: 0.05,
          spectral_centroid: 0.12,
          onset_density: 0.08,
          harmonic_ratio: 0.80,
          spectral_contrast: 0.10,
          spectral_change: 0.05,
        },
      },
    ],
  }, { localWindowS: 6 });

  assert.equal(curve.model_version, "test-v0.3-subjective-v0.4");
  assert.ok(curve.points[1].intensity > curve.points[0].intensity);
  assert.ok(curve.points[2].intensity < curve.points[0].intensity);
  assert.ok(curve.points[1].subjective_features.musical_pressure > curve.points[0].subjective_features.musical_pressure);
});

test("style priors can lift active metal sections without lifting quiet passages", () => {
  const curve = buildSubjectiveFeelCurve({
    model_version: "test-v0.3",
    sample_step_s: 2,
    points: [
      {
        t: 10,
        intensity: 0.62,
        audio_features: {
          loudness: 0.70,
          spectral_centroid: 0.55,
          onset_density: 0.50,
          harmonic_ratio: 0.62,
          spectral_contrast: 0.54,
          spectral_change: 0.40,
        },
      },
      {
        t: 20,
        intensity: 0.12,
        audio_features: {
          loudness: 0.04,
          spectral_centroid: 0.10,
          onset_density: 0.05,
          harmonic_ratio: 0.80,
          spectral_contrast: 0.08,
          spectral_change: 0.05,
        },
      },
    ],
  }, {
    styleSegments: [{ start_s: 0, end_s: 30, pressure: 0.50 }],
  });

  assert.ok(curve.points[0].subjective_features.style_prior > 0.45);
  assert.ok(curve.points[1].subjective_features.style_prior < 0.15);
  assert.ok(curve.points[0].intensity > 0.62);
  assert.ok(curve.points[1].intensity < 0.20);
});

test("concert profile exposes v0.4 subjective preview as a selectable curve", () => {
  const ids = concertProfiles[0].available_intensity_curves.map((curve) => curve.id);

  assert.ok(ids.includes("audio-v0.4-subjective"));
});
