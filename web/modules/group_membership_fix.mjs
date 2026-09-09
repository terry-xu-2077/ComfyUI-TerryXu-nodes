import { app } from "../../scripts/app.js";

const TOP_EDGE_GROUP_TYPES = new Set([
  "TerryXuGroupManager",
  "TerryXuWireBusPack",
  "TerryXuWireBusUnpack",
  "TerryXuWirelessBusPack",
  "TerryXuWirelessBusUnpack",
]);

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function rectOf(item) {
  const bounds = item?._bounding || item?.boundingRect;
  if (bounds?.length >= 4) {
    const rect = [Number(bounds[0]), Number(bounds[1]), Number(bounds[2]), Number(bounds[3])];
    if (rect.every(Number.isFinite)) return rect;
  }
  const pos = item?._pos || item?.pos;
  const size = item?._size || item?.size;
  if (pos?.length >= 2 && size?.length >= 2) {
    const rect = [Number(pos[0]), Number(pos[1]), Number(size[0]), Number(size[1])];
    if (rect.every(Number.isFinite)) return rect;
  }
  return null;
}

function visualTopInsideGroup(node, groupRect) {
  const nodeRect = rectOf(node);
  if (!nodeRect || !groupRect) return false;
  const [gx, gy, gw, gh] = groupRect;
  const [nx, ny, nw] = nodeRect;
  const horizontalOverlap = nx + nw > gx && nx < gx + gw;
  return horizontalOverlap && ny >= gy - 1 && ny <= gy + gh + 1;
}

function addGroupChild(group, node) {
  const children = group?._children;
  if (!children) {
    group._children = new Set([node]);
    return;
  }
  if (typeof children.add === "function") {
    children.add(node);
    return;
  }
  if (typeof children.set === "function") {
    children.set(node, node);
    return;
  }
  if (Array.isArray(children)) {
    if (!children.includes(node)) children.push(node);
    return;
  }
  children[String(node?.id ?? node?._id ?? Math.random())] = node;
}

function patchGroupMembership() {
  const Group = globalThis.LGraphGroup || globalThis.LiteGraph?.LGraphGroup;
  const proto = Group?.prototype;
  if (!proto || proto.__terryTopEdgeMembershipPatched) return false;
  const original = proto.recomputeInsideNodes;
  if (typeof original !== "function") return false;

  proto.recomputeInsideNodes = function () {
    const result = original.apply(this, arguments);
    try {
      const graph = this.graph || app.canvas?.graph || app.graph;
      const groupRect = rectOf(this);
      if (groupRect) {
        for (const node of graph?._nodes || graph?.nodes || []) {
          if (!TOP_EDGE_GROUP_TYPES.has(nodeType(node))) continue;
          if (visualTopInsideGroup(node, groupRect)) addGroupChild(this, node);
        }
      }
    } catch (error) {
      console.warn("[TerryXu] top-edge group membership refresh failed", error);
    }
    return result;
  };
  proto.__terryTopEdgeMembershipPatched = true;
  return true;
}

function ensurePatched() {
  patchGroupMembership();
}

app.registerExtension({
  name: "TerryXu.TopEdgeGroupMembership",
  setup() { ensurePatched(); },
  nodeCreated() { ensurePatched(); },
  loadedGraphNode() { ensurePatched(); },
  afterConfigureGraph() { ensurePatched(); },
});
