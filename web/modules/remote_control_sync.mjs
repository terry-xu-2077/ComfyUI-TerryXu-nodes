import { app } from "../../scripts/app.js";

const REMOTE_TYPE = "TerryXuRemoteControl";
const BOOL_TYPE = "TerryXuBoolSwitch";
const LINE_TYPE = "TerryXuLineSwitch";
const PAYLOAD_WIDGET = "remote_payload";
const REMOTE_VALUE_WIDGET = "terry_remote_value";
const LIVE_WIDGET = "enabled";
const REMOTE_VALUE_PROPERTY = "terry_remote_value";
const BOOL_PROPERTY = "terry_bool_switch_state";
const INDEX_PROPERTY = "terry_line_switch_index";
const POLL_MS = 60;

let timer = null;

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

function remoteNodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []).filter(isRemote);
}

function nodeById(graph, id) {
  if (!graph || id == null) return null;
  try {
    const direct = graph.getNodeById?.(id)
      || graph.getNodeById?.(String(id))
      || (Number.isFinite(Number(id)) ? graph.getNodeById?.(Number(id)) : null);
    if (direct) return direct;
  } catch {}
  return Array.from(graph?._nodes || graph?.nodes || []).find((item) => String(item?.id) === String(id)) || null;
}

function linkById(graph, id) {
  if (!graph || id == null) return null;
  for (const collection of [graph.links, graph._links]) {
    if (!collection) continue;
    let link = null;
    if (typeof collection.get === "function") {
      link = collection.get(id) ?? collection.get(String(id));
      if (link == null && Number.isFinite(Number(id))) link = collection.get(Number(id));
    } else if (Array.isArray(collection)) {
      link = collection.find((item) => String(item?.id ?? item?.[0]) === String(id));
    } else {
      link = collection[id] ?? collection[String(id)];
    }
    if (Array.isArray(link)) {
      return {
        id: link[0], origin_id: link[1], origin_slot: link[2],
        target_id: link[3], target_slot: link[4], type: link[5],
      };
    }
    if (link) return link;
  }
  return null;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const raw = String(value ?? "").trim().toLowerCase();
  if (["", "0", "false", "off", "no", "null", "none"].includes(raw)) return false;
  if (["1", "true", "on", "yes"].includes(raw)) return true;
  return Boolean(value);
}

function toInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 1;
}

function decodePayload(node) {
  const payload = widget(node, PAYLOAD_WIDGET)?.value;
  const text = String(payload ?? "").trim();
  if (text.startsWith("b:")) return toBoolean(text.slice(2));
  if (text.startsWith("i:")) return toInteger(text.slice(2));
  return payload;
}

function outputKind(node) {
  const type = String(node.outputs?.[0]?.type || "").toUpperCase();
  if (type === "BOOLEAN") return "bool";
  if (type === "INT" || type === "INTEGER") return "int";

  const visible = widget(node, REMOTE_VALUE_WIDGET)?.value;
  if (typeof visible === "boolean") return "bool";
  if (typeof visible === "number") return "int";

  const stored = properties(node)[REMOTE_VALUE_PROPERTY];
  if (typeof stored === "boolean") return "bool";
  if (typeof stored === "number") return "int";
  return null;
}

function readLiveValue(node, kind) {
  // The visible remote-control widget is the source of truth.  Reading the
  // serialized payload first caused the connected two-way switch to lag or
  // remain stuck on the previous value.
  const visible = widget(node, REMOTE_VALUE_WIDGET);
  let value = visible?.value;
  if (value === undefined) value = properties(node)[REMOTE_VALUE_PROPERTY];
  if (value === undefined) value = decodePayload(node);

  if (kind === "bool") return toBoolean(value);
  if (kind === "int") return toInteger(value);
  return value;
}

function ensurePayloadWidget(node) {
  let payload = widget(node, PAYLOAD_WIDGET);
  if (!payload && typeof node.addWidget === "function") {
    payload = node.addWidget("text", PAYLOAD_WIDGET, "i:1", () => {}, {});
  }
  if (!payload) return null;
  payload.hidden = true;
  payload.serialize = true;
  payload.options ||= {};
  payload.options.hidden = true;
  payload.options.serialize = true;
  if (!payload.__terryRemotePayloadComputeSize) {
    payload.__terryRemotePayloadComputeSize = payload.computeSize;
    payload.computeSize = () => [0, -4];
  }
  for (const key of ["element", "inputEl"]) {
    const element = payload[key];
    if (element?.style) element.style.display = "none";
  }
  return payload;
}

function ensureLiveWidget(node) {
  let live = widget(node, LIVE_WIDGET);
  if (!live && typeof node.addWidget === "function") {
    live = node.addWidget("text", LIVE_WIDGET, false, () => {}, {});
  }
  if (!live) return null;

  // TerryXu's connected-input preview code reads upstream widgets before the
  // graph is queued. Keep this typed mirror first so it sees bool/int data,
  // never the channel-name string.
  const list = node.widgets || [];
  const index = list.indexOf(live);
  if (index > 0) {
    list.splice(index, 1);
    list.unshift(live);
  }

  live.hidden = true;
  live.serialize = false;
  live.options ||= {};
  live.options.hidden = true;
  live.options.serialize = false;
  if (!live.__terryRemoteLiveComputeSize) {
    live.__terryRemoteLiveComputeSize = live.computeSize;
    live.computeSize = () => [0, -4];
  }
  for (const key of ["element", "inputEl"]) {
    const element = live[key];
    if (element?.style) element.style.display = "none";
  }
  return live;
}

