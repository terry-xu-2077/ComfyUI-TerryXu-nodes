import { app } from "../../scripts/app.js";

const LINE_TYPE = "TerryXuLineSwitch";
const BOOL_TYPE = "TerryXuBoolSwitch";
const REMOTE_TYPE = "TerryXuRemoteControl";
const LINE_NAMES_PROPERTY = "terry_line_switch_names";
const BOOL_NAMES_PROPERTY = "terry_bool_switch_names";
const INDEX_PROPERTY = "terry_line_switch_index";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";
const ROUTE_MENU_WIDGET = "terry_route_menu";
const REMOTE_VALUE_WIDGET = "terry_remote_value";

function localeCode() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(raw || navigator.language || "en").toLowerCase().replaceAll("_", "-");
  } catch { return String(navigator.language || "en").toLowerCase(); }
}
function isZh() { const l = localeCode(); return l === "zh" || l.startsWith("zh-"); }
function labels() {
  return isZh()
    ? { route: "线路", off: "关闭", on: "开启", rename: "重命名线路" }
    : { route: "Route", off: "Off", on: "On", rename: "Rename route" };
}
function nodeType(node) { return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || ""); }
function isLine(node) { return nodeType(node) === LINE_TYPE; }
function isBool(node) { return nodeType(node) === BOOL_TYPE; }
function isRemote(node) { return nodeType(node) === REMOTE_TYPE; }
function props(node) { if (!node.properties || typeof node.properties !== "object") node.properties = {}; return node.properties; }
function widget(node, name) { return (node?.widgets || []).find((w) => w?.name === name) || null; }
function input(node, name) { return (node?.inputs || []).find((i) => i?.name === name) || null; }
function routes(node) {
  return (node?.inputs || []).filter((i) => {
    const n = String(i?.name || "");
    return n.startsWith("routes.") || n.startsWith("route_");
  });
}
function routeKey(slot, index) { return String(slot?.name || "").trim() || `route_${index + 1}`; }
function lineNames(node) {
  const p = props(node);
  if (!p[LINE_NAMES_PROPERTY] || typeof p[LINE_NAMES_PROPERTY] !== "object" || Array.isArray(p[LINE_NAMES_PROPERTY])) p[LINE_NAMES_PROPERTY] = {};
  return p[LINE_NAMES_PROPERTY];
}
function boolNames(node) {
  const p = props(node);
  if (!p[BOOL_NAMES_PROPERTY] || typeof p[BOOL_NAMES_PROPERTY] !== "object" || Array.isArray(p[BOOL_NAMES_PROPERTY])) p[BOOL_NAMES_PROPERTY] = { false: "", true: "" };
  return p[BOOL_NAMES_PROPERTY];
}
function routeName(node, slot, index) {
  return String(lineNames(node)[routeKey(slot, index)] || "").trim() || `${labels().route} ${index + 1}`;
}
function boolName(node, enabled) {
  return String(boolNames(node)[enabled ? "true" : "false"] || "").trim() || (enabled ? labels().on : labels().off);
}
function clampIndex(value, count) {
  const parsed = Number.parseInt(value, 10);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 1, Math.max(1, Number(count) || 1)));
}
function numericIndex(node) {
  const p = props(node);
  const native = widget(node, "index");
  return clampIndex(p[INDEX_PROPERTY] ?? native?.value ?? 1, routes(node).length);
}
function displayValues(node) {
  const rs = routes(node);
  if (!rs.length) return [`1 · ${labels().route} 1`];
  return rs.map((slot, i) => `${i + 1} · ${routeName(node, slot, i)}`);
}
function displayIndex(value) { return clampIndex(String(value || "").split("·", 1)[0], 9999); }

function hideNativeIndex(node) {
  if (!isLine(node)) return;
  const w = widget(node, "index");
  if (!w) return;
  // Nodes 2.0 reads hidden/options.hidden; classic LiteGraph also respects computeSize.
  w.hidden = true;
  w.options ||= {};
  w.options.hidden = true;
  if (!w.__terryOrigComputeSize) w.__terryOrigComputeSize = w.computeSize;
  w.computeSize = () => [0, -4];
  for (const key of ["element", "inputEl"]) {
    const el = w[key];
    if (el?.style) el.style.display = "none";
  }
  // Keep the schema-bound widget strictly numeric even if another extension tries to make it a combo.
  const n = numericIndex(node);
  w.value = n;
  props(node)[INDEX_PROPERTY] = n;
}

