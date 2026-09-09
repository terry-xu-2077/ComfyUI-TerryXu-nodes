import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuGroupManager";
const STATE_PROPERTY = "terry_group_manager_groups";
const MODE_ALWAYS = 0;
const MODE_BYPASS = 4;
const SYNC_INTERVAL = 500;

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isManager(node) {
  return nodeType(node) === NODE_ID;
}

function isChinese() {
  try {
    const locale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(locale).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return false;
  }
}

function reduceNodesDepthFirst(nodeOrNodes, callback) {
  const nodes = Array.isArray(nodeOrNodes) ? nodeOrNodes : [nodeOrNodes];
  const stack = [];
  for (let i = nodes.length - 1; i >= 0; i--) stack.push(nodes[i]);
  const visited = new Set();

  while (stack.length) {
    const node = stack.pop();
    if (!node || visited.has(node)) continue;
    visited.add(node);
    callback(node);

    if (node.isSubgraphNode?.() && node.subgraph) {
      const children = node.subgraph.nodes || [];
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
    }
  }
}

function changeModeOfNodes(nodeOrNodes, mode) {
  reduceNodesDepthFirst(nodeOrNodes, (node) => {
    if (!node || isManager(node)) return;
    node.mode = mode;
  });
}

function getGroupNodes(group) {
  return Array.from(group?._children || []).filter((node) => node && !isManager(node));
}

function getGraphDependentNodeKey(node) {
  const graph = node?.graph || app.graph;
  return `${graph?.id ?? graph?._id ?? "root"}:${node?.id}`;
}

function groupsExactlyLikeRgthree() {
  const graph = app.canvas?.getCurrentGraph?.() ?? app.graph;
  if (!graph) return [];

  const groups = [...(graph._groups || [])];
  const subgraphs = graph.subgraphs?.values?.();
  if (subgraphs) {
    let subgraph;
    while ((subgraph = subgraphs.next().value)) {
      groups.push(...(subgraph.groups || []));
    }
  }
  return groups;
}

function getBoundingsForAllNodes() {
  const boundings = Object.create(null);
  const rootNodes = app.graph?._nodes || app.graph?.nodes || [];

  reduceNodesDepthFirst(rootNodes, (node) => {
    let bounds = null;
    try {
      bounds = node.getBounding?.();
    } catch {}

    if (bounds && Number(bounds[0]) === 0 && Number(bounds[1]) === 0 && Number(bounds[2]) === 0 && Number(bounds[3]) === 0) {
      try {
        const ctx = node.graph?.primaryCanvas?.canvas?.getContext?.("2d");
        if (ctx) {
          node.updateArea?.(ctx);
          bounds = node.getBounding?.();
        }
      } catch {}
    }

    if (!bounds?.length || bounds.length < 4) return;
    boundings[getGraphDependentNodeKey(node)] = [
      Number(bounds[0]),
      Number(bounds[1]),
      Number(bounds[2]),
      Number(bounds[3]),
    ];
  });

  return boundings;
}

function recomputeInsideNodesForGroup(group, cachedBoundings) {
  if (!group?.graph) return;
  const nodes = group.graph.nodes || group.graph._nodes || [];
  const groupBounds = group._bounding;
  if (!groupBounds?.length || groupBounds.length < 4) return;

  group._children?.clear?.();
  if (Array.isArray(group.nodes)) group.nodes.length = 0;

  for (const node of nodes) {
    if (!node || isManager(node)) continue;
    const nodeBounding = cachedBoundings[getGraphDependentNodeKey(node)];
    if (!nodeBounding) continue;

    const nodeCenter = [
      nodeBounding[0] + nodeBounding[2] * 0.5,
      nodeBounding[1] + nodeBounding[3] * 0.5,
    ];

    if (
      nodeCenter[0] >= groupBounds[0] &&
      nodeCenter[0] < groupBounds[0] + groupBounds[2] &&
      nodeCenter[1] >= groupBounds[1] &&
      nodeCenter[1] < groupBounds[1] + groupBounds[3]
    ) {
      group._children?.add?.(node);
      if (Array.isArray(group.nodes)) group.nodes.push(node);
    }
  }
}

function warmGroupsExactlyLikeRgthree() {
  const groups = groupsExactlyLikeRgthree();
  const cachedBoundings = getBoundingsForAllNodes();

  for (const group of groups) {
    recomputeInsideNodesForGroup(group, cachedBoundings);
    group.rgthree_hasAnyActiveNode = getGroupNodes(group).some((node) => node.mode === MODE_ALWAYS);
  }
  return groups;
}

