import test from "node:test";
import assert from "node:assert/strict";
import { PRESETS, normalizeHex, contrast, readFavorites, selectedNodes, applyColors } from "../web/node_colors_model.mjs";

test("HEX validation accepts shorthand and rejects CSS injection", () => {
  assert.equal(normalizeHex(" abc "), "#AABBCC");
  assert.equal(normalizeHex("#01ab89"), "#01AB89");
  for (const value of [null, 42, "#gggggg", "red", "#abcd", "#fff;background:red"]) {
    assert.equal(normalizeHex(value), null);
  }
});

test("36 distinct presets keep shallow node text readable", () => {
  const colors = PRESETS.flatMap(p => p.colors);
  assert.equal(colors.length, 36);
  assert.equal(new Set(colors.map(p => p.color + p.bgcolor)).size, 36);
  for (const p of colors) {
    assert.ok(contrast(p.color) >= 4.5, p.name + " title");
    assert.ok(contrast(p.bgcolor) >= 4.5, p.name + " body");
  }
});

test("malformed or unavailable browser storage does not prevent opening", () => {
  for (const raw of ["{", "null", "{}", '[null,{},42,{"color":"red","bgcolor":"#fff"}]']) {
    assert.deepEqual(readFavorites({ getItem: () => raw }), []);
  }
  assert.deepEqual(readFavorites({ getItem() { throw Error("denied"); } }), []);
  const raw = JSON.stringify([{ name: "收藏", color: "#abc", bgcolor: "#123456" }]);
  assert.deepEqual(readFavorites({ getItem: () => raw }), [{ name: "收藏", color: "#AABBCC", bgcolor: "#123456" }]);
});

test("batch operation is one graph change; reset removes serialized overrides", () => {
  const events = [];
  const graph = { beforeChange() { events.push("before"); }, afterChange() { events.push("after"); } };
  const a = { graph, id: 1 }, b = { graph, id: 2 }, other = { graph: {}, id: 3 };
  const canvas = { graph, selected_nodes: { 1: a, 2: b, 3: other }, setDirty() { events.push("dirty"); } };
  assert.deepEqual(selectedNodes(canvas, a), [a, b]);
  assert.deepEqual(selectedNodes(canvas, other), [other]);
  const palette = PRESETS[0].colors[0];
  assert.equal(applyColors([a, b], palette, canvas), true);
  assert.deepEqual(events, ["before", "after", "dirty"]);
  const serialized = JSON.parse(JSON.stringify({ color: a.color, bgcolor: a.bgcolor }));
  assert.deepEqual(serialized, { color: palette.color, bgcolor: palette.bgcolor });
  applyColors([a, b], null, canvas);
  assert.equal(Object.hasOwn(a, "color"), false);
  assert.equal(Object.hasOwn(b, "bgcolor"), false);
  assert.equal(applyColors([other], palette, canvas), false);
});
