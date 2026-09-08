import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Icon } from "./Icon";
import { WindowsKeyPager } from "./WindowsKeyPager";
import { KEY_GROUPS, MODIFIERS, QUICK_KEYS, sendDesktopKey, sendDesktopText } from "../windows-keyboard";
import type { DesktopKey, KeyboardTarget } from "../windows-keyboard";
import type { WindowsFrameRate } from "../windows-video-settings";

export function WindowsSettingsMenu({ sensitivity, onSensitivity, frameRate, onFrameRate, onReconnect, onFullscreen, onStats, ready }: {
  sensitivity: number;
  onSensitivity: (value: number) => void;
  frameRate: WindowsFrameRate;
  onFrameRate: (value: WindowsFrameRate) => void;
  onReconnect: () => void;
  onFullscreen: () => void;
  onStats: () => void;
  ready: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        root.current?.querySelector<HTMLButtonElement>("button")?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <div className="computer-menu-wrap" ref={root}>
    <button aria-expanded={open} aria-haspopup="menu" aria-label="Windows 설정 메뉴" className="dark-circle" onClick={() => setOpen((value) => !value)} type="button"><Icon name="more" size={19} /></button>
    {open ? <div aria-label="Windows 설정" className="computer-menu windows-settings-menu" role="menu">
      <button onClick={() => onSensitivity(sensitivity === 0.7 ? 1.4 : sensitivity === 1.4 ? 2 : 0.7)} role="menuitem" type="button"><Icon name="settings" size={17} /><span><strong>포인터 속도</strong><small>{sensitivity === 0.7 ? "느리게" : sensitivity === 2 ? "빠르게" : "보통"} · 트랙패드</small></span></button>
      <button aria-label="영상 프레임 설정" onClick={() => { setOpen(false); onFrameRate(frameRate === 60 ? 30 : 60); }} role="menuitem" type="button"><Icon name="display" size={17} /><span><strong>영상 부드러움 · {frameRate}fps</strong><small>{frameRate === 60 ? "누르면 30fps로 전환" : "누르면 60fps로 전환"}</small></span></button>
      <button onClick={() => { setOpen(false); onFullscreen(); }} role="menuitem" type="button"><Icon name="display" size={17} /><span><strong>전체 화면 전환</strong><small>메뉴와 하단 키바 함께 표시</small></span></button>
      <button disabled={!ready} onClick={() => { setOpen(false); onStats(); }} role="menuitem" type="button"><Icon name="usage" size={17} /><span><strong>연결 통계 표시</strong><small>프레임·전송 상태 켜기 / 끄기</small></span></button>
      <button onClick={() => { setOpen(false); onReconnect(); }} role="menuitem" type="button"><Icon name="refresh" size={17} /><span><strong>다시 연결</strong><small>Windows 화면 새로고침</small></span></button>
      <button aria-expanded={help} onClick={() => setHelp((value) => !value)} role="menuitem" type="button"><Icon name="help" size={17} /><span><strong>조작 도움말</strong><small>키보드·단축키와 호환 모드</small></span></button>
      {help ? <p className="windows-menu-help">한 손가락은 마우스 이동, 탭은 클릭, 길게 누르면 우클릭, 두 손가락은 스크롤입니다. 키보드·단축키는 하단에 있습니다. Ctrl·Alt·Shift·Win 선택은 다음 키 한 번에만 적용됩니다. 영상은 720p이며 60fps는 전력 사용·발열이 늘 수 있습니다. 부담되면 영상 부드러움을 30fps로 바꾸세요. 프레임 변경 시 이 화면만 다시 연결합니다. Ctrl+Alt+Del 보안 화면은 지원하지 않습니다.</p> : null}
    </div> : null}
  </div>;
}

export function WindowsKeyboardDock({ getTarget, ready }: { getTarget: () => KeyboardTarget | null; ready: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [group, setGroup] = useState(0);
  const [modifiers, setModifiers] = useState(0);
  const [keyboard, setKeyboard] = useState(false);
  const [text, setText] = useState("");
  const draft = useRef("");
  const [notice, setNotice] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") { setModifiers(0); setKeyboard(false); composing.current = false; }
    };
    document.addEventListener("visibilitychange", hidden);
    return () => document.removeEventListener("visibilitychange", hidden);
  }, []);
  useEffect(() => { if (!ready) { setModifiers(0); composing.current = false; } }, [ready]);

  function invoke(action: (target: KeyboardTarget) => void) {
    const target = getTarget();
    if (!ready || !target) { setNotice("연결이 준비된 뒤 눌러 주세요. 입력은 자동 재전송하지 않습니다."); return false; }
    try { action(target); setNotice(""); return true; }
    catch (error) { setNotice(error instanceof Error ? error.message : "입력을 보내지 못했습니다."); return false; }
  }
  function press(key: DesktopKey) {
    const mask = modifiers | (key.modifiers ?? 0);
    setModifiers(0);
    invoke((target) => sendDesktopKey(target, key.key, mask));
  }
  function toggleKeyboard() {
    const next = !keyboard;
    flushSync(() => { setKeyboard(next); if (next) setExpanded(false); });
    if (next) input.current?.focus();
    else input.current?.blur();
  }
  function sendText() {
    // Consume synchronously: duplicate submit/IME events can arrive before React commits
    // setText(""). A render-state-only guard would send the same draft twice.
    const value = draft.current;
    if (!value || composing.current || submitting.current) return;
    submitting.current = true;
    setModifiers(0);
    try {
      if (invoke((target) => sendDesktopText(target, value))) { draft.current = ""; setText(""); input.current?.focus(); }
    } finally {
      // Also block duplicate submits after a partial failure, retaining the warning/draft.
      queueMicrotask(() => { submitting.current = false; });
    }
  }
  const keyButton = (key: DesktopKey) => <button
    aria-label={key.description ? `${key.label} · ${key.description}` : key.label}
    disabled={!ready}
    key={key.label}
    onClick={() => press(key)}
    onPointerDown={(event) => event.preventDefault()}
    title={key.description}
    type="button"
  ><span>{key.label}</span>{key.description && !QUICK_KEYS.includes(key) ? <small>{key.description}</small> : null}</button>;

  return <footer className="windows-keyboard-dock">
    <div className="windows-dock-actions">
      <button aria-expanded={keyboard} aria-label="휴대폰 키보드" disabled={!ready} onClick={toggleKeyboard} type="button"><Icon name="keyboard" size={18} /><span>키보드</span></button>
      <button aria-expanded={expanded} onClick={() => { setExpanded((value) => !value); setKeyboard(false); input.current?.blur(); }} type="button">{expanded ? "접기" : "단축키"}<span aria-hidden="true">{expanded ? "⌄" : "⌃"}</span></button>
      <div className="windows-dock-status"><span><i className={ready ? "is-ready" : ""} />{ready ? "연결됨" : "연결 대기"}</span><span>{modifiers ? `${MODIFIERS.filter((item) => modifiers & item.mask).map((item) => item.label).join("+")} + 다음 키` : "좌우로 밀면 키 묶음 전환"}</span></div>
    </div>
    <WindowsKeyPager label="Windows 빠른 키" className="windows-key-row">
      {QUICK_KEYS.map(keyButton)}
    </WindowsKeyPager>
    {expanded ? <section aria-label="Windows 단축키 모음" className="windows-key-panel">
      <div aria-label="다음 키에 적용할 조합키" className="windows-modifiers">
        {MODIFIERS.map((item) => <button aria-pressed={Boolean(modifiers & item.mask)} disabled={!ready} key={item.label} onClick={() => setModifiers((value) => value ^ item.mask)} onPointerDown={(event) => event.preventDefault()} type="button">{item.label}</button>)}
        <button disabled={!modifiers} onClick={() => setModifiers(0)} type="button">해제</button>
      </div>
      <WindowsKeyPager label="단축키 분류" className="windows-key-tabs" minimum={110}>
        {KEY_GROUPS.map((item, index) => <button aria-pressed={group === index} key={item.label} onClick={() => setGroup(index)} type="button">{item.label}</button>)}
      </WindowsKeyPager>
      <div className={`windows-key-grid ${group === 4 ? "is-alphabet" : ""}`}>{KEY_GROUPS[group]!.keys.map(keyButton)}</div>
    </section> : null}
    {keyboard ? <form className="windows-text-entry" onSubmit={(event) => { event.preventDefault(); sendText(); }}>
      <input aria-label="Windows에 보낼 텍스트" autoCapitalize="off" autoComplete="off" autoCorrect="off" disabled={!ready} maxLength={4000} onChange={(event) => { draft.current = event.target.value; setText(event.target.value); }} onCompositionEnd={() => { composing.current = false; }} onCompositionStart={() => { composing.current = true; }} onKeyDown={(event) => { if (event.key === "Enter" && (event.nativeEvent.isComposing || composing.current)) event.preventDefault(); }} placeholder="한글·문자 입력 후 전송" ref={input} spellCheck={false} type="text" value={text} />
      <button aria-label="텍스트 전송" disabled={!ready || !text} onPointerDown={(event) => event.preventDefault()} type="submit"><Icon name="send" size={18} /></button>
      <small>텍스트만 전송합니다. PC의 Enter는 위쪽 키를 누르세요.</small>
    </form> : null}
    {notice ? <p className="windows-input-notice" role="status">{notice}</p> : null}
  </footer>;
}
