import { useRef, useState } from "react";
import { api } from "../api";
import { Icon } from "./Icon";
import { MessageContent } from "./MessageContent";
import type { AppRoute, SurfaceId } from "../navigation";
import type { AgentActivityMessage, Bot, MobileMessage } from "../types";

function formatTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("ko", { hour: "numeric", minute: "2-digit" }).format(new Date(timestamp));
}

export function AgentActivityGroup({ entries }: { entries: AgentActivityMessage[] }) {
  const names = [...new Set(entries.map((entry) => entry.agentName))];
  const hasError = entries.some((entry) => entry.isError);
  const label = entries.length > 1
    ? `${names.join(", ")} 작업 업데이트 ${entries.length}건`
    : entries[0]?.isError
      ? `${entries[0].agentName} 작업 오류`
      : entries[0]?.direction === "outgoing"
        ? `${entries[0].agentName}에게 작업 전달`
        : `${entries[0]?.agentName ?? "Bot"}에게서 결과 받음`;
  const jobs = [...new Set(entries.map((entry) => entry.jobId).filter(Boolean))];
  return (
    <details className={`agent-activity ${hasError ? "has-error" : ""}`}>
      <summary>
        <span className="agent-activity-icon"><Icon name={hasError ? "warning" : "bot"} size={16} /></span>
        <span><strong>{label}</strong><small>{jobs.length > 0 ? `작업 ${jobs.join(", ")}` : "Bot 간 내부 메시지"}</small></span>
        <Icon className="agent-activity-chevron" name="chevronRight" size={13} />
      </summary>
      <div className="agent-activity-detail">
        {entries.map((entry) => <article key={entry.id}><small>{entry.direction === "outgoing" ? "전달" : "수신"} · {formatTime(entry.timestampMs)}</small><pre>{entry.content}</pre></article>)}
      </div>
    </details>
  );
}

