import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuDateFormatter";

function isTarget(node) {
  return [node?.comfyClass, node?.type, node?.constructor?.type, node?.constructor?.nodeData?.name]
    .some((v) => String(v || "") === NODE_ID);
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replace("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch {
    return String(navigator.language || "en").toLowerCase().startsWith("zh");
  }
}

function installHint(node) {
  if (!isTarget(node) || node.__terryDateFormatHint || typeof node.addDOMWidget !== "function") return;

  const root = document.createElement("div");
  Object.assign(root.style, {
    width: "100%",
    boxSizing: "border-box",
    padding: "1px 10px 5px",
    font: "10px/1.5 Inter,system-ui,sans-serif",
    opacity: ".58",
    whiteSpace: "normal",
    overflowWrap: "anywhere",
    pointerEvents: "none",
  });

  const refreshText = () => {
    root.textContent = localeIsZh()
      ? "YYYY = 年 · MM = 月 · DD = 日 · HH = 时 · mm = 分 · ss = 秒"
      : "YYYY = year · MM = month · DD = day · HH = hour · mm = minute · ss = second";
  };
  refreshText();

  const dom = node.addDOMWidget("terry_date_format_hint", "terry_date_format_hint", root, {
    serialize: false,
    hideOnZoom: false,
    getMinHeight: () => 24,
    getMaxHeight: () => 40,
  });
  dom.serialize = false;
  node.__terryDateFormatHint = { root, dom, refreshText };

  try {
    const measured = node.computeSize?.();
    if (measured) node.setSize?.([Math.max(node.size?.[0] || 0, measured[0] || 0), measured[1]]);
  } catch {}
}

app.registerExtension({
  name: "TerryXu.DateFormatter.Hint",
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this, arguments);
      installHint(this);
      return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = configure?.apply(this, arguments);
      queueMicrotask(() => installHint(this));
      return result;
    };
  },
  nodeCreated(node) {
    if (isTarget(node)) queueMicrotask(() => installHint(node));
  },
  loadedGraphNode(node) {
    if (isTarget(node)) queueMicrotask(() => installHint(node));
  },
  setup() {
    let last = localeIsZh();
    setInterval(() => {
      const next = localeIsZh();
      if (next === last) return;
      last = next;
      for (const node of app.graph?._nodes || []) {
        if (isTarget(node)) node.__terryDateFormatHint?.refreshText?.();
      }
    }, 500);
  },
});
