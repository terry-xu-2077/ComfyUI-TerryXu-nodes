# 自动聚合所有节点模块
from .data_display import DataDisplayNode  # 当前节点
# from .new_node import NewNode       # 未来添加新节点时取消注释

# 统一注册节点
NODE_CLASS_MAPPINGS = {
    "DataDisplayNode": DataDisplayNode,
    # "NewNode": NewNode
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "DataDisplayNode": "✨Smart Data Display (TerryXu)",
    # "NewNode": "📌New Node (TerryXu)"
}