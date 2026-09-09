import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map(); const events = [];
const call = (m, p = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push({ t: Date.now(), method: m.method, params: m.params, sessionId: m.sessionId }); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { samples: [] };
ws.on("open", async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
    const t0 = Date.now();
    await call("Page.navigate", { url: process.argv[2] || "http://127.0.0.1:18791/index.html" }, sessionId);
    for (let i = 0; i < 25; i++) {
      await sleep(200);
      const iso = events.filter(e => e.sessionId === sessionId && e.method === "Runtime.executionContextCreated" && e.params.context.auxData?.isDefault === false).map(e => e.params.context.id);
      const last = iso[iso.length - 1];
      let v = "no-iso-ctx";
      if (last !== undefined) {
        const r = await call("Runtime.evaluate", { expression: "JSON.stringify({t: typeof globalThis.__asideAdBlock, p: typeof globalThis.__asideAdBlockPending, sheets: document.adoptedStyleSheets.length, ready: document.readyState})", contextId: last, returnByValue: true }, sessionId).catch(e => ({ result: { value: "ERR " + String(e.message).slice(0, 80) } }));
        v = r.result?.value;
      }
      out.samples.push({ ms: Date.now() - t0, ctxs: iso.join(","), v });
    }
    out.ctxEvents = events.filter(e => e.sessionId === sessionId && /executionContext/.test(e.method)).map(e => ({ ms: e.t - t0, m: e.method.replace("Runtime.executionContext", ""), id: e.params.context?.id ?? e.params.executionContextId, def: e.params.context?.auxData?.isDefault, origin: e.params.context?.origin }));
    await call("Target.closeTarget", { targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
