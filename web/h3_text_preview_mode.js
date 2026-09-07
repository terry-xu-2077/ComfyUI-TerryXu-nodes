import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuH3PromptEditor";
const SOURCE_INPUT = "source_text";
const LOCAL_PROMPT_PROP = "terry_h3_local_prompt_before_preview";
const READONLY_CLASS = "terry-h3-readonly-preview";

function isTarget(node) {
  if (!node) return false;
  return [node.comfyClass, node.type, node.constructor?.type, node.constructor?.comfyClass, node.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function promptWidget(node) {
  return node?.widgets?.find((widget) => String(widget?.name || "") === "prompt") || null;
}

function sourceInput(node) {
  return node?.inputs?.find((input) => String(input?.name || "") === SOURCE_INPUT) || null;
}

function sourceConnected(node) {
  const input = sourceInput(node);
  if (!input) return false;
  if (input.link != null) return true;
  if (Array.isArray(input.links) && input.links.length) return true;
  return false;
}

function ensureProperties(node) {
  node.properties ||= {};
  return node.properties;
}


function hasSavedLocalPrompt(node) {
  return Object.prototype.hasOwnProperty.call(node?.properties || {}, LOCAL_PROMPT_PROP);
}

function currentPrompt(node) {
  return String(promptWidget(node)?.value ?? "");
}

function rememberLocalPrompt(node) {
  if (hasSavedLocalPrompt(node)) return;
  ensureProperties(node)[LOCAL_PROMPT_PROP] = currentPrompt(node);
}

function setPromptWidgetValue(node, text) {
  const widget = promptWidget(node);
  if (!widget) return;
  const value = String(text ?? "");
  widget.value = value;
  if (widget._state) widget._state.value = value;
}

function setEditorValue(node, text) {
  const value = String(text ?? "");
  setPromptWidgetValue(node, value);

  // h3_prompt_editor.js exposes its DOM widget. Using its own setValue keeps
  // every existing formatter, media thumbnail resolver and visual/raw mode in
  // one code path instead of duplicating H3 rendering here.
  const domWidget = node?.__terryH3DomWidget;
  if (typeof domWidget?.setValue === "function") {
    domWidget.setValue(value);
    return;
  }

  // The editor can be created a tick later during graph restore. Keep the
  // hidden prompt value correct now; the normal H3 editor init will render it.
  const editor = node?.__terryH3Editor;
  if (editor && !editor.hasChildNodes()) editor.textContent = value;
}

function unwrapPreviewText(output) {
  let value = output?.terry_h3_preview_text;
  if (value == null) return null;

  // ComfyUI UI outputs may arrive as a scalar or as a one-item array depending
  // on frontend/backend version. Accept both without coercing object metadata.
  while (Array.isArray(value) && value.length === 1) value = value[0];
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.value === "string") return value.value;
  }
  return null;
}

function applyReadOnlyDom(node) {
  const editor = node?.__terryH3Editor;
  const wrap = node?.__terryH3Wrap;
  if (!editor) return false;

  const readonly = sourceConnected(node);
  editor.classList.toggle(READONLY_CLASS, readonly);
  wrap?.classList?.toggle(READONLY_CLASS, readonly);
  editor.contentEditable = readonly ? "false" : "true";
  editor.setAttribute("aria-readonly", readonly ? "true" : "false");
  editor.dataset.readonlyPreview = readonly ? "true" : "false";
  editor.title = readonly ? "已连接文本：只读预览" : "";

  if (readonly) {
    // Rich H3 dialogue chips contain their own editable span/select. Rendering
    // can recreate these descendants, so force every nested editor control into
    // a genuinely read-only state too.
    editor.querySelectorAll('[contenteditable="true"]').forEach((element) => {
      element.contentEditable = "false";
      element.setAttribute("aria-readonly", "true");
    });
    editor.querySelectorAll("input, textarea, select").forEach((element) => {
      element.disabled = true;
      element.setAttribute("aria-disabled", "true");
    });
  }

  installEditorGuard(node, editor);
  return true;
}

