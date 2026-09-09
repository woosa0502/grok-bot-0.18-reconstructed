// Screenshots for the G4 items that have a page: the importer WebUI and the
// settings row whose title the 825.1 string table changed.
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
    for (const [url, name, wait, expr] of [
      ["chrome://aside-import-data/", "G4-import-webui", 4000,
       "JSON.stringify({title: document.title, text: document.body.innerText.replace(/\\s+/g,' ').slice(0,400), browsers: [...document.querySelectorAll('img')].map(i=>i.getAttribute('src')).slice(0,12)})"],
      ["chrome://settings/importData", "G4-settings-import", 4000,
       "JSON.stringify({title: document.title, dialog: (document.querySelector('settings-ui')?.shadowRoot?.textContent||'').includes('Import data from another browser')})"],
      ["chrome://settings/", "G4-settings-people", 4500,
       "(function(){const t=[];const walk=(r)=>{for(const e of r.querySelectorAll('*')){if(e.shadowRoot)walk(e.shadowRoot);const s=(e.shadowRoot?'':e.textContent||'');}};return JSON.stringify({found: document.documentElement.innerHTML.includes('Import data from another browser')})})()"],
    ]) {
      const { targetId } = await call("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
      await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
      await call("Page.navigate", { url }, sessionId);
      await sleep(wait);
      out[name] = (await call("Runtime.evaluate", { expression: expr, returnByValue: true }, sessionId)).result?.value;
      const { data } = await call("Page.captureScreenshot", { format: "png" }, sessionId);
      writeFileSync(`${SP}/${name}.png`, Buffer.from(data, "base64"));
      await call("Target.closeTarget", { targetId }).catch(() => {});
    }
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
