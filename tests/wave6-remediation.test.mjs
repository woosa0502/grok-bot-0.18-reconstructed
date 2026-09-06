// Wave-6 remediation: fixes for the strict-review findings (AUDIT-W12..W17 and
// the P1 quality items). Behavioral tests where the unit is importable, source
// guards where the fix is production wiring.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const execFileAsync = promisify(execFile);

async function loadModule(relativeEntry) {
  const result = await build({
    entryPoints: [path.join(repoRoot, relativeEntry)],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    external: ["@earendil-works/pi-coding-agent", "@earendil-works/pi-ai", "pdfjs-dist/*"],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

// ---------- AUDIT-W14: credential path unification ----------

test("a pre-unification CLI login (~/.grokbot store format) migrates into the profile store", async () => {
  const { BelmontPiCredentialStore, migrateBelmontCliCredential } = await loadModule("source/host/extensions/inference/pi-codex-credential-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-w14-"));
  try {
    const cliPath = path.join(root, "cli-pi-auth.json");
    const credential = { type: "oauth", access: "aaa.bbb.ccc", refresh: "rrr", expires: Date.now() + 3_600_000, accountId: "acct-1" };
    await writeFile(cliPath, JSON.stringify({ "openai-codex": credential }), { mode: 0o600 });
    const store = new BelmontPiCredentialStore(path.join(root, "profile", "pi-auth.json"));
    assert.equal(await migrateBelmontCliCredential(store, cliPath), true, "credential is copied");
    assert.equal((await store.read("openai-codex"))?.refresh, "rrr");
    // Second run is a no-op (profile already has a credential).
    assert.equal(await migrateBelmontCliCredential(store, cliPath), false);
    // World-readable CLI files are refused, like the legacy Codex migration.
    const loosePath = path.join(root, "loose.json");
    await writeFile(loosePath, JSON.stringify({ "openai-codex": credential }), { mode: 0o644 });
    const emptyStore = new BelmontPiCredentialStore(path.join(root, "profile2", "pi-auth.json"));
    assert.equal(await migrateBelmontCliCredential(emptyStore, loosePath), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("auth CLI targets the profile store for login and the runtime runs the CLI migration", () => {
  const cli = read("scripts/pi-codex-auth.mjs");
  assert.match(cli, /function credentialPath\(\{ forWrite = false \} = \{\}\)/);
  assert.match(cli, /if \(forWrite\) return profilePath/);
  assert.match(cli, /command === "login" \? credentialPath\(\{ forWrite: true \}\) : undefined/);
  assert.match(cli, /\.cache", "belmont-wsl-profile"/);
  const runtime = read("source/host/extensions/inference/pi-codex-runtime.ts");
  assert.match(runtime, /await migrateBelmontCliCredential\(credentials\);/);
});

// ---------- AUDIT-W13: fresh-profile login bootstrap ----------

test("local Codex mode keeps a coordinator slot while logged out (fresh login is reachable)", () => {
  const runtime = read("source/electron-main/coordinator/coordinator-account-runtime.ts");
  assert.match(runtime, /if \(status\.kind !== "logged-in"\) \{[\s\S]{0,700}return isLocalCodexMode\(\) \? LOCAL_CODEX_AUTH_ID : null;/);
});

// ---------- AUDIT-W15: Grep canonical boundary ----------

test("daemon grep enforces the canonical workspace boundary before invoking rg", () => {
  const server = read("source/box-exec-daemon/server.ts");
  const grep = server.slice(server.indexOf("async grep("), server.indexOf("async grep(") + 1_200);
  assert.match(grep, /await this\.#assertCanonicalWithinRoots\(cwd, requested\);/);
});

// ---------- AUDIT-W16: local plugin catalog reaches the host MCP manager ----------

test("createHostMcp forwards the catalog overrides into SandMcpManager", () => {
  const service = read("source/host/extensions/mcp/mcp-service.ts");
  assert.match(service, /catalog\?: \{/, "CreateHostMcpOptions declares the catalog field");
  assert.match(service, /\.\.\.\(deps\.catalog === undefined \? \{\} : \{ catalog: deps\.catalog \}\)/);
});

test("local plugin catalog entries keep their declared skills", async () => {
  const { readLocalPluginCatalog } = await loadModule("source/shared/node/mcp/local-mcp-store.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-w16-"));
  try {
    await writeFile(path.join(root, "plugin-catalog.json"), JSON.stringify({ plugins: [{
      pluginId: "990001", name: "skillful", displayName: "Skillful", description: "d",
      skills: [{ name: "do-thing", description: "does the thing", sourceUrl: "https://example.com/skill.md" }, { bad: true }],
      install: { mcpServers: { skillful: { command: "npx", args: ["-y", "skillful"] } } },
    }] }));
    const entry = readLocalPluginCatalog(root).find((candidate) => candidate.pluginId === "990001");
    assert.deepEqual(entry?.skills, [{ name: "do-thing", description: "does the thing", sourceUrl: "https://example.com/skill.md" }]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------- AUDIT-W12: list_changed reaches the host tools cache ----------

test("tools discovery reconciles box tools and the mcp extension polls it", () => {
  const discovery = read("source/shared/node/mcp/tools-discovery.ts");
  assert.match(discovery, /async reconcileBoxTools\(\): Promise<boolean>/);
  assert.match(discovery, /if \(signature\(cachedBox\) === signature\(live\)\) return false;/);
  const service = read("source/host/extensions/mcp/mcp-service.ts");
  assert.match(service, /reconcileBoxTools: \(\) => discovery\.reconcileBoxTools\(\)/);
  assert.match(service, /this\.#boxToolsReconcileTimer = setInterval\(/);
  assert.match(service, /clearInterval\(this\.#boxToolsReconcileTimer\)/);
});

// ---------- AUDIT-W17: Computer defaults, readiness, honest prompt ----------

test("local Computer is default-on with a binary readiness gate, and the prompt distinguishes shared files from per-bot screens", async () => {
  const computer = read("source/host/box/local-computer-use.ts");
  assert.match(computer, /LOCAL_COMPUTER_REQUIRED_BINARIES = \["Xvfb", "xdotool", "ffmpeg"\]/);
  assert.match(computer, /process\.env\.SAND_LOCAL_COMPUTER_USE !== "0" && missingComputerBinaries\.length === 0/);
  const launcher = read("scripts/lib/wsl-runtime.mjs");
  assert.match(launcher, /SAND_LOCAL_COMPUTER_USE: env\.SAND_LOCAL_COMPUTER_USE \?\? "1"/);
  const { SAND_SYSTEM_PROMPT_LOCAL_CODEX: prompt } = await loadModule("source/host/runner/system-prompt.ts");
  assert.match(prompt, /ONE computer shared by all of this user's agents/);
  assert.match(prompt, /files and installed tools are shared/);
  assert.match(prompt, /each top-level bot has its own desktop screen/);
  assert.match(prompt, /Your computerUse subagent shares YOUR bot's screen/);
  assert.match(prompt, /only one computerUse subagent drive it at a time/);
  assert.doesNotMatch(prompt, /ONE screen on that machine|in this local build the desktop is shared too/);
});

// ---------- P1-02: stable prompt-cache affinity ----------

test("codex model calls reuse one cache session id instead of a per-call UUID", () => {
  const session = read("source/host/extensions/inference/provider-session.ts");
  // rev 2 (external review #5): executors are rebuilt every turn, so the key
  // must come from the CONVERSATION — turn-run-shell threads its conversation id
  // into the provider session; random stays only as a fallback.
  assert.match(session, /this\.#cacheSessionId = cacheSessionId != null && cacheSessionId\.length > 0 \? cacheSessionId : crypto\.randomUUID\(\);/);
  assert.match(session, /this\.#cacheSessionId,\s*\);/);
  const shellSource = read("source/host/runner/turn-run-shell.ts");
  assert.match(shellSource, /createProviderPromptSession\(turnProvider, resolvedModelId, resolvedReasoning, input\.conversationId\)/);
  const runtime = read("source/host/extensions/inference/pi-codex-runtime.ts");
  assert.match(runtime, /sessionId: options\.cacheSessionId \?\? options\.invocationId,/);
});

// ---------- P1-05: cron dispatch failure retries with backoff ----------

test("a failed cron fire restores the slot and retries after a backoff", async () => {
  const { LocalCronScheduler } = await loadModule("source/host/extensions/automations/local-cron-scheduler.ts");
  const T0 = Date.UTC(2026, 7, 31, 12, 0, 0);
  let now = T0;
  let failuresLeft = 1;
  const fires = [];
  const logs = [];
  const automation = { id: "auto-1", isEnabled: true, trigger: { type: "cron", schedule: "@every 1m" }, createdAt: T0 - 120_000 };
  const scheduler = new LocalCronScheduler({
    polling: { start: () => ({ dispose() {} }) },
    listAutomations: async () => [{ agentId: "agent-1", automation }],
    fire: async (agentId, _automation, dueAt) => {
      if (failuresLeft > 0) { failuresLeft -= 1; throw new Error("transient dispatch failure"); }
      fires.push({ agentId, dueAt });
    },
    isReady: () => true,
    shouldScheduleLocally: () => true,
    getTimeZone: () => undefined,
    now: () => now,
    log: (message) => logs.push(message),
  });
  await scheduler.tick();
  await new Promise((resolve) => setTimeout(resolve, 20)); // let the async fire settle
  assert.equal(fires.length, 0);
  assert.ok(logs.some((line) => line.includes("will retry")), `failure is logged for retry, got: ${logs.join(" | ")}`);
  // Within the backoff hold nothing fires…
  now = T0 + 10_000;
  await scheduler.tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fires.length, 0, "retry is held back during the backoff window");
  // …after it, the same slot fires again.
  now = T0 + 70_000;
  await scheduler.tick();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(fires.length, 1, "slot is retried after the backoff");
  await scheduler.stop();
});

// ---------- P1-07: shell state namespaced per conversation ----------

test("shell state is namespaced by the calling conversation", () => {
  const server = read("source/box-exec-daemon/server.ts");
  assert.match(server, /#shellStateDirFor\(owner: string \| undefined\): string/);
  assert.match(server, /const stateOwner = args\.conversationId;/);
  assert.match(server, /this\.#withShellState\(args\.command, stateOwner\)/);
  assert.match(server, /this\.#savedCwdLogical\(stateOwner\)/);
  assert.match(server, /this\.#resetShellState\(stateOwner\)/);
  const tool = read("source/packages/agent/tools/core/shell/create-shell-tool.ts");
  assert.match(tool, /skipApproval = false, conversationId\?: string\)/);
  assert.match(tool, /getConversationId\(ctx\)\);/);
});

// ---------- P1-09: web tool fidelity ----------

test("WebFetch refuses binary bodies, re-checks redirect landings and honors caller abort; WebSearch pairs snippets per result block", () => {
  const web = read("source/host/extensions/inference/codex-web-tools.ts");
  assert.match(web, /function binaryContentTypeNote\(/);
  assert.match(web, /redirect landed on unsupported protocol/);
  assert.match(web, /callerSignal\?\.addEventListener\("abort", onCallerAbort/);
  assert.match(web, /callerSignal\?\.removeEventListener\("abort", onCallerAbort\)/);
  assert.match(web, /const blockEnd = titles\[index \+ 1\]\?\.index \?\? html\.length;/);
  assert.match(web, /snippetPattern\.exec\(html\.slice\(blockStart, blockEnd\)\)/);
});

// ---------- P1-10: PDF cache key + extractor lifecycle ----------

test("PDF text cache keys include a content hash and stay bounded", () => {
  const readTool = read("source/packages/agent/tools/core/read/read.ts");
  assert.match(readTool, /createHash\("sha256"\)\.update\(output\.value\)\.digest\("hex"\)/);
  assert.match(readTool, /PDF_TEXT_CACHE_MAX_ENTRIES = 32/);
});

test("pdftotext extraction is killed at the deadline", async () => {
  const { extractWithPdftotext } = await loadModule("source/host/runner/local-pdf-text-extractor.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-w6-pdf-"));
  try {
    const slow = path.join(root, "slow-pdftotext");
    await writeFile(slow, "#!/bin/sh\nsleep 30\n");
    await chmod(slow, 0o755);
    const startedAt = Date.now();
    await assert.rejects(
      () => extractWithPdftotext(slow, new Uint8Array([1, 2, 3]), 300),
      /timed out/,
    );
    assert.ok(Date.now() - startedAt < 5_000, "the deadline kill is prompt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------- sanity: legacy shell-state behavior is unchanged for the default namespace ----------

test("wrapped shell-state command still round-trips through /bin/sh", async () => {
  const { buildShellStateWrappedCommand, SHELL_STATE_CWD_FILE } = await loadModule("source/box-exec-daemon/shell-state.ts");
  const root = await mkdtemp(path.join(tmpdir(), "belmont-w6-shell-"));
  try {
    const stateA = path.join(root, "state", "agent-a");
    const stateB = path.join(root, "state", "agent-b");
    await execFileAsync("/bin/sh", ["-lc", buildShellStateWrappedCommand(stateA, "export ONLY_A=1; true")], { cwd: root });
    await execFileAsync("/bin/sh", ["-lc", buildShellStateWrappedCommand(stateB, "true")], { cwd: root });
    const bEnv = await readFile(path.join(stateB, "env.sh"), "utf8").catch(() => "");
    assert.doesNotMatch(bEnv, /ONLY_A/, "one namespace's exports never leak into another's");
    assert.equal((await readFile(path.join(stateA, SHELL_STATE_CWD_FILE), "utf8")).trim(), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
