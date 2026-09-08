import { useEffect, useMemo, useSyncExternalStore } from "react";
import { TranscriptStore, type TranscriptPage } from "./transcript-store";

export function useTranscript(scope: string, fetchPage: (before: number | null, signal: AbortSignal) => Promise<TranscriptPage>, eventRevision: number, busy: boolean) {
  const store = useMemo(() => new TranscriptStore(fetchPage), [scope, fetchPage]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  useEffect(() => { store.start(); return () => store.dispose(); }, [store]);
  useEffect(() => { if (eventRevision > 0) void store.refresh(); }, [store, eventRevision]);
  useEffect(() => {
    const sync = () => { if (!document.hidden && navigator.onLine !== false) void store.refresh(); };
    const timer = window.setInterval(sync, busy ? 2500 : 15_000);
    window.addEventListener("online", sync);
    document.addEventListener("visibilitychange", sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, [store, busy]);
  return { ...snapshot, refresh: store.refresh, loadOlder: store.loadOlder, setEntries: store.updateEntries };
}
