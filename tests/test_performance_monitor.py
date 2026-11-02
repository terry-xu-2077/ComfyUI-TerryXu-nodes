import importlib.util
import asyncio
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import patch


class Routes:
    def get(self, path):
        return lambda function: function


spec = importlib.util.spec_from_file_location("terry_performance", Path(__file__).parents[1] / "performance_monitor.py")
monitor = importlib.util.module_from_spec(spec)
with patch.dict(sys.modules, {"server": types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=Routes())))}):
    spec.loader.exec_module(monitor)


class PerformanceTests(unittest.TestCase):
    def test_gpu_stats_returns_empty_when_nvml_is_unavailable(self):
        sampler = monitor.SystemSampler()
        with patch.object(monitor, "nvml", None):
            self.assertEqual(sampler.gpu_stats(), [])

    def test_gpu_stats_reads_metrics_through_nvml(self):
        class FakeNvml:
            class NVMLError(Exception):
                pass

            NVML_TEMPERATURE_GPU = 0

            @staticmethod
            def nvmlInit():
                return None

            @staticmethod
            def nvmlShutdown():
                return None

            @staticmethod
            def nvmlDeviceGetCount():
                return 1

            @staticmethod
            def nvmlDeviceGetHandleByIndex(index):
                return index

            @staticmethod
            def nvmlDeviceGetName(handle):
                return b"Test GPU"

            @staticmethod
            def nvmlDeviceGetMemoryInfo(handle):
                return types.SimpleNamespace(used=1024, total=2048)

            @staticmethod
            def nvmlDeviceGetUtilizationRates(handle):
                return types.SimpleNamespace(gpu=75)

            @staticmethod
            def nvmlDeviceGetTemperature(handle, sensor):
                return 65

        sampler = monitor.SystemSampler()
        with patch.object(monitor, "nvml", FakeNvml), patch.object(monitor.atexit, "register"):
            devices = sampler.gpu_stats()
        self.assertEqual(devices, [{
            "index": "0", "name": "Test GPU", "usage": 75,
            "memory_used": 1024, "memory_total": 2048, "temperature": 65,
        }])

    def test_shared_cache_and_available_ram(self):
        sampler = monitor.SystemSampler()
        ram = types.SimpleNamespace(total=1000, available=600)
        with patch.object(monitor.psutil, "cpu_percent", return_value=24) as cpu, \
             patch.object(monitor.psutil, "virtual_memory", return_value=ram), \
             patch.object(sampler, "gpu_stats", return_value=[]):
            first = sampler.sample()
            second = sampler.sample()
        self.assertIs(first, second)
        self.assertEqual(cpu.call_count, 1)
        self.assertEqual(first["memory"]["used"], 400)
        self.assertEqual(first["memory"]["usage"], 40)
        self.assertEqual(first["gpus"], [])


class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_slow_or_background_viewers_do_not_stop_sampling(self):
        calls = []

        def sample():
            calls.append(len(calls) + 1)
            return {"timestamp": calls[-1], "cpu": {"usage": 20}}

        stream = monitor.MonitorStream(types.SimpleNamespace(sample=sample), interval=0.01)
        first = stream.subscribe()
        second = stream.subscribe()
        try:
            await asyncio.wait_for(first.get(), timeout=1)
            # Neither client reads its queue during this period.
            await asyncio.sleep(0.08)
            self.assertGreaterEqual(len(stream.history), 3)
            self.assertEqual(second.qsize(), 1)
            self.assertEqual(len(stream.since(0)), len(stream.history))
            await stream.unsubscribe(first)
            self.assertIsNotNone(stream.task)
        finally:
            await stream.unsubscribe(first)
            await stream.unsubscribe(second)
        self.assertIsNone(stream.task)
        count = len(calls)
        await asyncio.sleep(0.03)
        self.assertEqual(len(calls), count)


if __name__ == "__main__":
    unittest.main()
