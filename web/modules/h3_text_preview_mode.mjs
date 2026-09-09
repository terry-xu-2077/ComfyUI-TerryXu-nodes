import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const NODE_ID = "TerryXuH3PromptEditor";
const SOURCE_INPUT = "source_text";
const EDIT_INPUT = "edit_mode";
const EDIT_PROP = "terry_h3_edit_mode";
const SAVED_PROMPT_PROP = "terry_h3_local_prompt_before_preview";
const READONLY_CLASS = "terry-h3-readonly-preview";
const LIVE_TYPES = new Set(["PrimitiveString", "PrimitiveStringMultiline", "PrimitiveNode"]);

const nodeType = (n) => String(n?.comfyClass || n?.type || n?.constructor?.type || n?.constructor?.comfyClass || n?.constructor?.nodeData?.name || "");
const isTarget = (n) => nodeType(n) === NODE_ID;
const widget = (n, name) => n?.widgets?.find?.((w) => String(w?.name || "") === name) || null;
const promptWidget = (n) => widget(n, "prompt");
const editWidget = (n) => widget(n, EDIT_INPUT);
const sourceInput = (n) => n?.inputs?.find?.((x) => String(x?.name || "") === SOURCE_INPUT) || null;
const sourceConnected = (n) => {
  const i = sourceInput(n);
  return Boolean(i && (i.link != null || (Array.isArray(i.links) && i.links.length)));
};
const props = (n) => (n.properties ||= {});
const currentPrompt = (n) => String(promptWidget(n)?.value ?? "");
const hasSavedPrompt = (n) => Object.prototype.hasOwnProperty.call(n?.properties || {}, SAVED_PROMPT_PROP);

function localEdit(n) {
  const w = editWidget(n);
  return w ? Boolean(w.value) : Boolean(n?.properties?.[EDIT_PROP]);
}

function setLocalEdit(n, value, dirty = true) {
  const next = Boolean(value);
  const w = editWidget(n);
  if (w) {
    w.value = next;
    if (w._state) w._state.value = next;
  }
  props(n)[EDIT_PROP] = next;
  n.__terryH3LocalEditMode = next;
  updateButton(n);
  if (dirty) {
    n.setDirtyCanvas?.(true, true);
    n.graph?.setDirtyCanvas?.(true, true);
    app.graph?.change?.();
  }
}

function hideEditWidget(n) {
  const w = editWidget(n);
  if (!w) return;
  const p = props(n);
  if (Object.prototype.hasOwnProperty.call(p, EDIT_PROP)) w.value = Boolean(p[EDIT_PROP]);
  else p[EDIT_PROP] = Boolean(w.value);
  if (w._state) w._state.value = Boolean(w.value);
  n.__terryH3LocalEditMode = Boolean(w.value);
  if (w.__terryHidden) return;
  w.__terryHidden = true;
  w.hidden = true;
  w.type = "hidden";
  w.options ||= {};
  w.options.hidden = true;
  w.options.canvasOnly = true;
  if (w._state?.options) {
    w._state.options.hidden = true;
    w._state.options.canvasOnly = true;
  }
  w.computeSize = () => [0, -4];
  if (w.element?.style) w.element.style.display = "none";
  if (w.inputEl?.style) w.inputEl.style.display = "none";
}

const followingSource = (n) => sourceConnected(n) && !localEdit(n);

function allGraphs(root = app.graph?.rootGraph || app.graph) {
  if (!root) return [];
  const out = [], seen = new Set(), queue = [root];
  while (queue.length) {
    const g = queue.shift();
    if (!g || seen.has(g)) continue;
    seen.add(g); out.push(g);
    for (const n of g?._nodes || g?.nodes || []) if (n?.subgraph && !seen.has(n.subgraph)) queue.push(n.subgraph);
    for (const c of [g?.subgraphs, g?._subgraphs]) {
      if (!c) continue;
      const values = typeof c.values === "function" ? c.values() : Object.values(c);
      for (const v of values) {
        const sg = v?.subgraph || v;
        if (sg && !seen.has(sg)) queue.push(sg);
      }
    }
  }
  return out;
}

