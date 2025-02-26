import comfy
from comfy import model_patcher
from nodes import MAX_RESOLUTION
from PIL import Image, ImageOps, ImageSequence
import numpy as np
import torch

class DataDisplayNode:
    """
    多功能数据展示节点，支持文本、图片、数值、模型路径的显示和暂存
    特性：
    1. 输入输出直通功能
    2. 断线数据保持功能
    3. 支持多种数据类型
    """
    
    def __init__(self):
        self.stored_data = None  # 数据存储变量
        self.last_type = None     # 记录最后接收的数据类型

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "optional": {
                "any": ("*",),  # 接受任意类型输入
            },
        }

    CATEGORY = "TerryXu"
    RETURN_TYPES = ("*",)
    RETURN_NAMES = ("any",)
    FUNCTION = "process_data"

    def process_data(self, input=None):
        # 数据更新逻辑
        if input is not None:
            self.stored_data = input
            self.last_type = type(input).__name__
        
        # 返回处理结果
        return (self.stored_data,)

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(s, input):
        return True