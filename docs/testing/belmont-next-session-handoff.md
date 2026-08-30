# Belmont — 다음 세션 인수인계

_작성: 2026-08-30 · 갱신: 2026-08-30 저녁 (auto-review 로컬 배선 세션 종료 시점 기준)_

전체 현황은 `docs/testing/belmont-full-test-report.md`(단일 SSOT, §1.6이 이번 작업). 이 문서는 **다음 세션이 바로 이어받도록** 한 곳에 요약.

---

## TL;DR

- **이전 세션의 "유일한 결함 클러스터"(auto-review 로컬 강제 OFF, AUDIT-W3) 해소.** 로컬 분류기(Pi gpt-5.5)로 Shell·컴퓨터 승인 카드, allow/block 규칙, Always allow가 라이브로 동작.
- 그 과정에서 **추가 결함 1건 발견·수정(AUDIT-W4)**: 호스트/데스크톱의 계정 scope 불일치로 auto-review 규칙·모델 기본값·로컬 도구 권한이 **매 시작마다 초기화**되던 문제.
- **작업트리 미커밋** (커밋은 사용자가 요청할 때만 — 아래 "변경 파일"). 앱은 최종 빌드로 실행 중(CDP 9347).
- 남은 것: UNCLEAR 8건, routine 편집기 aria-invalid(USR-675, UI 불일치), (선택) VNC 세부 E2E·다중창, 브라우저/MCP 표면 개별 라이브.

---

## ✅ 이번 세션에 한 것 (미커밋 — `git status` 참고)

| 항목 | 파일 |
|---|---|
| 로컬 auto-review 분류기(순수 모듈 + provider 연결) | `source/host/extensions/auto-review/local-smart-mode-classifier-{exec,provider}.ts` (신규) |
| 강제 off 제거, 로컬은 settings-on ⇒ enforce | `source/host/extensions/auto-review/extension.ts` |
| `systemPrompt`/`reasoning`을 라우팅 provider까지 관통 | `source/host/extensions/inference/{pi-codex-runtime,provider-session}.ts` |
| 분류기 타임아웃 env 재정의 | `source/packages/agent/utils/smart-mode-classifier-measurement.ts` (`SAND_SMART_MODE_CLASSIFIER_TIMEOUT_MS`) |
| 컴퓨터 표면 preflight 연결(로컬) | `source/host/runner/tools/{sand-computer-tool,turn-toolset}.ts`, `source/host/runner/{host-computer-tool-dependencies,turn-agent-composition}.ts`, `source/host/host-runner-composition.ts`, `source/host/box/local-computer-use.ts` |
| 계정 scope 통일(AUDIT-W4) | `source/shared/node/local-codex-account.ts` (신규), `source/electron-main/adapters/local-codex-mode.ts`, `source/host/extensions/mcp/mcp-service.ts` |
| 단위 테스트 10건 | `tests/local-auto-review-classifier.test.mjs` (신규) — `npm test` 109/109 |
| 문서 | `docs/testing/belmont-full-test-report.md` §0/§0.5/§1.5/§1.6/§2/§5, 이 문서 |

`npm run source:typecheck`는 **기존 오류 4개**(host-runner-composition.ts:2536-2537, host-computer-tool-dependencies.ts Context 타입)만 남음 — 이번 작업 이전부터 있던 것, esbuild 빌드엔 영향 없음.

---

## 동작 방식 (다음 사람이 알아야 할 것)

- **분류기**: provider≠cursor면 `createLocalSmartModeClassifierExecutor`가 라우팅 provider(코덱스=Pi gpt-5.5, reasoning `low`)에 단일 턴 요청 → JSON `{decision, block_reason, proposed_allow_rule}`. 정책 우선순위: block 규칙 > allow 규칙 > 대화 문맥. 실패/파싱불가 → error 결과 → 도구는 안전 방향(거부, "review errored").
  - env: `SAND_AUTO_REVIEW_CLASSIFIER_MODEL`(기본 provider 모델), `SAND_AUTO_REVIEW_CLASSIFIER_REASONING`(기본 low), `SAND_SMART_MODE_CLASSIFIER_TIMEOUT_MS`(기본 10000), `SAND_AUTO_REVIEW_MODE`(off|shadow|enforce 강제).
- **모드**: 설정 토글이 kill switch(off ⇒ 분류기 없음). 로컬은 Statsig 게이트가 없으므로 settings-on ⇒ **enforce**(카드 발화). `extension.ts`가 `sand_auto_review` 게이트를 로컬에서 true로 되돌림.
- **흐름(Shell)**: 모델 턴 → 분류(≈3s) → block이면 거부 사유 전달 → 모델이 `request_smart_mode_approval:true`로 재호출 → 분류 → 카드(Allow once/Always allow/Deny). 카드까지 21~25s.
- **컴퓨터 표면**: 로컬은 `turn.computerAutoReview`(디스플레이 99, 규칙, 컨트롤러)를 대체 경로가 `autoReview`로 사용, `createComputerTurnTool`이 실행 전 `runComputerToolAutoReviewPreflight` 호출. 로컬엔 박스 Chrome 탐침이 없어 표시상태 identity는 상수(재확인 없음).
- **규칙 저장**: 설정 화면 → `window.desktop.autoReviewInstructions.set()` → electron 저장소(=호스트와 같은 `sand-data/settings.json`) + 호스트 동기화. 재시작 시 electron 재동기화가 저장소 값을 호스트에 다시 밀어넣음(같은 값이라 무해). AUDIT-W4 수정 전엔 scope 뒤집힘으로 여기서 규칙이 사라졌음.

