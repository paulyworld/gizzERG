import { bnnIdWzGSYIAudioFeaturesFull } from "../audio-derived-curves.js";
import { buildSubjectiveFeelCurve } from "../subjective-intensity.js";

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

// Rider-tuned successor to v0.1. Replaces the sparse Motor Spirit drive +
// Mind Fuzz medley window (~1607-2036) with 26 anchor points derived from
// F2 annotations captured 2026-05-27 against the v0.4 subjective curve.
// Outside that window the curve inherits manual-seed-v0.1.
//
// Key shaping principles from the rider notes:
// - "False drop" notes (drums fill while vocals stop, banter mic spikes during
//   song break, post-20m audio cliff) → hold intensity at the surrounding peak
//   instead of letting it sag.
// - Mind Fuzz medley is bayou blues, not metal — peaks capped near 0.85 rather
//   than the 1.0-1.10 ceiling used for Motor Spirit metal peaks.
// - Banter / tuning / inter-song breaks → ~0.25-0.35 floor.
export const bnnIdWzGSYIManualSeedV02Curve = {
  model_version: "manual-seed-v0.2-motorspirit-mindfuzz",
  source:
    "rider-tuned via F2 annotations in repos/sidecar/docs/recordings/semantic-test-02.jsonl (2026-05-27)",
  sample_step_s: null,
  note: "Tuned by rider F2 annotations across the later half of Motor Spirit and the Mind Fuzz medley (t=1607-2036). Outside this window inherits manual-seed-v0.1.",
  points: [
    ...bnnIdWzGSYIManualSeedCurve.points.filter(
      (point) => point.t < 1607 || point.t > 2036,
    ),
    // --- Motor Spirit drive: later half (rider-tuned 2026-05-27) ---
    { t: 1607.8, intensity: 0.95 }, // Vocals return
    { t: 1630.6, intensity: 0.85 }, // Vocals end; verse continues — false drop
    { t: 1650.7, intensity: 0.55 }, // Intense section actually ends
    { t: 1662.9, intensity: 0.45 }, // Guitar back for next ramp
    { t: 1674.9, intensity: 0.60 }, // Drums + bass build
    { t: 1684.0, intensity: 0.95 }, // Vocals return, near peak
    { t: 1702.7, intensity: 1.00 }, // Vocals stop but music at peak
    { t: 1721.6, intensity: 1.05 }, // Vocals at peak, high-speed thrash
    { t: 1740.7, intensity: 0.95 }, // Drum fill — false drop
    { t: 1749.3, intensity: 0.85 }, // Doom-metal sustained (slower cadence)
    { t: 1775.9, intensity: 0.30 }, // Song ends abruptly → song break
    { t: 1786.3, intensity: 0.25 }, // Banter through mic — should not spike
    // --- Mind Fuzz medley: bayou blues (peaks capped ~0.85) ---
    { t: 1802.5, intensity: 0.25 }, // Tuning / intro noise
    { t: 1806.5, intensity: 0.35 }, // Guitar-only intro
    { t: 1823.6, intensity: 0.70 }, // Drums in — real start (genre cap)
    { t: 1835.8, intensity: 0.70 }, // Upbeat bayou blues
    { t: 1852.1, intensity: 0.65 }, // Harmonica fills out
    { t: 1870.9, intensity: 0.70 }, // Vocals in — modest lift
    { t: 1890.2, intensity: 0.80 }, // Start of chorus
    { t: 1906.8, intensity: 0.70 }, // Next verse
    { t: 1926.9, intensity: 0.85 }, // Chorus (this song's ceiling)
    { t: 1955.0, intensity: 0.55 }, // Jam slowdown
    { t: 1966.8, intensity: 0.65 }, // Jam building back
    { t: 1972.1, intensity: 0.75 }, // Chorus vocals return
    { t: 1981.6, intensity: 0.85 }, // Drums return — song peak
    { t: 2036.8, intensity: 0.80 }, // End of 20-min audio sample — false drop
  ].sort((a, b) => a.t - b.t),
};

// v0.3: full-concert audio features, prefixed with the manual-seed warmup
// intro (0-833) since the audio extraction starts at the first song (Gila
// Monster at 833). Inside the concert window the audio extraction is the
// sole source of truth — no manual splicing in the song range.
export const bnnIdWzGSYIAudioFeaturesV03 = {
  ...bnnIdWzGSYIAudioFeaturesFull,
  model_version: "audio-features-librosa-v0.3-section-dynamics",
  source: "audio:bnnIdWzGSYI video 833-end full v0.3 extraction; manual-seed warmup for 0-833",
  note: "Full-concert v0.3 curve. Manual seed only used for the 0-833 warmup intro; the rest is librosa-extracted at 2s sample step with per-window BPM.",
  points: [
    ...bnnIdWzGSYIManualSeedCurve.points.filter((point) => point.t < 833),
    ...bnnIdWzGSYIAudioFeaturesFull.points,
  ].sort((a, b) => a.t - b.t),
};

const bnnIdWzGSYISubjectiveFull = buildSubjectiveFeelCurve(bnnIdWzGSYIAudioFeaturesFull, {
  modelVersion: "audio-features-librosa-v0.4-subjective-feel",
  note: "v0.4 subjective transform over the full-concert v0.3 features. Local contrast, musical pressure, light style priors, and smooth-vocal release. Unsegmented songs get style_prior = 0 (no boost).",
  styleSegments: [
    { start_s: 833,  end_s: 1119, pressure: 0.45, label: "metal" },    // Gila Monster
    { start_s: 1119, end_s: 1795, pressure: 0.45, label: "metal" },    // Motor Spirit
    { start_s: 2933, end_s: 3233, pressure: 0.40, label: "metal" },    // The Balrog
    { start_s: 4004, end_s: 5038, pressure: 0.35, label: "heavy" },    // Iron Lung
    { start_s: 5038, end_s: 5644, pressure: 0.50, label: "thrash" },   // Evil Death Roll
    { start_s: 6525, end_s: 6799, pressure: 0.40, label: "heavy" },    // Hog Calling Contest
  ],
});

export const bnnIdWzGSYISubjectiveV04 = {
  ...bnnIdWzGSYISubjectiveFull,
  source: "audio:bnnIdWzGSYI video 833-end full v0.4 subjective; manual-seed warmup for 0-833",
  points: [
    ...bnnIdWzGSYIManualSeedCurve.points.filter((point) => point.t < 833),
    ...bnnIdWzGSYISubjectiveFull.points,
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
      id: "manual-seed-v0.2",
      label: "Manual seed v0.2 (Motor Spirit + Mind Fuzz rider-tuned)",
      curve: bnnIdWzGSYIManualSeedV02Curve,
    },
    {
      id: "audio-v0.3",
      label: "Audio v0.3 (full concert)",
      curve: bnnIdWzGSYIAudioFeaturesV03,
    },
    {
      id: "audio-v0.4-subjective",
      label: "Audio v0.4 subjective (full concert)",
      curve: bnnIdWzGSYISubjectiveV04,
    },
  ],
};
