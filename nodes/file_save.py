from __future__ import annotations

import os
import re
import uuid
from pathlib import Path
from typing import Any

import folder_paths
import torch
from comfy.cli_args import args
from comfy_api.latest import Types, io, ui


_INVALID_WIN_CHARS = re.compile(r'[<>:"|?*\x00-\x1F]')


def _detect_type(data: Any) -> str:
    if isinstance(data, str):
        return "text"
    if isinstance(data, dict) and "waveform" in data and (
        "sample_rate" in data or "sampler_rate" in data
    ):
        return "audio"
    if isinstance(data, torch.Tensor) and data.ndim == 4 and data.shape[-1] in (1, 3, 4):
        return "image"
    if hasattr(data, "save_to") and hasattr(data, "get_dimensions"):
        return "video"
    raise TypeError(
        "文件保存：当前仅支持 VIDEO / STRING / IMAGE / AUDIO。"
        f" 实际收到：{type(data).__module__}.{type(data).__name__}"
    )


def _sanitize_rel_path(value: str) -> str:
    value = (value or "").replace("\\", "/").strip().lstrip("/")
    clean_parts = []
    for raw in value.split("/"):
        raw = raw.strip()
        if not raw or raw in (".", ".."):
            continue
        raw = _INVALID_WIN_CHARS.sub("_", raw).rstrip(" .")
        if raw:
            clean_parts.append(raw)
    return "/".join(clean_parts) or "ComfyUI"


def _build_rel_stem(filename: str) -> str:
    value = _sanitize_rel_path(filename or "ComfyUI")
    path = Path(value)
    if path.suffix:
        value = str(path.with_suffix("")).replace("\\", "/")
    return value.rstrip("._- ") or "ComfyUI"


def _with_sequence(stem: str, append_sequence: bool, index: int, padding: int = 5) -> str:
    if not append_sequence:
        return stem
    return f"{stem}_{index:0{max(1, int(padding))}d}"


def _target_path(rel_stem: str, extension: str) -> tuple[str, str, str]:
    rel_stem = _sanitize_rel_path(rel_stem)
    rel = Path(rel_stem + "." + extension.lstrip("."))
    output_dir = Path(folder_paths.get_output_directory()).resolve()
    target = (output_dir / rel).resolve()
    if output_dir not in target.parents and target != output_dir:
        raise ValueError("文件保存：输出路径越界。")
    target.parent.mkdir(parents=True, exist_ok=True)
    subfolder = str(rel.parent).replace("\\", "/")
    if subfolder == ".":
        subfolder = ""
    return str(target), rel.name, subfolder


def _metadata_for_video(cls) -> dict | None:
    if args.disable_metadata:
        return None
    metadata = {}
    hidden = getattr(cls, "hidden", None)
    if hidden is not None:
        extra = getattr(hidden, "extra_pnginfo", None)
        prompt = getattr(hidden, "prompt", None)
        if extra:
            metadata.update(extra)
        if prompt:
            metadata["prompt"] = prompt
    return metadata or None


def _move_overwrite(src: str, dst: str):
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    os.replace(src, dst)


