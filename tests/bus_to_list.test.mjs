import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

async function fixture() {
  const graph = { _nodes: [], links: {}, getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); } };
  let extension;
  const app = { graph, registerExtension(value) { extension = value; }, graphToPrompt: async () => ({ output: {
    "1": { class_type: "TerryXuMediaLoader", inputs: {} },
    "5": { class_type: "TerryXuBusToList", inputs: { bus: ["2", 0], "items.item_99": ["stale", 0] } },
    "7": { class_type: "TestSource", inputs: {} },
  } }) };
  const source = (await readFile(new URL("../web/wire_bus.js", import.meta.url), "utf8"))
    .replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({ app, mediaExecutionSource, navigator: { language: "zh-CN" }, console });
  vm.runInContext(source + "\nglobalThis.listTest = {syncBusList,patchGraphToPrompt,canConnectBusOutput};", context);
  class BusList {}
  extension.beforeRegisterNodeDef(BusList, { name: "TerryXuBusToList", input: { optional: { items: [] } } });
  const loader = { id: 1, type: "TerryXuMediaLoader", graph, outputs: [{ type: "TERRY_WIRE_BUS" }] };
  let groups = { image: [{ id: "a" }, { id: "b" }, { id: "empty", empty: true }], audio: [{ id: "sound" }], video: [{ id: "clip" }] };
  loader.__terryBusLaneEntries = () => mediaLanes(loader, groups);
  const bridge = { id: 2, type: "TerryXuWirelessBusPack", graph, properties: { terry_wireless_bus_channel: "总线 1" },
    inputs: [{ name: "bus", type: "TERRY_WIRE_BUS", link: 1 }], outputs: [{ type: "TERRY_WIRE_BUS" }] };
  const relay = { id: 3, type: "TerryXuWirelessBusUnpack", graph,
    properties: { terry_wireless_bus_channel: "总线 1", terry_wire_bus_expand_outputs: false },
    inputs: [{ name: "bus", link: null }], outputs: [{ type: "TERRY_WIRE_BUS" }] };
  const node = Object.assign(new BusList(), { id: 5, type: "TerryXuBusToList", graph, inputs: [{ name: "bus", link: 2 }], outputs: [{ type: "*" }],
    __terryBusListInfo: { textContent: "" } });
  graph._nodes.push(loader, bridge, relay, node);
  graph.links[1] = { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0 };
  graph.links[2] = { id: 2, origin_id: 3, origin_slot: 0, target_id: 5, target_slot: 0 };
  context.listTest.patchGraphToPrompt();
  return { graph, app, loader, bridge, node, api: context.listTest, setGroups(value) { groups = value; } };
}

test("mixed media through wireless bus becomes one ordered native list without empty slots or virtual dependencies", async () => {
  const { app, node, api, setGroups } = await fixture();
  api.syncBusList(node);
  assert.equal(node.__terryBusListInfo.textContent, "混合：图片 2 · 音频 1 · 视频 1");
  assert.equal(node.outputs[0].type, "*");
  assert.equal(api.canConnectBusOutput(node, node.inputs[0]), true);
  const prompt = (await app.graphToPrompt()).output;
  assert.deepEqual(prompt["5"].inputs, {
    "items.item_0": ["1:media:a", 0], "items.item_1": ["1:media:b", 0],
    "items.item_2": ["1:media:sound", 0], "items.item_3": ["1:media:clip", 0],
  });
  assert.equal(prompt["1:media:empty"], undefined);
  setGroups({ image: [{ id: "b" }, { id: "a" }], audio: [], video: [] });
  const sorted = (await app.graphToPrompt()).output;
  assert.deepEqual(sorted["5"].inputs["items.item_0"], ["1:media:b", 0]);
  assert.equal(node.__terryBusListInfo.textContent, "图片 2");
  assert.equal(node.outputs[0].type, "IMAGE");
  node.inputs[0].link = null;
  assert.deepEqual((await app.graphToPrompt()).output["5"].inputs, {});
  assert.equal(node.__terryBusListInfo.textContent, "未识别到数据");
  assert.equal(node.outputs[0].type, "*");
});

test("Flow @ picker resolves real bus-list pictures and preserves ordinary list recognition", async t => {
  let source;
  try {
    source = await readFile(new URL("../../comfyui_libtv_xyq/web/cloudgen_at.js", import.meta.url), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return t.skip("optional Flow extension is not installed");
    throw error;
  }
  const { graph, node, setGroups } = await fixture();
  const context = vm.createContext({ app: { graph, registerExtension() {} }, api: { apiURL: value => value },
    URLSearchParams, document: { addEventListener() {} }, window: { addEventListener() {} }, setInterval() {} });
  vm.runInContext(source.replace(/^import .*;\r?\n/gm, "") + "\nglobalThis.assetsForTest = assetsFor;", context);
  const image = (id, kind = "image") => ({ id, kind, path: `references/${id}.png`, name: `${id}.png`, source: "output" });
  setGroups({ image: [image("b"), { id: "empty", empty: true }, image("a")], audio: [image("sound", "audio")], video: [] });
  graph.links[10] = { origin_id: node.id, origin_slot: 0, type: "*" };
  const flow = { type: "CloudGen_Flow_Image", graph, inputs: [{ name: "images", link: 10 }] };
  const refs = context.assetsForTest(flow).list;
  assert.deepEqual(Array.from(refs, ref => ref.name), ["b.png", "a.png"]);
  assert.deepEqual(Array.from(refs, ref => ref.token), ["<Picture 1>", "<Picture 2>"]);
  assert.match(refs[0].preview, /filename=b.png/);
  assert.match(refs[0].preview, /subfolder=references/);
  assert.match(refs[0].preview, /type=output/);
  assert.equal(node.__terryBusListEntries().length, 3, "recognition must not filter the actual mixed list");
  setGroups({ image: [], audio: [], video: [] });
  assert.equal(context.assetsForTest(flow).list.length, 0, "empty lists must not become a phantom picture");
  // Ordinary list and image-loader traversal stays intact.
  graph._nodes.push({ id: 8, type: "LoadImage", widgets: [{ name: "image", value: "ordinary.png" }] });
  graph._nodes.push({ id: 9, type: "CreateList", graph, inputs: [{ type: "IMAGE", link: 11 }] });
  graph.links[11] = { origin_id: 8, origin_slot: 0, type: "IMAGE" };
  graph.links[10].origin_id = 9;
  assert.equal(context.assetsForTest(flow).list[0].name, "ordinary.png");
});

test("ordinary typed bus lanes use real sources, and excessive counts fail explicitly", async () => {
  const { graph, app, node, setGroups } = await fixture();
  graph._nodes.push({ id: 7, type: "TestSource", outputs: [{ type: "INT", name: "number" }] });
  graph.links[1].origin_id = 7;
  const prompt = (await app.graphToPrompt()).output;
  assert.deepEqual(JSON.parse(JSON.stringify(prompt["5"].inputs)), { "items.item_0": ["7", 0] });
  assert.equal(node.__terryBusListInfo.textContent, "整数 1");
  assert.equal(node.outputs[0].type, "INT");
  graph.links[1].origin_id = 1;
  setGroups({ image: Array.from({ length: 101 }, (_, i) => ({ id: String(i) })), audio: [], video: [] });
  await assert.rejects(app.graphToPrompt(), /100/);
});
