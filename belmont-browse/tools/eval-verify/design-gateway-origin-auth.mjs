// DESIGN DRIVER (NOT YET RUN) — L15 / P4+H1 gateway auth + Origin guards.
//
// Two surfaces: (A) the Host gateway (NON-singleton port, discovered from gateway.json) and (B) the Aside
// daemon for-chrome Origin guard on singleton port 21420. On surface A this driver is READ-ONLY
// (getHostStatus / listAgents). On surface B it sends only a REJECTED / bogus-path request, so no session is
// mutated even on the pass-through branch.
//
// External artifact = HTTP status codes + the host agent-roster count staying unchanged — never a model string.
// Run only in a maintenance window against the dev stack.
//
// Cases (argv[2]): origin-guard | bad-bearer | daemon-for-chrome
// The bad-bearer case is only meaningful when the gateway runs auth-ON (SAND_GATEWAY_REQUIRE_AUTH=1 or a
// non-empty SAND_GATEWAY_TOKEN). The dev stack defaults to auth-OFF (proven historically by scripts/gw-sweep.mjs
// posting with no Authorization header); this driver detects that and reports BLOCKED_AUTH_OFF instead of a
// false PASS. Env overrides: GATEWAY_JSON, GATEWAY_PORT, GATEWAY_TOKEN, BELMONT_DAEMON_PORT.
import fs from "node:fs";
import path from "node:path";
import { gradeOriginGuard, gradeBadBearer, gradeDaemonForChrome } from "./gateway-origin-auth-lib.mjs";

const CASE = process.argv[2];
const OUT = process.argv[3] || `/tmp/design-gw-origin-${CASE}.json`;
const DAEMON_PORT = Number(process.env.BELMONT_DAEMON_PORT || 21420);
// gateway-server.ts:57 binds SAND_HOST_PORT/ephemeral (NOT a protected singleton). Discovery is written to
// getSandRootDir()/gateway.json (host-paths.ts:88; run-wsl.mjs:87). Default dev path below; override with GATEWAY_JSON.
const gwPath = process.env.GATEWAY_JSON || path.join(process.env.BELMONT_REPO || process.cwd(), ".cache/belmont-wsl-profile/sand-data/gateway.json");
const gw = JSON.parse(fs.readFileSync(gwPath, "utf8"));
const GW_PORT = Number(process.env.GATEWAY_PORT || gw.port);
const GW_TOKEN = process.env.GATEWAY_TOKEN || gw.token || gw.authToken || null;
const record = (obj) => {
  fs.writeFileSync(OUT, JSON.stringify({ case: CASE, at: new Date().toISOString(),
    gateway: { port: GW_PORT, jsonPath: gwPath, tokenAdvertised: !!GW_TOKEN }, ...obj }, null, 2));
  console.log("EVIDENCE ->", OUT);
};

async function gwFetch({ origin, bearer, method = "POST", pathname = "/api/getHostStatus", body = {} } = {}) {
  const headers = { "content-type": "application/json" };
  if (origin !== undefined) headers.origin = origin;
  if (bearer !== undefined) headers.authorization = `Bearer ${bearer}`;
  const res = await fetch(`http://127.0.0.1:${GW_PORT}${pathname}`, { method, headers, body: JSON.stringify(body) });
  let text = ""; try { text = await res.text(); } catch {}
  return { status: res.status, body: text.slice(0, 200) };
}
async function agentCount() {
  // read-only roster count (works with the advertised token, or with no auth when the stack is auth-off).
  // `parsed` is true ONLY when we actually decoded an array roster: a 200 with a malformed/unexpected body
  // yields count:null,parsed:false so the caller can tell "roster unreadable" from "roster genuinely unchanged"
  // (GPT false-PASS #2: two malformed rosters both gave count:null and null===null read as "unchanged").
  const res = await fetch(`http://127.0.0.1:${GW_PORT}/api/listAgents`, {
    method: "POST", headers: { "content-type": "application/json", ...(GW_TOKEN ? { authorization: `Bearer ${GW_TOKEN}` } : {}) }, body: "{}" });
  if (!res.ok) return { ok: false, status: res.status, count: null, parsed: false };
  let body = null; try { body = JSON.parse(await res.text()); } catch {}
  const list = Array.isArray(body) ? body : Array.isArray(body?.agents) ? body.agents : null;
  return { ok: true, status: res.status, count: list ? list.length : null, parsed: list !== null };
}

