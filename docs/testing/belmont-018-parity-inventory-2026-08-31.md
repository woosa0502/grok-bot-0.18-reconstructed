# Belmont — Grok Bot 0.18.0 기준 미구현 재파악 · 구현 · 검증 (2026-08-31)

_기준 설치파일: `research-archives/original/0.18.0/` — macOS arm64 `Grok_Bot_0.18.0.dmg` (SHA-256 `a253ccd8aab01e083f9812a0264354c5034d8ba7f0610bbb557e82ae77d203eb`) · Windows x64 `Grok_Bot_0.18.0_Setup.exe` (SHA-256 `464079a15ef5fa8b61ccea8fffcc78f63cfcf6df65fb0ad5e725d8b95f7e437e`). 렌더러는 이 payload를 checksum 고정으로 그대로 쓰고(`PROVENANCE.md`), 호스트·데스크톱·데몬은 복원 TypeScript. 추론·인증은 Cursor 계정 없이 로컬 Pi Codex OAuth._

판정 라벨(사용자 parity 문서 §1): **EXACT** = 원본과 같은 흐름 · **WSL_EQUIVALENT** = 클라우드/계정 의존 기능을 로컬 대체로 연결 · **EXCLUDED_HIDDEN** = 개인 WSL 제품에 성립하지 않아 제외하고 UI/프롬프트에서 광고하지 않음 · **(라이브)** 실제 앱에서 관찰 · **(단위)** 순수 함수 테스트 · **(코드)** 배선 확인.

## 0. 결론

| 항목 | 값 |
|---|---|
| 재파악 방법 | ① 공식 문서 8쪽(docs.x.ai/grok-bot/overview·bots·chat-and-collaboration·files-and-results·computer-and-apps·skills-routines-and-automations·settings-and-notifications·approvals-security-and-privacy) 기능 목록 ② 0.18 원장 1,292건 최신 판정 ③ 감사 findings ④ 코드 지도 4건(memory/roster · routine · plugin · feature gate) |
| 이번 회차 구현·수정 | 15건(§2) — `npm run check` 통과(typecheck 0 · 테스트 143/143) |
| 라이브 검증 | Pi 인증 상태 · 메모리 회수 · ListAgents/ListGroups · CloudAgent/GenerateImage 숨김 · Shell cwd/env 유지 · PDF 읽기 · 플러그인 설치(UI→mcp.json→에이전트 도구 호출) 전부 PASS · 루틴 로컬 발화 = 아래 §3 |
| 남은 것 | §4 — 구조적으로 로컬에 성립하지 않는 것(EXCLUDED_HIDDEN, 숨김·정직 표기 완료)과 후속 확장 |

한 줄 요약: **"코드는 있는데 production에 안 꽂힌" 핵심 연결부(기억 회수·roster·예약 루틴·플러그인·PDF·셸 상태·로그인 상태)를 전부 꽂았고, Cursor 계정이 있어야만 되는 것은 숨기고 프롬프트에서도 광고하지 않게 했다.**

## 1. 공식 문서 기능 목록 대조 (docs.x.ai/grok-bot)

