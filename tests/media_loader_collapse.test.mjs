import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.events = {};
    this.options = {};
    this.scrollHeight = 0;
    this.classes = new Set();
    this.classList = {
      toggle: (name, active) => active ? this.classes.add(name) : this.classes.delete(name),
      contains: name => this.classes.has(name),
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  addEventListener(name, callback) { this.events[name] = callback; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelectorAll() { return []; }
  querySelector(selector) {
    if (selector !== ".terry-media-add") return null;
    const find = element => element.className === "terry-media-add"
      ? element : element.children.map(find).find(Boolean);
    return find(this);
  }
  click() { this.events.click?.({}); }
}

async function fixture() {
  const source = (await readFile(new URL("../web/media_loader.js", import.meta.url), "utf8"))
    .replace(/^import\s+[\s\S]*?from\s+"[^"]+";\s*/gm, "")
    .replaceAll("import.meta.url", '"file:///media_loader.js"');
  const graph = { beforeChange() {}, afterChange() {}, change() {} };
  let busSyncs = 0;
  const app = {
    graph,
    extensionManager: { workflow: { activeWorkflow: null } },
    registerExtension() {},
  };
  const context = vm.createContext({
    app,
    document: { getElementById: () => true, createElement: tag => new Element(tag) },
    queueMicrotask: callback => callback(),
    crypto: { randomUUID: () => String(Math.random()) },
    MEDIA_KINDS: ["image", "audio", "video"],
    MEDIA_LABELS: { image: "图片", audio: "音频", video: "视频" },
    readMedia: JSON.parse,
    mediaFile() {}, moveMedia() {}, removeMedia() {}, mediaLanes: () => [],
    emptyMediaSlot: (kind, id) => ({ id, kind, empty: true }),
    syncMediaBusOutputs: () => { busSyncs++; },
    mediaAssetHasReferences: () => false,
  });
  vm.runInContext(source + "\nglobalThis.installTest = install;", context);
  let id = 0;
  function makeNode(properties = {}, size = [640, 800]) {
    const assets = {
      image: Array.from({ length: 7 }, () => ({ id: String(++id), empty: true })),
      audio: Array.from({ length: 3 }, () => ({ id: String(++id), empty: true })),
      video: Array.from({ length: 3 }, () => ({ id: String(++id), empty: true })),
    };
    const node = {
      graph, properties, size,
      widgets: [{ name: "assets_json", value: JSON.stringify(assets), options: {} }],
      setSize(value) { this.size = value; },
      setDirtyCanvas() {},
      addDOMWidget(name, type, root, options) {
        this.root = root;
        this.domOptions = options;
        return {};
      },
    };
    context.installTest(node);
    return node;
  }
  function section(node, kind) {
    return node.root.children[0].children.find(item => item.dataset.kind === kind);
  }
  function toggle(node, kind) { return section(node, kind).children[0].children[0].children[0]; }
  return { makeNode, section, toggle, busSyncs: () => busSyncs };
}

test("Media Loader bounds its DOM widget to content and trims stale oversized height after reload", async () => {
  const { makeNode } = await fixture();
  const node = makeNode({}, [640, 1600]);

  assert.equal(node.domOptions.getMinHeight(), 700);
  assert.equal(node.domOptions.getMaxHeight(), 1116);
  node.__terryMediaLoader.fitLoadedHeight();
  assert.equal(node.size[1], 1164);
});

test("each media section folds independently without changing its assets or bus", async () => {
  const { makeNode, section, toggle, busSyncs } = await fixture();
  const node = makeNode();
  const original = node.widgets[0].value;
  assert.equal(node.root.children[0].children.length, 3);
  assert.equal(node.domOptions.getMinHeight(), 700);
  toggle(node, "audio").click();
  assert.equal(section(node, "audio").classes.has("is-collapsed"), true);
  assert.equal(section(node, "audio").children[0].children[1].hidden, true);
  assert.equal(section(node, "image").classes.has("is-collapsed"), false);
  assert.equal(toggle(node, "audio").attributes["aria-expanded"], "false");
  assert.equal(node.properties.terry_media_collapsed.audio, true);
  assert.equal(node.widgets[0].value, original);
  assert.equal(busSyncs(), 0);
  toggle(node, "image").click();
  toggle(node, "video").click();
  assert.ok(node.size[1] < 800);
  assert.equal(node.properties.terry_media_expanded_height, 800);
  assert.ok(node.domOptions.getMinHeight() < 700);
});

test("folded sections and expanded node height survive workflow reload", async () => {
  const { makeNode, section, toggle, busSyncs } = await fixture();
  const node = makeNode();
  for (const kind of ["image", "audio", "video"]) toggle(node, kind).click();
  const saved = JSON.parse(JSON.stringify(node.properties));
  const restored = makeNode(saved, [...node.size]);
  for (const kind of ["image", "audio", "video"]) {
    assert.ok(section(restored, kind).classes.has("is-collapsed"));
    assert.equal(section(restored, kind).children[0].children[1].hidden, true);
  }
  // Clicking anywhere on the header row toggles the section.
  const audioHeader = section(restored, "audio").children[0];
  audioHeader.events.click({ target: { closest: () => null } });
  assert.equal(section(restored, "audio").classes.has("is-collapsed"), false);
  assert.equal(audioHeader.children[1].hidden, false);
  audioHeader.children[1].click();
  assert.equal(JSON.parse(restored.widgets[0].value).audio.length, 4);
  assert.equal(busSyncs(), 1);
  // The + button must not inadvertently fold the region.
  audioHeader.events.click({ target: { closest: () => ({}) } });
  assert.equal(section(restored, "audio").classes.has("is-collapsed"), false);
  for (const kind of ["image", "video"]) toggle(restored, kind).click();
  assert.equal(restored.size[1], 800);
  assert.equal(restored.properties.terry_media_expanded_height, undefined);
});
