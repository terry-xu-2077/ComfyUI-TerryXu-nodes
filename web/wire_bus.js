import { app } from "../../scripts/app.js";
import { mediaExecutionSource } from "./media_loader_model.mjs";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "./switch_bus_route.mjs";

// Stable workflow ids. Never localize these.
const WIRELESS_PACK_TYPE = "TerryXuWirelessBusPack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const BUS_TYPE = "TERRY_WIRE_BUS";
const LIST_TYPE = "TerryXuBusToList";
const EMPTY_TYPE = "*";

const PACK_LANES_PROPERTY = "terry_wire_bus_lanes";
const UNPACK_LANES_PROPERTY = "terry_wire_bus_lane_ids";
const WIRELESS_CHANNEL_PROPERTY = "terry_wireless_bus_channel";
const UNPACK_OUTPUT_MODE_PROPERTY = "terry_wire_bus_expand_outputs";
const UNPACK_SAVED_LINKS_PROPERTY = "terry_wire_bus_saved_output_links";

const LANE_FIELD = "terry_lane_id";
const BUS_OUTPUT_FIELD = "terry_bus_passthrough_output";

const COMPACT_NODE_WIDTH = 112;
const COMPACT_NODE_MIN_HEIGHT = 96;
const COMPACT_NODE_HEADER_HEIGHT = 32;
const COMPACT_NODE_LANE_HEIGHT = 20;
const COMPACT_NODE_SLOT_PADDING = 20;

const WIRELESS_WIDGET_HEIGHT = 38;
const WIRELESS_CONTROL_HEIGHT = 26;
const WIRELESS_CONTROL_MARGIN = 6;
const WIRELESS_CONTROL_BOTTOM_PADDING = 8;
const WIRELESS_CONTROL_STYLE_ID = "terry-wireless-bus-control-style";

const OUTPUT_MODE_CONTROL_HEIGHT = 30;
const OUTPUT_MODE_CONTROL_MARGIN = 4;
const OUTPUT_MODE_STYLE_ID = "terry-wire-bus-output-mode-style";
const BUS_ONLY_WIRELESS_HEIGHT = 140;

const H3_TYPES = new Set(["TerryXuH3PromptEditor"]);

let laneSequence = 0;

