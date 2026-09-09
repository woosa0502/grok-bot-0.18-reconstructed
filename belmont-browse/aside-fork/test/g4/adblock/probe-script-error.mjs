// Runs the production cosmetic script inside the same Chrome-internal isolated
// world the renderer injects it into, and reports what it throws.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { readFileSync } from "node:fs";
const header = readFileSync("/home/hoon/chromium/src/chrome/renderer/aside_adblock/aside_adblock_cosmetic_script.h", "utf8");
const script = header.match(/R"ASIDEJS\(([\s\S]*?)\)ASIDEJS"/)[1];
const payload = process.env.G4_PAYLOAD || JSON.stringify({ generichide: true, hideSelectors: [".aside-site-specific"], proceduralActions: [] });
const injected = script.replace(/\(\$1\);\s*$/, "(" + payload + ");");
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map(); const ctxs = [];
const call = (m, p = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.executionContextCreated") ctxs.push({ sessionId: m.sessionId, ...m.params.context }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
ws.on("open", async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
    await call("Page.navigate", { url: process.argv[2] || "http://127.0.0.1:18791/index.html" }, sessionId);
    await sleep(6000);
    const iso = ctxs.filter(c => c.sessionId === sessionId && c.auxData?.isDefault === false).pop();
    out.isolatedContext = iso?.id;
    out.injectedSize = injected.length;
    const r = await call("Runtime.evaluate", { expression: injected, contextId: iso.id, returnByValue: true }, sessionId);
    out.result = r.result?.value ?? r.result?.type;
    out.exception = r.exceptionDetails && { text: r.exceptionDetails.text, desc: r.exceptionDetails.exception?.description?.slice(0, 600), line: r.exceptionDetails.lineNumber };
    const after = await call("Runtime.evaluate", { expression: "JSON.stringify({t: typeof globalThis.__asideAdBlock, sheets: document.adoptedStyleSheets.length})", contextId: iso.id, returnByValue: true }, sessionId);
    out.after = after.result?.value;
    const main = await call("Runtime.evaluate", { expression: "JSON.stringify({sheets: document.adoptedStyleSheets.length, site1: getComputedStyle(document.getElementById('site1')).display})", returnByValue: true }, sessionId);
    out.main = main.result?.value;
    await call("Target.closeTarget", { targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
