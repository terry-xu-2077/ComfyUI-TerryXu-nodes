import { app } from "../../scripts/app.js";

const RANGE_RE = /\[\s*(\d{1,2}:\d{1,2}|\d+(?:\.\d+)?\s*s?)\s*-\s*(\d{1,2}:\d{1,2}|\d+(?:\.\d+)?\s*s?)\s*\]/gi;
const CARET = "\u200B";

function parsePoint(value) {
  const text = String(value || "").trim();
  const clock = text.match(/^(\d{1,2}):(\d{1,2})$/);
  if (clock) return Number(clock[1]) * 60 + Math.min(59, Number(clock[2]));
  const seconds = text.match(/^(\d+(?:\.\d+)?)\s*s?$/i);
  return seconds ? Number(seconds[1]) : null;
}

function formatClock(seconds) {
  const value = Math.max(0, Math.round(Number(seconds) || 0));
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function parseRange(raw) {
  const match = String(raw || "").match(/^\[\s*(\d{1,2}:\d{1,2}|\d+(?:\.\d+)?\s*s?)\s*-\s*(\d{1,2}:\d{1,2}|\d+(?:\.\d+)?\s*s?)\s*\]$/i);
  if (!match) return null;
  const start = parsePoint(match[1]);
  const end = parsePoint(match[2]);
  if (start == null || end == null || end <= start) return null;
  return { start, end };
}

function makeChip(raw) {
  const range = parseRange(raw);
  if (!range) return document.createTextNode(raw);
  const chip = document.createElement("span");
  chip.className = "terry-h3-chip terry-h3-type-time-range";
  chip.contentEditable = "false";
  chip.dataset.raw = raw;
  chip.dataset.terryTimeRange = "1";
  chip.textContent = `时间区间 ${formatClock(range.start)}–${formatClock(range.end)}`;
  chip.title = "点击编辑时间区间";
  return chip;
}

function editorRoot(node) {
  const root = node?.parentElement?.closest?.('[contenteditable="true"]');
  if (!root || root.classList?.contains("terry-h3-dialogue-text")) return null;
  const owner = root.closest?.('[class*="terry-h3"], [class*="terry-tl"]');
  return owner ? root : null;
}

function convertTextNode(node) {
  if (node?.nodeType !== Node.TEXT_NODE || !String(node.nodeValue || "").includes("[")) return;
  const editor = editorRoot(node);
  if (!editor || node.parentElement?.closest?.(".terry-h3-chip")) return;
  const text = String(node.nodeValue || "");
  RANGE_RE.lastIndex = 0;
  let match, last = 0, changed = false;
  const fragment = document.createDocumentFragment();
  while ((match = RANGE_RE.exec(text))) {
    if (!parseRange(match[0])) continue;
    changed = true;
    if (match.index > last) fragment.append(document.createTextNode(text.slice(last, match.index)));
    fragment.append(makeChip(match[0]));
    last = RANGE_RE.lastIndex;
  }
  if (!changed) return;
  if (last < text.length) fragment.append(document.createTextNode(text.slice(last)));
  node.replaceWith(fragment);
}

function scan(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach(convertTextNode);
}

function openEditor(chip) {
  const parsed = parseRange(chip.dataset.raw);
  if (!parsed) return;
  document.querySelector(".terry-h3-time-range-picker")?.remove?.();
  const box = document.createElement("div");
  box.className = "terry-h3-time-range-picker";
  const start = document.createElement("input");
  const end = document.createElement("input");
  for (const input of [start, end]) { input.type = "text"; input.inputMode = "numeric"; input.maxLength = 5; }
  start.value = formatClock(parsed.start); end.value = formatClock(parsed.end);
  const dash = document.createElement("span"); dash.textContent = "–";
  const ok = document.createElement("button"); ok.type = "button"; ok.textContent = "确定";
  const apply = () => {
    const a = parsePoint(start.value), b = parsePoint(end.value);
    if (a == null || b == null || b <= a) { box.classList.add("is-error"); return; }
    chip.dataset.raw = `[${formatClock(a)} - ${formatClock(b)}]`;
    chip.textContent = `时间区间 ${formatClock(a)}–${formatClock(b)}`;
    chip.closest('[contenteditable="true"]')?.dispatchEvent(new Event("terrychange", { bubbles: true }));
    box.remove();
  };
  ok.addEventListener("click", apply);
  box.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); apply(); } else if (event.key === "Escape") box.remove(); });
  box.append(start, dash, end, ok);
  document.body.append(box);
  const rect = chip.getBoundingClientRect();
  box.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - 250))}px`;
  box.style.top = `${Math.min(innerHeight - 48, rect.bottom + 6)}px`;
  start.focus(); start.select();
}

function slashHit() {
  const selection = window.getSelection?.();
  if (!selection?.rangeCount || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (caret.startContainer?.nodeType !== Node.TEXT_NODE) return null;
  const editor = editorRoot(caret.startContainer);
  if (!editor || editor.closest?.(".terry-h3-timeline-root")) return null;
  const before = String(caret.startContainer.textContent || "").slice(0, caret.startOffset);
  const match = before.match(/\/([^/\n]*)$/);
  if (!match) return null;
  const range = document.createRange();
  range.setStart(caret.startContainer, caret.startOffset - match[0].length);
  range.setEnd(caret.startContainer, caret.startOffset);
  return { editor, range };
}

function insertRangeFromMenu(menu) {
  const hit = slashHit(); if (!hit) return;
  hit.range.deleteContents();
  const marker = document.createTextNode(CARET);
  const fragment = document.createDocumentFragment();
  fragment.append(makeChip("[00:00 - 00:05]"), marker);
  hit.range.insertNode(fragment);
  const selection = window.getSelection?.();
  if (selection) {
    const next = document.createRange(); next.setStart(marker, marker.textContent.length); next.collapse(true);
    selection.removeAllRanges(); selection.addRange(next);
  }
  hit.editor.dispatchEvent(new Event("terrychange", { bubbles: true }));
  menu.remove(); hit.editor.focus({ preventScroll: true });
}

function patchShotMenu(menu) {
  if (!(menu instanceof HTMLElement) || menu.dataset.terryTimeRangeMenu === "1") return;
  const title = String(menu.querySelector(".terry-h3-command-head-title b")?.textContent || "").trim();
  if (title !== "镜头") return;
  if (!slashHit()) return;
  menu.dataset.terryTimeRangeMenu = "1";
  const item = document.createElement("button");
  item.type = "button"; item.className = "terry-h3-command-item terry-h3-time-range-command";
  const cat = document.createElement("span"); cat.className = "terry-h3-command-category"; cat.textContent = "镜头";
  const text = document.createElement("span"); text.className = "terry-h3-command-text"; text.innerHTML = "<b>时间区间</b><small>插入 [00:00 - 00:05]，用于描述镜头起止时间</small>";
  item.append(cat, text);
  item.addEventListener("pointerdown", (event) => { event.preventDefault(); event.stopPropagation(); insertRangeFromMenu(menu); });
  const timestamp = [...menu.querySelectorAll(".terry-h3-command-item")].find((el) => String(el.textContent || "").includes("时间戳"));
  if (timestamp?.nextSibling) menu.insertBefore(item, timestamp.nextSibling); else menu.append(item);
}

function preprocessTimelineParser(event) {
  const button = event.target?.closest?.(".terry-tl-parser-actions .is-primary");
  if (!button) return;
  const textarea = button.closest(".terry-tl-parser-panel")?.querySelector(".terry-tl-parser-text");
  if (!textarea) return;
  textarea.value = String(textarea.value || "").replace(RANGE_RE, (raw, a, b) => {
    const range = parseRange(raw);
    if (!range) return raw;
    return `\n时间: ${formatClock(range.start)} - ${formatClock(range.end)}\n`;
  });
}

function installStyles() {
  if (document.getElementById("terry-h3-time-range-style")) return;
  const style = document.createElement("style"); style.id = "terry-h3-time-range-style";
  style.textContent = `
