// Clears the custom rules the test installed (leaves the profile as it was).
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
ws.on("open", async () => {
  const { targetId } = await call("Target.createTarget", { url: "chrome://aside-adblock/" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Runtime.enable", {}, sessionId);
  await new Promise(r => setTimeout(r, 2000));
  const r = await call("Runtime.evaluate", { expression: `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().saveCustomRules('');return JSON.stringify({error:r.error, custom: JSON.parse(r.stateJson).custom.rules.length});})()`, awaitPromise: true, returnByValue: true }, sessionId);
  console.log("custom rules reset:", r.result?.value);
  await call("Target.closeTarget", { targetId });
  process.exit(0);
});
