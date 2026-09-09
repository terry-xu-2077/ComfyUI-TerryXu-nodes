import { app } from "../../scripts/app.js";

const NODE_TYPE = "TerryXuLinkedBoolean";
const LIVE_WIDGET = "terry_linked_bool_live";
const SOURCE_WIDGET = "enabled";
const POLL_MS = 60;

let timer = null;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isLinked(node) {
  return nodeType(node) === NODE_TYPE;
}

function widget(node, name) {
  return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function allGraphs(root = app.graph?.rootGraph || app.rootGraph || app.graph) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    result.push(graph);
    for (const node of graph?._nodes || graph?.nodes || []) if (node?.subgraph) queue.push(node.subgraph);
    for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
      for (const child of collectionValues(collection)) queue.push(child?.subgraph || child);
    }
  }
  return result;
}

function linkedNodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []).filter(isLinked);
}

function ensureLiveWidget(node) {
  let live = widget(node, LIVE_WIDGET);
  if (!live && typeof node.addWidget === "function") {
    live = node.addWidget("text", LIVE_WIDGET, false, () => {}, {});
  }
  if (!live) return null;

  // The switch preview code reads the first upstream widget value. The linked
  // switch now has a custom channel DOM widget before its visible toggle, so
  // expose a hidden primitive Boolean mirror at index 0 without changing the UI.
  const widgets = node.widgets || [];
  const index = widgets.indexOf(live);
  if (index > 0) {
    widgets.splice(index, 1);
    widgets.unshift(live);
  }

  live.hidden = true;
  live.serialize = false;
  live.options ||= {};
  live.options.hidden = true;
  live.options.serialize = false;
  if (!live.__terryLinkedLiveComputeSize) {
    live.__terryLinkedLiveComputeSize = live.computeSize;
    live.computeSize = () => [0, -4];
  }
  for (const key of ["element", "inputEl"]) {
    const element = live[key];
    if (element?.style) element.style.display = "none";
  }
  return live;
}

function syncNode(node) {
  if (!isLinked(node)) return false;
  const source = widget(node, SOURCE_WIDGET);
  const live = ensureLiveWidget(node);
  if (!source || !live) return false;
  const value = Boolean(source.value);
  const changed = live.value !== value || typeof live.value !== "boolean";
  if (changed) {
    live.value = value;
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
  }
  return true;
}

function syncAll() {
  const nodes = linkedNodes();
  for (const node of nodes) syncNode(node);
  return nodes.length > 0;
}

function startTimer() {
  if (timer != null) return;
  timer = setInterval(() => {
    if (!syncAll()) {
      clearInterval(timer);
      timer = null;
    }
  }, POLL_MS);
}

function patchNodeType(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terryLinkedLiveBridgePatched) return;
  nodeTypeClass.prototype.__terryLinkedLiveBridgePatched = true;

  const created = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    queueMicrotask(() => { syncNode(this); startTimer(); });
    return result;
  };

  const configured = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = configured?.apply(this, arguments);
    queueMicrotask(() => { syncNode(this); startTimer(); });
    return result;
  };

  const changed = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function () {
    const result = changed?.apply(this, arguments);
    queueMicrotask(() => syncNode(this));
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.LinkedBooleanLiveBridge",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (nodeData?.name === NODE_TYPE) patchNodeType(nodeTypeClass);
  },

  nodeCreated(node) {
    if (!isLinked(node)) return;
    queueMicrotask(() => { syncNode(node); startTimer(); });
  },

  loadedGraphNode(node) {
    if (!isLinked(node)) return;
    queueMicrotask(() => { syncNode(node); startTimer(); });
  },

  afterConfigureGraph() {
    if (syncAll()) startTimer();
  },
});
