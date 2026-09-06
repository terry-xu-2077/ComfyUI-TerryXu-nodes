import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { attachH3Menus } from "./h3_shared_menus.js";
import {
  bindH3TagInteractions,
  installH3RichTextStyles,
  renderH3RichText,
  serializeH3RichText,
} from "./h3_rich_text.js";

const NODE_ID = "TerryXuH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const MIN_SHOT = 0.5;
const MAX_DURATION = 30;
const MAX_MEDIA = 32;

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((v) => String(v || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) || null;
}

function hideWidget(w) {
  if (!w || w.__terryTimelineHidden) return;
  w.__terryTimelineHidden = true;
  w.hidden = true;
  w.type = "hidden";
  w.options ||= {};
  w.options.hidden = true;
  w.computeSize = () => [0, -4];
  if (w.element?.style) w.element.style.display = "none";
  if (w.inputEl?.style) w.inputEl.style.display = "none";
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}

function t(zh, en) { return localeIsZh() ? zh : en; }

function formatTime(seconds) {
  const value = Math.max(0, Number(seconds) || 0);
  const minutes = Math.floor(value / 60);
  const sec = value - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${sec.toFixed(3).padStart(6, "0")}`;
}

function parseTime(text) {
  const m = String(text || "").match(/^(\d{1,2}):(\d{2})\.(\d{3})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000 : null;
}

function clean(text) { return String(text || "").replace(/\r\n?/g, "\n").trim(); }

function normalizeDurations(shots, total) {
  total = Math.max(1, Math.min(MAX_DURATION, Number(total) || 15));
  if (!shots.length) shots.push({ text: "", duration: total });
  if (shots.length * MIN_SHOT > total) shots.splice(Math.max(1, Math.floor(total / MIN_SHOT)));
  for (const shot of shots) shot.duration = Math.max(MIN_SHOT, Number(shot.duration) || MIN_SHOT);
  let sum = shots.reduce((a, s) => a + s.duration, 0);
  if (!sum) return;
  let remaining = total;
  let flex = sum;
  for (const shot of shots) shot.duration = shot.duration / flex * remaining;
  for (let pass = 0; pass < 5; pass++) {
    const low = shots.filter((s) => s.duration < MIN_SHOT);
    if (!low.length) break;
    const fixed = low.length * MIN_SHOT;
    for (const s of low) s.duration = MIN_SHOT;
    const high = shots.filter((s) => s.duration > MIN_SHOT);
    const highSum = high.reduce((a, s) => a + s.duration, 0);
    const target = total - fixed - shots.filter((s) => s.duration === MIN_SHOT && !low.includes(s)).length * MIN_SHOT;
    if (highSum > 0 && target > 0) for (const s of high) s.duration = Math.max(MIN_SHOT, s.duration / highSum * target);
  }
  sum = shots.reduce((a, s) => a + s.duration, 0);
  shots[shots.length - 1].duration += total - sum;
}

function parsePrompt(raw, total) {
  const source = clean(raw);
  const soundMatch = source.match(/(?:^|\n)overall_soundscape:\s*\n?([\s\S]*?)(?=\nnon_diegetic_music:|$)/i);
  const musicMatch = source.match(/(?:^|\n)non_diegetic_music:\s*\n?([\s\S]*?)$/i);
  let detailed = source.replace(/(?:^|\n)overall_soundscape:[\s\S]*$/i, "").trim();
  detailed = detailed.replace(/^detailed_description:\s*/i, "");
  const re = /\[Shot\s+(\d+)\]/gi;
  const matches = [...detailed.matchAll(re)];
  if (!matches.length) {
    return {
      global: detailed,
      shots: [{ text: "", duration: total }],
      soundEnabled: Boolean(soundMatch), soundscape: clean(soundMatch?.[1] || ""),
      musicEnabled: Boolean(musicMatch), music: clean(musicMatch?.[1] || ""),
    };
  }
  const global = detailed.slice(0, matches[0].index).trim();
  const starts = [];
  const shots = [];
  matches.forEach((m, i) => {
    const begin = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : detailed.length;
    let body = detailed.slice(begin, end).trim();
    let start = i === 0 ? 0 : null;
    const tm = body.match(/^At\s+(\d{1,2}:\d{2}\.\d{3})\s*,\s*/i);
    if (tm) { start = parseTime(tm[1]); body = body.slice(tm[0].length).trim(); }
    starts.push(start); shots.push({ text: body, duration: 0 });
  });
  const valid = starts.slice(1).every((v, i) => v != null && v > (starts[i] ?? 0));
  if (valid) {
    for (let i = 0; i < shots.length; i++) {
      const a = starts[i] ?? 0;
      const b = i + 1 < shots.length ? starts[i + 1] : total;
      shots[i].duration = Math.max(MIN_SHOT, b - a);
    }
  } else {
    for (const shot of shots) shot.duration = total / shots.length;
  }
  normalizeDurations(shots, total);
  return {
    global, shots,
    soundEnabled: Boolean(soundMatch), soundscape: clean(soundMatch?.[1] || ""),
    musicEnabled: Boolean(musicMatch), music: clean(musicMatch?.[1] || ""),
  };
}

function compile(state) {
  const parts = ["detailed_description:"];
  if (clean(state.global)) parts.push(clean(state.global));
  let cursor = 0;
  state.shots.forEach((shot, index) => {
    const body = clean(shot.text);
    if (index === 0) parts.push(`[Shot 1]${body ? ` ${body}` : ""}`);
    else parts.push(`[Shot ${index + 1}] At ${formatTime(cursor)},${body ? ` ${body}` : ""}`);
    cursor += shot.duration;
  });
  if (state.soundEnabled) parts.push(`overall_soundscape:\n${clean(state.soundscape)}`);
  if (state.musicEnabled) parts.push(`non_diegetic_music:\n${clean(state.music)}`);
  return parts.join("\n\n");
}

function parseSavedState(raw, fallbackText, fallbackDuration) {
  const total = Math.max(1, Math.min(MAX_DURATION, Number(fallbackDuration) || 15));
  try {
    if (raw) {
      const data = JSON.parse(raw);
      if (data && Array.isArray(data.shots)) {
        const state = {
          total: Math.max(1, Math.min(MAX_DURATION, Number(data.total) || total)),
          global: String(data.global ?? data.intro ?? ""),
          shots: data.shots.map((s) => ({ text: String(s?.text || ""), duration: Number(s?.duration) || MIN_SHOT })),
          selected: Math.max(0, Number(data.selected) || 0),
          soundEnabled: Boolean(data.soundEnabled), soundscape: String(data.soundscape || ""),
          musicEnabled: Boolean(data.musicEnabled), music: String(data.music || ""),
        };
        normalizeDurations(state.shots, state.total);
        return state;
      }
    }
  } catch {}
  const parsed = parsePrompt(fallbackText, total);
  return { total, selected: 0, ...parsed };
}

function ensureLinks(node) {
  node.properties ||= {};
  if (!Array.isArray(node.properties[LINKS_PROP])) node.properties[LINKS_PROP] = [];
  return node.properties[LINKS_PROP];
}

function graphLink(graph, id) {
  if (id == null) return null;
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    if (typeof bag.get === "function") {
      const hit = bag.get(id) ?? bag.get(String(id));
      if (hit) return hit;
    }
    const hit = bag[id] ?? bag[String(id)];
    if (hit) return hit;
  }
  return null;
}

function sourceKind(node, slot = 0, fallback = "") {
  const raw = String(node?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  return "picture";
}

function normalizeLinks(node) {
  const graph = node?.graph || app.graph;
  const out = [];
  const seen = new Set();
  for (const link of ensureLinks(node)) {
    const id = Number(link?.source_id), slot = Number(link?.source_slot) || 0;
    const src = graph?.getNodeById?.(id);
    if (!Number.isFinite(id) || !src || id === Number(node.id)) continue;
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ source_id: id, source_slot: slot, source_type: String(src.outputs?.[slot]?.type || link.source_type || "*"), kind: sourceKind(src, slot, link.source_type) });
  }
  node.properties[LINKS_PROP] = out.slice(0, MAX_MEDIA);
  return node.properties[LINKS_PROP];
}

function addVirtualLink(node, src, slot = 0, type = "") {
  const links = normalizeLinks(node);
  if (!src || links.length >= MAX_MEDIA || links.some((x) => Number(x.source_id) === Number(src.id) && x.source_slot === slot)) return false;
  links.push({ source_id: Number(src.id), source_slot: slot, source_type: String(type || src.outputs?.[slot]?.type || "*"), kind: sourceKind(src, slot, type) });
  node.properties[LINKS_PROP] = links;
  node.__terryH3ShotTimeline?.refreshAssets?.();
  app.graph?.change?.();
  return true;
}

function getMediaInputIndex(node) { return node?.inputs?.findIndex((x) => String(x?.name || "") === "media") ?? -1; }

function ensureSingleMediaInput(node) {
  node.inputs ||= [];
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    const name = String(node.inputs[i]?.name || "");
    if (/^asset\d*$/i.test(name) || name === "assets") {
      try { if (node.inputs[i]?.link != null) node.disconnectInput?.(i); } catch {}
      if (typeof node.removeInput === "function") node.removeInput(i); else node.inputs.splice(i, 1);
    }
  }
  if (getMediaInputIndex(node) < 0) node.addInput?.("media", "*");
  const input = node.inputs[getMediaInputIndex(node)];
  if (input) {
    input.name = "media"; input.type = "*";
    input.label = t("参考 · 多路输入", "References · Multi-input");
    input.localized_name = input.label;
  }
}

function convertConnection(node, inputIndex, info = null) {
  if (!isTarget(node) || node.__terryClearingLink) return false;
  const input = node.inputs?.[inputIndex];
  if (String(input?.name || "") !== "media") return false;
  const graph = node.graph || app.graph;
  const native = graphLink(graph, input?.link) || info;
  if (!native) return false;
  const sourceId = native.origin_id ?? native.originId ?? native.from_id ?? native.fromId;
  const src = native.origin_node || native.originNode || graph?.getNodeById?.(Number(sourceId));
  if (!src) return false;
  const slot = Number(native.origin_slot ?? native.originSlot ?? native.from_slot ?? 0) || 0;
  const added = addVirtualLink(node, src, slot, native.type || src.outputs?.[slot]?.type || "*");
  node.__terryClearingLink = true;
  try { if (node.inputs?.[inputIndex]?.link != null) node.disconnectInput?.(inputIndex); } finally { node.__terryClearingLink = false; }
  return added;
}

function patchGraphToPrompt() {
  if (app.__terryH3TimelineGraphToPromptPatched || typeof app.graphToPrompt !== "function") return;
  app.__terryH3TimelineGraphToPromptPatched = true;
  const old = app.graphToPrompt;
  app.graphToPrompt = async function() {
    const data = await old.apply(this, arguments);
    const output = data?.output || {};
    for (const node of app.graph?._nodes || []) {
      if (!isTarget(node)) continue;
      node.__terryH3ShotTimeline?.save?.();
      const dst = output[String(node.id)];
      if (!dst) continue;
      dst.inputs ||= {};
      delete dst.inputs.media;
      for (const key of Object.keys(dst.inputs)) if (/^asset\d+$/i.test(key)) delete dst.inputs[key];
      normalizeLinks(node).forEach((link, i) => {
        if (output[String(link.source_id)]) dst.inputs[`asset${i + 1}`] = [String(link.source_id), Number(link.source_slot) || 0];
      });
    }
    return data;
  };
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || canvas.__terryH3TimelineLinksPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryH3TimelineLinksPatched = true;
  const old = canvas.drawConnections;
  canvas.drawConnections = function(ctx) {
    const r = old.apply(this, arguments);
    const graph = this.graph || app.graph;
    for (const target of graph?._nodes || []) {
      if (!isTarget(target)) continue;
      const idx = getMediaInputIndex(target);
      if (idx < 0) continue;
      const end = target.getInputPos?.(idx) || [target.pos[0], target.pos[1] + 40 + idx * 20];
      for (const link of normalizeLinks(target)) {
        const src = graph.getNodeById?.(Number(link.source_id));
        if (!src) continue;
        const start = src.getOutputPos?.(Number(link.source_slot) || 0) || [src.pos[0] + src.size[0], src.pos[1] + 40];
        ctx.save(); ctx.beginPath(); ctx.moveTo(start[0], start[1]);
        ctx.bezierCurveTo(start[0] + 80, start[1], end[0] - 80, end[1], end[0], end[1]);
        ctx.strokeStyle = globalThis.LGraphCanvas?.link_type_colors?.[link.source_type] || "#999";
        ctx.lineWidth = this.connections_width || 3; ctx.stroke(); ctx.restore();
      }
    }
    return r;
  };
}

function filenameFromSource(node, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename"] : ["audio", "file", "filename"];
  for (const w of node?.widgets || []) {
    const v = w?.value; const f = typeof v === "object" ? (v?.filename || v?.name) : v;
    if (!f || /^(data:|blob:|https?:)/i.test(String(f))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|mp4|webm|mov|mp3|wav|flac|ogg|m4a)$/i.test(String(f))) return String(f);
  }
  return "";
}

function previewFromSource(node, kind) {
  if (!node || kind === "audio") return "";
  const filename = filenameFromSource(node, kind);
  if (filename) {
    const w = (node.widgets || []).find((x) => {
      const v = x?.value; return String(typeof v === "object" ? (v?.filename || v?.name || "") : (v || "")) === filename;
    });
    const v = w?.value;
    const q = new URLSearchParams({ filename, type: typeof v === "object" ? String(v.type || "input") : "input" });
    if (typeof v === "object" && v.subfolder) q.set("subfolder", String(v.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  return (node.imgs || []).find((x) => x?.src)?.src || "";
}

function mediaOptions(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return normalizeLinks(node).map((link) => {
    const kind = link.kind || "picture"; counts[kind] += 1;
    const index = counts[kind]; const src = (node.graph || app.graph)?.getNodeById?.(Number(link.source_id));
    const label = kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`;
    return { kind, index, raw: `<${label}>`, label, source: filenameFromSource(src, kind).split(/[\\/]/).pop() || src?.title || label, preview: previewFromSource(src, kind) };
  });
}

