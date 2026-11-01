import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
import wave
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent.parent))
sys.argv = [sys.argv[0], "--cpu"]

import av
import numpy as np
from PIL import Image
import folder_paths

spec = importlib.util.spec_from_file_location("terry_media_loader", ROOT / "nodes/media_loader.py")
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class MediaLoaderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        Image.new("RGB", (16, 8), "red").save(self.base / "a.png")
        Image.new("RGB", (16, 8), "blue").save(self.base / "b.png")
        with wave.open(str(self.base / "sound.wav"), "wb") as file:
            file.setnchannels(1)
            file.setsampwidth(2)
            file.setframerate(16000)
            file.writeframes(b"\0\0" * 1600)
        with av.open(str(self.base / "clip.mp4"), "w") as file:
            stream = file.add_stream("mpeg4", rate=4)
            stream.width, stream.height, stream.pix_fmt = 16, 16, "yuv420p"
            for _ in range(2):
                frame = av.VideoFrame.from_ndarray(np.zeros((16, 16, 3), dtype=np.uint8), format="rgb24")
                for packet in stream.encode(frame):
                    file.mux(packet)
            for packet in stream.encode():
                file.mux(packet)
        self.input_patch = patch.object(folder_paths, "input_directory", str(self.base))
        self.input_patch.start()
        self.groups = {"image": [{"id": "a", "path": "a.png"}, {"id": "b", "path": "b.png"}],
                       "audio": [{"id": "s", "path": "sound.wav"}],
                       "video": [{"id": "v", "path": "clip.mp4"}]}

    def tearDown(self):
        self.input_patch.stop()
        self.temp.cleanup()

    def test_real_native_media_types_and_order(self):
        self.groups["image"].reverse()
        bus = media.MediaLoader.execute(json.dumps(self.groups)).result[0]
        self.assertEqual([a["id"] for a in bus], ["b", "a", "s", "v"])
        image = media.MediaBusItem.execute(bus, "b").result[0]
        self.assertEqual(tuple(image.shape), (1, 8, 16, 3))
        self.assertEqual(float(image[0, 0, 0, 2]), 1.0)
        audio = media.MediaBusItem.execute(bus, "s").result[0]
        self.assertEqual(audio["sample_rate"], 16000)
        self.assertEqual(tuple(audio["waveform"].shape), (1, 1, 1600))
        video = media.MediaBusItem.execute(bus, "v").result[0]
        self.assertEqual(video.get_dimensions(), (16, 16))

    def test_cache_fingerprint_tracks_order_and_file_changes(self):
        first = media.MediaLoader.fingerprint_inputs(json.dumps(self.groups))
        self.groups["image"].reverse()
        self.assertNotEqual(first, media.MediaLoader.fingerprint_inputs(json.dumps(self.groups)))
        with open(self.base / "a.png", "ab") as file:
            file.write(b"changed")
        self.groups["image"].reverse()
        self.assertNotEqual(first, media.MediaLoader.fingerprint_inputs(json.dumps(self.groups)))

    def test_rejects_cross_type_missing_files_and_traversal(self):
        for path in ("sound.wav", "missing.png", "../outside.png"):
            self.groups["image"][0]["path"] = path
            self.assertIsInstance(media.MediaLoader.validate_inputs(json.dumps(self.groups)), str)
        self.assertEqual(media.MediaLoader.execute('{"image":[],"audio":[],"video":[]}').result[0], [])


if __name__ == "__main__":
    sys.argv = [sys.argv[0]]
    unittest.main()
