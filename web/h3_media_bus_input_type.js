import { app } from "../../scripts/app.js";

const TARGETS = new Set(["TerryXuH3PromptEditor", "TerryXuH3ShotTimeline"]);
const MEDIA_INPUT_TYPE = "*";
const BUS_TYPE = "TERRY_WIRE_BUS";

function nodeType(node) {
  return String(
    node?.comfyClass ||
    node?.type ||
    node?.constructor?.comfyClass ||
    node?.constructor?.type ||
    node?.constructor?.nodeData?.name ||
    ""
  );
}

function isTarget(node) {
  return TARGETS.has(nodeType(node));
}

function isMediaInput(node, slot) {
  return isTarget(node) && String(node?.inputs?.[Number(slot)]?.name || "") === "media";
}

function resolvedOutputType(type, output, originNode) {
  let value = String(output?.type || type || "").trim().toUpperCase();
  try {
    const slot = Math.max(0, Number(originNode?.outputs?.indexOf?.(output)) || 0);
    const resolved = originNode?.resolveVirtualOutput?.(slot);
    if (resolved?.node) {
      value = String(resolved.node?.outputs?.[Number(resolved.slot) || 0]?.type || value)
        .trim()
        .toUpperCase();
    }
  } catch {}
  return value;
}

function allowedMediaType(type) {
  const value = String(type || "").trim().toUpperCase();
  if (!value) return false;
  if (value === BUS_TYPE) return true;
  return value.includes("IMAGE") || value.includes("VIDEO") || value.includes("AUDIO");
}

function patchTargetClass(nodeTypeClass, nodeData) {
  if (!TARGETS.has(String(nodeData?.name || ""))) return;
  const proto = nodeTypeClass?.prototype;
  if (!proto || proto.__terryH3MediaTypeGuard) return;
  proto.__terryH3MediaTypeGuard = true;

  const original = proto.onConnectInput;
  proto.onConnectInput = function(slot, type, output, originNode) {
    if (isMediaInput(this, slot)) {
      return allowedMediaType(resolvedOutputType(type, output, originNode));
    }
    return original ? original.apply(this, arguments) : true;
  };
}

function applyMediaType(node) {
  if (!isTarget(node)) return false;
  const input = node?.inputs?.find?.((slot) => String(slot?.name || "") === "media");
  if (!input) return false;
  if (input.type === MEDIA_INPUT_TYPE) return false;
  input.type = MEDIA_INPUT_TYPE;
  node._widgetSlotsDirty = true;
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
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

function applyAll() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) applyMediaType(node);
  }
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(applyAll, 200);
  queueMicrotask(applyAll);
}

app.registerExtension({
  name: "TerryXu.H3MediaBusInputType",
  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    patchTargetClass(nodeTypeClass, nodeData);
  },
  setup() {
    start();
  },
  nodeCreated(node) {
    applyMediaType(node);
    queueMicrotask(() => applyMediaType(node));
    start();
  },
  loadedGraphNode(node) {
    applyMediaType(node);
    queueMicrotask(() => applyMediaType(node));
    start();
  },
  afterConfigureGraph() {
    applyAll();
    queueMicrotask(applyAll);
    start();
  },
});
