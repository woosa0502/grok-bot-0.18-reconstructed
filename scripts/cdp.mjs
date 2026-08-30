// Minimal CDP client for driving the Belmont renderer as the user.
// Usage: node cdp.mjs eval '<js expression>'    -> Runtime.evaluate, prints JSON result
//        node cdp.mjs key <Key> [modifiers]      -> dispatch a keydown/keyup (e.g. KeyK Meta)
import WebSocket from "ws";

const PORT = 9347;
const [, , cmd, arg1, arg2] = process.argv;

async function targetWs() {
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const page = targets.find((t) => t.type === "page" && /Grok Bot|Belmont/i.test(t.title || "")) || targets.find((t) => t.type === "page");
  if (!page) throw new Error("no page target");
  return page.webSocketDebuggerUrl;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    ws.once("open", () => resolve(ws));
    ws.once("error", reject);
  });
}

let msgId = 0;
function send(ws, method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const onMsg = (data) => {
      let m; try { m = JSON.parse(data.toString()); } catch { return; }
      if (m.id !== id) return;
      ws.off("message", onMsg);
      if (m.error) reject(new Error(JSON.stringify(m.error))); else resolve(m.result);
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const ws = await connect(await targetWs());
await send(ws, "Runtime.enable");

if (cmd === "eval") {
  const r = await send(ws, "Runtime.evaluate", { expression: arg1, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) { console.log(JSON.stringify({ error: r.exceptionDetails.text, detail: r.exceptionDetails.exception?.description })); }
  else console.log(JSON.stringify(r.result.value));
} else if (cmd === "key") {
  // arg1 = code (e.g. "KeyK"), arg2 = comma modifiers (Meta,Ctrl,Shift,Alt)
  const mods = (arg2 || "").split(",").filter(Boolean);
  const modBits = (mods.includes("Alt") ? 1 : 0) | (mods.includes("Ctrl") ? 2 : 0) | (mods.includes("Meta") ? 4 : 0) | (mods.includes("Shift") ? 8 : 0);
  const key = arg1.replace("Key", "");
  const base = { modifiers: modBits, code: arg1, key: key.length === 1 ? key.toLowerCase() : arg1, windowsVirtualKeyCode: arg1.startsWith("Key") ? arg1.charCodeAt(3) : 0 };
  await send(ws, "Input.dispatchKeyEvent", { type: "keyDown", ...base });
  await send(ws, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  console.log(JSON.stringify({ dispatched: arg1, mods }));
}
ws.close();
process.exit(0);
