import { CompanionApi } from "./api.js";
import {
  STORAGE_KEY,
  escapeHtml,
  formatClock,
  formatDay,
  getManagerBot,
  getWorkerBots,
  messageText,
  normalizeBaseUrl,
  parsePairingInvite,
  pendingApproval,
  renderMarkdown,
  responseBehavior
} from "./core.js";
import { createMockApi } from "./mock-api.js";
import { personaSvg, resolvePersonaColor, resolvePersonaShape, startPersonaMotion } from "./persona.js";

const app = document.querySelector("#app");
const state = {
  view: "pair",
  overlay: null,
  connection: null,
  api: null,
  fleet: { bots: [], groups: [] },
  manager: null,
  workers: [],
  messages: [],
  hasMore: false,
  nextBefore: null,
  scrollRestore: null,
  query: "",
  draft: "",
  loading: false,
  awaitingReply: false,
  readonlyChat: null,
  pendingAttachments: [],
  notice: null,
  streamStatus: "closed",
  stopStream: null,
  installPrompt: null,
  searchOpen: false,
  pairOtherOpen: false,
  pairManualOpen: false,
  dictating: false,
  scannedInvite: null,
  scannerStream: null,
  scannerFrame: null,
  scannerStarting: false
};

const icons = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 12 6-6 6 6M12 6v12"/></svg>',
  computer: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1"/></svg>',
  task: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 .8.8L6 5M3.5 12l.8.8L6 11M3.5 18l.8.8L6 17"/></svg>',
  folder: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v7h14v-7"/></svg>',
  gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.55V21h-4v-.08A1.7 1.7 0 0 0 8.97 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.52-1.03H3v-4h.08A1.7 1.7 0 0 0 4.6 8.94a1.7 1.7 0 0 0-.34-1.88L4.2 7l2.83-2.83.06.06a1.7 1.7 0 0 0 1.88.34A1.7 1.7 0 0 0 10 3.05V3h4v.05a1.7 1.7 0 0 0 1.03 1.52 1.7 1.7 0 0 0 1.88-.34l.06-.06L19.8 7l-.06.06a1.7 1.7 0 0 0-.34 1.88A1.7 1.7 0 0 0 20.92 10H21v4h-.08A1.7 1.7 0 0 0 19.4 15Z"/></svg>'
  ,device: '<svg viewBox="0 0 64 64" aria-hidden="true"><rect x="5" y="10" width="38" height="28" rx="3"/><path d="M15 46h18M24 38v8"/><rect x="39" y="24" width="18" height="31" rx="4"/><path d="M45 50h6"/></svg>',
  qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M8 8h3v3H8zM14 8h2M14 11h3M8 14h2M8 17h4M13 14h3v3h-3z"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/></svg>',
  mic: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>',
  hand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 11V6.5a1.5 1.5 0 0 1 3 0V10M10.5 10V4.5a1.5 1.5 0 0 1 3 0V10M13.5 10V5.5a1.5 1.5 0 0 1 3 0V11M16.5 11V8a1.5 1.5 0 0 1 3 0v6.5c0 4-2.7 6.5-6.6 6.5h-1.3c-2.5 0-4.3-1.2-5.5-3.2L3.7 14a1.6 1.6 0 0 1 2.6-1.8l1.2 1.3V11Z"/></svg>'
};

function icon(name) {
  return `<span class="icon" aria-hidden="true">${icons[name] ?? ""}</span>`;
}

// THE SHIPPED ENGINE ITSELF: extracted as a self-contained dependency closure
// from the desktop's production bundle (scripts/extract-grok-engine.mjs), so
// the phone runs the exact same character engine — full 60fps rig, all states,
// gaze, particles — generated live, no recordings, no relay. The vanilla
// persona svg remains only as the instant pre-mount placeholder, and the
// composing→dots morph stays (observed desktop behavior, not in the engine).
let grokEngine = null;
const grokRoots = new WeakMap();
import("./grok-engine.js")
  .then((module) => { grokEngine = module; hydrateAvatars(); })
  .catch(() => {});

function engineStateFor(wrapper) {
  const status = wrapper.dataset.status;
  if (status === "done") return "happy";
  if (status === "waiting") return "listening";
  if (status === "busy") return wrapper.dataset.motion || "working";
  return "idle";
}

function hydrateAvatars() {
  if (!grokEngine) return;
  for (const el of document.querySelectorAll(".maus-avatar[data-agent-id]")) {
    if (el.dataset.status === "composing") continue;
    const props = {
      color: resolvePersonaColor(el.dataset.agentId, el.dataset.color || null),
      shape: resolvePersonaShape(el.dataset.agentId, el.dataset.shape || null),
      state: engineStateFor(el),
      sizePx: el.clientWidth || 52,
      isFollowingPointer: true
    };
    try {
      let root = grokRoots.get(el);
      if (!root) {
        root = grokEngine.mountGrokMark(el, props);
        grokRoots.set(el, root);
      } else {
        root.render(grokEngine.EngineReact.createElement(grokEngine.GrokMark, props));
      }
    } catch {}
  }
}

// The desktop's activity→engine-state mapping (agent-avatar.tsx), so the pose
// follows what the bot is actually doing.
function motionStateFor(bot, status) {
  if (status === "done") return "happy";
  if (status === "waiting") return "listening";
  if (status !== "busy" && status !== "composing") return "idle";
  const activity = bot?.activity;
  if (activity?.kind === "thinking") return "thinking";
  if (activity?.kind === "tool" && activity.tool === "SendToAgent") return "sending";
  const verbMap = { thinking: "thinking", searching: "searching", browsing: "searching", reading: "searching", connecting: "searching", writing: "working", coding: "working", generating: "loading", "running-commands": "working", "on-its-computer": "working", "on-your-computer": "working", working: "working", messaging: "orbit", waiting: "orbit", sending: "sending" };
  if (typeof activity?.verb === "string" && verbMap[activity.verb]) return verbMap[activity.verb];
  if (typeof activity?.tool === "string") {
    if (activity.tool === "WebSearch" || activity.tool === "WebFetch" || activity.tool.startsWith("browser_")) return "searching";
    if (activity.tool === "GenerateImage") return "loading";
    if (activity.tool === "Task" || activity.tool === "Await" || activity.tool === "CheckSubagent") return "orbit";
    return "working";
  }
  return "working";
}

function avatar(bot, size = "medium", status = "idle") {
  const resolved = status === "busy" && bot?.composing ? "composing" : status;
  const motionState = motionStateFor(bot, resolved);
  return `<span class="maus-avatar maus-avatar--${size}" data-status="${escapeHtml(resolved)}" data-motion="${escapeHtml(motionState)}" data-agent-id="${escapeHtml(bot?.id ?? "")}" data-color="${escapeHtml(bot?.color ?? "")}" data-shape="${escapeHtml(bot?.shape ?? "")}" aria-hidden="true">${personaSvg({ id: bot?.id, shape: bot?.shape, color: bot?.color, status: resolved })}</span>`;
}

function profileAvatar() {
  return '<span class="profile-avatar" aria-hidden="true"><img src="./icons/linear-app-icon.svg" alt="" /></span>';
}

function render() {
  // The whole view is rebuilt, so remember where the reader was: only follow the
  // tail when they were already near it, and keep the composer's focus alive.
  const previousList = document.querySelector("#message-list");
  const wasNearBottom = previousList == null
    || previousList.scrollTop + previousList.clientHeight >= previousList.scrollHeight - 80;
  const previousScrollTop = previousList?.scrollTop ?? 0;
  const composerHadFocus = document.activeElement?.id === "composer-input";
  document.body.dataset.view = state.view;
  if (state.view === "pair") app.innerHTML = renderPair();
  else if (state.view === "home") app.innerHTML = renderHome();
  else app.innerHTML = renderChat();
  if (state.overlay) app.insertAdjacentHTML("beforeend", renderOverlay());
  syncComputerView();
  syncViewerView();
  if (state.overlay?.type === "computer") bindComputerKeyboard();
  if (state.notice) app.insertAdjacentHTML("beforeend", `<div class="toast" role="status">${escapeHtml(state.notice)}</div>`);
  queueMicrotask(() => {
    if (state.overlay?.type === "scanner") startQrScanner();
    const messageList = document.querySelector("#message-list");
    if (state.view === "chat" && messageList) {
      if (state.scrollRestore) {
        messageList.scrollTop = messageList.scrollHeight - state.scrollRestore.height + state.scrollRestore.top;
        state.scrollRestore = null;
      } else if (previousList && !wasNearBottom) {
        messageList.scrollTop = previousScrollTop;
      } else {
        messageList.scrollTop = messageList.scrollHeight;
      }
    }
    if (composerHadFocus) {
      const input = document.querySelector("#composer-input");
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      }
    }
    hydrateAvatars();
  });
}

function renderPair() {
  if (state.scannedInvite) {
    return `
      <section class="pair-screen screen">
        <header class="pair-nav"><button type="button" data-action="scan-again">Back</button><strong>Connect computer</strong><span aria-hidden="true"></span></header>
        <form class="pair-confirmation" id="pair-form">
          <span class="confirmation-device" aria-hidden="true">${icon("computer")}</span>
          <h1>${escapeHtml(state.scannedInvite.name)}</h1>
          <strong class="confirmation-badge">${icon("check")} QR code scanned</strong>
          <div class="confirmation-origin"><strong>Computer address</strong><code>${escapeHtml(state.scannedInvite.baseUrl)}</code><p>연결하기 전에 예상한 컴퓨터 주소가 맞는지 확인하세요.</p></div>
          <input type="hidden" name="baseUrl" value="${escapeHtml(state.scannedInvite.baseUrl)}" />
          <input type="hidden" name="code" value="${escapeHtml(state.scannedInvite.credential)}" />
          <input type="hidden" name="deviceName" value="내 휴대폰" />
          <button class="primary-button" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? '<span class="spinner"></span> 연결 중' : "Connect"}</button>
        </form>
      </section>`;
  }
  return `
    <section class="pair-screen screen">
      <header class="pair-nav"><button type="button" data-action="demo">Not now</button><strong>Connect computer</strong><span aria-hidden="true"></span></header>
      <div class="pair-hero">
        <span class="pair-device" aria-hidden="true">${icon("device")}</span>
        <h1>Connect to your computer</h1>
        <p>컴퓨터의 Belmont QR 코드를 스캔하면 가장 적합한 연결 경로를 안전하게 선택합니다.</p>
      </div>
      <section class="pair-primary">
        <button class="primary-button" type="button" data-action="scan-qr">${icon("qr")} Scan QR code</button>
        <p>컴퓨터에서 Settings → Phone → Set up a phone을 여세요.</p>
      </section>
      <section class="pair-other ${state.pairOtherOpen ? "is-open" : ""}">
        <button class="disclosure-title" type="button" data-action="pair-other" aria-expanded="${state.pairOtherOpen}"><strong>Other ways to connect</strong>${icon("chevron")}</button>
        ${state.pairOtherOpen ? `<div class="pair-other-body">
          <div class="nearby-row">${icon("computer")}<span><strong>Nearby computers</strong><small>Computers ready to pair will appear here.</small></span><span class="spinner" aria-label="Looking for computers"></span></div>
          <div class="pair-divider"></div>
          <button class="manual-toggle" type="button" data-action="pair-manual" aria-expanded="${state.pairManualOpen}">${icon("keyboard")}<strong>Enter address and code</strong>${icon("chevron")}</button>
          ${state.pairManualOpen ? `<form class="pair-form" id="pair-form">
            <div class="pair-group">
              <label class="pair-row"><span>Computer address</span><input name="baseUrl" inputmode="url" autocomplete="url" placeholder="https://belmont.tailnet.ts.net" value="${escapeHtml(state.connection?.baseUrl ?? "")}" /></label>
              <label class="pair-row"><span>Pairing code</span><input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="80" placeholder="6 digits or QR credential" /></label>
              <label class="pair-row"><span>Device name</span><input name="deviceName" autocomplete="name" value="내 휴대폰" /></label>
            </div>
            <button class="quiet-button" type="submit" ${state.loading ? "disabled" : ""}>${state.loading ? '<span class="spinner"></span> 연결 중' : "Continue"}</button>
          </form>` : ""}
        </div>` : ""}
      </section>
      <p class="pair-note">Belmont gateway는 보호된 모바일 세션을 발급하고, 브라우저는 HttpOnly 세션만 사용합니다.</p>
      ${state.notice ? `<p class="form-error" role="alert">${escapeHtml(state.notice)}</p>` : ""}
    </section>`;
}

