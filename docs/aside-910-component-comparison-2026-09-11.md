# Aside 1.0.910.1 — 우리 909 이후 컴포넌트 변경 비교 (2026-09-11)

우리 최신(Aside 앱 1.0.825.1 / 엔진 1.26.909.1820) 이후 나온 **1.0.910.1**을 조사.
changelog뿐 아니라 **실제 컴포넌트(데몬·에이전트확장·비번확장)를 Omaha로 받아 909와 diff**.

---

## 결론 (한 줄)

**우리 이후 나온 건 1.0.910.1 딱 하나. 핵심은 Chromium 151→152.** 우리가 실제 쓰는
데몬·확장은 909→910에서 **거의 안 바뀜**(vault 동기화 미세 개선뿐), **우리 패치 체인은 910에 그대로 적용 가능.**

---

## 버전 체계 정리

| | 우리 현재 | 최신(910) |
|---|---|---|
| Aside 앱(.dmg/.crx3) | 1.0.825.1 | **1.0.910.1** |
| Chromium | 151.0.7922 | **152.0.7977.83** |
| 엔진 컴포넌트(데몬/확장) | 1.26.909.1820 | **1.26.910.1749** |

- 825.1 ~ 910.1 사이 공개 릴리스 **없음**(813/811/728 등은 825보다 이전).
- 컴포넌트 버전은 앱과 별도: 910 앱 = 910.1749 컴포넌트(Omaha 조회로 확인).

## Omaha 조회 (재현)

```
POST https://ptqgesmtzwdmeiknncqc.supabase.co/functions/v1/omaha
{"request":{"protocol":"4.0","updaterversion":"152.0.7977.83","os":{"platform":"mac",...},
 "apps":[{"appid":"kbbaihbiiohdfpocgkpkmngpjcpddbhh",...},  # daemon
          {"appid":"fjdhphbdlfjogobdofoaagnlnkoibdge",...},  # agent-manager
          {"appid":"clcdgiameigmljcbkkcbjiljinmfkncl",...}]}} # password-manager
→ 3개 모두 nextversion 1.26.910.1749
다운로드: https://releases.aside.com/dev-updater/components/1.26.910.1749/...
```

---

## 컴포넌트별 실측 diff (909 원본 vs 910)

### 1. 에이전트 확장 (agent-manager) — 거의 불변
- 파일 구조 동일(1235 vs 1234, Vite 콘텐츠해시만 바뀜).
- UI 문자열 4545 → 4548, **신규 딱 4개**:
  `"Automatic administrator access"`, `"Vault owner"`,
  `"No organizations yet. Create one in the web dashboard."`, `"Failed to resolve the edited turn."`
- 판정: **에이전트 UI 실질 변경 없음.** changelog의 카드레이아웃/Memory Saver 등은 확장이 아니라
  네이티브 브라우저(Chromium) 쪽.

### 2. 데몬 (우리가 실제 실행하는 핵심) — 미세 변경
- JS 크기 10,744,442 → 10,745,360 (**+918바이트**).
- **신규 문자열 5개**(버전 제외):
  - `[PWMSync] Rebased conflicting vault appearance edit` — 비번 금고 동기화 충돌 해결
  - `${oi} wants to use Aside.` — 권한 프롬프트 문구
  - vault mergeItem/operation 병합 로직 소폭
- **내장 스킬 목록: 변화 없음.** **도구(tool) 신규: 없음.**
- 판정: **데몬 변경 = 비밀번호 금고 동기화 개선 정도.** 에이전트/스킬/도구 로직 무변경.

### 3. 비번 확장 (password-manager) — 크기만 소폭
- 1,755,660 → 1,757,010 (+1350B). 데몬 vault sync 변경과 짝.

---

## 우리 패치 체인 호환성 (중요)

909에서 쓴 패치 앵커가 910에도 **개수 완전 동일**:

| 앵커 | 909 | 910 |
|---|---|---|
| globalCdpClient | 12 | 12 |
| memory_search | 7 | 7 |
| reconcileSessionTabs | 1 | 1 |
| browserMode | 13 | 13 |

→ **우리 `patch-daemon.py` 체인이 910에 그대로 적용됨.** 앵커 재작업 불필요(909→909 때는 앵커가
바뀌었지만, 909→910은 안 바뀜).

---

## 1.0.910.1 changelog (검증됨, docs.aside.com/changelog/native)

| 변경 | 어디 | 우리 관련 |
|---|---|---|
| **Chromium 151→152** | 브라우저 엔진 | ⚠️ fork 리베이스 시 핵심 |
| Card layout(가로탭), 사이드바/탭 UX, 채팅 고정/삭제, 툴바 커스텀 | 네이티브 UI | 낮음(Linux fork) |
| **Memory Saver 기본 켜짐** | 네이티브 | 참고(우리 OOM 이력) |
| Helium browser import, Mini Popup 위치기억 | 네이티브 | 낮음 |
| vault 동기화 충돌 해결 | **데몬** | 소폭(우리도 반영 가능) |
| 안정성(트랙패드·테마·macOS) | 네이티브/macOS | 낮음 |

---

## 우리(Linux fork + 909) 판정

| 항목 | 판정 |
|---|---|
| **엔진 909→910 올릴 가치** | **낮음.** 데몬·확장 실질 변경 미미(vault sync뿐). 굳이 안 올려도 됨 |
| 패치 체인 | 910에 그대로 적용 가능(앵커 동일) — 올리기로 하면 쉬움 |
| **Chromium 152 리베이스** | 별개의 큰 작업. 910의 진짜 알맹이지만 우리 fork(151)엔 대공사 |
| vault sync 개선 | 필요하면 데몬 패치로 소폭 반영 가능 |

**추천: 지금 910으로 안 올려도 무방.** 909→910은 우리에게 거의 이득 없음(네이티브 UI + Chromium이 본체,
우리가 쓰는 데몬/확장은 vault sync 미세개선뿐). Chromium 152가 필요해질 때 리베이스와 함께 검토.

---

## 아티팩트
- 910 앱: `Aside-1.0.910.1.crx3` (437MB, sha e814423b…)
- 910 컴포넌트: AsideDaemon/AgentManager/PasswordManager 1.26.910.1749 (scratchpad)
- 910 데몬 JS: 추출·node--check 통과 (DAEMON_VERSION 1.26.910.1749)
- 비교 기준: `research-archives/.../AsideDaemon-win-x64-1.26.909.1820.mjs`, `data/artifacts/aside-909-20260909/`
