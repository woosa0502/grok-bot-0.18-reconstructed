import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

function fixture() {
  const handlers = new Map();
  const cachesByName = new Map();
  const notifications = [];
  const navigation = [];
  const requests = [];
  let windows = [];
  const self = {
    location: { origin: "https://mobile.example.net" },
    addEventListener(type, handler) { handlers.set(type, handler); },
    registration: { async showNotification(title, options) { notifications.push({ title, ...options }); }, pushManager: { async subscribe() { throw new Error("unexpected real subscription"); } } },
    clients: { async matchAll() { return windows; }, async openWindow(url) { navigation.push({ kind: "open", url }); } },
  };
  const cacheApi = {
    async open(name) {
      if (!cachesByName.has(name)) cachesByName.set(name, new Map());
      const entries = cachesByName.get(name);
      return { async match(key) { return entries.get(key); }, async put(key, value) { entries.set(key, value); }, async keys() { return [...entries.keys()]; }, async delete(key) { return entries.delete(key); } };
    },
  };
  vm.runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { self, caches: cacheApi, URL, Response, Date, Uint8Array, Notification: { permission: "granted" }, atob,
    async fetch(path, init) { requests.push({ path, init }); return path === "/api/push/config" ? new Response(JSON.stringify({ available: true, publicKey: "AA", preferences: { enabled: true } })) : new Response("{}"); },
  });
  async function dispatch(type, event) { let pending; handlers.get(type)({ ...event, waitUntil(value) { pending = value; } }); await pending; }
  return { handlers, notifications, navigation, requests, self, dispatch, setWindows(value) { windows = value; } };
}

test("service worker displays an incoming encrypted-transport payload once across duplicate concurrent deliveries", async () => {
  const worker = fixture();
  const payload = { id: "a".repeat(64), botId: "bot / 한글", title: "테스트", body: "승인이 필요합니다.", kind: "needs-input", url: "https://outside.example.net/ignored" };
  await Promise.all([worker.dispatch("push", { data: { json: () => payload } }), worker.dispatch("push", { data: { json: () => payload } })]);
  assert.equal(worker.notifications.length, 1);
  assert.equal(worker.notifications[0].body, payload.body);
  assert.equal(new URL(worker.notifications[0].data.url).origin, "https://mobile.example.net");
  assert.equal(new URL(worker.notifications[0].data.url).searchParams.get("surface"), "ChatScreen");
  assert.equal(new URL(worker.notifications[0].data.url).searchParams.get("botId"), payload.botId);
  await worker.dispatch("push", { data: { json() { throw new Error("malformed"); } } });
  assert.equal(worker.notifications.length, 1);
});

test("notification click focuses the paired app and never navigates to a payload-supplied foreign origin", async () => {
  const worker = fixture();
  const moves = [];
  worker.setWindows([{ url: "https://mobile.example.net/", async navigate(url) { moves.push(url); }, async focus() { moves.push("focused"); } }]);
  let closed = false;
  await worker.dispatch("notificationclick", { notification: { data: { url: "https://mobile.example.net/?surface=ChatScreen&botId=worker" }, close() { closed = true; } } });
  assert.equal(closed, true);
  assert.deepEqual(moves, ["https://mobile.example.net/?surface=ChatScreen&botId=worker", "focused"]);
  worker.setWindows([]);
  await worker.dispatch("notificationclick", { notification: { data: { url: "https://outside.example.net/" }, close() {} } });
  assert.deepEqual(worker.navigation, [{ kind: "open", url: "https://mobile.example.net" }]);
});

test("subscription rotation registers the new endpoint and removes the old one through paired APIs", async () => {
  const worker = fixture();
  const next = { endpoint: "https://push.example.net/new" };
  await worker.dispatch("pushsubscriptionchange", { oldSubscription: { endpoint: "https://push.example.net/old" }, newSubscription: next });
  assert.deepEqual(worker.requests.map((request) => [request.path, request.init?.method ?? "GET"]), [["/api/push/config", "GET"], ["/api/push/subscriptions", "POST"], ["/api/push/subscriptions", "DELETE"]]);
  assert.equal(JSON.parse(worker.requests[1].init.body).subscription.endpoint, next.endpoint);
  assert.equal(JSON.parse(worker.requests[2].init.body).endpoint, "https://push.example.net/old");
});
