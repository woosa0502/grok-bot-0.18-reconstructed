import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { BabyGrokAvatar } from "../../components/BabyGrokAvatar";
import { Icon } from "../../components/Icon";
import { MessageContent } from "../../components/MessageContent";
import { EmptyState, ScreenError, ScreenSkeleton } from "../../components/ScreenState";
import { ChoiceChips, InlineNotice, NavRow, PrimaryButton, Section, SurfacePage, TextField, Toggle } from "../../components/SurfacePrimitives";
import type { AttachmentPreview, CodexUsage, MobileSettings, UsageLedger, UsageStat } from "../../types";
import type { SurfaceScreenProps } from "./types";

type Theme = "시스템" | "라이트" | "다크";
type AutofillValue = { label: string; name: string; detail: string };

const DEFAULT_AUTOFILL_VALUES: Record<string, AutofillValue> = {
  work: { label: "업무 프로필", name: "Hoon", detail: "Linear Mobile" },
  shipping: { label: "배송 정보", name: "Hoon", detail: "서울" },
};

function readAutofillValue(entryKey: string, isNew: boolean): AutofillValue {
  if (isNew) return { label: "", name: "", detail: "" };
  try {
    const stored = JSON.parse(localStorage.getItem(`linear-autofill:${entryKey}`) ?? "null") as Partial<AutofillValue> | null;
    if (stored != null) {
      return {
        label: typeof stored.label === "string" ? stored.label : "저장된 정보",
        name: typeof stored.name === "string" ? stored.name : "",
        detail: typeof stored.detail === "string" ? stored.detail : "",
      };
    }
  } catch {}
  return DEFAULT_AUTOFILL_VALUES[entryKey] ?? { label: "저장된 정보", name: "", detail: "" };
}

function setDocumentTheme(value: Theme) {
  const mode = value === "시스템" ? "system" : value === "다크" ? "dark" : "light";
  localStorage.setItem("belmont-mobile-theme", mode);
  const dark = mode === "dark" || mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
}

export function UserFormSheet({ back, open, route, bots, bot }: SurfaceScreenProps) {
  const botId = route.botId ?? bot?.id ?? bots.find((item) => item.isManager)?.id ?? null;
  const [project, setProject] = useState("");
  const [priority, setPriority] = useState("보통");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  async function send() {
    if (botId == null || status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await api.sendForm(botId, { "프로젝트 이름": project, "우선순위": priority }, note);
      try { localStorage.setItem("linear-user-form:last", JSON.stringify({ project, priority, savedAt: Date.now() })); } catch {}
      setStatus("sent");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "정보를 전달하지 못했습니다.");
      setStatus("idle");
    }
  }
  return (
    <SurfacePage back={back} subtitle="입력한 값은 Bot에게 메시지로 전달됩니다" title="추가 정보">
      <TextField label="프로젝트 이름" onChange={setProject} placeholder="예: Linear Mobile" value={project} />
      <Section title="우선순위"><ChoiceChips onChange={setPriority} selected={priority} values={["낮음", "보통", "높음"]} /></Section>
      <TextField label="메모 (선택)" multiline onChange={setNote} placeholder="Bot이 알아야 할 것" value={note} />
      <NavRow detail="저장된 정보에서 불러오기" icon="account" onClick={() => open("AutofillScreen")} title="자동 완성" />
      {error ? <InlineNotice detail={error} title="전달 실패" /> : null}
      {status === "sent" ? <InlineNotice detail={`${bot?.name ?? "Bot"}에게 전달했습니다. 대화에서 이어집니다.`} icon="check" title="전달됨" /> : null}
      <PrimaryButton disabled={!project.trim() || botId == null || status === "sending"} onClick={() => void send()}>{status === "sending" ? "전달 중…" : "Bot에게 전달"}</PrimaryButton>
      {status === "sent" ? <button className="surface-link" onClick={back} type="button">대화로 돌아가기</button> : null}
    </SurfacePage>
  );
}