function renderHome() {
  const manager = state.manager;
  const managerMessages = manager?.messages?.length ? manager.messages : state.messages;
  const approval = pendingApproval(managerMessages);
  const last = [...managerMessages].reverse().find((message) => messageText(message));
  const search = state.query.trim().toLowerCase();
  const workers = state.workers.filter((worker) => {
    if (!search) return true;
    return `${worker.name} ${worker.title} ${worker.taskSummary ?? worker.description}`.toLowerCase().includes(search);
  });

  return `
    <section class="home-screen screen">
      <header class="home-header">
        <button class="glass-button profile-button" type="button" data-action="settings" aria-label="연결 설정">${profileAvatar()}</button>
        <div class="home-title"><strong>Linear</strong><small>${state.connection?.mode === "demo" ? "Belmont Demo · connected" : `${escapeHtml(state.connection?.serverName || "Belmont computer")} · ${streamLabel(state.streamStatus).toLowerCase()}`}</small></div>
        <button class="glass-button" type="button" data-action="settings" aria-label="설정">${icon("gear")}</button>
      </header>

      <div class="home-scroll">
        ${approval ? `
          <button class="attention-banner" type="button" data-action="open-manager">
            ${avatar(manager, "small", "waiting")}
            <span><strong>Belmont가 확인을 기다립니다</strong><small>${escapeHtml(approval.card.subtitle || approval.card.title)}</small></span>
            ${icon("chevron")}
          </button>` : ""}

        <section class="roster-section">
          ${manager ? `
            <button class="manager-row" type="button" data-action="open-manager">
              <span class="row-leading">${manager.unread ? '<span class="unread-dot" aria-label="읽지 않음"></span>' : ""}</span>
              ${avatar(manager, "medium", manager.busy ? "busy" : approval ? "waiting" : "idle")}
              <span class="row-copy">
                <span class="row-title"><strong>${escapeHtml(manager.name)}</strong><em>${escapeHtml(manager.title || "Chief of Staff")}</em><time>${last ? formatClock(last.at) : ""}</time>${icon("chevron")}</span>
                <span class="row-preview">${escapeHtml(manager.busy ? "작업을 조율하고 있습니다" : messageText(last) || manager.description)}</span>
                ${approval ? '<span class="waiting-pill">Waiting on you</span>' : ""}
              </span>
            </button>` : '<div class="empty-state">Belmont 봇을 찾지 못했습니다.</div>'}
        </section>

        <section class="roster-section worker-section">
          <div class="section-heading">Bots</div>
          ${workers.length ? workers.map(renderWorkerRow).join("") : '<div class="empty-state">검색 결과가 없습니다.</div>'}
        </section>
      </div>

      <footer class="roster-bottom-bar">
        <div class="glass-group">
          ${state.searchOpen ? `
            <label class="bottom-search">${icon("search")}<input id="roster-search" type="search" placeholder="Search chats" value="${escapeHtml(state.query)}" autofocus />${state.query ? `<button type="button" data-action="clear-search" aria-label="검색어 지우기">${icon("close")}</button>` : ""}</label>
            <button class="cancel-search glass-pill" type="button" data-action="close-search">Cancel</button>
          ` : `
            <button class="updates-pill glass-pill" type="button" data-action="updates">${avatar(manager, "tiny", approval ? "waiting" : "idle")}<span class="pill-copy"><strong>Updates</strong><small>${approval ? "1 needs you" : `${workers.filter((worker) => worker.busy).length} working`}</small></span>${approval ? '<b>1</b>' : ""}</button>
            <button class="glass-button bottom-action" type="button" data-action="open-search" aria-label="Search">${icon("search")}</button>
            <button class="glass-button bottom-action" type="button" data-action="more" aria-label="Create">${icon("plus")}</button>
          `}
        </div>
      </footer>
    </section>`;
}

function renderWorkerRow(worker) {
  const status = worker.taskStatus || (worker.busy ? "진행 중" : "대기");
  return `
    <button class="worker-row" type="button" data-action="worker-chat" data-worker-id="${escapeHtml(worker.id)}">
      <span class="row-leading"></span>
      ${avatar(worker, "medium", worker.busy ? "busy" : status === "완료" ? "done" : "idle")}
      <span class="row-copy">
        <span class="row-title"><strong>${escapeHtml(worker.name)}</strong><em>${escapeHtml(worker.title)}</em><time>${worker.busy ? "now" : ""}</time>${icon("chevron")}</span>
        <span class="row-preview">${escapeHtml(worker.taskSummary || worker.description || status)}</span>
        ${worker.busy ? '<span class="working-indicator"><i></i><i></i><i></i></span>' : ""}
      </span>
    </button>`;
}

function activeChatBot() {
  return state.readonlyChat ?? state.manager;
}

function activeThreadId() {
  return activeChatBot()?.threadId ?? null;
}

function renderChat() {
  const bot = activeChatBot();
  const readonly = state.readonlyChat != null;
  const approval = readonly ? null : pendingApproval(state.messages);
  const composer = readonly
    ? `<div class="readonly-bar">읽기 전용: 이 봇에게 지시하려면 Belmont에게 부탁하세요</div>`
    : `${state.pendingAttachments.length ? `<div class="attach-chips">${state.pendingAttachments.map((att) => `<span class="attach-chip">${escapeHtml(att.name)}<button type="button" data-action="remove-attachment" data-attach-id="${escapeHtml(att.id)}" aria-label="첨부 제거">${icon("close")}</button></span>`).join("")}</div>` : ""}<form class="composer" id="composer-form">
        <input id="attach-input" type="file" multiple hidden />
        <button class="glass-button composer-plus ${state.overlay?.type === "more" ? "is-open" : ""}" type="button" data-action="more" aria-label="더 보기">${icon("plus")}</button>
        <label class="composer-field glass-pill">
          <span class="sr-only">Belmont에게 메시지</span>
          <textarea id="composer-input" rows="1" maxlength="12000" placeholder="Message ${escapeHtml(bot?.name || "Belmont")}">${escapeHtml(state.draft)}</textarea>
          <button class="mic-button ${state.dictating ? "is-listening" : ""}" type="button" data-action="dictation" aria-label="${state.dictating ? "음성 입력 중지" : "음성 입력 시작"}">${icon("mic")}</button>
          <button class="send-button" type="submit" aria-label="보내기" ${(!state.draft.trim() && state.pendingAttachments.length === 0) || state.loading ? "disabled" : ""}>${icon("send")}</button>
        </label>
      </form>`;
  return `
    <section class="chat-screen screen">
      <header class="chat-header">
        <button class="glass-button back-button" type="button" data-action="back" aria-label="대화 목록">${icon("back")}</button>
        <div class="chat-identity">
          ${avatar(bot, "tiny", bot?.busy ? "busy" : approval ? "waiting" : "idle")}
          <button class="identity-pill glass-pill" type="button" data-action="${readonly ? "worker-detail" : "manager-info"}" ${readonly ? `data-worker-id="${escapeHtml(bot?.id ?? "")}"` : ""}><strong>${escapeHtml(bot?.name || "Belmont")}</strong><span>${escapeHtml(bot?.title || (readonly ? "읽기 전용" : "Chief of Staff"))}</span>${icon("chevron")}</button>
        </div>
        ${readonly ? '<span class="glass-button" aria-hidden="true" style="visibility:hidden"></span>' : `<button class="glass-button" type="button" data-action="computer" aria-label="컴퓨터 보기">${icon("computer")}</button>`}
      </header>

      <div class="message-list" id="message-list">${chatMessagesHtml()}</div>

      ${composer}
    </section>`;
}

function chatMessagesHtml() {
  // The status line lives for the whole turn — with multi-part replies it only
  // leaves when the last one is done — styled after Claude Code's ✳ Working line.
  const bot = activeChatBot();
  const running = state.loading || state.awaitingReply || bot?.busy;
  return `
    ${state.hasMore ? '<button class="load-earlier" type="button" data-action="load-earlier">이전 메시지 불러오기</button>' : ""}
    ${state.messages.map((message, index) => renderMessage(message, index)).join("")}
    ${running ? renderTurnStatus(bot) : ""}
    <div id="message-end" aria-hidden="true"></div>`;
}

// Poll responses carry the bot's live turn state; fold it into the roster copy
// so the status line works even when the push channel is dead.
function applyThreadState(page) {
  const bot = activeChatBot();
  if (!page?.state || !bot) return;
  bot.busy = page.state.busy;
  bot.composing = page.state.composing;
  bot.activity = page.state.activity ?? null;
}

// Screenshot-verified desktop behavior: while the turn runs, the bot's own
// character stands at the incoming-message slot (rocking, no bubble); once it
// starts writing, the character becomes three bot-colored dots.
function renderTurnStatus(bot) {
  return `<article class="message-row message-row--bot turn-pending" role="status" aria-label="응답 생성 중">
    ${avatar(bot, "tiny", "busy")}
  </article>`;
}

// Swap only the list's contents: the scroll container itself survives, so the
// browser has no rebuilt-from-scratch frame to flash and the composer keeps
// focus without any restore trick. Full render() stays for view changes.
function updateChatMessages() {
  const messageList = document.querySelector("#message-list");
  if (state.view !== "chat" || !messageList) return render();
  const wasNearBottom = messageList.scrollTop + messageList.clientHeight >= messageList.scrollHeight - 80;
  const previousTop = messageList.scrollTop;
  messageList.innerHTML = chatMessagesHtml();
  messageList.scrollTop = wasNearBottom ? messageList.scrollHeight : previousTop;
  const headerAvatar = document.querySelector(".chat-header .maus-avatar");
  if (headerAvatar) {
    const bot = activeChatBot();
    const status = bot?.busy ? "busy" : "idle";
    headerAvatar.dataset.status = status;
    headerAvatar.dataset.motion = motionStateFor(bot, status);
  }
  hydrateAvatars();
}

