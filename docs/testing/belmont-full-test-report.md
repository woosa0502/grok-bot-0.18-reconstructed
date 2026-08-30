# Belmont — 풀 테스트 & 감사 종합 문서

_생성: 2026-08-29 · 갱신: 2026-08-30 (컴퓨터 유즈 §1.5 추가, 확정 실결함 커밋·병합 반영) · 단일 통합본 (이전 산재 문서/임시 원장 대체)_

이 문서는 두 검증 활동을 하나로 합친다: (1) **행위 단위 라이브 sweep** — 에이전트에 각 테스트 케이스를 주입해 실제 도구 실행 증거로 판정, (2) **소스 코드 감사** — production 배선/통합 여부를 코드로 확인. sweep은 '도구가 개별로 작동하는가'를 보고, 감사는 '실제로 production에 연결됐는가'를 본다. 후자가 전자의 여러 PASS를 false-green으로 뒤집었다.

## 0. 요약

| 항목 | 값 |
|---|---|
| 전체 테스트 케이스 | 1292 (USER 823 · AGENT 438 · GATED 31) |
| sweep 판정 완료 | 2075 |
| — PASS | 503 |
| — ISSUE (문제점, false-green 정정 포함) | 34 |
| — UNAVAIL (이 버전엔 기능 없음) | 641 |
| — ENV / UI_ONLY / EXPECTED | 83 / 13 / 1 |
| 감사 findings | 26 (CONFIRMED 19 · FIXED 3 · PARTIAL 3) |
| 확정 실결함 | 3 (update_state, Pi maxTokens, 첨부전송 크래시 — 셋 다 수정+재빌드+라이브검증+커밋) |
| 신규 기능 | **컴퓨터 유즈** (스크린샷·클릭·타이핑·키 — 라이브검증+커밋, §1.5) |

**핵심 결론:** 다중 봇 *기반*은 있으나, Belmont의 핵심 연결부 — 기억 자동회수 · 봇 발견 · 위임 내구성 · child 상태 격리 · 결과 검토 — 가 아직 production에 끊겨 있다. sweep의 PASS 수치는 false-green으로 부풀려져 있었다. (2026-08-30 갱신: 컴퓨터 유즈 신규 구현+검증 §1.5, 확정 실결함 3건 커밋·병합 완료.)

## 1. 확정 실결함 (수정 완료)

### AUDIT-2 — update_state 결과 오보고 ✅수정+빌드
- 증거: agent-state.ts {message} vs tool {detail/reason}; any boundary hid it. FIXED this session + built.
- sweep 관계: was caught by sweep (083/269)

### AUDIT-6 — Pi maxTokens:0 -> 선제압축 무력화 ✅수정+빌드
- 증거: pi-codex-runtime.ts:177 hardcoded 0; background-summarization.ts:27 maxTokens<=0 => no threshold. FIXED (resolved.model.contextWindow=272000) + built.
- sweep 관계: found by user analysis, not by sweep

### DEFECT-3 — 이미지/파일 첨부 전송 시 앱 전체 크래시 (attachment kinds shape 불일치) ✅수정+빌드
- 증거: session-projection.ts buildAttachmentLastEntry가 kinds를 countKinds()의 객체 {image:1}로 넣음. 렌더러 Yun/mergeKindCounts는 배열 [{kind,count}] 기대. 객체엔 .length=undefined라 빈-가드 통과 후 n.filter 폭발 -> 'TypeError: n.filter is not a function' -> 루트 에러경계 -> 앱 전체 크래시(reload로만, 심하면 agent 삭제로만 복구). 게이트웨이 주입/직접 CDP 앱제어 둘 다 동일 재현.

> 상태: 소스 수정 + 재빌드 + 라이브검증 완료. **커밋+병합 완료** (main d4babb9, origin push, 2026-08-30).

## 1.5 컴퓨터 유즈 (Computer Use) — 신규 구현 + 라이브 검증 ✅ (2026-08-30)

원래 이 로컬 버전엔 컴퓨터 유즈가 없었다(§6 UNAVAIL 641에 '컴퓨터' 포함). 이번에 **로컬 Codex 모드용 Computer 도구를 구현**해 에이전트가 화면을 보고(스크린샷→Pi 비전) 마우스·키보드로 조작(클릭·타이핑·키)하게 만들었다. 종단간 라이브 검증 완료, main 병합(d4babb9)·origin push.

### 무엇이 막혀 있었나 — 근본원인 3개 (원인별 재설계, 성적표 튜닝 아님)
원래 있던 `createComputerTool`은 **불완전 재구성**이라 턴-도구 계약을 하나도 안 지켰다.

