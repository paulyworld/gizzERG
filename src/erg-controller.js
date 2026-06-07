const DEFAULTS = {
  minWatts: 0,
  maxWatts: 420,
  maxFtpPct: 1.2,
  pauseFtpPct: 0.45,
  pauseCadenceRpm: 75,
  updatePeriodS: 5,
  largeChangeWatts: 40,
  defaultRampS: 15,
};

import { structuredTargetAt } from "./workout-patterns.js";

export class ErgWorkoutController {
  constructor(profile, options = {}) {
    this.profile = normalizeProfile(profile);
    this.options = { ...DEFAULTS, ...options };
    this.ftp = Math.max(1, Number(options.ftp ?? 250));
    this.weightKg = Math.max(1, Number(options.weightKg ?? 75));
    this.modeId = options.modeId ?? "raw_feel";
    this.warmupMinutes = Number(options.warmupMinutes ?? 15);
    this.intensitySource = options.intensitySource ?? "cues";
    this.intensityBlend = Number(options.intensityBlend ?? 0.65);
    this.intensitySeries = normalizeIntensitySeries(options.intensitySeries);
    this._lastSentWatts = null;
    this._lastWriteAtMs = -Infinity;
    this._lastPlaybackTime = 0;
  }

  setRider({ ftp, weightKg, maxWatts } = {}) {
    if (ftp != null) {
      this.ftp = Math.max(1, Number(ftp));
    }
    if (weightKg != null) {
      this.weightKg = Math.max(1, Number(weightKg));
    }
    if (maxWatts != null) {
      this.options.maxWatts = Math.max(this.options.minWatts, Number(maxWatts));
    }
  }

  setMode({ modeId, warmupMinutes } = {}) {
    if (modeId != null) {
      this.modeId = String(modeId);
    }
    if (warmupMinutes != null) {
      this.warmupMinutes = Number(warmupMinutes);
    }
  }

  setIntensitySource({ intensitySource, intensityBlend, intensitySeries } = {}) {
    if (intensitySource != null) {
      this.intensitySource = String(intensitySource);
    }
    if (intensityBlend != null) {
      this.intensityBlend = Number(intensityBlend);
    }
    if (intensitySeries !== undefined) {
      this.intensitySeries = normalizeIntensitySeries(intensitySeries);
    }
  }

  resetWrites() {
    this._lastSentWatts = null;
    this._lastWriteAtMs = -Infinity;
  }

  targetAt(videoTimeS) {
    const time = clamp(Number(videoTimeS) || 0, 0, this.profile.duration_s);
    const { cue, previous } = this._cuePairAt(time);
    const rawTarget = this._rawTargetFromCue(time, cue, previous);
    const target = structuredTargetAt(rawTarget, time, this.profile.duration_s, this.modeId, {
      warmupMinutes: this.warmupMinutes,
    });
    const gap = this._breakGapAt(time);
    if (gap) {
      // Music ended within this song but the authored boundary hasn't been
      // reached yet — banter, applause, intermission. Drop the trainer to
      // easy-spin (pauseFtpPct) for the gap so the rider gets recovery
      // rather than holding the per-section target through silence.
      const breakPct = clamp(this.options.pauseFtpPct, 0, this.options.maxFtpPct);
      const breakWatts = Math.round(
        clamp(breakPct * this.ftp, this.options.minWatts, this.options.maxWatts),
      );
      return {
        ...target,
        ftpPct: breakPct,
        watts: breakWatts,
        cadenceRpm: Math.round(this.options.pauseCadenceRpm),
        wkg: breakWatts / this.weightKg,
        label: `${target.label} → break`,
        intensitySource: "break-gap",
        inBreakGap: true,
        breakGap: gap,
      };
    }
    const watts = Math.round(clamp(target.ftpPct * this.ftp, this.options.minWatts, this.options.maxWatts));
    return {
      ...target,
      watts,
      cadenceRpm: Math.round(target.cadenceRpm),
      wkg: watts / this.weightKg,
    };
  }

  // Detect whether we're inside a music-ended-but-song-not-over gap. Walks
  // profile.tracks (sparse — most tracks don't carry `music_end_offset_s`
  // because they segue continuously). Returns { from, to, trackTitle } when
  // in a gap, null otherwise.
  _breakGapAt(time) {
    const tracks = this.profile.tracks;
    if (!Array.isArray(tracks) || tracks.length === 0) return null;
    let cursor = Number(this.profile.tracklist_intro_offset_s) || 0;
    for (const track of tracks) {
      const start = cursor;
      const end = start + Number(track.duration_s);
      const musicEndOffset = Number(track.music_end_offset_s);
      if (Number.isFinite(musicEndOffset) && musicEndOffset > 0) {
        const musicEnd = start + musicEndOffset;
        if (time >= musicEnd && time < end) {
          return { from: musicEnd, to: end, trackTitle: track.title };
        }
      }
      cursor = end;
    }
    return null;
  }

  _rawTargetFromCue(time, cue, previous) {
    const basePct = clamp(cue.ftp_pct, 0, this.options.maxFtpPct);
    const authoredPct = this._rampedPct(time, cue, previous, basePct);
    const { intensity: rawFeelIntensity, source } = this._rawFeelIntensityAt(time, authoredPct);
    const targetPct = rawFeelIntensity ?? authoredPct;
    const musicBpm = Number(cue.music_bpm ?? cue.bpm);
    return {
      ftpPct: targetPct,
      cadenceRpm: Math.round(cue.cadence_rpm),
      bpm: Math.round(musicBpm),
      musicBpm: Math.round(musicBpm),
      label: cue.label,
      cue,
      intensitySource: source,
    };
  }