function findGroup(entry, groups = warmGroupsExactlyLikeRgthree()) {
  const targetGraphId = String(entry?.graphId ?? "");
  const targetGroupId = String(entry?.groupId ?? "");
  const targetTitle = String(entry?.title ?? "");

  let matches = groups.filter((group) => {
    const graphId = String(group?.graph?.id ?? group?.graph?._id ?? "");
    if (targetGraphId && graphId !== targetGraphId) return false;
    const groupId = String(group?.id ?? group?._id ?? "");
    if (targetGroupId) return groupId === targetGroupId;
    return String(group?.title || "") === targetTitle;
  });

  if (!matches.length && targetGroupId) {
    matches = groups.filter((group) => String(group?.id ?? group?._id ?? "") === targetGroupId);
  }
  if (!matches.length) {
    matches = groups.filter((group) => String(group?.title || "") === targetTitle);
  }
  return matches[0] || null;
}

function rootManagers() {
  const result = [];
  const root = app.graph?.rootGraph || app.rootGraph || app.graph;
  if (!root) return result;
  reduceNodesDepthFirst(root._nodes || root.nodes || [], (node) => {
    if (isManager(node)) result.push(node);
  });
  return result;
}

function updateButton(button, enabled, title = "") {
  if (!button) return;
  const zh = isChinese();
  const enabledText = zh ? "已启用" : "Enabled";
  const bypassedText = zh ? "已旁路" : "Bypassed";
  button.setAttribute("aria-checked", String(enabled));
  button.setAttribute("aria-label", title ? `${title}: ${enabled ? enabledText : bypassedText}` : "");
  button.title = enabled ? enabledText : bypassedText;
  button.textContent = enabled ? (zh ? "开启" : "yes") : (zh ? "关闭" : "no");
}

function syncManager(manager, groups) {
  const entries = manager?.properties?.[STATE_PROPERTY];
  if (!Array.isArray(entries)) return;
  const panel = manager.__terryGroupManager?.panel;
  const rows = panel ? Array.from(panel.querySelectorAll(".terry-group-manager__row")) : [];

  entries.forEach((entry, index) => {
    const group = findGroup(entry, groups);
    if (!group) return;
    const nodes = getGroupNodes(group);
    if (!nodes.length) return;
    const enabled = nodes.some((node) => node.mode === MODE_ALWAYS);
    entry.enabled = enabled;
    group.rgthree_hasAnyActiveNode = enabled;
    updateButton(rows[index]?.querySelector?.(".terry-group-manager__toggle"), enabled, entry.title);
  });
}

function syncAllManagers() {
  const groups = warmGroupsExactlyLikeRgthree();
  for (const manager of rootManagers()) syncManager(manager, groups);
}

function handleToggle(event) {
  const button = event.target?.closest?.(".terry-group-manager__toggle");
  if (!button) return;
  const panel = button.closest?.(".terry-group-manager");
  if (!panel) return;

  const manager = rootManagers().find((node) => node.__terryGroupManager?.panel === panel);
  if (!manager) return;
  const row = button.closest?.(".terry-group-manager__row");
  const index = row ? Array.from(panel.children).indexOf(row) : -1;
  const entries = manager.properties?.[STATE_PROPERTY];
  const entry = Array.isArray(entries) && index >= 0 ? entries[index] : null;
  if (!entry) return;

  const groups = warmGroupsExactlyLikeRgthree();
  const group = findGroup(entry, groups);
  if (!group) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  group.recomputeInsideNodes?.();
  const nodes = getGroupNodes(group);
  const hasAnyActiveNodes = nodes.some((node) => node.mode === MODE_ALWAYS);
  const newValue = !hasAnyActiveNodes;

  changeModeOfNodes(nodes, newValue ? MODE_ALWAYS : MODE_BYPASS);
  group.rgthree_hasAnyActiveNode = newValue;
  entry.enabled = newValue;
  group.graph?.setDirtyCanvas?.(true, false);
  group.graph?.change?.();
  manager.graph?.change?.();
  manager.setDirtyCanvas?.(true, true);
  updateButton(button, newValue, entry.title);
}

document.addEventListener("click", handleToggle, true);
setInterval(syncAllManagers, SYNC_INTERVAL);

app.registerExtension({
  name: "TerryXu.GroupManagerSubgraphService",
  afterConfigureGraph() {
    queueMicrotask(syncAllManagers);
    setTimeout(syncAllManagers, 50);
    setTimeout(syncAllManagers, 200);
  },
});
