// belmont-browse: pretends to be the Aside browser extension on the daemon's in-process
// ExtensionBridgeServer, answering `Aside.*` commands with plain CDP against a stock Chrome (our code).
import { randomUUID } from "node:crypto";

const WS_OPEN = 1;

export class FakeExtension {
  #bridge;
  #cdp;
  #tabIds = new Map(); // targetId -> tabId
  #nextTabId = 1;
  #activeTargetId = null;
  #windowId = null;
  #log;
  entry = null;
  stats = { commands: 0, byMethod: new Map(), failures: 0 };

  constructor({ bridge, cdp, accountId, profileId, log = console.error }) {
    this.#bridge = bridge;
    this.#cdp = cdp;
    this.accountId = accountId;
    this.profileId = profileId;
    this.#log = log;
  }

  async attach() {
    await this.#cdp.connect();
    await this.#resolveWindowId();
    const fakeWs = {
      readyState: WS_OPEN,
      send: (text) => void this.#onDaemonMessage(text),
      close: () => { fakeWs.readyState = 3; },
    };
    this.entry = {
      accountId: this.accountId,
      connectionId: `belmont-${randomUUID().slice(0, 8)}`,
      profileId: this.profileId,
      ws: fakeWs,
      lastPongAt: Date.now(),
      keepAlive: undefined,
    };
    this.#bridge.connections.set(`${this.accountId}:${this.profileId}`, this.entry);
    for (const fn of this.#bridge.connectHandlers ?? []) {
      try { fn(this.entry); } catch (e) { this.#log("[bridge-shim] connect handler failed", e.message); }
    }
    return this;
  }

  detach() {
    const key = `${this.accountId}:${this.profileId}`;
    if (this.#bridge.connections.get(key) === this.entry) this.#bridge.connections.delete(key);
    if (this.entry) this.entry.ws.readyState = 3;
  }

  get windowId() { return this.#windowId; }

  async #resolveWindowId() {
    let pages = await this.#cdp.pageTargets();
    if (pages.length === 0) {
      await this.#cdp.send("Target.createTarget", { url: "about:blank" });
      pages = await this.#cdp.pageTargets();
    }
    let windowId = null;
    for (const p of pages) {
      try {
        ({ windowId } = await this.#cdp.send("Browser.getWindowForTarget", { targetId: p.targetId }));
        this.#activeTargetId ??= p.targetId;
        break;
      } catch (e) {
        this.#log(`[bridge-shim] getWindowForTarget skipped ${p.targetId}: ${e.message}`);
      }
    }
    this.#windowId = windowId ?? 1;
    for (const p of pages) this.#tabId(p.targetId);
    this.#activeTargetId ??= pages[0]?.targetId ?? null;
  }

  #tabId(targetId) {
    let id = this.#tabIds.get(targetId);
    if (id === undefined) {
      id = this.#nextTabId++;
      this.#tabIds.set(targetId, id);
    }
    return id;
  }

  async #onDaemonMessage(text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (msg.method === "ping") {
      this.entry.lastPongAt = Date.now();
      return;
    }
    if (msg.method !== "runCommand") return;
    const pending = this.#bridge.pendingCommandRequests.get(msg.id);
    const t0 = Date.now();
    const name = msg.command?.method;
    this.stats.commands += 1;
    this.stats.byMethod.set(name, (this.stats.byMethod.get(name) ?? 0) + 1);
    let result, error;
    try {
      result = await this.#run(name, msg.command.params ?? {}, msg.route ?? {});
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      this.stats.failures += 1;
    }
    this.#log(`[bridge-shim] ${name} ${error ? "FAILED " + error : "ok"} (${Date.now() - t0}ms)`);
    const p = this.#bridge.pendingCommandRequests.get(msg.id) ?? pending;
    if (!p) return;
    this.#bridge.pendingCommandRequests.delete(msg.id);
    clearTimeout(p.timeout);
    if (error) p.reject(new Error(error));
    else p.resolve(result);
  }

