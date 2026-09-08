import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifacts = path.resolve(root, "../data/artifacts/parity-remediation-20260906/mobile-client");

test("isolated mobile UI: thread cards, retry identity, reconnection, paging and real stop", { skip: process.env.MOBILE_UI_TEST !== "1", timeout: 90_000 }, async () => {
  // Explicit opt-in only: this launches a new headless browser with its own temporary profile.
  // It never attaches to the user's browser or sends requests to a Belmont gateway.
  const modulePath = process.env.MOBILE_TEST_PLAYWRIGHT_MODULE;
  const executablePath = process.env.MOBILE_TEST_CHROME;
  assert.ok(modulePath && executablePath, "provide cached Playwright and a browser executable");
  const { chromium } = await import(pathToFileURL(modulePath).href);
  await fs.mkdir(artifacts, { recursive: true });
  const bundle = await build({
    absWorkingDir: root, bundle: true, write: false, format: "esm", platform: "browser", target: "es2022", jsx: "automatic",
    stdin: { resolveDir: root, loader: "tsx", contents: `
      import React, {useState} from "react";
      import {createRoot} from "react-dom/client";
      import {ChatScreen} from "./src/screens/ChatScreen";
      import {ThreadScreen} from "./src/screens/surfaces/AccessAndConversationSurfaces";
      function Fixture() {
        const [id, setId] = useState("A");
        const [revision, setRevision] = useState(0);
        const [mount, setMount] = useState(0);
        const bot = {id, name:"검토 Bot", title:"",description:"",avatar:{shape:"blob",color:"violet"},isManager:false,isPinned:false,isRunning:true,isComposing:false,stopGuard:"fixture-run",isHidden:false,hasUnread:false,unreadCount:0,awaitingUserResponse:false,lastMessagePreview:"",lastActivityAt:1,notificationsEnabled:false,notifyOnUpdatesEnabled:false,isGroup:false,memberIds:[]};
        window.fixture = {switchBot:()=>setId("B"), refresh:()=>setRevision(x=>x+1), remount:()=>setMount(x=>x+1)};
        const open = (name, route) => { window.lastOpened = {name,...route}; };
        return location.search.includes("thread") ? <ThreadScreen key={id+mount} back={()=>{}} home={()=>{}} bot={bot} bots={[bot]} route={{name:"ThreadScreen",botId:id,entryId:"root"}} eventRevision={revision} open={open} openChat={()=>{}} refreshBots={async()=>{}} /> : <ChatScreen key={id+mount} bot={bot} eventRevision={revision} onBack={()=>{}} onComputer={()=>{}} onBotChanged={()=>{}} onOpen={open} />;
      }
      createRoot(document.getElementById("root")).render(<Fixture/>);
    ` },
  });
  const javascript = bundle.outputFiles[0].text;
  const styles = await fs.readFile(path.resolve(root, "src/styles.css"));
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://fixture.invalid");
    if (url.pathname === "/fixture.js") { response.setHeader("content-type", "text/javascript"); response.end(javascript); return; }
    if (url.pathname === "/styles.css") { response.setHeader("content-type", "text/css"); response.end(styles); return; }
    if (url.pathname.startsWith("/assets/") && !url.pathname.includes("..")) {
      try { response.end(await fs.readFile(path.join(root, "public", url.pathname))); }
      catch { response.writeHead(404).end(); }
      return;
    }
    if (url.pathname !== "/") { response.writeHead(404).end(); return; }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end('<!doctype html><html lang="ko"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browserServer; let browser;
  const consoleErrors = [];
  const requests = [];
  try {
    browserServer = await chromium.launchServer({ executablePath, headless: true, args: ["--no-sandbox", "--disable-background-networking"], env: { ...process.env, DISPLAY: "" } });
    await fs.writeFile(path.join(artifacts, "render-process.json"), JSON.stringify({ pid: browserServer.process().pid, fixturePort: server.address().port, ownedBy: "mobile-client-isolated-ui-test", startedAt: new Date().toISOString() }, null, 2));
    browser = await chromium.connect(browserServer.wsEndpoint());
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    page.on("pageerror", (error) => consoleErrors.push(error.message));
    const entry = (id, content = id) => ({ id, type: "text", role: "assistant", content, timestampMs: 1700000000000 });
    let answered = false; let newest = 0; let posts = 0;
    let holdA; let releaseA; let releaseOldSend;
    const dispatchNonces = new Set();
    await page.route("**/api/**", async (route) => {
      const request = route.request(); const url = new URL(request.url());
      const body = request.postDataJSON(); requests.push({ path: url.pathname, search: url.search, method: request.method(), body });
      const json = (value, status = 200) => route.fulfill({ status, json: value });
      if (url.pathname.endsWith("/threads/root")) return json({ entries: [entry("root", "문서를 확인해 주세요"), { ...entry("widget"), type: "widget", prompt: "계속 진행할까요?", agentId: "A", options: [{ label: "승인", value: "yes", style: "primary" }], answered: answered ? "yes" : null, skipped: false, replyToId: "root" }, { ...entry("file"), type: "attachment", agentId: "A", name: "검토 결과.pdf", path: "/fake/report.pdf", byteSize: 2048, kind: "pdf", mime: "application/pdf", width: null, height: null, replyToId: "root" }, { ...entry("approval"), type: "approval", agentId: "A", requestId: "q1", summary: "내보내기 승인", reason: "파일 작성", command: "", surface: "tool", status: "pending", replyToId: "root" }] });
      if (url.pathname.endsWith("/widgets/widget")) { answered = true; return json({ ok: true }); }
      if (url.pathname.endsWith("/stop")) return json({ ok: true, id: "A", interrupted: true });
      if (url.pathname.endsWith("/messages") && request.method() === "POST") {
        dispatchNonces.add(body.clientNonce);
        if (body.text === "이전 실행") { await new Promise((resolve) => { releaseOldSend = resolve; }); return json({ accepted: true, clientNonce: body.clientNonce }); }
        if (body.text === "새 실행") return json({ accepted: true, clientNonce: body.clientNonce });
        posts++; return json(posts % 2 ? { error: "응답 손실 시험" } : { accepted: true, clientNonce: body.clientNonce }, posts % 2 ? 502 : 200);
      }
      if (url.pathname.endsWith("/messages")) {
        if (url.pathname.includes("/B/")) return json({ entries: [entry("bot-B", "새 Bot의 메시지")], nextBeforeSeq: null });
        if (holdA) { await new Promise((resolve) => { releaseA = resolve; }); return json({ entries: [entry("late-A", "이전 Bot의 늦은 응답")], nextBeforeSeq: 60 }); }
        if (url.searchParams.has("beforeSeq")) return json({ entries: [entry("older", "가장 오래된 메시지")], nextBeforeSeq: null });
        return json({ entries: [entry("new", `최신 메시지 ${newest}`)], nextBeforeSeq: 60 });
      }
      return json({ ok: true });
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${origin}/?thread`);
    await page.getByText("계속 진행할까요?", { exact: true }).waitFor();
    assert.equal(await page.getByText("검토 결과.pdf", { exact: true }).count(), 1);
    assert.equal(await page.getByText("내보내기 승인", { exact: true }).count(), 1);
    await page.getByRole("button", { name: "검토 결과.pdf" }).click();
    assert.equal((await page.evaluate(() => window.lastOpened)).name, "AttachmentPreviewRoute");
    await page.getByRole("button", { name: "승인", exact: true }).first().click();
    await page.getByText("선택: 승인", { exact: true }).waitFor();
    await page.locator('input[type="file"]').setInputFiles({ name: "evidence.txt", mimeType: "text/plain", buffer: Buffer.from("proof") });
    await page.getByRole("textbox", { name: "답글", exact: true }).fill("첨부 검토 요청");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "응답 손실 시험" }).waitFor();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="답글"]').value === "첨부 검토 요청" && !document.querySelector('textarea[aria-label="답글"]').disabled);
    assert.equal(await page.getByRole("button", { name: "evidence.txt 제거", exact: true }).count(), 1, "reply attachments survive reload with the same send identity");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="답글"]').value === "");
    const threadSends = requests.filter((request) => request.method === "POST" && request.path.endsWith("/messages"));
    assert.equal(threadSends.length, 2);
    assert.equal(dispatchNonces.size, 1, "accepted-but-lost response followed by a reload must dispatch one logical thread send");
    assert.deepEqual(threadSends[0].body, threadSends[1].body);
    assert.equal(threadSends[0].body.replyToId, "root");
    assert.deepEqual(threadSends[0].body.attachments, [{ name: "evidence.txt", bytesBase64: "cHJvb2Y=" }]);
    await page.getByRole("button", { name: "작업 중단", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('button[aria-label="작업 중단"]').disabled);
    assert.ok(requests.some((request) => request.path === "/api/bots/A/stop" && request.method === "POST"));
    const composer = await page.locator(".thread-composer").boundingBox();
    const replyInput = await page.getByRole("textbox", { name: "답글", exact: true }).boundingBox();
    assert.ok(replyInput.width >= 150 && composer.height <= 100, "attachment and stop controls leave a usable reply input on a narrow phone");
    await page.screenshot({ path: path.join(artifacts, "thread-cards.png"), fullPage: true });

    await page.goto(origin);
    await page.getByText("최신 메시지 0", { exact: true }).waitFor();
    await page.getByRole("button", { name: "이전 대화 보기" }).click();
    await page.getByText("가장 오래된 메시지", { exact: true }).waitFor();
    newest = 1;
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.getByText("최신 메시지 1", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "이전 대화 보기" }).count(), 0);
    newest = 2;
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await page.getByText("최신 메시지 2", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "메시지", exact: true }).fill("다시 보내기");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "응답 손실 시험" }).waitFor();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="메시지"]').value === "다시 보내기" && !document.querySelector('textarea[aria-label="메시지"]').disabled);
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="메시지"]').value === "");
    const sends = requests.filter((request) => request.method === "POST" && request.path.endsWith("/messages"));
    assert.deepEqual(sends[2].body, sends[3].body);
    assert.equal(dispatchNonces.size, 2, "chat and thread retries each dispatch once across reloads");
    await page.getByRole("textbox", { name: "메시지", exact: true }).fill("이전 실행");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    while (!releaseOldSend) await new Promise((resolve) => setTimeout(resolve, 10));
    const stopCountBeforeRemount = requests.filter((request) => request.path.endsWith("/stop")).length;
    await page.getByRole("button", { name: "작업 중단", exact: true }).click();
    await page.evaluate(() => window.fixture.remount());
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="메시지"]').value === "이전 실행" && !document.querySelector('textarea[aria-label="메시지"]').disabled);
    await page.getByRole("textbox", { name: "메시지", exact: true }).fill("새 실행");
    await page.getByRole("button", { name: "보내기", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('textarea[aria-label="메시지"]').value === "");
    releaseOldSend();
    await page.waitForTimeout(80);
    assert.equal(requests.filter((request) => request.path.endsWith("/stop")).length, stopCountBeforeRemount, "unmounted delayed stop never reaches a newer run of the same bot");
    holdA = true;
    await page.evaluate(() => window.fixture.refresh());
    while (!releaseA) await new Promise((resolve) => setTimeout(resolve, 10));
    await page.evaluate(() => window.fixture.switchBot());
    await page.getByText("새 Bot의 메시지", { exact: true }).waitFor();
    releaseA();
    await page.waitForTimeout(50);
    assert.equal(await page.getByText("이전 Bot의 늦은 응답", { exact: true }).count(), 0);
    assert.equal(await page.getByText("최신 메시지 2", { exact: true }).count(), 0);
    assert.deepEqual(consoleErrors, []);
    await fs.writeFile(path.join(artifacts, "render-result.json"), JSON.stringify({ passed: true, consoleErrors, requests, scope: "isolated fake upstream; no live gateway, profile, phone or notification request" }, null, 2));
  } finally {
    await browser?.close();
    await browserServer?.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
