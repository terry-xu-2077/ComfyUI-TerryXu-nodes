import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { attachH3Menus } from "./h3_shared_menus.js";
import {
  bindH3TagInteractions,
  insertH3RichTextAtSelection,
  installH3RichTextStyles,
  renderH3RawText,
  renderH3RichText,
  serializeH3RichText,
} from "./h3_rich_text.js";

const NODE_ID = "TerryXuH3PromptEditor";
const LINKS_PROP = "terry_h3_virtual_media_links";
const VIEW_PROP = "terry_h3_view_mode";
const MAX_MEDIA = 32;
const BUS_TYPE = "TERRY_WIRE_BUS";

function isTarget(node) {
  if (!node) return false;
  return [
    node.comfyClass,
    node.type,
    node.constructor?.type,
    node.constructor?.comfyClass,
    node.constructor?.nodeData?.name,
  ].some((value) => String(value || "") === NODE_ID);
}

function getWidget(node, name) {
  return node?.widgets?.find?.((widget) => String(widget?.name || "") === name) || null;
}

function promptTextarea(widget) {
  if (!widget || typeof HTMLTextAreaElement === "undefined") return null;
  if (widget.element instanceof HTMLTextAreaElement) return widget.element;
  if (widget.inputEl instanceof HTMLTextAreaElement) return widget.inputEl;
  return widget.element?.querySelector?.("textarea")
    || widget.inputEl?.querySelector?.("textarea")
    || null;
}

function prepareCanonicalPromptWidget(widget) {
  if (!widget) return;
  // prompt remains the one and only official ComfyUI value widget. H3 merely
  // overlays its rich editor onto the textarea's DOM host.
  if (widget.type === "hidden") widget.type = "customtext";
  widget.hidden = false;
  widget.options ||= {};
  delete widget.options.hidden;
  delete widget.options.canvasOnly;
  if (widget._state?.options) {
    delete widget._state.options.hidden;
    delete widget._state.options.canvasOnly;
  }
  widget.options.minNodeSize = [400, 280];
  widget.__terryH3CanonicalPromptWidget = true;
}

function allGraphs(root = app.graph?.rootGraph || app.graph) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    result.push(graph);
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (node?.subgraph && !seen.has(node.subgraph)) queue.push(node.subgraph);
    }
  }
  return result;
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

function sourceType(node, slot = 0, fallback = "") {
  const raw = String(node?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (raw.includes("IMAGE")) return "picture";
  if (raw.includes("VIDEO")) return "video";
  if (raw.includes("AUDIO")) return "audio";
  const name = String(node?.comfyClass || node?.type || "").toLowerCase();
  if (name.includes("video")) return "video";
  if (name.includes("audio")) return "audio";
  return "picture";
}

function resolveVirtualMediaSource(source, sourceSlot = 0, fallbackType = "") {
  let node = source;
  let slot = Number(sourceSlot) || 0;
  try {
    const resolved = source?.resolveVirtualOutput?.(slot);
    if (resolved?.node) {
      node = resolved.node;
      slot = Number(resolved.slot) || 0;
    }
  } catch {}
  return { node, slot, type: String(node?.outputs?.[slot]?.type || fallbackType || "*") };
}

function normalizeLinks(node) {
  const graph = node?.graph || app.graph;
  const seen = new Set();
  const out = [];
  for (const link of ensureLinks(node)) {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id) || id === Number(node.id)) continue;
    const src = graph?.getNodeById?.(id);
    // BUS media may resolve from an ancestor graph. The native BUS module owns
    // that mapping, so keep its descriptor even when this local graph cannot.
    if (!src && String(link?.source_type || "").toUpperCase() !== BUS_TYPE) continue;
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      source_id: id,
      source_slot: slot,
      source_type: String(src?.outputs?.[slot]?.type || link?.source_type || "*"),
      kind: link?.kind || sourceType(src, slot, link?.source_type),
    });
  }
  node.properties[LINKS_PROP] = out.slice(0, MAX_MEDIA);
  return node.properties[LINKS_PROP];
}

function directLinksForDrawing(node) {
  // BUS is a real structural link. Expanded BUS media is useful for H3 tags and
  // execution, but must never be redrawn as fake source→H3 direct wires.
  try {
    const direct = node?.__terryNativeBus?.getDirectLinks?.();
    if (Array.isArray(direct)) return direct;
  } catch {}
  return normalizeLinks(node);
}

