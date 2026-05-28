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
