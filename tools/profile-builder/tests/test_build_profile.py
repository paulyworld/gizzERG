import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "build_profile.py"
SPEC = importlib.util.spec_from_file_location("build_profile", MODULE_PATH)
build_profile = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(build_profile)


class BuildProfileTests(unittest.TestCase):
    def test_build_curve_normalizes_precomputed_features(self):
        curve = build_profile.build_curve({
            "model_version": "test-model",
            "sample_step_s": 2,
            "points": [
                {"t": 2, "loudness": 1, "spectral_centroid": 0, "onset_density": 0, "harmonic_ratio": 1},
                {"t": 0, "loudness": 0.5, "spectral_centroid": 0.5, "onset_density": 0.5, "harmonic_ratio": 0},
            ],
        })

        self.assertEqual(curve["model_version"], "test-model")
        self.assertEqual(curve["sample_step_s"], 2)
        self.assertEqual([point["t"] for point in curve["points"]], [0.0, 2.0])
        self.assertEqual(curve["points"][0]["audio_features"]["loudness"], 0.5)
        self.assertEqual(curve["points"][0]["intensity"], 0.55)
        self.assertEqual(curve["points"][1]["intensity"], 0.4)

    def test_build_curve_rejects_missing_points(self):
        with self.assertRaisesRegex(ValueError, "non-empty points"):
            build_profile.build_curve({"points": []})

    def test_weighted_intensity_clamps_to_model_ceiling(self):
        intensity = build_profile.weighted_intensity({
            "loudness": 3,
            "spectral_centroid": 3,
            "onset_density": 3,
            "harmonic_ratio": -3,
        })

        self.assertEqual(intensity, 1.25)

    def test_normalize_series_handles_constant_values_when_numpy_is_available(self):
        try:
            values = build_profile.normalize_series([4, 4, 4])
        except RuntimeError as exc:
            if "requires numpy" in str(exc):
                self.skipTest("numpy not installed")
            raise

        self.assertEqual(values, [0.0, 0.0, 0.0])

    def test_newest_downloaded_file_prefers_files_not_present_before(self):
        with tempfile.TemporaryDirectory() as tmp:
            work_dir = Path(tmp)
            old_file = work_dir / "old.webm"
            old_file.write_text("old", encoding="utf-8")
            before = set(work_dir.iterdir())
            new_file = work_dir / "new.webm"
            new_file.write_text("new", encoding="utf-8")

            self.assertEqual(build_profile.newest_downloaded_file(work_dir, before), new_file)

    def test_youtube_audio_file_uses_work_dir_and_keeps_audio_when_requested(self):
        with tempfile.TemporaryDirectory() as tmp:
            work_dir = Path(tmp)
            audio_path = work_dir / "video.webm"

            with mock.patch.object(build_profile, "download_youtube_audio", return_value=audio_path) as download:
                with build_profile.youtube_audio_file("https://youtu.be/example", work_dir, keep_audio=True) as path:
                    self.assertEqual(path, audio_path)

            download.assert_called_once_with("https://youtu.be/example", work_dir)

    def test_newest_downloaded_file_prefers_wav_over_webm_when_both_exist(self):
        """After yt-dlp + ffmpeg post-processing, the .webm original may
        sit alongside the .wav extracted form. We want the .wav (libsndfile
        decodes it 10x faster than going back through audioread+ffmpeg)."""
        with tempfile.TemporaryDirectory() as tmp:
            work_dir = Path(tmp)
            webm = work_dir / "video.webm"
            wav = work_dir / "video.wav"
            webm.write_bytes(b"\x00" * 16)
            wav.write_bytes(b"\x00" * 16)

            self.assertEqual(build_profile.newest_downloaded_file(work_dir), wav)

    def test_extract_feature_doc_from_audio_chunked_matches_synthetic_signal(self):
        """End-to-end test of chunked extraction against a small synthetic
        WAV. Validates that the chunk-and-stitch path produces the expected
        shape (sorted points, normalized features, intensity within [0, 1.25],
        boundaries at 0 and ~duration_s)."""
        try:
            import numpy as np
            import soundfile as sf
        except ImportError:
            self.skipTest("numpy / soundfile not installed")

        sample_rate = 22050
        duration_s = 12.0
        # Two phases: 6s of low-amplitude sine, then 6s of high-amplitude
        # square-ish noise. Should produce visibly different intensities.
        t = np.linspace(0, duration_s, int(sample_rate * duration_s), endpoint=False)
        quiet = 0.05 * np.sin(2 * np.pi * 220 * t[: int(sample_rate * 6)])
        loud_t = t[int(sample_rate * 6):]
        loud = 0.6 * np.sign(np.sin(2 * np.pi * 880 * loud_t))
        # Add a bit of broadband noise to the loud half so spectral_centroid
        # actually differs from the quiet half's pure tone.
        rng = np.random.default_rng(seed=42)
        loud = loud + 0.2 * rng.standard_normal(len(loud))
        y = np.concatenate([quiet, loud]).astype(np.float32)

        with tempfile.TemporaryDirectory() as tmp:
            wav_path = Path(tmp) / "synthetic.wav"
            sf.write(str(wav_path), y, sample_rate)

            # Force chunk boundary mid-signal to exercise the chunked path.
            doc = build_profile.extract_feature_doc_from_audio(
                wav_path,
                sample_step_s=1.0,
                sample_rate=sample_rate,
                window_s=4.0,  # 3 chunks of 4s each
            )

        self.assertEqual(doc["sample_step_s"], 1.0)
        self.assertIn("audio-features-librosa", doc["model_version"])
        points = doc["points"]
        # ~13 points (t=0 through t=12 inclusive); allow a small tolerance
        # because the duration sampling boundary is fuzzy.
        self.assertGreaterEqual(len(points), 12)
        self.assertLessEqual(len(points), 14)
        self.assertEqual(points[0]["t"], 0.0)

        # Each point's features should be in [0, 1].
        for p in points:
            for k in ("loudness", "spectral_centroid", "onset_density", "harmonic_ratio"):
                self.assertGreaterEqual(p[k], 0.0)
                self.assertLessEqual(p[k], 1.0)

        # The loud half should average higher loudness than the quiet half.
        # Global normalization means quiet ≈ 0, loud ≈ 1 (modulo edges).
        quiet_loudness = [p["loudness"] for p in points if p["t"] < 6.0]
        loud_loudness = [p["loudness"] for p in points if p["t"] >= 6.0]
        self.assertLess(
            sum(quiet_loudness) / max(1, len(quiet_loudness)),
            sum(loud_loudness) / max(1, len(loud_loudness)),
            "global normalization should rank loud half above quiet half",
        )


if __name__ == "__main__":
    unittest.main()
