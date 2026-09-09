// Mini popup checks over CDP (port 9333) + X11 (:97): shortcut registration, toggle, options window.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { execSync } from "node:child_process";
const DISPLAY = process.env.DISPLAY_NUM || ":97";
const j = await (await fetch("http://127.0.0.1:9333/json")).json();
const sw = j.find(t => t.type === "service_worker" && t.url.includes("fjdhphbdlfjogobd"));
if (!sw) { console.log(JSON.stringify({ error: "Aside SW not found" })); process.exit(0); }
const ws = new WebSocket(sw.webSocketDebuggerUrl);
let id = 1; const pend = new Map();
const call = (m, p = {}) => new Promise((res, rej) => { const i = id++; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => rej(new Error("timeout " + m)), 10000); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ev = async (expr) => (await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
const api = (code) => ev(`(async()=>{try{ return JSON.stringify({ok: await (${code})}); }catch(e){ return JSON.stringify({err: String(e)}); }})()`);
function xwins() {
  try {
    const ids = execSync(`DISPLAY=${DISPLAY} xdotool search --onlyvisible --name ''`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    return ids.map(w => { try { return { id: w, name: execSync(`DISPLAY=${DISPLAY} xdotool getwindowname ${w}`, { encoding: "utf8" }).trim(), geom: execSync(`DISPLAY=${DISPLAY} xdotool getwindowgeometry ${w}`, { encoding: "utf8" }).replace(/\s+/g, " ").trim() }; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}
const out = {};
ws.on("open", async () => {
  try {
    await call("Runtime.enable");
    out.getEnabled = JSON.parse(await api(`chrome.asideMiniPopup.getEnabled()`));
    out.getShortcut = JSON.parse(await api(`chrome.asideMiniPopup.getShortcut()`));
    out.setShortcutInvalid = JSON.parse(await api(`chrome.asideMiniPopup.setShortcut("Bogus+Key")`));
    out.setShortcutAltSpace = JSON.parse(await api(`chrome.asideMiniPopup.setShortcut("Alt+Space")`));
    out.setEnabled = JSON.parse(await api(`chrome.asideMiniPopup.setEnabled(true)`));
    out.getEnabledAfter = JSON.parse(await api(`chrome.asideMiniPopup.getEnabled()`));
    // hide first so the toggle shows
    await api(`chrome.asideMiniPopup.hide()`);
    await sleep(500);
    const before = xwins().filter(w => /AsideMiniPopup/.test(w.name) || w.geom.includes("440x") || w.geom.includes("420x"));
    execSync(`DISPLAY=${DISPLAY} xdotool key --clearmodifiers alt+space`);
    await sleep(2500);
    const targets1 = (await (await fetch("http://127.0.0.1:9333/json")).json()).filter(t => t.url.includes("minipopup")).map(t => t.url.slice(0, 90));
    const wins1 = xwins();
    out.afterShortcut = { minipopupTargets: targets1, windows: wins1.filter(w => !/Chromium|Window \d+$/.test(w.name) || /Aside/.test(w.name)).slice(0, 8), beforeCount: before.length, count: wins1.length };
    // toggle again -> hidden
    execSync(`DISPLAY=${DISPLAY} xdotool key --clearmodifiers alt+space`);
    await sleep(1500);
    out.afterSecondShortcut = { count: xwins().length };
    // show via API and open the options window from the popup page
    await api(`chrome.asideMiniPopup.setState("expanded")`);
    await sleep(2000);
    const pages = (await (await fetch("http://127.0.0.1:9333/json")).json());
    const mp = pages.find(t => t.type === "page" && /minipopup\.html/.test(t.url));
    out.popupTarget = mp ? mp.url.slice(0, 100) : null;
    if (mp) {
      const ws2 = new WebSocket(mp.webSocketDebuggerUrl);
      let id2 = 1; const pend2 = new Map();
      const call2 = (m, p = {}) => new Promise((res, rej) => { const i = id2++; pend2.set(i, { res, rej }); ws2.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => rej(new Error("timeout " + m)), 10000); });
      ws2.on("message", d => { const m = JSON.parse(d); if (m.id && pend2.has(m.id)) { const { res, rej } = pend2.get(m.id); pend2.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
      await new Promise(r => ws2.on("open", r));
      await call2("Runtime.enable");
      const opened = await call2("Runtime.evaluate", { expression: `(()=>{const u=new URL(chrome.runtime.getURL('minipopup-options.html'));u.searchParams.set('left','500');u.searchParams.set('top','300');u.searchParams.set('width','360');u.searchParams.set('height','240');const w=window.open(u.href,'_blank','popup=yes');window.__optWin=w;return w?'handle':'null';})()`, returnByValue: true, userGesture: true });
      out.optionsOpen = opened.result?.value;
      await sleep(2500);
      const pages2 = (await (await fetch("http://127.0.0.1:9333/json")).json());
      out.optionsTarget = pages2.filter(t => /minipopup-options/.test(t.url)).map(t => t.url.slice(0, 100));
      out.optionsWindowBefore = xwins().filter(w => /360x240|AsideMiniPopupOptions/.test(w.geom + w.name)).map(w => w.geom);
      const opt = pages2.find(t => /minipopup-options/.test(t.url));
      if (opt) {
        const ws3 = new WebSocket(opt.webSocketDebuggerUrl);
        let id3 = 1; const pend3 = new Map();
        const call3 = (m, p = {}) => new Promise((res, rej) => { const i = id3++; pend3.set(i, { res, rej }); ws3.send(JSON.stringify({ id: i, method: m, params: p })); setTimeout(() => rej(new Error("timeout " + m)), 10000); });
        ws3.on("message", d => { const m = JSON.parse(d); if (m.id && pend3.has(m.id)) { const { res, rej } = pend3.get(m.id); pend3.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
        await new Promise(r => ws3.on("open", r));
        await call3("Runtime.enable");
        const r = await call3("Runtime.evaluate", { expression: `(async()=>{try{await chrome.asideMiniPopup.setOptionWindowSize(400,300);return 'resized';}catch(e){return 'ERR '+e;}})()`, awaitPromise: true, returnByValue: true });
        out.setOptionWindowSize = r.result?.value;
        await sleep(1000);
        out.optionsWindowAfter = xwins().filter(w => /400x300|AsideMiniPopupOptions/.test(w.geom + w.name)).map(w => w.geom);
        ws3.close();
      }
      try { execSync(`DISPLAY=${DISPLAY} import -window root /home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/ui-shots/26-minipopup-options-window.png`); } catch {}
      await call2("Runtime.evaluate", { expression: `window.__optWin && window.__optWin.close(); 'closed'`, returnByValue: true });
      await sleep(1500);
      const pages3 = (await (await fetch("http://127.0.0.1:9333/json")).json());
      out.optionsAfterClose = pages3.filter(t => /minipopup-options/.test(t.url)).length;
      ws2.close();
    }
    await api(`chrome.asideMiniPopup.hide()`);
    await api(`chrome.asideMiniPopup.setEnabled(false)`);
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("wserr", String(e)); process.exit(0); });
