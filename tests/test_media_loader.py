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

    def test_missing_bus_item_returns_execution_blocker(self):
        from comfy_execution.graph_utils import ExecutionBlocker
        bus = media.MediaLoader.execute(json.dumps(self.groups)).result[0]
        value = media.MediaBusItem.execute(bus, "__terry_bus_empty_99_0").result[0]
        self.assertIsInstance(value, ExecutionBlocker)
        self.assertIsNone(value.message)

    def test_cache_fingerprint_tracks_order_and_file_changes(self):
        first = media.MediaLoader.fingerprint_inputs(json.dumps(self.groups))
        self.groups["image"].reverse()
        self.assertNotEqual(first, media.MediaLoader.fingerprint_inputs(json.dumps(self.groups)))
        with open(self.base / "a.png", "ab") as file:
            file.write(b"changed")
        self.groups["image"].reverse()
        self.assertNotEqual(first, media.MediaLoader.fingerprint_inputs(json.dumps(self.groups)))

    def test_bus_list_is_native_list_with_mixed_values_and_numeric_order(self):
        media.BusToList.VALIDATE_CLASS()
        self.assertEqual(list(media.BusToList.OUTPUT_IS_LIST), [True])
        image, audio, video = object(), {"waveform": object()}, object()
        values = media.BusToList.execute(items={"item_10": video, "item_2": audio, "item_0": image}).result[0]
        self.assertIs(values[0], image)
        self.assertIs(values[1], audio)
        self.assertIs(values[2], video)
        empty = media.BusToList.execute().result[0]
        self.assertIsInstance(empty, media.ExecutionBlocker)
        self.assertIsNone(empty.message)

    def test_media_bus_to_list_decodes_in_order_and_skips_empty_slots(self):
        self.groups["image"].reverse()
        self.groups["image"].append({"id": "empty", "empty": True})
        bus = media.MediaLoader.execute(json.dumps(self.groups)).result[0]
        values = media.BusToList.execute(bus=bus).result[0]
        self.assertEqual(len(values), 4)
        self.assertEqual(float(values[0][0, 0, 0, 2]), 1.0)
        self.assertEqual(float(values[1][0, 0, 0, 0]), 1.0)
        self.assertEqual(values[2]["sample_rate"], 16000)
        self.assertEqual(values[3].get_dimensions(), (16, 16))

    def test_rejects_cross_type_missing_files_and_traversal(self):
        for path in ("sound.wav", "missing.png", "../outside.png"):
            self.groups["image"][0]["path"] = path
            self.assertIsInstance(media.MediaLoader.validate_inputs(json.dumps(self.groups)), str)
        self.assertEqual(media.MediaLoader.execute('{"image":[],"audio":[],"video":[]}').result[0], [])

    def test_cleared_references_are_valid_and_silently_bypass_without_decoding(self):
        from comfy_execution.graph_utils import ExecutionBlocker
        original = media.MediaLoader.fingerprint_inputs(json.dumps(self.groups))
        for kind in ("image", "audio", "video"):
            self.groups[kind][0] = {"id": self.groups[kind][0]["id"], "kind": kind,
                                    "empty": True, "path": "", "name": "", "source": "input"}
        serialized = json.dumps(self.groups)
        self.assertTrue(media.MediaLoader.validate_inputs(serialized))
        self.assertNotEqual(media.MediaLoader.fingerprint_inputs(serialized), original)
        bus = media.MediaLoader.execute(serialized).result[0]
        with patch.object(media.LoadImage, "load_image", side_effect=AssertionError("empty asset was decoded")):
            for asset_id in ("a", "s", "v"):
                value = media.MediaBusItem.execute(bus, asset_id).result[0]
                self.assertIsInstance(value, ExecutionBlocker)
                self.assertIsNone(value.message)
        self.groups["image"][0] = {"id": "a", "path": "a.png"}
        bus = media.MediaLoader.execute(json.dumps(self.groups)).result[0]
        self.assertEqual(tuple(media.MediaBusItem.execute(bus, "a").result[0].shape), (1, 8, 16, 3))


if __name__ == "__main__":
    sys.argv = [sys.argv[0]]
    unittest.main()
