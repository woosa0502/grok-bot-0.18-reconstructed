const CACHE_NAME = "belmont-mobile-v14-shipped-engine";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/grok-bot-app-icon.png",
  "./icons/grok-bot-app-icon-192.png",
  "./icons/grok-bot-app-icon-512.png",
  "./src/app.js",
  "./src/api.js",
  "./src/core.js",
  "./src/mock-api.js",
  "./src/persona.js",
  "./src/grok-engine.js",
  "./src/styles.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Network-first so a redeploy shows up on the next load; the cache is only the
// offline fallback, refreshed on every successful fetch.
self.addEventListener("fetch", (event) => {
  const requestUrl = new URL(event.request.url);
  if (event.request.method !== "GET" || requestUrl.pathname.startsWith("/api/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && response.type === "basic") {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error()))
  );
});