function addVirtualLink(node, source, sourceSlot = 0, sourceTypeValue = "") {
  if (!node || !source || Number(source.id) === Number(node.id)) return false;
  const links = normalizeLinks(node);
  if (links.length >= MAX_MEDIA) return false;
  if (links.some((item) => Number(item.source_id) === Number(source.id) && Number(item.source_slot) === Number(sourceSlot))) return false;
  links.push({
    source_id: Number(source.id),
    source_slot: Number(sourceSlot) || 0,
    source_type: String(sourceTypeValue || source.outputs?.[sourceSlot]?.type || "*"),
    kind: sourceType(source, sourceSlot, sourceTypeValue),
  });
  node.properties[LINKS_PROP] = links;
  watchSourceNode(source);
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  node.graph?.change?.();
  refreshEditorsSoon();
  return true;
}

function getMediaInputIndex(node) {
  return node?.inputs?.findIndex?.((input) => String(input?.name || "") === "media") ?? -1;
}

function isSubgraphInputBoundaryNode(node) {
  if (!node) return false;
  try {
    if (node.isSubgraphInputNode?.()) return true;
  } catch {}
  const type = String(
    node.comfyClass || node.type || node.constructor?.type || node.constructor?.name || ""
  ).toLowerCase();
  return type.includes("subgraphinput") || type.includes("subgraph input");
}

function ensureSingleMediaInput(node) {
  if (!node) return;
  node.inputs ||= [];
  for (let index = node.inputs.length - 1; index >= 0; index--) {
    const name = String(node.inputs[index]?.name || "");
    if (!/^asset\d*$/i.test(name) && !/^assets$/i.test(name)) continue;
    try { if (node.inputs[index]?.link != null) node.disconnectInput?.(index); } catch {}
    if (typeof node.removeInput === "function") node.removeInput(index);
    else node.inputs.splice(index, 1);
  }
  if (getMediaInputIndex(node) < 0) {
    if (typeof node.addInput === "function") node.addInput("media", "*");
    else node.inputs.unshift({ name: "media", type: "*", link: null });
  }
  const input = node.inputs[getMediaInputIndex(node)];
  if (input) {
    input.name = "media";
    input.type = "*";
    input.label = "参考 · 多路输入";
    input.localized_name = "参考 · 多路输入";
  }
  node._widgetSlotsDirty = true;
}

function convertNativeMediaConnection(node, inputIndex, info = null) {
  if (!isTarget(node) || node.__terryClearingLink) return false;
  const input = node.inputs?.[inputIndex];
  if (String(input?.name || "") !== "media") return false;
  const graph = node.graph || app.graph;
  const native = graphLink(graph, input?.link) || info;
  if (!native) return false;
  const sourceId = native.origin_id ?? native.originId ?? native.from_id ?? native.fromId;
  const src = native.origin_node || native.originNode || native.fromNode || graph?.getNodeById?.(Number(sourceId));
  if (!src) return false;
  const rawSlot = native.origin_slot ?? native.originSlot ?? native.from_slot ?? native.fromSlot ?? 0;
  const slot = Number(rawSlot) || 0;
  const nativeType = String(native.type || src.outputs?.[slot]?.type || "").toUpperCase();

  // BUS and SubgraphInput are structural links and must remain physical.
  if (nativeType === BUS_TYPE || isSubgraphInputBoundaryNode(src)) return false;

  const added = addVirtualLink(node, src, slot, native.type || src.outputs?.[slot]?.type || "*");
  node.__terryClearingLink = true;
  try {
    if (node.inputs?.[inputIndex]?.link != null) node.disconnectInput?.(inputIndex);
  } finally {
    node.__terryClearingLink = false;
  }
  return added;
}

function connectionPos(node, input, slotIndex) {
  const modern = input ? node?.getInputPos?.(slotIndex) : node?.getOutputPos?.(slotIndex);
  if (Array.isArray(modern) && Number.isFinite(modern[0])) return modern;
  const out = [0, 0];
  try {
    const legacy = node?.getConnectionPos?.(input, slotIndex, out);
    if (Array.isArray(legacy)) return legacy;
  } catch {}
  return input
    ? [Number(node?.pos?.[0] || 0), Number(node?.pos?.[1] || 0) + 40 + slotIndex * 20]
    : [Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 200), Number(node?.pos?.[1] || 0) + 40 + slotIndex * 20];
}

