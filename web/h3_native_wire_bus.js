import { app } from "../../scripts/app.js";
import {
  H3_BUS_TYPE,
  h3BusSignature,
  h3CollectBusMedia,
  h3IsBusLinkInfo,
  h3MediaInputIndex,
  h3MediaKind,
  h3NodeType,
  h3ResolveNativeBus,
} from "./h3_bus_resolver.js";

const TARGETS = {
  TerryXuH3PromptEditor: "terry_h3_virtual_media_links",
  TerryXuH3ShotTimeline: "terry_h3_timeline_virtual_media_links",
};

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

  // This runs at node-definition registration time, before any graph is restored.
  // The legacy H3 handler turns every media connection into a virtual reference
  // and then disconnects the real socket. BUS is different: it must remain a
  // native visual connection and only be read internally by the H3 resolver.
  const legacyConnections = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function(type, index, connected, linkInfo) {
    if (isBusConnection(this, index, connected, linkInfo)) {
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
      // The legacy H3 canvas renderer must only see truly direct references.
      // BUS members are data references, not visual links.
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
    const busConnected = isMedia && connected && (h3IsBusLinkInfo(this, linkInfo) || Boolean(h3ResolveNativeBus(this)));
    if (busConnected) {
      this.__terryProtectBusUntil = performance.now() + 5000;
    }
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
  for (const node of app.graph?._nodes || []) installReferenceView(node);
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

let timer = null;
function start() {
  patchAll();
  patchCanvas();
  if (timer) return;
  timer = setInterval(() => {
    patchAll();
    patchCanvas();
    for (const node of app.graph?._nodes || []) {
      const prop = TARGETS[h3NodeType(node)];
      if (!prop || !node.__terryNativeBus) continue;
      const signature = h3BusSignature(node);
      if (node.__terryNativeBusSignature !== signature) {
        node.__terryNativeBusSignature = signature;
        refreshNode(node);
      }
    }
  }, 300);
}

app.registerExtension({
  name: "TerryXu.H3NativeWireBus",
  setup() {
    start();
    queueMicrotask(() => { patchAll(); patchCanvas(); });
    setTimeout(() => { patchAll(); patchCanvas(); }, 0);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    installTypeGuard(nodeType, nodeData);
  },
  nodeCreated(node) {
    queueMicrotask(() => installReferenceView(node));
  },
  loadedGraphNode(node) {
    queueMicrotask(() => installReferenceView(node));
  },
  afterConfigureGraph() {
    queueMicrotask(() => { patchAll(); patchCanvas(); });
  },
});