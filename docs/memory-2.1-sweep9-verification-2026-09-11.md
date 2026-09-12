# Belmont Memory 2.1 — 고정 9개 검증 묶음 (2026-09-11) — 판정: **9/9 닫힘**

**9개 전부 실제 제품 경로로 닫음.** 마지막 두 연결(⑥⑦)도 이번에 제품 경로로 실행 완료:
- ⑥ **기억이 채운 인자를 제품 browser 도구로 실행해 실제 DOM 변경 확인**(`item67-connections2/closeconn2-6` 10/10): 제품 driver `navigate`+`snapshot`으로 **실제 페이지의 실 AX ref(e1)·실 snapshot digest** 확보 → 그 digest에 키잉한 승인 procedure seed → `beforeToolAction`가 빠진 `value`를 **기억에서 SEOUL 보충**(`{ref:e1}`→`{ref:e1,value:SEOUL}`, 프롬프트 아님) → 제품 driver **`fill` op(`element.fill`, OPS dispatcher)**로 실행 → 제품 snapshot이 `textbox "Destination" [ref=e1] value="SEOUL"` 확인. **raw CDP `element.value` 아님, 가짜 문자열 아님.**
- ⑦ **grade를 `reportOutcome()`으로 전달→평가된 경험 저장·feedback 확인**(`item67-connections2/closeconn2-7` 7/7): 실 task 종료 후 `BrowseClient.reportOutcome()`로 grade 전달 → 반환 view가 `outcomeSource="explicit-producer", experience=true` → 제품 `observe()`가 `ingestAsideOutcome` 구동(ingest 0→1) → canonical `evidence` 2→6·`memory_item` 1→3, `deferred` 오류 없음.
범위는 원래 요청 + handoff §7로 고정. 제품/테스트 소스 무수정.
**결함 표현 한정: "검사한 범위에서 발견된 결함 0"** (미확인이 결함 부재를 뜻하진 않음 — 제외 유지분은 아래 종료 기준 참조).
**주의: ⑥⑦ 실 엔진은 Aside 설치키 페어링 보안상 "1개 blessed 라이브 엔진"만 구동 가능(M2.1 무관 보안). 사용자 승인(개발 테스트)하에 라이브 엔진 직접 구동. ⑦용 파생 canonical daemon(`daemon.memory-2.1.mjs`)이 `bootstrap:aside`로 신규 생성됨 — 라이브 봇은 `BELMONT_MEMORY_AUTHORITY` 미설정이라 stock daemon으로 legacy 동작(무영향). 검증 종료 후 검증용 엔진·chrome 종료, 포트(21420/9333/9360) 해제, 라이브 봇 legacy로 복구 완료(아래 서비스 상태).**

## 실행 환경 (항목 1) — 정정된 사실
| 항목 | 값 |
|---|---|
| Node | sweep9 하니스 v26.8.1; **라이브 봇은 Node 26.5.0**(운영 프로필에 rollout 파일 없음 = legacy). 과거 로그의 26.5.0은 실제 기록(오기 아님). |
| HEAD / 브랜치 | `af95bca` / `feat/skill-scope-fields` |
| Memory 2.1 적용분 | **미커밋** — modified + untracked(kernel 27 포함). |
| 변경셋 소스 해시 | **`52072025c610daabd774af512018dd79649e2dfa947a0eb4692fe63d410c2ac8`** = 68파일(kernel 27 포함). 현재 소스와 일치 확인. |
| **서비스 상태 (정정)** | **"서비스 무변경"은 틀림** — #1·#4 및 ⑥⑦(Aside) 검증에서 **라이브 봇을 여러 번 중지·재시작**했고 `npm run wsl:setup`으로 **`belmont-wsl-runtime`를 Memory 2.1 소스로 재빌드**했다(매 재시작 전 lineage 갱신 때문). ⑥⑦용으로 **라이브 Aside 데몬(21420)도 일시 중지**했다가 복구. **매번 legacy로 복구**(운영 프로필 `memory-2.1` 디렉터리 부재로 확인 — canonical migration 안 함). **검증 종료 후 최종 복구 완료(2026-09-12):** `wsl:setup`로 runtime 재빌드 → tmux `belmont-bot`에서 `wsl:start`(mise **Node 26.5.0**) → host-main(pid 1041190) + box-daemon@1337 + electron 렌더러 + local-exec-daemon 기동, gateway@43463 `/health ok:true`, `listAgents`가 실제 에이전트(브라우저 봇 등) 반환. **운영 프로필 `.cache/belmont-wsl-profile/sand-data`에 `memory-2.1` 없음 = LEGACY 유지 재확인.** 검증용 Aside 데몬/엔진 chrome은 종료(포트 21420/9333/9360 해제). **바이너리·재시작은 변경이 맞다.** 전부 사용자 승인(일시 중지/테스트)하에 수행. |

