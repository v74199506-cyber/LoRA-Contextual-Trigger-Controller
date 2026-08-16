import hashlib
import json
import struct
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from lctc.metadata import MAX_HEADER_BYTES, LoraMetadataService, MetadataError, read_safetensors_metadata


class MetadataTests(unittest.TestCase):
    def test_reads_metadata_and_hashes_file(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "pose.safetensors"
            header = json.dumps({"__metadata__": {"ss_base_model_version": "sdxl_base_v1-0"}, "tensor": {"dtype": "F16", "shape": [1], "data_offsets": [0, 2]}}).encode()
            payload = struct.pack("<Q", len(header)) + header + b"\0\0"
            path.write_bytes(payload)
            self.assertEqual(read_safetensors_metadata(path)["ss_base_model_version"], "sdxl_base_v1-0")
            info = LoraMetadataService(lambda name: str(path)).inspect("pose.safetensors")
            self.assertEqual(info["fileHash"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(info["baseModel"], "SDXL")

    def test_rejects_oversized_or_truncated_header(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.safetensors"
            path.write_bytes(struct.pack("<Q", MAX_HEADER_BYTES + 1))
            with self.assertRaises(MetadataError): read_safetensors_metadata(path)
            path.write_bytes(struct.pack("<Q", 200) + b"{}")
            with self.assertRaises(MetadataError): read_safetensors_metadata(path)

    def test_rejects_non_safetensors(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model.ckpt"
            path.write_bytes(b"test")
            with self.assertRaises(MetadataError): LoraMetadataService(lambda name: str(path)).resolve("model.ckpt")


if __name__ == "__main__":
    unittest.main()
