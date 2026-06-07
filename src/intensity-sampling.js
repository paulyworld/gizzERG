export function buildExtremaPreservingSeries({
  durationS,
  sampleStepS,
  candidateTimes,
  intensityAt,
}) {
  const duration = Math.max(0, Number(durationS) || 0);
  const step = Math.max(1, Number(sampleStepS) || 1);
  const candidates = Array.isArray(candidateTimes) ? candidateTimes : [];
  const out = [];

  for (let start = 0; start <= duration; start += step) {
    const end = Math.min(duration, start + step);
    const windowTimes = uniqueSorted([
      start,
      end,
      ...candidates.filter((time) => time > start && time < end),
    ]);
    const points = windowTimes
      .map((time) => ({ t: time, intensity: Number(intensityAt(time)) }))
      .filter((point) => Number.isFinite(point.intensity));
    if (points.length === 0) {
      continue;
    }

    const minPoint = points.reduce((best, point) => (
      point.intensity < best.intensity ? point : best
    ), points[0]);
    const maxPoint = points.reduce((best, point) => (
      point.intensity > best.intensity ? point : best
    ), points[0]);

    for (const point of uniquePointsByTime([points[0], minPoint, maxPoint, points.at(-1)])) {
      pushPoint(out, point);
    }
  }
  return out;
}

function uniqueSorted(values) {
  return [...new Set(values.map((value) => Math.round(Number(value) * 1000) / 1000))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
}

function uniquePointsByTime(points) {
  const seen = new Set();
  const out = [];
  for (const point of points.sort((a, b) => a.t - b.t)) {
    if (seen.has(point.t)) {
      continue;
    }
    seen.add(point.t);
    out.push(point);
  }
  return out;
}

// Symmetric (centered) moving-average smoothing across a time window, in
// seconds. Designed for non-uniformly-sampled intensity series — for each
// input point, averages every other point whose timestamp lies within
// windowS/2 of the anchor. Returns the input unchanged if windowS <= 0 or
// the series is empty. Symmetric rather than causal so peaks don't drift in
// time when smoothed.
export function applySymmetricSmoothing(series, windowS) {
  const window = Math.max(0, Number(windowS) || 0);
  if (window === 0 || !Array.isArray(series) || series.length === 0) {
    return series;
  }
  const half = window / 2;
  const out = [];
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < series.length; i++) {
    const t = series[i].t;
    while (lo < series.length && series[lo].t < t - half) {
      lo += 1;
    }
    if (hi < lo) {
      hi = lo;
    }
    while (hi < series.length && series[hi].t <= t + half) {
      hi += 1;
    }
    let sum = 0;
    let count = 0;
    for (let j = lo; j < hi; j++) {
      sum += series[j].intensity;
      count += 1;
    }
    out.push({
      ...series[i],
      intensity: count > 0 ? sum / count : series[i].intensity,
    });
  }
  return out;
}

function pushPoint(points, point) {
  const last = points.at(-1);
  if (last && last.t === point.t) {
    last.intensity = point.intensity;
    return;
  }
  points.push({
    t: point.t,
    intensity: point.intensity,
  });
}
