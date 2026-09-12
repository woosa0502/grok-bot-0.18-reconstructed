// DESIGN DRIVER (NOT YET RUN) — L41 / U4 new mobile PWA send-ledger idempotency & stop guard.
//
// Drives the NEW PWA HTTP API (default 127.0.0.1:4173, default build port 4187 — NON-singleton, no conflict
// with 21420/1337/9333/9360). External artifact = the on-disk send ledger (<session-file>.sends.json), diffed
// before/after, plus HTTP status codes — never the model's status string. Run in a maintenance window.
//
// SAFETY: the default case (stop-before-send) dispatches NO real message (the send is refused after the stop
// reserves the nonce). The same-nonce / diff-body cases each dispatch ONE real prompt to PWA_BOT_ID and so
// require CONFIRM_LIVE_SEND=1 and a THROWAWAY bot.
//
// Cases (argv[2]): stop-before-send | same-nonce | diff-body
// Env: PWA_BASE (default http://127.0.0.1:4173), PWA_COOKIE (a belmont_mobile_session value, or rely on the
// instance running GROK_MOBILE_SKIP_PAIRING=1), PWA_BOT_ID (required — a throwaway bot),
// GROK_MOBILE_SESSION_FILE (defaults to grok-mobile-belmont-pwa/.sessions.json), CONFIRM_LIVE_SEND=1.
// Ledger logic verified in grok-mobile-belmont-pwa/mobile-send-ledger.mjs (send:40-109, stop:110-147);
// routes in grok-mobile-belmont-pwa/server.mjs (messages:1416-1428, stop:1432-1437; ledger file:1061).
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const REPO = process.env.BELMONT_REPO || process.cwd();
const CASE = process.argv[2];
const OUT = process.argv[3] || `/tmp/design-pwa-ledger-${CASE}.json`;
const BASE = process.env.PWA_BASE || "http://127.0.0.1:4173";
const COOKIE = process.env.PWA_COOKIE || null;
const BOT = process.env.PWA_BOT_ID || null;
const SESSION_FILE = process.env.GROK_MOBILE_SESSION_FILE || path.join(REPO, "grok-mobile-belmont-pwa/.sessions.json");
const LEDGER_FILE = `${SESSION_FILE}.sends.json`;
const record = (obj) => {
  fs.writeFileSync(OUT, JSON.stringify({ case: CASE, at: new Date().toISOString(),
    base: BASE, bot: BOT, ledgerFile: LEDGER_FILE, ...obj }, null, 2));
  console.log("EVIDENCE ->", OUT);
};

