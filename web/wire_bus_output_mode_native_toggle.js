import { app } from "../../scripts/app.js";

const WIRED_UNPACK_TYPE = "TerryXuWireBusUnpack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const MODE_PROPERTY = "terry_wire_bus_expand_outputs";
const LEGACY_MODE_WIDGET = "terry_bus_expand_outputs";
const NATIVE_MODE_WIDGET = "terry_bus_expand_outputs_native";
const STYLE_ID = "terry-wire-bus-native-toggle-style";

function nodeType(node) {
  return String(
    node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || ""
  );
}

function isUnpack(node) {
  const type = nodeType(node);
  return type === WIRED_UNPACK_TYPE || type === WIRELESS_UNPACK_TYPE;
}

function localeCode() {
  try {
    const value = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    return String(value || navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  } catch {
    return String(navigator.language || "en").trim().toLowerCase().replaceAll("_", "-");
  }
}

function labels() {
  const zh = localeCode() === "zh" || localeCode().startsWith("zh-");
  return zh
    ? { name: "散开输出", on: "散开", off: "总线" }
    : { name: "Expand outputs", on: "Expand", off: "Bus" };
}

function state(node) {
  return node?.properties?.[MODE_PROPERTY] !== false;
}

function legacyWidget(node) {
  return (node?.widgets || []).find((widget) => widget?.name === LEGACY_MODE_WIDGET) || null;
}

function hideLegacyWidget(widget) {
  if (!widget || widget.__terryHiddenByNativeModeToggle) return;
  widget.__terryHiddenByNativeModeToggle = true;
  widget.hidden = true;
  widget.serialize = false;
  widget.options ||= {};
  widget.options.hidden = true;
  widget.options.serialize = false;
  widget.computeSize = () => [0, -4];
  if (widget.element?.style) widget.element.style.display = "none";
  if (widget.inputEl?.style) widget.inputEl.style.display = "none";
}

function installStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.terry-bus-native-bool-row{
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
.terry-bus-native-bool-label{
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
}
.terry-bus-native-bool-switch{
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
.terry-bus-native-bool-switch[data-checked="true"]{
  background:var(--p-primary-color,#60a5fa);
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);
}
.terry-bus-native-bool-switch:focus-visible{
  box-shadow:0 0 0 2px color-mix(in srgb,var(--p-primary-color,#60a5fa) 45%,transparent);
}
.terry-bus-native-bool-thumb{
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
.terry-bus-native-bool-switch[data-checked="true"] .terry-bus-native-bool-thumb{
  transform:translateX(12px);
}
`;
  document.head.append(style);
}

function applyVisual(node) {
  const ui = node?.__terryNativeBusModeToggle;
  if (!ui) return;
  const value = state(node);
  const text = labels();
  ui.label.textContent = text.name;
  ui.button.dataset.checked = String(value);
  ui.button.setAttribute("aria-checked", String(value));
  ui.button.title = value ? text.on : text.off;
}

function setState(node, next) {
  const value = Boolean(next);
  node.properties ||= {};
  node.properties[MODE_PROPERTY] = value;

  const legacy = legacyWidget(node);
  if (legacy) {
    legacy.value = value;
    try {
      legacy.callback?.(value);
    } catch (error) {
      console.warn("[TerryXu Wire Bus] Native output-mode toggle callback failed", error);
    }
  }

  applyVisual(node);
  node.graph?.setDirtyCanvas?.(true, true);
  node.graph?.change?.();
}

function installNode(node) {
  if (!isUnpack(node) || node.__terryNativeBusModeToggle) return;
  if (typeof document === "undefined" || typeof node.addDOMWidget !== "function") return;

  const legacy = legacyWidget(node);
  if (!legacy) return;
  hideLegacyWidget(legacy);
  installStyle();

  const row = document.createElement("div");
  row.className = "terry-bus-native-bool-row";

  const label = document.createElement("span");
  label.className = "terry-bus-native-bool-label";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "terry-bus-native-bool-switch p-toggleswitch p-component";
  button.setAttribute("role", "switch");

  const thumb = document.createElement("span");
  thumb.className = "terry-bus-native-bool-thumb";
  button.append(thumb);
  row.append(label, button);

  row.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setState(node, !state(node));
  });
  button.addEventListener("keydown", (event) => {
    if (event.key !== " " && event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    setState(node, !state(node));
  });

  const widget = node.addDOMWidget(
    NATIVE_MODE_WIDGET,
    NATIVE_MODE_WIDGET,
    row,
    {
      serialize: false,
      hideOnZoom: false,
      margin: 4,
      getMinHeight: () => 30,
      getMaxHeight: () => 30,
    }
  );
  if (!widget) {
    row.remove?.();
    return;
  }
  widget.serialize = false;

  node.__terryNativeBusModeToggle = { widget, row, label, button, thumb };
  applyVisual(node);
  node._widgetSlotsDirty = true;
  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshNode(node) {
  if (!isUnpack(node)) return;
  const legacy = legacyWidget(node);
  if (legacy) hideLegacyWidget(legacy);
  if (!node.__terryNativeBusModeToggle) installNode(node);
  applyVisual(node);
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

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(() => {
    for (const graph of allGraphs()) {
      for (const node of graph?._nodes || []) refreshNode(node);
    }
  }, 300);
}

app.registerExtension({
  name: "TerryXu.WireBusOutputModeNativeToggle",

  setup() {
    installStyle();
    start();
  },

  nodeCreated(node) {
    if (isUnpack(node)) queueMicrotask(() => refreshNode(node));
  },

  loadedGraphNode(node) {
    if (isUnpack(node)) queueMicrotask(() => refreshNode(node));
  },

  afterConfigureGraph() {
    start();
    queueMicrotask(() => {
      for (const graph of allGraphs()) {
        for (const node of graph?._nodes || []) refreshNode(node);
      }
    });
  },
});
