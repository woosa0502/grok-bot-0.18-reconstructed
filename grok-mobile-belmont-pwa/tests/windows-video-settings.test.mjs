import assert from "node:assert/strict";
import test from "node:test";
import { applyWindowsVideoProfile, readWindowsFrameRate, WINDOWS_FRAME_RATE_KEY } from "../src/windows-video-settings.ts";

function storage(entries = []) {
  const values = new Map(entries);
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("60 fps defaults and explicit 30 fps selection survive readback", () => {
  const store = storage();
  assert.equal(readWindowsFrameRate(store), 60);
  store.setItem(WINDOWS_FRAME_RATE_KEY, "30");
  assert.equal(readWindowsFrameRate(store), 30);
  store.setItem(WINDOWS_FRAME_RATE_KEY, "60");
  assert.equal(readWindowsFrameRate(store), 60);
  assert.equal(readWindowsFrameRate({ getItem() { throw Error("blocked"); } }), 60);
});

test("30/60 changes only fps within the protected compatibility profile", () => {
  const original = JSON.stringify({ volume: 0.3, playAudioLocal: true, fps: 120, canvasVsync: false });
  const store = storage([["mlSettings", original]]);
  let baseline;
  for (const fps of [60, 30, 60]) {
    applyWindowsVideoProfile(store, fps);
    const config = JSON.parse(store.getItem("mlSettings"));
    assert.equal(config.fps, fps);
    assert.equal(config.volume, 0.3);
    assert.equal(config.playAudioLocal, true);
    assert.equal(config.videoCodec, "h264");
    assert.deepEqual(config.videoSizeCustom, { width: 1280, height: 720 });
    assert.equal(config.bitrate, 6000);
    assert.equal(config.dataTransport, "websocket");
    assert.equal(config.canvasVsync, true);
    assert.equal(config.canvasRenderer, true);
    assert.equal(config.forceVideoElementRenderer, false);
    assert.equal(store.getItem("mlSettingsBeforeBelmontCompatibilityV1"), original);
    delete config.fps;
    if (baseline) assert.deepEqual(config, baseline); else baseline = config;
  }
});

test("malformed settings repaired, storage write failures propagated to UI", () => {
  for (const original of ["{", "null", "[]", "2"]) {
    const store = storage([["mlSettings", original]]);
    applyWindowsVideoProfile(store, 60);
    assert.equal(JSON.parse(store.getItem("mlSettings")).fps, 60);
    assert.equal(store.getItem("mlSettingsBeforeBelmontCompatibilityV1"), original);
  }
  assert.throws(() => applyWindowsVideoProfile({ getItem: () => null, setItem() { throw Error("quota"); } }, 30), /quota/);
});
