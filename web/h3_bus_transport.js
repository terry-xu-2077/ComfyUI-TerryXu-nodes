import { app } from "../../scripts/app.js";
import {
  H3_BUS_TYPE,
  h3AllGraphs,
  h3IsBusLinkInfo,
  h3IsSubgraphInputLinkInfo,
  h3MediaInputIndex,
  h3NodeType,
} from "./h3_bus_resolver.js";

const H3_TARGETS = new Set([
  "TerryXuH3PromptEditor",
  "TerryXuH3ShotTimeline",
]);

function graphLink(graph, id) {
  if (!graph || id == null) return null;
  return graph.getLink?.(id)
    || graph.links?.get?.(id)
    || graph._links?.get?.(id)
    || graph.links?.[id]
    || graph._links?.[id]
    || null;
}

function isSubgraphInputNode(node) {
  if (!node) return false;
  try {
    if (node.isSubgraphInputNode?.()) return true;
  } catch {}
  const type = String(
    node.comfyClass
      || node.type
      || node.constructor?.type
      || node.constructor?.name
      || ""
  ).toLowerCase();
  return type.includes("subgraphinput") || type.includes("subgraph input");
}

function sourceForConnection(node, inputIndex, linkInfo = null) {
  const graph = node?.graph || app.graph;
  const input = node?.inputs?.[inputIndex];
  const link = linkInfo || graphLink(graph, input?.link);
  if (!link) return { source: null, slot: 0, type: "" };

  const sourceId = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  const slot = Number(
    link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? 0
  ) || 0;
  const source = link.origin_node
    || link.originNode
    || link.fromNode
    || graph?.getNodeById?.(Number(sourceId))
    || null;
  const type = String(
    source?.outputs?.[slot]?.type
      || link.type
      || ""
  ).toUpperCase();

  return { source, slot, type };
}

function isStructuralMediaConnection(node, index, connected, linkInfo = null) {
  if (!connected || !H3_TARGETS.has(h3NodeType(node))) return false;
  const inputIndex = Number(index);
  if (inputIndex !== h3MediaInputIndex(node)) return false;
  if (String(node?.inputs?.[inputIndex]?.name || "") !== "media") return false;

  try {
    if (h3IsBusLinkInfo(node, linkInfo)) return true;
    if (h3IsSubgraphInputLinkInfo(node, linkInfo)) return true;
  } catch {}

  // Workflow restore can fire before linkInfo is fully populated. Resolve the
  // actual physical link as a fallback so BUS cannot be mistaken for media.
  const { source, type } = sourceForConnection(node, inputIndex, linkInfo);
  return type === H3_BUS_TYPE || isSubgraphInputNode(source);
}

function patchH3Class(nodeTypeClass) {
  const proto = nodeTypeClass?.prototype;
  if (!proto) return;

  // Always inspect the current outermost handler. Other TerryXu H3 modules can
  // register before or after this module, so a prototype-level one-shot marker
  // is not sufficient: a later wrapper could otherwise bypass this guard.
  const previous = proto.onConnectionsChange;
  if (previous?.__terryH3BusTransportGuard) return;

  function guardedConnections(type, index, connected, linkInfo) {
    if (!isStructuralMediaConnection(this, index, connected, linkInfo)) {
      return previous?.apply(this, arguments);
    }

    // Ordinary IMAGE/VIDEO/AUDIO references may be virtualized by the H3
    // editor. BUS and SubgraphInput are topology, not assets. Setting the
    // existing clearing flag prevents the legacy editor from scheduling its
    // convert-to-direct-media path while leaving all other behavior intact.
    const previousClearing = this.__terryClearingLink;
    this.__terryClearingLink = true;
    try {
      return previous?.apply(this, arguments);
    } finally {
      this.__terryClearingLink = previousClearing;
      this.setDirtyCanvas?.(true, true);
      this.graph?.setDirtyCanvas?.(true, true);
    }
  }

  guardedConnections.__terryH3BusTransportGuard = true;
  proto.onConnectionsChange = guardedConnections;
}

function patchRegisteredTypes() {
  const registered = globalThis.LiteGraph?.registered_node_types || {};
  for (const type of H3_TARGETS) {
    const cls = registered[type];
    if (cls) patchH3Class(cls);
  }
}

function patchExistingNodes() {
  for (const graph of h3AllGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (H3_TARGETS.has(h3NodeType(node))) patchH3Class(node.constructor);
    }
  }
}

function patchAll() {
  patchRegisteredTypes();
  patchExistingNodes();
}

app.registerExtension({
  name: "TerryXu.H3BusTransport",
  setup() {
    patchAll();
    queueMicrotask(patchAll);
    setTimeout(patchAll, 0);
    setTimeout(patchAll, 100);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (!H3_TARGETS.has(String(nodeData?.name || ""))) return;
    // Re-run after all synchronous beforeRegisterNodeDef hooks for this class,
    // making this the final structural connection policy regardless of module
    // discovery order.
    queueMicrotask(() => patchH3Class(nodeType));
  },
  nodeCreated(node) {
    if (H3_TARGETS.has(h3NodeType(node))) patchH3Class(node.constructor);
  },
  loadedGraphNode(node) {
    if (H3_TARGETS.has(h3NodeType(node))) patchH3Class(node.constructor);
  },
  afterConfigureGraph() {
    patchAll();
    queueMicrotask(patchAll);
  },
});
