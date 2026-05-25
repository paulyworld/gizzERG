# gizzERG Profile Builder

First-pass local tooling for turning music analysis output into a
`derived_intensity_curve` that the browser can render and use for terrain.

This scaffold is intentionally dependency-free. The next pass can add
`yt-dlp`/`librosa`, but the app should not have to change when the richer audio
pipeline lands.

## Current workflow

Provide an audio-feature JSON file:

```json
{
  "model_version": "audio-features-v0.1",
  "sample_step_s": 2,
  "points": [
    {
      "t": 0,
      "loudness": 0.31,
      "spectral_centroid": 0.42,
      "onset_density": 0.18,
      "harmonic_ratio": 0.71
    }
  ]
}
```

Then run:

```powershell
python tools\profile-builder\build_profile.py `
  --features features.json `
  --out derived-curve.json `
  --sample-step-s 2
```

The output is a `derived_intensity_curve` object that can be pasted into a
profile or consumed by future profile JSON tooling.

## Model notes

The initial weighted model is:

```text
intensity = loudness*0.40 + centroid*0.20 + onset_density*0.30 + (1 - harmonic_ratio)*0.10
```

Recommended future controls:

- `sample_step_s`: 1-5s for manual shifting terrain, 5-15s for smoother ERG terrain.
- `smoothing_window_s`: suppress short false peaks, especially crescendos before breaks.
- `boundary_hold_s`: require elevated signal to persist before promoting it to sustained terrain.
- Event overrides: first-class `crescendo`, `drop`, `sprint`, `lull`, and `song-boundary`.
