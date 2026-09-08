import { useMemo } from "react";
import { BabyGrokAvatar } from "../components/BabyGrokAvatar";
import { EmptyState, ScreenError, ScreenSkeleton } from "../components/ScreenState";
import { Icon } from "../components/Icon";
import type { AppRoute, SurfaceId } from "../navigation";
import type { Bot } from "../types";

function relativeTime(timestamp: number): string {
  if (!timestamp) return "";
  const delta = Date.now() - timestamp;
  if (delta < 60_000) return "방금";
  if (delta < 3_600_000) return `${Math.max(1, Math.floor(delta / 60_000))}분`;
  const date = new Date(timestamp);
  if (date.toDateString() === new Date().toDateString()) return new Intl.DateTimeFormat("ko", { hour: "numeric", minute: "2-digit" }).format(date);
  if (delta < 7 * 86_400_000) return new Intl.DateTimeFormat("ko", { weekday: "short" }).format(date);
  return new Intl.DateTimeFormat("ko", { month: "numeric", day: "numeric" }).format(date);
}

export function HomeScreen({ bots, loading, error, onRetry, onOpenChat, onOpenSettings, onOpenWindows, onCreateBot, onOpen }: {
  bots: Bot[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpenChat: (bot: Bot) => void;
  onOpenSettings: () => void;
  onOpenWindows: () => void;
  onCreateBot: () => void;
  onOpen: (name: SurfaceId, route?: Omit<AppRoute, "name">) => void;
}) {
  const manager = bots.find((bot) => bot.isManager) ?? bots[0];
  const pinned = useMemo(() => {
    const selected = bots.filter((bot) => bot.isPinned && !bot.isHidden).slice(0, 3);
    for (const bot of bots) {
      if (selected.length >= 3) break;
      if (!bot.isHidden && !selected.some((item) => item.id === bot.id)) selected.push(bot);
    }
    return selected;
  }, [bots]);
  const visible = useMemo(() => bots.filter((bot) => !bot.isHidden && !pinned.some((item) => item.id === bot.id)), [bots, pinned]);

  return (
    <main className="app-screen home-screen">
      <header className="home-toolbar">
        <button aria-label="설정 열기" className="profile-button" onClick={onOpenSettings} type="button">
          {manager ? <BabyGrokAvatar color={manager.avatar.color} shape={manager.avatar.shape} size={50} state={manager.isRunning ? "working" : manager.awaitingUserResponse ? "listening" : "idle"} /> : <Icon name="person" size={24} />}
        </button>
        <div className="toolbar-actions">
          <button aria-label="Windows 화면 열기" className="circle-button windows-stream-button" onClick={onOpenWindows} title="Windows 화면" type="button"><Icon name="display" size={21} /></button>
          <button aria-label="검색" className="circle-button" onClick={() => onOpen("SearchSheet")} type="button"><Icon name="search" size={22} /></button>
          <button aria-label="새 채팅" className="circle-button" onClick={() => onOpen("NewChatScreen")} type="button"><Icon name="plus" size={23} /></button>
        </div>
      </header>
      {loading ? <ScreenSkeleton rows={7} /> : null}
      {!loading && error ? <ScreenError message={error} retry={onRetry} /> : null}
      {!loading && !error ? (
        <>
          {pinned.length > 0 ? (
            <section aria-label="고정된 Bot" className="pinned-grid">
              {pinned.map((bot) => (
                <button className="pinned-agent" key={bot.id} onClick={() => onOpenChat(bot)} type="button">
                  <span className="avatar-state-wrap">
                    <BabyGrokAvatar color={bot.avatar.color} label={bot.name} shape={bot.avatar.shape} size={104} state={bot.isRunning ? "working" : bot.awaitingUserResponse ? "listening" : "idle"} />
                    {bot.isRunning ? <i className="semantic-status running" title="작업 중" /> : bot.awaitingUserResponse ? <i className="semantic-status waiting" title="응답 대기" /> : null}
                  </span>
                  <span>{bot.name}</span>
                </button>
              ))}
            </section>
          ) : null}
          <section aria-label="Bot 대화" className="roster-list">
            {visible.map((bot) => (
              <button className="roster-row" key={bot.id} onClick={() => onOpenChat(bot)} type="button">
                <span className="avatar-state-wrap compact"><BabyGrokAvatar color={bot.avatar.color} label={bot.name} shape={bot.avatar.shape} size={54} state={bot.isRunning ? "working" : bot.awaitingUserResponse ? "listening" : "idle"} />{bot.isRunning ? <i className="semantic-status running" /> : null}</span>
                <span className="roster-copy"><strong>{bot.name}</strong><small>{bot.isComposing ? "메시지 작성 중" : bot.lastMessagePreview || bot.description || "아직 대화가 없습니다."}</small></span>
                <span className="roster-meta"><time>{relativeTime(bot.lastActivityAt)}</time>{bot.unreadCount > 0 ? <b aria-label={`읽지 않은 메시지 ${bot.unreadCount}개`}>{Math.min(99, bot.unreadCount)}</b> : null}</span>
              </button>
            ))}
            {visible.length === 0 ? <EmptyState action="새 Bot 만들기" detail="새 Bot을 만들거나 숨긴 Bot을 확인하세요." onAction={onCreateBot} title="대화가 없습니다" /> : null}
          </section>
          <div className="home-links"><button onClick={() => onOpen("HiddenChatsScreen")} type="button">숨긴 Bot {bots.filter((bot) => bot.isHidden).length}개 <Icon name="chevronRight" size={14} /></button><button onClick={() => onOpen("FailuresScreen")} type="button">실패한 작업 <Icon name="chevronRight" size={14} /></button></div>
        </>
      ) : null}
    </main>
  );
}
