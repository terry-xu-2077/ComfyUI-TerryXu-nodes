import { app } from "../../scripts/app.js";

const MINIMAX_H3_TYPE = "MiniMaxH3ReferenceToVideo";
const OPTIONAL_REFERENCE_INPUT = /^(?:ref_image|ref_video|ref_video_audio|ref_audio)_\d+$/i;

function hasPromptNode(prompt, id) {
  if (id == null || id === "") return false;
  return Object.prototype.hasOwnProperty.call(prompt, String(id));
}

function sanitizeMiniMaxH3References(prompt) {
  if (!prompt || typeof prompt !== "object") return;

  for (const [executionId, promptNode] of Object.entries(prompt)) {
    if (String(promptNode?.class_type || "") !== MINIMAX_H3_TYPE) continue;
    const inputs = promptNode?.inputs;
    if (!inputs || typeof inputs !== "object") continue;

    for (const [name, value] of Object.entries(inputs)) {
      if (!OPTIONAL_REFERENCE_INPUT.test(String(name))) continue;
      if (!Array.isArray(value) || value.length < 1) continue;

      const sourceId = value[0];
      if (hasPromptNode(prompt, sourceId)) continue;

      // ComfyUI removes bypassed/muted source nodes from the execution prompt.
      // Wire Bus expands virtual connections after graphToPrompt(), so never
      // leave an optional MiniMax H3 reference pointing at a source that the
      // execution graph no longer contains. Omitting the optional Autogrow
      // input matches native MiniMax H3 semantics for a skipped reference.
      delete inputs[name];
      console.debug(
        `[TerryXu Wire Bus] Omitted inactive MiniMax H3 reference ${name} on ${executionId}; source ${String(sourceId)} is not in the execution prompt.`
      );
    }
  }
}

function patchGraphToPrompt() {
  const current = app.graphToPrompt;
  if (typeof current !== "function" || current.__terryWireBusMiniMaxH3BypassGuard) return;

  const wrapped = async function (...args) {
    const result = await current.apply(this, args);
    sanitizeMiniMaxH3References(result?.output);
    return result;
  };
  wrapped.__terryWireBusMiniMaxH3BypassGuard = true;
  app.graphToPrompt = wrapped;
}

app.registerExtension({
  name: "TerryXu.WireBusMiniMaxH3BypassGuard",
  setup() {
    patchGraphToPrompt();
    queueMicrotask(patchGraphToPrompt);
    setTimeout(patchGraphToPrompt, 0);
  },
  afterConfigureGraph() {
    patchGraphToPrompt();
  },
});
