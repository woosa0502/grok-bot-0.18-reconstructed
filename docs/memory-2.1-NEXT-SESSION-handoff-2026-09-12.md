# Belmont Memory 2.1 — 다음 세션 핸드오프 (2026-09-12)

## TL;DR (한 줄)
Memory 2.1 통합을 고정 9개 목록으로 검증(전부 실 제품 경로로 행사, 검사 범위 내 결함 0)하고 **커밋·푸시 완료**.
**실봇은 legacy 그대로**(canonical 전환 안 함). 남은 건 **운영 cutover 결정**과 ⑥의 "단일 흐름" 여부 정도.

## 1. 끝난 것
- **커밋**: `3833653` "Apply Belmont Memory 2.1 integration and verify it (fixed 9-item sweep)".
- **푸시**: remote `grok-fork`(github.com/woosa0502/grok-bot-0.18-reconstructed), 브랜치 `feat/skill-scope-fields`(upstream 설정됨). PR 미생성(링크만 있음).
- **9개 검증**(상세: `docs/memory-2.1-sweep9-verification-2026-09-11.md`):
  ① 격리 host-main.cjs canonical 기동→gateway `addAgentMemory`→canonical.sqlite 기록
  ② 실 `resolveLocalMemoryPrincipal`(credential 파일 변경)→MemoryService scope 전파·user/project shard 격리
  ③ 실 `RunLifecycle.retireSession`·inactivity·crash 경계·clear+ID 재사용
  ④ 실 runner(turn-run-shell 풀 host)→provider 요청에 canonical memory evidence 포함
  ⑤ migration 엣지: tombstone-only shard·explicit marker 오승인 방지·source drift·import 중단→재개
  ⑥ 기억 grounding(beforeToolAction)→**제품 driver `fill`**→실 chrome DOM `""`→`"SEOUL"`
  ⑦ `reportOutcome(grade)`→제품 `observe()`→`ingestAsideOutcome`→canonical 경험(evidence 2→6, memory_item episodic+knowledge)
  ⑧ dense 실사용(on/off)·timeout sparse fallback
  ⑨ 참조 kernel 계약 **157/157**(제품 kernel 번들에 `node --test`) + 독립 24/24 + 전체 suite 1079 pass
- 빌드/타입: `source:typecheck`=0, `frontend:build`=0, `mobile:check`=0(검증 당시).

## 2. 정직한 잔여 / "9/9"가 뜻하지 않는 것 (중요)
- **실 프로필 canonical cutover는 안 함(일부러).** 운영 프로필(`~/…/.cache/belmont-wsl-profile/sand-data`)에 `memory-2.1/rollout.json` 없음 = legacy. cutover는 "현재 지원되는 legacy 복귀 기능이 없음"이라 **운영 결정 사항**(아래 §7).
- **⑥ caveat**: memory→인자 보충→실 DOM은 닫았으나, **schema/approval(`BrowserInteractionHandler`)은 host-side 별도 세트(18/18+6/6)로 확인**했고 driver 실행과 **한 흐름으로 묶진 않음**(BrowserInteractionHandler는 host runner+box 없이 단독 구성 불가). 완전 단일 흐름을 원하면 §6-B.
- **"결함 0"은 검사한 범위 한정.** 제외분(운영 cutover·상시 서비스 교체·실계정·외부 공개 사이트·기기 수용)은 검사 안 함.
- **증거는 gitignore**(`data/artifacts/`) — 로컬에만 있음(커밋 안 됨). 파생 canonical daemon·`.build`·`belmont-browse/.state`도 gitignore.

## 3. 환경·핵심 사실 (재개 전 필독)
| 항목 | 값 |
|---|---|
| Node (검증 하니스) | `~/.nvm/versions/node/v26.8.1/bin/node` (node:sqlite 내장). **라이브 봇은 mise Node 26.5.0** |
| 소스 해시(변경셋) | `52072025…` = 68파일(kernel 27 포함). `git status`가 untracked `kernel/`을 한 줄로 보여주니 **재귀 열거로 계산**(`git ls-files --others` 사용) |
| 커스텀 chromium | `/home/hoon/chromium/src/out/aside/chrome` (Chrome 151, aside-component 1.26.909.1820) — Aside 확장 로드용. stock google-chrome는 확장 미로드 |
| 싱글턴 포트 | **21420**(Aside daemon 브리지, 확장 하드와이어)·**1337**(box-exec-daemon, `loopback-sand-box.ts:12` 하드코딩)·**9333**(chrome CDP). 2차 격리 인스턴스는 이 포트들 때문에 라이브와 공존 불가 → 라이브 중지 필요 |
| blessed 설치키 | `belmont-browse/.state/{aside-installation-key.der,installation-keys.json,linux-installation.json}` — Aside daemon P-256 페어링용. **fresh 키는 등록 실패**, 이 blessed state를 써야 확장 등록됨 |
| 파생 canonical daemon | `belmont-browse/vendor/aside-909/apps/daemon/build/daemon.memory-2.1.mjs`(신규 생성, gitignore). `BELMONT_MEMORY_AUTHORITY=belmont`일 때만 로드 |
| tmux | 라이브 봇은 tmux 세션 **`belmont-bot`**에서 `npm run wsl:start`로 돎 |

