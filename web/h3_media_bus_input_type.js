import { app } from "../../scripts/app.js";

const TARGETS = new Set(["TerryXuH3PromptEditor", "TerryXuH3ShotTimeline"]);
const MEDIA_INPUT_TYPE = "IMAGE,VIDEO,AUDIO,TERRY_WIRE_BUS";

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

function applyMediaType(node) {
  if (!TARGETS.has(nodeType(node))) return false;
  const input = node?.inputs?.find?.((slot) => String(slot?.name || "") === "media");
  if (!input) return false;
  if (input.type === MEDIA_INPUT_TYPE) return false;
  input.type = MEDIA_INPUT_TYPE;
  node._widgetSlotsDirty = true;
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
  return true;
}

function applyAll() {
  for (const node of app.graph?._nodes || []) applyMediaType(node);
}

let timer = null;
function start() {
  if (timer) return;
  timer = setInterval(applyAll, 200);
  queueMicrotask(applyAll);
}

app.registerExtension({
  name: "TerryXu.H3MediaBusInputType",
  setup() {
    start();
  },
  nodeCreated(node) {
    applyMediaType(node);
    queueMicrotask(() => applyMediaType(node));
    start();
  },
  loadedGraphNode(node) {
    applyMediaType(node);
    queueMicrotask(() => applyMediaType(node));
    start();
  },
  afterConfigureGraph() {
    applyAll();
    queueMicrotask(applyAll);
    start();
  },
});
