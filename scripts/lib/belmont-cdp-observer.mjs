import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, realpath, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_ENDPOINT = "http://127.0.0.1:9347";
const ALLOWED_ACTIONS = new Set(["assert", "click", "drag", "fill", "hover", "press", "screenshot", "scroll", "snapshot", "upload", "wait"]);
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,159}$/u;

export class BelmontCdpError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "BelmontCdpError";
    this.code = code;
    this.details = details;
  }
}

function normalizeEndpoint(raw = DEFAULT_ENDPOINT) {
  const url = new URL(raw);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new BelmontCdpError("INVALID_ENDPOINT", "CDP endpoint must use http or https.");
  if (!new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname)) {
    throw new BelmontCdpError("NON_LOOPBACK_ENDPOINT", "Belmont CDP observer accepts loopback endpoints only.");
  }
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BelmontCdpError("CDP_TIMEOUT", `${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isBelmontTarget(target) {
  if (target?.type !== "page") return false;
  const title = String(target.title ?? "").toLowerCase();
  const url = String(target.url ?? "").toLowerCase();
  return url.includes("belmont") && (title.includes("belmont") || title.includes("grok bot"));
}

export async function discoverBelmontTarget(endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch) {
  const base = normalizeEndpoint(endpoint);
  const listUrl = new URL("/json/list", base);
  let response;
  try {
    response = await withTimeout(fetchImpl(listUrl), 5_000, "CDP target discovery");
  } catch (error) {
    if (error instanceof BelmontCdpError) throw error;
    throw new BelmontCdpError("CDP_DISCOVERY_FAILED", "Could not reach the loopback CDP endpoint.", { cause: error.message });
  }
  if (!response.ok) throw new BelmontCdpError("CDP_DISCOVERY_FAILED", `CDP target discovery returned HTTP ${response.status}.`);
  const targets = await response.json();
  if (!Array.isArray(targets)) throw new BelmontCdpError("CDP_DISCOVERY_INVALID", "CDP target discovery did not return an array.");
  const matchingTargets = targets.filter(isBelmontTarget);
  if (matchingTargets.length > 1) {
    throw new BelmontCdpError("MULTIPLE_BELMONT_TARGETS", "More than one Belmont page is exposed. Stop before mixing product instances.", {
      targets: matchingTargets.map(target => ({ id: target.id, title: target.title, url: target.url })),
    });
  }
  const [target] = matchingTargets;
  if (target == null || typeof target.webSocketDebuggerUrl !== "string") {
    throw new BelmontCdpError("BELMONT_TARGET_NOT_FOUND", "No Belmont Electron page is exposed by this CDP endpoint.");
  }
  return { endpoint: base.origin, target };
}

function normalizeEvent(message) {
  if (message.method === "Runtime.consoleAPICalled") {
    return {
      type: "console",
      level: message.params?.type ?? "unknown",
      text: (message.params?.args ?? []).map(value => value.value ?? value.description ?? value.type ?? "").join(" "),
      timestamp: message.params?.timestamp ?? null,
    };
  }
  if (message.method === "Runtime.exceptionThrown") {
    return {
      type: "exception",
      level: "error",
      text: message.params?.exceptionDetails?.exception?.description ?? message.params?.exceptionDetails?.text ?? "Runtime exception",
      timestamp: message.params?.timestamp ?? null,
    };
  }
  if (message.method === "Log.entryAdded") {
    return {
      type: "log",
      level: message.params?.entry?.level ?? "unknown",
      text: message.params?.entry?.text ?? "",
      url: message.params?.entry?.url ?? null,
      lineNumber: message.params?.entry?.lineNumber ?? null,
      timestamp: message.params?.entry?.timestamp ?? null,
    };
  }
  return null;
}

export class BelmontCdpClient {
  constructor({ endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch, WebSocketImpl = WebSocket, commandTimeoutMs = 10_000 } = {}) {
    this.endpoint = endpoint;
    this.fetchImpl = fetchImpl;
    this.WebSocketImpl = WebSocketImpl;
    this.commandTimeoutMs = commandTimeoutMs;
    this.pending = new Map();
    this.events = [];
    this.nextId = 1;
    this.socket = null;
    this.target = null;
  }

  async connect() {
    const discovered = await discoverBelmontTarget(this.endpoint, this.fetchImpl);
    this.endpoint = discovered.endpoint;
    this.target = discovered.target;
    const socket = new this.WebSocketImpl(this.target.webSocketDebuggerUrl);
    this.socket = socket;
    socket.addEventListener("message", ({ data }) => this.#onMessage(data));
    socket.addEventListener("close", () => this.#rejectPending(new BelmontCdpError("CDP_DISCONNECTED", "Belmont CDP connection closed.")));
    await withTimeout(new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new BelmontCdpError("CDP_CONNECT_FAILED", "Could not connect to Belmont CDP WebSocket.")), { once: true });
    }), 5_000, "CDP WebSocket connection");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
    await this.send("Page.enable");
    return this.target;
  }

  #onMessage(data) {
    const message = JSON.parse(String(data));
    if (message.id != null && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new BelmontCdpError("CDP_COMMAND_FAILED", JSON.stringify(message.error), message.error));
      else pending.resolve(message.result);
      return;
    }
    const event = normalizeEvent(message);
    if (event != null) this.events.push(event);
  }

  #rejectPending(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  send(method, params = {}) {
    if (this.socket == null || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      return Promise.reject(new BelmontCdpError("CDP_NOT_CONNECTED", "Belmont CDP client is not connected."));
    }
    const id = this.nextId++;
    const pending = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.socket.send(JSON.stringify({ id, method, params }));
    return withTimeout(pending, this.commandTimeoutMs, method).finally(() => this.pending.delete(id));
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (response.exceptionDetails) throw new BelmontCdpError("PAGE_EVALUATION_FAILED", response.exceptionDetails.text ?? "Page evaluation failed.", response.exceptionDetails);
    return response.result?.value;
  }

  async screenshot(filePath) {
    const response = await this.send("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(filePath, Buffer.from(response.data, "base64"));
  }

  clearEvents() {
    this.events.length = 0;
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}

function pageExpression(operation, payload) {
  return `(() => {
    const operation = ${JSON.stringify(operation)};
    const payload = ${JSON.stringify(payload)};
    const normalize = value => String(value ?? "").replace(/\\s+/gu, " ").trim();
    const visible = node => {
      if (!(node instanceof Element) || node.getClientRects().length === 0) return false;
      const style = getComputedStyle(node);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const roleOf = node => {
      const explicit = node.getAttribute("role");
      if (explicit) return explicit;
      if (node.tagName === "BUTTON") return "button";
      if (node.tagName === "A" && node.hasAttribute("href")) return "link";
      if (node.tagName === "TEXTAREA" || node.isContentEditable) return "textbox";
      if (node.tagName === "SELECT") return "combobox";
      if (node.tagName === "INPUT") {
        const type = (node.getAttribute("type") || "text").toLowerCase();
        if (["button", "submit", "reset"].includes(type)) return "button";
        if (type === "checkbox") return "checkbox";
        if (type === "radio") return "radio";
        return "textbox";
      }
      return "";
    };
    const nameOf = node => normalize(node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("placeholder") || node.innerText || node.value);
    const textOf = node => normalize(node.innerText || node.value || node.textContent);
    const locator = payload.locator ?? {};
    let nodes;
    if (typeof locator.css === "string") nodes = Array.from(document.querySelectorAll(locator.css));
    else if (typeof locator.text === "string" && typeof locator.role !== "string" && typeof locator.name !== "string") {
      nodes = Array.from(document.body?.querySelectorAll("*") ?? []);
    } else nodes = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role],[contenteditable='true'],[data-testid]"));
    if (typeof locator.role === "string") nodes = nodes.filter(node => roleOf(node) === locator.role);
    if (typeof locator.name === "string") nodes = nodes.filter(node => locator.exact ? nameOf(node) === normalize(locator.name) : nameOf(node).includes(normalize(locator.name)));
    if (typeof locator.text === "string") {
      const expectedText = normalize(locator.text);
      const textMatches = node => locator.exact ? textOf(node) === expectedText : textOf(node).includes(expectedText);
      nodes = nodes.filter(textMatches);
      if (typeof locator.css !== "string" && typeof locator.role !== "string" && typeof locator.name !== "string") {
        nodes = nodes.filter(node => !Array.from(node.children).some(textMatches));
      }
    }
    if (locator.includeHidden !== true) nodes = nodes.filter(visible);
    const selected = nodes[Number.isInteger(locator.nth) ? locator.nth : 0] ?? null;
    const describe = node => {
      if (node == null) return null;
      const rect = node.getBoundingClientRect();
      return {
        tag: node.tagName,
        role: roleOf(node),
        name: nameOf(node),
        text: textOf(node).slice(0, 1000),
        value: typeof node.value === "string" ? node.value.slice(0, 1000) : null,
        visible: visible(node),
        enabled: !node.disabled && node.getAttribute("aria-disabled") !== "true",
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      };
    };
    if (operation === "locate") return { matches: nodes.length, selected: describe(selected) };
    if (operation === "focus") {
      if (selected == null) return { matches: nodes.length, selected: null };
      selected.focus();
      return { matches: nodes.length, selected: describe(selected), focused: document.activeElement === selected };
    }
    if (operation === "snapshot") {
      const requestedMaxText = Number(payload.maxText);
      const maxText = Math.max(0, Math.min(Number.isFinite(requestedMaxText) ? requestedMaxText : 4000, 20000));
      const interactive = Array.from(document.querySelectorAll("button,a,input,textarea,select,[role],[contenteditable='true'],[data-testid]"))
        .filter(visible).slice(0, 300).map(describe);
      return {
        title: document.title,
        url: location.href,
        readyState: document.readyState,
        bodyText: (document.body?.innerText ?? "").slice(0, maxText),
        activeElement: describe(document.activeElement),
        interactive,
        dimensions: { width: innerWidth, height: innerHeight, devicePixelRatio },
      };
    }
    throw new Error("Unsupported observer page operation");
  })()`;
}

function assertLocator(locator) {
  if (typeof locator !== "object" || locator == null || Array.isArray(locator)) throw new BelmontCdpError("INVALID_LOCATOR", "Step locator must be an object.");
  const dimensions = ["css", "role", "name", "text"].filter(key => typeof locator[key] === "string" && locator[key].length > 0);
  if (dimensions.length === 0) throw new BelmontCdpError("INVALID_LOCATOR", "Locator needs css, role, name, or text.");
  if (locator.nth != null && (!Number.isInteger(locator.nth) || locator.nth < 0)) throw new BelmontCdpError("INVALID_LOCATOR", "Locator nth must be a non-negative integer.");
}

export function validateBelmontCdpPlan(raw) {
  if (typeof raw !== "object" || raw == null || Array.isArray(raw)) throw new BelmontCdpError("INVALID_PLAN", "Plan must be a JSON object.");
  if (raw.schemaVersion !== 1) throw new BelmontCdpError("INVALID_PLAN", "Plan schemaVersion must be 1.");
  if (typeof raw.caseId !== "string" || !SAFE_NAME.test(raw.caseId)) throw new BelmontCdpError("INVALID_PLAN", "Plan caseId must be a safe, stable identifier.");
  if (!Array.isArray(raw.steps) || raw.steps.length === 0 || raw.steps.length > 100) throw new BelmontCdpError("INVALID_PLAN", "Plan needs 1 to 100 steps.");
  raw.steps.forEach((step, index) => {
    if (typeof step !== "object" || step == null || !ALLOWED_ACTIONS.has(step.action)) throw new BelmontCdpError("INVALID_PLAN", `Unsupported step ${index + 1}.`);
    if (new Set(["assert", "click", "drag", "fill", "hover"]).has(step.action)) assertLocator(step.locator);
    if (step.action === "drag") {
      if (!Number.isFinite(step.deltaX) && !Number.isFinite(step.deltaY)) throw new BelmontCdpError("INVALID_PLAN", `drag step ${index + 1} needs a finite deltaX and/or deltaY.`);
      for (const key of ["deltaX", "deltaY"]) {
        if (step[key] != null && (!Number.isFinite(step[key]) || Math.abs(step[key]) > 4000)) throw new BelmontCdpError("INVALID_PLAN", `drag step ${index + 1} ${key} must be a finite number with magnitude <= 4000.`);
      }
    }
    if (new Set(["click", "hover"]).has(step.action) && step.modifiers != null) {
      const validModifiers = new Set(["ALT", "CTRL", "META", "SHIFT"]);
      if (!Array.isArray(step.modifiers) || step.modifiers.some(value => !validModifiers.has(String(value).toUpperCase()))) {
        throw new BelmontCdpError("INVALID_PLAN", `${step.action} step ${index + 1} modifiers must be an array of ALT, CTRL, META, SHIFT.`);
      }
    }
    if (step.action === "press" && (typeof step.key !== "string" || step.key.length === 0)) throw new BelmontCdpError("INVALID_PLAN", `press step ${index + 1} needs a key.`);
    if (step.action === "fill" && typeof step.text !== "string") throw new BelmontCdpError("INVALID_PLAN", `fill step ${index + 1} needs text.`);
    if (step.action === "upload") {
      if (typeof step.locator?.css !== "string" || step.locator.css.length === 0 || Object.keys(step.locator).some(key => !["css", "nth", "includeHidden"].includes(key))) {
        throw new BelmontCdpError("INVALID_PLAN", `upload step ${index + 1} needs a CSS-only locator.`);
      }
      if (!Array.isArray(step.files) || step.files.length === 0 || step.files.length > 10 || step.files.some(file => typeof file !== "string" || !path.isAbsolute(file))) {
        throw new BelmontCdpError("INVALID_PLAN", `upload step ${index + 1} needs 1 to 10 absolute file paths.`);
      }
    }
    if (new Set(["screenshot", "snapshot"]).has(step.action) && (typeof step.name !== "string" || !SAFE_NAME.test(step.name))) throw new BelmontCdpError("INVALID_PLAN", `${step.action} step ${index + 1} needs a safe name.`);
  });
  return raw;
}

async function locate(client, locator, operation = "locate") {
  return await client.evaluate(pageExpression(operation, { locator }));
}

function pointOf(result) {
  if (result?.selected == null || !result.selected.visible) throw new BelmontCdpError("LOCATOR_NOT_FOUND", "No visible element matched the locator.", result);
  const { x, y, width, height } = result.selected.rect;
  return { x: x + width / 2, y: y + height / 2 };
}

function modifierMask(modifiers = []) {
  const normalized = modifiers.map(value => String(value).toUpperCase());
  return (normalized.includes("ALT") ? 1 : 0) | (normalized.includes("CTRL") ? 2 : 0) | (normalized.includes("META") ? 4 : 0) | (normalized.includes("SHIFT") ? 8 : 0);
}

async function hover(client, locator, modifiers = []) {
  const target = await locate(client, locator);
  const point = pointOf(target);
  const mask = modifierMask(modifiers);
  // A single teleporting mouseMoved does not always register as a pointer
  // "enter" transition for React onPointerEnter-style handlers, even though
  // it reliably drives CSS :hover. Dispatch one settling move just outside
  // the target first so the browser sees a real enter transition onto it.
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.max(0, point.x - 2), y: Math.max(0, point.y - 2), modifiers: mask });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point, modifiers: mask });
  return target;
}

async function drag(client, locator, deltaX = 0, deltaY = 0, steps = 8) {
  const target = await locate(client, locator);
  const from = pointOf(target);
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", clickCount: 1 });
  const stepCount = Math.max(1, Math.min(Math.trunc(steps) || 8, 40));
  let to = from;
  for (let index = 1; index <= stepCount; index += 1) {
    to = { x: from.x + (deltaX * index) / stepCount, y: from.y + (deltaY * index) / stepCount };
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...to, button: "left" });
  }
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", clickCount: 1 });
  return { from, to };
}

async function click(client, locator, button = "left", clickCount = 1, modifiers = []) {
  const target = await hover(client, locator, modifiers);
  const point = pointOf(target);
  const mask = modifierMask(modifiers);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button, clickCount, modifiers: mask });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button, clickCount, modifiers: mask });
  return target;
}

const KEY_DEFINITIONS = Object.freeze({
  Enter: ["Enter", "Enter", 13], Escape: ["Escape", "Escape", 27], Tab: ["Tab", "Tab", 9], Backspace: ["Backspace", "Backspace", 8],
  ArrowUp: ["ArrowUp", "ArrowUp", 38], ArrowDown: ["ArrowDown", "ArrowDown", 40], ArrowLeft: ["ArrowLeft", "ArrowLeft", 37], ArrowRight: ["ArrowRight", "ArrowRight", 39],
  Space: [" ", "Space", 32], Delete: ["Delete", "Delete", 46], Home: ["Home", "Home", 36], End: ["End", "End", 35],
  ";": [";", "Semicolon", 186], "=": ["=", "Equal", 187], ",": [",", "Comma", 188], "-": ["-", "Minus", 189], ".": [".", "Period", 190],
  "/": ["/", "Slash", 191], "`": ["`", "Backquote", 192], "[": ["[", "BracketLeft", 219], "\\": ["\\", "Backslash", 220], "]": ["]", "BracketRight", 221], "'": ["'", "Quote", 222],
  "+": ["+", "Equal", 187], "_": ["_", "Minus", 189], "<": ["<", "Comma", 188], ">": [">", "Period", 190], "?": ["?", "Slash", 191],
  ":": [":", "Semicolon", 186], "{": ["{", "BracketLeft", 219], "|": ["|", "Backslash", 220], "}": ["}", "BracketRight", 221], "\"": ["\"", "Quote", 222], "~": ["~", "Backquote", 192],
  "!": ["!", "Digit1", 49], "@": ["@", "Digit2", 50], "#": ["#", "Digit3", 51], "$": ["$", "Digit4", 52], "%": ["%", "Digit5", 53],
  "^": ["^", "Digit6", 54], "&": ["&", "Digit7", 55], "*": ["*", "Digit8", 56], "(": ["(", "Digit9", 57], ")": [")", "Digit0", 48],
  F1: ["F1", "F1", 112], F2: ["F2", "F2", 113], F3: ["F3", "F3", 114], F4: ["F4", "F4", 115], F5: ["F5", "F5", 116], F6: ["F6", "F6", 117],
  F7: ["F7", "F7", 118], F8: ["F8", "F8", 119], F9: ["F9", "F9", 120], F10: ["F10", "F10", 121], F11: ["F11", "F11", 122], F12: ["F12", "F12", 123],
});

function keyDefinition(key) {
  if (KEY_DEFINITIONS[key]) return KEY_DEFINITIONS[key];
  if (key.length === 1 && /[a-z0-9]/iu.test(key)) {
    const upper = key.toUpperCase();
    return [key, /[a-z]/iu.test(key) ? `Key${upper}` : `Digit${key}`, upper.charCodeAt(0)];
  }
  throw new BelmontCdpError("UNSUPPORTED_KEY", `Unsupported key: ${key}`);
}

async function press(client, key, modifiers = []) {
  const mask = modifierMask(modifiers);
  const [keyValue, code, virtualKeyCode] = keyDefinition(key);
  const printable = keyValue.length === 1 && (mask & 7) === 0 ? keyValue : "";
  const params = { key: keyValue, code, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode, modifiers: mask };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...params, text: printable });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...params });
}

async function fill(client, locator, text) {
  await click(client, locator);
  await press(client, "a", ["CTRL"]);
  await press(client, "Backspace");
  if (text.length > 0) await client.send("Input.insertText", { text });
  return await locate(client, locator);
}

async function upload(client, locator, files) {
  const resolvedFiles = [];
  for (const file of files) {
    let resolved;
    let metadata;
    try {
      resolved = await realpath(file);
      metadata = await stat(resolved);
    } catch (error) {
      throw new BelmontCdpError("UPLOAD_FILE_UNAVAILABLE", `Upload file is unavailable: ${file}`, { cause: error instanceof Error ? error.message : String(error) });
    }
    if (!metadata.isFile()) throw new BelmontCdpError("UPLOAD_FILE_INVALID", `Upload path is not a regular file: ${file}`);
    resolvedFiles.push(resolved);
  }
  const document = await client.send("DOM.getDocument", { depth: 1, pierce: true });
  const rootNodeId = document?.root?.nodeId;
  if (!Number.isInteger(rootNodeId)) throw new BelmontCdpError("UPLOAD_TARGET_UNAVAILABLE", "CDP did not return a document root for file upload.");
  const matches = await client.send("DOM.querySelectorAll", { nodeId: rootNodeId, selector: locator.css });
  const nodeIds = Array.isArray(matches?.nodeIds) ? matches.nodeIds : [];
  const selected = nodeIds[Number.isInteger(locator.nth) ? locator.nth : 0];
  if (!Number.isInteger(selected)) throw new BelmontCdpError("LOCATOR_NOT_FOUND", "No file input matched the upload locator.", { matches: nodeIds.length });
  await client.send("DOM.setFileInputFiles", { files: resolvedFiles, nodeId: selected });
  return { matches: nodeIds.length, selectedNodeId: selected, files: resolvedFiles.map(file => path.basename(file)) };
}

function expectationResult(observation, expect) {
  const checks = [];
  if ("visible" in expect) checks.push({ name: "visible", expected: expect.visible, actual: observation.selected?.visible ?? false });
  if ("hidden" in expect) checks.push({ name: "hidden", expected: expect.hidden, actual: observation.selected == null || !observation.selected.visible });
  if ("enabled" in expect) checks.push({ name: "enabled", expected: expect.enabled, actual: observation.selected?.enabled ?? false });
  if ("count" in expect) checks.push({ name: "count", expected: expect.count, actual: observation.matches });
  if ("textIncludes" in expect) checks.push({ name: "textIncludes", expected: expect.textIncludes, actual: observation.selected?.text ?? "", passed: (observation.selected?.text ?? "").includes(expect.textIncludes) });
  if ("textEquals" in expect) checks.push({ name: "textEquals", expected: expect.textEquals, actual: observation.selected?.text ?? "", passed: (observation.selected?.text ?? "") === expect.textEquals });
  for (const check of checks) check.passed ??= Object.is(check.actual, check.expected);
  return { passed: checks.length > 0 && checks.every(check => check.passed), checks };
}

async function runAssertion(client, step) {
  if (typeof step.expect !== "object" || step.expect == null) throw new BelmontCdpError("INVALID_ASSERTION", "assert step needs an expect object.");
  const timeoutMs = Math.max(0, Math.min(Number(step.timeoutMs) || 0, 30_000));
  const deadline = Date.now() + timeoutMs;
  let observation;
  let result;
  do {
    observation = await locate(client, step.locator);
    result = expectationResult(observation, step.expect);
    if (result.passed) return { observation, ...result };
    if (Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new BelmontCdpError("ASSERTION_FAILED", "Page assertion failed.", { observation, ...result });
}

async function executeStep(client, step, evidenceDir) {
  if (step.action === "assert") return await runAssertion(client, step);
  if (step.action === "click") return await click(client, step.locator, step.button ?? "left", step.clickCount ?? 1, step.modifiers ?? []);
  if (step.action === "hover") return await hover(client, step.locator, step.modifiers ?? []);
  if (step.action === "fill") return await fill(client, step.locator, step.text);
  if (step.action === "upload") return await upload(client, step.locator, step.files);
  if (step.action === "drag") return await drag(client, step.locator, Number(step.deltaX) || 0, Number(step.deltaY) || 0, step.steps);
  if (step.action === "press") {
    if (step.locator != null) { assertLocator(step.locator); await click(client, step.locator); }
    await press(client, step.key, step.modifiers ?? []);
    return { key: step.key, modifiers: step.modifiers ?? [] };
  }
  if (step.action === "scroll") {
    const dimensions = await client.evaluate("({ width: innerWidth, height: innerHeight })");
    await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: dimensions.width / 2, y: dimensions.height / 2, deltaX: Number(step.deltaX) || 0, deltaY: Number(step.deltaY) || 0 });
    return { deltaX: Number(step.deltaX) || 0, deltaY: Number(step.deltaY) || 0 };
  }
  if (step.action === "wait") {
    const ms = Math.max(0, Math.min(Number(step.ms) || 0, 30_000));
    await new Promise(resolve => setTimeout(resolve, ms));
    return { ms };
  }
  if (step.action === "snapshot") {
    const output = path.join(evidenceDir, `${step.name}.json`);
    const snapshot = await client.evaluate(pageExpression("snapshot", { maxText: step.maxText }));
    await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    return { output };
  }
  if (step.action === "screenshot") {
    const output = path.join(evidenceDir, `${step.name}.png`);
    await client.screenshot(output);
    return { output };
  }
  throw new BelmontCdpError("UNSUPPORTED_ACTION", `Unsupported action: ${step.action}`);
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await rename(temporary, filePath);
}

export function validateBelmontRuntimeLineage(runtimeLineage, client) {
  if (typeof runtimeLineage !== "object" || runtimeLineage == null || Array.isArray(runtimeLineage)) {
    throw new BelmontCdpError("RUN_LINEAGE_REQUIRED", "A runtime-lineage.json from the active Belmont launcher is required for a test run.");
  }
  if (runtimeLineage.schemaVersion !== 1 || typeof runtimeLineage.runtimeGenerationId !== "string" || runtimeLineage.runtimeGenerationId.length === 0) {
    throw new BelmontCdpError("RUN_LINEAGE_INVALID", "The Belmont runtime lineage has an unsupported schema or no generation ID.");
  }
  if (runtimeLineage.debugEndpoint !== client.endpoint) {
    throw new BelmontCdpError("RUN_LINEAGE_MISMATCH", "The Belmont runtime lineage does not describe the connected CDP endpoint.", {
      lineageEndpoint: runtimeLineage.debugEndpoint,
      connectedEndpoint: client.endpoint,
    });
  }
  if (typeof runtimeLineage.git?.head !== "string" || !/^[0-9a-f]{40}$/u.test(runtimeLineage.git.head)) {
    throw new BelmontCdpError("RUN_LINEAGE_INVALID", "The Belmont runtime lineage does not contain a full Git HEAD.");
  }
  if (typeof runtimeLineage.profileDir !== "string" || !path.isAbsolute(runtimeLineage.profileDir)) {
    throw new BelmontCdpError("RUN_LINEAGE_INVALID", "The Belmont runtime lineage does not contain an absolute profile path.");
  }
  if (runtimeLineage.build?.source?.sourceIdentity?.head !== runtimeLineage.git.head
    || runtimeLineage.build?.source?.sourceIdentity?.combinedSha256 !== runtimeLineage.git.sourceIdentitySha256) {
    throw new BelmontCdpError("RUN_LINEAGE_INVALID", "The Belmont runtime lineage does not bind the running artifacts to the recorded source identity.");
  }
  for (const name of ["runner", "host", "electron"]) {
    const processRecord = runtimeLineage.processes?.[name];
    if (!Number.isInteger(processRecord?.pid) || processRecord.pid < 1 || typeof processRecord.startedAt !== "string") {
      throw new BelmontCdpError("RUN_LINEAGE_INVALID", `The Belmont runtime lineage has no valid ${name} process record.`);
    }
  }
  return runtimeLineage;
}

async function ensureRunIdentity(runDir, client, startedAt, rawRuntimeLineage) {
  const runPath = path.join(runDir, "run.json");
  const existing = await readFile(runPath, "utf8").then(JSON.parse).catch(error => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  const runtimeLineage = validateBelmontRuntimeLineage(rawRuntimeLineage, client);
  const identity = {
    schemaVersion: 2,
    startedAt,
    endpoint: client.endpoint,
    targetId: client.target.id,
    targetUrl: client.target.url,
    targetTitle: client.target.title,
    runtimeLineage,
  };
  if (existing == null) {
    await writeJsonAtomic(runPath, identity);
    return identity;
  }
  if (existing.schemaVersion !== identity.schemaVersion
    || existing.endpoint !== identity.endpoint
    || existing.targetId !== identity.targetId
    || existing.targetUrl !== identity.targetUrl
    || existing.runtimeLineage?.runtimeGenerationId !== runtimeLineage.runtimeGenerationId) {
    throw new BelmontCdpError("RUN_GENERATION_CHANGED", "Belmont CDP target changed. Start a new run directory instead of mixing runtime generations.", { existing, current: identity });
  }
  return existing;
}

export async function observeBelmontPlan({ client, plan: rawPlan, runDir, runtimeLineage, now = () => new Date() }) {
  const plan = validateBelmontCdpPlan(rawPlan);
  const absoluteRunDir = path.resolve(runDir);
  await mkdir(absoluteRunDir, { recursive: true });
  const startedAt = now().toISOString();
  await ensureRunIdentity(absoluteRunDir, client, startedAt, runtimeLineage);
  const observationId = `OBS-${startedAt.replace(/[-:.TZ]/gu, "")}-${randomUUID().slice(0, 8)}`;
  const evidenceDir = path.join(absoluteRunDir, "evidence", plan.caseId, observationId);
  await mkdir(evidenceDir, { recursive: true });
  client.clearEvents();
  const record = {
    schemaVersion: 1,
    observationId,
    caseId: plan.caseId,
    description: plan.description ?? null,
    expectedBehavior: plan.expectedBehavior ?? null,
    startedAt,
    finishedAt: null,
    executionStatus: "RUNNING",
    provisionalVerdict: "REVIEW_REQUIRED",
    target: { id: client.target.id, title: client.target.title, url: client.target.url },
    steps: [],
    evidence: {},
    consoleAndPageErrors: [],
  };
  let assertionCount = 0;
  try {
    const beforeScreenshot = path.join(evidenceDir, "before.png");
    const beforeSnapshot = path.join(evidenceDir, "before.json");
    await client.screenshot(beforeScreenshot);
    await writeFile(beforeSnapshot, `${JSON.stringify(await client.evaluate(pageExpression("snapshot", { maxText: 4000 })), null, 2)}\n`);
    record.evidence.beforeScreenshot = beforeScreenshot;
    record.evidence.beforeSnapshot = beforeSnapshot;
    for (let index = 0; index < plan.steps.length; index += 1) {
      const step = plan.steps[index];
      const stepStartedAt = now().toISOString();
      try {
        const result = await executeStep(client, step, evidenceDir);
        if (step.action === "assert") assertionCount += 1;
        record.steps.push({ index: index + 1, action: step.action, startedAt: stepStartedAt, finishedAt: now().toISOString(), status: "COMPLETE", result });
      } catch (error) {
        record.steps.push({ index: index + 1, action: step.action, startedAt: stepStartedAt, finishedAt: now().toISOString(), status: "FAILED", error: { code: error.code ?? "UNEXPECTED", message: error.message, details: error.details } });
        throw error;
      }
    }
    record.executionStatus = "ACTION_COMPLETE";
    record.provisionalVerdict = assertionCount > 0 ? "PROVISIONAL_PASS" : "REVIEW_REQUIRED";
  } catch (error) {
    record.executionStatus = error.code === "ASSERTION_FAILED" ? "ASSERTION_FAILED" : "HARNESS_ERROR";
    record.provisionalVerdict = error.code === "ASSERTION_FAILED" ? "PROVISIONAL_FAIL" : "NO_PRODUCT_VERDICT";
    record.error = { code: error.code ?? "UNEXPECTED", message: error.message, details: error.details };
  } finally {
    const afterScreenshot = path.join(evidenceDir, "after.png");
    const afterSnapshot = path.join(evidenceDir, "after.json");
    const evidenceCaptureErrors = [];
    await client.screenshot(afterScreenshot)
      .then(() => { record.evidence.afterScreenshot = afterScreenshot; })
      .catch(error => evidenceCaptureErrors.push({ artifact: "afterScreenshot", code: error.code ?? "UNEXPECTED", message: error.message }));
    await client.evaluate(pageExpression("snapshot", { maxText: 4000 }))
      .then(snapshot => writeFile(afterSnapshot, `${JSON.stringify(snapshot, null, 2)}\n`))
      .then(() => { record.evidence.afterSnapshot = afterSnapshot; })
      .catch(error => evidenceCaptureErrors.push({ artifact: "afterSnapshot", code: error.code ?? "UNEXPECTED", message: error.message }));
    if (evidenceCaptureErrors.length > 0) record.evidenceCaptureErrors = evidenceCaptureErrors;
    record.consoleAndPageErrors = client.events.filter(event => event.level === "error" || event.type === "exception");
    record.finishedAt = now().toISOString();
    await appendFile(path.join(absoluteRunDir, "observations.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
    await writeJsonAtomic(path.join(absoluteRunDir, "checkpoint.json"), {
      schemaVersion: 1,
      lastObservedCaseId: plan.caseId,
      lastObservationId: observationId,
      lastExecutionStatus: record.executionStatus,
      updatedAt: record.finishedAt,
      finalVerdictStillRequired: true,
    });
  }
  return record;
}

export async function snapshotBelmont(client, maxText = 4000) {
  return await client.evaluate(pageExpression("snapshot", { maxText }));
}

export const BELMONT_CDP_DEFAULT_ENDPOINT = DEFAULT_ENDPOINT;
