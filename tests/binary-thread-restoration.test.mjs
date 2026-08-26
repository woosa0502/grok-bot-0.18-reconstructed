import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadModule(entry) {
  const temporaryRoot = path.join(repoRoot, ".build");
  await mkdir(temporaryRoot, { recursive: true });
  const temporary = await mkdtemp(path.join(temporaryRoot, "test-thread-restoration-"));
  const output = path.join(temporary, "module.mjs");
  await build({
    entryPoints: [path.join(repoRoot, entry)],
    outfile: output,
    bundle: true,
    external: ["react", "react-dom", "react-dom/server", "react/jsx-runtime"],
    format: "esm",
    loader: { ".woff2": "dataurl" },
    platform: "node",
    target: "node22",
  });
  const module = await import(`${pathToFileURL(output).href}?${Date.now()}`);
  return { module, dispose: () => rm(temporary, { recursive: true, force: true }) };
}

test("shipped 0.18 renderer contains the recovered thread projection and affordance", async () => {
  const renderer = await readFile(path.join(repoRoot, "src/app/dist/renderer/assets/index-UbX-y3il.js"), "utf8");
  assert.ok(
    /function N_n\(n,e=\{\}\).*?visibleEntries:n,threadSummaries:S_n/s.test(renderer),
    "the shipped renderer must retain the thread projection function",
  );
  assert.ok(
    /`View thread, \$\{[^}]+\}`/.test(renderer),
    "the shipped renderer must retain the thread affordance label",
  );
  assert.ok(
    renderer.includes('"aria-label":"Thread breadcrumb"'),
    "the shipped renderer must retain the thread breadcrumb",
  );
});

test("recovered projection hides resolved branches and counts nested replies", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/thread-projection.ts");
  try {
    const entries = [
      { kind: "message", id: "root" },
      { kind: "message", id: "reply-1", replyToId: "root", branched: true },
      { kind: "notice", id: "reply-2", replyToId: "reply-1", branched: true },
      { kind: "tool-call", id: "tool" },
      { kind: "message", id: "orphan", replyToId: "missing", branched: true },
    ];
    const complete = loaded.module.projectTranscriptThreads(entries);
    assert.deepEqual(complete.visibleEntries.map((entry) => entry.id), ["root", "tool", "orphan"]);
    assert.deepEqual(complete.threadSummaries.get("root"), { rootId: "root", count: 2 });
    const windowed = loaded.module.projectTranscriptThreads(entries, { mayHoldOlderHistory: true });
    assert.deepEqual(windowed.visibleEntries.map((entry) => entry.id), ["root", "tool"]);
    assert.equal(loaded.module.resolveThreadRootId(entries, "reply-2"), "root");
    assert.equal(loaded.module.hasResolvedThreadRoot(entries, "reply-2"), true);
    assert.deepEqual([...loaded.module.threadEntryIds(entries, "root")], ["root", "reply-1", "reply-2"]);
  } finally {
    await loaded.dispose();
  }
});

test("recovered thread titles match shipped text and attachment rules", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/thread-projection.ts");
  try {
    assert.equal(loaded.module.threadTitleForEntry({ kind: "message", id: "text", text: "  one   two  " }), "one two");
    assert.equal(loaded.module.threadTitleForEntry({ kind: "message", id: "markdown", text: "## **hello** [Cursor](https://cursor.com)" }), "hello Cursor");
    assert.equal(
      loaded.module.threadTitleForEntry({ kind: "message", id: "long", text: "123456789012345678901234567890123456789, trailing" }),
      "123456789012345678901234567890123456789…",
    );
    assert.equal(loaded.module.threadTitleForEntry({
      kind: "message", id: "photo", text: "", attachments: [{ path: "/tmp/photo.png", name: "photo.png" }],
    }), "Photo");
    assert.equal(loaded.module.threadTitleForEntry({
      kind: "send-message", id: "file", message: { type: "attachment", url: "/tmp/report.pdf", fileName: "report.pdf" },
    }), "report.pdf");
    assert.equal(loaded.module.threadTitleForEntry({
      kind: "send-message", id: "link", message: { type: "attachment", url: "https://example.com/report.pdf" },
    }), "example.com");
    const cardTitles = [
      [{ type: "widget", widget: { prompt: "Choose one", options: [] } }, "Choose one"],
      [{ type: "cursor-agent", bcId: "cloud", title: "Fix tests" }, "Cursor agent: Fix tests"],
      [{ type: "secret-request", secretRequest: { label: "API key" } }, "API key"],
      [{ type: "email-draft", draft: { to: [], subject: "Status", body: "Body" } }, "Status"],
      [{ type: "slack-draft", draft: { target: "#team", body: "Ship it" } }, "Ship it"],
      [{ type: "auto-review-approval", approval: { summary: "Run tests" } }, "Approval required: Run tests"],
      [{ type: "connector", connector: "Gmail", variant: "connected" }, "Gmail connected"],
      [{ type: "connectors", connectors: ["Gmail", "Calendar"] }, "Connect Gmail, Calendar"],
      [{ type: "listener-connect", platform: "github" }, "Connect GitHub"],
    ];
    for (const [message, title] of cardTitles) {
      assert.equal(loaded.module.threadTitleForEntry({ kind: "send-message", id: title, message }), title);
    }
  } finally {
    await loaded.dispose();
  }
});

