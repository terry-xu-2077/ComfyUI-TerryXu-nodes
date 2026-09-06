from __future__ import annotations

import os
import uuid
from pathlib import Path

import folder_paths
from comfy_api.latest import io, ui, Types


class VideoCompare(io.ComfyNode):
    """
    A/B synchronized video comparison preview.

    The node writes temporary MP4 previews through ComfyUI's native VideoInput.save_to()
    and exposes them to the frontend. It does not create permanent output files.
    """

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TerryXuVideoCompare",
            display_name="视频对比",
            category="TerryXu/Video",
            description=(
                "A/B 双路视频同步对比预览。拖动中间分割线观察画面差异；"
                "底部时间轴同步控制两路视频。"
            ),
            is_output_node=True,
            inputs=[
                io.Video.Input("a", display_name="A"),
                io.Video.Input("b", display_name="B"),
            ],
            outputs=[
                io.Video.Output("a", display_name="A"),
                io.Video.Output("b", display_name="B"),
            ],
        )

    @classmethod
    def execute(cls, a, b):
        temp_dir = Path(folder_paths.get_temp_directory())
        temp_dir.mkdir(parents=True, exist_ok=True)

        token = uuid.uuid4().hex
        filename_a = f"terry_compare_{token}_A.mp4"
        filename_b = f"terry_compare_{token}_B.mp4"

        path_a = temp_dir / filename_a
        path_b = temp_dir / filename_b

        # Use the same native save path as ComfyUI's current VideoInput implementation.
        # MP4/H.264-compatible browser preview is preferred; AUTO codec lets ComfyUI
        # remux/encode as efficiently as the input implementation permits.
        a.save_to(
            str(path_a),
            format=Types.VideoContainer("mp4"),
            codec=Types.VideoCodec("auto"),
        )
        b.save_to(
            str(path_b),
            format=Types.VideoContainer("mp4"),
            codec=Types.VideoCodec("auto"),
        )

        previews = [
            ui.SavedResult(filename_a, "", io.FolderType.temp),
            ui.SavedResult(filename_b, "", io.FolderType.temp),
        ]

        return io.NodeOutput(
            a,
            b,
            ui=ui.PreviewVideo(previews),
        )