function ApprovalCard({ entry, botId, onResolved }: { entry: Extract<MobileMessage, { type: "approval" | "local-permission" }>; botId: string; onResolved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = entry.status === "pending";

  async function resolve(resolution: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api.resolveApproval(botId, entry.id, { kind: entry.type, requestId: entry.requestId, resolution });
      onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "응답을 전송하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  const local = entry.type === "local-permission";
  return (
    <article className="action-card">
      <span className="action-icon"><Icon name={local ? "display" : "sparkle"} size={20} /></span>
      <div className="action-copy">
        <small>{local ? "컴퓨터 권한" : "작업 승인"}</small>
        <strong>{local ? "로컬 컴퓨터에서 명령을 실행할까요?" : entry.summary}</strong>
        {local ? <p><b>{entry.action || "실행"}</b>{entry.target ? ` ${entry.target}` : ""}</p> : null}
        {!local && entry.reason ? <p>{entry.reason}</p> : null}
        {!local && entry.command ? <code>{entry.command}</code> : null}
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        {pending ? (
          <div className="action-buttons">
            {local ? (
              <>
                <button disabled={busy} onClick={() => void resolve("allow-once")} type="button">한 번 허용</button>
                <button disabled={busy} onClick={() => void resolve("always")} type="button">항상 허용</button>
                <button className="quiet" disabled={busy} onClick={() => void resolve("deny")} type="button">거부</button>
              </>
            ) : (
              <>
                <button disabled={busy} onClick={() => void resolve("approved")} type="button">승인</button>
                <button className="quiet" disabled={busy} onClick={() => void resolve("denied")} type="button">거부</button>
              </>
            )}
          </div>
        ) : <span className="resolved-label"><Icon name="check" size={14} /> {entry.status}</span>}
      </div>
    </article>
  );
}

function WidgetCard({ entry, botId, onResolved }: { entry: Extract<MobileMessage, { type: "widget" }>; botId: string; onResolved: () => void }) {
  const [busyValue, setBusyValue] = useState("");
  // Shown as answered the moment the tap is accepted; the refetched entry carries the same value.
  const [localAnswer, setLocalAnswer] = useState("");
  const [error, setError] = useState("");
  const answered = entry.answered ?? (localAnswer || null);
  const answeredLabel = answered ? (entry.options.find((option) => option.value === answered)?.label ?? answered) : null;

  async function answer(value: string) {
    if (busyValue || answered) return;
    setBusyValue(value);
    setError("");
    try {
      await api.answerWidget(botId, entry.id, value);
      setLocalAnswer(value);
      onResolved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "선택을 전송하지 못했습니다.");
    } finally {
      setBusyValue("");
    }
  }

  return (
    <article className={answered ? "action-card widget-card widget-card--answered" : "action-card widget-card"}>
      <span className="action-icon"><Icon name="sparkle" size={20} /></span>
      <div className="action-copy">
        <small>{answered ? "답했습니다" : "선택이 필요합니다"}</small>
        <strong>{entry.prompt}</strong>
        {error ? <p className="inline-error" role="alert">{error}</p> : null}
        {answered ? <span className="resolved-label">선택: {answeredLabel}</span>
          : !entry.skipped ? <div className="widget-options">{entry.options.map((option) => <button disabled={Boolean(busyValue)} key={option.value} onClick={() => void answer(option.value)} type="button">{busyValue === option.value ? "전송 중" : option.label}</button>)}</div>
          : <span className="resolved-label">건너뜀</span>}
      </div>
    </article>
  );
}

export function MessageEntry({ entry, bot, onResolved, onOpen, replyCount, threadRootId }: { entry: MobileMessage; bot: Bot; onResolved: () => void; onOpen: (name: SurfaceId, route?: Omit<AppRoute, "name">) => void; replyCount?: number; threadRootId?: string }) {
  const gesture = useRef({ startX: 0, swiped: false });
  if (entry.type === "agent-activity") return <AgentActivityGroup entries={[entry]} />;
  if (entry.type === "approval" || entry.type === "local-permission") return <ApprovalCard botId={bot.id} entry={entry} onResolved={onResolved} />;
  if (entry.type === "widget") return <WidgetCard botId={bot.id} entry={entry} onResolved={onResolved} />;
  if (entry.type === "attachment") {
    const isDocument = ["pdf", "markdown", "document", "text", "table", "json"].includes(entry.kind);
    const detail = entry.path.startsWith("http")
      ? new URL(entry.path).hostname
      : entry.byteSize > 0
        ? `${Math.max(1, Math.round(entry.byteSize / 1024))} KB · ${entry.kind.toUpperCase()}`
        : entry.kind.toUpperCase();
    return <div className={`message-line ${entry.role}`}><button className={`attachment-bubble ${isDocument ? "document-attachment" : ""}`} onClick={() => onOpen("AttachmentPreviewRoute", { botId: bot.id, entryId: entry.id, value: entry.name, attachment: { agentId: entry.agentId, entryId: entry.id, name: entry.name, path: entry.path, byteSize: entry.byteSize, kind: entry.kind, mime: entry.mime, width: entry.width, height: entry.height } })} type="button"><span className="attachment-kind-icon"><Icon name={entry.kind === "image" ? "image" : isDocument ? "file" : "paperclip"} size={18} /></span><span><strong>{entry.name}</strong><small>{detail}</small></span></button></div>;
  }
  const textEntry = entry;
  function openActions(target: EventTarget | null) {
    if (target instanceof Element && target.closest("a")) return;
    if (!gesture.current.swiped) onOpen("MessageActionsSheet", { botId: bot.id, entryId: textEntry.id, value: textEntry.content });
  }
  return (
    <div className={`message-line ${textEntry.role}`}>
      <div className="message-stack">
        <div aria-label="메시지 작업 열기" className={`message-bubble ${textEntry.optimistic ? "optimistic" : ""}`} onClick={(event) => openActions(event.target)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") openActions(event.target); }} onPointerDown={(event) => { gesture.current = { startX: event.clientX, swiped: false }; }} onPointerUp={(event) => { if (event.clientX - gesture.current.startX > 56) { gesture.current.swiped = true; onOpen("ThreadScreen", { botId: bot.id, entryId: textEntry.id, value: textEntry.content }); window.setTimeout(() => { gesture.current.swiped = false; }, 0); } }} role="button" tabIndex={0} title={textEntry.optimistic ? "전송 중" : textEntry.isStreaming ? "작성 중" : formatTime(textEntry.timestampMs)}><MessageContent content={textEntry.content} /></div>
        {textEntry.reactions?.length ? <div className="reaction-pills">{textEntry.reactions.map((reaction, index) => <span key={`${reaction.emoji}-${index}`}>{reaction.emoji}</span>)}</div> : null}
        {replyCount ? <button className="thread-pill" onClick={() => onOpen("ThreadScreen", { botId: bot.id, entryId: textEntry.id, value: textEntry.content })} type="button"><Icon name="reply" size={13} /> 답글 {replyCount}개</button> : null}
        {!replyCount && threadRootId ? <button className="thread-pill" onClick={() => onOpen("ThreadScreen", { botId: bot.id, entryId: threadRootId, value: "" })} type="button"><Icon name="reply" size={13} /> 스레드 보기</button> : null}
      </div>
    </div>
  );
}