function renderMessage(message, index) {
  const previous = state.messages[index - 1];
  const showDay = !previous || new Date(previous.at).toDateString() !== new Date(message.at).toDateString();
  const prefix = showDay ? `<div class="day-separator">${formatDay(message.at)}</div>` : "";
  if (message.kind === "options" && message.card) return prefix + renderApproval(message);
  if (message.kind === "activity") return prefix + renderActivity(message);
  if (message.kind === "attachment" && message.attachment) return prefix + renderAttachment(message);
  const mine = message.role === "user";
  const text = messageText(message);
  if (!text) return "";
  const body = mine ? escapeHtml(text).replaceAll("\n", "<br />") : renderMarkdown(text);
  return `${prefix}<article class="message-row ${mine ? "message-row--mine" : "message-row--bot"}">
    <div class="bubble"><span class="bubble-text">${body}</span></div>
  </article>`;
}

// Attachments Belmont sends: images show as a picture tile, everything else as a
// file card; both open the full-screen viewer. In demo mode the attachment carries
// its bytes inline (src / text); live ones stream through the session-scoped route.
function attachmentUrl(message, { download = false } = {}) {
  const att = message.attachment || {};
  if (att.src) return att.src;
  if (att.href) return att.href;
  const base = state.api?.baseUrl ?? "";
  return `${base}/api/threads/${encodeURIComponent(activeThreadId())}/attachments/${encodeURIComponent(att.ref || "")}${download ? "?download=1" : ""}`;
}
function attachmentKindLabel(kind) {
  return { image: "이미지", text: "문서", html: "웹 문서", pdf: "PDF", video: "동영상", link: "링크", file: "파일" }[kind] || "파일";
}
function isMarkdownName(name) { return /\.(md|markdown)$/iu.test(String(name || "")); }
function renderAttachment(message) {
  const att = message.attachment;
  const id = escapeHtml(message.id);
  if (att.kind === "image") {
    return `<article class="message-row message-row--bot"><figure class="bubble bubble--image"><img src="${escapeHtml(attachmentUrl(message))}" alt="${escapeHtml(att.alt || att.name || "")}" loading="lazy" decoding="async" data-action="open-attachment" data-message-id="${id}" /></figure></article>`;
  }
  if (att.kind === "link") {
    return `<article class="message-row message-row--bot"><a class="bubble file-card" href="${escapeHtml(att.href)}" target="_blank" rel="noopener"><span class="file-icon">${icon("link")}</span><span><strong>${escapeHtml(att.name)}</strong><small>링크</small></span></a></article>`;
  }
  return `<article class="message-row message-row--bot"><button type="button" class="bubble file-card" data-action="open-attachment" data-message-id="${id}"><span class="file-icon">${icon("task")}</span><span><strong>${escapeHtml(att.name)}</strong><small>${escapeHtml(attachmentKindLabel(att.kind))} · 탭해서 열기</small></span></button></article>`;
}

// ---- full-screen viewer (images zoom; documents read on a white page) ----
const viewerView = { node: null, scale: 1, tx: 0, ty: 0, lastTap: 0 };

function openAttachment(messageId) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message?.attachment) return;
  openViewer(message.attachment, { key: `message:${messageId}`, url: attachmentUrl(message), downloadUrl: attachmentUrl(message, { download: true }) });
}

// The viewer shows one attachment-shaped item: from a chat bubble or from the file
// browser. `back` restores the overlay to return to (the folder listing).
function openViewer(attachment, { key, url, downloadUrl, back = null }) {
  viewerView.scale = 1; viewerView.tx = 0; viewerView.ty = 0;
  state.overlay = { type: "viewer", key, attachment, url, downloadUrl, back, content: null, error: null };
  render();
  loadViewerContent(state.overlay);
}

async function loadViewerContent(overlay) {
  const att = overlay.attachment;
  if (att.kind !== "text") return;
  try {
    let text = att.text;
    if (typeof text !== "string") {
      const response = await fetch(overlay.url, { credentials: "include" });
      if (!response.ok) throw new Error(`문서를 불러오지 못했습니다 (${response.status})`);
      text = await response.text();
    }
    if (state.overlay?.type === "viewer" && state.overlay.key === overlay.key) { state.overlay = { ...state.overlay, content: text }; render(); }
  } catch (error) {
    if (state.overlay?.type === "viewer" && state.overlay.key === overlay.key) { state.overlay = { ...state.overlay, error: error.message }; render(); }
  }
}

function renderViewerOverlay() {
  const att = state.overlay.attachment;
  if (!att) return "";
  const url = state.overlay.url;
  let body;
  if (att.kind === "image") {
    body = `<div id="viewer-stage-slot" class="viewer-stage-slot"></div><p class="viewer-hint">두 손가락으로 확대 · 두 번 탭</p>`;
  } else if (att.kind === "text") {
    body = state.overlay.error
      ? `<div class="computer-placeholder cv-message">${icon("close")}<p>${escapeHtml(state.overlay.error)}</p></div>`
      : state.overlay.content == null
        ? `<div class="computer-placeholder viewer-loading"><span class="spinner"></span><p>불러오는 중…</p></div>`
        : `<div class="viewer-doc">${isMarkdownName(att.name) ? renderMarkdown(state.overlay.content) : `<pre class="viewer-pre">${escapeHtml(state.overlay.content)}</pre>`}</div>`;
  } else if (att.kind === "html") {
    body = `<iframe class="viewer-frame" sandbox="" src="${escapeHtml(url)}" title="${escapeHtml(att.name)}"></iframe>`;
  } else if (att.kind === "video") {
    body = `<video class="viewer-video" controls playsinline src="${escapeHtml(url)}"></video>`;
  } else {
    body = `<div class="computer-placeholder cv-message">${icon("task")}<p>${escapeHtml(att.name)}<br /><small>이 형식은 폰에서 바로 열 수 없어 외부 앱으로 엽니다.</small></p><a class="cv-retry" href="${escapeHtml(url)}" target="_blank" rel="noopener">외부 앱으로 열기</a></div>`;
  }
  const doc = att.kind === "text" || att.kind === "html";
  return `<section class="viewer-view ${doc ? "viewer-view--doc" : ""}" role="dialog" aria-modal="true" aria-label="${escapeHtml(att.name)}" data-sheet>
    <header class="cv-top">
      <button type="button" class="icon-button" data-action="close-overlay" aria-label="닫기">${icon("back")}</button>
      <div class="cv-title"><strong>${escapeHtml(att.name)}</strong><small>${escapeHtml(attachmentKindLabel(att.kind))}</small></div>
      ${att.href || !state.overlay.downloadUrl ? "" : `<a class="icon-button viewer-download" href="${escapeHtml(state.overlay.downloadUrl)}" download="${escapeHtml(att.name)}" aria-label="저장">${icon("share")}</a>`}
    </header>
    <div class="viewer-body">${body}</div>
  </section>`;
}

function syncViewerView() {
  if (state.overlay?.type !== "viewer") { if (viewerView.node) { viewerView.node.remove(); viewerView.node = null; } return; }
  const slot = document.querySelector("#viewer-stage-slot");
  if (!slot || !state.overlay.url) return;
  if (!viewerView.node || viewerView.node.dataset.key !== state.overlay.key) {
    viewerView.node?.remove();
    const node = document.createElement("div");
    node.className = "viewer-stage";
    node.dataset.key = state.overlay.key;
    node.innerHTML = `<img class="viewer-image" src="${escapeHtml(state.overlay.url)}" alt="" draggable="false" />`;
    bindViewerZoom(node);
    viewerView.node = node;
  }
  if (viewerView.node.parentElement !== slot) slot.appendChild(viewerView.node);
}

function bindViewerZoom(node) {
  const img = node.querySelector("img");
  const pointers = new Map();
  let start = null;
  const apply = () => { img.style.transform = `translate(${viewerView.tx}px, ${viewerView.ty}px) scale(${viewerView.scale})`; };
  const single = (point) => ({ x: point.x, y: point.y, tx: viewerView.tx, ty: viewerView.ty });
  node.addEventListener("pointerdown", (event) => {
    node.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      start = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale: viewerView.scale, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, tx: viewerView.tx, ty: viewerView.ty };
    } else if (pointers.size === 1) {
      start = single({ x: event.clientX, y: event.clientY });
      const now = Date.now();
      if (now - viewerView.lastTap < 300) {
        viewerView.scale = viewerView.scale > 1 ? 1 : 2.5;
        if (viewerView.scale === 1) { viewerView.tx = 0; viewerView.ty = 0; }
        apply();
      }
      viewerView.lastTap = now;
    }
  });
  node.addEventListener("pointermove", (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2 && start?.dist) {
      const [a, b] = [...pointers.values()];
      viewerView.scale = Math.min(6, Math.max(1, start.scale * Math.hypot(a.x - b.x, a.y - b.y) / start.dist));
      viewerView.tx = start.tx + (a.x + b.x) / 2 - start.cx;
      viewerView.ty = start.ty + (a.y + b.y) / 2 - start.cy;
      apply();
    } else if (pointers.size === 1 && start && !start.dist && viewerView.scale > 1) {
      viewerView.tx = start.tx + event.clientX - start.x;
      viewerView.ty = start.ty + event.clientY - start.y;
      apply();
    }
  });
  const end = (event) => {
    pointers.delete(event.pointerId);
    start = pointers.size === 1 ? single([...pointers.values()][0]) : null;
    if (viewerView.scale === 1) { viewerView.tx = 0; viewerView.ty = 0; apply(); }
  };
  node.addEventListener("pointerup", end);
  node.addEventListener("pointercancel", end);
}

// ---- file browser over Belmont's /workspace (read-only) ----
function openFiles(path = "") {
  state.overlay = { type: "files", path, listing: null, error: null };
  render();
  loadFiles(path);
}
async function loadFiles(path) {
  try {
    const listing = await state.api.files(state.manager.id, path);
    if (state.overlay?.type === "files" && state.overlay.path === path) { state.overlay = { ...state.overlay, listing }; render(); }
  } catch (error) {
    if (state.overlay?.type === "files" && state.overlay.path === path) { state.overlay = { ...state.overlay, error: error.message }; render(); }
  }
}
function formatBytes(size) {
  if (!Number.isFinite(size)) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10240 ? 1 : 0)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
