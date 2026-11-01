export const MEDIA_KINDS = ["image", "audio", "video"];
export const MEDIA_LABELS = { image: "图片", audio: "音频", video: "视频" };
export const MEDIA_TYPES = { image: "IMAGE", audio: "AUDIO", video: "VIDEO" };

export function readMedia(value) {
  const data = typeof value === "string" ? JSON.parse(value) : value;
  return Object.fromEntries(MEDIA_KINDS.map(kind => [kind, Array.isArray(data?.[kind]) ? data[kind] : []]));
}

export function mediaFile(file, kind, id) {
  let path = String(file.path || file.filename || file.name || "").replaceAll("\\", "/");
  let source = file.source || file.type || "input";
  const annotation = path.match(/ \[(input|output|temp)\]$/);
  if (annotation) { source = annotation[1]; path = path.slice(0, annotation.index); }
  if (file.subfolder && !path.includes("/")) path = `${file.subfolder}/${path}`;
  if (!path || !["input", "output", "temp"].includes(source)) throw Error("资产路径无效");
  return { id, kind, path, source, name: path.split("/").at(-1) };
}

export function moveMedia(groups, kind, id, targetId, after = false) {
  const group = groups[kind];
  const from = group.findIndex(asset => asset.id === id);
  if (from < 0 || id === targetId) return groups;
  const next = group.filter(asset => asset.id !== id);
  const to = targetId == null ? next.length : next.findIndex(asset => asset.id === targetId);
  if (to < 0) return groups;
  next.splice(to + (after && targetId != null ? 1 : 0), 0, group[from]);
  return { ...groups, [kind]: next };
}

export function mediaLanes(node, groups) {
  return MEDIA_KINDS.flatMap(kind => groups[kind].map((asset, index) => {
    const name = `${MEDIA_LABELS[kind]} ${index + 1}`;
    const lane = { id: asset.id, type: MEDIA_TYPES[kind], name };
    return { laneId: asset.id, lane, name, type: lane.type,
      source: { node, nodeId: node.id, slot: 0, type: lane.type, name, assetId: asset.id } };
  }));
}

export function mediaExecutionSource(prompt, source, sourceId) {
  if (!source?.assetId || !prompt[sourceId]) return null;
  const id = `${sourceId}:media:${source.assetId}`;
  prompt[id] = { class_type: "TerryXuMediaBusItem",
    inputs: { bus: [String(sourceId), 0], asset_id: source.assetId } };
  return [id, 0];
}
