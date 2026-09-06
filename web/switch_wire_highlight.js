import { app } from "../../scripts/app.js";

const LINE_TYPE = "TerryXuLineSwitch";
const BOOL_TYPE = "TerryXuBoolSwitch";
const INDEX_PROPERTY = "terry_line_switch_index";
const BOOL_PROPERTY = "terry_bool_switch_state";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isLine(node) { return nodeType(node) === LINE_TYPE; }
function isBool(node) { return nodeType(node) === BOOL_TYPE; }

function graphLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    if (typeof bag.get === "function") {
      const found = bag.get(linkId) ?? bag.get(String(linkId));
      if (found) return found;
    }
    const found = bag[linkId] ?? bag[String(linkId)];
    if (found) return found;
  }
  return null;
}

function graphNode(graph, id) {
  return graph?.getNodeById?.(id) || null;
}

function routeInputs(node) {
  return (node?.inputs || []).filter((input) => {
    const name = String(input?.name || "");
    return name.startsWith("routes.") || name.startsWith("route_");
  });
}

function widget(node, name) {
  return (node?.widgets || []).find((item) => item?.name === name) || null;
}

function properties(node) {
  return node?.properties && typeof node.properties === "object" ? node.properties : {};
}

function selectedLineIndex(node) {
  const routes = routeInputs(node);
  const raw = properties(node)[INDEX_PROPERTY] ?? widget(node, "index")?.value ?? node?.__terryRuntimeIndex ?? 1;
  const parsed = Number.parseInt(raw, 10);
  const safe = Number.isFinite(parsed) ? parsed : 1;
  return Math.max(1, Math.min(safe, Math.max(1, routes.length)));
}

function selectedBoolState(node) {
  const raw = widget(node, "enabled")?.value ?? properties(node)[BOOL_PROPERTY] ?? node?.__terryRuntimeBool ?? false;
  return Boolean(raw);
}

function activeInput(node) {
  if (isLine(node)) return routeInputs(node)[selectedLineIndex(node) - 1] || null;
  if (isBool(node)) {
    const name = selectedBoolState(node) ? "input_true" : "input_false";
    return (node?.inputs || []).find((input) => input?.name === name) || null;
  }
  return null;
}

function selectedSwitchLinks(graph) {
  const links = [];
  const seen = new Set();
  for (const node of graph?._nodes || graph?.nodes || []) {
    if (!isLine(node) && !isBool(node)) continue;
    const input = activeInput(node);
    if (!input || input.link == null) continue;
    const link = graphLink(graph, input.link);
    if (!link) continue;
    const id = link?.id ?? link?.link_id ?? link?.linkId ?? input.link;
    const key = String(id);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(link);
  }
  return links;
}

// Same proven strategy as wire_bus_visual.js: temporarily remove only the
// selected links during ComfyUI's native pass, then restore them immediately
// and redraw just those links with a stronger selection treatment.
function hideLinksForNativeDraw(graph, links) {
  if (!graph || !links?.length) return () => {};

  const bags = [];
  const seenBags = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag || seenBags.has(bag)) continue;
    seenBags.add(bag);
    bags.push(bag);
  }

  const removed = [];
  for (const bag of bags) {
    const isMap = typeof bag.delete === "function" && typeof bag.set === "function";
    for (const link of links) {
      const id = link?.id ?? link?.link_id ?? link?.linkId;
      if (id == null) continue;
      for (const key of [id, String(id)]) {
        const exists = isMap ? bag.has?.(key) : Object.prototype.hasOwnProperty.call(bag, key);
        if (!exists) continue;
        const value = isMap ? bag.get(key) : bag[key];
        removed.push({ bag, isMap, key, value });
        if (isMap) bag.delete(key);
        else delete bag[key];
        break;
      }
    }
  }

  return () => {
    for (const item of removed) {
      if (item.isMap) item.bag.set(item.key, item.value);
      else item.bag[item.key] = item.value;
    }
  };
}

function linkNodes(graph, link) {
  return {
    origin: graphNode(graph, link?.origin_id ?? link?.originId),
    target: graphNode(graph, link?.target_id ?? link?.targetId),
    originSlot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
    targetSlot: Number(link?.target_slot ?? link?.targetSlot ?? 0) || 0,
  };
}

