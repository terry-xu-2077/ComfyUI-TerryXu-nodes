import { app } from "../../scripts/app.js";

const REMOTE_TYPE = "TerryXuRemoteControl";

function nodeType(node) {
  return String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
}

function isRemote(node) {
  return nodeType(node) === REMOTE_TYPE;
}

function unlockResize(node) {
  if (!isRemote(node) || node.__terryRemoteResizeUnlocked) return;

  // line_switch.js refreshes remote controllers frequently and historically
  // set `resizable = false` every time.  Lock this instance to the normal
  // LiteGraph behaviour (`resizable !== false`) so later refreshes cannot
  // disable the resize handles again.  The node's current size is untouched,
  // therefore user-resized dimensions continue to serialize with the workflow.
  try {
    delete node.resizable;
    Object.defineProperty(node, "resizable", {
      configurable: true,
      enumerable: true,
      get() { return true; },
      set() {},
    });
  } catch {
    node.resizable = true;
  }

  node.__terryRemoteResizeUnlocked = true;
  node.graph?.setDirtyCanvas?.(true, true);
  node.setDirtyCanvas?.(true, true);
}

function allGraphs(root = app.graph?.rootGraph || app.rootGraph || app.graph) {
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
      if (node?.subgraph) queue.push(node.subgraph);
    }
    for (const collection of [graph?.subgraphs, graph?._subgraphs]) {
      if (!collection) continue;
      const values = typeof collection.values === "function" ? collection.values() : Object.values(collection);
      for (const value of values) queue.push(value?.subgraph || value);
    }
  }
  return result;
}

function unlockAll() {
  for (const graph of allGraphs()) {
    for (const node of graph?._nodes || graph?.nodes || []) unlockResize(node);
  }
}

app.registerExtension({
  name: "TerryXu.RemoteControlResizable",

  nodeCreated(node) {
    if (isRemote(node)) queueMicrotask(() => unlockResize(node));
  },

  loadedGraphNode(node) {
    if (isRemote(node)) queueMicrotask(() => unlockResize(node));
  },

  afterConfigureGraph() {
    queueMicrotask(unlockAll);
  },
});
