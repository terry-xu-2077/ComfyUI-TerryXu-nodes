import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuH3PromptEditor";
function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.comfyClass, node?.constructor?.nodeData?.name]
    .some((value) => String(value || "") === NODE_ID);
}
function applyLayout(node) {
  const wrap = node?.__terryH3Wrap;
  const editor = node?.__terryH3Editor;
  const dom = node?.__terryH3DomWidget;
  if (!wrap || !editor) return false;
  wrap.style.setProperty("height", "504px", "important");
  wrap.style.setProperty("min-height", "0px", "important");
  wrap.style.setProperty("max-height", "728px", "important");
  wrap.style.setProperty("overflow", "hidden", "important");
  wrap.style.setProperty("contain", "size layout paint", "important");
  editor.style.setProperty("height", "100%", "important");
  editor.style.setProperty("min-height", "0px", "important");
  editor.style.setProperty("max-height", "100%", "important");
  editor.style.setProperty("overflow-y", "auto", "important");
  editor.style.setProperty("overflow-x", "hidden", "important");
  if (dom && !dom.__terryPromptLayoutBound) {
    dom.__terryPromptLayoutBound = true;
    dom.computeSize = (width) => [Math.max(300, Number(width) || Number(node.size?.[0]) || 520), 518];
    dom.getMinHeight = () => 420;
    dom.getMaxHeight = () => 728;
  }
  return true;
}
function installSoon(node) {
  let attempts = 0;
  const run = () => { attempts += 1; if (applyLayout(node) || attempts >= 12) return; setTimeout(run, Math.min(800, attempts * 60)); };
  setTimeout(run, 0);
}
app.registerExtension({
  name: "TerryXu.H3PromptLayout",
  setup() {
    const style = document.createElement("style");
    style.id = "terry-h3-prompt-layout-style";
    style.textContent = ".terry-h3-wrap{height:504px!important;min-height:0!important;max-height:728px!important;overflow:hidden!important;contain:size layout paint!important}.terry-h3-editor{height:100%!important;min-height:0!important;max-height:100%!important;overflow-y:auto!important;overflow-x:hidden!important;scrollbar-gutter:stable;overscroll-behavior:contain}";
    document.head.append(style);
  },
  nodeCreated(node) { if (isTarget(node)) installSoon(node); },
  loadedGraphNode(node) { if (isTarget(node)) installSoon(node); },
});