export function AutofillScreen({ back, open }: SurfaceScreenProps) {
  const [entries] = useState<Array<{ key: string; title: string; detail: string }>>(() => {
    const stored = localStorage.getItem("linear-autofill-index");
    if (stored != null) return JSON.parse(stored);
    const initial = [{ key: "work", title: "업무 프로필", detail: "이름, 직책, 기본 프로젝트" }, { key: "shipping", title: "배송 정보", detail: "이름과 주소" }];
    localStorage.setItem("linear-autofill-index", JSON.stringify(initial));
    for (const [key, value] of Object.entries(DEFAULT_AUTOFILL_VALUES)) {
      if (localStorage.getItem(`linear-autofill:${key}`) == null) localStorage.setItem(`linear-autofill:${key}`, JSON.stringify(value));
    }
    return initial;
  });
  return (
    <SurfacePage action={<button aria-label="자동 완성 추가" className="circle-button" onClick={() => open("AutofillEntryScreen", { value: "new" })} type="button"><Icon name="plus" size={19} /></button>} back={back} subtitle="저장하면 관리자 Bot의 기억에도 들어가 Bot들이 폼과 답변에 씁니다" title="자동 완성">
      {entries.length > 0 ? <Section>{entries.map((entry) => <NavRow detail={entry.detail} icon="account" key={entry.key} onClick={() => open("AutofillEntryScreen", { value: entry.key })} title={entry.title} />)}</Section> : <div className="centered-hero compact-hero"><span className="hero-icon"><Icon name="account" size={28} /></span><h1>저장된 정보가 없습니다</h1></div>}
    </SurfacePage>
  );
}

export function AutofillEntryScreen({ back, route, bots }: SurfaceScreenProps) {
  const managerId = bots.find((item) => item.isManager)?.id ?? bots[0]?.id ?? null;
  const [entryKey] = useState(() => route.value === "new" ? `entry-${Date.now()}` : route.value || "work");
  const [initialValue] = useState(() => readAutofillValue(entryKey, route.value === "new"));
  const [label, setLabel] = useState(initialValue.label);
  const [name, setName] = useState(initialValue.name);
  const [detail, setDetail] = useState(initialValue.detail);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "deleted">("idle");
  const [error, setError] = useState("");
  const storageKey = `linear-autofill:${entryKey}`;
  function memoryIdOf(): string | null {
    try { const stored = JSON.parse(localStorage.getItem(storageKey) ?? "null") as { memoryId?: string } | null; return stored?.memoryId ?? null; } catch { return null; }
  }
  async function save() {
    if (status === "saving") return;
    setStatus("saving");
    setError("");
    const content = `자동 완성 "${label.trim()}": ${[name.trim() ? `이름 ${name.trim()}` : "", detail.trim() ? detail.trim() : ""].filter(Boolean).join(", ")} (사용자가 폰에서 저장한 값; 폼이나 답변에 이 값을 쓴다)`;
    let memoryId: string | null = null;
    try {
      if (managerId != null) {
        const previous = memoryIdOf();
        if (previous) await api.deleteMemory(managerId, previous).catch(() => undefined);
        const { memory } = await api.addMemory(managerId, content, "profile");
        memoryId = memory?.id ?? null;
      }
      localStorage.setItem(storageKey, JSON.stringify({ label, name, detail, savedAt: Date.now(), ...(memoryId ? { memoryId } : {}) }));
      const stored = JSON.parse(localStorage.getItem("linear-autofill-index") ?? "[]") as Array<{ key: string; title: string; detail: string }>;
      const next = [...stored.filter((entry) => entry.key !== entryKey), { key: entryKey, title: label, detail: [name, detail].filter(Boolean).join(", ") || "저장된 정보" }];
      localStorage.setItem("linear-autofill-index", JSON.stringify(next));
      setStatus("saved");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
      setStatus("idle");
    }
  }
  async function remove() {
    setError("");
    const memoryId = memoryIdOf();
    if (managerId != null && memoryId) await api.deleteMemory(managerId, memoryId).catch(() => undefined);
    localStorage.removeItem(storageKey);
    const stored = JSON.parse(localStorage.getItem("linear-autofill-index") ?? "[]") as Array<{ key: string }>;
    localStorage.setItem("linear-autofill-index", JSON.stringify(stored.filter((entry) => entry.key !== entryKey)));
    setStatus("deleted");
  }
  return (
    <SurfacePage action={<button className="text-button" disabled={!label.trim() || status === "saving"} onClick={() => void save()} type="button">{status === "saving" ? "저장 중" : status === "saved" ? "저장됨" : "저장"}</button>} back={back} title={route.value === "new" ? "자동 완성 추가" : "자동 완성 편집"}>
      <div className="section-form"><TextField label="항목 이름" onChange={(value) => { setLabel(value); setStatus("idle"); }} value={label} /><TextField label="이름" onChange={(value) => { setName(value); setStatus("idle"); }} value={name} /><TextField label="기본 프로젝트 / 상세" onChange={(value) => { setDetail(value); setStatus("idle"); }} value={detail} /></div>
      {error ? <InlineNotice detail={error} title="저장 실패" /> : null}
      {status === "saved" ? <InlineNotice detail="이 기기와 관리자 Bot의 기억(프로필)에 저장했습니다." icon="check" title="저장됨" /> : null}
      {status === "deleted" ? <InlineNotice detail="이 기기와 Bot 기억에서 지웠습니다." icon="check" title="삭제됨" /> : null}
      <button className="danger-action" onClick={() => void remove()} type="button"><Icon name="trash" size={17} /> 항목 삭제</button>
    </SurfacePage>
  );
}

