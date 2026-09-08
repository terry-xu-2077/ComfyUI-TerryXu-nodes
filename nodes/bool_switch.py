from comfy_api.latest import io


class BoolSwitch(io.ComfyNode):
    """Select between two arbitrary inputs with a boolean control."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="TerryXuBoolSwitch",
            display_name="🔀 二路切换器",
            category="TerryXu/线束整理",
            description=(
                "使用布尔值在两路任意输入之间切换，可通过远程控制器按名称控制。"
                "两路数据输入均允许留空；选中未连接的线路时输出 None。"
                "数据端使用真正的 AnyType，以保证节点放入 ComfyUI 子图后仍可正常切换。"
            ),
            has_intermediate_output=True,
            inputs=[
                io.Boolean.Input(
                    "enabled",
                    display_name="切换",
                    default=False,
                    socketless=False,
                ),
                io.AnyType.Input(
                    "input_false",
                    display_name="线路 1",
                    lazy=True,
                    optional=True,
                ),
                io.AnyType.Input(
                    "input_true",
                    display_name="线路 2",
                    lazy=True,
                    optional=True,
                ),
            ],
            outputs=[
                io.AnyType.Output(
                    display_name="输出",
                )
            ],
        )

    @classmethod
    def check_lazy_status(cls, enabled=False, **kwargs):
        selected_name = "input_true" if bool(enabled) else "input_false"
        # Optional inputs that are completely unwired are absent from kwargs.
        # A wired lazy input is present with value None until its upstream branch is evaluated.
        if selected_name in kwargs and kwargs[selected_name] is None:
            return [selected_name]
        return []

    @classmethod
    def execute(cls, enabled=False, input_false=None, input_true=None, **kwargs) -> io.NodeOutput:
        state = bool(enabled)
        value = input_true if state else input_false
        return io.NodeOutput(
            value,
            ui={"terry_bool_switch_state": [state]},
        )
