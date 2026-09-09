// Reads the cosmetic payload the browser handed the renderer, from inside the
// Chrome-internal isolated world where the shim actually lives.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map(); const ctxs = []; const exceptions = [];
const call = (m, p = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method === "Runtime.executionContextCreated") ctxs.push({ sessionId: m.sessionId, ...m.params.context }); else if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
ws.on("open", async () => {
  try {
    const url = process.argv[2] || "http://127.0.0.1:18791/index.html";
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
    await call("Page.navigate", { url }, sessionId);
    await sleep(6000);
    out.contexts = ctxs.filter(c => c.sessionId === sessionId).map(c => ({ id: c.id, name: c.name, origin: c.origin, isDefault: c.auxData?.isDefault }));
    for (const c of out.contexts) {
      const r = await call("Runtime.evaluate", { expression: "JSON.stringify({t: typeof globalThis.__asideAdBlock, pend: typeof globalThis.__asideAdBlockPending, gh: globalThis.__asideAdBlock && globalThis.__asideAdBlock.generichide, sel: globalThis.__asideAdBlock && [...globalThis.__asideAdBlock.standardSelectors], proc: globalThis.__asideAdBlock && globalThis.__asideAdBlock.proceduralRules.length, sheets: document.adoptedStyleSheets.length, url: document.URL})", returnByValue: true, contextId: c.id }, sessionId).catch(e => ({ result: { value: "ERR " + e.message } }));
      c.shim = r.result?.value;
    }
    out.exceptions = exceptions.map(e => ({ text: e.text, msg: e.exception?.description?.slice(0, 400), line: e.lineNumber, col: e.columnNumber, ctx: e.executionContextId }));
    out.main = (await call("Runtime.evaluate", { expression: "JSON.stringify({sheets: document.adoptedStyleSheets.length, site1: getComputedStyle(document.getElementById(process.argv[3]||'site1')).display})", returnByValue: true }, sessionId)).result?.value;
    await call("Target.closeTarget", { targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
