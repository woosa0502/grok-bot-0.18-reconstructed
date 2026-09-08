import assert from "node:assert/strict";
import test from "node:test";
import { encodeDesktopText, KEY_GROUPS, MODIFIERS, QUICK_KEYS, sendDesktopKey, sendDesktopText } from "../src/windows-keyboard.ts";

test("Ctrl+C presses and releases the chord, not a permanently held Ctrl", () => {
  const calls = [];
  sendDesktopKey({ sendKey: (...args) => calls.push(args) }, 67, 2);
  assert.deepEqual(calls, [[true, 162, 2], [true, 67, 2], [false, 67, 2], [false, 162, 0]]);
});

test("every exposed key and modifier combination balances all presses", () => {
  for (const key of [...QUICK_KEYS, ...KEY_GROUPS.flatMap((group) => group.keys)]) {
    assert.ok(Number.isInteger(key.key) && key.key > 0 && key.key <= 255);
    for (let mask = 0; mask < 16; mask++) {
      const held = new Set();
      sendDesktopKey({ sendKey(down, code, modifiers) {
        assert.ok(modifiers >= 0 && modifiers <= 15);
        if (down) { assert.ok(!held.has(code)); held.add(code); }
        else assert.ok(held.delete(code));
      } }, key.key, mask | (key.modifiers || 0));
      assert.equal(held.size, 0, key.label);
    }
  }
  assert.equal(MODIFIERS.length, 4);
});

test("one failed keyup still attempts to release every modifier", () => {
  const releases = [];
  assert.throws(() => sendDesktopKey({ sendKey(down, code) {
    if (!down) { releases.push(code); if (code === 83) throw new Error("socket lost"); }
  } }, 83, 9), /연결/);
  assert.deepEqual(releases, [83, 91, 160]);
});

test("Unicode and long text round trip with scalar-count headers and bounded packets", () => {
  for (const value of ["", "한글", "한😀é", "A".repeat(256), "가😀".repeat(600)]) {
    const packets = encodeDesktopText(value).map((buffer) => new Uint8Array(buffer));
    let decoded = "";
    for (const packet of packets) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(packet.slice(2));
      assert.equal(packet[0], 1);
      assert.equal(packet[1], Array.from(text).length);
      assert.ok(packet.byteLength <= 252);
      decoded += text;
    }
    assert.equal(decoded, value);
  }
});

test("text has no Enter side effect and is never sent to a missing channel", () => {
  let keys = 0;
  const packets = [];
  const target = { sendKey() { keys++; }, keyboard: { send: (packet) => packets.push(packet) } };
  sendDesktopText(target, "한😀");
  assert.equal(keys, 0);
  assert.equal(packets.length, 1);
  assert.throws(() => sendDesktopText(target, "command\n"), /줄바꿈/);
  assert.throws(() => sendDesktopText({ sendKey() {} }, "hello"), /연결/);
  assert.throws(() => encodeDesktopText("x".repeat(4001)), /4,000/);
});
