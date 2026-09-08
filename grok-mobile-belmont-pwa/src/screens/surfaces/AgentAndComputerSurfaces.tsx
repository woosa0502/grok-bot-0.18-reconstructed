import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../api";
import { BabyGrokAvatar, type BabyGrokState } from "../../components/BabyGrokAvatar";
import { Icon } from "../../components/Icon";
import { ScreenSkeleton } from "../../components/ScreenState";
import { ComputerScreen, routeWindowIndex } from "../ComputerScreen";
import { ChoiceChips, InlineNotice, NavRow, PrimaryButton, Section, SurfacePage, TextField, Toggle } from "../../components/SurfacePrimitives";
import type { Bot } from "../../types";
import type { SurfaceScreenProps } from "./types";

function AgentRows({ bots, selected, toggle }: { bots: Bot[]; selected: Set<string>; toggle: (id: string) => void }) {
  return <div className="selectable-agents">{bots.map((item) => <button aria-pressed={selected.has(item.id)} className="agent-pick-row" key={item.id} onClick={() => toggle(item.id)} type="button"><BabyGrokAvatar color={item.avatar.color} shape={item.avatar.shape} size={44} state={item.isRunning ? "working" : "idle"} /><span><strong>{item.name}</strong><small>{item.description || item.title}</small></span><span className={`selection-check ${selected.has(item.id) ? "selected" : ""}`}>{selected.has(item.id) ? <Icon name="check" size={13} /> : null}</span></button>)}</div>;
}

