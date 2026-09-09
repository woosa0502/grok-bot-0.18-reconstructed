// Focused probe for the three host-specific cosmetic checks on 127.0.0.1.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { readFileSync } from "node:fs";
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map();
const call = (m, p = {}, s) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p, ...(s ? { sessionId: s } : {}) })); });
ws.on("message", d => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function openTab(url) {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId);
  await call("Page.navigate", { url }, sessionId);
  return { targetId, sessionId };
}
const ev = async (s, e) => (await call("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }, s)).result?.value;
const out = {};
ws.on("open", async () => {
  try {
    const internals = await openTab("chrome://aside-adblock/");
    await sleep(2500);
    const stateExpr = `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().getState();return r.stateJson;})()`;
    let state = JSON.parse(await ev(internals.sessionId, stateExpr) || "{}");
    for (let i = 0; i < 45 && !(state.engines?.[0]?.networkRuleCount > 1000); i++) { await sleep(2000); state = JSON.parse(await ev(internals.sessionId, stateExpr) || "{}"); }
    const rules = readFileSync(new URL("./custom-rules.txt", import.meta.url), "utf8");
    out.saveError = await ev(internals.sessionId, `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().saveCustomRules(${JSON.stringify(rules)});return r.error;})()`);
    for (let i = 0; i < 40; i++) { await sleep(1000); state = JSON.parse(await ev(internals.sessionId, stateExpr) || "{}"); if (!state.compiling && state.custom?.cosmeticRuleCount >= 3) break; }
    out.custom = state.custom; out.compiling = state.compiling;
    out.cosmeticFor = JSON.parse(await ev(internals.sessionId, `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().testRule('http://127.0.0.1:18791/index.html','http://127.0.0.1:18791/index.html','document','GET',true);return r.resultJson;})()`) || "null");
    const page = await openTab("http://127.0.0.1:18791/index.html");
    for (const wait of [3000, 4000, 5000, 8000]) {
      await sleep(wait);
      out["at" + wait] = JSON.parse(await ev(page.sessionId, `JSON.stringify({shim: typeof globalThis.__asideAdBlock, sheets: document.adoptedStyleSheets.length, site1: getComputedStyle(document.getElementById('site1')).display, proc1: getComputedStyle(document.getElementById('proc1')).display, styled: getComputedStyle(document.getElementById('styled')).color, gen1: getComputedStyle(document.getElementById('gen1')).display})`));
    }
    await call("Target.closeTarget", { targetId: page.targetId }).catch(() => {});
    await call("Target.closeTarget", { targetId: internals.targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
