import assert from "node:assert/strict";
import { test } from "node:test";
import { codecFromAccessUnit, createAnnexBSplitter, ffmpegArgs, hasParameterSets, keyCommandsForText, nalType } from "../screen-stream.mjs";

const nal = (type, ...payload) => Buffer.from([0, 0, 0, 1, type, ...payload]);

test("annex-b splitter groups NALs into access units at AUD boundaries and flags IDR units", () => {
  const splitter = createAnnexBSplitter();
  const stream = Buffer.concat([
    nal(9, 0xf0), nal(7, 0x42, 0xe0, 0x1e), nal(8, 0xce), nal(5, 0x88, 0x84),
    nal(9, 0xf0), nal(1, 0x9a, 0x1b),
    nal(9, 0xf0), nal(1, 0x9a, 0x1c),
  ]);
  const units = [];
  for (let i = 0; i < stream.length; i += 7) units.push(...splitter.push(stream.subarray(i, i + 7)));
  assert.equal(units.length, 2, "the last unit stays pending until the next AUD arrives");
  assert.equal(units[0].key, true);
  assert.equal(units[1].key, false);
  assert.equal(codecFromAccessUnit(units[0].data), "avc1.42E01E");
  assert.equal(hasParameterSets(units[0].data), true);
  assert.equal(hasParameterSets(units[1].data), false);
  assert.equal(nalType(units[1].data[4]), 9);
});

test("without AUDs every slice starts a new unit", () => {
  const splitter = createAnnexBSplitter();
  const units = splitter.push(Buffer.concat([nal(7, 0x64, 0x00, 0x28), nal(8, 0xce), nal(5, 0x88), nal(1, 0x9a), nal(1, 0x9b)]));
  assert.equal(units.length, 1, "SPS+PPS+IDR close when the first P slice arrives; the trailing slice waits for the next start code");
  assert.equal(units[0].key, true);
  assert.equal(codecFromAccessUnit(units[0].data), "avc1.640028");
  const more = splitter.push(nal(1, 0x9c));
  assert.equal(more.length, 1);
  assert.equal(more[0].key, false);
});

test("typed text becomes key events that survive shell-like parsing", () => {
  assert.deepEqual(keyCommandsForText("a b\n한"), ["key U0061", "key space", "key U0062", "key Return", "key UD55C"]);
});

test("encoder arguments capture the display and emit an annex-b elementary stream", () => {
  const args = ffmpegArgs({ display: ":99", width: 1280, height: 800, fps: 60, encoder: "nvenc" });
  assert.ok(args.includes("x11grab") && args.includes("1280x800") && args.includes("h264_nvenc") && args.at(-1) === "-" && args.includes("h264"));
  assert.ok(ffmpegArgs({ display: ":99", width: 1, height: 1, fps: 30, encoder: "x264" }).includes("libx264"));
});
