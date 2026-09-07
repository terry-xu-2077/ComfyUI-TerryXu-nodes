import { app } from "../../scripts/app.js";
import { h3MediaOptions, mountH3PromptWidget } from "./h3_prompt_editor.js";

const H3_TYPE = "TerryXuH3PromptEditor";
const PROMPT_WIDGET = "prompt";
const PREVIEW_WIDGET = "visual_preview";

function nodeType(node) {
  return String(
    node?.comfyClass
      || node?.type
      || node?.constructor?.comfyClass
      || node?.constructor?.type
      || node?.constructor?.nodeData?.name
      || ""
  );
}

function isH3(node) {
  return nodeType(node) === H3_TYPE;
}

function isSubgraphNode(node) {
  try {
    if (node?.isSubgraphNode?.()) return true;
  } catch {}
  return Boolean(node?.subgraph?.inputNode && node?.subgraph?.outputNode);
}

function allGraphs(root = app.graph) {
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
  }
  return result;
}

function directH3Nodes(subgraphNode) {
  if (!isSubgraphNode(subgraphNode)) return [];
  return (subgraphNode.subgraph?._nodes || subgraphNode.subgraph?.nodes || []).filter(isH3);
}

function getWidget(node, name) {
  return node?.widgets?.find?.((widget) => String(widget?.name || "") === name) || null;
}

function sourceSlotForWidget(node, widget) {
  if (!node || !widget) return null;
  try {
    const slot = node.getSlotFromWidget?.(widget);
    if (slot) return slot;
  } catch {}
  return (node.inputs || []).find((input) =>
    input?.widget === widget
      || String(input?.widget?.name || "") === String(widget.name || "")
  ) || null;
}

function getLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  return graph.getLink?.(linkId)
    || graph.links?.get?.(linkId)
    || graph._links?.get?.(linkId)
    || graph.links?.[linkId]
    || graph._links?.[linkId]
    || null;
}

function linkTarget(graph, link) {
  if (!graph || !link) return { node: null, input: null };
  try {
    const resolved = link.resolve?.(graph);
    if (resolved?.inputNode && resolved?.input) {
      return { node: resolved.inputNode, input: resolved.input };
    }
  } catch {}
  const targetId = link.target_id ?? link.targetId;
  const targetSlot = Number(link.target_slot ?? link.targetSlot ?? 0) || 0;
  const node = graph.getNodeById?.(targetId) || null;
  return { node, input: node?.inputs?.[targetSlot] || null };
}

function promotionSlotFor(subgraphNode, sourceNode, widgetName) {
  const graph = subgraphNode?.subgraph;
  if (!graph) return null;
  const slots = graph.inputNode?.slots || graph.inputs || [];
  for (const slot of slots) {
    for (const linkId of slot?.linkIds || []) {
      const target = linkTarget(graph, getLink(graph, linkId));
      if (target.node !== sourceNode || !target.input) continue;
      const targetWidget = sourceNode.getWidgetFromSlot?.(target.input)
        || getWidget(sourceNode, target.input?.widget?.name);
      if (String(targetWidget?.name || target.input?.widget?.name || "") === widgetName) return slot;
    }
  }
  return null;
}

