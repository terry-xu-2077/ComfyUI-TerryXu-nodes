from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

from .nodes import (
    BoolSwitch,
    DateFormatter,
    FileSave,
    H3PromptEditor,
    H3ShotTimeline,
    LineSwitch,
    VideoCompare,
)

WEB_DIRECTORY = "./web"


class TerryXuExtension(ComfyExtension):
    """
    TerryXu root extension.

    Future custom nodes should be imported from ./nodes and appended to
    get_node_list(), so the whole toolset remains one installable package.
    """

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            FileSave,
            DateFormatter,
            VideoCompare,
            H3PromptEditor,
            H3ShotTimeline,
            LineSwitch,
            BoolSwitch,
        ]


async def comfy_entrypoint() -> TerryXuExtension:
    return TerryXuExtension()


__all__ = ["comfy_entrypoint"]
