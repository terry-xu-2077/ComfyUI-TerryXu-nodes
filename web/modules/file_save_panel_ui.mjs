import { app } from "../../scripts/app.js";

function installStyle() {
  if (document.getElementById("terry-file-save-panel-style")) return;
  const style = document.createElement("style");
  style.id = "terry-file-save-panel-style";
  style.textContent = `
.terry-file-save-panel{width:100%;height:100%;max-width:100%;min-width:0;min-height:0;box-sizing:border-box;padding:6px 7px 8px;font-family:Inter,system-ui,sans-serif;color:var(--input-text,#ddd);display:flex;flex-direction:column;gap:9px;overflow:hidden}
.terry-file-save-card{flex:0 0 auto;width:100%;max-width:100%;min-width:0;box-sizing:border-box;padding:8px;border:1px solid rgba(255,255,255,.11);border-radius:7px;background:rgba(0,0,0,.12);display:flex;flex-direction:column;gap:7px;overflow:hidden}
.terry-file-save-card.is-media{border-color:rgba(96,165,250,.22);background:rgba(96,165,250,.035)}
.terry-file-save-card.is-file{border-color:rgba(255,255,255,.11);background:rgba(0,0,0,.10)}
.terry-file-save-row{width:100%;max-width:100%;min-width:0;box-sizing:border-box;display:grid;grid-template-columns:minmax(0,36%) minmax(0,1fr);align-items:center;gap:10px;min-height:30px}
.terry-file-save-label{min-width:0;max-width:100%;font-size:11px;line-height:1.25;opacity:.72;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.terry-file-save-control{display:block;width:100%;max-width:100%;min-width:0;height:30px;box-sizing:border-box;border:1px solid rgba(255,255,255,.10);border-radius:6px;background:#303236;color:#e5e7eb;font:11px Inter,system-ui,sans-serif;outline:none;padding:0 8px;color-scheme:dark}
.terry-file-save-control:focus{border-color:rgba(255,255,255,.25);box-shadow:0 0 0 1px rgba(255,255,255,.05)}
.terry-file-save-control[type=number]{text-align:left}
.terry-file-save-control:disabled{opacity:.58;cursor:not-allowed;background:rgba(255,255,255,.035)}
.terry-file-save-control option{background:#25272b!important;color:#e8e8e8!important}
.terry-file-save-check-wrap{width:100%;max-width:100%;min-width:0;height:30px;display:flex;align-items:center;justify-content:flex-end;box-sizing:border-box}
.terry-file-save-check{appearance:none;flex:0 0 auto;width:42px;height:24px;border-radius:999px;background:rgba(255,255,255,.13);position:relative;cursor:pointer;transition:background .12s ease}
.terry-file-save-check:after{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;border-radius:50%;background:rgba(10,10,10,.92);transition:transform .12s ease,background .12s ease}
.terry-file-save-check:checked{background:rgba(96,165,250,.55)}
.terry-file-save-check:checked:after{transform:translateX(18px);background:#f4f4f4}
.terry-file-save-preview{flex:1 1 auto;width:100%;min-height:140px;max-width:100%;min-width:0;box-sizing:border-box;padding:0;display:flex;align-items:stretch;justify-content:center;overflow:hidden;color:var(--input-text,#ddd);font-family:Inter,system-ui,sans-serif}
.terry-file-save-preview-content{width:100%;height:100%;min-width:0;min-height:130px;box-sizing:border-box;border:1px solid rgba(255,255,255,.09);border-radius:7px;background:rgba(0,0,0,.13);overflow:auto;display:flex;align-items:center;justify-content:center}
.terry-file-save-preview-empty{color:rgba(255,255,255,.29);font-size:12px;text-align:center;padding:18px;user-select:none}
.terry-file-save-preview-text{align-self:stretch;width:100%;min-height:130px;box-sizing:border-box;margin:0;padding:12px;color:#e5e7eb;background:transparent;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;overflow-wrap:anywhere;user-select:text;overflow:auto}
`;
  document.head.append(style);
}

function getWidget(node, name) {
  return node?.widgets?.find((w) => w?.name === name) || null;
}

function usesNativeMediaPreview(node) {
  return ["image", "video", "audio"].includes(node?.__terryFileSavePreview?.root?.dataset?.kind);
}

