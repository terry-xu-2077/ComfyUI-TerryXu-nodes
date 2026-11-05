import { app } from "../../scripts/app.js";
import { showTextPrompt, showConfirm } from "./terry_dialog.js";

const WIRELESS_PACK_TYPE = "TerryXuWirelessBusPack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const EMPTY_TYPE = "*";
const LANE_FIELD = "terry_lane_id";
const PACK_LANES_PROPERTY = "terry_wire_bus_lanes";
const PACK_NAMED_LANES_PROPERTY = "terry_wire_bus_named_lanes";
const WIRELESS_CHANNEL_PROPERTY = "terry_wireless_bus_channel";
const PENCIL = "✎";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isPack(node) { return nodeType(node) === WIRELESS_PACK_TYPE; }
function isUnpack(node) { return nodeType(node) === WIRELESS_UNPACK_TYPE; }
function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}
function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function localeCode() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  } catch {
    return String(navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  }
}

function isChineseLocale() {
  const locale = localeCode();
  return locale === "zh" || locale.startsWith("zh-");
}

function labels() {
  return isChineseLocale()
    ? {
        input: "线束",
        rename: "重命名线束",
        confirmDelete: (name) => `确定删除线束“${name}”吗？\n\n删除后，该线束的输入连接、总线-出对应端口及其下游连线都会被移除。`,
      }
    : {
        input: "Lane",
        rename: "Rename lane",
        confirmDelete: (name) => `Delete lane “${name}”?\n\nIts input connection, matching Bus-Out port, and downstream links will also be removed.`,
      };
}

function nodeProperties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function manualLaneNames(pack) {
  const properties = nodeProperties(pack);
  const current = properties[PACK_NAMED_LANES_PROPERTY];
  if (!current || typeof current !== "object" || Array.isArray(current)) {
    properties[PACK_NAMED_LANES_PROPERTY] = {};
  }
  return properties[PACK_NAMED_LANES_PROPERTY];
}

