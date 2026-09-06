import { app } from "../../scripts/app.js";

const NODE_ID = "TerryXuH3PromptEditor";
const TITLE_ZH = "📃 H3提示词编辑器";
const TITLE_EN = "📃 H3 Prompt Editor";
const LEGACY = new Set([
  "TerryXu H3 提示词编辑器",
  "TerryXu | H3 提示词编辑器",
  "H3 提示词编辑器",
  "H3提示词编辑器",
  "TerryXu H3 Prompt Editor",
  "H3 Prompt Editor",
]);

function isChinese() {
  try {
    const locale = app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || navigator.language || "en";
    return String(locale).toLowerCase().replaceAll("_", "-").startsWith("zh");
  } catch {
    return false;
  }
}

function desiredTitle() {
  return isChinese() ? TITLE_ZH : TITLE_EN;
}

function syncTitle(node, force = false) {
  if (!node) return;
  const current = String(node.title || "").trim();
  if (force || !current || LEGACY.has(current)) node.title = desiredTitle();
}

app.registerExtension({
  name: "TerryXu.H3TitleFix",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;

    // Set the definition and constructor title before LiteGraph creates instances.
    nodeData.display_name = desiredTitle();
    nodeType.title = desiredTitle();
    nodeType.prototype.title = desiredTitle();

    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      syncTitle(this, true);
      queueMicrotask(() => syncTitle(this, true));
      return result;
    };

    const configured = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function () {
      const result = configured?.apply(this, arguments);
      syncTitle(this);
      queueMicrotask(() => syncTitle(this));
      return result;
    };
  },

  setup() {
    queueMicrotask(() => {
      for (const node of app.graph?._nodes || []) {
        const type = String(node?.comfyClass || node?.type || node?.constructor?.comfyClass || node?.constructor?.type || "");
        if (type === NODE_ID) syncTitle(node);
      }
      app.graph?.setDirtyCanvas?.(true, true);
    });
  },
});
