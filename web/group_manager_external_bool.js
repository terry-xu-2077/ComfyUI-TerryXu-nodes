import { app } from "../../scripts/app.js";

const MANAGER_TYPE = "TerryXuGroupManager";
const BOOLEAN_SOURCE_TYPE = "TerryXuBooleanSwitch";
const STATE_PROPERTY = "terry_group_manager_groups";
const POLL_MS = 180;
const ROW_HEIGHT = 28;
const ROW_GAP = 3;
const PANEL_PADDING = 8;
const NODE_MIN_WIDTH = 240;
const STYLE_ID = "terry-group-manager-external-bool-style";

let timer = null;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === MANAGER_TYPE;
}

function isVueNodesMode() {
  return Boolean(globalThis.LiteGraph?.vueNodesMode);
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

function expectedPanelHeight(node) {
  const count = savedGroups(node).length;
  return (count + 1) * ROW_HEIGHT + count * ROW_GAP + PANEL_PADDING * 2;
}

function normalizeManagerSize(node) {
  const width = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || NODE_MIN_WIDTH);
  const height = expectedPanelHeight(node);
  if (Math.abs(Number(node.size?.[0]) - width) > 0.5 || Math.abs(Number(node.size?.[1]) - height) > 0.5) {
    node.setSize?.([width, height]);
    node.graph?.setDirtyCanvas?.(true, true);
  }
}

function syncWidgetAnchor(node) {
  if (!node.__terryExternalBoolWidgetAnchor) {
    node.__terryExternalBoolWidgetAnchor = {
      value: node.widgets_start_y,
      mode: null,
    };
  }
  const state = node.__terryExternalBoolWidgetAnchor;
  const mode = isVueNodesMode() ? "vue" : "classic";
  const desired = mode === "classic" ? 0 : state.value;
  if (state.mode === mode && node.widgets_start_y === desired) return;
  state.mode = mode;
  node.widgets_start_y = desired;
  try { node.arrange?.(); } catch {}
  normalizeManagerSize(node);
}

