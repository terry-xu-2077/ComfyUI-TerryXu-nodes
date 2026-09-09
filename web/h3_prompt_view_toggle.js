import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuH3PromptEditor";
const VIEW_PROP = "terry_h3_view_mode";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}

function widget(node, name) { return node?.widgets?.find((item) => item?.name === name) || null; }

function syncView(node) {
  const toggle = widget(node, "visual_preview");
  const button = node.__terryH3ViewButton;
  if (!toggle || !button) return false;
  const wantsVisual = Boolean(toggle.value);
  const isVisual = node?.properties?.[VIEW_PROP] !== "raw";
  if (wantsVisual !== isVisual) button.click();
  button.style.display = "none";
  return true;
}

function bind(node) {
  if (!isTarget(node)) return false;
  const toggle = widget(node, "visual_preview");
  if (!toggle) return false;
  if (!toggle.__terryH3ViewToggleBound) {
    toggle.__terryH3ViewToggleBound = true;
    const original = toggle.callback;
    toggle.callback = function(value) {
      const result = original?.apply(this, arguments);
      toggle.value = Boolean(value);
      queueMicrotask(() => syncView(node));
      return result;
    };
  }
  return syncView(node);
}

function installSoon(node) {
  let attempts = 0;
  const run = () => { attempts += 1; if (bind(node) || attempts >= 12) return; setTimeout(run, Math.min(800, attempts * 60)); };
  setTimeout(run, 0);
}

app.registerExtension({
  name: "TerryXu.H3PromptViewToggle",
  setup() {
    const style = document.createElement("style");
    style.textContent = ".terry-h3-view{display:none!important}";
    document.head.append(style);
  },
  nodeCreated(node) { if (isTarget(node)) installSoon(node); },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});