test("production entry projection preserves branch metadata for every shipped thread kind", async () => {
  const loaded = await loadModule("frontend/src/production/model.ts");
  try {
    const message = loaded.module.projectTranscriptEntry({ kind: "message", id: "m", role: "user", content: "reply", replyTo: "root", branched: true }, 0, "Grok Bot");
    const notice = loaded.module.projectTranscriptEntry({ kind: "notice", id: "n", text: "reply", replyTo: "root", branched: true }, 1, "Grok Bot");
    const card = loaded.module.projectTranscriptEntry({ kind: "send-message", id: "s", message: { type: "text", content: "reply" }, replyTo: "root", branched: true }, 2, "Grok Bot");
    const permission = loaded.module.projectTranscriptEntry({ kind: "send-message", id: "p", message: { type: "permission-request", permission: { title: "Approve" } }, replyTo: "root", branched: true }, 3, "Grok Bot");
    const localPermission = loaded.module.projectTranscriptEntry({ kind: "send-message", id: "l", message: { type: "local-tool-permission", ask: { requestId: "ask", status: "pending", action: {}, target: {} } }, replyTo: "root", branched: true }, 4, "Grok Bot");
    const handoff = loaded.module.projectTranscriptEntry({ kind: "send-message", id: "h", message: { type: "cursor-agent", bcId: "cloud", title: "Fix tests" }, boxRequestId: "box", replyTo: "root", branched: true }, 5, "Grok Bot");
    for (const entry of [message, notice, card, permission, localPermission, handoff]) {
      assert.ok(entry);
      assert.equal(entry.replyToId, "root");
      assert.equal(entry.branched, true);
    }
    assert.equal(localPermission.kind, "send-message");
    assert.equal(localPermission.message.type, "local-tool-permission");
    assert.equal(handoff.threadTitle, "Cursor agent: Fix tests");
  } finally {
    await loaded.dispose();
  }
});

test("thread affordance renders the shipped count contract and rejects zero", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/cards/transcript-card/thread-affordance.tsx");
  try {
    const twoReplies = renderToStaticMarkup(createElement(loaded.module.ThreadAffordance, {
      summary: { rootId: "root", count: 2 },
      onOpen: () => {},
    }));
    assert.match(twoReplies, /aria-label="View thread, 2 replies"/);
    assert.match(twoReplies, />2 replies</);
    assert.equal(renderToStaticMarkup(createElement(loaded.module.ThreadAffordance, {
      summary: { rootId: "root", count: 0 },
      onOpen: () => {},
    })), "");
  } finally {
    await loaded.dispose();
  }
});

test("thread breadcrumb renders an exit target and the recovered thread title", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/chat-header.tsx");
  try {
    const header = renderToStaticMarkup(createElement(loaded.module.ConversationAgentHeader, {
      agent: {
        id: "agent-1",
        name: "Grok Bot",
        isRunning: false,
        isComposingMessage: false,
        awaitingUserResponse: false,
        currentActivity: null,
        avatarDataUrl: null,
        avatarShape: null,
        avatarColor: null,
        isSharedRoom: false,
        memberIds: [],
      },
      isComputerActive: false,
      isInfoOpen: false,
      onToggleInfo: () => {},
      thread: { title: "Root question", onExit: () => {} },
    }));
    assert.match(header, /aria-label="Thread breadcrumb"/);
    assert.match(header, /aria-label="Back to Grok Bot"/);
    assert.match(header, />Root question</);
  } finally {
    await loaded.dispose();
  }
});

test("attachment-only roots retain their thread affordance", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/transcript.tsx");
  try {
    const markup = renderToStaticMarkup(createElement(loaded.module.ConversationTranscript, {
      entries: [{
        kind: "message", id: "attachment-root", role: "user", author: "You", text: "", timestampMs: 1,
        attachments: [{ path: "/tmp/photo.png", name: "photo.png" }],
      }],
      resolveTranscriptCardInteractions: {
        threadRootId: null,
        isReadOnly: false,
        onReply: () => {},
        onThread: () => {},
        getThreadSummary: () => ({ rootId: "attachment-root", count: 1 }),
        openThread: () => {},
        resolveEntry: () => null,
        scrollToEntry: () => {},
        isEntryInScope: () => true,
      },
    }));
    assert.match(markup, /aria-label="View thread, 1 reply"/);
    assert.match(markup, /aria-label="More message actions"/);
  } finally {
    await loaded.dispose();
  }
});

