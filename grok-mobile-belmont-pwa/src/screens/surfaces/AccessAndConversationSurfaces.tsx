import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, fileToAttachment } from "../../api";
import { BabyGrokAvatar } from "../../components/BabyGrokAvatar";
import { Icon } from "../../components/Icon";
import { MessageContent } from "../../components/MessageContent";
import { MessageEntry } from "../../components/MessageEntry";
import { useSendIntent } from "../../use-send-intent";
import { useTranscript } from "../../use-transcript";
import { enablePush, getPushState } from "../../push-client";
import { EmptyState, ScreenError, ScreenSkeleton } from "../../components/ScreenState";
import { ChoiceChips, InlineNotice, NavRow, PrimaryButton, Section, SurfacePage, TextField } from "../../components/SurfacePrimitives";
import type { MediaSearchResult, MessageSearchResult } from "../../types";
import type { SurfaceScreenProps } from "./types";

export function NotificationsAskScreen({ back, home }: SurfaceScreenProps) {
  const [push, setPush] = useState<Awaited<ReturnType<typeof getPushState>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void getPushState().then((value) => { if (active) setPush(value); }).catch((caught) => { if (active) setError(caught instanceof Error ? caught.message : "알림 설정을 확인하지 못했습니다."); });
    return () => { active = false; };
  }, []);
  const status = push?.permission;
  const enabled = Boolean(push?.subscribed && push.enabled);

  function remember() { try { localStorage.setItem("linear-notifications-prompted", "1"); } catch {} }
  async function enable() {
    remember();
    if (busy) return;
    setBusy(true);
    setError("");
    try { setPush(await enablePush()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "알림을 연결하지 못했습니다."); }
    finally { setBusy(false); }
  }

  return (
    <SurfacePage back={back} title="알림">
      <div className="centered-hero compact-hero">
        <span className="hero-icon"><Icon name="bell" size={31} /></span>
        <h1>Bot이 당신을 기다릴 때 알려드릴게요</h1>
        <p>작업 완료, 승인 요청, 추가 질문을 놓치지 않습니다.</p>
        {enabled ? <InlineNotice detail="이 기기의 푸시 알림 구독이 연결됐습니다." icon="check" title="알림이 켜졌습니다" /> : null}
        {status === "denied" ? <InlineNotice detail="브라우저 사이트 설정에서 다시 허용할 수 있습니다." title="알림이 차단됐습니다" /> : null}
        {status === "unsupported" ? <InlineNotice detail="현재 브라우저가 알림 권한을 제공하지 않습니다." title="알림을 사용할 수 없습니다" /> : null}
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <PrimaryButton disabled={enabled || busy} onClick={() => void enable()}>{busy ? "연결 중" : "알림 켜기"}</PrimaryButton>
        <button className="text-button" onClick={() => { remember(); home(); }} type="button">나중에</button>
      </div>
    </SurfacePage>
  );
}

export function TierNoAccessScreen({ back, open }: SurfaceScreenProps) {
  return (
    <SurfacePage back={back} title="이 기능을 사용할 수 없습니다">
      <div className="centered-hero compact-hero">
        <BabyGrokAvatar color="violet" shape="cloud" size={118} state="curious" />
        <h1>이 판에는 플랜 등급이 없습니다</h1>
        <p>기능 권한은 xAI 구독이 아니라 연결된 Codex 계정의 한도로 정해집니다.</p>
        <PrimaryButton onClick={() => open("UsageScreen")}>Codex 한도 보기</PrimaryButton>
      </div>
    </SurfacePage>
  );
}

export function WebNoAccessScreen({ back, home }: SurfaceScreenProps) {
  return (
    <SurfacePage back={back} title="연결 필요">
      <div className="centered-hero compact-hero">
        <BabyGrokAvatar color="gray" shape="pebble" size={118} state="searching" />
        <h1>데스크톱에 연결할 수 없습니다</h1>
        <p>Linear 데스크톱이 실행 중인지 확인하고 다시 시도하세요.</p>
        <PrimaryButton onClick={home}>다시 확인</PrimaryButton>
      </div>
    </SurfacePage>
  );
}

