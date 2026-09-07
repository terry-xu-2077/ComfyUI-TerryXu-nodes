import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const UNPACK_TYPES = new Set([
  "TerryXuWireBusUnpack",
  "TerryXuWirelessBusUnpack",
]);
const STYLE_ID = "terry-wire-bus-busout-port-fix-style";

function nodeType(node) {
  return String(
    node?.comfyClass ||
    node?.type ||
    node?.constructor?.comfyClass ||
    node?.constructor?.type ||
    ""
  );
}

function isUnpack(node) {
  return UNPACK_TYPES.has(nodeType(node));
}

function busOutputSlots(node) {
  const slots = [];
  for (let index = 0; index < (node?.outputs?.length || 0); index++) {
    if (String(node.outputs[index]?.type || "").toUpperCase() === BUS_TYPE) slots.push(index);
  }
  return slots;
}

function nodeTitleHeight() {
  return Math.max(0, Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30);
}

function nodeVisualCenterY(node) {
  return Number(node?.pos?.[1] || 0)
    + (Number(node?.size?.[1] || 0) - nodeTitleHeight()) * 0.5;
}

function busColor() {
  return (
    globalThis.LGraphCanvas?.link_type_colors?.[BUS_TYPE] ||
    globalThis.LGraphCanvas?.link_type_colors?.["*"] ||
    "#9ca3af"
  );
}

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBusOutputCapsule(ctx, node, slot) {
  if (!ctx || node?.flags?.collapsed) return;
  const global = node.getOutputPos?.(slot);
  if (!Array.isArray(global) || !Number.isFinite(global[0]) || !Number.isFinite(global[1])) return;
  const x = global[0] - Number(node?.pos?.[0] || 0);
  const y = global[1] - Number(node?.pos?.[1] || 0);
  const width = 12;
  const height = 30;

  ctx.save();
  roundedRect(ctx, x - width * 0.5, y - height * 0.5, width, height, width * 0.5);
  ctx.fillStyle = busColor();
  ctx.fill();
  ctx.lineWidth = 1.35;
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.stroke();
  ctx.restore();
}

function patchOutputPosition(node) {
  const current = node?.getOutputPos;
  if (typeof current !== "function" || current.__terryBusOutPortFix) return;

  const wrapped = function(slot) {
    const index = Number(slot) || 0;
    if (
      !this.flags?.collapsed &&
      String(this.outputs?.[index]?.type || "").toUpperCase() === BUS_TYPE
    ) {
      return [
        Number(this.pos?.[0] || 0) + Number(this.size?.[0] || 0),
        nodeVisualCenterY(this),
      ];
    }
    return current.apply(this, arguments);
  };
  wrapped.__terryBusOutPortFix = true;
  wrapped.__terryBusOutPortFixOriginal = current;
  node.getOutputPos = wrapped;
}

function patchForeground(node) {
  const current = node?.onDrawForeground;
  if (typeof current === "function" && current.__terryBusOutPortFix) return;

  const wrapped = function(ctx) {
    const result = current?.apply(this, arguments);
    if (!this.flags?.collapsed) {
      try {
        for (const slot of busOutputSlots(this)) drawBusOutputCapsule(ctx, this, slot);
      } catch (error) {
        console.warn("[TerryXu Wire Bus] Failed to draw Bus-Out capsule", error);
      }
    }
    return result;
  };
  wrapped.__terryBusOutPortFix = true;
  wrapped.__terryBusOutPortFixOriginal = current;
  node.onDrawForeground = wrapped;
}

function patchNode(node) {
  if (!isUnpack(node)) return;
  patchOutputPosition(node);
  patchForeground(node);
}

function attrEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function refreshVueStyle() {
  if (typeof document === "undefined") return;
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    document.head.append(style);
  }

  const selectors = [];
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (!isUnpack(node) || node?.id == null) continue;
      const root = `[data-node-id="${attrEscape(node.id)}"]:not([data-collapsed])`;
      for (const slot of busOutputSlots(node)) {
        selectors.push(
          `${root} .lg-slot--output:nth-child(${slot + 1} of .lg-slot--output) [data-testid="slot-connection-dot"]`
        );
      }
    }
  }

  style.textContent = selectors.length ? `
${selectors.join(",\n")}{
  position:relative !important;
  overflow:visible !important;
  width:12px !important;
  min-width:12px !important;
  height:30px !important;
  min-height:30px !important;
  border-radius:999px !important;
  box-sizing:border-box !important;
  background:rgba(156,163,175,.94) !important;
  border:1.35px solid rgba(255,255,255,.34) !important;
  box-shadow:inset 0 0 0 1px rgba(20,24,30,.18) !important;
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
}
` : "";
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

function patchAll() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) patchNode(node);
  }
  refreshVueStyle();
}

let timer = null;
function start() {
  patchAll();
  if (timer) return;
  timer = setInterval(patchAll, 300);
}

app.registerExtension({
  name: "TerryXu.WireBusBusOutPortFix",

  setup() {
    start();
    queueMicrotask(patchAll);
  },

  nodeCreated(node) {
    if (isUnpack(node)) {
      queueMicrotask(() => patchNode(node));
      setTimeout(patchAll, 0);
    }
  },

  loadedGraphNode(node) {
    if (isUnpack(node)) queueMicrotask(() => patchNode(node));
  },

  afterConfigureGraph() {
    start();
    queueMicrotask(patchAll);
  },
});
