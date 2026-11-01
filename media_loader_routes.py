import asyncio
from pathlib import Path

from aiohttp import web
import folder_paths
from server import PromptServer

from .nodes.media_loader import MEDIA_EXTENSIONS


def input_files(kind):
    base = Path(folder_paths.get_input_directory())
    return sorted(p.relative_to(base).as_posix() for p in base.rglob("*")
                  if p.is_file() and p.suffix.lower() in MEDIA_EXTENSIONS[kind])


@PromptServer.instance.routes.get("/terryxu/media-loader/picker")
async def media_picker_info(request):
    # The 2.0 picker has no public open-dialog API. Resolve the installed native
    # component, rather than shipping a copy or pinning a hashed bundle filename.
    assets = Path(PromptServer.instance.web_root) / "assets"
    components = sorted(assets.glob("WidgetSelect-*.js"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not components:
        return web.json_response({"error": "当前 ComfyUI 前端未提供 2.0 资产选择组件，请更新前端。"}, status=409)
    kind = request.query.get("kind", "image")
    if kind not in MEDIA_EXTENSIONS:
        raise web.HTTPBadRequest(text="不支持的媒体类型")
    files = await asyncio.to_thread(input_files, kind)
    return web.json_response({"component": "/assets/" + components[0].name, "files": files})
