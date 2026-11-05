let dialogQueue = Promise.resolve();

function ensureStyles(doc) {
  if (doc.getElementById("terryxu-shared-dialog-style")) return;
  const style = doc.createElement("style");
  style.id = "terryxu-shared-dialog-style";
  style.textContent = `
.terryxu-dialog-backdrop{position:fixed;inset:0;z-index:1000000;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.54);box-sizing:border-box}
.terryxu-dialog-panel{width:min(420px,calc(100vw - 40px));box-sizing:border-box;padding:20px;color:#e8e8e8;background:#252525;border:1px solid rgba(255,255,255,.13);border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.48);font:inherit;outline:none}
.terryxu-dialog-title{margin:0 0 14px;font-size:16px;font-weight:600;line-height:1.4;color:#f0f0f0}
.terryxu-dialog-message{margin:0 0 16px;color:#c4c4c4;font-size:13px;line-height:1.65;white-space:pre-line}
.terryxu-dialog-input{display:block;width:100%;height:40px;box-sizing:border-box;padding:0 11px;color:#f1f1f1;background:#191919;border:1px solid #505050;border-radius:7px;outline:none;font:inherit;font-size:14px}
.terryxu-dialog-input:focus{border-color:#8c9cae;box-shadow:0 0 0 2px rgba(140,156,174,.16)}
.terryxu-dialog-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:20px}
.terryxu-dialog-button{min-width:76px;height:34px;padding:0 14px;border:1px solid rgba(255,255,255,.12);border-radius:7px;color:#e6e6e6;background:#383838;font:inherit;font-size:13px;cursor:pointer;transition:background .12s,border-color .12s}
.terryxu-dialog-button:hover{background:#454545;border-color:rgba(255,255,255,.22)}
.terryxu-dialog-button-primary{background:#4a4a4a;color:#fff}
.terryxu-dialog-button-primary:hover{background:#565656}
.terryxu-dialog-button-danger{background:#713b3b;border-color:#8c4b4b;color:#fff}
.terryxu-dialog-button-danger:hover{background:#874747;border-color:#a45a5a}
`;
  doc.head.append(style);
}

function enqueueDialog(render) {
  const pending = dialogQueue.then(render, render);
  dialogQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

function createDialog(options = {}) {
  return enqueueDialog(() => new Promise((resolve) => {
    const doc = globalThis.document;
    if (!doc?.body) {
      resolve(options.mode === "confirm" ? false : null);
      return;
    }
    ensureStyles(doc);
    const previousFocus = doc.activeElement;
    const backdrop = doc.createElement("div");
    backdrop.className = "terryxu-dialog-backdrop";
    const panel = doc.createElement("section");
    panel.className = "terryxu-dialog-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "terryxu-dialog-title");
    panel.tabIndex = -1;
    const title = doc.createElement("h2");
    title.className = "terryxu-dialog-title";
    title.id = "terryxu-dialog-title";
    title.textContent = String(options.title || "");
    panel.append(title);

    if (options.message) {
      const message = doc.createElement("p");
      message.className = "terryxu-dialog-message";
      message.textContent = String(options.message);
      panel.append(message);
    }

    let input = null;
    if (options.mode === "prompt") {
      input = doc.createElement("input");
      input.className = "terryxu-dialog-input";
      input.type = "text";
      input.autocomplete = "off";
      input.spellcheck = false;
      input.value = String(options.value ?? "");
      input.placeholder = String(options.placeholder || "");
      input.setAttribute("aria-label", String(options.inputLabel || options.title || ""));
      panel.append(input);
    }

    const actions = doc.createElement("div");
    actions.className = "terryxu-dialog-actions";
    const cancel = doc.createElement("button");
    cancel.className = "terryxu-dialog-button";
    cancel.type = "button";
    cancel.textContent = String(options.cancelText || "Cancel");
    const confirm = doc.createElement("button");
    confirm.className = "terryxu-dialog-button terryxu-dialog-button-primary";
    if (options.danger) confirm.className += " terryxu-dialog-button-danger";
    confirm.type = "button";
    confirm.textContent = String(options.confirmText || "OK");
    actions.append(cancel, confirm);
    panel.append(actions);
    backdrop.append(panel);
    doc.body.append(backdrop);

    let finished = false;
    const cancelValue = options.mode === "confirm" ? false : null;
    const confirmValue = () => options.mode === "confirm" ? true : String(input?.value ?? "").trim();
    const close = (value) => {
      if (finished) return;
      finished = true;
      doc.removeEventListener("keydown", onKeyDown, true);
      backdrop.remove();
      if (previousFocus?.isConnected) previousFocus.focus?.();
      resolve(value);
    };
    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(cancelValue);
      } else if (event.key === "Enter" && (options.mode === "confirm" || event.target === input)) {
        event.preventDefault();
        event.stopPropagation();
        close(confirmValue());
      } else if (event.key === "Tab") {
        const focusable = [...(input ? [input] : []), cancel, confirm];
        const current = focusable.indexOf(doc.activeElement);
        if (event.shiftKey && current <= 0) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && current === focusable.length - 1) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    }
    cancel.addEventListener("click", () => close(cancelValue));
    confirm.addEventListener("click", () => close(confirmValue()));
    backdrop.addEventListener("pointerdown", (event) => {
      if (event.target === backdrop) close(cancelValue);
    });
    doc.addEventListener("keydown", onKeyDown, true);
    if (input) { input.focus(); input.select(); } else confirm.focus();
  }));
}

export function showTextPrompt(options = {}) {
  return createDialog({ ...options, mode: "prompt" });
}

export function showConfirm(options = {}) {
  return createDialog({ ...options, mode: "confirm" });
}
