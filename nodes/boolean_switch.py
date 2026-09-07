from comfy_api.latest import io


class BooleanSwitch(io.ComfyNode):
    """A pure boolean source that can be named and controlled remotely."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="TerryXuBooleanSwitch",
            display_name="🔘 布尔开关",
            category="TerryXu/线束整理",
            description="纯布尔开关：本地切换 True / False，输出 BOOLEAN；可命名并通过远程控制器按名称控制。",
            search_aliases=["boolean switch", "bool", "toggle", "布尔", "开关"],
            inputs=[
                io.Boolean.Input(
                    "enabled",
                    display_name="开关",
                    default=False,
                    socketless=True,
                ),
            ],
            outputs=[
                io.Boolean.Output(display_name="布尔值"),
            ],
        )

    @classmethod
    def execute(cls, enabled: bool = False) -> io.NodeOutput:
        state = bool(enabled)
        return io.NodeOutput(
            state,
            ui={"terry_boolean_switch_state": [state]},
        )
