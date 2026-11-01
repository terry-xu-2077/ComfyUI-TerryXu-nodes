import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { percent, memoryText, memoryPercent, trendPath, smoothTrend, TrendHistory, mergeSnapshots } from "./performance_model.mjs";

// Hierarchy: large live trend first; four compact readings second; hardware metadata third.
// Native theme, 8/12px spacing, 12px radius; each reading keys its matching trace.
const POSITION_KEY = "TerryXu.Performance.position.v1";
const SVG = "http://www.w3.org/2000/svg";
const SERIES = [["cpu", "CPU"], ["ram", "内存"], ["gpu", "GPU"], ["vram", "显存"]];
let panel, toggle, stream, selectedGpu = "";
let snapshots = [];
const history = new TrendHistory();
let ui;

function el(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function makeButton(label, text, action) {
  const button = el("button", "", text);
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.onclick = action;
  return button;
}

function setPosition(x, y) {
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
  panel.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
}

function createPanel() {
  panel = el("section", "tx-monitor");
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "TerryXu 性能监控");
  const header = el("header", "tx-monitor-header");
  const heading = el("div", "tx-monitor-heading");
  heading.append(el("span", "tx-monitor-brand", "TerryXu"), el("strong", "", "性能监控"));
  const actions = el("div", "tx-monitor-actions");
  const connection = el("span", "tx-monitor-connection");
  connection.setAttribute("role", "status");
  connection.setAttribute("aria-label", "连接中");
  connection.title = "连接中";
  actions.append(connection, makeButton("关闭性能监控", "×", closeMonitor));
  header.append(heading, actions);
  const deviceRow = el("div", "tx-monitor-device");
  const gpuSelect = el("select");
  gpuSelect.setAttribute("aria-label", "监控显卡");
  gpuSelect.onchange = () => {
    selectedGpu = gpuSelect.value;
    refreshHistory();
  };
  const temperature = el("span", "tx-monitor-temp", "— °C");
  temperature.title = "GPU 温度";
  deviceRow.append(gpuSelect, temperature);
  const metrics = el("div", "tx-monitor-metrics");
  const cards = {};
  for (const [key, label] of SERIES) {
    const card = el("div", `tx-monitor-metric tx-series-${key}`);
    const top = el("div", "tx-monitor-metric-top");
    const value = el("strong", "", "—");
    const labelEl = el("span", "", label);
    top.append(labelEl, value);
    const track = el("div", "tx-monitor-track");
    track.setAttribute("role", "meter");
    track.setAttribute("aria-label", label + "占用率");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    const fill = el("span");
    track.append(fill);
    card.append(top, track);
    metrics.append(card);
    cards[key] = { card, value, fill, track };
  }
  const chart = el("div", "tx-monitor-chart");
  chart.title = "趋势曲线已降噪，保留明显波峰；上方数值仍为原始实时读数";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 288 128");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "CPU、内存、GPU、显存占用趋势，纵轴 0 至 100% ");
  for (const y of [1, 64, 127]) {
    const line = document.createElementNS(SVG, "path");
    line.setAttribute("d", `M0,${y} H288`);
    line.setAttribute("class", "tx-monitor-gridline");
    svg.append(line);
  }
  const paths = {};
  for (const [key] of SERIES) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("class", `tx-monitor-trace tx-series-${key}`);
    svg.append(path);
    paths[key] = path;
  }
  const scale = el("div", "tx-monitor-scale");
  const scaleLabels = [el("span", "", "100%"), el("span", "", "50%"), el("span", "", "0%")];
  scale.append(...scaleLabels);
  const timeAxis = el("div", "tx-monitor-time");
  const range = el("span", "", "2 分钟前");
  const axisMode = el("span", "", "现在");
  axisMode.title = "横轴固定为最近 2 分钟，纵轴固定为 0–100%；后台持续监控";
  timeAxis.append(range, axisMode);
  chart.append(svg, scale);
  panel.append(header, deviceRow, metrics, chart, timeAxis);
  document.body.append(panel);
  ui = { cards, gpuSelect, temperature, paths, connection };
  let drag;
  header.onpointerdown = event => {
    if (event.button !== 0 || event.target.closest("button")) return;
    const rect = panel.getBoundingClientRect();
    drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    header.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  header.onpointermove = event => { if (drag) setPosition(event.clientX - drag.x, event.clientY - drag.y); };
  header.onpointerup = () => {
    if (!drag) return;
    drag = null;
    try { localStorage.setItem(POSITION_KEY, JSON.stringify({ x: panel.offsetLeft, y: panel.offsetTop })); } catch {}
  };
  header.onlostpointercapture = () => { drag = null; };
  panel.addEventListener("keydown", event => {
    event.stopPropagation();
    if (event.key === "Escape") closeMonitor();
  });
  window.addEventListener("resize", () => { if (!panel.hidden) setPosition(panel.offsetLeft, panel.offsetTop); });
}

