import { app } from "../../scripts/app.js";
import { PRESETS, STORAGE_KEY, normalizeHex, readFavorites, selectedNodes, applyColors } from "./node_colors_model.mjs";

const COMMAND = "TerryXu.NodeColors.Open";
let popup;

function button(label, text, action) {
  const el = document.createElement("button");
  el.type = "button";
  el.title = label;
  el.setAttribute("aria-label", label);
  el.textContent = text;
  el.onclick = action;
  return el;
}

export function openColorPanel(node, anchor) {
  if (popup) {
    const wasOpen = popup.matches(":popover-open");
    popup.remove();
    popup = null;
    if (wasOpen) return;
  }
  const canvas = app.canvas;
  const nodes = selectedNodes(canvas, node);
  const panel = document.createElement("div");
  popup = panel;
  panel.className = "tx-colors";
  panel.popover = "auto";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "增强配色");
  let favorites;
  try { favorites = readFavorites(localStorage); } catch { favorites = []; }
  const status = document.createElement("span");
  status.className = "tx-color-status";
  status.setAttribute("role", "status");
  function apply(palette) {
    if (applyColors(nodes, palette, canvas)) panel.hidePopover();
    else status.textContent = "请重新选择节点";
  }
  const grid = document.createElement("div");
  grid.className = "tx-color-grid";
  // Main action: native-style circles; all custom controls stay collapsed.
  for (const row of PRESETS) {
    for (const palette of row.colors) {
      const swatch = button(`${row.name} · ${palette.name}`, "", () => apply(palette));
      swatch.className = "tx-color-swatch";
      swatch.style.backgroundColor = palette.color;
      if (node.color?.toUpperCase() === palette.color && node.bgcolor?.toUpperCase() === palette.bgcolor) {
        swatch.textContent = "✓";
        swatch.setAttribute("aria-pressed", "true");
      } else swatch.setAttribute("aria-pressed", "false");
      grid.append(swatch);
    }
  }
  const tools = document.createElement("div");
  tools.className = "tx-color-tools";
  const brand = document.createElement("span");
  brand.className = "tx-color-brand";
  brand.textContent = "TerryXu";
  const saved = document.createElement("div");
  saved.className = "tx-color-saved";
  function drawFavorites() {
    saved.replaceChildren();
    for (const palette of favorites) {
      const swatch = button(`收藏 ${palette.color} / ${palette.bgcolor}（右键或 Delete 删除）`, "", () => apply(palette));
      swatch.className = "tx-color-swatch";
      swatch.style.backgroundColor = palette.color;
      function remove(event) {
        event.preventDefault();
        persist(favorites.filter(p => p !== palette));
      }
      swatch.oncontextmenu = remove;
      swatch.onkeydown = event => { if (event.key === "Delete") remove(event); };
      saved.append(swatch);
    }
  }
  function persist(next) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      favorites = next;
      drawFavorites();
      position();
      return true;
    } catch { status.textContent = "浏览器无法保存收藏"; return false; }
  }
  const custom = document.createElement("form");
  custom.className = "tx-color-custom";
  custom.hidden = true;
  const fields = [];
  for (const [key, label] of [["color", "标题"], ["bgcolor", "背景"]]) {
    const row = document.createElement("label");
    row.textContent = label;
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = normalizeHex(node[key]) || PRESETS[0].colors[8][key];
    picker.setAttribute("aria-label", label + "颜色");
    const hex = document.createElement("input");
    hex.type = "text";
    hex.value = picker.value.toUpperCase();
    hex.maxLength = 7;
    hex.spellcheck = false;
    hex.setAttribute("aria-label", label + " HEX");
    picker.oninput = () => { hex.value = picker.value.toUpperCase(); hex.setCustomValidity(""); };
    hex.oninput = () => {
      const value = normalizeHex(hex.value);
      hex.setCustomValidity(value ? "" : "请输入 3 位或 6 位 HEX");
      hex.setAttribute("aria-invalid", String(!value));
      if (value) picker.value = value;
    };
    row.append(picker, hex);
    custom.append(row);
    fields.push({ key, picker, hex });
  }
  function draft() {
    return Object.fromEntries(fields.map(f => [f.key, normalizeHex(f.hex.value)]));
  }
  const save = button("收藏当前自定义配色", "☆", () => {
    if (!custom.reportValidity()) return;
    const palette = draft();
    if (favorites.some(p => p.color === palette.color && p.bgcolor === palette.bgcolor)) {
      status.textContent = "已收藏"; return;
    }
    if (favorites.length >= 48) { status.textContent = "收藏已满，请右键删除旧配色"; return; }
    if (persist([...favorites, { name: "自定义", ...palette }])) status.textContent = "已收藏";
  });
  const confirm = button("应用自定义配色", "✓", () => {});
  confirm.type = "submit";
  custom.onsubmit = event => { event.preventDefault(); if (custom.reportValidity()) apply(draft()); };
  custom.append(save, confirm);
  const add = button("自定义颜色", "+", () => {
    custom.hidden = !custom.hidden;
    add.setAttribute("aria-expanded", String(!custom.hidden));
    position();
    if (!custom.hidden) fields[0].hex.focus();
  });
  add.setAttribute("aria-expanded", "false");
  const reset = button("恢复默认颜色", "↶", () => apply(null));
  tools.append(brand, saved, status, add, reset);
  panel.append(grid, tools, custom);
  document.body.append(panel);
  drawFavorites();
  function position() {
    const rect = anchor?.getBoundingClientRect();
    const width = panel.offsetWidth, height = panel.offsetHeight;
    const center = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    const top = rect ? rect.top - height - 8 : window.innerHeight / 2 - height / 2;
    panel.style.left = `${Math.max(8, Math.min(center - width / 2, window.innerWidth - width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(top < 8 && rect ? rect.bottom + 8 : top, window.innerHeight - height - 8))}px`;
  }
  panel.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Escape") { panel.hidePopover(); anchor?.focus(); }
  });
  panel.addEventListener("toggle", event => {
    if (event.newState === "closed") { panel.remove(); if (popup === panel) popup = null; }
  });
  panel.showPopover();
  position();
  grid.firstElementChild.focus();
}

app.registerExtension({
  name: "TerryXu.NodeColors",
  commands: [{ id: COMMAND, label: "增强配色", icon: "terryxu-palette-icon", function: () => {
    const node = Object.values(app.canvas.selected_nodes ?? {})[0];
    if (node) openColorPanel(node, document.querySelector("button:has(.terryxu-palette-icon)"));
  } }],
  getSelectionToolboxCommands(item) {
    return item?.graph && Array.isArray(item.inputs) ? [COMMAND] : [];
  },
  setup() {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = new URL("./node_colors.css", import.meta.url).href;
    document.head.append(css);
    // This frontend version leaves extension command button labels empty.
    function labelButton() {
      const button = document.querySelector("button:has(.terryxu-palette-icon)");
      if (button) {
        button.setAttribute("aria-label", "增强配色");
        button.title = "增强配色";
      }
    }
    new MutationObserver(labelButton).observe(document.body, { childList: true, subtree: true });
    labelButton();
  },
  getNodeMenuItems(node) {
    return [{ content: "TerryXu · 增强配色", callback: () => openColorPanel(node) }];
  },
});
