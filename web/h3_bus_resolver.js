import { app } from "../../scripts/app.js";

export const H3_BUS_TYPE = "TERRY_WIRE_BUS";
export const H3_BUS_PACK_TYPE = "TerryXuWirelessBusPack";
export const H3_WIRED_BUS_PACK_TYPE = "TerryXuWireBusPack";
export const H3_WIRELESS_BUS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
export const H3_WIRED_BUS_UNPACK_TYPE = "TerryXuWireBusUnpack";
export const H3_MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO"]);

const H3_BUS_PACK_TYPES = new Set([H3_BUS_PACK_TYPE, H3_WIRED_BUS_PACK_TYPE]);
const H3_BUS_UNPACK_TYPES = new Set([H3_WIRELESS_BUS_UNPACK_TYPE, H3_WIRED_BUS_UNPACK_TYPE]);

export function h3NodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      node?.constructor?.nodeData?.name ||
      ""
  );
}

function h3RootGraph(graph = app.graph) {
  return graph?.rootGraph || app.graph?.rootGraph || app.graph || graph || null;
}

export function h3AllGraphs(root = h3RootGraph()) {
  if (!root) return [];
  const result = [];
  const seen = new Set();
  const queue = [root];
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
      for (const value of values) {
        const subgraph = value?.subgraph || value;
        if (subgraph && !seen.has(subgraph)) queue.push(subgraph);
      }
    }
  }
  return result;
}

export function h3IsSubgraphNode(node) {
  if (!node) return false;
  try {
    if (node.isSubgraphNode?.()) return true;
  } catch {}
  return Boolean(node.subgraph?.inputNode);
}

function h3SubgraphInstances(subgraph) {
  if (!subgraph) return [];
  const root = h3RootGraph(subgraph);
  const result = [];
  for (const graph of h3AllGraphs(root)) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (node?.subgraph === subgraph) result.push(node);
    }
  }
  return result;
}

export function h3GetGraphLink(graph, id) {
  if (!graph || id == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const hit = links.get(id) ?? links.get(String(id));
      if (hit) return hit;
    }
    const hit = links[id] ?? links[String(id)];
    if (hit) return hit;
  }
  return null;
}

export function h3GetNode(graph, id) {
  return graph?.getNodeById?.(id) || app.graph?.getNodeById?.(id) || null;
}

export function h3IsReroute(node) {
  const type = h3NodeType(node).toLowerCase();
  return type === "reroute" || type.endsWith("reroute");
}

export function h3IsGetNode(node) {
  return h3NodeType(node) === "GetNode";
}

export function h3IsSetNode(node) {
  return h3NodeType(node) === "SetNode";
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

export function h3FindSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  const localGraph = getNode?.graph || app.graph;
  for (const node of localGraph?._nodes || []) {
    if (h3IsSetNode(node) && variableName(node) === name) return node;
  }
  if (localGraph !== app.graph) {
    for (const node of app.graph?._nodes || []) {
      if (h3IsSetNode(node) && variableName(node) === name) return node;
    }
  }
  return null;
}

function h3SubgraphInputSlot(graph, index) {
  return graph?.inputNode?.slots?.[Number(index) || 0]
    || graph?.inputs?.[Number(index) || 0]
    || null;
}

function h3WrapperInputIndex(instance, subgraphSlot, fallbackIndex) {
  const inputs = instance?.inputs || [];
  let index = inputs.findIndex((input) =>
    input?._subgraphSlot === subgraphSlot
    || (
      input?._subgraphSlot?.id != null
      && subgraphSlot?.id != null
      && String(input._subgraphSlot.id) === String(subgraphSlot.id)
    )
  );
  if (index < 0 && subgraphSlot?.name) {
    index = inputs.findIndex((input) => String(input?.name || "") === String(subgraphSlot.name));
  }
  if (index < 0 && Number(fallbackIndex) < inputs.length) index = Number(fallbackIndex) || 0;
  return index;
}