1. **프레임워크 미준수** — 스트리밍 execute·proto 결과(toJson)·serializeError·이미지 전달 render가 전무 → `createComputerTurnTool` 신규 작성(host-computer-tool-dependencies.ts). generate-image/ls와 동일 계약(withSafeParsedArgs + ComputerUseToolCall proto + createImageResult).
2. **실행 라우팅 오류** — 컴퓨터 동작이 local-exec 게이트웨이(shell/파일만 앎)로 가서 describeLocalExec가 computerUseArgs를 몰라 '설명 불가(SAND_LOCAL_TOOLS_UNDESCRIBABLE)'로 차단됨 → 공유 헬퍼(box/local-computer-use.ts)로 박스 accessor를 로컬 Xvfb executor로 감쌈(box/production.ts + extensions/local-exec/production.ts). CombinedResourceAccessor는 로컬 항목이 게이트웨이보다 우선.
3. **★이미지 미전달 (결정타)** — Pi 투영이 tool 결과의 텍스트(`part.result`)만 쓰고 스크린샷이 담긴 `experimental_content`를 통째로 버림 → experimental_content 우선 사용하도록 수정(extensions/inference/pi-codex-projection.ts:202). 이게 모델이 화면을 '보게' 만든 핵심.

### 구현 방식
- 전용 **Xvfb**(:99, 1280×800) 가상 화면. 캡처=**ffmpeg x11grab**(ImageMagick `import -window root`는 Xvfb서 1비트/빈 프레임으로 퇴화), 입력=**xdotool**.
- 로컬 모드엔 컴퓨터유즈 서브에이전트 런타임이 없어 **메인 에이전트에 직접 노출**(turn-toolset.ts 게이트 완화 + turn-agent-composition.ts fallback + host-runner-composition.ts projection).
- 실행기: `source/packages/local-exec/computer-use/{executor,display-manager}.ts`. remote-box-resources.ts는 로컬 모드서 monitor-lease/navigation-probe 단계 건너뜀.

### 라이브 검증 (에이전트 응답 + 내 독립 ffmpeg 캡처로 교차확인 — self-report 아님)
| 액션 | 판정 | 증거 |
|---|---|---|
| **screenshot** | ✅ PASS | 화면 코드 정확 판독: GRAPE-99·CHERRY-42·MANGO-88 정확 (작은폰트 KIWI→KWW 근사, 판독 자체는 작동) |
| **click** | ✅ PASS | xmessage OK 버튼 클릭 → 창이 실제로 닫힘(내 독립 확인). 마우스 물리 입력 작동 |
| **type** | ✅ PASS | xedit에 " ZEBRA-TYPED-42" 입력 → **내 독립 캡처에 실제 삽입 확인**(에이전트 환각 아님) |
| **key** | ✅ PASS | Return 키로 새 줄(상태바 L1→L2) 생성 후 "KEY-NEWLINE-9" 입력, 독립 캡처 확인 |
| move | ✅ (암묵) | 클릭 전 mousemove로 좌표 이동(executor 내장) |
| scroll·drag·wait·cursorPosition | 구현됨 (미개별검증) | 동일 xdotool executor 경로 — 마우스(click)·키보드(type/key) 파이프라인 이미 입증 |

### ② computerUse 서브에이전트 dispatch ✅ (2026-08-30 추가)
Task 도구가 subagent_type을 executor만 허용("Invalid value. Expected one of: executor")한 이유는 host-runner-composition.ts:2530이 config를 `[executor]`로 하드코딩(재구성 잔재)한 것. 로컬 CU면 `createSandComputerUseSubagentConfig`도 추가하도록 고침. 단일화면 락(`allocateComputerUseWindow`, agent-adapters.ts:62)은 이미 존재 → 한 번에 하나만.
- **라이브 검증**: "Use the Task tool to dispatch a computerUse subagent..." → 봇 "The computerUse subagent was accepted and dispatched successfully. It reported the code word: **PLUM-55**". (수정 전엔 "Invalid value. Expected one of: executor"로 거부됨 → 수정 후 수락)

### ③ VNC 뷰어 패널 ✅ (2026-08-30 추가)
호스트가 **x11vnc**(:99→5900) + **websockify/noVNC**(6080)를 spawn하고, 박스 vncUrl을 noVNC URL로 채움(display-manager.ts + box/local-computer-use.ts + box/production.ts). x11vnc가 WSL의 WAYLAND_DISPLAY를 보고 Wayland로 오인·종료하던 것 → spawn env에서 WAYLAND_DISPLAY/XDG_SESSION_TYPE 제거로 해결.
- **라이브 검증**: 앱 "Grok Bot's Computer" 패널 클릭 → 렌더러가 `<webview src="http://127.0.0.1:6080/vnc.html?...">` 생성 → **:99 데스크톱이 앱 안에 실시간 표시**("VNC LIVE: MELON-33" 창 그대로 보임). 회색 플레이스홀더→실제 화면.

### 상태 / 한계
- 커밋 815c410(도구, 12파일) → main 병합(d4babb9). ②③은 추가 커밋 예정(4파일).
- 실행 조건: **`SAND_LOCAL_COMPUTER_USE=1`** (기본 동작 불변, opt-in). VNC는 x11vnc/websockify/novnc 설치 시 자동(없으면 뷰어만 비활성, 도구는 작동).
- 창 관리자 없음(openbox 등 미설치) → 앱이 테두리 없이 뜸. 실제 GUI 앱 자동화엔 WM 설치 권장.

