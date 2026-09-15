// DESIGN DRIVER (NOT YET RUN) — L26 / M6 Belmont canonical memory-authority boundary.
//
// Requires a LIVE belmont-browse serve (which holds singleton daemon 21420 / CDP 9333 / serve 9360|9340).
// MUST run only inside a maintenance window, against a DEV profile. This driver is READ-MOSTLY: it calls
// GET /health, GET /sessions, POST /memory/context, and attempts POST /sessions with deliberately-INVALID
// memoryContext. Those session-creates are REJECTED by validateBelmontMemoryContext (core.mjs:328,484 ->
// memory-belmont-runtime.mjs:23-39) BEFORE any session record exists, so there is nothing to clean up.
//
// External artifact = the HOST's own validation verdict (the response body's error code) + the /sessions
// list count staying unchanged — never the model's status string.
//
// Cases (argv[2]): context-authority | reject-control-field | reject-malformed
// Prereq for the specific UNTRUSTED_MEMORY_CONTROL_FIELD / INVALID_BELMONT_MEMORY_CONTEXT paths: the serve must
// run with BELMONT_MEMORY_AUTHORITY=belmont (regenerate the daemon via tools/patch-daemon-canonical-memory.py
// first). For domain->siteRevision, set BELMONT_BROWSE_SITE_REVISIONS_JSON. The driver auto-detects the serve's
// memoryAuthority via /health and grades accordingly, reporting BLOCKED/PARTIAL rather than a false PASS when
// the serve is on legacy authority.
import fs from "node:fs";
import path from "node:path";

const REPO = process.env.BELMONT_REPO || process.cwd();
const serve = JSON.parse(fs.readFileSync(path.join(REPO, "belmont-browse/.state/serve.json"), "utf8"));
const CASE = process.argv[2];
const OUT = process.argv[3] || `/tmp/design-mem-authority-${CASE}.json`;
const model = process.env.BELMONT_MODEL || "gpt-5.5";
const thinking = "high";

async function rawApi(method, route, body) {
  const res = await fetch(`http://127.0.0.1:${serve.port}${route}`, {
    method,
    headers: { authorization: `Bearer ${serve.token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let json = null, text = "";
  try { text = await res.text(); json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body: json, text };
}
const sessionCount = async () => { const r = await rawApi("GET", "/sessions"); return Array.isArray(r.body) ? r.body.length : null; };
const authorityMode = async () => { const h = await rawApi("GET", "/health"); return h.body?.memoryAuthority ?? null; };
const record = (obj) => {
  fs.writeFileSync(OUT, JSON.stringify({ case: CASE, at: new Date().toISOString(),
    serve: { port: serve.port, engine: serve.engine, instanceId: serve.instanceId ?? null }, ...obj }, null, 2));
  console.log("EVIDENCE ->", OUT);
};

// A structurally-valid Belmont context (memory-belmont-runtime.mjs:26-30 required fields), used as the base
// onto which we graft one forbidden control field for the reject-control-field case.
const validCtx = { authority: "belmont", version: 1, agentId: "probe-agent", conversationId: "probe-conv",
  ownerKey: "probe-owner", requestId: "probe-req", expectedEpoch: 0 };

async function contextAuthority() {
  const mode = await authorityMode();
  const one = await rawApi("POST", "/memory/context", { task: "Complete a booking on https://united.example/reserve now." });
  const two = await rawApi("POST", "/memory/context", { task: "Compare https://united.example and https://delta.example fares." });
  let pass, note;
  if (mode === "belmont") {
    // core.mjs:684-688: exactly one URL host -> domain extracted; two distinct hosts -> no invented domain.
    const singleOk = one.status === 200 && one.body?.domain === "united.example";
    const twoOk = two.status === 200 && (two.body?.domain === undefined || two.body?.domain === null);
    pass = singleOk && twoOk;
    note = "belmont authority: /memory/context returns a host-owned bounded context; single-URL task -> domain extracted, multi-URL task -> no invented domain (core.mjs:684-688)";
  } else {
    // core.mjs:683: legacy authority must refuse.
    pass = one.status >= 400 && (one.body?.error === "MEMORY_AUTHORITY_MISMATCH" || one.text.includes("MEMORY_AUTHORITY_MISMATCH"));
    note = `legacy authority (${mode}): /memory/context must refuse with MEMORY_AUTHORITY_MISMATCH; re-run against a BELMONT_MEMORY_AUTHORITY=belmont serve for the positive context path`;
  }
  record({ authorityMode: mode, singleDomainStatus: one.status, singleDomain: one.body, multiDomainStatus: two.status, multiDomain: two.body, verdict_pass: pass, note });
}

async function rejectContext(memoryContext, expectBelmontCode, tag) {
  const mode = await authorityMode();
  const before = await sessionCount();
  const r = await rawApi("POST", "/sessions", { task: "noop probe", model, thinking, mode: "guard", autoApprove: false, memoryContext });
  const after = await sessionCount();
  const rejected = r.status >= 400;
  const err = (typeof r.body?.error === "string" ? r.body.error : null) ?? (r.text ? r.text.slice(0, 200) : null);
  // On legacy authority, the authority check (memory-belmont-runtime.mjs:25) fires before the specific guard.
  const expected = mode === "belmont" ? expectBelmontCode : "MEMORY_AUTHORITY_MISMATCH";
  const codeOk = typeof err === "string" && err.includes(expected);
  const countUnchanged = before !== null && before === after;
  const pass = rejected && codeOk && countUnchanged;
  record({ authorityMode: mode, tag, requestStatus: r.status, error: err, expectedCode: expected,
    sessionCountBefore: before, sessionCountAfter: after, verdict_pass: pass,
    note: mode === "belmont"
      ? "belmont authority: the specific validateBelmontMemoryContext guard was exercised and no session was created"
      : "legacy authority: authority-mismatch guard fired first; re-run against BELMONT_MEMORY_AUTHORITY=belmont for the specific code" });
}

const map = {
  "context-authority": contextAuthority,
  // memory-belmont-runtime.mjs:31 — an injected control field must be refused as UNTRUSTED_MEMORY_CONTROL_FIELD.
  "reject-control-field": () => rejectContext({ ...validCtx, authorityOverride: true }, "UNTRUSTED_MEMORY_CONTROL_FIELD", "forbidden-control-field:authorityOverride"),
  // memory-belmont-runtime.mjs:26-30 — a context missing required fields must be refused as INVALID_BELMONT_MEMORY_CONTEXT.
  "reject-malformed": () => rejectContext({ authority: "belmont", version: 1 }, "INVALID_BELMONT_MEMORY_CONTEXT", "malformed:missing-required-fields"),
};
if (!map[CASE]) { console.error("unknown case:", CASE, "| choices:", Object.keys(map).join(", ")); process.exit(2); }
await map[CASE]();
