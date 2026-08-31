// Wave-5 wiring guards: subagent settle isolation (AUDIT-4), local-tool ask expiry
// notice (USR-660), staged-attachment cleanup after send, and the Linux/WSL OS
// notification fallback — plus behavioral tests for the fallback command builder.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(repoRoot, relativePath), "utf8");

test("subagent turns settle against their own runner/transcript and never the parent root slot (AUDIT-4 rev 2)", () => {
  const source = read("source/host/host-runner-composition.ts");
  assert.match(source, /const createProductionTurnSettleHost = \(turnConversationId: string = session\.id\): TurnSettleHost => \{/);
  assert.match(source, /const isChildTurn = turnConversationId !== session\.id;/);
  assert.match(source, /getTranscriptId: \(\) => turnConversationId,/);
  assert.match(source, /agentStore: \(\) => isChildTurn \? null : \(\{/);
  assert.match(source, /isSubagentRunner: isChildTurn \|\| isSharedRoomTurn,/);
  assert.match(source, /if \(isChildTurn\) return; \/\/ a child must not rewrite the parent's announced profile/);
  // rev 2 (external review #1): turn-run-shell creates the settle host BEFORE
  // prepareTurn runs, so identity must never flow through a shared per-prepare
  // stamp. The parent adapter is pinned to session.id; each child runner gets
  // its own override pinned to its own id.
  assert.match(source, /createSettleHost: \(\) => createProductionTurnSettleHost\(session\.id\),/);
  assert.match(source, /getConversationId: \(\) => session\.id,/);
  assert.match(source, /createSettleHost: \(\) => createProductionTurnSettleHost\(agentId\),/);
  assert.match(source, /getConversationId: \(\) => agentId,/);
  assert.match(source, /getConversationState: childConversationState,/);
  assert.doesNotMatch(source, /activeTurnConversationId \?\?/, "the shared mutable turn-id stamp is gone");
  assert.doesNotMatch(source, /activeTurnConversationId = /, "no per-prepare identity stamping");
  assert.match(source, /getAgentId: \(\) => agentId,/);
});

test("expired local-tool asks surface a tray and a transcript notice (USR-660)", () => {
  const source = read("source/host/host-runner-composition.ts");
  assert.match(source, /title: "Permission request expired"/);
  assert.match(source, /dedupeKey: `local-tool-ask-expired:\$\{session\.id\}`/);
  assert.match(source, /expired without an answer — nothing ran on your computer/);
});

test("staged attachments are deleted after a fully successful commit", () => {
  const source = read("source/electron-main/attachments/attachments.ts");
  const commit = source.slice(source.indexOf("async commitStaged("), source.indexOf("async discardStaged("));
  assert.match(commit, /rm\(stagedPath, \{ force: true \}\)\.catch\(\(error: unknown\) => report\("commit-cleanup", error\)\)/);
  assert.ok(commit.indexOf("commit-cleanup") < commit.indexOf("return committed;"), "cleanup runs before the successful return");
});

test("OS notifications fall back to notify-send / Windows balloon on Linux and report show() failures", () => {
  const binding = read("source/electron-main/production-binding-providers.ts");
  assert.match(binding, /const fallbackNotifier = detectLinuxNotifier\(\)/);
  assert.match(binding, /isSupported: \(\) => ports\.Notification\.isSupported\(\) \|\| fallbackNotifier !== undefined/);
  assert.match(binding, /createFallbackNotification\(fallbackNotifier!, options\)/);
  assert.match(binding, /reportFailure: \(operation, error\) => reportDesktopEdgeFailure\("os-notification", operation, error\)/);
  const manager = read("source/electron-main/notifications/os-notification-manager.ts");
  assert.match(manager, /try \{\s*notification\.show\(\);\s*\} catch \(error\) \{\s*this\.active\.delete\(notification\);\s*this\.deps\.reportFailure\?\.\("show", error\);/);
});

async function loadFallback() {
  const result = await build({
    entryPoints: [path.join(repoRoot, "source/electron-main/notifications/linux-notification-fallback.ts")],
    bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}

test("fallback detection prefers notify-send, then WSL powershell, else none", async () => {
  const { detectLinuxNotifier, WSL_POWERSHELL_PATH } = await loadFallback();
  const env = { WSL_DISTRO_NAME: "Ubuntu", SAND_FORCE_LINUX_NOTIFIER: "1" };
  assert.equal(detectLinuxNotifier(env, () => ({ status: 0 })), "notify-send");
  assert.equal(detectLinuxNotifier(env, () => ({ status: 127 }), (p) => p === WSL_POWERSHELL_PATH), "windows-powershell");
  assert.equal(detectLinuxNotifier({ SAND_FORCE_LINUX_NOTIFIER: "1" }, () => { throw new Error("ENOENT"); }, () => false), undefined);
});

test("fallback commands escape content and the port emits close after the notifier exits", async () => {
  const { buildNotifyCommand, createFallbackNotification } = await loadFallback();
  const notifySend = buildNotifyCommand("notify-send", { title: "Bot done", body: "-rf; echo pwned", silent: true, urgency: "normal" });
  assert.deepEqual(notifySend.args.slice(-3), ["--", "Bot done", "-rf; echo pwned"], "body cannot be parsed as an option");
  const balloon = buildNotifyCommand("windows-powershell", { title: "It's done", body: "quote ' test", silent: true, urgency: "critical" });
  assert.match(balloon.args.at(-1), /'It''s done'/);
  assert.match(balloon.args.at(-1), /'quote '' test'/);
  assert.match(balloon.args.at(-1), /ToolTipIcon\]::Warning/);

  const listeners = {};
  let spawned;
  const port = createFallbackNotification("notify-send", { title: "t", body: "b", silent: true, urgency: "normal" }, (command, args) => {
    spawned = { command, args };
    return { on: (event, listener) => { listeners[event] = listener; }, unref: () => {} };
  });
  let closed = 0;
  port.once("close", () => { closed += 1; });
  port.show();
  assert.equal(spawned.command, "notify-send");
  listeners.exit?.();
  assert.equal(closed, 1);
  port.close();
  assert.equal(closed, 1, "close only fires once");
});