function hideNativeWidget(widget) {
  if (!widget) return;
  if (!widget.__terryFilePanelHideInstalled) {
    widget.__terryFilePanelHideInstalled = true;
    widget.__terryFilePanelOriginalComputeSize = typeof widget.computeSize === "function" ? widget.computeSize.bind(widget) : null;
    widget.computeSize = function() { return [0, -4]; };
  }
  widget.hidden = true;
  widget.options ||= {};
  widget.options.hidden = true;
  if (widget.element?.style) widget.element.style.display = "none";
  if (widget.inputEl?.style) widget.inputEl.style.display = "none";
}

function graphLink(graph, id) {
  if (!graph || id == null) return null;
  return graph.links?.[id] || graph._links?.get?.(id) || graph.links?.[String(id)] || null;
}

function normalizeType(type) {
  const v = String(type || "").toUpperCase();
  return v === "TEXT" ? "STRING" : v;
}

function nodeType(node) {
  return String(node?.type || node?.constructor?.type || node?.comfyClass || node?.constructor?.comfyClass || "").toLowerCase();
}

function resolveOriginType(graph, linkId, supported, seen = new Set()) {
  if (linkId == null || seen.has(linkId)) return null;
  seen.add(linkId);
  const link = graphLink(graph, linkId);
  if (!link) return null;
  const origin = graph?.getNodeById?.(link.origin_id);
  const output = origin?.outputs?.[link.origin_slot];
  let type = normalizeType(link.type || output?.type);
  if (supported.has(type)) return type;
  const nt = nodeType(origin);
  if (origin && (nt === "reroute" || nt.endsWith("reroute"))) {
    const upstream = resolveOriginType(graph, origin.inputs?.[0]?.link, supported, seen);
    if (upstream) return upstream;
  }
  type = normalizeType(output?.type);
  return supported.has(type) ? type : null;
}

function connectedType(node, supported) {
  const input = node?.inputs?.find((x) => x?.name === "data");
  if (!input || input.link == null) return null;
  return resolveOriginType(node.graph || app.graph, input.link, supported);
}

function hasInputLink(node, name) {
  const input = node?.inputs?.find((x) => x?.name === name || x?.widget?.name === name);
  return input?.link != null;
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch { return false; }
}

const FALLBACK_LABELS = {
  image_compress_level:["PNG 压缩等级","PNG Compression"], audio_format:["音频格式","Audio Format"], audio_quality:["音频质量","Audio Quality"],
  video_format:["视频容器","Video Container"], video_codec:["视频编码","Video Codec"], video_encoding:["H.264 编码模式","H.264 Mode"], video_crf:["H.264 CRF","H.264 CRF"],
  text_extension:["文本后缀","Text Extension"], text_custom_extension:["自定义文本后缀","Custom Text Extension"],
  filename:["文件名","Filename"], filename_template:["文件名","Filename"], date_format:["日期格式","Date Format"], append_sequence:["尾部添加序号","Append Sequence"],
  sequence_start:["起始序号","Sequence Start"], sequence_padding:["序号位数","Sequence Padding"],
};

function displayLabel(widget, name) {
  const explicit = widget?.label || widget?.localized_name;
  if (explicit && explicit !== name) return String(explicit);
  const pair = FALLBACK_LABELS[name];
  return pair ? pair[localeIsZh() ? 0 : 1] : name;
}

function valuesFor(widget) {
  const raw = widget?.options?.values;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "function") {
    try { const v = raw(); if (Array.isArray(v)) return v; } catch {}
  }
  return null;
}

function setWidgetValue(node, widget, value) {
  if (!widget) return;
  widget.value = value;
  if (widget._state) widget._state.value = value;
  try { widget.callback?.(value, app.canvas, node); } catch {}
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
  app.graph?.change?.();
}

