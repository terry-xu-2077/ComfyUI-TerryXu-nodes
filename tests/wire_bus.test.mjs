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