function installEditorGuard(node, editor) {
  if (!editor || editor.__terryH3ReadOnlyGuard) return;
  editor.__terryH3ReadOnlyGuard = true;

  // Existing H3 tag replacement is bound to pointerdown on chips. Capture it
  // first while in preview mode so Picture/Video/Audio tags cannot be clicked
  // to replace media, while ordinary text remains selectable/copyable.
  editor.addEventListener("pointerdown", (event) => {
    if (!sourceConnected(node)) return;
    if (!event.target?.closest?.(".terry-h3-chip")) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);

  // Belt-and-suspenders guards for browser editing paths and nested rich chips.
  for (const eventName of ["beforeinput", "paste", "drop", "cut"]) {
    editor.addEventListener(eventName, (event) => {
      if (!sourceConnected(node)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }

  const observer = new MutationObserver(() => {
    if (sourceConnected(node)) applyReadOnlyDom(node);
  });
  observer.observe(editor, { childList: true, subtree: true });
  editor.__terryH3ReadOnlyObserver = observer;
}

function enterReadOnly(node) {
  rememberLocalPrompt(node);
  node.__terryH3ReadOnlyActive = true;
  applyReadOnlyDom(node);
  if (node.__terryH3LastPreviewText != null) {
    setEditorValue(node, node.__terryH3LastPreviewText);
    applyReadOnlyDom(node);
  }
}

function leaveReadOnly(node) {
  const props = ensureProperties(node);
  const hadSaved = Object.prototype.hasOwnProperty.call(props, LOCAL_PROMPT_PROP);
  const local = hadSaved ? String(props[LOCAL_PROMPT_PROP] ?? "") : currentPrompt(node);

  node.__terryH3ReadOnlyActive = false;
  node.__terryH3LastPreviewText = null;
  if (hadSaved) delete props[LOCAL_PROMPT_PROP];
  setEditorValue(node, local);
  applyReadOnlyDom(node);
}

function syncMode(node) {
  if (!isTarget(node)) return;
  if (sourceConnected(node)) {
    enterReadOnly(node);
  } else if (node.__terryH3ReadOnlyActive || hasSavedLocalPrompt(node)) {
    leaveReadOnly(node);
  } else {
    applyReadOnlyDom(node);
  }
  node.setDirtyCanvas?.(true, true);
}

function syncModeSoon(node) {
  queueMicrotask(() => syncMode(node));
  setTimeout(() => syncMode(node), 0);
  setTimeout(() => applyReadOnlyDom(node), 80);
}

function patchNodeType(nodeType) {
  if (nodeType.prototype.__terryH3TextPreviewPatched) return;
  nodeType.prototype.__terryH3TextPreviewPatched = true;

  const oldCreated = nodeType.prototype.onNodeCreated;
  nodeType.prototype.onNodeCreated = function () {
    const result = oldCreated?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldConnectionsChange = nodeType.prototype.onConnectionsChange;
  nodeType.prototype.onConnectionsChange = function () {
    const result = oldConnectionsChange?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldConfigure = nodeType.prototype.onConfigure;
  nodeType.prototype.onConfigure = function () {
    const result = oldConfigure?.apply(this, arguments);
    syncModeSoon(this);
    return result;
  };

  const oldExecuted = nodeType.prototype.onExecuted;
  nodeType.prototype.onExecuted = function (output) {
    const connected = sourceConnected(this);
    let previewText = null;

    if (connected) {
      rememberLocalPrompt(this);
      previewText = unwrapPreviewText(output);
      if (previewText != null) {
        this.__terryH3LastPreviewText = previewText;
        // Make the existing H3 execution handler see the external text as its
        // current raw source, then force one final render after it updates media.
        setPromptWidgetValue(this, previewText);
      }
    }

    const result = oldExecuted?.apply(this, arguments);

    if (connected && previewText != null) {
      setEditorValue(this, previewText);
    }
    syncModeSoon(this);
    return result;
  };
}

if (typeof document !== "undefined" && !document.getElementById("terry-h3-readonly-preview-style")) {
  const style = document.createElement("style");
  style.id = "terry-h3-readonly-preview-style";
  style.textContent = `
    .terry-h3-editor.${READONLY_CLASS} {
      cursor: text;
      user-select: text;
      -webkit-user-select: text;
    }
    .terry-h3-editor.${READONLY_CLASS} .terry-h3-chip {
      cursor: default !important;
    }
    .terry-h3-wrap.${READONLY_CLASS} .terry-h3-editor {
      outline-color: color-mix(in srgb, var(--border-color, #777) 75%, transparent);
    }
  `;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TextPreviewMode",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (String(nodeData?.name || "") !== NODE_ID) return;
    patchNodeType(nodeType);
  },
  nodeCreated(node) {
    if (isTarget(node)) syncModeSoon(node);
  },
  loadedGraphNode(node) {
    if (isTarget(node)) syncModeSoon(node);
  },
  afterConfigureGraph() {
    for (const node of app.graph?._nodes || []) if (isTarget(node)) syncModeSoon(node);
  },
});