function graphNode(g, id) {
  if (!g || id == null) return null;
  return g.getNodeById?.(id) || g.getNodeById?.(String(id)) || (Number.isFinite(Number(id)) ? g.getNodeById?.(Number(id)) : null) || null;
}

function graphLink(g, ref) {
  if (!g || ref == null) return null;
  if (typeof ref === "object") return ref;
  return g.getLink?.(ref) || g.links?.get?.(ref) || g._links?.get?.(ref) || g.links?.[ref] || g._links?.[ref] || g.links?.[String(ref)] || g._links?.[String(ref)] || null;
}

function connectedSource(n) {
  const input = sourceInput(n), g = n?.graph || app.graph;
  if (!input || !g) return null;
  const ref = input.link ?? (Array.isArray(input.links) ? input.links[0] : null);
  const link = graphLink(g, ref);
  if (!link) return null;
  let source = null, slot = 0;
  try {
    const r = link.resolve?.(g);
    source = r?.outputNode || r?.originNode || null;
    if (r?.output) slot = Number(source?.outputs?.indexOf?.(r.output)) || 0;
  } catch {}
  const id = link.origin_id ?? link.originId ?? link.from_id ?? link.fromId;
  slot = Number(link.origin_slot ?? link.originSlot ?? link.from_slot ?? link.fromSlot ?? slot) || 0;
  source ||= link.origin_node || link.originNode || link.fromNode || graphNode(g, id);
  return source ? { graph: g, link, source, sourceSlot: slot } : null;
}

function executionNode(id) {
  const raw = String(id ?? "");
  if (!raw) return null;
  const root = app.graph?.rootGraph || app.graph;
  if (!raw.includes(":")) {
    const direct = graphNode(root, raw);
    if (direct) return direct;
    return allGraphs(root).map((g) => graphNode(g, raw)).find(Boolean) || null;
  }
  const parts = raw.split(":").filter(Boolean);
  let g = root;
  for (let i = 0; g && i < parts.length - 1; i++) g = graphNode(g, parts[i])?.subgraph || null;
  return graphNode(g, parts.at(-1)) || allGraphs(root).map((x) => graphNode(x, parts.at(-1))).find(Boolean) || null;
}

function setEditorValue(n, text) {
  const value = String(text ?? ""), w = promptWidget(n);
  if (w) {
    w.value = value;
    if (w._state) w._state.value = value;
  }
  const dom = n?.__terryH3DomWidget;
  if (dom) {
    try { dom.value = value; n.__terryH3PreviewRenderedValue = value; return true; } catch {}
    try { dom.options?.setValue?.(value); n.__terryH3PreviewRenderedValue = value; return true; } catch {}
  }
  const editor = n?.__terryH3Editor;
  if (editor && !editor.hasChildNodes()) {
    editor.textContent = value;
    n.__terryH3PreviewRenderedValue = value;
    return true;
  }
  return false;
}

function readableStringWidget(source) {
  const widgets = Array.isArray(source?.widgets) ? source.widgets : [];
  for (const name of ["value", "text", "string", "prompt", "content"]) {
    const w = widgets.find((x) => String(x?.name || "").toLowerCase() === name);
    if (w && typeof w.value === "string") return w;
  }
  return widgets.find((w) => typeof w?.value === "string") || null;
}

function isLiveSource(info) {
  if (!info?.source || !LIVE_TYPES.has(nodeType(info.source))) return false;
  const t = String(info.source?.outputs?.[info.sourceSlot]?.type || info.link?.type || "").toUpperCase();
  return !t || t.includes("STRING") || t.includes("TEXT") || t === "*";
}

