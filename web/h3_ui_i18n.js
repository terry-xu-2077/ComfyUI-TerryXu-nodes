import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuH3PromptEditor";

function isZh() {
  try {
    if (typeof globalThis.__terryH3IsZh === "function") return Boolean(globalThis.__terryH3IsZh());
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(value || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

const EN = new Map([
  ["引用角色", "Reference Role"],
  ["同一资产可以有不同 H3 角色", "One asset can serve different H3 roles"],
  ["主体 · 内容", "Subject · Content"],
  ["画面 · 图片", "Picture · Frame"],
  ["Subject · 内容", "Subject · Content"],
  ["Picture · 画面", "Picture · Frame"],
  ["从视频中抽取人物、物体、场景、动作、表情或风格，作为后续镜头可复用的内容单元。", "Extract a person, object, scene, action, expression, or style from the video as reusable content."],
  ["从图片中抽取人物、物体、场景、服装、风格、动作或姿态，作为后续镜头可复用的内容单元。", "Extract a person, object, scene, outfit, style, action, or pose from the image as reusable content."],
  ["直接引用这张图片本身：适合首帧、尾帧、关键帧、构图锚点或分镜规划。", "Reference the image itself for first/last frames, keyframes, composition anchors, or storyboard planning."],
  ["引用整段视频本身：适合视频编辑、续写、镜头运动、剪辑节奏或时间结构。", "Reference the whole video for editing, continuation, camera motion, pacing, or timing structure."],
  ["引用独立音频信号：适合完整/部分复用，或参考音色、节奏、对白、音乐与声音质感。", "Reference an audio signal for full/partial reuse or for voice, rhythm, dialogue, music, and sound texture."],
  ["H3 语法", "H3 Syntax"], ["搜索 H3 语法", "Search H3 Syntax"],
  ["结构", "Structure"], ["镜头", "Shot"], ["对白", "Dialogue"], ["保留关系", "Retention"],
  ["任务类型", "Task Type"], ["镜头运动", "Camera Motion"],
  ["H3 主字段与段落", "H3 fields and sections"],
  ["Shot、时间戳与说话人", "Shots, timestamps, and speakers"],
  ["可编辑对白块与连续性", "Editable dialogue blocks and continuity"],
  ["视觉与音频引用关系", "Visual and audio reference relationships"],
  ["Summary 的任务类型前缀", "Task type prefixes for Summary"],
  ["Camera motion 常用表达", "Common camera motion phrases"],
  ["选择分类 · 也可继续输入关键词", "Choose a category · or keep typing to search"],
  ["← 返回 · ↑↓ 选择", "← Back · ↑↓ Select"],
  ["没有匹配的 H3 语法", "No matching H3 syntax"],
  ["对白块", "Dialogue Block"], ["语言下拉 + 可直接编辑正文，输出 <d>[Language] ...</d>", "Language dropdown + editable text, outputs <d>[Language] ...</d>"],
  ["对白或音频跨镜头连续", "Dialogue or audio continues across shots"],
  ["对白被视频结尾截断", "Dialogue is cut off by the end of the video"],
  ["时间戳", "Timestamp"], ["插入 MM:SS.mmm 占位", "Insert an MM:SS.mmm placeholder"],
  ["切换镜头序号", "Change Shot Number"], ["切换说话人序号", "Change Speaker Number"], ["应用", "Apply"],
  ["没有可用的兼容资产", "No compatible assets available"],
  ["仅显示图片 / 视频", "Showing images / videos only"],
  ["输入对白…", "Enter dialogue…"],
]);

const ZH = new Map([
  ["Reference Role", "引用角色"],
  ["One asset can serve different H3 roles", "同一资产可以有不同 H3 角色"],
  ["Subject · Content", "主体 · 内容"],
  ["Picture · Frame", "画面 · 图片"],
  ["Subject · 内容", "主体 · 内容"],
  ["Picture · 画面", "画面 · 图片"],
  ["+ Subject", "+ 主体"],
  ["+ New Subject", "+ 新主体"],
  ["+ 新 Subject", "+ 新主体"],
]);

function translateString(text) {
  const raw = String(text || "");
  if (!raw) return raw;

  if (isZh()) {
    if (ZH.has(raw)) return ZH.get(raw);
    let m = raw.match(/^Subject\s*(\d+)$/i);
    if (m) return `主体 ${m[1]}`;
    m = raw.match(/^Picture\s*(\d+)$/i);
    if (m) return `图片 ${m[1]}`;
    m = raw.match(/^Video\s*(\d+)$/i);
    if (m) return `视频 ${m[1]}`;
    m = raw.match(/^Audio\s*(\d+)$/i);
    if (m) return `音频 ${m[1]}`;
    m = raw.match(/^图片资产\s*·\s*Picture\s*(\d+)$/i);
    if (m) return `图片资产 · 图片 ${m[1]}`;
    m = raw.match(/^视频资产\s*·\s*Video\s*(\d+)$/i);
    if (m) return `视频资产 · 视频 ${m[1]}`;
    m = raw.match(/^音频资产\s*·\s*Audio\s*(\d+)$/i);
    if (m) return `音频资产 · 音频 ${m[1]}`;
    return raw;
  }

  if (EN.has(raw)) return EN.get(raw);
  let m = raw.match(/^参考：图片\s*(\d+)\s*·\s*视频\s*(\d+)\s*·\s*音频\s*(\d+)$/);
  if (m) return `References: Images ${m[1]} · Videos ${m[2]} · Audio ${m[3]}`;
  m = raw.match(/^图片资产\s*·\s*(?:Picture|图片)\s*(\d+)$/i);
  if (m) return `Image asset · Picture ${m[1]}`;
  m = raw.match(/^视频资产\s*·\s*(?:Video|视频)\s*(\d+)$/i);
  if (m) return `Video asset · Video ${m[1]}`;
  m = raw.match(/^音频资产\s*·\s*(?:Audio|音频)\s*(\d+)$/i);
  if (m) return `Audio asset · Audio ${m[1]}`;
  m = raw.match(/^Subject\s*(\d+)\s*·\s*切换来源资产$/i);
  if (m) return `Subject ${m[1]} · Change Source Asset`;
  m = raw.match(/^(.+?)\s*·\s*切换资产$/);
  if (m) return `${m[1]} · Change Asset`;
  m = raw.match(/^仅显示\s*(图片|视频|音频)$/);
  if (m) return `Showing ${m[1] === "图片" ? "images" : m[1] === "视频" ? "videos" : "audio"} only`;
  m = raw.match(/^说话人\s*S(\d+)$/i);
  if (m) return `Speaker S${m[1]}`;
  m = raw.match(/^镜头\s*(\d+)$/);
  if (m) return `Shot ${m[1]}`;
  return raw;
}

function translateElement(el) {
  if (!el) return;
  if (el.nodeType === Node.TEXT_NODE) {
    const next = translateString(el.nodeValue);
    if (next !== el.nodeValue) el.nodeValue = next;
    return;
  }
  if (el.nodeType !== Node.ELEMENT_NODE) return;
  if (!isZh() && el.matches?.(".terry-h3-dialogue-text") && el.dataset?.placeholder === "输入对白…") el.dataset.placeholder = "Enter dialogue…";
  if (!isZh() && el.matches?.(".terry-h3-editor")) {
    const p = el.dataset.placeholder;
    if (p?.includes("粘贴 MiniMax H3")) el.dataset.placeholder = "Paste a MiniMax H3 prompt; @ references assets; / inserts H3 syntax…";
  }
  if (el.title) {
    const next = translateString(el.title);
    if (next !== el.title) el.title = next;
  }
  if (el.childNodes?.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE) {
    const next = translateString(el.textContent);
    if (next !== el.textContent) el.textContent = next;
  } else {
    for (const child of el.childNodes || []) translateElement(child);
  }
}

function localizeNode(node) {
  if (!isTarget(node)) return;
  if (isZh()) return;
  for (const input of node.inputs || []) {
    if (String(input?.name || "") === "media") {
      input.label = "References · Multi-input";
      input.localized_name = "References · Multi-input";
    }
  }
  for (const w of node.widgets || []) {
    if (w?.name === "visual_preview") {
      w.label = "Visual Preview";
      w.localized_name = "Visual Preview";
      w.options ||= {};
      w.options.tooltip = "On: visual H3 tags. Off: raw H3 text.";
    }
    if (w?.name === "prompt") {
      w.label = "H3 Source";
      w.localized_name = "H3 Source";
    }
  }
  if (node.__terryH3Editor) translateElement(node.__terryH3Editor);
}

function sweep() {
  for (const node of app.graph?._nodes || []) localizeNode(node);
  for (const selector of [
    ".terry-h3-role-menu", ".terry-h3-command-menu", ".terry-h3-rebind-menu",
    ".terry-h3-shot-picker", ".terry-h3-mention", ".terry-h3-editor", ".terry-h3-wrap"
  ]) {
    for (const el of document.querySelectorAll(selector)) translateElement(el);
  }
}

let queued = false;
function queueSweep() {
  if (queued) return;
  queued = true;
  queueMicrotask(() => { queued = false; sweep(); });
}

app.registerExtension({
  name: "TerryXu.H3UiI18n",
  setup() {
    for (const delay of [0, 100, 400, 1000]) setTimeout(sweep, delay);
    const observer = new MutationObserver(queueSweep);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3I18nInstalled) return;
    nodeType.prototype.__terryH3I18nInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        setTimeout(() => localizeNode(this), 0);
        return result;
      };
    }
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      localizeNode(this);
      return result;
    };
  },
  loadedGraphNode(node) { setTimeout(() => localizeNode(node), 0); },
});
