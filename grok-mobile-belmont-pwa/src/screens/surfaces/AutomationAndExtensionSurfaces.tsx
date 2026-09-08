import { useEffect, useState } from "react";
import { api } from "../../api";
import { BabyGrokAvatar } from "../../components/BabyGrokAvatar";
import { Icon } from "../../components/Icon";
import { EmptyState, ScreenError, ScreenSkeleton } from "../../components/ScreenState";
import { InlineNotice, NavRow, PrimaryButton, Section, SurfacePage, TextField, Toggle } from "../../components/SurfacePrimitives";
import type { BotTemplate, RoutineAutomation, RoutedTool, SkillCatalogItem, TemplateImportResult } from "../../types";
import type { SurfaceScreenProps } from "./types";

function message(caught: unknown): string {
  return caught instanceof Error ? caught.message : "요청을 처리하지 못했습니다.";
}

export function RoutineDetailScreen({ back, open, bot, route }: SurfaceScreenProps) {
  const [routines, setRoutines] = useState<RoutineAutomation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const selected = route.value ? routines.find((item) => item.id === route.value) ?? null : null;
  async function load() {
    if (bot == null) return;
    setLoading(true);
    setError("");
    try { setRoutines((await api.routines(bot.id)).routines); }
    catch (caught) { setError(message(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [bot?.id]);
  async function toggle(routine: RoutineAutomation, enabled: boolean) {
    if (bot == null) return;
    setBusy(routine.id);
    try { setRoutines((await api.setRoutineEnabled(bot.id, routine.id, enabled)).routines); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(""); }
  }
  async function run(routine: RoutineAutomation) {
    if (bot == null) return;
    setBusy(routine.id);
    try { await api.runRoutine(bot.id, routine.id); await load(); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(""); }
  }
  async function remove(routine: RoutineAutomation) {
    if (bot == null) return;
    setBusy(routine.id);
    try { setRoutines((await api.deleteRoutine(bot.id, routine.id)).routines); }
    catch (caught) { setError(message(caught)); }
    finally { setBusy(""); }
  }
  return (
    <SurfacePage action={<button aria-label="루틴 추가" className="circle-button" onClick={() => open("RoutineInstructionScreen", { botId: bot?.id, value: "new" })} type="button"><Icon name="plus" size={19} /></button>} back={back} subtitle={bot?.name ?? "Belmont"} title="루틴">
      {loading ? <ScreenSkeleton rows={4} /> : null}
      {error ? <ScreenError message={error} retry={() => void load()} /> : null}
      {!loading && !error && routines.length === 0 ? <EmptyState action="첫 루틴 만들기" detail="정해진 일정에 Bot이 실행할 작업을 등록하세요." onAction={() => open("RoutineInstructionScreen", { botId: bot?.id, value: "new" })} title="등록된 루틴이 없습니다" /> : null}
      {!route.value && routines.length > 0 ? <Section title={`등록된 루틴 ${routines.length}개`}>{routines.map((routine) => <div className="surface-row" key={routine.id}><span className="settings-symbol"><Icon name="routine" size={18} /></span><button className="surface-row-copy routine-open" onClick={() => open("RoutineDetailScreen", { botId: bot?.id, value: routine.id })} type="button"><strong>{routine.name}</strong><small>{routine.triggerDescription || "일정 정보 없음"} · {routine.runs.length}회 실행</small></button><span className="surface-row-meta"><Toggle checked={routine.isEnabled} label={`${routine.name} 활성화`} onChange={(value) => void toggle(routine, value)} /></span></div>)}</Section> : null}
      {selected ? <>
        <div className="routine-hero"><span><Icon name="routine" size={25} /></span><div><strong>{selected.name}</strong><small>{selected.triggerDescription || "일정 정보 없음"}</small></div><Toggle checked={selected.isEnabled} label="루틴 활성화" onChange={(value) => void toggle(selected, value)} /></div>
        <Section title="지침"><NavRow detail={selected.prompt} icon="edit" onClick={() => open("RoutineInstructionScreen", { botId: bot?.id, value: selected.id })} title="작업 내용 편집" /></Section>
        <div className="split-actions"><button disabled={busy === selected.id} onClick={() => void remove(selected)} type="button">삭제</button><button disabled={busy === selected.id} onClick={() => void run(selected)} type="button">지금 실행</button></div>
        {selected.runs.length > 0 ? <Section title="최근 실행">{selected.runs.slice(0, 5).map((run) => <NavRow detail={new Date(run.startedAt).toLocaleString("ko")} icon={run.status === "error" ? "warning" : "check"} key={run.id} title={run.detail || run.event || run.status} />)}</Section> : null}
      </> : route.value && !loading && !error ? <EmptyState detail="해당 루틴을 찾지 못했습니다." title="루틴 없음" /> : null}
    </SurfacePage>
  );
}

export function RoutineInstructionScreen({ back, bot, route }: SurfaceScreenProps) {
  const creating = route.value === "new";
  const [name, setName] = useState("");
  const [instruction, setInstruction] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * 1-5");
  const [enabled, setEnabled] = useState(true);
  const [status, setStatus] = useState<"idle" | "loading" | "saving" | "saved">(creating ? "idle" : "loading");
  const [error, setError] = useState("");
  useEffect(() => {
    if (creating || bot == null || !route.value) return;
    void api.routines(bot.id).then(({ routines }) => {
      const routine = routines.find((item) => item.id === route.value);
      if (routine != null) {
        setName(routine.name);
        setInstruction(routine.prompt);
        setSchedule(typeof routine.trigger.schedule === "string" ? routine.trigger.schedule : "0 9 * * 1-5");
        setEnabled(routine.isEnabled);
      }
    }).catch((caught) => setError(message(caught))).finally(() => setStatus("idle"));
  }, [bot?.id, creating, route.value]);
  async function save() {
    if (bot == null || !name.trim() || !instruction.trim() || status === "saving") return;
    setStatus("saving");
    setError("");
    const spec = { name: name.trim(), prompt: instruction.trim(), trigger: { type: "cron", schedule: schedule.trim() }, isEnabled: enabled };
    try {
      if (creating) await api.createRoutine(bot.id, spec);
      else if (route.value) await api.updateRoutine(bot.id, route.value, spec);
      setStatus("saved");
    } catch (caught) { setError(message(caught)); setStatus("idle"); }
  }
  return (
    <SurfacePage action={<button className="text-button" disabled={status === "loading" || status === "saving" || !name.trim() || !instruction.trim()} onClick={() => void save()} type="button">{status === "saving" ? "저장 중" : status === "saved" ? "저장됨" : "저장"}</button>} back={back} title={creating ? "루틴 추가" : "루틴 편집"}>
      <TextField label="이름" onChange={(value) => { setName(value); setStatus("idle"); }} placeholder="예: 아침 브리핑" value={name} />
      <TextField label="무엇을 할까요?" multiline onChange={(value) => { setInstruction(value); setStatus("idle"); }} placeholder="Bot이 수행할 작업을 입력하세요" value={instruction} />
      <TextField label="Cron 일정" onChange={(value) => { setSchedule(value); setStatus("idle"); }} placeholder="0 9 * * 1-5" value={schedule} />
      <Section><NavRow detail="일정에 따라 자동 실행" icon="clock" meta={<Toggle checked={enabled} label="루틴 활성화" onChange={setEnabled} />} title="활성화" /></Section>
      {error ? <InlineNotice detail={error} title="루틴을 저장하지 못했습니다" /> : <InlineNotice detail="루틴은 Belmont 데스크톱 자동화 저장소에 기록됩니다." icon="check" title="실제 자동화 연결" />}
    </SurfacePage>
  );
}

export function AutoReviewRulesScreen({ back }: SurfaceScreenProps) {
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => { void api.settings().then((settings) => setEnabled(settings.autoReviewEnabled)).catch((caught) => setError(message(caught))).finally(() => setLoading(false)); }, []);
  async function change(value: boolean) {
    setLoading(true);
    setError("");
    try { setEnabled((await api.setSetting("autoReviewEnabled", value)).autoReviewEnabled); }
    catch (caught) { setError(message(caught)); }
    finally { setLoading(false); }
  }
  return <SurfacePage back={back} title="자동 검토"><Section><NavRow detail="Belmont의 현재 자동 검토 설정" icon="sparkle" meta={<Toggle checked={enabled} label="자동 검토" onChange={(value) => void change(value)} />} title={loading ? "불러오는 중" : "자동 검토 사용"} /></Section>{error ? <InlineNotice detail={error} title="설정을 바꾸지 못했습니다" /> : <InlineNotice detail="세부 허용·차단 문구 편집은 현재 모바일 게이트웨이에서 제공하지 않습니다." title="지원 범위" />}</SurfacePage>;
}

export function AutoReviewRuleScreen({ back }: SurfaceScreenProps) {
  return <SurfacePage back={back} title="자동 검토 규칙"><EmptyState detail="현재 Belmont 모바일 게이트웨이는 자동 검토 켜기/끄기만 제공합니다. 존재하지 않는 규칙 편집 화면은 만들지 않았습니다." title="세부 규칙 편집 미지원" /></SurfacePage>;
}

export function AutoReviewApprovalSheet({ back }: SurfaceScreenProps) {
  return <SurfacePage back={back} title="작업 승인"><EmptyState detail="실제 승인 요청은 Bot 채팅 안에 승인·거부 카드로 나타납니다." title="대기 중인 승인 요청 없음" /></SurfacePage>;
}

export function FailuresScreen({ back, bots, open }: SurfaceScreenProps) {
  const [items, setItems] = useState<Array<{ botId: string; routineId: string; title: string; detail: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load() {
    setLoading(true);
    setError("");
    try {
      const groups = await Promise.all(bots.map(async (bot) => ({ bot, routines: (await api.routines(bot.id)).routines })));
      setItems(groups.flatMap(({ bot, routines }) => routines.flatMap((routine) => routine.runs.filter((run) => run.status === "error").map((run) => ({ botId: bot.id, routineId: routine.id, title: `${bot.name} · ${routine.name}`, detail: run.detail || run.event || new Date(run.startedAt).toLocaleString("ko") })))));
    } catch (caught) { setError(message(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [bots]);
  return <SurfacePage back={back} subtitle="실제 자동화 실행 기록" title="실패">{loading ? <ScreenSkeleton rows={4} /> : null}{error ? <ScreenError message={error} retry={() => void load()} /> : null}{!loading && !error && items.length === 0 ? <EmptyState detail="현재 저장된 루틴 실행 기록에서 오류를 찾지 못했습니다." title="실패 기록 없음" /> : <Section>{items.map((item, index) => <NavRow detail={item.detail} icon="warning" key={`${item.routineId}-${index}`} onClick={() => open("RoutineDetailScreen", { botId: item.botId, value: item.routineId })} title={item.title} />)}</Section>}</SurfacePage>;
}

function SkillRows({ items, open }: { items: SkillCatalogItem[]; open: SurfaceScreenProps["open"] }) {
  return <Section>{items.map((skill) => <NavRow detail={skill.description || skill.publisher || skill.source} icon="tools" key={skill.id} onClick={() => open("SkillSheet", { value: skill.name })} title={skill.name} />)}</Section>;
}

export function PluginsScreen({ back, open }: SurfaceScreenProps) {
  const [query, setQuery] = useState("");
  const [skills, setSkills] = useState<SkillCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  async function load(value: string) {
    setLoading(true);
    setError("");
    try { setSkills((await api.skills(value)).skills); }
    catch (caught) { setError(message(caught)); }
    finally { setLoading(false); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(query), 180); return () => window.clearTimeout(timer); }, [query]);
  return <SurfacePage action={<button className="text-button" onClick={() => open("PluginsYoursScreen")} type="button">연결된 도구</button>} back={back} subtitle="Belmont 스킬 카탈로그" title="플러그인"><label className="search-field surface-search"><Icon name="search" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="스킬 검색" value={query} /></label>{loading ? <ScreenSkeleton rows={5} /> : null}{error ? <ScreenError message={error} retry={() => void load(query)} /> : null}{!loading && !error ? <SkillRows items={skills} open={open} /> : null}</SurfacePage>;
}

export function PluginsYoursScreen({ back, open }: SurfaceScreenProps) {
  const [tools, setTools] = useState<RoutedTool[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void api.tools().then((result) => setTools(result.tools)).catch((caught) => setError(message(caught))); }, []);
  return <SurfacePage action={<button aria-label="스킬 검색" className="circle-button" onClick={() => open("PluginsScreen")} type="button"><Icon name="plus" size={19} /></button>} back={back} subtitle={`${tools.length}개 라우팅됨`} title="연결된 도구">{error ? <InlineNotice detail={error} title="도구를 불러오지 못했습니다" /> : null}<Section>{tools.map((tool) => <NavRow detail={`${tool.providerIdentifier} · ${tool.description}`} icon="plug" key={`${tool.providerIdentifier}-${tool.name}`} title={tool.name} />)}</Section>{tools.length === 0 && !error ? <EmptyState detail="현재 Belmont에 라우팅된 MCP 도구가 없습니다." title="연결된 도구 없음" /> : null}</SurfacePage>;
}

export function SkillSheet({ back, route }: SurfaceScreenProps) {
  const name = route.value || "스킬";
  const [skill, setSkill] = useState<SkillCatalogItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    setLoading(true);
    setError("");
    void api.skills(name)
      .then(({ skills }) => setSkill(skills.find((item) => item.name === name) ?? skills[0] ?? null))
      .catch((caught) => setError(message(caught)))
      .finally(() => setLoading(false));
  }, [name]);
  return <SurfacePage back={back} subtitle={skill?.publisher || skill?.source || "스킬"} title={name}><div className="skill-hero"><span><Icon name="tools" size={28} /></span><h1>{name}</h1>{loading ? <ScreenSkeleton rows={2} /> : skill ? <p>{skill.description}</p> : <p>일치하는 스킬을 찾지 못했습니다.</p>}</div>{error ? <InlineNotice detail={error} title="카탈로그를 불러오지 못했습니다" /> : null}{skill ? <Section><NavRow detail={skill.source} icon="folder" title="출처" /><NavRow detail={skill.id} icon="file" title="식별자" /></Section> : null}<InlineNotice detail="카탈로그 조회는 실제 연결입니다. 개별 설치·활성화는 데스크톱에서 관리합니다." title="관리 범위" /></SurfacePage>;
}

export function BotTemplateDetailsScreen({ back, open, bot, route, bots }: SurfaceScreenProps) {
  const botId = route.botId ?? bot?.id ?? bots.find((item) => item.isManager)?.id ?? null;
  const [template, setTemplate] = useState<BotTemplate | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    if (botId == null) return;
    void api.botTemplate(botId).then(({ template: loaded }) => setTemplate(loaded)).catch((caught) => setError(message(caught)));
  }, [botId]);
  const json = template ? JSON.stringify(template, null, 2) : "";
  async function copy() {
    try { await navigator.clipboard.writeText(json); setNotice("템플릿 JSON을 복사했습니다. 다른 기기의 '템플릿 가져오기'에 붙여 넣으면 같은 Bot이 만들어집니다."); }
    catch { setNotice("복사하지 못했습니다. 아래 내용을 길게 눌러 복사하세요."); }
  }
  async function share() {
    if (template == null) return;
    const file = new File([json], `${template.name}.belmont-template.json`, { type: "application/json" });
    try {
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: `${template.name} 템플릿` });
      else await navigator.share({ title: `${template.name} 템플릿`, text: json });
      setNotice("공유했습니다.");
    } catch (caught) { if (!(caught instanceof Error && caught.name === "AbortError")) setNotice("이 브라우저에서는 공유 창을 열 수 없습니다. 복사를 사용하세요."); }
  }
  function cloneFromTemplate() {
    try { sessionStorage.setItem("linear-template-draft", json); } catch {}
    open("BotTemplateImportScreen", { value: "draft" });
  }
  return (
    <SurfacePage back={back} subtitle="페르소나·스킬·루틴을 한 묶음으로" title="템플릿">
      {error ? <ScreenError message={error} retry={() => { setError(""); if (botId != null) void api.botTemplate(botId).then(({ template: loaded }) => setTemplate(loaded)).catch((caught) => setError(message(caught))); }} /> : template == null ? <ScreenSkeleton rows={4} /> : <>
        <div className="template-hero"><BabyGrokAvatar color={bot?.avatar.color ?? "green"} shape={bot?.avatar.shape ?? "cloud"} size={96} state="proud" /><h1>{template.name}</h1><p>{template.description.slice(0, 160)}{template.description.length > 160 ? "…" : ""}</p></div>
        <Section detail={template.skills.length === 0 ? "이 Bot에 켜진 스킬이 없습니다." : undefined} title={`스킬 ${template.skills.length}개`}>{template.skills.map((skill) => <NavRow detail={skill.description || "설명 없음"} icon="sparkle" key={skill.name} title={skill.name} />)}</Section>
        <Section detail={template.routines.length === 0 ? "루틴이 없습니다." : "가져올 때는 꺼진 상태로 만들어집니다."} title={`루틴 ${template.routines.length}개`}>{template.routines.map((routine) => <NavRow detail={routine.schedule} icon="routine" key={routine.name} title={routine.name} />)}</Section>
        {notice ? <InlineNotice detail={notice} icon="check" title="템플릿" /> : null}
        <div className="widget-options"><button onClick={() => void copy()} type="button">JSON 복사</button><button onClick={() => void share()} type="button">공유</button></div>
        <PrimaryButton onClick={cloneFromTemplate}>이 템플릿으로 새 Bot 만들기</PrimaryButton>
        <button className="surface-link" onClick={() => open("BotTemplateImportScreen")} type="button">주소나 JSON으로 가져오기</button>
      </>}
    </SurfacePage>
  );
}

