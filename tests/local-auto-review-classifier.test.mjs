import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

const repositoryRoot = path.resolve(import.meta.dirname, "..");

async function loadModule(entry) {
  const result = await build({
    absWorkingDir: repositoryRoot,
    bundle: true,
    entryPoints: [entry],
    format: "esm",
    platform: "node",
    target: "node22",
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

const CLASSIFIER_ENTRY = "source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts";
const PROTO_ENTRY = "source/packages/proto/generated/agent/v1/smart_mode_classifier_exec_pb.ts";

function fakeContext(signal = new AbortController().signal) {
  return { signal, get: () => undefined };
}

async function shellArgs(proto, overrides = {}) {
  const { Struct } = await import("@bufbuild/protobuf");
  return new proto.SmartModeClassifierArgs({
    toolCallId: "tc-1",
    parentConversationId: "conv-1",
    target: new proto.SmartModeRiskTarget({
      action: "shell",
      arguments: Struct.fromJson({
        command: "git push --force origin main",
        working_directory: "/home/user/project",
        surface: "host_machine",
        sandbox_enabled: false,
        project_permissions: { auto_run: { allow_instructions: ["Allow npm test"], block_instructions: ["Never force-push"] } },
        ...overrides,
      }),
    }),
    conversationContext: [
      new proto.SmartModeClassifierConversationMessage({ role: "user", content: "please push my branch" }),
      new proto.SmartModeClassifierConversationMessage({ role: "assistant", content: "Pushing now." }),
    ],
  });
}

test("local classifier prompt carries the action, arguments, permissions and conversation", async () => {
  const classifier = await loadModule(CLASSIFIER_ENTRY);
  const proto = await loadModule(PROTO_ENTRY);
  const args = await shellArgs(proto);
  const prompt = classifier.buildLocalSmartModeClassifierPrompt(args, "enforce");
  assert.equal(prompt.systemPrompt, classifier.LOCAL_SMART_MODE_CLASSIFIER_SYSTEM_PROMPT);
  assert.match(prompt.systemPrompt, /"decision":"allow"\|"block"/u);
  assert.match(prompt.userPrompt, /^review_mode: enforce\naction: shell\n/u);
  assert.match(prompt.userPrompt, /git push --force origin main/u);
  assert.match(prompt.userPrompt, /Never force-push/u);
  assert.match(prompt.userPrompt, /\[1\] user:\nplease push my branch/u);
  assert.match(prompt.userPrompt, /\[2\] assistant:\nPushing now\./u);
});

test("local classifier prompt truncates oversized arguments and context without dropping the tail", async () => {
  const classifier = await loadModule(CLASSIFIER_ENTRY);
  const proto = await loadModule(PROTO_ENTRY);
  const args = await shellArgs(proto, { command: `echo ${"x".repeat(40_000)} END` });
  args.conversationContext = [new proto.SmartModeClassifierConversationMessage({ role: "user", content: `${"y".repeat(9_000)} TAIL` })];
  const prompt = classifier.buildLocalSmartModeClassifierPrompt(args, "shadow");
  assert.ok(prompt.userPrompt.length < classifier.LOCAL_SMART_MODE_CLASSIFIER_MAX_ARGUMENTS_CHARS + classifier.LOCAL_SMART_MODE_CLASSIFIER_MAX_CONTEXT_MESSAGE_CHARS + 2_000);
  assert.match(prompt.userPrompt, /\[truncated\]/u);
  assert.match(prompt.userPrompt, /END/u);
  assert.match(prompt.userPrompt, /TAIL/u);
});

test("local classifier parses allow / block replies, fenced JSON, and rejects garbage", async () => {
  const { parseLocalSmartModeClassifierResponse: parse } = await loadModule(CLASSIFIER_ENTRY);
  assert.deepEqual(parse('{"decision":"allow"}'), { decision: "allow" });
  assert.deepEqual(parse('  {"decision":"ALLOW","block_reason":"ignored"} '), { decision: "allow" });
  assert.deepEqual(
    parse('```json\n{"decision":"block","block_reason":"Force-pushes to origin/main,\\n rewriting history.","proposed_allow_rule":"Allow git push to origin"}\n```'),
    { decision: "block", blockReason: "Force-pushes to origin/main, rewriting history.", proposedAllowRule: "Allow git push to origin" },
  );
  assert.deepEqual(
    parse('Sure, here is my verdict: {"decision":"block"} thanks'),
    { decision: "block", blockReason: "This action needs your approval before it runs." },
  );
  assert.deepEqual(parse('{"decision":"block","block_reason":"   "}'), { decision: "block", blockReason: "This action needs your approval before it runs." });
  assert.equal(parse('{"decision":"maybe"}'), undefined);
  assert.equal(parse("I cannot decide."), undefined);
  assert.equal(parse('["allow"]'), undefined);
  assert.equal(parse(""), undefined);
});

test("local classifier executor maps replies onto the SmartModeClassifierResult contract", async () => {
  const classifier = await loadModule(CLASSIFIER_ENTRY);
  const proto = await loadModule(PROTO_ENTRY);
  const args = await shellArgs(proto);
  const seen = [];
  const executor = classifier.createLocalSmartModeClassifierExecutor({
    provider: "codex",
    runText: async (request) => {
      seen.push(request);
      return '{"decision":"block","block_reason":"Force-push rewrites shared history.","proposed_allow_rule":"Allow force-push to my own branches"}';
    },
  });
  const blocked = await executor.execute(fakeContext(), args);
  assert.equal(blocked.result.case, "success");
  assert.equal(blocked.result.value.decision, proto.SmartModeClassifierDecision.BLOCK);
  assert.equal(blocked.result.value.blockReason, "Force-push rewrites shared history.");
  assert.equal(blocked.result.value.proposedAllowRule, "Allow force-push to my own branches");
  assert.equal(seen.length, 1);
  assert.equal(seen[0].systemPrompt, classifier.LOCAL_SMART_MODE_CLASSIFIER_SYSTEM_PROMPT);
  assert.match(seen[0].userPrompt, /review_mode: enforce/u, "mode falls back to enforce when the context carries none");
  assert.equal(seen[0].reasoning, "low", "codex classification runs at low reasoning effort for latency");
  assert.ok(seen[0].signal instanceof AbortSignal);

  const allowing = classifier.createLocalSmartModeClassifierExecutor({ provider: "claude-code", runText: async () => '{"decision":"allow"}' });
  const allowed = await allowing.execute(fakeContext(), args);
  assert.equal(allowed.result.case, "success");
  assert.equal(allowed.result.value.decision, proto.SmartModeClassifierDecision.ALLOW);
  assert.equal(allowed.result.value.blockReason, undefined);
});

test("local classifier executor reports provider failures and unparseable replies as classifier errors, but propagates aborts", async () => {
  const classifier = await loadModule(CLASSIFIER_ENTRY);
  const proto = await loadModule(PROTO_ENTRY);
  const args = await shellArgs(proto);

  const failing = classifier.createLocalSmartModeClassifierExecutor({ provider: "openrouter", runText: async () => { throw new Error("OpenRouter needs OPENROUTER_API_KEY."); } });
  const failed = await failing.execute(fakeContext(), args);
  assert.equal(failed.result.case, "error");
  assert.match(failed.result.value.error, /^local_classifier_request_failed: Error: OpenRouter needs/u);

  const rambling = classifier.createLocalSmartModeClassifierExecutor({ provider: "codex", runText: async () => "As an AI I think this is probably fine." });
  const unparsed = await rambling.execute(fakeContext(), args);
  assert.equal(unparsed.result.case, "error");
  assert.match(unparsed.result.value.error, /^local_classifier_unparseable_response: As an AI/u);

  const abortError = new Error("aborted");
  abortError.name = "AbortError";
  const aborting = classifier.createLocalSmartModeClassifierExecutor({ provider: "codex", runText: async () => { throw abortError; } });
  await assert.rejects(() => aborting.execute(fakeContext(), args), (error) => error === abortError);

  const controller = new AbortController();
  const cancelled = classifier.createLocalSmartModeClassifierExecutor({ provider: "codex", runText: async () => { controller.abort(); throw new Error("socket closed"); } });
  await assert.rejects(() => cancelled.execute(fakeContext(controller.signal), args), /socket closed/u);
});

test("local classifier executor honours model / reasoning overrides", async () => {
  const classifier = await loadModule(CLASSIFIER_ENTRY);
  const proto = await loadModule(PROTO_ENTRY);
  const args = await shellArgs(proto);
  const seen = [];
  const executor = classifier.createLocalSmartModeClassifierExecutor({
    provider: "codex",
    modelId: "gpt-5.4-mini",
    reasoning: "minimal",
    runText: async (request) => { seen.push(request); return '{"decision":"allow"}'; },
  });
  await executor.execute(fakeContext(), args);
  assert.equal(seen[0].modelId, "gpt-5.4-mini");
  assert.equal(seen[0].reasoning, "minimal");
  assert.equal(classifier.isLocalAutoReviewInferenceProvider("cursor"), false);
  for (const provider of ["codex", "claude-code", "openrouter"]) assert.equal(classifier.isLocalAutoReviewInferenceProvider(provider), true);
});

test("auto-review extension no longer forces the setting off for local providers", async () => {
  const source = await readFile(path.join(repositoryRoot, "source/host/extensions/auto-review/extension.ts"), "utf8");
  assert.doesNotMatch(source, /isEnabled:\s*false/u, "the local override that ignored the user's Auto-review toggle must be gone");
  assert.match(source, /createLocalSmartModeClassifierExecutor\(\{ provider, runText: createRoutedProviderClassifierTextRunner\(provider\) \}\)/u, "local providers must be served by the local classifier over the routed provider");
  assert.match(source, /createSandBackendSmartModeClassifierExecutor\(classifierAuth\)/u, "Cursor keeps the backend classifier");
  assert.match(source, /name === "sand_auto_review" && isLocalAutoReviewInferenceProvider\(/u, "settings-on must enforce locally instead of idling in shadow");
});

test("local computer-use Computer tool goes through the auto-review preflight", async () => {
  const read = (relative) => readFile(path.join(repositoryRoot, relative), "utf8");
  const turnTool = await read("source/host/runner/host-computer-tool-dependencies.ts");
  assert.match(turnTool, /await runComputerToolAutoReviewPreflight\(deps, parsed, \{/u, "createComputerTurnTool must run the classifier/approval preflight before executing");
  const composition = await read("source/host/runner/turn-agent-composition.ts");
  assert.match(composition, /\.\.\.\(turn\.computerAutoReview === undefined \? \{\} : \{ autoReview: turn\.computerAutoReview \}\)/u, "the direct-from-accessor Computer dependencies must carry the turn's computer auto-review options");
  const host = await read("source/host/host-runner-composition.ts");
  assert.match(host, /resolveDisplayNumber: async \(\) => localComputerDisplayNumber\(\)/u, "local computer auto-review must resolve the local Xvfb display");
  assert.match(host, /computerAutoReview: localComputerAutoReview/u, "the production turn must hand the computer auto-review options to the toolset");
  const computerTool = await read("source/host/runner/tools/sand-computer-tool.ts");
  assert.match(computerTool, /SAND_LOCAL_COMPUTER_USE === "1"\) return SAND_COMPUTER_PAGE_STATE_CHROME_UNREACHABLE/u, "local mode must not probe a box Chrome for the display-state identity");
  for (const relative of ["source/host/runner/tools/sand-computer-tool.ts", "source/host/runner/host-computer-tool-dependencies.ts", "source/host/runner/sand-computer-auto-review.ts", "source/host/host-runner-composition.ts", "source/host/runner/turn-agent-composition.ts", CLASSIFIER_ENTRY]) {
    assert.doesNotMatch(await read(relative), /computer-review-debug/u, `${relative} must not ship debug tracing`);
  }
});

test("desktop and host derive the same account scope for the local Codex account (rules survive restarts)", async () => {
  const account = await loadModule("source/shared/node/local-codex-account.ts");
  const token = await loadModule("source/shared/node/cursor-token.ts");
  const desktop = await loadModule("source/electron-main/adapters/local-codex-mode.ts");
  // The desktop authorizes the coordinator account with accountCacheScope(status.authId) and
  // scopes settings to it; the host must land on the identical scope or every launch flips
  // the stored scope and scopeToAccount() drops autoReviewInstructions / model defaults /
  // localToolPermission (observed live: rules vanished after each restart).
  assert.equal(desktop.LOCAL_CODEX_STATUS.authId, account.LOCAL_CODEX_AUTH_ID);
  assert.equal(account.localCodexAccountCacheScope(), token.accountCacheScope(desktop.LOCAL_CODEX_STATUS.authId));
  assert.notEqual(account.localCodexAccountCacheScope(), "local", "the host must not fall back to the literal \"local\" scope in local Codex mode");
  const mcpService = await readFile(path.join(repositoryRoot, "source/host/extensions/mcp/mcp-service.ts"), "utf8");
  assert.match(mcpService, /isLocalCodexMode\(\) \? localCodexAccountCacheScope\(\) : "local"/u, "host account-servers fallback scope must match the desktop's local Codex scope");
  assert.equal(account.isLocalCodexMode({ SAND_LOCAL_CODEX_MODE: "1" }), true);
  assert.equal(account.isLocalCodexMode({}), false);
});

test("local MCP projection spills large tool results to a box file", async () => {
  const host = await readFile(path.join(repositoryRoot, "source/host/host-runner-composition.ts"), "utf8");
  assert.match(host, /textSpiller: isLargeOutputSpillEnabled\(\) && typeof method\(remoteBox, "uploadFile"\) === "function"/u, "the per-turn MCP projection must install the MCP text spiller instead of textSpiller: undefined");
  assert.doesNotMatch(host, /textSpiller: undefined,/u);
  // The loopback (in-box) upload must go through the daemon's path-mapped write executor:
  // the shell-based uploader runs `mkdir -p -- /workspace/...` literally, and the local daemon
  // only maps /workspace for cwd/WriteArgs paths, so every box upload (spills included) failed.
  const production = await readFile(path.join(repositoryRoot, "source/host/box/production.ts"), "utf8");
  assert.match(production, /async uploadFile\(ctx, accessor, path, data\): Promise<void> \{[\s\S]*?await writeFileBytesViaExecDaemon\(ctx, accessor, path, data\);/u, "loopback uploadFile must use writeFileBytesViaExecDaemon");
  assert.doesNotMatch(production, /uploadFileViaExecDaemon/u, "the shell-based uploader must not be used for the loopback box");
  // Attachment box-staging needs a real Context: the loopback readiness ping calls ctx methods,
  // so the extension's former `ctx: {}` made every staging upload fail ("last ping: crash").
  const attachments = await readFile(path.join(repositoryRoot, "source/host/extensions/attachments/extension.ts"), "utf8");
  assert.match(attachments, /ctx: createContext\(\)/u, "attachments service must be created with a real Context");
  assert.doesNotMatch(attachments, /ctx: \{\}/u);
});

test("local classifier module stays free of provider SDK imports so it bundles standalone", async () => {
  const source = await readFile(path.join(repositoryRoot, CLASSIFIER_ENTRY), "utf8");
  const valueImports = [...source.matchAll(/^import (?!type )[^;]*from "([^"]+)";/gmu)].map(match => match[1]);
  for (const specifier of valueImports) assert.doesNotMatch(specifier, /inference\//u, `${specifier} must not be a value import of the inference layer`);
});
