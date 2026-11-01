export const STORAGE_KEY = "TerryXu.NodeColors.favorites.v1";

export function normalizeHex(value) {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) hex = [...hex].map(c => c + c).join("");
  return /^[0-9a-f]{6}$/i.test(hex) ? `#${hex.toUpperCase()}` : null;
}

export function contrast(a, b = "#DDDDDD") {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(c => parseInt(c, 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function hsl(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const channel = n => {
    const k = (n + h / 30) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))))
      .toString(16).padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`.toUpperCase();
}

function readableShade(h, s, l) {
  let hex = hsl(h, s, l);
  while (contrast(hex) < 4.5 && l > 0.05) {
    l -= 0.01;
    hex = hsl(h, s, l);
  }
  return hex;
}

const hues = [["朱红", 4], ["珊瑚", 18], ["琥珀", 38], ["金黄", 52],
  ["青柠", 82], ["翠绿", 142], ["松石", 170], ["湖蓝", 192],
  ["湛蓝", 216], ["靛紫", 250], ["兰紫", 280], ["玫红", 326]];

export const PRESETS = [
  { name: "鲜明", colors: hues.map(([name, hue]) => ({ name,
    color: readableShade(hue, 0.82, 0.42), bgcolor: readableShade(hue, 0.68, 0.28) })) },
  { name: "柔和", colors: hues.map(([name, hue]) => ({ name,
    color: readableShade(hue, 0.48, 0.40), bgcolor: readableShade(hue, 0.34, 0.28) })) },
  { name: "深色", colors: hues.map(([name, hue]) => ({ name,
    color: readableShade(hue, 0.76, 0.28), bgcolor: readableShade(hue, 0.54, 0.17) })) },
];

export function readFavorites(storage) {
  try {
    const data = JSON.parse(storage.getItem(STORAGE_KEY) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter(p => p && normalizeHex(p.color) && normalizeHex(p.bgcolor))
      .slice(0, 48).map(p => ({ name: String(p.name || "自定义").slice(0, 40),
        color: normalizeHex(p.color), bgcolor: normalizeHex(p.bgcolor) }));
  } catch { return []; }
}

export function selectedNodes(canvas, anchor) {
  const graph = anchor?.graph ?? canvas.graph;
  const selected = Object.values(canvas.selected_nodes ?? {}).filter(n => n.graph === graph);
  return selected.includes(anchor) ? selected : [anchor];
}

export function applyColors(nodes, palette, canvas) {
  const targets = nodes.filter(n => n.graph && n.graph === canvas.graph);
  if (!targets.length) return false;
  const graph = targets[0].graph;
  graph.beforeChange();
  try {
    for (const node of targets) {
      if (palette) {
        node.color = palette.color;
        node.bgcolor = palette.bgcolor;
      } else {
        delete node.color;
        delete node.bgcolor;
      }
    }
  } finally { graph.afterChange(); }
  canvas.setDirty(true, true);
  return true;
}