| 공식 기능 (docs.x.ai) | 0.18 원장/감사 상태 (회차 전) | 판정 · 처리 (회차 후) |
|---|---|---|
| **Bot 생성·프로필** (Cmd/Ctrl+N, 이름·title·설명·아바타) | PASS(라이브, USER 라우트) | EXACT — 유지 |
| **Pin / Hide from sidebar / Show hidden chats** | PASS(라이브) | EXACT — 유지 |
| **Bot 복제** (프로필·설정·스킬·루틴·아바타 복사, 기록·기억·첨부 제외) | PASS(라이브) | EXACT — 유지(0.30 계약 재검증은 후속) |
| **Bot 삭제** | PASS(라이브) | EXACT |
| **Bot 공개 공유 링크** (x.ai 미리보기 → Add to Grok Bot) | UNAVAIL | EXCLUDED_HIDDEN — 0.18 렌더러에 표면 없음(0.24+ 기능) |
| **Bot 한도 50** | 코드(`isAgentCapReached`) | EXACT(코드) |
| **Bot memory** ("stable working preferences, important facts, summaries") | **AUDIT-1 CONFIRMED** — 저장은 되나 system prompt에 `memoryStore/…` 전부 null → 회수 안 됨 | **WSL_EQUIVALENT→EXACT 수정** — 프롬프트 조립에 실제 store(agent/user/project) 연결, `createUserMemory/createProjectMemory` 신규(§2 M1) · 라이브 §3 |
| **채팅** (텍스트·링크·이미지·파일·`/`스킬·`@`멘션·답글·반응·Stop) | PASS 다수(라이브) | EXACT — 유지 |
| **그룹 채팅** (2~6 Bot, `@everyone`, 스레드, 가시적 handoff) | PARTIAL — roster가 `isGroup:false`만 보고해 그룹 배송 분기 미도달 | **수정+라이브(후속 5)** — roster 요약이 `group.json`으로 그룹/멤버를 채움(§2 R2) · 라이브: createGroup(2봇) → GROUP-PING → 상대 봇 GROUP-PONG 자동 응답(그룹 전사 왕복) |
| **Bot 간 메시지** (비동기, 수신 Bot wake, 답장) | PASS(SendToAgent) / AUDIT-5 휘발성(재시작 비내구) | EXACT(원본도 fire-and-forget) — 재시작 내구성은 Phase B 항목으로 유지 |
| **Bot roster 발견** (다른 Bot/그룹 찾기, ListAgents/ListGroups) | **AUDIT-3 CONFIRMED** — 프롬프트에 빈 배열, 도구 부재 | **수정** — 실제 roster provider 연결 + `ListAgents`/`ListGroups` 도구 신설(§2 R1,R3) · 라이브 §3 |
| **검색 · command palette** | PASS(라이브) | EXACT |
| **Bot의 컴퓨터** (클라우드 VM, 브라우저·터미널·파일, Bot별 화면, 앱 종료 후 계속) | UNAVAIL(클라우드) → §1.5 로컬 컴퓨터 유즈 구현 | WSL_EQUIVALENT — 로컬 Xvfb 데스크톱/박스(이 머신) · "앱 종료 후 계속"은 호스트 프로세스 수명과 동일 |
| **Browser/computer use, takeover(비밀번호·2FA·CAPTCHA)** | 컴퓨터 유즈 PASS(라이브) · takeover 카드 표면 PARTIAL | WSL_EQUIVALENT — VNC 뷰어로 사용자가 직접 조작(takeover 동등) |
| **Local computer execution** (Ask/Always/Never, 명령 승인) | PASS(라이브, AUDIT-W5 후) | EXACT |
| **Shell 상태 유지** ("Shell state (cwd, env vars) persists") | **AUDIT-W2 CONFIRMED** — 매번 새 sh | **수정** — 데몬이 cwd/env를 스냅샷·복원(§2 S1) · 라이브 §3 |
| **첨부** (이미지·오디오·비디오·PDF·Office·CSV/JSON/YAML·코드·HTML·이메일·노트북, 25MB/200MB, 6개) | 이미지·텍스트 PASS · PDF **AUDIT-11**(worker 미탑재) · 오디오/비디오 미구현 | PDF **수정**(pdftotext→pdfjs, §2 P1) · 라이브 §3 · 오디오/비디오 이해 = EXCLUDED_HIDDEN(로컬 모델 경로 없음; 프롬프트는 광고 안 함) |
| **결과 artifact 카드** (파일·이미지·링크·도구 결과, 미리보기·저장·열기) | PASS(라이브, PDF/XLSX 미리보기) | EXACT |
| **Plugins** (Settings → Plugins: Marketplace 발견·설치·업데이트·삭제, Yours, 브라우저 인증, 도구 토글) | **AUDIT-8** — 검색/설치/인증/삭제가 Cursor 백엔드 전용, 데스크톱은 로컬 mcp.json도 못 봄 | **WSL_EQUIVALENT 구현** — 로컬 카탈로그(`plugin-catalog.json` + 기본 3종)·설치 기록·`mcp.json` 쓰기, 데스크톱/호스트 관리자 모두 로컬 저장소 사용, 인증은 "not-configured"로 정직 강등(§2 PL1) · 라이브 §3 |
| **Local MCP** (stdio initialize/list/call, 도구 토글) | PASS(라이브) · `cwd` 유실 | **수정** — `cwd` 지원(§2 PL1) |
| **Skills** (전역, Bot별 enable, `/` 참조) | PARTIAL(로컬 SKILL.md 존재) | EXACT(로컬 스킬) — managed/plugin 스킬은 로컬 플러그인 스킬로 후속 |
| **Teach by demonstration** (10분 브라우저 녹화 → skill) | UNAVAIL | EXCLUDED_HIDDEN — 게이트 `sand_teach_by_demonstration` 로컬 고정 false(§2 G1) |
| **Routine CRUD** (create/test/pause/edit/history/delete, 50개, 최근 20 run) | PASS(편집·수동 실행) | EXACT |
| **Scheduled routine** (timezone cron, 앱 닫혀도 실행) | **AUDIT-7 CONFIRMED** — cron 발화는 클라우드 전용 | **WSL_EQUIVALENT 구현** — 로컬 cron 스케줄러(30s tick, lastRunAt 앵커, 6h 오래된 누락 재앵커, 서버 스케줄 진입점 재사용)(§2 A1) · 라이브 §3 · "앱 닫혀도"는 호스트 실행 중일 때 |
| **Event routine** (Slack/GitHub 트리거) | UNAVAIL(Cursor 통합) | EXCLUDED_HIDDEN — 커넥터 미연결 시 UI에 "connect" 카드만; 실제 이벤트는 로컬 커넥터 추가 시 |
| **Approval card** (Allow once / Deny / Always allow) | PASS(라이브) | EXACT |
| **Auto-review** (Require Approval > Always Allow, 모델 사전 검토) | AUDIT-W3 FIXED(라이브) | WSL_EQUIVALENT(Pi 분류기) |
| **Settings: 테마·Default Model·Timezone·Execution on Local Computer·Auto-review** | PASS(라이브) | EXACT |
| **Account (Sign in/out, 버전, iOS 링크)** | **AUDIT-10** — 화면은 "logged-in" 고정, 실제 Pi 자격증명과 무관 | **수정** — 실제 Pi 자격증명으로 상태 표시, 앱 내 Sign in = 기기 코드 OAuth(브라우저 열기 + 앱 내 트레이에 코드), Sign out = 자격증명 삭제(§2 L1) · 라이브 §3(상태) |
| **Usage & Billing / weekly usage** | UNAVAIL(Cursor 계정) | EXCLUDED_HIDDEN — `sand_usage_page` false 고정; Settings 탭은 Router 패치가 로컬 사용량으로 대체 |
| **Team Setup / Teams·Enterprise / SSO / 관리자 명령 거부목록** | UNAVAIL | EXCLUDED_HIDDEN(단일 사용자) — 111 UNAVAIL 유지 |
| **Check for Updates / Restart to Update** | INTENTIONAL_DIFFERENCE(updater 비활성) | EXCLUDED_HIDDEN — `sand_auto_update_when_idle` false 고정 |
| **Update/Reset Agent Computer** | UNAVAIL(managed VM) | EXCLUDED_HIDDEN(로컬 박스는 파일 시스템) |
| **Notifications** (OS 알림 토글, 모바일 푸시, 포커스 시 억제, 읽음 표시) | PARTIAL/UNVERIFIED | **수정+라이브(후속 5)** — Linux/WSL fallback(notify-send → WSL powershell 풍선) 신설·배선, 라이브 발사 확인; 모바일 푸시 EXCLUDED |
| **Error display above composer / Copy request ID** | PASS(트레이) | EXACT |
| **Cloud agents (Cursor)** | 프롬프트·도구가 계속 광고(map-gates) | **EXCLUDED_HIDDEN 수정** — 로컬 모드에서 CloudAgent 도구 제거 + 프롬프트 변형(§2 G2) |
| **GenerateImage / AI 아바타** (Cursor 토큰) | AUDIT-9 — 프롬프트가 광고, 도구 없음 | **EXCLUDED_HIDDEN 수정** — 로컬 프롬프트 변형이 "이미지 생성 불가"를 명시(§2 G2); 아바타 생성 RPC는 토큰 오류로 정직 실패 |
| **iPhone / mobile** | MISSING | EXCLUDED_HIDDEN(`sand_get_grok_bot_ios` false) |
| **X connector** | UNVERIFIED | 후속 — 로컬 MCP/플러그인 카탈로그에 항목 추가 시 |
| **Hooks** (preToolUse/beforeShellExecution/postToolUse 등) | AUDIT-W8 FIXED(라이브) | **EXACT(전 표면, 후속 5)** — Shell 스트림 + beforeMCPExecution(라이브 deny/allow) + WebFetch(withRemoteHooks, 라이브 deny) |
| **대화 압축(compaction)·컨텍스트 창** | AUDIT-EPOCH(항상 0)·AUDIT-6B(창 과대평가) | **수정+실측(후속 5)** — epoch = 요약 아카이브 수(§2 C1) · 창 실측: 90k/150k/220k/260k 전부 수락 → 272k 카탈로그 유지, AUDIT-6B 해소(env knob은 운영자용 존치) |
## 2. 이번 회차 구현·수정 목록

