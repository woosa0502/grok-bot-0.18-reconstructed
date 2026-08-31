# Belmont — Grok Bot parity 우선 구현·검증 기준

_작성: 2026-08-30 KST_

_상태: `PROVISIONAL / SCOPE AUTHORITY` — 구현 현황은 계속 변하므로 각 항목의 완료 판정은 최신 커밋과 실사용 증거로 다시 확인한다._

## 0. 이 문서의 목적

현재 작업 순서를 다음처럼 고정한다.

1. **원본 Grok Bot의 개인 사용자 기능을 WSL + Pi Codex OAuth 환경에서 완성한다.**
2. **그 기능을 실제 사용자 조작과 실제 production 경로로 검증한다.**
3. **기반이 안정된 뒤 Belmont 전용 중앙 관리자 기능을 추가한다.**

따라서 지금의 완료 기준은 “Belmont가 모든 작업 봇을 관리하는가”가 아니다. 현재 완료 기준은 다음 질문이다.

> **원본 Grok Bot에서 개인 사용자가 쓸 수 있던 기능이 WSL에서 빠짐없이 작동하거나, WSL에 맞는 대체 기능으로 작동하거나, 명시적으로 제외·숨김 처리됐는가?**

이 문서는 `belmont-full-test-report.md`의 증거·결함 기록을 폐기하지 않는다. 다만 그 문서의 §9~§13에서 중앙 관리자 orchestration을 즉시 P0로 둔 우선순위를 정정한다. 중앙 관리자 설계는 이 문서의 **Phase B**로 이연한다.

## 1. 범위 분류 원칙

원본 기능은 각 항목마다 반드시 다음 셋 중 하나로 판정한다.

### 1.1 `EXACT_RESTORATION`

원본과 같은 사용자 흐름·상태·결과를 WSL에서 제공한다.

- 같은 입력이 같은 기능으로 연결된다.
- 오류·취소·재시작 상태도 같은 의미를 가진다.
- UI에 노출된 기능은 실제 production 경로까지 연결된다.

### 1.2 `WSL_EQUIVALENT`

Cursor 계정·macOS·원격 box·클라우드 backend에 묶인 원본 기능을 WSL 로컬 기능으로 대체한다.

- 예: Cursor inference 대신 Pi Codex OAuth
- 예: 원격 computer 대신 로컬 Xvfb/Computer
- 예: Cursor MCP backend 대신 로컬 `mcp.json`/stdio MCP

대체 구현은 이름만 같은 stub이면 안 된다. 사용자가 달성할 수 있는 결과와 실패·복구 계약이 검증돼야 한다.

### 1.3 `EXCLUDED_AND_HIDDEN`

개인 WSL 제품에 불필요하거나 구조적으로 성립하지 않는 기능은 제외할 수 있다.

- 다중 사용자·팀 공유
- SSO/RBAC
- Cursor Cloud Agent
- Cursor marketplace/backend 전용 기능
- macOS/Windows installer 전용 기능
- Docker/원격 box 전용 운영 기능

단, 제외한 기능을 UI나 system prompt에서 작동하는 것처럼 광고하면 안 된다. **구현·대체·숨김 중 아무것도 하지 않은 `UNAVAIL`은 완료가 아니다.**

## 2. 현재 기준점과 검증 주의사항

- 코드 기준 HEAD: `7e65baa6e99aa08ad4c3db07fa1cd9f8444a8eaf`
- 현재 Belmont 앱과 별도 Claude 실사용 테스트가 실행 중이다. 이 문서 작성에서는 프로세스·DB·runtime artifact를 변경하지 않았다.
- 기존 `belmont-full-test-report.md`, `belmont-next-session-handoff.md`, `scripts/lib/wsl-runtime.mjs`, `tests/wsl-runtime.test.mjs`에는 다른 세션의 미커밋 변경이 있다.
- `AUDIT-W5` gateway auth 수정은 작업트리에 있으나 아직 커밋 기준선에는 없다.
- `npm test`는 109/109를 통과했지만 `npm run source:typecheck`는 현재 4건 실패한다.
  - `host-runner-composition.ts`: Computer-use subagent config 타입 오류 2건
  - `host-computer-tool-dependencies.ts`: `Context` 타입 충돌 2건
- 위 타입 오류는 최근 Computer-use 구현 커밋에서 들어왔으며 “이번 작업 전부터 있던 오류”로 취급하면 안 된다.

