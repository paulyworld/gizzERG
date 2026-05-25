# HANDOFF - concert MVP

> Browser-based ERG controller experiment for the YouTube concert ride.

**Last updated:** 2026-05-23
**Current branch:** `develop`
**Current focus:** Terrain-dev UI for gizzERG. The app now derives a synthetic
route from the concert profile, displays current/total distance and climbing,
draws a net-elevation line on the ride timeline, and lets the rider tune grade,
rolling resistance, aero drag, and mass from the browser. These controls are
still a dev/test surface, but they now affect estimated planned terrain TSS
instead of being display-only.

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
- The same profile now includes a seeded `derived_intensity_curve` with
  `model_version`. This seed mirrors authored cue intensity until the audio
  feature preprocessor lands, but it gives the browser and later tools a real
  schema to consume.
- The profile also includes Bandcamp-derived Night 2 tracklist metadata for the
  same video. The source is `Live in Greece '25` on Midnight Gnome People's
  Bandcamp page, which explicitly lists `bnnIdWzGSYI` as Night 2 and identifies
  tracks 18-33 as June 5, 2025.
- Browser talks directly to the sidecar WebSocket with `set_target_power`.
- Sidecar remains the only trainer I/O layer.
- A horizontal ride timeline canvas is pinned as an overlay at the bottom of
  the YouTube player. It spans the video column width, draws target power,
  target cadence, music BPM, actual power/cadence samples, rider annotations,
  and a line-only net-elevation profile. The song color background was removed
  because it made the timeline too crowded once terrain was added.
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
- The seeded derived intensity curve is drawn as a subtle dotted purple line
  and appears in the hover tooltip. Keep this visually quiet; the chart is
  already dense.
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
  selector: `Derived intensity` or `Authored cues`.
- `Sample step` controls route sampling cadence. Default is 5 seconds. Lower
  values are intended for manual-shift terrain and future audio-derived curves
  where grade should respond to musical changes more tightly than the current
  sparse authored cue map.
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

## Profile Builder / Audio Features

`tools/profile-builder/` now has the first real local audio-feature path. It
still accepts dependency-free precomputed feature JSON, and it can also extract
features from a local audio file with `librosa`.

- `build_profile.py` accepts feature JSON with points carrying `t`, `loudness`,
  `spectral_centroid`, `onset_density`, and `harmonic_ratio`.
- `build_profile.py --audio <file>` uses `librosa` to extract RMS/loudness,
  spectral centroid, onset strength, and harmonic/percussive balance, then
  samples dense points at `--sample-step-s` seconds.
- It writes `model_version`, `sample_step_s`, model weights, derived
  `intensity`, and per-point `audio_features`.
- Audio extraction emits `model_version="audio-features-librosa-v0.1"` by
  default. Current weights are loudness 0.40, spectral centroid 0.20, onset
  density 0.30, and percussive ratio 0.10.
- `build_profile.py --youtube-url <url>` downloads audio with `yt-dlp` and then
  runs the same `librosa` path. Use `--work-dir` and `--keep-audio` while
  tuning so the download can be reused.
- Dependencies are in `tools/profile-builder/requirements.txt`.

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

- `node --test tests/*.test.mjs` passes: 40/40.
- `node --check src\app.js` passes.
- `node --check src\concert-profile.js` passes.
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
- Sidecar replies with a `rider_annotation` envelope; the app pins the
  *current video time* at receipt (not WS RTT) so chart markers land at the
  rider's actual ride position.
- Markers render as dashed amber verticals + a small triangle at the top of
  the ride chart. Density is glanceable; precise inspection comes from the
  JSONL recording.
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