### full-test 케이스 재분류 (컴퓨터 관련 — §6 UNAVAIL 641 중)
컴퓨터 관련 케이스는 3그룹 — ①에이전트 Computer 도구 ②computerUse 서브에이전트 dispatch ③VNC 뷰어 패널. **셋 다 구현+라이브검증 완료**(초기엔 ①만; ②③은 사용자 지시로 후속 구현).

| 케이스 | 원판정 | 새 판정 | 근거 |
|---|---|---|---|
| GBF-AGT-000141 (시퀀스가 screenshot로 안 끝나면 자동 screenshot 추가) | UI_ONLY | **✅ PASS(라이브)** | move만 시켜도 screenshot 반환·FIG-11 판독. host-computer-tool-dependencies.ts:351 |
| GBF-AGT-000135 (Computer then-batch 후속액션) | UNAVAIL | **✅ PASS(코드+라이브)** | :347-348 primary+then[] 시퀀스 조립; 다중액션(클릭+타이핑) 라이브 입증 |
| GBF-AGT-000206 (auto-review가 Computer 액션 거부) | UNAVAIL | **PARTIAL** | Computer 액션은 이제 존재하나 auto-review가 local서 강제OFF(AUDIT-W3)라 거부 게이트 미작동 |
| GBF-AGT-000429 (no-monitor면 SandBoxNoMonitor throw) | PASS | PASS(유지) | 플래그 OFF면 여전히 throw, ON이면 Xvfb 모니터 존재 — 둘 다 정상 |
| GBF-AGT-000297 (computerUse 서브에이전트 dispatch) | UNAVAIL | **✅ PASS(라이브)** | ②: config 하드코딩 수정 → 수락·dispatch → PLUM-55 판독 |
| GBF-AGT-000420 (서브에이전트로 **GUI 조작**) | UNAVAIL | **✅ PASS(라이브)** | 서브에이전트가 스크린샷→OK 버튼 클릭(좌표 자가조정 x463→x552)→창 닫힘(독립검증) |
| GBF-AGT-000298 (두 번째 서브에이전트 disallow) | UNAVAIL | **✅ PASS(라이브)** | 메인에이전트가 규칙대로 두 번째 dispatch 거부("forbid dispatching a second while one is running") |
| GBF-AGT-000235 (두 번째 → 데스크톱 할당 실패) | PASS | **코드경로 활성(유지)** | allocateComputerUseWindow(agent-adapters.ts:62) 하드 가드 존재·도달가능. 에이전트가 규칙 지켜 race 미생성 → 에러경로 자체는 미트리거 |
| GBF-USR (VNC 화면 보기) | UNAVAIL | **✅ PASS(라이브)** | ③: x11vnc+websockify+noVNC → 앱 "Open computer"에 :99 실시간 표시(MELON-33) |
| GBF-USR-000913 (VNC 줌 1x 고정) / USR-000456 (키 전달) | UNAVAIL | **✅ 코드배선** | electron VNC trust가 내 loopback `127.0.0.1/vnc.html`을 box desktop으로 인식(vnc-trust.ts:8) → installGuestInputGuard가 줌 1x 고정+before-input-event 라우팅 |
| GBF-AGT-307/308 (readClipboard/writeClipboard), USR-452/453/758 (클립보드), AGT-354 (presence), USR-454 (Cmd→Ctrl) | UNAVAIL | **코드배선(미개별E2E)** | 같은 trust로 boxDesktopWebview에 클립보드/presence 핸들러 부착(vnc-trust.ts:84-86, electron.clipboard). 인프라는 활성이나 중첩 webview 통한 각 동작 개별검증은 못 함 |
| GBF-USR-000390 (**다중 데스크톱 창** ensureWindow) | UNAVAIL | **미지원(정직)** | production.ts:107 maxWindows()=1 — 단일 Xvfb. 로컬은 한 화면만 |
| GBF-USR-000897 (handoff-card 'Open computer') | UNAVAIL | 별도 UI | 카드 UI 케이스 — 컴퓨터 유즈 코어 아님 |

**정직한 결론(검증 수준 구분):**
- **라이브검증**: ① 도구 실행(스크린샷/클릭/타이핑/키/then-batch/trailing) · ② 서브에이전트 dispatch·GUI조작·disallow · ③ VNC 화면 표시.
- **코드배선(개별 E2E 미검증)**: VNC 클립보드/presence/키보드/줌 — electron VNC 인프라(vnc-trust.ts)가 내 loopback vncUrl을 box desktop으로 인식해 자동 부착. 인프라 활성 확인·각 동작 개별검증은 중첩 webview 제약으로 못 함.
- **실제 미지원**: 다중 데스크톱 창(USR-390, maxWindows=1) — 단일 화면 설계.

## 2. 감사 findings — P0 (심각)

