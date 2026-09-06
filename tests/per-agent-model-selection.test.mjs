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

test("resolution picks main, per-subagent-type, subagent default, and runner fallback in order", async () => {
  const { reasoningEffortFromSelection } = await loadAgentModel();
  // Mirrors turn-run-shell exactly: main -> agentDefaultModel; a subagent -> its type's selection,
  // then the subagent default, then the runner's global default. Reasoning rides the effort param.
  const resolve = (isSubagentRunner, subagentType, store, fallbackModelId) => {
    const selection = isSubagentRunner
      ? ((subagentType != null && subagentType.length > 0 ? store.agentModelsBySubagentType?.[subagentType] : undefined)
        ?? store.subagentDefaultModel)
      : store.agentDefaultModel;
    const modelId = selection?.modelId ?? fallbackModelId;
    const effort = reasoningEffortFromSelection(selection);
    const reasoning = ["minimal", "low", "medium", "high", "xhigh", "max"].includes(effort) ? effort : undefined;
    return { modelId, reasoning };
  };
  const executorSelection = { modelId: "gpt-5.6-sol", maxMode: true, parameters: [{ id: "effort", value: "xhigh" }] };
  const store = { agentDefaultModel: mainSelection, subagentDefaultModel: subagentSelection, agentModelsBySubagentType: { executor: executorSelection } };
  // main
  assert.deepEqual(resolve(false, undefined, store, "gpt-5.5"), { modelId: "gpt-5.5", reasoning: "high" });
  // subagent of a configured type -> that type's selection wins over the subagent default
  assert.deepEqual(resolve(true, "executor", store, "gpt-5.5"), { modelId: "gpt-5.6-sol", reasoning: "xhigh" });
  // subagent of an unconfigured type -> subagent default
  assert.deepEqual(resolve(true, "video-review", store, "gpt-5.5"), { modelId: "gpt-5.4", reasoning: "medium" });
  // subagent with no type -> subagent default
  assert.deepEqual(resolve(true, undefined, store, "gpt-5.5"), { modelId: "gpt-5.4", reasoning: "medium" });
  // no subagent selections at all -> runner's global default model; reasoning undefined so the
  // executor fills it from the global high default.
  assert.deepEqual(resolve(true, "executor", { agentDefaultModel: mainSelection }, "gpt-5.5"), { modelId: "gpt-5.5", reasoning: undefined });
});

test("the local resolver mirror above matches the production resolution text (AUDIT-F3)", async () => {
  // The mirror is only valid while production keeps this exact resolution order;
  // pin the source so drift fails here instead of leaving a false-green mirror.
  const { readFile } = await import("node:fs/promises");
  const shell = await readFile(new URL("../source/host/runner/turn-run-shell.ts", import.meta.url), "utf8");
  assert.match(shell, /input\.isSubagentRunner\s*\?\s*\(input\.subagentType != null && input\.subagentType\.length > 0\s*\?\s*settingsStore\.getAgentModelForSubagentType\(input\.subagentType\)\s*:\s*undefined\)\s*\?\? settingsStore\.getSubagentDefaultModel\(\)/);
  assert.match(shell, /: settingsStore\.getAgentModelForAgentId\(input\.conversationId\) \?\? settingsStore\.getAgentDefaultModel\(\);/);
  assert.match(shell, /const resolvedModelId = agentSelection\?\.modelId \?\? input\.modelId;/);
});