function timelineRichOptions(node, onChange) {
  return {
    extraChipClass: "terry-tl-chip",
    resolveMedia(kind, index) {
      return mediaOptions(node).find((item) => item.kind === kind && item.index === Number(index)) || null;
    },
    onChange,
  };
}

function createRichEditor(node, value, placeholder, onChange) {
  const editor = document.createElement("div");
  editor.className = "terry-tl-rich";
  editor.contentEditable = "true";
  editor.dataset.placeholder = placeholder;
  let lastValue = String(value || "");
  const commit = () => { lastValue = serializeH3RichText(editor); onChange(lastValue); };
  const options = timelineRichOptions(node, commit);
  renderH3RichText(editor, lastValue, options);
  bindH3TagInteractions(editor, {
    node,
    getSourceText: () => serializeH3RichText(editor),
    onChange: commit,
  });
  editor.addEventListener("input", commit);
  editor.addEventListener("terrychange", commit);
  editor.addEventListener("keydown", (event) => { if (event.key === "Enter") event.stopPropagation(); });
  editor.addEventListener("blur", () => setTimeout(() => {
    const valueNow = serializeH3RichText(editor);
    renderH3RichText(editor, valueNow, timelineRichOptions(node, commit));
  }, 100));
  const menuController = attachH3Menus({ node, editor, mode: "timeline", onChange: commit });
  return {
    editor, menuController,
    setValue(next) {
      next = String(next || "");
      if (next === lastValue) return;
      lastValue = next;
      renderH3RichText(editor, next, timelineRichOptions(node, commit));
    },
    refreshAssets() {
      const current = serializeH3RichText(editor);
      renderH3RichText(editor, current, timelineRichOptions(node, commit));
    },
  };
}

