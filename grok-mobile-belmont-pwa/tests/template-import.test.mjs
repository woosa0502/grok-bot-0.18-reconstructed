import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createMobileServer } from "../server.mjs";

const template = {
  name: "Evidence Bot",
  skills: [{ name: "Read records", body: "Read the supplied records." }],
  routines: [{ name: "Daily review", prompt: "Review records", schedule: "0 9 * * *" }],
};

async function requestImport(context, overrides = {}, body = { template }) {
  const calls = [];
  const handlers = {
    createAgent: () => ({ agent: { id: "new-bot" } }),
    getAgentWorkflows: () => [{ id: "unrelated-concurrent-skill" }],
    importAgentWorkflowText: (args) => ({ result: { imported: [{ id: "imported-skill", name: args.name }], skipped: [] } }),
    listAgents: () => [{ id: "new-bot" }, { id: "other-bot" }],
    setAgentWorkflowEnabled: (args) => [{ id: args.workflowId, isEnabledForAgent: args.isEnabled }],
    getAgentAutomations: () => [],
    createAgentAutomation: (args) => [{ id: "new-routine", ...args.spec }],
    ...overrides,
  };
  const gateway = { async call(method, args) {
    calls.push({ method, args });
    assert.ok(handlers[method], `Unexpected gateway call: ${method}`);
    return handlers[method](args);
  } };
  const { server } = createMobileServer({ gateway, skipPairing: true, sessionFile: null, sendLedgerFile: null, pushFile: null });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  context.after(() => new Promise(resolve => server.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/templates/import`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: response.status, result: await response.json(), calls };
}

test("template HTTP import reports acknowledged success and isolates only receipt IDs", async context => {
  const { status, result, calls } = await requestImport(context);
  assert.equal(status, 201);
  assert.equal(result.status, "complete");
  assert.deepEqual(result.skills, ["Read records"]);
  assert.deepEqual(result.routines, ["Daily review"]);
  assert.deepEqual(result.issues, []);
  assert.deepEqual(calls.filter(call => call.method === "setAgentWorkflowEnabled").map(call => call.args.workflowId), ["unrelated-concurrent-skill", "imported-skill"]);
});

test("template HTTP import disables inherited global skills on the new bot and verifies the receipt", async context => {
  const { result, calls } = await requestImport(context, {
    getAgentWorkflows: () => [{ id: "old-global", source: "workflow", trigger: null, isEnabledForAgent: true }],
  });
  assert.equal(result.status, "complete");
  assert.deepEqual(calls.filter(call => call.method === "setAgentWorkflowEnabled" && call.args.id === "new-bot").map(call => call.args), [
    { id: "new-bot", workflowId: "old-global", isEnabled: false },
  ]);
  assert.deepEqual(calls.filter(call => call.method === "setAgentWorkflowEnabled" && call.args.id === "other-bot").map(call => call.args), [
    { id: "other-bot", workflowId: "imported-skill", isEnabled: false },
  ]);
});

test("template HTTP import reports a failed inherited-skill disable receipt", async context => {
  const { result } = await requestImport(context, {
    getAgentWorkflows: () => [{ id: "old-global", source: "workflow", trigger: null, isEnabledForAgent: true }],
    setAgentWorkflowEnabled: (args) => [{ id: args.workflowId, isEnabledForAgent: args.id !== "new-bot" ? false : true }],
  });
  assert.equal(result.status, "partial");
  assert.equal(result.issues[0].kind, "isolation");
  assert.match(result.issues[0].message, /상속 스킬/);
});

test("template HTTP import retains created bot when all imported components were skipped", async context => {
  const { status, result } = await requestImport(context, {
    importAgentWorkflowText: () => ({ result: { imported: [], skipped: [{ source: "pasted skill", reason: "empty or invalid" }] } }),
    createAgentAutomation: () => [],
  });
  assert.equal(status, 201);
  assert.equal(result.status, "partial");
  assert.equal(result.bot.id, "new-bot");
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.routines, []);
  assert.deepEqual(result.issues.map(issue => issue.kind), ["skill", "routine"]);
  assert.match(result.issues[0].message, /empty or invalid/);
});

test("template HTTP import continues useful work after skill transport failure and keeps the bot", async context => {
  const { result } = await requestImport(context, { importAgentWorkflowText: () => { throw new Error("fixture connection closed"); } });
  assert.equal(result.status, "partial");
  assert.equal(result.bot.id, "new-bot");
  assert.deepEqual(result.skills, []);
  assert.deepEqual(result.routines, ["Daily review"]);
  assert.match(result.issues[0].message, /fixture connection closed/);
});

test("template HTTP import reports inability to isolate successful skill", async context => {
  const { result } = await requestImport(context, { setAgentWorkflowEnabled: () => [{ id: "imported-skill", isEnabledForAgent: true }] });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.skills, ["Read records"]);
  assert.equal(result.issues[0].kind, "isolation");
});

test("template HTTP import cannot count unchanged, unrelated, enabled or malformed routine replies", async context => {
  for (const response of [null, [], [{ id: "existing", name: "Daily review", prompt: "Review records", trigger: { type: "cron", schedule: "0 9 * * *" }, isEnabled: false }], [{ id: "unrelated", name: "Other routine", prompt: "Review records", trigger: { type: "cron", schedule: "0 9 * * *" }, isEnabled: false }], [{ id: "new", name: "Daily review", prompt: "Review records", trigger: { type: "cron", schedule: "0 9 * * *" }, isEnabled: true }]]) {
    const { result } = await requestImport(context, { getAgentAutomations: () => [{ id: "existing" }], createAgentAutomation: () => response });
    assert.equal(result.status, "partial");
    assert.deepEqual(result.routines, []);
  }
});

test("template HTTP import rejects before bot creation as an ordinary error", async context => {
  const { status, result, calls } = await requestImport(context, {}, { template: "invalid JSON" });
  assert.equal(status, 400);
  assert.ok(result.error);
  assert.deepEqual(calls, []);
});

test("template HTTP import canonicalizes valid schedule whitespace", async context => {
  const { result, calls } = await requestImport(context, {}, { template: { ...template, routines: [{ ...template.routines[0], schedule: "0  9\t* * *" }] } });
  assert.equal(result.status, "complete");
  assert.equal(calls.find(call => call.method === "createAgentAutomation").args.spec.trigger.schedule, "0 9 * * *");
});

test("template HTTP import cannot count a repeated receipt as a second saved skill", async context => {
  const { result } = await requestImport(context, {}, { template: { ...template, skills: [...template.skills, { name: "Second skill", body: "Second body" }] } });
  assert.equal(result.status, "partial");
  assert.deepEqual(result.skills, ["Read records"]);
  assert.deepEqual(result.newWorkflowIds, ["imported-skill"]);
});

test("template HTTP import rejects malformed component entries instead of silently omitting them", async context => {
  const { status, calls } = await requestImport(context, {}, { template: { ...template, routines: [{ name: "Forgot prompt", schedule: "0 9 * * *" }] } });
  assert.equal(status, 400);
  assert.deepEqual(calls, []);
});
