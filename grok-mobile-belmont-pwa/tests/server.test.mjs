import assert from "node:assert/strict";
import { once } from "node:events";
import { promises as fs } from "node:fs";
import http from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { WebSocket, WebSocketServer } from "ws";
import { createMobileServer, createPairingGuard, projectAgent, projectTranscriptEntries } from "../server.mjs";
import { projectCodexUsage } from "../codex-usage.mjs";

test("Codex usage projection keeps real quota windows and token activity", () => {
  const projected = projectCodexUsage({
    rateLimits: { limitId: "codex", primary: { usedPercent: 26, windowDurationMins: 10_080, resetsAt: 1_788_747_940 }, planType: "pro" },
    rateLimitsByLimitId: {
      codex: { limitId: "codex", primary: { usedPercent: 26, windowDurationMins: 10_080, resetsAt: 1_788_747_940 }, planType: "pro" },
      codex_spark: { limitId: "codex_spark", limitName: "Codex Spark", primary: { usedPercent: 12, windowDurationMins: 300, resetsAt: 1_788_469_192 }, secondary: { usedPercent: 5, windowDurationMins: 10_080, resetsAt: 1_789_055_992 } },
    },
    rateLimitResetCredits: { availableCount: 1 },
  }, {
    summary: { lifetimeTokens: 1_234_567, peakDailyTokens: 45_678, currentStreakDays: 8 },
    dailyUsageBuckets: [{ startDate: "2026-09-03", tokens: 12_345 }],
  }, 999);
  assert.equal(projected.planType, "pro");
  assert.deepEqual(projected.windows.map((window) => [window.limitName, window.scope, window.usedPercent]), [
    ["Codex", "primary", 26],
    ["Codex Spark", "primary", 12],
    ["Codex Spark", "secondary", 5],
  ]);
  assert.equal(projected.resetCredits, 1);
  assert.equal(projected.activity.lifetimeTokens, 1_234_567);
  assert.equal(projected.fetchedAt, 999);
});