function directSourceText(n) {
  const info = connectedSource(n);
  if (!isLiveSource(info)) return null;
  const w = readableStringWidget(info.source);
  if (w) return String(w.value ?? "");
  try {
    const v = info.source?.getOutputData?.(info.sourceSlot);
    if (typeof v === "string") return v;
  } catch {}
  return null;
}

function unwrap(v) {
  while (Array.isArray(v) && v.length === 1) v = v[0];
  if (v == null) return v;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (typeof v.text === "string") return v.text;
    if (typeof v.value === "string") return v.value;
  }
  return null;
}

function previewText(output) {
  for (const v of [output?.text, output?.output?.text, output?.ui?.text, output?.value, output?.output?.value, output?.ui?.value]) {
    if (v != null) return unwrap(v);
  }
  return null;
}

function sourceText(output) {
  for (const v of [output?.terry_h3_source_text, output?.output?.terry_h3_source_text, output?.ui?.terry_h3_source_text]) {
    if (v !== undefined) return unwrap(v);
  }
  return null;
}

function outputRecords(n) {
  const outputs = app?.nodeOutputs || {}, seen = new Set(), out = [];
  const add = (id) => {
    id = String(id ?? "");
    if (!id || seen.has(id) || outputs[id] == null) return;
    seen.add(id);
    out.push({ id, output: outputs[id], text: previewText(outputs[id]), source: sourceText(outputs[id]) });
  };
  add(n?.__terryH3LastExecutionId); add(n?.id);
  const local = String(n?.id ?? "");
  if (local) for (const id of Object.keys(outputs)) if (id.endsWith(`:${local}`) && executionNode(id) === n) add(id);
  return out;
}

function fresh(n, record) {
  const b = n?.__terryH3OutputBaseline;
  return !(b && !n.__terryH3ExecutedSinceSourceChange && b.id === record.id && b.output === record.output);
}

function cachedPreview(n) {
  return outputRecords(n).find((r) => r.text != null && fresh(n, r))?.text ?? null;
}

function cachedSource(n) {
  return outputRecords(n).find((r) => r.source != null && fresh(n, r))?.source ?? null;
}

function rememberBaseline(n) {
  const r = outputRecords(n).find((x) => x.text != null || x.source != null);
  n.__terryH3OutputBaseline = r ? { id: r.id, output: r.output } : null;
  n.__terryH3ExecutedSinceSourceChange = false;
}

function latestSource(n, fallbackPreview = false) {
  const direct = directSourceText(n);
  if (direct != null) return direct;
  if (n.__terryH3LatestSourceText != null) return String(n.__terryH3LatestSourceText);
  const cached = cachedSource(n);
  if (cached != null) return String(cached);
  if (fallbackPreview) return n.__terryH3LastPreviewText ?? cachedPreview(n);
  return null;
}

function watchLiveSource(n) {
  const info = connectedSource(n);
  if (!isLiveSource(info)) return;
  const w = readableStringWidget(info.source);
  if (!w) return;
  w.__terryH3PreviewTargets ||= new Set();
  w.__terryH3PreviewTargets.add(n);
  if (w.__terryH3PreviewWatchInstalled) return;
  w.__terryH3PreviewWatchInstalled = true;
  const old = w.callback;
  w.callback = function() {
    const r = old?.apply(this, arguments);
    queueMicrotask(() => { for (const t of w.__terryH3PreviewTargets) syncSoon(t); });
    return r;
  };
  const el = w.element || w.inputEl;
  const notify = () => queueMicrotask(() => { for (const t of w.__terryH3PreviewTargets) syncSoon(t); });
  el?.addEventListener?.("input", notify, true);
  el?.addEventListener?.("change", notify, true);
}

function updateButton(n) {
  const b = n?.__terryH3SourceModeButton;
  if (!b) return;
  b.style.display = sourceConnected(n) ? "" : "none";
  if (!sourceConnected(n)) return;
  const local = localEdit(n);
  b.textContent = local ? "↻ 同步最新" : "✏ 编辑副本";
  b.title = local
    ? "使用上游最近一次已经生成的文本；不会主动重新运行上游节点"
    : "复制当前收到的文本并进入本地编辑；上游后续运行不会覆盖修改";
}

