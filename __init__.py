from comfy_api.latest import ComfyExtension, io
from typing_extensions import override

from .nodes import (
    BooleanSwitch,
    BoolSwitch,
    H3PromptEditor,
    LineSwitch,
    RemoteControl,
)

# Only web/modules/index.js is auto-loaded by ComfyUI. The remaining frontend
# implementation files use .mjs and are imported explicitly by index.js so
# initialization order never depends on filenames such as zz/zzz.
WEB_DIRECTORY = "./web/modules"


class TerryXuExtension(ComfyExtension):
    """TerryXu custom nodes extension."""

    @override
    async def get_node_list(self) -> list[type[io.ComfyNode]]:
        return [
            H3PromptEditor,
            LineSwitch,
            BoolSwitch,
            BooleanSwitch,
            RemoteControl,
        ]


async def comfy_entrypoint() -> TerryXuExtension:
    return TerryXuExtension()


__all__ = ["comfy_entrypoint"]
