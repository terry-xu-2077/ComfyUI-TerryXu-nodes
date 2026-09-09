import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { serializeH3RichText } from "./h3_rich_text.js";

const NODE_ID = "TerryXuH3PromptEditor";
const LINKS_PROP = "terry_h3_virtual_media_links";
const BINDINGS_PROP = "terry_h3_subject_bindings";
function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name) || null;
}

function sourceKind(source, slot = 0, fallback = "") {
  const type = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (type.includes("AUDIO")) return "audio";
  if (type.includes("VIDEO")) return "video";
  if (type.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("audio")) return "audio";
  if (name.includes("video")) return "video";
  return "picture";
}

function filenameFromSource(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const filename = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!filename || /^(data:|blob:|https?:)/i.test(String(filename))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(filename))) return String(filename);
  }
  return "";
}

function previewFromSource(source, kind) {
  if (!source || kind === "audio") return "";
  const filename = filenameFromSource(source, kind);
  if (filename) {
    const sourceWidget = (source.widgets || []).find((w) => {
      const value = w?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === filename;
    });
    const value = sourceWidget?.value;
    const query = new URLSearchParams({
      filename,
      type: typeof value === "object" ? String(value.type || "input") : "input",
    });
    if (typeof value === "object" && value.subfolder) query.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${query.toString()}`);
  }
  const img = (source.imgs || []).find((item) => item?.src);
  if (img?.src) return img.src;
  for (const w of source.widgets || []) {
    const element = w?.element;
    const image = element?.matches?.("img") ? element : element?.querySelector?.("img");
    if (image?.src) return image.src;
    const video = element?.matches?.("video") ? element : element?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}

function assetOptions(node) {
  const links = Array.isArray(node?.properties?.[LINKS_PROP]) ? node.properties[LINKS_PROP] : [];
  const counts = { picture: 0, video: 0, audio: 0 };
  const out = [];
  for (const link of links) {
    const sourceId = Number(link?.source_id);
    const sourceSlot = Number(link?.source_slot) || 0;
    const source = (node?.graph || app.graph)?.getNodeById?.(sourceId);
    if (!source || !Number.isFinite(sourceId)) continue;
    const kind = link?.kind || sourceKind(source, sourceSlot, link?.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    out.push({
      key: `${sourceId}:${sourceSlot}`,
      kind,
      index: counts[kind],
      source,
      preview: previewFromSource(source, kind),
    });
  }
  return out;
}

function boundAssetForSubject(node, subjectNumber) {
  const bindings = node?.properties?.[BINDINGS_PROP];
  if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return null;
  const number = Number(subjectNumber);
  const entry = Object.entries(bindings).find(([, subjects]) =>
    Array.isArray(subjects) && subjects.some((value) => Number(value) === number)
  );
  if (!entry) return null;
  return assetOptions(node).find((asset) => asset.key === entry[0]) || null;
}

function refreshSubjectThumbnails(node) {
  const editor = node?.__terryH3Editor;
  if (!editor || node?.properties?.terry_h3_view_mode === "raw") return;
  const chips = editor.querySelectorAll?.(".terry-h3-chip[data-raw]") || [];
  for (const chip of chips) {
    const match = String(chip.dataset?.raw || "").match(/^<Subject\s+(\d+)>$/i);
    if (!match) continue;
    const asset = boundAssetForSubject(node, Number(match[1]));
    const label = `Subject ${match[1]}`;
    chip.classList.add("terry-h3-strong");
    if (!asset) {
      if (!chip.querySelector("img")) chip.textContent = `◇ ${label}`;
      continue;
    }
    const current = chip.querySelector("img")?.src || "";
    if (asset.preview && current === asset.preview && chip.textContent.includes(label)) continue;
    chip.replaceChildren();
    if (asset.preview && asset.kind !== "audio") {
      const img = document.createElement("img");
      img.src = asset.preview;
      img.alt = "";
      img.draggable = false;
      chip.append(img);
    } else {
      const icon = document.createElement("span");
      icon.className = "terry-h3-media-icon";
      icon.textContent = "◇";
      chip.append(icon);
    }
    const text = document.createElement("span");
    text.textContent = label;
    chip.append(text);
    chip.classList.add("terry-h3-subject-asset-chip");
  }
}

function serializeEditor(editor) {
  return serializeH3RichText(editor);
}

function syncBeforeViewSwitch(node) {
  const editor = node?.__terryH3Editor;
  const prompt = widget(node, "prompt");
  if (!editor || !prompt) return;
  const raw = serializeEditor(editor);
  prompt.value = raw;
  if (prompt._state) prompt._state.value = raw;
}

function bind(node) {
  if (!isTarget(node)) return false;
  const editor = node.__terryH3Editor;
  const button = node.__terryH3ViewButton;
  if (!editor || !button) return false;

  if (!button.__terryH3StableViewBound) {
    button.__terryH3StableViewBound = true;
    // Capture the current editor text before the original view-switch handler runs.
    // This also preserves line breaks created by contenteditable as DIV/P blocks.
    button.addEventListener("click", () => syncBeforeViewSwitch(node), true);
    button.addEventListener("click", () => {
      queueMicrotask(() => refreshSubjectThumbnails(node));
    });
  }

  if (!editor.__terryH3StableThumbnailBound) {
    editor.__terryH3StableThumbnailBound = true;
    editor.addEventListener("focus", () => refreshSubjectThumbnails(node));
  }

  refreshSubjectThumbnails(node);
  node.__terryH3RefreshSubjectThumbnails = () => refreshSubjectThumbnails(node);
  return true;
}

function bindSoon(node) {
  if (!isTarget(node)) return;
  if (bind(node)) return;
  for (const delay of [0, 60, 180, 500]) setTimeout(() => bind(node), delay);
}

function installStyle() {
  if (document.getElementById("terry-h3-view-stability-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-view-stability-style";
  style.textContent = `
.terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px;margin-right:1px}
.terry-h3-subject-asset-chip{color:rgba(210,235,255,.98);background:rgba(90,169,240,.12)}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3PromptEditorViewStability",
  setup() { installStyle(); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID || nodeType.prototype.__terryH3ViewStabilityInstalled) return;
    nodeType.prototype.__terryH3ViewStabilityInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const old = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = old?.apply(this, arguments);
        bindSoon(this);
        return result;
      };
    }
  },
  loadedGraphNode(node) { bindSoon(node); },
});
