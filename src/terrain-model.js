const G = 9.80665;

export const DEFAULT_TERRAIN_OPTIONS = Object.freeze({
  sampleStepS: 5,
  ftp: 250,
  riderWeightKg: 75,
  bikeWeightKg: 9,
  baselineIntensity: 0.55,
  gradeScale: 18,
  minGrade: -2,
  maxGrade: 12,
  smoothingWindowS: 20,
  rollingResistance: 0.005,
  dragArea: 0.63,
  airDensity: 1.225,
  drivetrainEfficiency: 0.96,
  minSpeedMps: 1.2,
  maxSpeedMps: 22,
});

export function intensityToGrade(intensity, options = {}) {
  const opts = { ...DEFAULT_TERRAIN_OPTIONS, ...options };
  const raw = (Number(intensity) - opts.baselineIntensity) * opts.gradeScale;
  return clamp(raw, opts.minGrade, opts.maxGrade);
}

export function sampleTerrainRoute(profile, options = {}) {
  const opts = { ...DEFAULT_TERRAIN_OPTIONS, ...options };
  const cues = normalizeCues(profile, opts);
  const durationS = Math.max(Number(profile.duration_s ?? 0), cues.at(-1).t);
  const stepS = Math.max(1, Number(opts.sampleStepS));
  const alpha = stepS / (Math.max(0, Number(opts.smoothingWindowS)) + stepS);
  const samples = [];

  let smoothedIntensity = intensityAt(cues, 0);
  let distanceM = 0;
  let elevationM = 0;
  let elevationGainM = 0;

  for (let timeS = 0; timeS <= durationS; timeS += stepS) {
    const intensity = intensityAt(cues, timeS);
    smoothedIntensity = lerp(smoothedIntensity, intensity, alpha);
    const gradePercent = intensityToGrade(smoothedIntensity, opts);
    const powerW = clamp(smoothedIntensity * opts.ftp, 0, 2500);
    const speedMps = estimateSpeedMps(powerW, gradePercent, opts);
    const deltaDistanceM = samples.length === 0 ? 0 : speedMps * stepS;
    const deltaElevationM = deltaDistanceM * (gradePercent / 100);
    const deltaElevationGainM = Math.max(0, deltaElevationM);

    distanceM += deltaDistanceM;
    elevationM += deltaElevationM;
    elevationGainM += deltaElevationGainM;

    samples.push({
      timeS,
      intensity,
      smoothedIntensity,
      gradePercent,
      powerW,
      speedMps,
      deltaDistanceM,
      deltaElevationM,
      deltaElevationGainM,
      distanceM,
      elevationM,
      elevationGainM,
    });
  }

  return {
    durationS,
    sampleStepS: stepS,
    distanceM,
    elevationGainM,
    samples,
  };
}

export function estimateSpeedMps(powerW, gradePercent, options = {}) {
  const opts = { ...DEFAULT_TERRAIN_OPTIONS, ...options };
  const massKg = Math.max(1, Number(opts.riderWeightKg) + Number(opts.bikeWeightKg));
  const grade = Number(gradePercent) / 100;
  const rollingForce = opts.rollingResistance * massKg * G;
  const gradeForce = massKg * G * grade;
  const availablePower = Math.max(0, Number(powerW)) * opts.drivetrainEfficiency;

  if (availablePower <= 0) {
    return 0;
  }

  let lo = 0;
  let hi = Math.max(opts.minSpeedMps, opts.maxSpeedMps);
  for (let i = 0; i < 32; i += 1) {
    const mid = (lo + hi) / 2;
    const aeroForce = 0.5 * opts.airDensity * opts.dragArea * mid * mid;
    const requiredPower = Math.max(0, rollingForce + gradeForce + aeroForce) * mid;
    if (requiredPower > availablePower) {
      hi = mid;
    } else {
      lo = mid;
    }
  }
  return clamp(lo, 0, opts.maxSpeedMps);
}

export function estimatePowerForSpeedW(speedMps, gradePercent, options = {}) {
  const opts = { ...DEFAULT_TERRAIN_OPTIONS, ...options };
  const massKg = Math.max(1, Number(opts.riderWeightKg) + Number(opts.bikeWeightKg));
  const speed = Math.max(0, Number(speedMps) || 0);
  const grade = Number(gradePercent) / 100;
  const rollingForce = opts.rollingResistance * massKg * G;
  const gradeForce = massKg * G * grade;
  const aeroForce = 0.5 * opts.airDensity * opts.dragArea * speed * speed;
  const wheelPower = Math.max(0, rollingForce + gradeForce + aeroForce) * speed;
  return wheelPower / opts.drivetrainEfficiency;
}

export function routePointAt(route, distanceM) {
  if (!route?.samples?.length) {
    return null;
  }
  const target = clamp(Number(distanceM) || 0, 0, route.distanceM);
  let previous = route.samples[0];
  for (const sample of route.samples) {
    if (sample.distanceM >= target) {
      const span = Math.max(1e-9, sample.distanceM - previous.distanceM);
      const t = clamp((target - previous.distanceM) / span, 0, 1);
      return {
        timeS: lerp(previous.timeS, sample.timeS, t),
        distanceM: target,
        elevationM: lerp(previous.elevationM, sample.elevationM, t),
        elevationGainM: lerp(previous.elevationGainM, sample.elevationGainM, t),
        gradePercent: lerp(previous.gradePercent, sample.gradePercent, t),
      };
    }
    previous = sample;
  }
  const last = route.samples.at(-1);
  return {
    timeS: last.timeS,
    distanceM: route.distanceM,
    elevationM: last.elevationM,
    elevationGainM: last.elevationGainM,
    gradePercent: last.gradePercent,
  };
}

function normalizeCues(profile, options = {}) {
  if (!profile || !Array.isArray(profile.cues) || profile.cues.length === 0) {
    throw new Error("terrain profile must include at least one cue");
  }
  const derived = normalizeDerivedCurve(profile);
  if (options.intensitySource === "derived" && derived.length > 0) {
    return derived;
  }
  const cues = profile.cues
    .map((cue) => ({
      t: Number(cue.t),
      intensity: Number(cue.intensity ?? cue.ftp_pct),
    }))
    .filter((cue) => Number.isFinite(cue.t) && Number.isFinite(cue.intensity))
    .sort((a, b) => a.t - b.t);

  if (cues.length === 0) {
    throw new Error("terrain profile must include at least one valid cue");
  }
  return cues;
}

function normalizeDerivedCurve(profile) {
  const points = profile?.derived_intensity_curve?.points;
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .map((point) => ({
      t: Number(point.t),
      intensity: Number(point.intensity),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.intensity))
    .sort((a, b) => a.t - b.t);
}

function intensityAt(cues, timeS) {
  let current = cues[0];
  for (const cue of cues) {
    if (cue.t > timeS) {
      break;
    }
    current = cue;
  }
  return current.intensity;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}