const readLedger = () => { try { return JSON.parse(fs.readFileSync(LEDGER_FILE, "utf8")).records ?? {}; } catch { return {}; } };
function ledgerDiff(before, after) {
  const added = {}, changed = {};
  for (const [k, v] of Object.entries(after)) {
    if (!(k in before)) added[k] = v;
    else if (JSON.stringify(before[k]) !== JSON.stringify(v)) changed[k] = { before: before[k], after: v };
  }
  return { added, changed, addedCount: Object.keys(added).length, changedCount: Object.keys(changed).length };
}
async function pwa(method, pathname, body) {
  const headers = { "content-type": "application/json" };
  if (COOKIE) headers.cookie = COOKIE.includes("=") ? COOKIE : `belmont_mobile_session=${COOKIE}`;
  const res = await fetch(`${BASE}${pathname}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  let json = null, text = ""; try { text = await res.text(); json = JSON.parse(text); } catch {}
  return { status: res.status, ok: res.ok, body: json, text: text.slice(0, 300) };
}
const nonce = () => `design-l41-${crypto.randomUUID()}`;
const botPath = (suffix) => `/api/bots/${encodeURIComponent(BOT)}/${suffix}`;

async function stopBeforeSend() {
  if (!BOT) { record({ verdict: "BLOCKED_NEEDS_BOT", note: "set PWA_BOT_ID to a throwaway test bot" }); return; }
  const N = nonce();
  const before = readLedger();
  // mobile-send-ledger.mjs:115-124 — stop before any send reserves a cancelled record for the nonce.
  const stop = await pwa("POST", botPath("stop"), { expectedClientNonce: N });
  const send = await pwa("POST", botPath("messages"), { text: "design-l41 probe (should never dispatch)", clientNonce: N });
  const afterSend = readLedger();
  const diff = ledgerDiff(before, afterSend);
  const touched = { ...diff.added, ...Object.fromEntries(Object.entries(diff.changed).map(([k, v]) => [k, v.after])) };
  const reserved = Object.values(touched).find((r) => r?.cancelled === true && r?.dispatchAttempted !== true);
  // send is refused with 409 (mobile-send-ledger.mjs:45) and never dispatched.
  const pass = stop.body?.cancelledSubmission === true && send.status === 409 && !!reserved;
  record({ nonce: N, stopStatus: stop.status, stopBody: stop.body, sendStatus: send.status, sendBody: send.body,
    ledgerDiff: diff, reservedCancelledRecord: reserved ?? null, verdict_pass: pass,
    note: "stop reserves a cancelled record before the send arrives; the late send is refused (409) and never dispatched (dispatchAttempted!=true)" });
}

async function dispatchCase({ tag, secondBodyDiffers }) {
  if (!BOT) { record({ verdict: "BLOCKED_NEEDS_BOT", note: "set PWA_BOT_ID to a throwaway test bot" }); return; }
  if (process.env.CONFIRM_LIVE_SEND !== "1") {
    record({ verdict: "BLOCKED_NEEDS_CONFIRM",
      note: `${tag} dispatches ONE real prompt to ${BOT}; set CONFIRM_LIVE_SEND=1 to run against a throwaway bot in a maintenance window` });
    return;
  }
  const N = nonce();
  const before = readLedger();
  const first = await pwa("POST", botPath("messages"), { text: "design-l41 first", clientNonce: N });
  const second = await pwa("POST", botPath("messages"), { text: secondBodyDiffers ? "design-l41 SECOND-different" : "design-l41 first", clientNonce: N });
  const afterSecond = readLedger();
  const diffAll = ledgerDiff(before, afterSecond);
  const newKeys = Object.keys(diffAll.added);
  let pass, note;
  if (secondBodyDiffers) {
    // mobile-send-ledger.mjs:46 — same nonce + different body -> 409, fingerprint unchanged.
    pass = first.status === 202 && second.status === 409 && newKeys.length === 1;
    note = "same nonce + different body -> 409; exactly one ledger record; the second body never overwrites the first fingerprint";
  } else {
    // mobile-send-ledger.mjs:48 — same nonce + same body -> second short-circuits to accepted; one dispatch only.
    const rec = diffAll.added[newKeys[0]];
    pass = first.status === 202 && second.status === 202 && newKeys.length === 1 && rec?.accepted === true;
    note = "same nonce + same body -> both 202 (second deduped); exactly one accepted ledger record (one real dispatch)";
  }
  record({ tag, nonce: N, firstStatus: first.status, secondStatus: second.status, addedRecordKeys: newKeys, ledgerDiff: diffAll,
    verdict_pass: pass, note,
    followUp: "definitive 'exactly one real send' also needs the Host transcript: query gateway promptAcceptanceStatus / getAgentTranscriptTail with the record.gatewayNonce (best-effort; not included here to avoid coupling this driver to the Host gateway surface)" });
}

const map = {
  "stop-before-send": stopBeforeSend,
  "same-nonce": () => dispatchCase({ tag: "same-nonce", secondBodyDiffers: false }),
  "diff-body": () => dispatchCase({ tag: "diff-body", secondBodyDiffers: true }),
};
if (!map[CASE]) { console.error("unknown case:", CASE, "| choices:", Object.keys(map).join(", ")); process.exit(2); }
await map[CASE]();
