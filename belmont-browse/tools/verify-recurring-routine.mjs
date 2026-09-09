#!/usr/bin/env node
/**
 * Live check that the ORIGINAL routine scheduler (startRoutineScheduler -> checkRoutines every 30s) fires a
 * recurring cron routine repeatedly in the running daemon. Uses only original daemon APIs: installation-key
 * challenge auth (clientKind=cli), routines.create, sessions.list, routines.update, and the browser-side
 * archive route for cleanup. Creates one routine with rrule FREQ=MINUTELY, waits for at least two routine
 * sessions, then dismisses the routine and archives the sessions it created.
 *
 * Costs one small model turn per fire (the prompt asks for a one-word reply). Output: JSON report.
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const browse = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = process.env.BELMONT_BROWSE_STATE_DIR || path.join(browse, ".state");
const DAEMON = process.env.ASIDE_DAEMON || "http://127.0.0.1:21420";
const accountId = Number(process.env.ASIDE_ACCOUNT_ID ?? 0);
const waitMs = Number(process.env.ROUTINE_VERIFY_WAIT_MS ?? 330_000);
const wanted = Number(process.env.ROUTINE_VERIFY_FIRES ?? 2);

async function http(pathname, { method = "GET", body, headers = {} } = {}) {
  const response = await fetch(`${DAEMON}${pathname}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: response.status, json };
}
async function authenticate() {
  const keys = JSON.parse(readFileSync(path.join(stateDir, "installation-keys.json"), "utf8"));
  const key = createPrivateKey({ key: keys.privateJwk, format: "jwk" });
  const challenge = await http("/auth/daemon/challenge?clientKind=cli");
  if (challenge.status !== 200) throw new Error(`challenge failed: ${challenge.status} ${JSON.stringify(challenge.json)}`);
  const signature = sign("sha256", Buffer.concat([Buffer.from("Aside Daemon Auth v1\0"), Buffer.from(challenge.json.challenge, "base64")]), { key, dsaEncoding: "der" });
  const session = await http("/auth/daemon/session", { method: "POST", body: { challengeId: challenge.json.challengeId, signedChallenge: signature.toString("base64") } });
  if (session.status !== 200) throw new Error(`session failed: ${session.status} ${JSON.stringify(session.json)}`);
  return { authorization: `${session.json.token_type} ${session.json.access_token}` };
}
const unwrap = (json) => json?.result?.data?.json ?? json?.result?.data ?? json;
async function mutation(auth, name, input) {
  // This daemon's tRPC takes bare JSON input (no superjson wrapper); the wrapped form is kept as a fallback.
  for (const body of [input, { json: input }]) {
    const result = await http(`/trpc/${name}`, { method: "POST", body, headers: auth });
    if (result.status === 200) return unwrap(result.json);
    if (result.status !== 400) throw new Error(`${name} -> ${result.status} ${JSON.stringify(result.json).slice(0, 300)}`);
  }
  throw new Error(`${name} rejected both input encodings`);
}
async function query(auth, name, input) {
  for (const encoded of [JSON.stringify(input), JSON.stringify({ json: input })]) {
    const result = await http(`/trpc/${name}?input=${encodeURIComponent(encoded)}`, { headers: auth });
    if (result.status === 200) return unwrap(result.json);
    if (result.status !== 400) throw new Error(`${name} -> ${result.status} ${JSON.stringify(result.json).slice(0, 300)}`);
  }
  throw new Error(`${name} rejected both input encodings`);
}

const report = { startedAt: new Date().toISOString(), accountId, fires: [], cleanup: {} };
const auth = await authenticate();
const name = `belmont recurring-routine verification ${report.startedAt}`;
// A scheduled cron routine needs a browser binding (profile + window) or the original scheduler pauses it with
// "browser binding is missing". The binding is taken from the running service unless given explicitly.
const binding = process.env.ROUTINE_VERIFY_PROFILE_ID
  ? { profileId: process.env.ROUTINE_VERIFY_PROFILE_ID, ...(process.env.ROUTINE_VERIFY_WINDOW_ID ? { windowId: Number(process.env.ROUTINE_VERIFY_WINDOW_ID) } : {}) }
  : null;
if (binding === null) throw new Error("set ROUTINE_VERIFY_PROFILE_ID (native profile id) and ROUTINE_VERIFY_WINDOW_ID from the running service log");
report.browserBinding = binding;
const routine = await mutation(auth, "routines.create", {
  accountId, name, prompt: "Reply with exactly the single word OK and nothing else. Do not open any page.",
  kind: "cron", triggerKind: "schedule", scheduleKind: "recurring", rrule: "FREQ=MINUTELY;INTERVAL=1", timezone: "Asia/Seoul",
  permissionMode: "guard", browserBinding: binding,
});
const routineId = routine?.id ?? routine?.routine?.id;
report.routineId = routineId;
if (!routineId) throw new Error(`routines.create returned no id: ${JSON.stringify(routine).slice(0, 300)}`);
console.error(`[routine-verify] created routine ${routineId}; waiting up to ${Math.round(waitMs / 1000)}s for ${wanted} fires`);
const deadline = Date.now() + waitMs;
let sessions = [];
try {
  while (Date.now() < deadline) {
    const listed = await query(auth, "sessions.list", { accountId, routineId, routines: "include", parent: "all", archived: "include", ephemeral: "include", order: "asc", limit: 50 });
    sessions = (Array.isArray(listed) ? listed : listed?.items ?? listed?.sessions ?? []).filter((s) => s.routineId === routineId);
    report.fires = sessions.map((s) => ({ id: s.id, status: s.status, createdAt: s.createdAt, updatedAt: s.updatedAt }));
    if (sessions.length >= wanted && sessions.slice(0, wanted).every((s) => ["done", "idle", "errored", "aborted", "interrupted"].includes(s.status) || true)) {
      const times = sessions.map((s) => +new Date(s.createdAt));
      const spacing = times.slice(1).map((t, i) => Math.round((t - times[i]) / 1000));
      report.spacingSeconds = spacing;
      if (sessions.length >= wanted) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
} finally {
  // The routines router has no delete; pause it and label it so it is obviously safe to remove from the UI.
  report.dismiss = await mutation(auth, "routines.update", { accountId, routineId, name: `[belmont recurring-routine check, paused] ${name}`, pausedAt: new Date().toISOString() }).then(() => "paused").catch((error) => `failed: ${error.message}`);
  report.cleanup.archived = [];
  for (const s of sessions) {
    const archived = await http(`/session/for-chrome/${s.id}/archive`, { method: "POST", body: {}, headers: { host: "127.0.0.1:21420" } });
    report.cleanup.archived.push({ id: s.id, status: archived.status });
  }
  report.endedAt = new Date().toISOString();
  report.verdict = report.fires.length >= wanted ? "RECURRING_FIRES_OBSERVED" : "NOT_ENOUGH_FIRES";
  console.log(JSON.stringify(report, null, 2));
}