function renderFilesOverlay() {
  const { path, listing, error } = state.overlay;
  const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  const rows = listing?.entries?.length
    ? listing.entries.map((entry) => entry.kind === "dir"
      ? `<button type="button" class="file-row" data-action="files-open" data-path="${escapeHtml(path ? `${path}/${entry.name}` : entry.name)}"><span class="file-icon file-icon--dir">${icon("folder")}</span><span><strong>${escapeHtml(entry.name)}</strong><small>폴더</small></span>${icon("chevron")}</button>`
      : `<button type="button" class="file-row" data-action="files-view" data-path="${escapeHtml(path ? `${path}/${entry.name}` : entry.name)}" data-index="${listing.entries.indexOf(entry)}"><span class="file-icon">${icon(entry.kind === "image" ? "image" : "file")}</span><span><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(attachmentKindLabel(entry.kind))}${entry.size != null ? ` · ${formatBytes(entry.size)}` : ""}${entry.mtime ? ` · ${formatDay(entry.mtime)}` : ""}</small></span></button>`).join("")
    : listing ? `<div class="computer-placeholder viewer-loading"><p>빈 폴더입니다.</p></div>` : "";
  const body = error
    ? `<div class="computer-placeholder cv-message">${icon("close")}<p>${escapeHtml(error)}</p><button type="button" class="cv-retry" data-action="files-open" data-path="${escapeHtml(path)}">다시 시도</button></div>`
    : listing ? `<div class="files-list">${rows}</div>` : `<div class="computer-placeholder viewer-loading"><span class="spinner"></span><p>불러오는 중…</p></div>`;
  return `<section class="viewer-view viewer-view--doc files-view" role="dialog" aria-modal="true" aria-label="Belmont의 파일" data-sheet>
    <header class="cv-top">
      <button type="button" class="icon-button" data-action="${path ? "files-open" : "close-overlay"}" data-path="${escapeHtml(parent)}" aria-label="${path ? "상위 폴더" : "닫기"}">${icon("back")}</button>
      <div class="cv-title"><strong>${escapeHtml(path ? path.slice(path.lastIndexOf("/") + 1) : (listing?.rootName || "Belmont"))}</strong><small>${escapeHtml(listing?.rootName || "Belmont")}${path ? `/${escapeHtml(path)}` : ""}</small></div>
      ${path ? `<button type="button" class="icon-button" data-action="close-overlay" aria-label="닫기">${icon("close")}</button>` : ""}
    </header>
    <div class="viewer-body">${body}</div>
  </section>`;
}
function openWorkspaceFile(path, index) {
  const entry = state.overlay?.listing?.entries?.[index];
  if (!entry || entry.kind === "dir") return;
  const back = { type: "files", path: state.overlay.path, listing: state.overlay.listing, error: null };
  const url = entry.src || state.api.fileUrl(state.manager.id, path);
  openViewer({ name: entry.name, kind: entry.kind, mime: entry.mime, ...(entry.text != null ? { text: entry.text } : {}) }, { key: `file:${path}`, url, downloadUrl: entry.src ? null : state.api.fileUrl(state.manager.id, path, { download: true }), back });
}

function renderActivity(message) {
  const done = message.tool?.ok === true;
  const failed = message.tool?.ok === false;
  return `<article class="activity-row" data-state="${done ? "done" : failed ? "failed" : "running"}">
    <span class="activity-mark">${done ? icon("check") : failed ? icon("close") : '<span class="spinner"></span>'}</span>
    <span><strong>${escapeHtml(message.tool?.name || "작업")}</strong><small>${escapeHtml(messageText(message) || "진행 중")}</small></span>
  </article>`;
}

function approvalCode(card) {
  return card.code ? `<pre class="approval-code">${escapeHtml(card.code)}</pre>` : "";
}

function renderApproval(message) {
  const card = message.card;
  if (state.readonlyChat) {
    return `<article class="approval-card approval-card--answered">
      <div class="approval-kicker">${icon("check")} Belmont가 관리하는 항목</div>
      <h2>${escapeHtml(card.title || "승인 요청")}</h2>
      <p>${escapeHtml(card.subtitle || "")}</p>
      ${approvalCode(card)}
      ${card.answered ? `<div class="decision-label">${escapeHtml(decisionLabel(card.answered))}</div>` : ""}
    </article>`;
  }
  if (card.answered) {
    return `<article class="approval-card approval-card--answered">
      <div class="approval-kicker">${icon("check")} Belmont 결정</div>
      <h2>${escapeHtml(card.title)}</h2>
      <p>${escapeHtml(card.subtitle)}</p>
      ${approvalCode(card)}
      <div class="decision-label">${escapeHtml(decisionLabel(card.answered))}</div>
    </article>`;
  }
  const isPermission = Boolean(card.tool);
  const options = Array.isArray(card.options) && card.options.length ? card.options : ["Allow", "Deny"];
  const actions = isPermission
    ? `<button class="approval-allow" type="button" data-action="choose-option" data-choice="Allow" data-message-id="${escapeHtml(message.id)}">허용</button>
       <button type="button" data-action="choose-option" data-choice="Deny" data-message-id="${escapeHtml(message.id)}">거절</button>`
    : options.map((choice, index) => `<button class="${index === 0 ? "approval-allow" : ""}" type="button" data-action="choose-option" data-choice="${escapeHtml(choice)}" data-message-id="${escapeHtml(message.id)}">${escapeHtml(choice)}</button>`).join("");
  return `<article class="approval-card" data-request-id="${escapeHtml(card.requestId)}">
    <div class="approval-kicker"><span class="waiting-hand">${icon("hand")}</span> Belmont가 확인을 기다립니다</div>
    <h2>${escapeHtml(card.title || "승인 필요")}</h2>
    <p>${escapeHtml(card.subtitle || "이 작업을 진행할까요?")}</p>
    ${approvalCode(card)}
    <div class="approval-actions">
      ${actions}
    </div>
    ${card.allowKey ? `<button class="always-allow" type="button" data-action="always-allow" data-message-id="${escapeHtml(message.id)}">이 범위는 항상 허용</button>` : ""}
  </article>`;
}


function renderOverlay() {
  if (state.overlay?.type === "scanner") return renderScannerOverlay();
  if (state.overlay?.type === "worker") return renderWorkerOverlay(state.overlay.workerId);
  if (state.overlay?.type === "settings") return renderSettingsOverlay();
  if (state.overlay?.type === "computer") return renderComputerOverlay();
  if (state.overlay?.type === "viewer") return renderViewerOverlay();
  if (state.overlay?.type === "files") return renderFilesOverlay();
  if (state.overlay?.type === "manager") return renderManagerOverlay();
  return renderMoreOverlay();
}

function renderScannerOverlay() {
  return `<section class="scanner-screen" role="dialog" aria-modal="true" aria-label="Scan QR Code" data-sheet>
    <header><button type="button" data-action="close-overlay">Cancel</button><strong>Scan QR Code</strong><span aria-hidden="true"></span></header>
    <div class="scanner-viewport">
      <video id="qr-video" playsinline muted aria-label="QR camera preview"></video>
      <span class="scanner-frame" aria-hidden="true"></span>
    </div>
    <div class="scanner-instruction">Point the camera at the QR code on your computer</div>
    <label class="scanner-file">${icon("qr")} QR 이미지 선택<input id="qr-file" type="file" accept="image/*" /></label>
  </section>`;
}

function sheet(title, body) {
  return `<div class="sheet-backdrop" data-action="close-overlay">
    <section class="bottom-sheet" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}" data-sheet>
      <div class="sheet-handle"></div>
      <header><h2>${escapeHtml(title)}</h2><button type="button" class="icon-button" data-action="close-overlay" aria-label="닫기">${icon("close")}</button></header>
      ${body}
    </section>
  </div>`;
}

function renderMoreOverlay() {
  return `<div class="sheet-backdrop plus-backdrop" data-action="close-overlay">
    <section class="plus-sheet glass-sheet" role="dialog" aria-modal="true" aria-label="Belmont actions" data-sheet>
      <div class="sheet-menu">
        <button type="button" data-action="attach"><span class="menu-icon">${icon("share")}</span><span><strong>사진·파일 첨부</strong><small>Belmont에게 파일을 보냅니다</small></span></button>
        <button type="button" data-action="new-task"><span class="menu-icon">${icon("plus")}</span><span><strong>New goal</strong><small>Write a new goal in this Belmont conversation</small></span></button>
        <button type="button" data-action="show-tasks"><span class="menu-icon">${icon("task")}</span><span><strong>Agents</strong><small>See current persistent agent status</small></span></button>
        <button type="button" data-action="files"><span class="menu-icon">${icon("folder")}</span><span><strong>Files</strong><small>Belmont 폴더 전체를 봅니다</small></span></button>
        <button type="button" data-action="computer"><span class="menu-icon">${icon("computer")}</span><span><strong>Computer status</strong><small>Belmont가 쓰는 컴퓨터 화면을 봅니다</small></span></button>
        <button type="button" data-action="share"><span class="menu-icon">${icon("share")}</span><span><strong>Share transcript</strong><small>This chat as a text file</small></span></button>
      </div>
    </section>
  </div>`;
}

// A bot's stored description can be its full operating prompt — machinery, not
// an introduction. Show a short line; tuck the raw text behind a disclosure.
function describeBot(bot, fallback) {
  const text = String(bot?.description ?? "").trim();
  const short = text && text.length <= 160 ? text : fallback;
  const full = text.length > 160
    ? `<details class="persona-spec"><summary>설명 전문 보기</summary><pre>${escapeHtml(text)}</pre></details>`
    : "";
  return { short, full };
}

function renderWorkerOverlay(workerId) {
  const worker = state.workers.find((entry) => entry.id === workerId);
  if (!worker) return "";
  const status = worker.taskStatus || (worker.busy ? "진행 중" : "대기");
  const described = describeBot(worker, "Belmont의 지시를 받아 일하는 작업 봇입니다.");
  return sheet(worker.name, `<div class="worker-detail">
    ${avatar(worker, "hero", worker.busy ? "busy" : status === "완료" ? "done" : "idle")}
    <p class="worker-role">${escapeHtml(worker.title)}</p>
    <h3>${escapeHtml(worker.taskSummary || described.short)}</h3>
    ${described.full}
    <dl><div><dt>상태</dt><dd>${escapeHtml(status)}</dd></div><div><dt>모바일 대화</dt><dd>읽기 전용</dd></div><div><dt>사용자 창구</dt><dd>Belmont</dd></div></dl>
    <button class="primary-button" type="button" data-action="worker-chat" data-worker-id="${escapeHtml(worker.id)}">대화 내역 보기</button>
    <p class="sheet-note">이 화면은 에이전트 실행 상태만 표시합니다. 결과 검토 완료 여부를 추정하지 않습니다.</p>
  </div>`);
}

function renderSettingsOverlay() {
  return sheet("연결 설정", `<div class="settings-list">
    <div><span>모드</span><strong>${state.connection?.mode === "demo" ? "데모" : "Gateway"}</strong></div>
    <div><span>컴퓨터</span><strong>${escapeHtml(state.connection?.serverName || "연결되지 않음")}</strong></div>
    <div><span>실시간 연결</span><strong>${escapeHtml(streamLabel(state.streamStatus))}</strong></div>
  </div>
  <button class="danger-button" type="button" data-action="disconnect">연결 초기화</button>`);
}

function renderComputerOverlay() {
  const computer = state.overlay?.computer;
  const conn = computerView.connection;
  const interactive = computerInteractive(computer);
  const status = computer?.error ? "오류"
    : !computer ? "여는 중"
    : conn === "connected" ? (computerView.control ? "직접 조작 중" : interactive ? "조작 가능" : "보기 전용")
    : conn === "failed" ? "연결 끊김"
    : "연결 중";
  const handoff = computer?.handoff?.instruction
    ? `<div class="cv-handoff">${icon("hand")}<span>${escapeHtml(computer.handoff.instruction)}</span><button type="button" data-action="computer-hand-back">다 했어요</button></div>`
    : "";
  const body = computer?.error
    ? `<div class="computer-placeholder cv-message">${icon("computer")}<p>${escapeHtml(computer.error)}</p><button type="button" class="cv-retry" data-action="computer-retry">다시 시도</button></div>`
    : `<div id="computer-stage-slot" class="cv-slot"></div>${conn !== "connected" ? `<div class="computer-placeholder cv-message cv-overlay"><span class="spinner"></span><p>${conn === "failed" ? "화면 연결이 끊겼습니다. 다시 연결하는 중…" : "Belmont의 화면을 여는 중…"}</p></div>` : ""}`;
  return `<section class="computer-view" role="dialog" aria-modal="true" aria-label="Belmont의 컴퓨터" data-sheet>
    <header class="cv-top">
      <button type="button" class="icon-button" data-action="close-overlay" aria-label="닫기">${icon("back")}</button>
      <div class="cv-title"><strong>Belmont의 컴퓨터</strong><small>${escapeHtml(status)}<span class="cv-fps"></span></small></div>
      <span class="cv-status ${conn === "connected" ? (interactive ? "is-live" : "is-view") : ""}" aria-hidden="true"></span>
    </header>
    ${handoff}
    <div class="cv-stage">${body}</div>
    <footer class="cv-bottom">
      <button type="button" class="${computerView.control ? "is-on" : ""}" data-action="computer-control" ${conn !== "connected" ? "disabled" : ""}>${computerView.control ? "보기만" : "조작하기"}</button>
      <button type="button" data-action="computer-zoom" ${conn !== "connected" ? "disabled" : ""}>${computerView.zoom === "fit" ? "1:1 크기" : "화면 맞춤"}</button>
      <button type="button" data-action="computer-keyboard" ${conn === "connected" && interactive ? "" : "disabled"}>${icon("keyboard")} 키보드</button>
      <button type="button" data-action="computer-reconnect">다시 연결</button>
      <input id="computer-key-input" class="sr-only cv-key-input" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="원격 키보드 입력" />
    </footer>
  </section>`;
}

