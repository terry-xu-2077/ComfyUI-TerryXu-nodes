import { app } from "../../scripts/app.js";

const LINE_TYPE = "TerryXuLineSwitch";
const BOOL_TYPE = "TerryXuBoolSwitch";
const REMOTE_TYPE = "TerryXuRemoteControl";
const LINE_NAMES_PROPERTY = "terry_line_switch_names";
const BOOL_NAMES_PROPERTY = "terry_bool_switch_names";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";
const REMOTE_VALUE_WIDGET = "terry_remote_value";
const BUTTON_SIZE = 16;
const BUTTON_GAP = 5;

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
    ? { route: "线路", off: "关闭", on: "开启", rename: "重命名线路", bool: "切换" }
    : { route: "Route", off: "Off", on: "On", rename: "Rename route", bool: "Switch" };
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isLine(node) { return nodeType(node) === LINE_TYPE; }
function isBool(node) { return nodeType(node) === BOOL_TYPE; }
function isRemote(node) { return nodeType(node) === REMOTE_TYPE; }

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

function routeInputs(node) {
  return (node?.inputs || []).filter((input) => {
    const name = String(input?.name || "");
    return name.startsWith("routes.") || name.startsWith("route_");
  });
}

function lineNames(node) {
  const props = properties(node);
  const raw = props[LINE_NAMES_PROPERTY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) props[LINE_NAMES_PROPERTY] = {};
  return props[LINE_NAMES_PROPERTY];
}

function boolNames(node) {
  const props = properties(node);
  const raw = props[BOOL_NAMES_PROPERTY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    props[BOOL_NAMES_PROPERTY] = { false: "", true: "" };
  }
  return props[BOOL_NAMES_PROPERTY];
}

function routeStableKey(input, index) {
  const raw = String(input?.name || "").trim();
  return raw || `route_${index + 1}`;
}

function lineRouteName(node, input, index) {
  const custom = String(lineNames(node)[routeStableKey(input, index)] || "").trim();
  return custom || `${text().route} ${index + 1}`;
}

function boolRouteName(node, enabled) {
  const names = boolNames(node);
  const custom = String(names[enabled ? "true" : "false"] || "").trim();
  if (custom) return custom;
  return enabled ? text().on : text().off;
}

function setLineRouteName(node, input, index, value) {
  const names = lineNames(node);
  const key = routeStableKey(input, index);
  const next = String(value || "").trim();
  if (next) names[key] = next;
  else delete names[key];
  applyNames(node);
}

function setBoolRouteName(node, enabled, value) {
  boolNames(node)[enabled ? "true" : "false"] = String(value || "").trim();
  applyNames(node);
}

function namedLineValues(node) {
  return routeInputs(node).map((input, index) => `${index + 1} · ${lineRouteName(node, input, index)}`);
}

function currentLineIndex(node) {
  const widget = widgetByName(node, "index");
  const parsed = Number.parseInt(widget?.value ?? properties(node).terry_line_switch_index ?? 1, 10);
  const count = Math.max(1, routeInputs(node).length);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 1, count));
}

function applyLineNames(node) {
  const routes = routeInputs(node);
  routes.forEach((input, index) => { input.label = lineRouteName(node, input, index); });

  const widget = widgetByName(node, "index");
  if (widget) {
    const values = namedLineValues(node);
    const index = currentLineIndex(node);
    widget.type = "combo";
    widget.options ||= {};
    widget.options.values = values;
    widget.value = values[index - 1] || values[0] || "1";
  }
}

function applyBoolNames(node) {
  const off = inputByName(node, "input_false");
  const on = inputByName(node, "input_true");
  if (off) off.label = boolRouteName(node, false);
  if (on) on.label = boolRouteName(node, true);
}

function controlChannel(node) {
  return String(properties(node)[CHANNEL_PROPERTY] || widgetByName(node, "terry_channel")?.value || "").trim();
}

function remoteChannel(node) {
  return String(properties(node)[REMOTE_CHANNEL_PROPERTY] || widgetByName(node, "terry_remote_channel")?.value || "").trim();
}

function allGraphs(root = app.graph) {
  const result = [];
  const seen = new Set();
  const queue = root ? [root] : [];
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

function graphNodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []);
}

function targetForRemote(remote) {
  const channel = remoteChannel(remote);
  if (!channel) return null;
  return graphNodes().find((node) => (isLine(node) || isBool(node)) && controlChannel(node) === channel) || null;
}

function applyRemoteNames(remote) {
  if (!isRemote(remote)) return;
  const target = targetForRemote(remote);
  const widget = widgetByName(remote, REMOTE_VALUE_WIDGET);
  if (!target || !widget) return;

  if (isLine(target)) {
    const values = namedLineValues(target);
    const index = currentLineIndex(target);
    widget.type = "combo";
    widget.options ||= {};
    widget.options.values = values;
    widget.value = values[index - 1] || values[0] || "1";
    widget.label = text().route;
  } else if (isBool(target)) {
    widget.label = `${boolRouteName(target, false)} / ${boolRouteName(target, true)}`;
  }
}

function applyNames(node) {
  if (isLine(node)) applyLineNames(node);
  else if (isBool(node)) applyBoolNames(node);
  for (const remote of graphNodes()) if (isRemote(remote)) applyRemoteNames(remote);
  node.graph?.setDirtyCanvas?.(true, true);
}