export function AgentProfileScreen({ back, bot, open, refreshBots }: SurfaceScreenProps) {
  const [name, setName] = useState(bot?.name ?? "Belmont");
  const [description, setDescription] = useState(bot?.description ?? "작업을 조율하고 결과를 정리합니다.");
  const [notifications, setNotifications] = useState(bot?.notifyOnUpdatesEnabled ?? true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [hidden, setHidden] = useState(bot?.isHidden ?? false);
  const [hideError, setHideError] = useState("");
  const state: BabyGrokState = bot?.isRunning ? "working" : bot?.awaitingUserResponse ? "listening" : "idle";
  async function saveProfile() {
    if (bot == null || status === "saving") return;
    setStatus("saving");
    setHideError("");
    try {
      await api.updateBot(bot.id, { name: name.trim(), description: description.trim() });
      await api.setBotNotifications(bot.id, notifications);
      await refreshBots();
      setStatus("saved");
    } catch (caught) {
      setHideError(caught instanceof Error ? caught.message : "프로필을 저장하지 못했습니다.");
      setStatus("idle");
    }
  }
  return (
    <SurfacePage action={<button className="text-button" disabled={bot == null || status === "saving" || !name.trim()} onClick={() => void saveProfile()} type="button">{status === "saving" ? "저장 중" : status === "saved" ? "저장됨" : "저장"}</button>} back={back} title="Bot 프로필">
      <div className="profile-hero"><BabyGrokAvatar color={bot?.avatar.color ?? "green"} shape={bot?.avatar.shape ?? "cloud"} size={118} state={state} /><strong>{name}</strong><small>{bot?.isRunning ? "작업 중" : "대기 중"}</small></div>
      <Section title="정보"><div className="section-form"><TextField label="이름" onChange={(value) => { setName(value); setStatus("idle"); }} value={name} /><TextField label="역할" multiline onChange={(value) => { setDescription(value); setStatus("idle"); }} value={description} /></div></Section>
      <Section title="구성">
        <NavRow detail="Bot이 정기적으로 수행할 작업" icon="routine" onClick={() => open("RoutineDetailScreen")} title="루틴" />
        <NavRow detail="사용 중인 도구와 지식" icon="tools" onClick={() => open("PluginsYoursScreen")} title="플러그인과 스킬" />
        <NavRow detail="다른 Bot과 함께 작업" icon="group" onClick={() => open("AddMemberScreen")} title="멤버" />
        <NavRow detail="이 Bot이 쓰는 모델과 노력" icon="model" onClick={() => open("BotModelScreen", { botId: bot?.id })} title="모델" />
        <NavRow detail="템플릿으로 내보내기·가져오기" icon="template" onClick={() => open("BotTemplateDetailsScreen", { botId: bot?.id })} title="템플릿" />
      </Section>
      <Section title="활동"><NavRow icon="bell" meta={<Toggle checked={notifications} label="Bot 알림" onChange={setNotifications} />} title="알림" /><NavRow detail="현재 컴퓨터 상태와 복구" icon="display" onClick={() => open("BoxScreen", { botId: bot?.id })} title="컴퓨터" /></Section>
      <InlineNotice detail="이름, 역할, 알림 상태는 Belmont 데스크톱의 현재 Bot에 바로 저장됩니다." icon="check" title="데스크톱 연결" />
      {hideError ? <InlineNotice detail={hideError} title="상태를 바꾸지 못했습니다" /> : null}
      <button className="danger-action" disabled={bot == null} onClick={() => { if (bot == null) return; setHideError(""); void api.hideBot(bot.id, !hidden).then(() => setHidden((value) => !value)).catch((caught) => setHideError(caught instanceof Error ? caught.message : "Bot 상태를 바꾸지 못했습니다.")); }} type="button"><Icon name="archive" size={17} /> {hidden ? "Bot 다시 표시" : "Bot 숨기기"}</button>
    </SurfacePage>
  );
}

export function BotModelScreen({ back, bot, route, bots }: SurfaceScreenProps) {
  const botId = route.botId ?? bot?.id ?? bots.find((item) => item.isManager)?.id ?? null;
  const [state, setState] = useState<Awaited<ReturnType<typeof api.botModel>> | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [modelId, setModelId] = useState("");
  const [effort, setEffort] = useState("");
  const [maxMode, setMaxMode] = useState(false);
  useEffect(() => {
    if (botId == null) return;
    void api.botModel(botId).then((loaded) => {
      setState(loaded);
      const current = loaded.selection;
      setModelId(current?.modelId ?? "");
      setEffort(current?.parameters.find((parameter) => parameter.id === "effort")?.value ?? "");
      setMaxMode(current?.maxMode === true);
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "모델 설정을 불러오지 못했습니다."));
  }, [botId]);
  const model = state?.models.find((item) => item.id === modelId) ?? null;
  async function save(selection: { modelId: string; effort?: string; maxMode?: boolean } | null) {
    if (botId == null || saving) return;
    setSaving(true);
    setError("");
    try {
      const saved = await api.setBotModel(botId, selection);
      setState((current) => current == null ? current : { ...current, selection: saved.selection });
      if (saved.selection == null) { setModelId(""); setEffort(""); setMaxMode(false); }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "모델을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }
  const defaultLabel = state?.defaultSelection ? `${state.defaultSelection.modelId} ${state.defaultSelection.parameters.find((parameter) => parameter.id === "effort")?.value ?? ""}`.trim() : "gpt-5.5 (코드 기본값)";
  return (
    <SurfacePage back={back} subtitle={bot?.name ?? "Bot"} title="모델">
      {error ? <InlineNotice detail={error} title="오류" /> : null}
      {state == null ? <ScreenSkeleton rows={4} /> : <>
        <Section detail={state.selection == null ? `지금은 기본 모델(${defaultLabel})을 씁니다.` : "이 Bot만의 선택입니다. 다음 턴부터 바로 적용됩니다."} title="모델">
          {state.models.map((item) => <button aria-pressed={modelId === item.id} className="model-row" disabled={saving} key={item.id} onClick={() => { setModelId(item.id); const nextEffort = item.efforts.includes(effort) ? effort : item.efforts[item.efforts.length - 1]; setEffort(nextEffort); void save({ modelId: item.id, effort: nextEffort, maxMode }); }} type="button"><strong>{item.label}</strong><small>{item.id}</small></button>)}
        </Section>
        {model ? <Section detail="루나는 max가 기본이고 xhigh 아래로는 쓰지 않습니다." title="노력"><ChoiceChips onChange={(value) => { setEffort(value); void save({ modelId: model.id, effort: value, maxMode }); }} selected={effort} values={model.efforts} /></Section> : null}
        {model ? <Section><NavRow detail="긴 문맥·긴 출력 허용" icon="sparkle" meta={<Toggle checked={maxMode} label="Max 모드" onChange={(value) => { setMaxMode(value); void save({ modelId: model.id, effort, maxMode: value }); }} />} title="Max 모드" /></Section> : null}
        <button className="danger-action" disabled={saving || state.selection == null} onClick={() => void save(null)} type="button"><Icon name="trash" size={17} /> 기본 모델로 되돌리기</button>
      </>}
    </SurfacePage>
  );
}

export function AgentPickerSheet({ back, bots, openChat, refreshBots }: SurfaceScreenProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = useMemo(() => bots.filter((bot) => bot.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [bots, query]);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 6) next.add(id); return next; }); }
  async function create() {
    if (selected.size < 2 || !name.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.createGroup({ name: name.trim(), description: "모바일에서 만든 그룹", memberAgentIds: [...selected] });
      await refreshBots();
      if (result.bot != null) openChat(result.bot.id);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "그룹을 만들지 못했습니다."); }
    finally { setBusy(false); }
  }
  return (
    <SurfacePage action={<button className="text-button" disabled={selected.size < 2 || !name.trim() || busy} onClick={() => void create()} type="button">{busy ? "만드는 중" : "완료"}</button>} back={back} subtitle={`${selected.size}/6명 선택`} title="새 그룹">
      <TextField label="그룹 이름" onChange={setName} placeholder="예: 프로젝트 팀" value={name} />
      <label className="search-field surface-search"><Icon name="search" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="이름 검색" value={query} /></label>
      {error ? <InlineNotice detail={error} title="그룹을 만들지 못했습니다" /> : null}
      <AgentRows bots={visible} selected={selected} toggle={toggle} />
    </SurfacePage>
  );
}