function h3IsSubgraphInputOrigin(graph, id) {
  return Boolean(graph?.inputNode && String(graph.inputNode.id) === String(id));
}

function h3ResolveSubgraphInputUpstream(graph, slot, seen) {
  const subgraphSlot = h3SubgraphInputSlot(graph, slot);
  if (!subgraphSlot) return null;

  for (const instance of h3SubgraphInstances(graph)) {
    const inputIndex = h3WrapperInputIndex(instance, subgraphSlot, slot);
    const input = inputIndex >= 0 ? instance.inputs?.[inputIndex] : null;
    if (!input || input.link == null || !instance.graph) continue;
    const source = h3ResolveUpstream(instance.graph, input.link, seen);
    if (source) return source;
  }
  return null;
}

function h3ResolveSubgraphOutput(node, slot, seen) {
  if (!h3IsSubgraphNode(node)) return null;
  try {
    const resolved = node.resolveSubgraphOutputLink?.(Number(slot) || 0);
    const innerNode = resolved?.outputNode;
    const link = resolved?.link;
    if (!innerNode) return null;
    if (link?.id != null) return h3ResolveUpstream(node.subgraph, link.id, seen);

    const innerSlot = Number(
      resolved?.outputSlotIndex
      ?? resolved?.output_slot
      ?? resolved?.outputSlot
      ?? 0
    ) || 0;
    const outputType = String(innerNode.outputs?.[innerSlot]?.type || "*").toUpperCase();
    return {
      node: innerNode,
      nodeId: Number(innerNode.id),
      slot: innerSlot,
      type: outputType,
    };
  } catch {
    return null;
  }
}

export function h3ResolveUpstream(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${String(graph?.id || "g")}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = h3GetGraphLink(graph, linkId);
  if (!link) return null;
  const id = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  const slot = Number(link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? 0) || 0;

  if (h3IsSubgraphInputOrigin(graph, id)) {
    return h3ResolveSubgraphInputUpstream(graph, slot, seen);
  }

  const node = h3GetNode(graph, id);
  if (!node) return null;

  if (h3IsReroute(node)) {
    return h3ResolveUpstream(node.graph || graph, node.inputs?.[0]?.link, seen);
  }
  if (h3IsGetNode(node)) {
    const setter = h3FindSetter(node);
    if (setter?.inputs?.[0]?.link != null) {
      return h3ResolveUpstream(setter.graph || graph, setter.inputs[0].link, seen);
    }
  }
  if (h3IsSubgraphNode(node)) {
    const source = h3ResolveSubgraphOutput(node, slot, seen);
    if (source) return source;
  }

  if (H3_BUS_UNPACK_TYPES.has(h3NodeType(node))) {
    const outputType = String(node.outputs?.[slot]?.type || link.type || "*").toUpperCase();
    try {
      const resolved = node.resolveVirtualOutput?.(slot);
      if (resolved?.node) {
        const resolvedSlot = Number(resolved.slot) || 0;
        return {
          node: resolved.node,
          nodeId: Number(resolved.node.id),
          slot: resolvedSlot,
          type: String(resolved.node.outputs?.[resolvedSlot]?.type || outputType || "*").toUpperCase(),
        };
      }
    } catch {}

    if (outputType === H3_BUS_TYPE && node.inputs?.[0]?.link != null) {
      const upstream = h3ResolveUpstream(node.graph || graph, node.inputs[0].link, seen);
      if (upstream) return upstream;
    }
  }

  return {
    node,
    nodeId: Number(node.id),
    slot,
    type: String(link.type || node.outputs?.[slot]?.type || "*").toUpperCase(),
  };
}

export function h3MediaKind(type) {
  const value = String(type || "").toUpperCase();
  if (value.includes("VIDEO")) return "video";
  if (value.includes("AUDIO")) return "audio";
  return "picture";
}

export function h3MediaInputIndex(node) {
  return node?.inputs?.findIndex?.((input) => String(input?.name || "") === "media") ?? -1;
}

