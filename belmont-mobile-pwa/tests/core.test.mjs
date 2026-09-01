import assert from "node:assert/strict";
import test from "node:test";

globalThis.window = { location: { origin: "https://belmont.example" } };

const {
  createSendId,
  endsMessageRun,
  getManagerBot,
  getWorkerBots,
  normalizeBaseUrl,
  normalizeFleet,
  parsePairingInvite,
  pendingApproval,
  renderMarkdown,
  resolveMausColor,
  responseBehavior
} = await import("../src/core.js");

test("normalizes a companion base URL without carrying paths or secrets", () => {
  assert.equal(normalizeBaseUrl("desktop.tailnet.ts.net:8810/path?token=no"), "https://desktop.tailnet.ts.net:8810");
  assert.equal(normalizeBaseUrl("http://127.0.0.1:8810/"), "http://127.0.0.1:8810");
});

test("rejects non-http companion protocols", () => {
  assert.throws(() => normalizeBaseUrl("file:///tmp/secret"), /HTTPS/);
});

test("selects the chief of staff and keeps workers out of the user chat target", () => {
  const fleet = normalizeFleet({ bots: [
    { id: "worker", name: "Worker" },
    { id: "manager", name: "Belmont", chiefOfStaff: true }
  ] });
  assert.equal(getManagerBot(fleet).id, "manager");
  assert.deepEqual(getWorkerBots(fleet, "manager").map((bot) => bot.id), ["worker"]);
});

test("does not silently promote a worker when Belmont is absent", () => {
  const fleet = normalizeFleet({ bots: [{ id: "researcher", name: "Researcher" }] });
  assert.equal(getManagerBot(fleet), null);
});

test("finds only unresolved approval cards", () => {
  const messages = [
    { id: "old", kind: "options", card: { requestId: "r1", answered: "Allow" } },
    { id: "new", kind: "options", card: { requestId: "r2" } }
  ];
  assert.equal(pendingApproval(messages).id, "new");
});

test("maps permission choices without guessing question answers", () => {
  assert.equal(responseBehavior("Deny", true), "deny");
  assert.equal(responseBehavior("거절", true), "deny");
  assert.equal(responseBehavior("Always allow", true), "allow");
  assert.equal(responseBehavior("아니요", false), "answer");
});

test("send identifiers are route-safe and non-trivial", () => {
  const id = createSendId();
  assert.match(id, /^[\w-]{16,80}$/);
});

test("maps OpenMaus named bot colors as well as explicit hex colors", () => {
  assert.equal(resolveMausColor("purple"), "#8057C8");
  assert.equal(resolveMausColor("orange"), "#E78531");
  assert.equal(resolveMausColor("#123aBc"), "#123abc");
  assert.equal(resolveMausColor("pink"), "#D84F8B");
  assert.equal(resolveMausColor("yellow"), "#D8A729");
  assert.equal(resolveMausColor("teal"), "#01A492");
  assert.equal(resolveMausColor("coral"), "#E5634E");
  assert.equal(resolveMausColor("unknown"), "#8E8E93");
});

test("parses the OpenMaus QR invite without accepting ambiguous credentials", () => {
  const invite = parsePairingInvite("openmausbot://pair?address=mac.local&code=004209&name=My%20Mac");
  assert.deepEqual(invite, { baseUrl: "http://mac.local:8810", credential: "004209", name: "My Mac" });
  assert.equal(parsePairingInvite("https://example.com/pair?address=mac.local&code=004209"), null);
  assert.equal(parsePairingInvite("openmausbot://pair?address=mac.local&code=12345"), null);
  assert.equal(parsePairingInvite("openmausbot://pair?address=one&address=two&code=004209"), null);
  assert.equal(parsePairingInvite("openmausbot://pair?address=mac.local&code=004209&endpoints="), null);
  assert.equal(parsePairingInvite("openmausbot://pair?address=mac.local&code=004209&endpoints=not_json"), null);
});

test("places a speech-bubble tail only at the end of a same-sender run", () => {
  const messages = [
    { role: "assistant", kind: "text", text: "first" },
    { role: "assistant", kind: "text", text: "second" },
    { role: "user", kind: "text", text: "reply" }
  ];
  assert.equal(endsMessageRun(messages, 0), false);
  assert.equal(endsMessageRun(messages, 1), true);
  assert.equal(endsMessageRun(messages, 2), true);
});

test("markdown renders structure but never raw HTML", () => {
  const rendered = renderMarkdown([
    "결과 **요약**이야.",
    "",
    "- Scribe: `[job:bt01]` 응답",
    "- Clerk: 정상",
    "",
    "| 봇 | 상태 |",
    "| --- | --- |",
    "| QA Bot | 정상 |",
    "",
    "```",
    "tail -n 200 ledger.jsonl",
    "```",
    "<script>alert(1)</script>"
  ].join("\n"));
  assert.match(rendered, /<strong>요약<\/strong>/);
  assert.match(rendered, /<ul class="md-list"><li>Scribe: <code>\[job:bt01\]<\/code> 응답<\/li>/);
  assert.match(rendered, /<table class="md-table"><thead><tr><th>봇<\/th><th>상태<\/th>/);
  assert.match(rendered, /<pre class="md-code">tail -n 200 ledger\.jsonl<\/pre>/);
  assert.equal(rendered.includes("<script>"), false, "raw HTML must stay escaped");
  assert.match(rendered, /&lt;script&gt;/);
});
