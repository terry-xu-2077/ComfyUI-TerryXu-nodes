import { app } from "../../scripts/app.js";

const MANAGER_TYPE = "TerryXuGroupManager";
const BOOLEAN_SOURCE_TYPE = "TerryXuBooleanSwitch";
const STATE_PROPERTY = "terry_group_manager_groups";
const POLL_MS = 180;

let timer = null;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === MANAGER_TYPE;
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

function graphChildren(graph) {
  const result = [];
  for (const node of graph?._nodes || graph?.nodes || []) if (node?.subgraph) result.push(node.subgraph);
  for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
    for (const child of collectionValues(collection)) {
      const subgraph = child?.subgraph || child;
      if (subgraph) result.push(subgraph);
    }
  }
  return result;
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
    queue.push(...graphChildren(graph));
  }
  return result;
}

function savedGroups(node) {
  node.properties ||= {};
  if (!Array.isArray(node.properties[STATE_PROPERTY])) node.properties[STATE_PROPERTY] = [];
  return node.properties[STATE_PROPERTY];
}

function groupKeys(node) {
  return savedGroups(node).map((entry, index) => String(
    entry?.key || `${entry?.graphId ?? ""}:${entry?.groupId ?? ""}:${entry?.title ?? ""}:${index}`
  ));
}

function removedGroupIndex(previous, current) {
  if (!Array.isArray(previous) || previous.length <= current.length) return -1;
  for (let index = 0; index < current.length; index++) {
    if (previous[index] === current[index]) continue;
    const tailMatches = current.slice(index).every((key, offset) => previous[index + 1 + offset] === key);
    if (tailMatches) return index;
    break;
  }
  return current.length;
}

function ensureInputs(node) {
  if (!isManager(node)) return;
  const keys = groupKeys(node);
  const desired = keys.length;
  let previous = Array.isArray(node.__terryExternalBoolKeys) ? [...node.__terryExternalBoolKeys] : null;
  node.__terryExternalBoolSyncing = true;
  try {
    // When a row is deleted from the middle, remove that exact socket so the
    // external wires belonging to later rows stay aligned with their groups.
    while (previous && previous.length > desired && (node.inputs?.length || 0) > desired) {
      const index = Math.max(0, removedGroupIndex(previous, keys));
      if (typeof node.removeInput === "function") node.removeInput(index);
      else node.inputs.splice(index, 1);
      previous.splice(index, 1);
    }
    while ((node.inputs?.length || 0) > desired) {
      const index = node.inputs.length - 1;
      if (typeof node.removeInput === "function") node.removeInput(index);
      else node.inputs.splice(index, 1);
    }
    while ((node.inputs?.length || 0) < desired) {
      if (typeof node.addInput !== "function") break;
      node.addInput("", "BOOLEAN", { nameLocked: true });
    }
    for (const slot of node.inputs || []) {
      slot.name = "";
      slot.label = "";
      slot.localized_name = "";
      slot.type = "BOOLEAN";
      slot.nameLocked = true;
      slot.__terryGroupExternalBoolean = true;
    }
    node.__terryExternalBoolKeys = keys;
  } finally {
    node.__terryExternalBoolSyncing = false;
  }
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
        id: link[0],
        origin_id: link[1],
        origin_slot: link[2],
        target_id: link[3],
        target_slot: link[4],
        type: link[5],
      };
    }
    if (link) return link;
  }
  return null;
}

function nodeById(graph, id) {
  if (!graph || id == null) return null;
  try {
    const found = graph.getNodeById?.(id);
    if (found) return found;
  } catch {}
  const table = graph._nodes_by_id;
  if (table) {
    if (typeof table.get === "function") {
      const found = table.get(id) ?? table.get(String(id)) ?? table.get(Number(id));
      if (found) return found;
    } else {
      const found = table[id] ?? table[String(id)];
      if (found) return found;
    }
  }
  return Array.from(graph?._nodes || graph?.nodes || []).find((node) => String(node?.id) === String(id)) || null;
}

function booleanValueFromSource(source, outputSlot = 0) {
  if (!source) return { readable: false, value: false };
  const enabled = widget(source, "enabled");
  if (nodeType(source) === BOOLEAN_SOURCE_TYPE && enabled?.value !== undefined) {
    return { readable: true, value: Boolean(enabled.value) };
  }

  const output = source.outputs?.[Number(outputSlot) || 0];
  if (String(output?.type || "").toUpperCase() !== "BOOLEAN") return { readable: false, value: false };
  if (enabled?.value !== undefined && typeof enabled.value === "boolean") {
    return { readable: true, value: enabled.value };
  }
  const boolWidgets = (source.widgets || []).filter((item) => typeof item?.value === "boolean");
  if (boolWidgets.length === 1) return { readable: true, value: Boolean(boolWidgets[0].value) };
  return { readable: false, value: false };
}

function externalControl(node, index) {
  const slot = node.inputs?.[index];
  if (!slot || slot.link == null) return { connected: false, readable: false, value: false };
  const graph = node.graph || app.graph;
  const link = linkById(graph, slot.link);
  if (!link) return { connected: true, readable: false, value: false };
  const source = nodeById(graph, link.origin_id);
  const state = booleanValueFromSource(source, link.origin_slot);
  return { connected: true, readable: state.readable, value: state.value };
}

