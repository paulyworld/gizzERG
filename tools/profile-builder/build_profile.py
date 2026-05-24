#!/usr/bin/env python3
"""Build a gizzERG derived_intensity_curve from precomputed audio features.

This is a dependency-free bridge tool. Future versions can add yt-dlp/librosa
feature extraction ahead of this normalization step.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path


DEFAULT_WEIGHTS = {
    "loudness": 0.40,
    "spectral_centroid": 0.20,
    "onset_density": 0.30,
    "percussive_ratio": 0.10,
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--features", required=True, type=Path, help="Input feature JSON.")
    parser.add_argument("--out", required=True, type=Path, help="Output derived curve JSON.")
    parser.add_argument("--sample-step-s", type=float, default=None, help="Override sample interval metadata.")
    parser.add_argument("--model-version", default=None, help="Override model_version metadata.")
    args = parser.parse_args()

    feature_doc = json.loads(args.features.read_text(encoding="utf-8"))
    curve = build_curve(
        feature_doc,
        sample_step_s=args.sample_step_s,
        model_version=args.model_version,
    )
    args.out.write_text(json.dumps(curve, indent=2) + "\n", encoding="utf-8")
    return 0


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