export function BotTemplateImportScreen({ back, home, route, refreshBots, openChat }: SurfaceScreenProps) {
  const [url, setUrl] = useState("");
  const [templateText, setTemplateText] = useState(() => { if (route.value !== "draft") return ""; try { return sessionStorage.getItem("linear-template-draft") ?? ""; } catch { return ""; } });
  const [name, setName] = useState("");
  const [status, setStatus] = useState<"idle" | "creating" | "created">("idle");
  const [result, setResult] = useState<TemplateImportResult | null>(null);
  const [error, setError] = useState("");
  const ready = url.trim().length > 0 || templateText.trim().length > 0;
  async function create() {
    if (!ready || status === "creating") return;
    setStatus("creating");
    setError("");
    try {
      const body = url.trim().length > 0 ? { url: url.trim() } : { template: templateText };
      const imported = await api.importTemplate({ ...body, ...(name.trim() ? { name: name.trim() } : {}) });
      setResult(imported);
      setStatus("created");
      if (imported.status === "complete") { try { sessionStorage.removeItem("linear-template-draft"); } catch {} }
      try { await refreshBots(); } catch (caught) { setError(`Bot 목록을 새로 고치지 못했습니다: ${message(caught)}`); }
    } catch (caught) { setError(message(caught)); setStatus("idle"); }
  }
  if (status === "created" && result != null) {
    const partial = result.status === "partial";
    return <SurfacePage back={home} title={partial ? "가져오기 일부 미완료" : "생성 완료"}>
      <div className="centered-hero compact-hero"><BabyGrokAvatar color="violet" shape="gem" size={112} state="spawning" /><h1>{result.bot.name} {partial ? "생성됨" : "준비 완료"}</h1><p>저장 확인: 스킬 {result.skills.length}개, 꺼진 루틴 {result.routines.length}개.</p></div>
      {partial ? <InlineNotice title="일부 설정을 확인하지 못했습니다" detail="Bot은 만들어졌습니다. 아래 항목은 Bot 설정에서 확인하세요. 같은 템플릿을 다시 가져오면 Bot이 하나 더 만들어집니다." /> : null}
      {result.issues.map((issue, index) => <InlineNotice key={index} title={issue.name} detail={issue.message} />)}
      {error ? <InlineNotice title="목록 새로 고침 실패" detail={error} /> : null}
      <PrimaryButton onClick={() => openChat(result.bot.id)}>대화 열기</PrimaryButton>
    </SurfacePage>;
  }
  return (
    <SurfacePage back={back} subtitle="x.ai 마켓플레이스 주소, 공유 링크, 또는 내보낸 JSON" title="템플릿 가져오기">
      <TextField label="주소 (x.ai/bot/…)" onChange={setUrl} placeholder="https://x.ai/bot/marketplace/bots/…" value={url} />
      <TextField label="또는 템플릿 JSON" multiline onChange={setTemplateText} placeholder='{"name": "...", "description": "...", "skills": [...]}' value={templateText} />
      <TextField label="Bot 이름 (비우면 템플릿 이름)" onChange={setName} value={name} />
      {error ? <InlineNotice detail={error} title="Bot을 만들지 못했습니다" /> : null}
      <PrimaryButton disabled={!ready || status === "creating"} onClick={() => void create()}>{status === "creating" ? "만드는 중…" : "Bot 만들기"}</PrimaryButton>
    </SurfacePage>
  );
}

