from comfy_api.latest import io


class LineSwitch(io.ComfyNode):
    """Select one route from a dynamically growing set of type-matched inputs."""

    MAX_ROUTES = 64

    @classmethod
    def define_schema(cls) -> io.Schema:
        route_type = io.MatchType.Template("terry_line_switch_route")
        routes = io.Autogrow.TemplatePrefix(
            input=io.MatchType.Input(
                "route",
                template=route_type,
                lazy=True,
                display_name="线路",
            ),
            prefix="route_",
            min=1,
            max=cls.MAX_ROUTES,
        )
        return io.Schema(
            node_id="TerryXuLineSwitch",
            display_name="TerryXu 线路切换器",
            category="TerryXu/线束整理",
            description="在任意数量的同类型线路之间切换；序号可手动选择，也可连接 INT 控制。",
            inputs=[
                io.Int.Input(
                    "index",
                    display_name="线路",
                    default=1,
                    min=1,
                    max=cls.MAX_ROUTES,
                    step=1,
                    socketless=False,
                ),
                io.Autogrow.Input("routes", template=routes),
            ],
            outputs=[
                io.MatchType.Output(
                    template=route_type,
                    display_name="输出",
                )
            ],
        )

    @staticmethod
    def _ordered_items(routes):
        if routes is None:
            return []
        try:
            items = list(routes.items())
        except AttributeError:
            return []

        def route_number(item):
            name = str(item[0])
            tail = name.rsplit("_", 1)[-1]
            try:
                return int(tail)
            except ValueError:
                return 10**9

        return sorted(items, key=route_number)

    @classmethod
    def _selected(cls, index, routes):
        items = cls._ordered_items(routes)
        if not items:
            return None, None, 1
        try:
            requested = int(index)
        except (TypeError, ValueError):
            requested = 1
        selected = max(1, min(requested, len(items)))
        key, value = items[selected - 1]
        return key, value, selected

    @classmethod
    def check_lazy_status(cls, index, routes):
        key, value, _ = cls._selected(index, routes)
        if key is None or value is not None:
            return []
        # V3 dynamic inputs use their dotted prompt key for lazy dependency requests.
        return [f"routes.{key}"]

    @classmethod
    def execute(cls, index, routes) -> io.NodeOutput:
        _, value, selected = cls._selected(index, routes)
        return io.NodeOutput(
            value,
            ui={"terry_line_switch_index": [selected]},
        )
