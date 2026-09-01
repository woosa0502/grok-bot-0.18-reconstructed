import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { origin: "https://belmont.example" } };

const { CompanionApi, parseEventStream } = await import("../src/api.js");
const { createMockApi } = await import("../src/mock-api.js");

function streamFrom(chunks) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  });
}

test("parses SSE frames split across network chunks", async () => {
  const frames = [];
  for await (const frame of parseEventStream(streamFrom([
    "id: 7\nevent: message\ndata: {\"thread",
    "Id\":\"t1\"}\n\n: keepalive\n\n"
  ]))) frames.push(frame);
  assert.deepEqual(frames, [{ id: "7", event: "message", data: { threadId: "t1" } }]);
});

test("SSE subscription drops an expired cursor and resynchronizes without it", async (t) => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const encoder = new TextEncoder();
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: "expired" }), { status: 409 });
    }
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('id: mobile-fresh\nevent: message\ndata: {"threadId":"thread-belmont"}\n\n'));
        controller.close();
      }
    }), { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const api = new CompanionApi({ baseUrl: "https://belmont.example" });
  const abort = new AbortController();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SSE resync timed out")), 1_000);
    api.subscribe({
      cursor: "mobile-expired",
      signal: abort.signal,
      onEvent() {
        clearTimeout(timer);
        abort.abort();
        resolve();
      }
    });
  });

  assert.match(calls[0], /since=mobile-expired/);
  assert.doesNotMatch(calls[1], /since=/);
});

test("mock vertical slice returns Belmont, sends a turn, and resolves approval", async () => {
  const api = createMockApi();
  const fleet = await api.fleet();
  const manager = fleet.bots.find((bot) => bot.chiefOfStaff);
  assert.equal(manager.name, "Belmont");
  const before = await api.messages(manager.threadId);
  await api.send({ botId: manager.id, threadId: manager.threadId, text: "테스트 목표" });
  const after = await api.messages(manager.threadId);
  assert.equal(after.messages.length, before.messages.length + 2);
  await api.respond({ threadId: manager.threadId, requestId: "request-connect-pwa", behavior: "allow" });
  const decided = await api.messages(manager.threadId);
  assert.equal(decided.messages.find((message) => message.id === "approval-1").card.answered, "Allow");
});

test("mock question cards preserve the selected answer text", async () => {
  const api = createMockApi();
  const page = await api.messages("thread-belmont");
  const approval = page.messages.find((message) => message.id === "approval-1");
  approval.card.tool = null;
  await api.respond({ requestId: approval.card.requestId, behavior: "answer", message: "두 번째 선택" });
  const decided = await api.messages("thread-belmont");
  assert.equal(decided.messages.find((message) => message.id === "approval-1").card.answered, "두 번째 선택");
  assert.equal(decided.messages.at(-1).text, "선택을 받았습니다: 두 번째 선택");
});