| # | 결함/공백 | 수정 | 근거 파일 |
|---|---|---|---|
| M1 | **AUDIT-1** 장기 기억 자동 회수 미연결(프롬프트 컨텍스트 memory 전부 null) | 프롬프트 조립에 `session.memory`·`session.db` 연결 + `createUserMemory/createProjectMemory` 신설(user/project 샤드를 `[via 봇]` 출처와 함께 병합) | `host-runner-composition.ts`, `extensions/memory/extension.ts` |
| R1 | **AUDIT-3** roster 빈 배열 | 프롬프트 컨텍스트와 runnerOptions가 같은 provider 공유 | `host-runner-composition.ts` |
| R2 | 그룹 요약이 항상 `isGroup:false` | `session-roster.ts`가 `group.json`으로 isGroup/memberIds 채움 → 그룹 배송 분기 도달 | `extensions/session/session-roster.ts` |
| R3 | `ListAgents`/`ListGroups` 도구 부재(프롬프트만 광고) | 두 도구 신설·툴셋 등록 | `sand-agent-management-tools.ts`, `turn-toolset.ts` |
| S1 | **AUDIT-W2** Shell cwd/env 미유지(결과 문구는 "persists") | 데몬 `shellStream`이 상태 파일(cwd·`export -p`)을 복원·스냅샷, 중단 시 초기화, exit cwd를 논리 경로로 보고; 내부 탐침용 `shellArgs` 경로는 제외 | `box-exec-daemon/shell-state.ts`, `server.ts`, `create-shell-tool.ts` |
| P1 | **AUDIT-11** PDF Read 미구현 + **AUDIT-W10** 데몬이 PDF 거부 | 로컬 추출기(pdftotext→pdfjs) 바인딩 + 데몬이 PDF 바이트를 data로 반환 | `runner/local-pdf-text-extractor.ts`, `server.ts` |
| C1 | **AUDIT-EPOCH** compactionEpoch 0 고정 | 요약 아카이브 수로 계산 | `host-runner-composition.ts` |
| C2 | **AUDIT-6B** 컨텍스트 창 과대평가 | `SAND_CODEX_CONTEXT_WINDOW_TOKENS`/`_MAX_TOKENS` 운영자 조정(기본 미변경, 실측 후속) | `inference/context-window.ts` |
| L1 | **AUDIT-10** 로그인 화면이 Pi 자격증명과 무관 | 실제 자격증명으로 상태·Sign in(기기 코드 OAuth, 브라우저+트레이 코드)·Sign out; 게이트웨이/코디네이터 메서드 5개 | `pi-codex-login-session.ts`, `extension.ts`, `account-oauth.ts`, `gateway-protocol.ts`, `host-gateway-api.ts`, `coordinator-main.ts` |
| A1 | **AUDIT-7** 예약 루틴 로컬 미발화 | 로컬 cron 스케줄러(30s tick·lastRunAt 앵커·6h 초과 누락 재앵커·서버 스케줄 진입점 재사용) + `shouldScheduleCronLocally` | `automations/local-cron-scheduler.ts`, `extension.ts`, `sand-automation-cloud-sync.ts` |
| A2 | **AUDIT-W9(신규)** 로컬 모드 추론 준비 상태 항상 false → 루틴/훅/wake 게이트 영구 차단 | `inference.isReady`가 Pi 자격증명도 인정 | `inference/extension.ts` |
| PL1 | **AUDIT-8** 플러그인이 Cursor 백엔드 전용 | 로컬 저장소(`mcp.json`·`plugin-catalog.json`+기본 3종·`plugin-installs.json`), 데스크톱·호스트 관리자 로컬 배선, 인증 not-configured, `cwd` 지원 | `shared/node/mcp/local-mcp-store.ts`, `desktop-mcp-manager.ts`, `mcp-service.ts`, `mcp-manager.ts`, `mcp-oauth.ts` |
| G1 | 클라우드 전용 게이트가 상류 기본값 의존 | 로컬 스냅샷에서 usage/teach/agent-network/iOS/publish/auto-update 게이트 false 고정 | `local-codex-mode.ts` |
| G2 | CloudAgent 도구·GenerateImage 문구가 계속 광고(정직성 위반) | 로컬 모드: CloudAgent 도구 제거 + `isCloudAgentsDisabledByTeam` + 로컬 프롬프트 변형(이미지 생성 불가 명시) | `host-runner-composition.ts`, `experiments/extension.ts`, `system-prompt.ts`, `system-prompt-assembly.ts` |
| T1 | 미사용 복원 모듈 제네릭 추론 실패 3건 | 명시적 타입 인자 | `recovered-production-stream-retry.ts` |

