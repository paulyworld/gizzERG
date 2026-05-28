const DEFAULT_SUBJECTIVE_OPTIONS = {
  localWindowS: 60,
  baseWeight: 0.72,
  pressureWeight: 0.22,
  localLiftWeight: 0.18,
  stylePriorWeight: 0.12,
  releasePenaltyWeight: 0.10,
  maxIntensity: 1.25,
};

export function buildSubjectiveFeelCurve(curve, options = {}) {
  const opts = { ...DEFAULT_SUBJECTIVE_OPTIONS, ...options };
  const points = Array.isArray(curve?.points) ? curve.points : [];
  const enriched = points.map((point) => ({
    ...point,
    t: Number(point.t),
    intensity: normalize(point.intensity),
    audio_features: normalizeFeatures(point.audio_features),
  })).filter((point) => Number.isFinite(point.t) && Number.isFinite(point.intensity));

  return {
    ...curve,
    model_version: options.modelVersion ?? `${curve?.model_version ?? "audio-features"}-subjective-v0.4`,
    source: curve?.source ? `${curve.source}; subjective-feel transform` : "subjective-feel transform",
    weights: {
      ...(curve?.weights ?? {}),
      subjective_pressure: opts.pressureWeight,
      local_contrast: opts.localLiftWeight,
      release_penalty: opts.releasePenaltyWeight,
    },
    note: options.note ?? curve?.note,
    points: enriched.map((point, index) => {
      const pressure = musicalPressure(point.audio_features);
      const localLift = localContrastLift(enriched, index, opts.localWindowS);
      const stylePrior = stylePriorLift(point, opts.styleSegments);
      const release = vocalReleasePenalty(point.audio_features);
      const intensity = clamp(
        point.intensity * opts.baseWeight
          + pressure * opts.pressureWeight
          + localLift * opts.localLiftWeight
          + stylePrior * opts.stylePriorWeight
          - release * opts.releasePenaltyWeight,
        0,
        opts.maxIntensity,
      );

      return {
        ...point,
        intensity: round4(intensity),
        subjective_features: {
          base_intensity: round4(point.intensity),
          musical_pressure: round4(pressure),
          local_contrast: round4(localLift),
          style_prior: round4(stylePrior),
          vocal_release_penalty: round4(release),
        },
      };
    }),
  };
}

export function musicalPressure(features) {
  const percussiveRatio = 1 - features.harmonic_ratio;
  const denseDistortion = Math.sqrt(features.loudness * features.spectral_contrast);
  return clamp(
    features.loudness * 0.30
      + features.onset_density * 0.20
      + features.spectral_contrast * 0.18
      + features.spectral_change * 0.14
      + features.spectral_centroid * 0.08
      + percussiveRatio * 0.10
      + denseDistortion * 0.12,
    0,
    1.25,
  );
}

function localContrastLift(points, index, windowS) {
  const point = points[index];
  const halfWindow = windowS / 2;
  const neighbors = points.filter((candidate) => Math.abs(candidate.t - point.t) <= halfWindow);
  const localMean = mean(neighbors.map((candidate) => candidate.intensity));
  if (!Number.isFinite(localMean)) {
    return 0;
  }
  return clamp((point.intensity - localMean) / 0.25, 0, 1);
}

function stylePriorLift(point, styleSegments = []) {
  if (!Array.isArray(styleSegments)) {
    return 0;
  }
  const segment = styleSegments.find((candidate) => (
    point.t >= Number(candidate.start_s) && point.t < Number(candidate.end_s)
  ));
  if (!segment) {
    return 0;
  }
  const pressure = normalize(segment.pressure);
  const activeAudio = clamp(point.intensity / 0.60, 0, 1);
  return pressure * activeAudio;
}

function vocalReleasePenalty(features) {
  const smoothBrightness = Math.max(
    0,
    features.spectral_centroid
      - (features.spectral_contrast * 0.40 + features.onset_density * 0.35 + features.spectral_change * 0.25),
  );
  return clamp(smoothBrightness * features.loudness, 0, 1);
}

function normalizeFeatures(features = {}) {
  return {
    loudness: normalize(features.loudness),
    spectral_centroid: normalize(features.spectral_centroid),
    onset_density: normalize(features.onset_density),
    harmonic_ratio: normalize(features.harmonic_ratio),
    spectral_contrast: normalize(features.spectral_contrast),
    spectral_change: normalize(features.spectral_change),
  };
}

function normalize(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number, 0, 1) : 0;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  if (finite.length === 0) {
    return NaN;
  }
  return finite.reduce((total, value) => total + value, 0) / finite.length;
}

function round4(value) {
  return Math.round(value * 10000) / 10000;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
