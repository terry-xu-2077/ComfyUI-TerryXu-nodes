import { app } from "../../scripts/app.js";

const NODE_TYPE = "TerryXuLinkedBoolean";
const CHANNEL_ID = "terry_linked_bool_channel_id";
const CHANNEL_NAME = "terry_linked_bool_channel_name";
const CHANNEL_ROLE = "terry_linked_bool_channel_role";
const CREATED_AT = "terry_linked_bool_created_at";
const ROLE_CREATE = "create";
const POLL_MS = 250;

let timer = null;

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

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    const ca = Number(properties(a)[CREATED_AT]) || 0;
    const cb = Number(properties(b)[CREATED_AT]) || 0;
    if (ca !== cb) return ca - cb;
    return String(a?.id ?? "").localeCompare(String(b?.id ?? ""), undefined, { numeric: true });
  });
}

function channelRecords() {
  const groups = new Map();
  for (const node of linkedNodes()) {
    const p = properties(node);
    const id = String(p[CHANNEL_ID] || "").trim();
    const name = String(p[CHANNEL_NAME] || "").trim();
    if (!id || !name) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(node);
  }

  const records = [];
  for (const [id, membersRaw] of groups) {
    const members = sortNodes(membersRaw);
    const owner = members.find((node) => properties(node)[CHANNEL_ROLE] === ROLE_CREATE) || members[0];
    const name = String(properties(owner)[CHANNEL_NAME] || properties(members[0])[CHANNEL_NAME] || "").trim();
    if (name) records.push({ id, name, owner, members });
  }

  records.sort((a, b) => a.name.localeCompare(b.name));
  return records;
}

function selectableRecords(node, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const seenNames = new Set();
  const result = [];
  for (const record of channelRecords()) {
    // A channel creator should never see its own channel as a selectable target.
    if (record.owner === node) continue;
    const key = record.name.toLowerCase();
    if (seenNames.has(key)) continue;
    if (needle && !key.includes(needle)) continue;
    seenNames.add(key);
    result.push(record);
  }
  return result;
}

function makeMenu() {
  const menu = document.createElement("div");
  Object.assign(menu.style, {
    position: "fixed",
    display: "none",
    zIndex: "2147483000",
    minWidth: "120px",
    maxHeight: "240px",
    overflowY: "auto",
    padding: "5px",
    borderRadius: "8px",
    border: "1px solid rgba(255,255,255,.14)",
    background: "var(--comfy-menu-bg, #202124)",
    boxShadow: "0 10px 30px rgba(0,0,0,.38)",
    boxSizing: "border-box",
  });
  document.body.appendChild(menu);
  return menu;
}

function positionMenu(input, menu) {
  const rect = input.getBoundingClientRect();
  const gap = 4;
  const width = Math.max(120, rect.width);
  menu.style.width = `${width}px`;
  menu.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - width - 4))}px`;

  // Open upward when there is not enough room below.
  const estimated = Math.min(240, Math.max(38, menu.scrollHeight || 38));
  const roomBelow = window.innerHeight - rect.bottom;
  if (roomBelow < estimated + gap && rect.top > estimated + gap) {
    menu.style.top = `${Math.max(4, rect.top - estimated - gap)}px`;
  } else {
    menu.style.top = `${Math.min(window.innerHeight - estimated - 4, rect.bottom + gap)}px`;
  }
}

function install(node) {
  if (!isLinked(node) || node.__terryLinkedComboFix) return false;
  const ui = node.__terryLinkedBoolUi;
  const input = ui?.input;
  const row = ui?.row;
  if (!input || !row || typeof document === "undefined") return false;

  node.__terryLinkedComboFix = true;

  // Native <datalist> is unreliable inside ComfyUI's transformed DOM widgets:
  // it can close on pointer-down and Chromium may render option value + label as
  // two visually duplicated rows. Replace it with a small custom popup.
  input.removeAttribute("list");
  try { ui.list?.remove?.(); } catch {}

  const wrap = document.createElement("div");
  Object.assign(wrap.style, {
    position: "relative",
    display: "flex",
    flex: "1 1 auto",
    minWidth: "0",
    height: "26px",
  });
  row.replaceChild(wrap, input);
  wrap.appendChild(input);

  Object.assign(input.style, {
    width: "100%",
    height: "26px",
    paddingRight: "30px",
  });

  const arrow = document.createElement("button");
  arrow.type = "button";
  arrow.textContent = "▼";
  arrow.tabIndex = -1;
  Object.assign(arrow.style, {
    position: "absolute",
    right: "1px",
    top: "1px",
    width: "28px",
    height: "24px",
    padding: "0",
    border: "0",
    borderRadius: "0 6px 6px 0",
    background: "transparent",
    color: "inherit",
    cursor: "pointer",
    fontSize: "11px",
    lineHeight: "24px",
  });
  wrap.appendChild(arrow);

  const menu = makeMenu();
  let open = false;

  const hideMenu = () => {
    open = false;
    menu.style.display = "none";
  };

  const showMenu = (filter = "") => {
    menu.replaceChildren();
    const records = selectableRecords(node, filter);
    if (!records.length) {
      hideMenu();
      return;
    }

    for (const record of records) {
      const item = document.createElement("div");
      item.textContent = record.name;
      Object.assign(item.style, {
        padding: "7px 10px",
        borderRadius: "6px",
        cursor: "pointer",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        userSelect: "none",
      });
      item.addEventListener("mouseenter", () => { item.style.background = "rgba(255,255,255,.10)"; });
      item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
      item.addEventListener("pointerdown", (event) => {
        // Keep the input focused so its blur handler cannot close/rebuild the UI
        // before the selected channel is committed.
        event.preventDefault();
        event.stopPropagation();
        input.value = record.name;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        hideMenu();
      });
      menu.appendChild(item);
    }

    menu.style.display = "block";
    open = true;
    requestAnimationFrame(() => positionMenu(input, menu));
  };

  input.addEventListener("focus", () => showMenu(input.value));
  input.addEventListener("input", () => showMenu(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hideMenu();
  });

  arrow.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (open) {
      hideMenu();
    } else {
      input.focus({ preventScroll: true });
      showMenu("");
    }
  });

  const outside = (event) => {
    const target = event.target;
    if (wrap.contains(target) || menu.contains(target)) return;
    hideMenu();
  };
  document.addEventListener("pointerdown", outside, true);

  node.__terryLinkedComboFixUi = { wrap, arrow, menu, hideMenu, showMenu, outside };
  return true;
}

function syncAll() {
  const nodes = linkedNodes();
  if (!nodes.length) return false;
  for (const node of nodes) install(node);
  return true;
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

app.registerExtension({
  name: "TerryXu.LinkedBooleanComboFix",

  nodeCreated(node) {
    if (!isLinked(node)) return;
    setTimeout(() => { install(node); start(); }, 0);
  },

  loadedGraphNode(node) {
    if (!isLinked(node)) return;
    setTimeout(() => { install(node); start(); }, 0);
  },

  afterConfigureGraph() {
    setTimeout(() => { syncAll(); start(); }, 0);
  },
});
