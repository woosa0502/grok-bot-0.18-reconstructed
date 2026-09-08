import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { WebSocket } from "ws";

const baseUrl = process.env.LINEAR_RENDER_BASE_URL ?? "http://127.0.0.1:4197";
const outputDir = resolve(process.cwd(), process.env.LINEAR_RENDER_OUTPUT ?? "artifacts/full-ui-render_20260903");
const debugPort = Number(process.env.LINEAR_RENDER_DEBUG_PORT ?? "9237");
const viewportWidth = Number(process.env.LINEAR_RENDER_WIDTH ?? "430");
const viewportHeight = Number(process.env.LINEAR_RENDER_HEIGHT ?? "932");
const auditAll = process.env.LINEAR_RENDER_AUDIT_ALL === "1";
const reusePage = process.env.LINEAR_RENDER_REUSE_PAGE === "1";
const profileDir = `/tmp/linear-pwa-cdp-${process.pid}`;
const chrome = spawn("google-chrome", [
  "--headless=new",
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--disable-background-networking",
  "--hide-scrollbars",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${profileDir}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let chromeError = "";
chrome.stderr.on("data", (chunk) => { chromeError += String(chunk); });

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function devtoolsTarget() {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const targets = await fetch(`http://127.0.0.1:${debugPort}/json`).then((response) => response.json());
      const page = targets.find((target) => target.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(100);
  }
  throw new Error(`Chrome DevTools did not start: ${chromeError.slice(-1200)}`);
}

function createClient(url) {
  const socket = new WebSocket(url);
  let nextId = 0;
  const pending = new Map();
  const errors = [];
  socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.id != null) {
      const waiter = pending.get(message.id);
      if (waiter) {
        pending.delete(message.id);
        if (message.error) waiter.reject(new Error(message.error.message));
        else waiter.resolve(message.result);
      }
      return;
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text ?? "Runtime exception");
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? "error").join(" "));
  });
  function command(method, params = {}) {
    const id = ++nextId;
    socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolvePromise, reject) => pending.set(id, { resolve: resolvePromise, reject }));
  }
  return { socket, command, errors };
}

