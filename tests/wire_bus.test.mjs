import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "../web/switch_bus_route.mjs";
import { mediaLanes, moveMedia, mediaExecutionSource } from "../web/media_loader_model.mjs";

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


test("renaming an empty Bus-In port does not pin it and automatic cleanup removes it", async () => {
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
    id: 10, type: "TerryXuWirelessBusPack", graph,
    properties: { terry_wire_bus_named_lanes: { lane_camera: "摄影机模型" } },
    inputs: [lane, addWire],
    outputs: [{ name: "bus", type: "TERRY_WIRE_BUS", links: [] }],
    size: [112, 120], setSize(size) { this.size = size; },
    removeInput(index) { this.inputs.splice(index, 1); },
    addInput(name, type) {
      const input = { name, label: name, type, link: null };
      this.inputs.push(input);
      return input;
    },
  };
  graph._nodes.push(pack);

  assert.equal(context.busTest.packLaneEntries(pack)[0].lane.named, true);
  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some((input) => input.terry_lane_id === "lane_camera"), false);
  assert.equal(pack.properties.terry_wire_bus_named_lanes.lane_camera, undefined);
});

test("pinned empty Bus-In ports survive cleanup until they are unpinned", async () => {
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

  const lane = { name: "wire", label: "[空] 保留端口", type: "*", link: null, terry_lane_id: "lane_fixed" };
  const addWire = { name: "wire", label: "添加线束", type: "*", link: null };
  const pack = {
    id: 12, type: "TerryXuWirelessBusPack", graph,
    properties: {
      terry_wire_bus_named_lanes: { lane_fixed: "保留端口" },
      terry_wire_bus_pinned_lanes: { lane_fixed: true },
    },
    inputs: [lane, addWire],
    outputs: [{ name: "bus", type: "TERRY_WIRE_BUS", links: [] }],
    size: [112, 120], setSize(size) { this.size = size; },
    removeInput(index) { this.inputs.splice(index, 1); },
    addInput(name, type) {
      const input = { name, label: name, type, link: null };
      this.inputs.push(input);
      return input;
    },
  };
  graph._nodes.push(pack);

  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some((input) => input.terry_lane_id === "lane_fixed"), true);
  assert.equal(context.busTest.packLaneEntries(pack)[0].lane.pinned, true);

  delete pack.properties.terry_wire_bus_pinned_lanes.lane_fixed;
  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some((input) => input.terry_lane_id === "lane_fixed"), false);
});
test("resizing a wireless bus node down ignores its previously stored larger width", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({
    app: { graph: { _nodes: [] }, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.layoutTest = {resizeCompactBusNode,stableExpandedHeight};", context);
  const node = {
    type: "TerryXuWirelessBusPack",
    size: [180, 130],
    properties: { terry_wire_bus_width: 320 },
    __terryBusLayoutInitialized: true,
    __terryBusPreferredHeight: 112,
    __terryBusMinHeight: 100,
    inputs: [{ name: "wire", type: "IMAGE", terry_lane_id: "lane_a", link: 1 }],
    outputs: [{ name: "bus", type: BUS, links: [] }],
    setSize(size) { this.size = size; },
  };
  context.layoutTest.resizeCompactBusNode(node, 1);
  assert.equal(node.size[0], 180);
  assert.equal(node.size[1], 130);
  assert.equal(context.layoutTest.stableExpandedHeight(node), 130);
});

test("a pinned Bus-Out port keeps its empty upstream Bus-In lane", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const graph = {
    _nodes: [],
    links: { 1: { id: 1, origin_id: 20, origin_slot: 0, target_id: 21, target_slot: 0, type: BUS } },
    getNodeById(id) { return this._nodes.find(node => String(node.id) === String(id)); },
    setDirtyCanvas() {},
    change() {},
  };
  const context = vm.createContext({
    app: { graph, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.busTest = {refreshPackSlots};", context);

  const pack = {
    id: 20, type: "TerryXuWirelessBusPack", graph,
    properties: { terry_wire_bus_lanes: [{ id: "lane_empty", name: "空端口", type: "*" }] },
    inputs: [
      { name: "wire", label: "[空] 空端口", type: "*", link: null, terry_lane_id: "lane_empty" },
      { name: "wire", label: "添加线束", type: "*", link: null },
    ],
    outputs: [{ name: "bus", type: BUS, links: [1] }],
    size: [180, 140], setSize(size) { this.size = size; },
    removeInput(index) { this.inputs.splice(index, 1); },
    addInput(name, type) { const input = { name, label: name, type, link: null }; this.inputs.push(input); return input; },
  };
  const unpack = {
    id: 21, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: BUS, link: 1 }],
    outputs: [{ name: "空端口", label: "空端口", type: "*", terry_lane_id: "lane_empty", links: [] }],
    properties: { terry_wire_bus_expand_outputs: true, terry_wire_bus_pinned_outputs: { "0": true } },
    size: [180, 140], setSize(size) { this.size = size; },
    removeOutput(index) { this.outputs.splice(index, 1); },
    addOutput(name, type) { const output = { name, label: name, type, links: [] }; this.outputs.push(output); return output; },
  };
  graph._nodes.push(pack, unpack);

  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some(input => input.terry_lane_id === "lane_empty"), true);

  delete unpack.properties.terry_wire_bus_pinned_outputs["0"];
  context.busTest.refreshPackSlots(pack);
  assert.equal(pack.inputs.some(input => input.terry_lane_id === "lane_empty"), false);
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


test("Bus port configuration replaces inline edit and delete affordances", async () => {
  const [switchUi, busUi, dialog] = await Promise.all([
    readFile(new URL("../web/switch_ui.js", import.meta.url), "utf8"),
    readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"),
    readFile(new URL("../web/terry_dialog.js", import.meta.url), "utf8"),
  ]);
  assert.match(switchUi, /from "\.\/terry_dialog\.js"/);
  assert.match(switchUi, /showTextPrompt\(/);
  assert.match(busUi, /terry-wire-bus-port-config-button/);
  assert.match(busUi, /terry-wire-bus-port-config-overlay/);
  assert.match(busUi, /function createPortPinIcon\(/);
  assert.match(busUi, /terry-wire-bus-port-pin-shape/);
  assert.match(busUi, /fill:currentColor/);
  assert.match(busUi, /text\.unfix/);
  assert.doesNotMatch(busUi, /textContent = "📌"/);
  assert.match(busUi, /terry_wire_bus_pinned_lanes/);
  assert.match(busUi, /terry_wire_bus_pinned_outputs/);
  assert.doesNotMatch(busUi, /\.text-node-component-slot-text:hover::after/);
  assert.doesNotMatch(busUi, /terry-wire-bus-port-actions-visible|deleteNamedLane/);
  assert.match(dialog, /aria-modal/);
});


test("renaming a Bus-Out lane updates its owning Bus-In and every paired Bus-Out", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const graph = {
    _nodes: [],
    links: {
      1: { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      2: { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 },
      3: { id: 3, origin_id: 2, origin_slot: 0, target_id: 6, target_slot: 0 },
      4: { id: 4, origin_id: 4, origin_slot: 0, target_id: 5, target_slot: 0 },
      5: { id: 5, origin_id: 6, origin_slot: 0, target_id: 4, target_slot: 0 },
    },
    getNodeById(id) { return this._nodes.find((node) => String(node.id) === String(id)); },
    change() {},
    setDirtyCanvas() {},
  };
  const app = {
    graph,
    ui: { settings: { getSettingValue: () => "zh-CN" } },
    registerExtension() {},
  };
  const context = vm.createContext({
    app,
    navigator: { language: "zh-CN" },
    showTextPrompt: () => Promise.resolve(null),
    showConfirm: () => Promise.resolve(false),
  });
  vm.runInContext(source + "\nglobalThis.busNamedTest = { outputRenameEntries, setLaneName };", context);

  const sourceNode = {
    id: 1, type: "ModelSource",
    outputs: [{ name: "MODEL", label: "MODEL", type: "MODEL", links: [1] }],
  };
  const pack = {
    id: 2, type: "TerryXuWirelessBusPack", graph,
    properties: {
      terry_wire_bus_lanes: [{ id: "lane_model", name: "MODEL", type: "MODEL" }],
      terry_wire_bus_named_lanes: {},
    },
    inputs: [{ name: "wire", label: "MODEL", type: "MODEL", link: 1, terry_lane_id: "lane_model" }],
    outputs: [{ name: "bus", label: "bus", type: "TERRY_WIRE_BUS", links: [2, 3] }],
    size: [180, 120],
    setDirtyCanvas() {},
  };
  const directUnpack = {
    id: 3, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: "TERRY_WIRE_BUS", link: 2 }],
    outputs: [{ name: "MODEL", label: "MODEL", type: "MODEL", terry_lane_id: "lane_model", links: [] }],
    setDirtyCanvas() {},
  };
  const relayUnpack = {
    id: 6, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: "TERRY_WIRE_BUS", link: 3 }],
    outputs: [{ name: "bus", label: "bus", type: "TERRY_WIRE_BUS", links: [5] }],
    setDirtyCanvas() {},
  };
  const bridgePack = {
    id: 4, type: "TerryXuWirelessBusPack", graph,
    properties: { terry_wire_bus_lanes: [{ id: "bridge_bus", name: "bus", type: "TERRY_WIRE_BUS" }] },
    inputs: [{ name: "bus", label: "bus", type: "TERRY_WIRE_BUS", link: 5, terry_lane_id: "bridge_bus" }],
    outputs: [{ name: "bus", label: "bus", type: "TERRY_WIRE_BUS", links: [4] }],
    size: [180, 120],
    setDirtyCanvas() {},
  };
  const bridgedUnpack = {
    id: 5, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: "TERRY_WIRE_BUS", link: 4 }],
    outputs: [{ name: "MODEL", label: "MODEL", type: "MODEL", terry_lane_id: "lane_model", links: [] }],
    setDirtyCanvas() {},
  };
  graph._nodes.push(sourceNode, pack, directUnpack, relayUnpack, bridgePack, bridgedUnpack);

  const outputEntry = context.busNamedTest.outputRenameEntries(bridgedUnpack)[0];
  assert.equal(outputEntry.pack, pack);
  assert.equal(outputEntry.entry.laneId, "lane_model");

  context.busNamedTest.setLaneName(pack, outputEntry.entry, "摄影机模型");

  assert.equal(pack.properties.terry_wire_bus_named_lanes.lane_model, "摄影机模型");
  assert.equal(pack.inputs[0].label.includes("摄影机模型"), true);
  assert.equal(directUnpack.outputs[0].name, "摄影机模型");
  assert.equal(bridgedUnpack.outputs[0].name, "摄影机模型");
  assert.equal(directUnpack.outputs[0].label.includes("✎"), false);
  assert.equal(bridgedUnpack.outputs[0].label.includes("✎"), false);
});


