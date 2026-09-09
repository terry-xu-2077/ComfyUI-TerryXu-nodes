import { app } from "../../scripts/app.js";

const MANAGER_TYPE = "TerryXuGroupManager";
const POLL_MS = 260;
let timer = null;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === MANAGER_TYPE;
}

function isVueNodesMode() {
  return Boolean(globalThis.LiteGraph?.vueNodesMode);
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

function managers() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []).filter(isManager);
}

function managerPanel(node) {
  return node.__terryGroupManager?.panel
    || (node.widgets || []).map((widget) => widget?.element).find((element) => element?.classList?.contains("terry-group-manager"))
    || null;
}

function managerWidget(node) {
  return node.__terryGroupManager?.widget
    || (node.widgets || []).find((widget) => widget?.element?.classList?.contains("terry-group-manager"))
    || null;
}

function syncManagerWidth(node) {
  const panel = managerPanel(node);
  const widget = managerWidget(node);
  if (!panel || !widget) return;

  // Nodes 2.0 may leave an explicit DOM-widget width behind. The legacy DOM
  // widget renderer prefers widget.width over node.width, so that stale value
  // makes the HTML controls spill outside the classic node after mode changes.
  if (!isVueNodesMode()) {
    if (widget.width !== undefined) widget.width = undefined;
    panel.style.width = "100%";
    panel.style.maxWidth = "100%";
    panel.style.minWidth = "0";
    panel.style.boxSizing = "border-box";
    panel.style.overflowX = "hidden";
    for (const row of panel.querySelectorAll(".terry-group-manager__row")) {
      row.style.width = "100%";
      row.style.maxWidth = "100%";
      row.style.minWidth = "0";
      row.style.boxSizing = "border-box";
    }
  } else {
    panel.style.overflowX = "";
  }
  node.setDirtyCanvas?.(true, true);
}

function syncAll() {
  const list = managers();
  for (const node of list) syncManagerWidth(node);
  return list.length > 0;
}

function start() {
  if (timer != null) return;
  timer = setInterval(() => {
    if (!syncAll()) {
      clearInterval(timer);
      timer = null;
    }
  }, POLL_MS);
}

app.registerExtension({
  name: "TerryXu.GroupManagerClassicWidthFix",
  nodeCreated(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => { syncManagerWidth(node); start(); });
  },
  loadedGraphNode(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => { syncManagerWidth(node); start(); });
  },
  afterConfigureGraph() {
    if (syncAll()) start();
  },
});
