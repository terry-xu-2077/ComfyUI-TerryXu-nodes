import { app } from "../../scripts/app.js";

const NODE_TYPE = "TerryXuLinkedBoolean";
const CHANNEL_ID = "terry_linked_bool_channel_id";
const CHANNEL_NAME = "terry_linked_bool_channel_name";
const CHANNEL_ROLE = "terry_linked_bool_channel_role";
const CREATED_AT = "terry_linked_bool_created_at";
const ROLE_CREATE = "create";
const ROLE_SELECT = "select";
const CHANNEL_WIDGET = "terry_linked_bool_channel";
const POLL_MS = 350;
const MIN_WIDTH = 210;

let timer = null;
let syncing = false;

function isChinese() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(raw).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return true;
  }
}

function labels() {
  return isChinese()
    ? {
        create: "创建",
        select: "选取",
        placeholder: "输入新频道或选择已有频道",
        empty: "未设置频道",
        title: "🔗 联动开关",
      }
    : {
        create: "Create",
        select: "Select",
        placeholder: "Type a new channel or choose an existing one",
        empty: "No channel",
        title: "🔗 Linked Switch",
      };
}

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isLinked(node) {
  return nodeType(node) === NODE_TYPE;
}

function properties(node) {
  if (!node.properties || typeof node.properties !== "object") node.properties = {};
  return node.properties;
}

