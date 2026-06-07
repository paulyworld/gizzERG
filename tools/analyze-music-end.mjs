// Analyze per-song music-end vs authored cue boundary.
//
// For each Night-2 song window, walk the audio-derived points and find the
// last contiguous point where the music is still playing — based on a
// smoothed combination of loudness + onset_density above an empirical
// threshold. Outputs a per-song table comparing authored_end against the
// detected music_end, plus the gap (in seconds).
//
// Validates against the rider's F2 anchor at t=1775.9 for Motor Spirit
// ("Song ends abruptly... should drop to a consistent level for the song
// break"). The authored Motor Spirit boundary is 1795, so the rider says
// music actually ended ~19s earlier.
//
// Run from repo root: node tools/analyze-music-end.mjs

import { concertVideos } from "../src/library/videos.js";
import { bnnIdWzGSYIAudioFeaturesFull } from "../src/audio-derived-curves.js";

// Tunables. Smoothed loudness alone is the cleanest signal for music-vs-quiet
// transitions. Onset density spikes during applause and crowd clapping
// (rhythmic onsets without true musical content) — including it as an OR
// pushes the detected end well past where the band actually stopped. The
// smoothing window damps single-frame dips and short instrumental holes
// within songs. Hold-time guards against the song just ending right at the
// authored boundary (no detectable banter gap).
const MUSIC_LOUDNESS_THRESHOLD = 0.20;
const SMOOTHING_WINDOW_S       = 8.0;   // ±4s around each point
const MIN_QUIET_HOLD_S         = 6.0;   // need this many continuous seconds below threshold to call it music-end

function smoothedSignalAt(points, anchorT, halfWindowS, fieldExtractor) {
  // Symmetric moving-average over a ±halfWindowS window.
  let sum = 0;
  let count = 0;
  for (const p of points) {
    if (p.t < anchorT - halfWindowS) continue;
    if (p.t > anchorT + halfWindowS) break;
    const value = fieldExtractor(p);
    if (Number.isFinite(value)) {
      sum += value;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function isMusic(points, idx, halfWindowS) {
  const t = points[idx].t;
  const loud = smoothedSignalAt(points, t, halfWindowS, (p) => p.audio_features?.loudness);
  return loud >= MUSIC_LOUDNESS_THRESHOLD;
}

function detectMusicEnd(points, startS, endS) {
  // Walk from authored end backward toward the song start. Find the last
  // point where the music heuristic is still true, AND that's followed by
  // at least MIN_QUIET_HOLD_S of continuous "not music" before the authored
  // end. If we never see that pattern, fall back to the authored end.
  const inWindow = points.filter((p) => p.t >= startS && p.t <= endS);
  if (inWindow.length === 0) return null;

  const halfWindow = SMOOTHING_WINDOW_S / 2;
  let lastMusicIdx = -1;
  // Find last "music" point.
  for (let i = inWindow.length - 1; i >= 0; i--) {
    if (isMusic(inWindow, i, halfWindow)) {
      lastMusicIdx = i;
      break;
    }
  }
  if (lastMusicIdx < 0) return null;

  const lastMusicT = inWindow[lastMusicIdx].t;
  const tailQuietS = endS - lastMusicT;
  if (tailQuietS < MIN_QUIET_HOLD_S) {
    // The song's audio runs right up to its authored boundary. No detectable
    // banter/applause gap.
    return null;
  }
  return lastMusicT;
}

function songWindows(video) {
  // profile.tracks list start_s = intro_offset + cumulative previous durations.
  let cursor = video.tracklist_intro_offset_s;
  const out = [];
  for (const track of video.tracks) {
    const start = cursor;
    const end = cursor + track.duration_s;
    out.push({ title: track.title, start, end });
    cursor = end;
  }
  return out;
}

function pad(s, n) { return String(s).padEnd(n, " "); }
function rpad(s, n) { return String(s).padStart(n, " "); }

function analyze() {
  const video = concertVideos.find((v) => v.id === "bnnIdWzGSYI");
  const points = bnnIdWzGSYIAudioFeaturesFull.points;
  const windows = songWindows(video);

  console.log(`Analyzing ${points.length} audio points across ${windows.length} songs.`);
  console.log(`Heuristic: smoothed loudness >= ${MUSIC_LOUDNESS_THRESHOLD}`);
  console.log(`Smoothing window: ${SMOOTHING_WINDOW_S}s; min trailing quiet hold: ${MIN_QUIET_HOLD_S}s`);
  console.log("");
  console.log(`${pad("song", 26)} ${rpad("auth_end", 9)} ${rpad("music_end", 10)} ${rpad("gap_s", 7)}  note`);
  console.log("-".repeat(80));

  for (const w of windows) {
    const detected = detectMusicEnd(points, w.start, w.end);
    let gap = "";
    let note = "";
    if (detected != null) {
      gap = (w.end - detected).toFixed(1);
      // Rider's F2 anchor for Motor Spirit: 1775.9 = "song ends abruptly"
      if (w.title === "Motor Spirit") {
        const diff = Math.abs(detected - 1775.9);
        note = `rider F2 said 1775.9 → diff ${diff.toFixed(1)}s`;
      }
    } else {
      note = "no detectable trailing quiet — music runs to authored end";
    }
    console.log(
      `${pad(w.title, 26)} ${rpad(w.end, 9)} ${rpad(detected?.toFixed(1) ?? "—", 10)} ${rpad(gap, 7)}  ${note}`,
    );
  }
}

analyze();

function dumpTail(label, startS, endS) {
  console.log("");
  console.log(`${label} (t=${startS}..${endS}):`);
  console.log("t       loud   onset  hrm   sc     scc    bpm");
  for (const p of bnnIdWzGSYIAudioFeaturesFull.points) {
    if (p.t < startS || p.t > endS) continue;
    const f = p.audio_features;
    const pct = (n) => n.toFixed(2);
    console.log(
      `${rpad(p.t, 6)} ${pct(f.loudness)} ${pct(f.onset_density)} ${pct(f.harmonic_ratio)} ${pct(f.spectral_centroid)} ${pct(f.spectral_change)} ${rpad(f.bpm?.toFixed(0) ?? "—", 4)}`,
    );
  }
}
// Sanity-check songs where the detector said "no gap" — confirm music is
// actually running right up to the boundary (vs the threshold being too lax).
dumpTail("Gila Monster tail (Gila→Motor Spirit segue suspected)", 1110, 1130);
dumpTail("I'm in Your Mind tail (segue into I'm Not suspected)", 2028, 2050);
dumpTail("Iron Lung tail (segue into Evil Death Roll suspected)", 5028, 5050);
