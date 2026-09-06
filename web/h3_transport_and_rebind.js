import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryXuH3PromptEditor";
const LINKS_PROP = "terry_h3_virtual_media_links";
const BINDINGS_PROP = "terry_h3_subject_bindings";
const CARET = "\u200B";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function isTransportName(name) {
  const value = String(name || "");
  return /^asset\d*$/i.test(value) || value === "assets";
}

function pruneNodeData(nodeData) {
  if (!nodeData) return;
  for (const sectionName of ["required", "optional"]) {
    const section = nodeData.input?.[sectionName];
    if (!section || typeof section !== "object") continue;
    for (const key of Object.keys(section)) if (isTransportName(key)) delete section[key];
  }
  if (Array.isArray(nodeData.inputs)) nodeData.inputs = nodeData.inputs.filter((input) => !isTransportName(input?.name));
  for (const key of ["required", "optional"]) {
    if (Array.isArray(nodeData.input_order?.[key])) {
      nodeData.input_order[key] = nodeData.input_order[key].filter((name) => !isTransportName(name));
    }
  }
}

function removeInputAt(node, index) {
  const input = node?.inputs?.[index];
  if (!input) return;
  try { if (input.link != null) node.disconnectInput?.(index); } catch {}
  if (typeof node.removeInput === "function") node.removeInput(index);
  else node.inputs.splice(index, 1);
}

function pruneInstance(node) {
  if (!node?.inputs) return;
  for (let i = node.inputs.length - 1; i >= 0; i--) {
    if (isTransportName(node.inputs[i]?.name)) removeInputAt(node, i);
  }
  node._widgetSlotsDirty = true;
  node.setDirtyCanvas?.(true, true);
}

function virtualLinks(node) {
  node.properties ||= {};
  const links = Array.isArray(node.properties[LINKS_PROP]) ? node.properties[LINKS_PROP] : [];
  return links.filter((link) => app.graph?.getNodeById?.(Number(link?.source_id)));
}

function kindFor(source, slot, fallback = "") {
  const type = String(source?.outputs?.[slot]?.type || fallback || "").toUpperCase();
  if (type.includes("AUDIO")) return "audio";
  if (type.includes("VIDEO")) return "video";
  if (type.includes("IMAGE")) return "picture";
  const name = String(source?.comfyClass || source?.type || "").toLowerCase();
  if (name.includes("audio")) return "audio";
  if (name.includes("video")) return "video";
  return "picture";
}

function filename(source, kind) {
  const preferred = kind === "picture"
    ? ["image", "filename", "file"]
    : kind === "video"
      ? ["video", "file", "filename", "video_file", "videofile"]
      : ["audio", "file", "filename", "audio_file", "audiofile"];
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  const ordered = [...widgets.filter((w) => preferred.includes(String(w?.name || "").toLowerCase())), ...widgets];
  for (const w of ordered) {
    const value = w?.value;
    const file = typeof value === "object" ? (value?.filename || value?.name || "") : value;
    if (!file || /^(data:|blob:|https?:)/i.test(String(file))) continue;
    const name = String(w?.name || "").toLowerCase();
    if (preferred.includes(name) || /\.(png|jpe?g|webp|gif|bmp|tiff?|mp4|webm|mov|mkv|avi|m4v|mp3|wav|flac|ogg|m4a|aac)$/i.test(String(file))) return String(file);
  }
  return "";
}

function preview(source, kind) {
  if (!source || kind === "audio") return "";
  const file = filename(source, kind);
  if (file) {
    const w = (source.widgets || []).find((item) => {
      const value = item?.value;
      return String(typeof value === "object" ? (value?.filename || value?.name || "") : (value || "")) === file;
    });
    const value = w?.value;
    const q = new URLSearchParams({ filename: file, type: typeof value === "object" ? String(value.type || "input") : "input" });
    if (typeof value === "object" && value.subfolder) q.set("subfolder", String(value.subfolder));
    return api.apiURL(`/view?${q.toString()}`);
  }
  const img = (source.imgs || []).find((x) => x?.src);
  if (img?.src) return img.src;
  for (const w of source.widgets || []) {
    const el = w?.element;
    const image = el?.matches?.("img") ? el : el?.querySelector?.("img");
    if (image?.src) return image.src;
    const video = el?.matches?.("video") ? el : el?.querySelector?.("video");
    if (kind === "video" && (video?.poster || video?.currentSrc || video?.src)) return video.poster || video.currentSrc || video.src;
  }
  return "";
}

function assets(node) {
  const counts = { picture: 0, video: 0, audio: 0 };
  return virtualLinks(node).map((link) => {
    const source = app.graph?.getNodeById?.(Number(link.source_id));
    const slot = Number(link.source_slot) || 0;
    const kind = link.kind || kindFor(source, slot, link.source_type);
    counts[kind] = (counts[kind] || 0) + 1;
    const index = counts[kind];
    return {
      key: `${Number(link.source_id)}:${slot}`,
      kind,
      index,
      source,
      name: filename(source, kind).split(/[\\/]/).pop() || source?.title || `${kind} ${index}`,
      preview: preview(source, kind),
      tag: kind === "picture" ? `<Picture ${index}>` : kind === "video" ? `<Video ${index}>` : `<Audio ${index}>`,
    };
  });
}