function encodePayload(kind, value) {
  if (kind === "bool") return `b:${toBoolean(value) ? 1 : 0}`;
  if (kind === "int") return `i:${toInteger(value)}`;
  return String(value ?? "");
}

function setBoolConsumer(target, value) {
  const input = (target.inputs || []).find((item) => item?.name === "enabled");
  if (!input) return false;
  const next = toBoolean(value);
  const control = widget(target, "enabled");
  const p = properties(target);
  const changed = control?.value !== next || target.__terryRuntimeBool !== next || p[BOOL_PROPERTY] !== next;
  if (!changed) return false;

  if (control) control.value = next;
  target.__terryRuntimeBool = next;
  p[BOOL_PROPERTY] = next;
  globalThis.__terrySyncSwitchUI?.(target);
  target.graph?.setDirtyCanvas?.(true, true);
  target.setDirtyCanvas?.(true, true);
  return true;
}

function setLineConsumer(target, value) {
  const input = (target.inputs || []).find((item) => item?.name === "index");
  if (!input) return false;
  const count = Math.max(1, (target.inputs || []).filter((item) => {
    const name = String(item?.name || "");
    return name.startsWith("routes.") || name.startsWith("route_");
  }).length);
  const next = Math.max(1, Math.min(toInteger(value), count));
  const control = widget(target, "index");
  const p = properties(target);
  const changed = control?.value !== next || target.__terryRuntimeIndex !== next || p[INDEX_PROPERTY] !== next;
  if (!changed) return false;

  if (control) control.value = next;
  target.__terryRuntimeIndex = next;
  p[INDEX_PROPERTY] = next;
  globalThis.__terrySyncSwitchUI?.(target);
  target.graph?.setDirtyCanvas?.(true, true);
  target.setDirtyCanvas?.(true, true);
  return true;
}

function propagateFromOutput(node, value, seen = new Set()) {
  const graph = node?.graph;
  const output = node?.outputs?.[0];
  if (!graph || !output) return false;
  let changed = false;

  for (const raw of output.links || []) {
    const link = typeof raw === "object" && raw ? raw : linkById(graph, raw);
    if (!link) continue;
    const key = String(link.id ?? raw);
    if (seen.has(key)) continue;
    seen.add(key);

    const target = nodeById(graph, link.target_id ?? link.targetId);
    const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
    if (!target) continue;

    const type = nodeType(target);
    const slotName = String(target.inputs?.[targetSlot]?.name || "");
    if (type === BOOL_TYPE && slotName === "enabled") {
      changed = setBoolConsumer(target, value) || changed;
      continue;
    }
    if (type === LINE_TYPE && slotName === "index") {
      changed = setLineConsumer(target, value) || changed;
      continue;
    }

    // Follow ordinary reroutes so remote outputs keep behaving like normal
    // data wires even when users insert a reroute between controller/consumer.
    const lower = type.toLowerCase();
    if ((lower === "reroute" || lower.endsWith("reroute")) && target.outputs?.[0]) {
      changed = propagateFromOutput(target, value, seen) || changed;
    }
  }
  return changed;
}

function syncRemote(node) {
  if (!isRemote(node)) return false;
  const kind = outputKind(node);
  const value = readLiveValue(node, kind);
  const live = ensureLiveWidget(node);
  const payload = ensurePayloadWidget(node);
  if (!live || !payload) return false;

  let changed = false;
  if (live.value !== value || typeof live.value !== typeof value) {
    live.value = value;
    changed = true;
  }
  node.__terryRemoteLiveValue = value;
  if (properties(node)[REMOTE_VALUE_PROPERTY] !== value) {
    properties(node)[REMOTE_VALUE_PROPERTY] = value;
    changed = true;
  }

  const encoded = encodePayload(kind, value);
  if (payload.value !== encoded) {
    payload.value = encoded;
    changed = true;
  }

  changed = propagateFromOutput(node, value) || changed;
  if (changed) {
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
  }
  return true;
}

function syncAll() {
  const remotes = remoteNodes();
  for (const remote of remotes) syncRemote(remote);
  return remotes.length > 0;
}

function startTimer() {
  if (timer != null) return;
  timer = setInterval(() => {
    if (!syncAll()) {
      clearInterval(timer);
      timer = null;
    }
  }, POLL_MS);
}

function patchRemoteType(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terryRemoteLiveBridgePatchedV2) return;
  nodeTypeClass.prototype.__terryRemoteLiveBridgePatchedV2 = true;

  const created = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    queueMicrotask(() => { syncRemote(this); startTimer(); });
    return result;
  };

  const configured = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = configured?.apply(this, arguments);
    queueMicrotask(() => { syncRemote(this); startTimer(); });
    return result;
  };

  const changed = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function () {
    const result = changed?.apply(this, arguments);
    queueMicrotask(() => syncRemote(this));
    return result;
  };

  const connections = nodeTypeClass.prototype.onConnectionsChange;
  nodeTypeClass.prototype.onConnectionsChange = function () {
    const result = connections?.apply(this, arguments);
    queueMicrotask(() => syncRemote(this));
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.RemoteControlLiveBridge",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (nodeData?.name === REMOTE_TYPE) patchRemoteType(nodeTypeClass);
  },

  nodeCreated(node) {
    if (!isRemote(node)) return;
    queueMicrotask(() => { syncRemote(node); startTimer(); });
  },

  loadedGraphNode(node) {
    if (!isRemote(node)) return;
    queueMicrotask(() => { syncRemote(node); startTimer(); });
  },

  afterConfigureGraph() {
    if (syncAll()) startTimer();
  },
});
