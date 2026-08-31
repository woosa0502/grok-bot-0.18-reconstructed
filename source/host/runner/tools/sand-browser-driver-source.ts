export const SAND_BROWSER_DRIVER_VERSION = 3;
export const SAND_BROWSER_DRIVER_BOX_DIR = "/tmp/.sand-browser";
export const SAND_BROWSER_DRIVER_BOX_PATH = SAND_BROWSER_DRIVER_BOX_DIR + "/driver-v" + String(SAND_BROWSER_DRIVER_VERSION) + ".mjs";
export const SAND_BROWSER_RESULT_MARKER = "__SAND_BROWSER_RESULT__";
/**
 * The only CDP methods `browser_cdp` will forward. This is an allowlist, not a
 * denylist: the driver drives a browser holding the user's live logged-in
 * sessions, so any command that can run script (`Runtime.evaluate`,
 * `Page.addScriptToEvaluateOnNewDocument`), rewrite traffic (`Fetch.*`), read
 * response bodies, or drive the debugger is equivalent to acting as the user,
 * and a denylist of prefixes left every one of those reachable. Perception
 * commands the driver itself needs are issued by the ops below against a
 * session it owns, never through a model-supplied method name.
 */
export const SAND_BROWSER_MODEL_CDP_ALLOWLIST: readonly string[] = [
  "Accessibility.getFullAXTree",
  "Accessibility.getPartialAXTree",
  "DOM.describeNode",
  "DOM.getBoxModel",
  "DOM.getDocument",
  "DOM.resolveNode",
  "DOMSnapshot.captureSnapshot",
  "Page.getFrameTree",
  "Page.getLayoutMetrics",
  "Page.getNavigationHistory",
];
export const SAND_BROWSER_DRIVER_SOURCE = `
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";

const RESULT_MARKER = "__SAND_BROWSER_RESULT__";
const STATE_DIR = "/tmp/.sand-browser";
const ACTION_TIMEOUT_MS = 10000;
const NAVIGATE_TIMEOUT_MS = 25000;
const MODEL_CDP_ALLOWLIST = ${JSON.stringify(SAND_BROWSER_MODEL_CDP_ALLOWLIST)};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statePath(display) {
  return STATE_DIR + "/views-" + String(display) + ".json";
}

function loadState(display) {
  try {
    const parsed = JSON.parse(readFileSync(statePath(display), "utf8"));
    if (parsed && typeof parsed === "object") {
      return {
        views: parsed.views && typeof parsed.views === "object" ? parsed.views : {},
        urls: parsed.urls && typeof parsed.urls === "object" ? parsed.urls : {},
        refMeta: parsed.refMeta && typeof parsed.refMeta === "object" ? parsed.refMeta : {},
        lastViewId: typeof parsed.lastViewId === "string" ? parsed.lastViewId : undefined,
      };
    }
  } catch {}
  return { views: {}, urls: {}, refMeta: {}, lastViewId: undefined };
}

function saveState(display, state) {
  try {
    mkdirSync(STATE_DIR, { recursive: true });
    const current = loadState(display);
    const views = { ...current.views, ...state.views };
    const urls = { ...current.urls, ...state.urls };
    // Ref fingerprints merge per VIEW, not per ref: a new snapshot renumbers
    // every ref in that view, so its whole fingerprint map is replaced.
    const refMeta = { ...current.refMeta, ...state.refMeta };
    for (const removed of state.deletedViews ?? []) {
      delete views[removed];
      delete urls[removed];
      delete refMeta[removed];
    }
    let lastViewId = state.lastViewId ?? current.lastViewId;
    if (lastViewId !== undefined && (state.deletedViews ?? []).includes(lastViewId)) {
      lastViewId = undefined;
    }
    const merged = { views, urls, refMeta, lastViewId };
    const tmp = statePath(display) + "." + String(process.pid) + ".tmp";
    writeFileSync(tmp, JSON.stringify(merged));
    renameSync(tmp, statePath(display));
  } catch {}
}

// Serializes cross-process claims on a live tab: two concurrent driver calls
// (same-step parallel browser tools) re-adopting by URL could otherwise pick
// the SAME tab for different views before either saves. The winner writes its
// claim to the state file INSIDE the lock, so the loser's fresh read inside
// its own turn sees the tab as taken. A lock older than 5s is treated as
// leaked by a crashed driver and broken. Failure to lock degrades to the
// unlocked behavior instead of failing the op.
async function withViewClaimLock(display, fn) {
  const lockPath = statePath(display) + ".lock";
  const deadline = Date.now() + 3000;
  let locked = false;
  while (!locked && Date.now() < deadline) {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(lockPath, String(process.pid), { flag: "wx" });
      locked = true;
    } catch {
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 5000) unlinkSync(lockPath);
      } catch {}
      await sleep(50);
    }
  }
  try {
    return await fn();
  } finally {
    if (locked) {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  }
}

async function cdpAlive(port) {
  try {
    const res = await fetch("http://127.0.0.1:" + String(port) + "/json/version", {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function ensureChrome(port, display) {
  if (await cdpAlive(port)) return;
  await new Promise((resolve) => {
    const child = spawn("box-chrome", ["--new-window"], {
      env: { ...process.env, DISPLAY: ":" + String(display) },
      stdio: "ignore",
    });
    child.on("error", () => resolve(undefined));
    child.on("exit", () => resolve(undefined));
    setTimeout(() => resolve(undefined), 45000);
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (await cdpAlive(port)) return;
    await sleep(500);
  }
  throw new Error(
    "The box browser's CDP endpoint did not come up on port " + String(port)
  );
}

// A minimal raw CDP socket for the pre-connect probe below. Uses the box
// image's playwright-core bundled ws client (the driver already depends on
// playwright-core, and the box's plain node has no global WebSocket). Every
// send resolves with the response message, or undefined on timeout/failure \u2014
// never rejects and never hangs.
async function openCdpSocket(wsUrl) {
  let WS;
  try {
    const { createRequire } = await import("node:module");
    WS = createRequire(import.meta.url)("playwright-core/lib/utilsBundle").ws;
  } catch {
    return undefined;
  }
  let ws;
  try {
    ws = new WS(wsUrl);
  } catch {
    return undefined;
  }
  const opened = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 3000);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(true);
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
  if (!opened) {
    try {
      ws.close();
    } catch {}
    return undefined;
  }
  let nextId = 1;
  const pending = new Map();
  ws.on("message", (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch {
      return;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  });
  const send = (method, params, sessionId, timeoutMs) =>
    new Promise((resolve) => {
      const id = nextId++;
      const timer = setTimeout(() => {
        pending.delete(id);
        resolve(undefined);
      }, timeoutMs);
      pending.set(id, (msg) => {
        clearTimeout(timer);
        resolve(msg);
      });
      const payload = { id, method, params: params !== undefined ? params : {} };
      if (sessionId !== undefined) payload.sessionId = sessionId;
      try {
        ws.send(JSON.stringify(payload));
      } catch {
        clearTimeout(timer);
        pending.delete(id);
        resolve(undefined);
      }
    });
  return {
    send,
    close: () => {
      try {
        ws.close();
      } catch {}
    },
  };
}

// A discarded tab (Memory Saver, or any lifecycle discard) keeps a page target
// in the target list but has no renderer, so attaching to it never completes.
// playwright's connectOverCDP auto-attaches to EVERY page, so one discarded
// tab hangs the whole connect and every driver call fails until something
// revives that tab. Before connecting, probe each page target over a raw CDP
// socket and activate the unresponsive ones \u2014 Chrome reloads a discarded tab
// when it becomes active \u2014 then hand focus back to the tab that was visible.
// A live-but-busy page that misses the probe deadline is also activated; that
// is harmless (activation does not reload a live tab, and focus is restored).
// Best-effort throughout: on any failure the plain connect proceeds and
// reports its own error.
async function reviveDiscardedTabs(port) {
  let socket;
  try {
    const base = "http://127.0.0.1:" + String(port);
    const listRes = await fetch(base + "/json/list", { signal: AbortSignal.timeout(1500) });
    if (!listRes.ok) return;
    const targets = (await listRes.json()).filter((t) => t.type === "page");
    if (targets.length === 0) return;
    const versionRes = await fetch(base + "/json/version", { signal: AbortSignal.timeout(1500) });
    if (!versionRes.ok) return;
    const wsUrl = (await versionRes.json()).webSocketDebuggerUrl;
    if (typeof wsUrl !== "string" || wsUrl.length === 0) return;
    socket = await openCdpSocket(wsUrl);
    if (socket === undefined) return;
    // Resolves to the page's visibilityState, or undefined when the page never
    // answers (a discarded tab's renderer is gone, so evaluate never returns).
    const probe = async (targetId) => {
      const attached = await socket.send(
        "Target.attachToTarget",
        { targetId, flatten: true },
        undefined,
        2000
      );
      const sessionId =
        attached !== undefined && attached.result !== undefined
          ? attached.result.sessionId
          : undefined;
      if (sessionId === undefined) return undefined;
      const evaluated = await socket.send(
        "Runtime.evaluate",
        { expression: "document.visibilityState", returnByValue: true },
        sessionId,
        1500
      );
      socket.send("Target.detachFromTarget", { sessionId }, undefined, 1000);
      if (evaluated === undefined || evaluated.result === undefined) return undefined;
      return evaluated.result.result !== undefined ? evaluated.result.result.value : undefined;
    };
    const states = await Promise.all(targets.map((t) => probe(t.id)));
    const hung = targets.filter((t, i) => states[i] === undefined);
    if (hung.length === 0) return;
    const visible = targets.find((t, i) => states[i] === "visible");
    // Revive every hung tab under ONE overall deadline, never a per-tab
    // budget: a long-lived box can hold many discarded tabs at once, and
    // sequential per-tab waits would eat the driver's 90s watchdog before the
    // connect even starts. The activation ack is milliseconds and a discarded
    // tab keeps reloading after focus moves on, so each round activates all
    // stragglers in parallel, then probes them in parallel, until every tab
    // answers or the deadline passes.
    const deadline = Date.now() + 20000;
    let remaining = hung.map((t) => t.id);
    while (remaining.length > 0 && Date.now() < deadline) {
      await Promise.all(
        remaining.map((id) =>
          socket.send("Target.activateTarget", { targetId: id }, undefined, 2000)
        )
      );
      const results = await Promise.all(remaining.map((id) => probe(id)));
      remaining = remaining.filter((_, i) => results[i] === undefined);
      if (remaining.length > 0) await sleep(300);
    }
    if (visible !== undefined) {
      await socket.send("Target.activateTarget", { targetId: visible.id }, undefined, 2000);
    }
  } catch {
  } finally {
    if (socket !== undefined) socket.close();
  }
}

async function targetIdOf(context, page) {
  const session = await context.newCDPSession(page);
  try {
    const info = await session.send("Target.getTargetInfo");
    return info.targetInfo.targetId;
  } finally {
    await session.detach().catch(() => {});
  }
}

async function pagesByTargetId(context) {
  const byTarget = new Map();
  for (const p of context.pages().filter((page) => !page.isClosed())) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        byTarget.set(await targetIdOf(context, p), p);
        break;
      } catch {
        await sleep(150);
      }
    }
  }
  return byTarget;
}

async function resolvePage(request, context, state) {
  const explicit = typeof request.viewId === "string" && request.viewId.length > 0;
  const viewId = explicit ? request.viewId : state.lastViewId ?? "default";
  const mappedTarget = state.views[viewId];
  let byTarget = await pagesByTargetId(context);
  let page = mappedTarget !== undefined ? byTarget.get(mappedTarget) : undefined;
  if (page === undefined && mappedTarget !== undefined) {
    const deadline = Date.now() + 5000;
    while (page === undefined && Date.now() < deadline) {
      await sleep(400);
      byTarget = await pagesByTargetId(context);
      page = byTarget.get(mappedTarget);
    }
  }
  // Discarding a tab destroys its target and revives it under a NEW targetId
  // with the same URL, so a mapped target that never comes back usually means
  // the view's tab was discarded (Memory Saver), not closed. Re-adopt the tab
  // by its last recorded URL instead of falling through to a blank new tab \u2014
  // only a tab no other view claims, so two same-URL views cannot collapse.
  if (page === undefined && mappedTarget !== undefined) {
    const lastUrl = state.urls !== undefined ? state.urls[viewId] : undefined;
    if (typeof lastUrl === "string" && lastUrl.length > 0 && lastUrl !== "about:blank") {
      await withViewClaimLock(request.display, async () => {
        // Re-read the persisted views inside the lock: a concurrent driver
        // process may have claimed a candidate after this one loaded state.
        const persisted = loadState(request.display);
        const claimed = new Set([
          ...Object.values(state.views),
          ...Object.values(persisted.views),
        ]);
        for (const [candidateId, candidate] of byTarget) {
          if (candidate.url() === lastUrl && !claimed.has(candidateId)) {
            page = candidate;
            state.views[viewId] = candidateId;
            saveState(request.display, { views: { [viewId]: candidateId } });
            break;
          }
        }
      });
    }
  }
  if (page === undefined && !explicit && byTarget.size > 0) {
    const pages = [...byTarget.values()];
    page = pages[pages.length - 1];
  }
  if (page === undefined) {
    page = await context.newPage();
  }
  state.views[viewId] = await targetIdOf(context, page);
  state.lastViewId = viewId;
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  return { page, viewId };
}

// Fingerprint of a ref persisted at snapshot time, used to re-find the element
// when the live ref map is gone (navigation wiped the page globals) or the
// element was replaced by a framework re-render. Returns undefined when this
// view has no snapshot fingerprints or the ref was never handed out.
function refMetaFor(state, viewId, ref) {
  const entry = state !== null && state.refMeta !== undefined ? state.refMeta[viewId] : undefined;
  if (entry === undefined || entry.refs === undefined) return undefined;
  const meta = entry.refs[ref];
  if (meta === undefined) return undefined;
  return { opts: entry.opts ?? {}, role: meta.role, name: meta.name, nth: meta.nth };
}

// Refs recovered by fingerprint during this driver call; surfaced in the
// summary so the model knows the target was re-resolved, not the original node.
const recoveredRefs = [];

async function refHandle(page, ref, meta) {
  const lookup = () => page.evaluateHandle((r) => {
    const map = globalThis.__sandRefs;
    return map instanceof Map ? map.get(r) : undefined;
  }, ref);
  let element = (await lookup()).asElement();
  if (element !== null) {
    // A handle can survive while its node left the document (framework
    // re-render); acting on it silently does nothing, so treat it as stale.
    const connected = await element.evaluate((el) => el.isConnected).catch(() => false);
    if (connected) return element;
    element = null;
  }
  // Identity recovery: re-run the snapshot walk and match the persisted
  // role/name fingerprint. nth disambiguates same-labelled siblings; a single
  // survivor matches regardless of position.
  if (meta !== undefined && typeof meta.role === "string") {
    const recovery = Object.assign({}, meta.opts || {}, {
      recover: { ref, role: meta.role, name: meta.name, nth: meta.nth },
    });
    const result = await page.evaluate(SNAPSHOT_FN, recovery).catch(() => undefined);
    if (result !== undefined && result.recovered === true) {
      element = (await lookup()).asElement();
      if (element !== null) {
        recoveredRefs.push(ref);
        return element;
      }
    }
  }
  throw new Error(
    "Unknown or stale ref " + JSON.stringify(ref) + ". Take a fresh browser_snapshot and use a ref from it."
  );
}

// Never type into these, confirmed or not: credentials and card secrets must
// not pass through the model or land in the transcript. The user types them
// directly in the browser window (the profile usually holds live logins).
const SECRET_FIELD_FN = (el) => {
  if (!el || !el.getAttribute) return null;
  const tag = (el.tagName || "").toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
  if (tag === "input" && type === "password") return "input type=password";
  if (auto === "current-password" || auto === "new-password") return "autocomplete=" + auto;
  if (auto === "one-time-code") return "one-time-code field";
  if (auto === "cc-number" || auto === "cc-csc") return "payment card field (" + auto + ")";
  return null;
};

// Deterministic sensitive-action detector: only payment/money controls and
// login/signup submissions are gated — ordinary clicks run free (the middle
// path between approving everything and nothing). The container build runs a
// cloud classifier for this; locally the check is this in-page heuristic, and
// a false positive costs one confirmed retry, never a lost capability.
// Accepts an element (element.evaluate), viewport coordinates, or neither —
// the last resolves document.activeElement for Enter-key submissions, where
// only the password-form check applies (keyword-matching the whole focused
// container would false-positive on page text).
const SENSITIVE_ACTION_FN = (target, extra) => {
  const doc = globalThis.document;
  let el = null;
  let viaKeyboard = extra !== null && extra !== undefined && extra.viaEnter === true;
  if (target && target.nodeType === 1) el = target;
  else if (target && typeof target.x === "number" && typeof target.y === "number") {
    el = doc ? doc.elementFromPoint(target.x, target.y) : null;
  } else {
    el = doc ? doc.activeElement : null;
    viaKeyboard = true;
  }
  if (!el || !el.closest) return null;
  const passwordForm = (node) => {
    const form = node.closest("form");
    return form && form.querySelector('input[type="password"]') !== null ? form : null;
  };
  if (viaKeyboard) {
    return passwordForm(el) !== null
      ? "pressing Enter submits a form containing a password field (login/signup)"
      : null;
  }
  const control = el.closest('button, a[href], input, select, summary, [role="button"], [role="link"], [onclick]');
  if (!control) return null;
  const tag = control.tagName.toLowerCase();
  const type = (control.getAttribute("type") || "").toLowerCase();
  const role = (control.getAttribute("role") || "").toLowerCase();
  const label = ((control.getAttribute("aria-label") || "") + " "
    + (typeof control.value === "string" ? control.value : "") + " "
    + (control.innerText || "")).replace(/\\s+/g, " ").trim().slice(0, 120).toLowerCase();
  const money = /(결제|구매|주문하기|주문\\s*완료|송금|이체|출금|충전|후원|구독하기|정기\\s*구독|\\bpay\\b|payment|purchase|\\bbuy\\b|checkout|place\\s+order|order\\s+now|subscribe|donate|send\\s+money|transfer\\s+(money|funds)|confirm\\s+(purchase|payment|order))/;
  if (money.test(label)) return 'payment/money control "' + label.slice(0, 60) + '"';
  const submitLike = tag === "button" || (tag === "input" && (type === "submit" || type === "image")) || role === "button";
  if (submitLike && passwordForm(control) !== null) {
    return "submit control of a form containing a password field (login/signup)";
  }
  const login = /(로그인|회원가입|log\\s*in|\\blogin\\b|sign\\s*in|sign\\s*up|\\bregister\\b)/;
  if (login.test(label)) return 'login/signup control "' + label.slice(0, 60) + '"';
  return null;
};

function sensitiveBlockMessage(reason) {
  return "Sensitive action blocked (" + reason + "). Payment, money-transfer, and login/signup submissions run only with the user's explicit go-ahead: ask the user to approve this exact step, then retry the same call with \\"confirmed\\": true.";
}

const SNAPSHOT_FN = (opts) => {
  const doc = globalThis.document;
  const win = globalThis.window;
  const root = opts.selector ? doc.querySelector(opts.selector) : doc.body;
  if (!root) return { lines: ["(no matching element for selector)"], refCount: 0, refMeta: [] };
  const refs = new Map();
  const refMeta = [];
  const refElements = [];
  let refCounter = 0;
  const lines = [];
  const maxNodes = 400;
  let nodeCount = 0;
  const interactiveMatcher =
    "a[href], button, input, select, textarea, summary, " +
    '[role="button"], [role="link"], [role="checkbox"], [role="radio"], ' +
    '[role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="combobox"], ' +
    '[role="option"], [role="switch"], [role="searchbox"], [role="textbox"], ' +
    '[role="slider"], [contenteditable="true"], [onclick]';
  const isVisible = (el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    const style = win.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const trim = (text, max) => {
    const t = (text ?? "").replace(/\\s+/g, " ").trim();
    return t.length > max ? t.slice(0, max) + "\u2026" : t;
  };
  const nameOf = (el) => {
    const aria = el.getAttribute("aria-label");
    if (aria) return trim(aria, 80);
    if (el.labels && el.labels.length > 0) return trim(el.labels[0].innerText, 80);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return trim(placeholder, 80);
    const alt = el.getAttribute("alt");
    if (alt) return trim(alt, 80);
    const title = el.getAttribute("title");
    if (title) return trim(title, 80);
    return trim(el.innerText ?? el.value ?? "", 80);
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return "link";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "button" || type === "submit" || type === "reset") return "button";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "range") return "slider";
      return "textbox";
    }
    if (/^h[1-6]$/.test(tag)) return "heading";
    return tag;
  };
  const describe = (el, depth) => {
    const role = roleOf(el);
    const name = nameOf(el);
    let line = "  ".repeat(Math.min(depth, 6)) + "- " + role;
    if (name) line += " " + JSON.stringify(name);
    if (el.matches(interactiveMatcher) && !el.disabled) {
      refCounter += 1;
      const ref = "e" + String(refCounter);
      refs.set(ref, el);
      refMeta.push({ ref, role, name });
      refElements.push(el);
      line += " [ref=" + ref + "]";
    }
    if (el.disabled) line += " disabled";
    if (el.checked === true) line += " checked";
    const tag = el.tagName.toLowerCase();
    if ((tag === "input" || tag === "textarea") && typeof el.value === "string" && el.value.length > 0) {
      const inputType = (el.getAttribute("type") ?? "").toLowerCase();
      const isSecret = inputType === "password" || el.getAttribute("autocomplete") === "current-password" || el.getAttribute("autocomplete") === "new-password";
      line += " value=" + (isSecret ? '"<redacted>"' : JSON.stringify(trim(el.value, 40)));
    }
    if (tag === "a") {
      const href = el.getAttribute("href");
      if (href && !href.startsWith("javascript:")) line += " href=" + JSON.stringify(trim(href, 80));
    }
    return line;
  };
  const walk = (el, depth) => {
    if (nodeCount >= maxNodes || depth > (opts.maxDepth ?? 20)) return;
    if (!(el instanceof win.HTMLElement)) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "noscript") return;
    if (!isVisible(el)) return;
    const isInteractive = el.matches(interactiveMatcher);
    const isHeading = /^h[1-6]$/.test(tag);
    const isTextual = !opts.interactive && (tag === "p" || tag === "li" || tag === "label" || tag === "td" || tag === "th");
    let childDepth = depth;
    if (isInteractive || isHeading || (isTextual && trim(el.innerText, 10).length > 0 && el.querySelector(interactiveMatcher) === null)) {
      nodeCount += 1;
      lines.push(describe(el, depth));
      childDepth = depth + 1;
      if (isInteractive || isTextual) return;
    }
    for (const child of el.children) walk(child, childDepth);
  };
  walk(root, 0);
  if (nodeCount >= maxNodes) lines.push("(snapshot truncated at " + String(maxNodes) + " elements)");
  // Recovery mode: same walk, same enumeration order, but the live ref map is
  // NOT renumbered — other still-valid refs must keep pointing where they do.
  // Only the recovered ref is (re)registered.
  if (opts.recover) {
    const wanted = opts.recover;
    const candidates = [];
    for (let i = 0; i < refMeta.length; i++) {
      if (refMeta[i].role === wanted.role && refMeta[i].name === wanted.name) {
        candidates.push(refElements[i]);
      }
    }
    const pick = candidates.length === 1
      ? candidates[0]
      : typeof wanted.nth === "number" ? candidates[wanted.nth] : undefined;
    if (pick === undefined) return { recovered: false, candidateCount: candidates.length };
    if (!(globalThis.__sandRefs instanceof Map)) globalThis.__sandRefs = new Map();
    globalThis.__sandRefs.set(wanted.ref, pick);
    return { recovered: true, candidateCount: candidates.length };
  }
  globalThis.__sandRefs = refs;
  return { lines, refCount: refCounter, refMeta };
};

function clickOptionsFor(args) {
  const options = { timeout: ACTION_TIMEOUT_MS };
  if (args.button === "right" || args.button === "middle") options.button = args.button;
  if (Array.isArray(args.modifiers) && args.modifiers.length > 0) options.modifiers = args.modifiers;
  if (typeof args.holdDurationMs === "number" && args.holdDurationMs > 0) options.delay = Math.min(args.holdDurationMs, 5000);
  if (args.doubleClick === true) options.clickCount = 2;
  return options;
}

const OPS = {
  navigate: async ({ request, context, state }) => {
    if (request.newTab === true) {
      const page = await context.newPage();
      const viewId = typeof request.viewId === "string" && request.viewId.length > 0 ? request.viewId : "tab-" + String(Date.now());
      state.views[viewId] = await targetIdOf(context, page);
      state.lastViewId = viewId;
      page.setDefaultTimeout(ACTION_TIMEOUT_MS);
      await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: NAVIGATE_TIMEOUT_MS });
      await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
      return { page, viewId, summary: "Opened " + request.url + " in a new tab" };
    }
    const { page, viewId } = await resolvePage(request, context, state);
    await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: NAVIGATE_TIMEOUT_MS });
    await page.waitForLoadState("load", { timeout: 5000 }).catch(() => {});
    return { page, viewId, summary: "Navigated to " + request.url };
  },
  snapshot: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const opts = {
      interactive: request.interactive === true,
      maxDepth: typeof request.maxDepth === "number" ? request.maxDepth : 20,
      selector: typeof request.selector === "string" && request.selector.length > 0 ? request.selector : undefined,
    };
    const result = await page.evaluate(SNAPSHOT_FN, opts);
    // Persist each ref's identity fingerprint (role/name plus its position
    // among same-labelled refs) and the snapshot options that produced the
    // enumeration, so a later call can re-find the element after the live ref
    // map is gone. Whole-view replacement: a new snapshot renumbers every ref.
    const captured = {};
    const counts = {};
    for (const entry of result.refMeta ?? []) {
      const key = JSON.stringify([entry.role, entry.name]);
      const nth = counts[key] ?? 0;
      counts[key] = nth + 1;
      captured[entry.ref] = { role: entry.role, name: entry.name, nth };
    }
    state.refMeta = { ...state.refMeta, [viewId]: { opts, refs: captured } };
    const data = result.lines.join("\\n");
    return {
      page,
      viewId,
      summary: "Captured page snapshot (" + String(result.refCount) + " interactive refs)",
      data,
    };
  },
  click: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
    const sensitive = await element.evaluate(SENSITIVE_ACTION_FN).catch(() => null);
    if (sensitive !== null && request.confirmed !== true) {
      throw new Error(sensitiveBlockMessage(sensitive));
    }
    const options = clickOptionsFor(request);
    if (typeof request.offsetX === "number" || typeof request.offsetY === "number") {
      const box = await element.boundingBox();
      if (box !== null) {
        options.position = {
          x: box.width / 2 + (request.offsetX ?? 0),
          y: box.height / 2 + (request.offsetY ?? 0),
        };
      }
    }
    await element.click(options);
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    return { page, viewId, summary: "Clicked " + (request.element ?? request.ref) };
  },
  mouse_click_xy: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const sensitive = await page.evaluate(SENSITIVE_ACTION_FN, { x: request.x, y: request.y }).catch(() => null);
    if (sensitive !== null && request.confirmed !== true) {
      throw new Error(sensitiveBlockMessage(sensitive));
    }
    await page.mouse.click(request.x, request.y, {
      button: request.button === "right" || request.button === "middle" ? request.button : "left",
    });
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    return { page, viewId, summary: "Clicked at (" + String(request.x) + ", " + String(request.y) + ")" };
  },
  type: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
    const secret = await element.evaluate(SECRET_FIELD_FN).catch(() => null);
    if (secret !== null) {
      throw new Error(
        "Refusing to type into a credential field (" + secret + "). Secrets must never pass through the model or the transcript: ask the user to enter it directly in the browser window (the profile usually keeps live logins)."
      );
    }
    if (request.submit === true && request.confirmed !== true) {
      // submit:true presses Enter in this field, so the question is not what
      // the field looks like but what Enter submits: the password-form check.
      const sensitive = await element.evaluate(SENSITIVE_ACTION_FN, { viaEnter: true }).catch(() => null);
      if (sensitive !== null) throw new Error(sensitiveBlockMessage(sensitive));
    }
    await element.click({ timeout: ACTION_TIMEOUT_MS });
    if (request.clear === true) {
      await element.fill("").catch(() => {});
    }
    await page.keyboard.type(request.text, { delay: request.slowly === true ? 40 : 0 });
    if (request.submit === true) {
      await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded", { timeout: 5000 }).catch(() => {});
    }
    return { page, viewId, summary: "Typed into " + (request.element ?? request.ref) };
  },
  fill: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
    const secret = await element.evaluate(SECRET_FIELD_FN).catch(() => null);
    if (secret !== null) {
      throw new Error(
        "Refusing to fill a credential field (" + secret + "). Secrets must never pass through the model or the transcript: ask the user to enter it directly in the browser window (the profile usually keeps live logins)."
      );
    }
    await element.fill(request.value);
    return { page, viewId, summary: "Filled " + (request.element ?? request.ref) };
  },
  select_option: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
    const values = Array.isArray(request.values) ? request.values : [];
    let selected;
    try {
      selected = await element.selectOption(values);
    } catch {
      selected = await element.selectOption(values.map((v) => ({ label: v })));
    }
    return {
      page,
      viewId,
      summary: "Selected " + JSON.stringify(selected) + " in " + (request.element ?? request.ref),
    };
  },
  press_key: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    if ((request.key === "Enter" || request.key === "NumpadEnter") && request.confirmed !== true) {
      const sensitive = await page.evaluate(SENSITIVE_ACTION_FN, { viaEnter: true }).catch(() => null);
      if (sensitive !== null) throw new Error(sensitiveBlockMessage(sensitive));
    }
    await page.keyboard.press(request.key);
    await page.waitForLoadState("domcontentloaded", { timeout: 3000 }).catch(() => {});
    return { page, viewId, summary: "Pressed " + request.key };
  },
  scroll: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    if (typeof request.ref === "string" && request.ref.length > 0) {
      const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
      await element.scrollIntoViewIfNeeded();
      return { page, viewId, summary: "Scrolled " + (request.element ?? request.ref) + " into view" };
    }
    const amount = typeof request.amount === "number" && request.amount > 0 ? request.amount : 300;
    let deltaX = typeof request.deltaX === "number" ? request.deltaX : 0;
    let deltaY = typeof request.deltaY === "number" ? request.deltaY : 0;
    if (deltaX === 0 && deltaY === 0) {
      const direction = request.direction ?? "down";
      if (direction === "up") deltaY = -amount;
      else if (direction === "down") deltaY = amount;
      else if (direction === "left") deltaX = -amount;
      else deltaX = amount;
    }
    await page.mouse.wheel(deltaX, deltaY);
    await sleep(200);
    return { page, viewId, summary: "Scrolled by (" + String(deltaX) + ", " + String(deltaY) + ")" };
  },
  tabs: async ({ request, context, state }) => {
    const pages = context.pages().filter((p) => !p.isClosed());
    if (request.action === "list") {
      const entries = [];
      for (let i = 0; i < pages.length; i++) {
        entries.push({
          index: i,
          url: pages[i].url(),
          title: await pages[i].title().catch(() => ""),
        });
      }
      return { summary: "Listed " + String(pages.length) + " tab(s)", data: JSON.stringify(entries, null, 1) };
    }
    if (request.action === "new") {
      const page = await context.newPage();
      const viewId = "tab-" + String(Date.now());
      state.views[viewId] = await targetIdOf(context, page);
      state.lastViewId = viewId;
      return { page, viewId, summary: "Opened a new tab" };
    }
    let page;
    if (typeof request.index === "number") {
      page = pages[request.index];
      if (page === undefined) {
        throw new Error("No tab at index " + String(request.index) + " (" + String(pages.length) + " open)");
      }
    } else if (request.action === "close") {
      const currentTarget = state.lastViewId !== undefined ? state.views[state.lastViewId] : undefined;
      if (currentTarget !== undefined) {
        for (const p of pages) {
          try {
            if ((await targetIdOf(context, p)) === currentTarget) {
              page = p;
              break;
            }
          } catch {}
        }
      }
      if (page === undefined) {
        throw new Error("No current tab to close; pass an index from browser_tabs list.");
      }
    } else {
      throw new Error('Tab index is required for "' + String(request.action) + '".');
    }
    if (request.action === "select") {
      await page.bringToFront().catch(() => {});
      const targetId = await targetIdOf(context, page);
      let viewId = Object.keys(state.views).find((k) => state.views[k] === targetId);
      if (viewId === undefined) {
        viewId = "tab-" + String(Date.now());
        state.views[viewId] = targetId;
      }
      state.lastViewId = viewId;
      return { page, viewId, summary: "Selected tab " + String(request.index) };
    }
    if (request.action === "close") {
      const targetId = await targetIdOf(context, page).catch(() => undefined);
      const closedUrl = page.url();
      await page.close();
      if (targetId !== undefined) {
        state.deletedViews = state.deletedViews ?? [];
        for (const key of Object.keys(state.views)) {
          if (state.views[key] === targetId) {
            delete state.views[key];
            state.deletedViews.push(key);
            if (state.lastViewId === key) state.lastViewId = undefined;
          }
        }
      }
      return { summary: "Closed tab (" + closedUrl + ")" };
    }
    throw new Error("Unknown tabs action: " + String(request.action));
  },
  screenshot: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    return { page, viewId, summary: "Took a screenshot", fullPage: request.fullPage === true };
  },
  drag: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const source = await refHandle(page, request.sourceRef, refMetaFor(state, viewId, request.sourceRef));
    await source.scrollIntoViewIfNeeded();
    const sourceBox = await source.boundingBox();
    if (sourceBox === null) throw new Error("The drag source has no visible bounding box.");
    let targetX;
    let targetY;
    if (typeof request.targetRef === "string" && request.targetRef.length > 0) {
      const target = await refHandle(page, request.targetRef, refMetaFor(state, viewId, request.targetRef));
      const targetBox = await target.boundingBox();
      if (targetBox === null) throw new Error("The drag target has no visible bounding box.");
      targetX = targetBox.x + targetBox.width / 2;
      targetY = targetBox.y + targetBox.height / 2;
    } else if (typeof request.targetX === "number" && typeof request.targetY === "number") {
      targetX = request.targetX;
      targetY = request.targetY;
    } else {
      throw new Error("drag needs targetRef or targetX/targetY.");
    }
    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(
        startX + ((targetX - startX) * i) / steps,
        startY + ((targetY - startY) * i) / steps
      );
    }
    await page.mouse.up();
    return {
      page,
      viewId,
      summary:
        "Dragged " + request.sourceRef + " to (" + String(Math.round(targetX)) + ", " + String(Math.round(targetY)) + ")",
    };
  },
  get_bounding_box: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
    const box = await element.boundingBox();
    if (box === null) throw new Error("The element has no visible bounding box.");
    return {
      page,
      viewId,
      summary: "Bounding box for " + (request.element ?? request.ref),
      data: JSON.stringify({
        x: Math.round(box.x),
        y: Math.round(box.y),
        width: Math.round(box.width),
        height: Math.round(box.height),
      }),
    };
  },
  highlight: async ({ request, context, state }) => {
    const { page, viewId } = await resolvePage(request, context, state);
    await page.bringToFront().catch(() => {});
    const element = await refHandle(page, request.ref, refMetaFor(state, viewId, request.ref));
    await element.scrollIntoViewIfNeeded();
    const durationMs = Math.min(
      typeof request.durationMs === "number" && request.durationMs > 0 ? request.durationMs : 2000,
      5000
    );
    await element.evaluate((el, ms) => {
      const doc = el.ownerDocument;
      const rect = el.getBoundingClientRect();
      const overlay = doc.createElement("div");
      overlay.style.cssText =
        "position:fixed;z-index:2147483647;pointer-events:none;border:3px solid #ff4d4f;" +
        "border-radius:4px;background:rgba(255,77,79,0.15);" +
        "left:" + String(rect.left - 3) + "px;top:" + String(rect.top - 3) + "px;" +
        "width:" + String(rect.width) + "px;height:" + String(rect.height) + "px;";
      doc.body.appendChild(overlay);
      setTimeout(() => overlay.remove(), ms);
    }, durationMs);
    await sleep(300);
    return { page, viewId, summary: "Highlighted " + (request.element ?? request.ref) + " for " + String(durationMs) + "ms" };
  },
  cdp: async ({ request, context, state }) => {
    const method = typeof request.method === "string" ? request.method : "";
    if (!MODEL_CDP_ALLOWLIST.includes(method)) {
      throw new Error(
        "CDP method " + JSON.stringify(method) + " is not available. Only read-only page-inspection commands are allowed here (" + MODEL_CDP_ALLOWLIST.join(", ") + "); use the dedicated browser tools for navigation, clicks, text input, key presses, scrolling, drag-and-drop, and screenshots."
      );
    }
    const { page, viewId } = await resolvePage(request, context, state);
    const session = await context.newCDPSession(page);
    try {
      const result = await session.send(method, request.params && typeof request.params === "object" ? request.params : {});
      let serialized = JSON.stringify(result);
      const max = 20000;
      if (serialized.length > max) {
        serialized = serialized.slice(0, max) + " \u2026(truncated " + String(serialized.length - max) + " chars)";
      }
      return { page, viewId, summary: "Ran CDP " + method, data: serialized };
    } finally {
      await session.detach().catch(() => {});
    }
  },
};

async function run(request) {
  await ensureChrome(request.cdpPort, request.display);
  await reviveDiscardedTabs(request.cdpPort);
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(
    "http://127.0.0.1:" + String(request.cdpPort),
    { timeout: 10000 }
  );
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const state = loadState(request.display);
    const loadedViews = { ...state.views };
    const loadedUrls = { ...state.urls };
    const loadedRefMeta = { ...state.refMeta };
    const loadedLastViewId = state.lastViewId;
    const op = OPS[request.op];
    if (op === undefined) throw new Error("Unknown op: " + String(request.op));
    const result = await op({ request, context, state });
    // Record the view's URL so a discard-churned target can be re-adopted by
    // URL on a later call (see resolvePage).
    if (result.viewId !== undefined && result.page !== undefined) {
      state.urls[result.viewId] = result.page.url();
    }
    // Persist only the entries THIS process changed. state holds a snapshot of
    // the whole file from loadState, and writing it back wholesale would let
    // a concurrent driver call's save clobber fresher mappings with stale
    // ones (e.g. undo the other call's post-discard re-adoption).
    const dirtyViews = {};
    for (const key of Object.keys(state.views)) {
      if (state.views[key] !== loadedViews[key]) dirtyViews[key] = state.views[key];
    }
    const dirtyUrls = {};
    for (const key of Object.keys(state.urls)) {
      if (state.urls[key] !== loadedUrls[key]) dirtyUrls[key] = state.urls[key];
    }
    const dirtyRefMeta = {};
    for (const key of Object.keys(state.refMeta)) {
      if (state.refMeta[key] !== loadedRefMeta[key]) dirtyRefMeta[key] = state.refMeta[key];
    }
    saveState(request.display, {
      views: dirtyViews,
      urls: dirtyUrls,
      refMeta: dirtyRefMeta,
      deletedViews: state.deletedViews,
      // Only when THIS op changed it: an op that never resolves a view (e.g.
      // tabs list) must not write the loaded value back over a concurrent
      // call's fresher one.
      lastViewId: state.lastViewId !== loadedLastViewId ? state.lastViewId : undefined,
    });
    const out = {
      ok: true,
      summary: recoveredRefs.length > 0
        ? result.summary + " (stale ref " + recoveredRefs.join(", ") + " re-resolved by role/name fingerprint; take a fresh browser_snapshot before further ref-based actions)"
        : result.summary,
    };
    if (result.data !== undefined) out.data = result.data;
    if (result.viewId !== undefined) out.viewId = result.viewId;
    if (result.page !== undefined) {
      out.url = result.page.url();
      out.title = await result.page.title().catch(() => "");
      if (typeof request.screenshotPath === "string" && request.screenshotPath.length > 0) {
        mkdirSync(STATE_DIR, { recursive: true });
        await result.page
          .screenshot({
            path: request.screenshotPath,
            timeout: 8000,
            fullPage: result.fullPage === true,
          })
          .then(() => {
            out.screenshot = true;
          })
          .catch(() => {});
      }
    }
    return out;
  } finally {
    await browser.close().catch(() => {});
  }
}

const watchdog = setTimeout(() => {
  process.stdout.write(
    "\\n" + RESULT_MARKER + JSON.stringify({ ok: false, error: "Browser driver timed out after 90s" }) + "\\n"
  );
  process.exit(0);
}, 90000);

(async () => {
  let result;
  try {
    const raw = process.argv[2] ?? "";
    const request = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
    result = await run(request);
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  clearTimeout(watchdog);
  process.stdout.write("\\n" + RESULT_MARKER + JSON.stringify(result) + "\\n");
  process.exit(0);
})();
`;

