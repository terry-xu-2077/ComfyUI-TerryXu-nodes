import { app } from "../../scripts/app.js";

const BUS_PACK_TYPES = new Set([
  "TerryXuWireBusPack",
  "TerryXuWirelessBusPack",
]);

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

function rootGraph(graph = app.graph) {
  return graph?.rootGraph || app.graph?.rootGraph || app.graph || graph || null;
}

function allGraphs(root = rootGraph()) {
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

  return result;
}

function collectBusSourceIds() {
  const ids = new Set();

  for (const graph of allGraphs()) {
    for (const pack of graph?._nodes || graph?.nodes || []) {
      if (!BUS_PACK_TYPES.has(nodeType(pack))) continue;

      let entries = [];
      try {
        entries = pack.__terryBusLaneEntries?.() || [];
      } catch {}

      for (const entry of entries) {
        const sourceId = entry?.source?.nodeId ?? entry?.source?.node?.id;
        if (sourceId == null || sourceId === "") continue;
        ids.add(String(sourceId));
      }
    }
  }

  return ids;
}

function isConnectionValue(value) {
  return Array.isArray(value)
    && value.length === 2
    && (typeof value[0] === "string" || typeof value[0] === "number")
    && Number.isInteger(Number(value[1]));
}

function isBusSourceReference(sourceExecutionId, busSourceIds) {
  const executionId = String(sourceExecutionId ?? "");
  if (!executionId) return false;
  if (busSourceIds.has(executionId)) return true;

  for (const localId of busSourceIds) {
    if (executionId.endsWith(`:${localId}`)) return true;
  }
  return false;
}

function hasPromptNode(prompt, id) {
  if (id == null || id === "") return false;
  return Object.prototype.hasOwnProperty.call(prompt, String(id));
}

function sanitizeDanglingBusReferences(prompt) {
  if (!prompt || typeof prompt !== "object") return;

  const busSourceIds = collectBusSourceIds();
  if (!busSourceIds.size) return;

  for (const [executionId, promptNode] of Object.entries(prompt)) {
    const inputs = promptNode?.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    for (const [inputName, value] of Object.entries(inputs)) {
      if (!isConnectionValue(value)) continue;

      const sourceExecutionId = value[0];
      if (hasPromptNode(prompt, sourceExecutionId)) continue;
      if (!isBusSourceReference(sourceExecutionId, busSourceIds)) continue;

      // The bus topology can still retain a physical source link while ComfyUI
      // intentionally omits that source from the final execution prompt (for
      // example when the source node is bypassed / skipped). Never manufacture
      // a dangling execution reference. Treat that bus lane as disconnected for
      // this run; if the downstream input is required, ComfyUI will report the
      // normal missing-input validation error instead of an invalid node id.
      delete inputs[inputName];
      console.debug(
        `[TerryXu Wire Bus] Omitted inactive bus source ${String(sourceExecutionId)} -> ${executionId}.${inputName}`
      );
    }
  }
}

function patchGraphToPrompt() {
  const current = app.graphToPrompt;
  if (typeof current !== "function" || current.__terryWireBusDanglingSourceGuard) return;

  const wrapped = async function (...args) {
    const result = await current.apply(this, args);
    sanitizeDanglingBusReferences(result?.output);
    return result;
  };
  wrapped.__terryWireBusDanglingSourceGuard = true;
  app.graphToPrompt = wrapped;
}

app.registerExtension({
  name: "TerryXu.WireBusDanglingSourceGuard",
  setup() {
    patchGraphToPrompt();
    queueMicrotask(patchGraphToPrompt);
    setTimeout(patchGraphToPrompt, 0);
  },
  afterConfigureGraph() {
    patchGraphToPrompt();
  },
});