function ensureButton(n) {
  hideEditWidget(n);
  const wrap = n?.__terryH3Wrap;
  if (!wrap) return false;
  let b = n.__terryH3SourceModeButton;
  if (!b || !b.isConnected) {
    const tools = wrap.querySelector?.(".terry-h3-tools");
    if (!tools) return false;
    b = document.createElement("button");
    b.type = "button";
    b.className = "terry-h3-source-mode";
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); e.stopPropagation(); });
    b.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      localEdit(n) ? syncLatest(n) : beginEdit(n);
    });
    const view = n.__terryH3ViewButton;
    view?.parentElement === tools ? tools.insertBefore(b, view) : tools.append(b);
    n.__terryH3SourceModeButton = b;
  }
  updateButton(n);
  return true;
}

function applyReadonly(n) {
  ensureButton(n);
  const editor = n?.__terryH3Editor, wrap = n?.__terryH3Wrap;
  if (!editor) return false;
  const ro = followingSource(n);
  editor.classList.toggle(READONLY_CLASS, ro);
  wrap?.classList?.toggle(READONLY_CLASS, ro);
  editor.contentEditable = ro ? "false" : "true";
  editor.setAttribute("aria-readonly", ro ? "true" : "false");
  editor.dataset.readonlyPreview = ro ? "true" : "false";
  editor.title = ro ? "已连接文本：只读跟随；点击“编辑副本”后可修改" : "";
  if (ro) {
    editor.querySelectorAll('[contenteditable="true"]').forEach((x) => { x.contentEditable = "false"; x.setAttribute("aria-readonly", "true"); });
    editor.querySelectorAll("input, textarea, select").forEach((x) => { x.disabled = true; x.setAttribute("aria-disabled", "true"); });
  }
  installGuard(n, editor);
  updateButton(n);
  return true;
}

