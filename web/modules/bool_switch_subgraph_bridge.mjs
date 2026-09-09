import { app } from "../../scripts/app.js";

const BOOL_SOURCE_TYPE = "TerryXuBooleanSwitch";
const TWO_WAY_TYPE = "TerryXuBoolSwitch";
const BOOL_PROPERTY = "terry_bool_switch_state";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isBooleanSource(node) { return nodeType(node) === BOOL_SOURCE_TYPE; }
function isTwoWay(node) { return nodeType(node) === TWO_WAY_TYPE; }

function getLink(graph, id) {
  if (!graph || id == null) return null;
  for (const bag of [graph.links, graph._links]) {
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

function getNode(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function enabledWidget(node) {
  return (node?.widgets || []).find((widget) => widget?.name === "enabled") || null;
}

function sourceValue(node) {
  const widget = enabledWidget(node);
  if (widget?.value !== undefined) return Boolean(widget.value);
  if (node?.__terryRuntimeBool !== undefined) return Boolean(node.__terryRuntimeBool);
  return Boolean(properties(node)[BOOL_PROPERTY]);
}

function applyTwoWayState(node, value) {
  if (!isTwoWay(node)) return;
  const next = Boolean(value);
  node.__terryRuntimeBool = next;
  properties(node)[BOOL_PROPERTY] = next;

  // The enabled widget is still the fallback value used when the socket is
  // disconnected later. Keep it in sync without firing another graph change.
  const widget = enabledWidget(node);
  if (widget && widget.value !== next) widget.value = next;

  globalThis.__terrySyncSwitchUI?.(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function slotLinkIds(slot) {
  const ids = slot?.linkIds ?? slot?.links ?? [];
  if (ids == null) return [];
  if (typeof ids.values === "function" && !Array.isArray(ids)) return [...ids.values()];
  return Array.isArray(ids) ? ids : [...ids];
}

function propagateIntoSubgraph(subgraphNode, inputSlotIndex, value, visited) {
  const subgraph = subgraphNode?.subgraph;
  const inputSlot = subgraph?.inputNode?.slots?.[Number(inputSlotIndex) || 0];
  if (!subgraph || !inputSlot) return;

  const visitKey = `${String(subgraph?.id || "subgraph")}:${Number(inputSlotIndex) || 0}`;
  if (visited.has(visitKey)) return;
  visited.add(visitKey);

  for (const linkId of slotLinkIds(inputSlot)) {
    const link = getLink(subgraph, linkId);
    if (!link) continue;

    const targetId = link.target_id ?? link.targetId;
    const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
    const target = getNode(subgraph, targetId);
    if (!target) continue;

    if (target?.subgraph) {
      propagateIntoSubgraph(target, targetSlot, value, visited);
      continue;
    }

    const inputName = String(target?.inputs?.[targetSlot]?.name || "");
    if (isTwoWay(target) && inputName === "enabled") {
      applyTwoWayState(target, value);
    }
  }
}

function propagateFromSource(source, value = sourceValue(source)) {
  if (!isBooleanSource(source) || !source?.graph) return;
  const output = source.outputs?.[0];
  const linkIds = output?.links || [];
  const visited = new Set();

  for (const linkId of linkIds) {
    const link = getLink(source.graph, linkId);
    if (!link) continue;

    const targetId = link.target_id ?? link.targetId;
    const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
    const target = getNode(source.graph, targetId);
    if (!target) continue;

    if (target?.subgraph) {
      propagateIntoSubgraph(target, targetSlot, value, visited);
      continue;
    }

    const inputName = String(target?.inputs?.[targetSlot]?.name || "");
    if (isTwoWay(target) && inputName === "enabled") {
      applyTwoWayState(target, value);
    }
  }
}

function syncSoon(node) {
  queueMicrotask(() => propagateFromSource(node));
  setTimeout(() => propagateFromSource(node), 0);
}

function patchBooleanSource(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terrySubgraphBoolBridgePatched) return;
  nodeTypeClass.prototype.__terrySubgraphBoolBridgePatched = true;

  const oldCreated = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = oldCreated?.apply(this, arguments);
    syncSoon(this);
    return result;
  };

  const oldConfigure = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = oldConfigure?.apply(this, arguments);
    syncSoon(this);
    return result;
  };

  const oldConnections = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function () {
    const result = oldConnections?.apply(this, arguments);
    syncSoon(this);
    return result;
  };

  const oldWidgetChanged = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function (name, value) {
    const result = oldWidgetChanged?.apply(this, arguments);
    if (name === "enabled") {
      propagateFromSource(this, Boolean(value));
    }
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.BooleanSubgraphBridge",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (String(nodeData?.name || "") === BOOL_SOURCE_TYPE) patchBooleanSource(nodeTypeClass);
  },

  nodeCreated(node) {
    if (isBooleanSource(node)) syncSoon(node);
  },

  loadedGraphNode(node) {
    if (isBooleanSource(node)) syncSoon(node);
  },

  afterConfigureGraph() {
    for (const node of app.graph?._nodes || []) {
      if (isBooleanSource(node)) syncSoon(node);
    }
  },
});