function setIndex(node, next) {
  if (!isLine(node) || input(node, "index")?.link != null) return false;
  const n = clampIndex(next, routes(node).length);
  const native = widget(node, "index");
  if (native) native.value = n;
  props(node)[INDEX_PROPERTY] = n;
  node.__terryRuntimeIndex = n;
  node.onWidgetChanged?.("index", n, native, native);
  syncLine(node);
  syncRemotes();
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function ensureRouteMenu(node) {
  if (!isLine(node)) return null;
  hideNativeIndex(node);
  let menu = widget(node, ROUTE_MENU_WIDGET);
  if (!menu) {
    const values = displayValues(node);
    menu = node.addWidget?.("combo", ROUTE_MENU_WIDGET, values[numericIndex(node) - 1] || values[0], (value) => {
      setIndex(node, displayIndex(value));
    }, { values });
    if (menu) {
      menu.label = labels().route;
      menu.serialize = false;
      menu.options ||= {};
      menu.options.serialize = false;
    }
  }
  if (!menu) return null;
  const values = displayValues(node);
  const signature = values.join("\u0001");
  if (menu.__terryValuesSignature !== signature) {
    menu.options ||= {};
    menu.options.values = values;
    menu.__terryValuesSignature = signature;
  }
  menu.label = labels().route;
  const shown = values[numericIndex(node) - 1] || values[0];
  if (menu.value !== shown) menu.value = shown;
  return menu;
}

function syncLineLabels(node) {
  routes(node).forEach((slot, i) => {
    // Core renderer draws this label in both classic and Nodes 2.0, so the rename affordance stays visible.
    slot.label = `${routeName(node, slot, i)}   ✎`;
  });
}
function syncBoolLabels(node) {
  const off = input(node, "input_false");
  const on = input(node, "input_true");
  if (off) off.label = `${boolName(node, false)}   ✎`;
  if (on) on.label = `${boolName(node, true)}   ✎`;
}
function syncLine(node) { if (!isLine(node)) return; hideNativeIndex(node); syncLineLabels(node); ensureRouteMenu(node); }
function syncBool(node) { if (!isBool(node)) return; syncBoolLabels(node); }

function inputLocalY(node, slot) {
  const index = (node?.inputs || []).indexOf(slot);
  if (index < 0) return null;
  try {
    const out = [0, 0];
    const p = node.getConnectionPos?.(true, index, out) || out;
    if (Array.isArray(p) && Number.isFinite(p[1])) return p[1] - Number(node.pos?.[1] || 0);
  } catch {}
  const h = Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20;
  return (Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30) + h * (index + 0.5);
}
function localPos(node, event, pos) {
  if (Array.isArray(pos) && Number.isFinite(pos[0]) && Number.isFinite(pos[1])) return pos;
  if (Number.isFinite(event?.canvasX) && Number.isFinite(event?.canvasY)) return [event.canvasX - Number(node.pos?.[0] || 0), event.canvasY - Number(node.pos?.[1] || 0)];
  return null;
}
function renameEntries(node) {
  if (isLine(node)) return routes(node).map((slot, i) => ({ slot, i, label: routeName(node, slot, i), set(value) {
    const names = lineNames(node), key = routeKey(slot, i), next = String(value || "").trim();
    if (next) names[key] = next; else delete names[key];
  }}));
  if (isBool(node)) {
    const out = [];
    const a = input(node, "input_false"), b = input(node, "input_true");
    if (a) out.push({ slot: a, label: boolName(node, false), set(value) { boolNames(node).false = String(value || "").trim(); } });
    if (b) out.push({ slot: b, label: boolName(node, true), set(value) { boolNames(node).true = String(value || "").trim(); } });
    return out;
  }
  return [];
}
function tryRename(node, event, pos) {
  const p = localPos(node, event, pos);
  if (!p) return false;
  for (const entry of renameEntries(node)) {
    const y = inputLocalY(node, entry.slot);
    if (!Number.isFinite(y) || Math.abs(p[1] - y) > 9) continue;
    // The pencil is intentionally inside the core input-label area. Restrict activation to the right side of the label
    // so clicking the socket itself still starts a connection.
    if (p[0] < 42 || p[0] > Math.min(Number(node.size?.[0] || 180) - 8, 150)) continue;
    event?.preventDefault?.(); event?.stopPropagation?.();
    const next = globalThis.prompt?.(labels().rename, entry.label);
    if (next == null) return true;
    entry.set(next);
    if (isLine(node)) syncLine(node); else syncBool(node);
    syncRemotes();
    node.graph?.setDirtyCanvas?.(true, true);
    return true;
  }
  return false;
}

function allGraphs(root = app.graph) {
  const result = [], seen = new Set(), q = root ? [root] : [];
  while (q.length) {
    const g = q.shift(); if (!g || seen.has(g)) continue; seen.add(g); result.push(g);
    for (const n of g?._nodes || g?.nodes || []) if (n?.subgraph) q.push(n.subgraph);
    for (const c of [g?.subgraphs, g?._subgraphs]) if (c) {
      const vals = typeof c.values === "function" ? c.values() : Object.values(c);
      for (const v of vals) q.push(v?.subgraph || v);
    }
  }
  return result;
}
function nodes() { return allGraphs().flatMap((g) => g?._nodes || g?.nodes || []); }
function channel(node) { return String(props(node)[CHANNEL_PROPERTY] || widget(node, "terry_channel")?.value || "").trim(); }
function remoteChannel(node) { return String(props(node)[REMOTE_CHANNEL_PROPERTY] || widget(node, "terry_remote_channel")?.value || "").trim(); }
function targetForRemote(remote) {
  const c = remoteChannel(remote);
  return c ? nodes().find((n) => (isLine(n) || isBool(n)) && channel(n) === c) || null : null;
}
function syncRemote(remote) {
  if (!isRemote(remote)) return;
  const target = targetForRemote(remote), w = widget(remote, REMOTE_VALUE_WIDGET);
  if (!target || !w) return;
  if (isLine(target)) {
    const values = displayValues(target), shown = values[numericIndex(target) - 1] || values[0];
    w.type = "combo"; w.options ||= {}; w.options.values = values; w.value = shown; w.label = labels().route;
    if (!w.__terryNamedCallbackWrapped) {
      const old = w.callback;
      w.callback = function (value) {
        const t = targetForRemote(remote);
        if (t && isLine(t)) setIndex(t, displayIndex(value));
        else old?.apply(this, arguments);
      };
      w.__terryNamedCallbackWrapped = true;
    }
  } else if (isBool(target)) {
    w.label = `${boolName(target, false)} / ${boolName(target, true)}`;
  }
}
function syncRemotes() { for (const n of nodes()) if (isRemote(n)) syncRemote(n); }

function patchNodeType(nodeTypeClass, nodeData) {
  if (![LINE_TYPE, BOOL_TYPE].includes(nodeData?.name)) return;
  const oldMouse = nodeTypeClass.prototype.onMouseDown;
  nodeTypeClass.prototype.onMouseDown = function (event, pos) {
    if (tryRename(this, event, pos)) return true;
    return oldMouse?.apply(this, arguments);
  };
  const oldCreated = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const r = oldCreated?.apply(this, arguments);
    queueMicrotask(() => { if (isLine(this)) syncLine(this); else syncBool(this); });
    return r;
  };
  const oldConfigure = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const r = oldConfigure?.apply(this, arguments);
    queueMicrotask(() => { if (isLine(this)) syncLine(this); else syncBool(this); });
    return r;
  };
  const oldConnections = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function () {
    const r = oldConnections?.apply(this, arguments);
    queueMicrotask(() => { if (isLine(this)) syncLine(this); else syncBool(this); syncRemotes(); });
    return r;
  };
}

app.registerExtension({
  name: "TerryXu.SwitchUI",
  beforeRegisterNodeDef(nodeTypeClass, nodeData) { patchNodeType(nodeTypeClass, nodeData); },
  nodeCreated(node) {
    queueMicrotask(() => { if (isLine(node)) syncLine(node); else if (isBool(node)) syncBool(node); else if (isRemote(node)) syncRemote(node); });
  },
  loadedGraphNode(node) {
    queueMicrotask(() => { if (isLine(node)) syncLine(node); else if (isBool(node)) syncBool(node); else if (isRemote(node)) syncRemote(node); });
  },
  setup() {
    setInterval(() => {
      for (const n of nodes()) {
        if (isLine(n)) syncLine(n);
        else if (isBool(n)) syncBool(n);
        else if (isRemote(n)) syncRemote(n);
      }
    }, 700);
  },
  afterConfigureGraph() {
    for (const n of nodes()) {
      if (isLine(n)) syncLine(n);
      else if (isBool(n)) syncBool(n);
      else if (isRemote(n)) syncRemote(n);
    }
  },
});
