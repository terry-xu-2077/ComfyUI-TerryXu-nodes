import { app } from "../../scripts/app.js";

const WIRELESS_PACK_TYPE = "TerryXuWirelessBusPack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const MEDIA_LOADER_TYPE = "TerryXuMediaLoader";
const BUS_TYPE = "TERRY_WIRE_BUS";
const EMPTY_TYPE = "*";
const LANE_FIELD = "terry_lane_id";
const PACK_LANES_PROPERTY = "terry_wire_bus_lanes";
const PACK_NAMED_LANES_PROPERTY = "terry_wire_bus_named_lanes";
const PACK_PINNED_LANES_PROPERTY = "terry_wire_bus_pinned_lanes";
const UNPACK_NAMED_OUTPUTS_PROPERTY = "terry_wire_bus_named_outputs";
const UNPACK_PINNED_OUTPUTS_PROPERTY = "terry_wire_bus_pinned_outputs";
const UNPACK_PINNED_OUTPUT_TYPES_PROPERTY = "terry_wire_bus_pinned_output_types";
const UNPACK_PINNED_OUTPUT_DEFAULTS_PROPERTY = "terry_wire_bus_pinned_output_defaults";
const UNPACK_MEDIA_OUTPUTS_PROPERTY = "terry_wire_bus_media_outputs";
const WIRELESS_CHANNEL_PROPERTY = "terry_wireless_bus_channel";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isWirelessPack(node) { return nodeType(node) === WIRELESS_PACK_TYPE; }
function isMediaLoader(node) { return nodeType(node) === MEDIA_LOADER_TYPE; }
function isPack(node) { return isWirelessPack(node) || isMediaLoader(node); }
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
        rename: "端口名称",
        portConfig: "端口配置",
        fixed: "固定端口",
        unfix: "取消固定",
        hint: "固定端口始终保留；仅改名不会固定端口，未连接的端口仍会自动清理。",
        empty: "暂无端口",
        close: "完成",
      }
    : {
        input: "Lane",
        rename: "Port name",
        portConfig: "Port settings",
        fixed: "Keep port",
        unfix: "Unpin port",
        hint: "Pinned ports stay. Renaming alone does not pin a port; disconnected ports are still cleaned up.",
        empty: "No ports",
        close: "Done",
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
    const entries = pack?.__terryBusLaneEntries?.() || [];
    const mediaOutputMode = isMediaLoader(pack) || entries.some((item) => item?.mediaPack);
    const laneId = source.outputs?.[slot]?.[LANE_FIELD];
    const entry = mediaOutputMode
      ? entries[slot]
      : entries.find((item) => item?.laneId === laneId);
    if (entry?.source) return entry.source;
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
    if (physical && isPack(physical.node)) return physical.node;
    const name = wirelessChannelName(unpack);
    if (!name) return null;
    for (const graph of [unpack.graph, app.graph]) {
      const pack = (graph?._nodes || []).find((node) =>
        isWirelessPack(node) && wirelessChannelName(node) === name
      );
      if (pack) return pack;
    }
    return null;
  }
  return null;
}