export function NewChatScreen({ back, bots, open, openChat }: SurfaceScreenProps) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => bots.filter((bot) => `${bot.name} ${bot.description}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [bots, query]);
  return (
    <SurfacePage action={<button aria-label="새 Bot" className="circle-button" onClick={() => open("NewAgentScreen")} type="button"><Icon name="plus" size={20} /></button>} back={back} subtitle="대화를 시작할 대상을 선택하세요" title="새 채팅">
      <label className="search-field surface-search"><Icon name="search" size={17} /><input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Bot 또는 그룹 검색" value={query} /></label>
      <div className="quick-actions">
        <button onClick={() => open("AgentPickerSheet", { value: "group" })} type="button"><Icon name="group" size={20} /><span><strong>새 그룹</strong><small>여러 Bot과 대화</small></span></button>
        <button onClick={() => open("NewAgentScreen")} type="button"><Icon name="bot" size={20} /><span><strong>새 Bot</strong><small>새 역할 만들기</small></span></button>
      </div>
      <Section title="Bot">
        {visible.map((item) => <button className="agent-pick-row" key={item.id} onClick={() => openChat(item.id)} type="button"><BabyGrokAvatar color={item.avatar.color} shape={item.avatar.shape} size={46} state={item.isRunning ? "working" : "idle"} /><span><strong>{item.name}</strong><small>{item.description || item.title}</small></span><Icon name="chevronRight" size={14} /></button>)}
      </Section>
    </SurfacePage>
  );
}

export function ThreadScreen({ back, bot, open, route, eventRevision, refreshBots }: SurfaceScreenProps) {
  const rootId = route.entryId ?? "";
  const scope = `${bot?.id ?? ""}:${rootId}`;
  const fetchPage = useCallback((_before: number | null, signal: AbortSignal) => bot && rootId ? api.thread(bot.id, rootId, signal) : Promise.resolve({ entries: [] }), [bot?.id, rootId]);
  const { entries, loading, error: loadError, refresh: load } = useTranscript(scope, fetchPage, eventRevision ?? 0, Boolean(bot?.isRunning || bot?.isComposing));
  const { draft, setDraft, attachments, setAttachments, ready: intentReady, recoveryError, pendingIntent: intentRef, prepare, persist, accepted } = useSendIntent(bot?.id ?? "", rootId);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const taskRef = useRef<Promise<unknown> | null>(null);
  const stopLock = useRef(false);
  const mountGeneration = useRef(0);
  const lastSubmittedNonce = useRef<string | undefined>(undefined);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  useEffect(() => { ++mountGeneration.current; activeScope.current = scope; return () => { ++mountGeneration.current; activeScope.current = ""; }; }, [scope]);

  async function sendReply() {
    if (!intentReady || bot == null || !rootId || (!draft.trim() && attachments.length === 0) || taskRef.current || stopLock.current) return;
    const generation = mountGeneration.current;
    const current = () => activeScope.current === scope && mountGeneration.current === generation;
    const intent = prepare();
    setSending(true);
    setError("");
    const task = (async () => {
      await persist(intent);
      if (!current()) return false;
      lastSubmittedNonce.current = intent.clientNonce;
      await api.send(bot.id, intent.text, intent.attachments, AbortSignal.timeout(30_000), rootId, intent.clientNonce);
      return true;
    })();
    taskRef.current = task;
    try {
      const sent = await task;
      if (!sent || !current()) return;
      await accepted(intent);
      if (!current()) return;
      setDraft("");
      setAttachments([]);
      await load();
      void refreshBots();
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : "답글을 보내지 못했습니다.");
    } finally {
      if (taskRef.current === task) taskRef.current = null;
      if (current()) setSending(false);
    }
  }

  async function stopWork() {
    if (!bot || stopLock.current) return;
    const generation = mountGeneration.current;
    const current = () => activeScope.current === scope && mountGeneration.current === generation;
    const intent = intentRef.current;
    const expectedClientNonce = taskRef.current ? intent?.clientNonce : undefined;
    const target = expectedClientNonce ? { expectedClientNonce }
      : bot.stopGuard ? { expectedStopGuard: bot.stopGuard }
      : lastSubmittedNonce.current || intent?.clientNonce ? { expectedClientNonce: lastSubmittedNonce.current ?? intent?.clientNonce }
      : null;
    if (!target) { setError("중단할 작업 상태를 확인하고 있습니다. 잠시 후 다시 시도하세요."); void refreshBots(); return; }
    stopLock.current = true;
    setStopping(true);
    setError("");
    try {
      await taskRef.current?.catch(() => undefined);
      if (!current()) return;
      const result = await api.stop(bot.id, target);
      if (!current()) return;
      if (result.stale) setError("작업이 변경됐습니다. 현재 상태를 확인한 뒤 다시 중단하세요.");
      else if (intent && intentRef.current?.clientNonce === intent.clientNonce && target.expectedClientNonce === intent.clientNonce) {
        await accepted(intent);
        if (!current()) return;
        setDraft(""); setAttachments([]);
      }
      await load();
      void refreshBots();
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : "작업을 중단하지 못했습니다.");
    } finally {
      stopLock.current = false;
      if (current()) setStopping(false);
    }
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    try {
      const converted = await Promise.all([...files].slice(0, 8 - attachments.length).map(fileToAttachment));
      if (activeScope.current === scope) setAttachments((current) => [...current, ...converted].slice(0, 8));
    } catch { if (activeScope.current === scope) setError("첨부 파일을 읽지 못했습니다."); }
  }

  const root = entries.find((entry) => entry.id === rootId);
  const replies = entries.filter((entry) => entry.id !== rootId);
  return (
    <SurfacePage back={back} subtitle={bot?.name ?? "Bot"} title="답글">
      <article className="thread-root"><strong>원본 메시지</strong><div>{root && bot ? <MessageEntry bot={bot} entry={root} onOpen={open} onResolved={() => void load()} /> : <MessageContent content={route.value || "원본 메시지를 찾을 수 없습니다."} />}</div></article>
      <div className="thread-line" />
      {loading ? <ScreenSkeleton rows={3} /> : null}
      {!loading && loadError ? <ScreenError message={loadError} retry={() => void load()} /> : null}
      {!loading && !loadError && replies.length === 0 ? <EmptyState detail="이 메시지에 아직 답글이 없습니다." title="답글 없음" /> : null}
      <div className="thread-replies">{bot ? replies.map((reply) => <MessageEntry bot={bot} entry={reply} key={reply.id} onOpen={open} onResolved={() => void load()} />) : null}</div>
      {bot?.isRunning || bot?.isComposing ? <div aria-label={`${bot.name} ${bot.isComposing ? "답장 작성 중" : "작업 중"}`} className="message-line assistant working-row" role="status"><BabyGrokAvatar color={bot.avatar.color} shape={bot.avatar.shape} size={30} state={bot.isComposing ? "excited" : "working"} /><span className="working-label">{bot.isComposing ? "답장 작성 중" : "작업 중"}</span></div> : null}
      {recoveryError || error ? <p className="composer-error" role="alert">{recoveryError || error}</p> : null}
      {attachments.length > 0 ? <div className="pending-files">{attachments.map((attachment) => <span key={attachment.id}>{attachment.name}<button aria-label={`${attachment.name} 제거`} disabled={!intentReady || sending || stopping} onClick={() => setAttachments((current) => current.filter((file) => file.id !== attachment.id))} type="button"><Icon name="close" size={12} /></button></span>)}</div> : null}
      <input accept="image/*,.pdf,.txt,.md,.csv,.json,.zip" hidden multiple onChange={(event) => { void addFiles(event.target.files); event.target.value = ""; }} ref={fileInput} type="file" />
      <div className="surface-composer thread-composer"><button aria-label="답글 파일 첨부" disabled={!intentReady || sending || stopping} onClick={() => fileInput.current?.click()} type="button"><Icon name="plus" size={17} /></button><textarea aria-label="답글" disabled={!intentReady || sending || stopping} onChange={(event) => setDraft(event.target.value)} placeholder="답글" value={draft} />{sending || stopping || bot?.isRunning || bot?.isComposing ? <button aria-label="작업 중단" disabled={stopping} onClick={() => void stopWork()} type="button"><Icon name="close" size={17} /></button> : null}<button aria-label="보내기" disabled={!intentReady || (!draft.trim() && attachments.length === 0) || sending || stopping || !rootId || !bot} onClick={() => void sendReply()} type="button"><Icon name="send" size={17} /></button></div>
      {root?.type === "text" || route.value ? <button className="surface-link" onClick={() => open("LongMessageSheet", { value: root?.type === "text" ? root.content : route.value })} type="button">원본 전체 보기</button> : null}
    </SurfacePage>
  );
}

export function HiddenChatsScreen({ back, bots, openChat }: SurfaceScreenProps) {
  const hidden = bots.filter((bot) => bot.isHidden);
  return (
    <SurfacePage back={back} title="숨긴 Bot">
      {hidden.length > 0 ? <Section>{hidden.map((item) => <button className="agent-pick-row" key={item.id} onClick={() => openChat(item.id)} type="button"><BabyGrokAvatar color={item.avatar.color} shape={item.avatar.shape} size={46} state="idle" /><span><strong>{item.name}</strong><small>{item.lastMessagePreview || "숨겨진 대화"}</small></span><Icon name="chevronRight" size={14} /></button>)}</Section> : <div className="centered-hero compact-hero"><BabyGrokAvatar color="gray" shape="cloud" size={94} state="idle" /><h1>숨긴 Bot이 없습니다</h1><p>대화 메뉴에서 Bot을 숨기면 이곳에 표시됩니다.</p></div>}
    </SurfacePage>
  );
}

export function SearchSheet({ back, bots, open, openChat }: SurfaceScreenProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("메시지");
  const [messages, setMessages] = useState<MessageSearchResult[]>([]);
  const [media, setMedia] = useState<MediaSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const normalized = query.trim();
    if (!normalized) { setMessages([]); setMedia([]); setError(""); return; }
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void Promise.all([api.searchMessages(normalized), api.searchMedia(normalized)])
        .then(([messageResult, mediaResult]) => { setMessages(messageResult.results); setMedia(mediaResult.results); })
        .catch((caught) => setError(caught instanceof Error ? caught.message : "검색하지 못했습니다."))
        .finally(() => setLoading(false));
    }, 220);
    return () => window.clearTimeout(timer);
  }, [query]);
  const botName = (id: string) => bots.find((item) => item.id === id)?.name ?? "Bot";
  async function findTranscriptEntry(agentId: string, entryId: string) {
    let beforeSeq: number | null = null;
    for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
      const page = await api.messages(agentId, beforeSeq);
      const match = page.entries.find((entry) => entry.id === entryId);
      if (match != null) return match;
      if (page.nextBeforeSeq == null || page.nextBeforeSeq === beforeSeq) return null;
      beforeSeq = page.nextBeforeSeq;
    }
    return null;
  }
  async function openMessageResult(item: MessageSearchResult) {
    setError("");
    try {
      const match = await findTranscriptEntry(item.agentId, item.entryId);
      open("LongMessageSheet", { botId: item.agentId, entryId: item.entryId, value: match?.type === "text" ? match.content : item.snippet });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "메시지를 열지 못했습니다.");
    }
  }
  async function openMediaResult(item: MediaSearchResult) {
    setError("");
    try {
      const match = await findTranscriptEntry(item.agentId, item.entryId);
      if (match?.type === "attachment") {
        open("AttachmentPreviewRoute", { botId: item.agentId, entryId: item.entryId, value: match.name, attachment: { agentId: item.agentId, entryId: item.entryId, name: match.name, path: match.path, byteSize: match.byteSize, kind: match.kind, mime: match.mime, width: match.width, height: match.height } });
        return;
      }
      openChat(item.agentId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "파일을 열지 못했습니다.");
    }
  }
  return (
    <SurfacePage back={back} title="검색">
      <label className="search-field surface-search"><Icon name="search" size={17} /><input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="메시지와 파일 검색" value={query} /></label>
      <ChoiceChips onChange={setTab} selected={tab} values={["메시지", "파일"]} />
      {loading ? <ScreenSkeleton rows={4} /> : null}
      {error ? <ScreenError message={error} retry={() => { setQuery((value) => `${value} `); window.setTimeout(() => setQuery((value) => value.trimEnd()), 0); }} /> : null}
      {!query.trim() ? <EmptyState detail="대화 내용과 첨부 파일 이름을 검색합니다." title="검색어를 입력하세요" /> : null}
      {!loading && !error && query.trim() && tab === "메시지" ? <Section title={`메시지 ${messages.length}개`}>{messages.map((item) => <button className="search-result" key={`${item.agentId}-${item.entryId}`} onClick={() => void openMessageResult(item)} type="button"><Icon name="feedback" size={18} /><span><strong>{botName(item.agentId)}</strong><small>{item.snippet}</small></span></button>)}</Section> : null}
      {!loading && !error && query.trim() && tab === "파일" ? <Section title={`파일 ${media.length}개`}>{media.map((item) => <button className="search-result" key={`${item.agentId}-${item.entryId}`} onClick={() => void openMediaResult(item)} type="button"><Icon name={item.kind === "image" ? "image" : "file"} size={18} /><span><strong>{item.fileName}</strong><small>{botName(item.agentId)} · {item.kind}</small></span></button>)}</Section> : null}
    </SurfacePage>
  );
}

export function MessageActionsSheet({ back, open, route }: SurfaceScreenProps) {
  const [copied, setCopied] = useState(false);
  return (
    <SurfacePage back={back} subtitle="선택한 메시지" title="메시지 작업">
      <Section>
        <NavRow icon="reply" onClick={() => open("ThreadScreen", { botId: route.botId, entryId: route.entryId, value: route.value })} title="답글" />
        <NavRow icon="copy" onClick={() => { void navigator.clipboard?.writeText(route.value || "선택한 메시지"); setCopied(true); }} title={copied ? "복사됨" : "복사"} />
        <NavRow icon="smile" onClick={() => open("EmojiPickerView", { botId: route.botId, entryId: route.entryId })} title="반응 추가" />
        <NavRow icon="eye" onClick={() => open("LongMessageSheet", { value: route.value })} title="전체 보기" />
        <NavRow destructive icon="report" onClick={() => open("MessageReportSheet", { entryId: route.entryId, value: route.value })} title="신고" />
      </Section>
    </SurfacePage>
  );
}

export function LongMessageSheet({ back, route }: SurfaceScreenProps) {
  return (
    <SurfacePage back={back} title="전체 메시지">
      <article className="long-message"><MessageContent content={route.value || "표시할 메시지 내용이 없습니다."} /></article>
    </SurfacePage>
  );
}

export function MessageReportSheet({ back, home, route, bot }: SurfaceScreenProps) {
  const [reason, setReason] = useState("잘못된 결과");
  const [detail, setDetail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  async function send() {
    if (status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await api.feedback({ kind: "report", category: reason, detail, ...(route.botId ?? bot?.id ? { botId: route.botId ?? bot?.id } : {}), ...(route.entryId ? { entryId: route.entryId } : {}) });
      try { const current = JSON.parse(localStorage.getItem("linear-message-reports") ?? "[]") as unknown[]; localStorage.setItem("linear-message-reports", JSON.stringify([...current, { reason, detail, createdAt: Date.now() }])); } catch {}
      setStatus("sent");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "신고를 보내지 못했습니다."); setStatus("idle"); }
  }
  if (status === "sent") return <SurfacePage back={home} title="신고 완료"><div className="centered-hero compact-hero"><span className="hero-icon"><Icon name="check" size={30} /></span><h1>Belmont 호스트에 기록했습니다</h1><p>메시지 id와 함께 sand-data/mobile-feedback.jsonl 에 남습니다.</p></div></SurfacePage>;
  return (
    <SurfacePage back={back} title="메시지 신고">
      <Section title="이유"><ChoiceChips onChange={setReason} selected={reason} values={["잘못된 결과", "위험한 내용", "관련 없음", "기타"]} /></Section>
      <TextField label="상세 설명" multiline onChange={setDetail} placeholder="어떤 문제가 있었는지 알려주세요" value={detail} />
      {error ? <InlineNotice detail={error} title="전송 실패" /> : null}
      <PrimaryButton disabled={status === "sending"} onClick={() => void send()}>{status === "sending" ? "보내는 중…" : "신고 보내기"}</PrimaryButton>
    </SurfacePage>
  );
}
