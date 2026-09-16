import { useEffect as useBrowserEffect, useState as useBrowserState } from 'react';
import { BrowserBotChat } from '../components/BrowserBotChat';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, fileToAttachment } from "../api";
import { useSendIntent } from "../use-send-intent";
import { useTranscript } from "../use-transcript";
import { BabyGrokAvatar } from "../components/BabyGrokAvatar";
import { AgentActivityGroup, MessageEntry } from "../components/MessageEntry";
import { EmptyState, ScreenError, ScreenSkeleton } from "../components/ScreenState";
import { Icon } from "../components/Icon";
import { nextRunObservation, runPresentation, type RunObservation } from "../entries";
import type { AppRoute, SurfaceId } from "../navigation";
import type { AgentActivityMessage, Bot, MobileMessage } from "../types";

function transcriptMarker(timestamp: number): string {
  if (!timestamp) return "대화";
  const value = new Date(timestamp);
  const today = new Date();
  const day = value.toDateString() === today.toDateString()
    ? "오늘"
    : new Intl.DateTimeFormat("ko", { month: "long", day: "numeric" }).format(value);
  return `${day} ${new Intl.DateTimeFormat("ko", { hour: "numeric", minute: "2-digit" }).format(value)}`;
}

type TranscriptRow =
  | { kind: "day"; id: string; timestampMs: number }
  | { kind: "agent-activity"; id: string; entries: AgentActivityMessage[] }
  | { kind: "message"; id: string; entry: Exclude<MobileMessage, AgentActivityMessage>; replyCount?: number; threadRootId?: string };

/** replyToId also links ordinary answers; only explicit branches fold under a loaded main root. */
function threadIndex(entries: MobileMessage[]): { counts: Map<string, number>; folded: Set<string> } {
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const counts = new Map<string, number>();
  const folded = new Set<string>();
  for (const entry of entries) {
    if (entry.branched !== true || !entry.replyToId) continue;
    let root: MobileMessage = entry;
    const seen = new Set<string>();
    while (root.branched === true && root.replyToId && byId.has(root.replyToId) && !seen.has(root.id)) {
      seen.add(root.id);
      root = byId.get(root.replyToId) ?? root;
    }
    if (root.branched === true) continue; // Missing root or cycle: preserve all reachable content inline.
    folded.add(entry.id);
    counts.set(root.id, (counts.get(root.id) ?? 0) + 1);
  }
  return { counts, folded };
}

export function transcriptRows(entries: MobileMessage[]): TranscriptRow[] {
  const rows: TranscriptRow[] = [];
  const threads = threadIndex(entries);
  let dayKey = "";
  for (const entry of entries) {
    if (threads.folded.has(entry.id)) continue;
    const nextDayKey = entry.timestampMs ? new Date(entry.timestampMs).toDateString() : "unknown";
    if (nextDayKey !== dayKey) {
      rows.push({ kind: "day", id: `day-${entry.id}`, timestampMs: entry.timestampMs });
      dayKey = nextDayKey;
    }
    if (entry.type === "agent-activity") {
      const previous = rows.at(-1);
      if (previous?.kind === "agent-activity") previous.entries.push(entry);
      else rows.push({ kind: "agent-activity", id: `activity-${entry.id}`, entries: [entry] });
      continue;
    }
    const replyCount = threads.counts.get(entry.id);
    rows.push({ kind: "message", id: entry.id, entry, ...(replyCount ? { replyCount } : {}), ...(!replyCount && entry.branched === true && entry.replyToId ? { threadRootId: entry.replyToId } : {}) });
  }
  return rows;
}