test("wireless bus nodes can shrink after being enlarged", async () => {
  const source = (await readFile(new URL("../web/wire_bus_visual.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const context = vm.createContext({
    app: { registerExtension() {} },
    requestAnimationFrame() {},
  });
  vm.runInContext(source + "\nglobalThis.patchBusNode = patchBusNode;", context);

  const node = {
    type: "TerryXuWirelessBusPack",
    size: [112, 180],
    properties: {},
    __terryBusExpandedSize: [112, 180],
    __terryBusMinHeight: 120,
    onResize() {},
  };
  context.patchBusNode(node);
  node.size = [280, 260];
  node.onResize();

  assert.deepEqual(node.size, [280, 260]);
  assert.equal(node.properties.terry_wire_bus_width, 280);
  assert.equal(node.__terryBusCompactWidth, 280);

  node.size = [150, 90];
  node.onResize();
  assert.deepEqual(node.size, [150, 120]);
  assert.deepEqual(node.__terryBusExpandedSize, [150, 120]);
});

test("Bus-In and Bus-Out expose a single configuration control below the node", async () => {
  const [bus, visual, namedPorts] = await Promise.all([
    readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"),
    readFile(new URL("../web/wire_bus_visual.js", import.meta.url), "utf8"),
    readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"),
  ]);
  assert.match(bus, /this\.resizable = true;/);
  assert.match(bus, /terry_wire_bus_width/);
  assert.match(visual, /width:\$\{compactWidth\}px !important/);
  assert.match(namedPorts, /terry-wire-bus-port-config-button/);
  assert.match(namedPorts, /function openPortConfig\(/);
  assert.match(namedPorts, /function setPackLanePinned\(/);
  assert.match(namedPorts, /function setUnpackOutputPinned\(/);
  assert.doesNotMatch(namedPorts, /\.text-node-component-slot-text:hover::after/);
  assert.doesNotMatch(namedPorts, /terry-wire-bus-port-actions-visible|deleteNamedLane/);
});


test("port pin icon is a vector outline that can be filled for the pinned state", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const document = {
    createElementNS(namespace, tagName) {
      return {
        tagName,
        attributes: {},
        children: [],
        setAttribute(name, value) { this.attributes[name] = value; },
        append(...children) { this.children.push(...children); },
      };
    },
  };
  const context = vm.createContext({ document });
  vm.runInContext(source + "\nglobalThis.configTest = { createPortPinIcon };", context);

  const icon = context.configTest.createPortPinIcon();
  assert.equal(icon.tagName, "svg");
  assert.equal(icon.attributes.viewBox, "0 0 24 24");
  assert.equal(icon.children.length, 2);
  assert.equal(icon.children[0].attributes.class, "terry-wire-bus-port-pin-shape");
  assert.equal(icon.children[1].attributes.class, "terry-wire-bus-port-pin-stem");
});

test("port configuration exposes rename and pin state for each Bus-In port", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const graph = { change() {}, setDirtyCanvas() {} };
  const context = vm.createContext({
    app: { graph: { _nodes: [] }, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    navigator: { language: "zh-CN" },
  });
  vm.runInContext(source + "\nglobalThis.configTest = {portConfigEntries,setPackLanePinned};", context);

  const pack = {
    id: 15, type: "TerryXuWirelessBusPack", graph,
    properties: {
      terry_wire_bus_lanes: [{ id: "lane_camera", name: "摄影机模型", type: "IMAGE" }],
      terry_wire_bus_named_lanes: { lane_camera: "摄影机模型" },
    },
    inputs: [
      { name: "摄影机模型", label: "摄影机模型", type: "IMAGE", link: 1, terry_lane_id: "lane_camera" },
      { name: "wire", label: "添加线束", type: "*", link: null },
    ],
  };
  const first = context.configTest.portConfigEntries(pack);
  assert.equal(first.length, 1);
  assert.equal(first[0].label, "摄影机模型");
  assert.equal(first[0].pinned, false);

  context.configTest.setPackLanePinned(pack, first[0].entry, true);
  const afterPin = context.configTest.portConfigEntries(pack);
  assert.equal(afterPin[0].pinned, true);
  assert.equal(pack.properties.terry_wire_bus_pinned_lanes.lane_camera, true);
});

test("wireless bus channel control receives the port configuration gear button", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const context = vm.createContext({
    app: { graph: { _nodes: [] }, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    document: {
      createElement() {
        return {
          addEventListener() {},
          setAttribute() {},
          className: "",
          textContent: "",
          title: "",
          type: "",
        };
      },
    },
    navigator: { language: "zh-CN" },
    setTimeout() {},
  });
  vm.runInContext(source + "\nglobalThis.configTest = { ensurePortConfigButton };", context);

  const appended = [];
  const root = { querySelector() { return null; }, append(button) { appended.push(button); } };
  const node = { type: "TerryXuWirelessBusPack", __terryWirelessControl: { root } };
  context.configTest.ensurePortConfigButton(node);

  assert.equal(appended.length, 1);
  assert.equal(appended[0].className, "terry-wire-bus-port-config-button");
  assert.equal(appended[0].textContent, "⚙");
  assert.equal(appended[0].title, "端口配置");
});
test("Bus-Out keeps its manual width with a Media Loader source", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({
    app: { graph: { _nodes: [] }, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.layoutTest = { findPackFromUnpack, effectivePackLaneEntries, resizeCompactBusNode };", context);
  let lanes = Array.from({ length: 9 }, (_, index) => ({ laneId: `media_${index}`, lane: { id: `media_${index}` }, type: index < 6 ? "IMAGE" : "AUDIO" }));
  const graph = {
    _nodes: [],
    links: { 1: { id: 1, origin_id: 90, origin_slot: 0, target_id: 91, target_slot: 0 } },
    getNodeById(id) { return this._nodes.find((node) => String(node.id) === String(id)); },
  };
  const mediaPack = { id: 90, type: "TerryXuMediaLoader", graph, outputs: [{ type: "TERRY_WIRE_BUS", links: [1] }], __terryBusLaneEntries: () => lanes };
  const busOut = { id: 91, type: "TerryXuWirelessBusUnpack", graph, inputs: [{ link: 1, type: "TERRY_WIRE_BUS" }], properties: { terry_wire_bus_width: 264 }, size: [264, 120], setSize(size) { this.size = size; } };
  graph._nodes.push(mediaPack, busOut);
  const pairedPack = context.layoutTest.findPackFromUnpack(busOut);
  assert.equal(pairedPack, mediaPack);
  const first = context.layoutTest.effectivePackLaneEntries(pairedPack);
  context.layoutTest.resizeCompactBusNode(busOut, first.length, pairedPack);
  const firstHeight = busOut.size[1];
  assert.equal(first.length, 9);
  assert.equal(busOut.size[0], 264);
  assert.equal(busOut.properties.terry_wire_bus_width, 264);
  lanes = [...lanes, ...Array.from({ length: 6 }, (_, index) => ({ laneId: `extra_${index}`, lane: { id: `extra_${index}` }, type: "VIDEO" }))];
  const next = context.layoutTest.effectivePackLaneEntries(pairedPack);
  context.layoutTest.resizeCompactBusNode(busOut, next.length, pairedPack);
  assert.equal(next.length, 15);
  assert.equal(busOut.size[0], 264);
  assert.ok(busOut.size[1] > firstHeight);
  assert.equal(busOut.widgets_start_y, busOut.size[1] - 70);
});


test("renamed-only Media Bus-Out ports disappear while pinned empty ports remain", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const graph = {
    _nodes: [],
    links: { 1: { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: BUS } },
    getNodeById(id) { return this._nodes.find(node => String(node.id) === String(id)); },
    setDirtyCanvas() {},
  };
  const context = vm.createContext({
    app: { graph, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} },
    mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.busTest = {syncUnpack};", context);

  const mediaLoader = {
    id: 1, type: "TerryXuMediaLoader", graph,
    outputs: [{ type: BUS, links: [1] }],
    __terryBusLaneEntries: () => [],
  };
  const busOut = {
    id: 2, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ type: BUS, link: 1 }],
    outputs: [{ name: "自定义名称", label: "自定义名称", type: "IMAGE", links: [] }],
    properties: {
      terry_wire_bus_expand_outputs: true,
      terry_wire_bus_media_outputs: true,
      terry_wire_bus_named_outputs: { "0": "自定义名称" },
    },
    addOutput(name, type) { const output = { name, label: name, type, links: [] }; this.outputs.push(output); return output; },
    removeOutput(index) { this.outputs.splice(index, 1); },
    setSize(size) { this.size = size; },
    size: [180, 160],
  };
  graph._nodes.push(mediaLoader, busOut);

  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs.length, 0);
  assert.equal(busOut.properties.terry_wire_bus_named_outputs, undefined);

  busOut.outputs.push({ name: "固定空端口", label: "固定空端口", type: "IMAGE", links: [] });
  busOut.properties.terry_wire_bus_named_outputs = { "0": "固定空端口" };
  busOut.properties.terry_wire_bus_pinned_outputs = { "0": true };
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs.length, 1);
  assert.match(busOut.outputs[0].name, /固定空端口/);

  delete busOut.properties.terry_wire_bus_pinned_outputs["0"];
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs.length, 0);

  busOut.properties.terry_wire_bus_pinned_outputs = { "0": true };
  busOut.properties.terry_wire_bus_pinned_output_types = { "0": "IMAGE" };
  busOut.properties.terry_wire_bus_pinned_output_defaults = { "0": "图片 1" };
  busOut.outputs = [];
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs.length, 1);
  assert.equal(busOut.outputs[0].type, "IMAGE");
  assert.equal(busOut.outputs[0].__terryBusDefaultLabel, "图片 1");
});

