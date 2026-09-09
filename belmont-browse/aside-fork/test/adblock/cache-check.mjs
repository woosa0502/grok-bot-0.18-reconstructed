// Reports the engine cache state through the internals page: cacheHit, compile time, cache files.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { readdirSync, statSync } from "node:fs";
const ver = await (await fetch("http://127.0.0.1:9333/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
ws.on("open", async () => {
  const { targetId } = await call("Target.createTarget", { url: "chrome://aside-adblock/" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Runtime.enable", {}, sessionId);
  await sleep(2000);
  const expr = `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().getState();return r.stateJson;})()`;
  let state = {};
  for (let i = 0; i < 30; i++) { state = JSON.parse((await call("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }, sessionId)).result?.value || "{}"); if (state.engines?.[0] && !state.compiling) break; await sleep(1000); }
  const e = state.engines?.[0] || {};
  let files = [];
  try { files = readdirSync(state.cacheDirectory).map(f => `${f}:${statSync(state.cacheDirectory + "/" + f).size}`); } catch (err) { files = ["(unreadable: " + err.message + ")"]; }
  console.log(JSON.stringify({ cacheHit: e.cacheHit, lastCompileDurationMs: state.lastCompileDurationMs, activeGeneration: state.activeGeneration, networkRuleCount: e.networkRuleCount, cosmeticRuleCount: e.cosmeticRuleCount, compiledRegexCount: e.compiledRegexCount, proceduralRuleCount: e.proceduralRuleCount, cacheDirectory: state.cacheDirectory, files }));
  await call("Target.closeTarget", { targetId });
  process.exit(0);
});