function namedEntries(pack) {
  if (isMediaLoader(pack)) return [];
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
  if (isMediaLoader(pack)) {
    return (pack.__terryBusLaneEntries?.() || []).flatMap((mediaEntry, index) => {
      const laneId = String(mediaEntry?.laneId || mediaEntry?.lane?.id || "").trim();
      if (!laneId) return [];
      const sourceName = stripDecorations(mediaEntry?.name || mediaEntry?.lane?.name || "");
      return [{
        input: null,
        inputIndex: -1,
        laneId,
        ordinal: index + 1,
        named: false,
        label: sourceName || `${labels().input} ${index + 1}`,
        mediaEntry,
      }];
    });
  }
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
  const mediaOutputMode = isMediaLoader(pairedPack)
    || unpack.properties?.[UNPACK_MEDIA_OUTPUTS_PROPERTY] === true;

  if (mediaOutputMode) {
    return (unpack.outputs || []).flatMap((output, outputIndex) => {
      if (!output || output.type === BUS_TYPE) return [];
      const label = String(output.label || output.name || `${labels().input} ${outputIndex + 1}`);
      return [{
        output,
        outputIndex,
        pack: unpack,
        entry: { label, mediaOutput: true, outputIndex },
      }];
    });
  }

  if (!pairedPack) {
    return (unpack.outputs || []).flatMap((output, outputIndex) => {
      if (!output || output.type === BUS_TYPE) return [];
      const pinned = unpack.properties?.[UNPACK_PINNED_OUTPUTS_PROPERTY]?.[String(outputIndex)] === true;
      if (!pinned && !(output.links?.length > 0)) return [];
      const label = stripDecorations(output.label || output.name) || (labels().input + " " + (outputIndex + 1));
      return [{
        output,
        outputIndex,
        pack: unpack,
        entry: { label, mediaOutput: true, outputIndex },
      }];
    });
  }
  return (unpack.outputs || []).flatMap((output, outputIndex) => {
    const laneId = String(output?.[LANE_FIELD] || "").trim();
    if (!output || !laneId || output.type === BUS_TYPE) return [];
    const owner = findLaneOwner(pairedPack, laneId);
    if (!owner || isMediaLoader(owner.pack)) {
      const pinned = isUnpackOutputPinned(unpack, outputIndex);
      if (!pinned && !(output.links?.length > 0)) return [];
      const label = stripDecorations(output.label || output.name) || (labels().input + " " + (outputIndex + 1));
      return [{
        output,
        outputIndex,
        pack: unpack,
        entry: { label, mediaOutput: true, outputIndex },
      }];
    }
    const label = stripDecorations(output.label || output.name) || owner.entry.label;
    return [{
      output,
      outputIndex,
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
  rows.forEach((row, index) => {
    const span = row.querySelector(".text-node-component-slot-text");
    const output = unpack.outputs?.[index];
    if (span) span.textContent = String(output?.label || output?.name || "");
  });
}

function syncNodes2InputLabels(pack) {
  if (typeof document === "undefined") return;
  const root = [...document.querySelectorAll("[data-node-id]")]
    .find((element) => String(element.getAttribute("data-node-id")) === String(pack?.id));
  if (!root) return;

  const rows = [...root.querySelectorAll(".lg-slot--input")];
  const entries = laneRecords(pack);
  for (const entry of entries) {
    const row = rows[entry.inputIndex];
    if (!row) continue;
    const span = row.querySelector(".text-node-component-slot-text");
    if (span) span.textContent = entry.label;
  }
}

function syncPackLabels(pack) {
  if (!isWirelessPack(pack)) return;
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
    input.label = `${emptyPrefix}${displayName}`;
  }
  syncNodes2InputLabels(pack);
}

function applyNames(pack) {
  if (!isPack(pack) || !pack.graph) return;
  const entries = namedEntries(pack);
  const records = laneRecords(pack);

  if (isWirelessPack(pack)) {
    for (const entry of entries) {
      entry.input.name = entry.label;
      entry.input.label = entry.label;
      const stored = (pack.properties?.[PACK_LANES_PROPERTY] || [])
        .find((lane) => lane?.id === entry.laneId);
      if (stored) stored.name = entry.label;
    }
  }

  for (const node of allNodes()) {
    if (!isUnpack(node)) continue;
    for (const output of node.outputs || []) {
      const laneId = String(output?.[LANE_FIELD] || "").trim();
      if (!laneId || output.type === BUS_TYPE) continue;
      const owner = findLaneOwner(findPackForUnpack(node), laneId);
      if (owner?.pack !== pack || isMediaLoader(pack)) continue;

      const connectedEntry = entries.find((item) => item.laneId === laneId);
      const storedEntry = records.find((item) => item.laneId === laneId);
      const displayName = connectedEntry?.label || (storedEntry?.named ? storedEntry.label : "");
      if (!displayName) continue;

      output.name = displayName;
      output.label = displayName;
    }
    syncNodes2OutputLabels(node);
    node.setDirtyCanvas?.(true, true);
  }

  syncPackLabels(pack);
  pack.setDirtyCanvas?.(true, true);
}


let activePortConfigDialog = null;

function isPackLanePinned(pack, laneId) {
  const pinned = pack?.properties?.[PACK_PINNED_LANES_PROPERTY];
  return Boolean(pinned && typeof pinned === "object" && pinned[String(laneId)] === true);
}

function isUnpackOutputPinned(unpack, outputIndex) {
  const pinned = unpack?.properties?.[UNPACK_PINNED_OUTPUTS_PROPERTY];
  return Boolean(pinned && typeof pinned === "object" && pinned[String(outputIndex)] === true);
}

function refreshPackAfterPortEdit(pack, entry) {
  try {
    const index = Number.isInteger(entry?.inputIndex)
      ? entry.inputIndex
      : (pack?.inputs || []).indexOf(entry?.input);
    pack?.onConnectionsChange?.(globalThis.LiteGraph?.INPUT ?? 1, index, false, null, entry?.input);
  } catch {}
  pack?.graph?.change?.();
  pack?.graph?.setDirtyCanvas?.(true, true);
}

function refreshUnpackAfterPortEdit(unpack, outputIndex) {
  try {
    unpack?.onConnectionsChange?.(globalThis.LiteGraph?.OUTPUT ?? 2, outputIndex, false, null, unpack?.outputs?.[outputIndex]);
  } catch {}
  unpack?.graph?.change?.();
  unpack?.graph?.setDirtyCanvas?.(true, true);
  unpack?.setDirtyCanvas?.(true, true);
}

function setMediaOutputName(unpack, outputIndex, value) {
  const output = unpack?.outputs?.[outputIndex];
  if (!output || !Number.isInteger(outputIndex) || outputIndex < 0) return false;
  const next = String(value ?? "").trim();
  const properties = nodeProperties(unpack);
  let names = properties[UNPACK_NAMED_OUTPUTS_PROPERTY];
  if (!names || typeof names !== "object" || Array.isArray(names)) {
    names = {};
    properties[UNPACK_NAMED_OUTPUTS_PROPERTY] = names;
  }
  if (next) names[String(outputIndex)] = next;
  else delete names[String(outputIndex)];
  if (!Object.keys(names).length) delete properties[UNPACK_NAMED_OUTPUTS_PROPERTY];

  const emptyPrefix = String(output.name || output.label || "").match(/^\[(?:空|Empty)\]\s*/i)?.[0] || "";
  const defaultName = String(output.__terryBusDefaultLabel || stripDecorations(output.name || output.label))
    || (labels().input + " " + (outputIndex + 1));
  output.__terryBusDefaultLabel = defaultName;
  output.name = next ? (emptyPrefix + next) : (emptyPrefix + defaultName);
  output.label = output.name;
  refreshUnpackAfterPortEdit(unpack, outputIndex);
  syncNodes2OutputLabels(unpack);
  return true;
}

function setLaneName(pack, entry, value) {
  if (!pack || !entry) return false;
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
  if (entry.input) {
    if (next) {
      entry.input.name = next;
      entry.input.label = entry.input.link == null
        ? ((isChineseLocale() ? "[空] " : "[Empty] ") + next)
        : next;
    } else {
      entry.input.name = "wire";
      entry.input.label = "wire";
    }
  }

  applyNames(pack);
  syncPackLabels(pack);
  refreshPackAfterPortEdit(pack, entry);
  return true;
}

function setPackLanePinned(pack, entry, value) {
  if (!pack || !entry?.laneId) return false;
  const properties = nodeProperties(pack);
  let pinned = properties[PACK_PINNED_LANES_PROPERTY];
  if (!pinned || typeof pinned !== "object" || Array.isArray(pinned)) {
    pinned = {};
    properties[PACK_PINNED_LANES_PROPERTY] = pinned;
  }
  if (value) pinned[entry.laneId] = true;
  else delete pinned[entry.laneId];
  if (!Object.keys(pinned).length) delete properties[PACK_PINNED_LANES_PROPERTY];
  const stored = (properties[PACK_LANES_PROPERTY] || []).find((lane) => lane?.id === entry.laneId);
  if (stored) stored.pinned = Boolean(value);
  refreshPackAfterPortEdit(pack, entry);
  return true;
}

function setUnpackOutputPinned(unpack, outputIndex, value) {
  if (!unpack || !Number.isInteger(outputIndex) || outputIndex < 0 || !unpack.outputs?.[outputIndex]) return false;
  const properties = nodeProperties(unpack);
  let pinned = properties[UNPACK_PINNED_OUTPUTS_PROPERTY];
  if (!pinned || typeof pinned !== "object" || Array.isArray(pinned)) {
    pinned = {};
    properties[UNPACK_PINNED_OUTPUTS_PROPERTY] = pinned;
  }
  const output = unpack.outputs?.[outputIndex];
  if (value) {
    pinned[String(outputIndex)] = true;
    let types = properties[UNPACK_PINNED_OUTPUT_TYPES_PROPERTY];
    if (!types || typeof types !== "object" || Array.isArray(types)) {
      types = {};
      properties[UNPACK_PINNED_OUTPUT_TYPES_PROPERTY] = types;
    }
    types[String(outputIndex)] = String(output?.type || EMPTY_TYPE);
    let defaults = properties[UNPACK_PINNED_OUTPUT_DEFAULTS_PROPERTY];
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
      defaults = {};
      properties[UNPACK_PINNED_OUTPUT_DEFAULTS_PROPERTY] = defaults;
    }
    defaults[String(outputIndex)] = String(output?.__terryBusDefaultLabel || stripDecorations(output?.name || output?.label) || (labels().input + " " + (outputIndex + 1)));
  } else {
    delete pinned[String(outputIndex)];
    if (!Object.keys(pinned).length) delete properties[UNPACK_PINNED_OUTPUTS_PROPERTY];
    const types = properties[UNPACK_PINNED_OUTPUT_TYPES_PROPERTY];
    if (types && typeof types === "object") {
      delete types[String(outputIndex)];
      if (!Object.keys(types).length) delete properties[UNPACK_PINNED_OUTPUT_TYPES_PROPERTY];
    }
    const defaults = properties[UNPACK_PINNED_OUTPUT_DEFAULTS_PROPERTY];
    if (defaults && typeof defaults === "object") {
      delete defaults[String(outputIndex)];
      if (!Object.keys(defaults).length) delete properties[UNPACK_PINNED_OUTPUT_DEFAULTS_PROPERTY];
    }
  }
  const sourcePack = findPackForUnpack(unpack);
  const owner = output?.[LANE_FIELD] ? findLaneOwner(sourcePack, output[LANE_FIELD]) : null;
  refreshUnpackAfterPortEdit(unpack, outputIndex);
  if (owner?.pack && owner.entry) refreshPackAfterPortEdit(owner.pack, owner.entry);
  return true;
}

function renameEntries(pack) {
  return isWirelessPack(pack) ? laneRecords(pack) : [];
}

function portConfigEntries(node) {
  if (isWirelessPack(node)) {
    return renameEntries(node).map((entry) => ({
      direction: "input",
      index: entry.ordinal - 1,
      label: stripDecorations(entry.label) || (labels().input + " " + entry.ordinal),
      type: String(entry.input?.type || EMPTY_TYPE),
      pinned: isPackLanePinned(node, entry.laneId),
      pack: node,
      entry,
    }));
  }
  if (isUnpack(node)) {
    return outputRenameEntries(node).map((item) => ({
      direction: "output",
      index: item.outputIndex,
      label: stripDecorations(item.entry.label) || (labels().input + " " + (item.outputIndex + 1)),
      type: String(item.output?.type || EMPTY_TYPE),
      pinned: isUnpackOutputPinned(node, item.outputIndex),
      pack: item.pack,
      entry: item.entry,
      output: item.output,
      mediaOutput: Boolean(item.entry.mediaOutput),
      outputIndex: item.outputIndex,
    }));
  }
  return [];
}

function savePortName(node, item, value) {
  if (item.direction === "input") {
    setLaneName(item.pack || node, item.entry, value);
  } else if (item.mediaOutput || item.pack === node) {
    setMediaOutputName(node, item.outputIndex, value);
  } else {
    setLaneName(item.pack, item.entry, value);
  }
}

function setPortPinned(node, item, value) {
  if (item.direction === "input") setPackLanePinned(item.pack || node, item.entry, value);
  else setUnpackOutputPinned(node, item.outputIndex, value);
}

function createPortPinIcon() {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "terry-wire-bus-port-pin-icon");
  svg.setAttribute("aria-hidden", "true");

  const head = document.createElementNS(namespace, "path");
  head.setAttribute("class", "terry-wire-bus-port-pin-shape");
  head.setAttribute("d", "M8.5 3.5h7l-1 5.1 3.1 3.1v1.6H6.4v-1.6l3.1-3.1-1-5.1Z");

  const stem = document.createElementNS(namespace, "path");
  stem.setAttribute("class", "terry-wire-bus-port-pin-stem");
  stem.setAttribute("d", "M12 13.3v7.2");
  svg.append(head, stem);
  return svg;
}

function installPortConfigStyle() {
  if (typeof document === "undefined" || document.getElementById("terry-wire-bus-port-config-style")) return;
  const style = document.createElement("style");
  style.id = "terry-wire-bus-port-config-style";
  style.textContent = `
.terry-wire-bus-port-config-button{
  display:grid;place-items:center;flex:0 0 28px;width:28px;height:24px;
  margin:0 2px 0 0;padding:0;border:0;border-left:1px solid rgba(255,255,255,.14);
  border-radius:0;background:transparent;color:rgba(230,234,241,.68);
  font:16px/1 system-ui;cursor:pointer;pointer-events:auto;
}
.terry-wire-bus-port-config-button:hover,
.terry-wire-bus-port-config-button:focus-visible{
  color:#f4f6fa;background:rgba(255,255,255,.08);outline:none;
}
.terry-wire-bus-port-config-overlay{
  position:fixed;inset:0;z-index:10020;display:flex;align-items:center;justify-content:center;
  padding:20px;box-sizing:border-box;background:rgba(0,0,0,.58);pointer-events:auto;
}
.terry-wire-bus-port-config-dialog{
  display:flex;flex-direction:column;gap:12px;width:min(440px,calc(100vw - 32px));
  max-height:min(620px,calc(100vh - 40px));padding:16px;box-sizing:border-box;
  border:1px solid rgba(255,255,255,.14);border-radius:12px;
  background:#202328;color:#e7eaf0;box-shadow:0 18px 56px rgba(0,0,0,.48);
  font:13px/1.45 Inter,system-ui,sans-serif;
}
.terry-wire-bus-port-config-head{display:flex;align-items:center;justify-content:space-between;gap:12px}
.terry-wire-bus-port-config-title{font-size:15px;font-weight:650}
.terry-wire-bus-port-config-close{
  width:28px;height:28px;border:0;border-radius:7px;background:transparent;
  color:#aeb6c2;font-size:20px;cursor:pointer;
}
.terry-wire-bus-port-config-close:hover{background:rgba(255,255,255,.08);color:#fff}
.terry-wire-bus-port-config-hint{margin:0;color:#aab2bf;font-size:12px}
.terry-wire-bus-port-config-list{display:flex;flex-direction:column;gap:7px;min-height:0;overflow:auto;padding:1px 3px 1px 1px}
.terry-wire-bus-port-config-row{
  display:grid;grid-template-columns:28px minmax(0,1fr) 36px;align-items:center;gap:8px;
  min-height:42px;padding:6px 8px;border:1px solid rgba(255,255,255,.09);
  border-radius:8px;background:rgba(255,255,255,.025);
}
.terry-wire-bus-port-config-index{color:#8792a2;font-size:11px;font-variant-numeric:tabular-nums;text-align:center}
.terry-wire-bus-port-config-main{display:flex;align-items:center;gap:8px;min-width:0}
.terry-wire-bus-port-config-type{
  flex:none;max-width:88px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:#aabbd2;font-size:10px;
}
.terry-wire-bus-port-config-name{
  flex:1;min-width:0;height:30px;padding:0 8px;border:1px solid #454c57;border-radius:6px;
  outline:none;background:#171a1f;color:#e9edf3;font:12px Inter,system-ui,sans-serif;
}
.terry-wire-bus-port-config-name:focus{border-color:#799ac4;box-shadow:0 0 0 1px rgba(121,154,196,.2)}
.terry-wire-bus-port-config-pin{
  display:grid;place-items:center;width:32px;height:30px;padding:0;border:1px solid #424954;
  border-radius:7px;background:transparent;color:#7f8998;cursor:pointer;
  transition:color .14s ease,border-color .14s ease,background .14s ease;
}
.terry-wire-bus-port-pin-icon{display:block;width:17px;height:17px;overflow:visible}
.terry-wire-bus-port-pin-shape,.terry-wire-bus-port-pin-stem{
  fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;
}
.terry-wire-bus-port-config-pin:hover{
  border-color:#8392a5;color:#c5ceda;background:rgba(255,255,255,.045);
}
.terry-wire-bus-port-config-pin.is-pinned{
  border-color:#424954;background:transparent;color:#b85d6b;
}
.terry-wire-bus-port-config-pin.is-pinned .terry-wire-bus-port-pin-icon{
  transform:rotate(35deg);
}
.terry-wire-bus-port-config-pin.is-pinned .terry-wire-bus-port-pin-shape{
  fill:currentColor;
}
.terry-wire-bus-port-config-pin.is-pinned:hover{
  border-color:#8392a5;background:rgba(255,255,255,.045);color:#c16b78;
}
.terry-wire-bus-port-config-empty{padding:24px 8px;color:#8f98a6;text-align:center}
.terry-wire-bus-port-config-foot{display:flex;justify-content:flex-end}
.terry-wire-bus-port-config-done{
  min-width:84px;height:32px;padding:0 14px;border:1px solid #596372;border-radius:7px;
  background:#303640;color:#edf1f6;font:12px Inter,system-ui,sans-serif;cursor:pointer;
}
.terry-wire-bus-port-config-done:hover{background:#3a4350;border-color:#7e91aa}
`;
  document.head.append(style);
}

function closePortConfigDialog() {
  if (!activePortConfigDialog) return;
  const { overlay, onKeyDown } = activePortConfigDialog;
  document.removeEventListener("keydown", onKeyDown, true);
  overlay.remove();
  activePortConfigDialog = null;
}

function openPortConfig(node) {
  if (typeof document === "undefined" || !document.body) return;
  closePortConfigDialog();
  installPortConfigStyle();

  const text = labels();
  const overlay = document.createElement("div");
  overlay.className = "terry-wire-bus-port-config-overlay";
  const dialog = document.createElement("section");
  dialog.className = "terry-wire-bus-port-config-dialog";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", text.portConfig);

  const head = document.createElement("div");
  head.className = "terry-wire-bus-port-config-head";
  const title = document.createElement("div");
  title.className = "terry-wire-bus-port-config-title";
  title.textContent = text.portConfig;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "terry-wire-bus-port-config-close";
  close.textContent = "×";
  close.title = text.close;
  close.addEventListener("click", closePortConfigDialog);
  head.append(title, close);

  const hint = document.createElement("p");
  hint.className = "terry-wire-bus-port-config-hint";
  hint.textContent = text.hint;
  const list = document.createElement("div");
  list.className = "terry-wire-bus-port-config-list";
  const foot = document.createElement("div");
  foot.className = "terry-wire-bus-port-config-foot";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "terry-wire-bus-port-config-done";
  done.textContent = text.close;
  done.addEventListener("click", closePortConfigDialog);
  foot.append(done);
  dialog.append(head, hint, list, foot);
  overlay.append(dialog);

  const render = () => {
    list.replaceChildren();
    const entries = portConfigEntries(node);
    if (!entries.length) {
      const empty = document.createElement("div");
      empty.className = "terry-wire-bus-port-config-empty";
      empty.textContent = text.empty;
      list.append(empty);
      return;
    }

    entries.forEach((item, index) => {
      const row = document.createElement("div");
      row.className = "terry-wire-bus-port-config-row";
      const ordinal = document.createElement("span");
      ordinal.className = "terry-wire-bus-port-config-index";
      ordinal.textContent = String(index + 1).padStart(2, "0");

      const main = document.createElement("div");
      main.className = "terry-wire-bus-port-config-main";
      const type = document.createElement("span");
      type.className = "terry-wire-bus-port-config-type";
      type.textContent = item.type === EMPTY_TYPE ? "空槽" : item.type;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "terry-wire-bus-port-config-name";
      input.value = item.label;
      input.placeholder = text.rename;
      input.setAttribute("aria-label", text.rename + " " + (index + 1));
      input.addEventListener("change", () => {
        if (input.value.trim() === item.label) return;
        savePortName(node, item, input.value);
        setTimeout(render, 0);
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        input.blur();
      });
      main.append(type, input);

      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "terry-wire-bus-port-config-pin" + (item.pinned ? " is-pinned" : "");
      pin.append(createPortPinIcon());
      pin.title = item.pinned ? text.unfix : text.fixed;
      pin.setAttribute("aria-label", (item.pinned ? text.unfix : text.fixed) + " " + (index + 1));
      pin.setAttribute("aria-pressed", String(item.pinned));
      let preparedPinClick = false;
      const prepareNameBeforePin = () => {
        const nextName = input.value.trim();
        if (nextName === item.label) return false;
        if (!item.pinned) {
          setPortPinned(node, item, true);
          item.pinned = true;
          preparedPinClick = true;
        }
        savePortName(node, item, nextName);
        item.label = nextName;
        return true;
      };
      pin.addEventListener("pointerdown", prepareNameBeforePin);
      pin.addEventListener("click", () => {
        if (preparedPinClick) {
          preparedPinClick = false;
          render();
          return;
        }
        if (input.value.trim() !== item.label) prepareNameBeforePin();
        if (preparedPinClick) {
          preparedPinClick = false;
          render();
          return;
        }
        setPortPinned(node, item, !item.pinned);
        render();
      });

      row.append(ordinal, main, pin);
      list.append(row);
    });
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closePortConfigDialog();
    }
  };
  overlay.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    if (event.target === overlay) closePortConfigDialog();
  });
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.addEventListener("keydown", onKeyDown, true);
  activePortConfigDialog = { overlay, onKeyDown };
  document.body.append(overlay);
  render();
  close.focus?.();
}

