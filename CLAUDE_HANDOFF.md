# Claude Handoff - gizzERG model/UI state

Last updated: 2026-05-27

This is a compact catch-up for Claude after the v0.3 audio extraction work.
See `HANDOFF.md` for the long-form project state.

## Current Branch/Status

- Repo: `C:\dev\roguERGlike\repos\concert-mvp`
- Branch: `develop`
- This handoff is intended to be committed with the implementation changes:
  timeline review UI, v0.4 subjective curve, sampled Raw Feel target source,
  extrema-preserving target sampling, annotation note-preservation fix, and
  related tests.
- Validation currently passes: `node --test tests/*.test.mjs` => 62/62.

## Curves / Model

Selectable curve library now has three options for `bnnIdWzGSYI`:

- `manual-seed`: default authored cue seed.
- `audio-v0.3-20m`: dense audio-derived 20-minute preview covering video
  13:53-33:53, with manual seed outside that window.
- `audio-v0.4-subjective-20m`: browser-side transform over v0.3, also covering
  video 13:53-33:53 plus manual seed outside the sample.

The v0.4 transform lives in `src/subjective-intensity.js`. It combines:

- base audio intensity
- musical pressure
- local contrast
- light style priors for the first two metal sections
- smooth-vocal release penalty

The intent is not to replace v0.3 permanently. It is a selectable preview for
side-by-side subjective review.

## Timeline Review UI

The ride timeline now supports review workflows:

- `range`: Full, 20 min, 10 min, 5 min, 2 min, Custom.
- `select`: shows start/end sliders above the chart. Green marker is start;
  red marker is end. `Zoom` applies the custom range.
- Default selected custom range is 13:53-33:53, matching the audio-derived
  preview slice after the intro.
- `song`: enables clicking bottom song-strip segments to zoom to exactly that
  song.
- `tall`: expands the chart canvas to 320px high inside the video overlay.
- `seek`: existing click-to-seek behavior.

The derived intensity overlay is now bright cyan with a dark halo. Global
min/mean/max guide lines are drawn for the selected derived curve.

In `Derived intensity` terrain mode, the derived overlay and intensity guide
lines use the same power-axis scaling as the shaded target-power area. This
makes FTP changes easier to visually evaluate.

## Raw Feel / Terrain Source Semantics

The shaded colored area under the power curve is intended to be the trainer
target path.

Important recent fix: in Raw Feel, when terrain source is `Derived intensity`
or `Blended`, the controller now receives a sampled intensity series from the
same route/source configuration. This means `Sample step` affects:

- the green/blended intensity line
- the shaded target-power area
- the target watts sent to the trainer

`Authored cues` preserves the old cue/ramp behavior.

The sampled target series is no longer just boundary sampling. It uses
`src/intensity-sampling.js` to preserve internal extrema in each coarse sample
window. That prevents short valleys/peaks from disappearing at longer sample
steps, e.g. the Motor Spirit trough around 24:42-24:54.

Open design work: extrema preservation is a first pass. The next model should
probably add asymmetric attack/release rules so intensity rises and drops can
ramp differently around peaks and valleys.

## Annotations

F2 annotations still require the sidecar.

Current behavior:

- F2 opens the overlay.
- Presets, digit hotkeys, or typed tag/note send an `annotate` command to sidecar.
- Important fix: preset clicks and digit hotkeys now include the current note
  input text. Before this fix, they sent only the preset tag and silently
  dropped typed notes.
- Sidecar echoes `rider_annotation`.
- App records current video time at receipt and draws an amber marker on the
  chart.

Current gaps:

- No offline/local annotations yet. Without sidecar, F2 errors with
  "sidecar not connected" and nothing is persisted.
- Annotation hover details are not yet shown in the timeline tooltip.
- Existing recording `sidecar/docs/recordings/music-tuning-01.jsonl` cannot
  recover the user's intended semantic notes. Its `rider_annotation` events
  contain only `tag: "marker"` plus context, no `note` field. The marker timing
  and v0.4 context are still usable as anchors for manual re-entry.

Recommended next feature: localStorage-backed offline annotations with JSON
export, plus tooltip display for nearby annotation markers.

## Files To Know

- `src/audio-derived-curves.js`: generated 20-minute v0.3 payload.
- `src/library/intensity-curves.js`: curve registry and v0.4 preview
  registration.
- `src/subjective-intensity.js`: v0.4 transform.
- `src/chart-window.js`: timeline range/window math.
- `src/intensity-sampling.js`: extrema-preserving target series builder.
- `src/erg-controller.js`: Raw Feel target generation and sampled intensity
  series support.
- `src/app.js`: review UI, timeline rendering, terrain controls, annotation
  overlay.

## Suggested Next Steps

1. Test the cache-busted app in browser:
   `http://127.0.0.1:8430`
2. Compare v0.3 vs v0.4 over 13:53-33:53 using tall/custom zoom.
3. Use sidecar-backed F2 annotations to mark `missed-intensity` and
   `false-intensity` around exact moments.
4. Add offline annotation storage/export before doing long manual review
   sessions without a trainer.
5. Revisit target sampling with asymmetric attack/release after user reviews
   extrema-preserving behavior.