## 3. 라이브 검증 기록 (cycle18/19 빌드 · 에이전트 ParityProbe/HooksProbe · CDP+게이트웨이)

| 항목 | 결과 |
|---|---|
| Pi 인증 상태 | `getProviderAuthStatus` → `{configured:true, source:"stored"}`, 로그인 세션 idle |
| 메모리 회수 | 턴1 update_state(user 샤드에 "The user's favorite color is teal-7731." 기록) → 턴2 도구 없이 "teal-7731" 회답 |
| ListAgents/ListGroups | 다른 봇 10개를 id와 함께 나열 / "You are not in any group chats." |
| CloudAgent/GenerateImage 숨김 | 모델의 도구 목록 기준 "CloudAgent: no, GenerateImage: no" |
| Shell env 유지 | 호출1 `export PARITY_VAR=…` → 호출2 `echo $PARITY_VAR` = 값 유지, 결과 문구 "Current directory: /workspace/parity-sub" 정확 |
| Shell cwd 유지 | 호출1 `cd parity-sub` → 호출2(working_directory 미지정) `pwd` = …/box-workspace/parity-sub, "Current directory: /workspace/parity-sub" (cycle19) |
| PDF Read | `Read /workspace/parity-test.pdf` → "HELLO PDF 42 parity" (cycle19; cycle18에선 데몬 거부 → AUDIT-W10 수정) |
| 루틴 로컬 발화 | `@every 1m` 루틴 생성(nextRunAt=+60s) → t≈80s에 `trigger:"schedule"` run(status ok, 9s) → 전사에 "PARITY_ROUTINE_OK" (cycle19; cycle18에선 준비 상태 게이트 false로 200s 미발화 → AUDIT-W9 수정) |
| 플러그인(로컬) | Plugins 화면: Marketplace "This computer"에 Filesystem/Knowledge graph memory/Sequential thinking, Yours에 belmont-test(Connected). 상세 → **Add** → "Adding Sequential thinking" → `plugin-installs.json`/`mcp.json` 갱신 → Yours에 "Sequential thinking · 1 connector · Connected" → 에이전트 GetMcpTools에 `sequential-thinking: sequentialthinking` 노출, 호출 성공(`{"thoughtNumber":1,…}`) |

