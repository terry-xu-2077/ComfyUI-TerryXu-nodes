import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const PACK_TYPE = "TerryXuWireBusPack";
const UNPACK_TYPE = "TerryXuWireBusUnpack";
const WIRELESS_PACK_TYPE = "TerryXuWirelessBusPack";
const WIRELESS_UNPACK_TYPE = "TerryXuWirelessBusUnpack";
const GET_TYPE = "GetNode";
const SET_TYPE = "SetNode";
const VUE_STYLE_ID = "terry-wire-bus-vue-port-style";
const WIRELESS_WIDGET_HEIGHT = 38;
const WIRELESS_CHANNEL_BACKGROUND = "#191a1c";
const WIRELESS_CHANNEL_BORDER = "#373a40";

function nodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      ""
  );
}

function allLinks(graph) {
  const out = [];
  const seen = new Set();
  for (const bag of [graph?.links, graph?._links]) {
    if (!bag) continue;
    const values = typeof bag.values === "function" ? bag.values() : Object.values(bag);
    for (const link of values) {
      if (!link) continue;
      const id = link.id ?? link.link_id ?? link.linkId;
      const key = id == null ? link : String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(link);
    }
  }
  return out;
}

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

function linkNodes(graph, link) {
  const originId = link?.origin_id ?? link?.originId;
  const targetId = link?.target_id ?? link?.targetId;
  return {
    origin: graph?.getNodeById?.(originId) || null,
    target: graph?.getNodeById?.(targetId) || null,
    originSlot: Number(link?.origin_slot ?? link?.originSlot ?? 0) || 0,
    targetSlot: Number(link?.target_slot ?? link?.targetSlot ?? 0) || 0,
  };
}

function graphAncestors(graph) {
  if (!graph) return [];
  const root = graph.rootGraph || app.graph || graph;
  if (graph === root) return [graph];
  const chain = [graph];
  const seen = new Set(chain);
  let current = graph;
  while (current && current !== root) {
    let parent = current.parent || current._parent || current._subgraph_node?.graph || null;
    if (!parent && root?._nodes) {
      for (const node of root._nodes) {
        if (node?.subgraph === current) {
          parent = root;
          break;
        }
      }
    }
    if (!parent || seen.has(parent)) break;
    seen.add(parent);
    chain.push(parent);
    current = parent;
  }
  if (root && !chain.includes(root)) chain.push(root);
  return chain;
}

function variableName(node) {
  return node?.widgets?.[0]?.value ?? node?.properties?.name ?? null;
}

function findSetter(getNode) {
  const name = variableName(getNode);
  if (!name) return null;
  for (const graph of graphAncestors(getNode.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if (nodeType(node) === SET_TYPE && variableName(node) === name) {
        return { node, graph };
      }
    }
  }
  return null;
}

function isBusLink(graph, link) {
  const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
  const type = String(
    link?.type ||
      origin?.outputs?.[originSlot]?.type ||
      target?.inputs?.[targetSlot]?.type ||
      ""
  );
  return type === BUS_TYPE || nodeType(origin) === PACK_TYPE || nodeType(origin) === WIRELESS_PACK_TYPE;
}

function pointForOutput(node, slot) {
  const p = node?.getOutputPos?.(slot);
  if (Array.isArray(p) && p.length >= 2) return p;
  return [Number(node?.pos?.[0] || 0) + Number(node?.size?.[0] || 0), Number(node?.pos?.[1] || 0) + 40];
}

function pointForInput(node, slot) {
  const p = node?.getInputPos?.(slot);
  if (Array.isArray(p) && p.length >= 2) return p;
  return [Number(node?.pos?.[0] || 0), Number(node?.pos?.[1] || 0) + 40 + slot * 20];
}

function nodeTitleHeight() {
  return Math.max(0, Number(globalThis.LiteGraph?.NODE_TITLE_HEIGHT) || 30);
}

function nodeVisualCenterY(node) {
  // LiteGraph's position starts below the title while size covers the body.
  // The full visible bounds therefore run from posY - titleHeight to posY + height.
  return Number(node?.pos?.[1] || 0) + (Number(node?.size?.[1] || 0) - nodeTitleHeight()) * 0.5;
}

