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

  // Prefer the resolver's authoritative checks first. These understand nested
  // subgraph boundaries and the TerryXu BUS type.
  try {
    if (h3IsBusLinkInfo(node, linkInfo)) return true;
    if (h3IsSubgraphInputLinkInfo(node, linkInfo)) return true;
  } catch {}

  // During workflow restore, ComfyUI can deliver onConnectionsChange before
  // linkInfo is fully populated. Resolve the physical graph link as fallback.
  const { source, type } = sourceForConnection(node, inputIndex, linkInfo);
  return type === H3_BUS_TYPE || isSubgraphInputNode(source);
}

function patchH3Class(nodeTypeClass) {
  const proto = nodeTypeClass?.prototype;
  if (!proto || proto.__terryH3BusTransportPatched) return;

  const previous = proto.onConnectionsChange;
  proto.onConnectionsChange = function(type, index, connected, linkInfo) {
    if (!isStructuralMediaConnection(this, index, connected, linkInfo)) {
      return previous?.apply(this, arguments);
    }

    // h3_prompt_editor converts ordinary IMAGE/VIDEO/AUDIO links into its
    // virtual multi-reference representation. BUS and SubgraphInput are
    // structural links and must never enter that conversion path. Reuse the
    // existing __terryClearingLink guard so the original H3 behavior stays
    // untouched for every non-structural media connection.
    const previousClearing = this.__terryClearingLink;
    this.__terryClearingLink = true;
    try {
      return previous?.apply(this, arguments);
    } finally {
      this.__terryClearingLink = previousClearing;
      this.setDirtyCanvas?.(true, true);
      this.graph?.setDirtyCanvas?.(true, true);
    }
  };

  proto.__terryH3BusTransportPatched = true;
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
    // This module is intentionally loaded after h3_prompt_editor.js, so its
    // guard becomes the outermost connection policy. queueMicrotask also makes
    // the ordering resilient if ComfyUI changes extension registration order.
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
