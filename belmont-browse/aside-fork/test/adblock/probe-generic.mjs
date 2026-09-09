// Opens the generic-lookup page and reports what the cosmetic path did (main-world view).
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const url = process.argv[2] || "http://127.0.0.2:18777/generic.html";
const ver = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
ws.on("open", async () => {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
  await call("Page.navigate", { url }, sessionId);
  await sleep(4000);
  const r = await call("Runtime.evaluate", { expression: `JSON.stringify({sheets: document.adoptedStyleSheets.length, rules: document.adoptedStyleSheets[0] ? document.adoptedStyleSheets[0].cssRules.length : -1, gen1: getComputedStyle(document.getElementById('gen1')).display, late: document.getElementById('late') ? getComputedStyle(document.getElementById('late')).display : 'missing'})`, returnByValue: true }, sessionId);
  console.log(url, r.result?.value);
  await call("Target.closeTarget", { targetId });
  process.exit(0);
});
