import { app } from "../../scripts/app.js";

const LINE_TYPE = "TerryXuLineSwitch";
const REMOTE_TYPE = "TerryXuRemoteControl";
const LINE_NAMES_PROPERTY = "terry_line_switch_names";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isLine(node) { return nodeType(node) === LINE_TYPE; }
function isRemote(node) { return nodeType(node) === REMOTE_TYPE; }

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function widgetByName(node, name) {
  return (node?.widgets || []).find((widget) => widget?.name === name) || null;
}

function routeInputs(node) {
  return (node?.inputs || []).filter((input) => {
    const name = String(input?.name || "");
    return name.startsWith("routes.") || name.startsWith("route_");
  });
}

function routeKey(input, index) {
  return String(input?.name || "").trim() || `route_${index + 1}`;
}

function customName(node, input, index) {
  const names = properties(node)[LINE_NAMES_PROPERTY];
  if (!names || typeof names !== "object" || Array.isArray(names)) return "";
  return String(names[routeKey(input, index)] || "").trim();
}

function routeLabel(node, input, index) {
  const custom = customName(node, input, index);
  if (custom) return `${index + 1} · ${custom}`;
  const chinese = (() => {
    try {
      const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
      const locale = String(raw || navigator.language || "en").toLowerCase().replaceAll("_", "-");
      return locale === "zh" || locale.startsWith("zh-");
    } catch {
      return String(navigator.language || "en").toLowerCase().startsWith("zh");
    }
  })();
  return `${index + 1} · ${chinese ? "线路" : "Route"} ${index + 1}`;
}

function clampIndex(value, count) {
  const parsed = Number.parseInt(value, 10);
  const safeCount = Math.max(1, Number(count) || 1);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? parsed : 1, safeCount));
}

function lineValueMap(node) {
  const routes = routeInputs(node);
  const result = {};
  routes.forEach((input, index) => { result[routeLabel(node, input, index)] = index + 1; });
  if (!routes.length) result["1"] = 1;
  return result;
}

function installStableCombo(widget, target) {
  if (!widget || !target || widget.__terryStableNamedCombo) return;
  widget.__terryStableNamedCombo = true;

  let numericValue = clampIndex(widget.value ?? properties(target).terry_line_switch_index ?? 1, routeInputs(target).length);
  let options = widget.options || {};

  try {
    Object.defineProperty(options, "values", {
      configurable: true,
      enumerable: true,
      get() {
        return lineValueMap(target);
      },
      set() {},
    });
  } catch {}
  widget.options = options;

  try {
    Object.defineProperty(widget, "value", {
      configurable: true,
      enumerable: true,
      get() {
        const count = routeInputs(target).length;
        numericValue = clampIndex(numericValue, count);
        return numericValue;
      },
      set(value) {
        numericValue = clampIndex(value, routeInputs(target).length);
      },
    });
  } catch {}

  widget.value = numericValue;
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
  return graphNodes().find((node) => isLine(node) && controlChannel(node) === channel) || null;
}

function stabilizeNode(node) {
  if (isLine(node)) {
    installStableCombo(widgetByName(node, "index"), node);
    return;
  }
  if (isRemote(node)) {
    const target = targetForRemote(node);
    if (target) installStableCombo(widgetByName(node, "terry_remote_value"), target);
  }
}

app.registerExtension({
  name: "TerryXu.SwitchComboStability",

  nodeCreated(node) {
    queueMicrotask(() => stabilizeNode(node));
  },

  loadedGraphNode(node) {
    queueMicrotask(() => stabilizeNode(node));
  },

  setup() {
    setInterval(() => {
      for (const node of graphNodes()) stabilizeNode(node);
    }, 1000);
  },

  afterConfigureGraph() {
    for (const node of graphNodes()) stabilizeNode(node);
  },
});
