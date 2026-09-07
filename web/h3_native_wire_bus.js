import { app } from "../../scripts/app.js";
import {
  H3_BUS_TYPE,
  h3AllGraphs,
  h3BusSignature,
  h3CollectBusMedia,
  h3CollectBusMediaForExecution,
  h3IsBusLinkInfo,
  h3IsSubgraphInputLinkInfo,
  h3IsSubgraphNode,
  h3MediaInputIndex,
  h3MediaKind,
  h3NodeType,
  h3ResolveNativeBus,
} from "./h3_bus_resolver.js";

const TARGETS = {
  TerryXuH3PromptEditor: "terry_h3_virtual_media_links",
  TerryXuH3ShotTimeline: "terry_h3_timeline_virtual_media_links",
};

const BUS_SOURCE_TYPES = new Set([
  "TerryXuWireBusPack",
  "TerryXuWirelessBusPack",
  "TerryXuWireBusUnpack",
  "TerryXuWirelessBusUnpack",
]);

function cloneLink(link) {
  return {
    source_id: Number(link?.source_id),
    source_slot: Number(link?.source_slot) || 0,
    source_type: String(link?.source_type || "*"),
    kind: link?.kind || h3MediaKind(link?.source_type),
  };
}

function uniqueLinks(links) {
  const result = [];
  const seen = new Set();
  for (const link of links || []) {
    const id = Number(link?.source_id);
    const slot = Number(link?.source_slot) || 0;
    if (!Number.isFinite(id)) continue;
    const key = `${id}:${slot}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cloneLink(link));
  }
  return result;
}

function refreshNode(node) {
  node.__terryH3?.connectionChanged?.();
  node.__terryH3Editor?.refresh?.();
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function isH3MediaInput(node, input) {
  if (!TARGETS[h3NodeType(node)]) return false;
  if (String(input?.name || "") === "media") return true;
  return Boolean(node?.inputs?.some?.((slot) => String(slot?.name || "") === "media"));
}

function subgraphInputSlot(node, input) {
  if (!h3IsSubgraphNode(node) || !node?.subgraph?.inputNode) return null;
  const slots = node.subgraph.inputNode.slots || node.subgraph.inputs || [];
  if (input?._subgraphSlot) {
    const exact = slots.find((slot) =>
      slot === input._subgraphSlot
      || (
        slot?.id != null
        && input._subgraphSlot?.id != null
        && String(slot.id) === String(input._subgraphSlot.id)
      )
    );
    if (exact) return exact;
  }
  const inputIndex = node.inputs?.indexOf?.(input) ?? -1;
  if (inputIndex >= 0 && slots[inputIndex]) return slots[inputIndex];
  const name = String(input?.name || input?.label || "");
  return slots.find((slot) => String(slot?.name || "") === name) || null;
}

function subgraphInputTargets(node, input) {
  const slot = subgraphInputSlot(node, input);
  const graph = node?.subgraph;
  if (!slot || !graph) return [];

  const result = [];
  for (const linkId of slot.linkIds || []) {
    const link = graph.getLink?.(linkId)
      || graph.links?.get?.(linkId)
      || graph._links?.get?.(linkId)
      || graph.links?.[linkId]
      || graph._links?.[linkId];
    if (!link) continue;

    let targetNode = null;
    let targetInput = null;
    try {
      const resolved = link.resolve?.(graph);
      targetNode = resolved?.inputNode || null;
      targetInput = resolved?.input || null;
    } catch {}

    if (!targetNode) {
      const targetId = link.target_id ?? link.targetId;
      const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
      targetNode = graph.getNodeById?.(targetId) || null;
      targetInput = targetNode?.inputs?.[targetSlot] || null;
    }
    if (targetNode && targetInput) result.push({ node: targetNode, input: targetInput });
  }
  return result;
}

function subgraphInputLeadsToH3(node, input, seen = new Set()) {
  if (isH3MediaInput(node, input)) return true;
  if (!h3IsSubgraphNode(node)) return false;

  const slot = subgraphInputSlot(node, input);
  const key = `${String(node?.subgraph?.id || node?.id || "subgraph")}:${String(slot?.id || slot?.name || "input")}`;
  if (seen.has(key)) return false;
  seen.add(key);

  return subgraphInputTargets(node, input)
    .some((target) => subgraphInputLeadsToH3(target.node, target.input, seen));
}

function patchBusSourceClass(nodeTypeClass) {
  const proto = nodeTypeClass?.prototype;
  if (!proto || proto.__terryH3SubgraphBusOutput) return;
  const original = proto.onConnectOutput;
  if (typeof original !== "function") return;

  const wrapped = function(slot, type, input, targetNode) {
    const originalResult = original.apply(this, arguments);
    if (originalResult !== false) return originalResult;

    const outputType = String(this.outputs?.[Number(slot) || 0]?.type || type || "").toUpperCase();
    if (outputType !== H3_BUS_TYPE) return originalResult;
    return subgraphInputLeadsToH3(targetNode, input) ? true : originalResult;
  };
  wrapped.__terryH3SubgraphBusOutput = true;
  proto.onConnectOutput = wrapped;
  proto.__terryH3SubgraphBusOutput = true;
}

function patchRegisteredBusSources() {
  const registered = globalThis.LiteGraph?.registered_node_types || {};
  for (const type of BUS_SOURCE_TYPES) {
    const cls = registered[type];
    if (cls) patchBusSourceClass(cls);
  }
}

function isPreservedBoundaryConnection(node, index, connected, linkInfo) {
  if (!connected) return false;
  const input = node?.inputs?.[Number(index)];
  if (String(input?.name || "") !== "media") return false;
  return h3IsBusLinkInfo(node, linkInfo) || h3IsSubgraphInputLinkInfo(node, linkInfo);
}

function isBusConnection(node, index, connected, linkInfo) {
  if (!connected) return false;
  const input = node?.inputs?.[Number(index)];
  if (String(input?.name || "") !== "media") return false;
  if (h3IsBusLinkInfo(node, linkInfo)) return true;

  const originId = linkInfo?.origin_id ?? linkInfo?.originId ?? linkInfo?.from_id ?? linkInfo?.fromId;
  const originSlot = Number(linkInfo?.origin_slot ?? linkInfo?.originSlot ?? linkInfo?.from_slot ?? linkInfo?.fromSlot ?? 0) || 0;
  const graph = node?.graph || app.graph;
  const origin = linkInfo?.origin_node ?? linkInfo?.originNode ?? linkInfo?.fromNode ?? graph?.getNodeById?.(Number(originId));
  const originType = String(origin?.outputs?.[originSlot]?.type || linkInfo?.type || "").toUpperCase();
  return originType === H3_BUS_TYPE;
}

function installTypeGuard(nodeType, nodeData) {
  if (!TARGETS[String(nodeData?.name || "")] || nodeType.prototype.__terryNativeBusTypeGuard) return;
  nodeType.prototype.__terryNativeBusTypeGuard = true;

  // Direct references are virtualized by the legacy H3 editor. A BUS or a
  // SubgraphInput boundary must remain a real link so ComfyUI can preserve the
  // subgraph topology and the BUS resolver can walk through it.
  const legacyConnections = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function(type, index, connected, linkInfo) {
    if (isPreservedBoundaryConnection(this, index, connected, linkInfo)) {
      this.__terryProtectBusUntil = performance.now() + 5000;
      queueMicrotask(() => {
        installReferenceView(this);
        refreshNode(this);
      });
      return;
    }
    return legacyConnections?.apply(this, arguments);
  };
}

function installReferenceView(node) {
  const prop = TARGETS[h3NodeType(node)];
  if (!prop || node.__terryNativeBusInstalled) return;
  node.__terryNativeBusInstalled = true;
  node.properties ||= {};
  delete node.properties.terry_h3_wire_bus_visual_state;

  const initial = Array.isArray(node.properties[prop]) ? node.properties[prop].map(cloneLink) : [];
  const initialBusKeys = new Set(h3CollectBusMedia(node).map((item) => `${item.source_id}:${item.source_slot}`));
  const state = {
    direct: uniqueLinks(initial).filter((link) => {
      if (String(link?.source_type || "").toUpperCase() === H3_BUS_TYPE) return false;
      return !initialBusKeys.has(`${Number(link?.source_id)}:${Number(link?.source_slot) || 0}`);
    }),
  };

  const busKeys = () => new Set(h3CollectBusMedia(node).map((item) => `${item.source_id}:${item.source_slot}`));

  Object.defineProperty(node.properties, prop, {
    configurable: true,
    enumerable: true,
    get() {
      if (globalThis.__terryH3NativeBusDrawing) return state.direct.map(cloneLink);
      return uniqueLinks([...state.direct, ...h3CollectBusMedia(node)]);
    },
    set(value) {
      const bus = busKeys();
      state.direct = uniqueLinks(Array.isArray(value) ? value : []).filter((link) => {
        if (String(link?.source_type || "").toUpperCase() === H3_BUS_TYPE) return false;
        return !bus.has(`${Number(link?.source_id)}:${Number(link?.source_slot) || 0}`);
      });
    },
  });

  const originalDisconnect = node.disconnectInput;
  if (typeof originalDisconnect === "function") {
    node.disconnectInput = function(index) {
      const mediaIndex = h3MediaInputIndex(this);
      if (index === mediaIndex && performance.now() < Number(this.__terryProtectBusUntil || 0)) {
        return;
      }
      return originalDisconnect.apply(this, arguments);
    };
  }

  const originalConnections = node.onConnectionsChange;
  node.onConnectionsChange = function(type, index, connected, linkInfo) {
    const input = this.inputs?.[index];
    const isMedia = String(input?.name || "") === "media";
    const preserved = isMedia && connected && (
      isPreservedBoundaryConnection(this, index, connected, linkInfo)
      || Boolean(h3ResolveNativeBus(this))
    );
    if (preserved) this.__terryProtectBusUntil = performance.now() + 5000;
    const result = originalConnections?.apply(this, arguments);
    if (isMedia) queueMicrotask(() => refreshNode(this));
    return result;
  };

  node.__terryNativeBus = {
    getDirectLinks: () => state.direct.map(cloneLink),
    setDirectLinks: (links) => {
      state.direct = uniqueLinks(links);
      refreshNode(node);
      node.graph?.change?.();
    },
    getBusMedia: () => h3CollectBusMedia(node),
    hasBus: () => Boolean(h3ResolveNativeBus(node)),
    disconnectBus: () => {
      const index = h3MediaInputIndex(node);
      if (index < 0 || node.inputs?.[index]?.link == null) return false;
      node.__terryProtectBusUntil = 0;
      originalDisconnect?.call(node, index);
      refreshNode(node);
      node.graph?.change?.();
      return true;
    },
  };
}

function patchAll() {
  for (const graph of h3AllGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) installReferenceView(node);
  }
  patchRegisteredBusSources();
}

function patchCanvas() {
  const canvas = app.canvas;
  if (!canvas || typeof canvas.drawConnections !== "function") return;
  const current = canvas.drawConnections;
  if (current.__terryNativeBusDrawGuard) return;

  function guardedDrawConnections() {
    globalThis.__terryH3NativeBusDrawing = (globalThis.__terryH3NativeBusDrawing || 0) + 1;
    try {
      return current.apply(this, arguments);
    } finally {
      globalThis.__terryH3NativeBusDrawing = Math.max(
        0,
        Number(globalThis.__terryH3NativeBusDrawing || 1) - 1
      );
    }
  }
  guardedDrawConnections.__terryNativeBusDrawGuard = true;
  canvas.drawConnections = guardedDrawConnections;
}

function matchingExecutionIds(output, node) {
  const localId = String(node?.id ?? "");
  const type = h3NodeType(node);
  if (!localId || !type) return [];
  return Object.keys(output || {}).filter((id) => {
    if (!id.includes(":")) return false;
    if (!(id === localId || id.endsWith(`:${localId}`))) return false;
    return String(output[id]?.class_type || "") === type;
  });
}

function patchGraphToPrompt() {
  if (app.__terryH3SubgraphBusPromptPatched || typeof app.graphToPrompt !== "function") return;
  app.__terryH3SubgraphBusPromptPatched = true;
  const previous = app.graphToPrompt;

  app.graphToPrompt = async function() {
    const data = await previous.apply(this, arguments);
    const output = data?.output;
    if (!output) return data;

    try {
      const root = this.graph?.rootGraph || app.graph?.rootGraph || app.graph;
      for (const graph of h3AllGraphs(root)) {
        if (graph === root) continue;
        for (const node of graph?._nodes || graph?.nodes || []) {
          if (!TARGETS[h3NodeType(node)]) continue;

          for (const executionId of matchingExecutionIds(output, node)) {
            const busMedia = h3CollectBusMediaForExecution(node, executionId);
            if (!busMedia.length) continue;

            const dst = output[executionId];
            if (!dst) continue;
            dst.inputs ||= {};
            delete dst.inputs.media;

            const existing = Object.entries(dst.inputs)
              .filter(([name, value]) => /^asset\d+$/i.test(name) && Array.isArray(value))
              .sort((a, b) => Number(a[0].replace(/\D/g, "")) - Number(b[0].replace(/\D/g, "")))
              .map(([, value]) => value);
            for (const key of Object.keys(dst.inputs)) {
              if (/^asset\d+$/i.test(key)) delete dst.inputs[key];
            }

            const assets = [];
            const seen = new Set();
            for (const value of existing) {
              const key = `${String(value?.[0] ?? "")}:${Number(value?.[1]) || 0}`;
              if (!value?.[0] || seen.has(key)) continue;
              seen.add(key);
              assets.push([String(value[0]), Number(value[1]) || 0]);
            }
            for (const item of busMedia) {
              const sourceId = String(item?.source_execution_id || "");
              const sourceSlot = Number(item?.source_slot) || 0;
              const key = `${sourceId}:${sourceSlot}`;
              if (!sourceId || !output[sourceId] || seen.has(key)) continue;
              seen.add(key);
              assets.push([sourceId, sourceSlot]);
            }

            assets.forEach((value, index) => {
              dst.inputs[`asset${index + 1}`] = value;
            });
          }
        }
      }
    } catch (error) {
      console.warn("[TerryXu H3] Failed to expand BUS through subgraph boundary", error);
    }
    return data;
  };
}

let timer = null;
function start() {
  patchAll();
  patchCanvas();
  patchGraphToPrompt();
  if (timer) return;
  timer = setInterval(() => {
    patchAll();
    patchCanvas();
    patchGraphToPrompt();
    for (const graph of h3AllGraphs()) {
      for (const node of graph?._nodes || graph?.nodes || []) {
        const prop = TARGETS[h3NodeType(node)];
        if (!prop || !node.__terryNativeBus) continue;
        const signature = h3BusSignature(node);
        if (node.__terryNativeBusSignature !== signature) {
          node.__terryNativeBusSignature = signature;
          refreshNode(node);
        }
      }
    }
  }, 300);
}

app.registerExtension({
  name: "TerryXu.H3NativeWireBus",
  setup() {
    start();
    queueMicrotask(() => { patchAll(); patchCanvas(); patchGraphToPrompt(); });
    setTimeout(() => { patchAll(); patchCanvas(); patchGraphToPrompt(); }, 0);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    installTypeGuard(nodeType, nodeData);
    if (BUS_SOURCE_TYPES.has(String(nodeData?.name || ""))) {
      // WireBus installs its normal connection policy in another extension.
      // Defer our H3/subgraph extension so it wraps the final policy instead
      // of competing with it.
      queueMicrotask(() => patchBusSourceClass(nodeType));
    }
  },
  nodeCreated(node) {
    queueMicrotask(() => {
      installReferenceView(node);
      if (BUS_SOURCE_TYPES.has(h3NodeType(node))) patchBusSourceClass(node.constructor);
    });
  },
  loadedGraphNode(node) {
    queueMicrotask(() => {
      installReferenceView(node);
      if (BUS_SOURCE_TYPES.has(h3NodeType(node))) patchBusSourceClass(node.constructor);
    });
  },
  afterConfigureGraph() {
    queueMicrotask(() => { patchAll(); patchCanvas(); patchGraphToPrompt(); });
  },
});
