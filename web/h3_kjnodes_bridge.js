import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const H3_NODE_ID = "TerryXuH3PromptEditor";

function graphLink(graph, linkId) {
  if (!graph || linkId == null) return null;
  for (const links of [graph.links, graph._links]) {
    if (!links) continue;
    if (typeof links.get === "function") {
      const found = links.get(linkId) ?? links.get(String(linkId));
      if (found) return found;
    }
    const found = links[linkId] ?? links[String(linkId)];
    if (found) return found;
  }
  return null;
}

function graphAncestors(graph) {
  if (!graph) return [];
  const root = graph.rootGraph || app.graph || graph;
  if (graph === root) return [graph];
  const chain = [graph];
  const visited = new Set(chain);
  let current = graph;
  while (current && current !== root) {
    let parent = current.parent || current._parent || current._subgraph_node?.graph || null;
    if (!parent && root?._nodes) {
      for (const n of root._nodes) {
        if (n?.subgraph === current) { parent = root; break; }
      }
    }
    if (!parent) {
      const subgraphs = root?._subgraphs || root?.subgraphs;
      if (subgraphs?.values) {
        outer: for (const sg of subgraphs.values()) {
          for (const n of sg?._nodes || []) {
            if (n?.subgraph === current) { parent = sg; break outer; }
          }
        }
      }
    }
    if (!parent || visited.has(parent)) break;
    visited.add(parent);
    chain.push(parent);
    current = parent;
  }
  if (root && !chain.includes(root)) chain.push(root);
  return chain;
}

function findSetter(getNode) {
  const name = getNode?.widgets?.[0]?.value;
  if (!name) return null;
  for (const graph of graphAncestors(getNode.graph || app.graph)) {
    for (const node of graph?._nodes || []) {
      if ((node?.type === "SetNode" || node?.comfyClass === "SetNode") && node?.widgets?.[0]?.value === name) {
        return { node, graph };
      }
    }
  }
  return null;
}

function resolveUpstream(getNode) {
  const setter = findSetter(getNode);
  if (!setter) return null;
  let graph = setter.graph;
  let linkId = setter.node?.inputs?.[0]?.link;
  const seen = new Set();
  for (let hops = 0; hops < 64 && linkId != null; hops++) {
    const key = `${graph?.id || "g"}:${linkId}`;
    if (seen.has(key)) return null;
    seen.add(key);
    const link = graphLink(graph, linkId);
    if (!link) return null;
    const source = graph?.getNodeById?.(link.origin_id ?? link.originId);
    if (!source) return null;
    const isReroute = source.type === "Reroute" || source.comfyClass === "Reroute";
    if (isReroute && source.inputs?.[0]?.link != null) { linkId = source.inputs[0].link; continue; }
    const isGet = source.type === "GetNode" || source.comfyClass === "GetNode";
    if (isGet) {
      const nestedSetter = findSetter(source);
      if (!nestedSetter || nestedSetter.node?.inputs?.[0]?.link == null) return null;
      graph = nestedSetter.graph;
      linkId = nestedSetter.node.inputs[0].link;
      continue;
    }
    return { node: source, slot: Number(link.origin_slot ?? link.originSlot ?? 0) || 0 };
  }
  return null;
}

