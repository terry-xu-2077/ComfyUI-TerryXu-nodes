from __future__ import annotations

from datetime import datetime

from comfy_api.latest import io


_TOKEN_MAP = (
    ("YYYY", "%Y"),
    ("YY", "%y"),
    ("MM", "%m"),
    ("DD", "%d"),
    ("HH", "%H"),
    ("mm", "%M"),
    ("ss", "%S"),
)


def _to_strftime(value: str) -> str:
    pattern = str(value or "YYYYMMDDHHmmss")
    for token, replacement in _TOKEN_MAP:
        pattern = pattern.replace(token, replacement)
    return pattern


class DateFormatter(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="TerryXuDateFormatter",
            display_name="TerryXu 日期格式化",
            category="TerryXu/Utils",
            description=(
                "将当前日期/时间按指定格式写入文本中的 %date%。"
                "格式示例：YYYYMMDDHHmmss、YYYY-MM-DD_HH-mm-ss。"
            ),
            inputs=[
                io.String.Input(
                    "template",
                    display_name="文本模板",
                    default="%date%",
                    tooltip="文本中的所有 %date% 都会被当前日期/时间替换。",
                ),
                io.String.Input(
                    "format",
                    display_name="格式",
                    default="YYYYMMDDHHmmss",
                    tooltip="YYYY=年，MM=月，DD=日，HH=时，mm=分，ss=秒。",
                ),
            ],
            outputs=[
                io.String.Output("text", display_name="格式化文本"),
            ],
        )

    @classmethod
    def execute(cls, template, format) -> io.NodeOutput:
        pattern = _to_strftime(format)
        date_text = datetime.now().strftime(pattern)
        text = str(template or "").replace("%date%", date_text)
        return io.NodeOutput(text)
