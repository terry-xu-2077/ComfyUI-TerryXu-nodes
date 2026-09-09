from comfy_api.latest import io


class BooleanSwitch(io.ComfyNode):
    """A standalone linked Boolean source with frontend-managed shared channels."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="TerryXuLinkedBoolean",
            display_name="🔗 联动开关",
            category="TerryXu/线束整理",
            description=(
                "可创建或选取联动频道。相同频道中的联动开关共享同一个 BOOLEAN 状态，"
                "任意位置切换都会同步到该频道的其他节点；与远程控制器体系相互独立。"
            ),
            search_aliases=[
                "linked boolean",
                "linked switch",
                "shared boolean",
                "bool",
                "toggle",
                "联动",
                "布尔",
                "开关",
            ],
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
            ui={"terry_linked_boolean_state": [state]},
        )
