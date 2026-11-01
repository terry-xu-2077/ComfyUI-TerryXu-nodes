import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readMedia, moveMedia, removeMedia, mediaFile, mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

const asset = (id, kind = "image") => ({ id, kind, path: `${id}.png`, source: "input", name: `${id}.png` });

test("reordering is isolated to one type and survives serialization", () => {
  const before = { image: [asset("a"), asset("b"), asset("c")], audio: [asset("d", "audio")], video: [] };
  const moved = moveMedia(before, "image", "c", "a");
  assert.deepEqual(moved.image.map(a => a.id), ["c", "a", "b"]);
  assert.equal(moved.audio, before.audio);
  assert.deepEqual(before.image.map(a => a.id), ["a", "b", "c"]);
  assert.deepEqual(readMedia(JSON.stringify(moved)), moved);
  assert.deepEqual(moveMedia(moved, "audio", "c", "d"), moved);
  assert.deepEqual(moveMedia(moved, "image", "c", null).image.map(a => a.id), ["a", "b", "c"]);
});

test("native output assets and Director input assets normalize to portable paths", () => {
  assert.deepEqual(mediaFile({ path: "clips/a.mp4 [output]" }, "video", "v"),
    { id: "v", kind: "video", path: "clips/a.mp4", source: "output", name: "a.mp4" });
  assert.equal(mediaFile({ filename: "a.wav", subfolder: "audio" }, "audio", "a").path, "audio/a.wav");
  assert.equal(mediaFile({ path: "TerryDirector\\imported\\a.png", source: "input" }, "image", "i").path,
    "TerryDirector/imported/a.png");
});

test("bus lanes preserve asset identities while ports follow per-type order", () => {
  const node = { id: 8 }, before = { image: [asset("a"), asset("b")], audio: [asset("d", "audio")], video: [] };
  const lanes = mediaLanes(node, moveMedia(before, "image", "b", "a"));
  assert.deepEqual(lanes.map(l => [l.laneId, l.name, l.type]), [["b", "图片 1", "IMAGE"], ["a", "图片 2", "IMAGE"], ["d", "音频 1", "AUDIO"]]);
  const prompt = { "8": { class_type: "TerryXuMediaLoader" } };
  assert.deepEqual(mediaExecutionSource(prompt, lanes[0].source, "8"), ["8:media:b", 0]);
  assert.deepEqual(prompt["8:media:b"].inputs, { bus: ["8", 0], asset_id: "b" });
  assert.equal(mediaExecutionSource(prompt, { nodeId: 9 }, "9"), null);
});