function drawVirtualLinks(canvas, ctx) {
  if (!ctx) return;
  for (const target of canvas?.graph?._nodes || app.graph?._nodes || []) {
    if (!isTarget(target)) continue;
    const inputIndex = getMediaInputIndex(target);
    if (inputIndex < 0) continue;
    const end = connectionPos(target, true, inputIndex);
    for (const link of directLinksForDrawing(target)) {
      const src = target.graph?.getNodeById?.(Number(link.source_id)) || app.graph?.getNodeById?.(Number(link.source_id));
      if (!src) continue;
      const start = connectionPos(src, false, Number(link.source_slot) || 0);
      const colors = globalThis.LGraphCanvas?.link_type_colors || {};
      const type = String(link.source_type || "");
      const color = colors[type] || colors[type.toUpperCase()] || globalThis.LiteGraph?.LINK_COLOR || "#9A9";
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(start[0], start[1]);
      ctx.bezierCurveTo(start[0] + 80, start[1], end[0] - 80, end[1], end[0], end[1]);
      ctx.strokeStyle = color;
      ctx.lineWidth = canvas?.connections_width || 3;
      ctx.stroke();
      ctx.restore();
    }
  }
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || canvas.__terryH3CanvasPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryH3CanvasPatched = true;
  const previous = canvas.drawConnections;
  canvas.drawConnections = function(ctx) {
    const result = previous.apply(this, arguments);
    drawVirtualLinks(this, ctx || this.bgctx || this.ctx);
    return result;
  };
}

function patchGraphToPrompt() {
  if (app.__terryH3GraphToPromptPatched || typeof app.graphToPrompt !== "function") return;
  app.__terryH3GraphToPromptPatched = true;
  const previous = app.graphToPrompt;
  app.graphToPrompt = async function() {
    const data = await previous.apply(this, arguments);
    const output = data?.output || {};
    for (const node of app.graph?._nodes || []) {
      if (!isTarget(node)) continue;
      syncFromEditor(node, false);
      const dst = output[String(node.id)];
      if (!dst) continue;
      dst.inputs ||= {};
      delete dst.inputs.media;
      for (const key of Object.keys(dst.inputs)) if (/^asset\d+$/i.test(key)) delete dst.inputs[key];
      let assetIndex = 0;
      for (const link of normalizeLinks(node)) {
        const displaySource = app.graph?.getNodeById?.(Number(link.source_id));
        const resolved = resolveVirtualMediaSource(displaySource, link.source_slot, link.source_type);
        const executionSource = resolved.node || displaySource;
        const executionId = Number(executionSource?.id);
        if (!executionSource || !Number.isFinite(executionId) || !output[String(executionId)]) continue;
        assetIndex += 1;
        dst.inputs[`asset${assetIndex}`] = [String(executionId), Number(resolved.slot) || 0];
      }
    }
    return data;
  };
}

function filenameFromSource(node, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename"]
      : ["audio", "file", "filename"];
  const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
  const ordered = [
    ...widgets.filter((widget) => preferred.includes(String(widget?.name || "").toLowerCase())),
    ...widgets,
  ];
  for (const widget of ordered) {
    const value = widget?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name) : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    if (
      preferred.includes(String(widget?.name || "").toLowerCase())
      || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))
    ) return String(file);
  }
  return "";
}