  async #listTabs() {
    const pages = await this.#cdp.pageTargets();
    return pages.map((t) => ({
      id: String(this.#tabId(t.targetId)),
      targetId: t.targetId,
      url: t.url,
      title: t.title ?? "",
      faviconUrl: "",
      active: t.targetId === this.#activeTargetId,
      windowId: this.#windowId,
    }));
  }

  async #openTab(url) {
    const { targetId } = await this.#cdp.send("Target.createTarget", { url });
    this.#activeTargetId = targetId;
    return { targetId, tabId: this.#tabId(targetId), windowId: this.#windowId };
  }

  async #run(method, params, route) {
    switch (method) {
      case "Aside.listTabs":
        return { items: await this.#listTabs() };
      case "Aside.ownsTarget": {
        const pages = await this.#cdp.pageTargets();
        return { owned: pages.some((t) => t.targetId === params.targetId) };
      }
      case "Aside.createAgentTab":
        return this.#openTab(params.url);
      case "Aside.controlTab": {
        if (params.action === "open") {
          if (params.targetId) {
            await this.#cdp.withTarget(params.targetId, (send) => send("Page.navigate", { url: params.url }));
            await this.#cdp.send("Target.activateTarget", { targetId: params.targetId }).catch(() => {});
            this.#activeTargetId = params.targetId;
            return { success: true, action: "open", created: false, tabId: this.#tabId(params.targetId), targetId: params.targetId };
          }
          const opened = await this.#openTab(params.url);
          return { success: true, action: "open", created: true, ...opened };
        }
        if (params.action === "close") {
          let targetId = params.targetId;
          if (!targetId && params.url) targetId = (await this.#cdp.pageTargets()).find((t) => t.url === params.url)?.targetId;
          if (!targetId) return { success: true, action: "close", closed: false };
          if (params.skipIfActive && targetId === this.#activeTargetId && (await this.#cdp.pageTargets()).length <= 1) {
            return { success: true, action: "close", closed: false, targetId };
          }
          await this.#cdp.send("Target.closeTarget", { targetId }).catch(() => {});
          this.#tabIds.delete(targetId);
          if (this.#activeTargetId === targetId) this.#activeTargetId = (await this.#cdp.pageTargets())[0]?.targetId ?? null;
          return { success: true, action: "close", closed: true, targetId };
        }
        throw new Error(`controlTab action not supported: ${params.action}`);
      }
      case "Aside.ensureTabInAiTabsGroup":
        return { success: true, groupId: 1, tabId: this.#tabId(params.targetId) };
      case "Aside.clearAiTabsGroup":
        return { success: true };
      case "Aside.resolveBindingWindow": {
        const tabs = await this.#listTabs();
        return {
          status: "ok",
          windowId: this.#windowId,
          via: "single-window",
          ...(this.#activeTargetId ? { anchorTargetId: this.#activeTargetId } : {}),
          diagnostics: { windowCount: 1, windowCountByType: { normal: 1 }, tabCount: tabs.length },
        };
      }
      case "Aside.callExtensionMV3Api":
        return this.#mv3(params.method, params.args ?? []);
      case "Aside.showNotification":
      case "Aside.playNotificationSound":
      case "Aside.grantNotificationPermission":
      case "Aside.revokeNotificationPermission":
        return { success: true };
      case "Aside.searchHistory":
        return { items: [] };
      case "Aside.getThirdPartyCookies":
        return { mode: "allow" };
      case "Aside.setThirdPartyCookies":
        return { success: true };
      default:
        throw new Error(`${method} is not supported by belmont-browse (step 1 shim)`);
    }
  }

  async #mv3(method, args) {
    const tabs = await this.#listTabs();
    const chromeTabs = tabs.map((t) => ({ id: Number(t.id), windowId: t.windowId, url: t.url, title: t.title, active: t.active }));
    switch (method) {
      case "chrome.windows.getAll":
        return [{ id: this.#windowId, type: "normal", focused: true, tabs: args[0]?.populate ? chromeTabs : [] }];
      case "chrome.windows.getLastFocused":
        return { id: this.#windowId, type: "normal", focused: true, tabs: chromeTabs };
      case "chrome.tabs.query":
        return chromeTabs;
      default:
        throw new Error(`${method} is not supported by belmont-browse (step 1 shim)`);
    }
  }
}
