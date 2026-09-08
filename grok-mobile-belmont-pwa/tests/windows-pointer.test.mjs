import assert from "node:assert/strict";
import test from "node:test";
import { createRelativePointer } from "../src/windows-pointer.ts";

const rect = { width: 1000, height: 1000 };
function setup() {
  const packets = [];
  const input = { streamerSize: [1000, 1000], mouseRelative: { send() {} }, sendMouseMove(x, y) { packets.push([x, y]); } };
  return { pointer: createRelativePointer(), input, packets };
}

test("tiny motion is conserved, immediate, integer and never sends empty packets", () => {
  const { pointer, input, packets } = setup();
  for (let i = 0; i < 10; i++) pointer.move(input, 0.4, -0.4, rect, 1);
  assert.deepEqual(packets.reduce((sum, p) => [sum[0] + p[0], sum[1] + p[1]], [0, 0]), [4, -4]);
  assert.ok(packets.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y) && (x || y)));
});

test("each movement prefix stays within half a host pixel, including direction changes", () => {
  const { pointer, input, packets } = setup();
  input.streamerSize = [1920, 1080];
  let expectedX = 0, expectedY = 0, sentX = 0, sentY = 0, count = 0;
  for (let i = 0; i < 10000; i++) {
    const dx = ((i * 73) % 211 - 105) / 100, dy = ((i * 37) % 197 - 98) / 100;
    expectedX += dx * 1.92 * 1.4; expectedY += dy * 1.08 * 1.4;
    assert.equal(pointer.move(input, dx, dy, rect, 1.4), true);
    while (count < packets.length) { const [x, y] = packets[count++]; sentX += x; sentY += y; }
    assert.ok(Math.abs(expectedX - sentX) <= 0.500000001);
    assert.ok(Math.abs(expectedY - sentY) <= 0.500000001);
  }
});

test("reset, replaced target/channel and changed geometry/sensitivity never replay old residuals", () => {
  for (const boundary of ["reset", "target", "channel", "geometry", "sensitivity"]) {
    const { pointer, input, packets } = setup();
    pointer.move(input, 0.4, 0, rect, 1);
    let next = input, nextRect = rect, speed = 1;
    if (boundary === "reset") pointer.reset();
    if (boundary === "target") next = { ...input };
    if (boundary === "channel") input.mouseRelative = { send() {} };
    if (boundary === "geometry") { nextRect = { width: 2000, height: 2000 }; input.streamerSize = [2000, 2000]; }
    if (boundary === "sensitivity") speed = 1.01;
    pointer.move(next, 0.2, 0, nextRect, speed);
    assert.deepEqual(packets, [], boundary);
  }
});

test("missing channel, send failure, nonfinite and overflow clear residuals", () => {
  for (const failure of ["missing", "throw", "nan", "overflow"]) {
    const { pointer, input, packets } = setup();
    pointer.move(input, 0.4, 0, rect, 1);
    const channel = input.mouseRelative, send = input.sendMouseMove;
    if (failure === "missing") input.mouseRelative = null;
    if (failure === "throw") input.sendMouseMove = () => { throw Error("closed"); };
    const value = failure === "nan" ? NaN : failure === "overflow" ? 100000 : 1;
    assert.equal(pointer.move(input, value, 0, rect, 1), false);
    input.mouseRelative = channel; input.sendMouseMove = send;
    pointer.move(input, 0.2, 0, rect, 1);
    assert.deepEqual(packets, [], failure);
  }
});
