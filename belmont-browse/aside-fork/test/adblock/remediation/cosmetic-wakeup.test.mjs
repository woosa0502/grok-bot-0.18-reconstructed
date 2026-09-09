import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const chromium = process.env.ASIDE_REMEDIATION_CHROMIUM ?? '/home/hoon/chromium-remediation-20260906/src';
const header = fs.readFileSync(path.join(chromium, 'chrome/renderer/aside_adblock/aside_adblock_cosmetic_script.h'), 'utf8');
const script = header.match(/R"ASIDEJS\(([\s\S]*?)\)ASIDEJS"/)[1];

function fixture(generichide = false) {
  let wakes = 0;
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  const observers = [];
  const listeners = new Map();
  class Element {
    constructor(id = '', classes = []) { this.id = id; this.classList = classes; this.children = []; }
    querySelectorAll() { return this.children; }
    getAttribute() { return null; }
  }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.active = false; observers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
  }
  const root = new Element();
  const document = {
    documentElement: root, adoptedStyleSheets: [], baseURI: 'https://fixture.test/',
    querySelectorAll: () => [],
  };
  const context = vm.createContext({
    document, Element, HTMLElement: Element, MutationObserver,
    CSSStyleSheet: class { replaceSync() {} },
    location: { hostname: 'fixture.test' }, URL,
    __asideAdBlockPending() { wakes++; },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, due: clock + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { listeners.set(name, callback); },
  });
  vm.runInContext(script.replace('($1);', `(${JSON.stringify({generichide, hideSelectors: [], proceduralActions: []})});`), context);
  const advance = (ms) => {
    clock += ms;
    let budget = 10000;
    while (budget-- > 0) {
      const due = [...timers].find(([, timer]) => timer.due <= clock);
      if (!due) return;
      timers.delete(due[0]); due[1].fn();
    }
    throw new Error('unbounded idle timer activity');
  };
  const mutate = (node) => {
    root.children.push(node);
    for (const observer of observers) {
      if (observer.active) observer.callback([{ type: 'childList', addedNodes: [node] }]);
    }
  };
  return { context, Element, mutate, advance, timers, listeners, wakes: () => wakes,
    pending: () => JSON.parse(context.__asideAdBlock.takePending() || '{"classes":[],"ids":[]}') };
}

test('a class first appearing after 60 seconds wakes an idle renderer without periodic polling', () => {
  const f = fixture();
  f.advance(60_000);
  assert.equal(f.timers.size, 0, 'no permanently scheduled idle poll');
  assert.equal(f.wakes(), 0);
  f.mutate(new f.Element('late-id', ['late-ad']));
  assert.equal(f.wakes(), 1);
  assert.deepEqual(f.pending(), { classes: ['late-ad'], ids: ['late-id'] });
  f.advance(60_000);
  assert.equal(f.timers.size, 0);
  f.mutate(new f.Element('', ['second-late-ad']));
  assert.equal(f.wakes(), 2, 'a second idle period does not disable delivery');
  assert.deepEqual(f.pending().classes, ['second-late-ad']);
});

test('mutation bursts are coalesced and previously queried keys do not wake native code', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.mutate(new f.Element('', [`ad-${i}`]));
  assert.equal(f.wakes(), 1);
  assert.equal(f.pending().classes.length, 100);
  for (let i = 0; i < 100; i++) f.mutate(new f.Element('', [`ad-${i}`]));
  assert.equal(f.wakes(), 1);
  assert.deepEqual(f.pending(), { classes: [], ids: [] });
  f.mutate(new f.Element('', ['new-ad']));
  assert.equal(f.wakes(), 2);
});

test('generic hiding disable/re-enable and persisted-page resume preserve collection', () => {
  const f = fixture(true);
  f.mutate(new f.Element('', ['deferred-ad']));
  assert.equal(f.wakes(), 0);
  f.context.__asideAdBlock.setGenerichide(false);
  f.context.__asideAdBlock.recollect();
  assert.equal(f.wakes(), 1);
  assert.deepEqual(f.pending().classes, ['deferred-ad']);
  f.listeners.get('pagehide')();
  f.mutate(new f.Element('', ['bf-cache-ad']));
  assert.equal(f.wakes(), 1);
  f.listeners.get('pageshow')({ persisted: true });
  assert.equal(f.wakes(), 2);
  assert.deepEqual(f.pending().classes, ['bf-cache-ad']);
});

const resourceRoot = path.join(chromium, 'chrome/browser/aside_adblock/resources/ubol');
test('real Chartbeat and analytics surrogates expose APIs and complete callbacks', () => {
  const context = vm.createContext({ setTimeout: (fn) => fn(), document: { querySelectorAll: () => [] } });
  vm.runInContext('window = globalThis; self = globalThis; dataLayer = []; callbacks = 0;', context);
  vm.runInContext(fs.readFileSync(path.join(resourceRoot, 'chartbeat.js'), 'utf8'), context);
  assert.equal(vm.runInContext('typeof pSUPERFLY.activity', context), 'function');
  vm.runInContext(fs.readFileSync(path.join(resourceRoot, 'google-analytics_analytics.js'), 'utf8'), context);
  vm.runInContext('ga("send", {hitCallback() { callbacks++; }}); dataLayer.push({eventCallback() { callbacks++; }});', context);
  assert.equal(context.callbacks, 2, 'empty JavaScript cannot satisfy these APIs');
});

test('Fingerprint surrogate resolves both callback and promise interfaces', async () => {
  const context = vm.createContext({ setTimeout: (fn) => fn() });
  vm.runInContext('self = globalThis; callbackSize = -1;', context);
  vm.runInContext(fs.readFileSync(path.join(resourceRoot, 'fingerprint2.js'), 'utf8'), context);
  vm.runInContext('Fingerprint2.get(values => callbackSize = values.length)', context);
  assert.equal(context.callbackSize, 0);
  assert.equal((await vm.runInContext('Fingerprint2.getPromise()', context)).length, 0);
  assert.equal(vm.runInContext('Fingerprint2.getV18().length', context), 32);
});
