import { app } from "../../scripts/app.js";
import { openH3AssetMenuForChip } from "./h3_shared_menus.js";

const NODE_ID = "TerryXuH3PromptEditor";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function isTransportName(name) {
  const value = String(name || "");
  return /^asset\d*$/i.test(value) || value === "assets";
}

function pruneNodeData(nodeData) {
  if (!nodeData) return;
  for (const sectionName of ["required", "optional"]) {
    const section = nodeData.input?.[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const key of Object.keys(section)) if (isTransportName(key)) delete section[key];
  }
  if (Array.isArray(nodeData.inputs)) nodeData.inputs = nodeData.inputs.filter((input) => !isTransportName(input?.name));
  for (const key of ["required", "optional"]) {
    if (Array.isArray(nodeData.input_order?.[key])) {
      nodeData.input_order[key] = nodeData.input_order[key].filter((name) => !isTransportName(name));
    }
  }
}

function removeInputAt(node, index) {
  const input = node?.inputs?.[index];
  if (!input) return;
  try { if (input.link != null) node.disconnectInput?.(index); } catch {}
  if (typeof node.removeInput === "function") node.removeInput(index);
  else node.inputs.splice(index, 1);
}

function pruneInstance(node) {
  if (!node?.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (isTransportName(node.inputs[i]?.name)) removeInputAt(node, i);
  }
  node._widgetSlotsDirty = true;
  node.setDirtyCanvas?.(true, true);
}

function mediaChipType(chip) {
  const raw = String(chip?.dataset?.raw || "");
  if (/^<Picture\s+\d+>$/i.test(raw)) return "picture";
  if (/^<Video\s+\d+>$/i.test(raw)) return "video";
  if (/^<Audio\s+\d+>$/i.test(raw)) return "audio";
  return null;
}

function bindEditor(node) {
  const editor = node?.__terryH3Editor;
  if (!editor || editor.__terryH3RebindBound) return false;
  editor.__terryH3RebindBound = true;
  editor.addEventListener("pointerdown", (event) => {
    const chip = event.target?.closest?.(".terry-h3-chip");
    if (!chip || !editor.contains(chip) || !mediaChipType(chip)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    openH3AssetMenuForChip(editor, chip);
  }, true);
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  pruneInstance(node);
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    pruneInstance(node);
    if (bindEditor(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(900, 60 * attempts));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-rebind-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-rebind-style";
  style.textContent = `
.terry-h3-media-chip{cursor:pointer!important}
.terry-h3-media-chip:hover{box-shadow:inset 0 0 0 1px rgba(0,226,187,.38),0 0 0 1px rgba(0,226,187,.12)!important}
.terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TransportAndRebind",
  setup() {
    installStyle();
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;
    pruneNodeData(nodeData);
    if (nodeType?.nodeData && nodeType.nodeData !== nodeData) pruneNodeData(nodeType.nodeData);
    if (nodeType?.prototype?.constructor?.nodeData && nodeType.prototype.constructor.nodeData !== nodeData) pruneNodeData(nodeType.prototype.constructor.nodeData);
    if (nodeType.prototype.__terryH3TransportRebindInstalled) return;
    nodeType.prototype.__terryH3TransportRebindInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      pruneInstance(this);
      bindEditor(this);
      return result;
    };
  },
  loadedGraphNode(node) { installSoon(node); },
});