function inputLocalY(node, input) {
  const index = (node?.inputs || []).indexOf(input);
  if (index < 0) return null;
  try {
    const out = [0, 0];
    const pos = node.getConnectionPos?.(true, index, out) || out;
    if (Array.isArray(pos) && Number.isFinite(pos[1])) return pos[1] - Number(node.pos?.[1] || 0);
  } catch {}
  const slotHeight = Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20;
  return (Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30) + slotHeight * (index + 0.5);
}

function renameEntries(node) {
  if (isLine(node)) {
    return routeInputs(node).map((input, index) => ({
      input,
      index,
      label: lineRouteName(node, input, index),
      set: (value) => setLineRouteName(node, input, index, value),
    }));
  }
  if (isBool(node)) {
    const result = [];
    const off = inputByName(node, "input_false");
    const on = inputByName(node, "input_true");
    if (off) result.push({ input: off, label: boolRouteName(node, false), set: (value) => setBoolRouteName(node, false, value) });
    if (on) result.push({ input: on, label: boolRouteName(node, true), set: (value) => setBoolRouteName(node, true, value) });
    return result;
  }
  return [];
}

function buildButtonRects(node, ctx) {
  const rects = [];
  const maxX = Math.max(22, Number(node.size?.[0] || 140) - BUTTON_SIZE - 5);
  for (const entry of renameEntries(node)) {
    const y = inputLocalY(node, entry.input);
    if (!Number.isFinite(y)) continue;
    ctx.save();
    ctx.font = "12px sans-serif";
    const labelWidth = Math.ceil(ctx.measureText(String(entry.label || "")).width);
    ctx.restore();
    const x = Math.min(maxX, Math.max(24, 13 + labelWidth + BUTTON_GAP));
    rects.push({ ...entry, x, y: y - BUTTON_SIZE / 2, w: BUTTON_SIZE, h: BUTTON_SIZE });
  }
  node.__terryRenameRects = rects;
  return rects;
}

function drawRenameButtons(node, ctx) {
  if ((!isLine(node) && !isBool(node)) || node.flags?.collapsed || !ctx) return;
  applyNames(node);
  const rects = buildButtonRects(node, ctx);
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "12px sans-serif";
  for (const rect of rects) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
    else ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(235,235,235,0.88)";
    ctx.fillText("✎", rect.x + rect.w / 2, rect.y + rect.h / 2 + 0.5);
  }
  ctx.restore();
}

function eventLocalPos(node, event, pos) {
  if (Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) return pos;
  const canvasPos = event?.canvasX != null && event?.canvasY != null ? [event.canvasX, event.canvasY] : null;
  if (canvasPos) return [canvasPos[0] - Number(node.pos?.[0] || 0), canvasPos[1] - Number(node.pos?.[1] || 0)];
  return null;
}

function tryRenameAt(node, event, pos) {
  const local = eventLocalPos(node, event, pos);
  if (!local) return false;
  const rect = (node.__terryRenameRects || []).find((item) =>
    local[0] >= item.x && local[0] <= item.x + item.w && local[1] >= item.y && local[1] <= item.y + item.h
  );
  if (!rect) return false;
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const next = globalThis.prompt?.(text().rename, String(rect.label || ""));
  if (next === null || next === undefined) return true;
  rect.set(next);
  return true;
}

function patchNodeType(nodeTypeClass, nodeData) {
  if (![LINE_TYPE, BOOL_TYPE].includes(nodeData?.name)) return;

  const originalDraw = nodeTypeClass.prototype.onDrawForeground;
  nodeTypeClass.prototype.onDrawForeground = function (ctx) {
    const result = originalDraw?.apply(this, arguments);
    drawRenameButtons(this, ctx);
    return result;
  };

  const originalMouseDown = nodeTypeClass.prototype.onMouseDown;
  nodeTypeClass.prototype.onMouseDown = function (event, pos) {
    if (tryRenameAt(this, event, pos)) return true;
    return originalMouseDown?.apply(this, arguments);
  };

  const originalCreated = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = originalCreated?.apply(this, arguments);
    queueMicrotask(() => applyNames(this));
    return result;
  };

  const originalConfigure = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = originalConfigure?.apply(this, arguments);
    queueMicrotask(() => applyNames(this));
    return result;
  };

  const originalConnections = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function () {
    const result = originalConnections?.apply(this, arguments);
    queueMicrotask(() => applyNames(this));
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.SwitchInputNames",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    patchNodeType(nodeTypeClass, nodeData);
  },

  nodeCreated(node) {
    if (isLine(node) || isBool(node)) queueMicrotask(() => applyNames(node));
    else if (isRemote(node)) queueMicrotask(() => applyRemoteNames(node));
  },

  loadedGraphNode(node) {
    if (isLine(node) || isBool(node)) queueMicrotask(() => applyNames(node));
    else if (isRemote(node)) queueMicrotask(() => applyRemoteNames(node));
  },

  setup() {
    setInterval(() => {
      for (const node of graphNodes()) {
        if (isLine(node) || isBool(node)) applyNames(node);
        else if (isRemote(node)) applyRemoteNames(node);
      }
    }, 250);
  },

  afterConfigureGraph() {
    for (const node of graphNodes()) {
      if (isLine(node) || isBool(node)) applyNames(node);
      else if (isRemote(node)) applyRemoteNames(node);
    }
  },
});