## 종합 판정표

| # | 판정 | 확인된 진전 (유지) | **같은 번호 안 남은 조건** |
|---|---|---|---|
| 1 | ✅ **닫힘** | 실 host 진입점 재빌드→격리 canonical 기동→gateway `addAgentMemory`→canonical.sqlite 1→2·마커 일치. 68파일 해시=현재 소스. | (없음) |
| 2 | ✅ **닫힘** | 동일 MemoryService 계정 격리·project 탈퇴·scope 분리. + **closure 12/12**(`item2-auth-propagation`): **실 credential 파일(pi-auth.json) 변경이 제품 resolver→MemoryService로 전파**(acctA→B 전환 0건, 복귀 보존; 문자열 스왑 아님), **user-author shard 실쓰기→공유 읽기 O·agent own-scope엔 없음·타계정 격리**. | (닫힘) |
| 3 | ✅ **닫힘** | inactivity·ID 재사용·restart 복구·중복 무학습. + **closure 7/7**(`item3-realretire`): **실제 `RunLifecycle.retireSession()` 구동**(stub 아님)·**crash 경계3**(checkpoint commit 후 복원→restart 무중복)·8/11 기전(broken/fixed 대비). | 8/11은 기전 입증; 원본 fork의 정확한 3실패는 원본 하네스 없이 재현 불가(명시). |
| 4 | ✅ **닫힘** | assembler·`createPiContext` payload(이전) + **closure**(`item4-realrunner`): 라이브 봇 중지(1337 해제)→**풀 host-main.cjs 기동**→`setHostSettings(openrouter)`→`SAND_OPENROUTER_BASE_URL`=로컬 캡처서버→`addAgentMemory`+`sendPrompt`로 **실 턴 유발**→**제품 runner가 provider 경계로 요청 전송, 그 요청에 canonical memory evidence(MARKERQ7)+user turn 포함**(marker_in_request=true). 모델 응답만 stub. | (닫힘) |
| 5 | ✅ **닫힘** | legacy-id→UUID 삭제·중복 dedup. + **closure 13/13**(`item5-realedges`): **tombstone-only shard**(phantom 0)·**explicit marker authority=legacy(오승인 없음)**·**원본 markdown 변경→FROZEN_SOURCE_CHANGED**·**import 중단→resume 멱등**(3건 무중복). | (닫힘) |
| 6 | ✅ **닫힘** | host-side(18/18+6/6) + 실 `beforeToolAction`가 **기억에서 SEOUL 보충**(pre={ref}→post={ref,value:SEOUL}). + **connection 10/10**(`item67-connections2/closeconn2-6`): 제품 driver `navigate`+`snapshot`으로 **실제 페이지의 실 AX ref(e1)·실 snapshot digest(477d18da…)** 확보 → 그 digest에 키잉한 승인 procedure → `beforeToolAction`가 빠진 `value`를 기억에서 SEOUL 보충(프롬프트엔 SEOUL 없음) → 제품 driver **`fill` op(`element.fill`, OPS dispatcher)** 실행 → 제품 snapshot이 `textbox "Destination" [ref=e1] value="SEOUL"` 확인. **raw CDP 아님·가짜 문자열 아님.** | (닫힘) **범위 정직**: 이 연결 하니스는 driver의 **OPS 디스패처(`OPS[request.op]`)+`element.fill`+실 ref 해석**을 box의 정확한 호출(`node driver.mjs <base64>`)로 실행. host-side의 **schema 검증·approval**(BrowserInteractionHandler)은 별도 세트(18/18+6/6)로 확인 — 두 증거가 합쳐 경로 전체를 덮음(BrowserInteractionHandler는 host runner+box 없이는 단독 구성 불가). |
| 7 | ✅ **닫힘** | host-side(27/27+10/10) + 자동 전달·관측 저장(제품 `observe()`→canonical `evidence` 1→2). + **connection 7/7**(`item67-connections2/closeconn2-7`): 실 task 종료 후 **`BrowseClient.reportOutcome()`로 grade 전달** → 반환 view `outcomeSource="explicit-producer", experience=true` → 제품 `observe()`가 **`ingestAsideOutcome` 구동(ingest 0→1)** → canonical `evidence` 2→6·`memory_item` 1→3, `deferred` 오류 없음. **평가된 경험 학습·feedback 경로 실행 확인.** | (닫힘) |
| 8 | ✅ **닫힘** | dense on/off 대조(실사용)·지연 응답 sparse fallback. | (로컬 embedding stub 범위 내 — 합격 기준 충족) |
| 9 | ✅ **닫힘** | 전체 회귀 1081/pass 1079/fail 0/skip 2, `check` 구성요소 EXIT=0. + **kernel 계약 증거 불일치 해소**: 참조 계약 157건을 **제품 kernel 번들(`product-kernel-bundle.mjs`)에 직접 실행** → `# pass 157 / # fail 0`, EXIT=0(TAP raw 31KB 보존: `item9-reference-contracts-TAP-raw.txt`). + 내 독립 하니스 `item9-kernel-contracts` **24/24**(계약 22 + persistence 2). | (닫힘 — 157/157이 제품 kernel 번들에 연결된 원본 결과로 보존) |

