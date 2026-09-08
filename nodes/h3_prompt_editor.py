from __future__ import annotations

import uuid
from pathlib import Path
from typing import Any

import torch
import folder_paths
from comfy_api.latest import io, Types


def _kind(value: Any) -> str:
    if isinstance(value, dict) and "waveform" in value:
        return "audio"
    if isinstance(value, torch.Tensor) and value.ndim == 4 and value.shape[-1] in (1, 3, 4):
        return "picture"
    if hasattr(value, "save_to") and hasattr(value, "get_dimensions"):
        return "video"
    return "other"


def _single_input(value: Any, default: Any = None) -> Any:
    """Unwrap a normal input after Schema(is_input_list=True)."""
    if isinstance(value, (list, tuple)):
        return value[0] if value else default
    return default if value is None else value


def _flatten_asset_values(value: Any):
    """Flatten ComfyUI execution lists while preserving source order."""
    if isinstance(value, (list, tuple)):
        for item in value:
            yield from _flatten_asset_values(item)
        return
    if value is not None:
        yield value


def _asset_items(assets: io.Autogrow.Type | None, asset_inputs: dict[str, Any]):
    """Accept grouped/flattened Autogrow inputs and expand ComfyUI Lists."""
    merged: dict[str, Any] = {}
    if isinstance(assets, dict):
        merged.update(assets)
    for name, value in asset_inputs.items():
        if name.startswith("asset") and name[5:].isdigit():
            merged[name] = value

    def order(item):
        name = item[0]
        suffix = name[5:] if name.startswith("asset") else ""
        return int(suffix) if suffix.isdigit() else 10**9

    expanded: list[tuple[str, Any]] = []
    for name, value in sorted(merged.items(), key=order):
        for item in _flatten_asset_values(value):
            expanded.append((name, item))
    return expanded


class H3PromptEditor(io.ComfyNode):
    """Visual MiniMax H3 prompt editor with external-text follow/edit modes."""

    @classmethod
    def define_schema(cls):
        asset_template = io.Autogrow.TemplatePrefix(
            input=io.AnyType.Input(
                "asset",
                display_name="参考",
                tooltip=(
                    "可连接单个 IMAGE / VIDEO / AUDIO，也可连接 ComfyUI List；"
                    "List 会按原顺序展开为多个参考素材。"
                ),
            ),
            prefix="asset",
            min=0,
        )

        text_input_type = io.MatchType.Template(
            "terry_h3_source_text",
            allowed_types=[io.String, io.Custom("TEXT")],
        )

        return io.Schema(
            node_id="TerryXuH3PromptEditor",
            display_name="📃 H3提示词编辑器",
            category="TerryXu/Text",
            is_input_list=True,
            search_aliases=["MiniMax H3", "H3 prompt", "H3 提示词", "reference prompt", "text preview"],
            description=(
                "可视化编写 MiniMax H3 提示词；支持动态数量图片、视频、音频参考及 ComfyUI List 资产输入；"
                "外部 STRING / TEXT 默认实时跟随，也可点击“编辑副本”转为本地修改；"
                "@ 插入媒体，/ 打开 H3 语法菜单；输出始终为标准 H3 原文 STRING。"
            ),
            is_output_node=True,
            has_intermediate_output=True,
            inputs=[
                io.String.Input("prompt", display_name="H3 原文", multiline=True, default=""),
                io.MatchType.Input(
                    "source_text",
                    template=text_input_type,
                    display_name="文本输入 · 跟随/编辑",
                    optional=True,
                    tooltip=(
                        "可连接 STRING 或 TEXT。默认跟随上游文本；点击编辑器内“编辑副本”后，"
                        "保留连线但使用本地编辑内容；“同步最新”可恢复到上游最近一次结果。"
                    ),
                ),
                io.Boolean.Input(
                    "edit_mode",
                    display_name="编辑副本",
                    default=False,
                    socketless=True,
                    tooltip="内部状态：关闭时跟随 source_text；开启时使用本地 prompt。",
                ),
                io.Boolean.Input(
                    "visual_preview",
                    display_name="可视化预览",
                    default=True,
                    tooltip="开启：标签可视化；关闭：显示纯文本 H3 原文。",
                ),
                io.Autogrow.Input("assets", template=asset_template),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            outputs=[io.String.Output("prompt", display_name="H3 Prompt")],
        )

    @classmethod
    def execute(
        cls,
        prompt: Any,
        source_text: Any | None = None,
        edit_mode: Any = False,
        visual_preview: Any = True,
        assets: io.Autogrow.Type | None = None,
        **asset_inputs,
    ) -> io.NodeOutput:
        prompt_value = _single_input(prompt, "")
        source_value = _single_input(source_text, None)
        edit_value = bool(_single_input(edit_mode, False))
        _single_input(visual_preview, True)

        source_string = str(source_value) if source_value is not None else None
        if edit_value or source_string is None:
            effective_prompt = str(prompt_value or "")
        else:
            effective_prompt = source_string

        counts = {"picture": 0, "video": 0, "audio": 0, "other": 0}
        result = []
        temp = Path(folder_paths.get_temp_directory())
        temp.mkdir(parents=True, exist_ok=True)

        for input_name, value in _asset_items(assets, asset_inputs):
            kind = _kind(value)
            counts[kind] += 1
            idx = counts[kind]
            label = {
                "picture": f"Picture {idx}",
                "video": f"Video {idx}",
                "audio": f"Audio {idx}",
            }.get(kind, f"Asset {idx}")
            item = {"input_name": input_name, "kind": kind, "index": idx, "label": label}

            try:
                if kind == "picture":
                    from comfy_api.latest import ui

                    saved = ui.ImageSaveHelper.save_images(
                        value[:1],
                        filename_prefix=f".terry_h3/{uuid.uuid4().hex}",
                        folder_type=io.FolderType.temp,
                        cls=cls,
                        compress_level=2,
                    )
                    if saved:
                        s = saved[0]
                        item.update(filename=s.filename, subfolder=s.subfolder, folder_type="temp")

                elif kind == "video":
                    filename = f"terry_h3_{uuid.uuid4().hex}.mp4"
                    value.save_to(
                        str(temp / filename),
                        format=Types.VideoContainer("mp4"),
                        codec=Types.VideoCodec("auto"),
                    )
                    item.update(filename=filename, subfolder="", folder_type="temp")

                elif kind == "audio":
                    sr = value.get("sample_rate", value.get("sampler_rate", 0))
                    waveform = value.get("waveform")
                    if sr:
                        item["sample_rate"] = int(sr)
                    if waveform is not None and sr:
                        try:
                            item["duration"] = float(waveform.shape[-1]) / float(sr)
                        except Exception:
                            pass
            except Exception as exc:
                item["preview_error"] = str(exc)

            result.append(item)

        return io.NodeOutput(
            effective_prompt,
            ui={
                "text": [effective_prompt],
                "terry_h3_source_text": [source_string],
            },
        )