---

## 확인 필요 (UNCLEAR)

CDP/코드로 재판정 필요 (USER 라우트 8 + AGENT 일부):
`GBF-AGT-000201`(env transition reminder), `000381`(multitask coordinator reminder), `000314`(cloud/local rule 노출), `000017`(서브에이전트 model 파라미터 유효성), `000347`(MCP 큰 결과 파일 spill), `000373`(TODO frontmatter 자동싱크), `000322`(CI 조사 서브에이전트), `000330`(workspaceOpen 훅 pluginPaths), `000077/078`(browser_drag/click 검증), `000239`(도구 타임아웃), `000262`(429/5xx retryable 분류).

---

## (선택) 잔여

- **브라우저/MCP/서브에이전트 표면 개별 라이브**: 같은 `smartModeClassifierExecutorResource`를 쓰므로 활성이나 라이브는 Shell·컴퓨터만 했음.
- **USR-675**: pinned 렌더러가 routine 편집기 빈 Name에 `aria-invalid`/`required`를 붙이지 않음(복원 소스 view.tsx:94와 불일치). UI 항목.
- **VNC 세부 개별 E2E**(클립보드/키/줌) · **다중 데스크톱 창**(USR-390, maxWindows=1) · 창 관리자(openbox) — 이전과 동일.

---

## 환경 / 실행 방법

- **Node 26**: `export PATH="$HOME/.local/share/mise/installs/node/26.5.0/bin:$PATH"` (nvm엔 22/24만 있음).
- **빌드**: `node scripts/setup-wsl.mjs` (약 2분, **중단 금지**, 빌드 중 저장소 파일 수정 금지 — 소스 identity 검사에 걸림).
- **실행**: `SAND_LOCAL_COMPUTER_USE=1 BELMONT_WSL_DEBUG_PORT=9347 NODE_OPTIONS=--max-old-space-size=8192 node scripts/run-wsl.mjs`
- **정지**: run-wsl node 프로세스에 SIGTERM(자식 정리됨). `kill -9` 전엔 `prlimit --pid <p> --core=0`. Xvfb :99는 살려두면 재사용.
- **CDP**: 9347 고정. `scripts/ax-ui.mjs`(connect/axNodes/find/clickNode/domClick). 승인 카드는 AX `region "Auto-review approval"` + 버튼 `Allow once`/`Always allow`/`Deny`.
- **게이트웨이 API**: `sand-data/gateway.json`의 port → `POST /api/{setHostSettings,getHostSettings,createAgent,sendPrompt,getAgentTranscript,listAgents}` (JSON body, 토큰 없음). 규칙 설정은 `{"autoReviewInstructions":{"isEnabled":true,"allowInstructions":[],"blockInstructions":[...]}}`.
- **Pi 인증**: `SAND_DATA_ROOT=.cache/belmont-wsl-profile/sand-data node scripts/pi-codex-auth.mjs status` (앱과 같은 루트를 줘야 configured:true).
- **테스트**: `npm test` (109), `npm run source:typecheck`.
- **케이스/판정 데이터**: `docs/testing/belmont-wsl-test-queue.jsonl`(1292), `/tmp/sweep-verdicts.jsonl`(이번 재판정 17건 추가됨; /tmp라 휘발).

---

## 제약 (반드시 지킬 것)

1. **`upstream`(b-nnett/grok-bot-...)에 절대 푸시 금지.** 푸시는 `origin`(woosa0502/Belmont)만.
2. belmont 프로세스에 `kill -9` 전에 `prlimit --pid <p> --core=0`.
3. 커밋은 사용자가 요청할 때만. (현재 미커밋 변경 있음.)
4. 빌드 중간에 setup-wsl.mjs 죽이지 말 것 / 빌드 중 저장소 파일 수정 금지.

---

## 핵심 파일 지도

| 영역 | 파일 |
|---|---|
| **로컬 auto-review 분류기** | `source/host/extensions/auto-review/local-smart-mode-classifier-exec.ts` (정책 프롬프트·파싱), `-provider.ts` (Pi 연결) |
| auto-review 확장(모드·주입) | `source/host/extensions/auto-review/extension.ts` |
| Shell 분류·카드 | `source/packages/agent/tools/core/shell/create-shell-tool.ts` (`runShellSmartModeClassifier`), `source/host/runner/tools/turn-toolset.ts` (`createTurnShellAutoReviewOptions`) |
| 컴퓨터 분류·카드 | `source/host/runner/sand-computer-auto-review.ts` (preflight), `source/host/runner/tools/sand-computer-tool.ts` (`runComputerToolAutoReviewPreflight`), `source/host/runner/host-computer-tool-dependencies.ts` (`createComputerTurnTool`) |
| 분류기 리소스 등록 | `source/host/runner/turn-agent-composition.ts:1638` (`smartModeClassifierExecutorResource`) |
| 계정 scope(설정 초기화 방지) | `source/shared/node/local-codex-account.ts`, `source/host/extensions/mcp/mcp-service.ts:266`, `source/shared/node/settings/sand-settings-store.ts` (`scopeToAccount`/`clearAccountScope`) |
| 데스크톱 재동기화 | `source/electron-main/coordinator/coordinator-resync.ts` (`step("auto_review")`) |
| 컴퓨터 유즈 도구/실행기/VNC | 이전과 동일 (`host-computer-tool-dependencies.ts`, `packages/local-exec/computer-use/*`, `electron-main/vnc/vnc-trust.ts`) |