## 3. Phase A — 지금 완성할 Grok Bot 기능

### A0. 빌드·실행 기준선

현재 상태: **미완료**

남은 작업:

- `npm run check` 전체 green
- `npm run frontend:build` green
- gateway auth 수정의 검토·커밋·재빌드
- clean tracked tree에서 WSL runtime build lineage 일치
- fresh profile 기준 setup → OAuth login → start 재현
- source checkout이 없는 packaged app 검증은 별도 RELEASE 트랙으로 분리

완료 증거:

- 정확한 HEAD와 clean tree
- 전체 검사 명령과 exit code
- 같은 HEAD로 빌드된 runtime lineage
- fresh profile 실사용 smoke

### A1. Pi Codex OAuth·provider·계정 상태

현재 상태: **부분 구현**

이미 있는 것:

- Pi `ModelRuntime`
- `openai-codex` OAuth credential
- streaming·reasoning·tool projection·abort 배선
- Codex 실패 시 Cursor 자동 fallback 없음

남은 작업:

- renderer 로그인 상태를 실제 Pi OAuth 상태와 연결
- credential 없음·만료·refresh·재로그인 상태 표시
- CLI 기본 auth 경로와 WSL runtime `SAND_DATA_ROOT` 경로 통일
- provider 미설정 기본값 `cursor` 제거 또는 WSL에서 명시적 Codex-only migration
- 기존 Cursor provider profile 처리 정책 확정
- WSL 핵심 흐름에서 Cursor/Anysphere 호출 여부 검증

완료 조건:

- login/status/start가 같은 credential을 본다.
- credential이 없으면 UI도 준비 완료로 표시하지 않는다.
- 재로그인 뒤 같은 profile에서 실제 한 턴과 tool call이 복구된다.

### A2. 대화·컨텍스트·압축·캐시

현재 상태: **부분 구현·실측 부족** — 2026-09-01 실사용에서 결함 재현: transcript가 긴 에이전트(기본 Belmont)에 메시지를 보내면 compaction이 발화하지 않은 채 "Codex error: Your input exceeds the context window"로 턴이 즉사한다 (A6-1 검증 기록 참조).

남은 작업:

- `compactionEpoch` 고정값 `0` 제거 또는 실제 epoch 연결
- 모델 catalog의 context window와 실제 Codex OAuth 유효 한도 교정
- 긴 대화에서 compaction이 한도 초과 전에 실제 발화하는지 검증
- compaction 전후 transcript·tool result·attachment 보존 검증
- cache read/write token 기록의 정확성 검증
- 매 턴 전체 message projection과 provider native cache hit의 관계 측정
- explicit conversation continuity를 도입할지 현재 prefix-cache 방식으로 유지할지 결정
- restart·compact·resume E2E

완료 조건:

- 긴 대화가 실제 한도 초과 없이 계속된다.
- 압축 전후 사용자가 필요로 하는 사실·작업 상태가 보존된다.
- cache hit 수치는 실제 provider usage와 일치한다.

### A3. 영구 봇 CRUD·roster·원본 봇 간 통신

현재 상태: **CRUD는 구현, 발견·prompt 연결은 부분 구현**

이미 있는 것:

- 영구 봇 생성·수정·복제·삭제
- 봇별 UUID 디렉터리·DB·transcript·memory·attachments
- 원본 `SendToAgent` fire-and-forget 메시징

남은 작업:

- production system prompt의 빈 `agentDirectory`/`agentGroups` provider를 실제 roster에 연결
- prompt가 광고하는 `ListAgents`/`ListGroups`의 실제 제공 또는 잘못된 안내 제거
- agent 간 메시지의 전달·중단·오류·재시작 원본 semantics 검증
- 봇 생성·삭제 후 roster와 sidebar의 재시작 일관성 검증
- 영구 봇별 모델·reasoning 설정이 원본 기능인지 Belmont 확장인지 구분 후 처리

주의:

- 이 Phase에서는 `SendToAgent`를 Belmont 전용 durable job으로 바꾸지 않는다.
- 원본 fire-and-forget 기능이 정확히 작동하는지를 먼저 검증한다.

### A4. Task·임시 subagent

현재 상태: **핵심 실행 가능, lifecycle 완성도 부족**

이미 있는 것:

- child ID·runner·transcript
- foreground/background Task
- result revival
- child cancel
- 완료 후 runner dispose
- model parameter schema

