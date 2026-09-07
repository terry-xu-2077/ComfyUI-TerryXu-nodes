import { app } from "../../scripts/app.js";

const WIRED_PACK_TYPE = "TerryXuWireBusPack";
const WIRED_UNPACK_TYPE = "TerryXuWireBusUnpack";
const WIRELESS_PACK_TYPE = "TerryXuWirelessBusPack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const MODE_PROPERTY = "terry_wire_bus_expand_outputs";
const MODE_WIDGET = "terry_bus_expand_outputs";
const CHANNEL_CONTROL_WIDGET = "terry_wireless_channel_control";
const CHANNEL_PROPERTY = "terry_wireless_bus_channel";
const UNPACK_LANES_PROPERTY = "terry_wire_bus_lane_ids";
const LANE_FIELD = "terry_lane_id";
const BUS_OUTPUT_FIELD = "terry_bus_passthrough_output";
const MODE_ROW_HEIGHT = 28;
const WIRELESS_CHANNEL_BLOCK_HEIGHT = 40;

function localeCode() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  } catch {
    return String(navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  }
}

function isChinese() {
  const locale = localeCode();
  return locale === "zh" || locale.startsWith("zh-");
}

function text() {
  return isChinese()
    ? { expand: "散开输出", bus: "总线" }
    : { expand: "Expand outputs", bus: "Bus" };
}

function nodeType(node) {
  return String(
    node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || ""
  );
}

function isWiredPack(node) { return nodeType(node) === WIRED_PACK_TYPE; }
function isWirelessPack(node) { return nodeType(node) === WIRELESS_PACK_TYPE; }
function isPack(node) { return isWiredPack(node) || isWirelessPack(node); }
function isWiredUnpack(node) { return nodeType(node) === WIRED_UNPACK_TYPE; }
function isWirelessUnpack(node) { return nodeType(node) === WIRELESS_UNPACK_TYPE; }
function isUnpack(node) { return isWiredUnpack(node) || isWirelessUnpack(node); }
function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}
function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function expandedMode(node) {
  return properties(node)[MODE_PROPERTY] !== false;
}

function modeWidget(node) {
  return (node?.widgets || []).find((item) => item?.name === MODE_WIDGET) || null;
}

function ensureModeWidgetOrder(node) {
  if (!isWirelessUnpack(node)) return;
  const widgets = node?.widgets || [];
  const mode = modeWidget(node);
  const channel = widgets.find((item) => item?.name === CHANNEL_CONTROL_WIDGET);
  if (!mode || !channel) return;
  const modeIndex = widgets.indexOf(mode);
  const channelIndex = widgets.indexOf(channel);
  if (modeIndex < 0 || channelIndex < 0 || modeIndex > channelIndex) return;
  widgets.splice(modeIndex, 1);
  const nextChannelIndex = widgets.indexOf(channel);
  widgets.splice(nextChannelIndex + 1, 0, mode);
}

function ensureModeLayout(node) {
  if (!isUnpack(node) || !modeWidget(node) || node.flags?.collapsed) return;

  ensureModeWidgetOrder(node);

  const currentHeight = Math.max(0, Number(node.size?.[1]) || 0);
  const previousExtra = Math.max(0, Number(node.__terryBusOutputModeExtraApplied) || 0);
  const preferredBase = Math.max(
    0,
    Number(node.__terryBusPreferredHeight) || 0,
    Number(node.__terryBusMinHeight) || 0
  );
  const inferredBase = Math.max(0, currentHeight - previousExtra);
  const baseHeight = preferredBase || inferredBase;
  const desiredHeight = Math.max(currentHeight, baseHeight + MODE_ROW_HEIGHT);

  node.__terryBusOutputModeExtraApplied = MODE_ROW_HEIGHT;
  if (Math.abs(desiredHeight - currentHeight) > 0.5) {
    const width = Math.max(112, Number(node.size?.[0]) || 112);
    node.setSize?.([width, desiredHeight]);
  }

  const finalHeight = Math.max(desiredHeight, Number(node.size?.[1]) || 0);
  node.widgets_start_y = isWirelessUnpack(node)
    ? Math.max(0, finalHeight - WIRELESS_CHANNEL_BLOCK_HEIGHT - MODE_ROW_HEIGHT)
    : Math.max(0, finalHeight - MODE_ROW_HEIGHT);

  node.__terryBusExpandedSize = [
    Math.max(112, Number(node.size?.[0]) || 112),
    finalHeight,
  ];
  node.graph?.setDirtyCanvas?.(true, true);
}

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const found = links.get(linkId) ?? links.get(String(linkId));
      if (found) return found;
    }
    const found = links[linkId] ?? links[String(linkId)];
    if (found) return found;
  }
  return null;
}

function getNode(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

function allGraphs(root = app.graph) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root.rootGraph || root];
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
      for (const value of values) queue.push(value?.subgraph || value);
    }
  }
  return result;
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  for (const graph of allGraphs(getNode?.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if (isSet(node) && variableName(node) === name) return { node, graph };
    }
  }
  return null;
}

