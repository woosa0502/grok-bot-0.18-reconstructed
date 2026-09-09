import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const ver = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const ev = async (sessionId, expression) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, sessionId)).result?.value;
ws.on("open", async () => {
  try {
    const { targetInfos } = await call("Target.getTargets");
    const sw = targetInfos.find(t => t.type === "service_worker" && t.url.includes("fjdhphbdlfjogobd"));
    const swSess = (await call("Target.attachToTarget", { targetId: sw.targetId, flatten: true })).sessionId;
    const tabId = await ev(swSess, `chrome.tabs.create({url:'http://localhost:18777/index.html?ext=1', active:false}).then(t=>t.id)`);
    await sleep(8000);
    const targets = (await call("Target.getTargets")).targetInfos;
    const tab = targets.find(t => t.type === "page" && t.url.includes("ext=1"));
    let extResult = null;
    if (tab) { const s = (await call("Target.attachToTarget", { targetId: tab.targetId, flatten: true })).sessionId; await call("Runtime.enable", {}, s); extResult = await ev(s, `JSON.stringify(window.__results)`); await call("Target.closeTarget", { targetId: tab.targetId }); }
    console.log("ext-created tab results:", extResult, "tabId", tabId);
    // neverssl block page details
    const { targetId } = await call("Target.createTarget", { url: "http://neverssl.com/" });
    const s2 = (await call("Target.attachToTarget", { targetId, flatten: true })).sessionId;
    await call("Runtime.enable", {}, s2); await sleep(4000);
    console.log("neverssl page:", await ev(s2, `JSON.stringify({title: document.title, codes: [...document.querySelectorAll('code')].map(c=>c.innerText), url: location.href})`));
    await call("Target.closeTarget", { targetId });
  } catch (e) { console.log("ERR", String(e)); }
  process.exit(0);
});
