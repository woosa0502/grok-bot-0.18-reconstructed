import { Icon } from "./Icon";

export function ScreenSkeleton({ rows = 6 }: { rows?: number }) {
  return <div aria-label="불러오는 중" className="screen-skeleton">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><i /><span><b /><small /></span></div>)}</div>;
}

export function ScreenError({ message, retry }: { message: string; retry: () => void }) {
  return <div className="screen-state"><Icon name="warning" size={27} /><strong>연결하지 못했습니다</strong><p>{message}</p><button onClick={retry} type="button">다시 시도</button></div>;
}

export function EmptyState({ title, detail, action, onAction }: { title: string; detail: string; action?: string; onAction?: () => void }) {
  return <div className="screen-state empty"><Icon name="bot" size={28} /><strong>{title}</strong><p>{detail}</p>{action && onAction ? <button onClick={onAction} type="button">{action}</button> : null}</div>;
}
