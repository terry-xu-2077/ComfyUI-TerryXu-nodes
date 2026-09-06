import { app } from "../../scripts/app.js";

const VIDEO_EXT = /\.(?:mp4|mkv|webm|mov|m4v|avi)$/i;

function previewFiles(message) {
  return Array.isArray(message?.images) ? message.images.filter((item) => item?.filename) : [];
}

function isNativeVideo(message) {
  const files = previewFiles(message);
  const animated = Array.isArray(message?.animated) ? message.animated.some(Boolean) : Boolean(message?.animated);
  return animated || files.some((file) => VIDEO_EXT.test(String(file.filename || "")));
}

function filenameFromVideo(video) {
  try {
    return new URL(video.currentSrc || video.src, location.href).searchParams.get("filename") || "";
  } catch {
    return "";
  }
}

function findVideo(message) {
  const names = new Set(previewFiles(message).map((file) => String(file.filename || "")));
  const videos = [...document.querySelectorAll(".video-preview video, video")];
  const exact = videos.find((video) => names.has(filenameFromVideo(video)));
  if (exact) return exact;
  return videos.length === 1 ? videos[0] : null;
}

function compactPanel(node) {
  const panel = node?.__terryFileSavePanel;
  if (!panel?.root || !panel?.dom) return;

  const root = panel.root;
  root.style.height = "auto";
  root.style.minHeight = "0";
  root.style.flex = "0 0 auto";
  root.style.alignSelf = "stretch";

  const parent = root.parentElement;
  if (parent) {
    parent.style.height = "auto";
    parent.style.minHeight = "0";
    parent.style.alignSelf = "stretch";
  }

  const applyMeasuredHeight = () => {
    const height = Math.max(1, Math.ceil(root.scrollHeight));
    panel.dom.options ||= {};
    panel.dom.options.getMinHeight = () => height;
    panel.dom.options.getMaxHeight = () => height;
    panel.dom.options.getHeight = () => height;
  };

  applyMeasuredHeight();
  requestAnimationFrame(applyMeasuredHeight);
}

function fitVideo(video) {
  if (!(video instanceof HTMLVideoElement)) return false;
  const root = video.closest(".video-preview");
  const wrapper = video.parentElement;
  if (!root || !wrapper) return false;

  const apply = () => {
    const width = Number(video.videoWidth) || 16;
    const height = Number(video.videoHeight) || 9;
    const ratio = `${width} / ${height}`;

    root.style.setProperty("height", "auto", "important");
    root.style.setProperty("min-height", "0", "important");
    root.style.setProperty("width", "100%", "important");
    root.style.setProperty("align-self", "center", "important");
    root.style.setProperty("justify-content", "center", "important");

    wrapper.style.setProperty("flex", "0 0 auto", "important");
    wrapper.style.setProperty("width", "100%", "important");
    wrapper.style.setProperty("height", "auto", "important");
    wrapper.style.setProperty("aspect-ratio", ratio, "important");
    wrapper.style.setProperty("align-self", "center", "important");
    wrapper.style.setProperty("max-width", "100%", "important");

    video.style.setProperty("width", "100%", "important");
    video.style.setProperty("height", "100%", "important");
    video.style.setProperty("max-width", "100%", "important");
    video.style.setProperty("max-height", "100%", "important");
    video.style.setProperty("object-fit", "contain", "important");
    video.style.setProperty("object-position", "center center", "important");
  };

  apply();
  if (!video.videoWidth || !video.videoHeight) video.addEventListener("loadedmetadata", apply, { once: true });
  return true;
}

function relayoutNode(node) {
  const run = () => {
    try {
      const measured = node.computeSize?.();
      if (measured?.length >= 2) {
        const width = Number(node.size?.[0]) || Number(measured[0]) || 0;
        const height = Number(measured[1]) || Number(node.size?.[1]) || 0;
        if (width > 0 && height > 0) node.setSize?.([width, height]);
      }
    } catch {}
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  };
  queueMicrotask(run);
  requestAnimationFrame(() => requestAnimationFrame(run));
  setTimeout(run, 80);
  setTimeout(run, 200);
}

export function optimizeFileSaveNativePreview(node, message) {
  if (!node || !isNativeVideo(message)) return;
  compactPanel(node);

  const tryFit = () => {
    const video = findVideo(message);
    if (video) fitVideo(video);
    compactPanel(node);
    relayoutNode(node);
  };

  queueMicrotask(tryFit);
  requestAnimationFrame(tryFit);
  setTimeout(tryFit, 60);
  setTimeout(tryFit, 180);
  setTimeout(tryFit, 400);
}
