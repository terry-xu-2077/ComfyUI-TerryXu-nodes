import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryXuH3PromptEditor";
const SOURCE_INPUT = "source_text";
const LOCAL_PROMPT_PROP = "terry_h3_local_prompt_before_preview";
const READONLY_CLASS = "terry-h3-readonly-preview";

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

function nodeType(node) {
  return String(
    node?.comfyClass
      || node?.type
      || node?.constructor?.type
      || node?.constructor?.comfyClass
      || node?.constructor?.nodeData?.name
      || ""
  );
}

function promptWidget(node) {
  return node?.widgets?.find?.((widget) => String(widget?.name || "") === "prompt") || null;
}

function sourceInput(node) {
  return node?.inputs?.find?.((input) => String(input?.name || "") === SOURCE_INPUT) || null;
}

function sourceConnected(node) {
  const input = sourceInput(node);
  if (!input) return false;
  if (input.link != null) return true;
  return Array.isArray(input.links) && input.links.length > 0;
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
    for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
      if (!collection) continue;
      const values = typeof collection.values === "function"
        ? collection.values()
        : Object.values(collection);
      for (const value of values) {
        const subgraph = value?.subgraph || value;
        if (subgraph && !seen.has(subgraph)) queue.push(subgraph);
      }
    }
  }
  return result;
}

function graphNode(graph, id) {
  if (!graph || id == null) return null;
  return graph.getNodeById?.(id)
    || graph.getNodeById?.(String(id))
    || (Number.isFinite(Number(id)) ? graph.getNodeById?.(Number(id)) : null)
    || null;
}

function graphLink(graph, reference) {
  if (!graph || reference == null) return null;
  if (typeof reference === "object") return reference;
  return graph.getLink?.(reference)
    || graph.links?.get?.(reference)
    || graph._links?.get?.(reference)
    || graph.links?.[reference]
    || graph._links?.[reference]
    || graph.links?.[String(reference)]
    || graph._links?.[String(reference)]
    || null;
}

function connectedSource(node) {
  const input = sourceInput(node);
  const graph = node?.graph || app.graph;
  if (!input || !graph) return null;

  const reference = input.link ?? (Array.isArray(input.links) ? input.links[0] : null);
  const link = graphLink(graph, reference);
  if (!link) return null;

  const sourceId = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  const sourceSlot = Number(
    link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? 0
  ) || 0;
  const source = link.origin_node
    || link.originNode
    || link.fromNode
    || graphNode(graph, sourceId);
  if (!source) return null;

  return { graph, link, source, sourceSlot };
}

function executionNodeById(nodeId) {
  const raw = String(nodeId ?? "");
  if (!raw) return null;

  if (!raw.includes(":")) {
    const matches = allGraphs().map((graph) => graphNode(graph, raw)).filter(Boolean);
    if (matches.length === 1) return matches[0];
    return graphNode(app.graph?.rootGraph || app.graph, raw) || matches[0] || null;
  }

  const parts = raw.split(":").filter(Boolean);
  let graph = app.graph?.rootGraph || app.graph;
  for (let index = 0; graph && index < parts.length - 1; index++) {
    const instance = graphNode(graph, parts[index]);
    graph = instance?.subgraph || null;
  }
  if (graph && parts.length) {
    const exact = graphNode(graph, parts[parts.length - 1]);
    if (exact) return exact;
  }

  const localId = parts[parts.length - 1];
  const matches = allGraphs().map((item) => graphNode(item, localId)).filter(Boolean);
  return matches.length === 1 ? matches[0] : null;
}

function ensureProperties(node) {
  node.properties ||= {};
  return node.properties;
}

function hasSavedLocalPrompt(node) {
  return Object.prototype.hasOwnProperty.call(node?.properties || {}, LOCAL_PROMPT_PROP);
}

function currentPrompt(node) {
  return String(promptWidget(node)?.value ?? "");
}

function rememberLocalPrompt(node) {
  if (hasSavedLocalPrompt(node)) return;
  ensureProperties(node)[LOCAL_PROMPT_PROP] = currentPrompt(node);
}

function setPromptWidgetValue(node, text) {
  const widget = promptWidget(node);
  if (!widget) return;
  const value = String(text ?? "");
  widget.value = value;
  if (widget._state) widget._state.value = value;
}

function setEditorValue(node, text) {
  const value = String(text ?? "");
  setPromptWidgetValue(node, value);

  // Reuse the stable H3 editor renderer. This keeps all rich-tag formatting,
  // media thumbnails and visual/raw behavior in h3_prompt_editor.js.
  const domWidget = node?.__terryH3DomWidget;
  if (typeof domWidget?.setValue === "function") {
    domWidget.setValue(value);
    return true;
  }

  // During graph restore the H3 DOM editor can appear a tick later. Keeping the
  // hidden canonical prompt correct lets normal H3 initialization render it.
  const editor = node?.__terryH3Editor;
  if (editor && !editor.hasChildNodes()) editor.textContent = value;
  return Boolean(editor);
}