export function h3ResolveNativeBus(node) {
  const index = h3MediaInputIndex(node);
  const input = node?.inputs?.[index];
  if (!input || input.link == null) return null;
  const source = h3ResolveUpstream(node.graph || app.graph, input.link);
  if (!source) return null;
  if (!H3_BUS_PACK_TYPES.has(h3NodeType(source.node)) && source.type !== H3_BUS_TYPE) return null;
  return { pack: source.node, source };
}

export function h3IsSubgraphInputLinkInfo(node, linkInfo) {
  if (!linkInfo) return false;
  const inputIndex = h3MediaInputIndex(node);
  if (inputIndex < 0) return false;
  const graph = node?.graph;
  if (!graph?.inputNode) return false;
  const originId = linkInfo.origin_id ?? linkInfo.originId ?? linkInfo.from_id ?? linkInfo.fromId;
  const originNode = linkInfo.origin_node ?? linkInfo.originNode ?? linkInfo.fromNode;
  return originNode === graph.inputNode || String(originId) === String(graph.inputNode.id);
}

// Nodes 2.0 can emit onConnectionsChange before the new link is visible in graph.links.
// This helper therefore accepts the event payload directly as a second path.
export function h3IsBusLinkInfo(node, linkInfo) {
  if (!linkInfo) return false;
  const directType = String(
    linkInfo.type ?? linkInfo.dataType ?? linkInfo.output_type ?? linkInfo.outputType ?? ""
  ).toUpperCase();
  if (directType === H3_BUS_TYPE) return true;

  const graph = node?.graph || app.graph;
  const originId = linkInfo.origin_id ?? linkInfo.originId ?? linkInfo.from_id ?? linkInfo.fromId;
  const originSlot = Number(linkInfo.origin_slot ?? linkInfo.originSlot ?? linkInfo.from_slot ?? linkInfo.fromSlot ?? 0) || 0;

  if (h3IsSubgraphInputOrigin(graph, originId)) {
    const resolved = h3ResolveSubgraphInputUpstream(graph, originSlot, new Set());
    return Boolean(resolved && (resolved.type === H3_BUS_TYPE || H3_BUS_PACK_TYPES.has(h3NodeType(resolved.node))));
  }

  const originNode = linkInfo.origin_node ?? linkInfo.originNode ?? linkInfo.fromNode ?? h3GetNode(graph, originId);
  if (!originNode) return false;
  const originType = String(originNode.outputs?.[originSlot]?.type || directType || "").toUpperCase();
  if (originType === H3_BUS_TYPE || H3_BUS_PACK_TYPES.has(h3NodeType(originNode))) return true;

  if (h3IsSubgraphNode(originNode)) {
    const resolved = h3ResolveSubgraphOutput(originNode, originSlot, new Set());
    if (resolved && (resolved.type === H3_BUS_TYPE || H3_BUS_PACK_TYPES.has(h3NodeType(resolved.node)))) return true;
  }
  if (h3IsReroute(originNode) && originNode.inputs?.[0]?.link != null) {
    const resolved = h3ResolveUpstream(originNode.graph || graph, originNode.inputs[0].link);
    if (resolved && (resolved.type === H3_BUS_TYPE || H3_BUS_PACK_TYPES.has(h3NodeType(resolved.node)))) return true;
  }
  if (h3IsGetNode(originNode)) {
    const setter = h3FindSetter(originNode);
    if (setter?.inputs?.[0]?.link != null) {
      const resolved = h3ResolveUpstream(setter.graph || graph, setter.inputs[0].link);
      if (resolved && (resolved.type === H3_BUS_TYPE || H3_BUS_PACK_TYPES.has(h3NodeType(resolved.node)))) return true;
    }
  }
  return false;
}

