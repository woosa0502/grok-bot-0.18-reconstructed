import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const ver = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
ws.on("open", async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "http://127.0.0.1:18777/index.html" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Runtime.enable", {}, sessionId);
    await sleep(5000);
    const r = await call("Runtime.evaluate", { expression: `(()=>{const s=document.getElementById('__aside_adblock_hide');return JSON.stringify({len: s? s.textContent.length: -1, head: s? s.textContent.slice(0,200): null, hasAdsbygoogle: s? s.textContent.includes('.adsbygoogle'): null, rules: s&&s.sheet? s.sheet.cssRules.length: -1, supports: CSS.supports('selector(.adsbygoogle)')})})()`, returnByValue: true }, sessionId);
    console.log(r.result?.value || JSON.stringify(r));
    await call("Target.closeTarget", { targetId });
  } catch (e) { console.log("ERR", String(e)); }
  process.exit(0);
});
