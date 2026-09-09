import { app } from "../../scripts/app.js";

const REMOTE_TYPE = "TerryXuRemoteControl";
const PAYLOAD_WIDGET = "remote_payload";
const LIVE_WIDGET = "enabled";
const POLL_MS = 100;

let timer = null;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isRemote(node) {
  return nodeType(node) === REMOTE_TYPE;
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

function remoteNodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []).filter(isRemote);
}

function decodePayload(node) {
  const payload = widget(node, PAYLOAD_WIDGET)?.value;
  const text = String(payload ?? "").trim();
  const outputType = String(node.outputs?.[0]?.type || "").toUpperCase();

  if (text.startsWith("b:")) {
    const raw = text.slice(2).trim().toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }
  if (text.startsWith("i:")) {
    const value = Number.parseInt(text.slice(2), 10);
    return Number.isFinite(value) ? value : 1;
  }

  if (outputType === "BOOLEAN") {
    if (typeof payload === "boolean") return payload;
    const raw = text.toLowerCase();
    return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
  }
  if (outputType === "INT") {
    const value = Number.parseInt(payload, 10);
    return Number.isFinite(value) ? value : 1;
  }
  return payload;
}

function ensureLiveWidget(node) {
  let live = widget(node, LIVE_WIDGET);
  if (!live && typeof node.addWidget === "function") {
    live = node.addWidget("text", LIVE_WIDGET, false, () => {}, {});
  }
  if (!live) return null;

  // This is a frontend-only mirror of the executable remote output.  Keep it
  // first in the widget array because TerryXu switch inputs inspect the first
  // upstream widget for a live value before the graph is queued.  It is hidden
  // and never serialized, so the visible remote UI keeps its normal order.
  const list = node.widgets || [];
  const index = list.indexOf(live);
  if (index > 0) {
    list.splice(index, 1);
    list.unshift(live);
  }

  live.hidden = true;
  live.serialize = false;
  live.options ||= {};
  live.options.hidden = true;
  live.options.serialize = false;
  if (!live.__terryRemoteLiveComputeSize) {
    live.__terryRemoteLiveComputeSize = live.computeSize;
    live.computeSize = () => [0, -4];
  }
  for (const key of ["element", "inputEl"]) {
    const element = live[key];
    if (element?.style) element.style.display = "none";
  }
  return live;
}

function syncRemote(node) {
  if (!isRemote(node)) return false;
  const live = ensureLiveWidget(node);
  if (!live) return false;
  const value = decodePayload(node);
  const changed = live.value !== value || typeof live.value !== typeof value;
  if (changed) live.value = value;

  // For BOOLEAN remotes this hidden widget is deliberately named `enabled`.
  // Besides fixing TerryXuBoolSwitch live input reading, the group-switch
  // external BOOLEAN controller can now read the same remote output directly.
  if (changed) {
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
  }
  return true;
}

function syncAll() {
  const remotes = remoteNodes();
  for (const remote of remotes) syncRemote(remote);
  return remotes.length > 0;
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

function patchRemoteType(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terryRemoteLiveBridgePatched) return;
  nodeTypeClass.prototype.__terryRemoteLiveBridgePatched = true;

  const created = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    queueMicrotask(() => { syncRemote(this); startTimer(); });
    return result;
  };

  const configured = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = configured?.apply(this, arguments);
    queueMicrotask(() => { syncRemote(this); startTimer(); });
    return result;
  };

  const changed = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function () {
    const result = changed?.apply(this, arguments);
    queueMicrotask(() => syncRemote(this));
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.RemoteControlLiveBridge",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (nodeData?.name === REMOTE_TYPE) patchRemoteType(nodeTypeClass);
  },

  nodeCreated(node) {
    if (!isRemote(node)) return;
    queueMicrotask(() => { syncRemote(node); startTimer(); });
  },

  loadedGraphNode(node) {
    if (!isRemote(node)) return;
    queueMicrotask(() => { syncRemote(node); startTimer(); });
  },

  afterConfigureGraph() {
    if (syncAll()) startTimer();
  },
});
