import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { readMedia, moveMedia, mediaFile, mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

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

test("real Bus-Out sync and prompt expansion keep connections on the same asset after sort", async () => {
  const graph = { _nodes: [], links: {}, getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); } };
  const app = { graph, registerExtension() {}, graphToPrompt: async () => ({ output: {
    "1": { class_type: "TerryXuMediaLoader", inputs: { assets_json: "{}" } },
    "3": { class_type: "PreviewImage", inputs: { images: ["1", 0] } },
  } }) };
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({ app, mediaExecutionSource, console, navigator: { language: "zh-CN" } });
  vm.runInContext(source + "\nglobalThis.busTest = {syncUnpack,patchGraphToPrompt};", context);
  const pack = { id: 1, type: "TerryXuMediaLoader", graph, size: [640, 740], outputs: [{ type: "TERRY_WIRE_BUS" }] };
  let groups = { image: [asset("a"), asset("b")], audio: [], video: [] };
  pack.__terryBusLaneEntries = () => mediaLanes(pack, groups);
  const unpack = { id: 2, type: "TerryXuWirelessBusUnpack", graph, inputs: [{ name: "bus", link: 1 }],
    outputs: [], properties: {}, widgets: [], setSize(size) { this.size = size; },
    addOutput(name, type) {
      const slot = { name, type };
      // Current LiteGraph slots derive connectivity from the graph and index.
      Object.defineProperty(slot, "links", { get: () => Object.values(graph.links)
        .filter(link => link.origin_id === this.id && link.origin_slot === this.outputs.indexOf(slot)).map(link => link.id) });
      this.outputs.push(slot); return slot;
    },
    removeOutput(index) { this.outputs.splice(index, 1); } };
  const sink = { id: 3, inputs: [{ name: "images", link: 2 }] };
  graph._nodes.push(pack, unpack, sink);
  graph.links[1] = { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 };
  context.busTest.syncUnpack(unpack);
  graph.links[2] = { id: 2, origin_id: 2, origin_slot: 0, target_id: 3, target_slot: 0 };
  groups = moveMedia(groups, "image", "b", "a");
  context.busTest.syncUnpack(unpack);
  assert.deepEqual(unpack.outputs.map(o => [o.terry_lane_id, o.name]), [["b", "图片 1"], ["a", "图片 2"]]);
  assert.equal(graph.links[2].origin_slot, 1);
  assert.ok(unpack.size[1] < 300, "Bus-Out must not inherit the loader's large card-panel height");
  context.busTest.patchGraphToPrompt();
  const { output } = await app.graphToPrompt();
  assert.deepEqual(output["3"].inputs.images, ["1:media:a", 0]);
  assert.equal(output["1:media:a"].inputs.asset_id, "a");
  assert.equal(output["1:media:b"], undefined, "unused media must not be decoded");
});