function previewFromSource(node, kind) {
  if (!node || kind === "audio") return "";
  const filename = filenameFromSource(node, kind);
  if (filename) {
    const widget = (node.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = widget?.value;
    const query = new URLSearchParams({
      filename,
      type: typeof value === "object" ? String(value.type || "input") : "input",
    });
    if (typeof value === "object" && value.subfolder) query.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${query.toString()}`);
  }
  const image = (node.imgs || []).find((item) => item?.src);
  if (image?.src) return image.src;
  for (const widget of node.widgets || []) {
    const element = widget?.element;
    const img = element?.matches?.("img") ? element : element?.querySelector?.("img");
    if (img?.src) return img.src;
    const video = element?.matches?.("video") ? element : element?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) {
      return video.poster || video.currentSrc || video.src;
    }
  }
  return "";
}

function findNodeInHierarchy(preferredGraph, id) {
  const direct = preferredGraph?.getNodeById?.(id);
  if (direct) return direct;
  const root = preferredGraph?.rootGraph || app.graph?.rootGraph || app.graph;
  for (const graph of allGraphs(root)) {
    const node = graph?.getNodeById?.(id);
    if (node) return node;
  }
  return null;
}

export function h3MediaOptions(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return normalizeLinks(node).map((link) => {
    const displaySource = findNodeInHierarchy(node?.graph || app.graph, Number(link.source_id));
    const resolved = resolveVirtualMediaSource(displaySource, link.source_slot, link.source_type);
    const src = resolved.node || displaySource;
    const slot = Number(resolved.slot) || 0;
    const kind = sourceType(src, slot, resolved.type || link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const label = kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`;
    if (src && src !== displaySource) watchSourceNode(src);
    return {
      kind,
      index,
      tag: kind === "picture" ? `<Picture ${index}>` : kind === "video" ? `<Video ${index}>` : `<Audio ${index}>`,
      label,
      source: filenameFromSource(src, kind).split(/[\\/]/).pop() || src?.title || label,
      preview: previewFromSource(src, kind),
    };
  });
}

function watchSourceNode(node) {
  if (!node) return;
  for (const widget of node.widgets || []) {
    if (widget?.__terryH3Watch) continue;
    widget.__terryH3Watch = true;
    const previous = widget.callback;
    widget.callback = function() {
      const result = previous?.apply(this, arguments);
      refreshEditorsSoon();
      return result;
    };
    const element = widget.inputEl || widget.element;
    element?.addEventListener?.("change", refreshEditorsSoon, true);
    element?.addEventListener?.("input", refreshEditorsSoon, true);
  }
}

function widgetValue(widget, fallback = "") {
  return widget == null ? fallback : widget.value;
}

function setWidgetValue(widget, value) {
  if (!widget) return;
  const next = value;
  if (widget.value !== next) widget.value = next;
  if (widget._state) widget._state.value = next;
  const element = promptTextarea(widget);
  if (element && element.value !== String(next ?? "")) element.value = String(next ?? "");
}

