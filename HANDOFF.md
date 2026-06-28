# HANDOFF - concert MVP

> Browser-based ERG controller experiment for the YouTube concert ride.

**Last updated:** 2026-06-27
**Current branch:** `docs/2026-06-27-reconcile-handoff` (handoff-only; code baseline aligned with `origin/develop` at `9e57784`)
**Current focus:** Music-intensity review and tuning UI for gizzERG. The app
now supports selectable curve versions, a v0.4 subjective-feel curve,
zoomable/tall timeline review, sidecar-backed F2 annotations, and Raw Feel
target power driven by sampled derived/blended intensity. Terrain controls are
still a dev/test surface, but they now affect the shaded target-power path when
Raw Feel uses `Derived intensity` or `Blended`.

**2026-06-06 update — tuning controls + full-concert curves landed:**

| Area | What landed |
|---|---|
| **Full-concert audio extraction** | v0.3 / v0.4 now cover 833→end of the concert (3974 points at 2s sample step). Manual-seed splice removed for t≥833 — audio extraction is the sole source past the warmup intro. Constants renamed: `bnnIdWzGSYISectionDynamics20m` → `bnnIdWzGSYIAudioFeaturesFull`; exposed via `bnnIdWzGSYIAudioFeaturesV03` + `bnnIdWzGSYISubjectiveV04`. Library ids: `audio-v0.3-20m`/`audio-v0.4-subjective-20m` → `audio-v0.3`/`audio-v0.4-subjective`. |
| **Per-window BPM** | `tools/profile-builder/build_profile.py` calls `librosa.feature.tempo(..., aggregate=None)` per chunk; `bpm` lands unnormalized in `audio_features`. Range observed: 68-172 BPM (median 112). Chart's BPM line, guidance text, and hover tooltip prefer per-window BPM via `audioBpmAt(time)`; fall back to per-section `cue.bpm` when the active curve has no audio data. Tooltip labels source as `(per-window)` vs `(per-section)`. |
| **Default metal style segments** | v0.4 `styleSegments` extended beyond Gila/Motor Spirit: The Balrog (0.40), Iron Lung (0.35, label `heavy`), Evil Death Roll (0.50, label `thrash`), Hog Calling Contest (0.40). Unsegmented songs still get `style_prior = 0` — extend the list in `src/library/intensity-curves.js` as you tune more sections. |
| **Rider-tuned manual seed v0.2** | New `bnnIdWzGSYIManualSeedV02Curve` (`model_version: manual-seed-v0.2-motorspirit-mindfuzz`) — 26 dense anchor points across t=1607-2036 derived from F2 annotations in `repos/sidecar/docs/recordings/semantic-test-02.jsonl`. Outside that window inherits v0.1. Selectable via `manual-seed-v0.2` library id. |
| **Intensity smoothing slider** | New 0-60s symmetric centered moving-average. Default off (preserves extrema). Applied at `derivedIntensityPoints()` so it affects chart overlay, controller target series, F2 annotation context, *and* the BPM line — single knob, consistent everywhere. |
| **Authored Cues chart overlay** | New `cues` toggle in the chart header. Renders `profile.cues` as a rose-magenta step line on the same power-axis as the cyan derived overlay. Lets you compare authored / derived / blended at a glance while tuning the blend slider. |
| **Curve dropdown persistence** | LocalStorage-keyed per video id (`gizzERG:curveSelection:<videoId>`). Falls back to first option gracefully when the stored id no longer exists. Boot-time init reorder fixed: `activateSelectedProfile({ reloadVideo: false })` now runs after `populateCurveSelect()` so the restored choice *actually loads* (was a dropdown-only restore before). |

**2026-06-06 follow-up — per-song music-end detection landed:**

