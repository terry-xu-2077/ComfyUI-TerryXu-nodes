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

export function h3ResolveUpstream(graph, linkId, seen = new Set()) {
  if (!graph || linkId == null) return null;
  const key = `${String(graph?.id || "g")}:${String(linkId)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  const link = h3GetGraphLink(graph, linkId);
  if (!link) return null;
  const id = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  const slot = Number(link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? 0) || 0;
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

    // Wired Bus-Out in BUS passthrough mode can still be resolved directly
    // through its physical BUS input if the output-mode extension has not yet
    // installed resolveVirtualOutput during graph restoration.
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
  const originNode = linkInfo.origin_node ?? linkInfo.originNode ?? linkInfo.fromNode ?? h3GetNode(graph, originId);
  if (!originNode) return false;
  const originType = String(originNode.outputs?.[originSlot]?.type || directType || "").toUpperCase();
  if (originType === H3_BUS_TYPE || H3_BUS_PACK_TYPES.has(h3NodeType(originNode))) return true;

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