function ensurePortConfigButton(node) {
  if (!isWirelessPack(node) && !isUnpack(node)) return;
  const root = node?.__terryWirelessControl?.root;
  if (!root || root.querySelector?.(".terry-wire-bus-port-config-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "terry-wire-bus-port-config-button";
  button.textContent = "⚙";
  button.title = labels().portConfig;
  button.setAttribute("aria-label", labels().portConfig);
  button.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openPortConfig(node);
  });
  root.append(button);
}

function schedule(node) {
  setTimeout(() => {
    if (isWirelessPack(node) || isUnpack(node)) ensurePortConfigButton(node);
    if (isPack(node)) {
      applyNames(node);
      return;
    }
    if (!isUnpack(node)) return;
    const pack = findPackForUnpack(node);
    if (pack) applyNames(pack);
    for (const entry of outputRenameEntries(node)) {
      if (entry.pack !== pack && entry.pack !== node) applyNames(entry.pack);
    }
    syncNodes2OutputLabels(node);
  }, 0);
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

function patchPackNodeType(nodeTypeClass, nodeData) {
  if (nodeData?.name !== WIRELESS_PACK_TYPE) return;

  for (const hook of ["onNodeCreated", "onConfigure", "onConnectionsChange"]) {
    const original = nodeTypeClass.prototype[hook];
    nodeTypeClass.prototype[hook] = function () {
      const result = original?.apply(this, arguments);
      schedule(this);
      return result;
    };
  }
}

app.registerExtension({
  name: "TerryXu.WireBusNamedPorts",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (![WIRELESS_PACK_TYPE, WIRELESS_UNPACK_TYPE].includes(nodeData?.name)) return;
    if (nodeData?.name === WIRELESS_PACK_TYPE) patchPackNodeType(nodeType, nodeData);

    if (nodeData?.name === WIRELESS_UNPACK_TYPE) {
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
    installPortConfigStyle();
  },

  afterConfigureGraph() {
    setTimeout(() => {
      for (const node of app.graph?._nodes || []) if (isPack(node)) applyNames(node);
    }, 0);
  },
});
