// Driver-level guards adopted from the Aside review (2026-09-01 user decision):
//   1. Credential isolation — browser_type/browser_fill refuse password and
//      card/OTP fields unconditionally; secrets never pass through the model.
//   2. Sensitive-action gate — payment/money controls and login/signup
//      submissions are blocked until retried with confirmed: true after the
//      user's explicit approval; ordinary clicks run free (the middle path).
//   3. Ref identity recovery — the snapshot persists a role/name/nth
//      fingerprint per ref, and a stale ref (navigation wiped the page
//      globals, or a framework re-render replaced the node) is re-resolved by
//      that fingerprint instead of failing the click.
// The ops run here are the real in-box driver ops, extracted the same way the
// CDP allowlist test does, against a minimal fake DOM/page/context.
import assert from "node:assert/strict";
import { test } from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function loadDriverSource() {
  const result = await build({
    stdin: {
      resolveDir: repoRoot,
      loader: "ts",
      sourcefile: "browser-guards-entry.ts",
      contents: `
        export { SAND_BROWSER_DRIVER_SOURCE } from "./source/host/runner/tools/sand-browser-driver-source.js";
      `,
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    supported: { using: false },
  });
  const code = result.outputFiles[0].text;
  const module = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  return module.SAND_BROWSER_DRIVER_SOURCE;
}

// Imports the driver's op table plus the in-page functions under test. The
// driver is a self-executing argv script; everything above the watchdog is
// pure declaration (same extraction as browser-cdp-allowlist.test.mjs).
async function loadDriver() {
  const source = await loadDriverSource();
  const cut = source.indexOf("const watchdog = setTimeout(");
  assert.ok(cut > 0, "driver source should still end with the watchdog and argv IIFE");
  const moduleText = `${source.slice(0, cut)}\nexport { OPS, SNAPSHOT_FN, SECRET_FIELD_FN, SENSITIVE_ACTION_FN };\n`;
  const encoded = Buffer.from(moduleText).toString("base64");
  return await import(`data:text/javascript;base64,${encoded}`);
}

const driverPromise = loadDriver();

// ---------------------------------------------------------------------------
// Minimal DOM standing in for the page. Only what the in-page functions
// actually touch: tagName/attributes/children/closest/querySelector plus the
// visibility accessors the snapshot walk reads.
// ---------------------------------------------------------------------------

class FakeElement {
  constructor({ tag = "div", attrs = {}, text = "", value, interactive = false, children = [] }) {
    this.tag = tag;
    this.attrs = attrs;
    this.text = text;
    if (value !== undefined) this.value = value;
    this.interactive = interactive;
    this.childList = children;
    this.disabled = false;
    this.nodeType = 1;
    this._connected = true;
    this.clicks = 0;
    for (const child of children) child.parent = this;
  }

  get tagName() { return this.tag.toUpperCase(); }
  get children() { return this.childList; }
  get innerText() { return this.text; }
  get isConnected() { return this._connected !== false; }
  getAttribute(name) { return this.attrs[name] ?? null; }
  matches() { return this.interactive; }
  getBoundingClientRect() { return { width: 10, height: 10, left: 0, top: 0 }; }

  #descendants() {
    const all = [];
    const collect = (node) => {
      for (const child of node.childList) {
        all.push(child);
        collect(child);
      }
    };
    collect(this);
    return all;
  }

  querySelector(selector) {
    const all = this.#descendants();
    if (selector === 'input[type="password"]') {
      return all.find((n) => n.tag === "input" && n.attrs.type === "password") ?? null;
    }
    return all.find((n) => n.interactive) ?? null;
  }

  closest(selector) {
    const isControl = (n) =>
      ["button", "input", "select", "summary"].includes(n.tag)
      || (n.tag === "a" && n.attrs.href != null)
      || n.attrs.role === "button" || n.attrs.role === "link"
      || n.attrs.onclick != null;
    let node = this;
    while (node != null) {
      if (selector === "form" ? node.tag === "form" : isControl(node)) return node;
      node = node.parent;
    }
    return null;
  }
}