남은 작업:

- child settle/checkpoint/blob/store가 부모 session closure를 공유하는 경계 수정
- child audit identity 분리
- `file_attachments`가 로컬에 없는 video-review 경로만 가리키는 문제 처리
- background throw → parent revival 검증
- steer/restart·follow-up·interrupt 검증
- 앱 재시작 시 running child의 명시적 recovery 상태
- 두 child 동시 실행·한 child만 cancel·state 교차오염 E2E
- Computer-use child와 main/general executor의 화면 조작 배타성

### A5. 장기 기억

현재 상태: **저장 구현은 있으나 production recall 연결 미완료**

남은 작업:

- system prompt assembly의 `memoryStore`, `memorySnapshots`, `userMemory`, `projectMemory`에 실제 store 연결
- 기억 저장 → 새 대화 recall → 의사결정 반영 E2E
- 기억 수정·삭제·tombstone 검증
- 앱 재시작 뒤 recall 검증
- memory synthesis/dreaming gate의 개인 WSL 기본 정책 결정
- memory flow focused tests 추가

Belmont가 모든 사용자 기억을 관리하고 worker에게 최소 정보만 전달하는 정책은 **Phase B**다. Phase A에서는 원본 기억 기능이 실제로 동작하는지만 완성한다.

### A6. Shell·파일·Web·Browser

현재 상태: **기본 기능 구현, 세부 계약·E2E 일부 부족**

남은 작업:

- Shell 호출 간 cwd/env 유지 여부를 원본 계약에 맞게 복원
- foreground/background shell timeout·cancel·hook parity
- File Read/Write/Edit/Grep/Glob/LS의 오류·경계·large output E2E
- PDF Read text extractor 연결
- WebSearch/WebFetch 오류·취소·large output 검증
- Browser click/drag validation 실제 실행 검증
- Browser auto-review 개별 live 검증
- browser unavailable 상태를 UI·prompt에서 정직하게 표시

현재 코드가 있어 “미구현”으로 부르면 안 되는 항목:

- image MIME Read와 Pi image result projection
- WebSearch 429/5xx 일시 오류 안내
- tool execution timeout
- Browser `sourceRef`, `x`, `y` 필수 schema

이 항목들은 **production E2E 미검증**으로 분류한다.

#### A6-1. Aside 검토 채택 항목 (2026-09-01 사용자 결정)

Aside 분석에서 브라우저 도구에 가져오기로 결정된 다섯 가지. 우선순위 순서와 처리 상태:

1. **자격증명 격리 최소 규칙** — 구현됨 (driver v3). `browser_type`/`browser_fill`이 비밀번호·OTP·카드번호 필드를 무조건 거부한다. `confirmed`로도 우회 불가. 비밀은 사용자가 브라우저 창에서 직접 입력한다.
2. **요소 신원 복구** — 구현됨 (driver v3). snapshot이 ref마다 role/name/순번 지문을 상태 파일에 저장하고, ref가 낡으면(페이지 이동으로 ref 지도가 사라졌거나 framework 재렌더로 요소가 교체된 경우) 같은 걷기 순서로 지문 재탐색 후 실행한다. 복구 사용 시 summary에 표기된다.
3. **민감 조작만 승인 대기** — 구현됨 (driver v5 + **진짜 승인 카드**). 결제·송금·구매와 로그인/가입 제출로 판정된 클릭·Enter만 잡고, 일반 클릭은 그대로 통과한다. 이력:
   - 무장(arm) 계약 (driver v4): 첫 실사용에서 모델이 첫 시도부터 `confirmed: true`를 자가 승인하는 것이 전사로 확인되어, `confirmed`를 "드라이버가 같은 view·같은 사유로 직접 차단한 이력(10분 유효, 1회 소모)" 있을 때만 유효하게 바꿨다.
   - **승인 카드 (2026-09-01, A8의 브라우저 표면 완성)**: 드라이버가 민감 차단을 반환하면 호스트 래퍼가 세션의 `SandAutoReviewController.requestApproval`로 **실제 auto-review 승인 카드**를 채팅에 띄우고, 사용자의 Allow가 같은 액션을 호스트 소유 `hostApproved` 플래그(모델 인자 spread 뒤에 강제 덮어씀 — 모델 주입 불가)로 재실행한다. 카드 채널이 있으면 모델의 `confirmed`/`hostApproved` 인자는 실행 전에 **제거**된다: 모델의 어떤 문구도 승인을 만들 수 없고, 사용자의 카드 결정만 가능하다. Deny/만료는 그대로 최종 답이 된다. 비밀번호·카드 필드 거부는 카드로도 우회 불가(절대 거부).
   - 배선 발견: 실제 앱의 브라우저 도구는 projection이 아니라 turn-agent-composition의 **폴백 경로**(`createLocalBrowserDriverDependencies`)로 만들어진다(기존 주석대로 projection 슬롯 미바인딩). 컨트롤러는 composition에만 있으므로 `registerLocalBrowserApprovalGate`(agent id 키, 재바인딩 시 최신 runner 우선)로 다리를 놓았다. 카드 채널이 없는 runner(등록 전 subagent 등)는 무장 계약이 폴백으로 남는다.