function widget(node, name) {
  return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function boolWidget(node) {
  return widget(node, "enabled");
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

function linkedNodes() {
  return allGraphs().flatMap((graph) => graph?._nodes || graph?.nodes || []).filter(isLinked);
}

function newId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `linked-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function ensureIdentity(node) {
  const p = properties(node);
  if (!Number.isFinite(Number(p[CREATED_AT]))) p[CREATED_AT] = Date.now() + Math.random();
  if (p[CHANNEL_ID] == null) p[CHANNEL_ID] = "";
  if (p[CHANNEL_NAME] == null) p[CHANNEL_NAME] = "";
  if (![ROLE_CREATE, ROLE_SELECT].includes(p[CHANNEL_ROLE])) p[CHANNEL_ROLE] = ROLE_CREATE;
}

function channelId(node) {
  ensureIdentity(node);
  return String(properties(node)[CHANNEL_ID] || "").trim();
}

function channelName(node) {
  ensureIdentity(node);
  return String(properties(node)[CHANNEL_NAME] || "").trim();
}

function role(node) {
  ensureIdentity(node);
  return properties(node)[CHANNEL_ROLE] === ROLE_SELECT ? ROLE_SELECT : ROLE_CREATE;
}

function sortMembers(items) {
  return [...items].sort((a, b) => {
    const ca = Number(properties(a)[CREATED_AT]) || 0;
    const cb = Number(properties(b)[CREATED_AT]) || 0;
    if (ca !== cb) return ca - cb;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""), undefined, { numeric: true });
  });
}

function groupsById() {
  const map = new Map();
  for (const node of linkedNodes()) {
    const id = channelId(node);
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(node);
  }
  return map;
}

function healChannels() {
  let changed = false;
  const groups = groupsById();

  for (const [id, rawMembers] of groups) {
    const members = sortMembers(rawMembers);
    let creators = members.filter((node) => role(node) === ROLE_CREATE);
    let owner = creators[0] || members[0];
    if (!owner) continue;

    if (role(owner) !== ROLE_CREATE) {
      properties(owner)[CHANNEL_ROLE] = ROLE_CREATE;
      changed = true;
    }
    for (const node of members) {
      if (node === owner) continue;
      if (role(node) !== ROLE_SELECT) {
        properties(node)[CHANNEL_ROLE] = ROLE_SELECT;
        changed = true;
      }
    }

    let name = channelName(owner);
    if (!name) name = members.map(channelName).find(Boolean) || id.slice(0, 8);
    for (const node of members) {
      if (channelName(node) !== name) {
        properties(node)[CHANNEL_NAME] = name;
        changed = true;
      }
    }
  }
  return changed;
}

function channelRecords() {
  healChannels();
  const records = [];
  for (const [id, members] of groupsById()) {
    const ordered = sortMembers(members);
    const owner = ordered.find((node) => role(node) === ROLE_CREATE) || ordered[0];
    const name = channelName(owner);
    if (!name) continue;
    records.push({ id, name, owner, members: ordered });
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}

function channelByName(name) {
  const target = String(name || "").trim();
  if (!target) return null;
  return channelRecords().find((record) => record.name === target) || null;
}

function channelById(id) {
  const target = String(id || "").trim();
  if (!target) return null;
  return channelRecords().find((record) => record.id === target) || null;
}

function setNodeValue(node, value) {
  const toggle = boolWidget(node);
  const next = Boolean(value);
  if (!toggle) return false;
  const changed = Boolean(toggle.value) !== next;
  if (changed) {
    node.__terryLinkedApplying = true;
    try {
      toggle.value = next;
      node.__terryLinkedLastValue = next;
    } finally {
      node.__terryLinkedApplying = false;
    }
    node.graph?.setDirtyCanvas?.(true, true);
    node.setDirtyCanvas?.(true, true);
  }
  return changed;
}

function publishState(source, value) {
  if (syncing || !isLinked(source)) return;
  const id = channelId(source);
  const next = Boolean(value);
  source.__terryLinkedLastValue = next;
  if (!id) return;

  syncing = true;
  try {
    const record = channelById(id);
    if (!record) return;
    for (const node of record.members) setNodeValue(node, next);
  } finally {
    syncing = false;
  }
}

function syncChannelState(id) {
  const record = channelById(id);
  if (!record) return;
  const ownerValue = Boolean(boolWidget(record.owner)?.value);
  syncing = true;
  try {
    for (const node of record.members) setNodeValue(node, ownerValue);
  } finally {
    syncing = false;
  }
}

function promoteOldChannel(oldId) {
  if (!oldId) return;
  healChannels();
  syncChannelState(oldId);
}

function setChannel(node, name) {
  if (!isLinked(node)) return;
  ensureIdentity(node);
  const p = properties(node);
  const nextName = String(name || "").trim();
  const oldId = channelId(node);
  const oldRole = role(node);
  const oldName = channelName(node);

  if (!nextName) {
    p[CHANNEL_ID] = "";
    p[CHANNEL_NAME] = "";
    p[CHANNEL_ROLE] = ROLE_CREATE;
    updateUi(node);
    if (oldRole === ROLE_CREATE) promoteOldChannel(oldId);
    return;
  }

  const existing = channelByName(nextName);
  if (existing && existing.id !== oldId) {
    p[CHANNEL_ID] = existing.id;
    p[CHANNEL_NAME] = existing.name;
    p[CHANNEL_ROLE] = ROLE_SELECT;
    setNodeValue(node, boolWidget(existing.owner)?.value);
    if (oldRole === ROLE_CREATE) promoteOldChannel(oldId);
    healChannels();
    updateAllUi();
    syncChannelState(existing.id);
    return;
  }

  if (oldId && oldRole === ROLE_CREATE) {
    p[CHANNEL_NAME] = nextName;
    for (const member of channelById(oldId)?.members || []) properties(member)[CHANNEL_NAME] = nextName;
    updateAllUi();
    return;
  }

  if (oldId && oldName === nextName) {
    updateUi(node);
    return;
  }

  const newChannelId = newId();
  p[CHANNEL_ID] = newChannelId;
  p[CHANNEL_NAME] = nextName;
  p[CHANNEL_ROLE] = ROLE_CREATE;
  if (oldRole === ROLE_CREATE) promoteOldChannel(oldId);
  healChannels();
  updateAllUi();
  publishState(node, boolWidget(node)?.value);
}

function ensureChannelDom(node) {
  let existing = widget(node, CHANNEL_WIDGET);
  if (existing?.element) return existing;
  if (typeof document === "undefined" || typeof node.addDOMWidget !== "function") return null;

  const row = document.createElement("div");
  row.className = "terry-linked-bool-row";
  Object.assign(row.style, {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    height: "30px",
    boxSizing: "border-box",
    padding: "0 2px",
  });

  const roleLabel = document.createElement("span");
  roleLabel.className = "terry-linked-bool-role";
  Object.assign(roleLabel.style, {
    width: "36px",
    flex: "0 0 36px",
    fontSize: "12px",
    opacity: "0.82",
    textAlign: "right",
    userSelect: "none",
  });

  const input = document.createElement("input");
  const listId = `terry-linked-bool-${String(node.id ?? Math.random()).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  input.setAttribute("list", listId);
  input.autocomplete = "off";
  input.spellcheck = false;
  Object.assign(input.style, {
    flex: "1 1 auto",
    minWidth: "0",
    height: "26px",
    borderRadius: "6px",
    border: "1px solid var(--border-color, rgba(255,255,255,.18))",
    background: "var(--comfy-input-bg, rgba(0,0,0,.22))",
    color: "inherit",
    padding: "0 8px",
    boxSizing: "border-box",
    outline: "none",
  });

  const list = document.createElement("datalist");
  list.id = listId;

  const commit = () => setChannel(node, input.value);
  input.addEventListener("change", commit);
  input.addEventListener("blur", commit);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      input.blur();
    }
  });

  row.append(roleLabel, input, list);
  const domWidget = node.addDOMWidget(CHANNEL_WIDGET, "linked_boolean_channel", row, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 34,
    getMaxHeight: () => 34,
    margin: 4,
  });
  domWidget.serialize = false;

  // Put channel selection above the Boolean toggle in both classic and Nodes 2.0.
  const widgets = node.widgets || [];
  const index = widgets.indexOf(domWidget);
  if (index > 0) {
    widgets.splice(index, 1);
    widgets.unshift(domWidget);
  }

  node.__terryLinkedBoolUi = { row, roleLabel, input, list, domWidget };
  return domWidget;
}

