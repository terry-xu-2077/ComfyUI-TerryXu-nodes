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


test("wireless bus nodes keep a user-adjusted width while preserving automatic height", async () => {
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
    onResize() {},
  };
  context.patchBusNode(node);
  node.size = [280, 260];
  node.onResize();

  assert.equal(node.size[0], 280);
  assert.equal(node.size[1], 180);
  assert.equal(node.properties.terry_wire_bus_width, 280);
  assert.equal(node.__terryBusCompactWidth, 280);
});

test("Bus-In and Bus-Out edit icons are shown only while hovering a port label", async () => {
  const [bus, visual, namedPorts] = await Promise.all([
    readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"),
    readFile(new URL("../web/wire_bus_visual.js", import.meta.url), "utf8"),
    readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"),
  ]);
  assert.match(bus, /this\.resizable = true;/);
  assert.match(bus, /terry_wire_bus_width/);
  assert.match(visual, /width:\$\{compactWidth\}px !important/);
  assert.match(namedPorts, /\.text-node-component-slot-text:hover::after/);
  assert.match(namedPorts, /terry-wire-bus-port-actions-visible::after/);
  assert.match(namedPorts, /document\.addEventListener\("pointerover"/);
  assert.match(namedPorts, /document\.addEventListener\("pointerout"/);
  assert.doesNotMatch(namedPorts, /label = `\$\{entry\.label\}   \$\{PENCIL\}/);
});


test("delete affordance appears after hovering a named port label and stays while moving to it", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const listeners = {};
  const document = {
    getElementById() { return null; },
    createElement() { return { id: "", textContent: "" }; },
    head: { append() {} },
    addEventListener(name, handler) { (listeners[name] ||= []).push(handler); },
    querySelectorAll() { return []; },
  };
  const extensions = [];
  const context = vm.createContext({
    app: { graph: { _nodes: [] }, registerExtension(extension) { extensions.push(extension); } },
    document,
    navigator: { language: "zh-CN" },
    showTextPrompt: () => Promise.resolve(null),
    showConfirm: () => Promise.resolve(false),
  });
  vm.runInContext(source, context);
  extensions[0].setup();

  const classes = new Set();
  const row = {
    classList: {
      add(...names) { names.forEach((name) => classes.add(name)); },
      remove(...names) { names.forEach((name) => classes.delete(name)); },
      contains(name) { return classes.has(name); },
    },
    contains(target) { return target === this || target === span; },
  };
  const span = {
    closest(selector) {
      return selector === ".lg-slot--input.terry-wire-bus-named-lane" ? row : null;
    },
  };
  const target = {
    closest(selector) {
      if (selector === ".text-node-component-slot-text") return span;
      if (selector === ".lg-slot--input.terry-wire-bus-named-lane") return row;
      return null;
    },
  };

  for (const handler of listeners.pointerover || []) handler({ target });
  assert.equal(classes.has("terry-wire-bus-port-actions-visible"), true);

  for (const handler of listeners.pointerout || []) handler({ target, relatedTarget: row });
  assert.equal(classes.has("terry-wire-bus-port-actions-visible"), true);

  for (const handler of listeners.pointerout || []) handler({ target, relatedTarget: {} });
  assert.equal(classes.has("terry-wire-bus-port-actions-visible"), false);
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


test("Bus-Out ports connected directly to Media Loader support persistent renaming", async () => {
  const source = (await readFile(new URL("../web/wire_bus_named_ports.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const graph = {
    _nodes: [],
    links: {
      1: { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 },
      2: { id: 2, origin_id: 1, origin_slot: 0, target_id: 3, target_slot: 0 },
    },
    getNodeById(id) { return this._nodes.find(node => String(node.id) === String(id)); },
    change() {},
    setDirtyCanvas() {},
  };
  const app = { graph, ui: { settings: { getSettingValue: () => "zh-CN" } }, registerExtension() {} };
  const context = vm.createContext({
    app, navigator: { language: "zh-CN" },
    showTextPrompt: () => Promise.resolve(null),
    showConfirm: () => Promise.resolve(false),
  });
  vm.runInContext(source + "\nglobalThis.mediaBusNamedTest = { outputRenameEntries, setLaneName, applyNames };", context);

  let groups = {
    image: [asset("cover"), asset("character")],
    audio: [asset("voice", "audio")],
    video: [],
  };
  const mediaLoader = {
    id: 1, type: "TerryXuMediaLoader", graph,
    properties: {},
    outputs: [{ name: "bus", type: BUS, links: [1, 2] }],
  };
  mediaLoader.__terryBusLaneEntries = () =>
    mediaLanes(mediaLoader, groups, mediaLoader.properties?.terry_wire_bus_named_lanes);
  const unpack = {
    id: 2, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: BUS, link: 1 }],
    outputs: mediaLanes(mediaLoader, groups).map(lane => ({
      name: lane.name, label: lane.name, type: lane.type, terry_lane_id: lane.laneId, links: [],
    })),
    setDirtyCanvas() {},
  };
  const secondUnpack = {
    id: 3, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", type: BUS, link: 2 }],
    outputs: mediaLanes(mediaLoader, groups).map(lane => ({
      name: lane.name, label: lane.name, type: lane.type, terry_lane_id: lane.laneId, links: [],
    })),
    setDirtyCanvas() {},
  };
  graph._nodes.push(mediaLoader, unpack, secondUnpack);

  const entry = context.mediaBusNamedTest.outputRenameEntries(unpack)
    .find(item => item.laneId === "cover");
  assert.equal(entry.pack, mediaLoader);
  context.mediaBusNamedTest.setLaneName(entry.pack, entry.entry, "主视觉参考");

  assert.equal(mediaLoader.properties.terry_wire_bus_named_lanes.cover, "主视觉参考");
  assert.equal(unpack.outputs[0].name, "主视觉参考");
  assert.equal(unpack.outputs[0].label, "主视觉参考");
  assert.equal(secondUnpack.outputs[0].name, "主视觉参考");
  assert.equal(secondUnpack.outputs[0].label, "主视觉参考");
  assert.equal(mediaLoader.__terryBusLaneEntries().find(lane => lane.laneId === "cover").name, "主视觉参考");

  groups = moveMedia(groups, "image", "character", "cover");
  context.mediaBusNamedTest.applyNames(mediaLoader);
  const reordered = mediaLoader.__terryBusLaneEntries();
  assert.equal(reordered.find(lane => lane.laneId === "cover").name, "主视觉参考");
  assert.equal(reordered.find(lane => lane.laneId === "character").name, "图片 1");
  assert.equal(unpack.outputs.find(output => output.terry_lane_id === "cover").name, "主视觉参考");
  assert.equal(secondUnpack.outputs.find(output => output.terry_lane_id === "cover").name, "主视觉参考");
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
    properties: {}, widgets: [], size: [160, 200],
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
  assert.equal(busOut.outputs[0].terry_lane_id, "a");
  assert.equal(busOut.outputs[1].terry_lane_id, "b");

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
  assert.deepEqual(busOut.outputs.map(output => output.terry_lane_id), ["x", "y"]);
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
  assert.deepEqual(busOut.outputs.map(output => output.terry_lane_id), ["y", "x"]);
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
  assert.equal(busOut.outputs[0].terry_lane_id, "y");
  assert.equal(busOut.outputs[1].terry_lane_id, "__terry_bus_empty_2_1");
  assert.deepEqual(busOut.outputs[1].links, [3]);
  assert.equal(graph.links[3].origin_slot, 1);

  secondGroups = { image: [asset("y"), asset("z")], audio: [], video: [] };
  context.busTest.syncUnpack(busOut, true);
  assert.equal(busOut.outputs[1], stablePorts[1]);
  assert.equal(busOut.outputs[1].terry_lane_id, "z");
  assert.deepEqual(busOut.outputs[1].links, [3]);
  assert.equal(graph.links[3].origin_slot, 1);
});