라이브 중 발견·수정: **AUDIT-W9**(로컬 모드 추론 준비 상태가 항상 false → 루틴/훅/wake 게이트 영구 차단), **AUDIT-W10**(박스 데몬이 PDF를 거부), 셸 상태가 내부 탐침(`curl 9223`, 비스트리밍 경로)에 덮이던 문제(비스트리밍 경로 제외).

## 4. 제외·숨김·후속

### EXCLUDED_HIDDEN (개인 WSL 제품에 성립하지 않음 — 숨김·정직 표기 완료)
| 기능 | 처리 |
|---|---|
| Cursor Cloud agents(launch/cancel/rename/archive/카드/승인 카드, USR-704~708·555~561·678, AGT-060~062 등 32건) | 로컬 모드에서 CloudAgent 도구 제거, 프롬프트가 클라우드 에이전트 비활성 변형 사용 → 원장은 UNAVAIL 유지(사유: EXCLUDED_HIDDEN) |
| GenerateImage / AI 아바타(AGT-142~148·340·341, USR-657) | 도구 없음 + 프롬프트가 "이미지 생성 불가"를 명시; 아바타 생성 RPC는 토큰 오류로 정직 실패 |
| Teams/Enterprise/SSO/조직도/멤버/채널/공유룸/관리자 거부목록 | 게이트 false 고정(`sand_agent_network`) + 단일 사용자 |
| Usage & Billing / weekly usage / Team Setup | `sand_usage_page` false; Settings 탭은 Router 패치가 로컬 사용량으로 대체 |
| iPhone / mobile push | `sand_get_grok_bot_ios` false; 알림은 OS 알림만 |
| Check for Updates / Update·Reset Agent Computer | updater 비활성(`sand_auto_update_when_idle` false); 로컬 박스는 파일 시스템 |
| Teach by demonstration | `sand_teach_by_demonstration` false |
| Bot 공개 공유 링크 / template marketplace / virtual card / voice | 0.18 렌더러에 표면 없음(0.24+); 제외 |
| 오디오/비디오 이해 | 로컬 모델 경로 없음(첨부·재생은 동작); 프롬프트는 광고하지 않음 |
| Slack/GitHub 이벤트 루틴 | 커넥터 미연결 시 connect 카드만; 로컬 커넥터는 요구 시 |