function graphLink(graph, id) {
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

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function wirelessChannelName(node) {
  const widget = (node?.widgets || []).find((item) => item?.terryWirelessChannel === true);
  return String(widget?.value ?? node?.properties?.[WIRELESS_CHANNEL_PROPERTY] ?? "").trim();
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  const graph = getNode?.graph || app.graph;
  for (const node of graph?._nodes || []) {
    if (isSet(node) && variableName(node) === name) return node;
  }
  for (const node of app.graph?._nodes || []) {
    if (isSet(node) && variableName(node) === name) return node;
  }
  return null;
}

function resolveSource(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${graph?.id || "g"}:${linkId}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = graphLink(graph, linkId);
  if (!link) return null;
  const source = graph.getNodeById?.(link.origin_id ?? link.originId);
  if (!source) return null;
  const slot = Number(link.origin_slot ?? link.originSlot ?? 0) || 0;

  if (isReroute(source)) return resolveSource(graph, source.inputs?.[0]?.link, seen);
  if (isGet(source)) {
    const setter = findSetter(source);
    if (setter?.inputs?.[0]?.link != null) return resolveSource(setter.graph || graph, setter.inputs[0].link, seen);
  }
  if (isUnpack(source)) {
    const pack = findPackForUnpack(source);
    const laneId = source.outputs?.[slot]?.[LANE_FIELD];
    const entry = pack?.__terryBusLaneEntries?.().find((item) => item?.laneId === laneId);
    const input = entry?.input
      || (pack?.inputs || []).find((item) => item?.[LANE_FIELD] === laneId);
    return input?.link == null
      ? null
      : resolveSource(entry?.inputGraph || pack.graph || graph, input.link, seen);
  }
  return { node: source, slot, output: source.outputs?.[slot] || null };
}

function cleanName(value) {
  const text = String(value ?? "").trim();
  return text && text !== EMPTY_TYPE ? text : "";
}

function stripDecorations(value) {
  let text = String(value ?? "").trim();
  text = text.replace(/^\[(?:空|Empty)\]\s*/i, "");
  text = text.replace(/\s*(?:✎|❌|×|✕)+\s*$/gu, "").trim();
  return text.startsWith("lane_") || text === "wire" ? "" : text;
}

function preferredPortName(source) {
  const output = source?.output;
  if (!output) return "";
  const type = cleanName(output.type).toUpperCase();
  const label = cleanName(output.label);
  const name = cleanName(output.name);
  const localized = cleanName(output.localized_name);
  const semantic = (value) => value && value.toUpperCase() !== type;

  // Subgraph outputs can expose the translated data type as their label while
  // retaining the user-defined port name in its name field.
  if (semantic(label) && (label !== localized || !semantic(name))) return label;
  if (semantic(name)) return name;
  if (semantic(label)) return label;
  return semantic(localized) ? localized : "";
}

function fallbackType(source, input) {
  return cleanName(source?.output?.type || input?.type || EMPTY_TYPE) || "Input";
}

function findPackForUnpack(unpack) {
  if (nodeType(unpack) === WIRELESS_UNPACK_TYPE) {
    const physical = resolveSource(unpack?.graph, unpack?.inputs?.[0]?.link);
    if (physical && nodeType(physical.node) === WIRELESS_PACK_TYPE) return physical.node;
    const name = wirelessChannelName(unpack);
    if (!name) return null;
    for (const graph of [unpack.graph, app.graph]) {
      const pack = (graph?._nodes || []).find((node) =>
        nodeType(node) === WIRELESS_PACK_TYPE && wirelessChannelName(node) === name
      );
      if (pack) return pack;
    }
    return null;
  }
  return null;
}

function namedEntries(pack) {
  const entries = [];
  const manualNames = manualLaneNames(pack);
  for (const input of pack?.inputs || []) {
    const laneId = String(input?.[LANE_FIELD] || "").trim();
    if (!input || !laneId || input.link == null || input.type === BUS_TYPE) continue;
    const source = resolveSource(pack.graph, input.link);
    if (!source) continue;
    const manualName = String(manualNames[laneId] || "").trim();
    const semantic = manualName ? "" : preferredPortName(source);
    const base = manualName || semantic || fallbackType(source, input);
    entries.push({ laneId, input, source, base, manualName });
  }

  const totals = new Map();
  for (const entry of entries) totals.set(entry.base, (totals.get(entry.base) || 0) + 1);
  const seen = new Map();
  for (const entry of entries) {
    const n = (seen.get(entry.base) || 0) + 1;
    seen.set(entry.base, n);
    entry.label = (totals.get(entry.base) || 0) > 1 ? `${entry.base} ${n}` : entry.base;
  }
  return entries;
}

function laneRecords(pack) {
  const manualNames = manualLaneNames(pack);
  const stored = Array.isArray(pack?.properties?.[PACK_LANES_PROPERTY])
    ? pack.properties[PACK_LANES_PROPERTY]
    : [];
  let ordinal = 0;
  return (pack?.inputs || []).flatMap((input, inputIndex) => {
    const laneId = String(input?.[LANE_FIELD] || "").trim();
    if (!input || !laneId || input.type === BUS_TYPE) return [];
    ordinal += 1;
    const manualName = String(manualNames[laneId] || "").trim();
    const storedName = String(stored.find((lane) => lane?.id === laneId)?.name || "").trim();
    const currentName = stripDecorations(input.label || input.name);
    const label = manualName || currentName || storedName || `${labels().input} ${ordinal}`;
    return [{
      input,
      inputIndex,
      laneId,
      ordinal,
      named: Boolean(manualName),
      label,
    }];
  });
}

function upstreamPackForBusInput(pack, input, seen = new Set()) {
  const graph = pack?.graph;
  const linkId = input?.link;
  if (!graph || linkId == null) return null;
  const key = `${graph?.id || "g"}:${linkId}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = graphLink(graph, linkId);
  const source = graph.getNodeById?.(link?.origin_id ?? link?.originId);
  if (isPack(source)) return source;
  if (isUnpack(source)) return findPackForUnpack(source);
  if (isReroute(source)) return upstreamPackForBusInput(pack, source.inputs?.[0], seen);
  if (isGet(source)) {
    const setter = findSetter(source);
    return setter?.inputs?.[0]
      ? upstreamPackForBusInput(setter, setter.inputs[0], seen)
      : null;
  }

  const resolved = resolveSource(graph, linkId);
  return resolved && isPack(resolved.node) ? resolved.node : null;
}

function findLaneOwner(pack, laneId, seen = new Set()) {
  if (!pack || !laneId || seen.has(pack)) return null;
  seen.add(pack);

  const entry = laneRecords(pack).find((item) => item.laneId === laneId);
  if (entry) return { pack, entry };

  const busInput = (pack.inputs || []).find((input) =>
    input?.type === BUS_TYPE && input.link != null
  );
  const upstream = upstreamPackForBusInput(pack, busInput);
  return upstream ? findLaneOwner(upstream, laneId, seen) : null;
}

function outputRenameEntries(unpack) {
  if (!isUnpack(unpack)) return [];
  const pairedPack = findPackForUnpack(unpack);
  if (!pairedPack) return [];

  return (unpack.outputs || []).flatMap((output) => {
    const laneId = String(output?.[LANE_FIELD] || "").trim();
    if (!output || !laneId || output.type === BUS_TYPE) return [];
    const owner = findLaneOwner(pairedPack, laneId);
    if (!owner) return [];
    const label = stripDecorations(output.label || output.name) || owner.entry.label;
    return [{
      output,
      laneId,
      pack: owner.pack,
      entry: { ...owner.entry, label },
    }];
  });
}

function syncNodes2OutputLabels(unpack) {
  if (typeof document === "undefined") return;
  const root = [...document.querySelectorAll("[data-node-id]")]
    .find((element) => String(element.getAttribute("data-node-id")) === String(unpack?.id));
  if (!root) return;

  const rows = [...root.querySelectorAll(".lg-slot--output")];
  const entries = outputRenameEntries(unpack);
  rows.forEach((row, index) => {
    const entry = entries[index];
    if (!entry) return;
    row.classList.add("terry-wire-bus-renamable-output");
    const span = row.querySelector(".text-node-component-slot-text");
    if (span) span.textContent = `${entry.label}   ${PENCIL}`;
  });
}

function syncNodes2InputLabels(pack) {
  if (typeof document === "undefined") return;
  const root = [...document.querySelectorAll("[data-node-id]")]
    .find((element) => String(element.getAttribute("data-node-id")) === String(pack?.id));
  if (!root) return;

  const rows = [...root.querySelectorAll(".lg-slot--input")]
    .filter((row) => {
      const span = row.querySelector(".text-node-component-slot-text");
      return String(span?.textContent || row.textContent || "").includes(PENCIL);
    });
  const entries = laneRecords(pack);
  rows.forEach((row, index) => {
    const entry = entries[index];
    if (!entry) return;
    row.classList.toggle("terry-wire-bus-named-lane", entry.named);
    const span = row.querySelector(".text-node-component-slot-text");
    if (span) span.textContent = `${entry.label}   ${PENCIL}`;
  });
}

function syncPackLabels(pack) {
  if (!isPack(pack)) return;
  const manualNames = manualLaneNames(pack);
  const stored = Array.isArray(pack.properties?.[PACK_LANES_PROPERTY])
    ? pack.properties[PACK_LANES_PROPERTY]
    : [];
  for (const input of pack.inputs || []) {
    const laneId = String(input?.[LANE_FIELD] || "").trim();
    if (!laneId || input.type === BUS_TYPE) continue;
    const current = String(input.label || input.name || "");
    const emptyPrefix = current.match(/^\[(?:空|Empty)\]\s*/i)?.[0] || "";
    const manualName = String(manualNames[laneId] || "").trim();
    const storedName = String(stored.find((lane) => lane?.id === laneId)?.name || "").trim();
    const displayName = manualName || stripDecorations(current) || storedName || labels().input;
    input.label = `${emptyPrefix}${displayName}   ${PENCIL}${manualName ? "   ❌" : ""}`;
  }
  syncNodes2InputLabels(pack);
}

function applyNames(pack) {
  if (!isPack(pack) || !pack.graph) return;
  const entries = namedEntries(pack);
  const records = laneRecords(pack);

  for (const entry of entries) {
    entry.input.name = entry.label;
    entry.input.label = `${entry.label}   ${PENCIL}${entry.manualName ? "   ❌" : ""}`;
    const stored = (pack.properties?.[PACK_LANES_PROPERTY] || [])
      .find((lane) => lane?.id === entry.laneId);
    if (stored) stored.name = entry.label;
  }

  for (const node of allNodes()) {
    if (!isUnpack(node)) continue;
    for (const output of node.outputs || []) {
      const laneId = String(output?.[LANE_FIELD] || "").trim();
      if (!laneId || output.type === BUS_TYPE) continue;
      const owner = findLaneOwner(findPackForUnpack(node), laneId);
      if (owner?.pack !== pack) continue;

      const connectedEntry = entries.find((item) => item.laneId === laneId);
      const storedEntry = records.find((item) => item.laneId === laneId);
      const displayName = connectedEntry?.label || (storedEntry?.named ? storedEntry.label : "");
      if (!displayName) continue;

      output.name = displayName;
      output.label = `${displayName}   ${PENCIL}`;
    }
    syncNodes2OutputLabels(node);
    node.setDirtyCanvas?.(true, true);
  }

  syncPackLabels(pack);
  pack.setDirtyCanvas?.(true, true);
}

function schedule(node) {
  setTimeout(() => {
    if (isPack(node)) {
      applyNames(node);
      return;
    }
    if (!isUnpack(node)) return;
    const pack = findPackForUnpack(node);
    if (pack) applyNames(pack);
    for (const entry of outputRenameEntries(node)) {
      if (entry.pack !== pack) applyNames(entry.pack);
    }
  }, 0);
}

function renameEntries(pack) {
  return laneRecords(pack);
}

function requestRename(pack, entry) {
  void showTextPrompt({
    title: labels().rename,
    value: entry.label,
    inputLabel: labels().rename,
    placeholder: isChineseLocale() ? "输入线束名称" : "Enter a lane name",
    confirmText: isChineseLocale() ? "保存" : "Save",
    cancelText: isChineseLocale() ? "取消" : "Cancel",
  }).then((next) => {
    if (next == null || !(pack?.inputs || []).includes(entry.input)) return;
    setLaneName(pack, entry, next);
    syncNodes2InputLabels(pack);
  });
}

function setLaneName(pack, entry, value) {
  if (!pack || !entry) return;
  const next = String(value ?? "").trim();
  const names = manualLaneNames(pack);
  if (next) names[entry.laneId] = next;
  else delete names[entry.laneId];

  const stored = (pack.properties?.[PACK_LANES_PROPERTY] || [])
    .find((lane) => lane?.id === entry.laneId);
  if (stored) {
    stored.name = next;
    stored.named = Boolean(next);
  }
  if (next) {
    entry.input.name = next;
    entry.input.label = entry.input.link == null
      ? `${isChineseLocale() ? "[空] " : "[Empty] "}${next}`
      : next;
  } else {
    entry.input.name = "wire";
    entry.input.label = "wire";
  }

  applyNames(pack);
  syncPackLabels(pack);
  pack.graph?.change?.();
  pack.graph?.setDirtyCanvas?.(true, true);

  if (!next) {
    try {
      pack.onConnectionsChange?.(globalThis.LiteGraph?.INPUT ?? 1, entry.inputIndex, false, null, entry.input);
    } catch {}
  }
}

function deleteNamedLane(pack, entry) {
  if (!pack || !entry?.named) return false;
  void showConfirm({
    title: isChineseLocale() ? "删除线束" : "Delete lane",
    message: labels().confirmDelete(entry.label),
    confirmText: isChineseLocale() ? "删除" : "Delete",
    cancelText: isChineseLocale() ? "取消" : "Cancel",
    danger: true,
  }).then((confirmed) => {
    if (!confirmed) return;
    const inputIndex = (pack.inputs || []).indexOf(entry.input);
    if (inputIndex < 0) return;
    const names = manualLaneNames(pack);
    delete names[entry.laneId];
    const stored = Array.isArray(pack.properties?.[PACK_LANES_PROPERTY])
      ? pack.properties[PACK_LANES_PROPERTY]
      : [];
    nodeProperties(pack)[PACK_LANES_PROPERTY] = stored.filter((lane) => lane?.id !== entry.laneId);

    pack.removeInput?.(inputIndex);
    try {
      pack.onConnectionsChange?.(globalThis.LiteGraph?.INPUT ?? 1, inputIndex, false, null, entry.input);
    } catch {}
    pack.graph?.change?.();
    pack.graph?.setDirtyCanvas?.(true, true);
    schedule(pack);
  });
  return true;
}

function inputLocalY(node, slot) {
  const index = (node?.inputs || []).indexOf(slot);
  if (index < 0) return null;
  try {
    const out = [0, 0];
    const result = node.getConnectionPos?.(true, index, out) || out;
    if (Array.isArray(result) && Number.isFinite(result[1])) return result[1] - Number(node.pos?.[1] || 0);
  } catch {}
  const height = Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20;
  return (Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30) + height * (index + 0.5);
}

function outputLocalY(node, slot) {
  const index = (node?.outputs || []).indexOf(slot);
  if (index < 0) return null;
  try {
    const out = [0, 0];
    const result = node.getConnectionPos?.(false, index, out) || out;
    if (Array.isArray(result) && Number.isFinite(result[1])) return result[1] - Number(node.pos?.[1] || 0);
  } catch {}
  const height = Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20;
  return (Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30) + height * (index + 0.5);
}

function localPos(node, event, pos) {
  if (Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) return pos;
  if (Number.isFinite(event?.canvasX) && Number.isFinite(event?.canvasY)) {
    return [
      event.canvasX - Number(node.pos?.[0] || 0),
      event.canvasY - Number(node.pos?.[1] || 0),
    ];
  }
  return null;
}

function tryRenameOrDelete(pack, event, pos) {
  const point = localPos(pack, event, pos);
  if (!point) return false;
  const width = Number(pack.size?.[0]) || 112;
  for (const entry of renameEntries(pack)) {
    const y = inputLocalY(pack, entry.input);
    if (!Number.isFinite(y) || Math.abs(point[1] - y) > 9) continue;
    if (point[0] < 42 || point[0] > Math.min(width - 8, 150)) continue;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if (entry.named && point[0] >= width - 30) {
      return deleteNamedLane(pack, entry);
    }
    requestRename(pack, entry);
    return true;
  }
  return false;
}

function tryRenameOutput(unpack, event, pos) {
  const point = localPos(unpack, event, pos);
  if (!point) return false;
  const width = Number(unpack.size?.[0]) || 180;
  for (const entry of outputRenameEntries(unpack)) {
    const y = outputLocalY(unpack, entry.output);
    if (!Number.isFinite(y) || Math.abs(point[1] - y) > 9) continue;
    if (point[0] < Math.max(8, width - 165) || point[0] > width - 20) continue;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    requestRename(entry.pack, entry.entry);
    return true;
  }
  return false;
}

function installNamedLaneStyle() {
  if (typeof document === "undefined" || document.getElementById("terry-wire-bus-named-lane-style")) return;
  const style = document.createElement("style");
  style.id = "terry-wire-bus-named-lane-style";
  style.textContent = `
.lg-slot--input.terry-wire-bus-named-lane{
  position:relative;
  padding-right:26px;
}
.lg-slot--output.terry-wire-bus-renamable-output{
  cursor:text;
}
.lg-slot--input.terry-wire-bus-named-lane::after{
  content:"×";
  position:absolute;
  right:7px;
  top:50%;
  transform:translateY(-50%);
  color:#e16b6b;
  font-size:17px;
  font-weight:600;
  line-height:1;
  pointer-events:none;
}
`;
  document.head.append(style);
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
    for (const node of graph?._nodes || graph?.nodes || []) if (node?.subgraph) queue.push(node.subgraph);
    for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
      if (!collection) continue;
      const values = typeof collection.values === "function" ? collection.values() : Object.values(collection);
      for (const value of values) queue.push(value?.subgraph || value);
    }
  }
  return result;
}

function allNodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []);
}

function installNodes2RenameHandler() {
  if (typeof document === "undefined" || globalThis.__terryWireBusNodes2RenameHandler) return;
  globalThis.__terryWireBusNodes2RenameHandler = true;
  document.addEventListener("pointerdown", (event) => {
    if (event.button != null && event.button !== 0) return;
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest('[data-testid="slot-connection-dot"], [data-testid="slot-dot"]')) return;
    const inputRow = target.closest(".lg-slot--input");
    const outputRow = target.closest(".lg-slot--output");
    const row = inputRow || outputRow;
    const root = row?.closest?.("[data-node-id]");
    if (!row || !root) return;
    const span = row.querySelector(".text-node-component-slot-text");
    if (!String(span?.textContent || row.textContent || "").includes(PENCIL)) return;

    const isOutputRow = Boolean(outputRow);
    const node = allNodes().find((item) =>
      (isOutputRow ? isUnpack(item) : isPack(item))
      && String(item?.id) === String(root.getAttribute("data-node-id"))
    );
    if (!node) return;

    const selector = isOutputRow ? ".lg-slot--output" : ".lg-slot--input";
    const rows = [...root.querySelectorAll(selector)]
      .filter((item) => {
        const label = item.querySelector(".text-node-component-slot-text");
        return String(label?.textContent || item.textContent || "").includes(PENCIL);
      });
    const entries = isOutputRow ? outputRenameEntries(node) : renameEntries(node);
    const entry = entries[rows.indexOf(row)];
    if (!entry) return;

    event.preventDefault?.();
    event.stopPropagation?.();
    if (isOutputRow) {
      requestRename(entry.pack, entry.entry);
      return;
    }
    const rect = row.getBoundingClientRect?.();
    if (entry.named && rect && Number.isFinite(event.clientX) && event.clientX >= rect.right - 28) {
      deleteNamedLane(node, entry);
      return;
    }
    requestRename(node, entry);
  }, true);
}

function patchPackNodeType(nodeTypeClass, nodeData) {
  if (nodeData?.name !== WIRELESS_PACK_TYPE) return;

  const oldMouse = nodeTypeClass.prototype.onMouseDown;
  nodeTypeClass.prototype.onMouseDown = function (event, pos) {
    if (tryRenameOrDelete(this, event, pos)) return true;
    return oldMouse?.apply(this, arguments);
  };

  for (const hook of ["onNodeCreated", "onConfigure", "onConnectionsChange"]) {
    const original = nodeTypeClass.prototype[hook];
    nodeTypeClass.prototype[hook] = function () {
      const result = original?.apply(this, arguments);
      schedule(this);
      return result;
    };
  }
}

function patchUnpackNodeType(nodeTypeClass) {
  const oldMouse = nodeTypeClass.prototype.onMouseDown;
  nodeTypeClass.prototype.onMouseDown = function (event, pos) {
    if (tryRenameOutput(this, event, pos)) return true;
    return oldMouse?.apply(this, arguments);
  };
}

app.registerExtension({
  name: "TerryXu.WireBusNamedPorts",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (![WIRELESS_PACK_TYPE, WIRELESS_UNPACK_TYPE].includes(nodeData?.name)) return;
    if (nodeData?.name === WIRELESS_PACK_TYPE) patchPackNodeType(nodeType, nodeData);

    if (nodeData?.name === WIRELESS_UNPACK_TYPE) {
      patchUnpackNodeType(nodeType);
      const oldConnections = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function () {
        const result = oldConnections?.apply(this, arguments);
        schedule(this);
        return result;
      };

      const oldConfigure = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const result = oldConfigure?.apply(this, arguments);
        schedule(this);
        return result;
      };
    }
  },

  nodeCreated(node) { schedule(node); },
  loadedGraphNode(node) { schedule(node); },

  setup() {
    installNamedLaneStyle();
    installNodes2RenameHandler();
  },

  afterConfigureGraph() {
    setTimeout(() => {
      for (const node of app.graph?._nodes || []) if (isPack(node)) applyNames(node);
    }, 0);
  },
});