function ensureInputs(node) {
  if (!isManager(node)) return;
  syncWidgetAnchor(node);
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
  normalizeManagerSize(node);
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

function setSlotPos(slot, x, y) {
  if (!slot || !Number.isFinite(x) || !Number.isFinite(y)) return;
  if (!Array.isArray(slot.pos)) slot.pos = [x, y];
  else {
    slot.pos[0] = x;
    slot.pos[1] = y;
  }
}

function syncClassicSlotPositions(node) {
  syncWidgetAnchor(node);
  const widgetRef = node.__terryGroupManager?.widget;
  const widgetY = Number(widgetRef?.y);
  const base = Number.isFinite(widgetY)
    ? widgetY
    : (Number(node.widgets_start_y) || 0) + 2;
  for (const [index, slot] of (node.inputs || []).entries()) {
    const y = base + PANEL_PADDING + ROW_HEIGHT / 2 + index * (ROW_HEIGHT + ROW_GAP);
    setSlotPos(slot, 0, y);
  }
  node.setDirtyCanvas?.(true, true);
}

function ensureGuideLayer(root) {
  if (!root) return null;
  let layer = [...root.children].find((element) => element?.classList?.contains("terry-group-manager-bool-guides"));
  if (!layer) {
    layer = document.createElement("div");
    layer.className = "terry-group-manager-bool-guides";
    root.append(layer);
  }
  return layer;
}

function syncNodes2SlotPositions(node, panel) {
  const root = nodeRoot(node);
  if (!root || !panel) return;
  const count = savedGroups(node).length;
  const slotRows = [...root.querySelectorAll(".lg-slot--input")].slice(0, count);
  const rows = [...panel.querySelectorAll(".terry-group-manager__row")].slice(0, count);
  if (!slotRows.length || !rows.length) return;

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
  const titleHeight = Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30;
  const layer = ensureGuideLayer(root);
  layer?.replaceChildren();

  slotRows.forEach((slotElement, index) => {
    const row = rows[index];
    const slot = node.inputs?.[index];
    if (!row || !slot) return;
    const rect = row.getBoundingClientRect();
    const rootY = rect.top + rect.height / 2 - rootRect.top;
    const localY = rootY - titleHeight;
    const rowLeft = Math.max(6, rect.left - rootRect.left);
    setSlotPos(slot, 0, localY);

    slotElement.classList.add("terry-group-external-bool-slot");
    Object.assign(slotElement.style, {
      position: "absolute", left: "0", top: `${rootY}px`, width: "14px", height: "12px",
      margin: "0", padding: "0", overflow: "visible", pointerEvents: "auto", zIndex: "46",
      transform: "translateY(-50%)",
    });

    if (layer) {
      const guide = document.createElement("div");
      guide.className = "terry-group-manager-bool-guide";
      guide.style.top = `${rootY}px`;
      guide.style.width = `${rowLeft}px`;
      layer.append(guide);
    }
  });
  node.setDirtyCanvas?.(true, true);
}

function installStyle() {
  if (typeof document === "undefined" || document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
.terry-group-manager__row[data-terry-boolean-input="true"]{
  box-shadow:inset 2px 0 0 color-mix(in srgb,var(--p-primary-color,#83a3bb) 52%,transparent);
}
.terry-group-manager-bool-guides{
  position:absolute;inset:0;overflow:visible;pointer-events:none;z-index:44;
}
.terry-group-manager-bool-guide{
  position:absolute;left:0;height:0;border-top:1px solid color-mix(in srgb,var(--p-primary-color,#83a3bb) 54%,transparent);
  transform:translateY(-.5px);pointer-events:none;
}
`;
  document.head.append(style);
}

function applyExternalStates(node) {
  ensureInputs(node);
  const panel = managerPanel(node);
  if (!panel) return;
  const rows = [...panel.querySelectorAll(".terry-group-manager__row")];
  const count = savedGroups(node).length;

  rows.forEach((row, index) => {
    if (index < count) row.dataset.terryBooleanInput = "true";
    else delete row.dataset.terryBooleanInput;
  });

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

  normalizeManagerSize(node);
  if (isVueNodesMode()) {
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => syncNodes2SlotPositions(node, panel));
    else queueMicrotask(() => syncNodes2SlotPositions(node, panel));
  } else {
    syncClassicSlotPositions(node);
  }
}

function fixedInputPosition(node, slotIndex) {
  const index = Number(slotIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const slot = node.inputs?.[index];
  const pos = slot?.pos;
  if (!slot?.__terryGroupExternalBoolean || !Array.isArray(pos) || pos.length < 2) return null;
  const x = Number(node.pos?.[0]) + Number(pos[0]);
  const y = Number(node.pos?.[1]) + Number(pos[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [x, y];
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

  const oldConnectionPos = nodeType.prototype.getConnectionPos;
  nodeType.prototype.getConnectionPos = function (isInput, slotIndex, out) {
    const fixed = isInput ? fixedInputPosition(this, slotIndex) : null;
    if (fixed) {
      if (out) {
        out[0] = fixed[0];
        out[1] = fixed[1];
        return out;
      }
      return fixed;
    }
    return oldConnectionPos?.apply(this, arguments);
  };

  const oldInputPos = nodeType.prototype.getInputPos;
  if (oldInputPos) {
    nodeType.prototype.getInputPos = function (slotIndex) {
      return fixedInputPosition(this, slotIndex) || oldInputPos.apply(this, arguments);
    };
  }

  const oldSlotPosition = nodeType.prototype.getSlotPosition;
  if (oldSlotPosition) {
    nodeType.prototype.getSlotPosition = function (slotIndex, isInput) {
      return (isInput ? fixedInputPosition(this, slotIndex) : null) || oldSlotPosition.apply(this, arguments);
    };
  }

  const oldForeground = nodeType.prototype.onDrawForeground;
  nodeType.prototype.onDrawForeground = function (ctx) {
    const result = oldForeground?.apply(this, arguments);
    if (!isVueNodesMode() && ctx && !this.flags?.collapsed) {
      ctx.save();
      ctx.strokeStyle = "rgba(131,163,187,.52)";
      ctx.lineWidth = 1;
      for (const slot of this.inputs || []) {
        if (!slot?.__terryGroupExternalBoolean || !Array.isArray(slot.pos)) continue;
        const y = Number(slot.pos[1]);
        if (!Number.isFinite(y)) continue;
        ctx.beginPath();
        ctx.moveTo(3, y);
        ctx.lineTo(12, y);
        ctx.stroke();
      }
      ctx.restore();
    }
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

  setup() {
    installStyle();
  },

  afterConfigureGraph() {
    installStyle();
    if (syncAll()) startTimer();
  },
});
