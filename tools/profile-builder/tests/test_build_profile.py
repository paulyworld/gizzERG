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


if __name__ == "__main__":
    unittest.main()
