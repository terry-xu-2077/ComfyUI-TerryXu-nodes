from comfy_api.latest import io


class BoolSwitch(io.ComfyNode):
    """Select between two same-type arbitrary inputs with a boolean control."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        value_type = io.MatchType.Template("terry_bool_switch_value")
        return io.Schema(
            node_id="TerryXuBoolSwitch",
            display_name="🔀 二路切换器",
            category="TerryXu/线束整理",
            description="使用布尔值在两路任意同类型输入之间切换，可通过远程控制器按名称控制。",
            inputs=[
                io.Boolean.Input(
                    "enabled",
                    display_name="切换",
                    default=False,
                    socketless=False,
                ),
                io.MatchType.Input(
                    "input_false",
                    template=value_type,
                    display_name="线路 1",
                    lazy=True,
                ),
                io.MatchType.Input(
                    "input_true",
                    template=value_type,
                    display_name="线路 2",
                    lazy=True,
                ),
            ],
            outputs=[
                io.MatchType.Output(
                    template=value_type,
                    display_name="输出",
                )
            ],
        )

    @classmethod
    def check_lazy_status(cls, enabled, input_false, input_true):
        selected_name = "input_true" if bool(enabled) else "input_false"
        selected_value = input_true if bool(enabled) else input_false
        return [selected_name] if selected_value is None else []

    @classmethod
    def execute(cls, enabled, input_false, input_true) -> io.NodeOutput:
        state = bool(enabled)
        value = input_true if state else input_false
        return io.NodeOutput(
            value,
            ui={"terry_bool_switch_state": [state]},
        )