## 4. 라이브 봇 운영 runbook (안전)
- **상태 확인**: `pgrep -f belmont-wsl-runtime/dist/host/host-main.cjs`, `ss -ltnp|grep :1337`, 게이트웨이 `.cache/belmont-wsl-profile/sand-data/gateway.json`의 port로 `/health`.
- **중지(필요 시만)**: 명시 pid로 `kill -TERM <run-wsl> <host-main>` → 6s → 잔존 시 `kill -KILL`. **`pkill -f "…box-exec-daemon…"` 금지**(자기 셸·tmux 서버를 자가매칭해 죽인 사고 있었음 — §8).
- **재시작**: 거의 항상 **`npm run wsl:setup`(재빌드)→`npm run wsl:start`** 순서. `wsl:start` 단독은 "runtime stale … run wsl:setup" 에러가 남(작업트리 변경으로 lineage 갱신됨). tmux로:
  `tmux send-keys -t belmont-bot 'cd <repo> && export PATH=~/.local/share/mise/installs/node/26.5.0/bin:$PATH DISPLAY=:0 SAND_ASIDE_BROWSE=1 SAND_DISABLE_UPDATES=1 && npm run wsl:start' Enter`
- **불변식**: 재시작 후 `.cache/belmont-wsl-profile/sand-data/memory-2.1/rollout.json`이 **없어야**(legacy). 있으면 실프로필이 canonical로 바뀐 것 → 조사.
- Aside 데몬(21420)은 **lazy**(브라우즈 사용 시 기동). 부팅마다 자동 아님.

## 5. 증거 위치 (data/artifacts, gitignore — 로컬)
`data/artifacts/memory_2_1_report_review_20260911/sweep9/`:
- item1-host-boot, item2-auth-scope + item2-auth-propagation, item3-transcript-lifecycle + item3-realretire, item4-retrieval-final-request + item4-realrunner, item5-…-migration + item5-realedges, item6-grounding + item6-closure, item7-aside + item7-closure, item8-dense + item8-dense-used, item9-kernel-contracts(+ TAP 157 원본 + 제품 kernel 번들), item67-realengine, **item67-connections2**(⑥⑦ 최종 연결: closeconn2-6 10/10, closeconn2-7 7/7).
- 종합 보고서: `docs/memory-2.1-sweep9-verification-2026-09-11.md`.

## 6. ⑥⑦ 재현 (실 Aside 엔진 필요 — 사용자 "개발 테스트, 미사용" 승인 시)
- **A. 현 방식(닫힌 상태 재현)**: 라이브 봇 중지(21420/1337/9333 해제)→ blessed state로 serve.mjs 기동:
  `BELMONT_BROWSE_ENGINE=909 BELMONT_BROWSE_TRANSPORT=port BELMONT_BROWSE_NATIVE_COMPONENTS=1 BELMONT_BROWSE_CHROME=/home/hoon/chromium/src/out/aside/chrome BELMONT_BROWSE_CHROME_ARGS=--ignore-gpu-blocklist BELMONT_BROWSE_DISPLAY=:0 DISPLAY=:0 BELMONT_BROWSE_STATE_DIR=<repo>/belmont-browse/.state node belmont-browse/src/serve.mjs --port 9360 --engine 909 --transport port --cdp-port 9333 --relay-port 9361`
  → /health + "real extension registered" 확인 → `scratchpad`(보존본)의 closeconn2-6.mjs / closeconn2-7.mjs 실행 → 엔진·chrome 종료 → 봇 `wsl:setup`+`wsl:start` 복구.
  (⑦는 `BELMONT_MEMORY_AUTHORITY=belmont` + 파생 daemon 필요 — 이미 생성돼 있음.)
- **B. 남은 선택(⑥ 단일 흐름)**: 풀 host(host-main) + SAND_ASIDE_BROWSE=1 + 모델 턴으로 browser_fill을 호출해 `withMemoryToolAction`→`beforeToolAction`(기억)→`BrowserInteractionHandler`→driver→DOM을 **한 흐름**으로. 모델 턴 + box 필요.

