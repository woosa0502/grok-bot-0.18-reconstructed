import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = resolve(root, "docs/evidence/screen-inventory.md");

test("all 54 high-confidence APK surfaces have a reachable implementation", async () => {
  const [inventory, navigation, router, app] = await Promise.all([
    fs.readFile(inventoryPath, "utf8"),
    fs.readFile(resolve(root, "src/navigation.ts"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/ProductSurfaceRouter.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/App.tsx"), "utf8"),
  ]);
  const expected = [...inventory.matchAll(/- `([A-Za-z]+(?:Screen|Sheet|View|Route))`/gu)].map((match) => match[1]);
  assert.equal(expected.length, 54);
  for (const surface of expected) {
    assert.match(navigation, new RegExp(`"${surface}"`, "u"), `${surface} must be registered`);
    assert.ok(router.includes(`${surface},`) || app.includes(surface), `${surface} must be routed`);
  }
});

test("recovered character states and mobile interaction affordances stay present", async () => {
  const [app, avatar, chat, messageEntry, messageContent, styles] = await Promise.all([
    fs.readFile(resolve(root, "src/App.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/components/BabyGrokAvatar.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/ChatScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/components/MessageEntry.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/components/MessageContent.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/styles.css"), "utf8"),
  ]);
  for (const state of ["searching", "happy", "working", "curious", "excited", "listening", "playful", "proud", "laughing"]) assert.match(avatar, new RegExp(`\\b${state}\\b`, "u"));
  assert.match(chat, /linear-chat-draft/u);
  assert.match(chat, /SpeechRecognition/u);
  assert.match(messageEntry, /MessageActionsSheet/u);
  assert.match(messageEntry, /AttachmentPreviewRoute/u);
  assert.match(chat, /AgentActivityGroup/u);
  assert.match(messageEntry, /MessageContent/u);
  assert.match(messageContent, /<ul/u);
  assert.match(messageContent, /<pre/u);
  assert.match(app, /if \(eventTimer\.current != null\) return;/u);
  assert.match(styles, /\.message-bubble \{[^}]*font-size: 17px/u);
  assert.match(styles, /\.composer-row \{/u);
  assert.match(styles, /prefers-reduced-motion/u);
});

test("mobile navigation is represented in browser history", async () => {
  const app = await fs.readFile(resolve(root, "src/App.tsx"), "utf8");
  assert.match(app, /window\.history\.pushState\(navigationState\(nextRoutes\)/u);
  assert.match(app, /window\.addEventListener\("popstate", syncRouteFromHistory\)/u);
  assert.match(app, /window\.history\.back\(\)/u);
  assert.match(app, /window\.history\.go\(-depth\)/u);
  assert.match(app, /document\.querySelector<HTMLElement>\("\.app-screen"\)\?\.scrollTo\(0, 0\)/u);
});

test("formerly orphaned surfaces use live contracts or explicit unsupported states", async () => {
  const [app, chat, settings, automation, files, computer, viewer] = await Promise.all([
    fs.readFile(resolve(root, "src/App.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/ChatScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/SettingsScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/AutomationAndExtensionSurfaces.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/FileAndSettingsSurfaces.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/AgentAndComputerSurfaces.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/ComputerScreen.tsx"), "utf8"),
  ]);
  assert.match(app, /commitNavigation\(shouldAskNotifications\(\) \? \[homeRoute\(\), \{ name: "NotificationsAskScreen" \}\] : \[homeRoute\(\)\], "push"\)/u);
  assert.match(settings, /onOpen\("NotificationsAskScreen"\)/u);
  for (const contract of ["api.routines", "api.createRoutine", "api.updateRoutine", "api.runRoutine", "api.skills", "api.tools"]) assert.match(automation, new RegExp(contract.replace(".", "\\."), "u"));
  assert.match(computer, /open\("WebNoAccessScreen"\)/u);
  assert.match(chat, /onOpen\("UserFormSheet"/u);
  // 2026-09-05: these screens stopped being phone-local; each now reaches the desktop through a live contract.
  for (const contract of ["api.sendForm", "api.addMemory", "api.deleteMemory", 'api.setSetting("agentDefaultModel"', 'api.setSetting("userLanguage"', 'api.setSetting("userTimeZone"', "api.feedback"]) assert.ok(files.includes(contract), `FileAndSettingsSurfaces uses ${contract}`);
  for (const contract of ["api.botTemplate", "api.importTemplate"]) assert.ok(automation.includes(contract), `template screens use ${contract}`);
  for (const contract of ["api.botModel", "api.setBotModel"]) assert.ok(computer.includes(contract), `bot model screen uses ${contract}`);
  assert.doesNotMatch(files, /linear-default-model|linear-time-zone|연결 전 로컬 선택값/u, "no local-only model/time zone selection remains");
  for (const contract of ["api.attachmentPreview", "api.shareAttachment", "api.codexUsage"]) assert.match(files, new RegExp(contract.replace(".", "\\."), "u"));
  assert.equal([...settings.matchAll(/onOpen\("AppearanceScreen"\)/gu)].length, 1, "settings exposes one appearance destination");
  assert.equal([...settings.matchAll(/<strong>화면 표시<\/strong>/gu)].length, 1, "settings renders one display row");
  assert.doesNotMatch(files, /이번 달 38%|월 20,000원|<span>H<\/span>/u);
  assert.match(computer, /api\.computer/u);
  assert.match(computer, /api\.ensureComputer/u);
  assert.match(computer, /api\.resetComputer/u);
  // One real computer view: the desktop surface and the window switcher both land on ComputerScreen.
  assert.match(computer, /return <ComputerScreen bot=\{bot\}/u);
  assert.match(computer, /open\("AgentComputerScreen", \{ botId: bot\?\.id, value: String\(selected\) \}\)/u);
  assert.match(viewer, /api\.computerWindow/u);
  assert.match(viewer, /noVNC_keyboard_button/u);
});

test("settings omits plan and user feedback menu rows", async () => {
  const settings = await fs.readFile(resolve(root, "src/screens/SettingsScreen.tsx"), "utf8");
  assert.match(settings, /onOpen\("UsageScreen"\)/u);
  assert.doesNotMatch(settings, /onOpen\("SubscriptionScreen"\)/u);
  assert.doesNotMatch(settings, /onOpen\("FeedbackSheet"\)/u);
  assert.doesNotMatch(settings, /<strong>플랜<\/strong>|<strong>피드백<\/strong>/u);
});

test("computer settings live in the top-right menu instead of the bottom dock", async () => {
  const [computer, help, styles] = await Promise.all([
    fs.readFile(resolve(root, "src/screens/ComputerScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/AgentAndComputerSurfaces.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/styles.css"), "utf8"),
  ]);
  const toolbar = computer.slice(computer.indexOf('<header className="computer-toolbar">'), computer.indexOf('<section className="computer-canvas"'));
  const dock = computer.slice(computer.indexOf('<footer className="computer-dock">'));
  assert.match(toolbar, /aria-expanded=\{menuOpen\}/u);
  assert.match(toolbar, /className="computer-menu"/u);
  for (const contract of ["togglePointerMode", "toggleFit", "setReloadKey", "ComputerHelpSheet", "BoxScreen"]) assert.match(toolbar, new RegExp(contract, "u"));
  for (const contract of ["togglePointerMode", "toggleFit", "setReloadKey", "ComputerHelpSheet", "BoxScreen"]) assert.doesNotMatch(dock, new RegExp(contract, "u"));
  for (const action of ["noVNC_keyboard_button", "noVNC_send_esc_button", "noVNC_send_tab_button", "pasteToComputer", "copyFromComputer", "toggleFullscreen"]) assert.match(dock, new RegExp(action, "u"));
  assert.match(styles, /\.computer-menu \{/u);
  assert.match(help, /포인터 방식 \(우측 상단 … 메뉴에서 전환\)/u);
  assert.match(help, /우측 상단 … 메뉴에서 '원본 크기'/u);
  assert.match(help, /우측 상단 … 메뉴의 '다시 연결'/u);
  assert.doesNotMatch(help, /포인터 방식 \(아래 도구 줄에서 전환\)|아래 줄의 '원본 크기'/u);
  assert.match(computer, /우측 상단 … 메뉴에서 다시 연결을 누르세요/u);
});

test("every bot chat menu opens the two personal filesystem scopes", async () => {
  const [chat, navigation, router, api, filesystem] = await Promise.all([
    fs.readFile(resolve(root, "src/screens/ChatScreen.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/navigation.ts"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/ProductSurfaceRouter.tsx"), "utf8"),
    fs.readFile(resolve(root, "src/api.ts"), "utf8"),
    fs.readFile(resolve(root, "src/screens/surfaces/PersonalFileSystemSurfaces.tsx"), "utf8"),
  ]);
  assert.match(chat, /내 파일 시스템/u);
  assert.match(chat, /onOpen\("FileSystemScreen", \{ botId: bot\.id, value: "windows:" \}\)/u);
  assert.match(chat, /onOpen\("FileSystemScreen", \{ botId: bot\.id, value: "belmont:" \}\)/u);
  assert.match(navigation, /"FileSystemScreen"/u);
  assert.match(navigation, /"LocalFilePreviewScreen"/u);
  assert.match(router, /FileSystemScreen/u);
  assert.match(router, /LocalFilePreviewScreen/u);
  assert.match(api, /fileSystemList/u);
  assert.match(api, /fileSystemPreview/u);
  assert.match(filesystem, /Windows 전체/u);
  assert.match(filesystem, /Belmont 폴더/u);
  assert.match(filesystem, /읽기 전용/u);
  assert.match(filesystem, /filesystem-more/u);
});
