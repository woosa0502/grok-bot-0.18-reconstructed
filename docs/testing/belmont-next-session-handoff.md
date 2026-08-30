# Belmont — 다음 세션 인수인계

_작성: 2026-08-30 · 갱신: 2026-08-31 (0.18.0 parity 회차 종료 시점 기준)_

전체 현황은 `docs/testing/belmont-full-test-report.md`(단일 SSOT, §1.6 후속 4가 이번 작업). 이번 회차의 재파악·판정표는 `docs/testing/belmont-018-parity-inventory-2026-08-31.md`. 판정 원장은 `docs/testing/belmont-sweep-verdicts.jsonl`(케이스별 최신 판정이 유효, `node scripts/verdict-ledger.mjs summary`), 감사 원장은 `docs/testing/belmont-audit-findings.jsonl`(id별 최신 행이 유효). 이 문서는 **다음 세션이 바로 이어받도록** 한 곳에 요약.

---

## TL;DR

- 지시: "0.18.0 설치파일(SHA-256 a253ccd8…/464079a1…) 기준으로 구현 안 된 것 재파악·구현·테스트, 플러그인은 로컬로, Cursor 계정 없이 Pi OAuth로도 원본과 같은 기능". 결과: **핵심 연결부 15건 구현 + 전부 라이브 검증** — 장기 기억 자동 회수(AUDIT-1), roster+ListAgents/ListGroups(AUDIT-3), 로컬 cron 루틴(AUDIT-7), 로컬 플러그인 저장소/카탈로그(AUDIT-8), 앱 내 Pi 로그인 상태/로그인/로그아웃(AUDIT-10), PDF 읽기(AUDIT-11), Shell cwd/env 유지(AUDIT-W2), compaction epoch, 컨텍스트 창 knob(AUDIT-6B), 클라우드 에이전트·이미지 생성 정직 숨김, 게이트 고정.
- 라이브 중 **신규 결함 2건 발견·수정**: **AUDIT-W9** 로컬 모드 추론 준비 상태(`inference.isReady`)가 항상 false → 루틴/훅/wake 게이트 영구 차단(루틴이 200s 미발화하던 원인) · **AUDIT-W10** 박스 데몬이 PDF를 invalidFile로 거부.
- 게이트: `npm run check` exit 0 (source:typecheck 0 오류 · 테스트 143/143). 원장: PASS 537 · UNAVAIL 631 · ISSUE 17 · PARTIAL 4 · UNCLEAR 0.
- 커밋 상태: `c34fd63` 이후 **미커밋** 변경(3차·4차 전부). 사용자 요청 시에만 커밋. **`upstream` 푸시 금지, `origin`만.**
- 앱은 최종 빌드(cycle20)로 실행 중(CDP 9347). 저장소 파일(문서 포함)을 바꾸면 다음 실행 전 재빌드 필요(stale 검사가 작업 트리 전체를 봄).

---

## ✅ 이번 회차에 한 것 (미커밋 — `git status` 참고)

| 항목 | 파일 |
|---|---|
| 기억 회수(M1) | `source/host/host-runner-composition.ts`(프롬프트 컨텍스트 memory/roster provider), `source/host/extensions/memory/extension.ts`(`createPromptUserMemory/createPromptProjectMemory`) |
| roster/그룹/도구(R1-R3) | `host-runner-composition.ts`, `extensions/session/session-roster.ts`(group.json), `runner/tools/sand-agent-management-tools.ts`(ListAgents/ListGroups), `runner/tools/turn-toolset.ts`, `agents/agent-messaging.ts` |
| Shell 상태 유지(S1) | `source/box-exec-daemon/shell-state.ts`(신규), `server.ts`(shellStream만), `packages/agent/tools/core/shell/create-shell-tool.ts`(exit cwd) |
| PDF(P1) | `source/host/runner/local-pdf-text-extractor.ts`(신규), `host-runner-composition.ts`(Read 옵션), `box-exec-daemon/server.ts`(PDF → data) |
| epoch/컨텍스트 창(C1,C2) | `host-runner-composition.ts`, `source/host/extensions/inference/context-window.ts`(신규), `pi-codex-runtime.ts` |
| Pi 로그인(L1) + 준비 상태(A2) | `extensions/inference/pi-codex-login-session.ts`(신규), `extensions/inference/extension.ts`(api 5개 + isReady), `gateway-protocol.ts`, `host-gateway-api.ts`(트레이에 코드), `shared/rpc/coordinator-main.ts`, `electron-main/adapters/account-oauth.ts` |
| 로컬 cron 루틴(A1) | `extensions/automations/local-cron-scheduler.ts`(신규), `extension.ts`, `sand-automation-cloud-sync.ts`(`shouldScheduleCronLocally`) |
| 로컬 플러그인(PL1) | `shared/node/mcp/local-mcp-store.ts`(신규), `mcp-display-runtime.ts`(cwd), `mcp-manager.ts`(catalog 옵션), `electron-main/mcp/desktop-mcp-manager.ts`, `electron-main/adapters/mcp-oauth.ts`, `host/extensions/mcp/mcp-service.ts` |
| 숨김/게이트(G1,G2) | `electron-main/adapters/local-codex-mode.ts`, `host/extensions/experiments/extension.ts`, `host/runner/system-prompt.ts`, `system-prompt-assembly.ts`, `host-runner-composition.ts`(cloudAgent) |
| 테스트(신규 8 파일) | `tests/{box-shell-state,local-pdf-text-extractor,context-window,pi-codex-login,host-wiring-parity,memory-prompt-adapters,local-cron-scheduler,local-mcp-store}.test.mjs` |
| 문서 | `belmont-018-parity-inventory-2026-08-31.md`(신규), full-test 보고서 §0/§0.5/§1.6 후속 4/§2/§3, 원장 2종, 이 문서 |