function buildDom() {
  const userField = new FakeElement({ tag: "input", attrs: { type: "text", placeholder: "아이디" }, interactive: true });
  const passwordField = new FakeElement({ tag: "input", attrs: { type: "password", placeholder: "비밀번호" }, interactive: true });
  const loginButton = new FakeElement({ tag: "button", text: "로그인", interactive: true });
  const loginForm = new FakeElement({ tag: "form", children: [userField, passwordField, loginButton] });
  const payButton = new FakeElement({ tag: "button", text: "결제하기", interactive: true });
  const okButtonA = new FakeElement({ tag: "button", text: "확인", interactive: true });
  const okButtonB = new FakeElement({ tag: "button", text: "확인", interactive: true });
  const detailLink = new FakeElement({ tag: "a", attrs: { href: "/detail" }, text: "자세히 보기", interactive: true });
  const body = new FakeElement({ tag: "body", children: [loginForm, payButton, okButtonA, okButtonB, detailLink] });
  return { body, userField, passwordField, loginButton, loginForm, payButton, okButtonA, okButtonB, detailLink };
}

// ---------------------------------------------------------------------------
// Fake playwright page/context. evaluate/evaluateHandle run the REAL in-page
// functions against the fake DOM by installing document/window for the call.
// ---------------------------------------------------------------------------

function buildPage(dom) {
  const fakeWindow = {
    HTMLElement: FakeElement,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  };
  const fakeDocument = {
    body: dom.body,
    querySelector: (sel) => dom.body.querySelector(sel),
    elementFromPoint: () => page.pointTarget ?? null,
  };
  Object.defineProperty(fakeDocument, "activeElement", { get: () => page.activeElement ?? null });

  const withDom = async (fn, arg) => {
    const prevDocument = globalThis.document;
    const prevWindow = globalThis.window;
    globalThis.document = fakeDocument;
    globalThis.window = fakeWindow;
    try {
      return fn(arg);
    } finally {
      globalThis.document = prevDocument;
      globalThis.window = prevWindow;
    }
  };

  const wrapElement = (node) => ({
    evaluate: async (fn, arg) => {
      const prevDocument = globalThis.document;
      const prevWindow = globalThis.window;
      globalThis.document = fakeDocument;
      globalThis.window = fakeWindow;
      try {
        return fn(node, arg);
      } finally {
        globalThis.document = prevDocument;
        globalThis.window = prevWindow;
      }
    },
    click: async () => { node.clicks += 1; },
    fill: async (value) => { node.value = value; },
    scrollIntoViewIfNeeded: async () => {},
    boundingBox: async () => ({ x: 0, y: 0, width: 10, height: 10 }),
  });

  const page = {
    typed: [],
    pressed: [],
    mouseClicks: [],
    pointTarget: null,
    activeElement: null,
    isClosed: () => false,
    url: () => "https://example.test/",
    title: async () => "Example",
    setDefaultTimeout: () => {},
    bringToFront: async () => {},
    waitForLoadState: async () => {},
    keyboard: {
      type: async (text) => { page.typed.push(text); },
      press: async (key) => { page.pressed.push(key); },
    },
    mouse: {
      click: async (x, y) => { page.mouseClicks.push([x, y]); },
      wheel: async () => {},
    },
    evaluate: async (fn, arg) => withDom(fn, arg),
    evaluateHandle: async (fn, arg) => {
      const result = await withDom(fn, arg);
      return { asElement: () => (result instanceof FakeElement ? wrapElement(result) : null) };
    },
  };
  const context = {
    pages: () => [page],
    newPage: async () => page,
    newCDPSession: async () => ({
      send: async () => ({ targetInfo: { targetId: "T1" } }),
      detach: async () => {},
    }),
  };
  return { page, context };
}

const freshState = () => ({ views: {}, urls: {}, refMeta: {}, lastViewId: undefined });
const request = (fields) => ({ display: 0, viewId: "v", ...fields });

async function snapshotInto(ops, context, state) {
  delete globalThis.__sandRefs;
  return await ops.snapshot({ request: request({}), context, state });
}

