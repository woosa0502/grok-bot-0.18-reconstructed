export type KeyboardTarget = {
  sendKey: (down: boolean, key: number, modifiers: number) => void;
  keyboard?: { send: (buffer: ArrayBuffer) => void } | null;
};

export const MODIFIERS = [
  { label: "Ctrl", key: 0xa2, mask: 2 },
  { label: "Alt", key: 0xa4, mask: 4 },
  { label: "Shift", key: 0xa0, mask: 1 },
  { label: "Win", key: 0x5b, mask: 8 },
] as const;

export type DesktopKey = { label: string; key: number; modifiers?: number; description?: string };
export const QUICK_KEYS: DesktopKey[] = [
  { label: "Esc", key: 27 }, { label: "Tab", key: 9 },
  { label: "↑", key: 38, description: "위쪽 화살표" }, { label: "↓", key: 40, description: "아래쪽 화살표" },
  { label: "←", key: 37, description: "왼쪽 화살표" }, { label: "→", key: 39, description: "오른쪽 화살표" },
  { label: "Enter", key: 13 }, { label: "⌫", key: 8, description: "Backspace" },
];

export const KEY_GROUPS: { label: string; keys: DesktopKey[] }[] = [
  { label: "자주 쓰는 조합", keys: [
    { label: "Alt+Tab", key: 9, modifiers: 4, description: "창 전환" },
    { label: "Shift+Tab", key: 9, modifiers: 1, description: "이전 항목" },
    { label: "Ctrl+Tab", key: 9, modifiers: 2, description: "다음 탭" },
    { label: "Ctrl+Shift+Tab", key: 9, modifiers: 3, description: "이전 탭" },
    ...[["C", "복사"], ["V", "PC에서 붙여넣기"], ["X", "잘라내기"], ["A", "전체 선택"],
      ["Z", "실행 취소"], ["Y", "다시 실행"], ["S", "저장"], ["F", "찾기"]].map(([key, description]) => ({
      label: `Ctrl+${key}`, key: key!.charCodeAt(0), modifiers: 2, description,
    })),
  ] },
  { label: "Windows", keys: [
    { label: "Win", key: 0x5b, description: "시작 메뉴" },
    ...[["E", "파일 탐색기"], ["D", "바탕화면"], ["R", "실행"], ["I", "Windows 설정"]].map(([key, description]) => ({
      label: `Win+${key}`, key: key!.charCodeAt(0), modifiers: 8, description,
    })),
    { label: "Win+Tab", key: 9, modifiers: 8, description: "작업 보기" },
    { label: "Win+Space", key: 32, modifiers: 8, description: "입력 언어 전환" },
    { label: "Win+Shift+S", key: 83, modifiers: 9, description: "화면 캡처" },
    { label: "Ctrl+Shift+Esc", key: 27, modifiers: 3, description: "작업 관리자" },
    { label: "Win+←", key: 37, modifiers: 8, description: "왼쪽에 창 배치" },
    { label: "Win+→", key: 39, modifiers: 8, description: "오른쪽에 창 배치" },
    { label: "Alt+F4", key: 115, modifiers: 4, description: "현재 창 닫기" },
  ] },
  { label: "이동·편집", keys: [
    { label: "Home", key: 36 }, { label: "End", key: 35 },
    { label: "PgUp", key: 33 }, { label: "PgDn", key: 34 },
    { label: "Delete", key: 46 }, { label: "Insert", key: 45 },
    { label: "Space", key: 32 }, { label: "한/영", key: 21 },
    { label: "CapsLock", key: 20 }, { label: "메뉴 키", key: 93 },
    { label: "Ctrl+Home", key: 36, modifiers: 2 }, { label: "Ctrl+End", key: 35, modifiers: 2 },
  ] },
  { label: "F1–F12", keys: Array.from({ length: 12 }, (_, index) => ({ label: `F${index + 1}`, key: 112 + index })) },
  { label: "문자·숫자", keys: Array.from("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", (label) => ({ label, key: label.charCodeAt(0) })) },
];

/** A chord is a synchronous transaction. Sticky modifiers are local UI state, never held on PC. */
export function sendDesktopKey(target: KeyboardTarget, key: number, modifiers = 0) {
  const held: { key: number; mask: number }[] = [];
  let active = 0;
  let failed = false;
  try {
    for (const modifier of MODIFIERS) {
      if (!(modifiers & modifier.mask) || modifier.key === key) continue;
      active |= modifier.mask;
      held.push(modifier);
      target.sendKey(true, modifier.key, active);
    }
    held.push({ key, mask: 0 });
    target.sendKey(true, key, active);
  } catch {
    failed = true;
  } finally {
    for (const heldKey of held.reverse()) {
      active &= ~heldKey.mask;
      try { target.sendKey(false, heldKey.key, active); } catch { failed = true; }
    }
  }
  if (failed) throw new Error("키 전송 중 연결이 끊겼습니다. 다시 연결한 뒤 확인해 주세요.");
}

/** Moonlight 2.10's U8 text header counts Unicode scalars, not bytes or UTF-16 units.
 * Its Rust get_utf8_raw() uses char_indices(). Keep packets small and split only at scalar boundaries.
 */
export function encodeDesktopText(text: string): ArrayBuffer[] {
  if (text.length > 4000) throw new Error("텍스트는 한 번에 4,000자까지 보낼 수 있습니다.");
  if (/[\u0000-\u001f\u007f]/u.test(text)) throw new Error("줄바꿈·Tab은 하단 키로 입력해 주세요.");
  const encoder = new TextEncoder();
  const packets: ArrayBuffer[] = [];
  let scalars: string[] = [];
  let bytes = 0;
  const flush = () => {
    if (!scalars.length) return;
    const payload = encoder.encode(scalars.join(""));
    const packet = new Uint8Array(payload.length + 2);
    packet.set([1, scalars.length]);
    packet.set(payload, 2);
    packets.push(packet.buffer);
    scalars = [];
    bytes = 0;
  };
  for (const scalar of text) {
    const size = encoder.encode(scalar).length;
    if (bytes + size > 250) flush();
    scalars.push(scalar);
    bytes += size;
  }
  flush();
  return packets;
}

export function sendDesktopText(target: KeyboardTarget, text: string) {
  const packets = encodeDesktopText(text);
  if (!target.keyboard) throw new Error("텍스트 입력 연결이 아직 준비되지 않았습니다.");
  try { for (const packet of packets) target.keyboard.send(packet); }
  catch { throw new Error("텍스트가 일부만 전송됐을 수 있습니다. PC 내용을 확인한 뒤 다시 보내주세요."); }
}