export function AttachmentPreviewRoute({ back, route, open }: SurfaceScreenProps) {
  const attachment = route.attachment;
  const name = attachment?.name || route.value || "첨부 파일";
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [error, setError] = useState("");
  async function load() {
    if (attachment == null) return;
    setError("");
    try { setPreview(await api.attachmentPreview(attachment)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "첨부 파일을 읽지 못했습니다."); }
  }
  useEffect(() => { void load(); }, [attachment?.agentId, attachment?.path]);
  return (
    <SurfacePage back={back} subtitle="채팅 첨부" title="첨부 파일">
      {attachment == null ? <EmptyState detail="이전 데모 링크에는 실제 파일 경로가 없습니다. 채팅의 첨부 카드에서 다시 여세요." title="파일 참조 없음" /> : <>
        <div className="file-card"><span><Icon name={attachment.kind === "image" ? "image" : "file"} size={29} /></span><div><strong>{name}</strong><small>{attachment.byteSize > 0 ? `${Math.max(1, Math.round(attachment.byteSize / 1024))} KB` : attachment.kind.toUpperCase()}</small></div></div>
        {!preview && !error ? <ScreenSkeleton rows={3} /> : null}
        {error ? <ScreenError message={error} retry={() => void load()} /> : null}
        {preview?.kind === "image" && preview.dataUrl ? <img alt={name} className="real-attachment-image" src={preview.dataUrl} /> : null}
        {preview?.kind === "text" && attachment.kind === "markdown" && preview.text ? <div className="real-document-preview rendered-markdown"><MessageContent content={preview.text} /></div> : null}
        {preview?.kind === "text" && !(attachment.kind === "markdown" && preview.text) ? <pre className="real-document-preview">{preview.text || "빈 문서"}</pre> : null}
        {preview?.kind === "pdf" && preview.contentUrl ? <iframe className="real-document-frame" src={preview.contentUrl} title={name} /> : null}
        {preview?.kind === "media" && preview.contentUrl && attachment.kind === "video" ? <video className="real-attachment-media" controls src={preview.contentUrl} /> : null}
        {preview?.kind === "media" && preview.contentUrl && attachment.kind === "audio" ? <audio className="real-attachment-audio" controls src={preview.contentUrl} /> : null}
        {preview?.kind === "binary" && preview.contentUrl ? <a className="download-file" href={preview.contentUrl} target="_blank">파일 열기 또는 다운로드</a> : null}
        <div className="split-actions"><button onClick={() => open("ShareTargetScreen", { value: name, attachment })} type="button">공유</button><button onClick={() => open(attachment.kind === "image" ? "ImageViewerRoute" : "FilePreviewSheet", { value: name, attachment })} type="button">전체 보기</button></div>
      </>}
    </SurfacePage>
  );
}

export function FilePreviewSheet({ back, route, open }: SurfaceScreenProps) {
  const attachment = route.attachment;
  const [preview, setPreview] = useState<AttachmentPreview | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { if (attachment != null) void api.attachmentPreview(attachment).then(setPreview).catch((caught) => setError(caught instanceof Error ? caught.message : "파일을 읽지 못했습니다.")); }, [attachment?.agentId, attachment?.path]);
  return (
    <SurfacePage action={<button aria-label="공유" className="circle-button" disabled={attachment == null} onClick={() => open("ShareTargetScreen", { value: route.value, attachment })} type="button"><Icon name="reply" size={18} /></button>} back={back} subtitle={attachment?.kind.toUpperCase()} title={route.value || "첨부 파일"}>
      {attachment == null ? <EmptyState detail="채팅의 첨부 카드에서 파일을 다시 여세요." title="파일 참조 없음" /> : null}
      {attachment != null && !preview && !error ? <ScreenSkeleton rows={5} /> : null}
      {error ? <ScreenError message={error} retry={() => window.location.reload()} /> : null}
      {preview?.kind === "text" ? <pre className="reader-page real-file-text">{preview.text || "빈 문서"}</pre> : null}
      {preview?.kind === "pdf" && preview.contentUrl ? <iframe className="reader-pdf" src={preview.contentUrl} title={route.value || "PDF"} /> : null}
      {preview?.contentUrl && preview.kind === "binary" ? <a className="download-file" href={preview.contentUrl} target="_blank">이 파일 형식은 새 창에서 엽니다</a> : null}
    </SurfacePage>
  );
}

