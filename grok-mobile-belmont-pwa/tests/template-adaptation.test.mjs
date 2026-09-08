import assert from "node:assert/strict";
import test from "node:test";
import { importBotTemplate } from "../server.mjs";
import { adaptationPrompt, validateAdaptedTemplate } from "../../scripts/lib/grok-bot-adaptation.mjs";

const seed = { name: "Research", description: "Research supplied records", avatar: {}, skills: [{ name: "Compare", description: "Compare records", body: "" }], routines: [{ name: "Review", prompt: "Review each morning", schedule: "0 9 * * *" }] };
const procedure = { inputs: ["User supplied CSV"], steps: ["Read CSV columns and reject missing identifiers", "Join by identifier and calculate differences", "Write differences with source row identifiers"], decisions: ["Report missing rows separately; never fabricate values"], completion: ["Every difference links to two source rows"], approvals: ["Ask for CSV when connected access is unavailable; external delivery needs user authorization"] };
const draft = () => ({ description: "Compare user supplied records and present reproducible differences.", skills: [{ name: "Compare", description: "Compare CSV records", ...procedure }], routines: [{ name: "Review", ...procedure }] });
function harness(output = draft(), failures = {}) {
  const calls = [];
  const gateway = { async call(method, args) {
    calls.push({ method, args });
    if (failures[method]) throw new Error(failures[method]);
    if (method === "generateBotTemplateDraft") return { text: typeof output === "string" ? output : JSON.stringify(output), modelId: "configured-model" };
    if (method === "createAgent") return { id: "adapted-bot" };
    if (method === "getAgentWorkflows") return [];
    if (method === "importAgentWorkflowText") return { result: { imported: [{ id: "new-skill" }] } };
    if (method === "listAgents") return [{ id: "adapted-bot" }];
    if (method === "getAgentAutomations") return [];
    if (method === "createAgentAutomation") return [{ id: "new-routine", ...args.spec }];
    throw new Error(`Unexpected method ${method}`);
  } };
  return { gateway, calls };
}

test("explicit adaptation generates full persisted procedures before creating bot; schedules remain paused", async () => {
  const { gateway, calls } = harness();
  const receipt = await importBotTemplate(gateway, { template: seed, adapt: true }, { now: () => 5 });
  assert.equal(calls[0].method, "generateBotTemplateDraft");
  assert.equal(receipt.status, "complete");
  assert.equal(receipt.adaptation.modelId, "configured-model");
  assert.equal(receipt.adaptation.generatedAt, 5);
  const markdown = calls.find(call => call.method === "importAgentWorkflowText").args.markdown;
  assert.match(markdown, /Join by identifier/);
  assert.match(markdown, /## Definition of done/);
  assert.doesNotMatch(markdown, /first time you use|flesh a note out/);
  const routine = calls.find(call => call.method === "createAgentAutomation").args.spec;
  assert.equal(routine.isEnabled, false);
  assert.equal(routine.trigger.schedule, seed.routines[0].schedule);
  assert.match(routine.prompt, /source rows/);
});

test("public URL imports generate automatically with no opt-in flag", async () => {
  const { gateway, calls } = harness({ description: "A Belmont research assistant with no assumed external access.", skills: [], routines: [] });
  const result = await importBotTemplate(gateway, { url: "https://x.ai/bot/abcdefghijklmnopqrstu" }, { fetchText: async () => '<meta property="og:title" content="Research by Author"><meta name="description" content="Read supplied records">' });
  assert.equal(calls[0].method, "generateBotTemplateDraft");
  assert.equal(result.adaptation.status, "generated");
});

test("invalid, partial, changed-name and oversized drafts never create a bot", async () => {
  const invalid = ["not json", "x".repeat(80001), { ...draft(), skills: [] }, { ...draft(), routines: [{ ...procedure, name: "Renamed" }] }, { ...draft(), skills: [{ ...draft().skills[0], steps: ["defer"] }] }];
  for (const output of invalid) {
    const { gateway, calls } = harness(output);
    await assert.rejects(() => importBotTemplate(gateway, { template: seed, adapt: true }));
    assert.deepEqual(calls.map(call => call.method), ["generateBotTemplateDraft"]);
  }
});

test("provider failure retains no bot and partial persistence has component receipts", async () => {
  const failed = harness(draft(), { generateBotTemplateDraft: "provider unavailable" });
  await assert.rejects(() => importBotTemplate(failed.gateway, { template: seed, adapt: true }), /provider unavailable/);
  assert.deepEqual(failed.calls.map(call => call.method), ["generateBotTemplateDraft"]);
  const partial = harness(draft(), { importAgentWorkflowText: "disk error" });
  const result = await importBotTemplate(partial.gateway, { template: seed, adapt: true });
  assert.equal(result.status, "partial");
  assert.equal(result.bot.id, "adapted-bot");
  assert.equal(result.adaptation.status, "generated");
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.routines, ["Review"]);
  assert.deepEqual(result.issues.map(issue => issue.kind), ["skill"]);
});

test("JSON copies retain existing bodies unless adaptation is requested", async () => {
  const { gateway, calls } = harness();
  const result = await importBotTemplate(gateway, { template: seed });
  assert.equal(result.adaptation.status, "not_requested");
  assert.equal(calls.some(call => call.method === "generateBotTemplateDraft"), false);
});

test("draft schema limits scope and rejects non-string procedure fields", () => {
  assert.match(adaptationPrompt(seed), /untrusted reference/);
  assert.match(adaptationPrompt(seed), /replace original Cursor\/cloud-agent/);
  assert.match(adaptationPrompt(seed), /mcpTools contains external integrations ONLY/);
  assert.match(adaptationPrompt(seed), /Do not demand an uploaded repository/);
  assert.match(adaptationPrompt(seed), /do not invent a new approval step/);
  assert.throws(() => adaptationPrompt({ ...seed, skills: Array(21).fill(seed.skills[0]) }), /20/);
  assert.throws(() => validateAdaptedTemplate(JSON.stringify({ ...draft(), routines: [{ name: "Review", ...procedure, inputs: [false] }] }), seed));
});