4. **system prompt 다이어트** — 구현됨. `buildSandBaseSystemPrompt`에 `localCodexMode`를 추가해 로컬 빌드에서 죽은 광고를 제거: Cursor Origin 절, Cursor 계정 마켓플레이스 플러그인 절(로컬 MCP 설정 안내로 대체), SearchPlugins 우선 의무 경로, "team's admin이 비활성화" 거짓 서사(개인 로컬 현실로 대체 — 저장소 작업은 이 컴퓨터에서 직접). 52,084 → 49,504자 (약 645토큰 감소 + 잘못된 안내로 인한 오동작 위험 제거). 컨테이너 프롬프트 2종은 전부 유지 (`tests/system-prompt-diet.test.mjs`가 고정).
5. **snapshot 고신호화 (Snapshot V2)** — **2단계까지 구현됨 (driver v5)**. 기본 엔진은 driver-side **접근성 병합**: CDP `Accessibility.getFullAXTree`(프레임별, shadow DOM은 AX 트리에 원래 포함)가 브라우저의 정식 role/name/상태를 주고, `DOMSnapshot.captureSnapshot` 한 번으로 tag·속성·입력값을 backendNodeId로 병합하며, 같은 프로세스 iframe은 AX iframe 노드→`DOM.describeNode`의 frameId로 제자리에 이어 붙인다(교차 출처는 정직 표기). ref는 `DOM.resolveNode`+`Runtime.callFunctionOn`으로 **각 요소가 속한 프레임의 main world**에 등록되고, `refHandle`이 프레임을 횡단 검색하므로 iframe 내부 클릭도 네이티브 프레임 핸들로 정확히 명중한다(1단계의 좌표 보정 경로는 DOM 엔진 폴백용으로 유지). 지문 복구는 엔진 표기(`engine: "ax"|"dom"`)를 따라 같은 엔진으로 재열거하고, 실패 시 DOM 걷기로 강등한다. CSS `selector` 지정 시와 AX 캡처 실패 시엔 1단계 in-page DOM 걷기(shadow/iframe 수집·aria-labelledby·상태 신호 포함)가 그대로 폴백이다 — 도구가 1단계 아래로 퇴행할 일이 없다.

검증:

- `tests/browser-driver-guards.test.mjs` — 실제 드라이버 OPS·페이지 내 함수·AX 파이프라인(대본화된 CDP 세션)을 폐루프 실행, 10/10 통과 (V2 걷기·AX 병합·프레임 스티칭·값 가림·상태 신호·무장 계약·엔진별 복구).
- `tests/browser-approval-gate.test.mjs` — A8 카드 래퍼 3/3: 승인 시 같은 액션의 hostApproved 재실행(모델 confirmed/hostApproved 제거·강제 덮어씀 확인), 거부는 최종 답, 일반 오류는 카드를 안 띄움, 게이트 없으면 무장 계약 유지.
- 라이브 드라이버 E2E (2026-09-01) — 실제 Chrome(headless, CDP)에 driver-v5.mjs를 그대로 실행, 28개 단계 전부 통과: **접근성 병합 엔진 활성 확인(heading level 등 AX 신호 포함)**, 관문 차단/무장/confirmed 재시도/자가승인 무시, 비밀번호·OTP·카드 필드 거부, Enter 차단, 재렌더·페이지 이동 후 지문 복구, shadow DOM·같은 출처 iframe 수집과 실클릭, 교차 출처 iframe 정직 표기.
- **실제 앱 UI 경유 E2E ×2 (2026-09-01)** — 재빌드한 WSL 런타임(`SAND_LOCAL_BROWSER_USE=1`)을 production 경로 그대로 기동, Electron renderer를 CDP로 조작해 실제 compose 흐름으로 새 에이전트를 만들고 실제 Pi Codex 턴을 보냄.
  - GuardProbe2 (무장 계약, driver v4): ① navigate→snapshot→일반 클릭(`OK`) ② 결제 클릭 차단 → 모델이 보고 후 턴 종료 ③ 사용자 승인 후 confirmed 재시도(`PAID`) ④ 비밀번호 거부. 전부 통과.
  - **GuardProbe4 (승인 카드 + AX 엔진, driver v5)**: ① 일반 클릭(`OK`) + production 상태 파일에 `engine:"ax"` 실기록 ② 결제 클릭 → **실제 승인 카드**가 채팅에 뜸 → "Allow once" 클릭 → 같은 턴에서 클릭 실행(`PAID`) ③ 로그인 클릭 → 카드 "Deny" → 거부 사유가 모델에 전달·보고 ④ 비밀번호 거부(카드 없음, 절대 거부). 전사 확인: 모델은 confirmed 없이 평범한 클릭만 보냈고 차단 문구를 한 번도 보지 못했다 — 승인 권한이 모델에서 사용자 카드로 완전히 이동.