function collectPackMedia(pack, result, seenMedia, seenPacks) {
  if (!pack?.graph) return;
  const packKey = `${h3NodeType(pack)}:${String(pack.id)}`;
  if (seenPacks.has(packKey)) return;
  seenPacks.add(packKey);

  for (const input of pack.inputs || []) {
    if (input?.link == null) continue;
    const source = h3ResolveUpstream(pack.graph, input.link);
    if (!source) continue;
    const type = String(source.type || source.node?.outputs?.[source.slot]?.type || "*").toUpperCase();

    if (H3_MEDIA_TYPES.has(type)) {
      const key = `${source.nodeId}:${source.slot}`;
      if (seenMedia.has(key)) continue;
      seenMedia.add(key);
      result.push({
        source_id: Number(source.nodeId),
        source_slot: Number(source.slot) || 0,
        source_type: type,
        kind: h3MediaKind(type),
      });
      continue;
    }

    if (type === H3_BUS_TYPE && H3_BUS_PACK_TYPES.has(h3NodeType(source.node))) {
      collectPackMedia(source.node, result, seenMedia, seenPacks);
    }
  }
}

export function h3CollectBusMedia(node) {
  const resolvedBus = h3ResolveNativeBus(node);
  const pack = resolvedBus?.pack;
  if (!pack?.graph) return [];

  const result = [];
  collectPackMedia(pack, result, new Set(), new Set());
  return result;
}

export function h3BusSignature(node) {
  return h3CollectBusMedia(node)
    .map((item) => `${item.source_id}:${item.source_slot}:${item.source_type}`)
    .join("|");
}

function h3GraphForInstancePath(path) {
  let graph = h3RootGraph();
  if (!graph) return null;
  for (const id of path || []) {
    const node = graph.getNodeById?.(id) || graph.getNodeById?.(Number(id));
    if (!h3IsSubgraphNode(node)) return null;
    graph = node.subgraph;
  }
  return graph;
}

function h3ExecutionId(path, nodeId) {
  return [...(path || []), String(nodeId)].join(":");
}

function h3ResolveSubgraphInputForExecution(graph, slot, path, seen) {
  if (!path?.length) return null;
  const parentPath = path.slice(0, -1);
  const parentGraph = h3GraphForInstancePath(parentPath);
  if (!parentGraph) return null;
  const wrapperId = path[path.length - 1];
  const instance = parentGraph.getNodeById?.(wrapperId) || parentGraph.getNodeById?.(Number(wrapperId));
  if (!instance || instance.subgraph !== graph) return null;

  const subgraphSlot = h3SubgraphInputSlot(graph, slot);
  const inputIndex = h3WrapperInputIndex(instance, subgraphSlot, slot);
  const input = inputIndex >= 0 ? instance.inputs?.[inputIndex] : null;
  if (!input || input.link == null) return null;
  return h3ResolveUpstreamForExecution(parentGraph, input.link, parentPath, seen);
}

function h3ResolveSubgraphOutputForExecution(node, slot, path, seen) {
  if (!h3IsSubgraphNode(node)) return null;
  try {
    const resolved = node.resolveSubgraphOutputLink?.(Number(slot) || 0);
    const link = resolved?.link;
    if (link?.id == null) return null;
    return h3ResolveUpstreamForExecution(node.subgraph, link.id, [...path, String(node.id)], seen);
  } catch {
    return null;
  }
}

