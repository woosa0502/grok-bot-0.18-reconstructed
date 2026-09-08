import { useEffect, useState } from "react";
import { api } from "../api";
import { disablePush, enablePush, getPushState } from "../push-client";
import { clearSendIntentJournal } from "../send-intent-journal";
import { BabyGrokAvatar } from "../components/BabyGrokAvatar";
import { Icon } from "../components/Icon";
import { ScreenError, ScreenSkeleton } from "../components/ScreenState";
import type { AppRoute, SurfaceId } from "../navigation";
import type { Bot, MobileSettings } from "../types";

function Switch({ checked, disabled, onChange, label }: { checked: boolean; disabled?: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button aria-checked={checked} aria-label={label} className={`switch ${checked ? "on" : ""}`} disabled={disabled} onClick={() => onChange(!checked)} role="switch" type="button"><i /></button>;
}

export function SettingsScreen({ manager, onBack, onLogout, onOpen }: { manager: Bot | null; onBack: () => void; onLogout: () => void; onOpen: (name: SurfaceId, route?: Omit<AppRoute, "name">) => void }) {
  const [settings, setSettings] = useState<MobileSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState("");
  const [pushState, setPushState] = useState<Awaited<ReturnType<typeof getPushState>> | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try { const [settings, push] = await Promise.all([api.settings(), getPushState().catch((caught) => { setError(caught instanceof Error ? caught.message : "알림 설정을 확인하지 못했습니다."); return null; })]); setSettings(settings); setPushState(push); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "설정을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function save<K extends keyof MobileSettings>(key: K, value: MobileSettings[K]) {
    if (saving) return;
    setSaving(String(key));
    setError("");
    try { setSettings(await api.setSetting(key, value)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "설정을 저장하지 못했습니다."); }
    finally { setSaving(""); }
  }

  async function logout() {
    // A different pairing must never inherit an unresolved send from this connection.
    try { await clearSendIntentJournal(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "전송 기록을 정리하지 못했습니다."); return; }
    await api.logout().catch(() => undefined);
    onLogout();
  }

  async function saveNotifications(enabled: boolean) {
    if (saving) return;
    setSaving("notificationsEnabled");
    setError("");
    try {
      if (enabled) setPushState(await enablePush());
      else { await disablePush(); setPushState(await getPushState()); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "알림 설정을 바꾸지 못했습니다."); }
    finally { setSaving(""); }
  }

  return (
    <main className="app-screen settings-screen">
      <header className="sheet-toolbar"><button aria-label="홈으로" className="circle-button" onClick={onBack} type="button"><Icon name="back" size={22} /></button><h1>설정</h1><span /></header>
      <button className="settings-profile" onClick={() => onOpen("AccountSheet")} type="button">
        {manager ? <BabyGrokAvatar color={manager.avatar.color} label={manager.name} shape={manager.avatar.shape} size={94} state={manager.characterState ?? (manager.isRunning ? "working" : "idle")} /> : <span className="empty-avatar"><Icon name="person" size={30} /></span>}
        <strong>{manager?.name ?? "Belmont"}</strong><small>데스크톱에 연결됨</small>
      </button>
      {loading ? <ScreenSkeleton rows={5} /> : null}
      {!loading && error && settings == null ? <ScreenError message={error} retry={() => void load()} /> : null}
      {settings ? (
        <div className="settings-groups">
          <section><h2>앱</h2>
            <div className="settings-row"><span className="settings-symbol"><Icon name="bell" size={19} /></span><span><strong>알림</strong><small>{pushState?.subscribed && pushState.enabled ? "이 기기에서 Bot의 새 활동을 알려줍니다" : "이 기기의 푸시 알림을 연결하세요"}</small></span><Switch checked={Boolean(pushState?.subscribed && pushState.enabled)} disabled={saving === "notificationsEnabled"} label="알림" onChange={(value) => void saveNotifications(value)} /></div>
            <button className="settings-row" onClick={() => onOpen("NotificationsAskScreen")} type="button"><span className="settings-symbol"><Icon name="bell" size={19} /></span><span><strong>알림 권한</strong><small>이 기기의 브라우저 알림 설정</small></span><Icon name="chevronRight" size={14} /></button>
          </section>
          <section><h2>Bot 권한</h2>
            <div className="settings-row"><span className="settings-symbol"><Icon name="sparkle" size={19} /></span><span><strong>자동 검토</strong><small>규칙에 맞는 작업을 자동 승인</small></span><Switch checked={settings.autoReviewEnabled} disabled={saving === "autoReviewEnabled"} label="자동 검토" onChange={(value) => void save("autoReviewEnabled", value)} /></div>
            <label className="settings-row"><span className="settings-symbol"><Icon name="display" size={19} /></span><span><strong>로컬 도구</strong><small>컴퓨터 명령 실행 권한</small></span><select aria-label="로컬 도구 권한" disabled={saving === "localToolPermission"} onChange={(event) => void save("localToolPermission", event.target.value as MobileSettings["localToolPermission"])} value={settings.localToolPermission}><option value="ask">매번 묻기</option><option value="always">항상 허용</option><option value="never">허용 안 함</option></select></label>
          </section>
          <section><h2>데스크톱</h2>
            <div className="settings-row static"><span className="settings-symbol"><Icon name="plug" size={19} /></span><span><strong>호스트 상태</strong><small>{settings.hostBusy ? "작업 실행 중" : "연결됨"}{settings.latestHostVersion ? ` · ${settings.latestHostVersion}` : ""}</small></span><i className="connection-dot" /></div>
            <div className="settings-row static"><span className="settings-symbol"><Icon name="globe" size={19} /></span><span><strong>시간대</strong><small>{settings.userTimeZone}</small></span></div>
          </section>
          <section><h2>개인 설정</h2>
            <button className="settings-row" onClick={() => onOpen("AppearanceScreen")} type="button"><span className="settings-symbol"><Icon name="palette" size={19} /></span><span><strong>화면 표시</strong><small>색상과 목록 밀도</small></span><Icon name="chevronRight" size={14} /></button>
            <button className="settings-row" onClick={() => onOpen("DefaultModelScreen")} type="button"><span className="settings-symbol"><Icon name="model" size={19} /></span><span><strong>기본 모델</strong><small>새 대화의 모델 선택</small></span><Icon name="chevronRight" size={14} /></button>
            <button className="settings-row" onClick={() => onOpen("LanguageScreen")} type="button"><span className="settings-symbol"><Icon name="language" size={19} /></span><span><strong>언어</strong><small>한국어</small></span><Icon name="chevronRight" size={14} /></button>
            <button className="settings-row" onClick={() => onOpen("HapticsScreen")} type="button"><span className="settings-symbol"><Icon name="haptics" size={19} /></span><span><strong>햅틱</strong><small>터치 피드백</small></span><Icon name="chevronRight" size={14} /></button>
            <button className="settings-row" onClick={() => onOpen("TimeZoneScreen")} type="button"><span className="settings-symbol"><Icon name="clock" size={19} /></span><span><strong>시간대</strong><small>{settings.userTimeZone}</small></span><Icon name="chevronRight" size={14} /></button>
          </section>
          <section><h2>기능</h2>
            <button className="settings-row" onClick={() => onOpen("PluginsScreen")} type="button"><span className="settings-symbol"><Icon name="plug" size={19} /></span><span><strong>플러그인과 스킬</strong><small>Bot 도구 관리</small></span><Icon name="chevronRight" size={14} /></button>
            <button className="settings-row" onClick={() => onOpen("AutoReviewRulesScreen")} type="button"><span className="settings-symbol"><Icon name="check" size={19} /></span><span><strong>자동 검토 규칙</strong><small>승인 정책</small></span><Icon name="chevronRight" size={14} /></button>
            <button className="settings-row" onClick={() => onOpen("AutofillScreen")} type="button"><span className="settings-symbol"><Icon name="account" size={19} /></span><span><strong>자동 완성</strong><small>자주 쓰는 정보</small></span><Icon name="chevronRight" size={14} /></button>
          </section>
          <section><h2>계정과 지원</h2>
            <button className="settings-row" onClick={() => onOpen("UsageScreen")} type="button"><span className="settings-symbol"><Icon name="usage" size={19} /></span><span><strong>사용량</strong><small>Codex 한도와 토큰 활동</small></span><Icon name="chevronRight" size={14} /></button>
          </section>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
          <button className="logout-button" onClick={() => void logout()} type="button"><Icon name="signOut" size={18} /> 연결 해제</button>
          <p className="settings-footnote">Grok Bot Android 1.5.0 (120) 화면 구조를 Linear 데스크톱 기능에 맞게 복원한 모바일 클라이언트입니다.</p>
        </div>
      ) : null}
    </main>
  );
}