await fs.mkdir(outputDir, { recursive: true });
const bots = await fetch(`${baseUrl}/api/bots`).then((response) => response.json()).catch(() => ({ bots: [], managerId: null }));
const botId = process.env.LINEAR_RENDER_BOT_ID ?? bots.managerId ?? bots.bots?.[0]?.id ?? "demo";
let attachment = null;
let imageAttachment = null;
let threadEntry = null;
const threadCandidates = [];
for (const item of bots.bots ?? []) {
  const page = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(item.id)}/messages?limit=100`).then((response) => response.json()).catch(() => ({ entries: [] }));
  const found = page.entries?.find((entry) => entry.type === "attachment" && ["markdown", "text"].includes(entry.kind))
    ?? page.entries?.find((entry) => entry.type === "attachment" && entry.kind === "pdf")
    ?? page.entries?.find((entry) => entry.type === "attachment" && entry.kind === "image");
  if (attachment == null && found != null) attachment = found;
  if (imageAttachment == null) imageAttachment = page.entries?.find((entry) => entry.type === "attachment" && entry.kind === "image") ?? null;
  for (const entry of page.entries ?? []) {
    if (entry.branched === true || Number(entry.threadCount) > 0) threadCandidates.push({ ...entry, agentId: item.id });
  }
}
for (const candidate of threadCandidates) {
  const thread = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(candidate.agentId)}/threads/${encodeURIComponent(candidate.id)}`).then((response) => response.json()).catch(() => ({ entries: [] }));
  if ((thread.entries?.length ?? 0) > 0) {
    threadEntry = candidate;
    break;
  }
}
function attachmentQueryFor(item) {
  return item == null ? "" : `&botId=${encodeURIComponent(item.agentId)}&entryId=${encodeURIComponent(item.id)}&value=${encodeURIComponent(item.name)}&attachmentAgentId=${encodeURIComponent(item.agentId)}&attachmentPath=${encodeURIComponent(item.path)}&attachmentKind=${encodeURIComponent(item.kind)}&attachmentBytes=${encodeURIComponent(item.byteSize)}${item.mime ? `&attachmentMime=${encodeURIComponent(item.mime)}` : ""}`;
}
const attachmentQuery = attachmentQueryFor(attachment);
const imageAttachmentQuery = attachmentQueryFor(imageAttachment);
const routines = await fetch(`${baseUrl}/api/bots/${encodeURIComponent(botId)}/routines`).then((response) => response.json()).catch(() => ({ routines: [] }));
const routineId = routines.routines?.[0]?.id ?? "";
const skillCatalog = await fetch(`${baseUrl}/api/skills?limit=1`).then((response) => response.json()).catch(() => ({ skills: [] }));
const skillName = skillCatalog.skills?.[0]?.name ?? "";
const allScreens = [
  ["home", `/?surface=HomeScreen`],
  ["chat", `/?surface=ChatScreen&botId=${encodeURIComponent(botId)}`],
  ["routine", `/?surface=RoutineDetailScreen&botId=${encodeURIComponent(botId)}${routineId ? `&value=${encodeURIComponent(routineId)}` : ""}`],
  ["plugins", `/?surface=PluginsScreen`],
  ["file-preview", `/?surface=AttachmentPreviewRoute${attachmentQuery}`],
  ["settings", `/?surface=SettingsSheet`],
  ["appearance", `/?surface=AppearanceScreen`],
  ["computer-controls", `/?surface=BoxDesktopScreen&botId=${encodeURIComponent(botId)}`],
];
const only = process.env.LINEAR_RENDER_ONLY;
const registeredSurfaces = auditAll
  ? [...new Set([...((await fs.readFile(resolve(process.cwd(), "src/navigation.ts"), "utf8")).matchAll(/"([A-Za-z]+(?:Screen|Sheet|View|Route))"/gu))].map((match) => match[1]))]
  : [];
function auditPath(name) {
  if (["AttachmentPreviewRoute", "FilePreviewSheet", "ShareTargetScreen"].includes(name) && attachmentQuery) return `/?surface=${name}${attachmentQuery}`;
  if (name === "ImageViewerRoute" && imageAttachmentQuery) return `/?surface=${name}${imageAttachmentQuery}`;
  if (name === "RoutineDetailScreen" && routineId) return `/?surface=${name}&botId=${encodeURIComponent(botId)}&value=${encodeURIComponent(routineId)}`;
  if (name === "SkillSheet" && skillName) return `/?surface=${name}&value=${encodeURIComponent(skillName)}`;
  if (name === "ThreadScreen" && threadEntry) return `/?surface=${name}&botId=${encodeURIComponent(threadEntry.agentId)}&entryId=${encodeURIComponent(threadEntry.id)}`;
  return `/?surface=${name}&botId=${encodeURIComponent(botId)}&value=sample`;
}
const screens = auditAll
  ? registeredSurfaces.filter((name) => name !== "OnboardingScreen").map((name) => [name, auditPath(name)])
  : only ? allScreens.filter(([name]) => name === only) : allScreens;

