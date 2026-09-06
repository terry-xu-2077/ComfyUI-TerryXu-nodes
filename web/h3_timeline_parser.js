import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuH3ShotTimeline";
const MAX_DURATION = 30;
const MIN_SHOT = 0.5;

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((v) => String(v || "") === NODE_ID);
}
function widget(node, name) { return node?.widgets?.find((w) => w?.name === name) || null; }
function isZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}
function t(zh, en) { return isZh() ? zh : en; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Number(v) || 0)); }

function normalizeSource(raw) {
  let source = String(raw || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[：]/g, ":")
    .replace(/[【［]/g, "[")
    .replace(/[】］]/g, "]")
    .replace(/[，]/g, ",")
    .replace(/[－–—～~]/g, "-")
    .replace(/\u00A0/g, " ")
    .trim();
  // AI-written prompts are often wrapped in one pair of decorative braces.
  if (source.startsWith("{") && source.endsWith("}")) source = source.slice(1, -1).trim();
  return source;
}

function parseClock(value) {
  const text = String(value || "").trim();
  let m = text.match(/^(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (m) {
    const frac = m[3] ? Number(`0.${String(m[3]).padEnd(3, "0")}`) : 0;
    return Number(m[1]) * 60 + Number(m[2]) + frac;
  }
  m = text.match(/^(\d+(?:\.\d+)?)\s*(?:s|sec|secs|second|seconds|秒)$/i);
  if (m) return Number(m[1]);
  m = text.match(/^(\d+(?:\.\d+)?)$/);
  return m ? Number(m[1]) : null;
}

function extractNamedSection(source, headerPattern, nextPattern = null) {
  const header = new RegExp(`(?:^|\\n)\\s*(?:${headerPattern})\\s*:\\s*`, "i");
  const match = header.exec(source);
  if (!match) return "";
  const start = match.index + match[0].length;
  const tail = source.slice(start);
  if (!nextPattern) return tail.trim();
  const stop = tail.search(new RegExp(`\\n\\s*(?:${nextPattern})\\s*:`, "i"));
  return (stop >= 0 ? tail.slice(0, stop) : tail).trim();
}

function extractSoundFields(source) {
  return {
    soundscape: extractNamedSection(source, "overall[ _-]*soundscape", "non[ _-]*diegetic[ _-]*music"),
    music: extractNamedSection(source, "non[ _-]*diegetic[ _-]*music"),
  };
}

function splitPrompt(source) {
  // Loose Chinese AI screenplay format: everything before [分镜脚本] is Global description.
  // [分镜脚本] / [Storyboard] is a semantic alias for H3 detailed_description.
  const looseHeader = /(?:^|\n)\s*\[(?:分镜脚本|分镜|镜头脚本|shot\s*list|storyboard)\]\s*/i;
  const loose = looseHeader.exec(source);
  if (loose) {
    const global = source.slice(0, loose.index).trim();
    const tail = source.slice(loose.index + loose[0].length);
    const stop = tail.search(/\n\s*(?:overall[ _-]*soundscape|non[ _-]*diegetic[ _-]*music)\s*:/i);
    return { global, body: (stop >= 0 ? tail.slice(0, stop) : tail).trim(), mode: "structured" };
  }

  // Official H3: keep pre-detailed sections too, because this node's Global description
  // is also the source for Subject definitions used by Shot @ mentions.
  const detailedHeader = /(?:^|\n)\s*detailed[ _-]*description\s*:\s*/i;
  const detailed = detailedHeader.exec(source);
  if (detailed) {
    const prefix = source.slice(0, detailed.index).trim();
    const tail = source.slice(detailed.index + detailed[0].length);
    const stop = tail.search(/\n\s*(?:overall[ _-]*soundscape|non[ _-]*diegetic[ _-]*music)\s*:/i);
    const body = (stop >= 0 ? tail.slice(0, stop) : tail).trim();
    const headers = shotHeaders(body);
    const intro = headers.length ? body.slice(0, headers[0].start).trim() : body;
    const global = [prefix, intro].filter(Boolean).join("\n\n");
    return { global, body: headers.length ? body.slice(headers[0].start) : body, mode: "official" };
  }

  return { global: "", body: source, mode: "freeform" };
}

function shotHeaders(body) {
  // Line-oriented on purpose: avoids treating phrases like "镜头 1 中..." inside prose as a new shot.
  // Supports [Shot 1] text, Shot-1: text, 镜头 1：标题, 【镜头1】标题.
  const re = /^[ \t]*(?:\[\s*(?:shot|镜头)\s*[-_ ]*(\d+)\s*\]|(?:shot|镜头)\s*[-_ ]*(\d+)\s*:?)\s*(.*)$/gim;
  const out = [];
  for (const m of body.matchAll(re)) {
    out.push({
      number: Number(m[1] || m[2] || out.length + 1),
      start: m.index || 0,
      afterLine: (m.index || 0) + m[0].length,
      tail: String(m[3] || "").trim().replace(/^[:\-\s]+/, ""),
    });
  }
  return out;
}

function consumeTiming(text) {
  let body = String(text || "").trim();
  let start = null;
  let end = null;
  let usedRange = false;

  // Chinese/AI screenplay range: 时间：00:00 - 00:04 / 时间: 0s-4s / Time: ...
  const rangeRe = /^\s*(?:时间|time|timing)\s*:\s*(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?|\d+(?:\.\d+)?\s*(?:s|sec|seconds?|秒)?)\s*(?:-|至|到)\s*(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?|\d+(?:\.\d+)?\s*(?:s|sec|seconds?|秒)?)\s*$/im;
  const range = body.match(rangeRe);
  if (range) {
    start = parseClock(range[1]);
    end = parseClock(range[2]);
    usedRange = start != null && end != null && end > start;
    body = body.replace(range[0], "").trim();
  }

  // Official H3 leading time: At 00:03.000, ...
  if (start == null) {
    const patterns = [
      /^at\s+(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\s*,?\s*/i,
      /^(\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?)\s*,\s*/,
      /^at\s+(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?)\s*,?\s*/i,
      /^从\s*(\d+(?:\.\d+)?)\s*秒\s*,?\s*/,
    ];
    for (const re of patterns) {
      const m = body.match(re);
      if (!m) continue;
      start = parseClock(m[1]);
      body = body.slice(m[0].length).trim();
      break;
    }
  }

  // Some AI prompts provide only "时长: 4秒". Keep it as an end hint later.
  let duration = null;
  const durationRe = /^\s*(?:时长|duration)\s*:\s*(\d+(?:\.\d+)?)\s*(?:s|sec|seconds?|秒)\s*$/im;
  const durationMatch = body.match(durationRe);
  if (durationMatch) {
    duration = Number(durationMatch[1]);
    body = body.replace(durationMatch[0], "").trim();
  }

  return { start, end, duration, text: body, usedRange };
}

function parseH3(raw, fallbackTotal = 15) {
  const source = normalizeSource(raw);
  if (!source) throw new Error(t("请先粘贴提示词。", "Paste a prompt first."));

  const { soundscape, music } = extractSoundFields(source);
  const split = splitPrompt(source);
  const headers = shotHeaders(split.body);
  if (!headers.length) throw new Error(t("没有识别到 Shot / 镜头标题。至少需要一个镜头。", "No Shot / 镜头 headings were found. At least one shot is required."));

  // If there was no explicit section splitter, everything before the first shot becomes Global.
  // For structured AI prompts, [分镜脚本]/[Storyboard] is consumed as the boundary and
  // the core timeline compiler emits the canonical `detailed_description:` field.
  const leading = split.body.slice(0, headers[0].start).trim();
  const global = [split.global, leading].filter(Boolean).join("\n\n");

  const shots = [];
  const starts = [];
  const ends = [];
  const durations = [];
  let rangeCount = 0;

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    const endAt = i + 1 < headers.length ? headers[i + 1].start : split.body.length;
    const rest = split.body.slice(h.afterLine, endAt).trim();
    const combined = [h.tail, rest].filter(Boolean).join("\n").trim();
    const timing = consumeTiming(combined);
    if (timing.usedRange) rangeCount += 1;
    shots.push({ text: timing.text, duration: 0 });
    starts.push(timing.start);
    ends.push(timing.end);
    durations.push(timing.duration);
  }

  let warnings = 0;
  // Shot 1 is always timeline zero. Preserve its written range only as a consistency check.
  if (starts[0] != null && Math.abs(starts[0]) > 0.001) warnings += 1;
  starts[0] = 0;

  const explicitEnds = ends.filter((x) => x != null && Number.isFinite(x));
  const explicitStarts = starts.filter((x) => x != null && Number.isFinite(x));
  let total;
  if (explicitEnds.length) total = Math.max(...explicitEnds);
  else {
    const maxStart = explicitStarts.length ? Math.max(...explicitStarts) : 0;
    total = Math.max(Number(fallbackTotal) || 15, maxStart + MIN_SHOT);
  }
  total = clamp(total, Math.max(1, shots.length * MIN_SHOT), MAX_DURATION);

  // Convert duration-only hints into end hints when their starts are already known.
  for (let i = 0; i < shots.length; i++) {
    if (ends[i] == null && durations[i] != null && starts[i] != null) ends[i] = starts[i] + durations[i];
  }

  // Validate explicit start anchors. Bad anchors become holes and are repaired below.
  let lastKnown = 0;
  for (let i = 1; i < starts.length; i++) {
    const value = starts[i];
    if (value == null || !Number.isFinite(value) || value <= lastKnown || value >= total) {
      if (value != null) warnings += 1;
      starts[i] = null;
    } else {
      lastKnown = value;
    }
  }

  // Where an AI range says 00:00-00:05 but the next shot says 00:06, this timeline
  // has no gap object. Preserve the next Shot's start and absorb the gap into the prior Shot.
  for (let i = 0; i < shots.length - 1; i++) {
    if (ends[i] != null && starts[i + 1] != null && Math.abs(ends[i] - starts[i + 1]) > 0.05) warnings += 1;
  }

  // Fill missing starts between known anchors by even distribution.
  let anchor = 0;
  while (anchor < shots.length) {
    let next = anchor + 1;
    while (next < shots.length && starts[next] == null) next += 1;
    const a = starts[anchor] ?? 0;
    const b = next < shots.length ? starts[next] : total;
    const slots = next - anchor;
    if (slots > 0) {
      const available = Math.max(MIN_SHOT * slots, b - a);
      const step = available / slots;
      for (let j = anchor + 1; j < next; j++) starts[j] = Math.min(total - MIN_SHOT, a + step * (j - anchor));
    }
    if (next >= shots.length) break;
    anchor = next;
  }

  // Build contiguous durations from starts. Last Shot prefers its explicit end.
  for (let i = 0; i < shots.length; i++) {
    const a = starts[i] ?? 0;
    let b;
    if (i + 1 < shots.length) b = starts[i + 1] ?? total;
    else b = ends[i] != null && ends[i] > a ? Math.min(total, ends[i]) : total;
    shots[i].duration = Math.max(MIN_SHOT, b - a);
  }

  // Keep exact total even after tolerance repairs.
  const sum = shots.reduce((acc, shot) => acc + shot.duration, 0);
  if (sum > 0 && Math.abs(sum - total) > 0.001) {
    const delta = total - sum;
    shots[shots.length - 1].duration = Math.max(MIN_SHOT, shots[shots.length - 1].duration + delta);
  }

  return {
    total,
    global,
    shots,
    selected: 0,
    soundEnabled: Boolean(soundscape),
    soundscape,
    musicEnabled: Boolean(music),
    music,
    meta: { warnings, mode: split.mode, rangeCount },
  };
}

function currentTotal(node) {
  try {
    const state = JSON.parse(String(widget(node, "timeline_state")?.value || "{}"));
    if (state?.total) return clamp(state.total, 1, MAX_DURATION);
  } catch {}
  return clamp(widget(node, "duration")?.value || 15, 1, MAX_DURATION) || 15;
}

function applyParsed(node, state) {
  const stateWidget = widget(node, "timeline_state");
  const durationWidget = widget(node, "duration");
  if (!stateWidget) throw new Error(t("找不到时间轴状态输入。", "Timeline state input was not found."));
  const packed = JSON.stringify(state);
  stateWidget.value = packed;
  stateWidget.callback?.(packed);
  if (durationWidget) {
    durationWidget.value = Math.round(state.total);
    durationWidget.callback?.(durationWidget.value);
  }
  node.__terryH3ShotTimeline?.refresh?.();
  node.__terryH3ShotTimeline?.save?.();
  node.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function closeDialog(dialog) { dialog?.remove?.(); }

function openParser(node) {
  document.querySelector(".terry-tl-parser-overlay")?.remove?.();
  const overlay = document.createElement("div"); overlay.className = "terry-tl-parser-overlay";
  const panel = document.createElement("div"); panel.className = "terry-tl-parser-panel";
  const head = document.createElement("div"); head.className = "terry-tl-parser-head";
  const title = document.createElement("b"); title.textContent = t("解析 / 还原提示词", "Parse / Restore Prompt");
  const close = document.createElement("button"); close.type = "button"; close.textContent = "×"; close.title = t("关闭", "Close");
  close.addEventListener("click", () => closeDialog(overlay)); head.append(title, close);

  const hint = document.createElement("div"); hint.className = "terry-tl-parser-hint";
  hint.textContent = t(
    "支持官方 H3，也支持常见 AI 分镜格式，例如 [全局参考] / [导演说明] / [视觉基调] / [分镜脚本]、镜头 1：标题、时间：00:00 - 00:04。[分镜脚本] 会作为 detailed_description 的分界进行转换。标题名称和空格可以变化；无法精确对应的时间间隙会自动吸收到相邻镜头。",
    "Supports official H3 and common AI screenplay formats such as [Global Reference] / [Director Notes] / [Storyboard], 镜头 1: title, and 时间: 00:00 - 00:04. [Storyboard] is treated as the detailed_description boundary. Section names and spacing may vary; unsupported gaps are absorbed into adjacent shots."
  );
  const textarea = document.createElement("textarea"); textarea.className = "terry-tl-parser-text";
  textarea.placeholder = t("粘贴官方 H3 或 AI 编写的分镜提示词…", "Paste official H3 or an AI-written storyboard prompt…"); textarea.spellcheck = false;
  const status = document.createElement("div"); status.className = "terry-tl-parser-status";
  const actions = document.createElement("div"); actions.className = "terry-tl-parser-actions";
  const cancel = document.createElement("button"); cancel.type = "button"; cancel.textContent = t("取消", "Cancel"); cancel.addEventListener("click", () => closeDialog(overlay));
  const parse = document.createElement("button"); parse.type = "button"; parse.className = "is-primary"; parse.textContent = t("解析并还原", "Parse & Restore");
  parse.addEventListener("click", () => {
    try {
      const state = parseH3(textarea.value, currentTotal(node));
      applyParsed(node, state);
      const mode = state.meta.mode === "structured" ? t("AI 分镜格式", "AI storyboard format") : state.meta.mode === "official" ? "H3" : t("宽松格式", "loose format");
      const warningText = state.meta.warnings ? t(` · ${state.meta.warnings} 处已容错修复`, ` · ${state.meta.warnings} tolerance repairs`) : "";
      status.className = "terry-tl-parser-status is-ok";
      status.textContent = t(
        `识别为 ${mode} · 已还原 ${state.shots.length} 个镜头 · ${state.total.toFixed(1)}s${warningText}`,
        `Detected ${mode} · restored ${state.shots.length} shots · ${state.total.toFixed(1)}s${warningText}`
      );
      setTimeout(() => closeDialog(overlay), 650);
    } catch (err) {
      status.className = "terry-tl-parser-status is-error";
      status.textContent = String(err?.message || err || t("解析失败", "Parse failed"));
    }
  });
  actions.append(cancel, parse); panel.append(head, hint, textarea, status, actions); overlay.append(panel);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) closeDialog(overlay); });
  document.body.append(overlay); setTimeout(() => textarea.focus(), 0);
}