export function ImageViewerRoute({ back, route, open }: SurfaceScreenProps) {
  const [zoomed, setZoomed] = useState(false);
  const attachment = route.attachment;
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (attachment != null) void api.attachmentPreview(attachment).then((preview) => setSource(preview.dataUrl || preview.contentUrl || "")).catch((caught) => setError(caught instanceof Error ? caught.message : "이미지를 읽지 못했습니다.")); }, [attachment?.agentId, attachment?.path]);
  return (
    <SurfacePage action={<button aria-label="공유" className="dark-circle" disabled={attachment == null} onClick={() => open("ShareTargetScreen", { value: route.value, attachment })} type="button"><Icon name="reply" size={18} /></button>} back={back} subtitle={zoomed ? "확대됨" : "탭하여 확대"} title={route.value || "image.png"} tone="computer">
      {error ? <ScreenError message={error} retry={() => window.location.reload()} /> : null}
      {!source && !error ? <ScreenSkeleton rows={3} /> : null}
      {source ? <button aria-pressed={zoomed} className={`image-viewer real-image-viewer ${zoomed ? "zoomed" : ""}`} onClick={() => setZoomed((value) => !value)} type="button"><img alt={route.value || "첨부 이미지"} src={source} /></button> : null}
    </SurfacePage>
  );
}

export function ShareTargetScreen({ back, route, bots, openChat }: SurfaceScreenProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const visible = useMemo(() => bots.filter((bot) => bot.name.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [bots, query]);
  async function share(targetId: string) {
    if (route.attachment == null || busy) return;
    setBusy(targetId);
    setError("");
    try { await api.shareAttachment(route.attachment, targetId); openChat(targetId); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "파일을 공유하지 못했습니다."); }
    finally { setBusy(""); }
  }
  return (
    <SurfacePage back={back} subtitle={route.value || "공유할 파일"} title="Bot에게 공유">
      <label className="search-field surface-search"><Icon name="search" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="Bot 검색" value={query} /></label>
      {route.attachment == null ? <InlineNotice detail="실제 첨부 파일 참조가 없어 공유할 수 없습니다." title="파일 참조 없음" /> : null}
      {error ? <InlineNotice detail={error} title="공유하지 못했습니다" /> : null}
      <Section>{visible.map((item) => <button className="agent-pick-row" disabled={route.attachment == null || Boolean(busy)} key={item.id} onClick={() => void share(item.id)} type="button"><BabyGrokAvatar color={item.avatar.color} shape={item.avatar.shape} size={45} state="listening" /><span><strong>{item.name}</strong><small>{busy === item.id ? "공유하는 중" : "파일을 실제 대화에 첨부"}</small></span><Icon name="chevronRight" size={14} /></button>)}</Section>
    </SurfacePage>
  );
}

export function AppearanceScreen({ back }: SurfaceScreenProps) {
  const initial = (localStorage.getItem("belmont-mobile-theme") ?? "system") as "system" | "light" | "dark";
  const [theme, setTheme] = useState<Theme>(initial === "dark" ? "다크" : initial === "light" ? "라이트" : "시스템");
  const [compact, setCompact] = useState(() => localStorage.getItem("linear-density") === "compact");
  function changeDensity(value: boolean) {
    setCompact(value);
    localStorage.setItem("linear-density", value ? "compact" : "comfortable");
    document.documentElement.dataset.density = value ? "compact" : "comfortable";
  }
  return (
    <SurfacePage back={back} title="화면 표시">
      <div className="theme-previews">{(["라이트", "다크", "시스템"] as Theme[]).map((value) => <button aria-pressed={theme === value} className={`${value === "다크" ? "dark" : ""} ${theme === value ? "selected" : ""}`} key={value} onClick={() => { setTheme(value); setDocumentTheme(value); }} type="button"><span><i /><i /><i /></span><strong>{value}</strong></button>)}</div>
      <Section><NavRow detail="목록의 간격을 줄입니다" icon="sliders" meta={<Toggle checked={compact} label="조밀한 목록" onChange={changeDensity} />} title="조밀한 목록" /></Section>
    </SurfacePage>
  );
}