const report = [];
try {
  const client = createClient(await devtoolsTarget());
  await new Promise((resolvePromise, reject) => {
    client.socket.once("open", resolvePromise);
    client.socket.once("error", reject);
  });
  await client.command("Page.enable");
  await client.command("Runtime.enable");
  await client.command("Emulation.setDeviceMetricsOverride", { width: viewportWidth, height: viewportHeight, deviceScaleFactor: 1, mobile: true, screenWidth: viewportWidth, screenHeight: viewportHeight });
  await client.command("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  if (auditAll || reusePage) {
    await client.command("Page.navigate", { url: `${baseUrl}/?surface=HomeScreen` });
    await wait(1800);
  }

  for (const [name, path] of screens) {
    client.errors.length = 0;
    if (auditAll || reusePage) {
      await client.command("Runtime.evaluate", { expression: `history.replaceState(null, '', ${JSON.stringify(path)}); window.dispatchEvent(new PopStateEvent('popstate')); true`, returnByValue: true });
      await wait(90);
    } else {
      await client.command("Page.navigate", { url: `${baseUrl}${path}` });
    }
    for (let attempt = 0; attempt < 18; attempt += 1) {
      const ready = await client.command("Runtime.evaluate", { expression: "Boolean(document.querySelector('.surface-page,.home-screen,.chat-screen,.computer-screen,.form-screen,.settings-screen'))", returnByValue: true });
      if (ready.result.value) break;
      await wait(100);
    }
    await wait(auditAll ? 120 : 800);
    for (let attempt = 0; attempt < (auditAll ? 50 : 40); attempt += 1) {
      const pendingSkeleton = await client.command("Runtime.evaluate", { expression: "Boolean(document.querySelector('.screen-skeleton'))", returnByValue: true });
      if (!pendingSkeleton.result.value) break;
      await wait(100);
    }
    if (name === "chat" && process.env.LINEAR_RENDER_CHAT_SCROLL === "top") {
      await client.command("Runtime.evaluate", { expression: "document.querySelector('.transcript')?.scrollTo({ top: 0 }); true", returnByValue: true });
      await wait(120);
    }
    await client.command("Runtime.evaluate", { expression: "document.fonts.ready.then(() => true)", awaitPromise: true, returnByValue: true });
    const metricsResult = await client.command("Runtime.evaluate", {
      expression: `(() => { const transcript = document.querySelector('.transcript'); const messages = transcript?.querySelectorAll('.message-line'); const lastMessage = messages?.[messages.length - 1]; return { title: document.title, text: document.body.innerText.slice(0, 240), width: document.documentElement.scrollWidth, viewport: window.innerWidth, scrollY: window.scrollY, documentHeight: document.documentElement.scrollHeight, renderedRoot: Boolean(document.querySelector('.surface-page,.home-screen,.chat-screen,.computer-screen,.form-screen,.settings-screen')), pendingSkeleton: Boolean(document.querySelector('.screen-skeleton')), fonts: { latin: document.fonts.check('16px "PP Neue Montreal"'), korean: document.fonts.check('16px "Pretendard Variable"') }, transcript: transcript ? { scrollTop: transcript.scrollTop, scrollHeight: transcript.scrollHeight, clientHeight: transcript.clientHeight, atBottom: Math.abs(transcript.scrollHeight - transcript.clientHeight - transcript.scrollTop) < 2, top: transcript.getBoundingClientRect().top, bottom: transcript.getBoundingClientRect().bottom, lastMessageBottom: lastMessage?.getBoundingClientRect().bottom ?? null } : null }; })()`,
      returnByValue: true,
    });
    const file = auditAll ? null : resolve(outputDir, `${name}.png`);
    if (file) {
      const screenshot = await client.command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
      await fs.writeFile(file, Buffer.from(screenshot.data, "base64"));
    }
    const metrics = metricsResult.result.value;
    report.push({ name, file, ...metrics, horizontalOverflow: metrics.width > metrics.viewport, consoleErrors: [...client.errors], passed: metrics.renderedRoot && !metrics.pendingSkeleton && metrics.width <= metrics.viewport && client.errors.length === 0 });
  }
  client.socket.close();
  const reportName = auditAll ? "all-surface-audit.json" : "render-report.json";
  await fs.writeFile(resolve(outputDir, reportName), `${JSON.stringify({ status: "observed", viewport: { width: viewportWidth, height: viewportHeight }, onboarding: auditAll ? "covered by unpaired product flow, excluded from paired deep-link audit" : undefined, screens: report }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  chrome.kill("SIGTERM");
}
