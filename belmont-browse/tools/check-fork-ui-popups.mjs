#!/usr/bin/env node
// Real-operation check of two more fork UI pieces on a scratch instance (same recipe as check-fork-ui-close-paths.mjs):
// the password manager toolbar popup (upstream ExtensionPopup path) closing on window.close() and Escape, and the
// mini popup global shortcut. Takes X screenshots into SHOT_DIR so the omnibox/strip can be looked at.
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
const send = (method, params = {}, sessionId) => new Promise((resolve) => { const id = nextId++; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })); setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ error: { message: `timeout: ${method}` } }); } }, 15_000).unref(); });
process.on("unhandledRejection", (e) => out({ step: "unhandled", error: String(e?.message ?? e) }));
const targets = async () => (await send("Target.getTargets")).result.targetInfos;
const find = (list, needle) => list.find((t) => t.url.includes(needle));
const waitFor = async (needle, present = true, ms = 10_000) => { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const t = find(await targets(), needle); if (present ? t : !t) return t ?? null; await delay(250); } return present ? null : find(await targets(), needle); };
const attach = async (targetId) => (await send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
const evalIn = async (sessionId, expression) => (await Promise.race([send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId), delay(5000).then(() => ({ result: { result: { value: "no-reply" } } }))])).result?.result?.value;
// Act only on the committed extension document: in the initial about:blank document of a fresh host, a
// window.open() trips an upstream content CHECK (rfs_document_data_from_creator); no extension code can run
// there, so that is a harness hazard, not a user path.
const waitCommitted = async (sessionId, page, ms = 10_000) => { for (const deadline = Date.now() + ms; Date.now() < deadline;) { const s = await evalIn(sessionId, "location.href.split('/').pop().split(/[?#]/)[0] + ' ' + document.readyState"); if (s === `${page} complete`) return true; await delay(100); } return false; };
const xdo = (...args) => { try { return execFileSync("xdotool", args, { env: { ...process.env, DISPLAY: display }, encoding: "utf8", timeout: 10_000 }).trim(); } catch (e) { return `xdotool-error:${(e.stdout || e.message || "").toString().split("\n")[0]}`; } };

