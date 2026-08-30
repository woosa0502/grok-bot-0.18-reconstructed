import { connect, axNodes, find, clickNode, domClick, resetUI, shot, sleep } from "./ax-ui.mjs";
const OUT = "/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/a327d9f5-4551-413e-9bec-af14aee7881f/scratchpad/";
const { ws, send } = await connect();
const ev = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true })).result.value;
const key = async (k, code, vk, mods = 0) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods }); };
const R = {};
await resetUI(send);
await clickNode(send, find(await axNodes(send), "button", /QA Bot/).backendNodeId); await sleep(500);
// Find in chat: Cmd+F
await key("f", "KeyF", 70, 4); await sleep(500);
R.findBar = JSON.parse(await ev(`JSON.stringify({
  input:!!document.querySelector("[placeholder*=Find i],[placeholder*=Search i],[aria-label*=Find i]"),
  prevNext:[...document.querySelectorAll("button")].filter(b=>/Prev|Next|이전|다음|↑|↓/i.test(b.getAttribute("aria-label")||b.textContent||"")).length,
  findText:/Find|찾기|No results|\\d+ of \\d+|\\d+\\/\\d+/i.test(document.body.innerText)
})`));
await shot(send, OUT + "find-in-chat.png");
await key("Escape", "Escape", 27); await sleep(300);
// slash command /no-test type
const pb = find(await axNodes(send), "textbox", /Prompt/); if (pb) await clickNode(send, pb.backendNodeId); await sleep(150);
await key("a", "KeyA", 65, 2); for (let i = 0; i < 20; i++) await key("Backspace", "Backspace", 8);
await send("Input.insertText", { text: "/" }); await sleep(500);
R.slashMenu = await ev(`document.querySelectorAll("[role=listbox],[role=option]").length`);
R.slashHasTest = await ev(`/no-test|skip test|test|Research|Settings/i.test(((document.querySelector("[role=listbox]")||document.body).innerText||""))`);
await key("Escape", "Escape", 27); await sleep(150);
for (let i = 0; i < 5; i++) await key("Backspace", "Backspace", 8);
// UI modal Tab trap (791): open a modal (About) and Tab
const am = find(await axNodes(send), "button", /Open account menu/); await domClick(send, am.backendNodeId); await sleep(300);
const about = (await axNodes(send)).find((n) => /menuitem/.test(n.role) && /^About$/.test(n.name)); if (about) await domClick(send, about.backendNodeId); await sleep(500);
const focus0 = await ev(`document.activeElement?document.activeElement.tagName+":"+(document.activeElement.textContent||"").slice(0,10):"none"`);
await key("Tab", "Tab", 9); await sleep(150);
const focus1 = await ev(`document.activeElement?document.activeElement.tagName+":"+(document.activeElement.textContent||"").slice(0,10):"none"`);
R.modalTab = { focus0, focus1, insideDialog: await ev(`!!document.activeElement?.closest("[role=dialog]")`) };
await key("Escape", "Escape", 27); await sleep(300);
await resetUI(send);
console.log(JSON.stringify(R, null, 1));
ws.close(); process.exit(0);