function updateUi(node) {
  if (!isLinked(node)) return;
  ensureIdentity(node);
  ensureChannelDom(node);
  const ui = node.__terryLinkedBoolUi;
  if (!ui) return;

  const t = labels();
  const currentRole = role(node);
  ui.roleLabel.textContent = currentRole === ROLE_CREATE ? t.create : t.select;
  ui.roleLabel.style.fontWeight = currentRole === ROLE_CREATE ? "600" : "400";
  ui.roleLabel.style.opacity = currentRole === ROLE_CREATE ? "1" : ".68";
  ui.input.placeholder = t.placeholder;
  if (document.activeElement !== ui.input) ui.input.value = channelName(node);

  const currentId = channelId(node);
  const records = channelRecords();
  ui.list.replaceChildren();
  for (const record of records) {
    if (!record.name) continue;
    // A creator already owns this channel; offering its own channel back in the
    // picker is redundant and makes the menu look like a selectable target.
    if (record.owner === node) continue;
    const option = document.createElement("option");
    option.value = record.name;
    option.label = record.id === currentId ? record.name : `${record.name} · ${record.members.length}`;
    ui.list.append(option);
  }

  node.title = t.title;
  node.resizable = true;
  if (Number(node.size?.[0]) < MIN_WIDTH) node.setSize?.([MIN_WIDTH, Number(node.size?.[1]) || 90]);
  node.graph?.setDirtyCanvas?.(true, true);
}

function updateAllUi() {
  healChannels();
  for (const node of linkedNodes()) updateUi(node);
}

function patchToggle(node) {
  const toggle = boolWidget(node);
  if (!toggle || toggle.__terryLinkedBoolWrapped) return;
  toggle.__terryLinkedBoolWrapped = true;
  node.__terryLinkedLastValue = Boolean(toggle.value);
  const original = toggle.callback;
  toggle.callback = function (value) {
    const result = original?.apply(this, arguments);
    if (!node.__terryLinkedApplying) publishState(node, value);
    return result;
  };
}

function installNode(node) {
  if (!isLinked(node)) return;
  ensureIdentity(node);
  patchToggle(node);
  ensureChannelDom(node);
  updateUi(node);
}

function syncAll() {
  const nodes = linkedNodes();
  if (!nodes.length) return false;
  const changed = healChannels();
  for (const node of nodes) {
    installNode(node);
    const toggle = boolWidget(node);
    const current = Boolean(toggle?.value);
    if (!node.__terryLinkedApplying && node.__terryLinkedLastValue !== undefined && current !== node.__terryLinkedLastValue) {
      publishState(node, current);
    }
    node.__terryLinkedLastValue = current;
  }
  if (changed) updateAllUi();
  return true;
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

function patchNodeType(nodeTypeClass) {
  if (nodeTypeClass.prototype.__terryLinkedBoolPatched) return;
  nodeTypeClass.prototype.__terryLinkedBoolPatched = true;

  const created = nodeTypeClass.prototype.onNodeCreated;
  nodeTypeClass.prototype.onNodeCreated = function () {
    const result = created?.apply(this, arguments);
    queueMicrotask(() => { installNode(this); updateAllUi(); startTimer(); });
    return result;
  };

  const configured = nodeTypeClass.prototype.onConfigure;
  nodeTypeClass.prototype.onConfigure = function () {
    const result = configured?.apply(this, arguments);
    queueMicrotask(() => { installNode(this); updateAllUi(); startTimer(); });
    return result;
  };

  const widgetChanged = nodeTypeClass.prototype.onWidgetChanged;
  nodeTypeClass.prototype.onWidgetChanged = function (name, value) {
    const result = widgetChanged?.apply(this, arguments);
    if (name === "enabled" && !this.__terryLinkedApplying) publishState(this, value);
    return result;
  };

  const removed = nodeTypeClass.prototype.onRemoved;
  nodeTypeClass.prototype.onRemoved = function () {
    const oldId = channelId(this);
    const result = removed?.apply(this, arguments);
    queueMicrotask(() => {
      promoteOldChannel(oldId);
      updateAllUi();
    });
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.LinkedBoolean",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (nodeData?.name === NODE_TYPE) patchNodeType(nodeTypeClass);
  },

  nodeCreated(node) {
    if (!isLinked(node)) return;
    queueMicrotask(() => { installNode(node); updateAllUi(); startTimer(); });
  },

  loadedGraphNode(node) {
    if (!isLinked(node)) return;
    queueMicrotask(() => { installNode(node); updateAllUi(); startTimer(); });
  },

  afterConfigureGraph() {
    queueMicrotask(() => {
      updateAllUi();
      for (const record of channelRecords()) syncChannelState(record.id);
      startTimer();
    });
  },
});
