import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "../web/switch_bus_route.mjs";
import { mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

async function fixture() {
  const graph = { _nodes: [], links: {}, getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); } };
  const prompt = { "1": { class_type: "TerryXuMediaLoader", inputs: {} },
    "3": { class_type: "MiniMaxH3ReferenceToVideo", inputs: { clip: ["9", 0], prompt: "test" } } };
  const app = { graph, registerExtension() {}, graphToPrompt: async () => ({ output: structuredClone(prompt) }) };
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({ isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE, app, mediaExecutionSource, console, navigator: { language: "zh-CN" } });
  vm.runInContext(source + "\nglobalThis.emptyTest = {syncUnpack,patchGraphToPrompt};", context);
  const groups = { image: [{ id: "a" }, { id: "b" }, ...Array.from({ length: 7 }, (_, i) => ({ id: `i${i}`, empty: true }))],
    audio: Array.from({ length: 3 }, (_, i) => ({ id: `s${i}`, empty: true })),
    video: Array.from({ length: 3 }, (_, i) => ({ id: `v${i}`, empty: true })) };
  const loader = { id: 1, type: "TerryXuMediaLoader", graph, outputs: [{ type: "TERRY_WIRE_BUS" }],
    __terryBusLaneEntries: () => mediaLanes(loader, groups) };
  const unpack = { id: 2, type: "TerryXuWirelessBusUnpack", graph, properties: {}, widgets: [],
    inputs: [{ name: "bus", link: 1 }], outputs: [], setSize(size) { this.size = size; },
    addOutput(name, type) { const output = { name, type, links: [] }; this.outputs.push(output); return output; },
    removeOutput(index) { this.outputs.splice(index, 1); } };
  const h3 = { id: 3, inputs: [], constructor: { nodeData: { input: { required: { clip: ["CLIP"], prompt: ["STRING"] },
    optional: Object.fromEntries(["ref_images", "ref_audios", "ref_videos", "ref_video_audios"].map(name => [name, ["COMFY_AUTOGROW_V3"]])) } } } };
  graph._nodes.push(loader, unpack, h3);
  graph.links[1] = { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 };
  context.emptyTest.syncUnpack(unpack);
  let linkId = 1;
  function connect(origin, slot, target, name) {
    const link = ++linkId;
    const targetSlot = target.inputs.length;
    target.inputs.push({ name, link });
    origin.outputs[slot].links.push(link);
    graph.links[link] = { id: link, origin_id: origin.id, origin_slot: slot, target_id: target.id, target_slot: targetSlot };
    prompt[String(target.id)].inputs[name] = [String(origin.id), slot];
  }
  for (let i = 0; i < 9; i++) connect(unpack, i, h3, `ref_images.ref_image_${i}`);
  for (let i = 0; i < 3; i++) connect(unpack, 9 + i, h3, `ref_audios.ref_audio_${i}`);
  for (let i = 0; i < 3; i++) {
    const split = { id: 4 + i, inputs: [], outputs: [{ links: [] }, { links: [] }],
      constructor: { nodeData: { input: { required: { video: ["VIDEO"] } } } } };
    graph._nodes.push(split);
    prompt[String(split.id)] = { class_type: "GetVideoComponents", inputs: {} };
    connect(unpack, 12 + i, split, "video");
    connect(split, 0, h3, `ref_videos.ref_video_${i}`);
    connect(split, 1, h3, `ref_video_audios.ref_video_audio_${i}`);
  }
  context.emptyTest.patchGraphToPrompt();
  return { app, graph, groups, prompt };
}

test("empty videos through GetVideoComponents do not block H3's optional reference inputs", async () => {
  const { app, graph, groups } = await fixture();
  const links = JSON.stringify(graph.links);
  const output = (await app.graphToPrompt()).output;
  const inputs = output["3"].inputs;
  assert.deepEqual(inputs["ref_images.ref_image_0"], ["1:media:a", 0]);
  assert.deepEqual(inputs["ref_images.ref_image_1"], ["1:media:b", 0]);
  assert.deepEqual(inputs.clip, ["9", 0]);
  assert.equal(inputs.prompt, "test");
  assert.equal(Object.keys(inputs).filter(name => name.startsWith("ref_")).length, 2);
  assert.deepEqual(output["4"].inputs.video, ["1:media:v0", 0], "required branches still receive the normal blocker");
  assert.equal(JSON.stringify(graph.links), links, "workflow connections must remain intact");
  groups.video[0] = { id: "v0", kind: "video", path: "real.mp4" };
  const filled = (await app.graphToPrompt()).output;
  assert.deepEqual(filled["3"].inputs["ref_videos.ref_video_0"], ["4", 0]);
  assert.deepEqual(filled["3"].inputs["ref_video_audios.ref_video_audio_0"], ["4", 1]);
  assert.equal("ref_videos.ref_video_1" in filled["3"].inputs, false);
  assert.deepEqual(filled["4"].inputs.video, ["1:media:v0", 0]);
});

test("blockers propagate through multiple required steps, while lazy branches and unrelated references stay intact", async () => {
  const { app, graph, prompt } = await fixture();
  // Put the second converter before the first in node order to exercise the
  // fixed-point traversal rather than depending on graph serialization order.
  graph._nodes.unshift({ id: 10, inputs: [{ name: "images" }],
    constructor: { nodeData: { input: { required: { images: ["IMAGE"] } } } } });
  prompt["10"] = { class_type: "ImageScale", inputs: { images: ["4", 0] } };
  prompt["3"].inputs["ref_videos.ref_video_0"] = ["10", 0];
  graph._nodes.push({ id: 11, inputs: [{ name: "images" }],
    constructor: { nodeData: { input: { required: { images: ["IMAGE", { lazy: true }] } } } } });
  prompt["11"] = { class_type: "LazySwitch", inputs: { images: ["4", 0] } };
  prompt["3"].inputs["ref_images.external"] = ["unrelated", 0];
  prompt["3"].inputs["ref_images.lazy"] = ["11", 0];
  const output = (await app.graphToPrompt()).output;
  assert.equal("ref_videos.ref_video_0" in output["3"].inputs, false);
  assert.deepEqual(output["10"].inputs.images, ["4", 0], "required conversion branches are not rewritten");
  assert.deepEqual(output["3"].inputs["ref_images.external"], ["unrelated", 0]);
  assert.deepEqual(output["3"].inputs["ref_images.lazy"], ["11", 0]);
});