test("mobile usage endpoint returns the injected Codex account snapshot", async (context) => {
  const snapshot = { planType: "pro", windows: [], resetCredits: 0, activity: { lifetimeTokens: 42, peakDailyTokens: 21, currentStreakDays: 3, recentDaily: [] }, fetchedAt: 100 };
  const app = createMobileServer({
    skipPairing: true,
    sessionFile: null,
    codexUsageReader: async () => snapshot,
    gateway: { async managerId() { return null; }, async call() { throw new Error("gateway should not be used"); } },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const response = await fetch(`http://127.0.0.1:${app.server.address().port}/api/codex/usage`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), snapshot);
});

test("personal filesystem API browses configured Windows and Belmont roots without write or escape", async (context) => {
  const sandbox = await fs.mkdtemp(join(tmpdir(), "linear-personal-files-"));
  const belmontRoot = join(sandbox, "Belmont");
  const windowsMountRoot = join(sandbox, "mnt");
  const outside = join(sandbox, "outside");
  await fs.mkdir(join(belmontRoot, "docs"), { recursive: true });
  await fs.mkdir(join(belmontRoot, "many"), { recursive: true });
  await fs.mkdir(join(windowsMountRoot, "c", "Users", "HOON"), { recursive: true });
  await fs.mkdir(join(windowsMountRoot, "wslg"), { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(join(belmontRoot, "docs", "note.txt"), "Belmont private file\n", "utf8");
  await fs.writeFile(join(windowsMountRoot, "c", "Users", "HOON", "windows.txt"), "Windows private file\n", "utf8");
  await fs.writeFile(join(outside, "escape.txt"), "must not escape\n", "utf8");
  await Promise.all(Array.from({ length: 501 }, (_, index) => fs.writeFile(join(belmontRoot, "many", `file-${String(index).padStart(3, "0")}.txt`), "x", "utf8")));
  await fs.symlink(outside, join(belmontRoot, "outside-link"));

  const gateway = { async managerId() { return null; }, async call() { throw new Error("gateway should not be used"); } };
  const lockedApp = createMobileServer({
    gateway,
    pairingCode: "314159",
    sessionFile: null,
    filesystemRoots: { belmontRoot, windowsMountRoot },
  });
  lockedApp.server.listen(0, "127.0.0.1");
  await once(lockedApp.server, "listening");
  context.after(() => lockedApp.server.close());
  assert.equal((await fetch(`http://127.0.0.1:${lockedApp.server.address().port}/api/filesystem/list?scope=belmont&path=`)).status, 401);

  const app = createMobileServer({
    gateway,
    skipPairing: true,
    sessionFile: null,
    filesystemRoots: { belmontRoot, windowsMountRoot },
  });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(async () => { app.server.close(); await fs.rm(sandbox, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${app.server.address().port}`;

  const windows = await fetch(`${base}/api/filesystem/list?scope=windows&path=`).then((response) => response.json());
  assert.deepEqual(windows.entries.map((entry) => [entry.name, entry.path, entry.type]), [["C:", "c", "directory"]]);
  const windowsUser = await fetch(`${base}/api/filesystem/list?scope=windows&path=c%2FUsers%2FHOON`).then((response) => response.json());
  assert.equal(windowsUser.displayPath, "C:\\Users\\HOON");
  assert.equal(windowsUser.entries[0].name, "windows.txt");

  const belmont = await fetch(`${base}/api/filesystem/list?scope=belmont&path=`).then((response) => response.json());
  assert.equal(belmont.displayPath, "Belmont");
  assert.ok(belmont.entries.some((entry) => entry.name === "docs" && entry.type === "directory"));
  assert.ok(belmont.entries.some((entry) => entry.name === "outside-link" && entry.type === "link"));
  const firstPage = await fetch(`${base}/api/filesystem/list?scope=belmont&path=many`).then((response) => response.json());
  assert.equal(firstPage.totalEntries, 501);
  assert.equal(firstPage.entries.length, 500);
  assert.equal(firstPage.nextOffset, 500);
  const secondPage = await fetch(`${base}/api/filesystem/list?scope=belmont&path=many&offset=500`).then((response) => response.json());
  assert.equal(secondPage.entries.length, 1);
  assert.equal(secondPage.nextOffset, null);

  const preview = await fetch(`${base}/api/filesystem/preview?scope=belmont&path=docs%2Fnote.txt`).then((response) => response.json());
  assert.equal(preview.kind, "text");
  assert.equal(preview.text, "Belmont private file\n");
  assert.equal(await fetch(`${base}/api/filesystem/content?scope=windows&path=c%2FUsers%2FHOON%2Fwindows.txt`).then((response) => response.text()), "Windows private file\n");

  assert.equal((await fetch(`${base}/api/filesystem/list?scope=belmont&path=..%2Foutside`)).status, 400);
  assert.equal((await fetch(`${base}/api/filesystem/list?scope=belmont&path=outside-link`)).status, 403);
  assert.equal((await fetch(`${base}/api/filesystem/list?scope=belmont&path=`, { method: "POST" })).status, 404);
});

test("agent projection keeps desktop state and assigns a stable BabyGrok avatar", () => {
  const source = {
    id: "bot-research",
    name: "Research Bot",
    description: "Find evidence",
    isRunningTurn: true,
    unreadCount: 3,
    awaitingUserResponse: true,
  };
  const first = projectAgent(source, { managerId: "bot-research", pinnedIds: [] });
  const second = projectAgent(source, { managerId: "bot-research", pinnedIds: [] });
  assert.deepEqual(first.avatar, second.avatar);
  assert.equal(first.isManager, true);
  assert.equal(first.isPinned, true);
  assert.equal(first.isRunning, true);
  assert.equal(first.unreadCount, 3);
  assert.equal(first.awaitingUserResponse, true);
});

test("transcript projection restores text, widget, approval, permission, and attachment cards", () => {
  const entries = projectTranscriptEntries([
    { id: "t1", role: "user", content: "hello", timestampMs: 1 },
    { id: "w1", message: { type: "widget", widget: { prompt: "Choose", options: [{ label: "A", value: "a" }] } }, timestampMs: 2 },
    { id: "a1", message: { type: "auto-review-approval", approval: { requestId: "r1", summary: "Run task", status: "pending" } }, timestampMs: 3 },
    { id: "p1", message: { type: "local-tool-permission", ask: { requestId: "r2", action: "write", target: "file", status: "pending" } }, timestampMs: 4 },
    { id: "f1", kind: "user-attachment", file_name: "brief.pdf", byteSize: 128, timestampMs: 5 },
  ], "bot-1");
  assert.deepEqual(entries.map((entry) => entry.type), ["text", "widget", "approval", "local-permission", "attachment"]);
  assert.equal(entries[1].answered, null, "an open widget carries no answer");
  assert.equal(entries[2].requestId, "r1");
  assert.equal(entries[3].target, "file");
  assert.equal(entries[4].name, "brief.pdf");
});

test("transcript projection keeps peer-agent traffic out of ordinary chat bubbles", () => {
  const entries = projectTranscriptEntries([
    { id: "out", role: "assistant", content: "[job:t9] Check the browser", toAgent: { id: "browser", name: "브라우저" }, timestampMs: 1 },
    { id: "error", role: "user", content: "[브라우저 봇 오류] request failed", fromAgent: { id: "browser", name: "브라우저" }, timestampMs: 2 },
    { id: "permission", message: { type: "local-tool-permission", ask: { requestId: "p1", status: "expired" } }, timestampMs: 3 },
    { id: "duplicate", message: { type: "text", content: "The local-computer permission request above expired without an answer — nothing ran on your computer." }, timestampMs: 4 },
    { id: "answer", message: { type: "text", content: "완료했습니다." }, timestampMs: 5 },
  ], "manager");
  assert.deepEqual(entries.map((entry) => entry.type), ["agent-activity", "agent-activity", "local-permission", "text"]);
  assert.deepEqual(entries[0], {
    id: "out",
    type: "agent-activity",
    role: "assistant",
    timestampMs: 1,
    agentId: "browser",
    agentName: "브라우저",
    direction: "outgoing",
    content: "[job:t9] Check the browser",
    jobId: "t9",
    isError: false,
  });
  assert.equal(entries[1].direction, "incoming");
  assert.equal(entries[1].isError, true);
  assert.equal(entries[3].content, "완료했습니다.");
});

test("pairing guard applies retry delay and a shared cooldown after repeated failures", () => {
  let now = 10_000;
  const guard = createPairingGuard({ code: "314159", now: () => now });
  for (let index = 0; index < 5; index += 1) {
    const result = guard.verify("000000", "client-a");
    assert.equal(result.ok, false);
    assert.ok(result.retryAfterMs > 0);
  }
  const blocked = guard.verify("000000", "client-a");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.retryAfterMs, 60_000);
  assert.equal(guard.verify("314159", "client-a").ok, false);
  now += 60_001;
  assert.equal(guard.verify("314159", "client-a").ok, true);
});

test("mobile HTTP adapter calls Belmont gateway contracts without the old PWA", async (context) => {
  const calls = [];
  const gateway = {
    async managerId() { return "manager"; },
    async call(method, args = {}) {
      calls.push({ method, args });
      if (method === "listAgents") return [{ id: "manager", name: "Belmont", lastMessagePreview: "Ready" }, { id: "worker", name: "Worker" }];
      if (method === "getHostSettings") return { notifications: { isEnabled: true }, localToolPermission: "ask", pinnedAgentIds: ["worker"] };
      if (method === "getHostStatus") return { latestHostVersion: "0.30", hostUpdateAvailable: false, isBusy: false };
      if (method === "getPluginSyncStatus") return { authBlocked: [] };
      if (method === "getAgentTranscriptTail") return { entries: [{ id: "m1", role: "assistant", content: "Connected", timestampMs: 10 }], nextBeforeSeq: null };
      if (method === "uploadAttachment") return { path: "/tmp/brief.txt" };
      if (method === "sendPrompt") return { accepted: true };
      if (method === "respondToWidget" || method === "resolveAutoReviewApproval" || method === "resolveLocalToolPermission" || method === "setAgentHiddenFromSidebar") return null;
      if (method === "setHostSettings") return {};
      if (method === "getForeverBoxStatus") return { state: "idle", vncUrl: null };
      if (method === "createAgent") return { id: "created" };
      throw new Error(`Unexpected method ${method}`);
    },
    async events() { return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } }); },
  };
  const app = createMobileServer({ gateway, skipPairing: true, sessionFile: null, sendLedgerFile: null });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const address = app.server.address();
  assert.equal(typeof address, "object");
  const base = `http://127.0.0.1:${address.port}`;

  const session = await fetch(`${base}/api/session`).then((response) => response.json());
  assert.deepEqual(session, { paired: true, pairingRequired: false });

  const roster = await fetch(`${base}/api/bots`).then((response) => response.json());
  assert.equal(roster.bots.length, 2);
  assert.equal(roster.bots[0].isManager, true);
  assert.equal(roster.bots[1].isPinned, true);

  const transcript = await fetch(`${base}/api/bots/worker/messages`).then((response) => response.json());
  assert.equal(transcript.entries[0].content, "Connected");

  const send = await fetch(`${base}/api/bots/worker/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Review this", clientNonce: "nonce-1", attachments: [{ name: "brief.txt", bytesBase64: "aGVsbG8=" }] }),
  });
  assert.equal(send.status, 202);
  const sendCall = calls.find((call) => call.method === "sendPrompt");
  assert.deepEqual(sendCall.args.attachmentPaths, ["/tmp/brief.txt"]);
  assert.equal(sendCall.args.agentId, "worker");
  assert.equal(sendCall.args.prompt, "Review this");

  const approval = await fetch(`${base}/api/bots/worker/approvals/entry-1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "local-permission", requestId: "request-1", resolution: "allow-once" }),
  });
  assert.equal(approval.status, 200);
  assert.ok(calls.some((call) => call.method === "resolveLocalToolPermission" && call.args.resolution === "allow-once"));

  const hidden = await fetch(`${base}/api/bots/worker/hidden`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hidden: true }),
  });
  assert.equal(hidden.status, 200);
  assert.ok(calls.some((call) => call.method === "setAgentHiddenFromSidebar" && call.args.id === "worker" && call.args.isHidden === true));

  const created = await fetch(`${base}/api/bots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Research", description: "Find sources", shape: "gem", color: "violet", clientNonce: "nonce-create" }),
  });
  assert.equal(created.status, 201);
  assert.ok(calls.some((call) => call.method === "createAgent" && call.args.name === "Research" && call.args.avatarShape === "gem" && call.args.avatarColor === "violet"));

  const widget = await fetch(`${base}/api/bots/worker/widgets/widget-1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ value: "choice-a" }),
  });
  assert.equal(widget.status, 200);
  assert.ok(calls.some((call) => call.method === "respondToWidget" && call.args.entryId === "widget-1" && call.args.value === "choice-a"));

  const autoApproval = await fetch(`${base}/api/bots/worker/approvals/approval-1`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "approval", requestId: "request-auto", resolution: "approved" }),
  });
  assert.equal(autoApproval.status, 200);
  assert.ok(calls.some((call) => call.method === "resolveAutoReviewApproval" && call.args.entryId === "approval-1" && call.args.resolution === "approved"));

  const settings = await fetch(`${base}/api/settings`).then((response) => response.json());
  assert.equal(settings.localToolPermission, "ask");
  const updatedSettings = await fetch(`${base}/api/settings`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ key: "notificationsEnabled", value: false }),
  });
  assert.equal(updatedSettings.status, 200);
  assert.ok(calls.some((call) => call.method === "setHostSettings" && call.args.notifications.isEnabled === false));
});

