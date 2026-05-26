# gizzERG Profile Builder

First-pass local tooling for turning music analysis output into a
`derived_intensity_curve` that the browser can render and use for terrain.

The builder still accepts dependency-free precomputed feature JSON. It can also
extract features from a local audio file with `librosa`.

Install the optional audio dependencies:

```powershell
python -m pip install -r tools\profile-builder\requirements.txt
```

**Also required: `ffmpeg` on PATH** for the `--audio` and `--youtube-url`
paths. yt-dlp uses it to post-process downloads to WAV (so librosa decodes
them via the fast soundfile backend); librosa's audioread fallback uses it
for any container soundfile can't read directly.

Install ffmpeg:

- Windows: `winget install ffmpeg` (or download from https://ffmpeg.org)
- macOS: `brew install ffmpeg`
- Linux: `apt install ffmpeg` / `dnf install ffmpeg`

Alternative for systems without admin access: `pip install imageio-ffmpeg`
bundles a static binary; add its directory to PATH before running this
tool. The tool detects missing ffmpeg up front and produces a clear error
rather than failing deep in librosa.

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
      "harmonic_ratio": 0.71,
      "spectral_contrast": 0.33,
      "spectral_change": 0.12
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

To extract directly from an audio file:

```powershell
python tools\profile-builder\build_profile.py `
  --audio concert-audio.m4a `
  --out derived-curve.json `
  --sample-step-s 2
```

Audio extraction is **chunked**: the file is processed in 5-minute windows
(tunable via `--window-s`) rather than loaded whole. A 2.5-hour concert
processed whole eats ~10 GB of RAM and runs silently for several minutes;
chunked extraction keeps memory under ~500 MB per chunk and emits a tqdm
progress bar so long runs are legible.

Features are normalized **globally** (5th/95th percentile across the whole
ride) so a quiet song in the middle still reads as low intensity relative
to the loud songs at the end.

To download YouTube audio first, then extract:

```powershell
python tools\profile-builder\build_profile.py `
  --youtube-url "https://www.youtube.com/watch?v=bnnIdWzGSYI" `
  --out derived-curve.json `
  --sample-step-s 2 `
  --work-dir .\tmp\profile-audio `
  --keep-audio
```

`--keep-audio` is useful while tuning the model because the download can be
reused. Omit it when you only need the output curve.

## Model notes

The initial weighted model is:

```text
intensity =
  loudness*0.34
  + spectral_centroid*0.16
  + onset_density*0.22
  + (1 - harmonic_ratio)*0.06
  + spectral_contrast*0.14
  + spectral_change*0.08
```

`spectral_contrast` and `spectral_change` are included to capture
within-loud-song changes: riff changes, walls of distorted guitars, and
section transitions that may not move loudness much. `onset_density` is
log-scaled and smoothed before percentile normalization because raw onset
strength is heavy-tailed on real music.

Raw BPM is intentionally not part of the weighted intensity formula. BPM is
better used for cadence guidance (`cue.bpm` -> ride cadence, often half-time)
and display. For intensity, beat strength / onset density is the useful
rhythmic signal because it can vary inside a song; BPM is often nearly
constant across the exact section changes the rider feels.

Long-term calibration should use F2 rider annotations as ground truth. Tags
like `missed-intensity` and `false-intensity` identify exact timeline moments
where the model disagrees with the rider's subjective climb / sprint /
recovery feel, which is more useful than song-level averages.

Recommended future controls:

- `sample_step_s`: 1-5s for manual shifting terrain, 5-15s for smoother ERG terrain.
- `smoothing_window_s`: suppress short false peaks, especially crescendos before breaks.
- `boundary_hold_s`: require elevated signal to persist before promoting it to sustained terrain.
- Event overrides: first-class `crescendo`, `drop`, `sprint`, `lull`, and `song-boundary`.