function readableStringWidget(source) {
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const preferred = ["value", "text", "string", "prompt", "content"];

  for (const name of preferred) {
    const widget = widgets.find((item) => String(item?.name || "").toLowerCase() === name);
    if (widget && typeof widget.value === "string") return widget;
  }
  return widgets.find((widget) => typeof widget?.value === "string") || null;
}

function directSourceText(node) {
  const info = connectedSource(node);
  if (!info) return null;

  const outputType = String(
    info.source?.outputs?.[info.sourceSlot]?.type
      || info.link?.type
      || ""
  ).toUpperCase();
  if (outputType && !outputType.includes("STRING") && !outputType.includes("TEXT") && outputType !== "*") {
    return null;
  }

  const widget = readableStringWidget(info.source);
  if (widget) return String(widget.value ?? "");

  try {
    const runtimeValue = info.source?.getOutputData?.(info.sourceSlot);
    if (typeof runtimeValue === "string") return runtimeValue;
  } catch {}

  return null;
}

function notifyPreviewTargets(widget) {
  for (const target of widget?.__terryH3PreviewTargets || []) {
    if (isTarget(target) && sourceConnected(target)) syncModeSoon(target);
  }
}

function watchConnectedSource(node) {
  const info = connectedSource(node);
  if (!info?.source) return;

  const widget = readableStringWidget(info.source);
  if (!widget) return;

  widget.__terryH3PreviewTargets ||= new Set();
  widget.__terryH3PreviewTargets.add(node);
  if (widget.__terryH3PreviewWatchInstalled) return;
  widget.__terryH3PreviewWatchInstalled = true;

  const oldCallback = widget.callback;
  widget.callback = function() {
    const result = oldCallback?.apply(this, arguments);
    queueMicrotask(() => notifyPreviewTargets(widget));
    return result;
  };

  const element = widget.inputEl || widget.element;
  const notify = () => queueMicrotask(() => notifyPreviewTargets(widget));
  element?.addEventListener?.("input", notify, true);
  element?.addEventListener?.("change", notify, true);
}

function unwrapPreviewText(output) {
  const candidates = [
    output?.text,
    output?.output?.text,
    output?.ui?.text,
    output?.terry_h3_preview_text,
    output?.output?.terry_h3_preview_text,
    output?.ui?.terry_h3_preview_text,
  ];
  let value = candidates.find((item) => item != null);
  if (value == null) return null;

  while (Array.isArray(value) && value.length === 1) value = value[0];
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.value === "string") return value.value;
  }
  return null;
}