export function mountH3PromptWidget({
  hostNode,
  sourceNode = hostNode,
  promptWidget,
  previewWidget = null,
  assetsProvider = null,
  promoted = false,
}) {
  if (!hostNode || !promptWidget || typeof document === "undefined") return null;

  const previousMount = promptWidget.__terryH3RichMount;
  if (previousMount?.wrap?.isConnected && previousMount?.textarea?.isConnected) return previousMount;
  if (previousMount) {
    try { previousMount.dispose?.(); } catch {}
    delete promptWidget.__terryH3RichMount;
  }

  prepareCanonicalPromptWidget(promptWidget);
  const textarea = promptTextarea(promptWidget);
  const mount = textarea?.parentElement;
  if (!textarea || !mount) return null;

  installStyle();
  installH3RichTextStyles();

  mount.classList.add("terry-h3-prompt-widget-host");
  textarea.classList.add("terry-h3-canonical-textarea");

  const wrap = document.createElement("div");
  wrap.className = `terry-h3-wrap${promoted ? " terry-h3-promoted-wrap" : ""}`;
  const editor = document.createElement("div");
  editor.className = "comfy-multiline-input terry-h3-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.tabIndex = 0;
  editor.dataset.placeholder = "粘贴 MiniMax H3 提示词，输入 @ 引用素材…";

  const tools = document.createElement("div");
  tools.className = "terry-h3-tools";
  const assetState = document.createElement("span");
  assetState.className = "terry-h3-state";
  const modeState = document.createElement("span");
  modeState.className = "terry-h3-mode-state";
  tools.append(assetState, modeState);
  wrap.append(editor, tools);
  mount.append(wrap);

  const getAssets = () => {
    try {
      if (assetsProvider) {
        const supplied = assetsProvider();
        return Array.isArray(supplied) ? supplied : [];
      }
      return h3MediaOptions(sourceNode);
    } catch {
      return [];
    }
  };
  const readRaw = () => String(widgetValue(promptWidget, "") ?? "");
  const visualEnabled = () => previewWidget ? Boolean(widgetValue(previewWidget, true)) : true;

  const state = {
    hostNode,
    sourceNode,
    promptWidget,
    previewWidget,
    textarea,
    mount,
    wrap,
    editor,
    assetState,
    modeState,
    rendering: false,
    lastRaw: null,
    lastVisual: null,
    lastAssets: null,
    menu: null,
    render: null,
    setValue: null,
    sync: null,
    dispose: null,
  };

  const richOptions = () => ({
    resolveMedia(kind, index) {
      return getAssets().find((item) => item.kind === kind && item.index === Number(index)) || null;
    },
    onChange: () => syncFromEditor(true),
  });

  const writeRaw = (raw, dirty = true) => {
    const next = String(raw ?? "");
    const changed = String(widgetValue(promptWidget, "") ?? "") !== next;
    setWidgetValue(promptWidget, next);
    if (changed) promptWidget.callback?.(next);
    state.lastRaw = next;
    if (dirty) {
      hostNode.setDirtyCanvas?.(true, true);
      hostNode.graph?.setDirtyCanvas?.(true, true);
      hostNode.graph?.change?.();
    }
  };

  const syncFromEditor = (dirty = true) => {
    if (state.rendering) return;
    writeRaw(serializeH3RichText(editor), dirty);
  };

  const render = (force = false) => {
    if (!wrap.isConnected || !textarea.isConnected) return;
    const raw = readRaw();
    const visual = visualEnabled();
    const assets = getAssets();
    const assetSignature = assets.map((item) => `${item.kind}:${item.index}:${item.preview || ""}:${item.source || ""}`).join("|");
    if (!force && document.activeElement === editor && state.lastRaw === raw) return;
    if (!force && state.lastRaw === raw && state.lastVisual === visual && state.lastAssets === assetSignature) return;

    state.rendering = true;
    try {
      if (visual) renderH3RichText(editor, raw, richOptions());
      else renderH3RawText(editor, raw);

      const pictures = assets.filter((item) => item.kind === "picture").length;
      const videos = assets.filter((item) => item.kind === "video").length;
      const audios = assets.filter((item) => item.kind === "audio").length;
      assetState.textContent = `参考：图片 ${pictures} · 视频 ${videos} · 音频 ${audios}`;
      modeState.textContent = visual ? "可视化预览" : "原文";
      state.lastRaw = raw;
      state.lastVisual = visual;
      state.lastAssets = assetSignature;
    } finally {
      state.rendering = false;
    }
  };

  editor.addEventListener("input", () => syncFromEditor(true));
  editor.addEventListener("keydown", (event) => event.stopPropagation());
  editor.addEventListener("paste", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const text = event.clipboardData?.getData("text/plain") || "";
    if (visualEnabled()) insertH3RichTextAtSelection(editor, text, richOptions());
    else document.execCommand?.("insertText", false, text);
    syncFromEditor(true);
    render(true);
  });
  editor.addEventListener("blur", () => syncFromEditor(true));
  wrap.addEventListener("pointerdown", (event) => event.stopPropagation());

  state.menu = attachH3Menus({
    node: hostNode,
    editor,
    mode: "prompt",
    onChange: () => syncFromEditor(true),
  });
  bindH3TagInteractions(editor, {
    node: hostNode,
    getSourceText: readRaw,
    onChange: () => syncFromEditor(true),
  });

  if (previewWidget && !previewWidget.__terryH3PreviewWatch) {
    previewWidget.__terryH3PreviewWatch = true;
    const previous = previewWidget.callback;
    previewWidget.callback = function() {
      const result = previous?.apply(this, arguments);
      queueMicrotask(() => render(true));
      return result;
    };
  }

  state.render = render;
  state.sync = syncFromEditor;
  state.setValue = (value) => {
    writeRaw(String(value ?? ""), false);
    render(true);
  };
  state.dispose = () => {
    try { state.menu?.destroy?.(); } catch {}
    try { wrap.remove?.(); } catch {}
    textarea.classList.remove("terry-h3-canonical-textarea");
    mount.classList.remove("terry-h3-prompt-widget-host");
    if (promptWidget.__terryH3RichMount === state) delete promptWidget.__terryH3RichMount;
  };

  promptWidget.__terryH3RichMount = state;
  queueMicrotask(() => render(true));
  return state;
}

