from __future__ import annotations

import ctypes
import gc
import logging
import sys
from typing import Any

from comfy_api.latest import io


logger = logging.getLogger(__name__)


def _enabled(value: Any) -> bool:
    # is_input_list=True wraps regular boolean widget inputs in lists.
    if isinstance(value, (list, tuple)):
        return bool(value[0]) if value else False
    return bool(value)


def _trim_current_process_ram() -> None:
    """Trim only ComfyUI's own resident working set, never other processes."""
    try:
        if sys.platform == "win32":
            kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
            current_process = kernel32.GetCurrentProcess
            current_process.argtypes = []
            current_process.restype = ctypes.c_void_p

            trim_working_set = kernel32.SetProcessWorkingSetSize
            trim_working_set.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_size_t]
            trim_working_set.restype = ctypes.c_int
            trim = ctypes.c_size_t(-1).value
            if not trim_working_set(current_process(), trim, trim):
                logger.warning("TerryXu 内存清理：当前进程工作集整理失败，错误码 %s", ctypes.get_last_error())

        elif sys.platform.startswith("linux"):
            libc = ctypes.CDLL(None)
            malloc_trim = getattr(libc, "malloc_trim", None)
            if malloc_trim is not None:
                malloc_trim.argtypes = [ctypes.c_size_t]
                malloc_trim.restype = ctypes.c_int
                malloc_trim(0)
    except Exception:
        logger.exception("TerryXu 内存清理：当前进程 RAM 整理失败")


class MemoryCleanup(io.ComfyNode):
    """Optional RAM/VRAM cleanup with an order-preserving ANY/List passthrough."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="TerryXuMemoryCleanup",
            display_name="🧹 内存清理",
            category="TerryXu/工具",
            description=(
                "任意类型 / ComfyUI List 原样透传。RAM 仅整理当前 ComfyUI 进程；"
                "VRAM 卸载模型并释放显存缓存。可能增加后续模型重载时间。"
            ),
            search_aliases=["RAM", "VRAM", "memory cleanup", "内存清理", "显存清理"],
            is_output_node=True,
            is_input_list=True,
            not_idempotent=True,
            inputs=[
                io.AnyType.Input(
                    "anything",
                    display_name="anything",
                    optional=True,
                    tooltip="支持图片、视频、音频、字符串及 ComfyUI List。",
                ),
                io.Boolean.Input(
                    "clean_ram",
                    display_name="清理 RAM",
                    default=True,
                    socketless=True,
                    tooltip="Python 垃圾回收及当前 ComfyUI 进程的内存工作集整理。",
                ),
                io.Boolean.Input(
                    "clean_vram",
                    display_name="清理 VRAM",
                    default=True,
                    socketless=True,
                    tooltip="卸载模型并释放显存缓存；后续使用时可能重新加载。",
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    "output",
                    display_name="output",
                    is_output_list=True,
                    tooltip="保留原始值及 ComfyUI List 的元素顺序。",
                )
            ],
        )

    @classmethod
    def fingerprint_inputs(cls, **kwargs) -> float:
        # A side-effect node must run again even when the input is unchanged.
        return float("nan")

    @classmethod
    def execute(
        cls,
        anything: Any = None,
        clean_ram: Any = True,
        clean_vram: Any = True,
    ) -> io.NodeOutput:
        do_ram = _enabled(clean_ram)
        do_vram = _enabled(clean_vram)

        model_management = None
        if do_vram:
            try:
                import comfy.model_management as model_management
                model_management.unload_all_models()
            except Exception:
                logger.exception("TerryXu 内存清理：卸载模型失败")

        if do_ram or do_vram:
            try:
                gc.collect()
            except Exception:
                logger.exception("TerryXu 内存清理：Python 垃圾回收失败")

        if do_vram and model_management is not None:
            try:
                model_management.soft_empty_cache()
            except Exception:
                logger.exception("TerryXu 内存清理：清理显存缓存失败")

        if do_ram:
            _trim_current_process_ram()

        # Both sides use ComfyUI List semantics so upstream list elements are
        # not accidentally wrapped into a single item after this node.
        values = anything if isinstance(anything, list) else [anything]
        return io.NodeOutput(values)