- 실측 부산물: (a) 무장 도입 전 모델의 `confirmed:true` 자가 승인(전사 증거) — 카드 도입의 직접 근거. (b) **A2 실증 결함**: 긴 transcript 에이전트에서 "Codex error: Your input exceeds the context window"로 턴 즉사 — compaction 미발화의 실사용 재현. (c) 브라우저 도구의 projection 슬롯 미바인딩(폴백 경로가 실경로) — A6/A12 배선 정리 시 참고.

### A7. MCP·플러그인

현재 상태: **local stdio MCP 기본 동작, 원본 plugin UX와 통합 미완료**

남은 작업:

- local MCP server별 cwd 지원
- `tools/list` pagination과 `list_changed`
- server-initiated message 처리 범위
- cancel·timeout·restart E2E
- image/audio/blob result fidelity
- child MCP identity·audit 분리
- large MCP result spill 실제 파일 생성·읽기 검증
- plugin search/install/auth/delete가 Cursor backend 전용인 경로를 로컬 구현 또는 숨김
- local MCP 추가·수정·삭제를 사용자가 할 수 있는 설정 UX
- MCP auto-review 개별 live 검증

### A8. Hooks

현재 상태: **부분 구현**

남은 작업:

- `beforeSubmitPrompt` 실제 발화와 `continue:false` 중단 처리
- `workspaceOpen` 발화와 `pluginPaths` 실제 로드
- `preToolUse`의 `ask` 구현 또는 명시적 미지원 처리 — 단, 이 항목이 A6-1에 지고 있던 빚(브라우저 민감 조작의 사용자 승인)은 2026-09-01에 hooks가 아니라 auto-review 승인 카드 경로로 갚았다(A6-1 항목 3). 남은 것은 hooks.json 일반 도구용 `ask`뿐이다.
- WebFetch·MCP hook 적용
- postToolUse/postToolUseFailure additional context E2E
- hook timeout·cancel·restart·잘못된 응답 검증

### A9. Routine·automation

현재 상태: **편집·수동 실행 일부 존재, 로컬 예약 실행 미완료**

남은 작업:

- WSL 로컬 cron scheduler 또는 명시적 대체 구현
- 앱 재시작 후 예약 복구
- routine enable/disable/delete와 실제 fire 연결
- 외부 서비스 trigger는 연결 가능한 것만 활성화하고 나머지는 숨김
- 빈 이름 `aria-invalid`/`required` UI 수정
- 저장 실패·expired 상태의 사용자 메시지 검증

### A10. 첨부·미디어

현재 상태: **이미지·일반 첨부는 동작, 일부 미디어 기능 미완료**

남은 작업:

- 전송 성공 후 staging 파일 즉시 정리
- retry가 필요하면 lease/journal로 lifecycle 명시
- PDF text extraction
- video 분석을 구현하거나 UI·prompt에서 제거
- 이미지 생성·AI 아바타의 Cursor token 의존을 로컬 대체하거나 숨김
- image Read → Pi vision → 응답 E2E
- 대용량·손상·지원하지 않는 파일의 오류 흐름 검증

### A11. Computer·VNC