// The live screen is a noVNC RFB client mounted on a node that survives re-renders:
// render() rebuilds the DOM, so the stage is created once and re-slotted each time.
// Only noVNC's core (core/rfb.js, proxied through the adapter) is used — none of its
// stock UI — so the phone gets our own bars, status and keyboard instead of a settings panel.
// Like the desktop app, the live screen accepts input whenever the user asks for it
// (`control`), not only when Belmont hands the box over. Default stays view-only so
// a stray touch never lands on a page Belmont is driving.
function computerInteractive(computer) { return Boolean(computer?.interactive) || computerView.control; }
const computerView = {
  stage: null, rfb: null, RFB: null, botId: null, control: false,
  mode: "auto", stream: null, streamSupport: null, encoder: null, fps: 0,
  connection: "idle", zoom: "fit", attempts: 0,
  pollTimer: null, reconnectTimer: null, composing: false
};

async function openComputerView() {
  const manager = state.manager;
  if (!manager) return;
  computerView.botId = manager.id;
  state.overlay = { type: "computer", computer: null };
  render();
  await refreshComputerStatus({ ensure: true });
  if (state.overlay?.type === "computer" && !computerView.pollTimer) {
    computerView.pollTimer = setInterval(() => { refreshComputerStatus({ ensure: false }); }, 3000);
  }
}

async function refreshComputerStatus({ ensure }) {
  const botId = computerView.botId;
  if (!botId || state.overlay?.type !== "computer") return;
  try {
    let status = await state.api.request(`/api/bots/${botId}/computer`);
    if (ensure && !status?.ready) {
      status = await state.api.request(`/api/bots/${botId}/computer/ensure`, { method: "POST", body: {} });
    }
    // The view may have been closed while the request was in flight: never resurrect it.
    if (state.overlay?.type !== "computer" || computerView.botId !== botId) return;
    const next = status?.viewerUrl ? status : { error: "컴퓨터 화면이 아직 준비되지 않았습니다. Belmont에게 작업을 시킨 뒤 다시 열어보세요." };
    const changed = JSON.stringify(state.overlay.computer) !== JSON.stringify(next);
    state.overlay = { type: "computer", computer: next };
    if (computerView.rfb) computerView.rfb.viewOnly = !computerInteractive(next);
    if (changed || !computerView.rfb) render();
  } catch (error) {
    if (state.overlay?.type === "computer" && !state.overlay.computer?.viewerUrl) { state.overlay = { type: "computer", computer: { error: error.message } }; render(); }
  }
}

function syncComputerView() {
  const open = state.overlay?.type === "computer";
  if (!open) { teardownComputerView(); return; }
  const slot = document.querySelector("#computer-stage-slot");
  const computer = state.overlay.computer;
  if (!slot || !computer?.viewerUrl) return;
  if (!computerView.stage) {
    computerView.stage = document.createElement("div");
    computerView.stage.className = "cv-rfb";
  }
  if (computerView.stage.parentElement !== slot) slot.appendChild(computerView.stage);
  if (computerView.rfb || computerView.stream || computerView.connection === "connecting") return;
  if (computerView.mode === "vnc") { connectComputerRfb(computer); return; }
  computerView.connection = "connecting";
  screenStreamSupported().then((supported) => {
    if (state.overlay?.type !== "computer" || computerView.rfb || computerView.stream) return;
    if (supported) connectScreenStream(computer);
    else { computerView.mode = "vnc"; computerView.connection = "idle"; connectComputerRfb(computer); }
  });
}

// ---- video path: H.264 access units over WebSocket, decoded with WebCodecs ----
async function screenStreamSupported() {
  if (computerView.streamSupport != null) return computerView.streamSupport;
  try {
    if (typeof VideoDecoder === "undefined" || typeof EncodedVideoChunk === "undefined") throw new Error("no WebCodecs");
    const probe = await VideoDecoder.isConfigSupported({ codec: "avc1.4D4028", optimizeForLatency: true });
    computerView.streamSupport = Boolean(probe?.supported);
  } catch { computerView.streamSupport = false; }
  return computerView.streamSupport;
}

function screenCodecFromKeyUnit(bytes) {
  // First SPS NAL after a start code → "avc1." + profile/constraints/level bytes.
  for (let i = 0; i + 4 < bytes.length; i += 1) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0) continue;
    const prefix = bytes[i + 2] === 1 ? 3 : bytes[i + 2] === 0 && bytes[i + 3] === 1 ? 4 : 0;
    if (!prefix) continue;
    const header = i + prefix;
    if ((bytes[header] & 0x1f) === 7 && header + 3 < bytes.length) {
      const hex = (value) => value.toString(16).padStart(2, "0").toUpperCase();
      return `avc1.${hex(bytes[header + 1])}${hex(bytes[header + 2])}${hex(bytes[header + 3])}`;
    }
    i = header - 1;
  }
  return null;
}

function connectScreenStream(computer) {
  const stage = computerView.stage;
  const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/bots/${computerView.botId}/computer/screen`;
  const socket = new WebSocket(wsUrl);
  socket.binaryType = "arraybuffer";
  const stream = { socket, decoder: null, canvas: null, ctx: null, width: 0, height: 0, frames: 0, seq: 0, gotKey: false, lastFrameAt: 0, fpsTimer: null, fpsCount: 0, pointers: new Map(), gesture: null };
  computerView.stream = stream;
  computerView.connection = "connecting";
  const fail = (reason) => {
    if (computerView.stream !== stream) return;
    teardownScreenStream();
    // No frames ever arrived: the video path is not available here, so fall back to VNC for this session.
    if (stream.frames === 0) { computerView.mode = "vnc"; computerView.connection = "idle"; if (state.overlay?.type === "computer") syncComputerView(); }
    else { computerView.connection = "failed"; render(); if (computerView.attempts < 6) { computerView.attempts += 1; computerView.reconnectTimer = setTimeout(() => { computerView.reconnectTimer = null; syncComputerView(); }, 1000 * computerView.attempts); } }
  };
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      let message; try { message = JSON.parse(event.data); } catch { return; }
      if (message.t === "info") {
        stream.width = message.width; stream.height = message.height; computerView.fps = message.fps;
        const canvas = document.createElement("canvas");
        canvas.width = message.width; canvas.height = message.height; canvas.className = "cv-video";
        stage.replaceChildren(canvas);
        stream.canvas = canvas; stream.ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
        bindScreenInput(stream);
        applyComputerZoom();
      } else if (message.t === "encoder") { computerView.encoder = message.encoder; }
      return;
    }
    const bytes = new Uint8Array(event.data);
    if (bytes.length < 2) return;
    const key = bytes[0] === 1;
    const data = bytes.subarray(1);
    if (!stream.decoder) {
      if (!key) return;
      const codec = screenCodecFromKeyUnit(data);
      if (!codec) return;
      stream.decoder = new VideoDecoder({
        output: (frame) => {
          if (stream.ctx) stream.ctx.drawImage(frame, 0, 0);
          frame.close();
          stream.frames += 1; stream.fpsCount += 1; stream.lastFrameAt = performance.now();
          if (stream.frames === 1) { computerView.connection = "connected"; computerView.attempts = 0; render(); }
        },
        error: (error) => { console.error("screen decoder", error); fail(error); },
      });
      // No hardware hint: phones pick their hardware decoder on their own, and forcing it fails where none exists.
      stream.decoder.configure({ codec, optimizeForLatency: true });
      stream.gotKey = true;
    }
    if (!stream.gotKey && !key) return;
    if (key) stream.gotKey = true;
    if (stream.decoder.state !== "configured") return;
    // Keep the decoder queue shallow: if the phone is behind, skip delta frames until the next key.
    if (stream.decoder.decodeQueueSize > 4 && !key) { stream.gotKey = false; return; }
    try {
      stream.decoder.decode(new EncodedVideoChunk({ type: key ? "key" : "delta", timestamp: stream.seq * Math.round(1e6 / (computerView.fps || 60)), data }));
      stream.seq += 1;
    } catch (error) { console.error("screen decode", error); }
  });
  socket.addEventListener("close", () => fail("closed"));
  socket.addEventListener("error", () => fail("error"));
  stream.fpsTimer = setInterval(() => {
    const fps = stream.fpsCount; stream.fpsCount = 0;
    const label = document.querySelector(".cv-fps");
    if (label) label.textContent = computerView.connection === "connected" ? ` · ${fps} fps ${computerView.encoder === "nvenc" ? "GPU" : "CPU"} 영상` : "";
    if (computerView.connection === "connected" && performance.now() - stream.lastFrameAt > 5000 && stream.frames > 0) { socket.close(); }
  }, 1000);
}

function teardownScreenStream() {
  const stream = computerView.stream;
  if (!stream) return;
  computerView.stream = null;
  clearInterval(stream.fpsTimer);
  try { stream.socket.onclose = null; stream.socket.close(); } catch {}
  try { stream.decoder?.close(); } catch {}
  if (stream.canvas?.parentElement) stream.canvas.remove();
}

function applyComputerZoom() {
  const stream = computerView.stream;
  if (!stream?.canvas || !computerView.stage) return;
  computerView.stage.classList.toggle("is-actual", computerView.zoom !== "fit");
}

// Touch on the video → pointer events on the box: tap = click, long press = right click,
// drag = press-move-release, two fingers = scroll. Sends only while interactive.
function bindScreenInput(stream) {
  const canvas = stream.canvas;
  const send = (payload) => { if (stream.socket.readyState === WebSocket.OPEN) stream.socket.send(JSON.stringify(payload)); };
  const toDisplay = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width * stream.width, y: (event.clientY - rect.top) / rect.height * stream.height };
  };
  const interactive = () => computerInteractive(state.overlay?.computer);
  canvas.addEventListener("pointerdown", (event) => {
    if (!interactive()) return;
    canvas.setPointerCapture(event.pointerId);
    stream.pointers.set(event.pointerId, toDisplay(event));
    if (stream.pointers.size === 1) {
      const point = toDisplay(event);
      stream.gesture = { start: point, last: point, startedAt: performance.now(), dragging: false, longPress: setTimeout(() => { if (stream.gesture && !stream.gesture.dragging) { stream.gesture.done = true; send({ t: "click", ...point, button: 3 }); navigator.vibrate?.(20); } }, 550) };
      send({ t: "move", ...point });
    } else if (stream.pointers.size === 2 && stream.gesture) {
      clearTimeout(stream.gesture.longPress);
      if (stream.gesture.dragging) send({ t: "up", ...stream.gesture.last, button: 1 });
      stream.gesture = { scroll: true, lastY: [...stream.pointers.values()].reduce((sum, p) => sum + p.y, 0) / 2, at: [...stream.pointers.values()][0] };
    }
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!stream.pointers.has(event.pointerId) || !stream.gesture) return;
    const point = toDisplay(event);
    stream.pointers.set(event.pointerId, point);
    if (stream.gesture.scroll) {
      const y = [...stream.pointers.values()].reduce((sum, p) => sum + p.y, 0) / stream.pointers.size;
      const dy = stream.gesture.lastY - y;
      if (Math.abs(dy) >= 40) { send({ t: "scroll", ...stream.gesture.at, dy }); stream.gesture.lastY = y; }
      return;
    }
    if (stream.gesture.done) return;
    const moved = Math.hypot(point.x - stream.gesture.start.x, point.y - stream.gesture.start.y);
    if (!stream.gesture.dragging && moved > 12) { stream.gesture.dragging = true; clearTimeout(stream.gesture.longPress); send({ t: "down", ...stream.gesture.start, button: 1 }); }
    if (stream.gesture.dragging) send({ t: "move", ...point });
    stream.gesture.last = point;
  });
  const finish = (event) => {
    if (!stream.pointers.has(event.pointerId)) return;
    stream.pointers.delete(event.pointerId);
    const gesture = stream.gesture;
    if (!gesture) return;
    if (gesture.scroll) { if (stream.pointers.size === 0) stream.gesture = null; return; }
    clearTimeout(gesture.longPress);
    if (gesture.dragging) send({ t: "up", ...gesture.last, button: 1 });
    else if (!gesture.done && performance.now() - gesture.startedAt < 500) send({ t: "click", ...gesture.start, button: 1 });
    stream.gesture = null;
  };
  canvas.addEventListener("pointerup", finish);
  canvas.addEventListener("pointercancel", finish);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
}


async function connectComputerRfb(computer) {
  computerView.connection = "connecting";
  try {
    if (!computerView.RFB) {
      const base = computer.viewerUrl.slice(0, computer.viewerUrl.indexOf("vnc.html"));
      const module = await import(`${base}core/rfb.js`);
      computerView.RFB = module.default;
    }
    if (state.overlay?.type !== "computer" || !computerView.stage) { computerView.connection = "idle"; return; }
    const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/bots/${computerView.botId}/computer/websockify`;
    const rfb = new computerView.RFB(computerView.stage, wsUrl, { shared: true, wsProtocols: ["binary"] });
    rfb.viewOnly = !computerInteractive(computer);
    rfb.scaleViewport = computerView.zoom === "fit";
    rfb.clipViewport = computerView.zoom !== "fit";
    rfb.dragViewport = computerView.zoom !== "fit";
    rfb.showDotCursor = true;
    rfb.background = "#000";
    rfb.addEventListener("connect", () => { computerView.connection = "connected"; computerView.attempts = 0; render(); });
    rfb.addEventListener("disconnect", () => {
      computerView.rfb = null;
      if (state.overlay?.type !== "computer") return;
      computerView.connection = "failed";
      render();
      if (computerView.attempts < 6) {
        computerView.attempts += 1;
        computerView.reconnectTimer = setTimeout(() => { computerView.reconnectTimer = null; syncComputerView(); }, 1500 * computerView.attempts);
      }
    });
    computerView.rfb = rfb;
  } catch (error) {
    computerView.connection = "failed";
    state.overlay = { type: "computer", computer: { error: `화면 모듈을 불러오지 못했습니다: ${error.message}` } };
    render();
  }
}