export function DefaultModelScreen({ back }: SurfaceScreenProps) {
  const [settings, setSettings] = useState<MobileSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { void api.settings().then(setSettings).catch((caught) => setError(caught instanceof Error ? caught.message : "설정을 불러오지 못했습니다.")); }, []);
  const selection = settings?.agentDefaultModel ?? null;
  const effort = selection?.parameters.find((parameter) => parameter.id === "effort")?.value ?? "";
  const model = settings?.models.find((item) => item.id === selection?.modelId) ?? null;
  async function save(value: { modelId: string; effort?: string; maxMode?: boolean } | null) {
    if (saving) return;
    setSaving(true);
    setError("");
    try { setSettings(await api.setSetting("agentDefaultModel", value as MobileSettings["agentDefaultModel"])); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); }
    finally { setSaving(false); }
  }
  return (
    <SurfacePage back={back} subtitle="개별 설정이 없는 Bot과 새 Bot이 쓰는 모델" title="기본 모델">
      {error ? <InlineNotice detail={error} title="오류" /> : null}
      {settings == null ? <ScreenSkeleton rows={4} /> : <>
        <Section detail={selection == null ? "지금은 코드 기본값(gpt-5.5 high)을 씁니다." : "Bot마다 정한 모델이 있으면 그쪽이 우선합니다."} title="모델">
          <button aria-pressed={selection == null} className="model-row" disabled={saving} onClick={() => void save(null)} type="button"><strong>자동</strong><small>코드 기본값 사용</small></button>
          {settings.models.map((item) => <button aria-pressed={selection?.modelId === item.id} className="model-row" disabled={saving} key={item.id} onClick={() => void save({ modelId: item.id, effort: item.efforts.includes(effort) ? effort : item.efforts[item.efforts.length - 1], maxMode: selection?.maxMode === true })} type="button"><strong>{item.label}</strong><small>{item.id}</small></button>)}
        </Section>
        {model ? <Section title="노력"><ChoiceChips onChange={(value) => void save({ modelId: model.id, effort: value, maxMode: selection?.maxMode === true })} selected={effort} values={model.efforts} /></Section> : null}
      </>}
    </SurfacePage>
  );
}

export function LanguageScreen({ back }: SurfaceScreenProps) {
  const languages = ["한국어", "English", "日本語", "简体中文"];
  const [selected, setSelected] = useState(() => localStorage.getItem("linear-language") ?? "");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  useEffect(() => { void api.settings().then((settings) => { if (settings.userLanguage) setSelected(settings.userLanguage); }).catch(() => undefined); }, []);
  async function choose(value: string) {
    setSelected(value);
    setStatus("saving");
    setError("");
    try {
      await api.setSetting("userLanguage", value);
      localStorage.setItem("linear-language", value);
      setStatus("saved");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); setStatus("idle"); }
  }
  return (
    <SurfacePage back={back} subtitle="Bot들이 답할 때 쓰는 언어입니다. 다른 언어로 말을 걸면 그 언어를 따릅니다." title="답변 언어">
      <Section>
        <button aria-pressed={selected === ""} className="model-row" onClick={() => void choose("")} type="button"><strong>자동</strong><small>내가 쓰는 언어를 따름</small></button>
        {languages.map((language) => <button aria-pressed={selected === language} className="model-row" key={language} onClick={() => void choose(language)} type="button"><strong>{language}</strong></button>)}
      </Section>
      {error ? <InlineNotice detail={error} title="저장 실패" /> : null}
      {status === "saved" ? <InlineNotice detail="모든 Bot의 다음 답변부터 적용됩니다." icon="check" title="저장됨" /> : null}
    </SurfacePage>
  );
}