function OriginalChatScreen({ bot, eventRevision, members = [], onBack, onComputer, onBotChanged, onOpen }: {
  bot: Bot;
  eventRevision: number;
  /** Group members, so @mentions can pick a specific Bot; empty for a one-to-one chat. */
  members?: Bot[];
  onBack: () => void;
  onComputer: () => void;
  onBotChanged: () => void;
  onOpen: (name: SurfaceId, route?: Omit<AppRoute, "name">) => void;
}) {
  const fetchPage = useCallback((before: number | null, signal: AbortSignal) => api.messages(bot.id, before, signal), [bot.id]);
  const { entries, setEntries, nextBeforeSeq, loading, loadingOlder, error, refresh: load, loadOlder } = useTranscript(bot.id, fetchPage, eventRevision, bot.isRunning || bot.isComposing);
  const { draft, setDraft, attachments, setAttachments, ready: intentReady, recoveryError, pendingIntent: sendIntent, prepare, persist, accepted } = useSendIntent(bot.id, undefined, localStorage.getItem(`linear-chat-draft:${bot.id}`) ?? "");
  const mentionQuery = /@([\p{L}\p{N}_-]*)$/u.exec(draft)?.[1] ?? null;
  const mentionCandidates = useMemo(() => {
    if (mentionQuery == null) return [];
    const pool = members.length > 0 ? members : [bot];
    const needle = mentionQuery.toLowerCase();
    return pool.filter((candidate) => candidate.name.toLowerCase().startsWith(needle)).slice(0, 6);
  }, [members, bot, mentionQuery]);
  const [sending, setSending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sendError, setSendError] = useState("");
  const [dictating, setDictating] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const userAdjustedScroll = useRef(false);
  const userScrolling = useRef(false);
  const hasInitialScroll = useRef(false);
  const initialScrollTimer = useRef<number | null>(null);
  const sendTask = useRef<Promise<unknown> | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopLock = useRef(false);
  const mountGeneration = useRef(0);
  const lastSubmittedNonce = useRef<string | undefined>(undefined);
  const activeScope = useRef(bot.id);
  const runObservation = useRef<RunObservation | null>(null);
  activeScope.current = bot.id;
  useEffect(() => { ++mountGeneration.current; activeScope.current = bot.id; return () => { ++mountGeneration.current; activeScope.current = ""; }; }, [bot.id]);

  useEffect(() => {
    if (initialScrollTimer.current != null) window.clearTimeout(initialScrollTimer.current);
    initialScrollTimer.current = null;
    hasInitialScroll.current = false;
    stickToBottom.current = true;
    userAdjustedScroll.current = false;
  }, [bot.id]);
  useEffect(() => () => { if (initialScrollTimer.current != null) window.clearTimeout(initialScrollTimer.current); }, []);
  // Reading here should clear the desktop's badge: report the view whenever unread activity is on screen.
  const lastMarkedActivity = useRef<string>("");
  useEffect(() => {
    if (loading || !(bot.hasUnread || bot.unreadCount > 0)) return;
    const stamp = `${bot.id}:${bot.lastActivityAt}`;
    const report = () => {
      if (document.visibilityState !== "visible" || lastMarkedActivity.current === stamp) return;
      lastMarkedActivity.current = stamp;
      void api.markRead(bot.id).then(() => onBotChanged()).catch(() => { lastMarkedActivity.current = ""; });
    };
    report();
    document.addEventListener("visibilitychange", report);
    return () => document.removeEventListener("visibilitychange", report);
  }, [bot.id, bot.hasUnread, bot.unreadCount, bot.lastActivityAt, loading]);
  useEffect(() => {
    const node = transcript.current;
    if (node == null) return;
    const observer = new MutationObserver(() => {
      if (userAdjustedScroll.current && !stickToBottom.current) return;
      window.requestAnimationFrame(() => { node.scrollTop = node.scrollHeight; });
    });
    observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [bot.id]);
  useEffect(() => { localStorage.setItem(`linear-chat-draft:${bot.id}`, draft); }, [bot.id, draft]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) onBotChanged(); }, bot.isRunning || bot.isComposing ? 2500 : 6000);
    return () => window.clearInterval(timer);
  }, [bot.isRunning, bot.isComposing, onBotChanged]);
  useLayoutEffect(() => {
    if (loading || entries.length === 0) return;
    let cancelled = false;
    const initialPass = !hasInitialScroll.current;
    void document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!cancelled && (initialPass || !userAdjustedScroll.current || stickToBottom.current) && transcript.current != null) {
        transcript.current.scrollTop = transcript.current.scrollHeight;
      }
      if (initialPass && initialScrollTimer.current == null) initialScrollTimer.current = window.setTimeout(() => {
        if (transcript.current != null) transcript.current.scrollTop = transcript.current.scrollHeight;
        hasInitialScroll.current = true;
        initialScrollTimer.current = null;
      }, 500);
    })));
    return () => { cancelled = true; };
  }, [entries, loading]);

  async function addFiles(files: FileList | null) {
    if (files == null) return;
    setSendError("");
    try {
      const converted = await Promise.all([...files].slice(0, 8 - attachments.length).map(fileToAttachment));
      setAttachments((current) => [...current, ...converted].slice(0, 8));
    } catch {
      setSendError("첨부 파일을 읽지 못했습니다.");
    }
  }

  async function send() {
    const prompt = draft.trim();
    if (!intentReady || (!prompt && attachments.length === 0) || sendTask.current || stopLock.current) return;
    const scope = bot.id;
    const generation = mountGeneration.current;
    const current = () => activeScope.current === scope && mountGeneration.current === generation;
    const intent = prepare();
    const optimisticId = `optimistic-${intent.clientNonce}`;
    if (prompt) setEntries((current) => [...current, { id: optimisticId, type: "text", role: "user", content: prompt, timestampMs: intent.timestampMs, optimistic: true, clientNonce: intent.clientNonce }]);
    setSending(true);
    setSendError("");
    const task = (async () => {
      await persist(intent);
      if (!current()) return false;
      lastSubmittedNonce.current = intent.clientNonce;
      await api.send(scope, intent.text, intent.attachments, AbortSignal.timeout(30_000), undefined, intent.clientNonce);
      return true;
    })();
    sendTask.current = task;
    try {
      const sent = await task;
      if (!sent || !current()) return;
      // Remove the legacy draft before clearing the journal, so reload has no stale draft-only gap.
      localStorage.removeItem(`linear-chat-draft:${scope}`);
      await accepted(intent);
      if (!current()) return;
      setDraft("");
      setAttachments([]);
      void load();
      onBotChanged();
    } catch (caught) {
      if (!current()) return;
      setEntries((current) => current.filter((entry) => entry.id !== optimisticId));
      setSendError(caught instanceof Error ? caught.message : "메시지를 보내지 못했습니다. 같은 내용으로 다시 보내면 중복 없이 재시도합니다.");
    } finally {
      if (sendTask.current === task) sendTask.current = null;
      if (current()) setSending(false);
    }
  }

  async function stopWork() {
    if (stopLock.current) return;
    const scope = bot.id;
    const generation = mountGeneration.current;
    const current = () => activeScope.current === scope && mountGeneration.current === generation;
    const intent = sendIntent.current;
    const expectedClientNonce = sendTask.current ? intent?.clientNonce : undefined;
    const target = expectedClientNonce ? { expectedClientNonce }
      : bot.stopGuard ? { expectedStopGuard: bot.stopGuard }
      : lastSubmittedNonce.current || intent?.clientNonce ? { expectedClientNonce: lastSubmittedNonce.current ?? intent?.clientNonce }
      : null;
    if (!target) { setSendError("중단할 작업 상태를 확인하고 있습니다. 잠시 후 다시 시도하세요."); onBotChanged(); return; }
    stopLock.current = true;
    setStopping(true);
    setSendError("");
    try {
      await sendTask.current?.catch(() => undefined);
      // A remount invalidates this UI action before it can reach a newer run of the same bot.
      if (!current()) return;
      const result = await api.stop(scope, target);
      if (!current()) return;
      if (result.stale) {
        setSendError("작업이 변경됐습니다. 현재 상태를 확인한 뒤 다시 중단하세요.");
      } else if (intent && sendIntent.current?.clientNonce === intent.clientNonce && target.expectedClientNonce === intent.clientNonce) {
        localStorage.removeItem(`linear-chat-draft:${scope}`);
        await accepted(intent);
        if (!current()) return;
        setDraft(""); setAttachments([]);
      }
      await load();
      onBotChanged();
    } catch (caught) {
      if (current()) setSendError(caught instanceof Error ? caught.message : "작업을 중단하지 못했습니다.");
    } finally {
      stopLock.current = false;
      if (current()) setStopping(false);
    }
  }

  function dictate() {
    type Recognition = { lang: string; interimResults: boolean; start: () => void; stop: () => void; onresult: ((event: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
    const SpeechCtor = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
    if (SpeechCtor == null) { setSendError("이 브라우저는 음성 입력을 지원하지 않습니다."); return; }
    const recognition = new SpeechCtor();
    recognition.lang = "ko-KR";
    recognition.interimResults = false;
    recognition.onresult = (event) => setDraft((value) => `${value}${value ? " " : ""}${event.results[0]?.[0]?.transcript ?? ""}`);
    recognition.onend = () => setDictating(false);
    recognition.onerror = () => { setDictating(false); setSendError("음성을 인식하지 못했습니다."); };
    setDictating(true);
    recognition.start();
  }

  async function toggleHidden() {
    try {
      await api.hideBot(bot.id, !bot.isHidden);
      setMenuOpen(false);
      onBotChanged();
      if (!bot.isHidden) onBack();
    } catch (caught) {
      setSendError(caught instanceof Error ? caught.message : "Bot 상태를 바꾸지 못했습니다.");
    }
  }

  const canSend = useMemo(() => Boolean(draft.trim() || attachments.length > 0) && intentReady && !sending && !stopping, [attachments.length, draft, intentReady, sending, stopping]);
  const rows = useMemo(() => transcriptRows(entries), [entries]);
  const visibleEntries = useMemo(() => rows.flatMap<MobileMessage>((row) => row.kind === "message" ? [row.entry] : row.kind === "agent-activity" ? row.entries : []), [rows]);
  const runKey = bot.stopGuard ?? `revision:${bot.userIntentRevision ?? 0}`;
  runObservation.current = nextRunObservation(runObservation.current, visibleEntries, bot.id, runKey, bot.isRunning);
  const responseObservedInRun = runObservation.current.running
    && runObservation.current.latestAssistantId != null
    && runObservation.current.latestAssistantId !== runObservation.current.baselineAssistantId;
  const activityPresentation = runPresentation(visibleEntries, bot.isRunning, bot.isComposing, responseObservedInRun);
  const activityLabel = activityPresentation === "composing" ? "답장 작성 중" : activityPresentation === "post-response" ? "응답 후 처리 중" : "작업 중";

  return (
    <main className="chat-screen">
      <header className="chat-toolbar">
        <button aria-label="홈으로" className="circle-button" onClick={onBack} type="button"><Icon name="back" size={22} /></button>
        <button aria-label={`${bot.name}, ${activityPresentation !== "idle" ? activityLabel : bot.awaitingUserResponse ? "응답을 기다리는 중" : "대기 중"}`} className="chat-identity" onClick={() => onOpen("AgentProfileScreen", { botId: bot.id })} type="button"><BabyGrokAvatar color={bot.avatar.color} shape={bot.avatar.shape} size={38} state={bot.characterState ?? (bot.isRunning ? "working" : bot.awaitingUserResponse ? "listening" : "idle")} /><strong>{bot.name}</strong></button>
        <div className="chat-actions">
          <button aria-label="컴퓨터 보기" className="circle-button" onClick={onComputer} type="button"><Icon name="display" size={20} /></button>
          <button aria-expanded={menuOpen} aria-haspopup="menu" aria-label="대화 메뉴" className="circle-button" onClick={() => setMenuOpen((value) => !value)} type="button"><Icon name="more" size={20} /></button>
        </div>
        {menuOpen ? <div aria-label={`${bot.name} 메뉴`} className="chat-menu" role="menu">
          <p className="chat-menu-label"><strong>내 파일 시스템</strong><small>페어링된 내 기기 전용 · 읽기 전용</small></p>
          <button className="chat-menu-file" onClick={() => { setMenuOpen(false); onOpen("FileSystemScreen", { botId: bot.id, value: "windows:" }); }} role="menuitem" type="button"><Icon name="display" size={17} /><span><strong>Windows 전체</strong><small>연결된 Windows 드라이브</small></span><Icon name="chevronRight" size={13} /></button>
          <button className="chat-menu-file" onClick={() => { setMenuOpen(false); onOpen("FileSystemScreen", { botId: bot.id, value: "belmont:" }); }} role="menuitem" type="button"><Icon name="folder" size={17} /><span><strong>Belmont 폴더</strong><small>프로젝트 폴더 안에서만 탐색</small></span><Icon name="chevronRight" size={13} /></button>
          <div className="chat-menu-divider" />
          <button onClick={() => { setMenuOpen(false); onOpen("AgentProfileScreen", { botId: bot.id }); }} role="menuitem" type="button">Bot 프로필</button>
          <button onClick={() => { setMenuOpen(false); onOpen("SearchSheet", { botId: bot.id }); }} role="menuitem" type="button">대화 검색</button>
          <button onClick={() => { setMenuOpen(false); onOpen("UserFormSheet", { botId: bot.id }); }} role="menuitem" type="button">추가 정보 폼</button>
          <button onClick={() => void toggleHidden()} role="menuitem" type="button">{bot.isHidden ? "Bot 다시 표시" : "Bot 숨기기"}</button>
        </div> : null}
      </header>
      <section
        aria-live="polite"
        className="transcript"
        onPointerCancel={(event) => { const node = event.currentTarget; stickToBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64; userScrolling.current = false; }}
        onPointerDown={() => { userAdjustedScroll.current = true; userScrolling.current = true; }}
        onPointerUp={(event) => { const node = event.currentTarget; stickToBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64; userScrolling.current = false; }}
        onScroll={(event) => { if (userScrolling.current) { const node = event.currentTarget; stickToBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64; } }}
        onWheel={(event) => { userAdjustedScroll.current = true; userScrolling.current = true; const node = event.currentTarget; window.requestAnimationFrame(() => { stickToBottom.current = node.scrollHeight - node.clientHeight - node.scrollTop < 64; userScrolling.current = false; }); }}
        ref={transcript}
      >
        {loading ? <ScreenSkeleton rows={6} /> : null}
        {!loading && error ? <ScreenError message={error} retry={() => void load()} /> : null}
        {!loading ? (
          <>
            {nextBeforeSeq != null ? <button className="older-button" disabled={loadingOlder} onClick={() => void loadOlder()} type="button">{loadingOlder ? "불러오는 중" : "이전 대화 보기"}</button> : null}
            {entries.length === 0 ? <EmptyState detail={`${bot.name}에게 첫 메시지를 보내세요.`} title="새 대화" /> : rows.map((row) => row.kind === "day"
              ? <time className="day-marker" dateTime={new Date(row.timestampMs).toISOString()} key={row.id}>{transcriptMarker(row.timestampMs)}</time>
              : row.kind === "agent-activity"
                ? <AgentActivityGroup entries={row.entries} key={row.id} />
                : <MessageEntry bot={bot} entry={row.entry} key={row.id} onOpen={onOpen} onResolved={() => void load()} replyCount={row.replyCount} threadRootId={row.threadRootId} />)}
            {activityPresentation !== "idle" ? (
              <div aria-label={`${bot.name} ${activityLabel}`} className="message-line assistant working-row" role="status">
                <BabyGrokAvatar color={bot.avatar.color} shape={bot.avatar.shape} size={40} state={bot.characterState ?? (bot.isComposing ? "excited" : "working")} />
                {activityPresentation === "composing" ? <div className="typing"><i /><i /><i /></div> : <span className="working-label">{activityLabel}</span>}
              </div>
            ) : null}
            <div aria-hidden="true" className="transcript-end" />
          </>
        ) : null}
      </section>
      <footer className="composer-wrap">
        {mentionQuery != null && mentionCandidates.length > 0 ? <div className="mention-strip"><span>@ 멘션</span>{mentionCandidates.map((candidate) => <button key={candidate.id} onClick={() => setDraft((value) => value.replace(/@[\p{L}\p{N}_-]*$/u, `@${candidate.name} `))} type="button"><BabyGrokAvatar color={candidate.avatar.color} shape={candidate.avatar.shape} size={25} state="listening" />{candidate.name}</button>)}</div> : null}
        {attachments.length > 0 ? <div className="pending-files">{attachments.map((attachment) => <span key={attachment.id}><Icon name="paperclip" size={14} />{attachment.name}<button aria-label={`${attachment.name} 제거`} disabled={!intentReady || sending || stopping} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))} type="button"><Icon name="close" size={12} /></button></span>)}</div> : null}
        {recoveryError || sendError ? <p className="composer-error" role="alert">{recoveryError || sendError}</p> : null}
        <input accept="image/*,.pdf,.txt,.md,.csv,.json,.zip" hidden multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} ref={fileInput} type="file" />
        <div className="composer-row">
          <button aria-label="파일 첨부" disabled={!intentReady || sending || stopping} className="composer-attach" onClick={() => fileInput.current?.click()} type="button"><Icon name="plus" size={22} /></button>
          <div className="composer">
            <textarea disabled={!intentReady || sending || stopping} aria-label="메시지" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void send(); } }} placeholder={`${bot.name}에게 메시지`} rows={1} value={draft} />
            {!draft.trim() && attachments.length === 0 && !sending ? <button aria-label="음성 입력" aria-pressed={dictating} className={`composer-tool ${dictating ? "active" : ""}`} onClick={dictate} type="button"><Icon name="mic" size={19} /></button> : null}
            {sending || stopping || bot.isRunning || bot.isComposing ? <button aria-label="작업 중단" disabled={stopping} className="send-button cancel-send" onClick={() => void stopWork()} type="button"><Icon name="close" size={16} /></button> : null}{canSend ? <button aria-label="보내기" className="send-button" onClick={() => void send()} type="button"><Icon name="send" size={18} /></button> : null}
          </div>
        </div>
      </footer>
    </main>
  );
}

export function ChatScreen(props: Parameters<typeof OriginalChatScreen>[0]) {
  const nav = props as unknown as { bot?: Bot; onBack?: () => void; onComputer?: () => void };
  const [enabled,setEnabled] = useBrowserState<boolean | null>(null);
  useBrowserEffect(() => { let alive=true; if (!nav.bot?.id) { setEnabled(false); return; } setEnabled(null); fetch('/api/bots/' + encodeURIComponent(nav.bot.id) + '/browser/runtime', {credentials:'same-origin'}).then(r=>r.ok?r.json():{enabled:false}).then(v=>{if(alive)setEnabled(v.enabled===true);}).catch(()=>{if(alive)setEnabled(false);}); return()=>{alive=false;}; }, [nav.bot?.id]);
  if (enabled === null && nav.bot?.id) return <p role="status">브라우저 종류 확인 중…</p>;
  if (enabled && nav.bot?.id) return <BrowserBotChat bot={nav.bot} onBack={nav.onBack} onComputer={nav.onComputer} />;
  return <OriginalChatScreen {...props} />;
}
