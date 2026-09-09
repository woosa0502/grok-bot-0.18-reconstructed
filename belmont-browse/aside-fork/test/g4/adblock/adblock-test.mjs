// Drives the fork over CDP (port 9333) to verify the Aside ad blocker replica.
import pkg from "/home/hoon/_roots/labs/work/Belmont/belmont-browse/node_modules/ws/index.js";
const { WebSocket } = pkg;
import { writeFileSync, readFileSync } from "node:fs";
const SP = process.env.SP;
const ver = await (await fetch("http://127.0.0.1:9414/json/version")).json();
const ws = new WebSocket(ver.webSocketDebuggerUrl);
let id = 1; const pending = new Map(); const events = [];
const call = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = id++; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
ws.on("message", (d) => { const m = JSON.parse(d); if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); } else if (m.method) { events.push(m); } });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function openTab(url) {
  const { targetId } = await call("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  await call("Page.enable", {}, sessionId); await call("Runtime.enable", {}, sessionId); await call("Network.enable", {}, sessionId);
  await call("Page.navigate", { url }, sessionId);
  return { targetId, sessionId };
}
const ev = async (sessionId, expression, extra = {}) => (await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, ...extra }, sessionId)).result?.value;
async function shot(sessionId, name) { const { data } = await call("Page.captureScreenshot", { format: "png" }, sessionId); writeFileSync(`${SP}/${name}`, Buffer.from(data, "base64")); }
const out = {};
ws.on("open", async () => {
  try {
    // 1. internals page: state via the page's own mojom remote
    const internals = await openTab("chrome://aside-adblock/");
    await sleep(2500);
    const stateExpr = `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().getState();return r.stateJson;})()`;
    let state = JSON.parse(await ev(internals.sessionId, stateExpr) || "{}");
    // wait for subscriptions to download + compile (up to 90s)
    for (let i = 0; i < 45 && !(state.engines?.[0]?.networkRuleCount > 1000); i++) { await sleep(2000); state = JSON.parse(await ev(internals.sessionId, stateExpr) || "{}"); }
    out.state = { enabled: state.enabled, compiling: state.compiling, activeGeneration: state.activeGeneration, lastCompileDurationMs: state.lastCompileDurationMs, lastCompileError: state.lastCompileError,
      subscriptions: (state.subscriptions || []).map(s => ({ name: s.name, status: s.status, contentSize: s.contentSize, networkRuleCount: s.networkRuleCount, cosmeticRuleCount: s.cosmeticRuleCount, parseErrorCount: s.parseErrorCount, lastError: s.lastError })),
      engine: state.engines?.[0] && { flatbufferSize: state.engines[0].flatbufferSize, networkRuleCount: state.engines[0].networkRuleCount, cosmeticRuleCount: state.engines[0].cosmeticRuleCount, sources: state.engines[0].sources?.length } };
    // page-rendered DOM check (original JS renders these ids)
    out.internalsDom = await ev(internals.sessionId, `JSON.stringify({title:document.title, enabledChecked: document.getElementById('adblock-enabled')?.checked, subsRows: document.querySelectorAll('#subscriptions-body tr').length, overviewText: (document.getElementById('overview-grid')?.innerText||'').slice(0,300), status: document.getElementById('status-message')?.innerText})`);
    await shot(internals.sessionId, "ui-shots/G4-adblock-internals.png");
    // 2. testRule through the page's mojom
    const testExpr = (u, t) => `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().testRule(${JSON.stringify(u)},'https://example.com/',${JSON.stringify(t)},'GET',true);return r.resultJson;})()`;
    out.testRule = {
      adsbygoogle: JSON.parse(await ev(internals.sessionId, testExpr("https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js", "script"))),
      example: JSON.parse(await ev(internals.sessionId, testExpr("https://example.com/", "script"))),
    };
    // 2b. custom rules exercising the extended syntax (popup, generichide, redirect, important, regex, method, csp, $document)
    const customRules = readFileSync(new URL("./custom-rules.txt", import.meta.url), "utf8");
    const saveExpr0 = `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().saveCustomRules(${JSON.stringify(customRules)});return r.error;})()`;
    out.saveCustomRulesError = await ev(internals.sessionId, saveExpr0);
    for (let i = 0; i < 30; i++) { await sleep(1000); state = JSON.parse(await ev(internals.sessionId, stateExpr) || "{}"); if (!state.compiling && state.custom?.networkRuleCount >= 10) break; }
    out.custom = { networkRuleCount: state.custom?.networkRuleCount, cosmeticRuleCount: state.custom?.cosmeticRuleCount, parseErrorCount: state.custom?.parseErrorCount, invalidLines: state.custom?.invalidLines, compiledRegexCount: state.engines?.[0]?.compiledRegexCount, popupRuleCount: state.engines?.[0]?.popupRuleCount, cspRuleCount: state.engines?.[0]?.cspRuleCount, easylistParseErrors: state.subscriptions?.[0]?.parseErrorCount, easyprivacyParseErrors: state.subscriptions?.[1]?.parseErrorCount };
    out.testRuleExtended = {
      redirect: JSON.parse(await ev(internals.sessionId, testExpr("http://127.0.0.1:18791/redir.js", "script"))),
      important: JSON.parse(await ev(internals.sessionId, testExpr("http://127.0.0.1:18791/imp.js", "script"))),
      exception: JSON.parse(await ev(internals.sessionId, testExpr("http://127.0.0.1:18791/exc.js", "script"))),
      regex: JSON.parse(await ev(internals.sessionId, testExpr("http://127.0.0.1:18791/rx-77.js", "script"))),
    };
    // 3. real page: network + cosmetic + subframe + extended syntax
    const page = await openTab("http://127.0.0.1:18791/index.html");
    await sleep(6000);
    out.page = JSON.parse(await ev(page.sessionId, `JSON.stringify({results: window.__results, gen1: getComputedStyle(document.getElementById('gen1')).display, gen2: getComputedStyle(document.getElementById('gen2')).display, ctrl: getComputedStyle(document.getElementById('ctrl')).display, site1: getComputedStyle(document.getElementById('site1')).display, adoptedSheets: document.adoptedStyleSheets.length, proc1: getComputedStyle(document.getElementById('proc1')).display, proc2: getComputedStyle(document.getElementById('proc2')).display, styledColor: getComputedStyle(document.getElementById('styled')).color, redirMarker: String(window.__redir_marker), imp: String(window.__imp), exc: String(window.__exc), rx: String(window.__rx)})`));
    const reqUrl = {}; for (const e of events) if (e.sessionId === page.sessionId && e.method === "Network.requestWillBeSent") reqUrl[e.params.requestId] = e.params.request.url;
    out.pageFailedLoads = events.filter(e => e.sessionId === page.sessionId && e.method === "Network.loadingFailed").map(e => (reqUrl[e.params.requestId] || "?").slice(0, 50) + " " + e.params.errorText + " " + (e.params.blockedReason || "")).slice(0, 12);
    out.pageRequests = Object.values(reqUrl).map(u => u.slice(0, 60));
    out.shimInfo = await ev(page.sessionId, `JSON.stringify(globalThis.__asideAdBlock ? {applied: globalThis.__asideAdBlock.applied, dropped: globalThis.__asideAdBlock.dropped} : null)`);
    await shot(page.sessionId, "ui-shots/G4-adblock-page.png");
    // 3a. generic class/id lookup path on a host without a $generichide exception
    // (EasyList itself carries "@@://localhost$generichide" and "@@://127.0.0.1$generichide", so use 127.0.0.2)
    const generic = await openTab("http://127.0.0.2:18791/generic.html");
    await sleep(4000);
    out.generic = JSON.parse(await ev(generic.sessionId, `JSON.stringify({gen1: getComputedStyle(document.getElementById('gen1')).display, ctrl: getComputedStyle(document.getElementById('ctrl')).display, late: document.getElementById('late') ? getComputedStyle(document.getElementById('late')).display : 'missing', adoptedSheets: document.adoptedStyleSheets.length})`));
    await call("Target.closeTarget", { targetId: generic.targetId }).catch(() => {});
    // 3b. $csp: inline script on csp.html must not run
    const csp = await openTab("http://127.0.0.1:18791/csp.html");
    await sleep(3000);
    out.csp = JSON.parse(await ev(csp.sessionId, `JSON.stringify({inline: String(window.__inline), title: document.title})`));
    const cspCtrl = await openTab("http://127.0.0.1:18791/opener.html");
    await sleep(2000);
    // 3c. $popup: window.open to a URL matching "&popunder=$popup" is cancelled and the popup closed
    const before = (await call("Target.getTargets")).targetInfos.filter(t => t.type === "page").length;
    await ev(cspCtrl.sessionId, `openPop('a=1&popunder=1'); 'opened'`, { userGesture: true });
    await sleep(3000);
    const targetsAfter = (await call("Target.getTargets")).targetInfos.filter(t => t.type === "page");
    const popLanded = targetsAfter.filter(t => /pop\.html\?a=1&popunder=1/.test(t.url)).map(t => t.url);
    await ev(cspCtrl.sessionId, `openPop('a=2'); 'opened'`, { userGesture: true });
    await sleep(3000);
    const targetsAfter2 = (await call("Target.getTargets")).targetInfos.filter(t => t.type === "page");
    const ctrlLanded = targetsAfter2.filter(t => /pop\.html\?a=2/.test(t.url)).map(t => t.url);
    out.popup = { pagesBefore: before, pagesAfterBlocked: targetsAfter.length, blockedPopupStillOpen: popLanded, pagesAfterControl: targetsAfter2.length, controlPopupOpen: ctrlLanded };
    for (const t of targetsAfter2) if (/pop\.html/.test(t.url)) await call("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
    await call("Target.closeTarget", { targetId: csp.targetId }).catch(() => {});
    await call("Target.closeTarget", { targetId: cspCtrl.targetId }).catch(() => {});
    // 4. $document rule (in the custom rules) -> block page -> continue once
    const blocked = await openTab("http://example.org/");
    await sleep(3000);
    out.blockPage = JSON.parse(await ev(blocked.sessionId, `JSON.stringify({title: document.title, h1: document.querySelector('h1')?.innerText, p: document.querySelector('p')?.innerText, note: document.querySelector('p.note')?.innerText, codes: [...document.querySelectorAll('code')].map(c=>c.innerText), buttons: [...document.querySelectorAll('button')].map(b=>b.innerText), url: location.href})`));
    await shot(blocked.sessionId, "ui-shots/G4-adblock-blockpage.png");
    out.continueLink = await ev(blocked.sessionId, `JSON.stringify({href: document.getElementById('continue')?.getAttribute('href'), tag: document.getElementById('continue')?.tagName})`);
    await ev(blocked.sessionId, `document.getElementById('continue').click(); 'clicked'`, { userGesture: true });
    await sleep(5000);
    out.afterContinue = JSON.parse(await ev(blocked.sessionId, `JSON.stringify({title: document.title, url: location.href, h1: document.querySelector('h1')?.innerText})`));
    // 4b. real https site: count blocked sub-resources
    const real = await openTab("https://www.naver.com/");
    await sleep(9000);
    const realReq = {}; for (const e of events) if (e.sessionId === real.sessionId && e.method === "Network.requestWillBeSent") realReq[e.params.requestId] = e.params.request.url;
    const realFailed = events.filter(e => e.sessionId === real.sessionId && e.method === "Network.loadingFailed" && /BLOCKED_BY_CLIENT/.test(e.params.errorText)).map(e => (realReq[e.params.requestId] || "?").slice(0, 70));
    out.realSite = { requests: Object.keys(realReq).length, blocked: realFailed.length, sample: realFailed.slice(0, 6) };
    await call("Target.closeTarget", { targetId: real.targetId }).catch(() => {});
    // 5. disable -> request goes through
    const disableExpr = `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().setEnabled(false);return JSON.parse(r.stateJson).enabled;})()`;
    out.disabledEnabledFlag = await ev(internals.sessionId, disableExpr);
    const page2 = await openTab("http://127.0.0.1:18791/index.html");
    await sleep(6000);
    out.pageDisabled = JSON.parse(await ev(page2.sessionId, `JSON.stringify({results: window.__results, gen1: getComputedStyle(document.getElementById('gen1')).display})`));
    const enableExpr = `(async()=>{const m=await import('./adblock_internals.mojom-webui.js');const r=await m.AdblockInternalsPageHandler.getRemote().setEnabled(true);return JSON.parse(r.stateJson).enabled;})()`;
    out.reEnabled = await ev(internals.sessionId, enableExpr);
    for (const t of [internals, page, blocked, page2]) await call("Target.closeTarget", { targetId: t.targetId }).catch(() => {});
  } catch (e) { out.error = String(e && e.stack || e); }
  console.log(JSON.stringify(out, null, 1));
  process.exit(0);
});
ws.on("error", e => { console.log("WS_ERR", String(e)); process.exit(0); });