function bindings(node) {
  node.properties ||= {};
  if (!node.properties[BINDINGS_PROP] || typeof node.properties[BINDINGS_PROP] !== "object" || Array.isArray(node.properties[BINDINGS_PROP])) {
    node.properties[BINDINGS_PROP] = {};
  }
  return node.properties[BINDINGS_PROP];
}

function bindSubject(node, subjectNumber, asset) {
  const map = bindings(node);
  for (const key of Object.keys(map)) {
    const list = Array.isArray(map[key]) ? map[key].map(Number) : [];
    const next = list.filter((value) => value !== subjectNumber);
    if (next.length) map[key] = next;
    else delete map[key];
  }
  map[asset.key] ||= [];
  if (!map[asset.key].map(Number).includes(subjectNumber)) map[asset.key].push(subjectNumber);
}

function parseChip(chip) {
  const raw = String(chip?.dataset?.raw || "");
  let match = raw.match(/^<Picture\s+(\d+)>$/i);
  if (match) return { type: "picture", number: Number(match[1]), raw };
  match = raw.match(/^<Video\s+(\d+)>$/i);
  if (match) return { type: "video", number: Number(match[1]), raw };
  match = raw.match(/^<Audio\s+(\d+)>$/i);
  if (match) return { type: "audio", number: Number(match[1]), raw };
  match = raw.match(/^<Subject\s+(\d+)>$/i);
  if (match) return { type: "subject", number: Number(match[1]), raw };
  return null;
}

function compatibleAssets(node, chipInfo) {
  const list = assets(node);
  if (chipInfo.type === "subject") return list.filter((asset) => asset.kind === "picture" || asset.kind === "video");
  return list.filter((asset) => asset.kind === chipInfo.type);
}

function closePicker(node) {
  node.__terryH3RebindMenu?.remove?.();
  node.__terryH3RebindMenu = null;
}

function syncPrompt(node) {
  const editor = node.__terryH3Editor;
  if (!editor) return;
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: null }));
  node.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function renderChipForAsset(chip, info, asset) {
  if (info.type === "subject") {
    chip.className = "terry-h3-chip terry-h3-subject-asset-chip terry-h3-strong";
    chip.replaceChildren();
    if (asset.preview) {
      const img = document.createElement("img");
      img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
    } else {
      const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = "◇"; chip.append(icon);
    }
    const label = document.createElement("span"); label.textContent = `Subject ${info.number}`; chip.append(label);
    chip.title = `Subject ${info.number} · 来源 ${asset.name}`;
    return;
  }
  chip.dataset.raw = asset.tag;
  chip.className = "terry-h3-chip terry-h3-media-chip";
  chip.replaceChildren();
  if (asset.preview && asset.kind !== "audio") {
    const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; img.draggable = false; chip.append(img);
  } else {
    const icon = document.createElement("span"); icon.className = "terry-h3-media-icon"; icon.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧"; chip.append(icon);
  }
  const label = document.createElement("span"); label.textContent = asset.tag.slice(1, -1); chip.append(label);
  chip.title = asset.name;
}

function chooseAsset(node, chip, info, asset) {
  if (info.type === "subject") bindSubject(node, info.number, asset);
  renderChipForAsset(chip, info, asset);
  closePicker(node);
  syncPrompt(node);
}

function openPicker(node, chip, info) {
  closePicker(node);
  const options = compatibleAssets(node, info);
  const menu = document.createElement("div");
  menu.className = "terry-h3-rebind-menu";
  node.__terryH3RebindMenu = menu;
  const head = document.createElement("div");
  head.className = "terry-h3-rebind-head";
  const title = document.createElement("b");
  title.textContent = info.type === "subject" ? `Subject ${info.number} · 切换来源资产` : `${info.raw.slice(1, -1)} · 切换资产`;
  const hint = document.createElement("small");
  hint.textContent = info.type === "subject" ? "仅显示图片 / 视频" : `仅显示 ${info.type === "picture" ? "图片" : info.type === "video" ? "视频" : "音频"}`;
  head.append(title, hint); menu.append(head);
  if (!options.length) {
    const empty = document.createElement("div"); empty.className = "terry-h3-rebind-empty"; empty.textContent = "没有可用的兼容资产"; menu.append(empty);
  }
  for (const asset of options) {
    const item = document.createElement("button"); item.type = "button"; item.className = "terry-h3-rebind-item";
    const thumb = document.createElement("span"); thumb.className = "terry-h3-rebind-thumb";
    if (asset.preview && asset.kind !== "audio") { const img = document.createElement("img"); img.src = asset.preview; img.alt = ""; thumb.append(img); }
    else thumb.textContent = asset.kind === "audio" ? "♪" : asset.kind === "video" ? "▶" : "▧";
    const text = document.createElement("span");
    const main = document.createElement("b"); main.textContent = asset.tag.slice(1, -1);
    const sub = document.createElement("small"); sub.textContent = asset.name;
    text.append(main, sub); item.append(thumb, text);
    item.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); chooseAsset(node, chip, info, asset); });
    menu.append(item);
  }
  document.body.append(menu);
  const rect = chip.getBoundingClientRect();
  const width = 300;
  let left = rect.left;
  let top = rect.bottom + 6;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  const height = Math.min(340, menu.offsetHeight || 260);
  if (top + height > window.innerHeight - 8) top = Math.max(8, rect.top - height - 6);
  menu.style.left = `${Math.max(8, Math.round(left))}px`;
  menu.style.top = `${Math.max(8, Math.round(top))}px`;
}

