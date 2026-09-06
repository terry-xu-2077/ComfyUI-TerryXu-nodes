import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryXuVideoCompare";

function makeViewUrl(item) {
  if (!item?.filename) return "";
  const params = new URLSearchParams();
  params.set("filename", item.filename);
  params.set("type", item.type || "temp");
  params.set("subfolder", item.subfolder || "");
  return api.apiURL(`/view?${params.toString()}`);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const ms = Math.floor((seconds - whole) * 100);
  const min = Math.floor(whole / 60);
  const sec = whole % 60;
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

function createCompareUI(node) {
  const root = document.createElement("div");
  root.className = "terry-video-compare";
  root.style.cssText = `
    width:100%;
    box-sizing:border-box;
    padding:4px 4px 7px;
    user-select:none;
    color:var(--fg-color, #ddd);
    font-family:Arial, sans-serif;
  `;

  const stage = document.createElement("div");
  stage.style.cssText = `
    position:relative;
    width:100%;
    aspect-ratio:16/9;
    min-height:180px;
    overflow:hidden;
    border-radius:6px;
    background:#101010;
  `;

  const videoA = document.createElement("video");
  const videoB = document.createElement("video");
  for (const video of [videoA, videoB]) {
    video.preload = "auto";
    video.playsInline = true;
    video.muted = true;
    video.controls = false;
    video.style.cssText = `
      position:absolute;
      inset:0;
      width:100%;
      height:100%;
      object-fit:contain;
      background:#101010;
      pointer-events:none;
    `;
  }

  // A is the base layer; B occupies the right side.
  videoA.style.zIndex = "1";
  videoB.style.zIndex = "2";
  videoB.style.clipPath = "inset(0 0 0 50%)";

  const divider = document.createElement("div");
  divider.style.cssText = `
    position:absolute;
    z-index:5;
    top:0;
    bottom:0;
    left:50%;
    width:2px;
    transform:translateX(-1px);
    background:rgba(255,255,255,.95);
    box-shadow:0 0 0 1px rgba(0,0,0,.25);
    pointer-events:none;
  `;

  const handle = document.createElement("button");
  handle.type = "button";
  handle.title = "拖动 A/B 分割线";
  handle.setAttribute("aria-label", "拖动 A/B 分割线");
  handle.style.cssText = `
    position:absolute;
    z-index:6;
    left:50%;
    top:50%;
    width:32px;
    height:32px;
    transform:translate(-50%,-50%);
    border-radius:16px;
    border:1px solid rgba(255,255,255,.9);
    background:rgba(20,20,20,.75);
    color:white;
    font-size:14px;
    cursor:ew-resize;
    line-height:28px;
    padding:0;
  `;
  handle.textContent = "↔";

  const labelA = document.createElement("div");
  labelA.textContent = "A";
  labelA.style.cssText = `
    position:absolute;z-index:7;left:8px;top:7px;
    padding:2px 6px;border-radius:4px;
    background:rgba(0,0,0,.58);color:#fff;font-size:11px;pointer-events:none;
  `;
  const labelB = document.createElement("div");
  labelB.textContent = "B";
  labelB.style.cssText = `
    position:absolute;z-index:7;right:8px;top:7px;
    padding:2px 6px;border-radius:4px;
    background:rgba(0,0,0,.58);color:#fff;font-size:11px;pointer-events:none;
  `;

  stage.append(videoA, videoB, divider, handle, labelA, labelB);

  const controls = document.createElement("div");
  controls.style.cssText = `
    display:grid;
    grid-template-columns:34px minmax(0,1fr) auto;
    gap:7px;
    align-items:center;
    margin-top:7px;
  `;

  const playBtn = document.createElement("button");
  playBtn.type = "button";
  playBtn.textContent = "▶";
  playBtn.title = "播放 / 暂停";
  playBtn.style.cssText = `
    width:32px;height:28px;padding:0;border-radius:5px;
    border:1px solid rgba(255,255,255,.16);
    background:rgba(255,255,255,.08);
    color:inherit;cursor:pointer;
  `;

  const timeline = document.createElement("input");
  timeline.type = "range";
  timeline.min = "0";
  timeline.max = "1";
  timeline.step = "0.001";
  timeline.value = "0";
  timeline.setAttribute("aria-label", "视频同步进度");
  timeline.style.cssText = `
    width:100%;
    min-width:0;
    cursor:pointer;
    accent-color:var(--comfy-input-bg, #888);
  `;

  const timeText = document.createElement("div");
  timeText.textContent = "00:00.00 / 00:00.00";
  timeText.style.cssText = `
    font-size:10px;
    opacity:.78;
    white-space:nowrap;
    font-variant-numeric:tabular-nums;
  `;

  controls.append(playBtn, timeline, timeText);

  const status = document.createElement("div");
  status.textContent = "等待执行…";
  status.style.cssText = `
    margin-top:4px;
    font-size:10px;
    opacity:.58;
    text-align:center;
  `;

  root.append(stage, controls, status);

  let split = 0.5;
  let maxDuration = 0;
  let draggingSplit = false;
  let seeking = false;
  let raf = 0;
  let wasPlayingBeforeSeek = false;

  function setSplit(value) {
    split = Math.min(1, Math.max(0, value));
    const pct = split * 100;
    videoB.style.clipPath = `inset(0 0 0 ${pct}%)`;
    divider.style.left = `${pct}%`;
    handle.style.left = `${pct}%`;
  }

  function splitFromPointer(e) {
    const rect = stage.getBoundingClientRect();
    if (!rect.width) return;
    setSplit((e.clientX - rect.left) / rect.width);
  }

  handle.addEventListener("pointerdown", (e) => {
    draggingSplit = true;
    handle.setPointerCapture?.(e.pointerId);
    splitFromPointer(e);
    e.preventDefault();
  });
  handle.addEventListener("pointermove", (e) => {
    if (draggingSplit) splitFromPointer(e);
  });
  handle.addEventListener("pointerup", (e) => {
    draggingSplit = false;
    handle.releasePointerCapture?.(e.pointerId);
  });
  handle.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      setSplit(split + (e.key === "ArrowRight" ? 0.02 : -0.02));
      e.preventDefault();
    }
  });

  function computeDuration() {
    const da = Number.isFinite(videoA.duration) ? videoA.duration : 0;
    const db = Number.isFinite(videoB.duration) ? videoB.duration : 0;
    maxDuration = Math.max(da, db, 0);

    timeline.max = String(Math.max(maxDuration, 0.001));
    updateTimeUI();
  }

  function clampTime(t) {
    if (!Number.isFinite(t)) t = 0;
    return Math.max(0, Math.min(maxDuration || 0, t));
  }

  function setTrackTime(video, target) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 0 && target <= duration) {
      video.style.visibility = "visible";
      try { video.currentTime = target; } catch (_) {}
      return;
    }

    // Past the end of this track: hide it so the stage background becomes black.
    video.pause();
    video.style.visibility = "hidden";
  }

  function setBothTime(t) {
    const target = clampTime(t);
    setTrackTime(videoA, target);
    setTrackTime(videoB, target);
    timeline.value = String(target);
    updateTimeUI(target);
  }

  function updateTimeUI(forced) {
    const current = Number.isFinite(forced) ? forced : (videoA.currentTime || 0);
    if (!seeking) timeline.value = String(Math.min(current, maxDuration || current));
    timeText.textContent = `${formatTime(current)} / ${formatTime(maxDuration)}`;
  }

  function pauseBoth() {
    videoA.pause();
    videoB.pause();
    playBtn.textContent = "▶";
  }

  async function playBoth() {
    if (!maxDuration) return;

    const current = Math.max(
      videoA.style.visibility === "hidden" ? 0 : (videoA.currentTime || 0),
      videoB.style.visibility === "hidden" ? 0 : (videoB.currentTime || 0),
      Number(timeline.value) || 0
    );

    if (current >= maxDuration - 0.01) setBothTime(0);

    const target = Number(timeline.value) || 0;
    const tasks = [];

    for (const video of [videoA, videoB]) {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration > 0 && target < duration - 0.001) {
        video.style.visibility = "visible";
        if (Math.abs((video.currentTime || 0) - target) > 0.015) {
          try { video.currentTime = target; } catch (_) {}
        }
        tasks.push(video.play());
      } else {
        video.pause();
        video.style.visibility = "hidden";
      }
    }

    const results = await Promise.allSettled(tasks);
    if (tasks.length && results.every((r) => r.status === "rejected")) {
      status.textContent = "浏览器阻止了播放，请再次点击播放";
      return;
    }

    playBtn.textContent = "❚❚";
  }

  playBtn.addEventListener("click", () => {
    if (!videoA.paused || !videoB.paused) pauseBoth();
    else void playBoth();
  });

  timeline.addEventListener("pointerdown", () => {
    seeking = true;
    wasPlayingBeforeSeek = !videoA.paused || !videoB.paused;
    pauseBoth();
  });
  timeline.addEventListener("input", () => {
    setBothTime(Number(timeline.value));
  });
  timeline.addEventListener("change", () => {
    setBothTime(Number(timeline.value));
    seeking = false;
    if (wasPlayingBeforeSeek) void playBoth();
  });
  timeline.addEventListener("pointerup", () => {
    if (seeking) {
      setBothTime(Number(timeline.value));
      seeking = false;
      if (wasPlayingBeforeSeek) void playBoth();
    }
  });

  function syncLoop() {
    cancelAnimationFrame(raf);

    const tick = () => {
      if (!seeking) {
        const playing = [videoA, videoB].filter(
          (v) => !v.paused && v.style.visibility !== "hidden"
        );

        if (playing.length) {
          const t = Math.max(...playing.map((v) => v.currentTime || 0));

          for (const video of [videoA, videoB]) {
            const duration = Number.isFinite(video.duration) ? video.duration : 0;

            if (duration > 0 && t < duration - 0.001) {
              video.style.visibility = "visible";
              if (!video.paused && Math.abs((video.currentTime || 0) - t) > 0.045) {
                try { video.currentTime = t; } catch (_) {}
              }
            } else if (duration > 0 && t >= duration - 0.001) {
              video.pause();
              video.style.visibility = "hidden";
            }
          }

          if (maxDuration && t >= maxDuration - 0.01) {
            // Default behavior: loop the whole A/B comparison.
            pauseBoth();
            setBothTime(0);
            void playBoth();
          } else {
            timeline.value = String(t);
            updateTimeUI(t);
          }
        }
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
  }

  for (const v of [videoA, videoB]) {
    v.addEventListener("loadedmetadata", computeDuration);
    v.addEventListener("durationchange", computeDuration);
    v.addEventListener("error", () => {
      status.textContent = "视频预览加载失败";
    });
  }

  videoA.addEventListener("ended", () => {
    videoA.style.visibility = "hidden";
  });
  videoB.addEventListener("ended", () => {
    videoB.style.visibility = "hidden";
  });

  setSplit(0.5);
  syncLoop();

  return {
    root,
    setSources(urlA, urlB) {
      pauseBoth();
      maxDuration = 0;
      timeline.value = "0";
      timeText.textContent = "00:00.00 / 00:00.00";
      status.textContent = "正在加载 A / B…";

      videoA.style.visibility = "visible";
      videoB.style.visibility = "visible";
      videoA.src = urlA;
      videoB.src = urlB;
      videoA.load();
      videoB.load();

      let loaded = 0;
      const markLoaded = () => {
        loaded += 1;
        if (loaded >= 2) {
          computeDuration();
          setBothTime(0);
          status.textContent = "拖动中间分割线对比；底部时间轴同步预览";
        }
      };
      videoA.addEventListener("loadeddata", markLoaded, { once: true });
      videoB.addEventListener("loadeddata", markLoaded, { once: true });
    },
    destroy() {
      cancelAnimationFrame(raf);
      pauseBoth();
      videoA.removeAttribute("src");
      videoB.removeAttribute("src");
      videoA.load();
      videoB.load();
    },
  };
}

app.registerExtension({
  name: "TerryXu.VideoCompare",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = originalCreated?.apply(this, arguments);

      const ui = createCompareUI(this);
      this.__terryVideoCompare = ui;

      const widget = this.addDOMWidget(
        "terry_video_compare",
        "terry_video_compare",
        ui.root,
        {
          serialize: false,
          hideOnZoom: false,
          getMinHeight: () => 270,
          getMaxHeight: () => 900,
        }
      );
      widget.serialize = false;

      // Comfortable review size without making the node enormous.
      const width = Math.max(this.size?.[0] || 0, 440);
      this.setSize?.([width, Math.max(this.size?.[1] || 0, 360)]);

      const previousExecuted = this.onExecuted;
      this.onExecuted = function(output) {
        previousExecuted?.call(this, output);

        // PreviewVideo currently serializes its SavedResults under `images`.
        // For this node, the first two items are always A and B.
        const items = output?.images;
        if (!Array.isArray(items) || items.length < 2) return;

        const urlA = makeViewUrl(items[0]);
        const urlB = makeViewUrl(items[1]);
        if (urlA && urlB) {
          this.__terryVideoCompare?.setSources(urlA, urlB);
        }

        // Prevent ComfyUI's generic animated preview from competing with our
        // purpose-built A/B widget on this node.
        this.imgs = null;
      };

      const originalRemoved = this.onRemoved;
      this.onRemoved = function() {
        this.__terryVideoCompare?.destroy();
        originalRemoved?.apply(this, arguments);
      };

      return result;
    };
  },

  loadedGraphNode(node) {
    if (node?.comfyClass !== NODE_ID && node?.constructor?.type !== NODE_ID) return;

    // Restore the most recent execution preview when available.
    const output = app.nodeOutputs?.[node.id];
    const items = output?.images;
    if (Array.isArray(items) && items.length >= 2) {
      const urlA = makeViewUrl(items[0]);
      const urlB = makeViewUrl(items[1]);
      if (urlA && urlB) node.__terryVideoCompare?.setSources(urlA, urlB);
    }
  },
});