| ID | 제목 | 판정 | 증거 |
|---|---|---|---|
| AUDIT-1 | 장기 기억 자동 회수 미연결 | CONFIRMED | host-runner-composition.ts:1414-1417 system-prompt context has memoryStore/memorySnapshots/userMemory/projectMemory ALL null; :1740-1750 turn-exec has real stores. Write works, rec |
| AUDIT-10 | 화면 로그인 vs 실제 Pi OAuth 별개 | CONFIRMED | account-oauth.ts:12 + local-codex-mode.ts:7-13 상수 logged-in(Belmont Local); 실제 추론은 별도 pi-auth.json. 경로 분기: CLI ~/.grokbot vs WSL .cache/.../sand-data (run-wsl.mjs:28). wsl-runtime. |
| AUDIT-11 | PDF Read 미구현(안전실패) | CONFIRMED | read.ts:374 throws "Read PDF worker is not bound"; host-runner-composition.ts:2150 의도적 unbound; worker 파일 없음. 안전실패일 뿐 기능복원 아님. |
| AUDIT-2 | update_state 결과 오보고 | FIXED | agent-state.ts {message} vs tool {detail/reason}; any boundary hid it. FIXED this session + built. |
| AUDIT-3 | 봇 목록이 빈 배열 + ListAgents/ListGroups 도구 없음 | CONFIRMED | host-runner-composition.ts:1436-1437 agentDirectory/agentGroups: ()=>[] (빈), :2826 이게 실제 프롬프트 생성; agent-messaging.ts:54 "no other agents yet" 출력. 올바른 roster provider(:1534)는 아무도 안  |
| AUDIT-4 | 서브에이전트 settle이 부모 상태 사용 | CONFIRMED | turn-run-shell.ts:637 settle이 createSettleHost/getConversationId 사용; host-runner-composition.ts:2409-2459가 부모 session/builtRunner에 바인딩(transcriptId=session.id, 부모 agentStore/blob/r |
| AUDIT-5 | SendToAgent 휘발성 + marker만 영속 | CONFIRMED | agent-to-agent-messaging.ts:48 in-memory Map, 영속 wake-kind에 agent-message 없음; AgentInboundMessage(:14-22)에 task/result 필드 없음; pending-wake-rearm.ts:8-17 marker에 result 없음; :257 크래시 |
| AUDIT-6 | Pi maxTokens:0 -> 선제압축 무력화 | FIXED | pi-codex-runtime.ts:177 hardcoded 0; background-summarization.ts:27 maxTokens<=0 => no threshold. FIXED (resolved.model.contextWindow=272000) + built. |
| AUDIT-6B | maxTokens fix 불충분 — catalog 272000이 실제 Codex OAuth 한도 과대평가 | CONFIRMED | maxTokens fix는 배선까지 맞으나(usedTokens=usage.totalTokens 실측), aa1a1169가 transcript ~48k+시스템/도구 ~35k ≈ 55-83k에서 초과, 압축 미발화. 카탈로그 272000이 실제 OAuth 한도(~60-80k 관측)를 3-4배 과대평가 → 압축 임계(245k) |
| AUDIT-7 | 예약 루틴이 로컬 WSL에서 실행 안 됨 | CONFIRMED | cron은 Cursor cloud 경로(sand-automation-cloud-sync.ts:274 createSandAutomation); 발화는 backend poll(sand-automation-fire-consumer.ts:84); shouldScheduleLocally(:370)는 cron에 false; 로컬 트 |
| AUDIT-8 | 플러그인≠로컬MCP + 로컬MCP 4갭 | CONFIRMED | 플러그인 search/install/auth/delete는 Cursor backend(mcp-service.ts:126-149). 로컬MCP 갭: (a)cwd 누락 readLocalMcpServers(mcp-service.ts:207-218), (b)tools/list pagination 없음(mcp-stdio-clien |
| AUDIT-9 | 이미지생성/아바타는 Cursor 토큰 필요(광고만) | CONFIRMED | system-prompt.ts:140 GenerateImage 광고; generate-image-service.ts:5 getAccessToken 요구; cursor-generate-image.ts:8 Cursor backend RPC. Codex-OAuth 로컬모드엔 토큰없어 실패. |
| AUDIT-W3 | Auto-review가 Codex에서 강제 OFF | CONFIRMED | auto-review/extension.ts:52-55 localCodexMode면 isEnabled:false 강제; sand-auto-review.ts:66 off. 사용자가 켜도 무효. |
| DEFECT-3 | 이미지/파일 첨부 전송 시 앱 전체 크래시 (attachment kinds shape 불일치) | FIXED | session-projection.ts buildAttachmentLastEntry가 kinds를 countKinds()의 객체 {image:1}로 넣음. 렌더러 Yun/mergeKindCounts는 배열 [{kind,count}] 기대. 객체엔 .length=undefined라 빈-가드 통과 후 n.filter 폭발 - |

## 3. 감사 findings — P1

| ID | 제목 | 판정 | 증거 |
|---|---|---|---|
| AUDIT-EPOCH | compactionEpoch 항상 0 | CONFIRMED | host-runner-composition.ts:1413 compactionEpoch: () => 0 (hardcoded) |
| AUDIT-F1 | stream-retry 모듈 production 미연결(false-green) | CONFIRMED | recovered-production-stream-retry.ts importer 없음(테스트만); 실제 retry는 stream-attempt.ts. |
| AUDIT-F2 | video 분석 실제 없음(config/test만) | CONFIRMED | recovered-video-subagent-configs.ts:5 not-wired; prod subagent는 executor뿐. |
| AUDIT-F3 | per-agent-model 테스트가 resolver 재구현(false-green) | CONFIRMED | per-agent-model-selection.test.mjs가 로컬 resolve 복사, production turn-run-shell 미호출. |
| AUDIT-F4 | local Codex 테스트가 가짜 로그인 객체 검사 | CONFIRMED | local-codex-mode.ts:7 frozen LOCAL_CODEX_STATUS; 상수만 assert. |
| AUDIT-W1 | 영구 봇별 모델설정 없음(글로벌 하나) | CONFIRMED | turn-run-shell.ts:196-202 top-level는 getAgentDefaultModel() 하나; 봇id별 map 없음, 서브에이전트 타입별만. |
| AUDIT-W2 | Shell 작업디렉터리 미유지 | CONFIRMED | server.ts:1254 매번 새 /bin/sh -lc; cd/export 비유지. |
| AUDIT-W4 | 훅 커버리지 부분적 | PARTIAL | host측 WebSearch+Task만; 박스측 preToolUse는 Shell/Read/파일 게이트(server.ts:798). WebFetch/MCP 미포함. 감사의 Shell-미포함 주장은 오류. |

## 4. 감사 findings — P2 (경미)

| ID | 제목 | 판정 | 증거 |
|---|---|---|---|
| AUDIT-F5 | 대화 메모리 테스트 자체가 없음 | PARTIAL | tests/에 memory 테스트 전무; 감사가 credential-store 테스트를 오인. 메모리 플로우 미검증은 사실. |
| AUDIT-W5 | 첨부 staging 즉시삭제 안함 | CONFIRMED | attachments.ts:5,11,91 전송후 삭제안하고 시작시 1시간초과만 쓸어냄. |
| AUDIT-W6 | 서브에이전트 audit이 부모id 사용 | PARTIAL | subagent-runtime.ts:348 computerUseSession audit이 부모 conversationId. MCP는 아님 — 감사 프레이밍 부정확. |
| OBS-1 | 파일 도구 workspace-root 샌드박스 작동 | POSITIVE | sweep봇에 /tmp 밖 파일 편집 요청 시 도구가 거부: 'write/edit tools could not operate directly on /tmp/... because that path is outside their configured workspace root'. 로컬 파일 도구가 workspace root로  |

## 5. sweep에서 false-green으로 뒤집힌 케이스 (ISSUE 정정)

감사가 '코드는 있으나 미배선/비활성'을 밝혀, 아래 케이스는 PASS→ISSUE로 정정했다.

| 케이스 | 원래 | 정정 사유 |
|---|---|---|
| GBF-AGT-000195-N01 | PASS→ISSUE | FALSE-GREEN: [via] attribution code exists (sand-memory.ts:254) BUT system-prompt assembly gets userMemory/memoryStore=null (host-runner-composition.t |
| GBF-AGT-000325-N01 | PASS→ISSUE | beforeSubmitPrompt hook is defined (proto/hook-step) + has a daemon response shell, but is NOT fired anywhere and continue:false halt is not consumed  |
| GBF-AGT-000026-N01 | PASS→ISSUE | file_attachments field is exposed in the Task tool schema but only works for video-review subagents (absent in local) via a local-machine connection ( |
| GBF-AGT-000101-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000102-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000105-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000149-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000151-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000154-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000155-N01 | PASS→ISSUE | FALSE-GREEN: auto-review controller code exists but is FORCED OFF on Codex provider (auto-review/extension.ts:52-55); never runs in local mode. See AU |
| GBF-AGT-000197-N01 | PASS→ISSUE | memory synthesis (episode summaries) present but disabled by sand_memory_dreaming experiment gate; not enabled for local personal use -> feature the u |
| GBF-AGT-000116-N01 | PASS→ISSUE | smart-mode/auto-review classifier does not block on Codex (forced OFF, AUDIT-W3) |
| GBF-AGT-000152-N01 | PASS→ISSUE | auto-review no-retry-routing guidance inactive (auto-review OFF on Codex, AUDIT-W3) |
| GBF-AGT-000159-N01 | PASS→ISSUE | Read returned raw PNG bytes not an image result; image-MIME inline Read not wired (cf 441) |
| GBF-AGT-000233-N01 | PASS→ISSUE | subagent auto-review fail path inactive (auto-review OFF on Codex, AUDIT-W3) |
| GBF-AGT-000240-N01 | PASS→ISSUE | 429/503 shown as error but no retry-guidance text produced |
| GBF-AGT-000251-N01 | PASS→ISSUE | subagent steer-restart (prepend steer prompt on finishing subagent) not observed; MessageSubagent/steer path may not restart |
| GBF-AGT-000321-N01 | PASS→ISSUE | smart-mode classifier BLOCK/ALLOW inactive (auto-review OFF on Codex, AUDIT-W3) |
| GBF-AGT-000441-N01 | PASS→ISSUE | Read did NOT treat .png/.avif as inline image (returned raw bytes); image-MIME inline Read not wired in local |
| GBF-GAT-000029-N01 | PASS→ISSUE | memory synthesis/dreaming gate exists (sand_memory_dreaming) but off in local; see AUDIT-1/197 |
| GBF-USR-000852-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000809-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000473-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000475-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000805-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000811-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000476-N01 | PASS→ISSUE | auto-review는 local Codex에서 강제 OFF(auto-review/extension.ts:51 'forced off in local mode'). 사용자가 켜도 무효 — AUDIT-W3. |
| GBF-USR-000778-N01 | PASS→ISSUE | Smart Mode/auto-review는 local Codex에서 강제 OFF(AUDIT-W3). 사용자가 켜도 분류/권한 게이트 미실행. |
| GBF-USR-000779-N01 | PASS→ISSUE | Smart Mode/auto-review는 local Codex에서 강제 OFF(AUDIT-W3). 사용자가 켜도 분류/권한 게이트 미실행. |
| GBF-USR-000780-N01 | PASS→ISSUE | Smart Mode/auto-review는 local Codex에서 강제 OFF(AUDIT-W3). 사용자가 켜도 분류/권한 게이트 미실행. |
| GBF-USR-000647-N01 | PASS→ISSUE | permissions.json의 autoReview allow/block 규칙은 auto-review가 local Codex서 강제OFF(AUDIT-W3)라 무효. |
| GBF-USR-000648-N01 | PASS→ISSUE | permissions.json의 autoReview allow/block 규칙은 auto-review가 local Codex서 강제OFF(AUDIT-W3)라 무효. |
| GBF-USR-000675-N01 | PASS→ISSUE | routine 편집기 검증(빈 이름 aria-invalid/저장 실패 메시지)은 저장 검증 실패 상태 — auto-review off/저장경로 제약으로 유발 제한. 편집기 자체는 실측. |
| GBF-USR-000676-N01 | PASS→ISSUE | routine 편집기 검증(빈 이름 aria-invalid/저장 실패 메시지)은 저장 검증 실패 상태 — auto-review off/저장경로 제약으로 유발 제한. 편집기 자체는 실측. |

## 6. sweep 결과 — 성격별 분포 (전체 2075건)

| 분류 | 건수 | 뜻 |
|---|---|---|
| PASS | 503 | 실제 tool call/코드로 검증됨 (단, 배선 미검증 항목 잔존 가능) |
| ISSUE | 34 | 문제점 (미완성·false-green 정정) |
| UNAVAIL | 641 | 이 로컬 버전엔 기능 자체 없음 (클라우드·이미지·~~컴퓨터~~·브라우저·영상). **단 '컴퓨터'는 이후 구현됨 → §1.5 참조**(스크린샷/클릭/타이핑/키 라이브검증). 관련 케이스는 재분류 대상. |
| ENV | 83 | 환경(채널·그룹) 없어 검증 불가 |
| UI_ONLY | 13 | 데스크톱 UI 전용, 에이전트 조작 불가 |
| EXPECTED | 1 | 설계상 정상 동작 |
| FIXED | 2 | 실결함이었고 수정됨 |

## 7. 수정 우선순위 (감사 제안 + 현 상태)

1. **미커밋 maxTokens·update_state 수정 검증 및 커밋** — 수정+빌드 완료, 커밋만 남음
2. **production memory store·자동 추출·새 대화 recall 실제 연결** (AUDIT-1) — system prompt 조립에 실제 store 전달 (host-runner-composition.ts:1414 null → 실제 store)
3. **실제 agent directory·manager routing 연결** (AUDIT-3) — :1436 빈배열 대신 :1534의 실제 roster provider 배선 + ListAgents/ListGroups 도구 추가 또는 프롬프트 수정
4. **child settle/store/transcript 완전 분리** (AUDIT-4)
5. **durable task ledger + worker delivery/result/retry 구현** (AUDIT-5)
6. **Pi OAuth 경로·UI 상태·provider 진실원 통합** (AUDIT-10)
7. **WSL 미지원 routine/plugin/image 기능 숨기거나 로컬 구현** (AUDIT-7/8/9)
8. **false-green 테스트를 실제 production E2E로 교체** (AUDIT-F1/F3/F4, 메모리 E2E 추가)

## 8. 검증 방법론 & 한계

- **sweep**: 게이트웨이 `/api/sendPrompt`로 각 케이스 주입 → transcript의 SendMessage/tool_use를 증거로 내가 직접 판정. 한계: 에이전트 self-report + 개별 도구 수준 → 통합/배선 미검출(false-green 원인). 컨텍스트 초과·OOM·박스 wedge로 여러 재시작 필요했음. 로테이션(25케이스)·힙 8GB·150초 타임아웃으로 안정화.
- **감사**: 3개 subagent가 실제 소스로 각 주장 검증. CONFIRMED/PARTIAL/REFUTED + file:line 증거. 감사 경로(`source/host/runtime/...`)는 실제 레이아웃(`source/host/...`)과 달라 subagent가 직접 탐색.
- **PARTIAL 3건** (감사 과장 교정): W4 Shell은 박스에서 게이트됨 / W6 부모id는 computer-use audit만(MCP 아님) / F5 메모리 테스트는 아예 없음(감사가 credential 테스트 오인).
- **USER 라우트(823) — CDP로 앱 직접 제어 검증**: 게이트웨이 주입이 아니라 CDP로 실제 사용자처럼 클릭·타이핑·키·파일첨부(DOM.setFileInputFiles)·스크린샷(비전 판독). 실측 PASS 101건, UNAVAIL 72(cross-user 공유 로컬 게이트오프), ENV 2, UNCLEAR 8, 나머지 UI_INHERITED 640(원본 Cursor 번들 바이트동일 131파일 상속; 아래 방법으로 순차 실측 중).
- **직접 제어로 발견한 실결함 DEFECT-3(첨부전송 크래시)**: 유효 PNG를 composer file-input에 넣고 전송하니 앱 전체 크래시. Copy-error로 스택 확보(n.filter is not a function @ Yun) → session-projection의 kinds shape 불일치로 특정 → 수정·재빌드·라이브 재검증(전송·썸네일·봇 vision 응답·사이드바 미리보기 모두 정상, 크래시 0).
- **실측 확인된 USER 상호작용**: 첨부 스테이징/전송/vision, composer 자동완성 @멘션(봇 4개 실데이터)·/워크플로(8)·:이모지(12)·화살표순환·Enter칩삽입·Escape닫기, 초안 봇별 보존('Draft:' 표시), Cmd+K 명령 팔레트(All/Messages/Agents/Groups/Files/Links/Routines/Actions 탭), 이전/다음 에이전트 전환(Meta/Ctrl+]/[), 헤더 에이전트 클릭→설정 패널(Name/Title/Description/Notifications).
- **CDP 한계(결함 아님)**: 줌(Cmd+±/0)은 Electron 네이티브 메뉴 accelerator라 CDP 합성키로 발화 안 됨(clientWidth·dpr 불변으로 확인) — 실사용자 키입력엔 작동, 자동검증만 불가. GATED 31은 미실행.

### 8.1 나머지 640(UI_INHERITED) 실측 방법 — 4-방법 체계 (증명 완료)

미니파이 렌더러엔 data-testid/aria-label이 없지만 **접근성(AX) 트리에는 완전한 role+name이 있다**(button:'View agent settings', switch:'Notifications', textbox:'Prompt' 등). 이를 등뼈로 케이스 성격별 4방법을 배정했다(`scripts/categorize-715.mjs`, `scripts/ax-ui.mjs`).

| 방법 | 대상수 | 방식 | 증명 |
|---|---|---|---|
| **AX** | 197 | AX 트리로 role+name 찾아 box-model 클릭 → AX/DOM 델타로 판정 | 버튼 18개 이름열거·'QA Bot' 열기·Notifications 스위치 true→false 토글 실측 |
| **VIEWER** | 97 | 실제 fixture(pdf/xlsx/csv/md/json/txt/png) DOM.setFileInputFiles로 첨부→카드 클릭→뷰어 렌더 검증 | PDF뷰어(canvas 'Belmont test PDF'+페이지수+줌/다운로드)·스프레드시트뷰어(xlsx→표 a\|b/1\|2) 실측 |
| **COLLAB** | 73 | 소스 배선확인→로컬 게이트오프면 UNAVAIL | cross-user-sharing: sand_multiplayer 게이트+dev-env 가드+Cursor JWT 필요, 로컬 전부 'Sharing isn\'t enabled'. **72건 UNAVAIL 기록** |
| **CLOUD** | 139 | 소스확인으로 forced-off/cloud-only/local-present/외부-dep 구분 | auto-review 강제off(AUDIT-W3)·routines는 로컬존재(→AX 재배정)·MCP-OAuth는 ENV·Babysit/Diff-PR cloud전용 |
| OTHER | 209 | 위 4방법으로 세부 재분류 | 진행 |

**방법론 교훈:** (1) 케이스 간 UI 상태 리셋 필수 — 열린 모달을 Escape/'Close preview'로 닫되 **창 크롬 버튼('Close'/'Minimize'/'Maximize')은 절대 클릭 금지**(클릭 시 앱 종료됨, `ax-ui.mjs`의 DANGER_BUTTONS로 차단). (2) fixture는 뷰어별 실제 파일 필요. (3) 코드확인이 '없어서 UNAVAIL'과 '있는데 미검증'을 정직히 가른다 — 상속 가정으로 PASS 처리하지 않는다.

## 9. OpenBot 비교 & 중앙 관리자 갭 (전략)

외부 비교 분석(OpenBot main fb0c797 vs Belmont 89f60e54)을 검토한 결과 — Belmont 쪽 주장은 위 findings와 전부 일치(코드 확인). OpenBot 소스는 이 환경에서 접근 불가라 OpenBot 쪽은 독립 검증 못 했으나, 설계는 OpenBot 세부구현에 의존하지 않는다.

**세 제품은 다르다:**

| 구분 | 성격 |
|---|---|
| OpenBot | 여러 봇에 권한·컴퓨터·도구를 안전 제공하는 다중사용자 서버 플랫폼 |
| 현재 Belmont | WSL/Electron에서 영구 봇 + 임시 subagent를 실행하는 로컬-우선 플랫폼 |
| **원하는 Belmont** | 사용자의 단일 접점이자 계획·위임·진행관리·결과검토·재시도·최종승인까지 책임지는 **관리자 봇** |

**핵심: 중앙 관리자 orchestration은 어느 쪽에도 완성돼 있지 않다.** OpenBot이 앞선 것 = durable 작업큐·권한·감사·격리·자격증명·다중사용자. Belmont가 앞선 것 = WSL 로컬실행·Pi Codex OAuth·직접 도구실행·임시 Task subagent. **양쪽 다 부족 = 중앙관리자 지정·결과가 관리자에게 돌아오는 구조·결과 검토/승인/재시도·승인된 결과만 게시.**

권고: **Belmont 유지 + OpenBot의 내구성 패턴만 차용**(durable queue·typed handoff·idempotency·lease·audit·real-DB test) + **새 Belmont 전용 review/publication 계층**. OpenBot의 결과-semantics(worker가 자기 대화에 게시)는 복사하지 않는다.

## 10. 단일 invariant (북극성)

> **위임된 작업이 durable job이 되고, 결과가 반드시 Belmont로 돌아오며, Belmont가 승인하기 전에는 사용자에게 노출되지 않는다.**

불변식 5가지: ①사용자 입력 target은 항상 Belmont ②모든 위임에 durable job ID ③worker는 사용자에게 직접 최종답 게시 불가 ④모든 결과는 Belmont review 통과 ⑤APPROVED만 user publication 허용. Docker·SSO·정책엔진보다 이 하나가 먼저다.

## 11. 목표 아키텍처

```
사용자 → Belmont-only Router → Belmont 영구봇
                                  ├── 직접 도구 실행
                                  └── Orchestration Store (SQLite)
                                       ├── Persistent Worker Adapter
                                       ├── Temporary Task Adapter
                                       └── (future) External Worker Adapter
                                            → Result+Evidence Store
                                            → Belmont Review Turn
                                            → APPROVED → Publication Gate → 사용자
                                            → REJECTED → Retry/Reassign
```

SQLite schema(요약): goals · jobs(idempotency_key/claimed_by/lease_until/attempt/deadline) · results(evidence_manifest) · reviews(decision/defects) · job_events. 상태전이: PLANNED→QUEUED→CLAIMED→RUNNING→RESULT_RECEIVED→REVIEWING→APPROVED→PUBLISHED (+FAILED/REJECTED/CANCELLED/ORPHANED 경로).

## 12. 로드맵 (전략 P0/P1/P2 — 위 findings 수정과 통합)

**전략 P0 (중앙관리자 성립 최소):** ①managerAgentId ②Belmont-only routing ③SQLite goal/job/result/review store ④typed DelegateJob(worker_id/task/constraints/expected_output/evidence_requirements) ⑤worker ReturnJobResult(worker의 user-visible SendMessage 차단) ⑥Belmont review tools(Approve/Reject/RequestRetry/Reassign/Cancel/PublishGoalResult) ⑦approved-only publication gate(코드 enforce) ⑧durable queue·lease·idempotency ⑨Task child owner 분리(=AUDIT-4 수정)

**전략 P1 (장기 신뢰성):** per-bot execution profile(=AUDIT-W1) · restart reconciliation · **memory prompt/settle 배선(=AUDIT-1)** · worker 최소기억 projection · 실제 Pi auth status UI(=AUDIT-10) · Cursor→Codex migration · WSL에서 Cursor/cloud tool hard-disable · **토큰 유효한도 재조정(=AUDIT-6B, maxTokens fix 불충분)**

**전략 P2 (확장):** user-readable audit UI · declarative policy engine · AG-UI remote worker · per-bot container 격리 · multi-user auth/SSO · publishable components

**이미 수정된 버그 P0:** update_state(AUDIT-2) · Pi maxTokens:0(AUDIT-6) — 단 AUDIT-6는 값 재조정 필요(AUDIT-6B).

## 13. 최우선 테스트 (real-SQLite E2E — 현 sweep의 self-report false-green 대체)

mock 단위테스트가 아니라 실제 SQLite+production store를 통과해야 하는 것:
- **T1 Durable delegation**: process A가 job offer→종료→process B가 claim→result 저장→Belmont review wake 복구
- **T2 Duplicate prevention**: 같은 goal/worker/task 2회 위임 → job 1개·실행 1회·result 1개
- **T3 동시 2 worker**: 서로 다른 checkpoint/store/result, evidence 비교차
- **T4 하나만 cancel**: A=CANCELLED, B=APPROVED, B runner/store 무영향
- **T5 잘못된 결과 재시도**: attempt1 REJECTED → attempt2 APPROVED, attempt1 미게시
- **T6 result 이후 crash**: restart 후 같은 result 재검토, worker 재실행 안됨, 다른 대화에 안붙음
- **T7 publication gate**: APPROVED 전 PublishGoalResult → 코드수준 거부·audit기록·user transcript 무변화
- **T8 장기기억**: 사용자 금지사항 저장→재시작→새 대화→Belmont 회수→worker엔 최소정보만
- **T9 Pi OAuth**: 만료→상태변경→재로그인→복구, Cursor/Anysphere 네트워크 요청 0

---

_이 문서는 sweep 판정 + 코드 감사 24 findings + OpenBot 비교/설계/로드맵을 하나로 통합한 단일 SSOT다._
