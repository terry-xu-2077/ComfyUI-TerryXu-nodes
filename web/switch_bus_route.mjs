// Shared route selection for real executable switch nodes.
// Bus resolvers use this to follow the selected virtual source without
// requiring ComfyUI to execute the switch to inspect its BUS payload.
export const LINE_SWITCH_TYPE = "TerryXuLineSwitch";
export const BOOL_SWITCH_TYPE = "TerryXuBoolSwitch";

export function isTerrySwitch(node) {
  const type = String(node?.comfyClass || node?.type || node?.constructor?.comfyClass
    || node?.constructor?.type || node?.constructor?.nodeData?.name || "");
  return type === LINE_SWITCH_TYPE || type === BOOL_SWITCH_TYPE;
}

function widgetValue(node, name) {
  return node?.widgets?.find(item => item?.name === name)?.value;
}

function routeNumber(name) {
  const match = String(name || "").match(/(?:^|\.)route_(\d+)$/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

export function selectedSwitchInput(node) {
  const type = String(node?.comfyClass || node?.type || node?.constructor?.comfyClass
    || node?.constructor?.type || node?.constructor?.nodeData?.name || "");
  if (type === BOOL_SWITCH_TYPE) {
    const linked = node?.inputs?.some(input => input?.name === "enabled" && input?.link != null);
    const value = linked
      ? node?.__terryRuntimeBool ?? node?.properties?.terry_bool_switch_state ?? widgetValue(node, "enabled")
      : widgetValue(node, "enabled") ?? node?.properties?.terry_bool_switch_state;
    return node?.inputs?.find(input => input?.name === (value ? "input_true" : "input_false")) || null;
  }
  if (type === LINE_SWITCH_TYPE) {
    const routes = (node?.inputs || []).filter(input =>
      /^(?:routes\.)?route_\d+$/.test(String(input?.name || "")));
    routes.sort((a, b) => routeNumber(a.name) - routeNumber(b.name));
    const linked = node?.inputs?.some(input => input?.name === "index" && input?.link != null);
    const raw = linked
      ? node?.__terryRuntimeIndex ?? node?.properties?.terry_line_switch_index ?? widgetValue(node, "index")
      : widgetValue(node, "index") ?? node?.properties?.terry_line_switch_index;
    const index = Number.parseInt(raw, 10);
    return routes[Math.max(0, Math.min((Number.isFinite(index) ? index : 1) - 1, routes.length - 1))] || null;
  }
  return null;
}