test("extended mobile surfaces bind threads, groups, reactions, attachments, routines, and tools", async (context) => {
  const calls = [];
  let routines = [{ id: "routine-1", name: "Briefing", prompt: "Summarize", trigger: { type: "cron", schedule: "0 9 * * 1-5" }, triggerDescription: "Weekdays", isEnabled: true, runs: [] }];
  const gateway = {
    async managerId() { return "manager"; },
    async call(method, args = {}) {
      calls.push({ method, args });
      if (method === "getAgentThread") return { entries: [{ id: "root", role: "user", content: "Root", timestampMs: 1 }, { id: "reply", role: "assistant", content: "Reply", replyToId: "root", timestampMs: 2 }] };
      if (["reactToMessage", "setAgentNotifyOnUpdates", "runAgentAutomationNow"].includes(method)) return null;
      if (method === "updateAgent") return { id: args.id, name: args.profile.name, description: args.profile.description };
      if (method === "createGroup") return { agent: { id: "group-1", name: args.name, isGroup: true, memberIds: args.memberAgentIds } };
      if (method === "setGroupMembers") return { id: args.id, name: "Team", isGroup: true, memberIds: args.memberAgentIds };
      if (method === "searchAgents") return [{ agentId: "manager", entryId: "entry-1", role: "assistant", timestampMs: 3, snippet: "Search hit" }];
      if (method === "searchMedia") return [{ agentId: "manager", entryId: "file-1", fileName: "note.md", ext: "md", mime: "text/markdown", kind: "markdown", timestampMs: 4 }];
      if (method === "readAttachmentText") return { kind: "text", text: "# Real document", bytes: 15, truncated: false };
      if (method === "readAttachmentChunk") return { bytesBase64: Buffer.from("attachment bytes").toString("base64"), totalSize: 16, mime: "text/plain" };
      if (method === "uploadAttachment") return { path: "/uploaded/note.txt" };
      if (method === "sendPrompt") return { accepted: true };
      if (method === "getAgentAutomations") return routines;
      if (method === "createAgentAutomation") { routines = [...routines, { id: "routine-2", ...args.spec, triggerDescription: "Daily", runs: [] }]; return routines; }
      if (method === "updateAgentAutomation") { routines = routines.map((item) => item.id === args.automationId ? { ...item, ...args.spec } : item); return routines; }
      if (method === "setAgentAutomationEnabled") { routines = routines.map((item) => item.id === args.automationId ? { ...item, isEnabled: args.isEnabled } : item); return null; }
      if (method === "deleteAgentAutomation") { routines = routines.filter((item) => item.id !== args.automationId); return null; }
      if (method === "skillsCatalog") return [{ id: "browser", name: "Browser", description: "Browse", source: "builtin" }];
      if (method === "listRoutedMcpTools") return [{ name: "search", providerIdentifier: "browser", toolName: "search", description: "Search" }];
      if (method === "resetForeverBox" || method === "getForeverBoxStatus") return { state: "idle", vncUrl: null, windows: [] };
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const app = createMobileServer({ gateway, skipPairing: true });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const address = app.server.address();
  assert.equal(typeof address, "object");
  const base = `http://127.0.0.1:${address.port}`;
  const jsonHeaders = { "content-type": "application/json" };

  const thread = await fetch(`${base}/api/bots/manager/threads/root`).then((response) => response.json());
  assert.deepEqual(thread.entries.map((entry) => entry.content), ["Root", "Reply"]);
  assert.equal((await fetch(`${base}/api/bots/manager/messages/root/reaction`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ emoji: "👍" }) })).status, 200);
  assert.equal((await fetch(`${base}/api/bots/manager/profile`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ profile: { name: "Belmont", description: "Chief" } }) })).status, 200);
  assert.equal((await fetch(`${base}/api/bots/manager/notifications`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ enabled: false }) })).status, 200);
  const group = await fetch(`${base}/api/groups`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ name: "Team", memberAgentIds: ["a", "b"] }) }).then((response) => response.json());
  assert.equal(group.bot.id, "group-1");
  assert.equal((await fetch(`${base}/api/bots/group-1/members`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ memberAgentIds: ["a", "b", "c"] }) })).status, 200);
  assert.equal((await fetch(`${base}/api/search/messages?query=search`).then((response) => response.json())).results[0].snippet, "Search hit");
  assert.equal((await fetch(`${base}/api/search/media?query=note`).then((response) => response.json())).results[0].fileName, "note.md");
  const attachment = { agentId: "manager", path: "/files/note.md", name: "note.md", byteSize: 15, kind: "markdown" };
  const preview = await fetch(`${base}/api/attachments/preview`, { method: "POST", headers: jsonHeaders, body: JSON.stringify(attachment) }).then((response) => response.json());
  assert.equal(preview.text, "# Real document");
  assert.equal((await fetch(`${base}/api/attachments/share`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ ...attachment, targetAgentId: "target" }) })).status, 202);
  assert.equal((await fetch(`${base}/api/bots/manager/routines`).then((response) => response.json())).routines.length, 1);
  assert.equal((await fetch(`${base}/api/bots/manager/routines`, { method: "POST", headers: jsonHeaders, body: JSON.stringify({ spec: { name: "New", prompt: "Do", trigger: { type: "cron", schedule: "0 8 * * *" }, isEnabled: true } }) }).then((response) => response.json())).routines.length, 2);
  assert.equal((await fetch(`${base}/api/skills?query=browser`).then((response) => response.json())).skills[0].name, "Browser");
  assert.equal((await fetch(`${base}/api/tools`).then((response) => response.json())).tools[0].providerIdentifier, "browser");
  assert.equal((await fetch(`${base}/api/bots/manager/computer/reset`, { method: "POST", headers: jsonHeaders, body: "{}" })).status, 200);

  for (const method of ["getAgentThread", "reactToMessage", "createGroup", "setGroupMembers", "readAttachmentText", "readAttachmentChunk", "createAgentAutomation", "skillsCatalog", "listRoutedMcpTools", "resetForeverBox"]) {
    assert.ok(calls.some((call) => call.method === method), `${method} must be called`);
  }
});

