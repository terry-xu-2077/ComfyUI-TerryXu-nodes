from comfy_api.latest import io


class RemoteControl(io.ComfyNode):
    """Executable value source used by the frontend remote-control UI."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="TerryXuRemoteControl",
            display_name="🎛️ 远程控制器",
            category="TerryXu/线束整理",
            description="按频道联动切换节点，并输出当前控制值；多线切换输出 INT，布尔类开关输出 BOOLEAN。",
            inputs=[
                io.String.Input(
                    "remote_payload",
                    display_name="内部控制值",
                    default="i:1",
                ),
            ],
            outputs=[
                io.AnyType.Output(display_name="控制值"),
            ],
        )

    @staticmethod
    def _decode(payload):
        text = str(payload or "").strip()
        kind, sep, raw = text.partition(":")
        kind = kind.lower().strip()
        raw = raw.strip() if sep else text

        if kind in {"b", "bool", "boolean"}:
            return raw.lower() in {"1", "true", "yes", "on"}
        if kind in {"i", "int", "integer"}:
            try:
                return int(float(raw))
            except (TypeError, ValueError):
                return 1

        lowered = text.lower()
        if lowered in {"true", "false"}:
            return lowered == "true"
        try:
            return int(float(text))
        except (TypeError, ValueError):
            return 1

    @classmethod
    def execute(cls, remote_payload="i:1") -> io.NodeOutput:
        return io.NodeOutput(cls._decode(remote_payload))