function teardownComputerView() {
  if (computerView.pollTimer) { clearInterval(computerView.pollTimer); computerView.pollTimer = null; }
  if (computerView.reconnectTimer) { clearTimeout(computerView.reconnectTimer); computerView.reconnectTimer = null; }
  if (computerView.rfb) { try { computerView.rfb.disconnect(); } catch {} computerView.rfb = null; }
  teardownScreenStream();
  if (computerView.stage) { computerView.stage.remove(); computerView.stage = null; }
  computerView.mode = "auto";
  computerView.connection = "idle";
  computerView.attempts = 0;
  computerView.control = false;
}

function setComputerZoom(zoom) {
  computerView.zoom = zoom;
  applyComputerZoom();
  const rfb = computerView.rfb;
  if (rfb) {
    rfb.scaleViewport = zoom === "fit";
    rfb.clipViewport = zoom !== "fit";
    rfb.dragViewport = zoom !== "fit";
  }
  render();
}

// X11 keysyms for the soft keyboard: Latin-1 maps 1:1, everything else is 0x01000000 + code point.
const KEYSYM = { Enter: 0xff0d, Backspace: 0xff08, Tab: 0xff09, Escape: 0xff1b, ArrowLeft: 0xff51, ArrowUp: 0xff52, ArrowRight: 0xff53, ArrowDown: 0xff54, Delete: 0xffff };
function sendComputerText(text) {
  if (computerView.stream) {
    if (computerInteractive(state.overlay?.computer) && computerView.stream.socket.readyState === WebSocket.OPEN) computerView.stream.socket.send(JSON.stringify({ t: "text", text }));
    return;
  }
  const rfb = computerView.rfb;
  if (!rfb || rfb.viewOnly) return;
  for (const char of text) {
    const cp = char.codePointAt(0);
    const keysym = cp < 0x100 ? cp : 0x01000000 + cp;
    rfb.sendKey(keysym, null, true);
    rfb.sendKey(keysym, null, false);
  }
}
function bindComputerKeyboard() {
  const input = document.querySelector("#computer-key-input");
  if (!input || input.dataset.bound) return;
  input.dataset.bound = "1";
  input.addEventListener("compositionstart", () => { computerView.composing = true; });
  input.addEventListener("compositionend", (event) => {
    computerView.composing = false;
    sendComputerText(event.data || input.value);
    input.value = "";
  });
  input.addEventListener("input", (event) => {
    if (computerView.composing) return;
    if (event.inputType === "deleteContentBackward") { sendComputerKey("Backspace"); input.value = ""; return; }
    if (input.value) { sendComputerText(input.value); input.value = ""; }
  });
  input.addEventListener("keydown", (event) => {
    if (computerView.composing) return;
    if (KEYSYM[event.key] == null) return;
    event.preventDefault();
    sendComputerKey(event.key);
  });
}
function sendComputerKey(key) {
  if (computerView.stream) {
    if (computerInteractive(state.overlay?.computer) && computerView.stream.socket.readyState === WebSocket.OPEN) computerView.stream.socket.send(JSON.stringify({ t: "key", key }));
    return;
  }
  if (computerView.rfb && !computerView.rfb.viewOnly) computerView.rfb.sendKey(KEYSYM[key], key);
}

function renderManagerOverlay() {
  const described = describeBot(state.manager, "목표를 이해하고 봇들에게 일을 나눠, 결과를 검토해 보고합니다.");
  return sheet("Belmont", `<div class="worker-detail manager-detail">
    ${avatar(state.manager, "hero", state.manager?.busy ? "busy" : "idle")}
    <p class="worker-role">${escapeHtml(state.manager?.title || "Chief of Staff")}</p>
    <h3>${escapeHtml(described.short)}</h3>
    <dl><div><dt>대화 권한</dt><dd>사용자 전용</dd></div><div><dt>작업 봇</dt><dd>${state.workers.length}개</dd></div><div><dt>결과 보고</dt><dd>Belmont 단일 창구</dd></div></dl>
    ${described.full}
  </div>`);
}

function streamLabel(status) {
  if (status === "connected") return "연결됨";
  if (status === "reconnecting") return "재연결 중";
  return "연결 안 됨";
}

function decisionLabel(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["allow", "allowed", "allow-once", "approved", "approve"].includes(normalized)) return "허용됨";
  if (["always", "always-allow"].includes(normalized)) return "항상 허용됨";
  if (["deny", "denied"].includes(normalized)) return "거절됨";
  if (["expired", "timeout", "timed-out"].includes(normalized)) return "시간 초과: 실행되지 않음";
  if (["cancelled", "canceled", "dismissed", "aborted"].includes(normalized)) return "취소됨";
  return value;
}

async function startDemo() {
  state.connection = { mode: "demo", serverName: "Belmont Demo" };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.connection));
  state.api = createMockApi();
  await enterApp();
}

async function pair(form) {
  const formData = new FormData(form);
  state.loading = true;
  state.notice = null;
  render();
  try {
    const baseUrl = normalizeBaseUrl(formData.get("baseUrl"));
    const result = await CompanionApi.pair({
      baseUrl,
      code: formData.get("code"),
      deviceName: formData.get("deviceName")
    });
    if (result?.session !== true) throw new Error("컴퓨터가 보호된 모바일 세션을 반환하지 않았습니다.");
    state.connection = { mode: "gateway", baseUrl, serverName: result.serverName || "Belmont computer" };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.connection));
    state.api = new CompanionApi({ baseUrl });
    await enterApp();
  } catch (error) {
    state.notice = `${error.message} 브라우저 Origin을 거부하는 기존 native companion에는 직접 연결할 수 없습니다.`;
    state.loading = false;
    render();
  }
}

async function enterApp() {
  state.loading = true;
  state.view = "home";
  render();
  try {
    await refreshFleet();
    state.view = "home";
    state.loading = false;
    startStream();
    render();
  } catch (error) {
    state.loading = false;
    state.notice = error.message;
    state.view = "pair";
    render();
  }
}

async function refreshFleet() {
  state.fleet = await state.api.fleet(50);
  state.manager = getManagerBot(state.fleet);
  state.workers = getWorkerBots(state.fleet, state.manager?.id);
  if (state.readonlyChat) {
    state.readonlyChat = state.workers.find((worker) => worker.id === state.readonlyChat.id) ?? state.readonlyChat;
  } else {
    state.messages = state.manager?.messages ?? [];
  }
}

