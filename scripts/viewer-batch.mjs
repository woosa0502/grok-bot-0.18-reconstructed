import { connect, axNodes, find, clickNode, resetUI, shot, sleep } from "./ax-ui.mjs";
const OUT = "/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/a327d9f5-4551-413e-9bec-af14aee7881f/scratchpad/";
const { ws, send } = await connect();
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.value;

async function attach(file) {
  const doc = await send("DOM.getDocument", { depth: -1 });
  const q = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "input[type=file]" });
  await send("DOM.setFileInputFiles", { files: [file], nodeId: q.nodeId });
  await sleep(700);
}
async function sendMsg() {
  const sb = find(await axNodes(send), "button", /^Send message$/);
  if (sb) await clickNode(send, sb.backendNodeId);
  await sleep(1800);
}
const viewerSig = () => ev(`JSON.stringify({
  dlg: document.querySelectorAll("[role=dialog]").length,
  canvas: document.querySelectorAll("[role=dialog] canvas").length,
  table: document.querySelectorAll("[role=dialog] table").length,
  img: document.querySelectorAll("[role=dialog] img").length,
  pre: document.querySelectorAll("[role=dialog] pre, [role=dialog] code").length,
  head: ((document.querySelector("[role=dialog]")||{}).innerText||"").replace(/\\s+/g," ").slice(0,90)
})`);

await resetUI(send);
// dedicated clean bot
await clickNode(send, find(await axNodes(send), "button", /Research Bot/).backendNodeId);
await sleep(500);

const files = ["img.png", "data.csv", "doc.md", "data.json", "note.txt"];
const R = {};
for (const fn of files) {
  await resetUI(send);
  await attach("/tmp/fix/" + fn);
  await sendMsg();
  const err = await ev(`/Something went wrong/.test(document.body.innerText)`);
  const nodes = await axNodes(send);
  // card: the "Open <fn>" button for THIS file (exact substring), else an image whose name is this file
  const openBtn = nodes.find((n) => n.role === "button" && n.name === `Open ${fn}` && n.backendNodeId != null);
  const imgNode = nodes.find((n) => n.role === "img" && n.backendNodeId != null && (n.name === fn || /image/i.test(n.name || "")));
  const card = openBtn || imgNode;
  let sig = { dlg: 0 };
  if (card) {
    await clickNode(send, card.backendNodeId);
    await sleep(1000);
    sig = JSON.parse(await viewerSig());
  }
  R[fn] = { err, cardKind: openBtn ? "Open-btn" : imgNode ? "img" : "none", ...sig };
  await shot(send, OUT + "vb-" + fn.replace(/\W/g, "_") + ".png");
  await resetUI(send);
}
console.log(JSON.stringify(R, null, 1));
ws.close();
process.exit(0);