function clearNodeMount(node) {
  const state = node?.__terryH3PromptMount;
  try { state?.dispose?.(); } catch {}
  delete node.__terryH3PromptMount;
  delete node.__terryH3Editor;
  delete node.__terryH3AssetState;
  delete node.__terryH3Wrap;
  delete node.__terryH3DomWidget;
}

function syncFromEditor(node, dirty = true) {
  const state = node?.__terryH3PromptMount;
  if (!state || state.rendering) return;
  state.sync?.(dirty);
}

function refreshEditor(node, force = false) {
  const state = node?.__terryH3PromptMount;
  if (!state?.wrap?.isConnected || !state?.textarea?.isConnected) {
    clearNodeMount(node);
    ensureEditor(node);
    return;
  }
  state.render?.(force);
}

function ensureEditor(node) {
  if (!node || !isTarget(node) || typeof document === "undefined") return false;
  const existing = node.__terryH3PromptMount;
  if (existing?.wrap?.isConnected && existing?.textarea?.isConnected) return true;
  if (existing) clearNodeMount(node);

  const prompt = getWidget(node, "prompt");
  if (!prompt) return false;
  const preview = getWidget(node, "visual_preview");
  const state = mountH3PromptWidget({
    hostNode: node,
    sourceNode: node,
    promptWidget: prompt,
    previewWidget: preview,
    assetsProvider: () => h3MediaOptions(node),
  });
  if (!state) return false;

  node.__terryH3PromptMount = state;
  node.__terryH3Editor = state.editor;
  node.__terryH3AssetState = state.assetState;
  node.__terryH3Wrap = state.wrap;
  // Compatibility API for the external STRING/TEXT read-only mode. This is not
  // a ComfyUI widget; prompt remains the sole official value widget.
  node.__terryH3DomWidget = { setValue: state.setValue };
  node.setSize?.([
    Math.max(520, Number(node.size?.[0]) || 0),
    Math.max(430, Number(node.size?.[1]) || 0),
  ]);
  return true;
}

function ensureAllEditors(force = false) {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (!isTarget(node)) continue;
      if (!ensureEditor(node)) continue;
      refreshEditor(node, force);
    }
  }
}

function installEditorSoon(node) {
  if (!node || node.__terryH3InstallPending || node.__terryH3PromptMount) return;
  node.__terryH3InstallPending = true;
  const run = () => {
    node.__terryH3InstallPending = false;
    if (ensureEditor(node)) return;
    node.__terryH3InstallAttempts = (node.__terryH3InstallAttempts || 0) + 1;
    if (node.__terryH3InstallAttempts < 16) {
      setTimeout(() => installEditorSoon(node), Math.min(1200, 60 + 80 * node.__terryH3InstallAttempts));
    }
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 0);
}

let refreshTimer = null;
function refreshEditorsSoon() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    ensureAllEditors(false);
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || graph?.nodes || []) {
        node?.__terryH3PromotedPromptMount?.render?.();
      }
    }
  }, 0);
}

let lifecycleTimer = null;
function startEditorLifecycle() {
  if (lifecycleTimer) return;
  lifecycleTimer = setInterval(() => {
    ensureAllEditors(false);
  }, 350);
}