function bindEditor(node) {
  const editor = node?.__terryH3Editor;
  if (!editor || editor.__terryH3RebindBound) return false;
  editor.__terryH3RebindBound = true;
  editor.addEventListener("pointerdown", (event) => {
    const chip = event.target?.closest?.(".terry-h3-chip");
    if (!chip || !editor.contains(chip)) return;
    const info = parseChip(chip);
    if (!info) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    openPicker(node, chip, info);
  }, true);
  return true;
}

function installSoon(node) {
  if (!isTarget(node)) return;
  pruneInstance(node);
  let attempts = 0;
  const retry = () => {
    attempts += 1;
    pruneInstance(node);
    if (bindEditor(node) || attempts >= 12) return;
    setTimeout(retry, Math.min(900, 60 * attempts));
  };
  setTimeout(retry, 0);
}

function installStyle() {
  if (document.getElementById("terry-h3-rebind-style")) return;
  const style = document.createElement("style");
  style.id = "terry-h3-rebind-style";
  style.textContent = `
.terry-h3-media-chip,.terry-h3-subject-asset-chip{cursor:pointer!important}.terry-h3-media-chip:hover,.terry-h3-subject-asset-chip:hover{box-shadow:inset 0 0 0 1px rgba(0,226,187,.38),0 0 0 1px rgba(0,226,187,.12)!important}
.terry-h3-subject-asset-chip img{width:26px;height:26px;object-fit:cover;border-radius:3px}
.terry-h3-rebind-menu{position:fixed;z-index:10120;width:300px;max-height:340px;overflow:auto;padding:5px;border:1px solid rgba(255,255,255,.15);border-radius:9px;background:var(--comfy-menu-bg,#202225);box-shadow:0 16px 38px rgba(0,0,0,.48);color:var(--input-text,#ddd)}
.terry-h3-rebind-head{position:sticky;top:-5px;z-index:2;padding:8px 9px;border-bottom:1px solid rgba(255,255,255,.09);background:var(--comfy-menu-bg,#202225)}.terry-h3-rebind-head b,.terry-h3-rebind-head small{display:block}.terry-h3-rebind-head b{font:600 12px/1.3 system-ui,sans-serif}.terry-h3-rebind-head small{margin-top:3px;font:10px/1.2 system-ui,sans-serif;opacity:.5}
.terry-h3-rebind-item{display:grid;grid-template-columns:38px minmax(0,1fr);gap:8px;align-items:center;width:100%;min-height:45px;padding:5px 7px;border:0;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer}.terry-h3-rebind-item:hover{background:rgba(255,255,255,.09)}
.terry-h3-rebind-thumb{display:grid;place-items:center;width:36px;height:36px;border-radius:5px;background:rgba(255,255,255,.08);overflow:hidden}.terry-h3-rebind-thumb img{width:100%;height:100%;object-fit:cover}.terry-h3-rebind-item b,.terry-h3-rebind-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.terry-h3-rebind-item b{font:600 12px/1.3 Consolas,monospace}.terry-h3-rebind-item small{margin-top:2px;font:10px/1.2 system-ui,sans-serif;opacity:.52}.terry-h3-rebind-empty{padding:12px;font:11px/1.4 system-ui,sans-serif;opacity:.62}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TransportAndRebind",
  setup() {
    installStyle();
    document.addEventListener("pointerdown", (event) => {
      for (const node of app.graph?._nodes || []) {
        if (!isTarget(node) || !node.__terryH3RebindMenu) continue;
        if (node.__terryH3RebindMenu.contains(event.target)) continue;
        closePicker(node);
      }
    }, true);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;
    pruneNodeData(nodeData);
    if (nodeType?.nodeData && nodeType.nodeData !== nodeData) pruneNodeData(nodeType.nodeData);
    if (nodeType?.prototype?.constructor?.nodeData && nodeType.prototype.constructor.nodeData !== nodeData) pruneNodeData(nodeType.prototype.constructor.nodeData);
    if (nodeType.prototype.__terryH3TransportRebindInstalled) return;
    nodeType.prototype.__terryH3TransportRebindInstalled = true;
    for (const hook of ["onNodeCreated", "onAdded", "onConfigure"]) {
      const original = nodeType.prototype[hook];
      nodeType.prototype[hook] = function() {
        const result = original?.apply(this, arguments);
        installSoon(this);
        return result;
      };
    }
    const draw = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function() {
      const result = draw?.apply(this, arguments);
      pruneInstance(this);
      bindEditor(this);
      return result;
    };
  },
  loadedGraphNode(node) { installSoon(node); },
});