function createControl(node, name, onChanged) {
  const widget = getWidget(node, name);
  if (!widget) return null;
  const row = document.createElement("div"); row.className = "terry-file-save-row"; row.dataset.widgetName = name;
  const label = document.createElement("div"); label.className = "terry-file-save-label"; label.textContent = displayLabel(widget, name); row.append(label);
  const values = valuesFor(widget);
  let control;
  const boolLike = typeof widget.value === "boolean" || widget.type === "toggle";
  if (boolLike) {
    const wrap = document.createElement("div"); wrap.className = "terry-file-save-check-wrap";
    control = document.createElement("input"); control.type = "checkbox"; control.className = "terry-file-save-check"; wrap.append(control); row.append(wrap);
    control.addEventListener("change", () => { setWidgetValue(node, widget, control.checked); onChanged?.(); });
  } else if (values?.length) {
    control = document.createElement("select"); control.className = "terry-file-save-control";
    for (const item of values) {
      const value = typeof item === "object" ? (item.value ?? item.name ?? item.label ?? String(item)) : item;
      const text = typeof item === "object" ? (item.label ?? item.name ?? item.value ?? String(item)) : item;
      const option = document.createElement("option"); option.value = String(value); option.textContent = String(text); control.append(option);
    }
    row.append(control);
    control.addEventListener("change", () => { setWidgetValue(node, widget, control.value); onChanged?.(); });
  } else if (typeof widget.value === "number") {
    control = document.createElement("input"); control.type = "number"; control.className = "terry-file-save-control";
    if (widget.options?.min != null) control.min = String(widget.options.min);
    if (widget.options?.max != null) control.max = String(widget.options.max);
    if (widget.options?.step != null) control.step = String(widget.options.step);
    row.append(control);
    control.addEventListener("change", () => { setWidgetValue(node, widget, Number(control.value)); onChanged?.(); });
  } else {
    control = document.createElement("input"); control.type = "text"; control.className = "terry-file-save-control"; row.append(control);
    control.addEventListener("input", () => { setWidgetValue(node, widget, control.value); onChanged?.(); });
  }
  return { row, control, widget, sync() {
    label.textContent = displayLabel(widget, name);
    if (control.type === "checkbox") control.checked = widget.value === true;
    else if (document.activeElement !== control) control.value = widget.value == null ? "" : String(widget.value);
  }};
}

export function installFileSavePanel(node, config) {
  installStyle();
  const prop = config.panelProp || "__terryFileSavePanel";
  if (node[prop]) return node[prop];
  const allNames = [...new Set([...Object.values(config.typeWidgets).flat(), ...config.fileWidgets])];
  for (const name of allNames) hideNativeWidget(getWidget(node, name));

  const root = document.createElement("div"); root.className = "terry-file-save-panel";
  const mediaCard = document.createElement("div"); mediaCard.className = "terry-file-save-card is-media";
  const fileCard = document.createElement("div"); fileCard.className = "terry-file-save-card is-file";
  root.append(mediaCard, fileCard);

  const controls = new Map();
  let panel;
  const add = (name, card) => {
    if (controls.has(name)) return;
    const item = createControl(node, name, () => panel?.refresh?.());
    if (!item) return;
    controls.set(name, item); card.append(item.row);
  };
  for (const name of Object.values(config.typeWidgets).flat()) add(name, mediaCard);
  for (const name of config.fileWidgets) add(name, fileCard);

  const panelMinHeight = () => {
    const visibleRows = [...controls.values()].filter((item) => item.row.style.display !== "none").length;
    const visibleCards = [mediaCard, fileCard].filter((card) => card.style.display !== "none").length;
    const nativeMedia = usesNativeMediaPreview(node);
    return Math.max(
      nativeMedia ? 0 : 220,
      visibleRows * 30
        + Math.max(0, visibleRows - visibleCards) * 7
        + visibleCards * 16
        + visibleCards * 9
        + (nativeMedia ? 14 : 154),
    );
  };
  const dom = node.addDOMWidget(config.widgetName, config.widgetName, root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: panelMinHeight,
    getMaxHeight: () => usesNativeMediaPreview(node)
      ? panelMinHeight()
      : Number.POSITIVE_INFINITY,
  });
  dom.serialize = false;

  const supported = new Set(Object.keys(config.typeWidgets));
  panel = {
    root, mediaCard, fileCard, dom, controls,
    refresh() {
      for (const name of allNames) hideNativeWidget(getWidget(node, name));
      const type = connectedType(node, supported);
      const visible = new Set(type ? (config.typeWidgets[type] || []) : []);
      if (type === "AUDIO" && getWidget(node,"audio_format")?.value === "flac") visible.delete("audio_quality");
      if (type === "VIDEO") {
        const codec = getWidget(node,"video_codec")?.value;
        const encoding = getWidget(node,"video_encoding")?.value;
        if (codec !== "h264") { visible.delete("video_encoding"); visible.delete("video_crf"); }
        else if (encoding !== "re-encode") visible.delete("video_crf");
      }
      if (type === "STRING" && getWidget(node,"text_extension")?.value !== "custom") visible.delete("text_custom_extension");
      if (config.sequence && getWidget(node,"append_sequence")?.value !== true) { visible.delete("sequence_start"); visible.delete("sequence_padding"); }

      const externalFilename = hasInputLink(node, "filename_input");
      let mediaCount = 0;
      for (const [name,item] of controls) {
        const isMedia = Object.values(config.typeWidgets).some((arr) => arr.includes(name));
        const show = isMedia ? visible.has(name) : (name !== "sequence_start" && name !== "sequence_padding") || getWidget(node,"append_sequence")?.value === true;
        item.row.style.display = show ? "grid" : "none";
        if (isMedia && show) mediaCount++;
        item.control.disabled = false;
        item.sync();
        if (name === "filename" && externalFilename) {
          item.control.disabled = true;
          if (item.control.type !== "checkbox") item.control.value = localeIsZh() ? "由外部输入" : "From external input";
        }
      }
      mediaCard.style.display = mediaCount ? "flex" : "none";
      root.style.width = "100%";
      root.style.maxWidth = "100%";
      root.style.minWidth = "0";
      if (root.parentElement) {
        root.parentElement.style.width = "100%";
        root.parentElement.style.maxWidth = "100%";
        root.parentElement.style.minWidth = "0";
        root.parentElement.style.boxSizing = "border-box";
      }
      try {
        const measured = node.computeSize?.();
        if (measured) node.setSize?.([
          node.size?.[0] || measured[0] || 0,
          Math.max(Number(node.size?.[1]) || 0, measured[1]),
        ]);
      } catch {}
      node.setDirtyCanvas?.(true,true); app.graph?.setDirtyCanvas?.(true,true);
    }
  };
  node[prop] = panel;
  panel.refresh();
  requestAnimationFrame(() => panel.refresh());
  setTimeout(() => panel.refresh(), 80);
  return panel;
}