---

## 동작 방식 (다음 사람이 알아야 할 것)

- **기억**: `update_state`가 쓰는 `<agentDir>/memory`(agent), `<sandRoot>/user-memory/agents/<id>`(user), `<sandRoot>/projects/<slug>/memory/agents/<id>`(project) 샤드를 프롬프트 조립이 읽음. 메모리 섹션은 compaction epoch별로 스냅샷 동결(`SAND_DISABLE_MEMORY_FREEZE=1`로 해제) — 같은 에이전트에서 방금 저장한 사실은 아직 스냅샷이 없을 때(사실이 0개였을 때) 다음 턴에 바로 보임, 그 뒤엔 압축 후 재렌더.
- **roster**: `listAgentsSync()` 캐시 기반(사이드바 로드 후 채워짐). 그룹은 `<agentDir>/group.json`.
- **Shell 상태**: 데몬 `terminalsDirectory/shell-state/{cwd,env.sh}`. 에이전트 Shell(스트리밍)만 읽고/쓴다. `working_directory`를 주면 그 디렉터리가 우선(스키마 "defaults to current directory"). 중단(SIGTERM) 시 초기화. 함수/별칭은 유지 안 됨.
- **PDF**: `pdftotext`(poppler, 호스트에 설치됨) → 없으면 `pdfjs-dist`. 빈 텍스트면 안내문. `SAND_PDFTOTEXT_PATH`로 바이너리 지정.
- **루틴**: 로컬 cron 스케줄러 30s tick, 앵커 `lastRunAt ?? createdAt`, 6h 초과 누락은 재앵커(로그 `[local-cron]`), 발화는 `runServerScheduledAutomation`(수동 실행과 같은 경로). 준비 상태 = `inference.isReady`(로컬: Pi 자격증명).
- **플러그인(로컬)**: `<sandRoot>/mcp.json`(stdio: command/args/env/cwd, url 항목 보존하나 로컬 실행은 stdio-only), `plugin-catalog.json`(`{"plugins":[…]}`, 없으면 기본 3종: Filesystem/Knowledge graph memory/Sequential thinking — npx로 실행), `plugin-installs.json`. 설치 = 카탈로그 fragment의 `${VAR}`를 폼 값으로 치환해 mcp.json에 병합. 서버 id = 이름 해시의 숫자열. Connect(인증)는 not-configured로 강등.
- **Pi 로그인**: 데스크톱 상태 = 호스트 `getProviderAuthStatus`(코디네이터 없으면 자격증명 파일). Sign in → 호스트 `startProviderLogin`(기기 코드) → 브라우저 열기 + 트레이 "Codex sign-in: Enter code …" → 폴링 `getProviderLoginStatus` → 완료 시 logged-in. `SAND_CODEX_LOGIN_METHOD=browser`로 브라우저 방식. Sign out은 자격증명 삭제(주의).
- **숨김**: 로컬 모드 프롬프트 = `SAND_SYSTEM_PROMPT_LOCAL_CODEX`(클라우드 에이전트·이미지 생성 없음 명시), CloudAgent 도구 미제공, 게이트 `LOCAL_CODEX_FEATURE_GATE_OVERRIDES`.
- 이전 회차 항목(분류기, 로컬 도구 권한, 훅, 첨부 스테이징, 빌드 계보 검사)은 full-test 보고서 §1.6 참조.

---

## 확인 필요 (UNCLEAR)

**없음.**

---

## (선택) 잔여 — parity 목록 문서 §4 참조

- EXCLUDED_HIDDEN(숨김 완료): Cursor 클라우드 에이전트, GenerateImage/AI 아바타, Teams/SSO/조직도/공유룸, Usage & Billing, iPhone/모바일 푸시, updater, Update/Reset Agent Computer, Teach by demonstration, 공개 공유 링크, 오디오/비디오 이해, Slack/GitHub 이벤트 루틴.
- 후속: OS 알림 라이브 검증 · beforeMCPExecution/WebFetch 훅 · 브라우저/MCP auto-review 라이브 · 컨텍스트 창 실측 후 기본값 · Shell 함수/별칭 유지 · MCP `tools/list` pagination·`list_changed` · 그룹 채팅 라이브 · 첨부 staging 즉시 정리 · 서브에이전트 settle 경계(AUDIT-4) · PARTIAL 4건(660/673/241/386).

