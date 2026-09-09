#!/usr/bin/env node
// Real key-input check of fork UI on an isolated instance (see repro-minipopup-close.mjs for the recipe):
// password manager popup via its _execute_action shortcut (Ctrl+Shift+Y), the mini popup via its global
// shortcut, and screenshots of the location bar on Aside extension pages. Writes PNGs next to the log.
import { spawn, execFileSync } from "node:child_process";
import { openSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
const [bin, profileDir, asideHome, display, portStr, logPath] = process.argv.slice(2);
const port = Number(portStr);
const AGENT = "fjdhphbdlfjogobdofoaagnlnkoibdge", PW = "clcdgiameigmljcbkkcbjiljinmfkncl";
const shotDir = path.dirname(logPath);
const out = (o) => console.log(JSON.stringify(o));
const err = openSync(logPath, "a");
const child = spawn(bin, [
  `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "--window-size=1280,800", "--window-position=0,0",
  "--no-first-run", "--no-sandbox", "--no-default-browser-check", "--disable-features=TranslateUI",
  "--disable-session-crashed-bubble", "--hide-crash-restore-bubble", "--password-store=basic",
  "--aside-component-version=1.26.907.1712", ...(process.env.CHECK_CHROME_ARGS?.split(/\s+/).filter(Boolean) ?? []), "about:blank",
], { env: { ...process.env, DISPLAY: display, ASIDE_HOME: asideHome }, stdio: ["ignore", "ignore", err] });
let exited = null;
child.on("exit", (code, signal) => { exited = { code, signal }; });
const alive = () => exited === null;
let version = null;
for (const deadline = Date.now() + 60_000; Date.now() < deadline && alive();) {
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); break; } catch { await delay(500); }
}
if (!version) { out({ step: "cdp", ok: false, exited }); process.exit(2); }
const ws = new WebSocket(version.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let nextId = 1; const pending = new Map();
ws.onmessage = (m) => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); } };
const send = (method, params = {}, sessionId) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); });
const targets = async () => (await send("Target.getTargets")).result.targetInfos;
const find = (list, needle) => list.find((t) => t.url.includes(needle));
const waitFor = async (needle, present = true, ms = 10_000) => { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const t = find(await targets(), needle); if (present ? t : !t) return t ?? null; await delay(250); } return present ? null : find(await targets(), needle); };
const attach = async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
const evalIn = async (sessionId, expression) => (await Promise.race([send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId), delay(5000).then(() => ({ result: { result: { value: "no-reply" } } }))])).result?.result?.value;
const waitCommitted = async (sessionId, page, ms = 10_000) => { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const s = await evalIn(sessionId, "location.href.split('/').pop().split('?')[0] + ' ' + document.readyState"); if (s === `${page} complete`) return true; await delay(100); } return false; };
const xdo = (...args) => { try { return execFileSync("xdotool", args, { env: { ...process.env, DISPLAY: display }, encoding: "utf8", timeout: 10_000 }).trim(); } catch (e) { return `xdotool-error:${(e.stdout || e.message || "").toString().split("\n")[0]}`; } };
const shot = (name) => { const file = path.join(shotDir, `shot-${name}.png`); try { execFileSync("import", ["-display", display, "-window", "root", file], { timeout: 15_000 }); return file; } catch (e) { return `shot-error:${e.message.split("\n")[0]}`; } };
const mainWindow = () => { const wins = xdo("search", "--onlyvisible", "--name", ".").split("\n").filter((w) => /^\d+$/.test(w)); return wins.find((w) => /about:blank|New Tab|Chromium/.test(xdo("getwindowname", w)) && !/^Aside/.test(xdo("getwindowname", w))); };
const focusMain = async () => { const w = mainWindow(); if (w) { xdo("windowfocus", w); await delay(500); } return w ? xdo("getwindowname", w) : null; };

// 1. password manager popup through its _execute_action shortcut
out({ step: "focus", window: await focusMain() });
xdo("key", "--clearmodifiers", "ctrl+shift+y");
const pw = await waitFor(`${PW}/popup.html`, true, 8000);
out({ step: "pw-popup-open", opened: !!pw, type: pw?.type ?? null });
if (pw) {
  const s = await attach(pw.targetId);
  const committed = await waitCommitted(s, "popup.html");
  await delay(1500);
  const size = await evalIn(s, "JSON.stringify({ inner: [innerWidth, innerHeight], body: [document.body.scrollWidth, document.body.scrollHeight], title: document.title })");
  out({ step: "pw-popup-size", committed, size: JSON.parse(size || "null"), shot: shot("pw-popup") });
  const called = await evalIn(s, "window.close(); 'called'");
  out({ step: "pw-popup-window.close", called, popupGone: !(await waitFor(`${PW}/popup.html`, false, 5000)), alive: alive() });
}

// 2. mini popup via its global shortcut
let sw = null;
for (let i = 0; i < 40 && !sw; i++) { sw = (await targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${AGENT}/`)); if (!sw) await delay(500); }
const swSession = await attach(sw.targetId);
let enabled = await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.getEnabled((v) => res(JSON.stringify(v ?? null))))");
if (enabled !== "true") {
  // A fresh profile starts with the global shortcut disabled (aside.mini_popup.enabled in Local State).
  const set = await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.setEnabled(true, (v) => res(JSON.stringify(chrome.runtime.lastError?.message ?? v ?? 'ok'))))");
  enabled = await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.getEnabled((v) => res(JSON.stringify(v ?? null))))");
  out({ step: "minipopup-enable", set, enabled });
}
let shortcut = await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.getShortcut((v) => res(JSON.stringify(v ?? null))))");
out({ step: "minipopup-shortcut", enabled, stored: shortcut });
if (!shortcut || shortcut === "null" || shortcut === '""') {
  const set = await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.setShortcut('Ctrl+Shift+Space', (v) => res(JSON.stringify(chrome.runtime.lastError?.message ?? v ?? 'ok'))))");
  shortcut = await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.getShortcut((v) => res(JSON.stringify(v ?? null))))");
  out({ step: "minipopup-shortcut-set", set, stored: shortcut });
}
const combo = String(JSON.parse(shortcut || '""') || "").toLowerCase().replace(/\s+/g, "").replace(/\+/g, "+");
if (combo) {
  await focusMain();
  xdo("key", "--clearmodifiers", combo);
  const popup = await waitFor(`${AGENT}/minipopup.html`, true, 8000);
  out({ step: "minipopup-by-key", combo, opened: !!popup });
  if (popup) {
    const s = await attach(popup.targetId);
    await waitCommitted(s, "minipopup.html");
    await delay(1500);
    const vis1 = await evalIn(s, "document.visibilityState");
    const shot1 = shot("minipopup-key");
    xdo("key", "--clearmodifiers", combo);
    await delay(1500);
    const vis2 = await evalIn(s, "document.visibilityState");
    const stillListed = !!find(await targets(), "minipopup.html");
    out({ step: "minipopup-toggle", visibleAfterOpen: vis1, visibleAfterSecondPress: vis2, hostKept: stillListed, shot: shot1, alive: alive() });
    if (stillListed) await evalIn(s, "window.close(); 'x'");
  }
}

// 3. location bar on Aside extension pages (screenshot; the fork replaces the URL with a page title)
for (const page of ["newtab.html", "main.html"]) {
  const t = await send("Target.createTarget", { url: `chrome-extension://${AGENT}/${page}` });
  await delay(3000);
  const s = await attach(t.result.targetId);
  const title = await evalIn(s, "document.title");
  out({ step: "omnibox", page, title, shot: shot(`omnibox-${page.replace(".html", "")}`), alive: alive() });
  await send("Target.closeTarget", { targetId: t.result.targetId });
  await delay(500);
}
await send("Browser.close");
await delay(3000);
out({ step: "done", exited });
process.exit(0);
