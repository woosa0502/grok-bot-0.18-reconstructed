const CACHE = "belmont-grok-mobile-v3";
const PUSH_RECEIPTS = "belmont-mobile-push-receipts-v1";
let pushDelivery = Promise.resolve();
const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE && key !== PUSH_RECEIPTS).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  pushDelivery = pushDelivery.catch(() => {}).then(async () => {
    let payload;
    try { payload = event.data?.json(); } catch { return; }
    if (!payload || !/^[a-f0-9]{64}$/.test(payload.id) || typeof payload.botId !== "string") return;
    const receipt = new URL(`/.push-receipts/${payload.id}`, self.location.origin).href;
    const cache = await caches.open(PUSH_RECEIPTS);
    if (await cache.match(receipt)) return;
    const url = new URL(`/?surface=ChatScreen&botId=${encodeURIComponent(payload.botId)}`, self.location.origin).href;
    await self.registration.showNotification(String(payload.title || "Bot"), {
      body: String(payload.body || "새 활동이 있습니다."), icon: "/icon-192.png", badge: "/icon-192.png",
      tag: `belmont:${payload.botId}:${payload.kind === "needs-input" ? "needs-input" : "completed"}`,
      data: { url, id: payload.id },
    });
    await cache.put(receipt, new Response(String(Date.now())));
    const receipts = await cache.keys();
    await Promise.all(receipts.slice(0, Math.max(0, receipts.length - 100)).map((request) => cache.delete(request)));
  });
  event.waitUntil(pushDelivery);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const requested = new URL(event.notification.data?.url || "/", self.location.origin);
    const target = requested.origin === self.location.origin ? requested.href : self.location.origin;
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const client = clients.find((candidate) => new URL(candidate.url).origin === self.location.origin);
    if (client) { await client.navigate(target); await client.focus(); }
    else await self.clients.openWindow(target);
  })());
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const configResponse = await fetch("/api/push/config", { credentials: "same-origin" });
    if (!configResponse.ok) return;
    const config = await configResponse.json();
    if (!config.available || !config.preferences.enabled || Notification.permission !== "granted") return;
    const raw = atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/"));
    const applicationServerKey = Uint8Array.from(raw, (character) => character.charCodeAt(0));
    const subscription = event.newSubscription || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
    const response = await fetch("/api/push/subscriptions", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription }) });
    if (!response.ok) throw new Error("Push subscription renewal failed");
    if (event.oldSubscription && event.oldSubscription.endpoint !== subscription.endpoint) {
      await fetch("/api/push/subscriptions", { method: "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: event.oldSubscription.endpoint }) });
    }
  })());
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname.startsWith("/windows")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? caches.match("/"))),
  );
});