function wirelessChannelName(node) {
  const widget = (node?.widgets || []).find((item) => item?.terryWirelessChannel === true);
  return String(widget?.value ?? node?.properties?.[CHANNEL_PROPERTY] ?? "").trim();
}

function findWirelessPack(unpack) {
  const channel = wirelessChannelName(unpack);
  if (!channel) return null;
  for (const graph of allGraphs(unpack?.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if (isWirelessPack(node) && wirelessChannelName(node) === channel) return node;
    }
  }
  return null;
}

function resolvePackFromLink(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${String(graph?.id || "g")}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = getLink(graph, linkId);
  if (!link) return null;
  const originId = link.origin_id ?? link.originId;
  const originSlot = Number(link.origin_slot ?? link.originSlot ?? 0) || 0;
  const origin = getNode(graph, originId);
  if (!origin) return null;
  if (isPack(origin)) return origin;

  if (isReroute(origin)) {
    return resolvePackFromLink(origin.graph || graph, origin.inputs?.[0]?.link, seen);
  }

  if (isGet(origin)) {
    const setter = findSetter(origin);
    return setter?.node?.inputs?.[0]?.link == null
      ? null
      : resolvePackFromLink(setter.graph, setter.node.inputs[0].link, seen);
  }

  if (isUnpack(origin) && String(origin.outputs?.[originSlot]?.type || "") === BUS_TYPE) {
    return resolvePack(origin, seen);
  }

  try {
    const resolved = origin.resolveVirtualOutput?.(originSlot);
    if (resolved?.node) {
      if (isPack(resolved.node)) return resolved.node;
      if (isUnpack(resolved.node)) return resolvePack(resolved.node, seen);
    }
  } catch {}
  return null;
}

