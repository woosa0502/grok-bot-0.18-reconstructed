#!/usr/bin/env node
// Regression check for the Aside mini popup close path (2026-09-09 crash: ExtensionHost::Close with no close handler).
// Run it against a scratch profile in an isolated network namespace so the extension cannot reach the live daemon:
//   unshare -Urn sh -c "ip link set lo up; Xvfb :96 -screen 0 1280x800x24 -nolisten tcp & sleep 2; node tools/repro-minipopup-close.mjs <chrome> <scratch-profile> <scratch-aside-home> :96 9343 <chrome.log> after"
// Prepare <scratch-profile> with tools/prepare-native-components.mjs first. Expected on a fixed binary: alive:true after window.close, popup target gone, reopen OK.
// window.close(). Pre-fix binary: browser dies with "Check failed: !is_null()" (ExtensionHost::Close).
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const [bin, profileDir, asideHome, display, portStr, logPath, label] = process.argv.slice(2);
const port = Number(portStr);
const EXT = "fjdhphbdlfjogobdofoaagnlnkoibdge";
const out = (o) => console.log(JSON.stringify({ label, ...o }));
const err = openSync(logPath, "a");
const child = spawn(bin, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--window-size=1280,800", "--window-position=0,0",
  "--no-first-run", "--no-sandbox", "--no-default-browser-check", "--disable-features=TranslateUI",
  "--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--password-store=basic",
  "--aside-component-version=1.26.907.1712", "about:blank",
], { env: { ...process.env, DISPLAY: display, ASIDE_HOME: asideHome }, stdio: ["ignore", "ignore", err] });
let exited = null;
child.on("exit", (code, signal) => { exited = { code, signal }; });
const alive = () => exited === null;
const deadline = Date.now() + 60_000;
let version = null;
while (Date.now() < deadline && alive()) {
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await delay(500); }
}
if (!version) { out({ step: "cdp", ok: false, exited }); process.exit(2); }
out({ step: "cdp", ok: true, browser: version.Browser });
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } else events.push(msg); };
const send = (method, params = {}, sessionId) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const targets = async () => (await send("Target.getTargets")).result.targetInfos;
const attach = async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
const evalIn = async (sessionId, expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)).result;
// Act only on the committed extension document: in the initial about:blank document of a fresh host, a
// window.open() trips an upstream content CHECK (rfs_document_data_from_creator); no extension code can run
// there, so that is a harness hazard, not a user path.
const waitCommitted = async (sessionId, page, ms = 10_000) => { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const s = (await evalIn(sessionId, "location.href.split('/').pop().split(/[?#]/)[0] + ' ' + document.readyState")).result?.value; if (s === `${page} complete`) return true; await delay(100); } return false; };
// 1. find an extension context that can call chrome.asideMiniPopup (service worker, else open sidepanel.html in a tab)
let ctx = null;
for (let i = 0; i < 40 && !ctx; i++) {
  const sw = (await targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${EXT}/`));
  if (sw) ctx = { kind: "service_worker", sessionId: await attach(sw.targetId) };
  else await delay(500);
}
if (!ctx) {
  const created = await send("Target.createTarget", { url: `chrome-extension://${EXT}/sidepanel.html` });
  await delay(2000);
  ctx = { kind: "sidepanel-tab", sessionId: await attach(created.result.targetId) };
}
const api = await evalIn(ctx.sessionId, "typeof chrome !== 'undefined' && chrome.asideMiniPopup ? Object.keys(chrome.asideMiniPopup).join(',') : 'absent'");
out({ step: "context", kind: ctx.kind, api: api.result?.value ?? api });
const openPopup = async () => {
  const r = await evalIn(ctx.sessionId, "new Promise((res) => { try { const p = chrome.asideMiniPopup.setState('expanded', () => res('cb:' + (chrome.runtime.lastError?.message ?? 'ok'))); if (p && p.then) p.then(() => res('promise:ok'), (e) => res('promise:' + e.message)); } catch (e) { res('throw:' + e.message); } setTimeout(() => res('timeout'), 3000); })");
  let popup = null;
  for (let i = 0; i < 20 && !popup; i++) { popup = (await targets()).find((t) => t.url.includes("minipopup.html")); if (!popup) await delay(500); }
  return { call: r.result?.value ?? r, popup };
};
const first = await openPopup();
out({ step: "open-popup", call: first.call, popup: first.popup ? { type: first.popup.type, url: first.popup.url } : null });
if (!first.popup) { await send("Browser.close"); process.exit(3); }
// 2. the page closes itself
const popupSession = await attach(first.popup.targetId);
out({ step: "popup-committed", committed: await waitCommitted(popupSession, "minipopup.html") });
const closeResult = await Promise.race([evalIn(popupSession, "window.close(); 'called'"), delay(5000).then(() => "no-reply")]);
await delay(3000);
out({ step: "window.close", result: closeResult?.result?.value ?? closeResult, alive: alive(), exited });
if (!alive()) process.exit(0);
// 3. post-fix expectations: popup target gone, popup can be reopened, closes again without crash
const stillListed = (await targets()).some((t) => t.url.includes("minipopup.html"));
const second = await openPopup();
let secondClose = null;
if (second.popup) {
  const s = await attach(second.popup.targetId);
  await waitCommitted(s, "minipopup.html");
  secondClose = (await Promise.race([evalIn(s, "window.close(); 'called'"), delay(5000).then(() => "no-reply")]))?.result?.value ?? "no-reply";
  await delay(2000);
}
out({ step: "after-close", popupStillListed: stillListed, reopened: !!second.popup, secondClose, alive: alive(), exited });
await send("Browser.close");
await delay(3000);
out({ step: "done", exited });
process.exit(0);
