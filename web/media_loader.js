import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { syncMediaBusOutputs, mediaAssetHasReferences } from "./wire_bus.js";
import { MEDIA_KINDS, MEDIA_LABELS, readMedia, mediaFile, moveMedia, emptyMediaSlot, removeMedia, mediaLanes } from "./media_loader_model.mjs";

const NODE_ID = "TerryXuMediaLoader";
const COLLAPSED_PROPERTY = "terry_media_collapsed";
const EXPANDED_HEIGHT_PROPERTY = "terry_media_expanded_height";
let sectionId = 0;
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
    // The native picker teleports its popover to body, outside this host.
    dialogComponentProps: { headless: true, modal: false, dismissOnFocusOutside: false,
      contentClass: "terry-media-native-host",
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
  const isCollapsed = kind => node.properties?.[COLLAPSED_PROPERTY]?.[kind] === true;
  const anyCollapsed = () => MEDIA_KINDS.some(isCollapsed);
  function contentHeight() {
    if (sections.scrollHeight > 0) return sections.scrollHeight + 24;
    const width = Math.max(320, Number(node.size?.[0]) || 640);
    const cols = Math.max(1, Math.floor((width - 52 + 12) / 172));
    const data = groups();
    return 24 + (MEDIA_KINDS.length - 1) * 8 + MEDIA_KINDS.reduce((height, kind) => {
      if (isCollapsed(kind) || !data[kind].length) return height + 46;
      const rows = Math.ceil(data[kind].length / cols);
      return height + 54 + rows * 178 + (rows - 1) * 12;
    }, 0);
  }
  function resizeForCollapse() {
    if (!anyCollapsed()) {
      const height = Number(node.properties?.[EXPANDED_HEIGHT_PROPERTY]);
      if (Number.isFinite(height) && height > 0) {
        node.setSize?.([Number(node.size?.[0]) || 640, height]);
      }
      if (node.properties) delete node.properties[EXPANDED_HEIGHT_PROPERTY];
      return;
    }
    node.properties ||= {};
    let expandedHeight = Number(node.properties[EXPANDED_HEIGHT_PROPERTY]);
    if (!Number.isFinite(expandedHeight) || expandedHeight < 220) {
      expandedHeight = Math.max(240, Number(node.size?.[1]) || 800);
      node.properties[EXPANDED_HEIGHT_PROPERTY] = expandedHeight;
    }
    const target = Math.max(220, Math.min(expandedHeight, Math.ceil(contentHeight() + 72)));
    if (Math.abs((Number(node.size?.[1]) || 0) - target) > 1) {
      node.setSize?.([Number(node.size?.[0]) || 640, target]);
    }
  }
  function setCollapsed(kind, collapsed, section, toggle) {
    node.graph?.beforeChange?.();
    node.properties ||= {};
    node.properties[COLLAPSED_PROPERTY] ||= {};
    node.properties[COLLAPSED_PROPERTY][kind] = collapsed;
    section.classList.toggle("is-collapsed", collapsed);
    const addButton = section.querySelector(".terry-media-add");
    if (addButton) addButton.hidden = collapsed;
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.ariaLabel = collapsed ? "展开" + MEDIA_LABELS[kind] + "区域" : "收起" + MEDIA_LABELS[kind] + "区域";
    toggle.title = toggle.ariaLabel;
    resizeForCollapse();
    node.graph?.afterChange?.();
    node.graph?.change?.();
    node.setDirtyCanvas?.(true, true);
  }
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
    let uploading = false, paste;
    el.draggable = true; el.tabIndex = 0; el.dataset.assetId = asset.id;
    el.ariaLabel = `${MEDIA_LABELS[kind]} ${index + 1}，${asset.empty ? "空槽位" : asset.name}，拖动排序`;
    const header = document.createElement("header");
    const tag = document.createElement("span"); tag.className = "terry-media-tag"; tag.textContent = `${MEDIA_LABELS[kind]} ${index + 1}`;
    const clearImage = kind === "image" && !asset.empty;
    const remove = button((clearImage ? "清空图片 " : "移除 ") + (asset.empty ? `${MEDIA_LABELS[kind]} ${index + 1} 空槽位` : asset.name), "terry-media-remove", () => {
      const referenced = mediaAssetHasReferences(node, asset.id);
      if (asset.empty && referenced) return report("此空槽位仍被引用，断开连线后可移除。");
      report(""); update(removeMedia(groups(), kind, asset.id, referenced || clearImage));
    });
    remove.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
    header.append(tag);
    if (kind === "image") {
      paste = button("从剪贴板粘贴图片", "terry-media-paste", async () => {
        if (uploading || paste.disabled) return;
        if (!navigator.clipboard?.read) return report("当前浏览器无法读取剪贴板图片，请使用拖入图片。");
        paste.disabled = true; report("");
        try {
          const items = await navigator.clipboard.read();
          const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/bmp": "bmp", "image/gif": "gif", "image/tiff": "tiff", "image/avif": "avif" };
          const files = [];
          for (const item of items) {
            const type = item.types.find(type => extensions[type]);
            if (type) files.push(new File([await item.getType(type)], `clipboard-${crypto.randomUUID()}.${extensions[type]}`, { type }));
          }
          if (!files.length) return report("剪贴板中没有图片，请先复制图片。");
          await uploadImages(files);
        } catch (err) {
          if (!disposed) report(err.name === "NotAllowedError" ? "无法读取剪贴板，请允许浏览器访问剪贴板后重试。" : err.message);
        } finally { paste.disabled = uploading; }
      });
      paste.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="8" y="3" width="8" height="4" rx="1"/><path d="M8 5H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-3"/></svg>';
      header.append(paste);
    }
    header.append(remove);
    const preview = document.createElement("div"); preview.className = "terry-media-preview";
    if (asset.empty) {
      const fill = button("添加" + MEDIA_LABELS[kind], "terry-media-fill", () => void add(kind, fill, false, asset.id));
      fill.title = kind === "image" ? "点击选择或拖入图片；右键使用 ComfyUI 资产选择器" : "点击选择资产；右键使用 ComfyUI 资产选择器";
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
    async function uploadImages(files) {
      if (uploading || disposed) return;
      uploading = true; report(""); el.setAttribute("aria-busy", "true");
      const fill = el.querySelector(".terry-media-fill");
      if (fill) { fill.disabled = true; fill.textContent = "上传中…"; }
      paste.disabled = true;
      let targetId = asset.id;
      try {
        for (const [fileIndex, file] of files.entries()) {
          if (disposed) break;
          const body = new FormData();
          body.append("image", file); body.append("type", "input");
          const response = await api.fetchApi("/upload/image", { method: "POST", body });
          if (!response.ok) throw Error(`图片上传失败：${response.status} ${response.statusText}`);
          const uploaded = await response.json();
          if (disposed) break;
          const next = groups(), targetIndex = next.image.findIndex(item => item.id === targetId);
          if (targetIndex < 0 || (fileIndex === 0 && (next.image[targetIndex].path !== asset.path || next.image[targetIndex].source !== asset.source))) break;
          const image = mediaFile(uploaded, "image", fileIndex === 0 ? asset.id : crypto.randomUUID());
          if (fileIndex === 0) next.image[targetIndex] = image;
          else next.image.splice(targetIndex + 1, 0, image);
          update(next); targetId = image.id;
        }
      } catch (err) { if (!disposed) report(err.message); }
      finally {
        uploading = false; el.removeAttribute("aria-busy");
        if (fill) { fill.disabled = false; fill.textContent = "+"; }
        paste.disabled = false;
      }
    }
    el.addEventListener("dragstart", event => {
      if (event.target.closest("button,audio,video")) { event.preventDefault(); return; }
      dragging = { kind, id: asset.id }; el.classList.add("is-dragging");
      event.dataTransfer.setData("application/x-terry-media", JSON.stringify(dragging)); event.dataTransfer.effectAllowed = "move";
    });
    el.addEventListener("dragend", () => { dragging = null; root.querySelectorAll(".is-dragging,.is-drop-target,.is-file-drop-target").forEach(item => item.classList.remove("is-dragging", "is-drop-target", "is-file-drop-target")); });
    el.addEventListener("dragover", event => {
      if (kind === "image" && asset.empty && event.dataTransfer.types.includes("Files")) {
        event.preventDefault(); event.stopPropagation();
        event.dataTransfer.dropEffect = uploading ? "none" : "copy";
        if (!uploading) el.classList.add("is-file-drop-target");
        return;
      }
      if (dragging?.kind !== kind || dragging.id === asset.id) return;
      event.preventDefault(); event.dataTransfer.dropEffect = "move"; el.classList.add("is-drop-target");
    });
    el.addEventListener("dragleave", event => {
      if (el.contains(event.relatedTarget)) return;
      el.classList.remove("is-drop-target", "is-file-drop-target");
    });
    el.addEventListener("drop", async event => {
      if (kind === "image" && asset.empty && event.dataTransfer.types.includes("Files")) {
        event.preventDefault(); event.stopPropagation(); el.classList.remove("is-drop-target", "is-file-drop-target");
        if (uploading) return;
        const files = Array.from(event.dataTransfer.files).filter(file => /\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(file.name));
        if (!files.length) return report("请拖入图片文件。");
        await uploadImages(files);
        return;
      }
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
      const heading = document.createElement("h3");
      const toggle = button("", "terry-media-toggle", () => setCollapsed(kind, !isCollapsed(kind), section, toggle));
      const chevron = document.createElement("span"); chevron.className = "terry-media-chevron"; chevron.textContent = "▾"; chevron.setAttribute("aria-hidden", "true");
      const title = document.createElement("span"); title.textContent = MEDIA_LABELS[kind];
      const count = document.createElement("span"); count.className = "terry-media-count"; count.textContent = String(next[kind].length);
      toggle.append(chevron, title, count); heading.append(toggle);
      const grid = document.createElement("div"); grid.className = "terry-media-grid";
      const collapsed = isCollapsed(kind);
      section.classList.toggle("is-collapsed", collapsed);
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.ariaLabel = (collapsed ? "展开" : "收起") + MEDIA_LABELS[kind] + "区域";
      toggle.title = toggle.ariaLabel;
      grid.id = "terry-media-grid-" + ++sectionId;
      toggle.setAttribute("aria-controls", grid.id);
      const plus = button("添加" + MEDIA_LABELS[kind] + "空槽位", "terry-media-add", () => {
        const next = groups(); next[kind].push(emptyMediaSlot(kind, crypto.randomUUID()));
        report(""); update(next);
      }); plus.textContent = "+"; plus.hidden = collapsed;
      sectionHead.append(heading, plus);
      sectionHead.addEventListener("click", event => {
        if (event.target.closest?.("button")) return;
        setCollapsed(kind, !isCollapsed(kind), section, toggle);
      });
      grid.append(...next[kind].map((asset, index) => card(asset, kind, index)));
      grid.addEventListener("dragover", event => { if (dragging?.kind === kind) event.preventDefault(); });
      grid.addEventListener("drop", event => {
        if (dragging?.kind !== kind) return;
        event.preventDefault(); update(moveMedia(groups(), kind, dragging.id, null)); dragging = null;
      });
      section.append(sectionHead, grid); sections.append(section);
    }
    if (anyCollapsed()) queueMicrotask(resizeForCollapse);
    return true;
  }
  root.addEventListener("pointerdown", event => event.stopPropagation());
  root.addEventListener("keydown", event => event.stopPropagation());
  const dom = node.addDOMWidget("media_cards", "terry_media_cards", root,
    { serialize: false, hideOnZoom: false, getMinHeight: () => Math.min(700, Math.max(120, contentHeight())), getMaxHeight: () => 1400 });
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