function renderMetrics(data) {
  const gpus = data.gpus || [];
  if (!gpus.some(g => g.index === selectedGpu)) selectedGpu = gpus[0]?.index ?? "";
  const options = gpus.length ? gpus : [{ index: "", name: "GPU 数据不可用" }];
  const signature = JSON.stringify(options.map(g => [g.index, g.name]));
  if (ui.gpuSelect.dataset.devices !== signature) {
    ui.gpuSelect.replaceChildren(...options.map(g => { const option = el("option", "", g.name); option.value = g.index; return option; }));
    ui.gpuSelect.dataset.devices = signature;
  }
  ui.gpuSelect.value = selectedGpu;
  ui.gpuSelect.disabled = gpus.length < 2;
  ui.gpuSelect.title = gpus.find(g => g.index === selectedGpu)?.name || "未检测到支持的 GPU 监控接口";
  const gpu = gpus.find(g => g.index === selectedGpu);
  const temp = gpu?.temperature;
  ui.temperature.textContent = Number.isFinite(temp) ? `${Math.round(temp)} °C` : "— °C";
  ui.temperature.classList.toggle("is-hot", temp >= 80);
  const values = { cpu: percent(data.cpu?.usage), ram: percent(data.memory?.usage), gpu: percent(gpu?.usage), vram: memoryPercent(gpu?.memory_used, gpu?.memory_total) };
  const details = {
    cpu: `${data.cpu?.threads ?? "—"} 线程 · ${data.cpu?.name || "CPU"}`,
    ram: memoryText(data.memory?.used, data.memory?.total),
    gpu: "计算引擎利用率", vram: memoryText(gpu?.memory_used, gpu?.memory_total),
  };
  for (const [key] of SERIES) {
    const card = ui.cards[key], value = values[key];
    card.value.textContent = value === null ? "—" : `${Math.round(value)}%`;
    card.fill.style.width = `${value ?? 0}%`;
    if (value === null) card.track.removeAttribute("aria-valuenow");
    else card.track.setAttribute("aria-valuenow", String(value));
    card.track.setAttribute("aria-valuetext", value === null ? "数据不可用" : `${Math.round(value)}%`);
    card.card.title = value === null ? "数据不可用" : details[key];
  }
  setConnection("实时 · 后台持续监控 · 每 2 秒更新", "live");
}

function renderChart() {
  const times = history.samples.map(s => s.time);
  for (const [key] of SERIES) {
    const values = history.samples.map(s => s.values?.[key] ?? null);
    ui.paths[key].setAttribute("d", trendPath(smoothTrend(values), { times }));
  }
}

function setConnection(message, state) {
  ui.connection.dataset.state = state;
  ui.connection.title = message;
  ui.connection.setAttribute("aria-label", message);
}

function refreshHistory() {
  const latest = snapshots.at(-1);
  if (!latest || panel.hidden || document.hidden) return;
  renderMetrics(latest);
  history.clear();
  for (const data of snapshots) {
    const gpu = data.gpus?.find(g => g.index === selectedGpu);
    history.append({
      cpu: percent(data.cpu?.usage), ram: percent(data.memory?.usage),
      gpu: percent(gpu?.usage), vram: memoryPercent(gpu?.memory_used, gpu?.memory_total),
    }, data.timestamp * 1000);
  }
  renderChart();
}

function connectStream() {
  stream?.close();
  const source = new EventSource(api.apiURL("/terryxu/performance/stream"), { withCredentials: true });
  stream = source;
  source.onmessage = event => {
    if (source !== stream || panel.hidden) return;
    let packet;
    try { packet = JSON.parse(event.data); }
    catch { setConnection("监控数据读取失败", "offline"); return; }
    if (packet.error) { setConnection(packet.error, "offline"); return; }
    snapshots = mergeSnapshots(snapshots, packet.samples || []);
    refreshHistory();
  };
  source.onerror = () => {
    if (source === stream && !panel.hidden) setConnection("监控连接中断 · 正在重连", "offline");
  };
}

function closeMonitor() {
  panel.hidden = true;
  toggle.setAttribute("aria-pressed", "false");
  stream?.close();
  stream = null;
}

function toggleMonitor() {
  if (!panel) createPanel();
  if (!panel.hidden) { closeMonitor(); return; }
  panel.hidden = false;
  renderChart();
  toggle.setAttribute("aria-pressed", "true");
  let position;
  try { position = JSON.parse(localStorage.getItem(POSITION_KEY)); } catch {}
  const anchor = toggle.getBoundingClientRect();
  setPosition(Number.isFinite(position?.x) ? position.x : anchor.left,
    Number.isFinite(position?.y) ? position.y : anchor.bottom + 12);
  refreshHistory();
  connectStream();
}

app.registerExtension({
  name: "TerryXu.PerformanceMonitor",
  setup() {
    const css = el("link");
    css.rel = "stylesheet";
    css.href = new URL("./performance_monitor.css", import.meta.url).href;
    document.head.append(css);
    toggle = makeButton("TerryXu 性能监控", "", toggleMonitor);
    toggle.className = "tx-monitor-toggle";
    toggle.setAttribute("aria-pressed", "false");
    const icon = document.createElementNS(SVG, "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const line = document.createElementNS(SVG, "path");
    line.setAttribute("d", "M3 12h4l3-7 4 14 3-7h4M3 4v16h18");
    icon.append(line); toggle.append(icon);
    function mount() {
      const parent = app.menu?.settingsGroup?.element?.parentElement;
      if (parent && toggle.parentElement !== parent) parent.prepend(toggle);
    }
    new MutationObserver(mount).observe(document.body, { childList: true, subtree: true });
    mount();
    document.addEventListener("visibilitychange", () => {
      if (panel && !panel.hidden && !document.hidden) refreshHistory();
    });
    api.addEventListener("reconnecting", () => {
      if (ui && !panel.hidden) setConnection("与 ComfyUI 的连接已断开", "offline");
    });
  },
});
