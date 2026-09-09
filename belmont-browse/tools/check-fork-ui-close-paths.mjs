#!/usr/bin/env node
// Real-operation check of the fork-restored UI close paths, on an isolated instance (see repro-minipopup-close.mjs
// for the namespace/Xvfb recipe): mini popup window.close(), mini popup options window window.close(), and the
// tab search bubble's own window.close() (the extension calls it on Escape and after picking a tab).
import { spawn, execFileSync } from "node:child_process";
import { openSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
const [bin, profileDir, asideHome, display, portStr, logPath] = process.argv.slice(2);
const port = Number(portStr);
const EXT = "fjdhphbdlfjogobdofoaagnlnkoibdge";
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
// Act only on the committed extension document: in the initial about:blank document of a fresh host, a
// window.open() trips an upstream content CHECK (rfs_document_data_from_creator); no extension code can run
// there, so that is a harness hazard, not a user path.
const waitCommitted = async (sessionId, page, ms = 10_000) => { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const s = await evalIn(sessionId, "location.href.split('/').pop().split('?')[0] + ' ' + document.readyState"); if (s === `${page} complete`) return true; await delay(100); } return false; };
const xdo = (...args) => { try { return execFileSync("xdotool", args, { env: { ...process.env, DISPLAY: display }, encoding: "utf8", timeout: 10_000 }).trim(); } catch (e) { return `xdotool-error:${(e.stdout || e.message || "").toString().split("\n")[0]}`; } };

// 1. mini popup + its options window
let sw = null;
for (let i = 0; i < 40 && !sw; i++) { sw = (await targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${EXT}/`)); if (!sw) await delay(500); }
const swSession = await attach(sw.targetId);
await evalIn(swSession, "new Promise((res) => chrome.asideMiniPopup.setState('expanded', () => res('ok')))");
const popup = await waitFor("minipopup.html");
out({ step: "minipopup-open", popup: !!popup });
if (popup) {
  const ps = await attach(popup.targetId);
  out({ step: "minipopup-committed", committed: await waitCommitted(ps, "minipopup.html") });
  const opened = await evalIn(ps, "String(!!window.open('minipopup-options.html?left=20&top=20&width=360&height=240', '_blank', 'popup=yes'))");
  const options = await waitFor("minipopup-options.html");
  const windowNames = () => xdo("search", "--onlyvisible", "--name", ".").split("\n").filter((w) => /^\d+$/.test(w)).map((w) => xdo("getwindowname", w));
  // A Browser-hosted page answers Browser.getWindowForTarget; the fork's own frameless options widget does not.
  const hosting = options ? await send("Browser.getWindowForTarget", { targetId: options.targetId }) : null;
  out({ step: "options-open", opened, options: options ? { type: options.type } : null, windows: windowNames(), browserWindow: hosting?.result ? { id: hosting.result.windowId, state: hosting.result.bounds?.windowState } : hosting?.error?.message ?? null });
  if (options) {
    const os = await attach(options.targetId);
    out({ step: "options-committed", committed: await waitCommitted(os, "minipopup-options.html") });
    const called = await evalIn(os, "window.close(); 'called'");
    const gone = !(await waitFor("minipopup-options.html", false, 5000));
    out({ step: "options-window.close", called, optionsGone: gone, popupStill: !!find(await targets(), "minipopup.html"), alive: alive(), windows: windowNames() });
    if (!gone) { for (const t of await targets()) if (t.url.includes("minipopup-options")) await send("Target.closeTarget", { targetId: t.targetId }); await delay(1000); }
  }
  const called = await evalIn(ps, "window.close(); 'called'");
  out({ step: "minipopup-window.close", called, popupGone: !(await waitFor("minipopup.html", false, 5000)), alive: alive() });
}

// 2. tab search bubble (Ctrl+Shift+A on the browser window), then the page's own window.close()
let wins = [];
for (let i = 0; i < 20 && wins.length === 0; i++) { wins = xdo("search", "--onlyvisible", "--name", ".").split("\n").filter((w) => /^\d+$/.test(w)); if (wins.length === 0) await delay(500); }
const named = wins.map((w) => `${w}:${xdo("getwindowname", w)}`);
out({ step: "x-windows", windows: named.slice(0, 6) });
const target = wins.find((w) => /about:blank|New Tab/i.test(xdo("getwindowname", w))) ?? wins.find((w) => /Chromium/.test(xdo("getwindowname", w)) && !/^Aside/.test(xdo("getwindowname", w)));
if (target) { xdo("windowactivate", target); xdo("windowfocus", target); await delay(700); xdo("key", "--clearmodifiers", "ctrl+shift+a"); }
out({ step: "tabsearch-key-sent", to: target ? xdo("getwindowname", target) : null });
const tabsearch = await waitFor("tabsearch.html", true, 10_000);
out({ step: "tabsearch-open", opened: !!tabsearch, type: tabsearch?.type ?? null });
if (tabsearch) {
  const ts = await attach(tabsearch.targetId);
  out({ step: "tabsearch-committed", committed: await waitCommitted(ts, "tabsearch.html") });
  const called = await evalIn(ts, "window.close(); 'called'");
  const gone = !(await waitFor("tabsearch.html", false, 4000));
  out({ step: "tabsearch-window.close", called, bubbleGone: gone, alive: alive() });
  if (!gone) {
    // Escape through the page (the extension's own handler calls window.close()); then Escape at the views layer.
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, ts);
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }, ts);
    const goneAfterEscape = !(await waitFor("tabsearch.html", false, 3000));
    out({ step: "tabsearch-escape-in-page", bubbleGone: goneAfterEscape, alive: alive() });
    if (!goneAfterEscape) { xdo("key", "--clearmodifiers", "Escape"); out({ step: "tabsearch-escape-x11", bubbleGone: !(await waitFor("tabsearch.html", false, 3000)), alive: alive() }); }
  }
}
await send("Browser.close");
await delay(3000);
out({ step: "done", exited });
process.exit(0);
