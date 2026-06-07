#!/usr/bin/env python3
"""Build a gizzERG derived_intensity_curve from audio or precomputed features.

The default path accepts precomputed feature JSON. Passing ``--audio`` uses
librosa to extract a dense curve directly from a local audio file. Passing
``--youtube-url`` downloads audio with yt-dlp first, then runs the same
extraction path.

Audio extraction is **chunked** — the file is processed in N-minute windows
rather than loaded whole. A 2.5-hour concert in one shot ate ~10 GB of RAM
and ran for several minutes silently; chunked processing keeps memory under
~500 MB and emits a tqdm progress bar so long extractions are legible.

Features are normalized **globally** (5th/95th percentile across the whole
ride) so a quiet song in the middle still reads as low intensity relative
to the loud songs at the end.

Requires ffmpeg on PATH for any audio path that isn't a raw WAV/FLAC.
yt-dlp uses it for post-processing; librosa's audioread backend uses it
for decoding webm/m4a/etc.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile
from collections.abc import Sequence
from pathlib import Path

DEFAULT_WEIGHTS = {
    "loudness": 0.34,
    "spectral_centroid": 0.16,
    "onset_density": 0.22,
    "percussive_ratio": 0.06,
    "spectral_contrast": 0.14,
    "spectral_change": 0.08,
}

DEFAULT_WINDOW_S = 300.0  # 5-minute chunks for audio feature extraction


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--features", type=Path, help="Input feature JSON.")
    input_group.add_argument(
        "--audio", type=Path, help="Input audio file for librosa extraction."
    )
    input_group.add_argument(
        "--youtube-url", help="YouTube URL to download with yt-dlp before extraction."
    )
    parser.add_argument("--out", required=True, type=Path, help="Output derived curve JSON.")
    parser.add_argument(
        "--sample-step-s",
        type=float,
        default=None,
        help="Sample interval in seconds.",
    )
    parser.add_argument(
        "--model-version", default=None, help="Override model_version metadata."
    )
    parser.add_argument(
        "--sample-rate",
        type=int,
        default=22050,
        help="Audio sample rate for librosa.load.",
    )
    parser.add_argument(
        "--window-s",
        type=float,
        default=DEFAULT_WINDOW_S,
        help="Chunk size in seconds for audio feature extraction (default 300).",
    )
    parser.add_argument("--work-dir", type=Path, default=None, help="Directory for downloaded audio.")
    parser.add_argument(
        "--keep-audio",
        action="store_true",
        help="Keep downloaded audio when using --youtube-url.",
    )
    args = parser.parse_args()

    if args.youtube_url or args.audio:
        ensure_ffmpeg_available()

    if args.youtube_url:
        audio_sample_step_s = args.sample_step_s if args.sample_step_s is not None else 2.0
        with youtube_audio_file(args.youtube_url, args.work_dir, args.keep_audio) as audio_path:
            feature_doc = extract_feature_doc_from_audio(
                audio_path,
                sample_step_s=audio_sample_step_s,
                sample_rate=args.sample_rate,
                model_version=args.model_version,
                window_s=args.window_s,
            )
    elif args.audio:
        audio_sample_step_s = args.sample_step_s if args.sample_step_s is not None else 2.0
        feature_doc = extract_feature_doc_from_audio(
            args.audio,
            sample_step_s=audio_sample_step_s,
            sample_rate=args.sample_rate,
            model_version=args.model_version,
            window_s=args.window_s,
        )
    else:
        feature_doc = json.loads(args.features.read_text(encoding="utf-8"))

    curve = build_curve(
        feature_doc,
        sample_step_s=args.sample_step_s,
        model_version=args.model_version,
    )
    args.out.write_text(json.dumps(curve, indent=2) + "\n", encoding="utf-8")
    return 0


def ensure_ffmpeg_available() -> None:
    """Fail fast with a clear message if ffmpeg isn't on PATH.

    Audio extraction depends on ffmpeg in two places: yt-dlp uses it for
    post-processing downloads to WAV (so librosa decodes them cleanly via
    soundfile), and librosa's audioread fallback uses it for any container
    soundfile can't read directly (webm, m4a, ...). Producing a clean
    error here beats a 30-line ``NoBackendError`` deep inside librosa."""
    if shutil.which("ffmpeg") is not None:
        return
    raise RuntimeError(
        "ffmpeg not found on PATH. Audio extraction requires ffmpeg.\n"
        "  Windows: winget install ffmpeg  (or download from https://ffmpeg.org)\n"
        "  macOS:   brew install ffmpeg\n"
        "  Linux:   apt install ffmpeg / dnf install ffmpeg\n"
        "Alternatively, `pip install imageio-ffmpeg` provides a bundled binary;\n"
        "add its directory to PATH before running this tool."
    )


class youtube_audio_file:
    def __init__(self, url: str, work_dir: Path | None, keep_audio: bool = False):
        self.url = url
        self.keep_audio = keep_audio
        self._temp_dir: tempfile.TemporaryDirectory | None = None
        self.work_dir = work_dir
        self.audio_path: Path | None = None

    def __enter__(self) -> Path:
        if self.work_dir is None:
            self._temp_dir = tempfile.TemporaryDirectory(prefix="gizzerg-audio-")
            self.work_dir = Path(self._temp_dir.name)
        self.work_dir.mkdir(parents=True, exist_ok=True)
        self.audio_path = download_youtube_audio(self.url, self.work_dir)
        return self.audio_path

    def __exit__(self, exc_type, exc, tb) -> None:
        if self.keep_audio:
            return
        if self._temp_dir is not None:
            self._temp_dir.cleanup()


def download_youtube_audio(url: str, work_dir: Path) -> Path:
    """Download with yt-dlp and post-process to WAV via ffmpeg.

    WAV is the right output here: it's natively readable by soundfile
    (libsndfile) which is ~10x faster than going through audioread+ffmpeg
    for every subsequent librosa call. Storage cost is higher (1.5 GB for
    a 2.5h mono 22kHz file) but only matters when ``--keep-audio`` is set."""
    try:
        from yt_dlp import YoutubeDL
    except ImportError as exc:
        raise RuntimeError(
            "YouTube extraction requires yt-dlp; install tools/profile-builder/requirements.txt"
        ) from exc

    before = set(work_dir.iterdir()) if work_dir.exists() else set()
    options = {
        "format": "bestaudio/best",
        "outtmpl": str(work_dir / "%(id)s.%(ext)s"),
        "noplaylist": True,
        "quiet": False,
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
    }
    with YoutubeDL(options) as ydl:
        ydl.download([url])
    return newest_downloaded_file(work_dir, before)


def newest_downloaded_file(work_dir: Path, before: set[Path] | None = None) -> Path:
    before = before or set()
    # After post-processing the .webm/.m4a original may still be present
    # alongside the .wav. Prefer audio containers we can decode cheaply.
    PREFERRED_SUFFIXES = (".wav", ".flac", ".ogg", ".mp3", ".m4a", ".webm")
    candidates = [
        path
        for path in work_dir.iterdir()
        if path.is_file()
        and path not in before
        and path.suffix.lower() not in {".part", ".ytdl"}
    ]
    if not candidates:
        candidates = [
            path
            for path in work_dir.iterdir()
            if path.is_file() and path.suffix.lower() not in {".part", ".ytdl"}
        ]
    if not candidates:
        raise RuntimeError(f"yt-dlp did not produce an audio file in {work_dir}")
    # Prefer .wav etc. when both pre- and post-processed forms exist.
    for suffix in PREFERRED_SUFFIXES:
        for path in candidates:
            if path.suffix.lower() == suffix:
                return path
    return max(candidates, key=lambda path: path.stat().st_mtime)


def get_audio_duration_s(audio_path: Path) -> float:
    """Read the audio's total duration without loading samples.

    soundfile reads the header directly for formats it understands
    (WAV/FLAC/OGG/...). For containers it doesn't (webm/m4a), fall back
    to ffprobe; ffprobe ships with ffmpeg so it's already a dependency.
    """
    try:
        import soundfile as sf

        with sf.SoundFile(str(audio_path)) as f:
            return float(len(f) / f.samplerate)
    except Exception:
        pass
    # ffprobe fallback for webm / m4a / other containers.
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(audio_path),
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    return float(result.stdout.strip())


def extract_feature_doc_from_audio(
    audio_path: Path,
    sample_step_s: float = 2.0,
    sample_rate: int = 22050,
    model_version: str | None = None,
    window_s: float = DEFAULT_WINDOW_S,
) -> dict:
    """Extract normalized feature points from an audio file using librosa.

    Chunked: processes the audio in ``window_s``-second windows so memory
    stays bounded (~500 MB per chunk worst case for HPSS, vs ~10 GB for
    full-file extraction on a 2.5-hour concert). tqdm shows progress.

    Features are normalized **globally** at the end (5th/95th percentile
    across all chunks) so a quiet song in the middle reads as low intensity
    relative to the loud ones at the end — what per-chunk normalization
    would lose.

    The output shape intentionally matches the precomputed-feature JSON
    shape so ``build_curve`` remains the only normalization-to-profile step.
    """

    if sample_step_s <= 0:
        raise ValueError("sample_step_s must be positive")
    if window_s <= 0:
        raise ValueError("window_s must be positive")

    try:
        import librosa
        import numpy as np
        from tqdm import tqdm
    except ImportError as exc:
        raise RuntimeError(
            "audio extraction requires librosa, numpy, and tqdm; "
            "install tools/profile-builder/requirements.txt"
        ) from exc

    duration_s = get_audio_duration_s(audio_path)
    if duration_s <= 0:
        raise ValueError("audio file has zero duration")

    hop_length = 512

    raw_loudness: list[float] = []
    raw_centroid: list[float] = []
    raw_onset: list[float] = []
    raw_spectral_contrast: list[float] = []
    raw_spectral_change: list[float] = []
    harmonic_ratio: list[float] = []
    # Per-frame BPM. Kept separate from the weighted-intensity features
    # because BPM is an absolute musical value, not a 0-1 normalized signal.
    # Emitted as `bpm` per point so the chart can render real per-window
    # tempo instead of the constant `cue.bpm` held between authored cues.
    raw_tempo: list[float] = []
    frame_times: list[float] = []
    previous_centroid: float | None = None

    n_windows = max(1, math.ceil(duration_s / window_s))
    iterator = tqdm(
        range(n_windows),
        desc="extracting features",
        unit="chunk",
        file=sys.stderr,
    )
    for i in iterator:
        win_start = i * window_s
        win_dur = min(window_s, duration_s - win_start)
        if win_dur <= 0:
            continue
        y, sr = librosa.load(
            audio_path,
            sr=sample_rate,
            mono=True,
            offset=win_start,
            duration=win_dur,
        )
        if len(y) == 0:
            continue

        rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
        centroid = librosa.feature.spectral_centroid(
            y=y, sr=sr, hop_length=hop_length
        )[0]
        onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
        spectral_contrast = np.mean(
            librosa.feature.spectral_contrast(y=y, sr=sr, hop_length=hop_length),
            axis=0,
        )
        prepend_centroid = centroid[0] if previous_centroid is None else previous_centroid
        spectral_change = np.abs(np.diff(centroid, prepend=prepend_centroid))
        previous_centroid = float(centroid[-1])
        harmonic_y, percussive_y = librosa.effects.hpss(y)
        harmonic_rms = librosa.feature.rms(y=harmonic_y, hop_length=hop_length)[0]
        percussive_rms = librosa.feature.rms(y=percussive_y, hop_length=hop_length)[0]
        # Per-frame tempo from the tempogram. aggregate=None gives one BPM
        # estimate per frame (same hop_length grid as the other features),
        # which is what we need for a dynamic tempo line on the chart.
        tempo_per_frame = librosa.feature.tempo(
            y=y, sr=sr, hop_length=hop_length, aggregate=None,
        )

        frame_count = min(
            len(rms),
            len(centroid),
            len(onset),
            len(spectral_contrast),
            len(spectral_change),
            len(harmonic_rms),
            len(percussive_rms),
            len(tempo_per_frame),
        )
        if frame_count == 0:
            continue

        local_times = librosa.frames_to_time(
            np.arange(frame_count), sr=sr, hop_length=hop_length
        )
        global_times = local_times + win_start
        ratio = harmonic_rms[:frame_count] / np.maximum(
            harmonic_rms[:frame_count] + percussive_rms[:frame_count], 1e-12
        )

        raw_loudness.extend(rms[:frame_count].tolist())
        raw_centroid.extend(centroid[:frame_count].tolist())
        raw_onset.extend(onset[:frame_count].tolist())
        raw_spectral_contrast.extend(spectral_contrast[:frame_count].tolist())
        raw_spectral_change.extend(spectral_change[:frame_count].tolist())
        harmonic_ratio.extend(ratio.tolist())
        raw_tempo.extend(tempo_per_frame[:frame_count].tolist())
        frame_times.extend(global_times.tolist())

    if not frame_times:
        raise ValueError("audio feature extraction produced no frames")

    frame_times_arr = np.asarray(frame_times)
    smoothing_frames = max(1, round(sample_rate / hop_length))
    normalized_features = {
        "loudness": np.asarray(normalize_series(raw_loudness)),
        "spectral_centroid": np.asarray(normalize_series(raw_centroid)),
        "onset_density": np.asarray(
            normalize_series(raw_onset, log_scale=True, smooth_frames=smoothing_frames)
        ),
        "spectral_contrast": np.asarray(normalize_series(raw_spectral_contrast)),
        "spectral_change": np.asarray(
            normalize_series(raw_spectral_change, smooth_frames=smoothing_frames)
        ),
        "harmonic_ratio": np.asarray(harmonic_ratio),  # already 0..1 by construction
    }
    # BPM stays in absolute units (not percentile-normalized) — it's a real
    # musical value, not a relative intensity signal.
    tempo_arr = np.asarray(raw_tempo, dtype=float)

    points = []
    t = 0.0
    while t <= duration_s:
        mask = (frame_times_arr >= t) & (frame_times_arr < t + sample_step_s)
        if not np.any(mask):
            nearest = int(np.argmin(np.abs(frame_times_arr - t)))
            mask = np.zeros(len(frame_times_arr), dtype=bool)
            mask[nearest] = True
        points.append(
            {
                "t": round(t, 3),
                "loudness": round(float(np.mean(normalized_features["loudness"][mask])), 4),
                "spectral_centroid": round(
                    float(np.mean(normalized_features["spectral_centroid"][mask])), 4
                ),
                "onset_density": round(
                    float(np.mean(normalized_features["onset_density"][mask])), 4
                ),
                "harmonic_ratio": round(
                    float(np.mean(normalized_features["harmonic_ratio"][mask])), 4
                ),
                "spectral_contrast": round(
                    float(np.mean(normalized_features["spectral_contrast"][mask])), 4
                ),
                "spectral_change": round(
                    float(np.mean(normalized_features["spectral_change"][mask])), 4
                ),
                "bpm": round(float(np.mean(tempo_arr[mask])), 1),
            }
        )
        t += sample_step_s

    return {
        "model_version": model_version or "audio-features-librosa-v0.3-section-dynamics",
        "source": f"audio:{audio_path.name}",
        "sample_step_s": sample_step_s,
        "points": points,
    }


def build_curve(
    feature_doc: dict,
    sample_step_s: float | None = None,
    model_version: str | None = None,
) -> dict:
    points = feature_doc.get("points")
    if not isinstance(points, list) or not points:
        raise ValueError("features JSON must include a non-empty points array")

    out_points = []
    for point in sorted(points, key=lambda p: number(p.get("t"), "point.t")):
        audio_features = {
            "loudness": normalized(point.get("loudness", 0)),
            "spectral_centroid": normalized(point.get("spectral_centroid", 0)),
            "onset_density": normalized(point.get("onset_density", 0)),
            "harmonic_ratio": normalized(point.get("harmonic_ratio", 0)),
            "spectral_contrast": normalized(point.get("spectral_contrast", 0)),
            "spectral_change": normalized(point.get("spectral_change", 0)),
        }
        # BPM passes through in absolute units; older feature JSON without a
        # bpm field stays valid (we just omit the key in those points).
        bpm = point.get("bpm")
        if bpm is not None:
            try:
                bpm_value = float(bpm)
                if math.isfinite(bpm_value) and bpm_value > 0:
                    audio_features["bpm"] = round(bpm_value, 1)
            except (TypeError, ValueError):
                pass
        intensity = weighted_intensity(audio_features)
        out_points.append(
            {
                "t": number(point.get("t"), "point.t"),
                "intensity": round(intensity, 4),
                "audio_features": audio_features,
            }
        )

    return {
        "model_version": model_version or feature_doc.get("model_version") or "audio-features-v0.1",
        "source": feature_doc.get("source") or "audio-features",
        "sample_step_s": sample_step_s if sample_step_s is not None else feature_doc.get("sample_step_s"),
        "weights": DEFAULT_WEIGHTS,
        "points": out_points,
    }


def weighted_intensity(features: dict) -> float:
    percussive_ratio = 1 - features["harmonic_ratio"]
    raw = (
        features["loudness"] * DEFAULT_WEIGHTS["loudness"]
        + features["spectral_centroid"] * DEFAULT_WEIGHTS["spectral_centroid"]
        + features["onset_density"] * DEFAULT_WEIGHTS["onset_density"]
        + percussive_ratio * DEFAULT_WEIGHTS["percussive_ratio"]
        + features.get("spectral_contrast", 0) * DEFAULT_WEIGHTS["spectral_contrast"]
        + features.get("spectral_change", 0) * DEFAULT_WEIGHTS["spectral_change"]
    )
    return clamp(raw, 0, 1.25)


def normalized(value: object) -> float:
    return clamp(number(value, "feature"), 0, 1)


def normalize_series(
    values: Sequence[float],
    *,
    log_scale: bool = False,
    smooth_frames: int = 1,
) -> list[float]:
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("normalize_series requires numpy") from exc

    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return []
    if log_scale:
        arr = np.log1p(np.maximum(arr, 0))
    if smooth_frames > 1:
        arr = smooth_series(arr, smooth_frames)
    lo = float(np.percentile(arr, 5))
    hi = float(np.percentile(arr, 95))
    if hi <= lo:
        return [0.0 for _ in arr]
    normalized_arr = np.clip((arr - lo) / (hi - lo), 0, 1)
    return [float(value) for value in normalized_arr]


def smooth_series(values, width: int):
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("smooth_series requires numpy") from exc

    if width <= 1 or len(values) <= 1:
        return np.asarray(values, dtype=float)
    width = min(width, len(values))
    kernel = np.ones(width, dtype=float) / width
    arr = np.asarray(values, dtype=float)
    left = width // 2
    right = width - 1 - left
    padded = np.pad(arr, (left, right), mode="edge")
    return np.convolve(padded, kernel, mode="valid")


def number(value: object, name: str) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{name} must be numeric") from exc
    if not math.isfinite(result):
        raise ValueError(f"{name} must be finite")
    return result


def clamp(value: float, minimum: float, maximum: float) -> float:
    return min(maximum, max(minimum, value))


if __name__ == "__main__":
    raise SystemExit(main())
