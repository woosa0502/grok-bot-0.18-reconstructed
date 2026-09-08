import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { WebSocket } from "ws";

const baseUrl = process.env.LINEAR_RENDER_BASE_URL ?? "http://127.0.0.1:4197";
const output = resolve(process.cwd(), process.env.LINEAR_INTERACTION_OUTPUT ?? "artifacts/rebuild_20260903/interaction-audit.json");
const port = Number(process.env.LINEAR_INTERACTION_DEBUG_PORT ?? "9242");
const chrome = spawn("google-chrome", ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-background-networking", `--remote-debugging-port=${port}`, `--user-data-dir=/tmp/linear-interaction-cdp-${process.pid}`, "about:blank"], { stdio: "ignore" });

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
async function target() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${port}/json`).then((response) => response.json());
      const page = pages.find((item) => item.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error("Chrome DevTools did not start");
}

const socket = new WebSocket(await target());
await new Promise((resolvePromise, reject) => { socket.once("open", resolvePromise); socket.once("error", reject); });
let id = 0;
const pending = new Map();
socket.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id == null) return;
  const item = pending.get(message.id);
  if (item == null) return;
  pending.delete(message.id);
  if (message.error) item.reject(new Error(message.error.message));
  else item.resolve(message.result);
});
function command(method, params = {}) {
  const requestId = ++id;
  socket.send(JSON.stringify({ id: requestId, method, params }));
  return new Promise((resolvePromise, reject) => pending.set(requestId, { resolve: resolvePromise, reject }));
}
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}
async function route(name, botId = "", value = "") {
  const query = `/?surface=${name}${botId ? `&botId=${encodeURIComponent(botId)}` : ""}${value ? `&value=${encodeURIComponent(value)}` : ""}`;
  await evaluate(`history.replaceState(null, '', ${JSON.stringify(query)}); window.dispatchEvent(new PopStateEvent('popstate')); true`);
  await wait(180);
}
async function routePath(path) {
  await evaluate(`history.replaceState(null, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate')); true`);
  await wait(180);
}
async function waitFor(selector, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return true;
    await wait(100);
  }
  return false;
}
async function setValue(selector, value) {
  await evaluate(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return false; const owner = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(owner, 'value').set.call(element, ${JSON.stringify(value)}); element.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await wait(80);
}
async function clickText(selector, text) {
  return await evaluate(`(() => { const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((item) => item.textContent.includes(${JSON.stringify(text)})); if (!element) return false; element.click(); return true; })()`);
}

const results = [];
function record(name, value, detail) { results.push({ name, passed: Boolean(value), detail }); }

try {
  await command("Page.enable");
  await command("Runtime.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
  await command("Page.navigate", { url: `${baseUrl}/?surface=HomeScreen` });
  if (!await waitFor(".home-screen")) throw new Error("Home screen did not finish booting");
  const bots = await fetch(`${baseUrl}/api/bots`).then((response) => response.json());
  const botId = bots.managerId ?? bots.bots[0].id;

  const openedChatFromHome = await evaluate("(() => { const button = document.querySelector('.pinned-agent, .roster-row'); button?.click(); return Boolean(button); })()");
  const chatOpened = await waitFor(".chat-screen");
  const openedComputer = await evaluate("(() => { const button = document.querySelector('button[aria-label=\"컴퓨터 보기\"]'); button?.click(); return Boolean(button); })()");
  const computerOpened = await waitFor(".computer-screen");
  const threeDeep = await evaluate("history.state?.linearNavigation?.routes?.length === 3 && history.state.linearNavigation.routes.at(-1)?.name === 'AgentComputerScreen'");
  await evaluate("history.back(); true");
  const returnedToChat = await waitFor(".chat-screen");
  const chatRestored = await evaluate("history.state?.linearNavigation?.routes?.at(-1)?.name === 'ChatScreen'");
  await evaluate("history.back(); true");
  const returnedToHome = await waitFor(".home-screen");
  const homeRestored = await evaluate("history.state?.linearNavigation?.routes?.at(-1)?.name === 'HomeScreen'");
  record("hardware back walks the app stack before exit", openedChatFromHome && chatOpened && openedComputer && computerOpened && threeDeep && returnedToChat && chatRestored && returnedToHome && homeRestored, "HomeScreen -> ChatScreen -> AgentComputerScreen -> ChatScreen -> HomeScreen");

  await route("UserFormSheet", botId);
  await setValue(".field-block input", "Linear Mobile");
  await evaluate("document.querySelector('.surface-primary')?.click(); true");
  record("user form persists", await evaluate("JSON.parse(localStorage.getItem('linear-user-form:last') || '{}').project === 'Linear Mobile'"), "linear-user-form:last");

  await evaluate("localStorage.setItem('linear-autofill:work', JSON.stringify({ label: '내 업무', name: '검증 사용자', detail: '저장 프로젝트' }))");
  await evaluate("localStorage.setItem('linear-autofill-index', JSON.stringify([{ key: 'work', title: '업무 프로필', detail: '이름' }]))");
  await route("AutofillEntryScreen", "", "work");
  record("autofill stored values load", await evaluate("[...document.querySelectorAll('.field-block input')].map((input) => input.value).join('|') === '내 업무|검증 사용자|저장 프로젝트'"), "three stored fields restored");
  await evaluate("document.querySelector('.danger-action')?.click(); true");
  record("autofill delete persists", await evaluate("localStorage.getItem('linear-autofill:work') === null && !JSON.parse(localStorage.getItem('linear-autofill-index')).some((entry) => entry.key === 'work')"), "value and list entry removed");

  await route("DefaultModelScreen");
  await clickText(".model-row", "Codex");
  record("default model persists", await evaluate("localStorage.getItem('linear-default-model') === 'Codex'"), "Codex");

  await route("AppearanceScreen");
  await evaluate("document.querySelector('.surface-row .switch')?.click(); true");
  record("density applies and persists", await evaluate("localStorage.getItem('linear-density') === 'compact' && document.documentElement.dataset.density === 'compact'"), "compact");

  await route("FeedbackSheet");
  await setValue(".field-block textarea", "모바일 상호작용 점검");
  await evaluate("document.querySelector('.surface-primary')?.click(); true");
  record("feedback persists", await evaluate("JSON.parse(localStorage.getItem('linear-feedback') || '[]').at(-1)?.detail === '모바일 상호작용 점검'"), "linear-feedback");

  await route("AppStoreReviewFlowSheet");
  await evaluate("document.querySelectorAll('.rating-row button')[3]?.click(); true");
  await wait(80);
  await evaluate("document.querySelector('.surface-primary')?.click(); true");
  record("rating persists", await evaluate("JSON.parse(localStorage.getItem('linear-app-rating') || '{}').rating === 4"), "4 stars local only");

  await route("SettingsSheet");
  await clickText("button.settings-row", "알림 권한");
  await wait(100);
  record("notification flow reachable", await evaluate("document.querySelector('.surface-title strong')?.textContent === '알림'"), "SettingsSheet to NotificationsAskScreen");

  await route("PluginsScreen");
  await waitFor("button.surface-row");
  record("live skill catalog loads", await evaluate("document.querySelectorAll('button.surface-row').length > 5 && !document.querySelector('.screen-skeleton')"), "skillsCatalog results");
  await route("PluginsYoursScreen");
  await wait(500);
  await waitFor(".surface-row");
  record("live routed tools load", await evaluate("/\\d+개 라우팅됨/.test(document.body.innerText) && document.querySelectorAll('.surface-row').length > 0 && !document.querySelector('.screen-skeleton')"), "listRoutedMcpTools results");

  await route("RoutineDetailScreen", botId);
  await wait(500);
  record("live routines load", await evaluate("document.body.innerText.includes('등록된 루틴') || document.body.innerText.includes('등록된 루틴이 없습니다')"), "getAgentAutomations");

  const attachmentBots = await fetch(`${baseUrl}/api/bots`).then((response) => response.json());
  let attachment = null;
  for (const item of attachmentBots.bots) {
    const page = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(item.id)}/messages?limit=100`).then((response) => response.json());
    attachment = page.entries.find((entry) => entry.type === "attachment" && ["markdown", "text"].includes(entry.kind)) ?? attachment;
    if (attachment != null) break;
  }
  if (attachment != null) {
    const query = new URLSearchParams({ surface: "AttachmentPreviewRoute", botId: attachment.agentId, entryId: attachment.id, value: attachment.name, attachmentAgentId: attachment.agentId, attachmentPath: attachment.path, attachmentKind: attachment.kind, attachmentBytes: String(attachment.byteSize) });
    await routePath(`/?${query}`);
    await wait(500);
    record("real attachment text loads", await evaluate("document.querySelector('.real-document-preview')?.textContent.includes('Belmont Test')"), "readAttachmentText");
  } else record("real attachment text loads", false, "no live text attachment found");

  await route("SearchSheet");
  await setValue(".surface-search input", "doc");
  await wait(500);
  await clickText("button", "파일");
  await wait(120);
  const openedSearchFile = await evaluate("document.querySelector('.search-result')?.click(); Boolean(document.querySelector('.search-result'))");
  await wait(500);
  record("media search result opens its attachment", openedSearchFile && await evaluate("document.querySelector('.surface-title strong')?.textContent === '첨부 파일' && !document.querySelector('.screen-skeleton')"), "searchMedia to AttachmentPreviewRoute");

  await route("SearchSheet");
  await setValue(".surface-search input", "Belmont");
  await wait(500);
  const openedSearchMessage = await evaluate("(() => { const row = document.querySelectorAll('.search-result')[2]; row?.click(); return Boolean(row); })()");
  await wait(900);
  record("older message search result opens full content", openedSearchMessage && await evaluate("document.querySelector('.surface-title strong')?.textContent === '전체 메시지' && document.querySelector('.long-message')?.textContent.startsWith('2단계 완료:')"), "searchAgents result outside tail60 paged to exact transcript entry");

  await route("BoxHelpRoute", botId);
  await clickText("button.surface-link", "연결 불가 화면 보기");
  await wait(100);
  record("web access error reachable", await evaluate("document.querySelector('.surface-title strong')?.textContent === '연결 필요'"), "BoxHelpRoute to WebNoAccessScreen");

  await route("ChatScreen", botId);
  await wait(900);
  await evaluate("document.querySelector('.chat-actions button:last-child')?.click(); true");
  await clickText(".chat-menu button", "추가 정보 폼");
  await wait(100);
  record("user form reachable", await evaluate("document.querySelector('.surface-title strong')?.textContent === '추가 정보'"), "ChatScreen menu to UserFormSheet");

  const passed = results.filter((result) => result.passed).length;
  await fs.writeFile(output, `${JSON.stringify({ status: passed === results.length ? "passed" : "failed", passed, total: results.length, results }, null, 2)}\n`);
  process.stdout.write(`${passed}/${results.length} interaction checks passed\n`);
  if (passed !== results.length) process.exitCode = 1;
} finally {
  socket.close();
  chrome.kill("SIGTERM");
}