test("snapshot persists role/name/nth fingerprints per ref", async () => {
  const { OPS } = await driverPromise;
  const dom = buildDom();
  const { context } = buildPage(dom);
  const state = freshState();
  const result = await snapshotInto(OPS, context, state);
  assert.match(result.data, /button "결제하기" \[ref=/);

  const refs = state.refMeta.v.refs;
  const byName = (name) => Object.values(refs).filter((meta) => meta.name === name);
  assert.deepEqual(byName("결제하기"), [{ role: "button", name: "결제하기", nth: 0 }]);
  // Two identically-labelled buttons are disambiguated by nth, in walk order.
  assert.deepEqual(byName("확인").map((meta) => meta.nth), [0, 1]);
  assert.equal(state.refMeta.v.opts.interactive, false);
});

test("payment and login clicks are gated until confirmed; ordinary clicks run free", async () => {
  const { OPS } = await driverPromise;
  const dom = buildDom();
  const { context } = buildPage(dom);
  const state = freshState();
  await snapshotInto(OPS, context, state);
  const refOf = (node) => {
    for (const [ref, el] of globalThis.__sandRefs) if (el === node) return ref;
    throw new Error("node has no ref");
  };

  await assert.rejects(
    OPS.click({ request: request({ ref: refOf(dom.payButton) }), context, state }),
    /Sensitive action blocked \(payment\/money control/,
  );
  assert.equal(dom.payButton.clicks, 0);

  // The login button trips the password-form submit check even before keywords.
  await assert.rejects(
    OPS.click({ request: request({ ref: refOf(dom.loginButton) }), context, state }),
    /Sensitive action blocked/,
  );

  // confirmed: true is the user-approved retry.
  await OPS.click({ request: request({ ref: refOf(dom.payButton), confirmed: true }), context, state });
  assert.equal(dom.payButton.clicks, 1);

  // Ordinary controls never see the gate.
  await OPS.click({ request: request({ ref: refOf(dom.okButtonA) }), context, state });
  assert.equal(dom.okButtonA.clicks, 1);
  await OPS.click({ request: request({ ref: refOf(dom.detailLink) }), context, state });
  assert.equal(dom.detailLink.clicks, 1);
});

test("credential fields refuse typing and filling, confirmed or not", async () => {
  const { OPS } = await driverPromise;
  const dom = buildDom();
  const { context, page } = buildPage(dom);
  const state = freshState();
  await snapshotInto(OPS, context, state);
  const refOf = (node) => {
    for (const [ref, el] of globalThis.__sandRefs) if (el === node) return ref;
    throw new Error("node has no ref");
  };
  const passwordRef = refOf(dom.passwordField);

  await assert.rejects(
    OPS.type({ request: request({ ref: passwordRef, text: "hunter2" }), context, state }),
    /credential field \(input type=password\)/,
  );
  // No override: the gate flag must not reach secrets.
  await assert.rejects(
    OPS.type({ request: request({ ref: passwordRef, text: "hunter2", confirmed: true }), context, state }),
    /credential field/,
  );
  await assert.rejects(
    OPS.fill({ request: request({ ref: passwordRef, value: "hunter2" }), context, state }),
    /credential field/,
  );
  assert.deepEqual(page.typed, []);
  assert.equal(dom.passwordField.value, undefined);

  // A plain field types fine…
  await OPS.type({ request: request({ ref: refOf(dom.userField), text: "myuser" }), context, state });
  assert.deepEqual(page.typed, ["myuser"]);

  // …but submit: true in a password form is an Enter-submit and is gated.
  await assert.rejects(
    OPS.type({ request: request({ ref: refOf(dom.userField), text: "again", submit: true }), context, state }),
    /Sensitive action blocked \(pressing Enter submits a form containing a password field/,
  );
  await OPS.type({ request: request({ ref: refOf(dom.userField), text: "again", submit: true, confirmed: true }), context, state });
  assert.ok(page.pressed.includes("Enter"));
});

test("a stale ref is re-resolved by its persisted fingerprint", async () => {
  const { OPS } = await driverPromise;
  const dom = buildDom();
  const { context } = buildPage(dom);
  const state = freshState();
  await snapshotInto(OPS, context, state);
  const refOf = (node) => {
    for (const [ref, el] of globalThis.__sandRefs) if (el === node) return ref;
    throw new Error("node has no ref");
  };
  const payRef = refOf(dom.payButton);
  const okBRef = refOf(dom.okButtonB);

  // Framework re-render: the pay button node is replaced by a fresh one; the
  // live ref map still points at the detached original.
  const newPay = new FakeElement({ tag: "button", text: "결제하기", interactive: true });
  const index = dom.body.childList.indexOf(dom.payButton);
  dom.body.childList[index] = newPay;
  newPay.parent = dom.body;
  dom.payButton._connected = false;

  await OPS.click({ request: request({ ref: payRef, confirmed: true }), context, state });
  assert.equal(newPay.clicks, 1, "the replacement node should receive the click");
  assert.equal(dom.payButton.clicks, 0, "the detached node must not be clicked");

  // Navigation wiped the page globals entirely: nth picks the right one of
  // two identically-labelled candidates.
  delete globalThis.__sandRefs;
  await OPS.click({ request: request({ ref: okBRef }), context, state });
  assert.equal(dom.okButtonB.clicks, 1);
  assert.equal(dom.okButtonA.clicks, 0);

  // Without a fingerprint the original stale-ref error is preserved.
  delete globalThis.__sandRefs;
  await assert.rejects(
    OPS.click({ request: request({ ref: "e99" }), context, state }),
    /Unknown or stale ref "e99"/,
  );
});

test("coordinate clicks and Enter presses hit the same gate", async () => {
  const { OPS } = await driverPromise;
  const dom = buildDom();
  const { context, page } = buildPage(dom);
  const state = freshState();

  page.pointTarget = dom.payButton;
  await assert.rejects(
    OPS.mouse_click_xy({ request: request({ x: 5, y: 5 }), context, state }),
    /Sensitive action blocked \(payment\/money control/,
  );
  assert.deepEqual(page.mouseClicks, []);
  await OPS.mouse_click_xy({ request: request({ x: 5, y: 5, confirmed: true }), context, state });
  assert.deepEqual(page.mouseClicks, [[5, 5]]);

  page.pointTarget = dom.detailLink;
  await OPS.mouse_click_xy({ request: request({ x: 6, y: 6 }), context, state });
  assert.equal(page.mouseClicks.length, 2);

  // Enter with focus inside a password form is a login submission.
  page.activeElement = dom.userField;
  await assert.rejects(
    OPS.press_key({ request: request({ key: "Enter" }), context, state }),
    /Sensitive action blocked \(pressing Enter submits a form containing a password field/,
  );
  await OPS.press_key({ request: request({ key: "Tab" }), context, state });
  await OPS.press_key({ request: request({ key: "Enter", confirmed: true }), context, state });
  page.activeElement = dom.okButtonA;
  await OPS.press_key({ request: request({ key: "Enter" }), context, state });
  assert.deepEqual(page.pressed, ["Tab", "Enter", "Enter"]);
});

test("the sensitive-action detector stays conservative on plain content", async () => {
  const { SENSITIVE_ACTION_FN, SECRET_FIELD_FN } = await driverPromise;
  // A bare div (no control ancestor) never gates, whatever its text says.
  const noisyDiv = new FakeElement({ tag: "div", text: "결제 관련 안내: 로그인 후 이용하세요" });
  assert.equal(SENSITIVE_ACTION_FN(noisyDiv), null);
  // A checkout link gates by keyword even outside any form.
  const checkoutLink = new FakeElement({ tag: "a", attrs: { href: "/checkout" }, text: "Checkout", interactive: true });
  assert.match(String(SENSITIVE_ACTION_FN(checkoutLink)), /payment\/money control/);
  // Card and OTP autocomplete are credential fields.
  for (const auto of ["cc-number", "cc-csc", "one-time-code", "current-password", "new-password"]) {
    const field = new FakeElement({ tag: "input", attrs: { autocomplete: auto }, interactive: true });
    assert.notEqual(SECRET_FIELD_FN(field), null, auto);
  }
  assert.equal(SECRET_FIELD_FN(new FakeElement({ tag: "input", attrs: { type: "email" } })), null);
});
