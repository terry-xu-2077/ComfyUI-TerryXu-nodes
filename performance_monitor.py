"""Read-only host metrics, sampled while a monitoring connection is open."""

import asyncio
import atexit
import csv
from collections import deque
from contextlib import suppress
import io
import json
import platform
import shutil
import subprocess
import sys
import threading
import time

import psutil
from aiohttp import web
from server import PromptServer

try:
    import pynvml as nvml
except ImportError:
    nvml = None

if sys.platform == "win32":
    import winreg


def cpu_name():
    if sys.platform == "win32":
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"HARDWARE\DESCRIPTION\System\CentralProcessor\0") as key:
                return winreg.QueryValueEx(key, "ProcessorNameString")[0].strip()
        except OSError:
            pass
    return platform.processor() or platform.machine()


def number(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def parse_smi(text):
    devices = []
    for row in csv.reader(io.StringIO(text), skipinitialspace=True):
        if len(row) != 6:
            continue
        index, name, usage, used, total, temperature = (v.strip() for v in row)
        devices.append({
            "index": index, "name": name, "usage": number(usage),
            "memory_used": number(used) * 1048576 if number(used) is not None else None,
            "memory_total": number(total) * 1048576 if number(total) is not None else None,
            "temperature": number(temperature),
        })
    return devices


class SystemSampler:
    def __init__(self):
        self.lock = threading.Lock()
        self.cached = None
        self.sampled_at = 0
        self.name = cpu_name()
        self.smi = shutil.which("nvidia-smi")
        self.handles = None
        self.nvml_attempted = False

    def gpu_stats(self):
        if nvml is not None and not self.nvml_attempted:
            self.nvml_attempted = True
            try:
                nvml.nvmlInit()
                atexit.register(nvml.nvmlShutdown)
                self.handles = [nvml.nvmlDeviceGetHandleByIndex(i) for i in range(nvml.nvmlDeviceGetCount())]
            except nvml.NVMLError:
                self.handles = None
        if self.handles is not None:
            devices = []
            for index, handle in enumerate(self.handles):
                def read(function, *args):
                    try:
                        return function(handle, *args)
                    except nvml.NVMLError:
                        return None

                name = read(nvml.nvmlDeviceGetName)
                if isinstance(name, bytes):
                    name = name.decode("utf-8", errors="replace")
                memory = read(nvml.nvmlDeviceGetMemoryInfo)
                utilization = read(nvml.nvmlDeviceGetUtilizationRates)
                devices.append({
                    "index": str(index), "name": name or f"GPU {index}",
                    "usage": utilization.gpu if utilization else None,
                    "memory_used": memory.used if memory else None,
                    "memory_total": memory.total if memory else None,
                    "temperature": read(nvml.nvmlDeviceGetTemperature, nvml.NVML_TEMPERATURE_GPU),
                })
            return devices
        if self.smi:
            try:
                result = subprocess.run([
                    self.smi, "--query-gpu=index,name,utilization.gpu,memory.used,memory.total,temperature.gpu",
                    "--format=csv,noheader,nounits",
                ], capture_output=True, text=True, encoding="utf-8", timeout=2,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0)
                if result.returncode == 0:
                    return parse_smi(result.stdout)
            except (OSError, subprocess.TimeoutExpired):
                pass
        return []

    def sample(self):
        with self.lock:
            if self.cached is not None and time.monotonic() - self.sampled_at < 1.5:
                return self.cached
            # A short blocking interval is measured in a worker, avoiding thread-local baselines.
            usage = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            self.cached = {
                "timestamp": time.time(),
                "cpu": {"name": self.name, "usage": usage, "threads": psutil.cpu_count()},
                "memory": {"used": memory.total - memory.available, "total": memory.total,
                           "usage": round((memory.total - memory.available) / memory.total * 100, 1)},
                "gpus": self.gpu_stats(),
            }
            self.sampled_at = time.monotonic()
            return self.cached


sampler = SystemSampler()


class MonitorStream:
    def __init__(self, sampler, interval=2):
        self.sampler = sampler
        self.interval = interval
        self.history = deque(maxlen=60)
        self.subscribers = set()
        self.task = None

    def subscribe(self):
        queue = asyncio.Queue(maxsize=1)
        self.subscribers.add(queue)
        if self.task is None:
            self.task = asyncio.create_task(self.run())
        return queue

    async def unsubscribe(self, queue):
        self.subscribers.discard(queue)
        if not self.subscribers and self.task is not None:
            task, self.task = self.task, None
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    async def run(self):
        while self.subscribers:
            try:
                sample = await asyncio.to_thread(self.sampler.sample)
                if not self.history or sample["timestamp"] > self.history[-1]["timestamp"]:
                    self.history.append(sample)
            except (OSError, psutil.Error):
                sample = None
            for queue in tuple(self.subscribers):
                if queue.full():
                    queue.get_nowait()
                queue.put_nowait(sample is not None)
            await asyncio.sleep(self.interval)

    def since(self, timestamp):
        return [sample for sample in self.history if sample["timestamp"] > timestamp]


monitor_stream = MonitorStream(sampler)


@PromptServer.instance.routes.get("/terryxu/performance")
async def performance_stats(request):
    return web.json_response(await asyncio.to_thread(sampler.sample), headers={"Cache-Control": "no-store"})


@PromptServer.instance.routes.get("/terryxu/performance/stream")
async def performance_stream(request):
    response = web.StreamResponse(headers={
        "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })
    await response.prepare(request)
    queue = monitor_stream.subscribe()
    timestamp = 0
    try:
        await response.write(b"retry: 2000\n\n")
        while request.transport is not None and not request.transport.is_closing():
            available = await queue.get()
            samples = monitor_stream.since(timestamp)
            packet = {"samples": samples} if available else {"error": "采集失败，正在重试"}
            data = json.dumps(packet, ensure_ascii=False, separators=(",", ":"))
            await response.write(("data:" + data + "\n\n").encode("utf-8"))
            if samples and available:
                timestamp = samples[-1]["timestamp"]
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        await monitor_stream.unsubscribe(queue)
    return response
