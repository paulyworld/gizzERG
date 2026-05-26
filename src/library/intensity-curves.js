import { bnnIdWzGSYISectionDynamics20m } from "../audio-derived-curves.js";

export const bnnIdWzGSYIManualSeedCurve = {
  model_version: "manual-seed-v0.1",
  source: "authored-cue-seed",
  sample_step_s: null,
  note: "Seed curve mirrors the authored cue map until the audio-feature builder lands.",
  points: [
    { t: 0, intensity: 0.45 },
    { t: 240, intensity: 0.52 },
    { t: 480, intensity: 0.60 },
    { t: 720, intensity: 0.68 },
    { t: 833, intensity: 1.04 },
    { t: 1119, intensity: 1.10 },
    { t: 1530, intensity: 1.00 },
    { t: 1795, intensity: 0.94 },
    { t: 2305, intensity: 0.96 },
    { t: 2713, intensity: 1.08 },
    { t: 2933, intensity: 1.02 },
    { t: 3233, intensity: 0.62 },
    { t: 3588, intensity: 0.72 },
    { t: 4004, intensity: 0.86 },
    { t: 4439, intensity: 1.02 },
    { t: 4789, intensity: 1.12 },
    { t: 5038, intensity: 1.00 },
    { t: 5389, intensity: 1.10 },
    { t: 5644, intensity: 0.82 },
    { t: 5987, intensity: 0.88 },
    { t: 6289, intensity: 1.00 },
    { t: 6525, intensity: 0.92 },
    { t: 6799, intensity: 0.78 },
    { t: 7189, intensity: 0.90 },
    { t: 7623, intensity: 0.70 },
    { t: 8039, intensity: 0.88 },
    { t: 8489, intensity: 0.96 },
    { t: 8699, intensity: 0.45 },
  ],
};

export const bnnIdWzGSYISectionDynamics20mPreview = {
  ...bnnIdWzGSYISectionDynamics20m,
  model_version: "audio-features-librosa-v0.3-section-dynamics-preview-20m",
  source: "audio:bnnIdWzGSYI video 13:53-33:53 plus manual seed outside sample",
  note: "Preview curve for app review. Dense v0.3 points cover video 13:53-33:53; manual seed points preserve the rest of the concert until full-audio extraction is run.",
  points: [
    ...bnnIdWzGSYIManualSeedCurve.points.filter((point) => point.t < 833),
    ...bnnIdWzGSYISectionDynamics20m.points,
    ...bnnIdWzGSYIManualSeedCurve.points.filter((point) => point.t > 2033),
  ].sort((a, b) => a.t - b.t),
};

export const intensityCurveLibrary = {
  bnnIdWzGSYI: [
    {
      id: "manual-seed",
      label: "Manual seed",
      curve: bnnIdWzGSYIManualSeedCurve,
    },
    {
      id: "audio-v0.3-20m",
      label: "Audio v0.3 preview (13:53-33:53)",
      curve: bnnIdWzGSYISectionDynamics20mPreview,
    },
  ],
};