export function HapticsScreen({ back }: SurfaceScreenProps) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem("linear-haptics") !== "off");
  const [strength, setStrength] = useState(() => localStorage.getItem("linear-haptics-strength") ?? "보통");
  function setHaptics(value: boolean) { setEnabled(value); localStorage.setItem("linear-haptics", value ? "on" : "off"); }
  function sample(value: string) { setStrength(value); localStorage.setItem("linear-haptics-strength", value); if (enabled) navigator.vibrate?.(value === "강하게" ? 50 : value === "보통" ? 28 : 14); }
  return <SurfacePage back={back} title="햅틱"><Section><NavRow detail="Belmont의 새 활동을 진동으로 전달" icon="haptics" meta={<Toggle checked={enabled} label="햅틱" onChange={setHaptics} />} title="활동 햅틱" /></Section><Section detail="강도를 누르면 이 기기에서 시험 진동을 실행합니다." title="진동 테스트"><ChoiceChips onChange={sample} selected={strength} values={["약하게", "보통", "강하게"]} /></Section></SurfacePage>;
}

export function TimeZoneScreen({ back }: SurfaceScreenProps) {
  const zones = useMemo(() => {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const all = typeof intl.supportedValuesOf === "function" ? intl.supportedValuesOf("timeZone") : [];
    const preferred = ["Asia/Seoul", "Asia/Tokyo", "Asia/Shanghai", "Asia/Singapore", "America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "UTC"];
    return [...preferred, ...all.filter((zone) => !preferred.includes(zone))];
  }, []);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");
  useEffect(() => { void api.settings().then((settings) => setSelected(settings.userTimeZone)).catch(() => setSelected(Intl.DateTimeFormat().resolvedOptions().timeZone ?? "Asia/Seoul")); }, []);
  const visible = zones.filter((zone) => zone.toLocaleLowerCase().includes(query.toLocaleLowerCase())).slice(0, 60);
  async function choose(zone: string) {
    setSelected(zone);
    setStatus("saving");
    setError("");
    try { await api.setSetting("userTimeZone", zone); setStatus("saved"); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "저장하지 못했습니다."); setStatus("idle"); }
  }
  return (
    <SurfacePage back={back} subtitle="Bot의 시간 표기와 루틴 시각의 기준" title="시간대">
      <label className="search-field surface-search"><Icon name="search" size={17} /><input onChange={(event) => setQuery(event.target.value)} placeholder="도시 또는 시간대 검색" value={query} /></label>
      {error ? <InlineNotice detail={error} title="저장 실패" /> : null}
      {status === "saved" ? <InlineNotice detail={`${selected}로 저장했습니다. 데스크톱 설정과 같은 값입니다.`} icon="check" title="저장됨" /> : null}
      <Section>{visible.map((zone) => <button aria-pressed={selected === zone} className="model-row" key={zone} onClick={() => void choose(zone)} type="button"><strong>{zone}</strong></button>)}</Section>
    </SurfacePage>
  );
}

function usageWindowLabel(minutes: number): string {
  if (minutes % 10_080 === 0) return `${minutes / 10_080}주`;
  if (minutes % 1_440 === 0) return `${minutes / 1_440}일`;
  if (minutes % 60 === 0) return `${minutes / 60}시간`;
  return `${minutes}분`;
}

function usageResetLabel(timestampSeconds: number): string {
  return `${new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(timestampSeconds * 1_000))} 초기화`;
}

function tokenLabel(tokens: number): string {
  return new Intl.NumberFormat("ko-KR", { notation: "compact", maximumFractionDigits: 1 }).format(tokens);
}

function planLabel(planType: string | null): string {
  if (planType == null) return "Codex";
  return `Codex ${planType.charAt(0).toUpperCase()}${planType.slice(1)}`;
}

function usdLabel(cost: number, costKnown: boolean): string {
  const value = cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
  return costKnown ? value : `${value}+?`;
}

/** The weekly window is what the user watches; put it first, then any shorter windows. */
function orderedWindows(windows: CodexUsage["windows"]): CodexUsage["windows"] {
  return [...windows].sort((a, b) => b.windowDurationMins - a.windowDurationMins);
}

function statLine(stat: UsageStat): string {
  const input = tokenLabel(stat.uncachedInput + stat.cacheRead + stat.cacheWrite);
  const reasoning = stat.reasoningKnown ? ` · 추론 ${tokenLabel(stat.reasoning)}` : "";
  return `${stat.calls}회 · 입력 ${input} · 출력 ${tokenLabel(stat.output)}${reasoning}`;
}

