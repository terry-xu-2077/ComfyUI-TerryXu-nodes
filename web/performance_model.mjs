export function percent(value) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

export function memoryText(used, total) {
  if (!Number.isFinite(used) || !Number.isFinite(total) || total <= 0) return "不可用";
  const gb = 1024 ** 3;
  return `${(used / gb).toFixed(1)} / ${(total / gb).toFixed(1)} GB`;
}

export function memoryPercent(used, total) {
  return typeof used === "number" && typeof total === "number" && total > 0 ? percent(used / total * 100) : null;
}

export class TrendHistory {
  constructor(limit = 60) {
    this.limit = limit;
    this.samples = [];
  }

  clear() { this.samples = []; }

  append(values, time = Date.now()) {
    const last = this.samples.at(-1);
    if (last && time - last.time > 7000) {
      this.samples.push({ time: (last.time + time) / 2, values: null });
    }
    this.samples.push({ time, values });
    this.samples = this.samples.slice(-this.limit);
  }

}

export function mergeSnapshots(previous, incoming, limit = 60) {
  const samples = new Map();
  for (const sample of [...previous, ...incoming]) {
    if (sample && Number.isFinite(sample.timestamp)) samples.set(sample.timestamp, sample);
  }
  return [...samples.values()].sort((a, b) => a.timestamp - b.timestamp).slice(-limit);
}

export const TREND_WINDOW_MS = 120_000;

export function smoothTrend(values) {
  const samples = values.map(percent);
  return samples.map((value, index) => {
    const previous = samples[index - 1], next = samples[index + 1];
    if (value === null || previous == null || next == null) return value;
    // Leave meaningful peaks and rapid load transitions at their measured values.
    const extremum = (value > previous && value > next) || (value < previous && value < next);
    if ((extremum && Math.min(Math.abs(value - previous), Math.abs(value - next)) >= 12)
      || Math.abs(next - previous) >= 12) return value;
    return (previous + value * 2 + next) / 4;
  });
}

// Monotone cubic curves pass through every sample without creating higher peaks.
function curveSegment(points) {
  if (!points.length) return "";
  const format = point => point.map(v => v.toFixed(1)).join(",");
  let path = `M${format(points[0])}`;
  if (points.length === 1) return path;
  const widths = points.slice(1).map((p, i) => p[0] - points[i][0]);
  const slopes = points.slice(1).map((p, i) => (p[1] - points[i][1]) / widths[i]);
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === points.length - 1) return slopes.at(-1);
    const before = slopes[i - 1], after = slopes[i];
    if (before * after <= 0) return 0;
    const a = 2 * widths[i] + widths[i - 1], b = widths[i] + 2 * widths[i - 1];
    return (a + b) / (a / before + b / after);
  });
  slopes.forEach((slope, i) => {
    if (slope === 0) { tangents[i] = 0; tangents[i + 1] = 0; return; }
    const size = Math.hypot(tangents[i] / slope, tangents[i + 1] / slope);
    if (size > 3) { tangents[i] *= 3 / size; tangents[i + 1] *= 3 / size; }
  });
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1], [x1, y1] = points[i];
    const third = widths[i - 1] / 3;
    path += ` C${format([x0 + third, y0 + tangents[i - 1] * third])} ${format([x1 - third, y1 - tangents[i] * third])} ${format(points[i])}`;
  }
  return path;
}

export function trendPath(values, { width = 288, height = 128, times = [] } = {}) {
  const end = times.length ? times.at(-1) : (values.length - 1) * 2000;
  const segments = [];
  let points = [];
  values.forEach((value, index) => {
    const normalized = percent(value);
    if (normalized === null) {
      if (points.length) segments.push(curveSegment(points));
      points = [];
      return;
    }
    const time = times.length ? times[index] : index * 2000;
    points.push([width - (end - time) / TREND_WINDOW_MS * width,
      height - normalized / 100 * (height - 2) - 1]);
  });
  if (points.length) segments.push(curveSegment(points));
  return segments.join(" ");
}