export function AddMemberScreen({ back, bot, bots, refreshBots }: SurfaceScreenProps) {
  const [selected, setSelected] = useState<Set<string>>(() => new Set(bot?.memberIds ?? []));
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  const touched = useRef(false);
  const memberKey = (bot?.memberIds ?? []).join("|");
  // After a cold start (refresh, deep link) the roster arrives after the first render; adopt the current members
  // until the user changes the selection, so saving never silently drops existing members.
  useEffect(() => { if (bot?.isGroup && !touched.current) setSelected(new Set(bot.memberIds)); }, [bot?.id, bot?.isGroup, memberKey]);
  const rosterLoading = bot == null && bots.length === 0;
  function toggle(id: string) { touched.current = true; setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else if (next.size < 6) next.add(id); setStatus("idle"); return next; }); }
  async function save() {
    if (bot == null || !bot.isGroup || selected.size === 0 || status === "saving") return;
    setStatus("saving");
    setError("");
    try { await api.setGroupMembers(bot.id, [...selected]); await refreshBots(); setStatus("saved"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "멤버를 저장하지 못했습니다."); setStatus("idle"); }
  }
  const candidates = bots.filter((item) => !item.isGroup && item.id !== bot?.id);
  return (
    <SurfacePage action={<button className="text-button" disabled={bot == null || !bot.isGroup || selected.size === 0 || status === "saving"} onClick={() => void save()} type="button">{status === "saving" ? "저장 중" : status === "saved" ? "저장됨" : "저장"}</button>} back={back} subtitle={`${selected.size}/6명 선택`} title="그룹 멤버">
      {rosterLoading ? <ScreenSkeleton rows={4} /> : !bot?.isGroup ? <InlineNotice detail="멤버 편집은 그룹 Bot에서만 사용할 수 있습니다." title="그룹이 아닙니다" /> : null}
      {error ? <InlineNotice detail={error} title="저장하지 못했습니다" /> : null}
      {rosterLoading ? null : <AgentRows bots={candidates} selected={selected} toggle={toggle} />}
    </SurfacePage>
  );
}

export function EmojiPickerView({ back, route }: SurfaceScreenProps) {
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const emojis = ["👍", "❤️", "😂", "🎉", "👀", "🙏", "🚀", "✅", "🤔", "💡", "🔥", "👏", "💯", "😮", "😢", "👎"];
  async function react(emoji: string) {
    if (!route.botId || !route.entryId || busy) return;
    setBusy(true);
    setError("");
    try { await api.react(route.botId, route.entryId, emoji); setPicked(emoji); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "반응을 추가하지 못했습니다."); }
    finally { setBusy(false); }
  }
  return (
    <SurfacePage back={back} subtitle={picked ? `${picked} 반응을 추가했습니다` : "메시지에 반응을 남기세요"} title="반응">
      {error ? <InlineNotice detail={error} title="반응을 추가하지 못했습니다" /> : null}
      <div className="emoji-grid">{emojis.map((emoji) => <button aria-label={`${emoji} 반응`} aria-pressed={picked === emoji} className={picked === emoji ? "selected" : ""} disabled={busy || !route.botId || !route.entryId} key={emoji} onClick={() => void react(emoji)} type="button">{emoji}</button>)}</div>
    </SurfacePage>
  );
}

