# Belmont Memory 2.1 — 실행 검증 보고 (2026-09-11)

v3 테스트 보고서(`memory-2.1-test-report-2026-09-11.md`)가 `unverified`로 남긴
canonical 기능·dense·migration·grounding·lifecycle을 **실제로 실행**해 판정으로 바꾼 기록.
**제품·테스트 코드는 수정하지 않았다.** 임시 E2E 하니스만 만들어 실행 후 제거했다.

---

## 결론

**canonical 삭제·검색·restart·migration 전 phase·dense fallback·grounding이 실제로 동작한다.**
v3의 "canonical 기능 회귀 미판정"을 아래 실행으로 **정상 동작 확인**으로 갱신한다.
단, 실제 신경 E5 추론·라이브 host 배선·Aside 브라우저 E2E는 여전히 미실행(모델·라이브 필요).

## 실행 증거 (provenance)

| 항목 | 값 |
|---|---|
| 브랜치 / HEAD | `feat/skill-scope-fields` / `af95bca…` (v3와 동일) |
| Node | v26.5.0 (`node:sqlite` 내장 사용) — 이 실행의 실제 로그 기록. (이후 sweep9 재검증은 v26.8.1에서 수행; 두 실행을 구분한다.) |
| 방식 | esbuild로 **제품 소스**(memory-service.ts, memory-migration.ts) 번들 → 실행. 코드 무수정 |
| 임시 sandRoot | scratchpad `mem-e2e/sand-data` (실프로필 아님, seed 2건) |
| 근거 보존 | `data/artifacts/memory_2_1_report_review_20260911/e2e/rollout-final-canonical.json` |

---

## 1. Migration 전 phase 실행 (handoff §5 TODO) — ✅

`scripts/memory-migrate.mjs`로 legacy → canonical 전 단계 실제 실행:
```
legacy → freeze → inventory → barriers → import → validation-ready → shadow-read → cutover(canonical)
```
- 각 phase가 실제로 stage를 전진시키고 `inventoryDigest`(c7b4a68…)를 고정.
- cutover는 `--approved-by --validation-artifact --inventory-digest` 없이는 진행 안 됨(gate 작동).
- 최종 `rollout.json`: stage=`canonical`, revision 7, migrationId, validationAuthorization 기록.

## 2. Legacy → canonical import 검증 — ✅

seed 2건(이름·좌석 선호)이 `canonical.sqlite`(147KB)로 import됨. `node:sqlite`로 직접 확인:
- `memory_item` 2 / `evidence` 2 / `revision` 2 / `receipt` 2 / `memory_fts` 2 / `outbox` 2.
- tombstone 0 (아직 삭제 전). FTS 인덱스 생성됨.

## 3. Canonical 삭제→재검색→restart (v3가 미판정한 핵심) — ✅ 8/8

제품 `MemoryService`를 canonical 모드로 세워 실제 태움:

| 검증 | 결과 |
|---|---|
| `isCanonical() === true` | ✅ |
| import 메모리 나열(2건) | ✅ |
| **`remove({agentId,id,memoryId})` → assertWritable → session.forget** | ✅ true 반환 (UUID `d4f54003…`) |
| 삭제 후 재나열: 대상 사라짐 | ✅ (2→1) |
| 형제 메모리 보존(scope 유지) | ✅ (이름 메모리 생존) |
| **restart(새 인스턴스) 후 tombstone 유지** | ✅ 부활 안 함 |
| restart 후 생존 메모리 유지 | ✅ |

→ 사용자가 지적한 "인증·scope·UUID mapping·session.forget 미실행" 경로를 **실제로 실행**했고,
삭제→반영→영속(tombstone)까지 정상 동작을 관찰했다.

## 4. Dense retrieval / fallback — ✅

`bench/ablation.mjs`(reference, 제품 kernel 동일 로직):
- A(원본 FTS) Recall@5=0.714 → B(query planning) **0.857** (+14.3pp, 문서 재현).
- **C(+dense) = B (동일)** + "Dense model state: **not_configured**" → **모델 없으면 sparse fallback 실동작**.
- **strict gate**: `BELMONT_REQUIRE_DENSE=1` → **exit 1**(모델 없음 정상 거부, 가짜 통과 안 함).
- closed-loop: 컨텍스트 6870→990 bytes **85.59% 축소**(같은 memory ID 유지) 재현.

주의: **실제 E5 신경 추론은 미실행**(모델 없음). dense의 의미검색 개선량은 여전히 null.

## 5. 회귀 — 제품 memory 테스트 + reference — ✅

| 스위트 | 결과 |
|---|---|
| 제품 `memory-state-integrity` | 14/14 |
| 제품 `memory-prompt-adapters` | 3/3 |
| 제품 `memory-synthesis-local` | 13/13 |
| 제품 `aside-memory-search` | 17/17 |
| reference `experience`(grounding/action) | 16/16 |
| reference `learning`(dreaming/extract) | 40/40 |

→ 통합이 기존 memory 기능을 깨지 않음(제품 47/47 + reference 56/56).

## 6. 여전히 미실행 (경계 유지)

- 실제 **E5 forward/semantic recall**(모델 다운로드 필요).
- **라이브 host 배선** 실동작(shadow-read부터, production data는 운영 승인 필요).
- **Aside 브라우저 E2E**(실사이트 trajectory→outcome→procedure).
- 이번 §3의 삭제 검증은 seed fixture 기준. 실제 사용자 프로필 대상 검증은 별도(운영 승인).

## 7. v3 대비 갱신 요약

| v3 상태 | 이 보고서 |
|---|---|
| canonical 삭제/검색 = `unverified` | **✅ 실행 확인**(§3, 8/8) |
| migration phase = 미실행 | **✅ 전 phase 실행**(§1) |
| dense fallback = 미실행 | **✅ 실동작 + strict gate**(§4) |
| 기능 회귀 여부 = 미판정 | **회귀 없음**(§5, 제품+reference 회귀 통과) |
| 남은 정적 실패 2건 | v3대로 **미보완**(정규식 갱신은 별도, 코드 수정 필요) |
| E5 실추론 / 라이브 / Aside E2E | 여전히 **미실행**(§6) |

## 부록: 재현
```bash
S=/tmp/.../mem-e2e/sand-data   # seed legacy profile.md 2건
node scripts/memory-migrate.mjs --sand-root $S --principal test-principal --phase status
# freeze→inventory→barriers→import→validation-ready→shadow-read→cutover(--approved-by/--validation-artifact/--inventory-digest)
# 제품 MemoryService를 esbuild 번들로 세워 add/list/remove/restart (임시 하니스, 실행 후 제거)
cd docs/belmont-memory-2.1/belmont-memory-2.1 && node bench/ablation.mjs && BELMONT_REQUIRE_DENSE=1 node bench/ablation.mjs
```