.terry-h3-type-time-range{background:rgba(110,190,255,.12)!important;color:rgb(196,229,255)!important;box-shadow:inset 0 0 0 1px rgba(110,190,255,.25)!important;cursor:pointer!important}
.terry-h3-time-range-picker{position:fixed;z-index:2147483100;display:flex;align-items:center;gap:6px;padding:7px;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:var(--comfy-menu-bg,#202225);box-shadow:0 14px 36px rgba(0,0,0,.48);color:var(--input-text,#ddd)}
.terry-h3-time-range-picker input{width:58px;height:26px;box-sizing:border-box;padding:0 6px;border:1px solid rgba(255,255,255,.14);border-radius:5px;background:rgba(0,0,0,.18);color:inherit;outline:none;text-align:center;font:11px ui-monospace,monospace}.terry-h3-time-range-picker button{height:26px;padding:0 9px;border:0;border-radius:5px;background:rgba(255,255,255,.12);color:inherit;cursor:pointer}.terry-h3-time-range-picker.is-error input{border-color:#d66}
`;
  document.head.append(style);
}

app.registerExtension({
  name: "TerryXu.H3TimeRange",
  setup() {
    installStyles();
    document.addEventListener("pointerdown", (event) => {
      preprocessTimelineParser(event);
      const chip = event.target?.closest?.(".terry-h3-type-time-range");
      if (chip) { event.preventDefault(); event.stopPropagation(); openEditor(chip); }
    }, true);
    const observer = new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes || []) {
        if (node.nodeType === Node.TEXT_NODE) convertTextNode(node);
        else if (node.nodeType === Node.ELEMENT_NODE) {
          if (node.matches?.(".terry-h3-command-menu")) queueMicrotask(() => patchShotMenu(node));
          scan(node);
          node.querySelectorAll?.(".terry-h3-command-menu").forEach((menu) => queueMicrotask(() => patchShotMenu(menu)));
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
  },
});
