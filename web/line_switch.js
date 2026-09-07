import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const LINE_TYPE = "TerryXuLineSwitch";
const BOOL_TYPE = "TerryXuBoolSwitch";
const BOOLEAN_TYPE = "TerryXuBooleanSwitch";
const REMOTE_TYPE = "TerryXuRemoteControl";
const MAX_ROUTES = 64;
const ACTIVE_COLOR = "#ffd45a";
const ACTIVE_GLOW = "rgba(255, 225, 120, 0.42)";
const INDEX_PROPERTY = "terry_line_switch_index";
const BOOL_PROPERTY = "terry_bool_switch_state";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";
const REMOTE_VALUE_PROPERTY = "terry_remote_value";
const CHANNEL_WIDGET = "terry_channel";
const REMOTE_CHANNEL_WIDGET = "terry_remote_channel";
const REMOTE_VALUE_WIDGET = "terry_remote_value";

const controlAdapters = new Map();

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
    ? {
        lineTitle: "*️⃣ 多线切换器",
        boolTitle: "🔀 二路切换器",
        booleanTitle: "🔘 布尔开关",
        remoteTitle: "🎛️ 远程控制器",
        index: "线路",
        route: "线路",
        bool: "切换",
        boolean: "开关",
        falseInput: "线路 1",
        trueInput: "线路 2",
        output: "输出",
        channel: "\u200B",
        control: "控制",
        lineChannel: "线路切换",
        boolChannel: "二路切换",
        booleanChannel: "布尔开关",
        remoteDescription: "按名称自动匹配可控节点，并生成对应的远程控制界面。",
      }
    : {
        lineTitle: "*️⃣ Multi-Line Switch",
        boolTitle: "🔀 Two-Way Switch",
        booleanTitle: "🔘 Boolean Switch",
        remoteTitle: "🎛️ Remote Control",
        index: "Route",
        route: "Route",
        bool: "Switch",
        boolean: "Switch",
        falseInput: "Input 1",
        trueInput: "Input 2",
        output: "Output",
        channel: "\u200B",
        control: "Control",
        lineChannel: "Line Switch",
        boolChannel: "Two-Way Switch",
        booleanChannel: "Boolean Switch",
        remoteDescription: "Match controllable nodes by name and build the corresponding remote control UI.",
      };
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isLine(node) { return nodeType(node) === LINE_TYPE; }
function isBool(node) { return nodeType(node) === BOOL_TYPE; }
function isBoolean(node) { return nodeType(node) === BOOLEAN_TYPE; }
function isControllable(node) { return isLine(node) || isBool(node) || isBoolean(node); }
function isRemote(node) { return nodeType(node) === REMOTE_TYPE; }

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

function graphNodes(root = app.graph) {
  return allGraphs(root).flatMap((graph) => graph?._nodes || graph?.nodes || []);
}

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function widgetByName(node, name) {
  return (node?.widgets || []).find((widget) => widget?.name === name) || null;
}

function inputByName(node, name) {
  return (node?.inputs || []).find((input) => input?.name === name) || null;
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

function routeInputs(node) {
  return (node?.inputs || []).filter((input) => {
    const name = String(input?.name || "");
    return name.startsWith("routes.") || name.startsWith("route_");
  });
}

function indexWidget(node) { return widgetByName(node, "index"); }
function boolWidget(node) { return widgetByName(node, "enabled"); }
function indexInput(node) { return inputByName(node, "index"); }
function boolInput(node) { return inputByName(node, "enabled"); }

function clampIndex(value, count) {
  const parsed = Number.parseInt(value, 10);
  const safeCount = Math.max(1, Number(count) || 1);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(parsed, safeCount));
}

function upstreamWidgetValue(node, input) {
  if (!input || input.link == null || !node?.graph) return null;
  const link = getLink(node.graph, input.link);
  if (!link) return null;
  const origin = getNode(node.graph, link.origin_id ?? link.originId);
  if (!origin) return null;
  for (const widget of origin.widgets || []) {
    if (widget?.value !== undefined) return widget.value;
  }
  return null;
}

function selectedIndex(node) {
  const count = routeInputs(node).length;
  if (indexInput(node)?.link != null) {
    const live = Number.parseInt(upstreamWidgetValue(node, indexInput(node)), 10);
    if (Number.isFinite(live)) return clampIndex(live, count);
    const runtime = Number(properties(node)[INDEX_PROPERTY] ?? node.__terryRuntimeIndex);
    if (Number.isFinite(runtime)) return clampIndex(runtime, count);
  }
  return clampIndex(indexWidget(node)?.value ?? properties(node)[INDEX_PROPERTY] ?? 1, count);
}

