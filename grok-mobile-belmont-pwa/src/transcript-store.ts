import { reconcileEntries } from "./entries";
import type { MobileMessage } from "./types";

export type TranscriptPage = { entries: MobileMessage[]; nextBeforeSeq?: number | null };
export type TranscriptSnapshot = { entries: MobileMessage[]; nextBeforeSeq: number | null; loading: boolean; loadingOlder: boolean; error: string };

// A long offline interval can contain many pages. Keep the continuation for the next refresh
// rather than making a single reconnect read an unbounded transcript.
const MAX_REFRESH_CATCHUP_PAGES = 8;
type TranscriptGap = { beforeSeq: number; anchorIds: Set<string>; olderCursor: number | null };

/** One request at a time; each store belongs to one bot/thread and never publishes after disposal. */
export class TranscriptStore {
  private snapshot: TranscriptSnapshot = { entries: [], nextBeforeSeq: null, loading: true, loadingOlder: false, error: "" };
  private listeners = new Set<() => void>();
  private initialized = false;
  private disposed = false;
  private queuedRefresh = false;
  private active: AbortController | null = null;
  private gap: TranscriptGap | null = null;

  constructor(private fetchPage: (before: number | null, signal: AbortSignal) => Promise<TranscriptPage>, private timeoutMs = 15_000) {}

  getSnapshot = (): TranscriptSnapshot => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<TranscriptSnapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  updateEntries = (update: (entries: MobileMessage[]) => MobileMessage[]) => this.publish({ entries: reconcileEntries(update(this.snapshot.entries)) });
  start() { this.disposed = false; void this.refresh(); }
  dispose() {
    this.disposed = true;
    this.queuedRefresh = false;
    this.active?.abort();
    this.active = null;
  }
  refresh = async () => {
    if (this.disposed) return;
    if (this.active) { this.queuedRefresh = true; return; }
    await this.load(false);
  };
  loadOlder = async () => {
    if (this.disposed || this.active || this.snapshot.nextBeforeSeq == null) return;
    await this.load(true);
  };

  private applyGapPage(page: TranscriptPage) {
    const gap = this.gap;
    if (gap == null) return;
    const nextBeforeSeq = page.nextBeforeSeq ?? null;
    const overlaps = page.entries.some((entry) => gap.anchorIds.has(entry.id));
    if (!overlaps && nextBeforeSeq != null && nextBeforeSeq >= gap.beforeSeq) throw new Error("대화 페이지를 이어 불러오지 못했습니다. 다시 시도해 주세요.");
    this.gap = overlaps || nextBeforeSeq == null ? null : { ...gap, beforeSeq: nextBeforeSeq };
    this.publish({
      // Keep refreshed head copies, while accepting updates (for example approval status)
      // to entries that were loaded before the gap opened.
      entries: reconcileEntries([...page.entries, ...this.snapshot.entries, ...page.entries.filter((entry) => gap.anchorIds.has(entry.id))]),
      nextBeforeSeq: nextBeforeSeq == null ? null : overlaps ? gap.olderCursor : nextBeforeSeq,
    });
  }

  private async load(older: boolean) {
    const controller = new AbortController();
    this.active = controller;
    const initial = !this.initialized;
    this.publish({ loading: initial, loadingOlder: older, error: "" });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const aborted = new Promise<never>((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("대화 연결이 지연되고 있습니다. 다시 시도해 주세요.")), { once: true });
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    });
    try {
      const page = await Promise.race([this.fetchPage(older ? this.snapshot.nextBeforeSeq : null, controller.signal), aborted]);
      if (this.disposed || this.active !== controller) return;
      if (older && this.gap != null) {
        this.applyGapPage(page);
      } else if (older) {
        this.publish({ entries: reconcileEntries([...page.entries, ...this.snapshot.entries]), nextBeforeSeq: page.nextBeforeSeq ?? null });
      } else {
        const knownIds = new Set(this.snapshot.entries.filter((entry) => entry.type !== "text" || !entry.optimistic).map((entry) => entry.id));
        const nextBeforeSeq = page.nextBeforeSeq ?? null;
        const overlaps = page.entries.some((entry) => knownIds.has(entry.id));
        let cursor = this.snapshot.nextBeforeSeq;
        if (initial || knownIds.size === 0 || nextBeforeSeq == null) {
          this.gap = null;
          cursor = nextBeforeSeq;
        } else if (!overlaps) {
          this.gap = { beforeSeq: nextBeforeSeq, anchorIds: this.gap?.anchorIds ?? knownIds, olderCursor: this.gap == null ? cursor : this.gap.olderCursor };
        }
        this.publish({ entries: reconcileEntries([...this.snapshot.entries, ...page.entries]), nextBeforeSeq: this.gap?.beforeSeq ?? cursor });
        for (let pageIndex = 0; this.gap != null && pageIndex < MAX_REFRESH_CATCHUP_PAGES; pageIndex++) {
          const gapPage = await Promise.race([this.fetchPage(this.gap.beforeSeq, controller.signal), aborted]);
          if (this.disposed || this.active !== controller) return;
          this.applyGapPage(gapPage);
        }
      }
      this.initialized = true;
    } catch (caught) {
      if (!this.disposed && this.active === controller) this.publish({ error: caught instanceof Error ? caught.message : "대화를 불러오지 못했습니다." });
    } finally {
      clearTimeout(timer);
      if (this.active === controller) {
        this.active = null;
        this.publish({ loading: false, loadingOlder: false });
        if (this.queuedRefresh && !this.disposed) { this.queuedRefresh = false; void this.refresh(); }
      }
    }
  }
}