function nextInputName(graph, base) {
  const names = new Set((graph?.inputs || graph?.inputNode?.slots || []).map((input) => String(input?.name || "")));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

function ensurePromotion(subgraphNode, sourceNode, widgetName) {
  const graph = subgraphNode?.subgraph;
  if (!graph || !sourceNode) return null;
  const existing = promotionSlotFor(subgraphNode, sourceNode, widgetName);
  if (existing) return existing;

  const widget = getWidget(sourceNode, widgetName);
  const sourceSlot = sourceSlotForWidget(sourceNode, widget);
  if (!widget || !sourceSlot || typeof graph.addInput !== "function") return null;

  const inputName = nextInputName(graph, widgetName);
  const subgraphInput = graph.addInput(inputName, String(sourceSlot.type ?? "*"));
  if (!subgraphInput) return null;
  subgraphInput.label = sourceSlot.label || widget.label || widgetName;

  let link = null;
  try {
    link = subgraphInput.connect?.(sourceSlot, sourceNode) || null;
  } catch (error) {
    console.warn(`[TerryXu H3] Failed to promote ${widgetName}`, error);
  }
  if (!link) {
    try { graph.removeInput?.(subgraphInput); } catch {}
    return null;
  }

  subgraphNode.expandToFitContent?.();
  subgraphNode.setDirtyCanvas?.(true, true);
  subgraphNode.graph?.setDirtyCanvas?.(true, true);
  return subgraphInput;
}

function hostInputForSlot(subgraphNode, subgraphSlot) {
  if (!subgraphNode || !subgraphSlot) return null;
  return (subgraphNode.inputs || []).find((input) =>
    input?._subgraphSlot === subgraphSlot
      || (
        input?._subgraphSlot?.id != null
          && subgraphSlot?.id != null
          && String(input._subgraphSlot.id) === String(subgraphSlot.id)
      )
      || String(input?.name || "") === String(subgraphSlot?.name || "")
  ) || null;
}

function hostWidgetForInput(subgraphNode, input) {
  if (!subgraphNode || !input) return null;
  try {
    const widget = subgraphNode.getWidgetFromSlot?.(input);
    if (widget) return widget;
  } catch {}
  return input._widget
    || (subgraphNode.widgets || []).find((widget) =>
      String(widget?.name || "") === String(input?.widget?.name || input?.name || "")
    )
    || null;
}

function setupSubgraphNode(node, attempt = 0) {
  if (!isSubgraphNode(node)) return false;
  const h3Nodes = directH3Nodes(node);
  if (h3Nodes.length !== 1) return false;
  const h3 = h3Nodes[0];

  const promptSlot = ensurePromotion(node, h3, PROMPT_WIDGET);
  const previewSlot = ensurePromotion(node, h3, PREVIEW_WIDGET);
  if (!promptSlot || !previewSlot) {
    if (attempt < 16) setTimeout(() => setupSubgraphNode(node, attempt + 1), Math.min(1200, 60 + attempt * 70));
    return false;
  }

  // Rebuild only once for workflows created by the older hidden-widget build.
  // New promotions are already bound by ComfyUI's input-connected lifecycle.
  if (!node.__terryH3PromotionMigrated) {
    node.__terryH3PromotionMigrated = true;
    try { node.rebuildInputWidgetBindings?.(); } catch {}
  }

  const promptInput = hostInputForSlot(node, promptSlot);
  const previewInput = hostInputForSlot(node, previewSlot);
  const promptWidget = hostWidgetForInput(node, promptInput);
  const previewWidget = hostWidgetForInput(node, previewInput);
  if (!promptInput || !previewInput || !promptWidget || !previewWidget) {
    if (attempt < 16) setTimeout(() => setupSubgraphNode(node, attempt + 1), Math.min(1200, 60 + attempt * 70));
    return false;
  }

  if (node.__terryH3PromotedPromptMount?.promptWidget === promptWidget) return true;

  const state = mountH3PromptWidget({
    hostNode: node,
    sourceNode: h3,
    promptWidget,
    previewWidget,
    assetsProvider: () => h3MediaOptions(h3),
    promoted: true,
  });
  if (!state) {
    if (attempt < 16) setTimeout(() => setupSubgraphNode(node, attempt + 1), Math.min(1200, 60 + attempt * 70));
    return false;
  }

  node.__terryH3PromotedPromptMount = state;
  node.expandToFitContent?.();
  node.setDirtyCanvas?.(true, true);
  return true;
}

function setupAllSubgraphs() {
  const root = app.graph?.rootGraph || app.graph;
  for (const graph of allGraphs(root)) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      if (isSubgraphNode(node)) setupSubgraphNode(node);
    }
  }
}

let timer = null;
function start() {
  setupAllSubgraphs();
  if (timer) return;
  timer = setInterval(() => {
    setupAllSubgraphs();
    const root = app.graph?.rootGraph || app.graph;
    for (const graph of allGraphs(root)) {
      for (const node of graph?._nodes || graph?.nodes || []) {
        node?.__terryH3PromotedPromptMount?.render?.();
      }
    }
  }, 300);
}

app.registerExtension({
  name: "TerryXu.H3SubgraphEditor",
  setup() {
    start();
    queueMicrotask(setupAllSubgraphs);
  },
  nodeCreated(node) {
    if (!isSubgraphNode(node)) return;
    queueMicrotask(() => setupSubgraphNode(node));
    setTimeout(() => setupSubgraphNode(node), 80);
  },
  loadedGraphNode(node) {
    if (isSubgraphNode(node)) queueMicrotask(() => setupSubgraphNode(node));
  },
  afterConfigureGraph() {
    queueMicrotask(setupAllSubgraphs);
    setTimeout(setupAllSubgraphs, 120);
  },
});