function selectedBool(node) {
  if (boolInput(node)?.link != null) {
    const live = upstreamWidgetValue(node, boolInput(node));
    if (live !== null && live !== undefined) return Boolean(live);
    if (node.__terryRuntimeBool !== undefined) return Boolean(node.__terryRuntimeBool);
    if (properties(node)[BOOL_PROPERTY] !== undefined) return Boolean(properties(node)[BOOL_PROPERTY]);
  }
  return Boolean(boolWidget(node)?.value ?? properties(node)[BOOL_PROPERTY] ?? false);
}

function routeValues(node) {
  const count = Math.max(1, routeInputs(node).length);
  return Array.from({ length: Math.min(MAX_ROUTES, count) }, (_, index) => index + 1);
}

function controlChannel(node) {
  return String(properties(node)[CHANNEL_PROPERTY] || widgetByName(node, CHANNEL_WIDGET)?.value || "").trim();
}

function setControlChannel(node, value) {
  const next = String(value || "").trim();
  properties(node)[CHANNEL_PROPERTY] = next;
  const widget = widgetByName(node, CHANNEL_WIDGET);
  if (widget && widget.value !== next) widget.value = next;
  if (isBoolean(node)) {
    const output = node.outputs?.[0];
    if (output) output.label = next || text().output;
  }
  refreshAllRemotes();
  node.graph?.setDirtyCanvas?.(true, true);
}

