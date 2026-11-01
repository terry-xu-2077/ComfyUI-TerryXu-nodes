import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

const BUS = "TERRY_WIRE_BUS";

test("connected bus cable endpoints align with centered capsules, while individual lanes retain their spacing", async () => {
  const source = (await readFile(new URL("../web/wire_bus_visual.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "");
  const context = vm.createContext({ app: { registerExtension() {} }, requestAnimationFrame() {},
    LiteGraph: { NODE_TITLE_HEIGHT: 30, NODE_SLOT_HEIGHT: 20 } });
  vm.runInContext(source + "\nglobalThis.patchBusNode = patchBusNode;", context);
  for (const type of ["TerryXuWireBusPack", "TerryXuWirelessBusPack"]) {
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
    assert.equal(laneCenter, node.getOutputPos(0)[1] - (type === "TerryXuWirelessBusPack" ? 19 : 0));
    node.flags = { collapsed: true };
    assert.deepEqual(node.getInputPos(0), [99, 199]);
  }
});

for (const type of ["TerryXuWireBusPack", "TerryXuWirelessBusPack"]) {
  test(`${type} accepts one bus, locks extra inputs, and recovers after disconnect`, async () => {
    const graph = { _nodes: [], links: {}, getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); } };
    let extension;
    const app = { graph, registerExtension(value) { extension = value; }, graphToPrompt: async () => ({ output: {
      "1": { class_type: "TerryXuMediaLoader", inputs: { assets_json: "{}" } },
      "5": { class_type: "SaveImage", inputs: { images: ["4", 0] } },
    } }) };
    const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
      .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
    const context = vm.createContext({ app, mediaExecutionSource, console, navigator: { language: "zh-CN" },
      queueMicrotask() {}, LiteGraph: { INPUT: 1, OUTPUT: 2 } });
    vm.runInContext(source + "\nglobalThis.busTest = {refreshPackSlots,syncUnpack,patchGraphToPrompt,canConnectBusOutput};", context);
    class Pack {}
    extension.beforeRegisterNodeDef(Pack, { name: type });
    const bus = { id: 1, type: "TerryXuMediaLoader", graph, outputs: [{ type: BUS, links: [1] }], size: [640, 740] };
    bus.__terryBusLaneEntries = () => mediaLanes(bus, {
      image: [{ id: "picture", kind: "image", path: "test.png", source: "input", name: "test.png" }], audio: [], video: [],
    });
    const pack = Object.assign(new Pack(), { id: 2, type, graph, properties: {}, inputs: [], outputs: [{ type: BUS, links: [2] }],
      widgets: [], size: [112, 160], setSize(size) { this.size = size; },
      addInput(name, type) { const input = { name, type, link: null }; this.inputs.push(input); return input; },
      removeInput(index) { this.inputs.splice(index, 1); } });
    const unpack = id => ({ id, type: "TerryXuWireBusUnpack", graph, inputs: [{ name: "bus", type: BUS, link: id - 1 }],
      outputs: [], properties: {}, widgets: [], setSize(size) { this.size = size; },
      addOutput(name, type) { const output = { name, type, links: [] }; this.outputs.push(output); return output; },
      removeOutput(index) { this.outputs.splice(index, 1); } });
    const relay = unpack(3), expanded = unpack(4);
    relay.properties.terry_wire_bus_expand_outputs = false;
    const sink = { id: 5, inputs: [{ name: "images", link: 4 }] };
    graph._nodes.push(bus, pack, relay, expanded, sink);
    context.busTest.refreshPackSlots(pack);
    assert.equal(pack.inputs.length, 1);
    assert.equal(pack.inputs[0].label, "添加线束");
    assert.equal(pack.onConnectInput(0, BUS), true);
    assert.equal(context.busTest.canConnectBusOutput(pack, pack.inputs[0]), true);
    assert.equal(bus.size[1], 740);
    graph.links[1] = { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: BUS };
    pack.inputs[0].link = 1;
    // Reject competing connections even before the queued refresh sets type.
    assert.equal(pack.onConnectInput(0, "IMAGE"), false);
    assert.equal(pack.onConnectInput(1, BUS), false);
    context.busTest.refreshPackSlots(pack);
    assert.equal(pack.inputs.length, 1);
    assert.equal(pack.inputs[0].label, "总线");
    assert.equal(pack.inputs[0].type, BUS);
    assert.equal(pack.onConnectInput(0, BUS), false);
    assert.ok(pack.size[1] < 300, "media-card height must not stretch the bridge");
    graph.links[2] = { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0, type: BUS };
    context.busTest.syncUnpack(relay, true);
    assert.equal(relay.outputs.length, 1);
    assert.equal(relay.outputs[0].type, BUS);
    relay.outputs[0].links = [3];
    graph.links[3] = { id: 3, origin_id: 3, origin_slot: 0, target_id: 4, target_slot: 0, type: BUS };
    context.busTest.syncUnpack(expanded, true);
    assert.equal(expanded.outputs[0].type, "IMAGE");
    expanded.outputs[0].links = [4];
    graph.links[4] = { id: 4, origin_id: 4, origin_slot: 0, target_id: 5, target_slot: 0, type: "IMAGE" };
    context.busTest.patchGraphToPrompt();
    const prompt = (await app.graphToPrompt()).output;
    assert.deepEqual(prompt["5"].inputs.images, ["1:media:picture", 0]);
    assert.equal(prompt["1:media:picture"].inputs.asset_id, "picture");

    // Save/reload the bridge metadata and retain its exclusive bus input.
    pack.properties = JSON.parse(JSON.stringify(pack.properties));
    context.busTest.refreshPackSlots(pack);
    assert.equal(pack.inputs.length, 1);
    pack.inputs[0].link = null;
    delete graph.links[1];
    relay.outputs[0].links = [];
    context.busTest.refreshPackSlots(pack);
    assert.equal(pack.inputs.length, 1);
    assert.equal(pack.inputs[0].label, "添加线束");
    assert.equal(pack.inputs[0].type, "*");
    assert.equal(pack.onConnectInput(0, "IMAGE"), true);
    assert.equal(pack.onConnectInput(0, BUS), true);
    // Existing individual wires cannot be overwritten by a bus connection.
    pack.inputs[0].link = 99;
    assert.equal(pack.onConnectInput(0, BUS), false);
    context.busTest.refreshPackSlots(pack);
    assert.equal(pack.inputs.at(-1).label, "添加线束");
    assert.equal(pack.onConnectInput(pack.inputs.length - 1, "AUDIO"), true);
  });
}
