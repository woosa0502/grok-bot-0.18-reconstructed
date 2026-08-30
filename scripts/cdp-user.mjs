// CDP USER-route runner: drives the renderer as the user for keyboard-shortcut cases.
// The renderer is the pinned original Cursor bundle (minified, no data-testid/aria-label),
// so only keyboard-driven + DOM-state-checkable behaviors auto-verify cleanly.
import WebSocket from "ws";
import { readFileSync, appendFileSync } from "node:fs";

const PORT = 9347;
const QUEUE = "/home/hoon/_roots/labs/work/Belmont/docs/testing/belmont-wsl-test-queue.jsonl";
const OUT = "/tmp/user-evidence.jsonl";
const LIMIT = Number(process.env.LIMIT || 15);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const p = t.find((x) => x.type === "page" && /Grok Bot|Belmont/i.test(x.title || "")) || t.find((x) => x.type === "page");
  return p.webSocketDebuggerUrl;
}
function connect(url) { return new Promise((res, rej) => { const ws = new WebSocket(url, { perMessageDeflate: false }); ws.once("open", () => res(ws)); ws.once("error", rej); }); }
let mid = 0;
function send(ws, method, params = {}) {
  const id = ++mid;
  return new Promise((res, rej) => {
    const on = (d) => { let m; try { m = JSON.parse(d.toString()); } catch { return; } if (m.id !== id) return; ws.off("message", on); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); };
    ws.on("message", on); ws.send(JSON.stringify({ id, method, params }));
  });
}
const ws = await connect(await targetWs());
await send(ws, "Runtime.enable");
const evalJs = async (expr) => { const r = await send(ws, "Runtime.evaluate", { expression: expr, returnByValue: true }); return r.result?.value; };
async function key(code, mods = []) {
  const bits = (mods.includes("Alt") ? 1 : 0) | (mods.includes("Ctrl") ? 2 : 0) | (mods.includes("Meta") ? 4 : 0) | (mods.includes("Shift") ? 8 : 0);
  const k = code.startsWith("Key") ? code.slice(3).toLowerCase() : code;
  const base = { modifiers: bits, code, key: k, windowsVirtualKeyCode: code.startsWith("Key") ? code.charCodeAt(3) : (code === "Equal" ? 187 : code === "Minus" ? 189 : code === "Digit0" ? 48 : 0) };
  await send(ws, "Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await send(ws, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
const snap = () => evalJs('JSON.stringify({dialogs:document.querySelectorAll("[role=dialog],[cmdk-root],[class*=palette],[class*=command],[class*=modal]").length, inputs:document.querySelectorAll("input,textarea,[contenteditable=true]").length, buttons:document.querySelectorAll("button").length, active:document.activeElement&&(document.activeElement.getAttribute("placeholder")||document.activeElement.tagName), zoom:Math.round((window.devicePixelRatio||1)*100)/100, bodyLen:document.body.innerText.length})');

// parse a likely key from the expected behavior
function parseKey(t) {
  if (/Cmd\/?Ctrl\s*\+\s*K|명령 팔레트|command palette/i.test(t)) return ["KeyK", ["Ctrl"]];
  if (/Cmd\/?Ctrl\s*\+\s*[+=]|확대|zoom in/i.test(t)) return ["Equal", ["Ctrl"]];
  if (/Cmd\/?Ctrl\s*\+\s*[-−]|축소|zoom out/i.test(t)) return ["Minus", ["Ctrl"]];
  if (/Cmd\/?Ctrl\s*\+\s*0|리셋|reset zoom/i.test(t)) return ["Digit0", ["Ctrl"]];
  if (/이전.*에이전트|previous agent|prev/i.test(t)) return ["BracketLeft", ["Ctrl"]];
  if (/다음.*에이전트|next agent/i.test(t)) return ["BracketRight", ["Ctrl"]];
  if (/Escape|닫|dismiss|close/i.test(t)) return ["Escape", []];
  return null;
}

const cases = readFileSync(QUEUE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.route === "USER_REACHABLE");
const done = new Set();
try { for (const l of readFileSync(OUT, "utf8").split("\n").filter(Boolean)) done.add(JSON.parse(l).caseId); } catch {}
const kb = cases.filter((c) => parseKey(c.expectedBehavior) && !done.has(c.testCaseId)).slice(0, LIMIT);
console.log(`[cdp-user] keyboard-drivable todo=${kb.length}`);
let i = 0;
for (const c of kb) {
  i++;
  const [code, mods] = parseKey(c.expectedBehavior);
  const before = JSON.parse(await snap());
  await key(code, mods); await sleep(700);
  const after = JSON.parse(await snap());
  await key("Escape", []); await sleep(200); // reset
  const rec = { caseId: c.testCaseId, area: c.area, expected: c.expectedBehavior.slice(0, 120), key: mods.concat(code).join("+"), before, after };
  appendFileSync(OUT, JSON.stringify(rec) + "\n");
  console.log(`[cdp-user] ${i}/${kb.length} ${c.testCaseId} ${rec.key} dlg:${before.dialogs}->${after.dialogs} inp:${before.inputs}->${after.inputs} zoom:${before.zoom}->${after.zoom}`);
}
ws.close(); process.exit(0);