현재 상태: **기본 Computer는 구현, 운영 lifecycle과 세부 UI 미완료**

이미 실측된 것:

- screenshot
- click
- type
- key
- computerUse subagent dispatch
- 기본 VNC viewer

남은 작업:

- `source:typecheck` 오류 수정
- VNC bind를 loopback으로 제한
- x11vnc/websockify readiness 확인 뒤 URL 제공
- start 실패 시 usable하지 않은 URL을 반환하지 않기
- Xvfb·window manager·VNC child의 host shutdown cleanup 연결
- stale display/process 재사용 정책
- main/general/computerUse 동시 조작 배타성
- clipboard·key routing·zoom 개별 E2E
- scroll·drag·wait·cursorPosition 개별 E2E
- 다중 window를 구현하거나 `maxWindows=1`로 명시적 제한

### A12. Renderer·UI parity

현재 상태: **checksum-pinned renderer와 editable frontend가 혼재**

남은 작업:

- production host의 attachment `kinds[]`와 editable frontend parser 계약 통일
- pinned renderer에서 고친 기능을 editable reconstruction에도 반영
- routine validation·expired card 문구 수정
- 원본에 있지만 WSL에서 제외한 메뉴·설정·tool 광고 숨김
- model picker를 복원할지 Codex-only 고정 상태를 명확히 표시할지 결정
- 오류·empty·loading·recovery 상태를 실제 fixture로 검증

### A13. 재시작·복구

현재 상태: **완료된 bot/transcript는 복구되지만 in-flight 기능은 부분적**

남은 작업:

- chat send 중 종료
- attachment commit 중 종료
- Shell/Browser/MCP/Computer 실행 중 종료
- background Task 실행 중 종료
- routine fire 직전·직후 종료
- compaction 중 종료
- OAuth refresh 중 종료
- 중복 실행·유실·orphan 상태 검증

Phase A에서는 원본 기능의 복구 의미를 맞춘다. durable manager job의 exactly-once/fencing은 Phase B다.

## 4. 구현됐지만 아직 합격시키면 안 되는 항목

다음은 코드가 존재하므로 `MISSING`으로 부르지 않는다. 하지만 현재 근거만으로 `VERIFIED`도 아니다.

- image MIME Read
- MCP large-result spill
- Browser argument validation
- generic tool timeout
- WebSearch 429/5xx 안내
- multitask coordinator reminder
- Task model parameter validation
- auto-review의 Browser/MCP/subagent surface
- subagent steer/restart
- VNC clipboard/key/zoom
- routine 오류·복구 상태

판정은 `CODE_PRESENT / RUNTIME_VERIFICATION_REQUIRED`로 유지한다.

## 5. Phase A에서 제외하거나 숨길 기능

다음은 개인 WSL parity의 필수 구현으로 잡지 않는다.

- cross-user sharing과 shared room
- 조직용 channel·member·team 관리
- SSO·WebAuthn 팀 정책
- Cursor Cloud Agent와 cloud review
- Cursor marketplace/plugin backend
- remote box update/reset/teach UI
- macOS dock·notarization·auto-update
- Windows installer
- Slack/GitHub/Google 등 미연결 외부 trigger의 실제 이벤트
- 기업용 secret vault·RBAC·audit console

처리 원칙:

1. 로컬 대체가 있으면 `WSL_EQUIVALENT`로 연결한다.
2. 연결하지 않으면 UI·system prompt·tool catalogue에서 숨긴다.
3. 오류 없이 보이지만 눌러도 실패하는 상태로 남기지 않는다.

## 6. 테스트 문서와 원장 정리 기준

`belmont-full-test-report.md`의 숫자는 현재 그대로 완료율로 사용할 수 없다.

2026-08-30 22:57 KST `/tmp/sweep-verdicts.jsonl` 재계산:

- physical rows: 2,112
- unique cases: 1,292
- 중복·재판정 rows: 820
- latest-per-case: PASS 501 · ISSUE 18 · PARTIAL 2 · UNAVAIL 628 · ENV 86 · UI_ONLY 13 · UNCLEAR 41 · FIXED 2 · EXPECTED 1

문서에는 2,075행과 UNCLEAR 8이 적혀 있다. UNCLEAR 8은 USER route만 센 값이고 AGENT route 미확정이 빠져 있다.

정리해야 할 사항:

- `/tmp` 판정 원장을 repo 내부 durable JSONL로 이동
- case ID별 append-only history 유지
- 요약은 최신 판정 한 건만 집계
- `executed`, `code-inspected`, `inherited`, `excluded`, `fixture-blocked`를 별도 필드로 분리
- `PASS`에는 실제 production effect 증거 필수
- 원본 기능 1,292개마다 `EXACT_RESTORATION / WSL_EQUIVALENT / EXCLUDED_AND_HIDDEN` disposition 추가
- 이전 build의 PASS는 새 HEAD에서 자동 승격하지 않음
- active live run이 끝난 뒤 한 번만 canonical snapshot 생성

## 7. Phase A 실행 순서

### Gate A0 — 기준선 정상화

- 동시 세션 종료·변경 소유권 정리
- gateway auth 변경 검토·커밋
- TypeScript 오류 4건 수정
- `npm run check`·`npm run frontend:build` green
- clean HEAD runtime 재빌드

### Gate A1 — 인증·대화 엔진

- Pi OAuth/UI/provider 진실원 통합
- context window·compaction·cache 검증
- 기본 chat·stream·cancel·restart E2E

### Gate A2 — 봇·Task·기억

- roster prompt 연결
- persistent bot CRUD/restart
- Task child ownership·cancel·revival
- memory save/recall/correct/restart

### Gate A3 — 도구 기능

- Shell·File·Web·Browser
- MCP·plugin
- Hooks
- PDF·image·video disposition
- routine scheduler

### Gate A4 — Computer·UI

- Computer/VNC lifecycle
- pinned renderer와 editable frontend 계약
- 오류·empty·loading·recovery UI
- excluded feature 숨김

### Gate A5 — 전체 실사용 검증

- fresh WSL profile
- 실제 Pi OAuth
- 실제 UI 입력·클릭·첨부·도구 실행
- 기능별 오류·취소·재시작
- 1,292 case 최신 판정과 durable evidence
- 미실행 0을 목표로 하되 구조적 제외는 근거와 함께 `EXCLUDED_AND_HIDDEN`

## 8. Phase A 완료 조건

다음이 모두 충족돼야 “Grok Bot WSL 기능 완성”이라고 부른다.

1. `npm run check`와 `npm run frontend:build`가 clean HEAD에서 통과한다.
2. fresh profile에서 setup → OAuth login → start가 문서 그대로 동작한다.
3. 개인 사용자 기능마다 구현·대체·제외 중 하나가 확정돼 있다.
4. UI와 system prompt가 사용할 수 없는 기능을 광고하지 않는다.
5. 코드가 있는 기능은 production 경로의 실제 effect까지 검증한다.
6. 주요 기능의 취소·오류·재시작 계약을 검증한다.
7. 테스트 원장에 중복 집계와 self-report PASS가 없다.
8. 기존 bot·transcript·memory·attachments를 손상하지 않는다.
9. 남은 `UNCLEAR`, 원인 불명 `ENV`, 설명 없는 `UNAVAIL`이 없다.

## 9. Phase B — 이후에 추가할 Belmont 관리자 확장

Phase A 완료 전에는 다음을 핵심 구현 우선순위로 올리지 않는다.

- `managerAgentId`
- Belmont-only user routing
- worker 직접 대화·직접 최종보고 차단
- SQLite goal/job/result/review store
- typed `DelegateJob`
- worker `ReturnJobResult`
- progress·attempt·timeout·cancel·retry·reassign
- result evidence manifest
- Belmont review tools
- approved-only publication gate
- durable queue·lease·idempotency·fencing
- restart reconciliation과 late-result 거부
- Belmont-owned user memory와 worker 최소정보 projection
- persistent worker별 capability·model·tool·MCP profile

Phase B의 북극성은 유지한다.

> 사용자는 Belmont에게만 목표를 말하고, Belmont가 작업을 직접 처리하거나 worker에게 위임하고, 결과와 증거를 검토한 뒤 승인된 내용만 사용자에게 보고한다.

다만 이 기능은 **원본 Grok Bot parity 완료 후** 별도 설계·구현·E2E로 진행한다.

## 10. 최종 우선순위

```text
지금:
원본 Grok Bot 기능 inventory
→ WSL exact/equivalent/hidden disposition
→ 미완료 구현
→ 실제 사용자 E2E
→ clean parity baseline

그다음:
Belmont 관리자 지정
→ durable delegation
→ result/review/retry
→ approved-only publication
```

이 순서를 뒤집지 않는다.