async function openWorkerChat(workerId) {
  const worker = state.workers.find((entry) => entry.id === workerId);
  if (!worker) return;
  state.readonlyChat = worker;
  state.view = "chat";
  state.overlay = null;
  state.loading = true;
  state.messages = [];
  state.hasMore = false;
  state.nextBefore = null;
  render();
  try {
    const page = await state.api.messages(worker.threadId, { limit: 50 });
    state.messages = page.messages;
    state.hasMore = page.hasMore;
    state.nextBefore = page.before;
    applyThreadState(page);
    startChatPoll();
  } catch (error) {
    state.notice = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function openManager() {
  if (!state.manager) return;
  state.readonlyChat = null;
  state.view = "chat";
  state.overlay = null;
  state.loading = true;
  render();
  try {
    const page = await state.api.messages(state.manager.threadId, { limit: 50 });
    state.messages = page.messages;
    state.hasMore = page.hasMore;
    state.nextBefore = page.before;
    applyThreadState(page);
    state.manager.unread = false;
    startChatPoll();
  } catch (error) {
    state.notice = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function sendMessage() {
  const text = state.draft.trim();
  const attachments = state.pendingAttachments.map((att) => att.id);
  if ((!text && attachments.length === 0) || state.loading || !state.manager || state.readonlyChat) return;
  state.draft = "";
  state.loading = true;
  state.messages.push({ id: `optimistic-${Date.now()}`, role: "user", kind: "text", at: Date.now(), text });
  render();
  try {
    await state.api.send({ botId: state.manager.id, threadId: state.manager.threadId, text, attachments });
    state.pendingAttachments = [];
    const page = await state.api.messages(state.manager.threadId, { limit: 50 });
    state.messages = page.messages;
    state.hasMore = page.hasMore;
    state.nextBefore = page.before;
    applyThreadState(page);
    startReplyPoll(new Set(page.messages.filter((message) => message.role === "bot").map((message) => message.id)));
  } catch (error) {
    state.notice = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function decide(messageId, choice, remember = false) {
  const message = state.messages.find((entry) => entry.id === messageId);
  if (!message?.card || !state.manager) return;
  state.loading = true;
  render();
  try {
    const behavior = responseBehavior(choice, Boolean(message.card.tool));
    if (remember && behavior === "allow" && message.card.allowKey) {
      await state.api.alwaysAllow({ botId: state.manager.id, allowKey: message.card.allowKey });
    }
    await state.api.respond({
      threadId: state.manager.threadId,
      requestId: message.card.requestId,
      behavior,
      message: behavior === "answer" ? choice : null
    });
    const page = await state.api.messages(state.manager.threadId, { limit: 50 });
    state.messages = page.messages;
    state.hasMore = page.hasMore;
    state.nextBefore = page.before;
    applyThreadState(page);
    startReplyPoll(new Set(page.messages.filter((entry) => entry.role === "bot").map((entry) => entry.id)));
  } catch (error) {
    state.notice = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function loadEarlierMessages() {
  const threadId = activeThreadId();
  if (!threadId || !state.hasMore || !state.nextBefore || state.loading) return;
  const messageList = document.querySelector("#message-list");
  const scrollRestore = messageList ? { height: messageList.scrollHeight, top: messageList.scrollTop } : null;
  state.loading = true;
  try {
    const page = await state.api.messages(threadId, { before: state.nextBefore, limit: 50 });
    const seen = new Set(state.messages.map((message) => message.id));
    state.messages = [...page.messages.filter((message) => !seen.has(message.id)), ...state.messages];
    state.hasMore = page.hasMore;
    state.nextBefore = page.before;
    state.scrollRestore = scrollRestore;
  } catch (error) {
    state.notice = error.message;
  } finally {
    state.loading = false;
    render();
  }
}

// A busy Belmont turn appends transcript entries several times a second and each
// one arrives as an event. Refetching per event would multiply load on the host,
// so events are coalesced into one refresh per window (trailing events queue one more).
const STREAM_REFRESH_WINDOW_MS = 400;
let streamRefreshTimer = null;
let streamRefreshQueued = false;

function scheduleStreamRefresh() {
  if (streamRefreshTimer) {
    streamRefreshQueued = true;
    return;
  }
  streamRefreshTimer = setTimeout(async () => {
    do {
      streamRefreshQueued = false;
      await performStreamRefresh();
    } while (streamRefreshQueued);
    streamRefreshTimer = null;
  }, STREAM_REFRESH_WINDOW_MS);
}

async function performStreamRefresh() {
  try {
    const beforeKey = chatRenderKey();
    const threadId = activeThreadId();
    const pagePromise = state.view === "chat" && threadId
      ? state.api.messages(threadId, { limit: 50 })
      : null;
    const [page] = await Promise.all([pagePromise, refreshFleet()]);
    if (page && state.view === "chat") {
      state.messages = page.messages;
      state.hasMore = page.hasMore;
      state.nextBefore = page.before;
      applyThreadState(page);
    }
    // In the chat view only the list contents are swapped, and only when the
    // visible conversation actually changed — the scroll container never rebuilds.
    if (state.view !== "chat") render();
    else if (chatRenderKey() !== beforeKey) updateChatMessages();
  } catch {}
}

function chatRenderKey() {
  const last = state.messages.at(-1);
  const bot = activeChatBot();
  return `${state.messages.length}|${last?.id ?? ""}|${last?.card?.answered ?? ""}|${bot?.busy ? 1 : 0}|${bot?.composing ? 1 : 0}|${JSON.stringify(bot?.activity ?? null)}|${state.awaitingReply ? 1 : 0}`;
}

// The gateway commits a reply as one entry when the turn completes and emits no
// mid-turn patches, so there is nothing to stream. What CAN be tight is the tail:
// after a send, poll until the reply text lands. This also covers a phone whose
// SSE connection was silently killed (screen off, radio nap) — the answer still
// shows up within a poll tick instead of waiting for a reconnect.
const REPLY_POLL_INTERVAL_MS = 1_200;
const REPLY_POLL_MAX_MS = 90_000;
let replyPollTimer = null;

function stopReplyPoll() {
  if (replyPollTimer) clearTimeout(replyPollTimer);
  replyPollTimer = null;
}

// A delegation flow answers in stages minutes apart (ack → interim → final report),
// and the reply poll stops at the first answer. While the chat is open, a slow
// steady check keeps later stages visible even with the push channel dead.
// Measured cost per check: ~7ms, ~2.7KB.
const CHAT_POLL_INTERVAL_MS = 5_000;
let chatPollTimer = null;

function stopChatPoll() {
  if (chatPollTimer) clearTimeout(chatPollTimer);
  chatPollTimer = null;
}

function startChatPoll() {
  stopChatPoll();
  // Adaptive cadence: while the bot is running a turn, poll fast so follow-up
  // replies, the dots morph and pose changes land within ~1.5s; idle chats
  // drop back to the slow cadence.
  const tick = async () => {
    chatPollTimer = null;
    const threadId = activeThreadId();
    if (state.view !== "chat" || !threadId) return;
    if (!state.awaitingReply && !state.loading) {
      try {
        const beforeKey = chatRenderKey();
        const page = await state.api.messages(threadId, { limit: 50 });
        state.messages = page.messages;
        state.hasMore = page.hasMore;
        state.nextBefore = page.before;
        applyThreadState(page);
        if (chatRenderKey() !== beforeKey) updateChatMessages();
      } catch {}
    }
    chatPollTimer = setTimeout(tick, activeChatBot()?.busy || state.awaitingReply ? 1_500 : CHAT_POLL_INTERVAL_MS);
  };
  chatPollTimer = setTimeout(tick, 1_500);
}

function startReplyPoll(baselineIds) {
  stopReplyPoll();
  state.awaitingReply = true;
  const startedAt = Date.now();
  const settle = () => {
    if (!state.awaitingReply) return;
    state.awaitingReply = false;
    updateChatMessages();
  };
  const tick = async () => {
    replyPollTimer = null;
    if (state.view !== "chat" || state.readonlyChat || !state.manager || Date.now() - startedAt > REPLY_POLL_MAX_MS) return settle();
    let done = false;
    try {
      const beforeKey = chatRenderKey();
      const page = await state.api.messages(state.manager.threadId, { limit: 50 });
      state.messages = page.messages;
      state.hasMore = page.hasMore;
      state.nextBefore = page.before;
      applyThreadState(page);
      const gotReply = page.messages.some((message) => message.role === "bot"
        && (message.kind === "text" || message.kind === "options")
        && !baselineIds.has(message.id));
      // With live turn state the poll runs until the whole turn is over, so a
      // multi-part answer keeps flowing in; without it, the first reply ends it.
      done = page.state
        ? !page.state.busy && (gotReply || Date.now() - startedAt > 5_000)
        : gotReply;
      if (done) state.awaitingReply = false;
      if (done || chatRenderKey() !== beforeKey) updateChatMessages();
    } catch {}
    if (!done) replyPollTimer = setTimeout(tick, REPLY_POLL_INTERVAL_MS);
  };
  replyPollTimer = setTimeout(tick, REPLY_POLL_INTERVAL_MS);
}

function startStream() {
  state.stopStream?.();
  if (!state.api?.subscribe) return;
  state.stopStream = state.api.subscribe({
    onStatus(status) {
      state.streamStatus = status;
      document.querySelector(".connection-dot")?.setAttribute("data-state", status);
    },
    onEvent() {
      scheduleStreamRefresh();
    }
  });
}

async function disconnect() {
  state.stopStream?.();
  stopReplyPoll();
  stopChatPoll();
  if (streamRefreshTimer) clearTimeout(streamRefreshTimer);
  streamRefreshTimer = null;
  streamRefreshQueued = false;
  try { await state.api?.logout?.(); } catch {}
  localStorage.removeItem(STORAGE_KEY);
  Object.assign(state, {
    view: "pair",
    overlay: null,
    connection: null,
    api: null,
    fleet: { bots: [], groups: [] },
    manager: null,
    workers: [],
    messages: [],
    hasMore: false,
    nextBefore: null,
    scrollRestore: null,
    streamStatus: "closed",
    awaitingReply: false,
    readonlyChat: null,
    notice: null
  });
  render();
}

function showNotice(message) {
  state.notice = message;
  render();
  window.setTimeout(() => {
    if (state.notice === message) {
      state.notice = null;
      render();
    }
  }, 2_800);
}

async function startQrScanner() {
  if (state.scannerStarting || state.scannerStream || state.overlay?.type !== "scanner") return;
  const instruction = document.querySelector(".scanner-instruction");
  const video = document.querySelector("#qr-video");
  if (!video || !navigator.mediaDevices?.getUserMedia) {
    if (instruction) instruction.textContent = "Camera access is unavailable. Choose a QR image below.";
    return;
  }
  state.scannerStarting = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    if (state.overlay?.type !== "scanner") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    state.scannerStream = stream;
    video.srcObject = stream;
    await video.play();
    if (!("BarcodeDetector" in window)) {
      if (instruction) instruction.textContent = "Live QR recognition is unavailable. Choose a QR image below.";
      return;
    }
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const scan = async () => {
      if (state.overlay?.type !== "scanner" || !state.scannerStream) return;
      try {
        const codes = await detector.detect(video);
        if (codes[0]?.rawValue && acceptQrPayload(codes[0].rawValue)) return;
      } catch {}
      state.scannerFrame = requestAnimationFrame(scan);
    };
    state.scannerFrame = requestAnimationFrame(scan);
  } catch (error) {
    if (instruction) {
      instruction.textContent = error?.name === "NotAllowedError"
        ? "Camera access needed. Allow access or choose a QR image below."
        : "Scanner unavailable. Choose a QR image below.";
      instruction.classList.add("is-error");
    }
  } finally {
    state.scannerStarting = false;
  }
}

function stopQrScanner() {
  if (state.scannerFrame) cancelAnimationFrame(state.scannerFrame);
  state.scannerFrame = null;
  state.scannerStream?.getTracks().forEach((track) => track.stop());
  state.scannerStream = null;
  state.scannerStarting = false;
}

function acceptQrPayload(payload) {
  const invite = parsePairingInvite(payload);
  const instruction = document.querySelector(".scanner-instruction");
  if (!invite) {
    if (instruction) {
      instruction.textContent = "That isn't an OpenMausBot pairing QR code.";
      instruction.classList.add("is-error");
    }
    return false;
  }
  stopQrScanner();
  state.scannedInvite = invite;
  state.overlay = null;
  render();
  return true;
}

async function scanQrFile(file) {
  if (!file) return;
  const instruction = document.querySelector(".scanner-instruction");
  if (!("BarcodeDetector" in window)) {
    if (instruction) instruction.textContent = "이 브라우저는 QR 이미지 인식을 지원하지 않습니다.";
    return;
  }
  try {
    const bitmap = await createImageBitmap(file);
    const detector = new BarcodeDetector({ formats: ["qr_code"] });
    const codes = await detector.detect(bitmap);
    bitmap.close();
    if (!codes[0]?.rawValue || !acceptQrPayload(codes[0].rawValue)) throw new Error("invalid");
  } catch {
    if (instruction) {
      instruction.textContent = "유효한 OpenMausBot 페어링 QR을 찾지 못했습니다.";
      instruction.classList.add("is-error");
    }
  }
}

function toggleDictation() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) {
    showNotice("이 브라우저는 음성 입력을 지원하지 않습니다.");
    return;
  }
  if (state.dictationSession) {
    state.dictationSession.stop();
    return;
  }
  const recognition = new Recognition();
  recognition.lang = navigator.language || "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = false;
  const original = state.draft;
  recognition.onstart = () => {
    state.dictating = true;
    state.dictationSession = recognition;
    render();
  };
  recognition.onresult = (event) => {
    const spoken = Array.from(event.results).map((result) => result[0]?.transcript ?? "").join("");
    state.draft = `${original}${original && spoken ? " " : ""}${spoken}`;
    render();
    document.querySelector("#composer-input")?.focus();
  };
  recognition.onerror = (event) => showNotice(`음성 입력 오류: ${event.error || "unknown"}`);
  recognition.onend = () => {
    state.dictating = false;
    state.dictationSession = null;
    render();
    document.querySelector("#composer-input")?.focus();
  };
  recognition.start();
}

function exportTranscript() {
  const lines = state.messages.map((message) => `${message.role === "user" ? "나" : "Belmont"}: ${messageText(message)}`).filter((line) => !line.endsWith(": "));
  const blob = new Blob([lines.join("\n\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `belmont-${new Date().toISOString().slice(0, 10)}.txt`;
  anchor.click();
  URL.revokeObjectURL(url);
  state.overlay = null;
  render();
}

app.addEventListener("submit", (event) => {
  event.preventDefault();
  if (event.target.id === "pair-form") pair(event.target);
  if (event.target.id === "composer-form") sendMessage();
});

app.addEventListener("input", (event) => {
  if (event.target.id === "roster-search") {
    state.query = event.target.value;
    const query = state.query.trim().toLowerCase();
    document.querySelectorAll(".worker-row").forEach((row) => {
      row.hidden = query && !row.textContent.toLowerCase().includes(query);
    });
  }
  if (event.target.id === "composer-input") {
    state.draft = event.target.value;
    const button = document.querySelector(".send-button");
    if (button) button.disabled = !state.draft.trim() || state.loading;
    document.querySelector(".composer-field")?.classList.toggle("has-draft", Boolean(state.draft.trim()));
    event.target.style.height = "auto";
    event.target.style.height = `${Math.min(event.target.scrollHeight, 120)}px`;
  }
});

app.addEventListener("change", (event) => {
  if (event.target.id === "qr-file") scanQrFile(event.target.files?.[0]);
  if (event.target.id === "attach-input") attachFiles([...(event.target.files ?? [])]);
});

async function attachFiles(files) {
  if (!state.manager || typeof state.api?.uploadAttachment !== "function") {
    showNotice("이 연결에서는 첨부를 지원하지 않습니다.");
    return;
  }
  for (const file of files.slice(0, 4 - state.pendingAttachments.length)) {
    if (file.size > 15 * 1024 * 1024) { showNotice(`${file.name}: 15MB 이하만 첨부할 수 있습니다.`); continue; }
    showNotice(`${file.name} 올리는 중…`);
    try {
      const dataUrl = await new Promise((resolveRead, rejectRead) => {
        const reader = new FileReader();
        reader.onload = () => resolveRead(String(reader.result));
        reader.onerror = () => rejectRead(new Error("파일을 읽지 못했습니다."));
        reader.readAsDataURL(file);
      });
      const dataBase64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
      const uploaded = await state.api.uploadAttachment({ botId: state.manager.id, name: file.name, dataBase64 });
      if (!uploaded?.attachmentId) throw new Error("업로드가 거절되었습니다.");
      state.pendingAttachments.push({ id: uploaded.attachmentId, name: uploaded.name ?? file.name });
      render();
    } catch (error) {
      showNotice(`${file.name}: ${error.message}`);
    }
  }
}

app.addEventListener("keydown", (event) => {
  if (event.target.id === "composer-input" && event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});

app.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  if (target.matches(".sheet-backdrop") && event.target.closest("[data-sheet]")) return;
  const action = target.dataset.action;
  if (action === "demo") await startDemo();
  if (action === "scan-qr") { state.overlay = { type: "scanner" }; render(); }
  if (action === "scan-again") { state.scannedInvite = null; render(); }
  if (action === "pair-other") { state.pairOtherOpen = !state.pairOtherOpen; if (!state.pairOtherOpen) state.pairManualOpen = false; render(); }
  if (action === "pair-manual") { state.pairManualOpen = !state.pairManualOpen; render(); }
  if (action === "dictation") toggleDictation();
  if (action === "open-manager") await openManager();
  if (action === "back") { state.view = "home"; state.overlay = null; state.readonlyChat = null; stopChatPoll(); await refreshFleet(); render(); }
  if (action === "worker-chat") await openWorkerChat(target.dataset.workerId);
  if (action === "more") { state.overlay = state.overlay?.type === "more" ? null : { type: "more" }; render(); }
  if (action === "close-overlay") { stopQrScanner(); state.overlay = state.overlay?.back ?? null; render(); }
  if (action === "files") openFiles("");
  if (action === "files-open") openFiles(target.dataset.path || "");
  if (action === "files-view") openWorkspaceFile(target.dataset.path, Number(target.dataset.index));
  if (action === "worker-detail") { state.overlay = { type: "worker", workerId: target.dataset.workerId }; render(); }
  if (action === "settings") { state.overlay = { type: "settings" }; render(); }
  if (action === "computer") await openComputerView();
  if (action === "open-attachment") openAttachment(target.dataset.messageId);
  if (action === "computer-control") {
    computerView.control = !computerView.control;
    if (computerView.rfb) computerView.rfb.viewOnly = !computerInteractive(state.overlay?.computer);
    if (computerView.control && activeChatBot()?.busy) showNotice("Belmont가 작업 중입니다. 지금 조작하면 서로 겹칠 수 있어요.");
    render();
  }
  if (action === "computer-zoom") setComputerZoom(computerView.zoom === "fit" ? "actual" : "fit");
  if (action === "computer-keyboard") { const input = document.querySelector("#computer-key-input"); if (input) { input.focus({ preventScroll: true }); } }
  if (action === "computer-reconnect") { computerView.attempts = 0; computerView.mode = "auto"; if (computerView.stream) { teardownScreenStream(); computerView.connection = "idle"; syncComputerView(); } else if (computerView.rfb) { computerView.rfb.disconnect(); } else { syncComputerView(); } }
  if (action === "computer-retry") { state.overlay = { type: "computer", computer: null }; render(); await refreshComputerStatus({ ensure: true }); }
  if (action === "computer-hand-back") {
    try { await state.api.request(`/api/bots/${computerView.botId}/computer/hand-back`, { method: "POST", body: {} }); await refreshComputerStatus({ ensure: false }); showNotice("Belmont에게 화면을 돌려줬습니다."); }
    catch (error) { showNotice(error.message); }
  }
  if (action === "manager-info") { state.overlay = { type: "manager" }; render(); }
  if (action === "open-search") { state.searchOpen = true; render(); queueMicrotask(() => document.querySelector("#roster-search")?.focus()); }
  if (action === "close-search") { state.searchOpen = false; state.query = ""; render(); }
  if (action === "clear-search") { state.query = ""; render(); queueMicrotask(() => document.querySelector("#roster-search")?.focus()); }
  if (action === "updates") {
    if (pendingApproval(state.manager?.messages?.length ? state.manager.messages : state.messages)) await openManager();
    else showNotice("새로운 승인 요청은 없습니다.");
  }
  if (action === "choose-option") await decide(target.dataset.messageId, target.dataset.choice);
  if (action === "always-allow") await decide(target.dataset.messageId, "Allow", true);
  if (action === "disconnect") await disconnect();
  if (action === "share") exportTranscript();
  if (action === "new-task") { state.overlay = null; state.view = "chat"; state.draft = "새 목표: "; render(); document.querySelector("#composer-input")?.focus(); }
  if (action === "show-tasks") { state.overlay = null; state.view = "home"; render(); }
  if (action === "load-earlier") await loadEarlierMessages();
  if (action === "attach") { state.overlay = null; render(); document.querySelector("#attach-input")?.click(); }
  if (action === "remove-attachment") {
    state.pendingAttachments = state.pendingAttachments.filter((att) => att.id !== target.dataset.attachId);
    render();
  }
  if (action === "copy-code") {
    const code = target.closest(".md-code-wrap")?.querySelector(".md-code")?.textContent ?? "";
    try { await navigator.clipboard.writeText(code); showNotice("코드를 복사했습니다."); }
    catch { showNotice("복사하지 못했습니다."); }
  }
  if (action === "install" && state.installPrompt) {
    state.installPrompt.prompt();
    await state.installPrompt.userChoice;
    state.installPrompt = null;
    render();
  }
});

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  state.installPrompt = event;
  render();
});

// With interactive-widget=resizes-content the whole layout shrinks above the
// keyboard; keep the conversation pinned to its tail while composing.
window.addEventListener("resize", () => {
  if (state.view === "chat" && document.activeElement?.id === "composer-input") {
    const messageList = document.querySelector("#message-list");
    if (messageList) messageList.scrollTop = messageList.scrollHeight;
  }
});

// Desktop hover actions map to long-press on touch: hold a bubble to copy it.
let bubblePressTimer = null;
app.addEventListener("pointerdown", (event) => {
  const bubble = event.target.closest(".bubble");
  if (!bubble || event.target.closest("button")) return;
  bubblePressTimer = setTimeout(async () => {
    bubblePressTimer = null;
    try {
      await navigator.clipboard.writeText(bubble.textContent ?? "");
      if (navigator.vibrate) navigator.vibrate(8);
      showNotice("메시지를 복사했습니다.");
    } catch { showNotice("복사하지 못했습니다."); }
  }, 550);
});
for (const eventName of ["pointerup", "pointercancel", "pointermove"]) {
  app.addEventListener(eventName, (event) => {
    if (bubblePressTimer == null) return;
    if (eventName === "pointermove" && event.movementX === 0 && event.movementY === 0) return;
    clearTimeout(bubblePressTimer);
    bubblePressTimer = null;
  });
}

window.addEventListener("offline", () => showNotice("오프라인입니다. 앱 셸과 마지막 화면만 사용할 수 있습니다."));
window.addEventListener("online", () => showNotice("네트워크가 다시 연결됐습니다."));

async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
  startPersonaMotion();
  try {
    state.connection = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  if (!state.connection) {
    render();
    return;
  }
  if (state.connection.mode === "demo") state.api = createMockApi();
  else state.api = new CompanionApi({ baseUrl: state.connection.baseUrl });
  await enterApp();
}

boot();