function newLaneId() {
  try {
    if (globalThis.crypto?.randomUUID) return `lane_${globalThis.crypto.randomUUID()}`;
  } catch {}
  laneSequence += 1;
  return `lane_${Date.now().toString(36)}_${laneSequence.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

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
  if (isChineseLocale()) {
    return {
      
      
      wirelessPackTitle: "↔️ 总线-入",
      wirelessUnpackTitle: "↔️ 总线-出",
      packDescription: "将任意数量、任意类型的连接汇总为一根虚拟总线，支持 KJNodes Get/Set。",
      unpackDescription: "从虚拟总线自动恢复原始连接的数量、类型和顺序，支持 KJNodes Get/Set。",
      wirelessPackDescription: "将多路连接整理成总线，通过 TerryXu 频道发布。",
      wirelessUnpackDescription: "按 TerryXu 频道接收总线，自动恢复多路连接；也可读取媒体加载器的总线。",
      category: "TerryXu/线束整理",
      addWire: "添加线束",
      bus: "总线",
      channelName: "名称",
      channelSelect: "选择总线",
      defaultChannel: "总线",
      input: "输入",
      output: "输出",
      expandOutputs: "散开输出",
    };
  }
  return {
    
    
    wirelessPackTitle: "↔️ Bus-In",
    wirelessUnpackTitle: "↔️ Bus-Out",
    packDescription: "Bundle any number of connections into one virtual bus. Supports KJNodes Get/Set.",
    unpackDescription: "Restore the original connection count, types and order from a virtual bus. Supports KJNodes Get/Set.",
    wirelessPackDescription: "Group multiple connections and publish them over a TerryXu wireless channel.",
    wirelessUnpackDescription: "Restore connections from a TerryXu wireless channel, or read a Media Loader bus.",
    category: "TerryXu/Wire Management",
    addWire: "Add wire",
    bus: "bus",
    channelName: "Name",
    channelSelect: "Select Bus",
    defaultChannel: "Bus",
    input: "Input",
    output: "Output",
    expandOutputs: "Expand outputs",
  };
}

function nodeType(node) {
  return String(
    node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || ""
  );
}

function isWirelessPack(node) { return nodeType(node) === WIRELESS_PACK_TYPE; }
function isWirelessUnpack(node) { return nodeType(node) === WIRELESS_UNPACK_TYPE; }
function isWireless(node) { return isWirelessPack(node) || isWirelessUnpack(node); }
function isMediaPack(node) { return nodeType(node) === "TerryXuMediaLoader"; }
function isPack(node) { return isWirelessPack(node) || isMediaPack(node); }
function isUnpack(node) { return isWirelessUnpack(node); }

function isReroute(node) {
  const type = nodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}

function isGet(node) { return nodeType(node) === "GetNode"; }
function isSet(node) { return nodeType(node) === "SetNode"; }

function nodeProperties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function unpackExpanded(node) {
  return nodeProperties(node)[UNPACK_OUTPUT_MODE_PROPERTY] !== false;
}

function isH3MediaTarget(node, input) {
  if (!H3_TYPES.has(nodeType(node))) return false;
  if (String(input?.name || "") === "media") return true;
  return Boolean(node?.inputs?.some?.((slot) => String(slot?.name || "") === "media"));
}

function canConnectBusOutput(targetNode, input) {
  return (
    isUnpack(targetNode)
    || isWirelessPack(targetNode)
    || nodeType(targetNode) === LIST_TYPE
    || isReroute(targetNode)
    || isSet(targetNode)
    || isH3MediaTarget(targetNode, input)
    || (isTerrySwitch(targetNode) && !["index", "enabled"].includes(String(input?.name || "")))
  );
}

function canConnectPackInput(pack, slot, type) {
  if (slot < 0 || !pack.inputs?.[slot]) return false;
  // A connected bus occupies the whole pack. Disconnect it before adding or
  // replacing wires, including during the deferred slot refresh.
  if (pack.inputs.some(input => input.link != null && (
    input.type === BUS_TYPE || resolveUpstream(pack.graph, input.link)?.type === BUS_TYPE
  ))) return false;
  if (String(type).toUpperCase() !== BUS_TYPE) return true;
  return pack.inputs.every(input => input.link == null)
    && !storedPackLanes(pack).some(lane => laneHasOutputLinks(pack, lane.id));
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

function graphAncestors(graph) {
  if (!graph) return [];
  const root = graph.rootGraph || app.graph || graph;
  if (graph === root) return [graph];
  const chain = [graph];
  const seen = new Set(chain);
  let current = graph;
  while (current && current !== root) {
    let parent = current.parent || current._parent || current._subgraph_node?.graph || null;
    if (!parent && root?._nodes) {
      for (const node of root._nodes) {
        if (node?.subgraph === current) { parent = root; break; }
      }
    }
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }
  if (root && !chain.includes(root)) chain.push(root);
  return chain;
}

function wirelessChannelWidget(node) {
  return (node?.widgets || []).find((widget) => widget?.terryWirelessChannel === true) || null;
}

function wirelessUnpackUsesWiredBus(node) {
  return isWirelessUnpack(node) && node?.inputs?.[0]?.link != null;
}

function wirelessChannelName(node) {
  const widgetValue = wirelessChannelWidget(node)?.value;
  return String(widgetValue ?? node?.properties?.[WIRELESS_CHANNEL_PROPERTY] ?? "").trim();
}

function wirelessPacksInScope(graph) {
  const currentGraph = graph || app.graph;
  const root = currentGraph?.rootGraph || app.graph?.rootGraph || app.graph || currentGraph;
  const candidateGraphs = [...graphAncestors(currentGraph), ...allGraphs(root)];
  const packs = [];
  const seen = new Set();
  for (const candidateGraph of candidateGraphs) {
    if (!candidateGraph || seen.has(candidateGraph)) continue;
    seen.add(candidateGraph);
    for (const node of candidateGraph?._nodes || candidateGraph?.nodes || []) {
      if (isWirelessPack(node) && wirelessChannelName(node)) packs.push(node);
    }
  }
  return packs;
}

function wirelessChannelNames(graph) {
  return [...new Set(wirelessPacksInScope(graph).map(wirelessChannelName))]
    .sort((a, b) => a.localeCompare(b));
}

function uniqueWirelessChannelName(pack, requested) {
  const base = String(requested || "").trim() || `${labels().defaultChannel} 1`;
  const names = new Set(
    wirelessPacksInScope(pack?.graph || app.graph)
      .filter((node) => node !== pack)
      .map(wirelessChannelName)
  );
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function refreshWirelessCombo(unpack) {
  const widget = wirelessChannelWidget(unpack);
  if (!widget) return;
  const descriptor = Object.getOwnPropertyDescriptor(widget.options || {}, "values");
  const options = widget.__terryWirelessHidden ? { hidden: true } : {};
  Object.defineProperty(options, "values", descriptor || {
    get: () => wirelessChannelNames(unpack.graph || app.graph),
    enumerable: true,
    configurable: true,
  });
  widget.options = options;
  const index = unpack.widgets?.indexOf(widget) ?? -1;
  if (index >= 0) {
    unpack.widgets.splice(index, 1);
    unpack.widgets.splice(index, 0, widget);
  }
  unpack.__terryWirelessControl?.refresh?.();
}

function refreshWirelessChannels(previousName = "", nextName = "") {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) {
      if (!isWirelessUnpack(node)) continue;
      const widget = wirelessChannelWidget(node);
      if (previousName && wirelessChannelName(node) === previousName) {
        if (widget) widget.value = nextName;
        nodeProperties(node)[WIRELESS_CHANNEL_PROPERTY] = nextName;
        node.__terryBusRefreshVisual?.();
      }
      refreshWirelessCombo(node);
      syncUnpack(node, true);
    }
  }
}

function setWirelessChannel(node, requested, notify = true) {
  const properties = nodeProperties(node);
  const previousName = String(properties[WIRELESS_CHANNEL_PROPERTY] || "").trim();
  const nextName = isWirelessPack(node)
    ? uniqueWirelessChannelName(node, requested)
    : String(requested || "").trim();
  const widget = wirelessChannelWidget(node);
  if (widget) widget.value = nextName;
  if (widget?._state) widget._state.value = nextName;
  properties[WIRELESS_CHANNEL_PROPERTY] = nextName;
  node.__terryWirelessControl?.refresh?.();
  node.__terryBusRefreshVisual?.();
  if (notify && !app.configuringGraph) {
    if (isWirelessPack(node)) refreshWirelessChannels(previousName, nextName);
    else syncUnpack(node, true);
  }
  return nextName;
}

function installWirelessControlStyle() {
  if (typeof document === "undefined" || document.getElementById(WIRELESS_CONTROL_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = WIRELESS_CONTROL_STYLE_ID;
  style.textContent = `
.terry-wireless-channel-control{
  position:relative;
  display:flex;
  align-items:center;
  width:100%;
  height:${WIRELESS_CONTROL_HEIGHT}px !important;
  min-height:${WIRELESS_CONTROL_HEIGHT}px !important;
  max-height:${WIRELESS_CONTROL_HEIGHT}px !important;
  min-width:0;
  box-sizing:border-box;
  border:1px solid rgba(255,255,255,.2);
  border-radius:7px;
  background:rgba(0,0,0,.2);
  overflow:hidden;
  pointer-events:auto;
}
.terry-wireless-channel-control:focus-within{
  border-color:rgba(255,255,255,.45);
  background:rgba(0,0,0,.28);
}
.terry-wireless-channel-control.is-disabled{
  opacity:.42;
  filter:saturate(.3);
  border-color:rgba(255,255,255,.1);
  background:rgba(0,0,0,.12);
  pointer-events:none;
}
.terry-wireless-channel-control.is-disabled::after{opacity:.35}
.terry-wireless-channel-control input,
.terry-wireless-channel-control select{
  display:block;
  flex:1 1 auto;
  width:100%;
  min-width:0;
  height:${WIRELESS_CONTROL_HEIGHT - 2}px !important;
  min-height:${WIRELESS_CONTROL_HEIGHT - 2}px !important;
  max-height:${WIRELESS_CONTROL_HEIGHT - 2}px !important;
  margin:0;
  padding:0 7px;
  border:0;
  outline:none;
  appearance:none;
  background:transparent;
  color:rgba(245,245,245,.9);
  font:11px/${WIRELESS_CONTROL_HEIGHT - 2}px Inter,system-ui,sans-serif;
  text-align:center;
  text-overflow:ellipsis;
  color-scheme:dark;
}
.terry-wireless-channel-control input::placeholder{color:rgba(255,255,255,.38)}
.terry-wireless-channel-control select{padding-right:18px;cursor:pointer}
.terry-wireless-channel-control select option{background:#25272b;color:#e8e8e8}
.terry-wireless-channel-control.is-select::after{
  position:absolute;
  top:9px;
  right:8px;
  width:5px;
  height:5px;
  border-right:1px solid rgba(255,255,255,.7);
  border-bottom:1px solid rgba(255,255,255,.7);
  content:"";
  pointer-events:none;
  transform:rotate(45deg);
}
`;
  document.head.append(style);
}

function hideWirelessNativeWidget(widget) {
  if (!widget) return;
  widget.__terryWirelessHidden = true;
  widget.hidden = true;
  widget.options ||= {};
  widget.options.hidden = true;
  widget.computeSize = () => [0, -4];
  if (widget.element?.style) widget.element.style.display = "none";
  if (widget.inputEl?.style) widget.inputEl.style.display = "none";
}

function initializeWirelessControl(node) {
  if (!isWireless(node) || node.__terryWirelessControl) return;
  if (typeof document === "undefined" || typeof node.addDOMWidget !== "function") return;
  const widget = wirelessChannelWidget(node);
  if (!widget) return;
  installWirelessControlStyle();

  const pack = isWirelessPack(node);
  const root = document.createElement("div");
  root.className = `terry-wireless-channel-control${pack ? "" : " is-select"}`;
  const control = document.createElement(pack ? "input" : "select");
  if (pack) {
    control.type = "text";
    control.placeholder = labels().channelName;
    control.spellcheck = false;
  }
  root.append(control);
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  control.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (pack && event.key === "Enter") {
      event.preventDefault();
      control.blur?.();
    }
  });
  control.addEventListener("change", () => {
    if (!pack && wirelessUnpackUsesWiredBus(node)) return;
    setWirelessChannel(node, control.value);
    node.graph?.setDirtyCanvas?.(true, true);
    node.graph?.change?.();
  });

  const dom = node.addDOMWidget("terry_wireless_channel_control", "terry_wireless_channel_control", root, {
    serialize: false,
    hideOnZoom: false,
    margin: WIRELESS_CONTROL_MARGIN,
    getMinHeight: () => WIRELESS_CONTROL_HEIGHT + WIRELESS_CONTROL_MARGIN * 2,
    getMaxHeight: () => WIRELESS_CONTROL_HEIGHT + WIRELESS_CONTROL_MARGIN * 2,
  });
  if (!dom) {
    root.remove?.();
    return;
  }
  dom.serialize = false;
  hideWirelessNativeWidget(widget);

  node.__terryWirelessControl = {
    root,
    control,
    widget: dom,
    refresh() {
      const selected = wirelessChannelName(node);
      if (pack) {
        control.placeholder = labels().channelName;
        if (document.activeElement !== control) control.value = selected;
        return;
      }

      const wired = wirelessUnpackUsesWiredBus(node);
      control.disabled = wired;
      root.classList.toggle("is-disabled", wired);

      const names = wirelessChannelNames(node.graph || app.graph);
      const signature = `${localeCode()}\u0000${names.join("\u0000")}`;
      if (control.__terryChannelSignature !== signature) {
        control.__terryChannelSignature = signature;
        control.replaceChildren?.();
        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.textContent = labels().channelSelect;
        control.append(placeholder);
        for (const name of names) {
          const option = document.createElement("option");
          option.value = name;
          option.textContent = name;
          control.append(option);
        }
      }
      control.value = selected;
    },
  };
  node.__terryWirelessControl.refresh();
}

function initializeWirelessWidget(node) {
  if (!isWireless(node) || wirelessChannelWidget(node)) return;
  const text = labels();
  const pack = isWirelessPack(node);
  const initial = node.properties?.[WIRELESS_CHANNEL_PROPERTY] || (pack ? `${text.defaultChannel} 1` : "");
  const options = {};
  if (!pack) {
    Object.defineProperty(options, "values", {
      get: () => wirelessChannelNames(node.graph || app.graph),
      enumerable: true,
      configurable: true,
    });
  }
  const widget = node.addWidget?.(
    pack ? "text" : "combo",
    pack ? text.channelName : text.channelSelect,
    String(initial),
    (value) => setWirelessChannel(node, value ?? wirelessChannelWidget(node)?.value),
    options
  );
  if (!widget) return;
  widget.terryWirelessChannel = true;
  widget.serialize = true;
  setWirelessChannel(node, initial, false);
  initializeWirelessControl(node);
}

function installOutputModeStyle() {
  if (typeof document === "undefined" || document.getElementById(OUTPUT_MODE_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = OUTPUT_MODE_STYLE_ID;
  style.textContent = `
.terry-bus-output-mode-row{
  display:flex;
  align-items:center;
  justify-content:space-between;
  width:100%;
  height:26px;
  min-height:26px;
  box-sizing:border-box;
  padding:0 2px 0 6px;
  color:rgba(238,238,238,.9);
  font:11px/1.2 Inter,system-ui,sans-serif;
  user-select:none;
  pointer-events:auto;
}
.terry-bus-output-mode-label{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.terry-bus-output-mode-switch{
  position:relative;
  display:inline-flex;
  align-items:center;
  flex:0 0 auto;
  width:30px;
  height:18px;
  margin-left:8px;
  padding:0;
  border:0;
  border-radius:999px;
  background:rgba(255,255,255,.16);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.12);
  cursor:pointer;
  outline:none;
  transition:background .12s ease, box-shadow .12s ease;
}
.terry-bus-output-mode-switch[data-checked="true"]{
  background:var(--p-primary-color,#60a5fa);
}
.terry-bus-output-mode-switch:focus-visible{
  box-shadow:0 0 0 2px color-mix(in srgb,var(--p-primary-color,#60a5fa) 45%,transparent);
}
.terry-bus-output-mode-thumb{
  position:absolute;
  left:2px;
  top:2px;
  width:14px;
  height:14px;
  border-radius:50%;
  background:#f5f5f5;
  box-shadow:0 1px 2px rgba(0,0,0,.35);
  transform:translateX(0);
  transition:transform .12s ease;
}
.terry-bus-output-mode-switch[data-checked="true"] .terry-bus-output-mode-thumb{
  transform:translateX(12px);
}
`;
  document.head.append(style);
}

function refreshOutputModeControl(node) {
  const ui = node?.__terryBusOutputModeControl;
  if (!ui) return;
  const value = unpackExpanded(node);
  ui.label.textContent = labels().expandOutputs;
  ui.button.dataset.checked = String(value);
  ui.button.setAttribute("aria-checked", String(value));
}

function saveUnpackExpandedLinks(node) {
  if (!isUnpack(node) || !unpackExpanded(node)) return;
  const saved = [];
  for (let outputIndex = 0; outputIndex < (node.outputs?.length || 0); outputIndex++) {
    const output = node.outputs[outputIndex];
    const laneId = output?.[LANE_FIELD];
    if (!laneId) continue;
    for (const linkId of output.links || []) {
      const link = getLink(node.graph, linkId);
      if (!link) continue;
      saved.push({
        laneId,
        targetId: link.target_id ?? link.targetId,
        targetSlot: Number(link.target_slot ?? link.targetSlot ?? 0) || 0,
      });
    }
  }
  nodeProperties(node)[UNPACK_SAVED_LINKS_PROPERTY] = saved;
}

function restoreUnpackExpandedLinks(node) {
  if (!isUnpack(node) || !unpackExpanded(node)) return;
  const properties = nodeProperties(node);
  const saved = Array.isArray(properties[UNPACK_SAVED_LINKS_PROPERTY])
    ? properties[UNPACK_SAVED_LINKS_PROPERTY]
    : [];
  if (!saved.length) return;

  for (const item of saved) {
    const outputIndex = (node.outputs || []).findIndex(
      (output) => output?.[LANE_FIELD] === item?.laneId
    );
    const target = getNode(node.graph, item?.targetId);
    const targetSlot = Number(item?.targetSlot) || 0;
    if (outputIndex < 0 || !target?.inputs?.[targetSlot]) continue;

    const alreadyConnected = (node.outputs?.[outputIndex]?.links || []).some((linkId) => {
      const link = getLink(node.graph, linkId);
      return String(link?.target_id ?? link?.targetId ?? "") === String(item.targetId)
        && Number(link?.target_slot ?? link?.targetSlot ?? 0) === targetSlot;
    });
    if (!alreadyConnected) node.connect?.(outputIndex, target, targetSlot);
  }
}

function setUnpackExpanded(node, value, notify = true) {
  if (!isUnpack(node)) return;
  const next = Boolean(value);
  const properties = nodeProperties(node);
  if (properties[UNPACK_OUTPUT_MODE_PROPERTY] === next) {
    refreshOutputModeControl(node);
    return;
  }
  if (!next && unpackExpanded(node)) saveUnpackExpandedLinks(node);
  properties[UNPACK_OUTPUT_MODE_PROPERTY] = next;
  node.__terryBusSignature = null;
  refreshOutputModeControl(node);
  syncUnpack(node, true);
  if (next) restoreUnpackExpandedLinks(node);
  node.__terryBusRefreshVisual?.();
  node.graph?.setDirtyCanvas?.(true, true);
  if (notify) node.graph?.change?.();
}

function initializeUnpackOutputModeControl(node) {
  if (!isUnpack(node) || node.__terryBusOutputModeControl) return;
  if (typeof document === "undefined" || typeof node.addDOMWidget !== "function") return;
  const properties = nodeProperties(node);
  if (properties[UNPACK_OUTPUT_MODE_PROPERTY] == null) properties[UNPACK_OUTPUT_MODE_PROPERTY] = true;

  installOutputModeStyle();

  const row = document.createElement("div");
  row.className = "terry-bus-output-mode-row";

  const label = document.createElement("span");
  label.className = "terry-bus-output-mode-label";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "terry-bus-output-mode-switch p-toggleswitch p-component";
  button.setAttribute("role", "switch");

  const thumb = document.createElement("span");
  thumb.className = "terry-bus-output-mode-thumb";
  button.append(thumb);
  row.append(label, button);

  row.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setUnpackExpanded(node, !unpackExpanded(node));
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    setUnpackExpanded(node, !unpackExpanded(node));
  });

  const widget = node.addDOMWidget(
    "terry_bus_expand_outputs_native",
    "terry_bus_expand_outputs_native",
    row,
    {
      serialize: false,
      hideOnZoom: false,
      margin: OUTPUT_MODE_CONTROL_MARGIN,
      getMinHeight: () => OUTPUT_MODE_CONTROL_HEIGHT,
      getMaxHeight: () => OUTPUT_MODE_CONTROL_HEIGHT,
    }
  );
  if (!widget) {
    row.remove?.();
    return;
  }
  widget.serialize = false;
  node.__terryBusOutputModeControl = { widget, row, label, button, thumb };
  refreshOutputModeControl(node);
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  for (const graph of graphAncestors(getNode.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if (isSet(node) && variableName(node) === name) return { node, graph };
    }
  }
  return null;
}

function linkOrigin(link) {
  return {
    nodeId: link?.origin_id ?? link?.originId,
    slot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
  };
}

function outputPortName(output) {
  if (!output) return null;
  const type = String(output.type || "").trim().toUpperCase();
  const label = String(output.label || "").trim();
  const name = String(output.name || "").trim();
  const localized = String(output.localized_name || "").trim();
  const semantic = (value) => value && value !== EMPTY_TYPE && value.toUpperCase() !== type;

  if (semantic(label) && (label !== localized || !semantic(name))) return label;
  if (semantic(name)) return name;
  if (semantic(label)) return label;
  return localized || label || name || null;
}

function resolveUpstream(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${graph?.id || "g"}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = getLink(graph, linkId);
  if (!link) return null;
  const { nodeId, slot } = linkOrigin(link);
  const node = getNode(graph, nodeId);
  if (!node) return null;

  if (isReroute(node)) return resolveUpstream(graph, node.inputs?.[0]?.link, seen);
  if (isTerrySwitch(node)) {
    const active = selectedSwitchInput(node);
    return active?.link == null ? null : resolveUpstream(node.graph || graph, active.link, seen);
  }

  if (isGet(node)) {
    const setter = findSetter(node);
    const setterLink = setter?.node?.inputs?.[0]?.link;
    if (!setter || setterLink == null) return null;
    return resolveUpstream(setter.graph, setterLink, seen);
  }

  if (isUnpack(node)) {
    const pack = findPackFromUnpack(node);
    if (!pack) return null;

    if (
      !unpackExpanded(node)
      && String(node.outputs?.[slot]?.type || "").toUpperCase() === BUS_TYPE
    ) {
      return {
        node: pack,
        graph: pack.graph,
        nodeId: pack.id,
        slot: 0,
        type: BUS_TYPE,
        name: labels().bus,
      };
    }

    const entries = effectivePackLaneEntries(pack);
    ensureUnpackLaneIds(node, entries.map((entry) => entry.lane));
    const laneId = node.outputs?.[slot]?.[LANE_FIELD];
    const entry = laneId ? entries.find((item) => item.laneId === laneId) : null;
    const input = entry?.input;
    if (entry?.mediaPack) return entry.source || null;
    return input?.link == null ? null : resolveUpstream(entry.inputGraph || pack.graph, input.link, seen);
  }

  const output = node.outputs?.[slot];
  const outputType = String(output?.type || "").trim();
  return {
    node,
    graph,
    nodeId,
    slot,
    type: outputType && outputType !== EMPTY_TYPE ? outputType : link.type || EMPTY_TYPE,
    name: outputPortName(output),
  };
}

// Preserve the real switch node, but expose a BUS socket when its active
// input carries one. Bus-Out follows the active upstream wire itself.
function syncSwitchBusType(node) {
  if (!isTerrySwitch(node) || !node.outputs?.[0]) return false;
  const output = node.outputs[0];
  const active = selectedSwitchInput(node);
  const source = active?.link == null ? null : resolveUpstream(node.graph, active.link);
  const bus = source?.type === BUS_TYPE;
  if (bus && !node.__terrySwitchBusTypeOverridden) {
    // A saved workflow can already contain our BUS socket; never cache BUS
    // as the native output type when restoring the original switch.
    node.__terrySwitchBusOriginalType = output.type === BUS_TYPE ? EMPTY_TYPE : output.type;
    node.__terrySwitchBusTypeOverridden = true;
  }
  if (!bus && !node.__terrySwitchBusTypeOverridden && output.type !== BUS_TYPE) return false;
  const type = bus ? BUS_TYPE : (node.__terrySwitchBusOriginalType || EMPTY_TYPE);
  if (!bus) {
    delete node.__terrySwitchBusOriginalType;
    delete node.__terrySwitchBusTypeOverridden;
  }
  if (output.type === type) return false;
  output.type = type;
  for (const linkId of output.links || []) {
    if (type !== EMPTY_TYPE) syncConnectionType(node.graph, linkId, type);
    else {
      const link = getLink(node.graph, linkId);
      if (link) {
        link.type = EMPTY_TYPE;
        delete link.color;
      }
    }
  }
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function refreshSwitchBus(node) {
  if (!isTerrySwitch(node)) return;
  syncSwitchBusType(node);
  syncAllUnpacks();
}

function collectDownstreamTargets(graph, node, outputSlot, seenNodes = new Set()) {
  const result = [];
  for (const linkId of node?.outputs?.[outputSlot]?.links || []) {
    const link = getLink(graph, linkId);
    if (!link) continue;
    const targetId = link.target_id ?? link.targetId;
    const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
    const target = getNode(graph, targetId);
    if (!target) continue;
    if (isReroute(target)) {
      const key = `${graph?.id || "g"}:${target.id}`;
      if (seenNodes.has(key)) continue;
      seenNodes.add(key);
      result.push(...collectDownstreamTargets(graph, target, 0, seenNodes));
      continue;
    }
    result.push({ node: target, nodeId: targetId, slot: targetSlot, graph });
  }
  return result;
}

function findPackFromUnpack(unpack) {
  if (isWirelessUnpack(unpack)) {
    const linkId = unpack?.inputs?.[0]?.link;
    if (unpack?.graph && linkId != null) {
      const upstream = resolveUpstream(unpack.graph, linkId);
      if (upstream && isPack(upstream.node)) return upstream.node;
    }
    const name = wirelessChannelName(unpack);
    if (!name) return null;
    return wirelessPacksInScope(unpack.graph || app.graph)
      .find((node) => wirelessChannelName(node) === name) || null;
  }
  return null;
}

function storedPackLanes(pack) {
  const properties = nodeProperties(pack);
  const raw = Array.isArray(properties[PACK_LANES_PROPERTY]) ? properties[PACK_LANES_PROPERTY] : [];
  const lanes = [];
  const seen = new Set();
  for (const value of raw) {
    const lane = typeof value === "string" ? { id: value } : { ...value };
    const id = String(lane?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    lanes.push({
      id,
      name: String(lane.name || "").trim(),
      type: String(lane.type || EMPTY_TYPE).trim() || EMPTY_TYPE,
    });
  }
  properties[PACK_LANES_PROPERTY] = lanes;
  return lanes;
}

function isAddWireInput(input) {
  if (!input || input.link != null || input[LANE_FIELD]) return false;
  const name = String(input.name || "").trim();
  const label = String(input.label || "").trim();
  return name === "wire" || label === labels().addWire;
}

function removeExtraAddWireInputs(pack) {
  const inputs = pack?.inputs || [];
  const lastIndex = inputs.length - 1;
  for (let index = lastIndex - 1; index >= 0; index--) {
    if (isAddWireInput(inputs[index])) pack.removeInput?.(index);
  }
}

function ensurePackLanes(pack) {
  if (!pack) return [];
  removeExtraAddWireInputs(pack);
  const stored = storedPackLanes(pack);
  const byId = new Map(stored.map((lane) => [lane.id, lane]));
  const inputs = pack.inputs || [];
  const hasAddWire = inputs.length > 0 && isAddWireInput(inputs[inputs.length - 1]);
  const laneInputCount = inputs.length - (hasAddWire ? 1 : 0);
  const count = Math.max(stored.length, laneInputCount);
  const lanes = [];
  const used = new Set();

  for (let index = 0; index < count; index++) {
    let input = pack.inputs?.[index];
    if (!input) input = pack.addInput?.("wire", EMPTY_TYPE);
    if (!input) continue;

    let id = String(input[LANE_FIELD] || stored[index]?.id || "").trim();
    if (!id || used.has(id)) id = newLaneId();
    used.add(id);
    input[LANE_FIELD] = id;

    const previous = byId.get(id) || stored[index] || {};
    lanes.push({
      id,
      name: String(previous.name || input.label || input.name || "").trim(),
      type: String(previous.type || input.type || EMPTY_TYPE).trim() || EMPTY_TYPE,
    });
  }

  nodeProperties(pack)[PACK_LANES_PROPERTY] = lanes;
  return lanes;
}

function laneInput(pack, laneId) {
  return (pack?.inputs || []).find((input) => input?.[LANE_FIELD] === laneId) || null;
}

function connectedUnpacksForPack(pack) {
  const result = [];
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) {
      if (isUnpack(node) && findPackFromUnpack(node) === pack) result.push(node);
    }
  }
  return result;
}

function ensureUnpackLaneIds(unpack, lanes) {
  const properties = nodeProperties(unpack);
  const stored = Array.isArray(properties[UNPACK_LANES_PROPERTY])
    ? properties[UNPACK_LANES_PROPERTY].map((id) => String(id || ""))
    : [];
  const ids = [];
  for (let index = 0; index < (unpack.outputs?.length || 0); index++) {
    const output = unpack.outputs[index];
    if (output?.[BUS_OUTPUT_FIELD]) continue;
    const id = String(output?.[LANE_FIELD] || stored[index] || lanes[index]?.id || "").trim();
    if (!id) continue;
    output[LANE_FIELD] = id;
    ids[index] = id;
  }
  properties[UNPACK_LANES_PROPERTY] = ids;
  return ids;
}

function laneHasOutputLinks(pack, laneId) {
  const lanes = ensurePackLanes(pack);
  for (const unpack of connectedUnpacksForPack(pack)) {
    if (!unpackExpanded(unpack)) continue;
    ensureUnpackLaneIds(unpack, lanes);
    const output = (unpack.outputs || []).find((item) => item?.[LANE_FIELD] === laneId);
    if ((output?.links?.length || 0) > 0) return true;
  }
  return false;
}

function displayType(type) {
  const value = String(type || EMPTY_TYPE).trim();
  return value && value !== EMPTY_TYPE ? value : null;
}

function numberDuplicateTypes(entries) {
  const totals = new Map();
  const bases = entries.map((entry, index) => {
    const rawName = String(entry.name || "").trim();
    const name = rawName && rawName !== "wire" ? rawName : "";
    return name || displayType(entry.type) || `${labels().input} ${index + 1}`;
  });
  for (const base of bases) totals.set(base, (totals.get(base) || 0) + 1);
  const seen = new Map();
  return entries.map((entry, index) => {
    const base = bases[index];
    const current = (seen.get(base) || 0) + 1;
    seen.set(base, current);
    return { ...entry, name: (totals.get(base) || 0) > 1 ? `${base} ${current}` : base };
  });
}

function packLaneEntries(pack) {
  if (!pack?.graph) return [];
  const lanes = ensurePackLanes(pack);
  const entries = lanes.map((lane, index) => {
    const input = laneInput(pack, lane.id);
    const source = input?.link == null ? null : resolveUpstream(pack.graph, input.link);
    return {
      laneId: lane.id,
      lane,
      input,
      source,
      type: source?.type || lane.type || input?.type || EMPTY_TYPE,
      name: source?.name || lane.name || input?.label || input?.name || `${labels().input} ${index + 1}`,
    };
  });
  const numbered = numberDuplicateTypes(entries);
  for (const entry of numbered) {
    if (entry.source) {
      entry.lane.name = entry.name;
      entry.lane.type = entry.type || EMPTY_TYPE;
    }
  }
  nodeProperties(pack)[PACK_LANES_PROPERTY] = lanes;
  return numbered;
}

function effectivePackLaneEntries(pack, seen = new Set()) {
  if (!pack || seen.has(pack)) return [];
  seen.add(pack);
  if (isMediaPack(pack)) return (pack.__terryBusLaneEntries?.() || [])
    .map(entry => ({ ...entry, mediaPack: pack }));
  const physical = packLaneEntries(pack);
  const bridge = physical.find(entry => entry.source?.type === BUS_TYPE && isPack(entry.source.node));
  if (bridge) {
    // Bus-In forwards the upstream lanes instead of wrapping the entire bus
    // in one lane. Preserve their identities, media origin and source graph.
    return effectivePackLaneEntries(bridge.source.node, seen).map(entry => ({
      ...entry, bridgeInput: bridge.input, bridgeLaneId: bridge.laneId,
    }));
  }
  return physical.map((entry) => ({
    ...entry,
    inputGraph: pack.graph,
  }));
}

function disconnectAllOutputLinks(node, outputIndex) {
  for (const linkId of [...(node.outputs?.[outputIndex]?.links || [])]) {
    const link = getLink(node.graph, linkId);
    if (!link) continue;
    const target = getNode(node.graph, link.target_id ?? link.targetId);
    if (target) node.disconnectOutput?.(outputIndex, target, link.target_slot ?? link.targetSlot ?? 0);
  }
}

function removeAllOutputs(node) {
  for (let index = (node.outputs?.length || 0) - 1; index >= 0; index--) {
    disconnectAllOutputLinks(node, index);
    node.removeOutput?.(index);
  }
}

function syncConnectionType(graph, linkId, type) {
  const link = getLink(graph, linkId);
  const nextType = String(type || EMPTY_TYPE).trim() || EMPTY_TYPE;
  if (!link || nextType === EMPTY_TYPE || link.type === nextType) return;

  const colors = globalThis.LGraphCanvas?.link_type_colors || {};
  const previousColor = colors[link.type] || colors[String(link.type || "").toUpperCase()];
  const currentColor = String(link.color || "").trim().toLowerCase();
  const inheritedColor = previousColor
    && currentColor
    && currentColor === String(previousColor).trim().toLowerCase();

  link.type = nextType;
  if (inheritedColor) {
    const nextColor = colors[nextType] || colors[nextType.toUpperCase()];
    if (nextColor) link.color = nextColor;
    else delete link.color;
  }
}

function signatureForEntries(entries) {
  return entries.map((entry) =>
    `${entry.laneId}:${entry.source?.nodeId ?? ""}:${entry.source?.slot ?? ""}:${entry.type}:${entry.name}`
  ).join("|");
}

function localizeFixedPorts(node, updateTitle = false) {
  const text = labels();
  if (isWirelessPack(node)) {
    const out = node.outputs?.[0];
    if (out) { out.name = "bus"; out.label = text.bus; out.type = BUS_TYPE; }
    const widget = wirelessChannelWidget(node);
    if (widget) widget.name = text.channelName;
    if (updateTitle) node.title = text.wirelessPackTitle;
  } else if (isWirelessUnpack(node)) {
    const input = node.inputs?.[0];
    if (input) { input.name = "bus"; input.label = text.bus; input.type = BUS_TYPE; }
    if (!unpackExpanded(node)) {
      const out = node.outputs?.[0];
      if (out) { out.name = "bus"; out.label = text.bus; out.type = BUS_TYPE; }
    }
    const widget = wirelessChannelWidget(node);
    if (widget) widget.name = text.channelSelect;
    if (updateTitle) node.title = text.wirelessUnpackTitle;
  }
  if (isUnpack(node)) refreshOutputModeControl(node);
}

function emptyLaneLabel(name, index) {
  const fallback = name || `${labels().input} ${index + 1}`;
  return isChineseLocale() ? `[空] ${fallback}` : `[Empty] ${fallback}`;
}

function compactBusNodeHeight(laneCount) {
  return Math.max(
    COMPACT_NODE_MIN_HEIGHT,
    COMPACT_NODE_HEADER_HEIGHT + Math.max(1, Number(laneCount) || 0) * COMPACT_NODE_LANE_HEIGHT
  );
}

function controlBlockHeight(node) {
  if (isWirelessUnpack(node)) return 40 + OUTPUT_MODE_CONTROL_HEIGHT;
  if (isWirelessPack(node)) return 40;
  return 0;
}

function compactBusNodeMinimumHeight(node, laneCount) {
  if (isUnpack(node) && !unpackExpanded(node)) {
    return BUS_ONLY_WIRELESS_HEIGHT;
  }
  const slotHeight = Math.max(16, Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20);
  const visibleSlots = Math.max(1, Number(laneCount) || 0) + (isPack(node) ? 1 : 0);
  return COMPACT_NODE_SLOT_PADDING + visibleSlots * slotHeight + controlBlockHeight(node);
}

function stableExpandedHeight(node, fallback = 0) {
  if (!node) return Math.max(0, Number(fallback) || 0);
  const current = node.flags?.collapsed ? 0 : (Number(node.size?.[1]) || 0);
  const stored = Number(node.__terryBusExpandedSize?.[1]) || 0;
  const preferred = Number(node.__terryBusPreferredHeight) || 0;
  const minimum = Number(node.__terryBusMinHeight) || 0;
  return Math.max(Number(fallback) || 0, current, stored, preferred, minimum);
}

function resizeCompactBusNode(node, laneCount, pairedPack = null) {
  if (!node) return;

  const busOnly = isUnpack(node) && !unpackExpanded(node);
  const fixedBusOnlyHeight = busOnly
    ? BUS_ONLY_WIRELESS_HEIGHT
    : 0;

  const minHeight = busOnly
    ? fixedBusOnlyHeight
    : compactBusNodeMinimumHeight(node, laneCount);

  const preferredHeight = busOnly
    ? fixedBusOnlyHeight
    : Math.max(
        minHeight,
        compactBusNodeHeight(laneCount) + controlBlockHeight(node)
      );

  const initialized = node.__terryBusLayoutInitialized === true;
  const currentWidth = Number(node.size?.[0]) || COMPACT_NODE_WIDTH;
  const currentHeight = Number(node.size?.[1]) || preferredHeight;
  const previousPreferredHeight = Number(node.__terryBusPreferredHeight) || preferredHeight;
  const customHeight = initialized && Math.abs(currentHeight - previousPreferredHeight) > 0.5;
  const width = initialized ? Math.max(COMPACT_NODE_WIDTH, currentWidth) : COMPACT_NODE_WIDTH;

  const inheritsPairedHeight = !busOnly && (
    (isUnpack(node) && isWirelessPack(pairedPack))
  );

  let pairedHeight = 0;
  if (inheritsPairedHeight) {
    pairedHeight = stableExpandedHeight(pairedPack);
    if (pairedHeight > 0 && isUnpack(node)) pairedHeight += OUTPUT_MODE_CONTROL_HEIGHT;
    if (pairedHeight > 0) pairedHeight = Math.max(minHeight, pairedHeight);
  }

  const height = busOnly
    ? fixedBusOnlyHeight
    : (isUnpack(node) && isMediaPack(pairedPack)
        ? preferredHeight
        : (pairedHeight || (customHeight ? Math.max(minHeight, currentHeight) : preferredHeight)));

  node.__terryBusCompactWidth = COMPACT_NODE_WIDTH;
  node.__terryBusMinHeight = minHeight;
  node.__terryBusPreferredHeight = pairedHeight || preferredHeight;
  node.__terryBusLayoutInitialized = true;

  const blockHeight = controlBlockHeight(node);
  if (blockHeight > 0) node.widgets_start_y = Math.max(0, height - blockHeight);

  node.__terryBusExpandedSize = [width, height];
  if (!node.flags?.collapsed) node.setSize?.([width, height]);
}

function ensureUnpackBusOutput(unpack) {
  const outputs = unpack.outputs || [];
  const current = outputs[0];

  // Dynamic slot metadata is not guaranteed to round-trip through every
  // ComfyUI graph serializer. A restored BUS-only output can therefore
  // lose BUS_OUTPUT_FIELD even though it is still the same physical slot.
  // Reuse that slot in place so its outgoing links survive reload.
  // A real expanded lane always carries LANE_FIELD, so toggling from an
  // expanded single-lane output still rebuilds the slot as intended.
  const alreadyBusOnly = outputs.length === 1
    && String(current?.type || "").toUpperCase() === BUS_TYPE
    && (
      current?.[BUS_OUTPUT_FIELD] === true
      || !current?.[LANE_FIELD]
    );

  if (!alreadyBusOnly) {
    removeAllOutputs(unpack);
    const added = unpack.addOutput?.("bus", BUS_TYPE);
    const output = unpack.outputs?.[0] || added;
    if (output) {
      output.name = "bus";
      output.label = labels().bus;
      output.type = BUS_TYPE;
      output[BUS_OUTPUT_FIELD] = true;
      delete output[LANE_FIELD];
    }
  } else {
    current.name = "bus";
    current.label = labels().bus;
    current.type = BUS_TYPE;
    current[BUS_OUTPUT_FIELD] = true;
    delete current[LANE_FIELD];
    for (const linkId of current.links || []) {
      syncConnectionType(unpack.graph, linkId, BUS_TYPE);
    }
  }

  nodeProperties(unpack)[UNPACK_LANES_PROPERTY] = [];
}

function clearBusOnlyOutputForExpanded(unpack) {
  if (!(unpack.outputs || []).some((output) => output?.[BUS_OUTPUT_FIELD] === true)) return;
  removeAllOutputs(unpack);
  nodeProperties(unpack)[UNPACK_LANES_PROPERTY] = [];
}

function syncUnpack(unpack, force = false) {
  if (!isUnpack(unpack) || unpack.__terryBusSyncing) return;
  unpack.__terryBusSyncing = true;
  try {
    localizeFixedPorts(unpack);
    initializeUnpackOutputModeControl(unpack);
    refreshOutputModeControl(unpack);
    if (isWirelessUnpack(unpack)) unpack.__terryWirelessControl?.refresh?.();

    const pack = findPackFromUnpack(unpack);
    const entries = pack ? effectivePackLaneEntries(pack) : [];

    if (!unpackExpanded(unpack)) {
      const signature = `BUS:${String(pack?.id ?? "")}:${wirelessChannelName(unpack)}`;
      const targetHeight = BUS_ONLY_WIRELESS_HEIGHT;
      const busOutputReady = (unpack.outputs?.length || 0) === 1
        && String(unpack.outputs?.[0]?.type || "").toUpperCase() === BUS_TYPE
        && unpack.outputs?.[0]?.[BUS_OUTPUT_FIELD] === true;
      const matchingHeight = Math.abs(Number(unpack.size?.[1] || 0) - targetHeight) <= 0.5;

      if (!force && unpack.__terryBusSignature === signature && busOutputReady && matchingHeight) return;

      unpack.__terryBusSignature = signature;
      ensureUnpackBusOutput(unpack);
      resizeCompactBusNode(unpack, 1, null);
      unpack.__terryBusRefreshVisual?.();
      unpack.graph?.setDirtyCanvas?.(true, true);
      return;
    }

    clearBusOnlyOutputForExpanded(unpack);

    const signature = `EXP:${signatureForEntries(entries)}`;
    if (!force && unpack.__terryBusSignature === signature) {
      resizeCompactBusNode(unpack, entries.length, pack);
      unpack.__terryBusRefreshVisual?.();
      return;
    }
    unpack.__terryBusSignature = signature;

    ensureUnpackLaneIds(unpack, entries.map((entry) => entry.lane));
    const desiredIds = new Set(entries.map((entry) => entry.laneId));
    const hasMediaLanes = isMediaPack(pack) || entries.some(entry => entry.mediaPack);
    const mediaOrderOnly = hasMediaLanes
      && (unpack.outputs?.length || 0) === entries.length
      && unpack.outputs.every((output, index) =>
        desiredIds.has(output[LANE_FIELD]) && output.type === entries[index].type);
    if (mediaOrderOnly) {
      // Sorting changes the media at each numbered port, never the wire endpoint.
      unpack.outputs.forEach((output, index) => { output[LANE_FIELD] = entries[index].laneId; });
    }

    for (let index = (unpack.outputs?.length || 0) - 1; index >= 0; index--) {
      const output = unpack.outputs[index];
      if (desiredIds.has(output?.[LANE_FIELD])) continue;
      disconnectAllOutputLinks(unpack, index);
      unpack.removeOutput?.(index);
    }

    for (const entry of entries) {
      let output = (unpack.outputs || []).find((item) => item?.[LANE_FIELD] === entry.laneId);
      if (!output) {
        const previousLength = unpack.outputs?.length || 0;
        const added = unpack.addOutput?.(entry.name || labels().output, entry.type || EMPTY_TYPE);
        output = unpack.outputs?.[previousLength] || added;
        if (output) output[LANE_FIELD] = entry.laneId;
      }
    }

    if (hasMediaLanes && !mediaOrderOnly) {
      // Preserve surviving asset connections when ports are added or removed.
      const connections = new Map(unpack.outputs.map(output => [output, [...(output.links || [])]]));
      const ordered = entries.map(entry => unpack.outputs.find(output => output[LANE_FIELD] === entry.laneId));
      unpack.outputs.splice(0, unpack.outputs.length, ...ordered);
      ordered.forEach((output, index) => {
        for (const id of connections.get(output) || []) {
          const link = getLink(unpack.graph, id);
          if (link) link.origin_slot = index;
        }
      });
    }

    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index];
      const output = (unpack.outputs || []).find((item) => item?.[LANE_FIELD] === entry.laneId);
      if (!output) continue;
      delete output[BUS_OUTPUT_FIELD];
      output.type = entry.type || EMPTY_TYPE;
      if (output.type === BUS_TYPE) {
        output.name = "bus";
        output.label = labels().bus;
      } else {
        output.name = entry.source || entry.mediaPack ? entry.name : emptyLaneLabel(entry.name, index);
        output.label = output.name;
      }
      for (const linkId of output.links || []) syncConnectionType(unpack.graph, linkId, output.type);
    }

    nodeProperties(unpack)[UNPACK_LANES_PROPERTY] = (unpack.outputs || []).map(
      (output) => output?.[LANE_FIELD] || ""
    );

    resizeCompactBusNode(unpack, entries.length, pack);
    unpack.__terryBusRefreshVisual?.();
    unpack.graph?.setDirtyCanvas?.(true, true);
  } finally {
    unpack.__terryBusSyncing = false;
  }
}

function syncAllUnpacks() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || []) if (isUnpack(node)) syncUnpack(node);
  }
}

export function syncMediaBusOutputs(pack) {
  for (const unpack of connectedUnpacksForPack(pack)) syncUnpack(unpack, true);
}

// BUS receivers and H3 editors do not hold a specific media slot.
// Protect only actual downstream consumers of a particular expanded media output.
function isPassiveMediaReference(node) {
  const type = nodeType(node);
  return H3_TYPES.has(type) || type === LIST_TYPE || isUnpack(node) || isWirelessPack(node) || isTerrySwitch(node);
}

function hasProtectedMediaConsumer(node, outputIndex) {
  return collectDownstreamTargets(node?.graph, node, outputIndex)
    .some(target => !isPassiveMediaReference(target.node));
}

export function mediaAssetHasReferences(pack, assetId) {
  const lanes = effectivePackLaneEntries(pack).map(entry => entry.lane);
  for (const unpack of connectedUnpacksForPack(pack)) {
    if (!unpackExpanded(unpack)) {
      if (hasProtectedMediaConsumer(unpack, 0)) return true;
      continue;
    }
    ensureUnpackLaneIds(unpack, lanes);
    for (let index = 0; index < (unpack.outputs?.length || 0); index++) {
      if (unpack.outputs[index]?.[LANE_FIELD] === assetId && hasProtectedMediaConsumer(unpack, index)) {
        return true;
      }
    }
  }
  return hasProtectedMediaConsumer(pack, 0);
}

function refreshPackSlots(pack) {
  if (isMediaPack(pack)) return;
  if (!pack?.graph || app.configuringGraph) return;
  const text = labels();
  localizeFixedPorts(pack);
  let entries = packLaneEntries(pack);

  for (const unpack of connectedUnpacksForPack(pack)) syncUnpack(unpack, true);

  const removable = entries.filter((entry) =>
    !entry.source && entry.input?.link == null && !laneHasOutputLinks(pack, entry.laneId)
  );
  for (const entry of removable) {
    const index = (pack.inputs || []).findIndex((input) => input?.[LANE_FIELD] === entry.laneId);
    if (index >= 0) pack.removeInput?.(index);
    const lanes = storedPackLanes(pack);
    nodeProperties(pack)[PACK_LANES_PROPERTY] = lanes.filter((lane) => lane.id !== entry.laneId);
  }

  entries = packLaneEntries(pack);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    const input = entry.input;
    if (!input) continue;
    input.type = entry.source?.type || (input.link != null ? entry.type : EMPTY_TYPE);
    if (input.type === BUS_TYPE) {
      input.name = "bus";
      input.label = text.bus;
    } else {
      input.name = entry.source ? entry.name : `lane_${entry.laneId}`;
      input.label = entry.source ? entry.name : emptyLaneLabel(entry.name, index);
    }
    if (input.link != null) syncConnectionType(pack.graph, input.link, input.type);
  }

  const upstreamBusEntry = entries.find((entry) =>
    entry.source?.type === BUS_TYPE || (entry.input?.link != null && entry.input.type === BUS_TYPE)
  );
  const busOnlyMode = Boolean(upstreamBusEntry);
  if (busOnlyMode) {
    for (let index = (pack.inputs?.length || 0) - 1; index >= 0; index--) {
      if (isAddWireInput(pack.inputs[index])) pack.removeInput?.(index);
    }
  } else {
    const last = pack.inputs?.[pack.inputs.length - 1];
    if (!last || last[LANE_FIELD] || last.link != null || last.type !== EMPTY_TYPE) {
      const input = pack.addInput("wire", EMPTY_TYPE);
      if (input) input.label = text.addWire;
    } else {
      last.name = "wire";
      last.label = text.addWire;
      last.type = EMPTY_TYPE;
    }
  }

  const publishedEntries = isWirelessPack(pack) ? effectivePackLaneEntries(pack) : entries;
  resizeCompactBusNode(pack, entries.length, upstreamBusEntry?.source?.node || null);
  pack.__terryBusPublishedLaneCount = publishedEntries.length;
  pack.__terryBusRefreshVisual?.();
  queueMicrotask(syncAllUnpacks);
  pack.graph?.setDirtyCanvas?.(true, true);
}

function executionPromptSource(prompt, source, current) {
  const sourceId = String(source?.nodeId ?? source?.node?.id ?? "");
  const mediaSource = mediaExecutionSource(prompt, source, sourceId);
  if (mediaSource) return mediaSource;
  const sourceSlot = Number(source?.slot) || 0;
  const hasPromptNode = (id) => id != null
    && Object.prototype.hasOwnProperty.call(prompt, String(id));

  if (hasPromptNode(sourceId)) return [sourceId, sourceSlot];

  if (Array.isArray(current) && hasPromptNode(current[0])) {
    return [String(current[0]), Number(current[1]) || 0];
  }

  const resolvedLink = source?.node?.getInputLink?.(sourceSlot);
  const resolvedId = resolvedLink?.origin_id ?? resolvedLink?.originId;
  if (hasPromptNode(resolvedId)) {
    const resolvedSlot = resolvedLink?.origin_slot ?? resolvedLink?.originSlot;
    return [String(resolvedId), Number(resolvedSlot) || 0];
  }

  if (source?.node?.subgraph || source?.node?.isSubgraphNode?.()) return null;
  return [sourceId, sourceSlot];
}

function listBusEntries(node) {
  const upstream = resolveUpstream(node.graph, node.inputs?.find(input => input.name === "bus")?.link);
  return upstream && isPack(upstream.node) ? effectivePackLaneEntries(upstream.node) : [];
}

function syncBusList(node) {
  const entries = listBusEntries(node).filter(entry => entry.source && !entry.empty);
  const names = { IMAGE: "图片", AUDIO: "音频", VIDEO: "视频", MASK: "遮罩",
    STRING: "文本", INT: "整数", FLOAT: "小数", BOOLEAN: "布尔" };
  const counts = new Map();
  for (const entry of entries) counts.set(entry.type, (counts.get(entry.type) || 0) + 1);
  const summary = [...counts].map(([type, count]) => `${isChineseLocale() ? names[type] || type : type} ${count}`).join(" · ");
  const text = !entries.length ? (isChineseLocale() ? "未识别到数据" : "No data detected")
    : `${counts.size > 1 ? (isChineseLocale() ? "混合：" : "Mixed: ") : ""}${summary}`;
  const info = node.__terryBusListInfo;
  if (info && info.title !== text) {
    info.title = text;
    if (typeof document === "undefined" || !info.replaceChildren) info.textContent = text;
    else {
      info.setAttribute("aria-label", text);
      info.replaceChildren();
      if (!entries.length) info.textContent = text;
      const colors = { IMAGE: "#85b7eb", AUDIO: "#b49be1", VIDEO: "#8ac5ac" };
      for (const [type, count] of counts) {
        const item = document.createElement("span");
        item.style.cssText = "display:inline-flex;align-items:center;gap:7px;white-space:nowrap;";
        const dot = document.createElement("span");
        dot.style.cssText = `width:5px;height:5px;border-radius:50%;background:${colors[type] || "#aeb8c4"};flex:none;`;
        const label = document.createElement("span");
        label.textContent = isChineseLocale() ? names[type] || type : type;
        label.style.cssText = "color:var(--descrip-text,#b1b6bf);font-size:12px;";
        const number = document.createElement("span");
        number.textContent = String(count);
        number.style.cssText = "color:var(--input-text,#e7eaf0);font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;";
        item.append(dot, label, number);
        info.append(item);
      }
    }
  }
  const output = node.outputs?.[0];
  if (output) {
    output.type = counts.size === 1 ? entries[0].type : EMPTY_TYPE;
    output.name = isChineseLocale() ? "列表" : "List";
    output.label = output.name;
    for (const link of output.links || []) syncConnectionType(node.graph, link, output.type);
  }
  return entries;
}

function initializeBusList(node) {
  if (!node.__terryBusListInfo && typeof document !== "undefined" && node.addDOMWidget) {
    const info = document.createElement("div");
    info.style.cssText = "display:flex;align-items:center;flex-wrap:wrap;gap:8px 15px;width:calc(100% - 12px);margin:3px 6px;min-height:42px;padding:9px 11px;border:1px solid rgba(170,183,203,.16);border-radius:8px;background:rgba(12,16,22,.2);color:var(--descrip-text,#b1b6bf);font:12px/1.5 Inter,system-ui,sans-serif;box-sizing:border-box;";
    const widget = node.addDOMWidget("terry_bus_list_info", "div", info, { serialize: false });
    widget.computeSize = width => [width, Math.max(48, Math.ceil((info.title?.length || 0) * 7 / Math.max(100, width - 40)) * 22 + 22)];
    node.__terryBusListInfo = info;
  }
  syncBusList(node);
}

function expandBusListPrompt(graph, prompt) {
  for (const node of graph?._nodes || []) {
    if (nodeType(node) !== LIST_TYPE) continue;
    const target = prompt[String(node.id)];
    if (!target) continue;
    const entries = syncBusList(node);
    if (entries.length > 100) throw new Error("总线转列表最多支持 100 个非空项，请拆分总线后重试。");
    target.inputs ||= {};
    delete target.inputs.bus;
    for (const key of Object.keys(target.inputs)) if (key.startsWith("items.item_")) delete target.inputs[key];
    entries.forEach((entry, index) => {
      const source = executionPromptSource(prompt, entry.source, null);
      if (source) target.inputs[`items.item_${index}`] = source;
    });
  }
}

function promptInputDeclaration(node, name) {
  const inputs = node?.constructor?.nodeData?.input;
  // Autogrow prompt keys are dotted (for example ref_videos.ref_video_0),
  // while the node definition marks their parent group as optional.
  for (let key = name; key; key = key.includes(".") ? key.slice(0, key.lastIndexOf(".")) : "") {
    for (const category of ["optional", "required"]) {
      const spec = inputs?.[category]?.[key];
      if (spec) return { optional: category === "optional", lazy: spec[1]?.lazy === true };
    }
  }
  const slot = node?.inputs?.find(input => input.name === name);
  return slot?.shape === 7 ? { optional: true, lazy: false } : null;
}

function omitBlockedOptionalReferences(graph, prompt, emptySources) {
  // Propagate only blockers introduced by our empty media slots. A required
  // converter input blocks all its outputs, but an optional reference should
  // be omitted rather than blocking an otherwise runnable generation branch.
  const blocked = new Set(emptySources);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph?._nodes || []) {
      const id = String(node.id);
      const data = prompt[id];
      if (!data?.inputs || blocked.has(id)) continue;
      for (const [name, value] of Object.entries(data.inputs)) {
        if (!Array.isArray(value) || value.length !== 2 || !blocked.has(String(value[0]))) continue;
        const declaration = promptInputDeclaration(node, name);
        if (!declaration || declaration.lazy) continue;
        if (declaration.optional) delete data.inputs[name];
        else { blocked.add(id); break; }
        changed = true;
      }
      if (blocked.has(id)) changed = true;
    }
  }
}

function patchGraphToPrompt() {
  if (app.__terryWireBusPatched) return;
  app.__terryWireBusPatched = true;
  const original = app.graphToPrompt;
  if (typeof original !== "function") return;

  app.graphToPrompt = async function (...args) {
    const result = await Reflect.apply(original, this, args);
    try {
      const prompt = result?.output;
      if (!prompt) return result;

      for (const graph of allGraphs(this.graph || app.graph)) {
        expandBusListPrompt(graph, prompt);
        const emptySources = new Set();
        for (const unpack of graph?._nodes || []) {
          if (!isUnpack(unpack) || !unpackExpanded(unpack)) continue;
          const pack = findPackFromUnpack(unpack);
          if (!pack) continue;
          const entries = effectivePackLaneEntries(pack);

          for (const entry of entries) {
            const source = entry?.source;
            if (!source && !entry.empty) continue;
            const outputIndex = (unpack.outputs || []).findIndex(
              (output) => output?.[LANE_FIELD] === entry.laneId
            );
            if (outputIndex < 0) continue;
            for (const target of collectDownstreamTargets(graph, unpack, outputIndex)) {
              if (
                isPack(target.node)
                || isUnpack(target.node)
                || isReroute(target.node)
                || isGet(target.node)
                || isSet(target.node)
              ) continue;
              const targetPrompt = prompt[String(target.nodeId)] || prompt[target.nodeId];
              const input = target.node?.inputs?.[target.slot];
              if (!targetPrompt?.inputs || !input?.name) continue;
              if (entry.empty) {
                // Optional references are absent; required consumers silently
                // skip their branch through the native ExecutionBlocker adapter.
                const declaration = promptInputDeclaration(target.node, input.name);
                if (declaration && !declaration.optional) {
                  const blocked = mediaExecutionSource(prompt, { assetId: entry.laneId }, String(entry.mediaPack?.id ?? pack.id));
                  if (blocked) {
                    targetPrompt.inputs[input.name] = blocked;
                    emptySources.add(String(blocked[0]));
                  }
                } else delete targetPrompt.inputs[input.name];
                continue;
              }
              const resolved = executionPromptSource(prompt, source, targetPrompt.inputs[input.name]);
              if (resolved) targetPrompt.inputs[input.name] = resolved;
            }
          }
        }
        omitBlockedOptionalReferences(graph, prompt, emptySources);
      }
    } catch (error) {
      console.error("[TerryXu Wire Bus] Failed to expand virtual bus", error);
      throw error;
    }
    return result;
  };
}

let bridgeTimer = null;
let lastBridgeLocale = localeCode();

function startBridge() {
  if (bridgeTimer) return;
  bridgeTimer = setInterval(() => {
    const nextLocale = localeCode();
    const localeChanged = nextLocale !== lastBridgeLocale;
    if (localeChanged) lastBridgeLocale = nextLocale;

    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) {
        if (isTerrySwitch(node)) syncSwitchBusType(node);
        if (nodeType(node) === LIST_TYPE) syncBusList(node);
        if (isWireless(node)) {
          initializeWirelessControl(node);
          if (localeChanged) node.__terryWirelessControl?.refresh?.();
        }

        if (isPack(node)) {
          localizeFixedPorts(node, localeChanged);
          const last = node.inputs?.[node.inputs.length - 1];
          if (last?.link == null && last?.type === EMPTY_TYPE) last.label = labels().addWire;
        }

        if (isUnpack(node)) {
          initializeUnpackOutputModeControl(node);
          if (localeChanged) refreshOutputModeControl(node);
          localizeFixedPorts(node, localeChanged);
          syncUnpack(node);
        }
      }
    }
  }, 300);
}

function makeNodeDef(name, displayName, description, category, input, output, outputName) {
  return {
    name,
    display_name: displayName,
    description,
    category,
    python_module: "custom_nodes.ComfyUI-TerryXu-nodes",
    input,
    output,
    output_name: outputName,
    output_is_list: output.map(() => false),
    output_node: false,
  };
}

app.registerExtension({
  name: "TerryXu.WireBus",

  addCustomNodeDefs(defs) {
    const text = labels();
    defs[WIRELESS_PACK_TYPE] = makeNodeDef(
      WIRELESS_PACK_TYPE,
      text.wirelessPackTitle,
      text.wirelessPackDescription,
      text.category,
      { required: { wire: [EMPTY_TYPE, { label: text.addWire }] } },
      [BUS_TYPE],
      [text.bus]
    );
    defs[WIRELESS_UNPACK_TYPE] = makeNodeDef(
      WIRELESS_UNPACK_TYPE,
      text.wirelessUnpackTitle,
      text.wirelessUnpackDescription,
      text.category,
      { required: { bus: [BUS_TYPE, { label: text.bus }] } },
      [],
      []
    );
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    const nodeName = nodeData.name;
    if (nodeName === LINE_SWITCH_TYPE || nodeName === BOOL_SWITCH_TYPE) {
      const created = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const result = created?.apply(this, arguments);
        queueMicrotask(() => refreshSwitchBus(this));
        return result;
      };
      const configured = nodeType.prototype.onConfigure;
      nodeType.prototype.onConfigure = function () {
        const result = configured?.apply(this, arguments);
        queueMicrotask(() => refreshSwitchBus(this));
        return result;
      };
      const connections = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function () {
        const result = connections?.apply(this, arguments);
        if (!app.configuringGraph) queueMicrotask(() => refreshSwitchBus(this));
        return result;
      };
      const widgets = nodeType.prototype.onWidgetChanged;
      nodeType.prototype.onWidgetChanged = function () {
        const result = widgets?.apply(this, arguments);
        queueMicrotask(() => refreshSwitchBus(this));
        return result;
      };
      return;
    }
    if (nodeName === LIST_TYPE) {
      // Public, read-only provenance API for reference pickers such as Flow's
      // @ menu. It exposes current order without changing the execution list.
      nodeType.prototype.__terryBusListEntries = function () {
        return listBusEntries(this).filter(entry => entry.source && !entry.empty);
      };
      // The server's dynamic inputs are populated from the bus at queue time;
      // only the single bus socket belongs in the visible node UI.
      if (nodeData.input?.optional) delete nodeData.input.optional.items;
      const originalCreated = nodeType.prototype.onNodeCreated;
      nodeType.prototype.onNodeCreated = function () {
        const result = originalCreated?.apply(this, arguments);
        initializeBusList(this);
        this.setSize?.([260, Math.max(100, Number(this.size?.[1]) || 0)]);
        return result;
      };
      const originalConnections = nodeType.prototype.onConnectionsChange;
      nodeType.prototype.onConnectionsChange = function () {
        const result = originalConnections?.apply(this, arguments);
        queueMicrotask(() => syncBusList(this));
        return result;
      };
      return;
    }
    if (![WIRELESS_PACK_TYPE, WIRELESS_UNPACK_TYPE].includes(nodeName)) return;

    const isPackDef = nodeName === WIRELESS_PACK_TYPE;
    const isWirelessDef = nodeName === WIRELESS_PACK_TYPE || nodeName === WIRELESS_UNPACK_TYPE;

    const originalCollapse = nodeType.prototype.collapse;
    if (typeof originalCollapse === "function") {
      nodeType.prototype.collapse = function () {
        const wasCollapsed = Boolean(this.flags?.collapsed);
        if (!wasCollapsed) {
          const width = Math.max(COMPACT_NODE_WIDTH, Number(this.size?.[0]) || 0);
          const height = stableExpandedHeight(this, Number(this.size?.[1]) || 0);
          if (height > 0) this.__terryBusExpandedSize = [width, height];
        }

        const result = originalCollapse.apply(this, arguments);
        if (wasCollapsed && !this.flags?.collapsed) {
          const saved = this.__terryBusExpandedSize;
          const width = Math.max(COMPACT_NODE_WIDTH, Number(saved?.[0]) || Number(this.size?.[0]) || 0);
          const height = Math.max(
            Number(saved?.[1]) || 0,
            Number(this.__terryBusPreferredHeight) || 0,
            Number(this.__terryBusMinHeight) || 0
          );
          if (height > 0) this.setSize?.([width, height]);
          if (isPackDef) refreshPackSlots(this);
          else syncUnpack(this, true);
        }
        this.__terryBusRefreshVisual?.();
        return result;
      };
    }

    const originalComputeSize = nodeType.prototype.computeSize;
    nodeType.prototype.computeSize = function () {
      const size = originalComputeSize?.apply?.(this, arguments) || [COMPACT_NODE_WIDTH, 0];
      const laneCount = isPackDef
        ? Math.max(0, Number(this.inputs?.length || 0) - 1)
        : Number(this.outputs?.length || 0);
      size[0] = COMPACT_NODE_WIDTH;
      size[1] = Math.max(Number(size[1]) || 0, compactBusNodeMinimumHeight(this, laneCount));
      return size;
    };

    const originalCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = originalCreated?.apply(this, arguments);
      this.isVirtualNode = true;
      this.serialize_widgets = isWirelessDef;
      this.resizable = false;

      if (isWirelessDef) initializeWirelessWidget(this);
      if (!isPackDef) initializeUnpackOutputModeControl(this);

      localizeFixedPorts(this, true);

      if (isPackDef) {
        const first = this.inputs?.[0];
        if (first && this.inputs.length === 1 && first.link == null && !first[LANE_FIELD]) {
          first.name = "wire";
          first.label = labels().addWire;
          first.type = EMPTY_TYPE;
        }
        queueMicrotask(() => refreshPackSlots(this));
      } else {
        queueMicrotask(() => syncUnpack(this, true));
      }
      return result;
    };

    nodeType.prototype.applyToGraph = function () {};

    if (isWirelessDef) {
      const originalAdded = nodeType.prototype.onAdded;
      nodeType.prototype.onAdded = function () {
        const result = originalAdded?.apply(this, arguments);
        if (!app.configuringGraph) {
          if (isPackDef) setWirelessChannel(this, wirelessChannelName(this));
          else refreshWirelessCombo(this);
        }
        return result;
      };

      const originalRemoved = nodeType.prototype.onRemoved;
      nodeType.prototype.onRemoved = function () {
        const result = originalRemoved?.apply(this, arguments);
        if (isPackDef && !app.configuringGraph) queueMicrotask(() => refreshWirelessChannels());
        return result;
      };
    }

    if (!isPackDef) {
      nodeType.prototype.getInputLink = function (slot) {
        const pack = findPackFromUnpack(this);
        if (!pack) return null;

        if (!unpackExpanded(this) && Number(slot) === 0) {
          const direct = this.inputs?.[0]?.link;
          return direct == null ? null : getLink(this.graph, direct);
        }

        const laneId = this.outputs?.[Number(slot) || 0]?.[LANE_FIELD];
        const entry = laneId
          ? effectivePackLaneEntries(pack).find((item) => item.laneId === laneId)
          : null;
        const inputGraph = entry?.inputGraph || pack.graph;
        if (entry?.mediaPack && entry.source) {
          return { origin_id: entry.mediaPack.id, origin_slot: 0 };
        }
        return entry?.input?.link == null || inputGraph !== this.graph
          ? null
          : getLink(inputGraph, entry.input.link);
      };

      nodeType.prototype.resolveVirtualOutput = function (slot) {
        const pack = findPackFromUnpack(this);
        if (!pack) return undefined;

        if (!unpackExpanded(this) && Number(slot) === 0) {
          return { node: pack, slot: 0 };
        }

        const laneId = this.outputs?.[Number(slot) || 0]?.[LANE_FIELD];
        const entry = laneId
          ? effectivePackLaneEntries(pack).find((item) => item.laneId === laneId)
          : null;
        const source = entry?.source;
        return source ? { node: source.node, slot: source.slot } : undefined;
      };

      // Stable cross-extension contract. TerryDirector and other Terry nodes
      // should use this named API instead of depending on WireBus internals.
      nodeType.prototype.__terryBusApiVersion = 1;
      nodeType.prototype.__terryBusResolveOutput = function (slot) {
        return this.resolveVirtualOutput?.(slot);
      };
    }

    const originalConnections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function (type, index) {
      const result = originalConnections?.apply(this, arguments);
      if (app.configuringGraph || this.__terryBusSyncing) return result;

      if (isPackDef) {
        if (type === LiteGraph.INPUT) queueMicrotask(() => refreshPackSlots(this));
        else queueMicrotask(syncAllUnpacks);
      } else if (type === LiteGraph.INPUT && index === 0) {
        queueMicrotask(() => syncUnpack(this, true));
      } else if (type === LiteGraph.OUTPUT) {
        const pack = findPackFromUnpack(this);
        if (pack && unpackExpanded(this)) queueMicrotask(() => refreshPackSlots(pack));
      }
      return result;
    };

    if (isPackDef) {
      nodeType.prototype.__terryBusLaneEntries = function () {
        return effectivePackLaneEntries(this);
      };

      nodeType.prototype.onConnectInput = function (slot, type) {
        return canConnectPackInput(this, slot, type);
      };

      nodeType.prototype.onConnectOutput = function (slot, type, input, targetNode) {
        return Number(slot) === 0 && canConnectBusOutput(targetNode, input);
      };
    } else {
      nodeType.prototype.onConnectInput = function (slot, type, output, originNode) {
        return Number(slot) === 0 && (
          type === BUS_TYPE
          || isPack(originNode)
          || isReroute(originNode)
          || (isTerrySwitch(originNode) && (() => {
            const active = selectedSwitchInput(originNode);
            return active?.link != null && resolveUpstream(originNode.graph || this.graph, active.link)?.type === BUS_TYPE;
          })())
          || isGet(originNode)
        );
      };

      nodeType.prototype.onConnectOutput = function (slot, type, input, targetNode) {
        if (
          !unpackExpanded(this)
          && Number(slot) === 0
          && String(this.outputs?.[0]?.type || type || "").toUpperCase() === BUS_TYPE
        ) {
          return canConnectBusOutput(targetNode, input);
        }
        return true;
      };
    }

    const originalConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = originalConfigure?.apply(this, arguments);
      this.resizable = false;

      if (isWirelessDef) {
        initializeWirelessWidget(this);
        initializeWirelessControl(this);
        const restored = wirelessChannelWidget(this)?.value
          ?? this.properties?.[WIRELESS_CHANNEL_PROPERTY]
          ?? "";
        setWirelessChannel(this, restored, false);
        if (!isPackDef) refreshWirelessCombo(this);
      }

      if (!isPackDef) initializeUnpackOutputModeControl(this);

      localizeFixedPorts(this, true);
      if (isPackDef) queueMicrotask(() => refreshPackSlots(this));
      else queueMicrotask(() => syncUnpack(this, true));
      return result;
    };
  },

  async setup() {
    patchGraphToPrompt();
    startBridge();
  },

  afterConfigureGraph() {
    patchGraphToPrompt();
    startBridge();
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) {
        if (isTerrySwitch(node)) syncSwitchBusType(node);
        if (isPack(node)) refreshPackSlots(node);
        if (isUnpack(node)) {
          initializeUnpackOutputModeControl(node);
          syncUnpack(node, true);
        }
      }
    }
    refreshWirelessChannels();
  },
});