export function ConnectorSheet({ back }: SurfaceScreenProps) {
  const [tools, setTools] = useState<RoutedTool[]>([]);
  const [error, setError] = useState("");
  useEffect(() => { void api.tools().then(({ tools: result }) => setTools(result.filter((tool) => `${tool.name} ${tool.providerIdentifier}`.toLocaleLowerCase().includes("github")))).catch((caught) => setError(message(caught))); }, []);
  const connected = tools.length > 0;
  return <SurfacePage back={back} subtitle="실제 라우팅 상태" title="GitHub 연결"><div className="connector-hero"><span><Icon name="plug" size={30} /></span><h1>GitHub</h1><p>Belmont에 등록된 GitHub 도구를 확인합니다.</p></div>{error ? <InlineNotice detail={error} title="연결 상태를 확인하지 못했습니다" /> : connected ? <><InlineNotice detail={`${tools.length}개 GitHub 도구가 현재 라우팅되어 있습니다.`} icon="check" title="연결됨" /><Section>{tools.map((tool) => <NavRow detail={tool.description} icon="tools" key={tool.name} title={tool.name} />)}</Section></> : <EmptyState detail="인증을 흉내 내지 않았습니다. GitHub 연결은 Belmont 데스크톱의 플러그인 설정에서 추가해야 합니다." title="연결되지 않음" />}</SurfacePage>;
}
