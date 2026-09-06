import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = { title: "Bot complete", body: "Open the completed task", silent: true, urgency: "normal" };
const modules = new Map();
function load(relativePath) {
  if (!modules.has(relativePath)) modules.set(relativePath, build({ entryPoints: [path.join(repoRoot, relativePath)], bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent" }).then((result) => import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`)));
  return modules.get(relativePath);
}
const loadFallback = () => load("source/electron-main/notifications/linux-notification-fallback.ts");

function fakeNotifier() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.unref = () => {};
  child.killCount = 0;
  child.kill = () => { child.killCount += 1; return true; };
  const calls = [];
  return { child, calls, spawn: (command, args) => { calls.push({ command, args }); return child; } };
}

test("notify-send requests the supported default action and keeps user text out of options", async () => {
  const { buildNotifyCommand } = await loadFallback();
  const command = buildNotifyCommand("notify-send", { ...options, title: "--action=evil", body: "$(touch forbidden)" });
  assert.equal(command.command, "notify-send");
  assert.ok(command.args.includes("--action=default=Open Grok Bot"));
  assert.ok(command.args.includes("--wait"));
  assert.ok(command.args.includes("--expire-time=8000"));
  assert.deepEqual(command.args.slice(-3), ["--", "--action=evil", "$(touch forbidden)"]);
});

test("WSL balloon pumps Windows events and reports BalloonTipClicked through the same action protocol", async () => {
  const { buildNotifyCommand, WSL_POWERSHELL_PATH } = await loadFallback();
  // Truncate BEFORE escaping: a quote exactly on the limit must remain paired.
  const command = buildNotifyCommand("windows-powershell", { ...options, title: `${"t".repeat(119)}'suffix`, body: `${"b".repeat(239)}'suffix` });
  assert.equal(command.command, WSL_POWERSHELL_PATH);
  assert.ok(command.args.includes("-STA"));
  const script = command.args.at(-1);
  assert.ok(script.includes(`'${"t".repeat(119)}'''`));
  assert.ok(script.includes(`'${"b".repeat(239)}'''`));
  assert.match(script, /add_BalloonTipClicked\(\{ \[Console\]::Out\.WriteLine\('default'\)/);
  assert.match(script, /\[Console\]::Out\.Flush\(\)/);
  assert.match(script, /\[System\.Windows\.Forms\.Application\]::Run\(\)/);
  assert.match(script, /add_BalloonTipClosed/);
  assert.match(script, /\$timer\.Interval = 8000/);
  assert.match(script, /finally \{ \$timer\.Stop\(\); \$timer\.Dispose\(\); \$n\.Dispose\(\) \}/);
  assert.doesNotMatch(script, /Start-Sleep/);
});

for (const kind of ["notify-send", "windows-powershell"]) {
  test(`${kind} forwards a chunked action once and waits for stdout after process exit`, async () => {
    const { createFallbackNotification } = await loadFallback();
    const fake = fakeNotifier();
    const port = createFallbackNotification(kind, options, fake.spawn);
    const events = [];
    port.on("click", () => events.push("click"));
    port.once("close", () => events.push("close"));
    port.show();
    port.show();
    assert.equal(fake.calls.length, 1, "show is idempotent");
    fake.child.stdout.emit("data", Buffer.from("def"));
    fake.child.emit("exit", 0);
    assert.deepEqual(events, [], "exit must not discard unread stdout");
    fake.child.stdout.emit("data", Buffer.from("ault\r\ndefault\n"));
    fake.child.emit("close", 0);
    port.close();
    assert.deepEqual(events, ["click", "close"]);
  });

  test(`${kind} notification click reaches the existing manager and opens the correct bot once`, async () => {
    const { createFallbackNotification } = await loadFallback();
    const { SandOsNotificationManager } = await load("source/electron-main/notifications/os-notification-manager.ts");
    const fake = fakeNotifier();
    const events = [];
    const window = { isFocused: () => false, isMinimized: () => true, restore: () => events.push("restore"), show: () => events.push("show"), focus: () => events.push("focus") };
    const manager = new SandOsNotificationManager({
      getWindow: () => window,
      isSupported: () => true,
      createNotification: (notificationOptions) => createFallbackNotification(kind, notificationOptions, fake.spawn),
      openAgent: (id) => events.push(`open:${id}`),
      now: () => 100_000,
    });
    const agent = { id: "target-bot", name: "Target", isRunning: true, notifyOnUpdatesEnabled: true, lastMessageId: "before" };
    manager.seedBaseline([agent]);
    manager.handleAgentUpsertedEvent({ agent: { ...agent, isRunning: false, lastMessageId: "after", lastMessagePreview: "Done" } });
    assert.equal(fake.calls.length, 1);
    fake.child.stdout.emit("data", "default\ndefault\n");
    fake.child.emit("close", 0);
    assert.deepEqual(events, ["restore", "show", "focus", "open:target-bot"]);
    manager.reset();
    assert.equal(fake.child.killCount, 0, "manager removed the closed notifier from its active set");
  });
}

test("dismissal, unknown output and spawn failure never synthesize notification clicks", async () => {
  const { createFallbackNotification } = await loadFallback();
  for (const output of ["", "1\n", "default-other\n", "default other\n", "debug default\n"]) {
    const fake = fakeNotifier();
    const events = [];
    const port = createFallbackNotification("notify-send", options, fake.spawn);
    port.on("click", () => events.push("click"));
    port.once("close", () => events.push("close"));
    port.show();
    fake.child.stdout.emit("data", output);
    fake.child.emit("close", 0);
    assert.deepEqual(events, ["close"], JSON.stringify(output));
  }
  const events = [];
  const port = createFallbackNotification("notify-send", options, () => { throw new Error("ENOENT"); });
  port.on("click", () => events.push("click"));
  port.once("close", () => events.push("close"));
  port.show();
  port.show();
  port.close();
  assert.deepEqual(events, ["close"]);
});

test("closing a notification terminates only its owned notifier and ignores delayed clicks", async () => {
  const { createFallbackNotification } = await loadFallback();
  const fake = fakeNotifier();
  const events = [];
  const port = createFallbackNotification("windows-powershell", options, fake.spawn);
  port.on("click", () => events.push("click"));
  port.once("close", () => events.push("close"));
  port.show();
  port.close();
  port.close();
  fake.child.stdout.emit("data", "default\n");
  fake.child.emit("close", 0);
  assert.deepEqual(events, ["close"]);
  assert.equal(fake.child.killCount, 1);
});

test("final stdout action without a newline is delivered before close bookkeeping", async () => {
  const { createFallbackNotification } = await loadFallback();
  const fake = fakeNotifier();
  const events = [];
  const port = createFallbackNotification("notify-send", options, fake.spawn);
  port.once("click", () => events.push("click"));
  port.once("close", () => events.push("close"));
  port.show();
  fake.child.stdout.emit("data", "default");
  fake.child.emit("close", 0);
  assert.deepEqual(events, ["click", "close"]);
});
