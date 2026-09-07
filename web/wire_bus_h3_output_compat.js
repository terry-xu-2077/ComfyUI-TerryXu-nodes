import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const SOURCE_TYPES = new Set([
  "TerryXuWireBusPack",
  "TerryXuWirelessBusPack",
  "TerryXuWireBusUnpack",
  "TerryXuWirelessBusUnpack",
]);
const PACK_TYPES = new Set([
  "TerryXuWireBusPack",
  "TerryXuWirelessBusPack",
]);
const H3_TYPES = new Set(["TerryXuH3PromptEditor", "TerryXuH3ShotTimeline"]);

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

function isH3MediaTarget(node, input) {
  if (!H3_TYPES.has(nodeType(node))) return false;
  if (String(input?.name || "") === "media") return true;
  return Boolean(node?.inputs?.some?.((slot) => String(slot?.name || "") === "media"));
}

function isBusOutput(node, slot, type) {
  const sourceType = nodeType(node);
  const index = Number(slot) || 0;
  if (PACK_TYPES.has(sourceType)) return index === 0;
  const outputType = String(node?.outputs?.[index]?.type || type || "").toUpperCase();
  return outputType === BUS_TYPE;
}

function patchSourceClass(nodeTypeClass) {
  if (!nodeTypeClass?.prototype || nodeTypeClass.prototype.__terryH3OutputCompat) return;
  const original = nodeTypeClass.prototype.onConnectOutput;
  nodeTypeClass.prototype.__terryH3OutputCompat = true;
  nodeTypeClass.prototype.onConnectOutput = function(slot, type, input, targetNode) {
    if (isBusOutput(this, slot, type) && isH3MediaTarget(targetNode, input)) return true;
    return original ? original.apply(this, arguments) : true;
  };
}

function patchRegisteredSources() {
  const registered = globalThis.LiteGraph?.registered_node_types || {};
  for (const type of SOURCE_TYPES) {
    const cls = registered[type];
    if (cls) patchSourceClass(cls);
  }
}

app.registerExtension({
  name: "TerryXu.WireBusH3OutputCompat",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (!SOURCE_TYPES.has(String(nodeData?.name || ""))) return;
    // Wrap after the base BUS node has installed its own connection rules.
    queueMicrotask(() => patchSourceClass(nodeTypeClass));
  },

  setup() {
    queueMicrotask(patchRegisteredSources);
    setTimeout(patchRegisteredSources, 0);
  },

  nodeCreated(node) {
    if (SOURCE_TYPES.has(nodeType(node))) patchSourceClass(node.constructor);
  },

  loadedGraphNode(node) {
    if (SOURCE_TYPES.has(nodeType(node))) patchSourceClass(node.constructor);
  },
});