test("Media Loader replacement preserves Bus-Out links and keeps H3 inputs in media order", async () => {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const graph = {
    _nodes: [],
    links: {
      1: { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: BUS },
      2: { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0, type: "IMAGE" },
      3: { id: 3, origin_id: 2, origin_slot: 1, target_id: 3, target_slot: 1, type: "IMAGE" },
    },
    getNodeById(id) { return this._nodes.find(node => String(node.id) === String(id)); },
    setDirtyCanvas() {},
  };
  const app = {
    graph,
    ui: { settings: { getSettingValue: () => "zh-CN" } },
    registerExtension() {},
    graphToPrompt: async () => ({ output: {
      "1": { class_type: "TerryXuMediaLoader", inputs: { assets_json: "{}" } },
      "4": { class_type: "TerryXuMediaLoader", inputs: { assets_json: "{}" } },
      "3": { class_type: "MiniMaxH3ReferenceToVideo", inputs: {
        "ref_images.ref_image_0": ["2", 0],
        "ref_images.ref_image_1": ["2", 1],
        prompt: "test",
      } },
    } }),
  };
  const context = vm.createContext({
    app, mediaExecutionSource, navigator: { language: "zh-CN" },
    LiteGraph: { INPUT: 1, OUTPUT: 2, NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 },
    queueMicrotask() {},
  });
  vm.runInContext(source + "\nglobalThis.busTest = { syncUnpack, patchGraphToPrompt };", context);

  let firstGroups = { image: [asset("a"), asset("b")], audio: [], video: [] };
  let secondGroups = { image: [asset("x"), asset("y")], audio: [], video: [] };
  const makeMediaLoader = (id, getGroups) => {
    const node = {
      id, type: "TerryXuMediaLoader", graph, size: [640, 740],
      outputs: [{ name: "bus", type: BUS, links: [] }],
    };
    node.__terryBusLaneEntries = () => mediaLanes(node, getGroups());
    return node;
  };
  const firstLoader = makeMediaLoader(1, () => firstGroups);
  const secondLoader = makeMediaLoader(4, () => secondGroups);
  firstLoader.outputs[0].links = [1];

  const makeOutput = (name, type, laneId, slot, links) => {
    const output = { name, label: name, type, terry_lane_id: laneId };
    Object.defineProperty(output, "links", {
      get: () => Object.values(graph.links)
        .filter(link => link.origin_id === 2 && link.origin_slot === slot)
        .map(link => link.id),
    });
    return output;
  };
  const busOut = {
    id: 2, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: BUS, link: 1 }],
    outputs: [
      makeOutput("图片 1", "IMAGE", "a", 0, [2]),
      makeOutput("图片 2", "IMAGE", "b", 1, [3]),
    ],
    properties: { terry_wire_bus_named_outputs: { "0": "主视觉", "1": "角色参考" } }, widgets: [], size: [160, 200],
    setSize(size) { this.size = size; },
    setDirtyCanvas() {},
    addOutput(name, type) {
      const slot = this.outputs.length;
      const output = makeOutput(name, type, "", slot, []);
      this.outputs.push(output);
      return output;
    },
    removeOutput(index) { this.outputs.splice(index, 1); },
    disconnectOutput(index, target, targetSlot) {
      for (const id of [...(this.outputs[index]?.links || [])]) delete graph.links[id];
    },
  };
  const h3 = {
    id: 3, type: "MiniMaxH3ReferenceToVideo", graph,
    inputs: [
      { name: "ref_images.ref_image_0", link: 2 },
      { name: "ref_images.ref_image_1", link: 3 },
    ],
  };
  graph._nodes.push(firstLoader, secondLoader, busOut, h3);
  context.busTest.syncUnpack(busOut, true);
  const stablePorts = [...busOut.outputs];
  assert.ok(busOut.outputs.every(output => !Object.prototype.hasOwnProperty.call(output, "terry_lane_id")));
  assert.deepEqual(busOut.outputs.map(output => output.name), ["主视觉", "角色参考"]);

  // Disconnecting the old loader is a transient state: it must not remove
  // output slots or sever either H3 connection.
  busOut.inputs[0].link = null;
  delete graph.links[1];
  firstLoader.outputs[0].links = [];
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs[0], stablePorts[0]);
  assert.equal(busOut.outputs[1], stablePorts[1]);
  assert.deepEqual(busOut.outputs.map(output => output.links), [[2], [3]]);
  assert.equal(graph.links[2].origin_slot, 0);
  assert.equal(graph.links[3].origin_slot, 1);

  // A different loader may have completely different asset IDs. The Bus-Out
  // ports remain positional and are rebound to the new loader in-place.
  graph.links[4] = { id: 4, origin_id: 4, origin_slot: 0, target_id: 2, target_slot: 0, type: BUS };
  secondLoader.outputs[0].links = [4];
  busOut.inputs[0].link = 4;
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs[0], stablePorts[0]);
  assert.equal(busOut.outputs[1], stablePorts[1]);
  assert.ok(busOut.outputs.every(output => !Object.prototype.hasOwnProperty.call(output, "terry_lane_id")));
  assert.deepEqual(secondLoader.__terryBusLaneEntries().map(entry => entry.name), ["图片 1", "图片 2"]);
  assert.deepEqual(busOut.outputs.map(output => output.name), ["主视觉", "角色参考"]);
  assert.deepEqual(busOut.outputs.map(output => output.links), [[2], [3]]);
  assert.equal(graph.links[2].origin_slot, 0);
  assert.equal(graph.links[3].origin_slot, 1);
  assert.equal(h3.inputs[0].link, 2);
  assert.equal(h3.inputs[1].link, 3);

  context.busTest.patchGraphToPrompt();
  let { output } = await app.graphToPrompt();
  assert.deepEqual(output["3"].inputs["ref_images.ref_image_0"], ["4:media:x", 0]);
  assert.deepEqual(output["3"].inputs["ref_images.ref_image_1"], ["4:media:y", 0]);

  // Sorting the new loader changes which asset each numbered output carries,
  // not the physical H3 input slot connected to that output.
  secondGroups = moveMedia(secondGroups, "image", "y", "x");
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs[0], stablePorts[0]);
  assert.equal(busOut.outputs[1], stablePorts[1]);
  assert.ok(busOut.outputs.every(output => !Object.prototype.hasOwnProperty.call(output, "terry_lane_id")));
  assert.deepEqual(secondLoader.__terryBusLaneEntries().map(entry => entry.name), ["图片 1", "图片 2"]);
  assert.deepEqual(busOut.outputs.map(output => output.name), ["主视觉", "角色参考"]);
  assert.equal(graph.links[2].origin_slot, 0);
  assert.equal(graph.links[3].origin_slot, 1);
  ({ output } = await app.graphToPrompt());
  assert.deepEqual(output["3"].inputs["ref_images.ref_image_0"], ["4:media:y", 0]);
  assert.deepEqual(output["3"].inputs["ref_images.ref_image_1"], ["4:media:x", 0]);
  assert.equal(output["4:media:y"].inputs.asset_id, "y");
  assert.equal(output["4:media:x"].inputs.asset_id, "x");

  // If the replacement source has fewer assets, keep the extra connected port
  // as an empty slot. It can be populated again without rebuilding the cable.
  secondGroups = { image: [asset("y")], audio: [], video: [] };
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs.length, 2);
  assert.ok(busOut.outputs.every(output => !Object.prototype.hasOwnProperty.call(output, "terry_lane_id")));
  assert.deepEqual(busOut.outputs.map(output => output.name), ["主视觉", "[空] 角色参考"]);
  assert.deepEqual(busOut.outputs[1].links, [3]);
  assert.equal(graph.links[3].origin_slot, 1);

  secondGroups = { image: [asset("y"), asset("z")], audio: [], video: [] };
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs[1], stablePorts[1]);
  assert.equal(busOut.outputs[1].name, "角色参考");
  assert.deepEqual(busOut.outputs[1].links, [3]);
  assert.equal(graph.links[3].origin_slot, 1);
});