- `tools/analyze-music-end.mjs` walks `bnnIdWzGSYIAudioFeaturesFull` and uses a smoothed-loudness threshold (≥0.20 over an 8s symmetric window) plus a 6s trailing-quiet hold to find where music actually ends within each authored song window. Validated against the rider's F2 anchor for Motor Spirit (detected 1777 vs rider 1775.9 — 1.1s diff, within 2s sample-step resolution).
- `src/library/videos.js` — `music_end_offset_s` baked into 6 of 16 Night-2 tracks. Other 10 are continuous live segues (verified via spot-check on Gila→Motor Spirit, I'm in Your Mind suite, Iron Lung→Evil Death Roll — loudness stays high through transitions).
- `src/erg-controller.js` — `targetAt()` detects break gaps via new `_breakGapAt(time)`. Inside a gap, returns an easy-spin target (`pauseFtpPct`, `pauseCadenceRpm`), labels it `<track> → break`, sets `inBreakGap: true` + `intensitySource: "break-gap"`, attaches the `breakGap: { from, to, trackTitle }` window for downstream consumers. Trainer command also drops automatically.
- BPM line (`drawMusicBpmCurve`) skips drawing during gaps — break in the line is the visual signal. Guidance text + hover tooltip both show "between songs (break)" instead of holding stale per-section BPM.
- 4 new controller tests cover gap detection, normal target outside gaps, resumption after gaps, and continuous-segue songs (no gap field → no override).

Detected gaps (validated where rider notes exist):

| Song | authored end | music end | gap | source |
|---|---|---|---|---|
| Motor Spirit | 1795 | 1777 | 18s | rider F2 confirmed |
| The Balrog | 3233 | 3203 | 30s | auto-detected |
| Sad Pilot | 4004 | 3981 | 23s | auto-detected |
| The Bitter Boogie | 6525 | 6509 | 16s | auto-detected |
| Hog Calling Contest | 6799 | 6791 | 8s | auto-detected |
| Set | 8753 | 8719 | 34s | auto-detected (end-of-show applause) |

The detector is conservative: requires ≥6s of sustained low loudness, so brief instrumental dips inside a song don't false-trigger. Re-run `node tools/analyze-music-end.mjs` after any audio re-extraction; bake new offsets into `videos.js` manually based on the output table.

**2026-06-27 update - local develop reconciled:**

- Local `develop` was previously ahead/behind `origin/develop` because two older Codex commits (`2816227`, `29db8ae`) predated the merged full-concert work.
- Created backup branch `codex-backup-develop-before-reconcile-20260627`, rebased onto `origin/develop`, and skipped those two commits because origin's `3c0187c` + `9e57784` are the newer superset.
- Current validation: `node --test tests/*.test.mjs` passes 69/69; `node --check src\app.js`, `src\erg-controller.js`, and `src\terrain-model.js` pass.

## ⚠️ Known UX gotcha (gizzERG issue #4)

Pressing a preset digit (1-5) inside the F2 overlay auto-submits immediately. To attach a note to a preset tag, type the note *first*, then press the digit. Riders who reach for the digit first lose the qualitative context. Validated 2026-05-27 smoke test (`repos/sidecar/docs/recordings/f2-smoke-test.jsonl`); filed at https://github.com/paulyworld/gizzERG/issues/4 with three suggested fixes.

## Current Shape

- Static browser app served from `repos/concert-mvp`.
- YouTube IFrame API provides playback time, pause, resume, and seeking. The
  app now loads the API from `src/app.js` after registering the callback; do
  not put a separate `https://www.youtube.com/iframe_api` script tag before the
  module, because that can race and leave the player blank.
- `src/erg-controller.js` maps video time + rider FTP/weight to target watts,
  cadence guidance, and section labels.
- Workout mode support now exists. `Raw Feel` preserves the music-first manual
  map. Sports-backed modes call `src/workout-patterns.js` to produce structured
  workout targets while using the music as a rough guide.
- `src/concert-profile.js` contains the first manual rolling map for
  `bnnIdWzGSYI`.
- The app now has a minimal profile library split:
  `src/library/videos.js` owns video identity, YouTube URL, duration, intro
  offset, source metadata, and tracklist; `src/library/intensity-curves.js`
  owns selectable intensity curves; `src/concert-profile.js` composes those
  into the app-facing profile.
- The default curve remains the manual seeded `derived_intensity_curve` with
  `model_version="manual-seed-v0.1"`. Two selectable 20-minute audio previews
  are registered for the King Gizzard video:
  `audio-features-librosa-v0.3-section-dynamics-preview-20m` and
  `audio-features-librosa-v0.4-subjective-feel-preview-20m`. Both use dense
  points for video 13:53-33:53 and manual seed points outside that sample
  window, so testing curve versions does not break the rest of the concert.
  v0.4 is a browser-side transform over the v0.3 payload: local contrast,
  musical pressure, light style priors, and smooth-vocal release penalty.
- The profile also includes Bandcamp-derived Night 2 tracklist metadata for the
  same video. The source is `Live in Greece '25` on Midnight Gnome People's
  Bandcamp page, which explicitly lists `bnnIdWzGSYI` as Night 2 and identifies
  tracks 18-33 as June 5, 2025.
- Browser talks directly to the sidecar WebSocket with `set_target_power`.
- Sidecar remains the only trainer I/O layer.
- A horizontal ride timeline canvas is pinned as an overlay at the bottom of
  the YouTube player. It spans the video column width, draws target power,
  target cadence, music BPM, actual power/cadence samples, rider annotations,
  a line-only net-elevation profile, derived/blended intensity overlays, and
  global intensity min/mean/max guide lines. The song color background was
  removed because it made the timeline too crowded once terrain was added.
- Video pause uses an app-level soft pause: the browser immediately sends a
  low easy-spin target instead of waiting for cadence bailout. The sidecar's
  cadence bailout still owns the low-cadence safety case, including delayed
  floor drop, queued restore targets, and intensity-aware resume ramps.
- Browser ERG writes are gated on sidecar state: WebSocket open,
  `device_capabilities.target_power=true`, and `control_acquired=true`.

## Sidecar Control / Pause Policy

The app and sidecar now have distinct responsibilities:

- **Intentional video pause:** handled in the browser immediately. When the
  YouTube player transitions from playing to paused/ended, the app computes
  `controller.pauseTarget(...)` and sends a low target via `set_target_power`.
  Default is 45% FTP and 75 rpm guidance.
- **Rider stops pedalling / locked-crank safety:** handled by the sidecar
  cadence bailout. The sidecar waits based on current intensity, drops to the
  configured floor, queues any later `set_target_power` as restore intent while
  bailout is active, and ramps back on cadence resume.
- **Overlap case:** if the app sends the soft-pause target while sidecar bailout
  is already active, sidecar replies with
  `target_power_set accepted=false reason="bailout-pending"`. The app now
  displays this as "queued by cadence bailout" instead of treating it as a hard
  rejection.

This means the app no longer relies on cadence bailout to make an intentional
video pause feel sane. Bailout remains a safety backstop for actual rider
dropout.

## Trainer-Control State Handling

`src/app.js` tracks:

- `supportsTargetPower` from `device_capabilities.data.target_power`
- `controlAcquired` from `control_acquired` / `control_released`
- `targetPowerAck` from `target_power_set`

`sendTargetPower(...)` only writes when:

- WebSocket is open
- target power is supported
- trainer control has been acquired
- video is playing, unless this is the explicit soft-pause write

On `control_acquired`, the app immediately sends the current ride target if the
video is playing, or the soft-pause target if the video is paused.

## Ride Timeline Chart

The canvas is `#rideChart` in `index.html`, drawn by `drawRideChart()` in
`src/app.js`.

Current chart behavior:

- Full-width pinned to the bottom of the YouTube player.
- The chart no longer draws song-color background bands. Songs now live in the
  strip below the canvas so the plot area has fewer overlapping visual layers.
- The chart header has a `songs` toggle that draws vertical song-boundary lines
  behind the power graph when desired.
- The chart header has a `range` selector: `Full`, `20 min`, `10 min`,
  `5 min`, `2 min`, and `Custom`. Preset ranges center on current video time.
  `Custom` is set by the `select` controls.
- The `select` toggle exposes start/end sliders above the chart and a `Zoom`
  button. Slider movement draws a green vertical start marker and red vertical
  end marker on the chart. The default selection is the current 20-minute
  audio-review slice, 13:53-33:53.
- The `song` toggle turns song-strip segments into zoom targets. Clicking a
  song segment sets the custom range exactly to that song.
- The `tall` toggle expands the chart canvas to 320px high inside the video
  overlay, staying above the transport controls.
- The bottom song strip includes an explicit `Intro / warmup` segment before
  Gila Monster. Segment widths are exactly proportional to their timeline
  duration and aligned to the chart plot area. Song title tabs use the
  green-to-red intensity gradient; long titles stay clipped by default and
  marquee-scroll only when the segment is active or hovered. Hovered segments
  lift above their neighbors until hover ends.
- Target power is drawn as the filled area under the curve. Fill color encodes
  workout intensity: green for easy, yellow/orange for tempo/threshold, red for
  hard.
- Terrain is drawn as a line-only net-elevation profile. Descents reduce the
  line because `sample.elevationM` is net elevation; cumulative positive gain
  remains available separately as `sample.elevationGainM` and
  `route.elevationGainM`. Elevation is scaled against the default route domain
  instead of auto-normalizing every slider state, so endpoint movement reflects
  terrain tuning changes. The right side of the chart includes an elevation
  axis/legend.
- The selected derived intensity curve is drawn as a bright cyan dotted line
  with a dark halo so it remains visible above green/yellow/red power fills.
  In `Derived intensity` mode, this overlay uses the same power-axis scaling as
  the shaded target-power area, so changing FTP does not make the visual
  comparison drift. In `Blended` and `Authored cues` modes, the derived overlay
  remains an intensity-scale reference.
- Horizontal guide lines show global min/mean/max intensity for the selected
  derived curve. In `Derived intensity` mode, these guide lines use the same
  power-axis scaling as the derived overlay.
- Rider progress traces over the net-elevation line with a white progress
  stroke and marker. The terrain dev readout shows current/total distance and
  current/total positive gain.
- Target cadence is overlaid on the same chart as a blue dotted line.
- Music BPM is overlaid as a separate white dashed line so BPM estimates can be
  checked against a tapping metronome. The hover tooltip reports the exact
  music BPM at the inspected timestamp.
- Actual samples are captured once per second while the video is playing.
- Actual power samples are drawn as narrow overlays: green only when both power
  and cadence are maintained; red if either drops below threshold.
- Hovering over the chart shows the time, section label, target watts/%FTP,
  target cadence, song title, terrain grade/distance/elevation, power zone,
  cadence zone, and nearest actual sample within five seconds. A gold hover
  line marks the inspected timestamp.
- Timeline click-to-seek is available only when the small `seek` checkbox in
  the chart header is enabled. With it enabled, clicking the chart seeks the
  YouTube player to the hovered timestamp, updates the external seek slider,
  resets ERG write throttling, and immediately recalculates the target. With
  it disabled, chart hover is read-only to avoid accidental jumps during a
  real ride.

Current caveat: annotation marker hover does not yet show annotation
tag/note. Markers are visible, but tooltip integration is still pending.

The threshold helper is `targetMaintained(...)` in `src/erg-controller.js`:

- Power maintained: actual power >= 95% of target watts.
- Cadence maintained: actual cadence >= target cadence - 5 rpm.

This should be mostly green in ERG mode if the trainer is following target.
The red/green history is intentionally useful for future freeride or shifting
mode, where the rider must actively hold the target.

## Terrain Dev Mode

Terrain is currently generated client-side from the concert profile. The route
is the same regardless of ERG/manual intent; trainer-control mode decides what
drives rider feel.

- `src/terrain-model.js` owns the first route model:
  `sampleTerrainRoute(...)`, `intensityToGrade(...)`,
  `estimateSpeedMps(...)`, `estimatePowerForSpeedW(...)`, and
  `routePointAt(...)`.
- `sampleTerrainRoute(...)` prefers `profile.derived_intensity_curve.points`
  when present. Pass `intensitySource: "cues"` to force the authored cue map
  instead; this is covered by tests.
- The terrain panel now exposes that choice directly with a `Terrain source`
  selector: `Derived intensity`, `Blended`, or `Authored cues`.
- `Sample step` controls route sampling cadence. Default is 5 seconds. Lower
  values are intended for manual-shift terrain and future audio-derived curves
  where grade should respond to musical changes more tightly than the current
  sparse authored cue map.
- In Raw Feel, `Derived intensity` and `Blended` target power now use the same
  sampled source series as the terrain route, so sample-step changes affect the
  shaded target-power area and the target watts sent to the trainer. `Authored
  cues` preserves the original cue/ramp behavior.
- The sampled target series uses `src/intensity-sampling.js` to preserve
  extrema inside coarse sample windows. Each sample window keeps its start/end
  plus the strongest internal peak and deepest internal valley from the
  underlying derived/blended curve. This is intended to avoid swallowing short
  troughs/peaks at longer sample steps, e.g. the Motor Spirit drop around
  24:42-24:54.
- The route keeps net elevation and positive gain separate. `elevationM` is the
  mountain cross-section line. `elevationGainM` is cumulative climbing for
  totals/export context.
- Terrain tuning sliders live in `index.html` / `src/app.js`: grade scale,
  baseline, min/max grade, smoothing, bike mass, rolling resistance, and aero
  drag.
- Slider titles and the help text below the panel explain the current default
  setpoints and what each control changes.
- `Reset terrain defaults` returns all terrain sliders to the default setpoints
  and recomputes the route, chart, and terrain-adjusted TSS.
- Terrain speed in the dev readout uses live rider power when sidecar power is
  available. Without sidecar/live power, it reports modeled speed from the
  generated route.
- Planned terrain TSS uses a bounded terrain difficulty multiplier over the
  original planned watts. This keeps slider feedback visible without producing
  impossible multi-thousand TSS rides from raw constant-speed climb physics.
  This remains a dev approximation until sidecar-owned distance/elevation and
  export semantics land.

Open terrain caveat: sidecar should eventually own ride distance/elevation as
the recording/export authority once it accepts a terrain profile from the
client. The browser still owns route design and preview.

Open model caveat: extrema preservation is a first-pass sampler, not final ride
feel logic. Future work should add asymmetric attack/release rules so rises and
drops can ramp differently around peaks/valleys rather than behaving like
simple step holds.

## Profile Builder / Audio Features

`tools/profile-builder/` now has the first real local audio-feature path. It
still accepts dependency-free precomputed feature JSON, and it can also extract
features from a local audio file with `librosa`.

- `build_profile.py` accepts feature JSON with points carrying `t`, `loudness`,
  `spectral_centroid`, `onset_density`, `harmonic_ratio`,
  `spectral_contrast`, and `spectral_change`. The last two are optional for
  older feature docs and default to zero in the weighted model.
- `build_profile.py --audio <file>` uses `librosa` to extract RMS/loudness,
  spectral centroid, onset strength, harmonic/percussive balance, spectral
  contrast, and spectral change, then samples dense points at
  `--sample-step-s` seconds.
- It writes `model_version`, `sample_step_s`, model weights, derived
  `intensity`, and per-point `audio_features`.
- Audio extraction emits `model_version="audio-features-librosa-v0.3-section-dynamics"`
  by default. Current weights are loudness 0.34, spectral centroid 0.16,
  onset density 0.22, percussive ratio 0.06, spectral contrast 0.14, and
  spectral change 0.08.
- `src/subjective-intensity.js` adds a browser-side v0.4 preview transform
  over the existing v0.3 payload. It combines:
  `base_intensity`, `musical_pressure`, `local_contrast`, a light
  `style_prior`, and `vocal_release_penalty`. This is deliberately selectable
  in the UI rather than replacing v0.3, so v0.3/v0.4 can be reviewed side by
  side by switching the `Curve` selector.
- Current 20-minute comparison on the 13:53-33:53 review slice:
  v0.3 min/p50/p90/max/avg was roughly `0.119/0.571/0.660/0.743/0.542`;
  v0.4 was roughly `0.120/0.590/0.716/0.824/0.571`. Gila and Motor Spirit
  peaks are lifted relative to v0.3, while the partial I'm in Your Mind section
  is less globally boosted.
- Raw BPM is intentionally not a weighted intensity feature. Keep it in
  `cue.bpm` for cadence guidance and display; use onset/beat strength and
  local timbre-change features for musical intensity.
- The F2 annotation loop is the model calibration path. `missed-intensity` and
  `false-intensity` at exact timestamps are more useful than song-level
  averages for training subjective climb / sprint / recovery feel.
- `build_profile.py --youtube-url <url>` downloads audio with `yt-dlp` and then
  runs the same `librosa` path. Use `--work-dir` and `--keep-audio` while
  tuning so the download can be reused.
- Dependencies are in `tools/profile-builder/requirements.txt`.

### Curve / video library

The settings panel has two selectors:

- `Video` is populated from `concertProfiles`, which currently wraps one
  library video: `bnnIdWzGSYI`.
- `Curve` is populated from `profile.available_intensity_curves`. Current
  options are `manual-seed`, `audio-v0.3-20m`, and
  `audio-v0.4-subjective-20m`.

The file layout is intentionally small but points toward a future library
manager:

- `src/library/videos.js`: canonical video metadata, including
  `youtube_id`, `youtube_url`, `duration_s`, `tracklist_intro_offset_s`, and
  `tracks`.
- `src/library/intensity-curves.js`: registered curves for each video id. The
  manual seed lives here, and preview curves are composed here.
- `src/audio-derived-curves.js`: generated dense curve data. Keep generated
  audio-feature payloads out of `concert-profile.js`; register them through
  `src/library/intensity-curves.js`.
- `src/concert-profile.js`: app-facing composition layer for the current MVP
  controller/tests.

This keeps the current manual setup as the default while allowing local curve
experiments from the UI. For now, adding another video means adding one object
to `videos.js`, adding its curve options to `intensity-curves.js`, and adding
the composed profile in `concert-profile.js`.

### Claude handoff — yt-dlp + librosa validation

Claude already validated the live YouTube/audio path on the 20-minute review
slice. The full 2.5-hour extraction was killed by request after the pipeline
proved expensive but functional. Current local validation includes:

- `python -m pip install -r tools\profile-builder\requirements.txt`
  succeeded on this machine.
- `python -m unittest discover tools\profile-builder\tests` passes.
- `python -m py_compile tools\profile-builder\build_profile.py` passes.
- `node --test tests/*.test.mjs` passes: 69/69.
- Synthetic WAV smoke test succeeded:
  `python tools\profile-builder\build_profile.py --audio C:\tmp\gizzerg-smoke.wav --out C:\tmp\gizzerg-smoke-curve.json --sample-step-s 1`
  produced an `audio-features-librosa-v0.1` curve with dense points. Current
  extraction emits `audio-features-librosa-v0.3-section-dynamics`.
- Real-music 20-minute smoke covered video 13:53-33:53 and produced the
  committed/generated `src/audio-derived-curves.js` payload used by v0.3 and
  transformed by v0.4.

Next full-audio validation for Claude, when ready:

```powershell
cd C:\dev\roguERGlike\repos\concert-mvp
python tools\profile-builder\build_profile.py `
  --youtube-url "https://www.youtube.com/watch?v=bnnIdWzGSYI" `
  --out C:\tmp\bnnIdWzGSYI.audio-features-librosa-v0.3-section-dynamics.json `
  --sample-step-s 2 `
  --work-dir C:\tmp\gizzerg-profile-audio `
  --keep-audio
```

Review generated JSON before registering it as a selectable curve:

- Confirm duration/point count roughly matches the YouTube video length.
- Confirm `model_version` is `audio-features-librosa-v0.3-section-dynamics`.
- Check min/median/max intensity and a handful of high-intensity timestamps.
- Compare peaks against obvious musical peaks and the 13:53 tracklist intro
  offset.
- Do **not** paste dense generated curves into `src/concert-profile.js`.
  Put generated payloads in a dedicated module such as
  `src/audio-derived-curves.js`, then register/select them through
  `src/library/intensity-curves.js`.

Recommended follow-up if the curve is hard to inspect: add a tiny summary mode
to `build_profile.py` or a separate script that prints duration, sample step,
min/median/max intensity, and top peak timestamps.

## Tracklist Discovery Direction

The current implementation uses a manually captured Bandcamp result for this
specific YouTube video:

- Source URL: `https://midnightgnomepeople.bandcamp.com/album/live-in-greece-25`
- The page says Night 2 is `https://www.youtube.com/watch?v=bnnIdWzGSYI`.
- The page lists tracks 18-33 as June 5, 2025 at Lycabettus Theatre in Athens.
- Those tracks and durations are stored in `profile.tracks`.
- The current alignment uses the rider-observed video intro offset:
  `tracklist_intro_offset_s=833` (13:53). This makes Gila Monster start at
  13:53 and Motor Spirit start around 18:39. The first 13:53 is treated as
  generic warmup.
- `duration_s` is now intro offset plus Bandcamp track durations, currently
  8753 seconds. Keep this invariant when editing track durations.
- The original MVP cue map only covered the first hour, which caused the full
  Bandcamp-length timeline to sit in `Easy spin` after Iron Lung. The current
  `profile.cues` now spans the full Night 2 duration.

## Warmup Policy

The 0:00-13:53 intro block is an on-bike warmup, not part of the Bandcamp
tracklist. The current warmup ramps from 45% FTP to about 68% FTP and cadence
from 78 to 90 rpm before Gila Monster starts. This follows common cycling
warmup guidance: use 10-20 minutes to progressively build intensity before
harder work. References checked while making this decision:

- British Cycling describes a progressive 20-minute warm-up and notes that
  longer rides often use the first 10-20 minutes to build toward intended pace.
- TrainingPeaks guidance commonly frames warmup as gradually increasing from
  Z1 toward Z2 over the first 10-15 minutes.

Do not treat the Bandcamp first song as starting at video time 0 unless the
source video is trimmed.

## BPM vs Cadence

`cue.bpm` now represents observed/estimated music BPM, not ride cadence. Fast
peaks can legitimately be around 200-220 BPM. The ride target is separately
stored as `cadence_rpm`, often half-time or otherwise derated to a practical
cycling target such as 103-110 rpm. The UI readout now says e.g. "206 music BPM,
ride 103 rpm" to avoid implying the music itself is only 103 BPM.

## Workout Modes / Sports Pattern Library

The app now has a mode selector:

- `Raw Feel`: current concert-first map, preserving the authored intensity and
  cadence feel.
- `Aerobic Builder`: full-video endurance/tempo ride with a progressive warmup,
  mostly endurance/tempo work, and cooldown.
- `Tempo Intervals`: progressive warmup, repeated tempo/recovery/sweet-spot
  blocks, and cooldown.

The sports-backed rules live in `src/workout-patterns.js`. They intentionally
start small:

- A local FTP-zone and cadence-range library.
- Rules for progressive warmup, endurance/tempo bias on long rides, limited
  VO2 work, recoveries between work intervals, and cooldown.
- Source metadata from British Cycling and TrainerRoad.

The structured modes still use music data, but only as a rough modifier. They
do not blindly follow concert intensity, because concerts are not designed like
training sessions. Cadence is also mode-shaped: it keeps the music's feel but
clamps to plausible workout cadence bands.

Warmup is user-selectable with a `Warmup` minutes input. For now this applies
to the whole-video structured modes. Future smart behavior could choose start
and stop times based on desired workout duration, track boundaries, and target
training stimulus.

Current UI note: `Warmup` and `Track offset` are entered as `min:sec` text
fields, e.g. `13:53`. A plain number is treated as minutes. Units are visible
for the other settings fields.

Later development candidates:

- Smarter workout templates: endurance, sweet spot, threshold, VO2, recovery,
  race simulation.
- Training objective selector and duration selector.
- Save corrected generated profile.
- Promote the current terrain preview into a sidecar-recorded distance/elevation
  model once the sidecar accepts route profiles and owns ride progress.

## TSS / Post-Workout Analysis

`src/workout-analysis.js` estimates planned and actual training load:

- Planned analysis samples `controller.targetAt(time)` across the whole video.
- Terrain-adjusted planned analysis lives in `src/app.js` for now. It uses the
  tuned terrain route to estimate the watts required to hold the neutral planned
  ERG speed over the current grade/mass/rolling/aero settings.
- Actual analysis uses recorded ride samples captured while the video plays.
- Weighted power is approximated with a fourth-power mean of sampled watts.
- Intensity Factor is `weightedPower / FTP`.
- TSS is estimated as `duration_hours * IF^2 * 100`.
- Compliance reports maintained percentage, power-maintained percentage,
  cadence-maintained percentage, and average power/cadence deltas.

This is an MVP approximation, not a full TrainingPeaks-grade NP/TSS
implementation. A later implementation should use rolling 30-second normalized
power windows and cleaner pause/excluded-time handling.

The UI shows:

- Live estimated TSS and IF metric tiles. Before ride samples exist, these show
  the terrain-adjusted planned estimate so slider changes affect difficulty.
- A Workout analysis section that shows original ERG-plan TSS/IF plus
  terrain-adjusted TSS/IF/weighted power before riding, then current ride
  estimates/compliance once samples exist.

Future automation should probably be a small resolver script/service rather
than direct browser scraping. Reasons:

- Bandcamp, Archive.org, and ResListen pages/APIs will have different schemas.
- Browser-side scraping will often hit CORS limitations.
- Matching needs confidence scoring because videos may have intro/slate time,
  crowd noise, missing songs, or edits that shift the audio relative to album
  durations.

Suggested resolver shape:

1. Input YouTube video id/title/channel/description.
2. Search Bandcamp, ResListen, and Archive.org for exact video id first.
3. Fall back to artist + venue/date title matching.
4. Extract song titles and durations.
5. Produce `tracks`, `tracklist_source`, and a guessed `tracklist_intro_offset_s`.
6. Let the rider tune offset in the UI and save the corrected profile.

## Layout Notes

The page is designed to fit a normal laptop viewport without the right-side
control panel forcing the video down:

- `body` is viewport-locked on desktop.
- `.shell` is `height: 100vh` with compact padding.
- `.control-panel` uses internal grid rows and `overflow: hidden`.
- The vertical cue timeline and event log each scroll inside their own panel
  regions.
- On narrower screens, the layout returns to normal document scrolling.

The YouTube embed may still letterbox depending on the source video's aspect
ratio; that is controlled by the embed/player content rather than page padding.

## Run

```powershell
cd C:\dev\roguERGlike\repos\sidecar
$env:PYTHONPATH="src"
python -m roguerglike_sidecar.cli --mode mock --allow-trainer-control
```

```powershell
cd C:\dev\roguERGlike\repos\concert-mvp
python -m http.server 8430 --bind 127.0.0.1
```

Open `http://127.0.0.1:8430`.

## Validation

Full local test run:

```powershell
node --test tests/*.test.mjs
```

Known PowerShell issue: `npm test` may be blocked by local execution policy
because it resolves to `npm.ps1`; use the direct Node command above.

Current validation performed:

- `node --test tests/*.test.mjs` passes: 69/69.
- `node --check src\app.js` passes.
- `node --check src\erg-controller.js` passes.
- `node --check src\chart-window.js` passes.
- `node --check src\intensity-sampling.js` passes.
- `node --check src\subjective-intensity.js` passes.
- Static files served successfully from `http://127.0.0.1:8430`.
- Headless Chrome loaded `http://127.0.0.1:8430` after the terrain TSS startup
  regression was fixed.
- Sidecar WebSocket command path was smoke-tested with the soft-pause target.
  During an active cadence bailout, sidecar returned:

```json
{"watts":113,"accepted":false,"reason":"bailout-pending"}
```

That is expected: the sidecar queued the app's soft-pause target as restore
intent rather than writing it while bailout was active.

## Rider Annotations (F2)

`src/annotations.js` owns the wire contract: tag presets, hotkey mapping,
`buildAnnotateCommand({tag, note, clientId})` that mirrors the sidecar
schema bounds (tag 1-64, note ≤280) so client-side mistakes don't have to
round-trip to discover.

`src/app.js` wires the overlay (markup in `index.html`, styles in
`styles.css`) and the chart markers:

- **F2** anywhere on the page toggles the overlay. Works regardless of focus.
- Inside the overlay: digits **1-5** send the preset tag immediately;
  **Esc** cancels; **Enter** sends the typed tag + note.
- Preset buttons and digit hotkeys now preserve the current note text. A prior
  bug sent only `tag: "marker"` when using presets/hotkeys, even if the note
  box had text. That is fixed in `src/app.js`; refresh the browser so
  `src/app.js?v=annotation-notes-1` is loaded before doing more annotation
  sessions.
- Sidecar replies with a `rider_annotation` envelope; the app pins the
  *current video time* at receipt (not WS RTT) so chart markers land at the
  rider's actual ride position.
- Markers render as dashed amber verticals + a small triangle at the top of
  the ride chart. Density is glanceable; precise inspection comes from the
  JSONL recording.
- Current limitation: annotations require the sidecar WebSocket. Without the
  sidecar, F2 shows "sidecar not connected" and nothing is persisted. Offline
  browser-local annotations plus JSON export are the next useful tuning feature.
- Current limitation: hovering near an annotation marker does not yet show its
  tag/note in the chart tooltip. The markers draw, but tooltip integration is
  still pending.
- Current UX gotcha (issue #4): pressing a preset digit (1-5) inside the
  overlay auto-submits immediately. To attach a note to a preset tag the rider
  must type the note *first* and *then* press the digit. Riders who reach for
  the digit first (its label names the tag) lose the qualitative context.
  Validated 2026-05-27 smoke test in
  `repos/sidecar/docs/recordings/f2-smoke-test.jsonl`.
- Recovery note: `repos/sidecar/docs/recordings/music-tuning-01.jsonl` did not
  persist the user's typed semantic notes because it was recorded before the
  preset/hotkey note fix. The file still preserves 41 Motor Spirit marker
  timestamps plus v0.4 intensity/audio-feature context, so it can be used as a
  re-entry scaffold, but the original note text is not recoverable from the
  JSONL/CSV artifacts.
- F2 context now includes `profile_id`, `profile_version`,
  `intensity_model_version`, `mode`, `video_id`, `section`,
  `estimated_intensity`, target/live power, cadence, HR, W/kg, and
  `hardware_source` when known. `audio_features` is also included when the
  derived curve point carries it; the current seed curve does not yet have real
  audio features.

Wire format matches the sidecar `annotate` command exactly — see
`repos/sidecar/docs/event-schema.md`. Vocabulary (`ui-pause`, `walk-away`,
`bug`, `unfair`, `marker`) is pinned to that doc by a test in
`tests/annotations.test.mjs`.

## Terrain authoring direction

Profile authoring direction (Blended Terrain Model, override types, override
events, terrain themes) is **maintained in the engine planning doc**, not
duplicated here:

- **Canonical proposal:** `repos/engine/docs/music-intensity-proposal.md`
  (PR #13). See Piece 3b — Blended Terrain Model for the next step
  (`Authored cues` / `Derived intensity` / `Blended` selector + blend slider
  + typed override events).
- **Vocabulary anchor:** `repos/engine/docs/vocabulary.md` Part 3 — Profile
  Authoring Vocabulary. Defines override types (`cap` / `floor` / `anchor` /
  `event` / `manual-override`), override events (`crescendo` / `drop` /
  `song-boundary`), and terrain themes (`climbing` / `rolling` / `flat` /
  `mixed`) with stable wire-format names.

Edit those files first; reference them here. The drift risk that motivated
this split: two near-mirror copies (engine doc + HANDOFF) would drift out
of sync on the next edit. The engine doc wins.

## Open Hardening Notes

- Harden `normalizeProfile` against malformed profile files where every cue has
  an invalid timestamp. It currently validates that the original cue array is
  non-empty, filters invalid cue times, then assumes at least one cue remains.
  This is not a current-profile bug, but should be fixed before loading external
  or user-authored profiles.
