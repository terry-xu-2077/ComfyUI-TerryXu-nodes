from __future__ import annotations

import json
from pathlib import Path

import folder_paths
from comfy_api.latest import io, InputImpl
from comfy_extras.nodes_audio import LoadAudio
from nodes import LoadImage
from comfy_execution.graph_utils import ExecutionBlocker


MediaBus = io.Custom("TERRY_WIRE_BUS")
MEDIA_EXTENSIONS = {
    "image": {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff", ".avif"},
    "audio": {".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac", ".opus", ".aiff"},
    "video": {".mp4", ".mov", ".mkv", ".webm", ".avi", ".m4v"},
}


def parse_assets(assets_json):
    groups = json.loads(assets_json)
    if not isinstance(groups, dict):
        raise ValueError("媒体列表格式无效")
    items, ids = [], set()
    for kind in MEDIA_EXTENSIONS:
        group = groups.get(kind, [])
        if not isinstance(group, list):
            raise ValueError(f"{kind} 媒体列表格式无效")
        for asset in group:
            if not isinstance(asset, dict) or not isinstance(asset.get("id"), str) or not asset["id"]:
                raise ValueError("媒体资产缺少编号")
            if asset["id"] in ids:
                raise ValueError("媒体资产编号重复")
            ids.add(asset["id"])
            if asset.get("empty") is True:
                items.append({"id": asset["id"], "kind": kind, "empty": True})
                continue
            path = asset.get("path", "")
            if not isinstance(path, str) or Path(path).suffix.lower() not in MEDIA_EXTENSIONS[kind]:
                raise ValueError(f"媒体文件类型与 {kind} 区域不匹配：{path}")
            source = asset.get("source", "input")
            base = folder_paths.get_directory_by_type(source)
            if base is None or source not in ("input", "output", "temp"):
                raise ValueError("不支持的媒体来源")
            full_path = (Path(base) / path).resolve()
            if not full_path.is_relative_to(Path(base).resolve()):
                raise ValueError("媒体文件必须位于 ComfyUI 媒体目录内")
            if not full_path.is_file():
                raise ValueError(f"找不到媒体文件：{path}")
            items.append({"id": asset["id"], "kind": kind, "path": path,
                          "source": source, "full_path": str(full_path)})
    return items


class MediaLoader(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TerryXuMediaLoader", display_name="媒体加载器", category="TerryXu/媒体",
            description="分区添加图片、音频和视频，拖动卡片调整顺序；连接总线-出展开标准媒体出口。",
            search_aliases=["media loader", "加载媒体", "媒体加载器"],
            inputs=[io.String.Input("assets_json", default='{"image":[],"audio":[],"video":[]}',
                                    multiline=True, socketless=True, dynamic_prompts=False)],
            outputs=[MediaBus.Output(display_name="总线")],
        )

    @classmethod
    def execute(cls, assets_json):
        return io.NodeOutput(parse_assets(assets_json))

    @classmethod
    def validate_inputs(cls, assets_json):
        try:
            parse_assets(assets_json)
        except (ValueError, TypeError) as error:
            return str(error)
        return True

    @classmethod
    def fingerprint_inputs(cls, assets_json):
        return [(a["id"], a["kind"], "empty") if a.get("empty") else
                (a["id"], a["kind"], a["source"], a["path"], Path(a["full_path"]).stat().st_mtime_ns,
                 Path(a["full_path"]).stat().st_size) for a in parse_assets(assets_json)]


class MediaBusItem(io.ComfyNode):
    """Execution adapter inserted by Bus-Out; files are decoded only when used."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TerryXuMediaBusItem", display_name="媒体总线资产", category="TerryXu/媒体",
            is_deprecated=True,
            inputs=[MediaBus.Input("bus"), io.String.Input("asset_id")],
            outputs=[io.AnyType.Output()],
        )

    @classmethod
    def execute(cls, bus, asset_id):
        asset = next((item for item in bus if item["id"] == asset_id), None)
        if asset is None:
            raise ValueError("媒体已移除，请重新连接总线出口")
        if asset.get("empty"):
            return io.NodeOutput(ExecutionBlocker(None))
        annotated = f'{asset["path"]} [{asset["source"]}]'
        if asset["kind"] == "image":
            value = LoadImage().load_image(annotated)[0]
        elif asset["kind"] == "audio":
            value = LoadAudio.execute(annotated).result[0]
        else:
            value = InputImpl.VideoFromFile(asset["full_path"])
        return io.NodeOutput(value)
