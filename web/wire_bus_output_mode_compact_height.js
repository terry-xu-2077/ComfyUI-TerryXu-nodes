import { app } from "../../scripts/app.js";

const WIRED_UNPACK_TYPE = "TerryXuWireBusUnpack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const MODE_PROPERTY = "terry_wire_bus_expand_outputs";
const LEGACY_MODE_WIDGET = "terry_bus_expand_outputs";

// Compact heights are intentionally independent from the upstream Bus-In lane
// count. In BUS passthrough mode Bus-Out only needs one BUS lane plus its local
// controls, so inheriting the paired pack height is both wasteful and visually
// misleading.
const WIRED_BUS_ONLY_HEIGHT = 110;
const WIRELESS_BUS_ONLY_HEIGHT = 140;
const MODE_ROW_HEIGHT = 30;
const WIRELESS_CHANNEL_BLOCK_HEIGHT = 40;

function nodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      ""
  );
}

function isWiredUnpack(node) {
  return nodeType(node) === WIRED_UNPACK_TYPE;
}

function isWirelessUnpack(node) {
  return nodeType(node) === WIRELESS_UNPACK_TYPE;
}

function isUnpack(node) {
  return isWiredUnpack(node) || isWirelessUnpack(node);
}

function expandedMode(node) {
  return node?.properties?.[MODE_PROPERTY] !== false;
}

function hasModeControl(node) {
  return Boolean(
    node?.__terryNativeBusModeToggle ||
      (node?.widgets || []).some((widget) => widget?.name === LEGACY_MODE_WIDGET)
  );
}

function compactHeight(node) {
  return isWirelessUnpack(node)
    ? WIRELESS_BUS_ONLY_HEIGHT
    : WIRED_BUS_ONLY_HEIGHT;
}

function applyCompactWidgetStart(node, height = compactHeight(node)) {
  if (!isUnpack(node) || expandedMode(node) || node.flags?.collapsed) return;
  const reserved = MODE_ROW_HEIGHT
    + (isWirelessUnpack(node) ? WIRELESS_CHANNEL_BLOCK_HEIGHT : 0);
  node.widgets_start_y = Math.max(0, Number(height || 0) - reserved);
  node._widgetSlotsDirty = true;
}

function callRawSize(node, original, size) {
  // wire_bus_output_mode.js has its own size guard for expanded mode. Tell that
  // guard this is an intentional final BUS-only size so it must not add another
  // row on top of it.
  const previousRaw = Boolean(node.__terryBusOutputModeRawSetSize);
  node.__terryBusOutputModeRawSetSize = true;
  try {
    return original.call(node, size);
  } finally {
    node.__terryBusOutputModeRawSetSize = previousRaw;
  }
}

function installSizeGuard(node) {
  if (!isUnpack(node) || node.__terryBusOnlyCompactSizeGuard) return;
  const original = node.setSize;
  if (typeof original !== "function") return;

  node.__terryBusOnlyCompactSizeGuard = true;
  node.__terryBusOnlyCompactOriginalSetSize = original;

  node.setSize = function (size) {
    if (
      this.flags?.collapsed ||
      expandedMode(this) ||
      !hasModeControl(this) ||
      !Array.isArray(size)
    ) {
      return original.apply(this, arguments);
    }

    const targetHeight = compactHeight(this);
    const width = Math.max(112, Number(size?.[0]) || Number(this.size?.[0]) || 112);
    const result = callRawSize(this, original, [width, targetHeight]);

    // Do not leave the expanded-layout bookkeeping pointing at the paired pack
    // height while this node is in BUS-only mode.
    this.__terryBusExpandedSize = [width, targetHeight];
    this.__terryBusOutputModeBaseHeight = Math.max(0, targetHeight - MODE_ROW_HEIGHT);
    applyCompactWidgetStart(this, targetHeight);
    return result;
  };
}

function forceCompact(node) {
  if (!isUnpack(node) || expandedMode(node) || node.flags?.collapsed || !hasModeControl(node)) return;
  installSizeGuard(node);

  const targetHeight = compactHeight(node);
  const currentHeight = Math.max(0, Number(node.size?.[1]) || 0);
  const width = Math.max(112, Number(node.size?.[0]) || 112);

  if (Math.abs(currentHeight - targetHeight) > 0.5) {
    node.setSize?.([width, targetHeight]);
  } else {
    applyCompactWidgetStart(node, targetHeight);
  }

  node.graph?.setDirtyCanvas?.(true, true);
}

function refreshNode(node) {
  if (!isUnpack(node)) return;
  installSizeGuard(node);
  if (!expandedMode(node)) forceCompact(node);
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
      const values = typeof collection.values === "function"
        ? collection.values()
        : Object.values(collection);
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
  name: "TerryXu.WireBusOutputModeCompactHeight",

  setup() {
    start();
    queueMicrotask(() => {
      for (const graph of allGraphs()) {
        for (const node of graph?._nodes || []) refreshNode(node);
      }
    });
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