---

## 환경 / 실행 방법

- **Node 26**: `export PATH="$HOME/.local/share/mise/installs/node/26.5.0/bin:$PATH"`.
- **빌드**: `node scripts/setup-wsl.mjs` (약 2분, **중단 금지**, 빌드 중 저장소 파일 수정 금지 — 소스 identity 검사에 걸림).
- **실행**: `SAND_LOCAL_COMPUTER_USE=1 BELMONT_WSL_DEBUG_PORT=9347 NODE_OPTIONS=--max-old-space-size=8192 node scripts/run-wsl.mjs`
- **정지**: run-wsl node 프로세스에 SIGTERM(자식 정리됨). `kill -9` 전엔 `prlimit --pid <p> --core=0`. Xvfb :99는 살려두면 재사용.
- **CDP**: 9347 고정. `scripts/ax-ui.mjs`. 승인 카드 AX: `region "Auto-review approval"` / `"Local tool permission"`. Plugins 화면: Ctrl+K → "Plugins" → 탭 Marketplace/Yours, 항목 버튼 `Open <name>`, 상세의 **Add**가 설치.
- **게이트웨이 API**: `sand-data/gateway.json`의 port·token → `POST /api/{…, getProviderAuthStatus, startProviderLogin, getProviderLoginStatus, cancelProviderLogin, providerLogout, createAgentAutomation({id, spec:{name,prompt,trigger:{type:"cron",schedule},isEnabled}}), getAgentAutomations({id}), deleteAgentAutomation({id, automationId})}` (`authorization: Bearer <token>`).
- **테스트**: `npm run check` (= frontend typecheck + source:typecheck + `npm test` 143).
- **케이스/판정 데이터**: `docs/testing/belmont-wsl-test-queue.jsonl`(1292), `belmont-sweep-verdicts.jsonl`, `belmont-audit-findings.jsonl`.
- **테스트 픽스처(저장소 밖, `sand-data/`)**: `mcp.json`(belmont-test + 이번에 UI로 설치한 `sequential-thinking`), `plugin-installs.json`(900003), `box-workspace/parity-test.pdf`, `box-workspace/parity-sub/`, `box-workspace/.cursor/{mcp-test-server.mjs, h-*.sh, hooks.json(비어 있음)}`, 에이전트 ParityProbe(`5dbad30c…`)·HooksProbe(`8df23a70…`)의 user 메모리 샤드에 테스트 사실("teal-7731").

---

## 제약 (반드시 지킬 것)

1. **`upstream`(b-nnett/grok-bot-...)에 절대 푸시 금지.** 푸시는 `origin`(woosa0502/Belmont)만.
2. belmont 프로세스에 `kill -9` 전에 `prlimit --pid <p> --core=0`.
3. 커밋은 사용자가 요청할 때만. (현재 미커밋 변경 있음.)
4. 빌드 중간에 setup-wsl.mjs 죽이지 말 것 / 빌드 중 저장소 파일 수정 금지.
5. 사용자 작성 문서 `docs/testing/belmont-grokbot-parity-first-scope-2026-08-30.md`(untracked)는 요청 없이 커밋에 넣지 말 것.

---

## 핵심 파일 지도

| 영역 | 파일 |
|---|---|
| **기억 회수** | `source/host/extensions/memory/{extension,memory-service,agent-state}.ts`, `source/host/runner/{system-prompt-assembly,sand-memory}.ts` |
| **roster/도구** | `source/host/extensions/session/session-roster.ts`, `source/host/runner/tools/sand-agent-management-tools.ts`, `source/host/agents/agent-messaging.ts` |
| **루틴** | `source/host/extensions/automations/{local-cron-scheduler,extension,sand-automation-cloud-sync}.ts`, `source/host/extensions/transcript/automation-runtime.ts`, `source/shared/automation-schedule.ts` |
| **플러그인/MCP(로컬)** | `source/shared/node/mcp/{local-mcp-store,mcp-manager,mcp-catalog-flow,mcp-display-runtime}.ts`, `source/electron-main/mcp/desktop-mcp-manager.ts`, `source/host/extensions/mcp/mcp-service.ts` |
| **Pi 로그인/준비** | `source/host/extensions/inference/{extension,pi-codex-login-session,pi-codex-runtime,context-window}.ts`, `source/electron-main/adapters/account-oauth.ts` |
| **Shell 상태/PDF/훅(데몬)** | `source/box-exec-daemon/{server,shell-state}.ts`, `source/host/runner/local-pdf-text-extractor.ts` |
| 숨김/게이트/프롬프트 | `source/electron-main/adapters/local-codex-mode.ts`, `source/host/extensions/experiments/extension.ts`, `source/host/runner/system-prompt*.ts` |
| 이전 회차(분류기·권한·첨부·계정 scope) | full-test 보고서 §1.6 지도 |
