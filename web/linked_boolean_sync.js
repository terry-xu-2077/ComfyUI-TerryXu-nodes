import { app } from "../../scripts/app.js";

const NODE_TYPE = "TerryXuLinkedBoolean";
const BOOL_SWITCH_TYPE = "TerryXuBoolSwitch";
const LIVE_WIDGET = "terry_linked_bool_live";
const SOURCE_WIDGET = "enabled";
const BOOL_PROPERTY = "terry_bool_switch_state";
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

function inputByName(node, name) {
  return (node?.inputs || []).find((item) => item?.name === name) || null;
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

function graphLinks(graph) {
  const out = [];
  const seen = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    const values = typeof bag.values === "function" ? bag.values() : Object.values(bag);
    for (const link of values) {
      if (!link) continue;
      const id = link.id ?? link.link_id ?? link.linkId ?? link;
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

function graphNode(graph, id) {
  if (!graph || id == null) return null;
  return graph.getNodeById?.(id)
    || graph.getNodeById?.(String(id))
    || (Number.isFinite(Number(id)) ? graph.getNodeById?.(Number(id)) : null)
    || null;
}

function outgoingLinks(graph, node, outputSlot = null) {
  if (!graph || !node) return [];
  return graphLinks(graph).filter((link) => {
    const originId = link?.origin_id ?? link?.originId;
    if (String(originId) !== String(node.id)) return false;
    if (outputSlot == null) return true;
    return Number(link?.origin_slot ?? link?.originSlot ?? 0) === Number(outputSlot);
  });
}

function applyBoolSwitch(target, targetSlot, value) {
  if (nodeType(target) !== BOOL_SWITCH_TYPE) return false;
  const input = target?.inputs?.[Number(targetSlot) || 0] || null;
  if (input && String(input.name || "") !== "enabled") return false;

  const next = Boolean(value);
  const control = widget(target, "enabled");
  if (control) control.value = next;
  target.__terryRuntimeBool = next;
  target.properties ||= {};
  target.properties[BOOL_PROPERTY] = next;
  globalThis.__terrySyncSwitchUI?.(target);
  target.graph?.setDirtyCanvas?.(true, true);
  target.setDirtyCanvas?.(true, true);
  return true;
}

function propagateValueFrom(node, value) {
  const graph = node?.graph;
  if (!graph) return;

  const queue = outgoingLinks(graph, node, 0);
  const seenLinks = new Set();
  while (queue.length) {
    const link = queue.shift();
    const linkId = link?.id ?? link?.link_id ?? link?.linkId ?? link;
    const key = String(linkId);
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);

    const targetId = link?.target_id ?? link?.targetId;
    const targetSlot = Number(link?.target_slot ?? link?.targetSlot ?? 0) || 0;
    const target = graphNode(graph, targetId);
    if (!target) continue;

    if (applyBoolSwitch(target, targetSlot, value)) continue;

    const type = nodeType(target).toLowerCase();
    if ((type === "reroute" || type.endsWith("reroute")) && target.outputs?.length) {
      queue.push(...outgoingLinks(graph, target, 0));
    }
  }
}

function ensureLiveWidget(node) {
  let live = widget(node, LIVE_WIDGET);
  if (!live && typeof node.addWidget === "function") {
    live = node.addWidget("text", LIVE_WIDGET, false, () => {}, {});
  }
  if (!live) return null;

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

  // Do not rely on widget-array ordering for connected BOOLEAN consumers.
  // The linked switch has a channel DOM widget that can legitimately move to
  // the front of node.widgets, so push the actual boolean value to a connected
  // two-way switch directly. This also keeps the route preview live without
  // requiring a workflow execution.
  propagateValueFrom(node, value);
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

  const connections = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function () {
    const result = connections?.apply(this, arguments);
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
