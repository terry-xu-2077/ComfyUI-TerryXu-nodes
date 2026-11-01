import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { syncMediaBusOutputs, mediaAssetHasReferences } from "./wire_bus.js";
import { MEDIA_KINDS, MEDIA_LABELS, readMedia, mediaFile, moveMedia, emptyMediaSlot, removeMedia, mediaLanes } from "./media_loader_model.mjs";

const NODE_ID = "TerryXuMediaLoader";
let directorModule;

function installStyle() {
  if (document.getElementById("terry-media-loader-style")) return;
  const link = document.createElement("link");
  link.id = "terry-media-loader-style"; link.rel = "stylesheet";
  link.href = new URL("./media_loader.css", import.meta.url).href;
  document.head.append(link);
}

async function getDirectorPicker() {
  if (!directorModule) directorModule = api.fetchApi("/extensions").then(r => r.json()).then(files => {
    const entry = files.find(path => /\/td_asset_picker\.js$/.test(path));
    return entry ? import(entry) : null;
  });
  return directorModule;
}

async function openNativePicker(kind, anchor, onSelect, onClose) {
  const response = await api.fetchApi(`/terryxu/media-loader/picker?kind=${kind}`);
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "无法打开资产选择器");
  const { default: component } = await import(new URL(`../../${data.component.slice(1)}`, import.meta.url).href);
  const field = kind === "image" ? "image" : kind === "audio" ? "audio" : "file";
  const nodeType = kind === "image" ? "LoadImage" : kind === "audio" ? "LoadAudio" : "LoadVideo";
  const widget = { name: field, type: "combo", value: "", options: { values: data.files },
    spec: { name: field, type: "COMBO", options: data.files, [`${kind}_upload`]: true } };
  const key = "extension-terry-media-picker";
  let dialog, closed = false, observer;
  const close = () => { if (closed) return; closed = true; observer?.disconnect(); dialog?.closeDialog(); };
  const selected = value => {
    if (!value || closed) return;
    onSelect(mediaFile({ path: value }, kind, crypto.randomUUID())); close();
  };
  widget.callback = selected;
  dialog = app.extensionManager.dialog.showExtensionDialog({ key, component,
    props: { widget, nodeType, modelValue: "", "onUpdate:modelValue": selected },
    dialogComponentProps: { headless: true, contentClass: "terry-media-native-host",
      onClose: () => { closed = true; observer?.disconnect(); onClose(); } },
  });
  // Open the same native dropdown used by LoadImage/LoadAudio/LoadVideo.
  const rect = anchor.getBoundingClientRect();
  const open = () => {
    const host = document.querySelector(".terry-media-native-host");
    const trigger = host?.querySelector("button");
    if (!trigger) return;
    observer.disconnect();
    host.style.left = `${Math.min(rect.left, innerWidth - 300)}px`;
    host.style.top = `${Math.max(8, Math.min(rect.top, innerHeight - 80))}px`;
    trigger.click();
  };
  observer = new MutationObserver(open);
  observer.observe(document.body, { childList: true, subtree: true }); open();
  return { close };
}

function viewURL(asset) {
  const parts = asset.path.split("/");
  const filename = parts.pop();
  return api.apiURL(`/view?${new URLSearchParams({ filename, subfolder: parts.join("/"), type: asset.source })}`);
}

