export type WindowsFrameRate = 30 | 60;
export const WINDOWS_FRAME_RATE_KEY = "belmontWindowsFrameRate";

export function readWindowsFrameRate(storage: Pick<Storage, "getItem">): WindowsFrameRate {
  try { return storage.getItem(WINDOWS_FRAME_RATE_KEY) === "30" ? 30 : 60; }
  catch { return 60; }
}

export function applyWindowsVideoProfile(storage: Pick<Storage, "getItem" | "setItem">, frameRate: WindowsFrameRate) {
  const original = storage.getItem("mlSettings");
  let current: Record<string, unknown> = {};
  try {
    const value = JSON.parse(original || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) current = value;
  } catch { /* Repair malformed viewer settings without losing the one-time original backup. */ }
  if (storage.getItem("mlSettingsBeforeBelmontCompatibilityV1") === null) {
    storage.setItem("mlSettingsBeforeBelmontCompatibilityV1", original || "{}");
  }
  storage.setItem("mlSettings", JSON.stringify({
    language: "ko-KR",
    playAudioLocal: false,
    touchMode: "mouseRelative",
    ...current,
    videoCodec: "h264",
    videoSize: "custom",
    videoSizeCustom: { width: 1280, height: 720 },
    fps: frameRate,
    bitrate: 6000,
    canvasRenderer: true,
    forceVideoElementRenderer: false,
    canvasVsync: true,
    dataTransport: "websocket",
  }));
}
