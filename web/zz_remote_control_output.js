import { app } from "../../scripts/app.js";

const REMOTE_TYPE = "TerryXuRemoteControl";
const LINE_TYPE = "TerryXuLineSwitch";
const BOOL_TYPE = "TerryXuBoolSwitch";
const BOOLEAN_TYPE = "TerryXuBooleanSwitch";
const CHANNEL_PROPERTY = "terry_control_channel";
const REMOTE_CHANNEL_PROPERTY = "terry_remote_channel";
const REMOTE_VALUE_PROPERTY = "terry_remote_value";
const INDEX_PROPERTY = "terry_line_switch_index";
const BOOL_PROPERTY = "terry_bool_switch_state";
const PAYLOAD_WIDGET = "remote_payload";
const POLL_MS = 180;
let timer = null;

function isChinese() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(raw).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return false;
  }
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isRemote(node) {
  return nodeType(node) === REMOTE_TYPE;
}

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function widget(node, name) {
  return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function allGraphs(root = app.graph?.rootGraph || app.rootGraph || app.graph) {
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
      for (const child of collectionValues(collection)) queue.push(child?.subgraph || child);
    }
  }
  return result;
}

function nodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []);
}

function remoteChannel(node) {
  return String(properties(node)[REMOTE_CHANNEL_PROPERTY] || widget(node, "terry_remote_channel")?.value || "").trim();
}

function targetChannel(node) {
  return String(properties(node)[CHANNEL_PROPERTY] || widget(node, "terry_channel")?.value || "").trim();
}

function targetForRemote(remote) {
  const channel = remoteChannel(remote);
  if (!channel) return null;
  return nodes().find((node) => {
    const type = nodeType(node);
    return [LINE_TYPE, BOOL_TYPE, BOOLEAN_TYPE].includes(type) && targetChannel(node) === channel;
  }) || null;
}

function remoteKind(target) {
  const type = nodeType(target);
  if (type === LINE_TYPE) return "int";
  if (type === BOOL_TYPE || type === BOOLEAN_TYPE) return "bool";
  return null;
}

function remoteValue(remote, target, kind) {
  const stored = properties(remote)[REMOTE_VALUE_PROPERTY];
  if (kind === "int") {
    const source = stored ?? properties(target)[INDEX_PROPERTY] ?? widget(target, "index")?.value ?? 1;
    const value = Number.parseInt(source, 10);
    return Number.isFinite(value) ? value : 1;
  }
  if (kind === "bool") {
    const source = stored ?? properties(target)[BOOL_PROPERTY] ?? widget(target, "enabled")?.value ?? false;
    return Boolean(source);
  }
  return null;
}

function forceExecutable(node) {
  if (!isRemote(node) || node.__terryRemoteExecutableLocked) return;
  try {
    Object.defineProperty(node, "isVirtualNode", {
      configurable: true,
      enumerable: true,
      get: () => false,
      set: () => {},
    });
  } catch {
    node.isVirtualNode = false;
  }
  node.__terryRemoteExecutableLocked = true;
}

function hidePayloadWidget(node) {
  let valueWidget = widget(node, PAYLOAD_WIDGET);
  if (!valueWidget && typeof node.addWidget === "function") {
    valueWidget = node.addWidget("text", PAYLOAD_WIDGET, "i:1", () => {}, {});
  }
  if (!valueWidget) return null;
  valueWidget.hidden = true;
  valueWidget.serialize = true;
  valueWidget.options ||= {};
  valueWidget.options.hidden = true;
  valueWidget.options.serialize = true;
  if (!valueWidget.__terryPayloadComputeSize) {
    valueWidget.__terryPayloadComputeSize = valueWidget.computeSize;
    valueWidget.computeSize = () => [0, -4];
  }
  for (const key of ["element", "inputEl"]) {
    const element = valueWidget[key];
    if (element?.style) element.style.display = "none";
  }
  return valueWidget;
}

function ensureOutput(node) {
  if (node.outputs?.length) return node.outputs[0];
  return node.addOutput?.("控制值", "*") || null;
}

function setPayload(node, payload) {
  const valueWidget = hidePayloadWidget(node);
  if (!valueWidget) return;
  if (valueWidget.value !== payload) valueWidget.value = payload;
}