function resolvePack(unpack, seen = new Set()) {
  if (!isUnpack(unpack)) return null;
  const key = `unpack:${String(unpack?.graph?.id || "g")}:${String(unpack.id)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const linkId = unpack.inputs?.[0]?.link;
  if (linkId != null) {
    const wired = resolvePackFromLink(unpack.graph, linkId, seen);
    if (wired) return wired;
  }
  return isWirelessUnpack(unpack) ? findWirelessPack(unpack) : null;
}

function disconnectOutputLinks(node, outputIndex) {
  const output = node.outputs?.[outputIndex];
  for (const linkId of [...(output?.links || [])]) {
    const link = getLink(node.graph, linkId);
    if (!link) continue;
    const target = getNode(node.graph, link.target_id ?? link.targetId);
    if (target) {
      node.disconnectOutput?.(outputIndex, target, Number(link.target_slot ?? link.targetSlot ?? 0) || 0);
    }
  }
}

function removeAllOutputs(node) {
  for (let index = (node.outputs?.length || 0) - 1; index >= 0; index--) {
    disconnectOutputLinks(node, index);
    node.removeOutput?.(index);
  }
}

function ensureBusOutput(node) {
  if (!isUnpack(node) || expandedMode(node) || node.__terryApplyingBusOutputMode) return;
  node.__terryApplyingBusOutputMode = true;
  try {
    const labels = text();
    const current = node.outputs || [];
    const alreadyBusOnly = current.length === 1
      && String(current[0]?.type || "") === BUS_TYPE
      && current[0]?.[BUS_OUTPUT_FIELD] === true;

    if (!alreadyBusOnly) {
      removeAllOutputs(node);
      const added = node.addOutput?.("bus", BUS_TYPE);
      const output = node.outputs?.[0] || added;
      if (output) {
        output.name = "bus";
        output.label = labels.bus;
        output.type = BUS_TYPE;
        output[BUS_OUTPUT_FIELD] = true;
        delete output[LANE_FIELD];
      }
    } else {
      current[0].name = "bus";
      current[0].label = labels.bus;
      current[0].type = BUS_TYPE;
    }

    properties(node)[UNPACK_LANES_PROPERTY] = [];
    node.graph?.setDirtyCanvas?.(true, true);
  } finally {
    node.__terryApplyingBusOutputMode = false;
  }
}

function restoreExpandedOutputs(node) {
  if (!isUnpack(node) || !expandedMode(node) || node.__terryApplyingBusOutputMode) return;
  if (!(node.outputs || []).some((output) => output?.[BUS_OUTPUT_FIELD] === true)) return;

  node.__terryApplyingBusOutputMode = true;
  try {
    removeAllOutputs(node);
    const pack = resolvePack(node);
    const entries = pack?.__terryBusLaneEntries?.() || [];
    for (const entry of entries) {
      const added = node.addOutput?.(entry?.name || text().bus, entry?.type || "*");
      const output = node.outputs?.[node.outputs.length - 1] || added;
      if (!output) continue;
      output.name = entry?.name || output.name;
      output.label = output.name;
      output.type = entry?.type || "*";
      if (entry?.laneId) output[LANE_FIELD] = entry.laneId;
    }
    properties(node)[UNPACK_LANES_PROPERTY] = (node.outputs || []).map(
      (output) => output?.[LANE_FIELD] || ""
    );
    node.__terryBusSignature = null;
    node.graph?.setDirtyCanvas?.(true, true);
  } finally {
    node.__terryApplyingBusOutputMode = false;
  }
}

function setExpandedMode(node, value, notify = true) {
  const next = Boolean(value);
  properties(node)[MODE_PROPERTY] = next;
  const widget = modeWidget(node);
  if (widget && widget.value !== next) widget.value = next;
  if (next) restoreExpandedOutputs(node);
  else ensureBusOutput(node);
  ensureModeLayout(node);
  if (notify) node.graph?.change?.();
}

function ensureModeWidget(node) {
  if (!isUnpack(node)) return;
  const existing = modeWidget(node);
  if (existing) {
    existing.label = text().expand;
    existing.options ||= {};
    existing.options.on = text().expand;
    existing.options.off = text().bus;
    if (existing.value !== expandedMode(node)) existing.value = expandedMode(node);
    ensureModeLayout(node);
    return;
  }
  if (properties(node)[MODE_PROPERTY] == null) properties(node)[MODE_PROPERTY] = true;
  const widget = node.addWidget?.(
    "toggle",
    MODE_WIDGET,
    expandedMode(node),
    (value) => setExpandedMode(node, value),
    { on: text().expand, off: text().bus }
  );
  if (widget) {
    widget.label = text().expand;
    widget.serialize = false;
  }
  ensureModeLayout(node);
}

function wrapBusRefresh(node) {
  if (!isUnpack(node)) return;
  const current = node.__terryBusRefreshVisual;
  if (typeof current !== "function" || current.__terryBusOutputModeWrapped) return;
  const original = current;
  const wrapped = function () {
    if (!expandedMode(node)) ensureBusOutput(node);
    const result = original.apply(this, arguments);
    if (!expandedMode(node)) ensureBusOutput(node);
    ensureModeLayout(node);
    return result;
  };
  wrapped.__terryBusOutputModeWrapped = true;
  wrapped.__terryBusOutputModeOriginal = original;
  node.__terryBusRefreshVisual = wrapped;
}

function installNode(node) {
  if (!isUnpack(node)) return;
  ensureModeWidget(node);
  wrapBusRefresh(node);
  if (expandedMode(node)) restoreExpandedOutputs(node);
  else ensureBusOutput(node);
  ensureModeLayout(node);
}

function patchUnpackClass(nodeTypeClass) {
  if (!nodeTypeClass?.prototype || nodeTypeClass.prototype.__terryBusOutputModePatched) return;
  const proto = nodeTypeClass.prototype;
  proto.__terryBusOutputModePatched = true;

  const originalComputeSize = proto.computeSize;
  proto.computeSize = function () {
    const size = originalComputeSize?.apply(this, arguments) || [112, 96];
    if (Array.isArray(size) && !this.flags?.collapsed) {
      size[1] = Math.max(0, Number(size[1]) || 0) + MODE_ROW_HEIGHT;
    }
    return size;
  };

  const originalCreated = proto.onNodeCreated;
  proto.onNodeCreated = function () {
    const result = originalCreated?.apply(this, arguments);
    queueMicrotask(() => installNode(this));
    return result;
  };

  const originalConfigure = proto.onConfigure;
  proto.onConfigure = function () {
    const result = originalConfigure?.apply(this, arguments);
    queueMicrotask(() => installNode(this));
    return result;
  };

  const originalConnections = proto.onConnectionsChange;
  proto.onConnectionsChange = function () {
    const result = originalConnections?.apply(this, arguments);
    if (!this.__terryApplyingBusOutputMode) queueMicrotask(() => installNode(this));
    return result;
  };

  const originalResolveVirtualOutput = proto.resolveVirtualOutput;
  proto.resolveVirtualOutput = function (slot) {
    if (!expandedMode(this) && Number(slot) === 0) {
      const pack = resolvePack(this);
      if (pack) return { node: pack, slot: 0 };
    }
    return originalResolveVirtualOutput?.apply(this, arguments);
  };
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => {
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) installNode(node);
    }
  }, 300);
}

app.registerExtension({
  name: "TerryXu.WireBusOutputMode",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    const name = String(nodeData?.name || "");
    if (name === WIRED_UNPACK_TYPE || name === WIRELESS_UNPACK_TYPE) patchUnpackClass(nodeTypeClass);
  },

  setup() {
    start();
    queueMicrotask(() => {
      for (const graph of allGraphs()) for (const node of graph?._nodes || []) installNode(node);
    });
  },

  nodeCreated(node) {
    if (isUnpack(node)) queueMicrotask(() => installNode(node));
  },

  loadedGraphNode(node) {
    if (isUnpack(node)) queueMicrotask(() => installNode(node));
  },

  afterConfigureGraph() {
    start();
    queueMicrotask(() => {
      for (const graph of allGraphs()) for (const node of graph?._nodes || []) installNode(node);
    });
  },
});