function applyPreviewText(node, previewText) {
  if (!isTarget(node) || !sourceConnected(node) || previewText == null) return false;
  const text = String(previewText);
  rememberLocalPrompt(node);
  node.__terryH3ReadOnlyActive = true;
  node.__terryH3LastPreviewText = text;
  setEditorValue(node, text);
  applyReadOnlyDom(node);
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function applyPreviewOutput(node, output) {
  return applyPreviewText(node, unwrapPreviewText(output));
}

function applyReadOnlyDom(node) {
  const editor = node?.__terryH3Editor;
  const wrap = node?.__terryH3Wrap;
  if (!editor) return false;

  const readonly = sourceConnected(node);
  editor.classList.toggle(READONLY_CLASS, readonly);
  wrap?.classList?.toggle(READONLY_CLASS, readonly);
  editor.contentEditable = readonly ? "false" : "true";
  editor.setAttribute("aria-readonly", readonly ? "true" : "false");
  editor.dataset.readonlyPreview = readonly ? "true" : "false";
  editor.title = readonly ? "已连接文本：只读预览" : "";

  if (readonly) {
    editor.querySelectorAll('[contenteditable="true"]').forEach((element) => {
      element.contentEditable = "false";
      element.setAttribute("aria-readonly", "true");
    });
    editor.querySelectorAll("input, textarea, select").forEach((element) => {
      element.disabled = true;
      element.setAttribute("aria-disabled", "true");
    });
  }

  installEditorGuard(node, editor);
  return true;
}

function installEditorGuard(node, editor) {
  if (!editor || editor.__terryH3ReadOnlyGuard) return;
  editor.__terryH3ReadOnlyGuard = true;

  editor.addEventListener("pointerdown", (event) => {
    if (!sourceConnected(node)) return;
    if (!event.target?.closest?.(".terry-h3-chip")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  for (const eventName of ["beforeinput", "paste", "drop", "cut"]) {
    editor.addEventListener(eventName, (event) => {
      if (!sourceConnected(node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  const observer = new MutationObserver(() => {
    if (sourceConnected(node)) applyReadOnlyDom(node);
  });
  observer.observe(editor, { childList: true, subtree: true });
  editor.__terryH3ReadOnlyObserver = observer;
}

function enterReadOnly(node) {
  rememberLocalPrompt(node);
  node.__terryH3ReadOnlyActive = true;
  watchConnectedSource(node);

  // Static/primitive STRING nodes expose their current widget value in the
  // frontend, so preview them immediately without requiring queue execution.
  const direct = directSourceText(node);
  if (direct != null) {
    node.__terryH3LastPreviewText = direct;
    setEditorValue(node, direct);
  } else if (node.__terryH3LastPreviewText != null) {
    setEditorValue(node, node.__terryH3LastPreviewText);
  }
  applyReadOnlyDom(node);
}

function leaveReadOnly(node) {
  const props = ensureProperties(node);
  const hadSaved = Object.prototype.hasOwnProperty.call(props, LOCAL_PROMPT_PROP);
  const local = hadSaved ? String(props[LOCAL_PROMPT_PROP] ?? "") : currentPrompt(node);

  node.__terryH3ReadOnlyActive = false;
  node.__terryH3LastPreviewText = null;
  if (hadSaved) delete props[LOCAL_PROMPT_PROP];
  setEditorValue(node, local);
  applyReadOnlyDom(node);
}

function syncMode(node) {
  if (!isTarget(node)) return;
  if (sourceConnected(node)) {
    enterReadOnly(node);
  } else if (node.__terryH3ReadOnlyActive || hasSavedLocalPrompt(node)) {
    leaveReadOnly(node);
  } else {
    applyReadOnlyDom(node);
  }
  node.setDirtyCanvas?.(true, true);
}

function syncModeSoon(node) {
  queueMicrotask(() => syncMode(node));
  setTimeout(() => syncMode(node), 0);
  setTimeout(() => syncMode(node), 80);
}

function syncAllTargets() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (isTarget(node)) syncMode(node);
    }
  }
}

function patchNodeType(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terryH3TextPreviewPatched) return;
  nodeTypeClass.prototype.__terryH3TextPreviewPatched = true;

  const oldCreated = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function() {
    const result = oldCreated?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldConnectionsChange = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function() {
    const result = oldConnectionsChange?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldConfigure = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function() {
    const result = oldConfigure?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldExecuted = nodeTypeClass.prototype.onExecuted;
  nodeTypeClass.prototype.onExecuted = function(output) {
    const result = oldExecuted?.apply(this, arguments);
    applyPreviewOutput(this, output);
    syncModeSoon(this);
    return result;
  };
}

function installExecutedListener() {
  if (globalThis.__terryH3PreviewExecutedListener) return;
  globalThis.__terryH3PreviewExecutedListener = true;

  api.addEventListener?.("executed", (event) => {
    const detail = event?.detail || {};
    const node = executionNodeById(detail.node ?? detail.node_id)
      || executionNodeById(detail.display_node);
    if (!node || !isTarget(node)) return;
    applyPreviewOutput(node, detail.output || detail);
    syncModeSoon(node);
  });
}

if (typeof document !== "undefined" && !document.getElementById("terry-h3-readonly-preview-style")) {
  const style = document.createElement("style");
  style.id = "terry-h3-readonly-preview-style";
  style.textContent = `
    .terry-h3-editor.${READONLY_CLASS} {
      cursor: text;
      user-select: text;
      -webkit-user-select: text;
    }
    .terry-h3-editor.${READONLY_CLASS} .terry-h3-chip {
      cursor: default !important;
    }
    .terry-h3-wrap.${READONLY_CLASS} .terry-h3-editor {
      outline-color: color-mix(in srgb, var(--border-color, #777) 75%, transparent);
    }
  `;
  document.head.append(style);
}

let fallbackTimer = null;

app.registerExtension({
  name: "TerryXu.H3TextPreviewMode",
  setup() {
    installExecutedListener();
    if (!fallbackTimer) fallbackTimer = setInterval(syncAllTargets, 300);
  },
  async beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (String(nodeData?.name || "") !== NODE_ID) return;
    patchNodeType(nodeTypeClass);
  },
  nodeCreated(node) {
    if (isTarget(node)) syncModeSoon(node);
  },
  loadedGraphNode(node) {
    if (isTarget(node)) syncModeSoon(node);
  },
  afterConfigureGraph() {
    installExecutedListener();
    syncAllTargets();
  },
});