function outputPoint(node, slot) {
  const point = node?.getOutputPos?.(slot);
  if (Array.isArray(point) && point.length >= 2) return point;
  return [
    Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 0),
    Number(node?.pos?.[1] || 0) + 40,
  ];
}

function inputPoint(node, slot) {
  const point = node?.getInputPos?.(slot);
  if (Array.isArray(point) && point.length >= 2) return point;
  return [
    Number(node?.pos?.[0] || 0),
    Number(node?.pos?.[1] || 0) + 40 + Number(slot || 0) * 20,
  ];
}

function originalLinkColor(graph, link) {
  const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
  const type = String(
    link?.type ||
    origin?.outputs?.[originSlot]?.type ||
    target?.inputs?.[targetSlot]?.type ||
    "*"
  );
  const colors = globalThis.LGraphCanvas?.link_type_colors || {};
  return (
    link?.color ||
    colors[type] ||
    colors[type.toUpperCase?.() || type] ||
    globalThis.LiteGraph?.LINK_COLOR ||
    colors["*"] ||
    "#9ca3af"
  );
}

function makeLinkPath(ctx, start, end) {
  const sx = start?.[0], sy = start?.[1], ex = end?.[0], ey = end?.[1];
  if (![sx, sy, ex, ey].every(Number.isFinite)) return false;
  const tangent = Math.max(40, Math.min(180, Math.abs(ex - sx) * 0.5));
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx + tangent, sy, ex - tangent, ey, ex, ey);
  return true;
}

function lightenLinkColor(color, whiteMix = 0.48) {
  const raw = String(color || "").trim();
  let r = null, g = null, b = null;
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3
      ? hex[1].split("").map((c) => c + c).join("")
      : hex[1];
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    const rgb = raw.match(/^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)/i);
    if (rgb) {
      r = Number(rgb[1]);
      g = Number(rgb[2]);
      b = Number(rgb[3]);
    }
  }
  if (![r, g, b].every(Number.isFinite)) return color;
  const mix = Math.max(0, Math.min(1, Number(whiteMix) || 0));
  const blend = (value) => Math.round(value + (255 - value) * mix);
  return `rgb(${blend(r)}, ${blend(g)}, ${blend(b)})`;
}

function drawHighlightedLink(ctx, start, end, color, baseWidth) {
  if (!ctx) return;
  const width = Math.max(2.5, Number(baseWidth) || 3);
  const bright = lightenLinkColor(color, 0.76);

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // Broad soft glow stays in the original type color.
  if (makeLinkPath(ctx, start, end)) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.38;
    ctx.lineWidth = width + 5.8;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    ctx.stroke();
  }

  // Original type color becomes the outer outline.
  ctx.shadowBlur = 0;
  if (makeLinkPath(ctx, start, end)) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.96;
    ctx.lineWidth = width + 2.5;
    ctx.stroke();
  }

  // Slimmer inner core: same hue mixed toward white for clear contrast.
  if (makeLinkPath(ctx, start, end)) {
    ctx.strokeStyle = bright;
    ctx.globalAlpha = 1;
    ctx.lineWidth = Math.max(2.0, width - 0.45);
    ctx.stroke();
  }

  ctx.restore();
}

function patchCanvas(canvas) {
  if (!canvas || canvas.__terrySwitchWireHighlightPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terrySwitchWireHighlightPatched = true;
  const original = canvas.drawConnections;

  canvas.drawConnections = function (ctx) {
    const graph = this.graph || app.graph;
    const links = selectedSwitchLinks(graph);
    const restore = hideLinksForNativeDraw(graph, links);
    let result;
    try {
      result = original.apply(this, arguments);
    } finally {
      restore();
    }

    try {
      const baseWidth = Math.max(3, Number(this.connections_width) || 3);
      for (const link of links) {
        const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
        if (!origin || !target) continue;
        drawHighlightedLink(
          ctx,
          outputPoint(origin, originSlot),
          inputPoint(target, targetSlot),
          originalLinkColor(graph, link),
          baseWidth
        );
      }
    } catch (error) {
      console.warn("[TerryXu Switch] Failed to draw selected route cable", error);
    }
    return result;
  };
}

function ensurePatched() {
  patchCanvas(app.canvas);
}

app.registerExtension({
  name: "TerryXu.SwitchWireHighlight",
  setup() { ensurePatched(); },
  loadedGraphNode() { ensurePatched(); },
  nodeCreated() { ensurePatched(); },
  afterConfigureGraph() { ensurePatched(); },
});