function createEditor(node) {
  const textWidget = widget(node, "compiled_prompt");
  const durationWidget = widget(node, "duration");
  const stateWidget = widget(node, "timeline_state");
  hideWidget(textWidget); hideWidget(durationWidget); hideWidget(stateWidget);
  ensureSingleMediaInput(node);

  let state = parseSavedState(stateWidget?.value, textWidget?.value, durationWidget?.value);
  let dragBoundary = null, raf = 0, dragShot = null;
  const richEditors = new Set();

  const root = document.createElement("div"); root.className = "terry-h3-timeline-root";
  const header = document.createElement("div"); header.className = "terry-tl-header";
  const title = document.createElement("b"); title.textContent = t("H3 提示词编辑器（时间轴）", "H3 Prompt Editor (Timeline)");
  const durationLabel = document.createElement("span");
  const durationRange = document.createElement("input"); durationRange.type = "range"; durationRange.min = "1"; durationRange.max = String(MAX_DURATION); durationRange.step = "1";
  const durationNumber = document.createElement("input"); durationNumber.type = "number"; durationNumber.min = "1"; durationNumber.max = String(MAX_DURATION); durationNumber.step = "1";
  header.append(title, durationLabel, durationRange, durationNumber);

  const globalWrap = document.createElement("section"); globalWrap.className = "terry-tl-section";
  const globalLabel = document.createElement("label"); globalLabel.textContent = t("全局描述", "Global description");
  const globalRich = createRichEditor(node, state.global, t("描述整体风格、场景规则、摄影方式等；@ 插入参考标签", "Describe overall style, scene rules, camera language, etc.; @ inserts references"), (v) => { state.global = v; save(); });
  richEditors.add(globalRich); globalWrap.append(globalLabel, globalRich.editor);

  const laneHead = document.createElement("div"); laneHead.className = "terry-tl-lane-head";
  const laneTitle = document.createElement("span"); laneTitle.textContent = t("镜头时间轴", "Shot timeline");
  const addBtn = document.createElement("button"); addBtn.type = "button"; addBtn.textContent = t("+ 镜头", "+ Shot"); laneHead.append(laneTitle, addBtn);
  const lane = document.createElement("div"); lane.className = "terry-tl-lane";
  const cards = document.createElement("div"); cards.className = "terry-tl-cards";

  const audio = document.createElement("section"); audio.className = "terry-tl-audio";
  const soundToggle = optionToggle(t("整体声音环境", "overall_soundscape"), state.soundEnabled, (checked) => { state.soundEnabled = checked; renderAudio(); save(); });
  const musicToggle = optionToggle(t("非剧情内音乐", "non_diegetic_music"), state.musicEnabled, (checked) => { state.musicEnabled = checked; renderAudio(); save(); });
  const soundBox = document.createElement("textarea"); soundBox.rows = 2; soundBox.placeholder = t("环境声、动作声、呼吸等", "Ambience, action sounds, breathing, etc."); soundBox.value = state.soundscape;
  const musicBox = document.createElement("textarea"); musicBox.rows = 2; musicBox.placeholder = t("非剧情内音乐；无则可写 N/A", "Non-diegetic music; use N/A for none"); musicBox.value = state.music;
  soundBox.addEventListener("input", () => { state.soundscape = soundBox.value; save(); }); musicBox.addEventListener("input", () => { state.music = musicBox.value; save(); });
  audio.append(soundToggle.wrap, soundBox, musicToggle.wrap, musicBox);

  const footer = document.createElement("div"); footer.className = "terry-tl-footer";
  const help = document.createElement("span"); help.textContent = t("拖接缝调时长 · 拖镜头块排序", "Drag seams for duration · drag shot blocks to reorder");
  const status = document.createElement("span"); footer.append(help, status);
  root.append(header, globalWrap, laneHead, lane, cards, audio, footer);

  function optionToggle(label, checked, onchange) {
    const wrap = document.createElement("label"); wrap.className = "terry-tl-option";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked;
    const text = document.createElement("span"); text.textContent = label; wrap.append(input, text); input.addEventListener("change", () => onchange(input.checked));
    return { wrap, input };
  }

  function renderAudio() {
    soundToggle.input.checked = state.soundEnabled; musicToggle.input.checked = state.musicEnabled;
    soundBox.style.display = state.soundEnabled ? "block" : "none"; musicBox.style.display = state.musicEnabled ? "block" : "none";
  }

  function save() {
    state.total = Math.max(1, Math.min(MAX_DURATION, Number(state.total) || 15));
    const compiled = compile(state);
    if (textWidget) { textWidget.value = compiled; textWidget.callback?.(compiled); }
    if (durationWidget) { durationWidget.value = Math.round(state.total); durationWidget.callback?.(durationWidget.value); }
    if (stateWidget) {
      const packed = JSON.stringify(state); stateWidget.value = packed; stateWidget.callback?.(packed);
    }
    status.textContent = `${state.shots.length} ${t("镜头", "shots")} · ${state.total.toFixed(1)}s`;
    node.setDirtyCanvas?.(true, true);
  }

  function setTotal(next) {
    next = Math.max(1, Math.min(MAX_DURATION, Number(next) || 15));
    if (state.shots.length * MIN_SHOT > next) next = state.shots.length * MIN_SHOT;
    const scale = next / state.total;
    for (const shot of state.shots) shot.duration *= scale;
    state.total = next; normalizeDurations(state.shots, next); render(); save();
  }
  durationRange.addEventListener("input", () => setTotal(durationRange.value)); durationNumber.addEventListener("change", () => setTotal(durationNumber.value));

  addBtn.addEventListener("click", () => {
    const index = Math.max(0, Math.min(state.shots.length - 1, state.selected || 0));
    const base = state.shots[index]; if (!base || base.duration < MIN_SHOT * 2) return;
    const half = base.duration / 2; base.duration = half; state.shots.splice(index + 1, 0, { text: "", duration: half }); state.selected = index + 1; render(); save();
  });

  function deleteShot(index) {
    if (state.shots.length <= 1) return;
    const removed = state.shots[index];
    if (index > 0) state.shots[index - 1].duration += removed.duration; else state.shots[1].duration += removed.duration;
    state.shots.splice(index, 1); state.selected = Math.max(0, Math.min(state.shots.length - 1, index - 1)); render(); save();
  }

  function reorderShot(from, to) {
    if (from === to || from == null || to == null) return;
    const [shot] = state.shots.splice(from, 1); state.shots.splice(to, 0, shot); state.selected = to; render(); save();
  }

  function renderLane() {
    lane.replaceChildren();
    let cursor = 0;
    state.shots.forEach((shot, index) => {
      const block = document.createElement("button"); block.type = "button"; block.className = `terry-tl-shot${index === state.selected ? " is-selected" : ""}`;
      block.style.flexBasis = `${shot.duration / state.total * 100}%`; block.draggable = true;
      const grip = document.createElement("span"); grip.className = "terry-tl-grip"; grip.textContent = "⋮⋮";
      const label = document.createElement("b"); label.textContent = `Shot ${index + 1}`;
      const dur = document.createElement("small"); dur.textContent = `${shot.duration.toFixed(1)}s`; block.append(grip, label, dur);
      block.addEventListener("click", () => { state.selected = index; renderLane(); renderCards(); save(); });
      block.addEventListener("dragstart", (e) => { dragShot = index; e.dataTransfer.effectAllowed = "move"; block.classList.add("is-dragging"); });
      block.addEventListener("dragend", () => { dragShot = null; block.classList.remove("is-dragging"); });
      block.addEventListener("dragover", (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; block.classList.add("is-drop"); });
      block.addEventListener("dragleave", () => block.classList.remove("is-drop"));
      block.addEventListener("drop", (e) => { e.preventDefault(); block.classList.remove("is-drop"); reorderShot(dragShot, index); });
      lane.append(block);
      cursor += shot.duration;
      if (index < state.shots.length - 1) {
        const handle = document.createElement("div"); handle.className = "terry-tl-seam"; handle.style.left = `calc(${cursor / state.total * 100}% - 6px)`;
        handle.addEventListener("pointerdown", (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          dragBoundary = { index, pointerId: ev.pointerId, startX: ev.clientX, left: state.shots[index].duration, right: state.shots[index + 1].duration, handle, leftBlock: block, rightBlock: lane.children[lane.children.length - 1] };
          handle.setPointerCapture?.(ev.pointerId); handle.classList.add("is-active");
        });
        handle.addEventListener("pointermove", (ev) => {
          if (!dragBoundary || dragBoundary.index !== index) return;
          dragBoundary.clientX = ev.clientX;
          if (raf) return;
          raf = requestAnimationFrame(() => {
            raf = 0;
            if (!dragBoundary) return;
            const rect = lane.getBoundingClientRect(); if (!rect.width) return;
            const pair = dragBoundary.left + dragBoundary.right;
            const delta = (dragBoundary.clientX - dragBoundary.startX) / rect.width * state.total;
            let left = Math.round((dragBoundary.left + delta) * 10) / 10;
            left = Math.max(MIN_SHOT, Math.min(pair - MIN_SHOT, left));
            state.shots[index].duration = left; state.shots[index + 1].duration = pair - left;
            const blocks = [...lane.querySelectorAll(".terry-tl-shot")];
            blocks[index].style.flexBasis = `${left / state.total * 100}%`; blocks[index + 1].style.flexBasis = `${(pair - left) / state.total * 100}%`;
            blocks[index].querySelector("small").textContent = `${left.toFixed(1)}s`; blocks[index + 1].querySelector("small").textContent = `${(pair - left).toFixed(1)}s`;
            const before = state.shots.slice(0, index + 1).reduce((a, s) => a + s.duration, 0); handle.style.left = `calc(${before / state.total * 100}% - 6px)`;
          });
        });
        const finish = () => {
          if (!dragBoundary || dragBoundary.index !== index) return;
          if (raf) { cancelAnimationFrame(raf); raf = 0; }
          handle.classList.remove("is-active"); dragBoundary = null; renderLane(); renderCards(); save();
        };
        handle.addEventListener("pointerup", finish); handle.addEventListener("pointercancel", finish); lane.append(handle);
      }
    });
  }

  function renderCards() {
    cards.replaceChildren(); richEditors.clear(); richEditors.add(globalRich);
    let cursor = 0;
    state.shots.forEach((shot, index) => {
      const row = document.createElement("div"); row.className = `terry-tl-card${index === state.selected ? " is-selected" : ""}`;
      const meta = document.createElement("button"); meta.type = "button"; meta.className = "terry-tl-meta";
      meta.innerHTML = `<b>Shot ${index + 1}</b><small>${formatTime(cursor)}<br>${shot.duration.toFixed(1)}s</small>`;
      meta.addEventListener("click", () => { state.selected = index; renderLane(); renderCards(); save(); });
      const rich = createRichEditor(node, shot.text, t("输入镜头描述；@ 插入参考标签", "Write shot description; @ inserts references"), (v) => { shot.text = v; save(); });
      richEditors.add(rich); rich.editor.addEventListener("focus", () => { state.selected = index; renderLane(); });
      const del = document.createElement("button"); del.type = "button"; del.className = "terry-tl-delete"; del.textContent = "×"; del.disabled = state.shots.length <= 1; del.title = t("删除镜头", "Delete shot"); del.addEventListener("click", () => deleteShot(index));
      row.append(meta, rich.editor, del); cards.append(row); cursor += shot.duration;
    });
  }

  function render() {
    durationRange.value = String(Math.round(state.total)); durationNumber.value = String(Math.round(state.total));
    durationLabel.textContent = `${t("总时长", "Total")} ${state.total.toFixed(0)}s / ${MAX_DURATION}s`;
    globalRich.setValue(state.global); soundBox.value = state.soundscape; musicBox.value = state.music; renderLane(); renderCards(); renderAudio(); save();
  }

  render();
  return {
    root, save,
    refresh() { state = parseSavedState(stateWidget?.value, textWidget?.value, durationWidget?.value); render(); },
    refreshAssets() { for (const rich of richEditors) rich.refreshAssets?.(); },
  };
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-style-v2")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-style-v2";
  style.textContent = `
.terry-h3-timeline-root{width:100%;box-sizing:border-box;padding:7px;font-family:Inter,system-ui,sans-serif;color:var(--input-text,#ddd)}
.terry-tl-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}.terry-tl-header>b{font-size:12px;flex:1}.terry-tl-header>span{font-size:10px;opacity:.65;white-space:nowrap}.terry-tl-header input[type=range]{width:110px}.terry-tl-header input[type=number]{width:48px;height:24px;box-sizing:border-box;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(0,0,0,.18);color:inherit;text-align:center;font-size:11px}
.terry-tl-section>label,.terry-tl-lane-head{font-size:10px;opacity:.65}.terry-tl-section>label{display:block;margin:0 0 4px}.terry-tl-section{margin-bottom:9px}
.terry-tl-rich{min-height:54px;width:100%;box-sizing:border-box;padding:7px 8px;border:1px solid rgba(255,255,255,.11);border-radius:6px;background:rgba(0,0,0,.16);color:inherit;font:10.5px/1.55 ui-monospace,Consolas,monospace;outline:none;white-space:pre-wrap;overflow-wrap:anywhere}.terry-tl-rich:empty:before{content:attr(data-placeholder);opacity:.4;pointer-events:none}
.terry-tl-chip{display:inline-flex;align-items:center;gap:4px;margin:1px 2px;padding:1px 5px;border-radius:4px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);font-size:10px;white-space:nowrap;vertical-align:middle}.terry-tl-chip img{width:24px;height:24px;object-fit:cover;border-radius:3px}.terry-tl-chip.is-subject{background:rgba(170,170,170,.10);font-weight:700;color:#aaa}.terry-tl-chip.is-picture{background:rgba(100,160,255,.13)}.terry-tl-chip.is-video{background:rgba(190,120,255,.13)}.terry-tl-chip.is-audio{background:rgba(255,165,90,.13)}.terry-tl-chip.is-dialogue{background:rgba(0,226,187,.12);color:rgba(190,255,244,.98)}.terry-tl-dialogue-lang{opacity:.65;font-size:9px}.terry-tl-dialogue-text{outline:none;min-width:30px}
.terry-tl-lane-head{display:flex;align-items:center;justify-content:space-between;margin:2px 0 4px}.terry-tl-lane-head button{height:25px;padding:0 9px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;font-size:10px}
.terry-tl-lane{position:relative;display:flex;width:100%;height:60px;overflow:hidden;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(0,0,0,.20);user-select:none;touch-action:none}.terry-tl-shot{position:relative;flex:0 0 auto;min-width:0;border:0;border-right:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.055);color:inherit;cursor:grab;overflow:hidden}.terry-tl-shot.is-selected{background:rgba(255,255,255,.14)}.terry-tl-shot.is-dragging{opacity:.35}.terry-tl-shot.is-drop{box-shadow:inset 3px 0 0 rgba(255,255,255,.75)}.terry-tl-shot b,.terry-tl-shot small{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.terry-tl-shot b{font-size:10px}.terry-tl-shot small{margin-top:3px;font-size:9px;opacity:.6}.terry-tl-grip{position:absolute;left:5px;top:5px;font-size:10px;opacity:.35}.terry-tl-seam{position:absolute;z-index:8;top:0;width:12px;height:100%;cursor:ew-resize}.terry-tl-seam:after{content:"";position:absolute;left:5px;top:8px;bottom:8px;width:2px;border-radius:2px;background:rgba(255,255,255,.65);box-shadow:0 0 0 1px rgba(0,0,0,.25)}.terry-tl-seam.is-active:after{width:3px;left:4px;background:#fff}
.terry-tl-cards{display:flex;flex-direction:column;gap:6px;margin-top:8px}.terry-tl-card{display:grid;grid-template-columns:76px minmax(0,1fr) 28px;gap:6px;align-items:start;padding:6px;border:1px solid rgba(255,255,255,.09);border-radius:6px;background:rgba(0,0,0,.10)}.terry-tl-card.is-selected{border-color:rgba(255,255,255,.20);background:rgba(255,255,255,.045)}.terry-tl-card .terry-tl-rich{min-height:64px}.terry-tl-meta{border:0;background:transparent;color:inherit;text-align:left;cursor:pointer;padding:2px}.terry-tl-meta b,.terry-tl-meta small{display:block}.terry-tl-meta b{font-size:10px}.terry-tl-meta small{margin-top:3px;font-size:9px;line-height:1.35;opacity:.56}.terry-tl-delete{width:26px;height:26px;border:1px solid rgba(255,255,255,.10);border-radius:5px;background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font-size:15px;opacity:.7}
.terry-tl-audio{display:grid;grid-template-columns:1fr;gap:5px;margin-top:9px;padding-top:8px;border-top:1px solid rgba(255,255,255,.08)}.terry-tl-option{display:flex;align-items:center;gap:6px;font-size:10px;opacity:.75;cursor:pointer}.terry-tl-audio textarea{width:100%;resize:vertical;box-sizing:border-box;padding:6px 7px;border:1px solid rgba(255,255,255,.09);border-radius:5px;background:rgba(0,0,0,.15);color:inherit;font:10.5px/1.45 ui-monospace,Consolas,monospace;outline:none}
.terry-tl-footer{display:flex;justify-content:space-between;margin-top:6px;font-size:9px;opacity:.48}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3ShotTimeline",
  setup() { installStyle(); patchGraphToPrompt(); patchCanvas(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3TimelineInstalled) return;
    nodeType.prototype.__terryH3TimelineInstalled = true;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments); ensureSingleMediaInput(this);
      const editor = createEditor(this); this.__terryH3ShotTimeline = editor;
      const dom = this.addDOMWidget("terry_h3_shot_timeline", "terry_h3_shot_timeline", editor.root, { serialize: false, hideOnZoom: false, getMinHeight: () => 500, getMaxHeight: () => 1200 }); dom.serialize = false;
      this.setSize?.([Math.max(650, this.size?.[0] || 0), Math.max(620, this.size?.[1] || 0)]); return result;
    };
    const added = nodeType.prototype.onAdded;
    nodeType.prototype.onAdded = function() { const result = added?.apply(this, arguments); ensureSingleMediaInput(this); return result; };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function(type, slotIndex, isConnected, linkInfo, ioSlot) {
      const result = connections?.apply(this, arguments);
      if (isConnected && type === 1) setTimeout(() => convertConnection(this, slotIndex, linkInfo), 0);
      return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() { const result = configure?.apply(this, arguments); setTimeout(() => { ensureSingleMediaInput(this); this.__terryH3ShotTimeline?.refresh?.(); }, 0); return result; };
  },
  loadedGraphNode(node) { if (isTarget(node)) setTimeout(() => { ensureSingleMediaInput(node); node.__terryH3ShotTimeline?.refresh?.(); }, 0); },
});

/* Consolidated from h3_timeline_chip_rebind_and_scroll.js. */
{
const NODE_ID = "TerryXuH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}
function t(zh, en) { return localeIsZh() ? zh : en; }

function virtualLinks(node) {
  node.properties ||= {};
  const links = Array.isArray(node.properties[LINKS_PROP]) ? node.properties[LINKS_PROP] : [];
  return links.filter((link) => (node.graph || app.graph)?.getNodeById?.(Number(link?.source_id)));
}

function kindFor(source, slot, fallback = "") {
  const type = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (type.includes("AUDIO")) return "audio";
  if (type.includes("VIDEO")) return "video";
  if (type.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("audio")) return "audio";
  if (name.includes("video")) return "video";
  return "picture";
}

function filename(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}

function preview(source, kind) {
  if (!source || kind === "audio") return "";
  const file = filename(source, kind);
  if (file) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === file;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename: file, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const img = (source.imgs || []).find((x) => x?.src);
  if (img?.src) return img.src;
  for (const w of source.widgets || []) {
    const el = w?.element;
    const image = el?.matches?.("img") ? el : el?.querySelector?.("img");
    if (image?.src) return image.src;
    const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}

function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return virtualLinks(node).map((link) => {
    const source = (node.graph || app.graph)?.getNodeById?.(Number(link.source_id));
    const slot = Number(link.source_slot) || 0;
    const kind = link.kind || kindFor(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    return {
      key: `${Number(link.source_id)}:${slot}`,
      kind,
      index,
      source,
      name: filename(source, kind).split(/[\\/]/).pop() || source?.title || `${kind} ${index}`,
      preview: preview(source, kind),
      tag: kind === "picture" ? `<Picture ${index}>` : kind === "video" ? `<Video ${index}>` : `<Audio ${index}>`,
    };
  });
}

function bindings(node) {
  node.properties ||= {};
  let map = node.properties[BINDINGS_PROP];
  if (!map || typeof map !== "object" || Array.isArray(map)) map = {};

  // Migrate the first timeline implementation (SubjectNumber -> assetKey)
  // into the exact structure used by TerryXu | H3 Prompt Editor (assetKey -> SubjectNumber[]).
  const values = Object.values(map);
  if (values.some((value) => typeof value === "string")) {
    const migrated = {};
    for (const [subject, key] of Object.entries(map)) {
      if (typeof key !== "string") continue;
      migrated[key] ||= [];
      migrated[key].push(Number(subject));
    }
    map = migrated;
  }
  node.properties[BINDINGS_PROP] = map;
  return map;
}

function bindSubject(node, subjectNumber, asset) {
  const map = bindings(node);
  for (const key of Object.keys(map)) {
    const list = Array.isArray(map[key]) ? map[key].map(Number) : [];
    const next = list.filter((value) => value !== subjectNumber);
    if (next.length) map[key] = next;
    else delete map[key];
  }
  map[asset.key] ||= [];
  if (!map[asset.key].map(Number).includes(subjectNumber)) map[asset.key].push(subjectNumber);
}

function boundAsset(node, subjectNumber) {
  const map = bindings(node);
  const entry = Object.entries(map).find(([, list]) => Array.isArray(list) && list.map(Number).includes(subjectNumber));
  if (!entry) return null;
  return assets(node).find((asset) => asset.key === entry[0]) || null;
}

function parseChip(chip) {
  const raw = String(chip?.dataset?.raw || "");
  let match = raw.match(/^<Picture\s+(\d+)>$/i);
  if (match) return { type: "picture", number: Number(match[1]), raw };
  match = raw.match(/^<Video\s+(\d+)>$/i);
  if (match) return { type: "video", number: Number(match[1]), raw };
  match = raw.match(/^<Audio\s+(\d+)>$/i);
  if (match) return { type: "audio", number: Number(match[1]), raw };
  match = raw.match(/^<Subject\s+(\d+)>$/i);
  if (match) return { type: "subject", number: Number(match[1]), raw };
  return null;
}

function compatibleAssets(node, chipInfo) {
  const list = assets(node);
  if (chipInfo.type === "subject") return list.filter((asset) => asset.kind === "picture" || asset.kind === "video");
  return list.filter((asset) => asset.kind === chipInfo.type);
}

function closePicker(node) {
  node.__terryTimelineRebindMenu?.remove?.();
  node.__terryTimelineRebindMenu = null;
}

function renderChipForAsset(chip, info, asset) {
  if (info.type === "subject") {
    chip.className = "terry-tl-chip terry-h3-chip terry-h3-subject-asset-chip terry-h3-strong terry-h3-type-subject";
    chip.dataset.raw = `<Subject ${info.number}>`;
    chip.replaceChildren();
    if (asset.preview) {
      const img = document.createElement("img");
      img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
    } else {
      const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = "◇"; chip.append(icon);
    }
    const label = document.createElement("span"); label.textContent = `Subject ${info.number}`; chip.append(label);
    chip.title = t(`Subject ${info.number} · 来源 ${asset.name}`, `Subject ${info.number} · source ${asset.name}`);
    return;
  }

  chip.dataset.raw = asset.tag;
  chip.className = `terry-tl-chip terry-h3-chip terry-h3-media-chip terry-h3-type-${asset.kind}`;
  chip.replaceChildren();
  if (asset.preview && asset.kind !== "audio") {
    const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
  } else {
    const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧"; chip.append(icon);
  }
  const label = document.createElement("span"); label.textContent = asset.tag.slice(1, -1); chip.append(label);
  chip.title = asset.name;
}

function syncRoot(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  for (const chip of root.querySelectorAll(".terry-tl-chip")) {
    const info = parseChip(chip);
    if (!info) continue;
    if (info.type === "subject") {
      const asset = boundAsset(node, info.number);
      if (asset) renderChipForAsset(chip, info, asset);
      else {
        chip.classList.add("terry-h3-chip", "terry-h3-subject-asset-chip", "terry-h3-strong", "terry-h3-type-subject");
        chip.classList.remove("is-subject");
        chip.title = t(`Subject ${info.number} · 尚未绑定来源 · 点击选择图片/视频`, `Subject ${info.number} · no source bound · click to choose image/video`);
      }
    } else {
      chip.classList.add("terry-h3-chip", "terry-h3-media-chip", `terry-h3-type-${info.type}`);
      chip.classList.remove(`is-${info.type}`);
    }
  }
}

function syncTimeline(node) {
  node.__terryH3ShotTimeline?.save?.();
  syncRoot(node);
  node.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function chooseAsset(node, chip, info, asset) {
  if (info.type === "subject") bindSubject(node, info.number, asset);
  renderChipForAsset(chip, info, asset);
  closePicker(node);
  if (info.type !== "subject") {
    chip.closest(".terry-tl-rich")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  }
  syncTimeline(node);
}

function openPicker(node, chip, info) {
  closePicker(node);
  const options = compatibleAssets(node, info);
  const menu = document.createElement("div");
  menu.className = "terry-h3-rebind-menu";
  node.__terryTimelineRebindMenu = menu;

  const head = document.createElement("div");
  head.className = "terry-h3-rebind-head";
  const title = document.createElement("b");
  title.textContent = info.type === "subject"
    ? t(`Subject ${info.number} · 切换来源资产`, `Subject ${info.number} · Change Source Asset`)
    : t(`${info.raw.slice(1, -1)} · 切换资产`, `${info.raw.slice(1, -1)} · Change Asset`);
  const hint = document.createElement("small");
  hint.textContent = info.type === "subject"
    ? t("仅显示图片 / 视频", "Images / videos only")
    : t(`仅显示 ${info.type === "picture" ? "图片" : info.type === "video" ? "视频" : "音频"}`, `Only ${info.type}`);
  head.append(title, hint); menu.append(head);

  if (!options.length) {
    const empty = document.createElement("div");
    empty.className = "terry-h3-rebind-empty";
    empty.textContent = t("没有可用的兼容资产", "No compatible assets available");
    menu.append(empty);
  }

  for (const asset of options) {
    const item = document.createElement("button"); item.type = "button"; item.className = "terry-h3-rebind-item";
    const thumb = document.createElement("span"); thumb.className = "terry-h3-rebind-thumb";
    if (asset.preview && asset.kind !== "audio") {
      const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img);
    } else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
    const text = document.createElement("span");
    const main = document.createElement("b"); main.textContent = asset.tag.slice(1, -1);
    const sub = document.createElement("small"); sub.textContent = asset.name;
    text.append(main, sub); item.append(thumb, text);
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); chooseAsset(node, chip, info, asset);
    });
    menu.append(item);
  }

  document.body.append(menu);
  const rect = chip.getBoundingClientRect();
  const width = 300;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const height = Math.min(340, menu.offsetHeight || 260);
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.max(8, Math.round(left))}px`;
  menu.style.top = `${Math.max(8, Math.round(top))}px`;
}