## 7. 다음 세션에서 할 수 있는 것 / 결정 대기
1. **PR 열기** 여부(`grok-fork` feat/skill-scope-fields → main). 사용자 결정.
2. **운영 프로필 canonical cutover**(실봇을 Memory 2.1 canonical로): **미승인·irreversible(지원되는 legacy 복귀 없음)**. 하려면: 실프로필 백업 → `scripts/memory-migrate.mjs --sand-root <실 sand-data> --principal <실 principal> --phase …`(freeze→…→shadow-read→cutover). **사용자 명시 승인 필요.**
3. ⑥ 단일 흐름(§6-B) — 원하면.
4. 실개인 holdout dense 이득 / threshold 0.86 calibration(합격 조건 아니었음, 별도).

## 8. gotchas (실수 방지)
- **`pkill -f <패턴>`이 자기 bash/ tmux를 자가매칭**해 exit 144 + tmux 서버 종료 사고. → 항상 **명시 pid**로 kill.
- **fork 과대주장 주의**: 서브에이전트가 결과를 과장한 전례(예: "157/157" 근거 부실, Aside observation을 `memory_item`이라 했으나 실은 `evidence` 테이블). **항상 raw 로그·sqlite를 직접 재검증**하고 fork 집계를 그대로 믿지 말 것. fork가 범위를 넘어 다른 item/문서를 건드린 적도 있음 → 저장 증거 무결성 확인.
- **Aside observation은 `evidence` 테이블**에 기록(capture)되고, graded outcome은 `ingestAsideOutcome`로 `memory_item`(episodic/knowledge)까지 생성. count 볼 때 테이블 구분.
- **wsl:start stale 에러**는 정상 — 작업트리 바뀌면 lineage 갱신됨. `wsl:setup` 먼저.
- **scratchpad 경로 충돌**: 여러 fork가 같은 scratchpad 파일명을 쓰면 덮어씀. 작업별 고유 파일명 사용.

## 9. 상태 요약(현재)
- 라이브 봇: 정상(host-main·box@1337·gateway), **실프로필 legacy**. 검증용 엔진/chrome 전부 종료, 포트 해제.
- 작업트리: 커밋 `3833653` 이후 깨끗(검증 중 추가로 쓴 문서/증거는 gitignore이거나 이 핸드오프처럼 신규). 이 핸드오프 문서는 미커밋(원하면 커밋).

## 10. 외부 ZIP 리뷰 P1 수정 (2026-09-12, 후속 커밋)
외부 리뷰(`woosa0502/Belmont` origin main @ `7a9049d7`, Memory 2.1 **미반영** 상태를 검토)의 P1 지적을 grok-fork에서 처리.
- **learn-measure.mjs (P1 3건)**: ① 채택 기준을 no-page가 아니라 **현재 승인 절차(champion)** 로 교체(no-page는 별도 진단군; 현재 절차 없을 때만 기준선). ② `status==="done"`만으로 채택 금지 — 결과문에 실패 admission 없어야(done≠목표), 오류가 기준보다 나빠지면 기각, 기준보다 **엄격히 싸야** 채택. ③ 전 경로 try/finally + lock(동시실행 차단) + recovery journal(crash 복구) + 원자적(temp→rename) 교체. 라이브 page는 승인 후에만 draft로 교체, 그 외 모든 종료에서 champion 복원.
- **memory-synthesis-service.ts (P1 1건)**: catch가 **모든** 실패에 `finish()`로 evidence를 드롭하던 것을 레지스트리 `retryable` 분류에 맞춤 — 의미적 거부(invalid-output/rejected, retryable:false)는 소비, 일시적 실패(SAND-E0413 retryable:true)는 **evidence 보존 → 다음 turn/poll에서 재시도**(패스 상한 `MAX_SYNTHESIS_RETRYABLE_PASSES=5`). `run` 분기의 try-전 `pending.delete`도 동일 패턴으로 교체.
- **회귀 테스트**: `belmont-browse/test/learn-measure-adoption.test.mjs`(신규 7개 = 리뷰어 repro 5개를 올바른 기대값으로 뒤집기 + 양성 채택 2개), `tests/memory-synthesis-local.test.mjs`(일시적 실패 보존·재커밋 1개 추가). Node 26.8.1로 learn-measure 7/7, 메모리 suite 56/56, `source:typecheck` 0 오류.
- **연결 2건 재검증(리뷰어는 origin을 봐서 오탐 가능)**:
  - **Belmont 기억 → Aside task = 이미 배선됨**(오탐). `extension.ts:60` `createBrowseMemoryHooks` → `BrowseClient.create/continue`의 `#prepareMemory`가 기억 packet 주입(create·follow-up·answer 전부). origin엔 Memory 2.1이 없어 안 보였음.
  - **dreaming → 승급 게이트**: **canonical엔 존재**(`kernel/experience/loop.ts`: `ingest`는 candidate를 evidence로만 capture, `promote()`가 `evaluateProcedure`로 측정 후 `state:"accepted"`만, `lookup`은 accepted만 반환). **legacy 경로만 gap** — `patch-daemon-dream-procedures.py`가 절차를 활성 `sites/` Current에 직접 쓰고 learn-measure(drafts/→sites/)와 자동 hand-off 없음. **남은 작업**: 라이브 Aside 엔진 + 설계 결정 필요(데몬 write 재조정). 맹목 수정 금지.