### 후속(코드는 있으나 라이브 미검증 / 확장)
**2026-08-31 후속 5 회차에서 대부분 마감** (상세: `belmont-full-test-report.md` §1.6 후속 5):
- ~~OS 알림~~ → 완료(Linux/WSL fallback 신설: notify-send → WSL powershell 풍선; 라이브 발사 확인)
- ~~beforeMCPExecution/WebFetch 훅~~ → 완료(라이브 deny/allow)
- ~~MCP 표면 auto-review~~ → 완료(AUDIT-W11 발견·수정 + 라이브: 분류기 규칙 인용 승인 카드)
- ~~컨텍스트 한도 실측~~ → 완료(90k/150k/220k/260k 전부 수락 → 카탈로그 272k 유지, AUDIT-6B 해소)
- ~~Shell 함수/별칭/옵션~~ → 완료(alias·set±o 유지 라이브; 함수는 bash 박스 한정 — dash 한계)
- ~~그룹 채팅 라이브~~ → 완료(createGroup → GROUP-PING → 상대 봇 GROUP-PONG 자동 응답)
- ~~첨부 staging 즉시 정리~~ → 완료(commitStaged 성공 후 삭제)
- ~~서브에이전트 settle 경계(AUDIT-4)~~ → 완료(settle host 턴-대화 매개변수화; 자식 재시작 내구만 Phase B 잔류)
- ~~MCP tools/list pagination~~ → 완료(앱 경유 라이브: belmont-page 2페이지 3도구). list_changed는 데몬 클라이언트까지 완료 — 호스트 전파 갭은 **AUDIT-W12**(CONFIRMED)로 분리

남은 후속: **AUDIT-W12**(list_changed 호스트 전파 — 동적 추가 도구가 refreshMcp 전까지 발견·호출 불가) · 브라우저 표면 auto-review 개별 라이브 · 로컬 플러그인 카탈로그 확장(url/http MCP 서버는 로컬 모드 stdio-only) · SendToAgent 재시작 내구성(AUDIT-5, Phase B) · 봇별 영구 모델 설정(AUDIT-W1) · X connector(카탈로그 항목 추가 시)
