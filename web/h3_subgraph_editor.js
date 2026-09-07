import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { attachH3Menus } from "./h3_shared_menus.js";
import {
  bindH3TagInteractions,
  installH3RichTextStyles,
  renderH3RawText,
  renderH3RichText,
  serializeH3RichText,
} from "./h3_rich_text.js";

const H3_TYPE = "TerryXuH3PromptEditor";
const LINKS_PROP = "terry_h3_virtual_media_links";
const PROMPT_WIDGET = "prompt";
const PREVIEW_WIDGET = "visual_preview";
const STYLE_ID = "terry-h3-subgraph-editor-style";

function nodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      node?.constructor?.nodeData?.name ||
      ""
  );
}

function isH3(node) {
  return nodeType(node) === H3_TYPE;
}

function isSubgraphNode(node) {
  try {
    if (node?.isSubgraphNode?.()) return true;
  } catch {}
  return Boolean(node?.subgraph?.inputNode && node?.subgraph?.outputNode);
}

function allGraphs(root = app.graph) {
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

function findNodeInHierarchy(preferredGraph, id) {
  const direct = preferredGraph?.getNodeById?.(id);
  if (direct) return direct;
  const root = preferredGraph?.rootGraph || app.graph?.rootGraph || app.graph;
  const rootNode = root?.getNodeById?.(id);
  if (rootNode) return rootNode;
  for (const graph of allGraphs(root)) {
    const node = graph?.getNodeById?.(id);
    if (node) return node;
  }
  return null;
}

function directH3Nodes(subgraphNode) {
  if (!isSubgraphNode(subgraphNode)) return [];
  return (subgraphNode.subgraph?._nodes || subgraphNode.subgraph?.nodes || []).filter(isH3);
}

function getWidget(node, name) {
  return node?.widgets?.find?.((widget) => String(widget?.name || "") === name) || null;
}

function sourceSlotForWidget(node, widget) {
  if (!node || !widget) return null;
  try {
    const slot = node.getSlotFromWidget?.(widget);
    if (slot) return slot;
  } catch {}
  return (node.inputs || []).find((input) =>
    input?.widget === widget || String(input?.widget?.name || "") === String(widget.name || "")
  ) || null;
}

function linkTarget(graph, link) {
  if (!graph || !link) return { node: null, input: null };
  try {
    const resolved = link.resolve?.(graph);
    if (resolved?.inputNode && resolved?.input) {
      return { node: resolved.inputNode, input: resolved.input };
    }
  } catch {}
  const targetId = link.target_id ?? link.targetId;
  const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
  const node = graph.getNodeById?.(targetId) || null;
  return { node, input: node?.inputs?.[targetSlot] || null };
}

function promotionSlotFor(subgraphNode, sourceNode, widgetName) {
  const graph = subgraphNode?.subgraph;
  if (!graph) return null;
  for (const slot of graph.inputs || graph.inputNode?.slots || []) {
    for (const linkId of slot?.linkIds || []) {
      const link = graph.getLink?.(linkId)
        || graph.links?.get?.(linkId)
        || graph._links?.get?.(linkId)
        || graph.links?.[linkId]
        || graph._links?.[linkId];
      if (!link) continue;
      const target = linkTarget(graph, link);
      if (target.node !== sourceNode || !target.input) continue;
      const targetWidget = sourceNode.getWidgetFromSlot?.(target.input)
        || (sourceNode.widgets || []).find((widget) =>
          String(widget?.name || "") === String(target.input?.widget?.name || "")
        );
      if (String(targetWidget?.name || target.input?.widget?.name || "") === widgetName) return slot;
    }
  }
  return null;
}

function nextInputName(graph, base) {
  const names = new Set((graph?.inputs || []).map((input) => String(input?.name || "")));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function ensurePromotion(subgraphNode, sourceNode, widgetName) {
  const graph = subgraphNode?.subgraph;
  if (!graph || !sourceNode) return null;
  const existing = promotionSlotFor(subgraphNode, sourceNode, widgetName);
  if (existing) return existing;

  const widget = getWidget(sourceNode, widgetName);
  const sourceSlot = sourceSlotForWidget(sourceNode, widget);
  if (!widget || !sourceSlot || typeof graph.addInput !== "function") return null;

  const inputName = nextInputName(graph, widgetName);
  const input = graph.addInput(inputName, String(sourceSlot.type ?? "*"));
  if (!input) return null;
  input.label = sourceSlot.label || widget.label || widgetName;

  let connected = null;
  try {
    connected = input.connect?.(sourceSlot, sourceNode) || null;
  } catch {}
  if (!connected) {
    try { graph.removeInput?.(input); } catch {}
    return null;
  }

  subgraphNode.expandToFitContent?.();
  subgraphNode.setDirtyCanvas?.(true, true);
  subgraphNode.graph?.setDirtyCanvas?.(true, true);
  return input;
}

function hostInputForSlot(subgraphNode, subgraphSlot) {
  if (!subgraphNode || !subgraphSlot) return null;
  return (subgraphNode.inputs || []).find((input) =>
    input?._subgraphSlot === subgraphSlot
    || (
      input?._subgraphSlot?.id != null
      && subgraphSlot?.id != null
      && String(input._subgraphSlot.id) === String(subgraphSlot.id)
    )
    || String(input?.name || "") === String(subgraphSlot?.name || "")
  ) || null;
}

function hostWidgetForInput(subgraphNode, input) {
  if (!subgraphNode || !input) return null;
  try {
    const widget = subgraphNode.getWidgetFromSlot?.(input);
    if (widget) return widget;
  } catch {}
  return input._widget
    || (subgraphNode.widgets || []).find((widget) => String(widget?.name || "") === String(input.name || ""))
    || null;
}

function installStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.terry-h3-subgraph-widget-host{position:relative!important;overflow:hidden!important;}
.terry-h3-subgraph-source-textarea{visibility:hidden!important;pointer-events:none!important;}
.terry-h3-subgraph-wrap{position:absolute;inset:0;box-sizing:border-box;overflow:hidden;color:var(--input-text,#ddd);background:var(--comfy-input-bg,#222);}
.terry-h3-subgraph-editor{width:100%;height:100%;min-height:0!important;box-sizing:border-box;padding:10px 10px 28px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;outline:none;border:0;background:transparent!important;font:12px/1.6 Consolas,"Courier New",monospace;}
.terry-h3-subgraph-footer{position:absolute;left:8px;right:8px;bottom:5px;display:flex;align-items:center;justify-content:space-between;gap:8px;pointer-events:none;font:10px/1.2 Inter,system-ui,sans-serif;color:rgba(255,255,255,.48);}
.terry-h3-subgraph-footer span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
`;
  document.head.append(style);
}

function filenameFromSource(node, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  for (const widget of node?.widgets || []) {
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

function resolveVirtualSource(source, slot = 0, fallback = "*") {
  let node = source;
  let resolvedSlot = Number(slot) || 0;
  try {
    const resolved = source?.resolveVirtualOutput?.(resolvedSlot);
    if (resolved?.node) {
      node = resolved.node;
      resolvedSlot = Number(resolved.slot) || 0;
    }
  } catch {}
  return {
    node,
    slot: resolvedSlot,
    type: String(node?.outputs?.[resolvedSlot]?.type || fallback || "*").toUpperCase(),
  };
}

function mediaKind(type) {
  const value = String(type || "").toUpperCase();
  if (value.includes("AUDIO")) return "audio";
  if (value.includes("VIDEO")) return "video";
  return "picture";
}

function mediaOptions(h3) {
  const links = Array.isArray(h3?.properties?.[LINKS_PROP]) ? h3.properties[LINKS_PROP] : [];
  const counts = { picture: 0, video: 0, audio: 0 };
  const result = [];
  const seen = new Set();

  for (const link of links) {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id)) continue;
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const displaySource = findNodeInHierarchy(h3.graph, id);
    if (!displaySource) continue;
    const resolved = resolveVirtualSource(displaySource, slot, link?.source_type || "*");
    const source = resolved.node || displaySource;
    const kind = mediaKind(resolved.type || link?.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    const label = kind === "picture" ? `Picture ${index}` : kind === "video" ? `Video ${index}` : `Audio ${index}`;
    result.push({
      kind,
      index,
      label,
      source: filenameFromSource(source, kind).split(/[\\/]/).pop() || source?.title || label,
      preview: previewFromSource(source, kind),
    });
  }
  return result;
}

function makeHostLinksProxy(subgraphNode, h3) {
  subgraphNode.properties ||= {};
  const existing = Object.getOwnPropertyDescriptor(subgraphNode.properties, LINKS_PROP);
  if (existing?.get?.__terryH3SubgraphProxy) return;
  if (existing && existing.configurable === false) return;

  const get = () => {
    const value = h3?.properties?.[LINKS_PROP];
    return Array.isArray(value) ? value : [];
  };
  get.__terryH3SubgraphProxy = true;
  Object.defineProperty(subgraphNode.properties, LINKS_PROP, {
    configurable: true,
    enumerable: false,
    get,
  });
}

function installRichEditor(subgraphNode, h3, promptInput, previewInput) {
  if (subgraphNode.__terryH3SubgraphEditor) return true;
  const promptWidget = hostWidgetForInput(subgraphNode, promptInput);
  const previewWidget = hostWidgetForInput(subgraphNode, previewInput);
  const textarea = promptWidget?.element instanceof HTMLTextAreaElement
    ? promptWidget.element
    : promptWidget?.inputEl instanceof HTMLTextAreaElement
      ? promptWidget.inputEl
      : null;
  const mount = textarea?.parentElement;
  if (!promptWidget || !textarea || !mount) return false;

  installStyle();
  installH3RichTextStyles();
  makeHostLinksProxy(subgraphNode, h3);

  mount.classList.add("terry-h3-subgraph-widget-host");
  textarea.classList.add("terry-h3-subgraph-source-textarea");

  const wrap = document.createElement("div");
  wrap.className = "terry-h3-subgraph-wrap";
  const editor = document.createElement("div");
  editor.className = "comfy-multiline-input terry-h3-editor terry-h3-subgraph-editor";
  editor.contentEditable = "true";
  editor.spellcheck = false;
  editor.dataset.placeholder = "H3 Prompt";

  const footer = document.createElement("div");
  footer.className = "terry-h3-subgraph-footer";
  const modeText = document.createElement("span");
  const assetText = document.createElement("span");
  footer.append(modeText, assetText);
  wrap.append(editor, footer);
  mount.append(wrap);

  const state = {
    promptWidget,
    previewWidget,
    textarea,
    wrap,
    editor,
    footer,
    modeText,
    assetText,
    lastRaw: null,
    lastVisual: null,
    lastAssets: null,
    rendering: false,
    menu: null,
  };

  const visualEnabled = () => previewWidget ? Boolean(previewWidget.value) : true;
  const readRaw = () => String(promptWidget.value ?? "");
  const writeRaw = (raw, dirty = true) => {
    const next = String(raw ?? "");
    if (String(promptWidget.value ?? "") !== next) {
      promptWidget.value = next;
      if (promptWidget._state) promptWidget._state.value = next;
      promptWidget.callback?.(next);
    }
    if (textarea.value !== next) textarea.value = next;
    state.lastRaw = next;
    if (dirty) {
      subgraphNode.setDirtyCanvas?.(true, true);
      subgraphNode.graph?.setDirtyCanvas?.(true, true);
      subgraphNode.graph?.change?.();
    }
  };

  const resolveMedia = (kind, index) =>
    mediaOptions(h3).find((item) => item.kind === kind && item.index === Number(index)) || null;

  const syncFromEditor = (dirty = true) => {
    if (state.rendering) return;
    writeRaw(serializeH3RichText(editor), dirty);
  };

  const render = (force = false) => {
    const raw = readRaw();
    const visual = visualEnabled();
    const assets = mediaOptions(h3);
    const assetSignature = assets.map((item) => `${item.kind}:${item.index}:${item.preview}:${item.source}`).join("|");
    if (
      !force
      && state.lastRaw === raw
      && state.lastVisual === visual
      && state.lastAssets === assetSignature
    ) return;
    if (!force && document.activeElement === editor && state.lastRaw !== raw) return;

    state.rendering = true;
    try {
      if (visual) {
        renderH3RichText(editor, raw, {
          resolveMedia,
          onChange: () => syncFromEditor(true),
        });
      } else {
        renderH3RawText(editor, raw);
      }
      editor.contentEditable = "true";
      modeText.textContent = visual ? "可视化预览" : "原文";
      const pictures = assets.filter((item) => item.kind === "picture").length;
      const videos = assets.filter((item) => item.kind === "video").length;
      const audios = assets.filter((item) => item.kind === "audio").length;
      assetText.textContent = `图片 ${pictures} · 视频 ${videos} · 音频 ${audios}`;
      state.lastRaw = raw;
      state.lastVisual = visual;
      state.lastAssets = assetSignature;
    } finally {
      state.rendering = false;
    }
  };

  editor.addEventListener("input", () => syncFromEditor(true));
  editor.addEventListener("blur", () => syncFromEditor(true));
  wrap.addEventListener("pointerdown", (event) => event.stopPropagation());

  state.menu = attachH3Menus({
    node: subgraphNode,
    editor,
    mode: "prompt",
    onChange: () => syncFromEditor(true),
  });
  bindH3TagInteractions(editor, {
    node: subgraphNode,
    getSourceText: readRaw,
    onChange: () => syncFromEditor(true),
  });

  subgraphNode.__terryH3SubgraphEditor = {
    h3,
    state,
    render,
    sync: syncFromEditor,
    dispose() {
      try { state.menu?.destroy?.(); } catch {}
      wrap.remove?.();
      textarea.classList.remove("terry-h3-subgraph-source-textarea");
      mount.classList.remove("terry-h3-subgraph-widget-host");
      delete subgraphNode.__terryH3SubgraphEditor;
    },
  };

  render(true);
  subgraphNode.expandToFitContent?.();
  subgraphNode.setDirtyCanvas?.(true, true);
  return true;
}

function setupSubgraphNode(node, attempt = 0) {
  if (!isSubgraphNode(node)) return false;
  const h3Nodes = directH3Nodes(node);
  if (h3Nodes.length !== 1) return false;
  const h3 = h3Nodes[0];

  const promptSlot = ensurePromotion(node, h3, PROMPT_WIDGET);
  const previewSlot = ensurePromotion(node, h3, PREVIEW_WIDGET);
  if (!promptSlot || !previewSlot) return false;

  const promptInput = hostInputForSlot(node, promptSlot);
  const previewInput = hostInputForSlot(node, previewSlot);
  if (!promptInput || !previewInput || !installRichEditor(node, h3, promptInput, previewInput)) {
    if (attempt < 12) setTimeout(() => setupSubgraphNode(node, attempt + 1), Math.min(1200, 60 + attempt * 80));
    return false;
  }
  return true;
}

function setupAllSubgraphs() {
  const root = app.graph?.rootGraph || app.graph;
  for (const graph of allGraphs(root)) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (isSubgraphNode(node)) setupSubgraphNode(node);
    }
  }
}

let timer = null;
function start() {
  setupAllSubgraphs();
  if (timer) return;
  timer = setInterval(() => {
    setupAllSubgraphs();
    const root = app.graph?.rootGraph || app.graph;
    for (const graph of allGraphs(root)) {
      for (const node of graph?._nodes || graph?.nodes || []) {
        node?.__terryH3SubgraphEditor?.render?.();
      }
    }
  }, 300);
}

app.registerExtension({
  name: "TerryXu.H3SubgraphEditor",
  setup() {
    start();
    queueMicrotask(setupAllSubgraphs);
  },
  nodeCreated(node) {
    if (isSubgraphNode(node)) {
      queueMicrotask(() => setupSubgraphNode(node));
      setTimeout(() => setupSubgraphNode(node), 80);
    }
  },
  loadedGraphNode(node) {
    if (isSubgraphNode(node)) queueMicrotask(() => setupSubgraphNode(node));
  },
  afterConfigureGraph() {
    queueMicrotask(setupAllSubgraphs);
    setTimeout(setupAllSubgraphs, 120);
  },
});
