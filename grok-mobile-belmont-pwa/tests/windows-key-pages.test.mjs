import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { keyPageDirection, keyPageLayout } from "../src/windows-key-pages.ts";

test("every key remains reachable without a scroll offset at phone and desktop widths", () => {
  for (const count of [5, 10, 36]) for (const width of [0, 224, 334, 624]) for (const minimum of [76, 110]) {
    const first = keyPageLayout(count, width, minimum, 0);
    const indices = [];
    for (let page = 0; page < first.pages; page++) {
      const layout = keyPageLayout(count, width, minimum, page);
      assert.equal(layout.page, page);
      for (let index = layout.start; index < layout.end; index++) indices.push(index);
    }
    assert.deepEqual(indices, Array.from({ length: count }, (_, i) => i));
    assert.equal(keyPageLayout(count, width, minimum, -1).page, 0);
    assert.equal(keyPageLayout(count, width, minimum, 999).page, first.pages - 1);
  }
});

test("resize and empty lists keep a valid page without wrapping or invented keys", () => {
  assert.deepEqual(keyPageLayout(0, 300, 76, 5), { columns: 1, pages: 1, page: 0, start: 0, end: 0 });
  assert.equal(keyPageLayout(10, 624, 76, 5).page, 1);
  assert.equal(keyPageLayout(10, 224, 76, 5).page, 4);
});

test("only deliberate horizontal swipes turn exactly one page", () => {
  for (const [dx, dy, expected] of [[0, 0, 0], [31, 0, 0], [32, 0, -1], [-32, 0, 1], [500, 0, -1], [45, 30, 0], [30, 45, 0], [0, 200, 0], [-60, 20, 1], [60, -20, -1]]) {
    assert.equal(keyPageDirection(dx, dy), expected);
  }
});

test("child-to-pager implicit capture transfer cannot cancel a swipe", async () => {
  const source = await readFile(new URL("../src/components/WindowsKeyPager.tsx", import.meta.url), "utf8");
  assert.match(source, /onLostPointerCapture=\{\(event\) => \{ if \(event\.target === event\.currentTarget\)/u);
  assert.match(source, /if \(event\.pointerType === "touch"\) pendingTouchTurn\.current = state\.direction/u);
  assert.match(source, /onTouchEndCapture=\{\(event\) =>/u);
  assert.match(source, /event\.touches\.length === 0 && direction\) turn\(direction\)/u);
  assert.match(source, /addEventListener\("touchmove", cancelHorizontalGesture, \{ passive: false \}\)/u);
  assert.match(source, /removeEventListener\("touchmove", cancelHorizontalGesture\)/u);
  assert.match(source, /Math\.abs\(dx\) > 10 && Math\.abs\(dx\) > Math\.abs\(dy\) && event\.cancelable/u);
  assert.match(source, /event\.nativeEvent as PointerEvent\)\.pointerType/u);
});
