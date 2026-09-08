import { useState } from "react";
import { api, MobileApiError } from "../api";
import { BabyGrokAvatar } from "../components/BabyGrokAvatar";
import { Icon } from "../components/Icon";

export function OnboardingScreen({ onPaired }: { onPaired: () => void }) {
  const [showCode, setShowCode] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function pair() {
    if (code.length !== 6 || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      await api.pair(code);
      onPaired();
    } catch (caught) {
      setError(caught instanceof MobileApiError ? caught.message : "페어링에 실패했습니다.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-screen">
      <BabyGrokAvatar className="onboarding-avatar avatar-one" color="magenta" shape="teardrop" size={70} state="playful" />
      <BabyGrokAvatar className="onboarding-avatar avatar-two" color="violet" shape="blob" size={65} state="happy" />
      <BabyGrokAvatar className="onboarding-avatar avatar-three" color="orange" shape="egg" size={58} state="curious" />
      <BabyGrokAvatar className="onboarding-avatar avatar-four" color="gray" shape="tablet" size={58} state="searching" />
      <BabyGrokAvatar className="onboarding-avatar avatar-five" color="cyan" shape="hex" size={70} state="excited" />
      <BabyGrokAvatar className="onboarding-avatar avatar-six" color="blue" shape="teardrop" size={54} state="listening" />
      <BabyGrokAvatar className="onboarding-avatar avatar-seven" color="yellow" shape="arch" size={64} state="proud" />
      <section className="onboarding-copy">
        <h1>Linear</h1>
        <p>데스크톱의 Belmont와 모든 Bot을<br />휴대폰에서 이어서 사용합니다.</p>
        {!showCode ? (
          <button className="primary-pill" onClick={() => setShowCode(true)} type="button">연결하기 <Icon name="chevronRight" size={18} /></button>
        ) : (
          <form className="pair-form" onSubmit={(event) => { event.preventDefault(); void pair(); }}>
            <label htmlFor="pair-code">데스크톱 터미널에 표시된 6자리 코드</label>
            <input autoComplete="one-time-code" autoFocus id="pair-code" inputMode="numeric" maxLength={6} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="000000" value={code} />
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <button className="primary-pill" disabled={code.length !== 6 || submitting} type="submit">{submitting ? "연결 중" : "페어링"}</button>
          </form>
        )}
      </section>
    </main>
  );
}