const PW = "clcdgiameigmljcbkkcbjiljinmfkncl";
const shotDir = process.env.SHOT_DIR || ".";
const shot = (name) => { try { execFileSync("import", ["-display", display, "-window", "root", `${shotDir}/${name}.png`], { timeout: 15_000 }); return `${name}.png`; } catch (e) { return `shot-error:${e.message.split("\n")[0]}`; } };
const visibleWindows = () => xdo("search", "--onlyvisible", "--name", "").split("\n").filter((w) => /^\d+$/.test(w)).map((w) => `${xdo("getwindowname", w) || "(untitled)"}@${xdo("getwindowgeometry", w).replace(/\s+/g, " ")}`);
const swFor = async (ext) => { let sw = null; for (let i = 0; i < 40 && !sw; i++) { sw = (await targets()).find((t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${ext}/`)); if (!sw) await delay(500); } return sw ? attach(sw.targetId) : null; };
await delay(1500);
out({ step: "start", windows: visibleWindows(), shot: shot("00-start") });

// A. password manager toolbar popup: opened through the extension's own chrome.action.openPopup()
const pwSw = await swFor(PW);
out({ step: "pw-sw", found: !!pwSw });
if (pwSw) {
  const opened = await evalIn(pwSw, "chrome.action.openPopup().then(() => 'ok', (e) => 'err:' + e.message)");
  const popup = await waitFor(`${PW}/popup.html`, true, 8000);
  out({ step: "pw-popup-open", opened, popup: !!popup, windows: visibleWindows() });
  if (popup) {
    const ps = await attach(popup.targetId);
    const committed = await waitCommitted(ps, "popup.html");
    const where = await evalIn(ps, "location.pathname + ' ' + document.readyState + ' ' + innerWidth + 'x' + innerHeight");
    const win = await send("Browser.getWindowForTarget", { targetId: popup.targetId });
    out({ step: "pw-popup-committed", committed, where, browserWindow: win?.result?.bounds ?? win?.error?.message ?? null, windows: visibleWindows(), shot: shot("01-pw-popup") });
    const called = await evalIn(ps, "window.close(); 'called'");
    out({ step: "pw-popup-window.close", called, popupGone: !(await waitFor(`${PW}/popup.html`, false, 5000)), alive: alive() });
    // Escape reaching the popup host (ExtensionViewHost::HandleKeyboardEvent -> Close -> ExtensionPopup handler)
    const opened2 = await evalIn(pwSw, "chrome.action.openPopup().then(() => 'ok', (e) => 'err:' + e.message)");
    const popup2 = await waitFor(`${PW}/popup.html`, true, 8000);
    if (popup2) {
      const ps2 = await attach(popup2.targetId);
      await waitCommitted(ps2, "popup.html");
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, ps2);
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }, ps2);
      out({ step: "pw-popup-escape", opened: opened2, popupGone: !(await waitFor(`${PW}/popup.html`, false, 5000)), alive: alive() });
    } else out({ step: "pw-popup-escape", opened: opened2, popup: false });
  }
}

// B. mini popup global shortcut
const asideSw = await swFor(EXT);
if (asideSw) {
  let shortcut = await evalIn(asideSw, "new Promise((res) => chrome.asideMiniPopup.getShortcut((s) => res(typeof s === 'string' ? s : JSON.stringify(s))))");
  if (!shortcut || shortcut === "" || shortcut === "null" || shortcut === "undefined") {
    const set = await evalIn(asideSw, "new Promise((res) => chrome.asideMiniPopup.setShortcut('Ctrl+Shift+Space', () => res(chrome.runtime.lastError?.message ?? 'set')))");
    shortcut = await evalIn(asideSw, "new Promise((res) => chrome.asideMiniPopup.getShortcut((s) => res(typeof s === 'string' ? s : JSON.stringify(s))))");
    out({ step: "mini-shortcut-set", set, shortcut });
  } else out({ step: "mini-shortcut", shortcut });
  const main = xdo("search", "--onlyvisible", "--name", "Chromium").split("\n").filter((w) => /^\d+$/.test(w))[0];
  if (main) { xdo("windowfocus", main); await delay(500); }
  const key = String(shortcut).replace(/Ctrl/i, "ctrl").replace(/Shift/i, "shift").replace(/Alt/i, "alt").replace(/Space/i, "space").replace(/\+/g, "+");
  xdo("key", "--clearmodifiers", key);
  const popup = await waitFor("minipopup.html", true, 6000);
  await delay(3000);
  const dom = popup ? await evalIn(await attach(popup.targetId), "document.readyState + ' body-children=' + document.body.childElementCount + ' text=' + JSON.stringify(document.body.innerText.slice(0, 120)) + ' bg=' + getComputedStyle(document.body).backgroundColor + ' size=' + innerWidth + 'x' + innerHeight") : null;
  out({ step: "mini-popup-dom", dom });
  const popupWindow = xdo("search", "--onlyvisible", "--name", "").split("\n").filter((w) => /^\d+$/.test(w)).find((w) => /Geometry: 420x/.test(xdo("getwindowgeometry", w)));
  const windowShot = popupWindow ? (() => { try { execFileSync("import", ["-display", display, "-window", popupWindow, `${shotDir}/02b-mini-popup-window.png`], { timeout: 15_000 }); return "02b-mini-popup-window.png"; } catch (e) { return `shot-error:${e.message.split("\n")[0]}`; } })() : null;
  out({ step: "mini-shortcut-open", key, popup: !!popup, windows: visibleWindows(), shot: shot("02-mini-popup"), windowShot });
  if (popup) {
    xdo("key", "--clearmodifiers", key);
    await delay(1500);
    out({ step: "mini-shortcut-toggle-hide", windows: visibleWindows(), shot: shot("03-mini-popup-hidden") });
  }
}
await send("Browser.close"); await delay(2000); out({ step: "done", exited }); process.exit(0);