test("computer WebSocket bridge carries noVNC bytes in both directions", { timeout: 5_000 }, async (context) => {
  const upstream = new WebSocketServer({
    host: "127.0.0.1",
    port: 0,
    verifyClient: (_info, done) => setTimeout(() => done(true), 80),
  });
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  assert.equal(typeof upstreamAddress, "object");
  upstream.on("connection", (socket) => socket.on("message", (data, binary) => socket.send(data, { binary })));

  const gateway = {
    async managerId() { return "worker"; },
    async call(method) {
      if (method === "getForeverBoxStatus") return { state: "running", vncUrl: `http://127.0.0.1:${upstreamAddress.port}/vnc.html?path=websockify`, windows: [{ windowIndex: 0, vncUrl: "ready" }] };
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const app = createMobileServer({ gateway, skipPairing: true });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const mobileAddress = app.server.address();
  assert.equal(typeof mobileAddress, "object");
  context.after(() => {
    app.server.close();
    upstream.close();
  });

  const status = await fetch(`http://127.0.0.1:${mobileAddress.port}/api/bots/worker/computer`).then((response) => response.json());
  assert.equal(status.ready, true);
  const client = new WebSocket(`ws://127.0.0.1:${mobileAddress.port}/api/bots/worker/computer/websockify`);
  await once(client, "open");
  client.send(Buffer.from([0x52, 0x46, 0x42]));
  const [message] = await once(client, "message");
  assert.deepEqual([...message], [0x52, 0x46, 0x42]);
  client.close();
  await once(client, "close");
});

test("computer asset proxy supplies noVNC metadata omitted by system packages", async (context) => {
  const upstream = http.createServer((request, response) => {
    if (request.url?.startsWith("/vnc.html")) {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<script type=\"module\" src=\"/app/ui.js\"></script>");
      return;
    }
    response.writeHead(404);
    response.end("missing");
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const upstreamAddress = upstream.address();
  assert.equal(typeof upstreamAddress, "object");

  const gateway = {
    async managerId() { return "worker"; },
    async call(method) {
      if (method === "getForeverBoxStatus") return { state: "running", vncUrl: `http://127.0.0.1:${upstreamAddress.port}/vnc.html?path=websockify` };
      throw new Error(`Unexpected method ${method}`);
    },
  };
  const app = createMobileServer({ gateway, skipPairing: true });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const mobileAddress = app.server.address();
  assert.equal(typeof mobileAddress, "object");
  context.after(() => {
    app.server.close();
    upstream.close();
  });

  const status = await fetch(`http://127.0.0.1:${mobileAddress.port}/api/bots/worker/computer`).then((response) => response.json());
  assert.equal(status.ready, true);

  const html = await fetch(`http://127.0.0.1:${mobileAddress.port}/api/bots/worker/computer/proxy/vnc.html`).then((response) => response.text());
  assert.match(html, /\/api\/bots\/worker\/computer\/proxy\/app\/ui\.js/);

  const packageResponse = await fetch(`http://127.0.0.1:${mobileAddress.port}/api/bots/worker/computer/proxy/package.json`);
  assert.equal(packageResponse.status, 200);
  assert.deepEqual(await packageResponse.json(), { name: "noVNC", version: "system-package" });
});

test("thread replies expose the desktop's replyTo link and transient subagents stay off the roster", async () => {
  const { threadParentId, isTransientSubagent } = await import("../server.mjs");
  assert.equal(threadParentId({ id: "t2", replyTo: "t1" }), "t1");
  assert.equal(threadParentId({ id: "t3", message: { type: "text", content: "x", reply_to: "t2" } }), "t2");
  assert.equal(threadParentId({ id: "t4", replyToId: "t0" }), "t0");
  assert.equal(threadParentId({ id: "t1" }), null);
  const [reply] = projectTranscriptEntries([{ kind: "message", id: "t2", role: "user", content: "답글", timestampMs: 1, replyTo: "t1", branched: true }], "bot-1");
  assert.equal(reply.replyToId, "t1");
  assert.equal(reply.branched, true);
  assert.equal(isTransientSubagent({ id: "subagent-dda62c6f", name: "New Agent" }), true);
  assert.equal(isTransientSubagent({ id: "40fb61e3", name: "Belmont" }), false);
});

test("a setting the desktop silently keeps comes back as 409 instead of a switch that snaps back", async (context) => {
  const gateway = {
    async managerId() { return "manager"; },
    async call(method) {
      if (method === "getHostSettings") return { notifications: { isEnabled: false }, localToolPermission: "ask" };
      if (method === "getHostStatus") return {};
      if (method === "getPluginSyncStatus") return {};
      // This desktop build pins OS notifications off: the update is acknowledged with the old value.
      if (method === "setHostSettings") return { notifications: { isEnabled: false }, localToolPermission: "ask" };
      throw new Error(`Unexpected method ${method}`);
    },
    async events() { return new Response("", { status: 200 }); },
  };
  const app = createMobileServer({ gateway, skipPairing: true });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const refused = await fetch(`${base}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "notificationsEnabled", value: true }) });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /알림/);
  const accepted = await fetch(`${base}/api/settings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "localToolPermission", value: "ask" }) });
  assert.equal(accepted.status, 200);
});

