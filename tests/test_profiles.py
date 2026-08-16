import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lctc.profiles import ProfileStore, ProfileValidationError, validate_profile


HASH = "a" * 64


def profile():
    return {
        "schemaVersion": 1,
        "fileHash": HASH,
        "displayName": "Pose Controller",
        "baseModel": "SDXL",
        "category": "Pose",
        "categoryConfirmed": True,
        "sources": ["user", "user"],
        "groups": [{
            "id": "position", "label": "Position", "exclusive": True, "required": False,
            "options": [
                {"label": "Standing", "text": "standing_trigger", "confidence": 1},
                {"label": "Sitting", "text": "sitting_trigger"},
            ],
        }],
    }


class ProfileTests(unittest.TestCase):
    def test_normalizes_and_deduplicates_sources(self):
        result = validate_profile(profile())
        self.assertEqual(result["sources"], ["user"])
        self.assertEqual(result["groups"][0]["options"][0]["confidence"], 1.0)

    def test_rejects_hash_mismatch_and_duplicate_ids(self):
        with self.assertRaises(ProfileValidationError):
            validate_profile(profile(), "b" * 64)
        invalid = profile()
        invalid["groups"].append(invalid["groups"][0].copy())
        with self.assertRaises(ProfileValidationError):
            validate_profile(invalid)

    def test_atomic_round_trip(self):
        with tempfile.TemporaryDirectory() as directory:
            store = ProfileStore(Path(directory))
            saved = store.save(profile(), HASH)
            self.assertEqual(store.load(HASH), saved)
            parsed = json.loads((Path(directory) / f"{HASH}.json").read_text(encoding="utf-8"))
            self.assertEqual(parsed["displayName"], "Pose Controller")

    def test_path_traversal_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ProfileValidationError):
                ProfileStore(Path(directory)).load("../profile")

    def test_rejects_unknown_category_value(self):
        invalid = profile()
        invalid["category"] = "Whatever"
        with self.assertRaises(ProfileValidationError):
            validate_profile(invalid)


if __name__ == "__main__":
    unittest.main()