function h3ResolveUpstreamForExecution(graph, linkId, path, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `exec:${path.join(":")}:${String(graph?.id || "g")}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = h3GetGraphLink(graph, linkId);
  if (!link) return null;
  const id = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  const slot = Number(link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? 0) || 0;

  if (h3IsSubgraphInputOrigin(graph, id)) {
    return h3ResolveSubgraphInputForExecution(graph, slot, path, seen);
  }

  const node = h3GetNode(graph, id);
  if (!node) return null;

  if (h3IsReroute(node)) {
    return h3ResolveUpstreamForExecution(node.graph || graph, node.inputs?.[0]?.link, path, seen);
  }
  if (h3IsGetNode(node)) {
    const setter = h3FindSetter(node);
    if (setter?.inputs?.[0]?.link != null) {
      const setterPath = setter.graph === graph ? path : [];
      return h3ResolveUpstreamForExecution(setter.graph || graph, setter.inputs[0].link, setterPath, seen);
    }
  }
  if (h3IsSubgraphNode(node)) {
    const resolved = h3ResolveSubgraphOutputForExecution(node, slot, path, seen);
    if (resolved) return resolved;
  }

  if (H3_BUS_UNPACK_TYPES.has(h3NodeType(node))) {
    const outputType = String(node.outputs?.[slot]?.type || link.type || "*").toUpperCase();
    try {
      const resolved = node.resolveVirtualOutput?.(slot);
      if (resolved?.node) {
        const resolvedSlot = Number(resolved.slot) || 0;
        return {
          node: resolved.node,
          nodeId: Number(resolved.node.id),
          slot: resolvedSlot,
          type: String(resolved.node.outputs?.[resolvedSlot]?.type || outputType || "*").toUpperCase(),
          path: [...path],
          execution_id: h3ExecutionId(path, resolved.node.id),
        };
      }
    } catch {}

    if (outputType === H3_BUS_TYPE && node.inputs?.[0]?.link != null) {
      const upstream = h3ResolveUpstreamForExecution(node.graph || graph, node.inputs[0].link, path, seen);
      if (upstream) return upstream;
    }
  }

  return {
    node,
    nodeId: Number(node.id),
    slot,
    type: String(link.type || node.outputs?.[slot]?.type || "*").toUpperCase(),
    path: [...path],
    execution_id: h3ExecutionId(path, node.id),
  };
}

function collectPackMediaForExecution(pack, path, result, seenMedia, seenPacks) {
  if (!pack?.graph) return;
  const packKey = `${path.join(":")}:${h3NodeType(pack)}:${String(pack.id)}`;
  if (seenPacks.has(packKey)) return;
  seenPacks.add(packKey);

  for (const input of pack.inputs || []) {
    if (input?.link == null) continue;
    const source = h3ResolveUpstreamForExecution(pack.graph, input.link, path, new Set());
    if (!source) continue;
    const type = String(source.type || source.node?.outputs?.[source.slot]?.type || "*").toUpperCase();

    if (H3_MEDIA_TYPES.has(type)) {
      const executionId = String(source.execution_id || h3ExecutionId(source.path || path, source.nodeId));
      const key = `${executionId}:${source.slot}`;
      if (seenMedia.has(key)) continue;
      seenMedia.add(key);
      result.push({
        source_id: Number(source.nodeId),
        source_slot: Number(source.slot) || 0,
        source_type: type,
        kind: h3MediaKind(type),
        source_execution_id: executionId,
      });
      continue;
    }

    if (type === H3_BUS_TYPE && H3_BUS_PACK_TYPES.has(h3NodeType(source.node))) {
      collectPackMediaForExecution(source.node, source.path || path, result, seenMedia, seenPacks);
    }
  }
}

export function h3CollectBusMediaForExecution(node, executionId) {
  const parts = String(executionId || "").split(":").filter(Boolean);
  const path = parts.length > 1 ? parts.slice(0, -1) : [];
  const mediaIndex = h3MediaInputIndex(node);
  const input = node?.inputs?.[mediaIndex];
  if (!input || input.link == null) return [];

  const source = h3ResolveUpstreamForExecution(node.graph || app.graph, input.link, path, new Set());
  if (!source) return [];
  if (!H3_BUS_PACK_TYPES.has(h3NodeType(source.node)) && source.type !== H3_BUS_TYPE) return [];

  const pack = source.node;
  if (!H3_BUS_PACK_TYPES.has(h3NodeType(pack)) || !pack?.graph) return [];

  const result = [];
  collectPackMediaForExecution(pack, source.path || path, result, new Set(), new Set());
  return result;
}