function installStyle() {
  if (typeof document === "undefined" || document.getElementById("terry-h3-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-style";
  style.textContent = `
.terry-h3-prompt-widget-host{position:relative!important;overflow:hidden!important;min-height:280px!important;}
.terry-h3-canonical-textarea{visibility:hidden!important;pointer-events:none!important;color:transparent!important;caret-color:transparent!important;}
.terry-h3-wrap{position:absolute;z-index:1;inset:0;width:100%;height:100%;min-height:0;box-sizing:border-box;overflow:hidden;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);pointer-events:auto;}
.terry-h3-editor{width:100%;height:100%;min-height:0;box-sizing:border-box;padding:10px 10px 34px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;border:0;background:transparent;font:12px/1.6 Consolas,"Courier New",monospace}
.terry-h3-editor:empty:before{content:attr(data-placeholder);opacity:.4;pointer-events:none}
.terry-h3-tools{position:absolute;left:8px;right:8px;bottom:5px;display:flex;align-items:center;justify-content:space-between;gap:10px;pointer-events:none}
.terry-h3-state,.terry-h3-mode-state{font-size:10px;opacity:.5;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.terry-h3-chip{display:inline-flex;align-items:center;gap:4px;margin:0 2px;padding:1px 5px;border-radius:5px;background:rgba(255,255,255,.08);box-shadow:inset 0 0 0 1px rgba(255,255,255,.1);vertical-align:middle;white-space:nowrap;font:11px/1.5 Consolas,monospace}
.terry-h3-strong{font-weight:700;background:rgba(255,255,255,.12)}
.terry-h3-dialogue{background:rgba(0,226,187,.12);color:rgba(190,255,244,.98)}
.terry-h3-media-chip{color:rgba(190,255,244,.98);background:rgba(0,226,187,.09)}
.terry-h3-media-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
.terry-h3-media-icon{display:grid;place-items:center;width:24px;height:24px;border-radius:3px;background:rgba(255,255,255,.09)}
`;
  document.head.append(style);
}

function installNode(nodeType, nodeData) {
  if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3Installed) return;
  nodeType.prototype.__terryH3Installed = true;

  const created = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function() {
    const result = created?.apply(this, arguments);
    ensureLinks(this);
    ensureSingleMediaInput(this);
    installEditorSoon(this);
    patchCanvas();
    patchGraphToPrompt();
    return result;
  };

  const added = nodeType.prototype.onAdded;
  nodeType.prototype.onAdded = function() {
    const result = added?.apply(this, arguments);
    ensureLinks(this);
    ensureSingleMediaInput(this);
    installEditorSoon(this);
    return result;
  };

  const configure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function() {
    const result = configure?.apply(this, arguments);
    ensureLinks(this);
    normalizeLinks(this);
    ensureSingleMediaInput(this);
    installEditorSoon(this);
    refreshEditorsSoon();
    return result;
  };

  const connections = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function(type, index, connected, linkInfo) {
    const result = connections?.apply(this, arguments);
    const inputIndex = Number(index);
    if (connected && !this.__terryClearingLink && String(this.inputs?.[inputIndex]?.name || "") === "media") {
      setTimeout(() => convertNativeMediaConnection(this, inputIndex, linkInfo), 0);
      setTimeout(() => convertNativeMediaConnection(this, inputIndex), 40);
    }
    return result;
  };

  const draw = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function() {
    const result = draw?.apply(this, arguments);
    if (!this.__terryH3PromptMount) installEditorSoon(this);
    return result;
  };

  const removed = nodeType.prototype.onRemoved;
  nodeType.prototype.onRemoved = function() {
    clearNodeMount(this);
    return removed?.apply(this, arguments);
  };

  const serialize = nodeType.prototype.onSerialize;
  nodeType.prototype.onSerialize = function(info) {
    syncFromEditor(this, false);
    const result = serialize?.apply(this, arguments);
    if (info) {
      info.properties ||= {};
      info.properties[LINKS_PROP] = ensureLinks(this);
      info.properties[VIEW_PROP] = getWidget(this, "visual_preview")?.value === false ? "raw" : "visual";
    }
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.H3PromptEditor",
  setup() {
    installStyle();
    installH3RichTextStyles();
    patchCanvas();
    patchGraphToPrompt();
    startEditorLifecycle();
    for (const delay of [0, 100, 400, 1000, 2500]) {
      setTimeout(() => {
        patchCanvas();
        patchGraphToPrompt();
        ensureAllEditors(delay === 2500);
        refreshEditorsSoon();
      }, delay);
    }
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    const name = String(nodeData?.name || "").toLowerCase();
    if (name.includes("loadimage") || name.includes("loadvideo") || name.includes("loadaudio")) {
      const created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function() {
        const result = created?.apply(this, arguments);
        watchSourceNode(this);
        return result;
      };
    }
    installNode(nodeType, nodeData);
  },
  afterConfigureGraph() {
    queueMicrotask(() => ensureAllEditors(true));
    setTimeout(() => ensureAllEditors(true), 150);
  },
});
