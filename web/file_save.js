import { app } from "../../scripts/app.js";
import {
  installFileSavePanel,
  installFileSavePreview,
  scheduleFileSavePanel,
  updateFileSavePreview,
} from "./file_save_panel_ui.js";
import { optimizeFileSaveNativePreview } from "./file_save_native_preview_layout.js";

const NODE_ID = "TerryXuFileSave";
const PANEL_PROP = "__terryFileSavePanel";
const TYPE_WIDGETS = {
  IMAGE:["image_compress_level"],
  AUDIO:["audio_format","audio_quality"],
  VIDEO:["video_format","video_codec","video_encoding","video_crf"],
  STRING:["text_extension","text_custom_extension"],
};
const FILE_WIDGETS = ["filename","append_sequence"];

function isTarget(node) {
  return [node?.comfyClass,node?.type,node?.constructor?.type,node?.constructor?.nodeData?.name].some((v)=>String(v||"")===NODE_ID);
}

function initNode(node) {
  if (!isTarget(node) || typeof node.addDOMWidget !== "function") return;
  for (let index = (node.outputs?.length || 0) - 1; index >= 0; index--) node.removeOutput?.(index);
  installFileSavePanel(node, {
    panelProp:PANEL_PROP,
    widgetName:"terry_file_save_panel",
    typeWidgets:TYPE_WIDGETS,
    fileWidgets:FILE_WIDGETS,
    sequence:true,
  });
  installFileSavePreview(node);
  scheduleFileSavePanel(node, PANEL_PROP);
}

function updatePreview(node, message) {
  updateFileSavePreview(node, message);
  optimizeFileSaveNativePreview(node, message);
}

app.registerExtension({
  name:"TerryXu.FileSave.RoundedPanel",
  beforeRegisterNodeDef(nodeType,nodeData) {
    if (nodeData.name !== NODE_ID) return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function() {
      const result = created?.apply(this,arguments);
      initNode(this);
      return result;
    };
    const connections = nodeType.prototype.onConnectionsChange;
    nodeType.prototype.onConnectionsChange = function() {
      const result = connections?.apply(this,arguments);
      scheduleFileSavePanel(this,PANEL_PROP);
      return result;
    };
    const configure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function() {
      const result = configure?.apply(this,arguments);
      queueMicrotask(()=>initNode(this));
      return result;
    };
    const executed = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function(message) {
      const result = executed?.apply(this, arguments);
      initNode(this);
      updatePreview(this, message);
      return result;
    };
  },
  nodeCreated(node){ if(isTarget(node)) queueMicrotask(()=>initNode(node)); },
  loadedGraphNode(node){ if(isTarget(node)) queueMicrotask(()=>initNode(node)); },
  onNodeOutputsUpdated(outputs) {
    for (const [id, message] of Object.entries(outputs || {})) {
      const node = app.graph?.getNodeById?.(id) || app.rootGraph?.getNodeById?.(id);
      if (isTarget(node)) updatePreview(node, message);
    }
  },
});