class FileSave(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TerryXuFileSave",
            display_name="文件保存",
            category="TerryXu/Save",
            description=(
                "按输入的精确文件名保存 VIDEO / STRING / IMAGE / AUDIO。"
                "可选择在文件名尾部添加序号；关闭时目标文件已存在则直接覆盖。"
                "文件名既可在节点内填写，也可由外部 STRING 输入覆盖。"
            ),
            is_output_node=True,
            inputs=[
                io.AnyType.Input(
                    "data",
                    display_name="内容",
                    tooltip="支持 VIDEO / STRING / IMAGE / AUDIO。",
                ),
                io.Int.Input(
                    "image_compress_level",
                    display_name="PNG 压缩等级",
                    default=4,
                    min=0,
                    max=9,
                    step=1,
                ),
                io.Combo.Input(
                    "audio_format",
                    display_name="音频格式",
                    options=["flac", "mp3", "opus"],
                    default="flac",
                ),
                io.Combo.Input(
                    "audio_quality",
                    display_name="音频质量",
                    options=["V0", "64k", "96k", "128k", "192k", "320k"],
                    default="128k",
                ),
                io.Combo.Input(
                    "video_format",
                    display_name="视频容器",
                    options=Types.VideoContainer.as_input(),
                    default="auto",
                ),
                io.Combo.Input(
                    "video_codec",
                    display_name="视频编码",
                    options=["auto", "h264"],
                    default="auto",
                ),
                io.Combo.Input(
                    "video_encoding",
                    display_name="H.264 编码模式",
                    options=["auto", "re-encode"],
                    default="auto",
                ),
                io.Float.Input(
                    "video_crf",
                    display_name="H.264 CRF",
                    default=23.0,
                    min=0.0,
                    max=51.0,
                    step=1.0,
                ),
                io.Combo.Input(
                    "text_extension",
                    display_name="文本后缀",
                    options=["txt", "md", "json", "csv", "log", "custom"],
                    default="txt",
                ),
                io.String.Input(
                    "text_custom_extension",
                    display_name="自定义文本后缀",
                    default="txt",
                ),
                io.String.Input(
                    "filename",
                    display_name="文件名",
                    default="ComfyUI",
                    tooltip=(
                        "支持子文件夹，例如 project/shot_01。无需填写扩展名；"
                        "若填写扩展名会自动移除，真实扩展名由内容格式决定。"
                    ),
                ),
                io.Boolean.Input(
                    "append_sequence",
                    display_name="尾部添加序号",
                    default=True,
                    tooltip="开启时在文件名尾部添加序号；关闭时同名文件直接覆盖。",
                ),
                io.String.Input(
                    "filename_input",
                    display_name="文件名",
                    optional=True,
                    force_input=True,
                    tooltip="可连接外部 STRING；连接后优先使用外部文件名。",
                ),
            ],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo],
            outputs=[],
        )

    @classmethod
    def execute(
        cls,
        data,
        image_compress_level,
        audio_format,
        audio_quality,
        video_format,
        video_codec,
        video_encoding,
        video_crf,
        text_extension,
        text_custom_extension,
        filename,
        append_sequence,
        filename_input=None,
    ) -> io.NodeOutput:
        kind = _detect_type(data)
        effective_filename = filename_input if filename_input is not None else filename
        stem = _build_rel_stem(effective_filename)

        if kind == "text":
            ext = (
                text_custom_extension.strip().lstrip(".")
                if text_extension == "custom"
                else text_extension
            )
            ext = re.sub(r"[^A-Za-z0-9_-]", "", ext) or "txt"
            rel_stem = _with_sequence(stem, append_sequence, 1)
            target, _, _ = _target_path(rel_stem, ext)
            with open(target, "w", encoding="utf-8", newline="") as file:
                file.write(data)
            return io.NodeOutput(ui=ui.PreviewText(data))

        if kind == "video":
            rel_stem = _with_sequence(stem, append_sequence, 1)
            fmt = Types.VideoContainer(video_format)
            ext = str(Types.VideoContainer.get_extension(video_format)).lstrip(".")
            target, filename_out, subfolder = _target_path(rel_stem, ext)
            crf = video_crf if (
                video_codec == "h264" and video_encoding == "re-encode"
            ) else None
            kwargs = {
                "format": fmt,
                "codec": video_codec,
                "metadata": _metadata_for_video(cls),
            }
            if crf is not None:
                try:
                    data.save_to(target, crf=crf, **kwargs)
                except TypeError:
                    data.save_to(target, **kwargs)
            else:
                data.save_to(target, **kwargs)
            return io.NodeOutput(
                ui=ui.PreviewVideo(
                    [ui.SavedResult(filename_out, subfolder, io.FolderType.output)]
                ),
            )

        if kind == "audio":
            audio = data
            if "sample_rate" not in audio and "sampler_rate" in audio:
                audio = dict(audio)
                audio["sample_rate"] = audio["sampler_rate"]
            temp_prefix = f".terry_file_save_tmp/{uuid.uuid4().hex}"
            quality = "128k" if audio_format == "flac" else audio_quality
            saved = ui.AudioSaveHelper.save_audio(
                audio,
                filename_prefix=temp_prefix,
                folder_type=io.FolderType.output,
                cls=cls,
                format=audio_format,
                quality=quality,
            )
            final_results = []
            for i, result in enumerate(saved):
                rel_stem = _with_sequence(stem, append_sequence, 1 + i)
                target, filename_out, subfolder = _target_path(rel_stem, audio_format)
                src = os.path.join(
                    folder_paths.get_output_directory(),
                    result.subfolder,
                    result.filename,
                )
                _move_overwrite(src, target)
                final_results.append(
                    ui.SavedResult(filename_out, subfolder, io.FolderType.output)
                )
            return io.NodeOutput(ui=ui.SavedAudios(final_results))

        if kind == "image":
            temp_prefix = f".terry_file_save_tmp/{uuid.uuid4().hex}"
            saved = ui.ImageSaveHelper.save_images(
                data,
                filename_prefix=temp_prefix,
                folder_type=io.FolderType.output,
                cls=cls,
                compress_level=int(image_compress_level),
            )
            final_results = []
            for i, result in enumerate(saved):
                rel_stem = _with_sequence(stem, append_sequence, 1 + i)
                target, filename_out, subfolder = _target_path(rel_stem, "png")
                src = os.path.join(
                    folder_paths.get_output_directory(),
                    result.subfolder,
                    result.filename,
                )
                _move_overwrite(src, target)
                final_results.append(
                    ui.SavedResult(filename_out, subfolder, io.FolderType.output)
                )
            return io.NodeOutput(ui=ui.SavedImages(final_results))

        raise RuntimeError("Unreachable")