test("viewing a conversation on the phone clears the desktop unread badge", async (context) => {
  const calls = [];
  const gateway = {
    async managerId() { return "manager"; },
    async call(method, args = {}) {
      calls.push({ method, args });
      if (method === "setAgentUnread") return null;
      throw new Error(`Unexpected method ${method}`);
    },
    async events() { return new Response("", { status: 200 }); },
  };
  const app = createMobileServer({ gateway, skipPairing: true });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const response = await fetch(`${base}/api/bots/worker/read`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(response.status, 200);
  const call = calls.find((item) => item.method === "setAgentUnread");
  assert.ok(call, "setAgentUnread was called");
  assert.equal(call.args.id, "worker");
  assert.equal(call.args.isUnread, false);
  assert.equal(typeof call.args.atMs, "number");
});

test("the proxied noVNC page hides its own side bar so the app toolbar is the only chrome", async () => {
  const { brandViewerHtml, VIEWER_CHROME_STYLE } = await import("../server.mjs");
  const page = brandViewerHtml("<html><head><title>noVNC</title></head><body></body></html>");
  assert.ok(page.includes('id="linear-vnc-chrome"'));
  assert.ok(page.indexOf(VIEWER_CHROME_STYLE) < page.indexOf("</head>"));
  assert.match(page, /#noVNC_control_bar_anchor[^{]*\{display:none!important\}/);
  assert.equal(brandViewerHtml(page), page, "injecting twice is a no-op");
});

test("the proxied noVNC gesture handler starts drags sooner than the stock 50 px dead zone", async () => {
  const { tuneViewerScript, VIEWER_DRAG_THRESHOLD_PX } = await import("../server.mjs");
  const stock = "const GH_NOGESTURE = 0;\nconst GH_MOVE_THRESHOLD = 50;\nconst GH_ANGLE_THRESHOLD = 90;";
  assert.match(tuneViewerScript("/core/input/gesturehandler.js", stock), new RegExp(`GH_MOVE_THRESHOLD = ${VIEWER_DRAG_THRESHOLD_PX};`));
  assert.equal(tuneViewerScript("/core/rfb.js", stock), stock, "other scripts are untouched");
});

test("an answered widget carries the chosen value so the phone can retire its buttons", () => {
  // 2026-09-05: the parked-task card kept showing 이어가기 / 그만두기 after the tap because the
  // projection dropped the host's respondedValue.
  const entries = projectTranscriptEntries([
    { id: "w1", kind: "send-message", message: { type: "widget", widget: { prompt: "계속?", options: [{ label: "이어가기", value: "이어가기" }, { label: "그만두기", value: "그만두기" }] } }, timestampMs: 2, respondedValue: "그만두기" },
    { id: "w2", kind: "send-message", message: { type: "widget", widget: { prompt: "다시?", options: [{ label: "A", value: "a" }] } }, timestampMs: 3, respondedValue: "" },
  ], "bot");
  assert.equal(entries[0].answered, "그만두기");
  assert.equal(entries[1].answered, null, "an empty value is not an answer");
});

// ---- 2026-09-05: the recovered screens that only wrote localStorage now reach the host ----
import { AVAILABLE_MODELS, appendFeedback, exportBotTemplate, formatFormPrompt, importBotTemplate, normalizeModelSelection } from "../server.mjs";

test("model selections are normalized against the local Codex catalog", () => {
  assert.deepEqual(normalizeModelSelection({ modelId: "gpt-5.6-luna", effort: "max", maxMode: true }), { modelId: "gpt-5.6-luna", maxMode: true, parameters: [{ id: "effort", value: "max" }] });
  assert.deepEqual(normalizeModelSelection({ modelId: "gpt-5.6-sol", parameters: [{ id: "effort", value: "high" }] }), { modelId: "gpt-5.6-sol", maxMode: false, parameters: [{ id: "effort", value: "high" }] });
  assert.equal(normalizeModelSelection({ modelId: "gpt-5.6-sol", effort: "max" }), null, "sol has no max");
  assert.equal(normalizeModelSelection({ modelId: "gpt-9" }), null);
  assert.ok(AVAILABLE_MODELS.some((model) => model.id === "gpt-5.6-luna" && model.efforts.includes("max")));
});

test("the 추가 정보 form becomes one user message with the filled fields only", () => {
  assert.equal(formatFormPrompt({ fields: { "프로젝트 이름": "Linear Mobile", "우선순위": "높음", "메모": "" }, note: "이번 주 안에" }), "[추가 정보] 요청하신 정보야.\n- 프로젝트 이름: Linear Mobile\n- 우선순위: 높음\n이번 주 안에");
  assert.equal(formatFormPrompt({ fields: { a: "  " } }), null);
  assert.equal(formatFormPrompt({ fields: [{ label: "이름", value: "Hoon" }] }), "[추가 정보] 요청하신 정보야.\n- 이름: Hoon");
});

test("feedback, ratings and reports are appended to the host-side log", async () => {
  const dir = await fs.mkdtemp(join(tmpdir(), "linear-feedback-"));
  await appendFeedback(dir, { kind: "rating", rating: 5 }, () => 111);
  await appendFeedback(dir, { kind: "report", category: "잘못된 결과", detail: "숫자가 틀림", botId: "b1", entryId: "e1" }, () => 222);
  await assert.rejects(() => appendFeedback(dir, { kind: "praise" }), /kind/);
  await assert.rejects(() => appendFeedback(dir, { kind: "feedback" }), /비어/);
  const lines = (await fs.readFile(join(dir, "mobile-feedback.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(lines, [{ kind: "rating", createdAt: 111, rating: 5 }, { kind: "report", createdAt: 222, category: "잘못된 결과", detail: "숫자가 틀림", botId: "b1", entryId: "e1" }]);
});

test("a bot exports as a template: persona, the skills enabled for it, and its routines", async () => {
  const gateway = { async managerId() { return "m"; }, async call(method, args) {
    if (method === "listAgents") return [{ id: "m", name: "Belmont", description: "manager persona", avatarShape: "cloud", avatarColor: "green" }];
    if (method === "getAgentWorkflows") { assert.equal(args.id, "m"); return [
      { id: "gmail", name: "Gmail 정리", description: "받은편지함", body: "# Gmail", source: "workflow", trigger: null, isEnabledForAgent: true },
      { id: "code", name: "Code", description: "x", body: "# code", source: "workflow", trigger: null, isEnabledForAgent: false },
      { id: "sweeper", name: "Job sweeper", description: "", body: "…", source: "automation", trigger: { type: "cron" }, isEnabledForAgent: true },
    ]; }
    if (method === "getAgentAutomations") return [{ id: "sweeper", name: "Job sweeper", prompt: "sweep", schedule: "@every 15m", isEnabled: true }];
    throw new Error(`unexpected ${method}`);
  } };
  const template = await exportBotTemplate(gateway, "m");
  assert.equal(template.name, "Belmont");
  assert.deepEqual(template.avatar, { shape: "cloud", color: "green" });
  assert.deepEqual(template.skills.map((skill) => skill.id), ["gmail"], "disabled skills and automations are not part of the template");
  assert.deepEqual(template.routines, [{ name: "Job sweeper", prompt: "sweep", schedule: "@every 15m", isEnabled: true }]);
  await assert.rejects(() => exportBotTemplate(gateway, "nope"), /찾을 수 없습니다/);
});

test("importing a template creates the bot, adds its skills to the library enabled for that bot only, and pauses its routines", async () => {
  const calls = [];
  let workflowsAfter = false;
  const gateway = { async managerId() { return "m"; }, async call(method, args) {
    calls.push({ method, args });
    if (method === "createAgent") return { agent: { id: "new-bot" } };
    if (method === "getAgentWorkflows") return workflowsAfter ? [{ id: "research" }, { id: "gmail-2" }] : [{ id: "research" }];
    if (method === "importAgentWorkflowText") { workflowsAfter = true; return { workflows: [{ id: "gmail-2", isEnabledForAgent: true }], result: { imported: [{ id: "gmail-2", name: args.name }], skipped: [] } }; }
    if (method === "listAgents") return [{ id: "new-bot", name: "Clone" }, { id: "m", name: "Belmont" }, { id: "g", name: "Group", isGroup: true }];
    if (method === "setAgentWorkflowEnabled") return [{ id: args.workflowId, isEnabledForAgent: false }];
    if (method === "getAgentAutomations") return [];
    if (method === "createAgentAutomation") return [{ ...args.spec, id: "routine-1" }];
    throw new Error(`unexpected ${method}`);
  } };
  const result = await importBotTemplate(gateway, { name: "Clone", template: JSON.stringify({ name: "Belmont", description: "persona", avatar: { shape: "cloud", color: "green" }, skills: [{ name: "Gmail 정리", description: "받은편지함", body: "# Gmail\n절차" }], routines: [{ name: "아침 브리핑", prompt: "brief", schedule: "0 8 * * 1-5", isEnabled: true }] }) }, { now: () => 5 });
  assert.deepEqual(result, { bot: { id: "new-bot", name: "Clone" }, status: "complete", skills: ["Gmail 정리"], newWorkflowIds: ["gmail-2"], routines: ["아침 브리핑"], issues: [], source: "template", adaptation: { status: "not_requested" } });
  const created = calls.find((call) => call.method === "createAgent");
  assert.equal(created.args.name, "Clone");
  assert.equal(created.args.avatarShape, "cloud");
  const imported = calls.find((call) => call.method === "importAgentWorkflowText");
  assert.match(imported.args.markdown, /^---\nname: "Gmail 정리"\ndescription: "받은편지함"\n---\n# Gmail\n절차\n$/);
  assert.deepEqual(calls.filter((call) => call.method === "setAgentWorkflowEnabled").map((call) => [call.args.id, call.args.workflowId, call.args.isEnabled]), [["new-bot", "research", false], ["m", "gmail-2", false]], "the new bot loses inherited defaults and other bots (not groups) get the new skill switched off");
  const routine = calls.find((call) => call.method === "createAgentAutomation");
  assert.deepEqual(routine.args.spec, { name: "아침 브리핑", prompt: "brief", trigger: { type: "cron", schedule: "0 8 * * 1-5" }, isEnabled: false });
  await assert.rejects(() => importBotTemplate(gateway, { template: "{" }), /템플릿/);
  await assert.rejects(() => importBotTemplate(gateway, { url: "https://example.com/x" }, { fetchText: async () => "" }), /x\.ai/);
});

test("form, memories, per-bot model, feedback and the new settings keys reach the gateway", async (context) => {
  const calls = [];
  const dir = await fs.mkdtemp(join(tmpdir(), "linear-mobile-hooks-"));
  const app = createMobileServer({ skipPairing: true, sessionFile: null, profileDir: dir, now: () => 42, gateway: { async managerId() { return "m"; }, async call(method, args) {
    calls.push({ method, args });
    if (method === "getHostSettings") return { userTimeZone: "Asia/Seoul", notifications: { isEnabled: true }, autoReviewInstructions: { isEnabled: true, allowInstructions: [], blockInstructions: [] }, localToolPermission: "ask", userLanguage: "한국어", agentDefaultModel: { modelId: "gpt-5.5", maxMode: true, parameters: [{ id: "effort", value: "high" }] } };
    if (method === "getHostStatus") return { isBusy: false };
    if (method === "getPluginSyncStatus") return {};
    if (method === "setHostSettings") return { ...args };
    if (method === "getAgentMemories") return [{ id: "mem-1", content: "x", createdAt: 1, kind: "profile" }];
    if (method === "addAgentMemory") return { id: "mem-2", content: args.content, createdAt: 2, kind: args.tier };
    if (method === "getAgentModelSelection") return { id: args.id, selection: null, defaultSelection: null };
    if (method === "setAgentModelSelection") return { id: args.id, selection: args.selection };
    return { ok: true };
  } } });
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  context.after(() => app.server.close());
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (path, body, method = "POST") => fetch(`${base}${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  const form = await post("/api/bots/m/form", { fields: { "프로젝트 이름": "Linear" } });
  assert.equal(form.status, 200);
  const sent = calls.find((call) => call.method === "sendPrompt");
  assert.equal(sent.args.agentId, "m");
  assert.match(sent.args.prompt, /- 프로젝트 이름: Linear/);
  assert.equal((await post("/api/bots/m/form", { fields: {} })).status, 400);

  const memory = await post("/api/bots/m/memories", { content: "자동 완성 \"업무\": 이름 Hoon", tier: "profile" });
  assert.equal(memory.status, 201);
  assert.deepEqual((await memory.json()).memory.id, "mem-2");
  assert.ok(calls.some((call) => call.method === "addAgentMemory" && call.args.tier === "profile"));
  assert.equal((await post("/api/bots/m/memories", { content: " " })).status, 400);
  assert.equal((await fetch(`${base}/api/bots/m/memories/mem-2`, { method: "DELETE" })).status, 200);
  assert.ok(calls.some((call) => call.method === "deleteAgentMemory" && call.args.memoryId === "mem-2"));
  assert.equal((await fetch(`${base}/api/bots/m/memories`).then((response) => response.json())).memories.length, 1);

  const modelGet = await fetch(`${base}/api/bots/m/model`).then((response) => response.json());
  assert.equal(modelGet.models.length, AVAILABLE_MODELS.length);
  assert.equal((await post("/api/bots/m/model", { selection: { modelId: "gpt-5.6-sol", effort: "max" } })).status, 400);
  const modelSet = await post("/api/bots/m/model", { selection: { modelId: "gpt-5.6-luna", effort: "max", maxMode: true } });
  assert.equal(modelSet.status, 200);
  assert.deepEqual(calls.find((call) => call.method === "setAgentModelSelection").args, { id: "m", selection: { modelId: "gpt-5.6-luna", maxMode: true, parameters: [{ id: "effort", value: "max" }] } });
  assert.equal((await post("/api/bots/m/model", { selection: null })).status, 200);

  assert.equal((await post("/api/feedback", { kind: "feedback", category: "아이디어", detail: "더 빠르게" })).status, 201);
  assert.match(await fs.readFile(join(dir, "mobile-feedback.jsonl"), "utf8"), /"detail":"더 빠르게"/);

  const settings = await fetch(`${base}/api/settings`).then((response) => response.json());
  assert.equal(settings.userLanguage, "한국어");
  assert.equal(settings.agentDefaultModel.modelId, "gpt-5.5");
  assert.equal(settings.models.length, AVAILABLE_MODELS.length);
  assert.equal((await post("/api/settings", { key: "userLanguage", value: "English" })).status, 200);
  assert.ok(calls.some((call) => call.method === "setHostSettings" && call.args.userLanguage === "English"));
  assert.equal((await post("/api/settings", { key: "userTimeZone", value: "Asia/Tokyo" })).status, 200);
  assert.ok(calls.some((call) => call.method === "setHostSettings" && call.args.userTimeZone === "Asia/Tokyo" && call.args.userTimeZoneOverride === "Asia/Tokyo"));
  assert.equal((await post("/api/settings", { key: "userTimeZone", value: "Mars/Olympus" })).status, 400);
  assert.equal((await post("/api/settings", { key: "agentDefaultModel", value: { modelId: "gpt-5.6-terra", effort: "high" } })).status, 200);
  assert.ok(calls.some((call) => call.method === "setHostSettings" && call.args.agentDefaultModel?.modelId === "gpt-5.6-terra"));
  assert.equal((await post("/api/settings", { key: "agentDefaultModel", value: null })).status, 200);
});
