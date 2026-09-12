# routines / skills / canvas — 0.30 → 0.47 재확인 (정정판, 2026-09-11)

앞 원장에서 "파일 수" 기준으로 routines(13→18)·skills(8→14)·canvas(15→33)를 "확장"이라 했는데,
**실제 기능 식별자로 다시 재보니 상당수가 착시**였다. 정직하게 정정한다.

전제: 0.30·0.47 asar를 실제 추출해 **기능 식별자(Routine*/Skill*/Canvas*)를 직접 비교**.

---

## 결론 (정정)

| marker | 파일수 표기 | **실제 기능 변화** | 정정 판정 |
|---|---|---|---|
| **routines** | 13→18 | **거의 없음** (식별자 오히려 감소) | ❌ **착시** — 파일 증가는 `main.cjs`가 main-app/core/proto로 쪼개진 번들 분화 탓 |
| **skills** | 8→14 | **소폭** (멘션/가져오기 추가, 경로관리 리팩터) | △ **작은 변화** |
| **canvas** | 15→33 | **소폭** (식별자 51→56) | △ **소폭 확장** |

→ 앞서 "확장분 반영 가치"라 한 것 중 **routines는 사실상 반영할 게 없다.** skills·canvas도 대규모 아님.

---

## 근거 (실측)

### routines — 착시 확정
- 0.30: routine이 `electron-main/main.cjs` 1개에 있었음.
- 0.47: 그 main.cjs가 `main-app.cjs`/`main-core.cjs`/`proto.cjs` + `local-exec-daemon/main.cjs` +
  `node-agent-coordinator/main.cjs`로 **분화** → routine 문자열이 여러 파일에 퍼져 "13→18"로 잡힘.
- **기능 식별자는 오히려 감소**:
  - 0.30: `createRoutine, openRoutine, routineGlyph, routineStatus, routineId` …
  - 0.47: `agentRoutine, routineBias, routineRefMap` (더 적음)
- 판정: **routines 자체는 0.30→0.47에서 실질 변화 없음.** 반영할 확장분 없음.

### skills — 작은 변화
- **신규**: `SkillRefId`, `SkillsEvent`, `skillMentionEmptyEditor`
  → 컴포저에서 **스킬 @멘션**(빈 에디터 힌트) + 이벤트 훅.
- **제거(리팩터)**: `SkillConfigDirs`, `SkillDir`, `SkillPath`, `SkillRoot(s)`, `SkillsForPromptOrder`
  → 스킬 **경로/로딩 방식 재구성**(파일 경로 기반 → ref/id 기반으로 추정).
- **UI 텍스트**: "Imported skill", "Private skill", "Open this skill in Settings", "Reference a skill",
  "Open a Bot to add/see private skills" → 스킬 **가져오기·비공개·봇 연동** 표현.
- 판정: **에디터 멘션 + 가져오기/비공개 정도의 소폭 개선.** 대규모 확장 아님.

### canvas — 소폭 확장
- 고유 식별자 **51 → 56** (+5). 신규: `CanvasBundle`, `CanvasPayloadIdentityError` 등.
- 구조(CanvasByKey/Metadata/Payload/Preview/Settings request-response)는 0.30과 동일 골격.
- 전용 의존성 `@anysphere/canvas-shared`는 0.47 신규지만, 식별자 증가는 소폭 → **골격 유지 + 소폭 보강.**
- 판정: **점진 개선.** UI 취향에 맞으면 참고, 아니면 스킵해도 손실 작음.

---

## 그래서 이 세 개, 다시 정리

| marker | 챙길 가치 | 실제 할 일 |
|---|---|---|
| **routines** | **낮음** | 0.30→0.47 반영할 것 없음 (우리가 이미 가진 수준) |
| **skills** | **낮~중** | 원하면 "스킬 @멘션 + 가져오기" 정도만 참고 |
| **canvas** | **낮~중** | UI 필요하면 참고, 아니면 스킵 |

**핵심 교훈**: minified 번들에서 "파일 수 marker"는 **번들 분화에 오염**된다. 의미 판정은 반드시
**기능 식별자/UI 텍스트**로 교차확인해야 한다. (앞 원장의 명시한 한계가 실제로 이 세 개에서 터진 것.)

---

## 남는 실질 가치 (앞 판정 중 살아남는 것)

세 개를 걷어내면, 0.30→0.47에서 **진짜 챙길 것**은:
1. **1Password 연동** (신규, 연동코드 완전 추출) — 우리 vault와 겹침
2. **MCP 계약 확대** (프로토콜/트랜스포트) — 도구 호환

이 둘이 실질 우선순위다. routines/skills/canvas는 "있으면 참고, 없어도 무방" 수준.
