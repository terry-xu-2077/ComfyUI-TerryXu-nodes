import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryXuH3PromptEditor";
const SOURCE_INPUT = "source_text";
const LOCAL_PROMPT_PROP = "terry_h3_local_prompt_before_preview";
const READONLY_CLASS = "terry-h3-readonly-preview";

function isTarget(node) {
  if (!node) return false;
  return [node.comfyClass, node.type, node.constructor?.type, node.constructor?.comfyClass, node.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function promptWidget(node) {
  return node?.widgets?.find((widget) => String(widget?.name || "") === "prompt") || null;
}

function sourceInput(node) {
  return node?.inputs?.find((input) => String(input?.name || "") === SOURCE_INPUT) || null;
}

function sourceConnected(node) {
  const input = sourceInput(node);
  if (!input) return false;
  if (input.link != null) return true;
  if (Array.isArray(input.links) && input.links.length) return true;
  return false;
}

function ensureProperties(node) {
  node.properties ||= {};
  return node.properties;
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
      const values = typeof collection.values === "function" ? collection.values() : Object.values(collection);
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

  // h3_prompt_editor.js owns the real rich editor renderer. Reuse its setter so
  // preview mode never develops a second rendering path.
  const domWidget = node?.__terryH3DomWidget;
  if (typeof domWidget?.setValue === "function") {
    domWidget.setValue(value);
    return;
  }

  // The editor may be created a tick later during graph restore. Keep the
  // hidden prompt widget correct now; normal H3 initialization will render it.
  const editor = node?.__terryH3Editor;
  if (editor && !editor.hasChildNodes()) editor.textContent = value;
}

function unwrapPreviewText(output) {
  const candidates = [
    output?.terry_h3_preview_text,
    output?.output?.terry_h3_preview_text,
    output?.ui?.terry_h3_preview_text,
  ];
  let value = candidates.find((item) => item != null);
  if (value == null) return null;

  // ComfyUI UI outputs can be scalars or one-item arrays depending on the
  // backend/frontend path (fresh execution, cache replay, subgraph display).
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

function applyPreviewOutput(node, output) {
  if (!isTarget(node) || !sourceConnected(node)) return false;
  const previewText = unwrapPreviewText(output);
  if (previewText == null) return false;

  rememberLocalPrompt(node);
  node.__terryH3ReadOnlyActive = true;
  node.__terryH3LastPreviewText = previewText;
  setEditorValue(node, previewText);
  applyReadOnlyDom(node);
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
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
  applyReadOnlyDom(node);
  if (node.__terryH3LastPreviewText != null) {
    setEditorValue(node, node.__terryH3LastPreviewText);
    applyReadOnlyDom(node);
  }
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
  setTimeout(() => applyReadOnlyDom(node), 80);
}

function patchNodeType(nodeType) {
  if (nodeType.prototype.__terryH3TextPreviewPatched) return;
  nodeType.prototype.__terryH3TextPreviewPatched = true;

  const oldCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const result = oldCreated?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldConnectionsChange = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function () {
    const result = oldConnectionsChange?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const result = oldConfigure?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldExecuted = nodeType.prototype.onExecuted;
  nodeType.prototype.onExecuted = function (output) {
    const result = oldExecuted?.apply(this, arguments);
    applyPreviewOutput(this, output);
    syncModeSoon(this);
    return result;
  };
}

function installExecutedListener() {
  if (globalThis.__terryH3PreviewExecutedListener) return;
  globalThis.__terryH3PreviewExecutedListener = true;

  // The stock app also calls node.onExecuted(), but listening to the websocket
  // event directly makes the preview resilient to extension hook ordering and
  // covers display_node / flattened subgraph execution IDs explicitly.
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

app.registerExtension({
  name: "TerryXu.H3TextPreviewMode",
  setup() {
    installExecutedListener();
  },
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (String(nodeData?.name || "") !== NODE_ID) return;
    patchNodeType(nodeType);
  },
  nodeCreated(node) {
    if (isTarget(node)) syncModeSoon(node);
  },
  loadedGraphNode(node) {
    if (isTarget(node)) syncModeSoon(node);
  },
  afterConfigureGraph() {
    installExecutedListener();
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || graph?.nodes || []) {
        if (isTarget(node)) syncModeSoon(node);
      }
    }
  },
});
