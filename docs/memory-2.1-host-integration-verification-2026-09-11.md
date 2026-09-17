# Belmont Memory 2.1 — runtime 계약 실행 검증 (2026-09-11, 정정본)

> **정정 고지.** 이 문서의 이전 판은 제목이 "host 통합 실검증"이었고 "host 전체 경로 검증 완료,
> 미확인 5개 중 4개 해소"라고 적었다. **과장이었다.** 아래 검증은 runtime의 public API에
> test principal·transcript reader·`acceptedDurably:true`를 **직접 주입**해 태운 것이다.
> 즉 **runtime 계약(learning/lifecycle/retrieval/grounding)의 실행**은 확인했으나,
> 실제 **auth extension → 메시지 수신 → host runner → 최종 prompt 조립** 전체 사슬은 **여전히 미확인**이다.

실프로필 무변경(복사본만), 제품 코드 무수정(테스트 2개 정규식만).

---

## 결론 (정정)

**runtime 계약(학습·lifecycle·scope 전파·stage별 주입·grounding 방어계약)은 실제로 동작**하고,
**§6에서 admission 플래그·transcript 엔트리·open/switch lifecycle을 제품 코드(`send-pipeline`·`session-runtime`)가
생산하도록 태워** gap #1을 상당 부분 해소했다(음성 gate 포함).
그러나 **host 전체 통합은 아직 아니다**: (1) 실 auth extension의 turn별 principal 부여, (2) runner의
최종 prompt 주입 2가지가 여전히 주입/stub이다. **cutover 부적합은 유지**(이유는 §cutover).

---

## 1+3. runtime 학습 경로 + lifecycle — ✅ (단, runtime 직접 호출)

runtime의 실제 API를 정확한 계약으로 태움 (앞서 잘못된 필드명 → 정정):
```
onConversationLifecycle(open)
  → onAuthenticatedUserTurn({user, acceptedDurably:true, memoryTurnId, entryId, ...})  # admission
  → onConversationLifecycle(close)
      → closeEpisode: transcript reader 재읽기(id/digest/role/source 매칭)
      → DreamingEngine.learn → canonical transaction
```
- transcript reader 주입(`setTranscriptReader`), record 매칭 조건(`entry.id===entryId`,
  `contentDigest 일치`, `role:user`, `memoryLearningSource!=system`)이 전부 통과해야 학습됨 — 통과시킴.
- **결과: "장거리 비행은 통로석을 선호한다"가 canonical에 학습**(items 1→2).
- **restart(새 runtime) 후 유지**(2건).
- → lifecycle(open/close), episode close→dreaming, canonical 저장, restart 지속을 **runtime 단위 실행**으로 입증.

> **이 절의 한계(핵심 정정).** `acceptedDurably:true`·`memoryTurnId`·`entryId`·`user`·transcript reader를
> **내가 직접 만들어 넣었다.** 실제로는 send-pipeline이 메시지를 받고, auth extension이 principal을 붙이고,
> admission 판정(`acceptedDurably`)을 내리고, runner가 transcript를 채운다. **그 전단이 미검증**이다.
> 따라서 "학습이 된다"가 아니라 **"admission이 참이고 transcript가 채워지면 학습된다"**까지만 증명됨.

## 2. scope 전파 — ✅ (위 경로에 내재, 단 principal도 직접 지정)

- principal `belmont-learn-test` → `memoryOwnerNamespace(sha256)` → `owner:<hash>:shard:<hash>` scope.
- admission·closeEpisode·저장·재조회가 **동일 scope로 흐름**(scope mismatch면 `MEMORY_CHECKPOINT_SCOPE_MISMATCH`
  throw — 안 남). migration principal과 런타임 principal이 같아야 조회됨을 실측(다르면 0건).
- **한계**: principal 문자열을 내가 직접 넘겼다. 실제 auth extension이 turn마다 이 principal을
  올바르게 산출해 붙이는지는 미확인.

## 4. stage별 검색 주입 — ✅ (실검색 경로)

실제 `prepareMemoryTurn()→retrieval.retrieve()`:
- shadow-read: 검색 실행 + `getMemoryContext()==""` (미주입).
- canonical: 같은 검색 + `getMemoryContext()==8347자 <memory_evidence>` (주입).
- `list()`가 아닌 실검색 경로로 입증. 이 절은 stage 정책 차이를 실제로 보여주므로 비교적 견고.

## 5. 도구 grounding — ⚠️ 방어 경로 위주 (정정)

제품 `memory-tool-grounding.ts`를 8개 호출로 태웠다. **대부분 "아무것도 안 한다"를 확인하는 경로다:**

| 호출 | 성격 |
|---|---|
| `observeBrowserResult` 성공 envelope → domain 파싱·snapshotDigest 생성 | 관측(변경 아님) |
| environment는 driver 버전 고정(page 텍스트로 위조 불가) | **no-change / 보안 방어** |
| isError 도구 → null | **no-change** |
| 비-browser 도구 → null | **no-change** |
| `groundBrowserTool`: siteRevision/snapshotDigest 없으면 arguments 불변 | **no-change** |
| whitelist 밖 도구(browser_evaluate) 불변 | **no-change** |
| 근거 없을 때 bindings 빈 배열 | **no-change** |