test("projected notice, permission, and Computer roots retain thread affordances", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/transcript.tsx");
  try {
    const markup = renderToStaticMarkup(createElement(loaded.module.ConversationTranscript, {
      entries: [
        { kind: "notice", id: "notice-root", text: "Notice", timestampMs: 1 },
        { kind: "permission-request", id: "permission-root", title: "Approve", timestampMs: 2 },
        { kind: "computer-handoff", id: "computer-root", requestId: "box", instruction: "Inspect", resolution: null, timestampMs: 3 },
      ],
      renderComputerHandoff: (entry) => createElement("article", { "data-entry-id": entry.id }, "Computer"),
      resolveTranscriptCardInteractions: {
        threadRootId: null,
        isReadOnly: false,
        onReply: () => {},
        onThread: () => {},
        getThreadSummary: (entryId) => ({ rootId: entryId, count: 1 }),
        openThread: () => {},
        resolveEntry: () => null,
        scrollToEntry: () => {},
        isEntryInScope: () => true,
      },
    }));
    assert.equal((markup.match(/aria-label="View thread, 1 reply"/g) ?? []).length, 3);
    assert.match(markup, /Message actions for Agent \(permission-root\)/);
    assert.match(markup, /Message actions for Agent \(computer-root\)/);
  } finally {
    await loaded.dispose();
  }
});

test("pagination restores each agent cursor and accumulated pages", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/pagination.ts");
  try {
    const requests = [];
    const controller = loaded.module.createTranscriptPaginationController({
      fetchPage: async (request) => {
        requests.push(request);
        return { entries: [{ kind: "message", id: `older-${request.id}` }] };
      },
    });
    controller.setScope("account", "agent-a");
    controller.installInitialPage({ entries: [{ kind: "message", id: "tail-a" }], nextBeforeSeq: 10 });
    controller.setScope("account", "agent-b");
    controller.installInitialPage({ entries: [{ kind: "message", id: "tail-b" }] });
    controller.setScope("account", "agent-a");
    assert.deepEqual(controller.getSnapshot().cursor, { kind: "more", beforeSeq: 10 });
    assert.deepEqual(controller.getSnapshot().entries.map((entry) => entry.id), ["tail-a"]);
    await controller.loadOlder();
    assert.deepEqual(requests, [{ id: "agent-a", limit: 200, beforeSeq: 10 }]);
    assert.deepEqual(controller.getSnapshot().entries.map((entry) => entry.id), ["older-agent-a", "tail-a"]);
    controller.setScope("account", "agent-b");
    controller.invalidateScope("account", "agent-a");
    controller.setScope("account", "agent-a");
    assert.equal(controller.getSnapshot().cursor.kind, "unprobed");
    assert.deepEqual(controller.getSnapshot().entries, []);
    controller.dispose();
  } finally {
    await loaded.dispose();
  }
});

test("thread Escape guard matches the shipped modifier and modal contract", async () => {
  const loaded = await loadModule("frontend/src/recovered/features/conversation/workspace/thread-lifecycle.ts");
  try {
    const escape = { key: "Escape", repeat: false, isComposing: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false };
    assert.equal(loaded.module.isPlainThreadEscape(escape), true);
    assert.equal(loaded.module.isPlainThreadEscape({ ...escape, ctrlKey: true }), false);
    assert.equal(loaded.module.isPlainThreadEscape({ ...escape, defaultPrevented: true }), false);
    assert.equal(loaded.module.documentHasModal({ querySelector: () => ({}) }), true);
    assert.equal(loaded.module.documentHasModal({ querySelector: () => null }), false);
  } finally {
    await loaded.dispose();
  }
});

test("production composition mounts the full thread path instead of the old null seam", async () => {
  const source = await readFile(path.join(repoRoot, "frontend/src/production/ProductionRenderer.tsx"), "utf8");
  assert.doesNotMatch(source, /getThreadSummary:\s*\(\)\s*=>\s*null/);
  assert.match(source, /projectTranscriptThreads\(entries,/);
  assert.match(source, /threadEntryIds\(entries, openThreadRootId\)/);
  assert.match(source, /transcriptThreadProjection\.threadSummaries\.get\(entryId\)/);
  assert.doesNotMatch(source, /client\.getAgentThread\(/);
  assert.match(source, /client\.call\("openAgentTail"/);
  assert.match(source, /projectTranscriptFeedEntries\(rawEntries,/);
  assert.match(source, /replyToId:\s*openThreadRootId/);
  assert.match(source, /submission\.isFork === true \? \{ branched: true \}/);
  assert.match(source, /entry\.branched === true \? \{ isFork: true \}/);
  assert.match(source, /openThreadTarget\?\.accountSlot === transcriptAccountSlot/);
  assert.match(source, /replyThreadController\.clearReply\(\);\s*setOpenThreadTarget/s);
  assert.match(source, /hasInstalledTranscriptPage = transcriptPaginationController\.getSnapshot\(\)\.cursor\.kind !== "unprobed"/);
  assert.match(source, /hasLoadedEntries && hasInstalledTranscriptPage/);
  assert.match(source, /transcriptPaginationController\.invalidateScope\(transcriptAccountSlot, ownerId\)/);
  assert.match(source, /isPlainThreadEscape\(event\).*documentHasModal\(document\)/s);
  assert.match(source, /threadRootId=\{openThreadRootId\}/);
});
