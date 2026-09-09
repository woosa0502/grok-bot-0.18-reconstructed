import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { writeFileSync } from "node:fs";
const SP = "/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork/ui-shots";
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (m, p = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
ws.on("open", async () => {
  try {
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
    await call("Page.navigate", { url: "chrome://settings/importData" }, sessionId);
    await sleep(5000);
    out.importTitle = (await call("Runtime.evaluate", { expression: "loadTimeData.getString('importTitle')", returnByValue: true }, sessionId)).result?.value;
    out.deepText = (await call("Runtime.evaluate", { expression: "(function(){let hits=[];const walk=(root,depth)=>{if(depth>12)return;for(const el of root.querySelectorAll('*')){if(el.shadowRoot)walk(el.shadowRoot,depth+1);}};walk(document,0);const collect=(root,depth)=>{if(depth>12)return;for(const el of root.querySelectorAll('*')){const t=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent.trim()).join(' ');if(t.includes('Import data from another browser'))hits.push(el.tagName+':'+t.slice(0,80));if(el.shadowRoot)collect(el.shadowRoot,depth+1);}};collect(document,0);return JSON.stringify(hits.slice(0,5));})()", returnByValue: true }, sessionId)).result?.value;
    const { data } = await call("Page.captureScreenshot", { format: "png" }, sessionId);
    writeFileSync(`${SP}/G4-settings-import.png`, Buffer.from(data, "base64"));
    await call("Target.closeTarget", { targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