function nodeRoot(node) {
  if (typeof document === "undefined") return null;
  return [...document.querySelectorAll("[data-node-id]")]
    .find((element) => String(element.getAttribute("data-node-id")) === String(node?.id)) || null;
}

function managerPanel(node) {
  return node.__terryGroupManager?.panel
    || node.widgets?.map((item) => item?.element).find((element) => element?.classList?.contains("terry-group-manager"))
    || nodeRoot(node)?.querySelector(".terry-group-manager")
    || null;
}

function syncClassicSlotPositions(node, panel) {
  const widgetRef = node.__terryGroupManager?.widget;
  const start = Number(widgetRef?.last_y);
  const base = Number.isFinite(start) ? start : (Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30);
  const rows = panel ? [...panel.querySelectorAll(".terry-group-manager__row")] : [];
  for (const [index, slot] of (node.inputs || []).entries()) {
    const y = rows[index]
      ? base + Number(rows[index].offsetTop || 0) + Number(rows[index].offsetHeight || 28) / 2
      : base + 22 + index * 31;
    slot.pos = [0, y];
  }
}

function syncNodes2SlotPositions(node, panel) {
  const root = nodeRoot(node);
  if (!root || !panel) return;
  const count = savedGroups(node).length;
  const slotRows = [...root.querySelectorAll(".lg-slot--input")].slice(0, count);
  if (!slotRows.length) return;

  const inputColumn = slotRows[0]?.parentElement;
  const wrapper = inputColumn?.parentElement;
  if (wrapper) Object.assign(wrapper.style, {
    position: "absolute", left: "0", top: "0", bottom: "0", width: "18px",
    zIndex: "45", pointerEvents: "none", overflow: "visible",
  });
  if (inputColumn) Object.assign(inputColumn.style, {
    position: "absolute", inset: "0", width: "18px", overflow: "visible", pointerEvents: "none",
  });

  const rootRect = root.getBoundingClientRect();
  const rows = [...panel.querySelectorAll(".terry-group-manager__row")];
  slotRows.forEach((slotElement, index) => {
    const row = rows[index];
    if (!row) return;
    const rect = row.getBoundingClientRect();
    const y = rect.top + rect.height / 2 - rootRect.top;
    Object.assign(slotElement.style, {
      position: "absolute", left: "0", top: `${y - 6}px`, width: "14px", height: "12px",
      margin: "0", padding: "0", overflow: "visible", pointerEvents: "auto", zIndex: "46",
    });
  });
}

function applyExternalStates(node) {
  ensureInputs(node);
  const panel = managerPanel(node);
  if (!panel) return;
  const rows = [...panel.querySelectorAll(".terry-group-manager__row")];
  const count = savedGroups(node).length;

  for (let index = 0; index < count; index++) {
    const row = rows[index];
    const toggle = row?.querySelector(".terry-group-manager__toggle");
    if (!row || !toggle) continue;
    const external = externalControl(node, index);
    row.dataset.terryExternalBoolean = String(external.readable);
    toggle.dataset.terryExternalBoolean = String(external.readable);
    if (external.readable) {
      toggle.style.pointerEvents = "none";
      toggle.style.cursor = "default";
      toggle.title = `外接布尔控制 · ${external.value ? "开启" : "关闭"}`;
      const current = toggle.getAttribute("aria-checked") === "true";
      if (current !== external.value) toggle.click();
    } else {
      toggle.style.pointerEvents = "";
      toggle.style.cursor = "";
    }
  }

  syncClassicSlotPositions(node, panel);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => syncNodes2SlotPositions(node, panel));
  else queueMicrotask(() => syncNodes2SlotPositions(node, panel));
}

function syncAll() {
  let found = false;
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (!isManager(node)) continue;
      found = true;
      applyExternalStates(node);
    }
  }
  return found;
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

function patchManagerType(nodeType) {
  if (nodeType.prototype.__terryExternalBoolPatched) return;
  nodeType.prototype.__terryExternalBoolPatched = true;

  const created = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    queueMicrotask(() => { ensureInputs(this); applyExternalStates(this); startTimer(); });
    return result;
  };

  const configured = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const result = configured?.apply(this, arguments);
    queueMicrotask(() => { ensureInputs(this); applyExternalStates(this); startTimer(); });
    return result;
  };

  const connections = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function () {
    const result = connections?.apply(this, arguments);
    if (!this.__terryExternalBoolSyncing) queueMicrotask(() => applyExternalStates(this));
    return result;
  };
}

function patchBooleanSourceType(nodeType) {
  if (nodeType.prototype.__terryExternalBoolSourcePatched) return;
  nodeType.prototype.__terryExternalBoolSourcePatched = true;
  const changed = nodeType.prototype.onWidgetChanged;
  nodeType.prototype.onWidgetChanged = function (name) {
    const result = changed?.apply(this, arguments);
    if (name === "enabled") queueMicrotask(syncAll);
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.GroupManagerExternalBoolean",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name === MANAGER_TYPE) patchManagerType(nodeType);
    else if (nodeData?.name === BOOLEAN_SOURCE_TYPE) patchBooleanSourceType(nodeType);
  },

  nodeCreated(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => { ensureInputs(node); applyExternalStates(node); startTimer(); });
  },

  loadedGraphNode(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => { ensureInputs(node); applyExternalStates(node); startTimer(); });
  },

  afterConfigureGraph() {
    if (syncAll()) startTimer();
  },
});