test("Media Loader Bus-Out custom names belong to output positions, not asset IDs", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const graph = {
    _nodes: [],
    links: { 1: { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: BUS } },
    getNodeById(id) { return this._nodes.find(node => String(node.id) === String(id)); },
    change() {},
    setDirtyCanvas() {},
  };
  const app = { graph, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} };
  const context = vm.createContext({
    app, showTextPrompt: async () => "主视觉", showConfirm: async () => false,
    navigator: { language: "zh-CN" }, setTimeout() {},
  });
  vm.runInContext(source + "\nglobalThis.namedPorts = { outputRenameEntries, setMediaOutputName, applyNames };", context);

  let groups = { image: [asset("cover"), asset("character")], audio: [], video: [] };
  const mediaLoader = {
    id: 1, type: "TerryXuMediaLoader", graph,
    outputs: [{ name: "bus", type: BUS, links: [1] }],
    __terryBusLaneEntries: () => mediaLanes(mediaLoader, groups),
    setDirtyCanvas() {},
  };
  const busOut = {
    id: 2, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: BUS, link: 1 }],
    outputs: [
      { name: "图片 1", label: "图片 1", type: "IMAGE", terry_lane_id: "cover", links: [] },
      { name: "图片 2", label: "图片 2", type: "IMAGE", terry_lane_id: "character", links: [] },
    ],
    properties: { terry_wire_bus_media_outputs: true },
    setDirtyCanvas() {},
  };
  graph._nodes.push(mediaLoader, busOut);

  const entry = context.namedPorts.outputRenameEntries(busOut).find(item => item.outputIndex === 0);
  assert.equal(entry.entry.mediaOutput, true);
  assert.equal(context.namedPorts.setMediaOutputName(busOut, 0, "主视觉"), true);
  assert.equal(busOut.properties.terry_wire_bus_named_outputs["0"], "主视觉");
  assert.equal(busOut.outputs[0].name, "主视觉");
  assert.equal(context.namedPorts.setMediaOutputName(busOut, 0, ""), true);
  assert.equal(busOut.outputs[0].name, "图片 1");
  assert.equal(context.namedPorts.setMediaOutputName(busOut, 0, "主视觉"), true);

  groups = moveMedia(groups, "image", "character", "cover");
  context.namedPorts.applyNames(mediaLoader);
  assert.deepEqual(mediaLoader.__terryBusLaneEntries().map(lane => lane.name), ["图片 1", "图片 2"]);
  assert.deepEqual(busOut.outputs.map(output => output.name), ["主视觉", "图片 2"]);
  assert.equal(context.namedPorts.outputRenameEntries(busOut)[0].entry.label, "主视觉");
});
