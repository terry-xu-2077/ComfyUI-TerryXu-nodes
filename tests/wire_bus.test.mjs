import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "../web/switch_bus_route.mjs";
import { mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

const BUS = "TERRY_WIRE_BUS";

test("connected bus cable endpoints align with centered capsules, while individual lanes retain their spacing", async () => {
  const source = (await readFile(new URL("../web/wire_bus_visual.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const context = vm.createContext({ isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE, app: { registerExtension() {} }, requestAnimationFrame() {},
    LiteGraph: { NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 } });
  vm.runInContext(source + "\nglobalThis.patchBusNode = patchBusNode;", context);
  for (const type of ["TerryXuWirelessBusPack"]) {
    const node = { type, pos: [100, 200], size: [112, 160], inputs: [{ type: BUS, link: 1 }],
      getInputPos() { return [99, 199]; }, getOutputPos() { return [213, 201]; } };
    context.patchBusNode(node);
    assert.equal(node.getInputPos(0)[1], node.getOutputPos(0)[1]);
    assert.equal(node.getInputPos(0)[1], 265);
    assert.equal(node.getInputPos(0)[0], 100);
    // Dragging the node or restoring its height must move both endpoints alike.
    node.pos[1] += 80;
    node.size[1] += 40;
    assert.equal(node.getInputPos(0)[1], node.getOutputPos(0)[1]);
    node.inputs = [{ type: "IMAGE", link: 2 }, { type: "*", link: null }];
    assert.equal(node.getInputPos(1)[1] - node.getInputPos(0)[1], 20);
    const laneCenter = (node.getInputPos(0)[1] + node.getInputPos(1)[1]) / 2;
    assert.equal(laneCenter, node.getOutputPos(0)[1] - 19);
    node.flags = { collapsed: true };
    assert.deepEqual(node.getInputPos(0), [99, 199]);
  }
});


test("only wireless channel bus nodes are registered", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  let extension;
  const app = {
    graph: { _nodes: [] },
    ui: { settings: { getSettingValue: () => "zh-CN" } },
    registerExtension(value) { extension = value; },
  };
  const context = vm.createContext({
    app, mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2 }, queueMicrotask() {},
  });
  vm.runInContext(source, context);

  const defs = {};
  extension.addCustomNodeDefs(defs);
  assert.deepEqual(Object.keys(defs).sort(), [
    "TerryXuWirelessBusPack", "TerryXuWirelessBusUnpack",
  ]);
  assert.equal(defs.TerryXuWirelessBusPack.display_name, "↔️ 总线-入");
  assert.equal(defs.TerryXuWirelessBusUnpack.display_name, "↔️ 总线-出");
});


test("manually named Bus-In lanes stay pinned when disconnected and keep their custom name", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const graph = { _nodes: [], setDirtyCanvas() {} };
  const context = vm.createContext({
    app: { graph, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.busTest = {packLaneEntries,refreshPackSlots};", context);

  const lane = { name: "wire", label: "[空] 摄影机模型", type: "*", link: null, terry_lane_id: "lane_camera" };
  const addWire = { name: "wire", label: "添加线束", type: "*", link: null };
  const pack = {
    id: 10,
    type: "TerryXuWirelessBusPack",
    graph,
    properties: { terry_wire_bus_named_lanes: { lane_camera: "摄影机模型" } },
    inputs: [lane, addWire],
    outputs: [{ name: "bus", type: "TERRY_WIRE_BUS", links: [] }],
    size: [112, 120],
    setSize(size) { this.size = size; },
    removeInput(index) { this.inputs.splice(index, 1); },
    addInput(name, type) {
      const input = { name, label: name, type, link: null };
      this.inputs.push(input);
      return input;
    },
  };
  graph._nodes.push(pack);

  const entries = context.busTest.packLaneEntries(pack);
  assert.equal(entries[0].name, "摄影机模型");
  assert.equal(entries[0].lane.named, true);

  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some((input) => input.terry_lane_id === "lane_camera"), true);
  assert.equal(pack.properties.terry_wire_bus_named_lanes.lane_camera, "摄影机模型");
});

test("unnamed empty Bus-In lanes remain eligible for automatic cleanup", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const graph = { _nodes: [], setDirtyCanvas() {} };
  const context = vm.createContext({
    app: { graph, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.busTest = {refreshPackSlots};", context);

  const lane = { name: "wire", label: "模型", type: "*", link: null, terry_lane_id: "lane_auto" };
  const addWire = { name: "wire", label: "添加线束", type: "*", link: null };
  const pack = {
    id: 11,
    type: "TerryXuWirelessBusPack",
    graph,
    properties: {},
    inputs: [lane, addWire],
    outputs: [{ name: "bus", type: "TERRY_WIRE_BUS", links: [] }],
    size: [112, 120],
    setSize(size) { this.size = size; },
    removeInput(index) { this.inputs.splice(index, 1); },
    addInput(name, type) {
      const input = { name, label: name, type, link: null };
      this.inputs.push(input);
      return input;
    },
  };
  graph._nodes.push(pack);

  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some((input) => input.terry_lane_id === "lane_auto"), false);
});


test("switch and Bus-In lane names use the shared TerryXu dialog instead of browser-native prompts", async () => {
  const [switchUi, busUi, dialog] = await Promise.all([
    readFile(new URL("../web/switch_ui.js", import.meta.url), "utf8"),
    readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"),
    readFile(new URL("../web/terry_dialog.js", import.meta.url), "utf8"),
  ]);
  assert.match(switchUi, /from "\.\/terry_dialog\.js"/);
  assert.match(busUi, /from "\.\/terry_dialog\.js"/);
  assert.match(switchUi, /showTextPrompt\(/);
  assert.match(busUi, /showTextPrompt\(/);
  assert.match(busUi, /showConfirm\(/);
  assert.doesNotMatch(switchUi, /globalThis\.prompt|window\.prompt/);
  assert.doesNotMatch(busUi, /globalThis\.prompt|window\.prompt|globalThis\.confirm|window\.confirm/);
  assert.match(dialog, /aria-modal/);
  assert.match(dialog, /terryxu-dialog-backdrop/);
  assert.match(dialog, /showTextPrompt/);
  assert.match(dialog, /showConfirm/);
});
