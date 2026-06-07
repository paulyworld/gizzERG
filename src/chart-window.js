export const CHART_RANGE_OPTIONS = [
  { id: "full", label: "Full", durationS: null },
  { id: "20m", label: "20 min", durationS: 20 * 60 },
  { id: "10m", label: "10 min", durationS: 10 * 60 },
  { id: "5m", label: "5 min", durationS: 5 * 60 },
  { id: "2m", label: "2 min", durationS: 2 * 60 },
  { id: "custom", label: "Custom", durationS: null },
];

export function chartWindowFor(rangeId, centerTimeS, durationS) {
  const duration = Math.max(1, Number(durationS) || 1);
  const option = CHART_RANGE_OPTIONS.find((candidate) => candidate.id === rangeId) ?? CHART_RANGE_OPTIONS[0];
  if (!option.durationS || option.durationS >= duration) {
    return { startS: 0, endS: duration, durationS: duration, rangeId: "full" };
  }
  const width = option.durationS;
  const center = clamp(Number(centerTimeS) || 0, 0, duration);
  let start = center - width / 2;
  start = clamp(start, 0, duration - width);
  return {
    startS: start,
    endS: start + width,
    durationS: width,
    rangeId: option.id,
  };
}

export function timeToXInWindow(timeS, plotLeft, plotWidth, window) {
  const duration = Math.max(1, window.endS - window.startS);
  const clampedTime = clamp(Number(timeS) || 0, window.startS, window.endS);
  return plotLeft + ((clampedTime - window.startS) / duration) * plotWidth;
}

export function customChartWindow(startS, endS, durationS) {
  const duration = Math.max(1, Number(durationS) || 1);
  const start = clamp(Number(startS) || 0, 0, duration);
  const end = clamp(Number(endS) || 0, 0, duration);
  const minWindowS = Math.min(30, duration);
  const orderedStart = Math.min(start, end);
  const orderedEnd = Math.max(start, end);
  const windowEnd = clamp(Math.max(orderedEnd, orderedStart + minWindowS), 0, duration);
  const windowStart = clamp(Math.min(orderedStart, windowEnd - minWindowS), 0, duration - minWindowS);
  return {
    startS: windowStart,
    endS: windowEnd,
    durationS: windowEnd - windowStart,
    rangeId: "custom",
  };
}

export function xToTimeInWindow(x, plotLeft, plotWidth, window) {
  const ratio = clamp((Number(x) - plotLeft) / Math.max(1, plotWidth), 0, 1);
  return window.startS + ratio * (window.endS - window.startS);
}

export function overlapsWindow(startS, endS, window) {
  return Number(endS) > window.startS && Number(startS) < window.endS;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}
