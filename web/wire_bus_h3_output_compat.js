import { app } from "../../scripts/app.js";

const PACK_TYPE = "TerryXuWireBusPack";
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

function patchPackClass(nodeTypeClass) {
  if (!nodeTypeClass?.prototype || nodeTypeClass.prototype.__terryH3OutputCompat) return;
  const original = nodeTypeClass.prototype.onConnectOutput;
  nodeTypeClass.prototype.__terryH3OutputCompat = true;
  nodeTypeClass.prototype.onConnectOutput = function(slot, type, input, targetNode) {
    if (slot === 0 && isH3MediaTarget(targetNode, input)) return true;
    return original ? original.apply(this, arguments) : true;
  };
}

function patchRegisteredPack() {
  const cls = globalThis.LiteGraph?.registered_node_types?.[PACK_TYPE];
  if (cls) patchPackClass(cls);
}

app.registerExtension({
  name: "TerryXu.WireBusH3OutputCompat",

  beforeRegisterNodeDef(nodeTypeClass, nodeData) {
    if (nodeData?.name !== PACK_TYPE) return;
    // Run after the other beforeRegisterNodeDef hooks have had a chance to install
    // their restrictions, then wrap the final handler instead of replacing BUS logic.
    queueMicrotask(() => patchPackClass(nodeTypeClass));
  },

  setup() {
    queueMicrotask(patchRegisteredPack);
    setTimeout(patchRegisteredPack, 0);
  },

  nodeCreated(node) {
    if (nodeType(node) === PACK_TYPE) patchPackClass(node.constructor);
  },
});