## 11. 2차 ZIP 리뷰 후속 수정 (d7d9f9c 재검토 대응)
리뷰어가 `d7d9f9c`를 정확히 고정해 재검토. learn-measure 수정은 유효하나 P1 2건·P2 2건·테스트 검출력 부족을 지적 — 다음과 같이 처리.
- **P1-1 목표검증 재작성**: `runOnce`가 결과를 100자로 자른 뒤 검사하던 truncation 결함 제거 — **전체 result**로 검증. 판정은 succeeded/failed/**unknown** 3분류(`goalVerdict`): 실패 표현이면 failed, `--goal`(운영자 지정 관찰가능 성공 표지)이 전체 결과에 있으면 succeeded, 아니면 unknown. **unknown은 절대 승격 안 함**(실패어 부재 ≠ 성공). `--goal` 없으면 전부 unknown → 아무것도 승격 불가(보수적).
- **P1-2 평가중 운영 페이지 격리**: 측정 중 운영 `sites/<domain>.md`를 **절대 건드리지 않음**. 후보는 격리된 eval 디렉터리(`.state/learn-eval/<domain>-<pid>/sites`, KNOWLEDGE_DIR 밖)에서 측정하고 세션에 `sitesDir`로 전달. 승인 시에만 운영 페이지를 atomic(temp→rename) publish. 독립 reader는 평가 내내 CHAMPION만 봄(회귀 테스트로 증명). 서비스가 오버레이를 광고(`health.sitesOverlay`)하지 않으면 **측정 거부**(노출 원천 차단).
  - 배선(우리 코드, 테스트됨): `serve.mjs`(health.sitesOverlay는 `BELMONT_BROWSE_SITES_OVERLAY=1` env 게이트, `/sessions`가 `sitesDir` 수용) → `core.mjs` startSession → `session.mjs` createBrowseSession(`runtimeConfig.sitesDir`) → `memory-search.mjs` per-session `sitesRoot`(운영 sites 심링크는 allowed에서 빠져 자연 배제, distinct 인덱스 키로 격리; 단위테스트 `memory-search-sites-overlay.test.mjs`).
  - **남은 배선(라이브 검증 필요)**: 데몬의 agent `memory_search`가 세션의 `runtimeConfig.sitesDir`를 `__belmontMemorySearch({sitesRoot})`로 포워딩해야 오버레이가 worker에 실제 적용됨. **주의**: 벤더 909 데몬은 이미 패치된 형태라 `patch-daemon.py`에 맹목 추가 시 bootstrap assert가 깨짐 — 실제 번들 대조 + 라이브 스모크 필요. 그전까지 learn-measure는 안전하게 거부(운영 노출 0, 다만 adoption 비활성).
- **P2-3 복구**: 새 설계는 운영 페이지를 측정 중 안 건드리므로 **저널·복원 단계 자체가 없음**(복원 실패 시 저널 삭제 결함 근본 해소). crash(SIGKILL) 시 운영 페이지는 CHAMPION 유지(회귀 테스트).
- **P2-3b lock**: 살아있는 소유자 PID의 lock은 **시간 경과만으로 탈취하지 않음**(죽은 PID만 탈취), release는 **자기 lock만**.
- **P2-4 테스트 검출력**: 부정 시나리오(done-without-goal·more-errors 등) 후보 비용을 1 call(< champion 2)로 낮춰 **비용만으론 기각 불가 → 목표·오류 게이트가 실제로 작동해야** 기각되게 함. `adopted = goalOk && errorsOk && cheaper`를 `adopted = cheaper`로 변형하면 12개 중 4개 실패(검출) 확인.
- **테스트**: `test/learn-measure-adoption.test.mjs` 12개(강화 fixture+목표+격리+lock+양성) + `test/memory-search-sites-overlay.test.mjs` 1개, Node 26.8.1로 전부 통과, mutation으로 검출력 확인. 리뷰어가 확인한 synthesis bounded-retry(프로세스 내 최대 5패스, 재시작 초과 영속성은 범위 밖)·연결 2건(memory→Aside 배선 존재, canonical ExperienceLoop 게이트 존재) 판정은 유지.