function uniqueDefaultChannel(node) {
  const labels = text();
  const base = isBoolean(node) ? labels.booleanChannel : (isBool(node) ? labels.boolChannel : labels.lineChannel);
  const names = new Set(graphNodes().filter((item) => item !== node).map(controlChannel).filter(Boolean));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function ensureChannelWidget(node) {
  if (!isControllable(node) || widgetByName(node, CHANNEL_WIDGET)) return;
  const initial = controlChannel(node) || uniqueDefaultChannel(node);
  properties(node)[CHANNEL_PROPERTY] = initial;
  const widget = node.addWidget?.("text", CHANNEL_WIDGET, initial, (value) => setControlChannel(node, value), {});
  if (widget) {
    widget.label = text().channel;
    widget.serialize = true;
  }
}

function refreshLine(node) {
  if (!isLine(node)) return;
  const labels = text();
  node.title = labels.lineTitle;
  node.resizable = false;
  node.serialize_widgets = true;
  if (properties(node)[INDEX_PROPERTY] == null) properties(node)[INDEX_PROPERTY] = 1;
  ensureChannelWidget(node);
  const index = indexInput(node);
  if (index) index.label = labels.index;
  routeInputs(node).forEach((input, i) => { input.label = `${labels.route} ${i + 1}`; });
  const output = node.outputs?.[0];
  if (output) output.label = labels.output;
  const widget = indexWidget(node);
  if (widget) {
    bindTargetWidgetSync(node, widget, "line");
    const values = routeValues(node);
    widget.type = "combo";
    widget.label = labels.index;
    widget.options ||= {};
    widget.options.values = values;
    widget.value = clampIndex(widget.value, values.length);
  }
  const channel = widgetByName(node, CHANNEL_WIDGET);
  if (channel) channel.label = labels.channel;
  globalThis.__terrySyncSwitchUI?.(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function bindTargetWidgetSync(node, widget, kind) {
  if (!node || !widget || widget.__terryRemoteTargetSyncWrapped) return;
  const original = widget.callback;
  widget.callback = function (value) {
    const result = original?.apply(this, arguments);
    if (kind === "line") {
      const next = clampIndex(value, routeValues(node).length);
      properties(node)[INDEX_PROPERTY] = next;
      node.__terryRuntimeIndex = next;
    } else if (kind === "bool") {
      const next = Boolean(value);
      properties(node)[BOOL_PROPERTY] = next;
      node.__terryRuntimeBool = next;
    }
    queueMicrotask(() => {
      globalThis.__terrySyncSwitchUI?.(node);
      refreshAllRemotes();
      node.graph?.setDirtyCanvas?.(true, true);
    });
    return result;
  };
  widget.__terryRemoteTargetSyncWrapped = true;
}

function refreshBool(node) {
  if (!isBool(node)) return;
  const labels = text();
  node.title = labels.boolTitle;
  node.resizable = false;
  node.serialize_widgets = true;
  if (properties(node)[BOOL_PROPERTY] == null) properties(node)[BOOL_PROPERTY] = false;
  ensureChannelWidget(node);
  const control = boolInput(node);
  if (control) control.label = labels.bool;
  const off = inputByName(node, "input_false");
  const on = inputByName(node, "input_true");
  if (off) off.label = labels.falseInput;
  if (on) on.label = labels.trueInput;
  const output = node.outputs?.[0];
  if (output) output.label = labels.output;
  const widget = boolWidget(node);
  if (widget) {
    bindTargetWidgetSync(node, widget, "bool");
    widget.label = labels.bool;
  }
  const channel = widgetByName(node, CHANNEL_WIDGET);
  if (channel) channel.label = labels.channel;
  globalThis.__terrySyncSwitchUI?.(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshBoolean(node) {
  if (!isBoolean(node)) return;
  const labels = text();
  node.title = labels.booleanTitle;
  node.resizable = false;
  node.serialize_widgets = true;
  if (properties(node)[BOOL_PROPERTY] == null) properties(node)[BOOL_PROPERTY] = false;
  ensureChannelWidget(node);
  const widget = boolWidget(node);
  if (widget) {
    bindTargetWidgetSync(node, widget, "bool");
    widget.label = labels.boolean;
  }
  const channel = widgetByName(node, CHANNEL_WIDGET);
  if (channel) channel.label = labels.channel;
  const output = node.outputs?.[0];
  if (output) output.label = controlChannel(node) || labels.output;
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshControllable(node) {
  if (isLine(node)) refreshLine(node);
  else if (isBool(node)) refreshBool(node);
  else if (isBoolean(node)) refreshBoolean(node);
  refreshAllRemotes();
}

function registerControlAdapter(type, adapter) {
  controlAdapters.set(type, adapter);
}

registerControlAdapter(LINE_TYPE, {
  describe(node) {
    const values = routeValues(node);
    return { kind: "combo", label: text().index, values, value: clampIndex(selectedIndex(node), values.length) };
  },
  set(node, value) {
    if (indexInput(node)?.link != null) return false;
    const next = clampIndex(value, routeValues(node).length);
    const widget = indexWidget(node);
    if (widget) widget.value = next;
    properties(node)[INDEX_PROPERTY] = next;
    node.__terryRuntimeIndex = next;
    node.onWidgetChanged?.("index", next, widget, widget);
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  },
});

registerControlAdapter(BOOL_TYPE, {
  describe(node) {
    return { kind: "toggle", label: text().bool, value: selectedBool(node) };
  },
  set(node, value) {
    if (boolInput(node)?.link != null) return false;
    const next = Boolean(value);
    const widget = boolWidget(node);
    if (widget) widget.value = next;
    properties(node)[BOOL_PROPERTY] = next;
    node.__terryRuntimeBool = next;
    node.onWidgetChanged?.("enabled", next, widget, widget);
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  },
});

registerControlAdapter(BOOLEAN_TYPE, {
  describe(node) {
    return { kind: "toggle", label: text().boolean, value: selectedBool(node) };
  },
  set(node, value) {
    const next = Boolean(value);
    const widget = boolWidget(node);
    if (widget) widget.value = next;
    properties(node)[BOOL_PROPERTY] = next;
    node.__terryRuntimeBool = next;
    node.onWidgetChanged?.("enabled", next, widget, widget);
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  },
});

function channelTargets() {
  return graphNodes().filter((node) => controlAdapters.has(nodeType(node)) && controlChannel(node));
}

function channelNames() {
  return [...new Set(channelTargets().map(controlChannel))].sort((a, b) => a.localeCompare(b));
}

function targetForChannel(channel) {
  const name = String(channel || "").trim();
  return channelTargets().find((node) => controlChannel(node) === name) || null;
}

function remoteChannel(node) {
  return String(properties(node)[REMOTE_CHANNEL_PROPERTY] || widgetByName(node, REMOTE_CHANNEL_WIDGET)?.value || "").trim();
}

function removeWidget(node, widget) {
  const index = node?.widgets?.indexOf(widget) ?? -1;
  if (index >= 0) node.widgets.splice(index, 1);
  widget?.onRemove?.();
}

function setRemoteChannel(node, value) {
  const next = String(value || "").trim();
  properties(node)[REMOTE_CHANNEL_PROPERTY] = next;
  const widget = widgetByName(node, REMOTE_CHANNEL_WIDGET);
  if (widget && widget.value !== next) widget.value = next;
  refreshRemote(node, true);
}

function ensureRemoteChannelWidget(node) {
  let widget = widgetByName(node, REMOTE_CHANNEL_WIDGET);
  if (!widget) {
    widget = node.addWidget?.("combo", REMOTE_CHANNEL_WIDGET, remoteChannel(node), (value) => setRemoteChannel(node, value), {
      values: () => channelNames(),
    });
  }
  if (!widget) return null;
  widget.label = text().channel;
  widget.options ||= {};
  widget.options.values = () => channelNames();
  widget.serialize = true;
  return widget;
}

function rebuildRemoteValueWidget(node, description, force = false) {
  const signature = description
    ? `${description.kind}|${description.label}|${(description.values || []).join("|")}`
    : "none";
  let widget = widgetByName(node, REMOTE_VALUE_WIDGET);
  if (!force && widget && node.__terryRemoteSignature === signature) return widget;
  if (widget) removeWidget(node, widget);
  node.__terryRemoteSignature = signature;
  if (!description) return null;

  const callback = (value) => {
    const target = targetForChannel(remoteChannel(node));
    const adapter = target && controlAdapters.get(nodeType(target));
    if (!target || !adapter) return;
    if (adapter.set(target, value) !== false) {
      const actual = adapter.describe?.(target)?.value ?? value;
      properties(node)[REMOTE_VALUE_PROPERTY] = actual;
      refreshAllRemotes();
      target.graph?.setDirtyCanvas?.(true, true);
      node.graph?.setDirtyCanvas?.(true, true);
    }
  };

  if (description.kind === "combo") {
    widget = node.addWidget?.("combo", REMOTE_VALUE_WIDGET, description.value, callback, { values: description.values || [] });
  } else if (description.kind === "toggle") {
    widget = node.addWidget?.("toggle", REMOTE_VALUE_WIDGET, Boolean(description.value), callback, {});
  } else if (description.kind === "number") {
    widget = node.addWidget?.("number", REMOTE_VALUE_WIDGET, Number(description.value) || 0, callback, description.options || {});
  } else {
    widget = node.addWidget?.("text", REMOTE_VALUE_WIDGET, String(description.value ?? ""), callback, {});
  }
  if (widget) {
    widget.label = description.label || text().control;
    widget.serialize = true;
  }
  return widget;
}

function syncRemoteColor(node, target) {
  if (!isRemote(node)) return false;
  if (!node.__terryRemoteDefaultColors) {
    node.__terryRemoteDefaultColors = { color: node.color, bgcolor: node.bgcolor };
  }
  const defaults = node.__terryRemoteDefaultColors;
  let changed = false;
  for (const key of ["color", "bgcolor"]) {
    const desired = target?.[key] ?? defaults[key];
    if (desired == null || desired === "") {
      if (node[key] != null && node[key] !== "") {
        delete node[key];
        changed = true;
      }
    } else if (node[key] !== desired) {
      node[key] = desired;
      changed = true;
    }
  }
  return changed;
}

function refreshRemote(node, force = false) {
  if (!isRemote(node)) return;
  node.isVirtualNode = true;
  node.serialize_widgets = true;
  node.resizable = false;
  const configuredTargetName = remoteChannel(node);
  node.title = configuredTargetName ? `🎛️ ${configuredTargetName}` : text().remoteTitle;
  const channelWidget = ensureRemoteChannelWidget(node);
  const names = channelNames();
  if (channelWidget) {
    channelWidget.options.values = () => channelNames();
    const current = remoteChannel(node);
    if (!current && names.length) {
      channelWidget.value = names[0];
      properties(node)[REMOTE_CHANNEL_PROPERTY] = names[0];
    } else if (current && !names.includes(current)) {
      channelWidget.value = current;
    }
  }
  const target = targetForChannel(remoteChannel(node));
  syncRemoteColor(node, target);
  const adapter = target && controlAdapters.get(nodeType(target));
  const description = adapter?.describe?.(target) || null;
  const valueWidget = rebuildRemoteValueWidget(node, description, force);
  if (valueWidget && description) {
    valueWidget.label = description.label || text().control;
    valueWidget.value = description.value;
    valueWidget.options ||= {};
    if (description.kind === "combo") valueWidget.options.values = description.values || [];
  }
  properties(node)[REMOTE_VALUE_PROPERTY] = description?.value ?? properties(node)[REMOTE_VALUE_PROPERTY];
  globalThis.__terrySyncSwitchUI?.(node);
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshAllRemotes() {
  for (const node of graphNodes()) if (isRemote(node)) refreshRemote(node);
}

function connectionPos(node, input, isInput) {
  if (!node || !input) return null;
  const slot = isInput ? (node.inputs || []).indexOf(input) : (node.outputs || []).indexOf(input);
  if (slot < 0) return null;
  try {
    const out = [0, 0];
    const result = node.getConnectionPos?.(isInput, slot, out) || out;
    if (Array.isArray(result) && Number.isFinite(result[0]) && Number.isFinite(result[1])) return result;
  } catch {}
  return null;
}

function activeInput(node) {
  if (isLine(node)) {
    const routes = routeInputs(node);
    return routes[selectedIndex(node) - 1] || routes[0] || null;
  }
  if (isBool(node)) return inputByName(node, selectedBool(node) ? "input_true" : "input_false");
  return null;
}

function bezier(ctx, start, end) {
  const distance = Math.max(40, Math.abs(end[0] - start[0]) * 0.5);
  ctx.beginPath();
  ctx.moveTo(start[0], start[1]);
  ctx.bezierCurveTo(start[0] + distance, start[1], end[0] - distance, end[1], end[0], end[1]);
}

function drawActiveWire(ctx, node, now) {
  const input = activeInput(node);
  if (!input || input.link == null || !node?.graph) return;
  const link = getLink(node.graph, input.link);
  if (!link) return;
  const origin = getNode(node.graph, link.origin_id ?? link.originId);
  const output = origin?.outputs?.[Number(link.origin_slot ?? link.originSlot ?? 0) || 0];
  if (!origin || !output) return;
  const start = connectionPos(origin, output, false);
  const end = connectionPos(node, input, true);
  if (!start || !end) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  bezier(ctx, start, end);
  ctx.strokeStyle = ACTIVE_GLOW;
  ctx.lineWidth = 8;
  ctx.setLineDash([]);
  ctx.stroke();
  bezier(ctx, start, end);
  ctx.strokeStyle = ACTIVE_COLOR;
  ctx.lineWidth = 3;
  ctx.setLineDash([12, 9]);
  ctx.lineDashOffset = -((now / 28) % 21);
  ctx.stroke();
  ctx.restore();
}

function patchCanvas() {
  const Canvas = globalThis.LGraphCanvas;
  if (!Canvas?.prototype || Canvas.prototype.__terryControlWirePatched) return false;
  const original = Canvas.prototype.drawConnections;
  if (typeof original !== "function") return false;
  Canvas.prototype.drawConnections = function () {
    const result = original.apply(this, arguments);
    try {
      const ctx = arguments[0] || this.ctx;
      const now = performance.now();
      for (const node of this.graph?._nodes || []) if (isControllable(node)) drawActiveWire(ctx, node, now);
    } catch (error) {
      console.warn("[TerryXu Controls] active wire draw failed", error);
    }
    return result;
  };
  Canvas.prototype.__terryControlWirePatched = true;
  return true;
}

function startAnimation() {
  if (globalThis.__terryControlAnimation) return;
  globalThis.__terryControlAnimation = true;
  let last = 0;
  let lastColorSync = 0;
  const tick = (time) => {
    if (time - last > 45) {
      last = time;
      const active = graphNodes().some((node) => isControllable(node) && activeInput(node)?.link != null);
      if (active) app.graph?.setDirtyCanvas?.(true, false);
    }
    if (time - lastColorSync > 180) {
      lastColorSync = time;
      let changed = false;
      for (const remote of graphNodes()) {
        if (!isRemote(remote)) continue;
        changed = syncRemoteColor(remote, targetForChannel(remoteChannel(remote))) || changed;
      }
      if (changed) app.graph?.setDirtyCanvas?.(true, true);
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function installExecutedListener() {
  if (globalThis.__terryControlExecutedListener) return;
  globalThis.__terryControlExecutedListener = true;
  api.addEventListener?.("executed", (event) => {
    const detail = event?.detail || {};
    const nodeId = detail.node ?? detail.node_id;
    const output = detail.output || detail;
    for (const graph of allGraphs()) {
      const node = graph?.getNodeById?.(nodeId);
      if (!node) continue;
      if (isLine(node)) {
        const raw = output?.terry_line_switch_index;
        const parsed = Number.parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
        if (Number.isFinite(parsed)) {
          node.__terryRuntimeIndex = parsed;
          properties(node)[INDEX_PROPERTY] = parsed;
          node.graph?.setDirtyCanvas?.(true, true);
          refreshAllRemotes();
        }
      } else if (isBool(node)) {
        const raw = output?.terry_bool_switch_state;
        if (raw !== undefined) {
          const value = Boolean(Array.isArray(raw) ? raw[0] : raw);
          node.__terryRuntimeBool = value;
          properties(node)[BOOL_PROPERTY] = value;
          node.graph?.setDirtyCanvas?.(true, true);
          refreshAllRemotes();
        }
      } else if (isBoolean(node)) {
        const raw = output?.terry_boolean_switch_state;
        if (raw !== undefined) {
          const value = Boolean(Array.isArray(raw) ? raw[0] : raw);
          node.__terryRuntimeBool = value;
          properties(node)[BOOL_PROPERTY] = value;
          node.graph?.setDirtyCanvas?.(true, true);
          refreshAllRemotes();
        }
      }
      break;
    }
  });
}

function remoteNodeDef() {
  const labels = text();
  return {
    name: REMOTE_TYPE,
    display_name: labels.remoteTitle,
    description: labels.remoteDescription,
    category: isChinese() ? "TerryXu/线束整理" : "TerryXu/Wire Management",
    python_module: "custom_nodes.ComfyUI-TerryXu-nodes",
    input: { required: {} },
    output: [],
    output_name: [],
    output_is_list: [],
    output_node: false,
  };
}

function patchControllableNodeType(nodeTypeClass, nodeData) {
  const originalCreated = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = originalCreated?.apply(this, arguments);
    queueMicrotask(() => refreshControllable(this));
    return result;
  };

  const originalConfigure = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = originalConfigure?.apply(this, arguments);
    queueMicrotask(() => refreshControllable(this));
    return result;
  };

  const originalConnections = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function () {
    const result = originalConnections?.apply(this, arguments);
    queueMicrotask(() => refreshControllable(this));
    return result;
  };

  const originalWidgetChanged = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function (name, value) {
    const result = originalWidgetChanged?.apply(this, arguments);
    if (nodeData?.name === LINE_TYPE && name === "index") {
      properties(this)[INDEX_PROPERTY] = Number.parseInt(value, 10) || 1;
      queueMicrotask(refreshAllRemotes);
    } else if ([BOOL_TYPE, BOOLEAN_TYPE].includes(nodeData?.name) && name === "enabled") {
      properties(this)[BOOL_PROPERTY] = Boolean(value);
      queueMicrotask(refreshAllRemotes);
    } else if (name === CHANNEL_WIDGET) {
      setControlChannel(this, value);
    }
    this.graph?.setDirtyCanvas?.(true, true);
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.ControlChannels",

  addCustomNodeDefs(defs) {
    defs[REMOTE_TYPE] = remoteNodeDef();
  },

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if ([LINE_TYPE, BOOL_TYPE, BOOLEAN_TYPE].includes(nodeData?.name)) patchControllableNodeType(nodeTypeClass, nodeData);

    if (nodeData?.name === REMOTE_TYPE) {
      const originalCreated = nodeTypeClass.prototype.onNodeCreated;
      nodeTypeClass.prototype.onNodeCreated = function () {
        const result = originalCreated?.apply(this, arguments);
        this.isVirtualNode = true;
        this.applyToGraph = function () {};
        queueMicrotask(() => refreshRemote(this, true));
        return result;
      };
      const originalConfigure = nodeTypeClass.prototype.onConfigure;
      nodeTypeClass.prototype.onConfigure = function () {
        const result = originalConfigure?.apply(this, arguments);
        this.isVirtualNode = true;
        this.applyToGraph = function () {};
        queueMicrotask(() => refreshRemote(this, true));
        return result;
      };
      nodeTypeClass.prototype.applyToGraph = function () {};
    }
  },

  nodeCreated(node) {
    if (isControllable(node)) queueMicrotask(() => refreshControllable(node));
    else if (isRemote(node)) queueMicrotask(() => refreshRemote(node, true));
  },

  loadedGraphNode(node) {
    if (isControllable(node)) queueMicrotask(() => refreshControllable(node));
    else if (isRemote(node)) queueMicrotask(() => refreshRemote(node, true));
  },

  setup() {
        patchCanvas();
        installExecutedListener();
        startAnimation();
      },

  afterConfigureGraph() {
    for (const node of graphNodes()) {
      if (isControllable(node)) refreshControllable(node);
      else if (isRemote(node)) refreshRemote(node, true);
    }
  },
});