function installButton(node) {
  if (!isTarget(node)) return;
  const root = node.__terryH3ShotTimeline?.root || node.__terryH3ShotTimelineRoot;
  let host = root?.querySelector?.(".terry-tl-header") || null;
  if (!host) {
    for (const candidate of document.querySelectorAll(".terry-h3-timeline-root")) {
      if (candidate.isConnected) { host = candidate.querySelector(".terry-tl-header"); if (host) break; }
    }
  }
  if (!host || host.querySelector(".terry-tl-parse-button")) return;
  const button = document.createElement("button"); button.type = "button"; button.className = "terry-tl-parse-button";
  button.textContent = t("解析", "Parse"); button.title = t("粘贴提示词并还原时间轴", "Paste a prompt and restore the timeline");
  button.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); openParser(node); });
  host.insertBefore(button, host.children[1] || null);
}

function installStyle() {
  if (document.getElementById("terry-h3-timeline-parser-style")) return;
  const style = document.createElement("style"); style.id = "terry-h3-timeline-parser-style";
  style.textContent = `
.terry-tl-parse-button{height:24px;padding:0 9px;border:1px solid rgba(255,255,255,.14);border-radius:5px;background:rgba(255,255,255,.07);color:inherit;cursor:pointer;font-size:10px;white-space:nowrap}.terry-tl-parse-button:hover{background:rgba(255,255,255,.12)}
.terry-tl-parser-overlay{position:fixed;inset:0;z-index:12050;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.52)}
.terry-tl-parser-panel{width:min(760px,calc(100vw - 48px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;box-sizing:border-box;padding:12px;border:1px solid rgba(255,255,255,.16);border-radius:10px;background:var(--comfy-menu-bg,#202225);color:var(--input-text,#ddd);box-shadow:0 20px 60px rgba(0,0,0,.55);font-family:Inter,system-ui,sans-serif}
.terry-tl-parser-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}.terry-tl-parser-head b{font-size:13px}.terry-tl-parser-head button{width:28px;height:28px;border:0;border-radius:5px;background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:17px}
.terry-tl-parser-hint{margin-bottom:8px;font-size:10px;line-height:1.5;opacity:.58}.terry-tl-parser-text{width:100%;min-height:320px;resize:vertical;box-sizing:border-box;padding:9px 10px;border:1px solid rgba(255,255,255,.12);border-radius:7px;background:rgba(0,0,0,.20);color:inherit;outline:none;font:11px/1.5 ui-monospace,Consolas,monospace}
.terry-tl-parser-status{min-height:18px;padding-top:6px;font-size:10px;opacity:.72}.terry-tl-parser-status.is-error{color:#ff8e8e;opacity:1}.terry-tl-parser-status.is-ok{color:#8fe3b0;opacity:1}.terry-tl-parser-actions{display:flex;justify-content:flex-end;gap:7px;margin-top:5px}.terry-tl-parser-actions button{height:29px;padding:0 12px;border:1px solid rgba(255,255,255,.13);border-radius:6px;background:rgba(255,255,255,.06);color:inherit;cursor:pointer;font-size:10px}.terry-tl-parser-actions button.is-primary{background:rgba(255,255,255,.14);font-weight:600}`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TimelineParser",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryTimelineParserInstalled) return;
    nodeType.prototype.__terryTimelineParserInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        for (const delay of [0, 60, 180, 500]) setTimeout(() => installButton(this), delay);
        return result;
      };
    }
  },
  loadedGraphNode(node) {
    if (!isTarget(node)) return;
    for (const delay of [0, 100, 350]) setTimeout(() => installButton(node), delay);
  },
});