## 종료 기준 판정 (확정: 9/9 닫힘)
- **9개 전부 실제 제품 경로로 닫음.** ⑨의 157/157은 `node --test`로 제품 kernel 번들에 재실행해 확인.
- **⑥⑦ 마지막 연결도 제품 경로로 실행**(이전 보고의 정확한 잔여 2건을 이번에 해소):
  1. **⑥ 완료**: 기억→인자 보충(`beforeToolAction`) 다음, **제품 driver `fill` op(`element.fill`, OPS dispatcher)**로 그 값을 **실제 페이지의 실 AX ref(e1)**에 실행 → 제품 snapshot이 `value="SEOUL"` 확인. 이전의 **CDP `element.value=X` 직접 실행·`booking.example` 가짜 문자열을 제거**하고, snapshot·ref·digest 전부 실제 페이지에서 취득. (`closeconn2-6` 10/10, EXIT=0)
  2. **⑦ 완료**: **`reportOutcome()`로 grade 전달** → `outcomeSource="explicit-producer", experience=true` → 제품 `observe()`가 `ingestAsideOutcome` 구동 → canonical `evidence` 2→6·`memory_item` 1→3. 이전의 **ungraded·experience 없음·`reportOutcome()` 미호출 상태를 해소**. (`closeconn2-7` 7/7, EXIT=0)
- **⑥⑦ 전제(정직)**: Aside P-256 설치키 페어링(core.mjs:115)상 **1개 blessed 라이브 엔진만** 실브라우저 구동(격리 2차 엔진 불가). M2.1 무관 Aside 보안. 사용자 승인(개발 테스트)하에 라이브 엔진 직접 구동 후 종료·복구.
- **결함 표현 한정: "검사한 범위에서 발견된 결함 0"** — 검사 안 한 부분의 결함 부재를 주장하지 않음. 제외 유지(검사 범위 밖): 운영 프로필 canonical cutover·상시 서비스 교체·실계정·외부 공개 사이트·기기 수용(installation acceptance).
- **부수 산출물**: ⑦용 파생 canonical daemon `belmont-browse/vendor/aside-909/apps/daemon/build/daemon.memory-2.1.mjs` 신규 생성(bootstrap:aside). 라이브 봇은 stock daemon으로 legacy 동작(무영향). 라이브 봇은 검증 중 여러 번 중지·재시작·재빌드했고 매번 legacy로 복구(현재 정상·안정).

## 증거
`data/artifacts/memory_2_1_report_review_20260911/sweep9/` 전 항목 보존(harness + raw log). 주요:
- `item1-host-boot/` — 빌드·기동·gateway·복구 로그.
- `item9-kernel-contracts/` — `product-kernel-bundle.mjs`(제품 kernel 번들) + `item9-reference-contracts-TAP-raw.txt`(157/157 TAP 원본) + `item9-kernel-contracts.log`(24/24).
- `item67-connections2/closeconn2-6.{mjs,log}` — ⑥ 최종 연결 10/10(실 snapshot digest `477d18da…`, 실 ref `e1`, 제품 `fill`로 `value="SEOUL"` DOM 확인).
- `item67-connections2/closeconn2-7.{mjs,log}` — ⑦ 최종 연결 7/7(`reportOutcome()`→graded experience→`ingestAsideOutcome`→canonical evidence 2→6).
- 각 항목(②③④⑤) closure 디렉터리에 해당 하니스·원본 로그 보존.

**재현(⑥⑦, 라이브 Aside 필요)**: blessed 엔진(`belmont-browse/.state`)으로 serve.mjs 기동(포트 9360, CDP 9333) → `node scratchpad/closeconn2-6.mjs`(또는 sweep9 보존본) / `closeconn2-7.mjs`. 제품 driver는 `/tmp/.sand-browser/driver-v5.mjs`(playwright-core 심링크). 검증 후 엔진·chrome 종료하고 라이브 봇은 `wsl:setup`+`wsl:start`로 legacy 복구.
