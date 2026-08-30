import { connect, axNodes, find, clickNode, domClick, resetUI, sleep } from "./ax-ui.mjs";
const { ws, send } = await connect();
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.value;
const key = async (k, code, vk, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); };
async function attach(file) { const doc = await send("DOM.getDocument", { depth: -1 }); const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" }); await send("DOM.setFileInputFiles", { files: [file], nodeId: q.nodeId }); await sleep(700); }
async function sendMsg() { const sb = find(await axNodes(send), "button", /^Send message$/); if (sb) await clickNode(send, sb.backendNodeId); await sleep(1700); }
async function openCard(reName) { const c = find(await axNodes(send), "button", reName); if (c) { await domClick(send, c.backendNodeId); await sleep(900); return true; } return false; }
const dlg = () => ev('document.querySelectorAll("[role=dialog]").length');

await resetUI(send);
await clickNode(send, find(await axNodes(send), "button", /Research Bot/).backendNodeId); await sleep(500);
const R = {};

// ---- PDF sub-behaviors ----
await resetUI(send); await attach("/tmp/fix/doc.pdf"); await sendMsg();
await openCard(/^Open doc\.pdf$/);
const cw = () => ev('(()=>{const c=document.querySelector("[role=dialog] canvas");return c?Math.round(c.getBoundingClientRect().width):0})()');
const w0 = await cw();
let z = find(await axNodes(send), "button", /Zoom in/); if (z) { await domClick(send, z.backendNodeId); await sleep(300); await domClick(send, find(await axNodes(send), "button", /Zoom in/).backendNodeId); await sleep(400); }
const w1 = await cw();
z = find(await axNodes(send), "button", /Zoom out/); if (z) { await domClick(send, z.backendNodeId); await sleep(400); }
const w2 = await cw();
R.pdf = { zoomIn: w1 > w0, zoomOut: w2 < w1, w0, w1, w2 };
// close via × (Close preview)
const cp = find(await axNodes(send), "button", /^Close preview$/); if (cp) { await domClick(send, cp.backendNodeId); await sleep(400); }
R.pdf.closeBtn = (await dlg()) === 0;
// reopen + Escape close
await openCard(/^Open doc\.pdf$/); await key("Escape", "Escape", 27); await sleep(400); R.pdf.escClose = (await dlg()) === 0;
// reopen + backdrop click (click far corner outside content)
await openCard(/^Open doc\.pdf$/); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 20, y: 400, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 20, y: 400, button: "left", clickCount: 1 }); await sleep(400); R.pdf.backdropClose = (await dlg()) === 0;
await resetUI(send);

// ---- Spreadsheet sub-behaviors ----
await attach("/tmp/fix/sheet.xlsx"); await sendMsg();
await openCard(/^Open sheet\.xlsx$/);
R.xlsx = { rows: await ev('document.querySelectorAll("[role=dialog] tr,[role=dialog] [role=row]").length'), cells: await ev('document.querySelectorAll("[role=dialog] td,[role=dialog] [role=gridcell]").length') };
// click a cell → cell-detail
const cell = await ev('(()=>{const c=document.querySelector("[role=dialog] td,[role=dialog] [role=gridcell]");if(!c)return null;const r=c.getBoundingClientRect();return JSON.stringify({x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)})})()');
if (cell) { const { x, y } = JSON.parse(cell); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(400); R.xlsx.cellClick = await ev('/column|Column|row|Row|value|cell|셀/i.test((document.querySelector("[role=dialog]")||{}).innerText||"")'); }
await key("Escape", "Escape", 27); await sleep(300); R.xlsx.escClose = (await dlg()) === 0;
await resetUI(send);

// ---- Image (media) sub-behaviors ----
await attach("/tmp/fix/img.png"); await sendMsg();
const ofs = find(await axNodes(send), "button", /Open image full screen/);
if (ofs) { await domClick(send, ofs.backendNodeId); await sleep(700); R.media = { opened: (await dlg()) > 0, img: await ev('document.querySelectorAll("[role=dialog] img,[role=dialog] canvas").length') };
  // zoom buttons?
  const zi = find(await axNodes(send), "button", /Zoom in/); R.media.hasZoom = !!zi;
  await key("Escape", "Escape", 27); await sleep(300); R.media.escClose = (await dlg()) === 0;
}
await resetUI(send);
console.log(JSON.stringify(R, null, 1));
ws.close(); process.exit(0);