for (const unpackType of ["TerryXuWireBusUnpack", "TerryXuWirelessBusUnpack"]) {
for (const bridgeType of [null, "TerryXuWireBusPack", "TerryXuWirelessBusPack"]) {
test(`${unpackType}${bridgeType ? ` through ${bridgeType}` : ""} sorting keeps port connections fixed and executes media in the new order`, async () => {
  const graph = { _nodes: [], links: {}, getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); } };
  const app = { graph, registerExtension() {}, graphToPrompt: async () => ({ output: {
    "1": { class_type: "TerryXuMediaLoader", inputs: { assets_json: "{}" } },
    "3": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { "ref_images.ref_image_0": ["1", 0], prompt: "test" } },
  } }) };
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({ app, mediaExecutionSource, console, navigator: { language: "zh-CN" } });
  vm.runInContext(source + "\nglobalThis.busTest = {syncUnpack,patchGraphToPrompt,mediaAssetHasReferences};", context);
  const pack = { id: 1, type: "TerryXuMediaLoader", graph, size: [640, 740], outputs: [{ type: "TERRY_WIRE_BUS" }] };
  let groups = { image: [asset("a"), asset("b")], audio: [], video: [] };
  pack.__terryBusLaneEntries = () => mediaLanes(pack, groups);
  const unpack = { id: 2, type: unpackType, graph, inputs: [{ name: "bus", link: 1 }],
    outputs: [], properties: {}, widgets: [], setSize(size) { this.size = size; },
    addOutput(name, type) {
      const slot = { name, type };
      // Current LiteGraph slots derive connectivity from the graph and index.
      Object.defineProperty(slot, "links", { get: () => Object.values(graph.links)
        .filter(link => link.origin_id === this.id && link.origin_slot === this.outputs.indexOf(slot)).map(link => link.id) });
      this.outputs.push(slot); return slot;
    },
    removeOutput(index) { this.outputs.splice(index, 1); } };
  const sink = { id: 3, inputs: [{ name: "ref_images.ref_image_0", link: 2 }] };
  graph._nodes.push(pack, unpack, sink);
  graph.links[1] = { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 };
  if (bridgeType) {
    const bridge = { id: 6, type: bridgeType, graph, properties: {}, size: [112, 160],
      inputs: [{ name: "bus", type: "TERRY_WIRE_BUS", link: 3 }], outputs: [{ type: "TERRY_WIRE_BUS", links: [1] }],
      setSize(size) { this.size = size; } };
    graph._nodes.push(bridge);
    pack.outputs[0].links = [3];
    graph.links[3] = { id: 3, origin_id: 1, origin_slot: 0, target_id: 6, target_slot: 0, type: "TERRY_WIRE_BUS" };
    graph.links[1].origin_id = 6;
    if (unpackType === "TerryXuWirelessBusUnpack" && bridgeType === "TerryXuWirelessBusPack") {
      // Receive by channel without a physical cable, as in the reported case.
      bridge.properties.terry_wireless_bus_channel = "总线 1";
      unpack.properties.terry_wireless_bus_channel = "总线 1";
      unpack.inputs[0].link = null;
      delete graph.links[1];
    }
  }
  context.busTest.syncUnpack(unpack);
  graph.links[2] = { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0, type: "IMAGE" };
  const ports = [...unpack.outputs];
  const connections = JSON.stringify(graph.links);
  groups = moveMedia(groups, "image", "b", "a");
  context.busTest.syncUnpack(unpack);
  assert.deepEqual(unpack.outputs.map(o => [o.terry_lane_id, o.name]), [["b", "图片 1"], ["a", "图片 2"]]);
  assert.equal(graph.links[2].origin_slot, 0);
  assert.equal(JSON.stringify(graph.links), connections);
  assert.equal(unpack.outputs[0], ports[0]);
  assert.equal(unpack.outputs[1], ports[1]);
  // Undo/redo and serialized lane metadata must keep the same physical ports.
  groups = moveMedia(groups, "image", "a", "b");
  context.busTest.syncUnpack(unpack);
  assert.equal(unpack.outputs[0].terry_lane_id, "a");
  assert.equal(JSON.stringify(graph.links), connections);
  groups = moveMedia(groups, "image", "b", "a");
  context.busTest.syncUnpack(unpack);
  unpack.properties = JSON.parse(JSON.stringify(unpack.properties));
  unpack.outputs.forEach(output => { delete output.terry_lane_id; });
  context.busTest.syncUnpack(unpack, true);
  assert.equal(unpack.outputs[0].terry_lane_id, "b");
  assert.equal(JSON.stringify(graph.links), connections);
  assert.ok(unpack.size[1] < 300, "Bus-Out must not inherit the loader's large card-panel height");
  const compactHeight = unpack.size[1];
  // Nodes saved while stretched must also shrink; legacy height must not be
  // mistaken for a user override on every subsequent media-bus refresh.
  unpack.size[1] = 800;
  context.busTest.syncUnpack(unpack, true);
  assert.equal(unpack.size[1], compactHeight);
  assert.equal(JSON.stringify(graph.links), connections);
  context.busTest.patchGraphToPrompt();
  const { output } = await app.graphToPrompt();
  assert.deepEqual(output["3"].inputs["ref_images.ref_image_0"], ["1:media:b", 0]);
  assert.equal(output["1:media:b"].inputs.asset_id, "b");
  assert.equal(output["1:media:a"], undefined, "unused media must not be decoded");
  assert.equal(context.busTest.mediaAssetHasReferences(pack, "b"), true);
  if (!bridgeType) assert.equal(context.busTest.mediaAssetHasReferences(pack, "a"), false);
  groups = removeMedia(groups, "image", "b", true);
  context.busTest.syncUnpack(unpack, true);
  assert.equal(groups.image[0].empty, true);
  assert.equal(unpack.outputs[0], ports[0]);
  assert.equal(unpack.outputs[0].name, "图片 1");
  assert.equal(JSON.stringify(graph.links), connections);
  const bypassed = (await app.graphToPrompt()).output;
  assert.equal("ref_images.ref_image_0" in bypassed["3"].inputs, false);
  assert.equal(bypassed["3"].inputs.prompt, "test");
  assert.equal(bypassed["1:media:b"], undefined, "an empty reference must not create a media decoder");
  // Required media consumers need a blocker connection rather than a missing
  // required input; optional H3 references above remain absent and can generate.
  sink.constructor = { nodeData: { input: { required: { "ref_images.ref_image_0": ["IMAGE"] } } } };
  const required = (await app.graphToPrompt()).output;
  assert.deepEqual(required["3"].inputs["ref_images.ref_image_0"], ["1:media:b", 0]);
  assert.equal(required["1:media:b"].inputs.asset_id, "b");
  delete sink.constructor;
  groups = readMedia(JSON.stringify(groups));
  context.busTest.syncUnpack(unpack, true);
  assert.equal(JSON.stringify(graph.links), connections);
  groups.image[0] = mediaFile({path:"replacement.png"}, "image", "b");
  context.busTest.syncUnpack(unpack, true);
  assert.equal(JSON.stringify(graph.links), connections);
  const restored = (await app.graphToPrompt()).output;
  assert.deepEqual(restored["3"].inputs["ref_images.ref_image_0"], ["1:media:b", 0]);
  assert.equal(restored["1:media:b"].inputs.asset_id, "b");
});
}
}

test("only referenced removals retain a serializable empty slot", () => {
  for (const kind of ["image", "audio", "video"]) {
    const groups = {image:[],audio:[],video:[],[kind]:[asset("first",kind),asset("second",kind)]};
    const removed = removeMedia(groups,kind,"first",false);
    assert.deepEqual(removed[kind].map(item=>item.id),["second"]);
    const cleared = readMedia(JSON.stringify(removeMedia(groups,kind,"first",true)));
    assert.equal(cleared[kind].length,2);
    assert.equal(cleared[kind][0].empty,true);
    assert.equal(cleared[kind][1].id,"second");
    const lane = mediaLanes({id:1},cleared)[0];
    assert.equal(lane.source,null);
    assert.equal(lane.empty,true);
    assert.equal(lane.laneId,"first");
  }
});