export function BoxScreen({ back, bot, open }: SurfaceScreenProps) {
  const [state, setState] = useState<"loading" | "ready" | "restarting" | "offline">("loading");
  useEffect(() => {
    if (bot == null) return setState("offline");
    let current = true;
    void api.computer(bot.id).then((computer) => { if (current) setState(computer.ready ? "ready" : "offline"); }).catch(() => { if (current) setState("offline"); });
    return () => { current = false; };
  }, [bot]);
  function ensure() {
    if (bot == null) return;
    setState("restarting");
    void api.ensureComputer(bot.id).then((computer) => setState(computer.ready ? "ready" : "offline")).catch(() => setState("offline"));
  }
  function reset() {
    if (bot == null || state === "restarting") return;
    setState("restarting");
    void api.resetComputer(bot.id).then((computer) => setState(computer.ready ? "ready" : "offline")).catch(() => setState("offline"));
  }
  return (
    <SurfacePage back={back} subtitle={bot?.name ?? "Belmont"} title="컴퓨터">
      <div className="computer-summary"><BabyGrokAvatar color={bot?.avatar.color ?? "green"} shape={bot?.avatar.shape ?? "cloud"} size={86} state={state === "loading" || state === "restarting" ? "working" : "idle"} /><span><strong>{state === "ready" ? "컴퓨터 사용 가능" : state === "loading" ? "컴퓨터 확인 중" : state === "restarting" ? "컴퓨터 시작 중" : "컴퓨터 오프라인"}</strong><small>Belmont 데스크톱 상태</small></span></div>
      <PrimaryButton disabled={state === "loading" || state === "restarting"} onClick={() => state === "ready" ? open("AgentComputerScreen", { botId: bot?.id }) : ensure()}>{state === "ready" ? "컴퓨터 열기" : "컴퓨터 시작"}</PrimaryButton>
      <Section title="데스크톱">
        <NavRow detail="실제 데스크톱 창 목록" icon="display" onClick={() => open("ComputerSwitcherSheet", { botId: bot?.id })} title="화면 전환" />
        <NavRow detail="터치, 키보드, 클립보드 사용법" icon="help" onClick={() => open("ComputerHelpSheet")} title="조작 도움말" />
      </Section>
      <Section title="복구">
        <NavRow destructive detail="현재 원격 컴퓨터를 초기화하고 새로 만듭니다" icon="refresh" onClick={reset} title="컴퓨터 재생성" />
      </Section>
      <InlineNotice detail="상태 조회, 시작, 재생성 모두 Belmont 컴퓨터 서비스에 연결됩니다." icon="check" title="데스크톱 연결" />
    </SurfacePage>
  );
}

export function BoxDesktopScreen({ back, bot, open, route }: SurfaceScreenProps) {
  // The APK had a separate "desktop" viewer with trackpad/direct chips; in this client there is one real
  // computer view (the chat's 컴퓨터 보기 screen with its dock), so this surface simply shows that view.
  if (bot == null) return <SurfacePage back={back} title="데스크톱"><InlineNotice detail="먼저 Bot을 선택하세요." title="Bot 없음" /></SurfacePage>;
  return <ComputerScreen bot={bot} onBack={back} onOpen={open} windowIndex={routeWindowIndex(route.value)} />;
}

export function ComputerSwitcherSheet({ back, bot, open }: SurfaceScreenProps) {
  const [selected, setSelected] = useState(0);
  const [windows, setWindows] = useState<Array<{ windowIndex: number; ready: boolean }>>([]);
  useEffect(() => {
    if (bot == null) return;
    let current = true;
    void api.computer(bot.id).then((computer) => { if (current) { setWindows(computer.windows); setSelected(computer.windows[0]?.windowIndex ?? 0); } }).catch(() => undefined);
    return () => { current = false; };
  }, [bot]);
  return (
    <SurfacePage back={back} subtitle={bot?.name ?? "Belmont"} title="컴퓨터 전환">
      <div className="computer-cards">{windows.map((window) => <button aria-pressed={selected === window.windowIndex} className={selected === window.windowIndex ? "selected" : ""} key={window.windowIndex} onClick={() => setSelected(window.windowIndex)} type="button"><span className="computer-thumbnail"><Icon name="display" size={26} /></span><span><strong>데스크톱 {window.windowIndex + 1}</strong><small>{window.ready ? "연결 가능" : "대기 중"}</small></span><span className={`selection-check ${selected === window.windowIndex ? "selected" : ""}`}><Icon name={selected === window.windowIndex ? "check" : "display"} size={13} /></span></button>)}</div>
      {windows.length === 0 ? <InlineNotice detail="Belmont에서 사용 가능한 화면을 찾지 못했습니다." title="화면 없음" /> : <PrimaryButton onClick={() => open("AgentComputerScreen", { botId: bot?.id, value: String(selected) })}>선택한 화면 열기</PrimaryButton>}
    </SurfacePage>
  );
}

