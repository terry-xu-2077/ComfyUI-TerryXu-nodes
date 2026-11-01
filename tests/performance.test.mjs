import test from "node:test";
import assert from "node:assert/strict";
import { percent, memoryText, memoryPercent, trendPath, smoothTrend, TrendHistory, mergeSnapshots } from "../web/performance_model.mjs";

function anchors(path) {
  return [...path.matchAll(/([MC])([^MC]+)/g)].map(([, command, coordinates]) => {
    const endpoint = coordinates.trim().split(/\s+/).at(-1);
    return `${command === "M" ? "M" : "L"}${endpoint}`;
  }).join(" ");
}

test("unavailable metrics stay unavailable, rather than showing zero", () => {
  for (const value of [null, undefined, NaN, Infinity, "25"]) assert.equal(percent(value), null);
  assert.equal(percent(120), 100);
  assert.equal(percent(-1), 0);
  assert.equal(memoryPercent(null, 100), null);
  assert.equal(memoryPercent(8, 16), 50);
  assert.equal(memoryPercent(8, 0), null);
  assert.equal(memoryText(null, 10), "不可用");
  assert.equal(memoryText(2 ** 30, 4 * 2 ** 30), "1.0 / 4.0 GB");
});

test("real sampling outages retain history and produce an honest gap", () => {
  const history = new TrendHistory(6);
  history.append({ cpu: 12, gpu: 20 }, 1000);
  history.append({ cpu: 14, gpu: 22 }, 3000);
  assert.equal(history.samples.length, 2);
  history.append({ cpu: 16, gpu: 25 }, 13000);
  assert.equal(history.samples.length, 4);
  assert.equal(history.samples[0].values.cpu, 12);
  assert.equal(history.samples[2].values, null);
  const path = trendPath(history.samples.map(s => s.values?.cpu ?? null), { times: history.samples.map(s => s.time) });
  assert.equal((path.match(/M/g) || []).length, 2);
  history.append({ cpu: 20 }, 15000);
  history.append({ cpu: 21 }, 17000);
  history.append({ cpu: 22 }, 19000);
  assert.equal(history.samples.length, 6);
  assert.equal(history.samples[0].time, 3000);
});

test("background samples merge without duplicates or artificial tab-switch gaps", () => {
  const previous = [{ timestamp: 1, cpu: { usage: 10 } }, { timestamp: 3, cpu: { usage: 20 } }];
  const incoming = [previous[1], { timestamp: 5, cpu: { usage: 30 } }, { timestamp: 7, cpu: { usage: 40 } }];
  const samples = mergeSnapshots(previous, incoming);
  assert.deepEqual(samples.map(s => s.timestamp), [1, 3, 5, 7]);
  const history = new TrendHistory();
  for (const sample of samples) history.append({ cpu: sample.cpu.usage }, sample.timestamp * 1000);
  assert.equal(history.samples.length, 4);
  assert.ok(history.samples.every(s => s.values !== null));
  assert.deepEqual(mergeSnapshots(samples, incoming, 2).map(s => s.timestamp), [5, 7]);
});

test("fixed 0–100% scale keeps small values at the same height before and after a peak", () => {
  const history = new TrendHistory(3);
  for (const gpu of [8, 99, 8]) history.append({ gpu });
  assert.equal(anchors(trendPath(history.samples.map(s => s.values.gpu))), "M278.4,116.9 L283.2,2.3 L288.0,116.9");
  for (const gpu of [8, 8, 8]) history.append({ gpu });
  assert.equal(anchors(trendPath(history.samples.map(s => s.values.gpu))), "M278.4,116.9 L283.2,116.9 L288.0,116.9");
  assert.equal(anchors(trendPath([0, 50, 100])), "M278.4,127.0 L283.2,64.0 L288.0,1.0");
});

test("fixed two-minute time scale leaves startup empty and preserves sample spacing", () => {
  const short = trendPath([0, 0], { times: [1000, 3000] });
  assert.equal(anchors(short), "M283.2,127.0 L288.0,127.0");
  assert.equal(anchors(trendPath([0, 0, 0], { times: [1000, 3000, 5000] })), "M278.4,127.0 L283.2,127.0 L288.0,127.0");
  assert.equal(anchors(trendPath([0, 0, 0], { times: [1000, 61000, 121000] })), "M0.0,127.0 L144.0,127.0 L288.0,127.0");
  assert.ok(trendPath([0, 0], { times: [1000, 131000] }).startsWith("M-24.0,"));
});

test("trend gaps break the line and values stay inside the chart", () => {
  const path = trendPath([0, null, 50, 120]);
  assert.equal((path.match(/M/g) || []).length, 2);
  assert.ok(!path.includes("NaN"));
  assert.ok(anchors(path).endsWith("L288.0,1.0"));
  assert.equal(trendPath([null, null]), "");
});

test("display smoothing reduces tiny sawteeth without changing raw samples", () => {
  const raw = Object.freeze([4, 10, 2, 10, 4]);
  assert.deepEqual(smoothTrend(raw), [4, 6.5, 6, 6.5, 4]);
  assert.deepEqual(raw, [4, 10, 2, 10, 4]);
  assert.deepEqual(smoothTrend([30, 30, 30, 30]), [30, 30, 30, 30]);
});

test("smoothing preserves major peaks, load transitions and missing-data gaps", () => {
  assert.deepEqual(smoothTrend([10, 10, 80, 10, 10]), [10, 10, 80, 10, 10]);
  assert.deepEqual(smoothTrend([80, 80, 10, 80, 80]), [80, 80, 10, 80, 80]);
  assert.deepEqual(smoothTrend([0, 10, 20, 30, 40]), [0, 10, 20, 30, 40]);
  assert.deepEqual(smoothTrend([5, 10, null, 80, 2]), [5, 10, null, 80, 2]);
  assert.deepEqual(smoothTrend([5]), [5]);
  assert.deepEqual(smoothTrend([]), []);
});

test("rounded curves preserve every sample and cannot overshoot segment peaks", () => {
  const values = [0, 100, 5, 8, 80, 80, 1];
  const path = trendPath(values, { times: [0, 1000, 3500, 5000, 9000, 11000, 13000] });
  assert.ok(path.includes(" C"));
  const commands = [...path.matchAll(/C([^MC]+)/g)];
  assert.equal(commands.length, values.length - 1);
  commands.forEach(([, coordinates], i) => {
    const points = coordinates.trim().split(/\s+/).map(pair => pair.split(",").map(Number));
    const y0 = 127 - values[i] / 100 * 126, y1 = 127 - values[i + 1] / 100 * 126;
    for (const [, y] of points) {
      assert.ok(y >= Math.min(y0, y1) - 0.051 && y <= Math.max(y0, y1) + 0.051);
    }
    assert.ok(Math.abs(points[2][1] - y1) <= 0.051);
  });
  assert.equal((trendPath([5, 30, null, 60, 10]).match(/M/g) || []).length, 2);
});