function selectedMediaValue(node, kind) {
  if (!node) return null;
  const preferred = {
    IMAGE: ["image", "filename", "file"],
    VIDEO: ["video", "file", "filename", "video_file", "videofile"],
    AUDIO: ["audio", "file", "filename", "audio_file", "audiofile"],
  }[kind] || ["image", "video", "audio", "file", "filename"];
  const widgets = Array.isArray(node.widgets) ? node.widgets : [];
  const preferredSet = new Set(preferred);
  const ordered = [...widgets.filter((w) => preferredSet.has(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    if (!value) continue;
    const filename = typeof value === "object" ? (value.filename || value.name) : value;
    if (!filename || /^(data:|blob:|https?:)/i.test(String(filename))) continue;
    const ext = String(filename);
    const matches = kind === "IMAGE" ? /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(ext) : kind === "VIDEO" ? /\.(mp4|webm|mov|mkv|avi|m4v)$/i.test(ext) : kind === "AUDIO" ? /\.(mp3|wav|flac|ogg|m4a|aac)$/i.test(ext) : true;
    if (preferredSet.has(String(w?.name || "").toLowerCase()) || matches) return { value, filename: String(filename) };
  }
  return null;
}

function makeViewUrl(media) {
  if (!media?.filename) return "";
  const value = media.value;
  const q = new URLSearchParams({
    filename: media.filename,
    type: typeof value === "object" ? String(value.type || "input") : "input",
    subfolder: typeof value === "object" ? String(value.subfolder || "") : "",
  });
  return api.apiURL(`/view?${q.toString()}`);
}

function outputType(getNode, upstream) {
  const getType = String(getNode?.outputs?.[0]?.type || "").toUpperCase();
  if (getType && getType !== "*") return getType;
  return String(upstream?.node?.outputs?.[upstream.slot]?.type || "").toUpperCase();
}

function syncGetNodePreview(getNode) {
  const upstream = resolveUpstream(getNode);
  if (!upstream) return false;
  const kind = outputType(getNode, upstream);
  if (kind !== "IMAGE" && kind !== "VIDEO") return false;
  const media = selectedMediaValue(upstream.node, kind);
  let previewUrl = "";
  if (kind === "IMAGE") {
    previewUrl = makeViewUrl(media) || upstream.node?.imgs?.find?.((x) => x?.src)?.src || "";
  } else {
    for (const w of upstream.node?.widgets || []) {
      const el = w?.element;
      const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
      if (video?.poster) { previewUrl = video.poster; break; }
      if (video?.currentSrc || video?.src) { previewUrl = video.currentSrc || video.src; break; }
    }
  }
  const signature = `${kind}|${media?.filename || ""}|${previewUrl}`;
  if (getNode.__terryH3PreviewSignature === signature) return false;
  getNode.__terryH3PreviewSignature = signature;
  if (previewUrl) {
    const image = new Image();
    image.src = previewUrl;
    getNode.imgs = [image];
  } else if (upstream.node?.imgs?.length) {
    getNode.imgs = upstream.node.imgs;
  } else {
    getNode.imgs = [];
  }
  getNode.__terryH3ResolvedSource = upstream.node;
  return true;
}

function allGraphs(root) {
  if (!root) return [];
  const result = [root];
  const seen = new Set(result);
  const queue = [root];
  while (queue.length) {
    const graph = queue.shift();
    for (const n of graph?._nodes || []) {
      if (n?.subgraph && !seen.has(n.subgraph)) {
        seen.add(n.subgraph);
        result.push(n.subgraph);
        queue.push(n.subgraph);
      }
    }
  }
  return result;
}

function refreshH3Nodes() {
  for (const graph of allGraphs(app.graph)) {
    for (const node of graph?._nodes || []) {
      if (node?.comfyClass === H3_NODE_ID || node?.constructor?.type === H3_NODE_ID) {
        node.__terryH3?.connectionChanged?.();
        node.__terryH3Editor?.refresh?.();
      }
    }
  }
}

let timer = null;
function startBridge() {
  if (timer) return;
  timer = setInterval(() => {
    let changed = false;
    for (const graph of allGraphs(app.graph)) {
      for (const node of graph?._nodes || []) {
        if (node?.type === "GetNode" || node?.comfyClass === "GetNode") changed = syncGetNodePreview(node) || changed;
      }
    }
    if (changed) refreshH3Nodes();
  }, 250);
}

app.registerExtension({
  name: "TerryXu.H3KJNodesBridge",
  setup() { startBridge(); },
  loadedGraphNode() { startBridge(); },
});