function install(node) {
  if (node.__terryMediaLoader) return;
  installStyle();
  const storage = node.widgets.find(widget => widget.name === "assets_json");
  storage.type = "hidden"; storage.hidden = true;
  Object.assign(storage.options, { hidden: true, canvasOnly: true });
  storage.computeSize = () => [0, -4];
  if (storage.element) storage.element.hidden = true;
  let picker, disposed = false, dragging = null, renderedValue;
  const root = document.createElement("div"); root.className = "terry-media-loader";
  const error = document.createElement("div"); error.className = "terry-media-error"; error.role = "status"; error.hidden = true;
  const sections = document.createElement("div"); sections.className = "terry-media-sections";
  root.append(sections, error);
  const groups = () => readMedia(storage.value);
  const report = message => { error.textContent = message; error.hidden = !message; };
  const update = next => {
    const tracker = app.extensionManager.workflow.activeWorkflow?.changeTracker;
    tracker?.captureCanvasState();
    node.graph?.beforeChange();
    storage.value = JSON.stringify(next);
    render();
    syncMediaBusOutputs(node);
    node.graph?.afterChange();
    node.graph?.change();
    tracker?.captureCanvasState();
    node.setDirtyCanvas(true, true);
  };
  const add = async (kind, anchor, native = false, replaceId) => {
    if (picker) return;
    anchor.disabled = true; report("");
    try {
      const director = native ? null : await getDirectorPicker();
      if (disposed) return;
      const onSelect = file => {
        if (disposed) return;
        const asset = mediaFile(file, kind, replaceId);
        const next = groups();
        const index = next[kind].findIndex(item => item.id === replaceId);
        if (index < 0) return;
        next[kind][index] = asset;
        update(next);
      };
      const onClose = () => { picker = null; anchor.disabled = false; };
      picker = director
        ? director.openAssetPicker({ fetchApi: (...args) => api.fetchApi(...args), kind, onSelect, onClose })
        : await openNativePicker(kind, anchor, onSelect, onClose);
    } catch (err) { report(err.message); }
    finally { anchor.disabled = false; }
  };
  const button = (label, className, action) => {
    const el = document.createElement("button"); el.type = "button"; el.className = className;
    el.ariaLabel = label; el.title = label; el.addEventListener("click", action); return el;
  };
  function card(asset, kind, index) {
    const el = document.createElement("article"); el.className = "terry-media-card";
    el.draggable = true; el.tabIndex = 0; el.dataset.assetId = asset.id;
    el.ariaLabel = `${MEDIA_LABELS[kind]} ${index + 1}，${asset.empty ? "空槽位" : asset.name}，拖动排序`;
    const header = document.createElement("header");
    const tag = document.createElement("span"); tag.className = "terry-media-tag"; tag.textContent = `${MEDIA_LABELS[kind]} ${index + 1}`;
    const remove = button("移除 " + (asset.empty ? `${MEDIA_LABELS[kind]} ${index + 1} 空槽位` : asset.name), "terry-media-remove", () => {
      const referenced = mediaAssetHasReferences(node, asset.id);
      if (asset.empty && referenced) return report("此空槽位仍被引用，断开连线后可移除。");
      report(""); update(removeMedia(groups(), kind, asset.id, referenced));
    }); remove.textContent = "×"; header.append(tag, remove);
    const preview = document.createElement("div"); preview.className = "terry-media-preview";
    if (asset.empty) {
      const fill = button("添加" + MEDIA_LABELS[kind], "terry-media-fill", () => void add(kind, fill, false, asset.id));
      fill.title = "点击选择资产；右键使用 ComfyUI 资产选择器";
      fill.addEventListener("contextmenu", event => {
        event.preventDefault(); event.stopPropagation(); void add(kind, fill, true, asset.id);
      });
      fill.textContent = "+"; preview.append(fill);
    } else if (kind === "image") {
      const img = document.createElement("img"); img.src = viewURL(asset); img.loading = "lazy"; img.alt = asset.name; img.draggable = false;
      img.addEventListener("error", () => { preview.textContent = "图片无法预览"; }, { once: true }); preview.append(img);
      preview.title = "点击更换图片"; preview.style.cursor = "pointer";
      preview.addEventListener("click", () => void add(kind, preview, false, asset.id));
    } else {
      const media = document.createElement(kind === "video" ? "video" : "audio");
      media.src = viewURL(asset); media.controls = true; media.preload = "metadata";
      if (kind === "video") media.playsInline = true;
      else { const icon = document.createElement("span"); icon.className = "terry-media-audio-icon"; icon.textContent = "♫"; preview.append(icon); }
      preview.append(media);
    }
    const filename = button(asset.empty ? "添加" + MEDIA_LABELS[kind] : "更换 " + asset.name, "terry-media-name", () => void add(kind, filename, false, asset.id));
    filename.textContent = asset.empty ? "空槽位 · 点击添加" : asset.name;
    filename.title = asset.empty ? "保留连线，生成时跳过此引用" : asset.path + " · 点击更换";
    filename.addEventListener("contextmenu", event => {
      event.preventDefault(); event.stopPropagation(); void add(kind, filename, true, asset.id);
    });
    el.append(header, preview, filename);
    el.addEventListener("dragstart", event => {
      if (event.target.closest("button,audio,video")) { event.preventDefault(); return; }
      dragging = { kind, id: asset.id }; el.classList.add("is-dragging");
      event.dataTransfer.setData("application/x-terry-media", JSON.stringify(dragging)); event.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => { dragging = null; root.querySelectorAll(".is-dragging,.is-drop-target").forEach(item => item.classList.remove("is-dragging", "is-drop-target")); });
    el.addEventListener("dragover", event => {
      if (dragging?.kind !== kind || dragging.id === asset.id) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move"; el.classList.add("is-drop-target");
    });
    el.addEventListener("dragleave", () => el.classList.remove("is-drop-target"));
    el.addEventListener("drop", event => {
      if (dragging?.kind !== kind) return;
      event.preventDefault(); event.stopPropagation();
      const rect = el.getBoundingClientRect();
      update(moveMedia(groups(), kind, dragging.id, asset.id, event.clientX > rect.left + rect.width / 2)); dragging = null;
    });
    el.addEventListener("keydown", event => {
      if (event.target !== el || !event.altKey || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      const next = groups(), to = index + (event.key === "ArrowLeft" ? -1 : 1);
      if (to < 0 || to >= next[kind].length) return;
      update(moveMedia(next, kind, asset.id, next[kind][to].id, to > index));
      sections.querySelector(`[data-asset-id="${CSS.escape(asset.id)}"]`)?.focus();
    });
    return el;
  }
  function render() {
    if (renderedValue === storage.value) return false;
    const next = groups();
    renderedValue = storage.value;
    // Pause media being removed from the DOM, including after undo/configure.
    sections.querySelectorAll("video,audio").forEach(media => media.pause());
    sections.replaceChildren();
    for (const kind of MEDIA_KINDS) {
      const section = document.createElement("section"); section.className = "terry-media-section"; section.dataset.kind = kind;
      const sectionHead = document.createElement("header"); sectionHead.className = "terry-media-section-head";
      const heading = document.createElement("h3"); heading.textContent = MEDIA_LABELS[kind];
      const count = document.createElement("span"); count.textContent = String(next[kind].length); heading.append(count);
      const grid = document.createElement("div"); grid.className = "terry-media-grid";
      const plus = button("添加" + MEDIA_LABELS[kind] + "空槽位", "terry-media-add", () => {
        const next = groups(); next[kind].push(emptyMediaSlot(kind, crypto.randomUUID()));
        report(""); update(next);
      }); plus.textContent = "+";
      sectionHead.append(heading, plus);
      grid.append(...next[kind].map((asset, index) => card(asset, kind, index)));
      grid.addEventListener("dragover", event => { if (dragging?.kind === kind) event.preventDefault(); });
      grid.addEventListener("drop", event => {
        if (dragging?.kind !== kind) return;
        event.preventDefault(); update(moveMedia(groups(), kind, dragging.id, null)); dragging = null;
      });
      section.append(sectionHead, grid); sections.append(section);
    }
    return true;
  }
  root.addEventListener("pointerdown", event => event.stopPropagation());
  root.addEventListener("keydown", event => event.stopPropagation());
  const dom = node.addDOMWidget("media_cards", "terry_media_cards", root,
    { serialize: false, hideOnZoom: false, getMinHeight: () => 700, getMaxHeight: () => 1400 });
  dom.serialize = false;
  node.__terryBusLaneEntries = () => mediaLanes(node, groups());
  node.__terryMediaLoader = { render, dispose() { disposed = true; picker?.close(); root.querySelectorAll("video,audio").forEach(media => media.pause()); } };
  const changed = storage.callback;
  storage.callback = function () {
    const result = changed?.apply(this, arguments);
    render(); syncMediaBusOutputs(node);
    return result;
  };
  render();
}

function refreshLoadedMedia() {
  const graphs = [app.graph], seen = new Set();
  for (const graph of graphs) {
    if (!graph || seen.has(graph)) continue;
    seen.add(graph);
    for (const node of graph._nodes || []) {
      if (node.subgraph) graphs.push(node.subgraph);
      if (node.__terryMediaLoader?.render()) syncMediaBusOutputs(node);
    }
  }
}

app.registerExtension({
  name: "TerryXu.MediaLoader",
  setup() { api.addEventListener("graphChanged", () => requestAnimationFrame(refreshLoadedMedia)); },
  afterConfigureGraph: refreshLoadedMedia,
  afterLoadGraph() { requestAnimationFrame(refreshLoadedMedia); },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    for (const hook of ["onNodeCreated", "onConfigure"]) {
      const previous = nodeType.prototype[hook];
      nodeType.prototype[hook] = function () {
        const result = previous?.apply(this, arguments);
        install(this); this.__terryMediaLoader.render();
        if (hook === "onNodeCreated") this.setSize([640, 800]);
        return result;
      };
    }
    const removed = nodeType.prototype.onRemoved;
    nodeType.prototype.onRemoved = function () { this.__terryMediaLoader?.dispose(); return removed?.apply(this, arguments); };
  },
});
