import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuGroupManager";
const STATE_PROPERTY = "terry_group_manager_groups";
const STYLE_ID = "terry-group-manager-style";
const ROW_HEIGHT = 28;
const ROW_GAP = 3;
const PANEL_PADDING = 8;
const NODE_MIN_WIDTH = 240;
const REFRESH_INTERVAL = 450;
const GROUP_NAME_WHITE_MIX = 0.30;
const MODE_ALWAYS = 0;
const MODE_BYPASS = 4;

let refreshTimer = null;

function isChinese() {
  try {
    const locale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(locale).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return false;
  }
}

function labels() {
  return isChinese()
    ? {
        title: "🎛️ 分组开关",
        description: "手动选择工作流分组，独立启用或旁路每个分组内的节点。",
        category: "TerryXu/工作流管理",
        choose: "选择分组…",
        missing: "分组不存在",
        enabled: "已启用",
        bypassed: "已旁路",
        on: "开启",
        off: "关闭",
        navigate: "跳转到分组",
      }
    : {
        title: "🎛️ Group Manager",
        description: "Choose workflow groups manually and enable or bypass their nodes independently.",
        category: "TerryXu/Workflow Management",
        choose: "Select a group…",
        missing: "Group unavailable",
        enabled: "Enabled",
        bypassed: "Bypassed",
        on: "yes",
        off: "no",
        navigate: "Go to group",
      };
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === NODE_ID;
}

function collectionValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === "function") return [...collection.values()];
  return Object.values(collection);
}

