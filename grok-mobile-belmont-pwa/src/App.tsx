import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, subscribeToEvents } from "./api";
import { syncPushSubscription } from "./push-client";
import { ScreenError, ScreenSkeleton } from "./components/ScreenState";
import { APP_SURFACE_IDS, type AppRoute, type SurfaceId } from "./navigation";
import { ChatScreen } from "./screens/ChatScreen";
import { ComputerScreen, routeWindowIndex } from "./screens/ComputerScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { NewBotScreen } from "./screens/NewBotScreen";
import { OnboardingScreen } from "./screens/OnboardingScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { WindowsDesktopScreen } from "./screens/WindowsDesktopScreen";
import { ProductSurfaceRouter } from "./screens/surfaces/ProductSurfaceRouter";
import type { Bot } from "./types";
import type { AttachmentKind } from "./types";

type Theme = "system" | "light" | "dark";
const NAVIGATION_STATE_KEY = "linearNavigation";

function homeRoute(): AppRoute {
  return { name: "HomeScreen" };
}

function applyTheme(theme: Theme) {
  const dark = theme === "dark" || theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

function initialRoute(): AppRoute {
  const params = new URLSearchParams(window.location.search);
  const candidate = params.get("surface") as SurfaceId | null;
  const attachmentKinds: AttachmentKind[] = ["image", "video", "audio", "pdf", "markdown", "table", "json", "document", "archive", "text", "file"];
  const attachmentPath = params.get("attachmentPath");
  const attachmentKind = params.get("attachmentKind") as AttachmentKind | null;
  const attachment = attachmentPath && attachmentKind && attachmentKinds.includes(attachmentKind) ? {
    agentId: params.get("attachmentAgentId") ?? params.get("botId") ?? "",
    entryId: params.get("entryId") ?? "",
    name: params.get("value") ?? "Attachment",
    path: attachmentPath,
    byteSize: Number(params.get("attachmentBytes")) || 0,
    kind: attachmentKind,
    mime: params.get("attachmentMime"),
    width: Number(params.get("attachmentWidth")) || null,
    height: Number(params.get("attachmentHeight")) || null,
  } : undefined;
  return { name: candidate != null && APP_SURFACE_IDS.includes(candidate) ? candidate : "HomeScreen", botId: params.get("botId") ?? undefined, entryId: params.get("entryId") ?? undefined, value: params.get("value") ?? undefined, attachment };
}

function historyRoutes(state: unknown): AppRoute[] | null {
  if (state == null || typeof state !== "object") return null;
  const navigation = (state as Record<string, unknown>)[NAVIGATION_STATE_KEY];
  if (navigation == null || typeof navigation !== "object") return null;
  const routes = (navigation as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return null;
  const valid = routes.every((item) => item != null && typeof item === "object" && APP_SURFACE_IDS.includes((item as { name?: SurfaceId }).name as SurfaceId));
  return valid ? routes as AppRoute[] : null;
}

function navigationState(routes: AppRoute[]) {
  return { [NAVIGATION_STATE_KEY]: { routes } };
}

function routeHref(route: AppRoute): string {
  const url = new URL(window.location.href);
  url.search = "";
  if (route.name !== "HomeScreen") url.searchParams.set("surface", route.name);
  if (route.botId) url.searchParams.set("botId", route.botId);
  if (route.entryId) url.searchParams.set("entryId", route.entryId);
  if (route.value) url.searchParams.set("value", route.value);
  if (route.attachment) {
    url.searchParams.set("attachmentAgentId", route.attachment.agentId);
    url.searchParams.set("attachmentPath", route.attachment.path);
    url.searchParams.set("attachmentKind", route.attachment.kind);
    url.searchParams.set("attachmentBytes", String(route.attachment.byteSize));
    if (route.attachment.mime) url.searchParams.set("attachmentMime", route.attachment.mime);
    if (route.attachment.width != null) url.searchParams.set("attachmentWidth", String(route.attachment.width));
    if (route.attachment.height != null) url.searchParams.set("attachmentHeight", String(route.attachment.height));
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

/** The notifications ask is shown once: never again after it was granted or explicitly answered. */
function shouldAskNotifications(): boolean {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission !== "default") return false;
  try { return localStorage.getItem("linear-notifications-prompted") !== "1"; } catch { return true; }
}

export default function App() {
  const [booting, setBooting] = useState(true);
  const [paired, setPaired] = useState(false);
  const [bots, setBots] = useState<Bot[]>([]);
  const [botsLoading, setBotsLoading] = useState(false);
  const [botsError, setBotsError] = useState("");
  const [routes, setRoutes] = useState<AppRoute[]>(() => historyRoutes(window.history.state) ?? [initialRoute()]);
  const routesRef = useRef(routes);
  const [selectedId, setSelectedId] = useState<string | null>(() => (historyRoutes(window.history.state)?.at(-1) ?? initialRoute()).botId ?? null);
  const [eventRevision, setEventRevision] = useState(0);
  const eventTimer = useRef<number | null>(null);
  const fleetRequest = useRef(0);
  const route = routes.at(-1) ?? { name: "HomeScreen" as const };

  const refreshBots = useCallback(async (quiet = false) => {
    const requestId = ++fleetRequest.current;
    if (!quiet) setBotsLoading(true);
    setBotsError("");
    try {
      const result = await api.bots();
      if (requestId !== fleetRequest.current) return;
      setBots(result.bots);
      setSelectedId((current) => current ?? result.managerId ?? result.bots[0]?.id ?? null);
    } catch (caught) {
      if (requestId !== fleetRequest.current) return;
      setBotsError(caught instanceof Error ? caught.message : "Bot 목록을 불러오지 못했습니다.");
    } finally {
      if (requestId === fleetRequest.current) setBotsLoading(false);
    }
  }, []);

  useEffect(() => {
    const stored = (localStorage.getItem("belmont-mobile-theme") as Theme | null) ?? "system";
    applyTheme(stored);
    document.documentElement.dataset.density = localStorage.getItem("linear-density") ?? "comfortable";
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => { if ((localStorage.getItem("belmont-mobile-theme") ?? "system") === "system") applyTheme("system"); };
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    window.scrollTo(0, 0);
    document.querySelector<HTMLElement>(".app-screen")?.scrollTo(0, 0);
  }, [route.name, route.botId, route.entryId, route.value]);

  useEffect(() => {
    let current = true;
    void api.session().then((session) => {
      if (!current) return;
      setPaired(session.paired);
      if (session.paired) void refreshBots();
    }).catch(() => { if (current) setPaired(false); }).finally(() => { if (current) setBooting(false); });
    return () => { current = false; };
  }, [refreshBots]);

  useEffect(() => {
    if (!paired) return;
    const unsubscribe = subscribeToEvents(() => {
      if (eventTimer.current != null) return;
      if (localStorage.getItem("linear-haptics") !== "off" && navigator.userActivation?.hasBeenActive) navigator.vibrate?.(18);
      eventTimer.current = window.setTimeout(() => {
        eventTimer.current = null;
        setEventRevision((value) => value + 1);
        void refreshBots(true);
      }, 180);
    }, () => undefined);
    return () => {
      unsubscribe();
      if (eventTimer.current != null) window.clearTimeout(eventTimer.current);
      eventTimer.current = null;
    };
  }, [paired, refreshBots]);

  useEffect(() => {
    if (!paired) return;
    void syncPushSubscription().catch(() => undefined);
    const resync = () => {
      if (document.hidden || navigator.onLine === false) return;
      setEventRevision((value) => value + 1);
      void refreshBots(true);
    };
    const timer = window.setInterval(resync, 15_000);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      ++fleetRequest.current;
      window.clearInterval(timer);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [paired, refreshBots]);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || import.meta.env.DEV) return;
    void navigator.serviceWorker.register("/sw.js");
  }, []);

  useEffect(() => {
    const restored = historyRoutes(window.history.state);
    if (restored != null) {
      routesRef.current = restored;
      setRoutes(restored);
    } else {
      const active = routesRef.current.at(-1) ?? homeRoute();
      if (active.name === "HomeScreen") {
        const root = [homeRoute()];
        routesRef.current = root;
        window.history.replaceState(navigationState(root), "", routeHref(root[0]));
        setRoutes(root);
      } else {
        const root = [homeRoute()];
        const stack = [...root, active];
        window.history.replaceState(navigationState(root), "", routeHref(root[0]));
        window.history.pushState(navigationState(stack), "", routeHref(active));
        routesRef.current = stack;
        setRoutes(stack);
      }
    }
    const syncRouteFromHistory = (event: PopStateEvent) => {
      const nextRoutes = historyRoutes(event.state) ?? [initialRoute()];
      routesRef.current = nextRoutes;
      setRoutes(nextRoutes);
      const nextBotId = nextRoutes.at(-1)?.botId;
      if (nextBotId) setSelectedId(nextBotId);
    };
    window.addEventListener("popstate", syncRouteFromHistory);
    return () => window.removeEventListener("popstate", syncRouteFromHistory);
  }, []);

  const selected = useMemo(() => bots.find((bot) => bot.id === (route.botId ?? selectedId)) ?? bots.find((bot) => bot.id === selectedId) ?? null, [bots, route.botId, selectedId]);
  const manager = useMemo(() => bots.find((bot) => bot.isManager) ?? bots[0] ?? null, [bots]);

  const commitNavigation = useCallback((nextRoutes: AppRoute[], mode: "push" | "replace") => {
    const active = nextRoutes.at(-1) ?? homeRoute();
    routesRef.current = nextRoutes;
    if (mode === "push") window.history.pushState(navigationState(nextRoutes), "", routeHref(active));
    else window.history.replaceState(navigationState(nextRoutes), "", routeHref(active));
    setRoutes(nextRoutes);
  }, []);
  const open = useCallback((name: SurfaceId, next: Omit<AppRoute, "name"> = {}) => {
    if (next.botId) setSelectedId(next.botId);
    commitNavigation([...routesRef.current, { name, ...next }], "push");
  }, [commitNavigation]);
  const back = useCallback(() => {
    const current = routesRef.current;
    const stored = historyRoutes(window.history.state);
    if (current.length > 1 && stored?.length === current.length) {
      window.history.back();
      return;
    }
    if (current.at(-1)?.name !== "HomeScreen") commitNavigation([homeRoute()], "replace");
  }, [commitNavigation]);
  const home = useCallback(() => {
    const current = routesRef.current;
    const stored = historyRoutes(window.history.state);
    const depth = current.length - 1;
    if (depth > 0 && stored?.length === current.length) {
      window.history.go(-depth);
      return;
    }
    commitNavigation([homeRoute()], "replace");
  }, [commitNavigation]);
  const openChat = useCallback((botId: string) => {
    setSelectedId(botId);
    commitNavigation([...routesRef.current, { name: "ChatScreen", botId }], "push");
  }, [commitNavigation]);

  if (booting) return <main className="boot-screen"><img alt="Linear" className="boot-mark" src="/linear-app-icon.svg" /><ScreenSkeleton rows={3} /></main>;
  if (!paired) return <OnboardingScreen onPaired={() => { setPaired(true); commitNavigation(shouldAskNotifications() ? [homeRoute(), { name: "NotificationsAskScreen" }] : [homeRoute()], "push"); void refreshBots(); }} />;

  if (route.name === "SettingsSheet") return <SettingsScreen manager={manager} onBack={back} onLogout={() => { setPaired(false); setBots([]); setSelectedId(null); home(); }} onOpen={open} />;
  if (route.name === "NewAgentScreen") return <NewBotScreen onClose={back} onCreated={() => { home(); void refreshBots(); }} />;
  if ((route.name === "ChatScreen" || route.name === "AgentComputerScreen") && selected == null) return <main className="boot-screen"><ScreenError message="선택한 Bot을 찾지 못했습니다." retry={home} /></main>;
  if (route.name === "AgentComputerScreen" && selected) return <ComputerScreen bot={selected} onBack={back} onOpen={open} windowIndex={routeWindowIndex(route.value)} />;
  if (route.name === "WindowsDesktopScreen") return <WindowsDesktopScreen onBack={back} />;
  if (route.name === "ChatScreen" && selected) return <ChatScreen key={selected.id} bot={selected} eventRevision={eventRevision} members={selected.isGroup ? bots.filter((item) => selected.memberIds.includes(item.id)) : []} onBack={back} onBotChanged={() => void refreshBots(true)} onComputer={() => open("AgentComputerScreen", { botId: selected.id })} onOpen={open} />;
  if (route.name === "HomeScreen") return <HomeScreen bots={bots} error={botsError} loading={botsLoading} onCreateBot={() => open("NewAgentScreen")} onOpen={open} onOpenChat={(bot) => openChat(bot.id)} onOpenSettings={() => open("SettingsSheet")} onOpenWindows={() => open("WindowsDesktopScreen")} onRetry={() => void refreshBots()} />;

  return <ProductSurfaceRouter back={back} bot={selected} bots={bots} eventRevision={eventRevision} home={home} open={open} openChat={openChat} refreshBots={() => refreshBots(true)} route={route} />;
}
