from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

from . import performance_monitor
from . import media_loader_routes

from .nodes import (
    BooleanSwitch,
    BoolSwitch,
    H3PromptEditor,
    LineSwitch,
    MemoryCleanup,
    MediaLoader,
    MediaBusItem,
    BusToList,
    RemoteControl,
)

WEB_DIRECTORY = "./web"


class TerryXuExtension(ComfyExtension):
    """TerryXu custom nodes extension."""

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            H3PromptEditor,
            LineSwitch,
            MemoryCleanup,
            MediaLoader,
            MediaBusItem,
            BusToList,
            BoolSwitch,
            BooleanSwitch,
            RemoteControl,
        ]


async def comfy_entrypoint() -> TerryXuExtension:
    return TerryXuExtension()


__all__ = ["comfy_entrypoint"]