function bindRoot(node) {
  const editor = node?.__terryH3ShotTimeline;
  const root = editor?.root;
  if (!root) return false;

  // Same interaction pattern as TerryXu | H3 Prompt Editor: bind pointer handling
  // once to the editor itself. No MutationObserver and no DOM polling.
  if (!root.__terryH3RebindBound) {
    root.__terryH3RebindBound = true;
    root.addEventListener("pointerdown", (event) => {
      const chip = event.target?.closest?.(".terry-tl-chip");
      if (!chip || !root.contains(chip)) return;
      const info = parseChip(chip);
      if (!info) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      openPicker(node, chip, info);
    }, true);
  }

  // Parser/render explicitly call refresh. Hook that existing lifecycle instead of
  // observing arbitrary DOM mutations, then re-apply the same chip rendering logic.
  if (!editor.__terryRebindRefreshWrapped) {
    editor.__terryRebindRefreshWrapped = true;
    const refresh = editor.refresh?.bind(editor);
    if (refresh) editor.refresh = function() {
      const result = refresh(...arguments);
      requestAnimationFrame(() => syncRoot(node));
      return result;
    };
    const refreshAssets = editor.refreshAssets?.bind(editor);
    if (refreshAssets) editor.refreshAssets = function() {
      const result = refreshAssets(...arguments);
      requestAnimationFrame(() => syncRoot(node));
      return result;
    };
  }

  syncRoot(node);
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    if (bindRoot(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(900, 60 * attempts));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-chip-rebind-scroll-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-chip-rebind-scroll-style";
  style.textContent = `
.terry-h3-timeline-root{max-height:720px!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-gutter:stable;overscroll-behavior:contain;padding-right:5px!important}
.terry-h3-timeline-root::-webkit-scrollbar{width:8px}.terry-h3-timeline-root::-webkit-scrollbar-track{background:rgba(255,255,255,.025);border-radius:8px}.terry-h3-timeline-root::-webkit-scrollbar-thumb{background:rgba(255,255,255,.16);border-radius:8px}.terry-h3-timeline-root::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.25)}
.terry-h3-timeline-root .terry-h3-chip{margin:1px 2px;vertical-align:middle}.terry-h3-timeline-root .terry-h3-media-chip,.terry-h3-timeline-root .terry-h3-subject-asset-chip{cursor:pointer!important}
.terry-h3-timeline-root .terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
.terry-h3-timeline-root .terry-h3-media-chip:hover,.terry-h3-timeline-root .terry-h3-subject-asset-chip:hover{box-shadow:inset 0 0 0 1px rgba(0,226,187,.38),0 0 0 1px rgba(0,226,187,.12)!important}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TimelineChipRebindAndScroll",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        const menu = node?.__terryTimelineRebindMenu;
        if (!menu || menu.contains(event.target) || event.target?.closest?.(".terry-h3-media-chip,.terry-h3-subject-asset-chip")) continue;
        closePicker(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineChipRebindInstalled) return;
    nodeType.prototype.__terryTimelineChipRebindInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});

}


/* Consolidated from h3_timeline_color_theme.js. */
{
const NODE_ID = "TerryXuH3ShotTimeline";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function refreshTimelineAssets(node) {
  if (!isTarget(node)) return;
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.__terryTimelineSyncChips?.();
}

function bindViewRefresh(node) {
  if (!isTarget(node)) return false;
  const root = node.__terryH3ShotTimeline?.root;
  if (!root) return false;
  if (root.__terryTimelineViewRefreshBound) return true;
  root.__terryTimelineViewRefreshBound = true;

  const refreshSoon = () => requestAnimationFrame(() => refreshTimelineAssets(node));
  root.addEventListener("click", (event) => {
    if (event.target?.closest?.(".terry-tl-shot,.terry-tl-meta")) refreshSoon();
  });
  root.addEventListener("focusin", (event) => {
    if (event.target?.closest?.(".terry-tl-card .terry-tl-rich")) refreshSoon();
  });
  return true;
}

function bindSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => {
    attempts += 1;
    if (bindViewRefresh(node) || attempts >= 12) return;
    setTimeout(run, Math.min(720, attempts * 60));
  };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-color-theme")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-color-theme";
  style.textContent = `
/* TerryXu H3 timeline — section color hierarchy */
.terry-h3-timeline-root{
  --tl-orange:#f59e0b;
  --tl-orange-soft:rgba(245,158,11,.14);
  --tl-orange-border:rgba(245,158,11,.38);
  --tl-blue:#60a5fa;
  --tl-blue-soft:rgba(96,165,250,.10);
  --tl-blue-border:rgba(96,165,250,.28);
  --tl-purple:#c084fc;
  --tl-purple-soft:rgba(192,132,252,.10);
  --tl-purple-border:rgba(192,132,252,.26);
  --tl-green:#4ade80;
  --tl-green-soft:rgba(74,222,128,.09);
  --tl-green-border:rgba(74,222,128,.24);
  --tl-pink:#f472b6;
  --tl-pink-soft:rgba(244,114,182,.09);
  --tl-pink-border:rgba(244,114,182,.24);
  max-height:none!important;
  overflow:visible!important;
  padding-right:7px!important;
}

/* Header — neutral with an orange timeline identity accent. */
.terry-h3-timeline-root .terry-tl-header{
  padding:7px 8px;
  border:1px solid var(--tl-orange-border);
  border-radius:7px;
  background:linear-gradient(90deg,var(--tl-orange-soft),rgba(245,158,11,.035));
}
.terry-h3-timeline-root .terry-tl-header>b{color:#ffd38a}
.terry-h3-timeline-root .terry-tl-header input[type=range]{accent-color:var(--tl-orange)}
.terry-h3-timeline-root .terry-tl-header input[type=number]{border-color:var(--tl-orange-border);background:rgba(245,158,11,.07)}
.terry-h3-timeline-root .terry-tl-parse-button{border-color:var(--tl-orange-border);background:var(--tl-orange-soft);color:#ffd89a}
.terry-h3-timeline-root .terry-tl-parse-button:hover{background:rgba(245,158,11,.22)}

/* Global description — cool blue, scrolls only inside its own editor. */
.terry-h3-timeline-root .terry-tl-section{
  padding:7px;
  border:1px solid var(--tl-blue-border);
  border-radius:7px;
  background:var(--tl-blue-soft);
}
.terry-h3-timeline-root .terry-tl-section>label{color:#a9d0ff;opacity:.92;font-weight:700}
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich{
  max-height:180px;
  overflow-y:auto;
  overscroll-behavior:contain;
  border-color:rgba(96,165,250,.22);
  background:rgba(22,50,84,.22);
}
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich:focus{
  border-color:rgba(96,165,250,.55);
  box-shadow:0 0 0 1px rgba(96,165,250,.12);
}

/* Timeline — fixed in place, intentionally orange and visually dominant. */
.terry-h3-timeline-root .terry-tl-lane-head{
  margin-top:9px;
  padding:0 2px;
  color:#ffc56d;
  opacity:1;
  font-weight:700;
}
.terry-h3-timeline-root .terry-tl-lane-head button{
  border-color:var(--tl-orange-border);
  background:var(--tl-orange-soft);
  color:#ffd38a;
}
.terry-h3-timeline-root .terry-tl-lane{
  border-color:rgba(245,158,11,.42);
  background:rgba(72,40,6,.30);
  box-shadow:inset 0 0 0 1px rgba(245,158,11,.05);
}
.terry-h3-timeline-root .terry-tl-shot{
  border-right-color:rgba(255,190,75,.28);
  background:rgba(245,158,11,.11);
  color:#ffe3b0;
}
.terry-h3-timeline-root .terry-tl-shot:nth-of-type(even){background:rgba(251,146,60,.15)}
.terry-h3-timeline-root .terry-tl-shot:hover{background:rgba(245,158,11,.21)}
.terry-h3-timeline-root .terry-tl-shot.is-selected{
  background:rgba(245,158,11,.31);
  box-shadow:inset 0 0 0 1px rgba(255,198,92,.45);
  color:#fff1d6;
}
.terry-h3-timeline-root .terry-tl-shot.is-drop{box-shadow:inset 4px 0 0 #ffd071}
.terry-h3-timeline-root .terry-tl-seam:after{background:#ffb238;box-shadow:0 0 0 1px rgba(85,44,0,.55)}
.terry-h3-timeline-root .terry-tl-seam.is-active:after{background:#ffe0a3;box-shadow:0 0 8px rgba(245,158,11,.55)}

/* Shot descriptions — only this area scrolls vertically. */
.terry-h3-timeline-root .terry-tl-cards{
  max-height:390px;
  overflow-y:auto;
  overflow-x:hidden;
  overscroll-behavior:contain;
  scrollbar-gutter:stable;
  padding:6px;
  border:1px solid var(--tl-purple-border);
  border-radius:7px;
  background:rgba(192,132,252,.035);
}
.terry-h3-timeline-root .terry-tl-card{
  border-color:rgba(192,132,252,.18);
  background:var(--tl-purple-soft);
}
.terry-h3-timeline-root .terry-tl-card.is-selected{
  border-color:rgba(192,132,252,.48);
  background:rgba(192,132,252,.16);
}
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich{
  max-height:180px;
  overflow-y:auto;
  overscroll-behavior:contain;
  border-color:rgba(192,132,252,.18);
  background:rgba(46,26,66,.20);
}
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich:focus{
  border-color:rgba(192,132,252,.48);
  box-shadow:0 0 0 1px rgba(192,132,252,.10);
}
.terry-h3-timeline-root .terry-tl-meta b{color:#dec0ff}
.terry-h3-timeline-root .terry-tl-delete{border-color:rgba(244,114,182,.22);background:rgba(244,114,182,.08);color:#ffc2df}

/* Optional sound blocks — green for diegetic ambience, pink for music. */
.terry-h3-timeline-root .terry-tl-audio{
  padding:8px;
  border:1px solid rgba(255,255,255,.08);
  border-radius:7px;
  background:rgba(255,255,255,.018);
}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(1){color:#9ff1b8}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(2){color:#ffb3d7}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(1) input{accent-color:var(--tl-green)}
.terry-h3-timeline-root .terry-tl-audio .terry-tl-option:nth-of-type(2) input{accent-color:var(--tl-pink)}
.terry-h3-timeline-root .terry-tl-audio textarea:nth-of-type(1){border-color:var(--tl-green-border);background:var(--tl-green-soft)}
.terry-h3-timeline-root .terry-tl-audio textarea:nth-of-type(2){border-color:var(--tl-pink-border);background:var(--tl-pink-soft)}

/* Keep H3 token colors vivid and consistent with the main H3 editor. */
.terry-h3-timeline-root .terry-tl-chip.is-subject{background:rgba(180,140,255,.16);color:#dccaff;border-color:rgba(180,140,255,.28)}
.terry-h3-timeline-root .terry-tl-chip.is-picture{background:rgba(0,210,180,.14);color:#b8fff2;border-color:rgba(0,210,180,.26)}
.terry-h3-timeline-root .terry-tl-chip.is-video{background:rgba(76,170,255,.15);color:#c2e2ff;border-color:rgba(76,170,255,.28)}
.terry-h3-timeline-root .terry-tl-chip.is-audio{background:rgba(255,174,70,.14);color:#ffe0b7;border-color:rgba(255,174,70,.28)}
.terry-h3-timeline-root .terry-tl-chip.is-speaker{background:rgba(255,120,160,.14);color:#ffcbdb;border-color:rgba(255,120,160,.26)}
.terry-h3-timeline-root .terry-tl-chip.is-dialogue{background:rgba(0,226,187,.14);color:#befff4;border-color:rgba(0,226,187,.25)}

/* Scrollbars belong only to text/card areas, never to the whole node. */
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar{width:8px}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-track,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-track{background:rgba(0,0,0,.10)}
.terry-h3-timeline-root .terry-tl-cards::-webkit-scrollbar-thumb,
.terry-h3-timeline-root .terry-tl-rich::-webkit-scrollbar-thumb{background:rgba(245,158,11,.26);border-radius:8px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TimelineColorTheme",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineColorThemeInstalled) return;
    nodeType.prototype.__terryTimelineColorThemeInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        bindSoon(this);
        if (isTarget(this)) this.setDirtyCanvas?.(true, true);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) bindSoon(node); },
});

}


/* Consolidated from h3_timeline_editor_integrity.js. */
{
const NODE_ID = "TerryXuH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("AUDIO")) return "audio";
  if (raw.includes("VIDEO")) return "video";
  return "picture";
}

function filenameFromSource(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v)$/i.test(String(file))) return String(file);
  }
  return "";
}

function previewFromSource(source, kind) {
  if (!source || kind === "audio") return "";
  const filename = filenameFromSource(source, kind);
  if (filename) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  return (source.imgs || []).find((item) => item?.src)?.src || "";
}

function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    const source = (node.graph || app.graph)?.getNodeById?.(sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    out.push({ key: `${sourceId}:${slot}`, kind, index: counts[kind], preview: previewFromSource(source, kind) });
  }
  return out;
}

function boundAsset(node, subjectNumber, allAssets) {
  const map = node?.properties?.[BINDINGS_PROP];
  if (!map || typeof map !== "object") return null;
  for (const [key, list] of Object.entries(map)) {
    if (Array.isArray(list) && list.map(Number).includes(subjectNumber)) return allAssets.find((asset) => asset.key === key) || null;
    if (typeof list === "string" && Number(key) === subjectNumber) return allAssets.find((asset) => asset.key === list) || null;
  }
  return null;
}

function ensureThumb(chip, preview) {
  if (!preview) return;
  let img = chip.querySelector(":scope > img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    chip.prepend(img);
  }
  if (img.src !== preview) img.src = preview;
}

function syncThumbnails(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  const allAssets = assets(node);
  for (const chip of root.querySelectorAll(".terry-tl-rich .terry-tl-chip")) {
    const raw = String(chip.dataset?.raw || "");
    let match = raw.match(/^<Subject\s+(\d+)>$/i);
    if (match) {
      const asset = boundAsset(node, Number(match[1]), allAssets);
      if (asset?.preview) ensureThumb(chip, asset.preview);
      continue;
    }
    match = raw.match(/^<(Picture|Video)\s+(\d+)>$/i);
    if (match) {
      const kind = match[1].toLowerCase() === "picture" ? "picture" : "video";
      const asset = allAssets.find((item) => item.kind === kind && item.index === Number(match[2]));
      if (asset?.preview) ensureThumb(chip, asset.preview);
    }
  }
}

function endsWithNewline(fragment) {
  const last = fragment.lastChild;
  return last?.nodeType === Node.TEXT_NODE && String(last.nodeValue || "").endsWith("\n");
}

function flattenInto(fragment, node) {
  if (node.nodeType === Node.TEXT_NODE) {
    fragment.append(document.createTextNode(node.nodeValue || ""));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;
  if (node.tagName === "BR") {
    fragment.append(document.createTextNode("\n"));
    return;
  }
  if (node.tagName === "DIV" || node.tagName === "P") {
    if (fragment.childNodes.length && !endsWithNewline(fragment)) fragment.append(document.createTextNode("\n"));
    for (const child of [...node.childNodes]) flattenInto(fragment, child);
    return;
  }
  fragment.append(node);
}

function normalizeEditorLines(editor) {
  if (!editor?.querySelector?.("div,p,br")) return;
  const selection = window.getSelection?.();
  let marker = null;
  if (selection?.rangeCount && editor.contains(selection.anchorNode)) {
    marker = document.createElement("span");
    marker.dataset.terryTimelineCaret = "1";
    marker.textContent = "";
    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);
    range.insertNode(marker);
  }

  const fragment = document.createDocumentFragment();
  for (const child of [...editor.childNodes]) flattenInto(fragment, child);
  editor.replaceChildren(fragment);

  if (marker?.isConnected && selection) {
    const range = document.createRange();
    range.setStartBefore(marker);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    marker.remove();
  }
}

function bind(node) {
  if (!isTarget(node)) return false;
  const editorApi = node?.__terryH3ShotTimeline;
  const root = editorApi?.root;
  if (!root) return false;

  if (!root.__terryTimelineIntegrityBound) {
    root.__terryTimelineIntegrityBound = true;
    // Run before the timeline core's bubbling input listener serializes the rich editor.
    root.addEventListener("input", (event) => {
      const editor = event.target?.closest?.(".terry-tl-rich");
      if (editor && root.contains(editor)) normalizeEditorLines(editor);
    }, true);
  }

  if (!editorApi.__terryTimelineIntegrityRefreshWrapped) {
    editorApi.__terryTimelineIntegrityRefreshWrapped = true;
    for (const name of ["refresh", "refreshAssets"]) {
      const original = editorApi[name]?.bind(editorApi);
      if (!original) continue;
      editorApi[name] = function() {
        const result = original(...arguments);
        // Re-apply bindings synchronously so rebuilt rich editors never paint a frame without thumbnails.
        syncThumbnails(node);
        return result;
      };
    }
  }

  syncThumbnails(node);
  return true;
}

function bindSoon(node) {
  if (!isTarget(node)) return;
  let tries = 0;
  const run = () => {
    tries += 1;
    if (bind(node) || tries >= 12) return;
    setTimeout(run, Math.min(720, tries * 60));
  };
  setTimeout(run, 0);
}

app.registerExtension({
  name: "TerryXu.H3TimelineEditorIntegrity",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineIntegrityInstalled) return;
    nodeType.prototype.__terryTimelineIntegrityInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        bindSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) bindSoon(node); },
});

}


/* Consolidated from h3_timeline_lane_polish.js. */
{
const NODE_ID = "TerryXuH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name) || null;
}

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("AUDIO")) return "audio";
  if (raw.includes("VIDEO")) return "video";
  return "picture";
}

function filenameFromSource(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}

function previewFromSource(source, kind) {
  if (!source || kind === "audio") return "";
  const filename = filenameFromSource(source, kind);
  if (filename) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const image = (source.imgs || []).find((item) => item?.src);
  if (image?.src) return image.src;
  return "";
}

function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    const source = (node.graph || app.graph)?.getNodeById?.(sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    out.push({
      key: `${sourceId}:${slot}`,
      kind,
      index: counts[kind],
      preview: previewFromSource(source, kind),
    });
  }
  return out;
}

function boundAsset(node, subjectNumber, allAssets) {
  const map = node?.properties?.[BINDINGS_PROP];
  if (!map || typeof map !== "object") return null;
  for (const [key, list] of Object.entries(map)) {
    if (Array.isArray(list) && list.map(Number).includes(subjectNumber)) return allAssets.find((asset) => asset.key === key) || null;
    if (typeof list === "string" && Number(key) === subjectNumber) return allAssets.find((asset) => asset.key === list) || null;
  }
  return null;
}

function ensureThumb(chip, preview) {
  if (!preview) return;
  let img = chip.querySelector(":scope > img");
  if (!img) {
    img = document.createElement("img");
    img.alt = "";
    img.draggable = false;
    chip.prepend(img);
  }
  if (img.src !== preview) img.src = preview;
}

function syncGlobalThumbnails(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  const globalEditor = root?.querySelector?.(".terry-tl-section .terry-tl-rich");
  if (!globalEditor) return;
  const allAssets = assets(node);
  for (const chip of globalEditor.querySelectorAll(".terry-tl-chip")) {
    const raw = String(chip.dataset?.raw || "");
    let match = raw.match(/^<Subject\s+(\d+)>$/i);
    if (match) {
      const asset = boundAsset(node, Number(match[1]), allAssets);
      if (asset?.preview) ensureThumb(chip, asset.preview);
      continue;
    }
    match = raw.match(/^<(Picture|Video)\s+(\d+)>$/i);
    if (match) {
      const kind = match[1].toLowerCase() === "picture" ? "picture" : "video";
      const asset = allAssets.find((item) => item.kind === kind && item.index === Number(match[2]));
      if (asset?.preview) ensureThumb(chip, asset.preview);
    }
  }
}

function parseState(node) {
  try {
    const raw = widget(node, "timeline_state")?.value;
    const state = raw ? JSON.parse(raw) : null;
    return state && Array.isArray(state.shots) ? state : null;
  } catch {
    return null;
  }
}

function summary(text) {
  return String(text || "")
    .replace(/<d>\[[^\]]+\][\s\S]*?<\/d>/gi, " ")
    .replace(/<(?:Subject|Picture|Video|Audio)\s+\d+>/gi, " ")
    .replace(/\(S\d+\)/gi, " ")
    .replace(/^\s*(?:景别与构图|主体动态|运镜动态|光照|音效)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function updateLane(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  const lane = root?.querySelector?.(".terry-tl-lane");
  if (!lane) return;
  const state = parseState(node);
  if (!state) return;
  const blocks = [...lane.querySelectorAll(".terry-tl-shot")];
  blocks.forEach((block, index) => {
    let line = block.querySelector(":scope > .terry-tl-shot-summary");
    if (!line) {
      line = document.createElement("span");
      line.className = "terry-tl-shot-summary";
      block.append(line);
    }
    line.textContent = summary(state.shots[index]?.text) || "—";
    const dur = block.querySelector(":scope > small");
    if (dur) dur.classList.add("terry-tl-shot-duration");
  });
}

function syncNow(node) {
  updateLane(node);
  syncGlobalThumbnails(node);
}

function refreshSoon(node) {
  requestAnimationFrame(() => syncNow(node));
}

function bind(node) {
  if (!isTarget(node)) return false;
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return false;
  if (!root.__terryLanePolishBound) {
    root.__terryLanePolishBound = true;

    // Run synchronously in bubble phase. The core target handler has already
    // rebuilt the lane by then, but the browser has not painted yet, so there
    // is no one-frame fallback/flicker.
    root.addEventListener("click", () => syncNow(node));
    root.addEventListener("drop", (event) => {
      if (event.target?.closest?.(".terry-tl-shot")) syncNow(node);
    });
    root.addEventListener("pointerup", (event) => {
      if (event.target?.closest?.(".terry-tl-seam")) syncNow(node);
    });
    root.addEventListener("pointercancel", (event) => {
      if (event.target?.closest?.(".terry-tl-seam")) syncNow(node);
    });
    root.addEventListener("focusin", (event) => {
      if (event.target?.closest?.(".terry-tl-rich")) syncNow(node);
    });
    root.addEventListener("input", (event) => {
      if (event.target?.closest?.(".terry-tl-card .terry-tl-rich")) syncNow(node);
    });
  }

  const editor = node.__terryH3ShotTimeline;
  if (editor && !editor.__terryLanePolishRefreshWrapped) {
    editor.__terryLanePolishRefreshWrapped = true;
    for (const name of ["refresh", "refreshAssets"]) {
      const original = editor[name]?.bind(editor);
      if (!original) continue;
      editor[name] = function() {
        const result = original(...arguments);
        syncNow(node);
        return result;
      };
    }
  }
  refreshSoon(node);
  return true;
}

function bindSoon(node) {
  if (!isTarget(node)) return;
  let tries = 0;
  const run = () => {
    tries += 1;
    if (bind(node) || tries >= 12) return;
    setTimeout(run, Math.min(720, tries * 60));
  };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-lane-polish-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-timeline-lane-polish-style";
  style.textContent = `
.terry-h3-timeline-root .terry-tl-rich{cursor:text!important}
.terry-h3-timeline-root .terry-tl-lane{height:76px!important}
.terry-h3-timeline-root .terry-tl-shot{padding:8px 9px 7px!important}
.terry-h3-timeline-root .terry-tl-shot>b,
.terry-h3-timeline-root .terry-tl-shot>small{display:inline!important;font-size:11px!important;font-weight:700!important;line-height:1.2!important;color:inherit!important;opacity:1!important}
.terry-h3-timeline-root .terry-tl-shot>small{margin:0 0 0 6px!important;padding:1px 6px!important;border:1px solid rgba(255,209,102,.62)!important;border-radius:999px!important;background:rgba(245,158,11,.12)!important}
.terry-h3-timeline-root .terry-tl-shot-summary{display:block;margin-top:7px;padding:0 2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:9.5px;line-height:1.2;opacity:.72;text-align:center;color:#f7e6ca}
.terry-h3-timeline-root .terry-tl-shot.is-selected{background:linear-gradient(180deg,rgba(245,158,11,.52),rgba(218,119,6,.34))!important;border:1px solid #ffd166!important;box-shadow:inset 0 0 0 1px rgba(255,255,255,.18),0 0 12px rgba(245,158,11,.38)!important;color:#fff7e8!important;z-index:2}
.terry-h3-timeline-root .terry-tl-shot.is-selected>b,
.terry-h3-timeline-root .terry-tl-shot.is-selected>small{font-size:11px!important;font-weight:700!important;text-shadow:0 1px 2px rgba(0,0,0,.45)}
.terry-h3-timeline-root .terry-tl-shot.is-selected>small{border-color:#ffe0a3!important;background:rgba(255,209,102,.18)!important}
.terry-h3-timeline-root .terry-tl-shot.is-selected .terry-tl-shot-summary{opacity:.95;color:#fff3da}
.terry-h3-timeline-root .terry-tl-section .terry-tl-chip>img{width:26px;height:26px;object-fit:cover;border-radius:3px;margin-right:3px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TimelineLanePolish",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryLanePolishInstalled) return;
    nodeType.prototype.__terryLanePolishInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        bindSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) { if (isTarget(node)) bindSoon(node); },
});

}


/* Consolidated from h3_timeline_transport_prune.js. */
{
const NODE_ID = "TerryXuH3ShotTimeline";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function isTransportName(name) {
  const value = String(name || "");
  return /^asset\d*$/i.test(value) || value === "assets";
}

function pruneNodeData(nodeData) {
  if (!nodeData) return;
  for (const sectionName of ["required", "optional"]) {
    const section = nodeData.input?.[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const key of Object.keys(section)) {
      if (isTransportName(key)) delete section[key];
    }
  }
  if (Array.isArray(nodeData.inputs)) {
    nodeData.inputs = nodeData.inputs.filter((input) => !isTransportName(input?.name));
  }
  for (const key of ["required", "optional"]) {
    if (Array.isArray(nodeData.input_order?.[key])) {
      nodeData.input_order[key] = nodeData.input_order[key].filter((name) => !isTransportName(name));
    }
  }
}

function removeInputAt(node, index) {
  const input = node?.inputs?.[index];
  if (!input) return;
  try {
    if (input.link != null) node.disconnectInput?.(index);
  } catch {}
  if (typeof node.removeInput === "function") node.removeInput(index);
  else node.inputs.splice(index, 1);
}

function pruneInstance(node) {
  if (!isTarget(node) || !node?.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (isTransportName(node.inputs[i]?.name)) removeInputAt(node, i);
  }
  node._widgetSlotsDirty = true;
  node.setDirtyCanvas?.(true, true);
}

function installSoon(node) {
  if (!isTarget(node)) return;
  pruneInstance(node);
  for (const delay of [0, 60, 180]) {
    setTimeout(() => pruneInstance(node), delay);
  }
}

app.registerExtension({
  name: "TerryXu.H3TimelineTransportPrune",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    // Same pattern used by TerryXu | H3 Prompt Editor: remove the backend Autogrow
    // transport sockets from frontend node metadata before ComfyUI creates visible inputs.
    pruneNodeData(nodeData);
    if (nodeType?.nodeData && nodeType.nodeData !== nodeData) pruneNodeData(nodeType.nodeData);
    if (nodeType?.prototype?.constructor?.nodeData && nodeType.prototype.constructor.nodeData !== nodeData) {
      pruneNodeData(nodeType.prototype.constructor.nodeData);
    }

    if (nodeType.prototype.__terryH3TimelineTransportPruneInstalled) return;
    nodeType.prototype.__terryH3TimelineTransportPruneInstalled = true;

    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }

    // Covers old workflows where asset0 / asset1 were serialized into the node.
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      pruneInstance(this);
      return result;
    };
  },
  loadedGraphNode(node) {
    installSoon(node);
  },
});

}


/* Consolidated from zz_h3_timeline_ux_v2.js. */
{
const NODE_ID = "TerryXuH3ShotTimeline";
const LINKS_PROP = "terry_h3_timeline_virtual_media_links";
const BINDINGS_PROP = "terry_h3_timeline_subject_bindings";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}
function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}
function t(zh, en) { return localeIsZh() ? zh : en; }
function graphNode(node, id) { return (node?.graph || app.graph)?.getNodeById?.(Number(id)) || null; }

function sourceKind(source, slot = 0, fallback = "") {
  const raw = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  if (raw.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("video")) return "video";
  if (name.includes("audio")) return "audio";
  return "picture";
}
function filename(source, kind) {
  const preferred = kind === "picture" ? ["image", "filename", "file"] : kind === "video" ? ["video", "file", "filename", "video_file", "videofile"] : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    if (preferred.includes(String(w?.name || "").toLowerCase()) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}
function preview(source, kind) {
  if (!source || kind === "audio") return "";
  const file = filename(source, kind);
  if (file) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === file;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename: file, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const img = (source.imgs || []).find((x) => x?.src);
  if (img?.src) return img.src;
  for (const w of source.widgets || []) {
    const el = w?.element;
    const image = el?.matches?.("img") ? el : el?.querySelector?.("img");
    if (image?.src) return image.src;
    const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}
function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 }, out = [], seen = new Set();
  for (const link of node?.properties?.[LINKS_PROP] || []) {
    const sourceId = Number(link?.source_id), slot = Number(link?.source_slot) || 0;
    const source = graphNode(node, sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const key = `${sourceId}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = link.kind || sourceKind(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const type = kind === "picture" ? "Picture" : kind === "video" ? "Video" : "Audio";
    out.push({ key, kind, index, tag: `<${type} ${index}>`, label: `${type} ${index}`,
      source, name: filename(source, kind).split(/[\\/]/).pop() || source.title || `${type} ${index}`, preview: preview(source, kind) });
  }
  return out;
}
function bindingMap(node) {
  const raw = node?.properties?.[BINDINGS_PROP];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
}
function boundAsset(node, subjectNumber, list = assets(node)) {
  const entry = Object.entries(bindingMap(node)).find(([, subjects]) => Array.isArray(subjects) && subjects.map(Number).includes(subjectNumber));
  return entry ? list.find((asset) => asset.key === entry[0]) || null : null;
}
function parseChip(chip) {
  const raw = String(chip?.dataset?.raw || "");
  let m = raw.match(/^<Subject\s+(\d+)>$/i);
  if (m) return { type: "subject", number: Number(m[1]), raw };
  m = raw.match(/^<(Picture|Video|Audio)\s+(\d+)>$/i);
  if (m) return { type: m[1].toLowerCase(), number: Number(m[2]), raw };
  return null;
}
function renderChip(chip, info, asset) {
  if (!chip || !info) return;
  if (info.type === "subject") {
    chip.className = "terry-tl-chip terry-h3-chip terry-h3-subject-asset-chip terry-h3-strong terry-h3-type-subject";
    chip.dataset.raw = `<Subject ${info.number}>`;
  } else {
    if (!asset) return;
    chip.className = `terry-tl-chip terry-h3-chip terry-h3-media-chip terry-h3-type-${asset.kind}`;
    chip.dataset.raw = asset.tag;
  }
  chip.replaceChildren();
  if (asset?.preview && asset.kind !== "audio") {
    const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
  } else {
    const icon = document.createElement("span"); icon.className = "terry-h3-media-icon";
    icon.textContent = info.type === "subject" ? "◇" : asset?.kind === "audio" ? "♪" : asset?.kind === "video" ? "▶" : "▧"; chip.append(icon);
  }
  const label = document.createElement("span");
  label.textContent = info.type === "subject" ? `Subject ${info.number}` : asset.label;
  chip.append(label);
  chip.title = info.type === "subject"
    ? (asset ? t(`Subject ${info.number} · 来源 ${asset.name}`, `Subject ${info.number} · source ${asset.name}`) : t("点击选择来源资产", "Click to choose source asset"))
    : asset.name;
}
function syncChips(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  const list = assets(node);
  for (const chip of root.querySelectorAll(".terry-tl-chip")) {
    const info = parseChip(chip);
    if (!info) continue;
    if (info.type === "subject") renderChip(chip, info, boundAsset(node, info.number, list));
    else {
      const asset = list.find((item) => item.kind === info.type && item.index === info.number);
      if (asset) renderChip(chip, info, asset);
    }
  }
}

function clearOuterScroll(node) {
  const root = node?.__terryH3ShotTimeline?.root;
  if (!root) return;
  root.style.setProperty("max-height", "none", "important");
  root.style.setProperty("overflow", "visible", "important");
  const rootRect = root.getBoundingClientRect();
  let parent = root.parentElement;
  for (let depth = 0; parent && parent !== document.body && depth < 7; depth += 1, parent = parent.parentElement) {
    const rect = parent.getBoundingClientRect();
    const computed = getComputedStyle(parent);
    const nearWidth = !rootRect.width || (rect.width >= rootRect.width * .82 && rect.width <= rootRect.width * 1.22);
    const scrollish = computed.overflowY === "auto" || computed.overflowY === "scroll" || parent.scrollHeight > parent.clientHeight + 3;
    if (!nearWidth || !scrollish) continue;
    parent.style.setProperty("overflow-y", "visible", "important");
    parent.style.setProperty("overflow-x", "visible", "important");
    parent.style.setProperty("max-height", "none", "important");
    parent.style.setProperty("scrollbar-gutter", "auto", "important");
  }
}

function closeTypeMenu(node) {
  node.__terryTimelineTypeMenu?.remove?.();
  node.__terryTimelineTypeMenu = null;
}
function openGlobalAssetMenu(node, chip) {
  closeTypeMenu(node);
  const list = assets(node);
  if (!list.length) return;
  const menu = document.createElement("div"); menu.className = "terry-h3-rebind-menu terry-h3-timeline-type-menu"; node.__terryTimelineTypeMenu = menu;
  const head = document.createElement("div"); head.className = "terry-h3-rebind-head";
  const title = document.createElement("b"); title.textContent = t("切换资产 / 类型", "Change asset / type");
  const hint = document.createElement("small"); hint.textContent = t("图片、视频、音频均可切换", "Switch between image, video, and audio");
  head.append(title, hint); menu.append(head);
  for (const asset of list) {
    const item = document.createElement("button"); item.type = "button"; item.className = "terry-h3-rebind-item";
    const thumb = document.createElement("span"); thumb.className = "terry-h3-rebind-thumb";
    if (asset.preview && asset.kind !== "audio") { const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img); }
    else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
    const text = document.createElement("span"); const main = document.createElement("b"); main.textContent = asset.label;
    const sub = document.createElement("small"); sub.textContent = asset.name; text.append(main, sub); item.append(thumb, text);
    item.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const info = parseChip(chip); if (!info) return;
      renderChip(chip, { ...info, type: asset.kind, number: asset.index }, asset);
      closeTypeMenu(node);
      chip.closest(".terry-tl-rich")?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
      requestAnimationFrame(() => syncChips(node));
    });
    menu.append(item);
  }
  document.body.append(menu);
  const rect = chip.getBoundingClientRect(), width = 300;
  let left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)), top = rect.bottom + 6;
  const height = Math.min(340, menu.offsetHeight || 280);
  if (top + height > innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.round(left)}px`; menu.style.top = `${Math.round(top)}px`;
}

function installNode(node) {
  if (!isTarget(node)) return false;
  const editor = node.__terryH3ShotTimeline, root = editor?.root;
  if (!root) return false;
  if (!root.__terryTimelineUxV2Bound) {
    root.__terryTimelineUxV2Bound = true;
    const refreshSoon = () => requestAnimationFrame(() => { syncChips(node); clearOuterScroll(node); });
    root.addEventListener("click", (event) => {
      if (event.target?.closest?.(".terry-tl-shot,.terry-tl-meta,.terry-tl-delete")) refreshSoon();
    });
    root.addEventListener("focusin", (event) => {
      if (event.target?.closest?.(".terry-tl-rich")) refreshSoon();
    });
  }
  if (!editor.__terryUxRefreshWrapped) {
    editor.__terryUxRefreshWrapped = true;
    for (const key of ["refresh", "refreshAssets"]) {
      const old = editor[key]?.bind(editor);
      if (!old) continue;
      editor[key] = function() {
        const result = old(...arguments);
        requestAnimationFrame(() => { syncChips(node); clearOuterScroll(node); });
        return result;
      };
    }
  }
  node.__terryTimelineSyncChips = () => syncChips(node);
  syncChips(node); clearOuterScroll(node);
  return true;
}
function installSoon(node) {
  if (!isTarget(node)) return;
  let attempts = 0;
  const run = () => { attempts += 1; if (installNode(node) || attempts >= 16) return; setTimeout(run, Math.min(800, attempts * 60)); };
  setTimeout(run, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-ux-v2-style")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-ux-v2-style";
  style.textContent = `