- → **안전 계약(추측 금지·위조 불가·whitelist)은 동작**. 하지만 이것은
  **"실제 근거가 있을 때 argument를 올바르게 채워 도구 호출이 성공한다"를 증명하지 않는다.**
  positive fill → 실도구 실행 성공 경로는 **미검증**이다(실 site revision/snapshot이 있는 라이브 호출 필요).

## cutover — 미실행 (정정된 표현)

- 라이브 봇/실프로필의 canonical 전환은 **하지 않았다.** handoff가 "production 승인 전 금지"로 명시.
- **정확한 표현**: cutover는 **"현재 지원되는 legacy 복귀 기능이 없다"**. 이것이
  "어떤 방법으로도 되돌릴 수 없다"는 뜻은 아니다(수동 복구 여지는 별개 문제, 다만 지원 경로 부재).
- 이번 검증은 전부 **실프로필 복사본**. 실봇은 legacy 유지(무변경).

## 6. 제품 호출자가 생산한 admission으로 학습 — ✅ (gap #1 일부 해소, 정정 반영)

앞 §1+3의 한계(내가 `acceptedDurably`/`memoryTurnId`/`entryId`/transcript를 직접 주입)를 실제로 줄였다.
이번엔 **제품 `send-pipeline.ts` + `session-runtime.ts`를 직접 태워** 그 값들을 **제품이 생산**하게 했다.

- `SendPipeline.sendPrompt(...)`가 persist 결과로 **`acceptedDurably=true`를 직접 계산**(내가 안 넣음).
- `createUserMessage`가 **`entryId="t0u"`(nextEntryId)·`memoryTurnId`(UUID)를 생산** → 이 값으로 admission hook 호출.
- `SessionRuntime.openSessionOnce`가 lifecycle **"open"**, `replaceSession`이 **"switch"**를 **제품 경로로 발화** → closeEpisode → DreamingEngine 학습.
- **결과: canonical 0→1, "장거리 비행은 통로석을 선호한다" 학습.** transcript reader는 파이프라인이 쓴 실제 엔트리를 돌려줌(위조 아님).
- **음성 검증(gate 제어 입증)**: `memoryLearningSource:"system"` send는 제품 gate가 **학습 hook을 아예 호출 안 함** → 학습 0.
  즉 "학습이 가능하다"가 아니라 **"제품 gate가 학습 여부를 실제로 제어한다"**까지 보임.
- 증거: `data/artifacts/memory_2_1_report_review_20260911/e2e/host-chain-learn.{mjs,log}` (exit 0).

> **남은 경계(여전히 정직하게).** 이번에도 **principal은 `getPrincipalId:()=>P`로 주입**했고(실 auth extension이
> turn마다 principal을 산출·부착하는 경로 미검증), **최종 prompt 조립은 `runTurn` stub**이라 `getMemoryContext`가
> 실제 송출 prompt에 박히는지는 이 하니스 밖이다. 즉 gap #1은 **admission·transcript·lifecycle까지 제품화**됐고,
> **auth principal 부여 + 최종 prompt 주입 2가지가 남았다.**

## 아직 미확인 (cutover·종결 전 필요)

1. **host turn 사슬의 나머지 2가지**: (a) 실 auth extension이 turn마다 principal 산출·부착, (b) runner가
   `getMemoryContext`를 **실제 송출 prompt에 주입**. (§6에서 admission·transcript·lifecycle은 제품화 완료.)
2. **grounding positive 경로**: 실 site revision/snapshot이 있는 도구 호출에서 argument 채움 → 도구 실행 성공.
3. **실봇 cutover**: 운영 승인 사항(이번 안 함).
4. **실개인 holdout dense 이득** / **Aside 브라우저 라이브 E2E** / threshold 0.86 calibration.

## 누적 검증 상태 (정정)

| 항목 | 상태 |
|---|---|
| 정적 실패 2건 | ✅ 보완, 전체 1079/fail0 (로그 저장) |
| canonical 삭제→재검색→restart | ✅ 8/8 (seed fixture) |
| migration 전 phase | ✅ 전 단계 |
| 실제 E5 dense | ✅ 실행, gain 0 |
| runtime 학습 경로 + lifecycle | ✅ **단 runtime 직접 호출**(§1+3) |
| scope 전파 | ✅ **단 principal 직접 지정**(§2) |
| stage별 검색 주입(shadow/canonical) | ✅ **실검색 경로**(§4) |
| 도구 grounding | ⚠️ **방어 경로만**(§5) — positive fill 미검증 |
| 제품 memory 회귀 | ✅ 47/47 |
| **admission·transcript·lifecycle 제품화 학습** | ✅ **§6**(제품 send-pipeline/session-runtime 구동, 음성 gate 포함) |
| host turn 사슬 — auth principal 부여 | ❌ **미확인**(principal 주입) |
| host turn 사슬 — 최종 prompt 주입 | ❌ **미확인**(runTurn stub) |
| 실봇 cutover / 실 holdout / Aside E2E | ⏸ 운영 승인·별도 |

## 상태·증거
- 실프로필 **무변경**(legacy). 봇 정상. 임시 sandbox·하니스 정리. **이번 작업은 조회·복사본 실행뿐, 자동화·서비스·데이터 무변경.**
- 제품 코드 무수정(테스트 2개 정규식만). Node 26.5.0(이 실행의 실제 로그), HEAD af95bca. (이후 sweep9 재검증은 26.8.1 — 구분.)
- 검증은 esbuild로 제품 소스를 번들해 runtime API를 **직접 호출**하는 방식(host runner 전체 아님, reference dist 아님).
