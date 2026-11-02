import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { isTerrySwitch, selectedSwitchInput, LINE_SWITCH_TYPE, BOOL_SWITCH_TYPE } from "../web/switch_bus_route.mjs";
import { mediaLanes, mediaExecutionSource } from "../web/media_loader_model.mjs";

async function moduleContext(file, globals, exports) {
  const source = (await readFile(new URL(`../web/${file}`, import.meta.url), "utf8"))
    .replace(/^import[\s\S]*?from\s+"[^"]+";\r?\n/gm, "").replace(/^export /gm, "");
  const context = vm.createContext({ console, URLSearchParams, ...globals });
  vm.runInContext(source + `\nglobalThis.testApi = {${exports.join(",")}};`, context);
  return context.testApi;
}

const asset = (id, kind = "image") => ({ id, kind, path: `refs/${id}.${kind === "image" ? "png" : kind === "audio" ? "wav" : "mp4"}`,
  name: id, source: "output" });

async function fixture(nested = false) {
  const graph = { id: "inner", _nodes: [], links: {}, getNodeById(id) { return this._nodes.find(n => String(n.id) === String(id)); } };
  const root = nested ? { _nodes: [{ id: 9, subgraph: graph }] } : graph;
  graph.rootGraph = root;
  let groups = { image: [asset("a"), asset("b"), { id: "empty", empty: true }], audio: [asset("sound", "audio")], video: [asset("clip", "video")] };
  const loader = { id: 1, type: "TerryXuMediaLoader", graph, outputs: [{ type: "TERRY_WIRE_BUS" }], widgets: [] };
  loader.__terryBusLaneEntries = () => mediaLanes(loader, groups);
  const editor = { id: 2, type: "TerryXuH3PromptEditor", graph, properties: {}, inputs: [{ name: "media", link: 1 }] };
  graph._nodes.push(loader, editor);
  graph.links[1] = { id: 1, origin_id: 1, origin_slot: 0, target_id: 2, target_slot: 0, type: "TERRY_WIRE_BUS" };
  const prefix = nested ? "9:" : "";
  const app = { graph: root, registerExtension() {}, graphToPrompt: async () => ({ output: {
    [`${prefix}1`]: { class_type: "TerryXuMediaLoader", inputs: {} },
    [`${prefix}2`]: { class_type: "TerryXuH3PromptEditor", inputs: { prompt: "<Picture 1> <Picture 2> <Audio 1> <Video 1>" } },
  } }) };
  const resolver = await moduleContext("h3_bus_resolver.js", { app, isTerrySwitch, selectedSwitchInput }, ["H3_BUS_TYPE", "h3AllGraphs", "h3BusSignature", "h3CollectBusMedia",
    "h3CollectBusMediaForExecution", "h3IsBusLinkInfo", "h3IsSubgraphInputLinkInfo", "h3IsSubgraphNode", "h3MediaInputIndex", "h3MediaKind", "h3NodeType", "h3ResolveNativeBus"]);
  const native = await moduleContext("h3_native_wire_bus.js", { app, ...resolver, mediaExecutionSource }, ["installReferenceView", "patchGraphToPrompt"]);
  native.installReferenceView(editor);
  const ui = await moduleContext("h3_prompt_editor.js", { app, api: { apiURL: value => value }, mediaExecutionSource }, ["graphMediaOptions", "patchGraphToPrompt", "normalizeLinks"]);
  return { graph, app, editor, loader, resolver, native, ui, setGroups(value) { groups = value; } };
}

test("H3 identifies every loader asset, shows correct thumbnails, and emits individual media adapters", async () => {
  const { graph, app, editor, resolver, native, ui, setGroups } = await fixture();
  assert.equal(resolver.h3CollectBusMedia(editor).length, 4);
  assert.equal(ui.normalizeLinks(editor).length, 4, "same node/slot must not collapse different assets");
  assert.equal(editor.__terryNativeBus.getDirectLinks().length, 0, "derived bus references must not leak into workflow properties");
  const options = ui.graphMediaOptions(editor);
  assert.deepEqual(Array.from(options, x => [x.kind, x.tag, x.source]), [
    ["picture", "<Picture 1>", "a"], ["picture", "<Picture 2>", "b"],
    ["audio", "<Audio 1>", "sound"], ["video", "<Video 1>", "clip"],
  ]);
  assert.match(options[1].preview, /filename=b.png/);
  assert.match(options[1].preview, /type=output/);
  assert.match(options[1].preview, /subfolder=refs/);
  ui.patchGraphToPrompt();
  native.patchGraphToPrompt();
  const prompt = (await app.graphToPrompt()).output;
  assert.deepEqual(prompt["2"].inputs.asset1, ["1:media:a", 0]);
  assert.deepEqual(prompt["2"].inputs.asset2, ["1:media:b", 0]);
  assert.deepEqual(prompt["2"].inputs.asset3, ["1:media:sound", 0]);
  assert.equal(prompt["1:media:empty"], undefined);
  const oldSignature = resolver.h3BusSignature(editor);
  setGroups({ image: [asset("b"), asset("a")], audio: [], video: [] });
  assert.notEqual(resolver.h3BusSignature(editor), oldSignature);
  assert.equal(ui.graphMediaOptions(editor)[0].source, "b");
  assert.deepEqual((await app.graphToPrompt()).output["2"].inputs.asset1, ["1:media:b", 0]);
  // A Bus-In bridge keeps the loader's asset identities and order.
  graph._nodes.push({ id: 3, type: "TerryXuWirelessBusPack", graph, inputs: [{ link: 3 }] });
  graph.links[3] = { id: 3, origin_id: 1, origin_slot: 0, type: "TERRY_WIRE_BUS" };
  graph.links[1].origin_id = 3;
  assert.deepEqual(Array.from(resolver.h3CollectBusMedia(editor), x => x.asset_id), ["b", "a"]);
});

test("H3 subgraph execution keeps the loader execution path in every adapter", async () => {
  const { app, editor, resolver, native } = await fixture(true);
  const media = resolver.h3CollectBusMediaForExecution(editor, "9:2");
  assert.equal(media.length, 4);
  assert.equal(media[0].source_execution_id, "9:1");
  native.patchGraphToPrompt();
  const output = (await app.graphToPrompt()).output;
  assert.deepEqual(output["9:2"].inputs.asset1, ["9:1:media:a", 0]);
  assert.deepEqual(output["9:1:media:a"].inputs.bus, ["9:1", 0]);
});