function isNodeCollapsed(node) {
  return Boolean(node?.flags?.collapsed);
}

function isWirelessBusNode(node) {
  const type = nodeType(node);
  return type === WIRELESS_PACK_TYPE || type === WIRELESS_UNPACK_TYPE;
}

function centeredLanePosition(node, slot, count, isInput) {
  const spacing = Math.max(12, Number(globalThis.LiteGraph?.NODE_SLOT_HEIGHT) || 20);
  const index = Math.max(0, Number(slot) || 0);
  const total = Math.max(1, Number(count) || 0);
  const x = Number(node?.pos?.[0] || 0) + (isInput ? 0 : Number(node?.size?.[0] || 0));
  const widgetOffset = isWirelessBusNode(node) ? WIRELESS_WIDGET_HEIGHT * 0.5 : 0;
  const y = nodeVisualCenterY(node) - widgetOffset + (index - (total - 1) * 0.5) * spacing;
  return [x, y];
}

function busColor(link = null) {
  return (
    link?.color ||
    globalThis.LGraphCanvas?.link_type_colors?.[BUS_TYPE] ||
    globalThis.LGraphCanvas?.link_type_colors?.["*"] ||
    "#9ca3af"
  );
}

function connectionColor(graph, link) {
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

function sameColor(a, b) {
  return String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();
}

function upstreamPack(graph, node, seen = new Set()) {
  if (!node || !graph) return null;
  if (nodeType(node) === PACK_TYPE || nodeType(node) === WIRELESS_PACK_TYPE) return { node, graph };

  const key = `${graph?.id || "g"}:${String(node.id ?? node)}`;
  if (seen.has(key)) return null;
  seen.add(key);

  if (nodeType(node) === UNPACK_TYPE || nodeType(node) === WIRELESS_UNPACK_TYPE) {
    const resolved = node.resolveVirtualOutput?.(0);
    if (resolved?.node) {
      const found = upstreamPack(resolved.node.graph || graph, resolved.node, seen);
      if (found) return found;
    }
  }

  if (nodeType(node) === GET_TYPE) {
    const setter = findSetter(node);
    const setterLinkId = setter?.node?.inputs?.[0]?.link;
    if (setter && setterLinkId != null) {
      const setterLink = graphLink(setter.graph, setterLinkId);
      if (setterLink) {
        const { origin } = linkNodes(setter.graph, setterLink);
        const found = upstreamPack(setter.graph, origin, seen);
        if (found) return found;
      }
    }
  }

  const incoming = allLinks(graph)
    .filter((link) => {
      const targetId = link?.target_id ?? link?.targetId;
      return String(targetId) === String(node.id) && isBusLink(graph, link);
    })
    .sort((a, b) => Number(a?.target_slot ?? a?.targetSlot ?? 0) - Number(b?.target_slot ?? b?.targetSlot ?? 0));

  for (const link of incoming) {
    const { origin } = linkNodes(graph, link);
    const found = upstreamPack(graph, origin, seen);
    if (found) return found;
  }
  return null;
}

function packInputColors(graph, packNode, fallback) {
  if (!packNode) return [fallback, fallback, fallback];
  const incoming = allLinks(graph)
    .filter((link) => {
      const targetId = link?.target_id ?? link?.targetId;
      return String(targetId) === String(packNode.id) && !isBusLink(graph, link);
    })
    .sort((a, b) => Number(a?.target_slot ?? a?.targetSlot ?? 0) - Number(b?.target_slot ?? b?.targetSlot ?? 0));

  const colors = [];
  for (const link of incoming) {
    const color = connectionColor(graph, link);
    if (!color || colors.some((existing) => sameColor(existing, color))) continue;
    colors.push(color);
    if (colors.length >= 3) break;
  }

  const first = colors[0] || fallback;
  return [first, colors[1] || first, colors[2] || first];
}

function lightLaneColors(graph, busLink) {
  const { origin } = linkNodes(graph, busLink);
  const packRef = upstreamPack(graph, origin);
  return packRef
    ? packInputColors(packRef.graph, packRef.node, busColor(busLink))
    : [busColor(busLink), busColor(busLink), busColor(busLink)];
}

function drawBusLane(ctx, start, end, color, width, offset, alpha) {
  const sx = start[0];
  const sy = start[1] + offset;
  const ex = end[0];
  const ey = end[1] + offset;
  const dx = Math.abs(ex - sx);
  const tangent = Math.max(40, Math.min(180, dx * 0.5));

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.bezierCurveTo(sx + tangent, sy, ex - tangent, ey, ex, ey);
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.restore();
}

function drawBusCable(ctx, start, end, darkColor, lightColors, baseWidth) {
  const laneWidth = Math.max(2.5, baseWidth);
  const spacing = laneWidth * 0.92;
  const lanes = [
    { offset: -spacing * 2, alpha: 0.92, color: lightColors[0] },
    { offset: -spacing, alpha: 0.56, color: darkColor },
    { offset: 0, alpha: 0.92, color: lightColors[1] },
    { offset: spacing, alpha: 0.56, color: darkColor },
    { offset: spacing * 2, alpha: 0.92, color: lightColors[2] },
  ];
  for (const lane of lanes) drawBusLane(ctx, start, end, lane.color, laneWidth, lane.offset, lane.alpha);
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

function bottomRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + width, y);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y);
  ctx.closePath();
}

function strokeBottomRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x, y + height - r);
  ctx.quadraticCurveTo(x, y + height, x + r, y + height);
  ctx.lineTo(x + width - r, y + height);
  ctx.quadraticCurveTo(x + width, y + height, x + width, y + height - r);
  ctx.lineTo(x + width, y);
  ctx.stroke();
}

function drawCapsulePort(ctx, node, isOutput, slot = 0) {
  const global = isOutput ? pointForOutput(node, slot) : pointForInput(node, slot);
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

function attrEscape(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function cssText(value) {
  return `"${String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\r", "")
    .replaceAll("\n", "\\A ")}"`;
}

function wirelessChannelLabel(node) {
  return String(
    node?.properties?.terry_wireless_bus_channel
      ?? node?.widgets?.find((widget) => widget?.terryWirelessChannel)?.value
      ?? ""
  ).trim();
}

function drawCompactNodeTitle(ctx, node, titleHeight, size, fontStyle, selected) {
  const title = String(node?.getTitle?.() ?? node?.title ?? "");
  if (!title || !ctx?.fillText) return;

  const left = Math.max(18, Number(titleHeight) || nodeTitleHeight());
  const width = Math.max(1, Number(size?.[0] || node?.size?.[0] || 0) - left - 6);
  const baseFont = String(fontStyle || "14px sans-serif");

  ctx.save();
  ctx.font = baseFont;
  const measured = Number(ctx.measureText?.(title)?.width) || 0;
  if (measured > width) {
    const match = baseFont.match(/(\d+(?:\.\d+)?)px/);
    if (match) {
      const reduced = Math.max(10, Number(match[1]) * width / measured);
      ctx.font = baseFont.replace(match[0], `${reduced.toFixed(2)}px`);
    }
  }
  ctx.fillStyle = selected
    ? globalThis.LiteGraph?.NODE_SELECTED_TITLE_COLOR || "#fff"
    : node?.constructor?.title_text_color || app.canvas?.node_title_color || "#ddd";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  const titleTextY = Number(globalThis.LiteGraph?.NODE_TITLE_TEXT_Y);
  ctx.fillText(title, left, (Number.isFinite(titleTextY) ? titleTextY : 20) - left, width);
  ctx.restore();
}

function drawCollapsedWirelessChannel(ctx, node) {
  const channel = wirelessChannelLabel(node);
  if (!channel || !ctx?.fillText) return;

  const collapsedWidth = Number(node?._collapsed_width)
    || Number(globalThis.LiteGraph?.NODE_COLLAPSED_WIDTH)
    || Number(node?.size?.[0])
    || 112;
  const height = 26;
  const top = -6;

  ctx.save();
  ctx.font = "11px Inter,system-ui,sans-serif";
  const textWidth = Number(ctx.measureText?.(channel)?.width) || channel.length * 8;
  const width = Math.min(180, Math.max(46, textWidth + 18));
  const left = (collapsedWidth - width) * 0.5;
  bottomRoundedRect(ctx, left, top, width, height, 7);
  ctx.fillStyle = WIRELESS_CHANNEL_BACKGROUND;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = WIRELESS_CHANNEL_BORDER;
  strokeBottomRoundedRect(ctx, left, top, width, height, 7);
  ctx.fillStyle = "rgba(245,245,245,.88)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(channel, collapsedWidth * 0.5, (top + height) * 0.5, width - 14);
  ctx.restore();
}

function workflowBusGraphs() {
  const active = app.canvas?.graph || app.graph;
  const root = active?.rootGraph || app.graph?.rootGraph || app.graph || active;
  const queue = [active, root];
  const graphs = [];
  const seen = new Set();

  while (queue.length) {
    const graph = queue.shift();
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    graphs.push(graph);

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
  return graphs;
}

function vueBusNodes() {
  const nodes = [];
  const seenIds = new Set();
  for (const graph of workflowBusGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) {
      const type = nodeType(node);
      if (![PACK_TYPE, UNPACK_TYPE, WIRELESS_PACK_TYPE, WIRELESS_UNPACK_TYPE].includes(type)) continue;
      const id = node?.id == null ? node : String(node.id);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      nodes.push(node);
    }
  }
  return nodes;
}

function refreshVuePortStyle() {
  let style = document.getElementById(VUE_STYLE_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = VUE_STYLE_ID;
    document.head.append(style);
  }

  const packs = [];
  const unpacks = [];
  const wirelessBusInputs = [];
  const busOutputs = [];
  const packRows = [];
  const unpackRows = [];
  const packInputGroups = [];
  const unpackOutputGroups = [];
  const nodeLayoutRules = [];
  const phantomOutputRows = [];
  const wirelessInputGroups = [];
  const wirelessOutputGroups = [];
  const centeredWirelessBusGroups = [];
  const wirelessWidgetGrids = [];
  const wirelessWidgetRows = [];
  const wirelessBadges = [];
  const collapsedWirelessChannelRules = [];
  const wiredBadges = [];

  for (const node of vueBusNodes()) {
    if (node?.id == null) continue;
    const type = nodeType(node);
    const root = `[data-node-id="${attrEscape(node.id)}"]`;
    const expandedRoot = `${root}:not([data-collapsed])`;
    const compactWidth = Math.max(80, Number(node?.__terryBusCompactWidth) || 112);
    const minBodyHeight = Math.max(0, Number(node?.__terryBusMinHeight) || Number(node?.size?.[1]) || 0);
    const bodyHeight = Math.max(minBodyHeight, Number(node?.size?.[1]) || 0);
    const nodeHeight = bodyHeight + nodeTitleHeight();

    nodeLayoutRules.push(`
${expandedRoot}{
  --min-node-width:${compactWidth}px !important;
  --node-width:${compactWidth}px !important;
  --node-height:${nodeHeight}px !important;
  min-width:${compactWidth}px !important;
  height:${nodeHeight}px !important;
  min-height:${nodeHeight}px !important;
  max-height:${nodeHeight}px !important;
}
${expandedRoot} [data-testid="node-inner-wrapper"]{
  width:${compactWidth}px !important;
  min-width:${compactWidth}px !important;
  height:${nodeHeight}px !important;
  min-height:${nodeHeight}px !important;
  max-height:${nodeHeight}px !important;
}
${root}[data-collapsed]{
  --min-node-width:${compactWidth}px !important;
  --node-width:${compactWidth}px !important;
  width:${compactWidth}px !important;
  min-width:${compactWidth}px !important;
  max-width:${compactWidth}px !important;
}
${root}[data-collapsed] [data-testid="node-inner-wrapper"]{
  width:${compactWidth}px !important;
  min-width:${compactWidth}px !important;
  max-width:${compactWidth}px !important;
}
`);

    if (type === PACK_TYPE) {
      phantomOutputRows.push(`${expandedRoot} .lg-slot--output:not(:first-child)`);
      packInputGroups.push(`${expandedRoot} :has(> .lg-slot--input)`);
      packRows.push(`${expandedRoot} .lg-slot--output`);
      packs.push(`${expandedRoot} .lg-slot--output [data-testid="slot-connection-dot"]`);
      wiredBadges.push(`${expandedRoot} [data-testid^="node-body-"] > .mt-auto`);
    } else if (type === UNPACK_TYPE) {
      unpackOutputGroups.push(`${expandedRoot} :has(> .lg-slot--output)`);
      unpackRows.push(`${expandedRoot} .lg-slot--input`);
      unpacks.push(`${expandedRoot} .lg-slot--input [data-testid="slot-connection-dot"]`);
      wiredBadges.push(`${expandedRoot} [data-testid^="node-body-"] > .mt-auto`);
      for (let slot = 0; slot < (node.outputs?.length || 0); slot++) {
        if (String(node.outputs[slot]?.type || "").toUpperCase() !== BUS_TYPE) continue;
        busOutputs.push(
          `${expandedRoot} .lg-slot--output:nth-child(${slot + 1} of .lg-slot--output) [data-testid="slot-connection-dot"]`
        );
      }
    } else {
      if (type === WIRELESS_PACK_TYPE) {
        packRows.push(`${expandedRoot} .lg-slot--output`);
        packs.push(`${expandedRoot} .lg-slot--output [data-testid="slot-connection-dot"]`);
        for (let slot = 0; slot < (node.inputs?.length || 0); slot++) {
          const input = node.inputs[slot];
          if (input?.type !== BUS_TYPE || input.link == null) continue;
          wirelessBusInputs.push(
            `${expandedRoot} .lg-slot--input:nth-child(${slot + 1} of .lg-slot--input) [data-testid="slot-connection-dot"]`
          );
        }
      } else if (type === WIRELESS_UNPACK_TYPE) {
        unpackRows.push(`${expandedRoot} .lg-slot--input`);
        unpacks.push(`${expandedRoot} .lg-slot--input [data-testid="slot-connection-dot"]`);
        for (let slot = 0; slot < (node.outputs?.length || 0); slot++) {
          if (String(node.outputs[slot]?.type || "").toUpperCase() !== BUS_TYPE) continue;
          busOutputs.push(
            `${expandedRoot} .lg-slot--output:nth-child(${slot + 1} of .lg-slot--output) [data-testid="slot-connection-dot"]`
          );
        }
      }

      const groups = type === WIRELESS_PACK_TYPE ? wirelessInputGroups : wirelessOutputGroups;
      const direction = type === WIRELESS_PACK_TYPE ? "input" : "output";
      const group = `${expandedRoot} :has(> .lg-slot--${direction})`;
      groups.push(group);
      const slots = type === WIRELESS_PACK_TYPE ? node.inputs : node.outputs;
      if (slots?.length === 1 && slots[0]?.type === BUS_TYPE) {
        centeredWirelessBusGroups.push(group);
      }
      wirelessWidgetGrids.push(`${expandedRoot} [data-testid="node-widgets"]`);
      wirelessWidgetRows.push(`${expandedRoot} [data-testid="node-widget"]`);
      wirelessBadges.push(`${expandedRoot} [data-testid^="node-body-"] > .mt-auto`);
      const channel = wirelessChannelLabel(node);
      if (channel) {
        collapsedWirelessChannelRules.push(`
${root}[data-collapsed]::before{
  content:${cssText(channel)};
  position:absolute;
  left:50%;
  top:calc(100% - 6px);
  transform:translateX(-50%);
  min-width:32px;
  max-width:168px;
  height:26px;
  padding:5px 9px 0;
  border:1px solid ${WIRELESS_CHANNEL_BORDER};
  border-top:0;
  border-top-left-radius:0;
  border-top-right-radius:0;
  border-bottom-right-radius:7px;
  border-bottom-left-radius:7px;
  box-sizing:border-box;
  background:${WIRELESS_CHANNEL_BACKGROUND};
  color:rgba(245,245,245,.88);
  font:11px/20px Inter,system-ui,sans-serif;
  text-align:center;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
  pointer-events:none;
  z-index:-1;
}
`);
      }
    }
  }

  const selectors = [...packs, ...unpacks, ...wirelessBusInputs, ...busOutputs];
  const dotSelectors = [
    ...packs.map((s) => `${s} [data-testid="slot-dot"]`),
    ...unpacks.map((s) => `${s} [data-testid="slot-dot"]`),
    ...wirelessBusInputs.map((s) => `${s} [data-testid="slot-dot"]`),
    ...busOutputs.map((s) => `${s} [data-testid="slot-dot"]`),
  ];

  style.textContent = nodeLayoutRules.length ? `
${nodeLayoutRules.join("\n")}
${collapsedWirelessChannelRules.join("\n")}
${phantomOutputRows.length ? `${phantomOutputRows.join(",\n")}{
  display:none !important;
  pointer-events:none !important;
}` : ""}
${packInputGroups.length ? `${packInputGroups.join(",\n")}{
  position:absolute !important;
  left:0;
  top:50% !important;
  transform:translateY(-50%);
  z-index:3;
}` : ""}
${unpackOutputGroups.length ? `${unpackOutputGroups.join(",\n")}{
  position:absolute !important;
  right:0;
  top:50% !important;
  transform:translateY(-50%);
  z-index:4;
}` : ""}
${wirelessInputGroups.length ? `${wirelessInputGroups.join(",\n")}{
  position:absolute !important;
  left:0;
  top:calc(50% - ${WIRELESS_WIDGET_HEIGHT * 0.5}px) !important;
  transform:translateY(-50%);
  z-index:3;
}` : ""}
${wirelessOutputGroups.length ? `${wirelessOutputGroups.join(",\n")}{
  position:absolute !important;
  right:0;
  top:calc(50% - ${WIRELESS_WIDGET_HEIGHT * 0.5}px) !important;
  transform:translateY(-50%);
  z-index:4;
}` : ""}
${centeredWirelessBusGroups.length ? `${centeredWirelessBusGroups.join(",\n")}{
  top:50% !important;
  transform:translateY(-50%);
}` : ""}
${wirelessWidgetGrids.length ? `${wirelessWidgetGrids.join(",\n")}{
  position:absolute !important;
  left:6px;
  right:6px;
  bottom:8px;
  display:block !important;
  grid-template-columns:minmax(0,1fr) !important;
  min-width:0 !important;
  width:auto !important;
  max-width:calc(100% - 12px);
  z-index:5;
}` : ""}
${wirelessWidgetRows.length ? `${wirelessWidgetRows.join(",\n")}{
  display:block !important;
  min-width:0 !important;
  width:100% !important;
  height:26px !important;
  min-height:26px !important;
  max-height:26px !important;
  padding:0 !important;
  grid-template-columns:minmax(0,1fr) !important;
}` : ""}
${wirelessWidgetRows.length ? `${wirelessWidgetRows.map((selector) => `${selector} > :first-child`).join(",\n")}{
  display:none !important;
}` : ""}
${wirelessWidgetRows.length ? `${wirelessWidgetRows.map((selector) => `${selector} > :not(:first-child)`).join(",\n")}{
  min-width:0 !important;
  width:100% !important;
  height:26px !important;
  min-height:26px !important;
  max-height:26px !important;
  grid-column:1 / -1 !important;
}` : ""}
${wirelessBadges.length ? `${wirelessBadges.join(",\n")}{
  display:none !important;
}` : ""}
${wiredBadges.length ? `${wiredBadges.join(",\n")}{
  height:17px !important;
  min-height:17px !important;
  max-width:calc(100% - 10px);
  padding:0 5px !important;
  overflow:hidden;
}` : ""}
${wiredBadges.length ? `${wiredBadges.map((selector) => `${selector} > div`).join(",\n")}{
  height:16px !important;
  min-width:0 !important;
  max-width:100%;
}` : ""}
${wiredBadges.length ? `${wiredBadges.map((selector) => `${selector} > div *`).join(",\n")}{
  min-width:0 !important;
  font-size:9px !important;
  line-height:15px !important;
}` : ""}
${packRows.length ? `${packRows.join(",\n")}{
  position:absolute !important;
  right:0;
  top:50% !important;
  transform:translateY(-50%);
  z-index:4;
}` : ""}
${unpackRows.length ? `${unpackRows.join(",\n")}{
  position:absolute !important;
  left:0;
  top:50% !important;
  transform:translateY(-50%);
  z-index:4;
}` : ""}
${selectors.length ? `${selectors.join(",\n")}{
  position:relative;
  overflow:visible;
  width:12px !important;
  min-width:12px !important;
  height:30px !important;
  min-height:30px !important;
  border-radius:999px;
  box-sizing:border-box;
  background:rgba(156,163,175,.94);
  border:1.35px solid rgba(255,255,255,.34);
  box-shadow:inset 0 0 0 1px rgba(20,24,30,.18);
  display:flex;
  align-items:center;
  justify-content:center;
}` : ""}
${dotSelectors.length ? `${dotSelectors.join(",\n")}{
  position:relative;
  z-index:1;
  flex:none;
}` : ""}
` : "";
}

let vueStyleQueued = false;
function queueVueStyleRefresh() {
  if (vueStyleQueued) return;
  vueStyleQueued = true;
  requestAnimationFrame(() => {
    vueStyleQueued = false;
    refreshVuePortStyle();
  });
}

function patchBusNode(node) {
  if (!node) return;
  const type = nodeType(node);
  if (![PACK_TYPE, UNPACK_TYPE, WIRELESS_PACK_TYPE, WIRELESS_UNPACK_TYPE].includes(type)) return;
  queueVueStyleRefresh();
  if (node.__terryBusCapsulePatched) return;
  node.__terryBusCapsulePatched = true;
  node.__terryBusRefreshVisual = queueVueStyleRefresh;

  const originalDrawTitleText = node.onDrawTitleText;
  node.onDrawTitleText = function (ctx, titleHeight, size, scale, fontStyle, selected) {
    if (isNodeCollapsed(this) && originalDrawTitleText) {
      return originalDrawTitleText.apply(this, arguments);
    }
    drawCompactNodeTitle(ctx, this, titleHeight, size, fontStyle, selected);
  };

  // Fixed BUS ports sit on the vertical centerline. Dynamic lanes retain their
  // compact ordering around the remaining control area.
  const originalInputPos = node.getInputPos;
  const originalOutputPos = node.getOutputPos;
  node.getInputPos = function (slot) {
    if (isNodeCollapsed(this)) return originalInputPos?.apply?.(this, arguments);
    if (
      ((nodeType(this) === UNPACK_TYPE || nodeType(this) === WIRELESS_UNPACK_TYPE) && Number(slot) === 0)
    ) {
      return [Number(this.pos?.[0] || 0), nodeVisualCenterY(this)];
    }
    if (nodeType(this) === PACK_TYPE || nodeType(this) === WIRELESS_PACK_TYPE) {
      return centeredLanePosition(this, slot, this.inputs?.length || 0, true);
    }
    return originalInputPos?.apply?.(this, arguments);
  };

  node.getOutputPos = function (slot) {
    if (isNodeCollapsed(this)) return originalOutputPos?.apply?.(this, arguments);
    const index = Number(slot) || 0;
    if (
      ((nodeType(this) === PACK_TYPE || nodeType(this) === WIRELESS_PACK_TYPE) && index === 0)
    ) {
      return [
        Number(this.pos?.[0] || 0) + Number(this.size?.[0] || 0),
        nodeVisualCenterY(this),
      ];
    }
    if (nodeType(this) === UNPACK_TYPE || nodeType(this) === WIRELESS_UNPACK_TYPE) {
      if (String(this.outputs?.[index]?.type || "").toUpperCase() === BUS_TYPE) {
        return [
          Number(this.pos?.[0] || 0) + Number(this.size?.[0] || 0),
          nodeVisualCenterY(this),
        ];
      }
      return centeredLanePosition(this, index, this.outputs?.length || 0, false);
    }
    return originalOutputPos?.apply?.(this, arguments);
  };

  const originalBackground = node.onDrawBackground;
  node.onDrawBackground = function (ctx) {
    const result = originalBackground?.apply?.(this, arguments);
    if (isNodeCollapsed(this) && isWirelessBusNode(this)) {
      try {
        drawCollapsedWirelessChannel(ctx, this);
      } catch (error) {
        console.warn("[TerryXu Wire Bus] Failed to draw collapsed wireless channel", error);
      }
    }
    return result;
  };

  const originalForeground = node.onDrawForeground;
  node.onDrawForeground = function (ctx) {
    const result = originalForeground?.apply?.(this, arguments);
    if (isNodeCollapsed(this)) return result;
    try {
      if (nodeType(this) === PACK_TYPE || nodeType(this) === WIRELESS_PACK_TYPE) {
        drawCapsulePort(ctx, this, true, 0);
      }
      if (nodeType(this) === UNPACK_TYPE || nodeType(this) === WIRELESS_UNPACK_TYPE) {
        drawCapsulePort(ctx, this, false, 0);
        for (let slot = 0; slot < (this.outputs?.length || 0); slot++) {
          if (String(this.outputs[slot]?.type || "").toUpperCase() === BUS_TYPE) {
            drawCapsulePort(ctx, this, true, slot);
          }
        }
      }
    } catch (error) {
      console.warn("[TerryXu Wire Bus] Failed to draw bus capsule port", error);
    }
    return result;
  };

  const originalResize = node.onResize;
  node.onResize = function () {
    const result = originalResize?.apply?.(this, arguments);
    queueVueStyleRefresh();
    return result;
  };
}

function patchExistingBusNodes() {
  for (const graph of workflowBusGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) patchBusNode(node);
  }
  queueVueStyleRefresh();
}

function hideBusLinksForNativeDraw(graph) {
  const busLinks = allLinks(graph).filter((link) => isBusLink(graph, link));
  if (!busLinks.length) return () => {};

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
    for (const link of busLinks) {
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

function patchCanvas(canvas) {
  if (!canvas || canvas.__terryWireBusRibbonPatched || typeof canvas.drawConnections !== "function") return;
  canvas.__terryWireBusRibbonPatched = true;
  const original = canvas.drawConnections;
  const originalSetGraph = canvas.setGraph;

  if (typeof originalSetGraph === "function") {
    canvas.setGraph = function () {
      const result = originalSetGraph.apply(this, arguments);
      this.__terryWireBusActiveGraph = this.graph || app.graph;
      patchExistingBusNodes();
      return result;
    };
  }

  canvas.drawConnections = function (ctx) {
    const graph = this.graph || app.graph;
    if (this.__terryWireBusActiveGraph !== graph) {
      this.__terryWireBusActiveGraph = graph;
      patchExistingBusNodes();
    }
    const busLinks = allLinks(graph).filter((link) => isBusLink(graph, link));
    const restore = hideBusLinksForNativeDraw(graph);
    let result;
    try {
      result = original.apply(this, arguments);
    } finally {
      restore();
    }

    try {
      const baseWidth = Math.max(3, Number(this.connections_width) || 3);
      for (const link of busLinks) {
        const { origin, target, originSlot, targetSlot } = linkNodes(graph, link);
        if (!origin || !target) continue;
        const darkColor = busColor(link);
        drawBusCable(
          ctx,
          pointForOutput(origin, originSlot),
          pointForInput(target, targetSlot),
          darkColor,
          lightLaneColors(graph, link),
          baseWidth
        );
      }
    } catch (error) {
      console.warn("[TerryXu Wire Bus] Failed to draw bus cable", error);
    }
    return result;
  };
}

function ensurePatched() {
  patchCanvas(app.canvas);
  patchExistingBusNodes();
}

app.registerExtension({
  name: "TerryXu.WireBusVisual",
  setup() { ensurePatched(); },
  nodeCreated(node) { patchBusNode(node); },
  loadedGraphNode(node) { patchBusNode(node); patchCanvas(app.canvas); },
  afterConfigureGraph() { ensurePatched(); },
});
