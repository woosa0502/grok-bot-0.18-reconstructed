import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const ver = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map(); const events = [];
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push(m); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
ws.on("open", async () => {
  try {
    for (const url of [process.argv[2]]) {
      const { targetId } = await call("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
      await call("Network.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
      await call("Page.navigate", { url }, sessionId);
      await sleep(7000);
      const req = events.filter(e => e.sessionId === sessionId && e.method === "Network.requestWillBeSent").map(e => e.params.request.url);
      const failed = events.filter(e => e.sessionId === sessionId && e.method === "Network.loadingFailed").map(e => e.params.errorText);
      const r = await call("Runtime.evaluate", { expression: `JSON.stringify({origin: location.origin, results: window.__results||null})`, returnByValue: true }, sessionId);
      console.log(JSON.stringify({ url, requests: req.length, sample: req.slice(1, 5).map(u => u.slice(0, 60)), failed, page: r.result?.value }));
      await call("Target.closeTarget", { targetId });
    }
  } catch (e) { console.log("ERR", String(e)); }
  process.exit(0);
});