export function ComputerHelpSheet({ back, open }: SurfaceScreenProps) {
  return (
    <SurfacePage back={back} title="컴퓨터 조작">
      {/* Each row states what the viewer actually sends (measured against the bot display on 2026-09-03). */}
      <Section title="터치 제스처">
        <NavRow detail="왼쪽 클릭. 포인터도 그 자리로 이동" icon="check" title="한 번 탭" />
        <NavRow detail="왼쪽 버튼을 누른 채 끌기(선택·이동). 손가락을 어느 정도 움직여야 시작" icon="display" title="한 손가락 드래그" />
        <NavRow detail="오른쪽 클릭" icon="more" title="두 손가락 탭" />
        <NavRow detail="가운데 클릭" icon="group" title="세 손가락 탭" />
        <NavRow detail="오른쪽 버튼을 누른 채 끌기" icon="clock" title="길게 누르기 (1초)" />
        <NavRow detail="스크롤(휠)" icon="sliders" title="두 손가락 드래그" />
        <NavRow detail="앱 안 확대·축소(Ctrl+휠). 화면 자체를 크게 보려면 우측 상단 … 메뉴에서 '원본 크기'를 켠 뒤 아래 도구 줄의 '이동'으로 끌기" icon="search" title="핀치" />
      </Section>
      <Section title="포인터 방식 (우측 상단 … 메뉴에서 전환)">
        <NavRow detail="손가락을 민 만큼 포인터가 움직입니다. 탭 = 클릭, 두 번 탭하고 끌기 = 드래그, 두 손가락 = 스크롤, 길게 = 오른쪽 클릭" icon="sliders" title="트랙패드 (기본)" />
        <NavRow detail="손가락이 닿은 곳으로 포인터가 갑니다. 위 제스처 표가 이 방식입니다" icon="check" title="직접 터치" />
      </Section>
      <Section title="입력 (아래 도구 줄)">
        <NavRow detail="휴대폰 키보드를 열어 컴퓨터에 입력" icon="keyboard" title="키보드" />
        <NavRow detail="Esc, Tab 키를 한 번 보냄" icon="settings" title="Esc · Tab" />
        <NavRow detail="붙여넣기: 휴대폰 → 컴퓨터 클립보드 (컴퓨터에서 Ctrl+V). 복사: 컴퓨터 → 휴대폰" icon="copy" title="붙여넣기 · 복사" />
        <NavRow detail="연결이 끊기면 우측 상단 … 메뉴의 '다시 연결', 크게 보려면 아래 '전체 화면'" icon="plug" title="다시 연결 · 전체 화면" />
      </Section>
      <button className="surface-link" onClick={() => open("BoxHelpRoute")} type="button">연결 문제 해결</button>
    </SurfacePage>
  );
}

export function BoxHelpRoute({ back, home, open }: SurfaceScreenProps) {
  const [step, setStep] = useState(0);
  const checks = ["데스크톱 연결 확인", "VNC 세션 다시 요청", "네트워크 경로 확인"];
  return (
    <SurfacePage back={back} title="연결 문제 해결">
      <div className="diagnostic-list">{checks.map((item, index) => <div className={index < step ? "done" : index === step ? "active" : ""} key={item}><span>{index < step ? <Icon name="check" size={14} /> : index + 1}</span><strong>{item}</strong></div>)}</div>
      {step < checks.length ? <PrimaryButton onClick={() => setStep((value) => value + 1)}>다음 확인</PrimaryButton> : <><InlineNotice detail="컴퓨터 화면을 다시 열어 상태를 확인하세요." icon="check" title="진단 완료" /><PrimaryButton onClick={home}>홈으로</PrimaryButton></>}
      <button className="surface-link" onClick={() => open("WebNoAccessScreen")} type="button">연결 불가 화면 보기</button>
    </SurfacePage>
  );
}