  _rawFeelIntensityAt(time, authoredPct) {
    if (this.modeId !== "raw_feel") {
      return { intensity: null, source: "cues" };
    }
    if (this.intensitySource === "derived") {
      const derived = this._selectedIntensityAt(time);
      return { intensity: derived, source: derived == null ? "cues" : "derived" };
    }
    if (this.intensitySource === "blended") {
      const derived = this._selectedIntensityAt(time);
      if (derived == null) {
        return { intensity: null, source: "cues" };
      }
      return {
        intensity: clamp(lerp(authoredPct, derived, clamp(this.intensityBlend, 0, 1)), 0, this.options.maxFtpPct),
        source: "blended",
      };
    }
    return { intensity: null, source: "cues" };
  }

  _derivedIntensityAt(time) {
    const curve = this.profile.derived_intensity_curve;
    if (!curve || !Array.isArray(curve.points)) {
      return null;
    }
    let current = null;
    for (const point of curve.points) {
      const pointTime = Number(point.t);
      if (!Number.isFinite(pointTime)) {
        continue;
      }
      if (pointTime > time) {
        break;
      }
      current = point;
    }
    if (!current) {
      return null;
    }
    const intensity = Number(current.intensity);
    if (!Number.isFinite(intensity)) {
      return null;
    }
    return clamp(intensity, 0, this.options.maxFtpPct);
  }

  _selectedIntensityAt(time) {
    if (this.intensitySeries.length > 0) {
      return this._seriesIntensityAt(time);
    }
    return this._derivedIntensityAt(time);
  }

  _seriesIntensityAt(time) {
    let current = null;
    for (const point of this.intensitySeries) {
      if (point.t > time) {
        break;
      }
      current = point;
    }
    return current ? clamp(current.intensity, 0, this.options.maxFtpPct) : null;
  }

  pauseTarget(videoTimeS) {
    const current = this.targetAt(videoTimeS);
    const targetPct = clamp(this.options.pauseFtpPct, 0, this.options.maxFtpPct);
    const watts = Math.round(clamp(targetPct * this.ftp, this.options.minWatts, this.options.maxWatts));
    return {
      watts,
      ftpPct: targetPct,
      cadenceRpm: Math.round(this.options.pauseCadenceRpm),
      bpm: current.bpm,
      label: "Paused / easy spin",
      cue: current.cue,
      wkg: watts / this.weightKg,
    };
  }

  shouldSendTarget(videoTimeS, nowMs, { playing, force = false } = {}) {
    if (!playing) {
      return { send: false, target: this.targetAt(videoTimeS), reason: "paused" };
    }

    const time = Number(videoTimeS) || 0;
    const target = this.targetAt(time);
    const changed = this._lastSentWatts == null || target.watts !== this._lastSentWatts;
    const periodElapsed = nowMs - this._lastWriteAtMs >= this.options.updatePeriodS * 1000;
    const scrubbed = Math.abs(time - this._lastPlaybackTime) > this.options.updatePeriodS + 2;

    this._lastPlaybackTime = time;

    if (force || scrubbed || (changed && periodElapsed)) {
      return { send: true, target, reason: force ? "forced" : scrubbed ? "seek" : "changed" };
    }
    return { send: false, target, reason: "unchanged" };
  }

  markSent(watts, nowMs) {
    this._lastSentWatts = Math.round(Number(watts));
    this._lastWriteAtMs = nowMs;
  }

  _cuePairAt(time) {
    let previous = this.profile.cues[0];
    let cue = this.profile.cues[0];
    for (const next of this.profile.cues) {
      if (next.t > time) {
        break;
      }
      previous = cue;
      cue = next;
    }
    return { cue, previous };
  }

  _rampedPct(time, cue, previous, basePct) {
    if (cue === previous) {
      return basePct;
    }
    const rampS = Math.max(0, Number(cue.ramp_s ?? this.options.defaultRampS));
    const deltaPct = Math.abs(cue.ftp_pct - previous.ftp_pct);
    const needsRamp = deltaPct * this.ftp >= this.options.largeChangeWatts;
    if (!needsRamp || rampS <= 0) {
      return basePct;
    }
    const progress = clamp((time - cue.t) / rampS, 0, 1);
    return lerp(previous.ftp_pct, basePct, smoothstep(progress));
  }
}

export function normalizeProfile(profile) {
  if (!profile || !Array.isArray(profile.cues) || profile.cues.length === 0) {
    throw new Error("profile must include at least one cue");
  }
  const cues = profile.cues
    .map((cue) => ({
      t: Number(cue.t),
      label: String(cue.label ?? "Section"),
      bpm: Number(cue.bpm),
      ftp_pct: Number(cue.ftp_pct),
      cadence_rpm: Number(cue.cadence_rpm),
      ramp_s: Number(cue.ramp_s ?? DEFAULTS.defaultRampS),
    }))
    .filter((cue) => Number.isFinite(cue.t))
    .sort((a, b) => a.t - b.t);
  return {
    ...profile,
    duration_s: Math.max(Number(profile.duration_s ?? cues[cues.length - 1].t), cues[cues.length - 1].t),
    cues,
  };
}

export function formatTime(totalSeconds) {
  const total = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function targetMaintained(actualPower, actualCadence, target) {
  const powerOk = Number(actualPower) >= target.watts * 0.95;
  const cadenceOk = Number(actualCadence) >= target.cadenceRpm - 5;
  return { powerOk, cadenceOk, maintained: powerOk && cadenceOk };
}

function normalizeIntensitySeries(points) {
  if (!Array.isArray(points)) {
    return [];
  }
  return points
    .map((point) => ({
      t: Number(point.t ?? point.timeS),
      intensity: Number(point.intensity),
    }))
    .filter((point) => Number.isFinite(point.t) && Number.isFinite(point.intensity))
    .sort((a, b) => a.t - b.t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
