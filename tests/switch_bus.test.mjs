import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "../web/switch_bus_route.mjs";

const BUS = "TERRY_WIRE_BUS";
async function moduleSource(file) {
  return (await readFile(new URL(`../web/${file}`, import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
}

async function fixture(kind) {
  const graph = {
    _nodes: [], links: {},
    getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); },
  };
  const prompt = () => ({
    "1": { class_type: "TerryXuMediaLoader", inputs: {} },
    "2": { class_type: "TerryXuMediaLoader", inputs: {} },
    "3": { class_type: kind, inputs: {} },
    "5": { class_type: "MiniMaxH3ReferenceToVideo", inputs: {
      "ref_images.ref_image_0": ["4", 0], prompt: "test",
    } },
  });
  const app = { graph, registerExtension() {}, graphToPrompt: async () => ({ output: prompt() }) };
  const globals = { app, navigator: { language: "zh-CN" },
    isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE,
    mediaExecutionSource, console, queueMicrotask: () => {} };
  const context = vm.createContext(globals);
  vm.runInContext((await moduleSource("wire_bus.js"))
    + "\nglobalThis.busTest = {syncUnpack,syncSwitchBusType,findPackFromUnpack,patchGraphToPrompt,canConnectBusOutput};", context);
  const empty = { image: [], audio: [], video: [] };
  const makePack = (id, label) => {
    const pack = { id, graph, type: "TerryXuMediaLoader",
      outputs: [{ type: BUS, links: [] }] };
    const media = { ...empty, image: [{ id: label, kind: "image", name: label,
      path: label + ".png", source: "input" }] };
    pack.__terryBusLaneEntries = () => mediaLanes(pack, media);
    return pack;
  };
  const first = makePack(1, "a"), second = makePack(2, "b");
  const line = kind === LINE_SWITCH_TYPE;
  const selector = line
    ? { type: kind, id: 3, graph, properties: {},
      widgets: [{ name: "index", value: 1 }],
      inputs: [{ name: "index" }, { name: "routes.route_0", link: 10 },
        { name: "routes.route_1", link: 11 }],
      outputs: [{ name: "输出", type: "*", links: [12, 13] }] }
    : { type: kind, id: 3, graph, properties: {},
      widgets: [{ name: "enabled", value: false }],
      inputs: [{ name: "enabled" }, { name: "input_false", link: 10 },
        { name: "input_true", link: 11 }],
      outputs: [{ name: "输出", type: "*", links: [12, 13] }] };
  const unpack = { id: 4, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", link: 12 }], properties: {}, widgets: [], outputs: [],
    size: [112, 160], setSize(size) { this.size = size; },
    addOutput(name, type) {
      const output = { name, type, links: [] };
      this.outputs.push(output);
      return output;
    },
    removeOutput(index) { this.outputs.splice(index, 1); },
  };
  const h3 = { id: 5, graph, type: "TerryXuH3PromptEditor",
    inputs: [{ name: "media", link: 13 }] };
  const sink = { id: 6, graph, type: "MiniMaxH3ReferenceToVideo",
    inputs: [{ name: "ref_images.ref_image_0", link: 14 }],
    constructor: { nodeData: { input: { optional: { ref_images: ["*"] } } } } };
  graph._nodes.push(first, second, selector, unpack, h3, sink);
  const connect = (id, source, target, targetSlot, originSlot = 0) => {
    graph.links[id] = { id, origin_id: source.id, origin_slot: originSlot,
      target_id: target.id, target_slot: targetSlot, type: BUS };
    source.outputs[originSlot].links ||= [];
    if (!source.outputs[originSlot].links.includes(id)) source.outputs[originSlot].links.push(id);
  };
  connect(10, first, selector, 1);
  connect(11, second, selector, 2);
  connect(12, selector, unpack, 0);
  connect(13, selector, h3, 0);
  const h3Context = vm.createContext({ app, isTerrySwitch, selectedSwitchInput, console });
  vm.runInContext((await moduleSource("h3_bus_resolver.js"))
    + "\nglobalThis.h3Test = {h3ResolveNativeBus,h3CollectBusMedia,h3CollectBusMediaForExecution,h3IsBusLinkInfo};", h3Context);
  const api = context.busTest;
  api.syncSwitchBusType(selector);
  api.syncUnpack(unpack, true);
  return { first, second, selector, unpack, h3, sink, graph, app,
    api, h3Api: h3Context.h3Test,
    selectSecond() {
      selector.widgets[0].value = line ? 2 : true;
      api.syncSwitchBusType(selector);
      api.syncUnpack(unpack, true);
    },
  };
}

for (const kind of [LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE]) {
  test(`${kind} forwards its active BUS with real output type and updates Bus-Out`, async () => {
    const { first, second, selector, unpack, api, h3, h3Api, selectSecond, graph } = await fixture(kind);
    assert.equal(api.findPackFromUnpack(unpack), first);
    assert.equal(selector.outputs[0].type, BUS);
    assert.equal(unpack.outputs[0].terry_lane_id, "a");
    assert.equal(api.canConnectBusOutput(selector, selector.inputs[1]), true);
    assert.equal(api.canConnectBusOutput(selector, selector.inputs[0]), false);
    assert.equal(h3Api.h3ResolveNativeBus(h3).pack, first);
    assert.equal(h3Api.h3CollectBusMedia(h3)[0].asset_id, "a");
    assert.equal(h3Api.h3IsBusLinkInfo(h3, graph.links[13]), true);

    selectSecond();
    assert.equal(api.findPackFromUnpack(unpack), second);
    assert.equal(selector.outputs[0].type, BUS);
    assert.equal(unpack.outputs[0].terry_lane_id, "b");
    assert.equal(h3Api.h3ResolveNativeBus(h3).pack, second);
    assert.equal(h3Api.h3CollectBusMedia(h3)[0].asset_id, "b");
    assert.equal(h3Api.h3CollectBusMediaForExecution(h3, String(h3.id))[0].asset_id, "b");
  });
}

test("switches can be chained without exposing a phantom BUS", async () => {
  const { first, second, selector, unpack, graph, api } = await fixture(BOOL_SWITCH_TYPE);
  const next = { id: 7, type: LINE_SWITCH_TYPE, graph,
    widgets: [{ name: "index", value: 1 }], properties: {},
    inputs: [{ name: "index" }, { name: "routes.route_0", link: 20 },
      { name: "routes.route_1", link: null }],
    outputs: [{ type: "*", links: [12] }] };
  graph._nodes.push(next);
  graph.links[20] = { id: 20, origin_id: selector.id, origin_slot: 0, target_id: next.id, target_slot: 1 };
  graph.links[12].origin_id = next.id;
  unpack.inputs[0].link = 12;
  api.syncSwitchBusType(next);
  assert.equal(next.outputs[0].type, BUS);
  assert.equal(api.findPackFromUnpack(unpack), first);
  selector.widgets[0].value = true;
  api.syncSwitchBusType(selector);
  api.syncSwitchBusType(next);
  assert.equal(api.findPackFromUnpack(unpack), second);
  next.widgets[0].value = 2;
  api.syncSwitchBusType(next);
  assert.equal(api.findPackFromUnpack(unpack), null);
  assert.notEqual(next.outputs[0].type, BUS);
});