function TokenBars({ rows, title, detail }: { rows: UsageStat[]; title: string; detail?: string }) {
  if (rows.length === 0) return null;
  const max = Math.max(1e-9, ...rows.map((row) => row.cost));
  return (
    <Section detail={detail} title={title}>
      {rows.map((row) => (
        <div className="token-row" key={row.label}>
          <div className="token-row-head"><strong>{row.label}</strong><span>{usdLabel(row.cost, row.costKnown)}</span></div>
          <span className="token-bar" role="presentation"><i style={{ width: `${Math.min(100, Math.round((row.cost / max) * 100))}%` }} /></span>
          <small>{statLine(row)}</small>
        </div>
      ))}
    </Section>
  );
}

export function UsageScreen({ back }: SurfaceScreenProps) {
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const [ledger, setLedger] = useState<UsageLedger | null>(null);
  const [error, setError] = useState("");
  async function load() {
    setError("");
    try { setUsage(await api.codexUsage()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "Codex 사용량을 불러오지 못했습니다."); }
    try { setLedger(await api.usageLedger()); }
    catch { /* token activity is best-effort; the limit card still shows */ }
  }
  useEffect(() => { void load(); }, []);
  const jobRows = (ledger?.byJob ?? []).filter((row) => !row.label.startsWith("(") || row.label.startsWith("(공유"));
  return (
    <SurfacePage back={back} subtitle={usage ? `${planLabel(usage.planType)} · 실제 계정` : undefined} title="사용량">
      {error ? <ScreenError message={error} retry={() => void load()} /> : usage == null ? <ScreenSkeleton rows={4} /> : <>
        <Section detail="현재 Codex 계정에서 직접 읽은 한도입니다. 남은 양은 100%에서 사용한 만큼을 뺀 값입니다." title="사용 한도">
          <div className="usage-cards">{orderedWindows(usage.windows).map((window) => <div className="usage-hero" key={window.id}>
            <small>{window.limitName} · {usageWindowLabel(window.windowDurationMins)}</small>
            <strong>{Math.max(0, Math.round(100 - window.usedPercent))}% 남음</strong>
            <span aria-label={`${window.limitName} ${Math.round(window.usedPercent)}% 사용`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={window.usedPercent} role="progressbar"><i style={{ width: `${window.usedPercent}%` }} /></span>
            <small>{Math.round(window.usedPercent)}% 사용 · {usageResetLabel(window.resetsAt)}</small>
          </div>)}</div>
        </Section>
        {usage.resetCredits != null && usage.resetCredits > 0 ? <InlineNotice detail={`${usage.resetCredits}회 사용할 수 있습니다.`} icon="check" title="한도 초기화 이용권" /> : null}
        {ledger == null || ledger.total.calls === 0 ? (
          <InlineNotice detail="우리 시스템이 직접 잰 값입니다. 오늘 기록이 아직 없습니다." title="토큰 활동" />
        ) : <>
          <Section detail="우리 시스템이 직접 잰 오늘 사용량입니다. API 단가 환산이며 Codex 구독 차감액과는 별개입니다." title="토큰 활동">
            <div className="usage-cards"><div className="usage-hero">
              <small>오늘 · API 환산 비용</small>
              <strong>{usdLabel(ledger.total.cost, ledger.total.costKnown)}</strong>
              <small>{statLine(ledger.total)}</small>
            </div></div>
          </Section>
          <TokenBars detail="봇마다 오늘 쓴 비용" rows={ledger.byBot} title="봇별" />
          <TokenBars detail="모델마다 오늘 쓴 비용" rows={ledger.byModel} title="모델별" />
          {jobRows.length > 0 ? <TokenBars detail="[job:이름] 태그로 묶인 작업" rows={jobRows} title="작업별" /> : null}
        </>}
      </>}
    </SurfacePage>
  );
}

export function SubscriptionScreen({ back, open }: SurfaceScreenProps) {
  const [usage, setUsage] = useState<CodexUsage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { void api.codexUsage().then(setUsage).catch((caught) => setError(caught instanceof Error ? caught.message : "계정 정보를 불러오지 못했습니다.")); }, []);
  return (
    <SurfacePage back={back} subtitle="이 Belmont는 Codex 계정으로 돌아갑니다" title="플랜">
      {error ? <InlineNotice detail={error} title="오류" /> : usage == null ? <ScreenSkeleton rows={3} /> : <>
        <Section title="현재 플랜"><NavRow detail={usage.windows.length > 0 ? `${usage.windows.length}개 한도 창` : "한도 정보 없음"} icon="usage" title={planLabel(usage.planType)} /></Section>
        <Section detail="xAI 구독(Personal/Pro)은 이 판에 없습니다. 실제 한도와 사용량은 Codex 계정 값입니다."><NavRow detail="한도와 토큰 활동 보기" icon="sparkle" onClick={() => open("UsageScreen")} title="사용량" /></Section>
      </>}
    </SurfacePage>
  );
}