function syncRemoteOutput(node) {
  if (!isRemote(node)) return;
  forceExecutable(node);
  const target = targetForRemote(node);
  const kind = remoteKind(target);
  const output = ensureOutput(node);
  if (!output) return;

  if (kind === "int") {
    const value = remoteValue(node, target, kind);
    setPayload(node, `i:${value}`);
    output.type = "INT";
    output.label = isChinese() ? "整数" : "Integer";
  } else if (kind === "bool") {
    const value = remoteValue(node, target, kind);
    setPayload(node, `b:${value ? 1 : 0}`);
    output.type = "BOOLEAN";
    output.label = isChinese() ? "布尔" : "Boolean";
  } else {
    setPayload(node, "i:1");
    output.type = "*";
    output.label = isChinese() ? "控制值" : "Value";
  }

  node.serialize_widgets = true;
  node.graph?.change?.();
  node.graph?.setDirtyCanvas?.(true, true);
  node.setDirtyCanvas?.(true, true);
}

function executableRemoteDef() {
  return {
    name: REMOTE_TYPE,
    display_name: isChinese() ? "🎛️ 远程控制器" : "🎛️ Remote Control",
    description: isChinese()
      ? "按频道控制切换节点，并输出当前控制值；线路选择输出 INT，布尔开关输出 BOOLEAN。"
      : "Control switch nodes by channel and output the current value as INT or BOOLEAN.",
    category: isChinese() ? "TerryXu/线束整理" : "TerryXu/Wire Management",
    python_module: "custom_nodes.ComfyUI-TerryXu-nodes",
    input: {
      required: {
        [PAYLOAD_WIDGET]: ["STRING", { default: "i:1" }],
      },
    },
    output: ["*"],
    output_name: [isChinese() ? "控制值" : "Value"],
    output_is_list: [false],
    output_node: false,
  };
}

function patchRemoteNodeType(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terryRemoteOutputPatched) return;
  nodeTypeClass.prototype.__terryRemoteOutputPatched = true;

  const created = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    queueMicrotask(() => syncRemoteOutput(this));
    return result;
  };

  const configured = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = configured?.apply(this, arguments);
    queueMicrotask(() => syncRemoteOutput(this));
    return result;
  };

  const changed = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function () {
    const result = changed?.apply(this, arguments);
    queueMicrotask(() => syncRemoteOutput(this));
    return result;
  };
}

function syncAll() {
  const remotes = nodes().filter(isRemote);
  for (const remote of remotes) syncRemoteOutput(remote);
  return remotes.length > 0;
}

function start() {
  if (timer != null) return;
  timer = setInterval(() => {
    if (!syncAll()) {
      clearInterval(timer);
      timer = null;
    }
  }, POLL_MS);
}

function wrapSharedSync() {
  const current = globalThis.__terrySyncSwitchUI;
  if (!current || current.__terryRemoteOutputWrapped) return;
  const wrapped = function (node) {
    const result = current.apply(this, arguments);
    if (isRemote(node)) syncRemoteOutput(node);
    return result;
  };
  wrapped.__terryRemoteOutputWrapped = true;
  globalThis.__terrySyncSwitchUI = wrapped;
}

app.registerExtension({
  name: "TerryXu.RemoteControlOutput",

  addCustomNodeDefs(defs) {
    // line_switch.js historically registered this as a frontend-only virtual
    // node. Replace that definition with the executable shape that mirrors the
    // bundled Python node.
    defs[REMOTE_TYPE] = executableRemoteDef();
  },

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (nodeData?.name === REMOTE_TYPE) patchRemoteNodeType(nodeTypeClass);
  },

  nodeCreated(node) {
    if (!isRemote(node)) return;
    queueMicrotask(() => { syncRemoteOutput(node); start(); wrapSharedSync(); });
  },

  loadedGraphNode(node) {
    if (!isRemote(node)) return;
    queueMicrotask(() => { syncRemoteOutput(node); start(); wrapSharedSync(); });
  },

  setup() {
    queueMicrotask(wrapSharedSync);
  },

  afterConfigureGraph() {
    wrapSharedSync();
    if (syncAll()) start();
  },
});