.terry-h3-timeline-root{max-height:none!important;overflow:visible!important;scrollbar-gutter:auto!important}
.terry-h3-timeline-root .terry-tl-cards{max-height:none!important;overflow:visible!important;scrollbar-gutter:auto!important;padding:7px!important}
.terry-h3-timeline-root .terry-tl-card{display:none!important;margin:0!important}
.terry-h3-timeline-root .terry-tl-card.is-selected{display:grid!important;border-color:rgba(216,170,255,.72)!important;background:rgba(151,86,205,.18)!important;box-shadow:0 0 0 1px rgba(192,132,252,.18),0 5px 18px rgba(0,0,0,.18)!important}
.terry-h3-timeline-root .terry-tl-shot{opacity:.68;filter:saturate(.72);transition:background .12s ease,box-shadow .12s ease,opacity .12s ease,filter .12s ease,transform .12s ease}
.terry-h3-timeline-root .terry-tl-shot:hover{opacity:.9;filter:saturate(1)}
.terry-h3-timeline-root .terry-tl-shot.is-selected{opacity:1!important;filter:saturate(1.35) brightness(1.08)!important;background:linear-gradient(180deg,rgba(255,177,28,.55),rgba(215,116,4,.42))!important;box-shadow:inset 0 0 0 2px rgba(255,211,114,.88),0 0 16px rgba(245,158,11,.32)!important;color:#fff5dd!important;z-index:3}
.terry-h3-timeline-root .terry-tl-shot.is-selected b{font-weight:800!important;text-shadow:0 1px 2px rgba(0,0,0,.35)}
.terry-h3-timeline-root .terry-tl-section>.terry-tl-rich{max-height:190px!important;overflow-y:auto!important}
.terry-h3-timeline-root .terry-tl-card .terry-tl-rich{max-height:260px!important;overflow-y:auto!important;min-height:120px!important}
.terry-h3-timeline-root .terry-h3-media-chip img,.terry-h3-timeline-root .terry-h3-subject-asset-chip img{width:26px!important;height:26px!important;object-fit:cover;border-radius:3px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TimelineUxV2",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      const chip = event.target?.closest?.(".terry-h3-timeline-root .terry-tl-section .terry-tl-chip");
      const info = parseChip(chip);
      if (chip && info && info.type !== "subject") {
        const root = chip.closest(".terry-h3-timeline-root");
        const node = (app.graph?._nodes || []).find((n) => isTarget(n) && n.__terryH3ShotTimeline?.root === root);
        if (node) {
          event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation?.();
          openGlobalAssetMenu(node, chip); return;
        }
      }
      for (const node of app.graph?._nodes || []) {
        if (node?.__terryTimelineTypeMenu && !node.__terryTimelineTypeMenu.contains(event.target)) closeTypeMenu(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineUxV2Installed) return;
    nodeType.prototype.__terryTimelineUxV2Installed = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() { const result = old?.apply(this, arguments); installSoon(this); return result; };
    }
    const resized = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function() { const result = resized?.apply(this, arguments); installSoon(this); return result; };
  },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});

}
