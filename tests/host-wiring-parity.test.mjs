// Production-wiring guards for 0.18 parity fixes in the host composition.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("system-prompt context receives the real memory stores and the shared roster providers", () => {
  const source = read("source/host/host-runner-composition.ts");
  assert.doesNotMatch(source, /memoryStore: \(\) => null/);
  assert.doesNotMatch(source, /memorySnapshots: \(\) => null/);
  assert.doesNotMatch(source, /userMemory: \(\) => null/);
  assert.doesNotMatch(source, /projectMemory: \(\) => null/);
  assert.doesNotMatch(source, /agentDirectory: \(\) => \[\]/);
  assert.doesNotMatch(source, /agentGroups: \(\) => \[\]/);
  assert.match(source, /memoryStore: \(\) => \(session\.memory as MemoryPromptStore \| undefined\) \?\? null/);
  assert.match(source, /userMemory: promptUserMemoryProvider/);
  assert.match(source, /projectMemory: promptProjectMemoryProvider/);
  assert.equal((source.match(/agentDirectory: agentDirectoryProvider/g) ?? []).length, 2, "both prompt-context and runnerOptions use the shared provider");
  assert.match(source, /createRosterToolInputs: \(\) => \(\{\s*dependencies: \{ listAgents: agentDirectoryProvider, listGroups: agentGroupsProvider \}/);
  const memoryExtension = read("source/host/extensions/memory/extension.ts");
  assert.match(memoryExtension, /createUserMemory:\(options:PromptUserMemoryOptions\)=>createPromptUserMemory/);
  assert.match(memoryExtension, /createProjectMemory:\(options:PromptProjectMemoryOptions\)=>createPromptProjectMemory/);
});

test("roster summaries carry group membership from group.json", () => {
  const roster = read("source/host/extensions/session/session-roster.ts");
  assert.match(roster, /function groupSummaryFields\(dbPath:string\)/);
  assert.equal((roster.match(/\.\.\.groupSummaryFields\(dbPath\)/g) ?? []).length, 3);
});

test("ListAgents / ListGroups tools exist and are registered in the turn toolset", () => {
  const tools = read("source/host/runner/tools/sand-agent-management-tools.ts");
  assert.match(tools, /export function createListAgentsTool\(roster: AgentRosterDependencies\)/);
  assert.match(tools, /export function createListGroupsTool\(roster: AgentRosterDependencies\)/);
  const messaging = read("source/host/agents/agent-messaging.ts");
  assert.match(messaging, /SAND_LIST_AGENTS_TOOL_NAME = "ListAgents"/);
  assert.match(messaging, /SAND_LIST_GROUPS_TOOL_NAME = "ListGroups"/);
  const toolset = read("source/host/runner/tools/turn-toolset.ts");
  assert.match(toolset, /listAgents: createTurnListAgentsToolFactory\(input\.roster\)/);
  assert.match(toolset, /roster: provider\.createRosterToolInputs\(turn, props\)/);
  assert.match(toolset, /const listGroups = factories\.listGroups\?\.\(\);\s*if \(listGroups !== undefined\) tools\.push\(listGroups\);/);
});

