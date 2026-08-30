// AX-driven UI harness for the pinned (minified, no data-testid) Cursor renderer.
// The renderer still exposes a full ARIA accessibility tree, so elements are found
// by accessible {role,name} — not by CSS/testid — then clicked via box-model coords
// and asserted via AX-tree deltas. This is the scalable backbone for the UI cases.
import WebSocket from "ws";
import { writeFileSync } from "node:fs";

const PORT = 9347;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function connect() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
  const p = t.find((x) => x.type === "page" && /Grok Bot/i.test(x.title || "")) || t.find((x) => x.type === "page");
  const ws = new WebSocket(p.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256e6 });
  await new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
  let id = 0;
  const send = (m, pr = {}) => new Promise((res, rej) => {
    const i = ++id;
    const on = (d) => { let x; try { x = JSON.parse(d); } catch { return; } if (x.id !== i) return; ws.off("message", on); x.error ? rej(new Error(m + ": " + JSON.stringify(x.error))) : res(x.result); };
    ws.on("message", on); ws.send(JSON.stringify({ id: i, method: m, params: pr }));
  });
  await send("Accessibility.enable"); await send("DOM.enable"); await send("Runtime.enable"); await send("Page.enable");
  return { ws, send };
}

// full AX tree as [{role, name, backendNodeId, checked, value, disabled}]
export async function axNodes(send) {
  const tree = await send("Accessibility.getFullAXTree");
  return (tree.nodes || []).map((n) => ({
    role: n.role?.value || "?",
    name: (n.name?.value || "").trim(),
    backendNodeId: n.backendDOMNodeId,
    checked: n.properties?.find((p) => p.name === "checked")?.value?.value,
    disabled: n.properties?.find((p) => p.name === "disabled")?.value?.value,
    value: n.value?.value,
  }));
}

export function find(nodes, role, nameRe) {
  const re = nameRe instanceof RegExp ? nameRe : new RegExp("^" + String(nameRe).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$");
  return nodes.find((n) => (role == null || n.role === role) && re.test(n.name));
}

export async function centerOf(send, backendNodeId) {
  const box = await send("DOM.getBoxModel", { backendNodeId });
  const q = box.model.content; // [x1,y1,x2,y2,x3,y3,x4,y4]
  return { x: Math.round((q[0] + q[2] + q[4] + q[6]) / 4), y: Math.round((q[1] + q[3] + q[5] + q[7]) / 4) };
}

export async function clickNode(send, backendNodeId) {
  const { x, y } = await centerOf(send, backendNodeId);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  return { x, y };
}

// DOM-level click: resolves the node and calls .click() — reliable for hover-only buttons
// whose coordinates/visibility depend on mouse position.
export async function domClick(send, backendNodeId) {
  const r = await send("DOM.resolveNode", { backendNodeId });
  await send("Runtime.callFunctionOn", { objectId: r.object.objectId, functionDeclaration: "function(){ this.click(); }" });
}

// window-chrome buttons that must NEVER be auto-clicked (clicking "Close" quits the app)
export const DANGER_BUTTONS = /^(Close|Minimize|Maximize)$/;

export async function clickByName(send, role, nameRe) {
  const nodes = await axNodes(send);
  const n = find(nodes, role, nameRe);
  if (!n || n.backendNodeId == null) throw new Error(`AX not found: ${role} ${nameRe}`);
  if (role === "button" && DANGER_BUTTONS.test(n.name)) throw new Error(`refusing to click window-chrome button: ${n.name}`);
  return await clickNode(send, n.backendNodeId);
}

// close any open modal/preview WITHOUT touching window chrome: Escape + explicit "Close preview/details" only.
export async function resetUI(send) {
  for (let k = 0; k < 5; k++) {
    const dlg = (await send("Runtime.evaluate", { expression: 'document.querySelectorAll("[role=dialog]").length', returnByValue: true })).result.value;
    if (dlg === 0) break;
    const cl = find(await axNodes(send), "button", /^(Close preview|Close details|Back to details)$/);
    if (cl && cl.backendNodeId != null) await clickNode(send, cl.backendNodeId);
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
  }
  return (await send("Runtime.evaluate", { expression: 'document.querySelectorAll("[role=dialog]").length', returnByValue: true })).result.value;
}

export async function shot(send, path) {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path, Buffer.from(r.data, "base64"));
}

export const bodyText = async (send) =>
  (await send("Runtime.evaluate", { expression: "document.body.innerText", returnByValue: true })).result.value;

// self-test / demo when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const OUT = "/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/a327d9f5-4551-413e-9bec-af14aee7881f/scratchpad/";
  const { ws, send } = await connect();
  const before = await axNodes(send);
  const btns = before.filter((n) => n.role === "button" && n.name).map((n) => n.name);
  console.log("clickable buttons by name:", JSON.stringify(btns));
  // 1) open an agent by name via AX
  await clickByName(send, "button", /QA Bot/); await sleep(600);
  // 2) find + toggle the Notifications switch, assert checked flips
  let nodes = await axNodes(send);
  let sw = find(nodes, "switch", /Notifications/);
  if (!sw) { // settings panel may be closed; open it
    await clickByName(send, "button", /View agent settings/); await sleep(600);
    nodes = await axNodes(send); sw = find(nodes, "switch", /Notifications/);
  }
  const before2 = sw?.checked;
  if (sw) { await clickNode(send, sw.backendNodeId); await sleep(500); }
  const after2 = find(await axNodes(send), "switch", /Notifications/)?.checked;
  console.log(JSON.stringify({ switch_found: !!sw, checked_before: before2, checked_after: after2, flipped: before2 !== after2 }));
  // restore
  if (sw) { await clickNode(send, find(await axNodes(send), "switch", /Notifications/).backendNodeId); await sleep(300); }
  await shot(send, OUT + "ax-selftest.png");
  ws.close(); process.exit(0);
}