async function originGuard() {
  // gateway-server.ts:23,47 — rejectUntrustedBrowserRequest fires for ANY Origin header, before auth and before
  // command routing. There is NO allowlist on the Host gateway: even the pinned Aside extension origin is refused.
  const before = await agentCount();
  const cases = [
    { name: "generic-web-origin", origin: "https://evil.test" },
    { name: "pinned-aside-extension-origin", origin: "chrome-extension://fjdhphbdlfjogobdofoaagnlnkoibdge" },
    { name: "localhost-web-origin", origin: "http://localhost:3000" },
  ];
  const results = [];
  for (const c of cases) { const r = await gwFetch({ origin: c.origin }); results.push({ ...c, status: r.status, body: r.body, rejected403: r.status === 403 }); }
  const after = await agentCount();
  const allRejected = results.every((r) => r.rejected403);
  const { result, rosterReadable, countUnchanged } = gradeOriginGuard({ allRejected, before, after });
  record({ expected: "every browser Origin -> 403 (Host gateway trusts NO browser origin, extension included); roster count unchanged",
    results, rosterBefore: before, rosterAfter: after, rosterReadable, countUnchanged, result, verdict_pass: result === "PASS" });
}

async function badBearer() {
  // Detect auth mode: a no-origin, no-auth read either works (auth OFF) or 401s (auth ON) (gateway-server.ts:51).
  const probe = await gwFetch({ method: "POST", pathname: "/api/getHostStatus" });
  const authOff = probe.status !== 401;
  if (authOff) {
    record({ authMode: "off", probeStatus: probe.status, verdict: "BLOCKED_AUTH_OFF",
      note: "dev stack runs auth-off; relaunch the host with SAND_GATEWAY_REQUIRE_AUTH=1 (or a SAND_GATEWAY_TOKEN) to exercise bad-bearer -> 401" });
    return;
  }
  const wrong = await gwFetch({ bearer: "wrong-token-000" });
  const right = GW_TOKEN ? await gwFetch({ bearer: GW_TOKEN }) : { status: null };
  // Auth-ON proof needs BOTH bad->401 AND good->200. Without a token to prove the positive path -> UNKNOWN, not
  // PASS (a wrong->401 alone can't tell a real guard from one that rejects everything) (GPT false-PASS #3).
  const { result } = gradeBadBearer({ hasToken: !!GW_TOKEN, wrongStatus: wrong.status, rightStatus: right.status });
  record({ authMode: "on", wrongBearerStatus: wrong.status, rightBearerStatus: right.status, result, verdict_pass: result === "PASS",
    note: result === "UNKNOWN"
      ? "auth-ON but no gateway token advertised/provided; cannot prove correct-Bearer->200, so bad-bearer->401 alone is inconclusive"
      : "bad Bearer -> 401 AND correct Bearer -> 200 (both required)" });
}

async function daemonForChrome() {
  // daemon-server.mjs:32,51-70 — a web-origin mutation under /session/for-chrome/* is refused (403 FORBIDDEN);
  // a request without an Origin (native browser / CLI) is exempt. A bogus subpath means neither branch mutates.
  const bogus = "/session/for-chrome/__belmont_probe_nonexistent";
  const call = async (headers) => {
    try {
      const r = await fetch(`http://127.0.0.1:${DAEMON_PORT}${bogus}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
      let t = ""; try { t = await r.text(); } catch {}
      return { status: r.status, body: (t || "").slice(0, 200) };
    } catch (e) { return { status: `fetch-failed:${e.message}`, body: "" }; }
  };
  const evil = await call({ origin: "https://evil.test" });
  const noOrigin = await call({});
  // BOTH requests must actually reach the daemon (a real numeric HTTP status). `call` returns a string status
  // ("fetch-failed:...") on a communication failure; that must NOT count as "not 403" (GPT false-PASS #1: a
  // no-Origin comm-failure passed because a failure string !== 403). Either side unreached -> UNKNOWN, not PASS.
  const { result, bothReached } = gradeDaemonForChrome({ evil, noOrigin });
  record({ expected: "web-origin mutation on /session/for-chrome/* -> 403 FORBIDDEN; no-Origin request not blocked by the guard (bogus subpath => no mutation either way)",
    evilOrigin: evil, noOrigin, bothReached, result, verdict_pass: result === "PASS",
    note: "touches singleton daemon 21420 but sends only a rejected / bogus-path request; nothing is mutated" });
}

const map = { "origin-guard": originGuard, "bad-bearer": badBearer, "daemon-for-chrome": daemonForChrome };
if (!map[CASE]) { console.error("unknown case:", CASE, "| choices:", Object.keys(map).join(", ")); process.exit(2); }
await map[CASE]();
