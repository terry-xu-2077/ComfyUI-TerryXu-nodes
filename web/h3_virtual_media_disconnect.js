import { app } from "../../scripts/app.js";

const BUS_TYPE = "TERRY_WIRE_BUS";
const TARGETS = {
  TerryXuH3PromptEditor: "terry_h3_virtual_media_links",
  TerryXuH3ShotTimeline: "terry_h3_timeline_virtual_media_links",
};

function nodeType(node) {
  return String(
    node?.comfyClass ||
      node?.type ||
      node?.constructor?.comfyClass ||
      node?.constructor?.type ||
      node?.constructor?.nodeData?.name ||
      ""
  );
}

function propFor(node) {
  return TARGETS[nodeType(node)] || null;
}

function localeIsZh() {
  try {
    const raw = app?.ui?.settings?.getSettingValue?.("Comfy.Locale");
    const locale = String(raw || navigator.language || "en").toLowerCase().replaceAll("_", "-");
    return locale === "zh" || locale.startsWith("zh-");
  } catch {
    return String(navigator.language || "en").toLowerCase().startsWith("zh");
  }
}

function text(zh, en) {
  return localeIsZh() ? zh : en;
}

function rawDirectLinks(node) {
  if (node?.__terryNativeBus?.getDirectLinks) return node.__terryNativeBus.getDirectLinks();
  const prop = propFor(node);
  if (!prop) return [];
  node.properties ||= {};
  const links = Array.isArray(node.properties[prop]) ? node.properties[prop] : [];
  return links.filter((link) => String(link?.source_type || "").toUpperCase() !== BUS_TYPE);
}

function refreshNode(node) {
  node.__terryH3?.connectionChanged?.();
  node.__terryH3Editor?.refresh?.();
  node.__terryH3ShotTimeline?.refreshAssets?.();
  node.setDirtyCanvas?.(true, true);
  node.graph?.setDirtyCanvas?.(true, true);
}

function setDirectLinks(node, next) {
  if (node?.__terryNativeBus?.setDirectLinks) {
    node.__terryNativeBus.setDirectLinks(Array.isArray(next) ? next : []);
    return true;
  }
  const prop = propFor(node);
  if (!prop) return false;
  node.properties ||= {};
  node.properties[prop] = Array.isArray(next) ? next : [];
  refreshNode(node);
  node.graph?.change?.();
  app.graph?.change?.();
  return true;
}

function hasBus(node) {
  return Boolean(node?.__terryNativeBus?.hasBus?.());
}

function clearAll(node) {
  setDirectLinks(node, []);
  node?.__terryNativeBus?.disconnectBus?.();
  delete node?.properties?.terry_h3_wire_bus_visual_state;
  refreshNode(node);
  node.graph?.change?.();
  app.graph?.change?.();
}

function sourceLabel(node, link, index) {
  const graph = node?.graph || app.graph;
  const source = graph?.getNodeById?.(Number(link?.source_id));
  const slot = Number(link?.source_slot) || 0;
  const output = source?.outputs?.[slot];
  const name = String(output?.label || output?.name || source?.title || "").trim();
  const type = String(output?.type || link?.source_type || "").trim();
  return name || type || `${text("参考", "Reference")} ${index + 1}`;
}

function removeOneDirect(node, index) {
  const links = rawDirectLinks(node);
  if (index < 0 || index >= links.length) return;
  links.splice(index, 1);
  setDirectLinks(node, links);
}

function singleRemoveSubmenu(node) {
  const result = rawDirectLinks(node).map((link, index) => ({
    content: `${index + 1}. ${sourceLabel(node, link, index)}`,
    callback: () => removeOneDirect(node, index),
  }));
  if (hasBus(node)) {
    result.push({
      content: `🚌 ${text("总线参考", "Wire bus reference")}`,
      callback: () => node?.__terryNativeBus?.disconnectBus?.(),
    });
  }
  return result;
}

function installNode(nodeType, nodeData) {
  if (!TARGETS[nodeData?.name] || nodeType.prototype.__terryRemoveReferenceInputsMenuV2) return;
  nodeType.prototype.__terryRemoveReferenceInputsMenuV2 = true;

  const oldMenu = nodeType.prototype.getExtraMenuOptions;
  nodeType.prototype.getExtraMenuOptions = function (canvas, options) {
    let result;
    try {
      result = oldMenu?.apply(this, arguments);
    } catch (error) {
      console.warn("[TerryXu H3] Existing context menu extension failed; keeping base menu available.", error);
    }

    try {
      if (!Array.isArray(options)) return result;
      const direct = rawDirectLinks(this);
      const bus = hasBus(this);
      if (!direct.length && !bus) return result;

      const node = this;
      const removeAll = {
        content: text("✂️ 移除所有参考输入", "✂️ Remove all reference inputs"),
        callback: () => clearAll(node),
      };
      const submenuOptions = singleRemoveSubmenu(node);
      const removeOneMenu = {
        content: text("移除单个参考输入", "Remove a reference input"),
        has_submenu: true,
        submenu: { options: submenuOptions },
      };

      options.push(null, removeAll, removeOneMenu);
    } catch (error) {
      console.warn("[TerryXu H3] Failed to append reference menu; default context menu is preserved.", error);
    }
    return result;
  };
}

app.registerExtension({
  name: "TerryXu.H3VirtualMediaDisconnect",
  beforeRegisterNodeDef(nodeType, nodeData) {
    installNode(nodeType, nodeData);
  },
});