function graphChildren(graph) {
  const result = [];
  for (const node of graph?._nodes || graph?.nodes || []) {
    if (node?.subgraph) result.push(node.subgraph);
  }
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

function graphGroups(graph) {
  return collectionValues(graph?._groups ?? graph?.groups ?? []);
}

function groupDescriptor(group, graph, graphIndex, groupIndex) {
  const title = String(group?.title || "").trim();
  if (!title) return null;
  const graphId = String(graph?.id ?? graph?._id ?? graphIndex);
  const rawGroupId = group?.id ?? group?._id;
  const groupId = rawGroupId == null || rawGroupId === "" ? "" : String(rawGroupId);
  const key = groupId ? `${graphId}:${groupId}` : `${graphId}:title:${title}:${groupIndex}`;
  const color = String(group?.color || group?._color || "").trim();
  return { group, graph, graphId, groupId, groupIndex, key, title, label: title, color };
}

function visibleGroupNameColor(color) {
  const value = String(color || "").trim();
  if (!value) return "";
  if (value.toLowerCase() === "black") return "#e5e7eb";
  let channels;
  const hex = value.match(/^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length <= 4
      ? hex.slice(0, 3).split("").map((part) => part + part).join("")
      : hex.slice(0, 6);
    channels = [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
  } else {
    const match = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match) channels = match.slice(1, 4).map(Number);
  }
  if (!channels) return `color-mix(in srgb, ${value} ${(1 - GROUP_NAME_WHITE_MIX) * 100}%, #e5e7eb)`;
  const brightness = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
  const colorSpread = Math.max(...channels) - Math.min(...channels);
  if (brightness < 64 || (colorSpread <= 32 && brightness < 160)) return "#e5e7eb";
  const light = [229, 231, 235];
  const mixed = channels.map((channel, index) => Math.round(channel * (1 - GROUP_NAME_WHITE_MIX) + light[index] * GROUP_NAME_WHITE_MIX));
  return `rgb(${mixed.join(", ")})`;
}

function workflowGroups() {
  const result = [];
  for (const [graphIndex, graph] of allGraphs().entries()) {
    for (const [groupIndex, group] of graphGroups(graph).entries()) {
      const item = groupDescriptor(group, graph, graphIndex, groupIndex);
      if (item) result.push(item);
    }
  }
  const totals = new Map();
  const counts = new Map();
  for (const item of result) totals.set(item.title, (totals.get(item.title) || 0) + 1);
  for (const item of result) {
    if ((totals.get(item.title) || 0) <= 1) continue;
    const count = (counts.get(item.title) || 0) + 1;
    counts.set(item.title, count);
    item.label = `${item.title} (${count})`;
  }
  return result;
}

function savedGroups(node) {
  node.properties ||= {};
  if (!Array.isArray(node.properties[STATE_PROPERTY])) node.properties[STATE_PROPERTY] = [];
  return node.properties[STATE_PROPERTY];
}

function matchingGroup(entry, groups) {
  if (!entry) return null;
  if (entry.groupId) {
    const exact = groups.find((item) => item.groupId === String(entry.groupId) && item.graphId === String(entry.graphId));
    if (exact) return exact;
    const sameId = groups.filter((item) => item.groupId === String(entry.groupId));
    if (sameId.length === 1) return sameId[0];
  }
  if (entry.key) {
    const exact = groups.find((item) => item.key === entry.key);
    if (exact) return exact;
  }
  return groups.find((item) => item.title === entry.title && item.graphId === String(entry.graphId))
    || groups.find((item) => item.title === entry.title)
    || null;
}

function entryForGroup(item, enabled) {
  return {
    key: item.key,
    graphId: item.graphId,
    groupId: item.groupId,
    title: item.title,
    enabled: Boolean(enabled),
  };
}

function rectOf(item) {
  const bounds = item?._bounding || item?.boundingRect;
  if (bounds && bounds.length >= 4) {
    const result = [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
    if (result.every(Number.isFinite)) return result;
  }
  const pos = item?._pos || item?.pos;
  const size = item?._size || item?.size;
  if (pos?.length >= 2 && size?.length >= 2) {
    const result = [Number(pos[0]), Number(pos[1]), Number(size[0]), Number(size[1])];
    if (result.every(Number.isFinite)) return result;
  }
  return null;
}

function nodeInsideGroup(node, groupRect) {
  const nodeRect = rectOf(node);
  if (!nodeRect || !groupRect) return false;
  const [gx, gy, gw, gh] = groupRect;
  const [nx, ny, nw, nh] = nodeRect;
  const cx = nx + nw / 2;
  const cy = ny + nh / 2;
  return cx >= gx && cx <= gx + gw && cy >= gy && cy <= gy + gh;
}

function isModeNode(node) {
  return Boolean(node)
    && !isManager(node)
    && typeof node.mode === "number"
    && Number.isFinite(node.mode);
}

function groupNodes(group, graph) {
  const groupRect = rectOf(group);
  const graphNodes = Array.from(graph?._nodes || graph?.nodes || []);
  if (groupRect && graphNodes.length) {
    return graphNodes.filter((node) => isModeNode(node) && nodeInsideGroup(node, groupRect));
  }
  try {
    if (!group?.graph && graph) group.graph = graph;
    group?.recomputeInsideNodes?.();
  } catch (error) {
    console.warn("[TerryXu][GroupManager] recomputeInsideNodes failed", error);
  }
  const children = group?._children && typeof group._children.values === "function"
    ? [...group._children.values()]
    : group?.nodes ?? group?._nodes ?? [];
  return Array.from(children).filter(isModeNode);
}

function groupIsEnabled(group, graph, fallback = true) {
  const nodes = groupNodes(group, graph);
  if (nodes.length === 0) return Boolean(fallback);
  return nodes.some((node) => node.mode !== MODE_BYPASS);
}

function changeNodesMode(nodes, mode, visited = new Set()) {
  for (const node of nodes) {
    if (!isModeNode(node) || visited.has(node)) continue;
    visited.add(node);
    node.mode = mode;
    node.graph?.change?.();
    node.setDirtyCanvas?.(true, true);
    if (node.subgraph) {
      const nested = Array.from(node.subgraph?._nodes || node.subgraph?.nodes || []).filter(isModeNode);
      changeNodesMode(nested, mode, visited);
    }
  }
}

function markChanged(node) {
  node.graph?.change?.();
  node.graph?.setDirtyCanvas?.(true, true);
  node.setDirtyCanvas?.(true, true);
}

function toggleGroup(node, entry, enabled) {
  const item = matchingGroup(entry, workflowGroups());
  if (!item) return;
  changeNodesMode(groupNodes(item.group, item.graph), enabled ? MODE_ALWAYS : MODE_BYPASS);
  Object.assign(entry, entryForGroup(item, enabled));
  item.graph?.change?.();
  item.graph?.setDirtyCanvas?.(true, true);
  markChanged(node);
  renderManager(node, true);
}

function navigateToGroup(entry) {
  const item = matchingGroup(entry, workflowGroups());
  const canvas = app.canvas;
  if (!item || !canvas) return;
  const currentGraph = canvas.getCurrentGraph?.() || canvas.graph;
  if (currentGraph && item.graph && currentGraph !== item.graph) {
    if (item.graph === app.graph) canvas.closeSubgraph?.();
    else canvas.openSubgraph?.(item.graph);
    if (canvas.getCurrentGraph?.() !== item.graph) canvas.setGraph?.(item.graph);
  }
  canvas.centerOnNode?.(item.group);
  const groupSize = item.group?._size || item.group?.size;
  const width = Number(groupSize?.[0]);
  const height = Number(groupSize?.[1]);
  const canvasWidth = Number(canvas.canvas?.width);
  const canvasHeight = Number(canvas.canvas?.height);
  if (width > 0 && height > 0 && canvasWidth > 0 && canvasHeight > 0) {
    const currentZoom = Number(canvas.ds?.scale) || 1;
    const zoom = Math.min(currentZoom, canvasWidth / width - 0.02, canvasHeight / height - 0.02);
    if (zoom > 0) canvas.setZoom?.(zoom, [canvasWidth / 2, canvasHeight / 2]);
  }
  canvas.setDirty?.(true, true);
}

function installStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .terry-group-manager { box-sizing:border-box; display:flex; flex-direction:column; gap:${ROW_GAP}px; min-height:${ROW_HEIGHT + PANEL_PADDING * 2}px; padding:${PANEL_PADDING}px; width:100%; }
    .terry-group-manager__row { align-items:center; background:var(--comfy-input-bg,#222); border:1px solid var(--border-color,#595959); border-radius:999px; box-sizing:border-box; display:flex; flex:0 0 ${ROW_HEIGHT}px; height:${ROW_HEIGHT}px; max-height:${ROW_HEIGHT}px; min-height:${ROW_HEIGHT}px; min-width:0; overflow:hidden; }
    .terry-group-manager__select { appearance:none; -webkit-appearance:none; background:transparent; background-image:linear-gradient(45deg,transparent 50%,#ddd 50%),linear-gradient(135deg,#ddd 50%,transparent 50%); background-position:calc(100% - 12px) 50%,calc(100% - 7px) 50%; background-repeat:no-repeat; background-size:5px 5px; border:0; border-radius:0; box-sizing:border-box; color:var(--input-text,#ddd); color-scheme:dark; cursor:pointer; flex:1 1 auto; font:12px Inter,system-ui,sans-serif; height:100%; min-width:0; padding:0 22px 0 12px; width:0; }
    .terry-group-manager__select option { background:#25272b !important; color:#e8e8e8; }
    .terry-group-manager__select option:disabled { color:#92959d !important; }
    .terry-group-manager__select:focus-visible,.terry-group-manager__toggle:focus-visible,.terry-group-manager__navigate:focus-visible { outline:1px solid var(--p-primary-color,#74a4cf); outline-offset:-2px; }
    .terry-group-manager__toggle { align-items:center; background:transparent; border:0; color:var(--input-text,#ddd); cursor:pointer; display:flex; flex:0 0 auto; font:11px Inter,system-ui,sans-serif; gap:7px; height:100%; justify-content:flex-end; min-width:64px; padding:0 8px; }
    .terry-group-manager__toggle::after { background:#555; border-radius:50%; content:""; flex:0 0 15px; height:15px; transition:background 120ms ease; width:15px; }
    .terry-group-manager__toggle[aria-checked="true"]::after { background:var(--p-primary-color,#71a2c8); }
    .terry-group-manager__navigate { align-items:center; background:transparent; border:0; border-left:1px solid var(--border-color,#595959); color:var(--p-primary-color,#83a3bb); cursor:pointer; display:flex; flex:0 0 37px; font:19px/1 system-ui,sans-serif; height:100%; justify-content:center; padding:0; width:37px; }
    .terry-group-manager__toggle:disabled,.terry-group-manager__navigate:disabled { cursor:not-allowed; opacity:.38; }
  `;
  document.head.append(style);
}

function panelHeight(node) {
  return (savedGroups(node).length + 1) * ROW_HEIGHT + savedGroups(node).length * ROW_GAP + PANEL_PADDING * 2;
}

function resizeManager(node) {
  const width = Math.max(NODE_MIN_WIDTH, Number(node.size?.[0]) || NODE_MIN_WIDTH);
  const height = Math.max(panelHeight(node), ROW_HEIGHT + PANEL_PADDING * 2);
  if (node.size?.[0] !== width || node.size?.[1] !== height) node.setSize?.([width, height]);
  node.setDirtyCanvas?.(true, true);
}

function makeOption(value, label, disabled = false, color = "") {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  option.disabled = disabled;
  const optionColor = visibleGroupNameColor(color);
  if (optionColor && !disabled) option.style.color = optionColor;
  return option;
}

function buildRow(node, panel, groups, entry, index) {
  const text = labels();
  const row = document.createElement("div");
  row.className = "terry-group-manager__row";

  const select = document.createElement("select");
  select.className = "terry-group-manager__select";
  const nodeId = String(node?.id ?? "manager").replace(/[^\w-]/g, "_");
  const fieldId = `terry-group-manager-${nodeId}-${index}`;
  select.id = fieldId;
  select.name = fieldId;
  select.autocomplete = "off";
  select.setAttribute("aria-label", text.choose);
  select.append(makeOption("", text.choose));

  const selected = entry ? matchingGroup(entry, groups) : null;
  const groupNameColor = visibleGroupNameColor(selected?.color);
  if (!entry) select.style.color = "#6b6b6b";
  else if (groupNameColor) select.style.color = groupNameColor;

  const selectedElsewhere = new Set(
    savedGroups(node)
      .filter((candidate) => candidate !== entry)
      .map((candidate) => matchingGroup(candidate, groups)?.key)
      .filter(Boolean)
  );

  if (entry && !selected) select.append(makeOption("__terry_missing__", `${entry.title} (${text.missing})`, true));
  for (const item of groups) {
    if (selectedElsewhere.has(item.key)) continue;
    select.append(makeOption(item.key, item.label, false, item.color));
  }
  select.value = selected?.key || (entry ? "__terry_missing__" : "");

  select.addEventListener("change", () => {
    const values = savedGroups(node);
    if (!select.value) {
      if (entry) values.splice(index, 1);
    } else {
      const chosen = workflowGroups().find((item) => item.key === select.value);
      if (!chosen) return;
      const next = entryForGroup(chosen, groupIsEnabled(chosen.group, chosen.graph, true));
      if (entry) values[index] = next;
      else values.push(next);
    }
    markChanged(node);
    renderManager(node, true);
  });
  row.append(select);

  if (entry && selected) {
    Object.assign(entry, entryForGroup(selected, groupIsEnabled(selected.group, selected.graph, entry.enabled)));
  }

  const enabled = Boolean(entry?.enabled);
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "terry-group-manager__toggle";
  toggle.setAttribute("role", "switch");
  toggle.setAttribute("aria-checked", String(enabled));
  toggle.setAttribute("aria-label", entry ? `${entry.title}: ${enabled ? text.enabled : text.bypassed}` : text.choose);
  toggle.title = enabled ? text.enabled : text.bypassed;
  toggle.textContent = enabled ? text.on : text.off;
  toggle.disabled = !selected;
  toggle.addEventListener("click", () => {
    if (entry) toggleGroup(node, entry, !entry.enabled);
  });
  row.append(toggle);

  const navigate = document.createElement("button");
  navigate.type = "button";
  navigate.className = "terry-group-manager__navigate";
  navigate.setAttribute("aria-label", entry ? `${text.navigate}: ${entry.title}` : text.navigate);
  navigate.title = text.navigate;
  navigate.textContent = "➜";
  navigate.disabled = !selected;
  navigate.addEventListener("click", () => {
    if (entry) navigateToGroup(entry);
  });
  row.append(navigate);
  panel.append(row);
}

function signatureFor(node, groups) {
  return JSON.stringify({
    zh: isChinese(),
    groups: groups.map((item) => [item.key, item.title, item.label, item.color]),
    selected: savedGroups(node).map((entry) => {
      const item = matchingGroup(entry, groups);
      const enabled = item ? groupIsEnabled(item.group, item.graph, entry.enabled) : entry.enabled;
      return [entry.key, entry.title, enabled, Boolean(item)];
    }),
  });
}

function renderManager(node, force = false) {
  const panel = node.__terryGroupManager?.panel;
  if (!panel) return;
  const groups = workflowGroups();
  const signature = signatureFor(node, groups);
  if (!force && panel.__terrySignature === signature) return;
  const focused = document.activeElement;
  if (!force && focused && panel.contains(focused)) return;
  panel.__terrySignature = signature;
  panel.replaceChildren();
  for (const [index, entry] of savedGroups(node).entries()) buildRow(node, panel, groups, entry, index);
  buildRow(node, panel, groups, null, savedGroups(node).length);
  resizeManager(node);
}

function installManager(node) {
  if (!isManager(node) || node.__terryGroupManager || typeof node.addDOMWidget !== "function") return;
  installStyle();
  const panel = document.createElement("div");
  panel.className = "terry-group-manager";
  panel.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.addEventListener("keydown", (event) => event.stopPropagation());
  const widget = node.addDOMWidget("terry_group_manager_panel", "terry_group_manager_panel", panel, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => panelHeight(node),
    getMaxHeight: () => panelHeight(node),
  });
  if (!widget) {
    panel.remove();
    return;
  }
  widget.serialize = false;
  node.__terryGroupManager = { panel, widget };
  renderManager(node, true);
}

function refreshAllManagers(force = false) {
  let found = false;
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (!isManager(node)) continue;
      found = true;
      installManager(node);
      renderManager(node, force);
    }
  }
  return found;
}

function startRefresh() {
  if (refreshTimer != null) return;
  refreshTimer = setInterval(() => {
    if (!refreshAllManagers()) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
  }, REFRESH_INTERVAL);
}

app.registerExtension({
  name: "TerryXu.GroupManager",

  addCustomNodeDefs(defs) {
    const text = labels();
    defs[NODE_ID] = {
      name: NODE_ID,
      display_name: text.title,
      description: text.description,
      category: text.category,
      python_module: "custom_nodes.ComfyUI-TerryXu-nodes",
      input: { required: {} },
      output: [],
      output_name: [],
      output_is_list: [],
      output_node: false,
    };
  },

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;
    nodeType.title = nodeData.display_name || labels().title;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      this.isVirtualNode = true;
      this.serialize_widgets = false;
      savedGroups(this);
      installManager(this);
      startRefresh();
      return result;
    };
    nodeType.prototype.applyToGraph = function () {};
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configure?.apply(this, arguments);
      this.isVirtualNode = true;
      savedGroups(this);
      queueMicrotask(() => {
        installManager(this);
        renderManager(this, true);
        startRefresh();
      });
      return result;
    };
  },

  nodeCreated(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => {
      installManager(node);
      renderManager(node, true);
      startRefresh();
    });
  },

  loadedGraphNode(node) {
    if (!isManager(node)) return;
    queueMicrotask(() => {
      installManager(node);
      renderManager(node, true);
      startRefresh();
    });
  },

  afterConfigureGraph() {
    if (refreshAllManagers(true)) startRefresh();
  },
});