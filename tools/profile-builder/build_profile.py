#!/usr/bin/env python3
"""Build a gizzERG derived_intensity_curve from audio or precomputed features.

The default path accepts precomputed feature JSON. Passing ``--audio`` uses
librosa to extract the first real dense curve directly from an audio file.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Sequence


DEFAULT_WEIGHTS = {
    "loudness": 0.40,
    "spectral_centroid": 0.20,
    "onset_density": 0.30,
    "percussive_ratio": 0.10,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    input_group = parser.add_mutually_exclusive_group(required=True)
    input_group.add_argument("--features", type=Path, help="Input feature JSON.")
    input_group.add_argument("--audio", type=Path, help="Input audio file for librosa extraction.")
    parser.add_argument("--out", required=True, type=Path, help="Output derived curve JSON.")
    parser.add_argument("--sample-step-s", type=float, default=None, help="Sample interval in seconds.")
    parser.add_argument("--model-version", default=None, help="Override model_version metadata.")
    parser.add_argument("--sample-rate", type=int, default=22050, help="Audio sample rate for librosa.load.")
    args = parser.parse_args()

    if args.audio:
        audio_sample_step_s = args.sample_step_s if args.sample_step_s is not None else 2.0
        feature_doc = extract_feature_doc_from_audio(
            args.audio,
            sample_step_s=audio_sample_step_s,
            sample_rate=args.sample_rate,
            model_version=args.model_version,
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


def extract_feature_doc_from_audio(
    audio_path: Path,
    sample_step_s: float = 2.0,
    sample_rate: int = 22050,
    model_version: str | None = None,
) -> dict:
    """Extract normalized feature points from an audio file using librosa.

    The output shape intentionally matches the precomputed-feature JSON shape so
    ``build_curve`` remains the only normalization-to-profile step.
    """

    if sample_step_s <= 0:
        raise ValueError("sample_step_s must be positive")

    try:
        import librosa
        import numpy as np
    except ImportError as exc:
        raise RuntimeError(
            "audio extraction requires librosa and numpy; install tools/profile-builder/requirements.txt"
        ) from exc

    y, sr = librosa.load(audio_path, sr=sample_rate, mono=True)
    if len(y) == 0:
        raise ValueError("audio file contained no samples")

    hop_length = 512
    rms = librosa.feature.rms(y=y, hop_length=hop_length)[0]
    centroid = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=hop_length)[0]
    onset = librosa.onset.onset_strength(y=y, sr=sr, hop_length=hop_length)
    harmonic, percussive = librosa.effects.hpss(y)
    harmonic_rms = librosa.feature.rms(y=harmonic, hop_length=hop_length)[0]
    percussive_rms = librosa.feature.rms(y=percussive, hop_length=hop_length)[0]

    frame_count = min(len(rms), len(centroid), len(onset), len(harmonic_rms), len(percussive_rms))
    if frame_count == 0:
        raise ValueError("audio feature extraction produced no frames")

    frame_times = librosa.frames_to_time(np.arange(frame_count), sr=sr, hop_length=hop_length)
    features = {
        "loudness": np.asarray(normalize_series(rms[:frame_count])),
        "spectral_centroid": np.asarray(normalize_series(centroid[:frame_count])),
        "onset_density": np.asarray(normalize_series(onset[:frame_count])),
    }
    harmonic_energy = harmonic_rms[:frame_count]
    percussive_energy = percussive_rms[:frame_count]
    harmonic_ratio = harmonic_energy / np.maximum(harmonic_energy + percussive_energy, 1e-12)

    duration_s = float(librosa.get_duration(y=y, sr=sr))
    points = []
    t = 0.0
    while t <= duration_s:
        mask = (frame_times >= t) & (frame_times < t + sample_step_s)
        if not np.any(mask):
            nearest = int(np.argmin(np.abs(frame_times - t)))
            mask = np.zeros(frame_count, dtype=bool)
            mask[nearest] = True
        points.append({
            "t": round(t, 3),
            "loudness": round(float(np.mean(features["loudness"][mask])), 4),
            "spectral_centroid": round(float(np.mean(features["spectral_centroid"][mask])), 4),
            "onset_density": round(float(np.mean(features["onset_density"][mask])), 4),
            "harmonic_ratio": round(float(np.mean(harmonic_ratio[mask])), 4),
        })
        t += sample_step_s

    return {
        "model_version": model_version or "audio-features-librosa-v0.1",
        "source": f"audio:{audio_path.name}",
        "sample_step_s": sample_step_s,
        "points": points,
    }


def build_curve(feature_doc: dict, sample_step_s: float | None = None, model_version: str | None = None) -> dict:
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
        }
        intensity = weighted_intensity(audio_features)
        out_points.append({
            "t": number(point.get("t"), "point.t"),
            "intensity": round(intensity, 4),
            "audio_features": audio_features,
        })

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
    )
    return clamp(raw, 0, 1.25)


def normalized(value: object) -> float:
    return clamp(number(value, "feature"), 0, 1)


def normalize_series(values: Sequence[float]) -> list[float]:
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("normalize_series requires numpy") from exc

    arr = np.asarray(values, dtype=float)
    if arr.size == 0:
        return []
    lo = float(np.percentile(arr, 5))
    hi = float(np.percentile(arr, 95))
    if hi <= lo:
        return [0.0 for _ in arr]
    normalized_arr = np.clip((arr - lo) / (hi - lo), 0, 1)
    return [float(value) for value in normalized_arr]


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
