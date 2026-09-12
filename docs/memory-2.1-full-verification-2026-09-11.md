# Belmont Memory 2.1 — 전체 실 검증 (2026-09-11, 정정본 v2)

"다해라" 3항목(정적 실패 보완 / 실제 E5 dense / 라이브 shadow-read)을 실행한 기록.
독립 검토 지적(A 로그 미저장, B 실행연결 부족, **C: list와 검색 혼동**)을 반영해 v1의 과장을 정정하고,
C의 실제 검색 배선을 다시 검증했다.

---

## 결론 (정정)

**일부 fixture·경로 실행 근거는 확보했으나, 제품 host 통합(실 turn→검색→prompt 전체 경로,
lifecycle 학습, 도구 grounding)은 아직 미확인이다.** cutover 전 추가 검증이 필요하다.

v1의 "shadow-read 검증 완료, 남은 건 cutover와 Aside E2E뿐"은 **과장이었고 철회**한다.

---

## A. 정적 실패 2건 보완 — ✅ (로그 저장 완료)

- 두 실패는 공백/개행 차이. 계약(factory 연결 / id??memoryId) 유지하며 `\s*`로 갱신
  (`tests/host-wiring-parity.test.mjs`, `tests/mobile-host-hooks.test.mjs`).
- **정정**: v1은 "전체 fail 0"을 주장하며 로그를 증거 폴더에 안 남겼다(이전 저장본은 여전히 1077/fail2).
  → 재실행 후 **로그 저장**: `data/artifacts/memory_2_1_report_review_20260911/e2e/memtest-after-fix-clean.log`
  (**1081 tests / pass 1079 / fail 0 / skip 2 / exit 0**, sha256 `cc2497af…`). 이제 확인 가능.

## B. 실제 E5 dense — ✅ 실행, 단 실행연결 기록은 보강 필요

- `multilingual-e5-small` rev `fd1525a9…` 로드 → `"status":"ready"`. bench `Dense model state: executed`.
- **저장 JSON 값**(`e2e/repository-ablation-real-e5.json`, `modelState:executed`, `measuredSemanticDenseGain:0`):

| | B (planning, sparse) | C (+실제 dense) | 차이 |
|---|---|---|---|
| Recall@10 | 0.857 | 0.857 | **Δ 0** |
| abstention | 0.75 | **0.5** | 하락 |
| p50 ms | (표시 실행별 변동) | **8.7606** | 독립 재계산 0.459→8.761 ≈ **19.1×** |
| evidencePrecision | 0.551 | **0.519** | 하락 |

- **정정**: v1 본문의 "p50 0.45→8.5"는 다른 실행값이었다. **저장 JSON의 정확한 C p50=8.7606ms**를 기준으로 한다.
- **한계(지적 반영)**: E5 로드 로그는 있으나 **strict 실행 명령·종료코드를 같은 실행에 묶은 기록이 부족**하다.
  strict gate exit 0은 관찰했으나 로그로 고정하지 않았다. → 다음 실행에서 명령/exit/stdout을 함께 보존.
- 판정: **실추론은 됨. 이 fixture에선 dense 이득 0(오히려 약간 나쁨).** 실개인 holdout 이득은 여전히 별도.

## C. 라이브 검색 배선 — ✅ 재검증 (v1의 list 혼동 정정)

**정정(핵심)**: v1은 `learning.list()`(=목록 읽기)를 "검색 배선 검증"이라 했다. 이는 틀렸다.
실제 검색은 `prepareMemoryTurn()` → `retrieval.retrieve()`다. 이를 실제로 태워 재검증했다.

실프로필 복사본(원본 무변경, 17 에이전트·210 메모리)을 shadow-read/canonical로 migration 후:

| 검증 | 방법 | 결과 |
|---|---|---|
| **실제 검색 실행** | `prepareMemoryTurn({query:"Job sweeper check"})` → `retrieval.retrieve()` | ✅ scope 15개 중 **7건 hit** |
| **shadow-read 미주입** | 검색 후 `getMemoryContext()` | ✅ **길이 0** ("shadow retrieval is never injected") |
| **canonical 주입** | cutover 후 같은 검색 | ✅ **8347자, `<memory_evidence>` 포함** |
| scope 전파 | principal `belmont-search-test` → `owner:…:shard:…` | ✅ 일치 |

→ 실 turn 검색 경로(`prepareMemoryTurn→retrieve`)와 stage별 주입 정책(shadow=미주입 / canonical=주입)을
**실제 실행으로 입증**. (v1의 list 근거는 폐기.)

## 여전히 미확인 (지적 반영 — cutover 전 필요)

독립 검토가 짚은 대로, 아래는 **아직 안 했다**:

1. **제품 host 턴 전체 경로**: send-pipeline→onAuthenticatedUserTurn→episode close→dreaming→
   prepareMemoryTurn→prompt 조립까지 **실제 host runner**로 태운 검증. (이번은 runtime을 직접 호출.)
2. **인증·scope 전파**: 실제 auth extension의 principal이 turn마다 올바른 scope로 흐르는지.
3. **lifecycle 학습**: open/switch/retire/inactivity/shutdown/restart, checkpoint 앞뒤 crash에서
   admission·episode·dreaming 동작.
4. **일반 도구 grounding**: 실제 browser tool schema에 field 매핑(`groundBrowserTool`)이 실 tool 호출에 붙는지.
5. **실봇 cutover**: 검증은 전부 복사본. 실프로필 canonical 전환은 운영 승인 사항(이번 안 함).
6. **Aside 브라우저 E2E** / 실개인 holdout dense 이득 / threshold 0.86 calibration.

이 목록은 기존 handoff(`memory-2.1-runtime-handoff.ko.md`) 검증 TODO와 동일하다.

## 정확한 현재 표현

> **"일부 fixture·경로 실행 근거 확보(정적 fail 0 로그·실 E5·prepareMemoryTurn 검색/주입 대비),
> 제품 host 통합(전체 turn 경로·인증전파·lifecycle·grounding)은 미확인. cutover 부적합."**

## 상태·증거
- 실프로필 **무변경**(legacy 유지, `.cache/.../memory-2.1` 없음). 라이브 봇 정상. 임시 sandbox 정리.
- 수정: 테스트 2개 정규식만(제품 코드 무수정).
- 증거: `data/artifacts/memory_2_1_report_review_20260911/e2e/`
  (`memtest-after-fix-clean.log` 1079/fail0, `repository-ablation-real-e5.json` dense 실측).
- Node 26.5.0, 브랜치 feat/skill-scope-fields, HEAD af95bca. (이 실행의 실제 로그 기록. 이후 2026-09-11 sweep9 재검증은 26.8.1에서 수행 — 둘은 구분한다.)
