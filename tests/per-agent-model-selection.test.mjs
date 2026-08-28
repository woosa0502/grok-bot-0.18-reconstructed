import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { transform } from "esbuild";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Load the real (pure, dependency-free) shared model helper by compiling the TS source in-process,
// the same esbuild+data-URL pattern the projection test uses. This exercises the actual
// reasoningEffortFromSelection the host calls, not a copy.
async function loadAgentModel() {
  const source = await readFile(path.join(repoRoot, "source/shared/agents/sand-agent-model.ts"), "utf8");
  const { code } = await transform(source, { format: "esm", loader: "ts", target: "es2022" });
  return await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const mainSelection = { modelId: "gpt-5.5", maxMode: true, parameters: [{ id: "effort", value: "high" }, { id: "fast", value: "true" }] };
const subagentSelection = { modelId: "gpt-5.4", maxMode: true, parameters: [{ id: "effort", value: "medium" }] };
const noEffortSelection = { modelId: "gpt-5.5", maxMode: true, parameters: [] };

test("reasoning effort is read from a model selection's effort parameter", async () => {
  const { reasoningEffortFromSelection } = await loadAgentModel();
  assert.equal(reasoningEffortFromSelection(mainSelection), "high");
  assert.equal(reasoningEffortFromSelection(subagentSelection), "medium");
  assert.equal(reasoningEffortFromSelection(noEffortSelection), undefined);
  assert.equal(reasoningEffortFromSelection(undefined), undefined);
});

test("the shipped computer-use selection carries the cheap effort=low it is meant to run at", async () => {
  const { SAND_COMPUTER_USE_MODEL_SELECTION, reasoningEffortFromSelection } = await loadAgentModel();
  assert.equal(reasoningEffortFromSelection(SAND_COMPUTER_USE_MODEL_SELECTION), "low");
});

test("per-role resolution picks main vs subagent selection and falls back to the runner default", async () => {
  const { reasoningEffortFromSelection } = await loadAgentModel();
  // Mirrors turn-run-shell: input.isSubagentRunner selects which stored selection applies; the
  // resolved model id / reasoning fall back to the runner default when a role has no selection.
  const resolve = (isSubagentRunner, store, fallbackModelId) => {
    const selection = isSubagentRunner ? store.subagentDefaultModel : store.agentDefaultModel;
    const modelId = selection?.modelId ?? fallbackModelId;
    const effort = reasoningEffortFromSelection(selection);
    const reasoning = ["minimal", "low", "medium", "high", "xhigh"].includes(effort) ? effort : undefined;
    return { modelId, reasoning };
  };
  const store = { agentDefaultModel: mainSelection, subagentDefaultModel: subagentSelection };
  assert.deepEqual(resolve(false, store, "gpt-5.5"), { modelId: "gpt-5.5", reasoning: "high" });
  assert.deepEqual(resolve(true, store, "gpt-5.5"), { modelId: "gpt-5.4", reasoning: "medium" });
  // No subagent selection -> falls back to the runner's global default model; reasoning undefined so
  // the executor fills it from the global high default.
  assert.deepEqual(resolve(true, { agentDefaultModel: mainSelection }, "gpt-5.5"), { modelId: "gpt-5.5", reasoning: undefined });
});
