// Browser.setDownloadBehavior "allowAndName": the bytes land in a directory the
// delegate has to create itself, under the download GUID, while the name shown
// to the user stays the one derived from the response.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { readdirSync, existsSync, rmSync, readFileSync } from "node:fs";
const DIR = process.argv[2] || "/tmp/aside-ui-G4-dl/fresh/deeper";
if (existsSync("/tmp/aside-ui-G4-dl")) rmSync("/tmp/aside-ui-G4-dl", { recursive: true, force: true });
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map(); const events = [];
const call = (m, p = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) events.push(m); });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = {};
ws.on("open", async () => {
  try {
    await call("Browser.setDownloadBehavior", { behavior: "allowAndName", downloadPath: DIR, eventsEnabled: true });
    out.dirExistedBefore = existsSync(DIR);
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId);
    await call("Page.navigate", { url: "http://127.0.0.1:18792/report.csv" }, sessionId).catch(() => {});
    await sleep(4000);
    out.dirExistsAfter = existsSync(DIR);
    out.files = out.dirExistsAfter ? readdirSync(DIR) : [];
    out.guidLike = out.files.filter(f => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(f));
    out.contents = out.guidLike.length ? readFileSync(`${DIR}/${out.guidLike[0]}`, "utf8").slice(0, 40) : null;
    out.downloadEvents = events.filter(e => /download/i.test(e.method)).map(e => ({ m: e.method, guid: e.params.guid, name: e.params.suggestedFilename, state: e.params.state }));
    // the name the browser reports to the user for that item
    const dl = await call("Target.createTarget", { url: "chrome://downloads/" });
    const { sessionId: ds } = await call("Target.attachToTarget", { targetId: dl.targetId, flatten: true });
    await call("Runtime.enable", {}, ds);
    await sleep(2500);
    out.downloadsPage = (await call("Runtime.evaluate", { expression: "(function(){const m=document.querySelector('downloads-manager');const it=m&&m.shadowRoot.querySelectorAll('downloads-item');return JSON.stringify([...(it||[])].map(i=>i.shadowRoot.querySelector('#file-link')?.textContent?.trim()).slice(0,3));})()", returnByValue: true }, ds)).result?.value;
    await call("Target.closeTarget", { targetId: dl.targetId }).catch(() => {});
    await call("Target.closeTarget", { targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