test("local Codex mode hides Cursor cloud agents and image generation honestly", () => {
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /const cloudAgent = \(\(\) => \{[\s\S]{0,400}if \(isLocalCodexMode\(process\.env\)\) return undefined;/);
  assert.match(composition, /isLocalCodexMode: \(\) => isLocalCodexMode\(process\.env\)/);
  const experiments = read("source/host/extensions/experiments/extension.ts");
  assert.match(experiments, /isCloudAgentsDisabledByTeam: \(\) => isLocalCodexMode\(process\.env\)/);
  const prompt = read("source/host/runner/system-prompt.ts");
  assert.match(prompt, /export const SAND_SYSTEM_PROMPT_LOCAL_CODEX = buildSandBaseSystemPrompt\(\{\s*cloudAgentsEnabled: false,\s*imageGenerationEnabled: false,\s*sharedLocalDesktop: true,\s*localCodexMode: true\s*\}\)/);
  // AUDIT-W17: the local build has ONE shared desktop; the local prompt must not
  // claim per-agent screens, while the cloud prompt keeps the per-agent wording.
  assert.match(prompt, /in this local build the desktop is shared too/);
  assert.match(prompt, /Image generation is not available in this setup: there is no GenerateImage tool/);
  const assembly = read("source/host/runner/system-prompt-assembly.ts");
  assert.match(assembly, /deps\.isLocalCodexMode\?\.\(\) === true\s*\? SAND_SYSTEM_PROMPT_LOCAL_CODEX/);
  const localMode = read("source/electron-main/adapters/local-codex-mode.ts");
  for (const gate of ["sand_usage_page", "sand_teach_by_demonstration", "sand_agent_network", "sand_get_grok_bot_ios", "publish_user_skills", "sand_auto_update_when_idle"]) {
    assert.match(localMode, new RegExp(`${gate}: false`));
  }
  assert.match(localMode, /\.\.\.LOCAL_CODEX_FEATURE_GATE_OVERRIDES/);
});

test("compaction epoch is derived from the conversation summary archives, not hardcoded", () => {
  const source = read("source/host/host-runner-composition.ts");
  assert.doesNotMatch(source, /compactionEpoch: \(\) => 0/);
  assert.match(source, /function compactionEpochFromConversationState\(state: unknown\): number/);
  assert.match(source, /compactionEpochFromConversationState\(getProductionConversationState\(\)\)/);
  assert.match(source, /compactionEpochFromConversationState\(store\.getConversationStateStructure\(\)\)/);
});

test("the production turn provider offers the subagent management tools (A4)", () => {
  // The system prompt tells the model to use CheckSubagent / MessageSubagent /
  // StopSubagent on a running child, but the production factory provider never
  // offered them (found live 2026-09-01: parent had a child running and the
  // model reported the tools missing). The provider must map
  // dependencies.subagentManagement into createSubagentManagementToolInputs.
  const composition = read("source/host/host-runner-composition.ts");
  assert.match(composition, /\.\.\.\(dependencies\.subagentManagement === undefined\s*\?\s*\{\}\s*:\s*\{\s*createSubagentManagementToolInputs/);
  const toolset = read("source/host/runner/tools/turn-toolset.ts");
  assert.match(toolset, /subagentManagement: provider\.createSubagentManagementToolInputs\(/);
  // and the prompt really does advertise them, so the offer must exist
  const prompt = read("source/host/runner/system-prompt.ts");
  assert.match(prompt, /CheckSubagent/);
});

test("agent-lifecycle hooks route to the box daemon's workspace (A8)", () => {
  // The engine accessor's default hookExecutorResource resolution never reached
  // the box workspace whose .cursor/hooks.json configures the hooks, so
  // preCompact / afterAgentThought / stop silently no-opped (live 2026-09-01:
  // gate open, executor bound, marker scripts never ran). The turn's local
  // resource projection must overlay a box-routed hook executor.
  const composition = read("source/host/runner/turn-agent-composition.ts");
  assert.match(composition, /readonly hookExecutor\?: Executor<ExecuteHookArgs, ExecuteHookResult>;/);
  assert.match(composition, /if \(input\.hookExecutor !== undefined\) \{\s*localEntries\.push\(resourceEntry\(hookExecutorResource, input\.hookExecutor\)\);/);
  const host = read("source/host/host-runner-composition.ts");
  assert.match(host, /hookExecutor: \{\s*execute: \(hookCtx: unknown, hookArgs: unknown, hookOpts\?: unknown\) =>\s*\(remoteBoxAccessor\.get\(hookExecutorResource\)/);
  // and the daemon maps the preCompact response (user_message) instead of dropping it
  const daemon = read("source/box-exec-daemon/server.ts");
  assert.match(daemon, /case "preCompact": \{/);
  assert.match(daemon, /new PreCompactRequestResponse\(\)/);
});