export function scheduleFileSavePanel(node, prop) {
  const refresh = () => node?.[prop]?.refresh?.();
  queueMicrotask(refresh); requestAnimationFrame(refresh); setTimeout(refresh, 80); setTimeout(refresh, 200);
}

function previewItems(value) {
  return Array.isArray(value) ? value.filter((item) => item?.filename) : [];
}

function isAnimatedPreview(message, files) {
  const animated = Array.isArray(message?.animated) ? message.animated.some(Boolean) : Boolean(message?.animated);
  return animated || files.some((file) => /\.(?:mp4|mkv|webm|mov|m4v|avi)$/i.test(String(file.filename || "")));
}

function showEmptyPreview(content) {
  const empty = document.createElement("div");
  empty.className = "terry-file-save-preview-empty";
  empty.textContent = localeIsZh() ? "运行后显示预览" : "Run to preview";
  content.replaceChildren(empty);
}

export function updateFileSavePreview(node, message) {
  const preview = node?.__terryFileSavePreview;
  if (!preview) return;
  const content = preview.content;
  const images = previewItems(message?.images);
  const audios = previewItems(message?.audio);
  const text = message?.text;
  const usedNativeMedia = usesNativeMediaPreview(node);

  if (images.length || audios.length) {
    // SavedImages, PreviewVideo and SavedAudios all have native ComfyUI
    // renderers. This panel only supplies the missing plain-text preview.
    content.replaceChildren();
    preview.root.style.display = "none";
    preview.root.dataset.kind = images.length
      ? (isAnimatedPreview(message, images) ? "video" : "image")
      : "audio";
  } else if (text != null) {
    preview.root.style.display = "flex";
    const block = document.createElement("pre");
    block.className = "terry-file-save-preview-text";
    block.textContent = Array.isArray(text)
      ? text.filter((part) => part != null).join("\n\n")
      : String(text);
    content.replaceChildren(block);
    preview.root.dataset.kind = "text";
  } else {
    preview.root.style.display = "flex";
    showEmptyPreview(content);
    preview.root.dataset.kind = "empty";
  }

  if (usedNativeMedia !== usesNativeMediaPreview(node)) {
    node.__terryFileSavePanel?.refresh?.();
  }
  node.setDirtyCanvas?.(true, true);
  app.graph?.setDirtyCanvas?.(true, true);
}

export function installFileSavePreview(node) {
  if (node?.__terryFileSavePreview) return node.__terryFileSavePreview;
  const panel = node?.__terryFileSavePanel;
  if (!panel?.root || !panel.dom) return null;
  installStyle();

  const root = document.createElement("div");
  root.className = "terry-file-save-preview";
  root.dataset.kind = "empty";
  const content = document.createElement("div");
  content.className = "terry-file-save-preview-content";
  root.append(content);
  root.addEventListener("pointerdown", (event) => event.stopPropagation());
  panel.root.append(root);

  const preview = { root, content, dom: panel.dom };
  node.__terryFileSavePreview = preview;
  updateFileSavePreview(node, app.nodeOutputs?.[String(node.id)]);
  panel.refresh?.();
  return preview;
}
