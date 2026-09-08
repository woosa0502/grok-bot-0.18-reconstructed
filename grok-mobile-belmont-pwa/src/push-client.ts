export interface MobilePushState {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
  enabled: boolean;
}

interface PushConfig {
  available: boolean;
  publicKey: string;
  subscribed: boolean;
  preferences: { enabled: boolean; bots: Record<string, boolean> };
}

function supported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin", headers: { "content-type": "application/json", ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "휴대폰 알림 설정을 저장하지 못했습니다.");
  return body as T;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("알림 서비스가 시작되지 않았습니다. 페이지를 새로고침하세요.")), 15_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

function applicationKey(value: string): Uint8Array<ArrayBuffer> {
  const raw = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
}

export async function getPushState(): Promise<MobilePushState> {
  if (!supported()) return { supported: false, permission: "unsupported", subscribed: false, enabled: false };
  const config = await request<PushConfig>("/api/push/config");
  const worker = await navigator.serviceWorker.getRegistration();
  const subscription = await worker?.pushManager.getSubscription();
  return { supported: config.available, permission: Notification.permission, subscribed: Boolean(subscription) && config.subscribed, enabled: config.preferences.enabled };
}

async function registerSubscription(config: PushConfig): Promise<void> {
  const worker = await registration();
  const applicationServerKey = applicationKey(config.publicKey);
  let subscription = await worker.pushManager.getSubscription();
  const currentKey = subscription?.options.applicationServerKey;
  if (subscription && currentKey && (new Uint8Array(currentKey).length !== applicationServerKey.length || new Uint8Array(currentKey).some((value, index) => value !== applicationServerKey[index]))) {
    await request("/api/push/subscriptions", { method: "DELETE", body: JSON.stringify({ endpoint: subscription.endpoint }) });
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  await request("/api/push/subscriptions", { method: "POST", body: JSON.stringify({ subscription: subscription.toJSON() }) });
}

export async function enablePush(): Promise<MobilePushState> {
  if (!supported()) return { supported: false, permission: "unsupported", subscribed: false, enabled: false };
  const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
  if (permission !== "granted") return { supported: true, permission, subscribed: false, enabled: false };
  const config = await request<PushConfig>("/api/push/config");
  if (!config.available) throw new Error("서버의 휴대폰 알림을 아직 사용할 수 없습니다.");
  await registerSubscription(config);
  await request("/api/push/preferences", { method: "PUT", body: JSON.stringify({ enabled: true }) });
  return await getPushState();
}

export async function disablePush(): Promise<void> {
  // Disable server delivery first, even if the browser cannot unsubscribe while offline.
  await request("/api/push/preferences", { method: "PUT", body: JSON.stringify({ enabled: false }) });
  await request("/api/push/subscriptions", { method: "DELETE", body: "{}" });
  if (supported()) await (await (await navigator.serviceWorker.getRegistration())?.pushManager.getSubscription())?.unsubscribe();
}

/** Reconnect an existing opt-in after a server restart or browser subscription rotation; no permission prompt. */
export async function syncPushSubscription(): Promise<void> {
  if (!supported()) return;
  if (Notification.permission !== "granted") {
    await request("/api/push/subscriptions", { method: "DELETE", body: "{}" });
    return;
  }
  const config = await request<PushConfig>("/api/push/config");
  if (config.available && config.preferences.enabled) await registerSubscription(config);
}