export function AccountSheet({ back, bot }: SurfaceScreenProps) {
  return <SurfacePage back={back} title="계정"><div className="account-hero"><BabyGrokAvatar color={bot?.avatar.color ?? "green"} shape={bot?.avatar.shape ?? "cloud"} size={86} state="idle" /><strong>{bot?.name ?? "Belmont"}</strong><small>연결된 로컬 호스트</small></div><Section><NavRow detail="HttpOnly 페어링 세션" icon="account" title="모바일 인증" /><NavRow detail="Belmont 데스크톱의 로컬 데이터" icon="display" title="데이터 위치" /></Section><InlineNotice detail="개인 이름이나 이니셜을 추측하지 않고 실제 연결 대상만 표시합니다." icon="check" title="연결된 계정" /></SurfacePage>;
}

export function FeedbackSheet({ back, open }: SurfaceScreenProps) {
  const [kind, setKind] = useState("아이디어");
  const [detail, setDetail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");
  async function send() {
    if (status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await api.feedback({ kind: "feedback", category: kind, detail });
      try { const current = JSON.parse(localStorage.getItem("linear-feedback") ?? "[]") as unknown[]; localStorage.setItem("linear-feedback", JSON.stringify([...current, { kind, detail, createdAt: Date.now() }])); } catch {}
      setStatus("sent");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "보내지 못했습니다."); setStatus("idle"); }
  }
  return <SurfacePage back={back} title="피드백">{status === "sent" ? <div className="centered-hero compact-hero"><BabyGrokAvatar color="green" shape="cloud" size={100} state="happy" /><h1>Belmont 호스트에 기록했습니다</h1><p>sand-data/mobile-feedback.jsonl 에 쌓입니다.</p><button className="surface-link" onClick={back} type="button">돌아가기</button></div> : <><Section title="종류"><ChoiceChips onChange={setKind} selected={kind} values={["아이디어", "문제", "칭찬", "기타"]} /></Section><TextField label="내용" multiline onChange={setDetail} placeholder="무엇을 바꾸면 좋을까요?" value={detail} />{error ? <InlineNotice detail={error} title="전송 실패" /> : null}<PrimaryButton disabled={!detail.trim() || status === "sending"} onClick={() => void send()}>{status === "sending" ? "보내는 중…" : "보내기"}</PrimaryButton><button className="surface-link" onClick={() => open("AppStoreReviewFlowSheet")} type="button">앱 평가하기</button></>}</SurfacePage>;
}

export function AppStoreReviewFlowSheet({ back }: SurfaceScreenProps) {
  const [rating, setRating] = useState(0);
  const [status, setStatus] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");
  async function send() {
    if (rating === 0 || status === "sending") return;
    setStatus("sending");
    setError("");
    try {
      await api.feedback({ kind: "rating", rating });
      try { localStorage.setItem("linear-app-rating", JSON.stringify({ rating, savedAt: Date.now() })); } catch {}
      setStatus("done");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "보내지 못했습니다."); setStatus("idle"); }
  }
  return <SurfacePage back={back} title="Linear 평가">{status === "done" ? <div className="centered-hero compact-hero"><BabyGrokAvatar color="yellow" shape="arch" size={105} state="proud" /><h1>평가를 기록했습니다</h1><p>앱 스토어가 없어 Belmont 호스트에 남깁니다.</p></div> : <div className="review-card"><BabyGrokAvatar color="yellow" shape="arch" size={96} state="happy" /><h1>이 앱은 어떤가요?</h1><div className="rating-row">{[1, 2, 3, 4, 5].map((value) => <button aria-label={`${value}점`} aria-pressed={rating >= value} key={value} onClick={() => setRating(value)} type="button">★</button>)}</div>{error ? <InlineNotice detail={error} title="전송 실패" /> : null}<PrimaryButton disabled={rating === 0 || status === "sending"} onClick={() => void send()}>{status === "sending" ? "보내는 중…" : "평가 보내기"}</PrimaryButton></div>}</SurfacePage>;
}
