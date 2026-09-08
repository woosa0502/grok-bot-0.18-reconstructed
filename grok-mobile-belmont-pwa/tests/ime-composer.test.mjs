import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("mobile composer fits long names and preserves IME, normal Enter and Shift Enter behavior", { skip: process.env.MOBILE_UI_TEST !== "1", timeout: 60_000 }, async () => {
  const { chromium } = await import(pathToFileURL(process.env.MOBILE_TEST_PLAYWRIGHT_MODULE).href);
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic", stdin: { resolveDir: root, loader: "tsx", contents: `
    import React from "react"; import {createRoot} from "react-dom/client"; import {ChatScreen} from "./src/screens/ChatScreen";
    const bot={id:"ime-fixture",name:"Personal workflow verification",title:"",description:"",avatar:{shape:"blob",color:"violet"},isManager:false,isPinned:false,isRunning:false,isComposing:false,isHidden:false,hasUnread:false,unreadCount:0,awaitingUserResponse:false,lastMessagePreview:"",lastActivityAt:1,notificationsEnabled:false,notifyOnUpdatesEnabled:false,isGroup:false,memberIds:[]};
    createRoot(document.getElementById("root")).render(<ChatScreen bot={bot} eventRevision={0} onBack={()=>{}} onComputer={()=>{}} onBotChanged={()=>{}} onOpen={()=>{}}/>);
  ` } });
  const styles = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith("/assets/")) { try { res.end(await fs.readFile(path.join(root, "public", req.url))); } catch { res.writeHead(404).end(); } return; }
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>' + styles + '</style><div id="root"></div><script type="module">' + bundle.outputFiles[0].text.replaceAll("</script>", "<\\/script>") + "</script>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: process.env.MOBILE_TEST_CHROME, headless: true, args: ["--no-sandbox", "--disable-background-networking"] });
  const records = []; const errors = [];
  try {
    for (const scenario of ["composition", "legacy229", "shift", "normal"]) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true }); const page = await context.newPage(); const posts = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/api/**", (route) => { const req = route.request(); if (req.method() === "POST" && new URL(req.url()).pathname.endsWith("/messages")) { posts.push(req.postDataJSON()); return route.fulfill({ json: { accepted: true } }); } return route.fulfill({ json: { entries: [], nextBeforeSeq: null } }); });
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      const input = page.getByRole("textbox", { name: "메시지", exact: true }); await input.fill("한글 조합 확인");
      const bounds = await page.evaluate(() => ({ width: innerWidth, toolbarRight: document.querySelector(".chat-toolbar").getBoundingClientRect().right, composerRight: document.querySelector(".composer").getBoundingClientRect().right }));
      assert.ok(bounds.toolbarRight <= bounds.width && bounds.composerRight <= bounds.width, JSON.stringify(bounds));
      let rawEvent = null;
      if (scenario === "composition" || scenario === "legacy229") rawEvent = await input.evaluate((node, kind) => { const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter", code: "Enter", isComposing: kind === "composition", keyCode: kind === "legacy229" ? 229 : 13 }); node.dispatchEvent(event); return { key: event.key, isComposing: event.isComposing, keyCode: event.keyCode, defaultPrevented: event.defaultPrevented }; }, scenario);
      else { await input.press(scenario === "shift" ? "Shift+Enter" : "Enter"); }
      await page.waitForTimeout(300);
      records.push({ scenario, bounds, rawEvent, posts, value: await input.inputValue() }); await context.close();
    }
    if (process.env.MOBILE_IME_ARTIFACT) await fs.writeFile(process.env.MOBILE_IME_ARTIFACT, JSON.stringify({ records, errors }, null, 2));
    assert.deepEqual(errors, []);
    for (const record of records.filter((item) => ["composition", "legacy229"].includes(item.scenario))) { assert.equal(record.posts.length, 0, record.scenario); assert.equal(record.value, "한글 조합 확인"); assert.equal(record.rawEvent.defaultPrevented, false); }
    assert.equal(records[2].posts.length, 0); assert.equal(records[2].value, "한글 조합 확인\n");
    assert.equal(records[3].posts.length, 1); assert.equal(records[3].posts[0].text, "한글 조합 확인"); assert.equal(records[3].value, "");
  } finally { await browser.close(); await new Promise((resolve) => server.close(resolve)); }
});