function installGuard(n, editor) {
  if (!editor || editor.__terryH3ReadOnlyGuard) return;
  editor.__terryH3ReadOnlyGuard = true;
  editor.addEventListener("pointerdown", (e) => {
    if (!followingSource(n) || !e.target?.closest?.(".terry-h3-chip")) return;
    e.preventDefault(); e.stopImmediatePropagation();
  }, true);
  for (const name of ["beforeinput", "paste", "drop", "cut"]) {
    editor.addEventListener(name, (e) => {
      if (!followingSource(n)) return;
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
  }
  const observer = new MutationObserver(() => { if (sourceConnected(n)) applyReadonly(n); });
  observer.observe(editor, { childList: true, subtree: true });
  editor.__terryH3ReadOnlyObserver = observer;
}

function applyOutput(n, output) {
  const source = sourceText(output);
  if (source != null) n.__terryH3LatestSourceText = String(source);
  if (localEdit(n)) return false;
  const text = previewText(output);
  if (text == null || !followingSource(n)) return false;
  const value = String(text);
  if (!hasSavedPrompt(n)) props(n)[SAVED_PROMPT_PROP] = currentPrompt(n);
  n.__terryH3ReadOnlyActive = true;
  n.__terryH3LastPreviewText = value;
  n.__terryH3LatestSourceText = source != null ? String(source) : value;
  if (n.__terryH3PreviewRenderedValue !== value) setEditorValue(n, value);
  applyReadonly(n);
  return true;
}

function beginEdit(n) {
  if (!sourceConnected(n) || localEdit(n)) return;
  const text = String(latestSource(n, true) ?? currentPrompt(n));
  delete props(n)[SAVED_PROMPT_PROP];
  setLocalEdit(n, true, false);
  n.__terryH3ReadOnlyActive = false;
  setEditorValue(n, text);
  applyReadonly(n);
  n.__terryH3Editor?.focus?.({ preventScroll: true });
  app.graph?.change?.();
}

function syncLatest(n) {
  if (!sourceConnected(n) || !localEdit(n)) return;
  props(n)[SAVED_PROMPT_PROP] = currentPrompt(n);
  const text = latestSource(n, false);
  setLocalEdit(n, false, false);
  n.__terryH3ReadOnlyActive = true;
  if (text != null) {
    const value = String(text);
    n.__terryH3LastPreviewText = value;
    n.__terryH3LatestSourceText = value;
    setEditorValue(n, value);
  }
  applyReadonly(n);
  app.graph?.change?.();
}

function enterFollow(n) {
  if (!hasSavedPrompt(n)) props(n)[SAVED_PROMPT_PROP] = currentPrompt(n);
  n.__terryH3ReadOnlyActive = true;
  const info = connectedSource(n);
  if (isLiveSource(info)) {
    watchLiveSource(n);
    const direct = directSourceText(n);
    if (direct != null) {
      n.__terryH3LatestSourceText = direct;
      n.__terryH3LastPreviewText = direct;
      if (n.__terryH3PreviewRenderedValue !== direct) setEditorValue(n, direct);
    }
  } else {
    const source = latestSource(n, false);
    const text = source ?? n.__terryH3LastPreviewText ?? cachedPreview(n);
    if (text != null) {
      const value = String(text);
      n.__terryH3LastPreviewText = value;
      if (source != null) n.__terryH3LatestSourceText = String(source);
      if (n.__terryH3PreviewRenderedValue !== value) setEditorValue(n, value);
    }
  }
  applyReadonly(n);
}

function enterLocal(n) {
  n.__terryH3ReadOnlyActive = false;
  const cached = cachedSource(n);
  if (cached != null) n.__terryH3LatestSourceText = String(cached);
  applyReadonly(n);
}

function resetRuntime(n) {
  n.__terryH3LastPreviewText = null;
  n.__terryH3LatestSourceText = null;
  n.__terryH3LastExecutionId = null;
  n.__terryH3PreviewRenderedValue = null;
  n.__terryH3ExecutedSinceSourceChange = false;
  n.__terryH3OutputBaseline = null;
}

function leaveFollow(n) {
  const p = props(n), local = hasSavedPrompt(n) ? String(p[SAVED_PROMPT_PROP] ?? "") : currentPrompt(n);
  if (hasSavedPrompt(n)) delete p[SAVED_PROMPT_PROP];
  n.__terryH3ReadOnlyActive = false;
  resetRuntime(n);
  setEditorValue(n, local);
  applyReadonly(n);
}

function leaveLocalAfterDisconnect(n) {
  const local = currentPrompt(n);
  delete props(n)[SAVED_PROMPT_PROP];
  setLocalEdit(n, false, false);
  n.__terryH3ReadOnlyActive = false;
  resetRuntime(n);
  setEditorValue(n, local);
  applyReadonly(n);
}

function sync(n) {
  if (!isTarget(n)) return;
  hideEditWidget(n); ensureButton(n);
  if (sourceConnected(n)) localEdit(n) ? enterLocal(n) : enterFollow(n);
  else if (localEdit(n)) leaveLocalAfterDisconnect(n);
  else if (n.__terryH3ReadOnlyActive || hasSavedPrompt(n)) leaveFollow(n);
  else applyReadonly(n);
  n.setDirtyCanvas?.(true, true);
}

function syncSoon(n) {
  queueMicrotask(() => sync(n));
  setTimeout(() => sync(n), 0);
  setTimeout(() => sync(n), 80);
}

function syncAll() {
  for (const g of allGraphs()) for (const n of g?._nodes || g?.nodes || []) if (isTarget(n)) sync(n);
}

function resetForSourceChange(n) {
  resetRuntime(n);
  rememberBaseline(n);
}

function patchNodeType(cls) {
  if (cls.prototype.__terryH3TextPreviewPatched) return;
  cls.prototype.__terryH3TextPreviewPatched = true;

  const created = cls.prototype.onNodeCreated;
  cls.prototype.onNodeCreated = function() {
    const r = created?.apply(this, arguments);
    hideEditWidget(this); syncSoon(this); return r;
  };

  const connections = cls.prototype.onConnectionsChange;
  cls.prototype.onConnectionsChange = function(type, index, connected, linkInfo) {
    const before = sourceConnected(this);
    const r = connections?.apply(this, arguments);
    const after = sourceConnected(this);
    if (String(this.inputs?.[Number(index)]?.name || "") === SOURCE_INPUT || before !== after) {
      resetForSourceChange(this);
      if (!before && after) setLocalEdit(this, false, false);
    }
    syncSoon(this); return r;
  };

  const configure = cls.prototype.onConfigure;
  cls.prototype.onConfigure = function() {
    const r = configure?.apply(this, arguments);
    hideEditWidget(this); rememberBaseline(this); syncSoon(this); return r;
  };

  const executed = cls.prototype.onExecuted;
  cls.prototype.onExecuted = function(output) {
    const localBefore = localEdit(this) ? currentPrompt(this) : null;
    const r = executed?.apply(this, arguments);
    if (localBefore != null) setEditorValue(this, localBefore);
    this.__terryH3ExecutedSinceSourceChange = true;
    applyOutput(this, output); syncSoon(this); return r;
  };
}

function installExecutedListener() {
  if (globalThis.__terryH3PreviewExecutedListenerV3) return;
  globalThis.__terryH3PreviewExecutedListenerV3 = true;
  api.addEventListener?.("executed", (event) => {
    const detail = event?.detail || {};
    const id = detail.display_node || detail.node || detail.node_id;
    const n = executionNode(id);
    if (!n || !isTarget(n)) return;
    n.__terryH3LastExecutionId = String(id ?? "");
    n.__terryH3ExecutedSinceSourceChange = true;
    applyOutput(n, detail.output || detail);
    syncSoon(n);
  });
}

if (typeof document !== "undefined" && !document.getElementById("terry-h3-readonly-preview-style")) {
  const style = document.createElement("style");
  style.id = "terry-h3-readonly-preview-style";
  style.textContent = `
    .terry-h3-editor.${READONLY_CLASS}{cursor:text;user-select:text;-webkit-user-select:text}
    .terry-h3-editor.${READONLY_CLASS} .terry-h3-chip{cursor:default!important}
    .terry-h3-wrap.${READONLY_CLASS} .terry-h3-editor{outline-color:color-mix(in srgb,var(--border-color,#777) 75%,transparent)}
    .terry-h3-source-mode{pointer-events:auto;margin-left:auto;min-width:78px;height:23px;padding:0 7px;border:1px solid rgba(255,255,255,.12);border-radius:5px;background:rgba(255,255,255,.05);color:inherit;cursor:pointer;font:500 10px/1 sans-serif;white-space:nowrap}
    .terry-h3-source-mode:hover{background:rgba(255,255,255,.09)}
    .terry-h3-source-mode+.terry-h3-view{margin-left:4px}
  `;
  document.head.append(style);
}

let timer = null;
app.registerExtension({
  name: "TerryXu.H3TextPreviewMode",
  setup() {
    installExecutedListener();
    if (!timer) timer = setInterval(syncAll, 300);
  },
  async beforeRegisterNodeDef(cls, data) {
    if (String(data?.name || "") === NODE_ID) patchNodeType(cls);
  },
  nodeCreated(n) { if (isTarget(n)) syncSoon(n); },
  loadedGraphNode(n) {
    if (!isTarget(n)) return;
    hideEditWidget(n); rememberBaseline(n); syncSoon(n);
  },
  afterConfigureGraph() {
    installExecutedListener(); syncAll();
  },
});
