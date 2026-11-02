import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "../web/switch_bus_route.mjs";

async function fixture() {
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const graph = {
    _nodes: [], links: {},
    getNodeById(id) { return this._nodes.find(node => String(node.id) === String(id)); },
  };
  const app = { graph, registerExtension() {} };
  const context = vm.createContext({ isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE,
    app, navigator: { language: "zh-CN" }, mediaExecutionSource: () => null,
  });
  vm.runInContext(source + "\nglobalThis.references = mediaAssetHasReferences;", context);
  const pack = {
    id: 1, type: "TerryXuMediaLoader", graph,
    outputs: [{ type: "TERRY_WIRE_BUS", links: [] }],
    __terryBusLaneEntries: () => [{ laneId: "asset", lane: { id: "asset", type: "IMAGE" } }],
  };
  const h3 = { id: 3, type: "TerryXuH3PromptEditor", graph };
  const consumer = { id: 4, type: "PreviewImage", graph };
  graph._nodes.push(pack, h3, consumer);
  return {
    graph, pack, h3, consumer, references: () => context.references(pack, "asset"),
    link(id, from, slot, to, targetSlot = 0) {
      graph.links[id] = { id, origin_id: from.id, origin_slot: slot,
        target_id: to.id, target_slot: targetSlot };
      from.outputs[slot].links.push(id);
    },
  };
}

test("H3 and bus-only consumers do not lock media slots", async () => {
  const { pack, h3, consumer, references, graph, link } = await fixture();
  link(11, pack, 0, h3);
  assert.equal(references(), false, "direct H3 bus reference is not slot-specific");
  graph.links[11].target_id = consumer.id;
  assert.equal(references(), true, "unknown direct consumer still protects its connection");
  graph.links[11].target_id = h3.id;

  const busToList = { id: 5, type: "TerryXuBusToList", graph };
  graph._nodes.push(busToList);
  link(12, pack, 0, busToList);
  assert.equal(references(), false, "bus-list adapter is not a per-slot reference");
});

test("expanded Bus-Out ignores H3 but protects other wired media inputs", async () => {
  const { graph, pack, h3, consumer, references, link } = await fixture();
  const unpack = {
    id: 2, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", link: 11 }],
    outputs: [{ name: "图片 1", type: "IMAGE", terry_lane_id: "asset", links: [] }],
    properties: { terry_wire_bus_expand_outputs: true },
  };
  graph._nodes.push(unpack);
  link(11, pack, 0, unpack);
  link(12, unpack, 0, h3);
  assert.equal(references(), false, "H3 receiving an expanded lane must not block removal");
  graph.links[12].target_id = consumer.id;
  assert.equal(references(), true, "real output consumer must still be protected");
});

test("unexpanded Bus-Out does not lock every slot through H3", async () => {
  const { graph, pack, h3, consumer, references, link } = await fixture();
  const unpack = {
    id: 2, type: "TerryXuWirelessBusUnpack", graph,
    inputs: [{ name: "bus", link: 11 }],
    outputs: [{ name: "bus", type: "TERRY_WIRE_BUS", links: [] }],
    properties: { terry_wire_bus_expand_outputs: false },
  };
  graph._nodes.push(unpack);
  link(11, pack, 0, unpack);
  link(12, unpack, 0, h3);
  assert.equal(references(), false);
  graph.links[12].target_id = consumer.id;
  assert.equal(references(), true);
});
