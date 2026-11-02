import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function extensions() {
  const registered = [];
  const graph = { _nodes: [], setDirtyCanvas() {}, change() {} };
  const app = {
    graph,
    ui: { settings: { getSettingValue: () => "zh-CN" } },
    registerExtension(extension) { registered.push(extension); },
  };
  const context = vm.createContext({
    app, api: { addEventListener() {} }, navigator: { language: "zh-CN" },
    queueMicrotask(callback) { callback(); },
    setInterval: () => 1, clearInterval() {},
    requestAnimationFrame() {}, performance: { now: () => 0 },
  });
  for (const file of ["line_switch.js", "remote_control_output.js"]) {
    const source = (await readFile(new URL(`../web/${file}`, import.meta.url), "utf8"))
      .replace(/^import .*;\r?\n/gm, "");
    vm.runInContext(`(function () {\n${source}\n})();`, context);
  }
  return { registered, graph };
}

test("remote control keeps a single executable frontend definition", async () => {
  const { registered, graph } = await extensions();
  const controls = registered.find(({ name }) => name === "TerryXu.ControlChannels");
  const output = registered.find(({ name }) => name === "TerryXu.RemoteControlOutput");
  assert.ok(controls && output);
  assert.equal(controls.addCustomNodeDefs, undefined);
  const defs = {};
  output.addCustomNodeDefs(defs);
  assert.deepEqual(Object.keys(defs), ["TerryXuRemoteControl"]);
  assert.equal(defs.TerryXuRemoteControl.output[0], "*");
  assert.ok(defs.TerryXuRemoteControl.input.required.remote_payload);

  const target = {
    type: "TerryXuBoolSwitch", graph,
    properties: { terry_control_channel: "二路切换" },
    widgets: [{ name: "enabled", value: true }], inputs: [],
  };
  class Remote {
    addWidget(type, name, value, callback, options) {
      const item = { type, name, value, callback, options };
      this.widgets.push(item); return item;
    }
    addOutput(label, type) {
      const item = { label, type };
      this.outputs.push(item); return item;
    }
  }
  controls.beforeRegisterNodeDef(Remote, { name: "TerryXuRemoteControl" });
  output.beforeRegisterNodeDef(Remote, { name: "TerryXuRemoteControl" });
  const remote = Object.assign(new Remote(), {
    type: "TerryXuRemoteControl", graph,
    properties: { terry_remote_channel: "二路切换" },
    widgets: [], outputs: [], setDirtyCanvas() {},
  });
  graph._nodes.push(target, remote);
  remote.onNodeCreated();
  controls.nodeCreated(remote);
  output.nodeCreated(remote);
  assert.notEqual(remote.isVirtualNode, true);
  assert.equal(remote.applyToGraph, undefined);
  assert.equal(remote.outputs[0].type, "BOOLEAN");
  assert.equal(remote.widgets.find((item) => item.name === "remote_payload").value, "b:1");

  target.type = "TerryXuLineSwitch";
  target.widgets = [{ name: "index", value: 2 }];
  target.inputs = [{ name: "routes.a" }, { name: "routes.b" }];
  target.properties.terry_line_switch_index = 2;
  controls.afterConfigureGraph();
  output.afterConfigureGraph();
  assert.equal(remote.outputs[0].type, "INT");
  assert.equal(remote.widgets.find((item) => item.name === "remote_payload").value, "i:2");
});

test("boolean signal integrations use the registered linked-switch source", async () => {
  for (const file of ["line_switch.js", "remote_control_output.js",
    "bool_switch_subgraph_bridge.js", "group_manager_external_bool.js"]) {
    const source = await readFile(new URL(`../web/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /TerryXuBooleanSwitch/);
    if (file.includes("bridge") || file.includes("external_bool")) {
      assert.match(source, /TerryXuLinkedBoolean/);
    }
  }
});
