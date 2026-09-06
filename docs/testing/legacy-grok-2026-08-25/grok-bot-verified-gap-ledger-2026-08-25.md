# Grok Bot 검증 누락 원장 — 가확정 추출 기준선

- 상태: `PROVISIONAL_BASELINE`
- 기준선 커밋: `0cc05f9`
- 실행 판정 기준: [grok-bot-user-test-standard-2026-08-25.md](grok-bot-user-test-standard-2026-08-25.md)
- 원장: [안정 ID 기준선](audit/grok-feature-registry.jsonl) · [현재 materialized 원장](audit/grok-feature-registry-active.jsonl) · [append-only 보정](audit/grok-feature-registry-updates.jsonl)
- 주의: 이 문서는 테스트 대상 후보 원장이다. 실사용 `PASS`나 제품 전체 검증 완료를 뜻하지 않는다.
- 2026-08-25 · 울트라코드 4단계(독립추출→100%파일정독→적대검증/중복제거→도달경로분류/재분해)
- 재현 근거: `audit/audit-method.md`, `audit/verdict-ledger.csv`, `audit/audited-files.sha256`
- 전 소스 1,763파일 100% 정독 · 후보 2,475 → 적대검증 → **검증 누락 1325행**
- 복합행동 재분해 완료: 1325행 → **원자 행동 1500개** (+175)

## 2026-08-25 실사용 실행 업데이트

- 실행 ID: `run-20260825-142437-kst`
- 증거 경로: `artifacts/grok-bot-user-e2e-20260825/run-20260825-142437-kst/`
- `UJ-01`: 직접 계산 요청은 화면상 성공했으나 런타임 로드 커밋과 network trace가 불완전해 `PROVISIONAL`.
- `UJ-02`: `FAIL`. 실제 Codex Local 세션이 저장소 읽기·쓰기 도구가 없다고 응답했고 요청한 보고서 파일도 생성되지 않았다.
- Plugins 화면: `Cursor access tokens are unavailable in local Codex mode` 오류를 직접 관찰했다. native 도구 부재와는 별도 결함이며, account-backed MCP 가용성에 미친 영향은 `unverified`다.
- 영향: `GB-CORE-001` P1을 열고 UJ-03·UJ-04 반복 실행을 중단했다. 소스에 기능 후보가 존재한다는 사실은 현재 런타임 가용성을 증명하지 않는다.
- read-only 원인 분석: 실제 프로필은 `mcpBoxServers=[]`다. 현재 HEAD의 비-Cursor `sendPrompt`는 별도 inference-router fast path를 타며, 보장된 native 도구는 `ListAgents`·`CreateAgent`·`UpdateAgent`·`SendToAgent` 4개다. full host의 Read·Shell·Task/Multitask·State·subagent 경로는 native fast path에 합성되지 않는다. live routed MCP 총목록은 미캡처다.
- 검증 경계: router focused test 2개는 2/2 통과했지만 full-host parity나 UJ-02 성공을 검증하지 않는다. 실행 중 PID의 로드 커밋은 계속 `UNKNOWN`이므로 observed-runtime 실패와 current-source 구조 판정을 섞지 않는다.
- Plugins 오류 재분류: local Codex auth와 Cursor-backed effective-plugin IPC 사이의 별도 통합 결함이다. Plugins 화면 실패는 확인됐지만 이것을 native 도구 부재의 직접 원인으로 쓰지 않는다.
- 상세 증거: `artifacts/grok-bot-user-e2e-20260825/run-20260825-142437-kst/outputs/gb-core-001-root-cause.txt`.
- 독립 반박 검증: `PARTIAL`. Codex UI 요청이 gateway/full host 전에 router에 소비되는 점, native 4도구, full-host lifecycle 우회, Plugins 별도 결함, focused-test 한계는 확인됐다. `mcpBoxServers=[]`로 account-backed 실효 MCP 도구까지 0개라고 단정하는 것은 기각됐다.

## 도달경로별 분포 (문제6 확정 — 단일 커버율 폐기)

| 도달경로 | 행 | 원자 | 비중 | 뜻 |
| --- | ---: | ---: | ---: | --- |
| USER_REACHABLE (사용자 직접) | 794 | 932 | 60% | |
| AGENT_REACHABLE (모델(에이전트)) | 405 | 441 | 31% | |
| GATED (게이트(플래그/권한/기업)) | 45 | 46 | 3% | |
| NOT_APPLICABLE (해당없음) | 9 | 9 | 1% | |
| INTERNAL_ONLY (내부) | 72 | 72 | 5% | |
| **합계** | **1325** | **1500** | 100% | |

- 원장 344의 도달경로는 아직 확정되지 않았다. 따라서 사용자 대면 누락 원자 932개와 단순 합산한 26~27% 수치는 실사용 커버리지로 사용하지 않는다.
- 모델(에이전트) 경로 누락 원자 441개는 원장이 거의 안 담음 → 이쪽 커버율 매우 낮음.
- ⚠️ 도달경로는 배치 에이전트가 소스 확인해 라벨 확정(휴리스틱 아님). 단 재구성 저장소 한계로 일부 GATED/N/A 경계는 근사.


# [USER_REACHABLE] 사용자 직접  — 794행 / 932원자


## Transcript  (57행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 메시지에 답글 스레드가 있으면 'View thread, N replies' 어포던스가 표시된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/thread-affordance.tsx` |
| high | 어시스턴트 텍스트에 인라인/디스플레이 수식이 있으면 KaTeX로 렌더된 수식이 표시된다(로딩 중엔 코드 텍스트로 대체) | `frontend/src/recovered/features/conversation/workspace/math.tsx` |
| high | 사용자 메시지 전송이 실패하면 'Failed to send'와 Resend, Delete 버튼이 표시된다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | 어시스턴트가 펜스 코드 블록을 보내면 구문 클래스가 붙은 코드 figure와 Copy code 버튼이 렌더된다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | 어시스턴트가 mermaid 코드 블록을 보내면 렌더된 Mermaid 다이어그램 figure가 표시된다(실패 시 코드로 대체) | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | 도구 호출 행을 클릭하면 요약과 도구 결과 카드로 펼쳐지고 다시 클릭하면 접힌다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | 실패한 메시지의 Resend를 클릭하면 해당 항목에 대해 onResendFailedSend가 발생한다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | 코드 블록의 Copy code 버튼을 클릭하면 코드가 클립보드에 복사되고 버튼이 약 1.2초간 'Copied'를 표시한다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | More 메시지 작업 메뉴를 열고 Start a thread를 클릭하면 해당 메시지에 대해 onStartThread가 발생한다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | 마크다운이 포함된 어시스턴트 메시지를 받으면 제목·목록·표·인용·수평선·문단이 렌더된다 | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| high | Show the spend-guard nudge widget with Keep/Pause/Never-ask when the user is idle with unread routine results | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | View a retired permission-request entry rendered read-only with its permission title | `frontend/src/recovered/features/conversation/cards/permission-request/view.tsx` |
| medium | See a red katex-error span with the raw expression and title when KaTeX fails to render | `frontend/src/recovered/features/conversation/workspace/math.tsx` |
| medium | Hover or focus a reply quote to see a referenced-message preview tooltip with author, time and quoted content | `frontend/src/recovered/features/conversation/workspace/referenced-message-preview.tsx` |
| medium | Click a reply quote whose target is in scope to jump to the replied message | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx` |
| medium | Click a reply quote whose target is out of scope to open the reply thread | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx` |
| medium | See a reply-quote preview button showing the referenced message label on a reply message | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See a 'Waiting to send…' status with a Cancel button when a message is queued and transport is up | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See a 'Will send when reconnected' status when a message is queued while transport is down | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See a 'Sent while offline · {date}' notice with a formatted timestamp on a message composed offline | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See a channel tag chip with a 'Sent to {channel}' title on an assistant message | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See an 'Agent attachments' image strip below the text when an assistant message includes images | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See a checked/unchecked checkbox before a task-list item in assistant text | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Open an http(s) link from assistant text in a new tab with rel=noopener (non-http URLs render as plain text) | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Click a Thinking row to expand or collapse its text | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Click Cancel on a queued send to fire onCancelQueuedSend for that entry | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Click Delete on a failed message to fire onDeleteFailedSend for that entry | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Open the message More menu | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Click Copy in the More menu to copy the message text (present only when onCopy provided) | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See an unread divider showing 'N new message(s)' when there are unread messages | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See a spinning loading icon (pending) or x-circle icon (failed) on a tool-call row | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | See copy/reply/thread actions suppressed on a read-only, failed, pending, or queued message | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| medium | Clone a group agent (fails: groups can't be duplicated yet) | `source/host/extensions/transcript/agent-lifecycle.ts` |
| medium | Delete the last remaining agent to clear the transcript | `source/host/extensions/transcript/agent-lifecycle.ts` |
| medium | Observe the INTRODUCTION_FAILED tray error when a kickstart/onboarding turn fails | `source/host/extensions/transcript/agent-lifecycle.ts` |
| medium | Answer the paused widget with 'Resume routines' to re-enable guard-paused routines | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | Answer the paused widget with 'Keep them paused' to leave them paused | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | Answer the spend-guard nudge 'Keep them running' to snooze the guard 30d | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | Answer the spend-guard nudge 'Don't ask again' to opt out permanently | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | Answer the spend-guard nudge 'Pause them all' to disable all enabled routines | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | Stay away past the pause delay after a nudge so all routines auto-pause and the tray/widget appear | `source/host/extensions/transcript/automation-spend-guard-runtime.ts` |
| medium | Observe the 'Message not delivered' tray and delivery-failure follow-up when channel delivery fails | `source/host/extensions/transcript/background-wakes.ts` |
| medium | Observe the 'Group chat failed' tray error when a group turn errors | `source/host/extensions/transcript/group-chat-glue.ts` |
| medium | Create a group whose member set duplicates an existing group (switches to the existing one) | `source/host/extensions/transcript/group-chat-glue.ts` |
| medium | Create a group with no existing members (throws: needs at least one existing member agent) | `source/host/extensions/transcript/group-chat-glue.ts` |
| medium | Show the agent's currentActivity label in the roster when a named activity update arrives | `source/host/extensions/transcript/run-lifecycle.ts` |
| medium | Observe the 'Agent failed to resume after host update' tray when a resume-after-host-update turn fails | `source/host/extensions/transcript/upgrade-recreate-resume.ts` |
| medium | Add a reaction to an agent's message to resume it with a hidden 'user reacted …' note | `source/host/extensions/transcript/widget-responses.ts` |
| low | View a notice transcript entry rendered as a notice card with text and timestamp | `frontend/src/recovered/features/conversation/cards/notice/view.tsx` |
| low | Observe no thread affordance rendered when the thread summary has a zero/invalid count | `frontend/src/recovered/features/conversation/cards/transcript-card/thread-affordance.tsx` |
| low | View a reply whose target was deleted/unavailable and see '(deleted)' quote / '(unavailable)' preview | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx` |
| low | Expand a tool-call with no summary and see 'No additional details.' | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| low | Pointer-down outside an open message actions menu to close it without restoring focus | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| low | Press Escape with the message actions menu open to close it and return focus to the trigger | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| low | Right-click over a link/image/input or an active selection so the native context menu shows and the actions menu does not open | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| low | View a time boundary between message groups and see the labeled time-separator divider | `frontend/src/recovered/features/conversation/workspace/transcript.tsx` |
| low | A new box-request card appended while a prior one is open auto-resolves the prior one as 'dismissed' | `source/host/extensions/transcript/box-request-entries.ts` |
| low | The isComposingMessage badge shows while the agent's send tool call is pending | `source/host/extensions/transcript/run-lifecycle.ts` |
| low | The isRetrying badge shows while the runner reports 'retrying' until output resumes | `source/host/extensions/transcript/run-lifecycle.ts` |
| low | A tool call going pending then failing shows an outline status item and reports a tool-call error diagnostic once | `source/host/extensions/transcript/turn-runtime.ts` |

## 정보-아바타  (21행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Generate 탭에서 설명을 입력하고 Generate를 눌러 아바타를 생성한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 25MB를 초과하는 이미지를 넣어 크기 초과 에러를 확인한다 | `frontend/src/recovered/features/agent-info/avatar-editor/model.ts` |
| medium | 손상되어 로드 불가한 이미지를 넣어 로드 실패 에러를 확인한다 | `frontend/src/recovered/features/agent-info/avatar-editor/model.ts` |
| medium | Bot 탭에서 모양 버튼을 눌러 캐릭터 모양을 스테이징한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | Bot 탭에서 색상 버튼을 눌러 캐릭터 색을 스테이징한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | Bot 탭에서 커스텀 캐릭터가 있을 때 Reset을 눌러 기본값으로 되돌린다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | Upload 드롭존에 이미지를 드래그·드롭해 크롭 스테이지로 넘어간다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | Upload 탭에서 'Browse files'를 눌러 파일 선택 대화상자를 연다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 기존 아바타가 있을 때 Reset을 눌러 아바타를 지우거나 스테이징 캐릭터를 커밋한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 아바타 처리 중 오류가 나면 aria-live 에러 메시지를 확인한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 아바타 편집기를 열어(비그룹) Bot/Generate/Upload 탭을 확인한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 줌 슬라이더를 조절해 이미지를 1~5배 확대/축소한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 크롭 스테이지에서 드래그해 이미지 위치(pan)를 이동한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| medium | 편집기에 이미지를 붙여넣기해 Upload 모드로 전환한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | Cancel 버튼을 누르면 편집기가 닫힌다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | Generate 텍스트영역에서 Cmd/Ctrl+Enter를 누르면 생성이 시작된다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | Zoom in 버튼을 누르면 줌이 0.5 단위로 증가한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | Zoom out 버튼을 누르면 줌이 0.5 단위로 감소한다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | 생성 진행 중이면 입력이 readOnly가 되고 상태 스피너와 'Generating…' 버튼이 표시된다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | 저장 진행 중이면 버튼이 'Saving…'로 바뀌고 컨트롤들이 비활성화된다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | 편집기 바깥(트리거 제외)을 누르면 편집기가 닫힌다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | 편집기에서 Escape를 누르면 편집기가 닫힌다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |

## 온보딩  (21행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | hand-off 단계에서 컴퓨터 준비 상태에 따라 'Setting up…'/'Waking your computer…'/'Getting your team ready…' 문구가 표시된다 | `frontend/src/recovered/features/onboarding/signed-in/model.ts` |
| medium | 에이전트 생성이 전송 실패하면 'Can't reach your computer right now…' 메시지와 'Try again' 버튼이 표시된다 | `frontend/src/recovered/features/onboarding/signed-in/model.ts` |
| medium | 'Meet Grok Bot' 단계에서 Next(또는 Send)를 누르면 computer-demo 단계로 진행된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | computer-demo 단계에서 Back을 누르면 meet 단계로 돌아간다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | computer-demo 단계에서 Next를 누르면 jobs 단계로 진행된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | create 단계에서 모양 라디오를 선택하면 draft 모양이 바뀌고 아바타 미리보기가 갱신된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | create 단계에서 색상 라디오를 선택하면 draft 색상이 바뀌고 아바타 미리보기가 갱신된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | create 단계에서 이름을 입력하면 draft 이름이 갱신되고 pickedTemplateId가 초기화된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | create 단계에서 이름이 비어 있으면 'Get started' 버튼이 비활성화된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | create 단계에서 추천 카드를 누르면 draft에 추천 이름·설명·색·모양·templateId가 채워진다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | hand-off 실패 후 'Try again'을 누르면 create()가 재실행된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | tools 단계에서 검색창에 입력하면 일치하는 도구만 필터링되어 표시된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| medium | tools 단계에서 도구 타일을 누르면 해당 도구가 선택 토글되고 체크가 나타난다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | 선택한 도구에 맞는 추천이 우선 배치되어 최대 10개까지 채워진다 | `frontend/src/recovered/features/onboarding/signed-in/suggestions.ts` |
| low | computer-demo 단계에 진입하면 커서가 창 타일을 누르는 데모 애니메이션이 재생된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | create 단계에서 아바타 착지 전환이 끝나면 미리보기 아바타가 나타난다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | jobs 단계에 진입하면 작업 말풍선이 나타나고 캐릭터가 배치된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | Meet 단계에 진입하면 환영 문구가 타이핑 애니메이션으로 표시되고 커서가 깜빡인다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | prefers-reduced-motion이 켜져 있으면 장면 비트가 즉시 최종값이 되고 전환 시간이 0이 된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | tools 단계에서 검색 결과가 없으면 'No tools match "쿼리"' 문구가 표시된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |
| low | 추천 레일을 마우스 휠로 스크롤하면 세로 델타가 가로 스크롤로 변환되고 가장자리 마스크가 갱신된다 | `frontend/src/recovered/features/onboarding/signed-in/view.tsx` |

## Settings/general  (16행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 설정에서 'Sign In with Cursor'를 클릭하면 Cursor 로그인 흐름이 시작된다 | `frontend/src/recovered/features/settings/overlay/desktop.ts` |
| high | 계정이 로그아웃 상태이면 카드에 'Not signed in'과 'Sign In with Cursor' 버튼이 표시된다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| high | 보안 키 지원(darwin/win32)에서 토글 스위치를 켜/끄면 하드웨어 보안 키 사용이 활성/비활성된다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| medium | 자동 리뷰 규칙을 1000자 넘게 입력하면 초안이 1000자로 절단된다 | `frontend/src/recovered/features/settings/overlay/auto-review.tsx` |
| medium | 로그인 중 'Cancel'을 클릭하면 진행 중 로그인이 취소된다 | `frontend/src/recovered/features/settings/overlay/desktop.ts` |
| medium | 같은 목록에 기존 텍스트와 중복되는 규칙을 추가하면 규칙이 추가되지 않는다(saveInstruction이 null 반환) | `frontend/src/recovered/features/settings/overlay/model.ts` |
| medium | 계정 오류가 있으면 계정 카드 아래에 오류 메시지가 렌더된다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| medium | 계정 상태가 logging-in이면 카드에 'Signing in / Finish from browser'와 Cancel 버튼이 표시된다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| medium | 로그인 상태에서 Copy email address를 클릭하면 이메일이 클립보드에 복사되고 아이콘이 체크로 바뀐다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| low | Observe the rules editor hidden when auto-review is disabled | `frontend/src/recovered/features/settings/overlay/auto-review.tsx` |
| low | Observe the add-draft input and Add controls disabled while editing a rule | `frontend/src/recovered/features/settings/overlay/auto-review.tsx` |
| low | Observe the account action button disabled while the account action is pending | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| low | Wait 2s after copying email and see the copy icon revert from check to copy | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| low | Observe the copy icon staying as copy (no check) when the clipboard write fails on copy email | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| low | Observe the security-key switch disabled while the security-key change is pending | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| low | Observe the theme select disabled until an in-flight theme change settles | `frontend/src/recovered/features/settings/overlay/panels.tsx` |

## 정보-공유룸  (14행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | sharing 이벤트 수신 시 공유룸 상태(멤버·요청)가 즉시 갱신된 것을 확인한다 | `frontend/src/recovered/features/agent-info/shared-room/controller.ts` |
| medium | transport down 시 공유 상태와 임시 초대/보류 상태가 초기화된 것을 확인한다 | `frontend/src/recovered/features/agent-info/shared-room/controller.ts` |
| medium | 대기 중인 참가 요청이 있을 때 트리거 배지와 'n pending join requests' 라벨을 확인한다 | `frontend/src/recovered/features/agent-info/shared-room/trigger.tsx` |
| medium | People에서 다른 사람의 Remove를 눌러 공유룸에서 제거한다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 공유가 비활성이거나 roomId가 없으면 공유룸 헤더 트리거가 표시되지 않는다 | `frontend/src/recovered/features/agent-info/shared-room/trigger.tsx` |
| low | 공유룸 헤더 트리거를 누르면 공유룸 관리 다이얼로그가 열린다 | `frontend/src/recovered/features/agent-info/shared-room/trigger.tsx` |
| low | People 목록에서 호스트 멤버는 'Host' 라벨이 표시되고 Remove 버튼이 없다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 공유룸 다이얼로그에서 Done을 누르면 닫히고 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 공유룸 다이얼로그에서 Escape를 누르면 닫히고 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 공유룸 다이얼로그 배경을 클릭하면 닫히고 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 에이전트 추가/제거가 진행 중이면 해당 에이전트의 Add/Remove 버튼이 비활성화된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 초대 링크 입력창에 포커스하면 링크 텍스트가 전체 선택된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 초대 링크 클립보드 복사가 실패하면 버튼이 'Try again'으로 표시된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 초대 링크의 Copy 버튼을 누르면 링크가 클립보드에 복사되고 버튼이 'Copied'로 바뀐다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 초대 생성이 error를 반환하면 role=alert로 에러 메시지가 표시된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |
| low | 해당 요청 처리가 진행 중이면 Approve·Deny 버튼이 비활성화된다 | `frontend/src/recovered/features/agent-info/shared-room/view.tsx` |

## Diff 탭  (12행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Diff 탭에서 Apply Locally를 눌러 원격 브랜치 전체 diff를 로컬 워크스페이스에 적용한다(파괴적 작업 전 확인) | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Checkout Branch를 눌러 지정 원격 브랜치를 로컬에 체크아웃한다(미커밋 충돌 시 확인) | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Commit & Push를 눌러 커밋 후 현재 브랜치로 푸시한다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Commit을 눌러 봇 작업 변경만 스테이징·커밋한다(무관 파일 제외, 푸시 안 함) | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Create Branch & Commit(또는 +Push)을 눌러 새 브랜치를 만든 뒤 커밋하고 옵션에 따라 푸시한다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Create Branch(만)를 눌러 현재 변경에 대해 새 브랜치를 만들어 체크아웃한다(스테이징/커밋/푸시 안 함) | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Create PR(초안/준비완료)을 눌러 브랜치를 푸시하고 초안 여부에 맞춰 PR을 생성한다(PR 템플릿 준수) | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Fix Merge Conflicts를 눌러 origin 최신을 가져온 뒤 단순 충돌은 해결하고 복잡한 것은 보고한다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 Push를 눌러 기존 로컬 커밋만 원격에 푸시한다(새 커밋 안 만듦) | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 변경과 함께 PR 만들기(commit+push+PR)를 눌러 스테이징·커밋·푸시 후 초안 옵션에 맞춰 PR을 생성한다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Diff 탭에서 클라우드에서 Babysit PR을 눌러 코멘트·충돌·CI를 처리해 머지 가능 상태까지 진행(서브에이전트 모드면 클라우드 서브에이전트)하고 상태를 보고한다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |
| high | Multitask에서 Split PRs를 눌러 작업을 리뷰어 정렬된 작은 PR들로 나누는 계획을 세우고 승인 후 브랜치/커밋/PR을 만든다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |

## Attachments/Media  (12행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 오디오 첨부가 있으면 인라인 오디오 플레이어가 렌더된다 | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| medium | 확대된 미디어 이미지를 드래그해 뷰어 안에서 이동시킨다 | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| medium | 여러 미디어로 뷰어를 열면 이전/다음 버튼, 'Media N of M', 필름스트립이 렌더된다 | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| medium | 미디어 뷰어에서 ArrowLeft로 이전 미디어로 이동한다 | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| medium | 미디어 뷰어에서 ArrowRight로 다음 미디어로 이동한다 | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| medium | 미디어 이미지 위에서 마우스 휠을 굴려 1x~5x로 확대/축소한다 | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Click a filmstrip thumbnail to jump the viewer to that media item | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Click the media viewer backdrop to close it | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Click the close (×) button to close the media viewer | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Double-click the media image to reset it to fit (1x, centered) | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Observe the 'Couldn't load media' alert when media fails to load in the viewer | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Observe the 'Loading media…' status while media loads in a card | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | Press Escape to close the media viewer and restore focus to the trigger | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |
| low | View a non-previewable file attachment rendered as a chip with icon, name, kind and size | `frontend/src/recovered/features/conversation/workspace/media-viewer.tsx` |

## Sidebar  (12행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 미리보기가 켜진 상태에서 에이전트 행을 hover/focus하면 아바타·시간·초안/최근 항목 텍스트의 hover-card 미리보기가 나타난다 | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-content.tsx` |
| medium | 에이전트가 주의 필요이거나 미읽음이 있으면 'Needs attention'/'Unread activity' 마커(점)가 표시된다 | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-status.ts` |
| medium | 에이전트에 초안/대기사유/최근 메시지가 있으면 행에 'Draft: …'/'Waiting for you: …'/최근 메시지 미리보기가 표시된다 | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| medium | 에이전트가 작업 중이면 행에 Working 활동 미리보기와 상태 코너 점이 표시된다 | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| medium | 에이전트 행을 Cmd/Ctrl-클릭하면 다중 선택 집합에 토글된다 | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| medium | 에이전트 행을 Shift-클릭하면 에이전트 범위 선택이 이루어진다 | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| low | Press Escape with an open agent hover preview to close it | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-content.tsx` |
| low | Click outside an open agent hover preview to close it | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-content.tsx` |
| low | Click Clear on the selection bar to clear the multi-agent selection | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| low | Press Escape in the section name editor to cancel the rename without committing | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| low | Press Escape while resizing the sidebar to cancel and clean up the resize | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| low | Observe Move up/down/Rename/Delete section items disabling when the section is first/last or synthetic | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |
| low | View an empty expanded section and see the 'Drag chats here' placeholder | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |

## Composer/Editor  (11행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 편집기에서 '#' 뒤에 숫자/제목을 입력하면 최대 8개의 PR 후보 listbox가 뜬다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| high | 편집기에서 '/' 뒤에 질의를 입력하면 'Reference a skill' 워크플로우 listbox가 뜬다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| high | 편집기에서 ':' 뒤에 2자 이상 입력하면 최대 96개 이모지 listbox가 뜬다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| high | 편집기에서 '@' 뒤에 질의를 입력하면 멤버/워크플로우/MCP 참조 mention listbox가 뜬다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 열린 제안 리스트박스에서 ArrowDown으로 아래 옵션으로 이동(순환)한다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 열린 제안 리스트박스에서 ArrowUp으로 위 옵션으로 이동(순환)한다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 프롬프트 밖에 포커스가 있을 때 Cmd/Ctrl+V를 누르면 에디터 포커스가 복구되고 붙여넣어진다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 열린 제안 리스트박스에서 Enter 또는 Tab으로 활성 제안을 칩/이모지로 삽입한다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 열린 제안 리스트박스에서 Escape로 삽입 없이 닫는다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 멘션 제안을 선택하면 @멘션 칩과 뒤 공백이 삽입된다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | '@'를 입력했는데 매치가 없으면 'No matches'/'Nothing to mention yet' 빈 상태가 표시된다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| low | Press Ctrl+A on macOS to move the caret to the start of the current visual line | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| low | Press Ctrl+E on macOS to move the caret to the end of the current visual line | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |

## 조직도  (11행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 두 에이전트가 모두 턴 진행 중일 때 연결선이 'talking'으로 밝게 표시된 것을 확인한다 | `frontend/src/recovered/features/org-chart/workspace/graph.tsx` |
| medium | 조직도 노드가 대기/작업 중/그룹일 때 해당 캡션을 확인한다 | `frontend/src/recovered/features/org-chart/workspace/graph.tsx` |
| medium | 조직도 씬에서 마우스 휠을 돌려 포인터 기준 확대/축소한다 | `frontend/src/recovered/features/org-chart/workspace/graph.tsx` |
| medium | 조직도 씬을 드래그해 뷰포트를 이동(pan)한다 | `frontend/src/recovered/features/org-chart/workspace/graph.tsx` |
| medium | 조직도에 에이전트가 없을 때 'No agents yet' 빈 상태를 확인한다 | `frontend/src/recovered/features/org-chart/workspace/graph.tsx` |
| medium | 인스펙터에서 에이전트 활동 상태에 따른 Working/Waiting/Idle 라벨을 확인한다 | `frontend/src/recovered/features/org-chart/workspace/inspector.tsx` |
| medium | 사이드바에서 Agent network 트리거를 눌러 조직도 워크스페이스를 연다 | `frontend/src/recovered/features/org-chart/workspace/network-trigger.ts` |
| low | 조직도 빈 영역을 더블클릭하면 뷰포트가 기본(scale 1, 0,0)으로 리셋된다 | `frontend/src/recovered/features/org-chart/workspace/graph.tsx` |
| low | 인스펙터에 설명/마지막 메시지가 있으면 About·Last activity 섹션과 시각이 표시된다 | `frontend/src/recovered/features/org-chart/workspace/inspector.tsx` |
| low | 인스펙터의 Close 버튼을 누르면 인스펙터가 닫히고 선택이 해제된다 | `frontend/src/recovered/features/org-chart/workspace/inspector.tsx` |
| low | 조직도의 Close 버튼을 누르면 조직도가 닫힌다 | `frontend/src/recovered/features/org-chart/workspace/view.tsx` |

## attachments  (10행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 전사의 스프레드시트/표 첨부 칩을 클릭(또는 Enter/Space)하면 다운로드 가능한 뷰어가 열리고 닫으면 칩으로 포커스가 돌아온다 | `frontend/src/production/ProductionRenderer.tsx` |
| high | Fetch an OpenGraph link preview for a URL | `source/host/extensions/attachments/attachments-service.ts` |
| medium | 너무 크거나 빈 파일을 첨부하면 사유별(용량 초과/빈 파일) 안내가 표시된다 | `frontend/src/recovered/features/conversation/workspace/desktop.ts` |
| medium | Show a 'Couldn't save this file' error dialog and return false when attachment download fails | `source/electron-main/attachments/attachments.ts` |
| medium | Throw AttachmentTooLargeError when ingesting an attachment over its per-type byte limit | `source/host/extensions/attachments/attachments-service.ts` |
| low | Resolve a media attachment whose path is a video and return {kind:'video', src: sand-media url} | `source/electron-main/attachments/attachments.ts` |
| low | Resolve a media attachment whose path is audio and return {kind:'audio', src: sand-media url} | `source/electron-main/attachments/attachments.ts` |
| low | Stage a file with an unsafe filename and get {ok:false, reason:'failed'} | `source/electron-main/attachments/attachments.ts` |
| low | Stage an attachment exceeding the per-name byte limit and get {ok:false, reason:'too-large'} | `source/electron-main/attachments/attachments.ts` |
| low | Stage an empty (0-byte) attachment and get {ok:false, reason:'empty'} | `source/electron-main/attachments/attachments.ts` |

## Command Palette  (10행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 명령 팔레트에 질의를 입력하면 항목이 퍼지 점수로 순위화되고 숨김 에이전트가 뒤에 붙는다 | `frontend/src/production/command-palette-model.ts` |
| high | 명령 팔레트에서 Arrow Up/Down으로 이동한 뒤 Enter로 강조된 항목을 실행한다 | `frontend/src/production/CommandPalette.tsx` |
| high | 명령 팔레트의 결과 분류 탭(All/Messages/Agents/Groups/Files/Links/Routines/Actions)을 전환해 해당 종류로 필터한다(일부 탭은 검색 기능 활성 시에만 노출) | `frontend/src/production/CommandPalette.tsx` |
| high | 명령 팔레트에서 링크 결과(대화에서 추출된 URL)를 선택하면 외부 브라우저로 열린다(파비콘+제목/호스트 표시) | `frontend/src/production/ProductionRenderer.tsx` |
| high | 명령 팔레트에서 루틴 결과를 선택하면 해당 루틴의 에이전트가 열리고 루틴 정보 창이 표시된다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | 자식이 있는(chevron) 명령을 활성화해 중첩 단계로 진입한다 | `frontend/src/production/command-palette-model.ts` |
| medium | Back 버튼으로 상위 단계로 돌아간다 | `frontend/src/production/command-palette-model.ts` |
| medium | Escape로 상위 단계로 돌아간다 | `frontend/src/production/command-palette-model.ts` |
| medium | 빈 입력에서 Backspace로 상위 단계로 돌아간다 | `frontend/src/production/command-palette-model.ts` |
| medium | Cmd/Ctrl을 누른 채 1-9 숫자를 눌러 해당 번호의 상위 행을 활성화한다 | `frontend/src/production/command-palette-model.ts` |
| medium | 빈 쿼리에서 Tab 또는 ArrowRight로 탭을 앞으로 순환한다 | `frontend/src/production/command-palette-model.ts` |
| medium | 빈 쿼리에서 Shift+Tab 또는 ArrowLeft로 탭을 뒤로 순환한다 | `frontend/src/production/command-palette-model.ts` |
| medium | 'Update Grok Bot's Computer' 팔레트 액션을 실행하면 확인 다이얼로그(바쁨 시 큐 대기/강제)가 뜬다 | `frontend/src/production/command-palette-root-commands.ts` |
| medium | 숨김 에이전트에 매칭되는 검색을 하면 결과 끝에 'Hidden' 배지와 함께 표시된다 | `frontend/src/production/CommandPalette.tsx` |

## PDF viewer  (9행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | PDF 첨부 칩을 클릭하면 페이지 수가 헤더에 표시된 모달 PDF 뷰어가 열린다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | PDF 헤더의 Download 버튼을 클릭하면 onDownload로 파일이 저장된다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | PDF 툴바의 Zoom in 또는 + 키로 페이지를 0.5x~4x 범위에서 확대한다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | PDF 툴바의 Zoom out 또는 - 키로 페이지를 0.5x~4x 범위에서 축소한다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | 25MB 미리보기 한도를 넘는 PDF를 열면 'PDF too large to preview'와 Download 버튼이 표시된다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | PDF 렌더에 실패하면 'Couldn't render this PDF'와 Download 버튼이 표시된다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | PageDown 또는 아래 화살표로 다음 페이지로 전진해 스크롤된다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| medium | PageUp 또는 위 화살표로 이전 페이지로 후퇴해 스크롤된다 | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| low | Observe the 'Loading PDF…' status while PDF bytes load | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| low | Observe the 'File unavailable' alert when the PDF file is missing | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| low | Press Escape to close the PDF viewer and restore focus | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |
| low | Click the backdrop to close the PDF viewer and restore focus | `frontend/src/recovered/features/conversation/workspace/pdf-viewer.tsx` |

## Settings/computer  (9행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | busy-override 단계에서 Update를 클릭하면 'An agent is working' 문구와 함께 강제 업데이트되어 작업 중 에이전트를 중단한다 | `frontend/src/recovered/features/settings/overlay/computer.ts` |
| medium | Cancel Update(queued)를 클릭하면 큐된 업데이트가 취소된다 | `frontend/src/recovered/features/settings/overlay/computer.ts` |
| medium | ready 단계에서 Update를 처음 클릭하면 버튼이 'Click Again to Confirm'으로 바뀐다 | `frontend/src/recovered/features/settings/overlay/computer.ts` |
| medium | 업데이트 큐 단계에서는 버튼이 'Cancel Update'와 'Update queued' 문구로 표시된다 | `frontend/src/recovered/features/settings/overlay/computer.ts` |
| low | Observe Reset disabled with 'Open an agent to reset the shared computer' when canResetBox is false | `frontend/src/recovered/features/settings/overlay/computer-view.tsx` |
| low | Observe the Reset button showing 'Resetting…' and disabled while reset is pending | `frontend/src/recovered/features/settings/overlay/computer-view.tsx` |
| low | Observe Update/Reset disabled with blocked copy when rebuild is blocked for the session | `frontend/src/recovered/features/settings/overlay/computer.ts` |
| low | Observe the Update button showing 'Updating…' and disabled while update is pending | `frontend/src/recovered/features/settings/overlay/computer.ts` |
| low | Wait 3s after the first Update click and see the confirm state revert to 'Update' | `frontend/src/recovered/features/settings/overlay/computer.ts` |

## Composer  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 프롬프트 편집기에 파일을 붙여넣으면 첨부로 스테이징된다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |
| medium | 첨부 안내(예: 제한 경고)를 받으면 에디터 위에 라이브 영역 상태 메시지가 표시된다 | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Observe the attach button disabled while voice is recording or processing | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Drag non-file content over the composer and observe no drop overlay appears | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Enter text in the composer to expand the prompt shell and reveal the Send button | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Add an attachment to expand the prompt shell and reveal the Send button | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Observe the default 'Ask anything, or drop a file.' placeholder when there is no reply target | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Observe the editor content cleared once a send is accepted | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| low | Reply to an image and observe the placeholder change to 'Reply to attachment…' | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx` |
| low | Reply to a file and observe the placeholder change to 'Reply to file…' | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx` |
| low | Reply to a link and observe the placeholder change to 'Reply to link…' | `frontend/src/recovered/features/conversation/workspace/reply-preview.tsx` |

## notifications  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 앱이 비활성일 때 에이전트가 새 마지막 메시지로 턴을 마치면 에이전트명 제목+메시지 미리보기(또는 대체 문구) OS 알림이 뜬다 | `source/shared/os-notification.ts` |
| high | 앱이 비활성일 때 비포커스 에이전트가 입력 대기로 전환되면 '<agent> needs you' 제목의 OS 알림이 사유를 본문으로 뜬다 | `source/shared/os-notification.ts` |
| high | Send a mobile push when an agent finishes a turn while the window is unfocused | `source/host/extensions/notifications/mobile-push-notifier.ts` |
| high | Send a push with awaitingUserResponse=true when an agent needs user input | `source/host/extensions/notifications/mobile-push-notifier.ts` |
| medium | Observe a silent OS notification when an agent finishes while the window is unfocused | `source/electron-main/notifications/os-notification-manager.ts` |
| medium | Observe a critical OS notification when an agent needs input while the window is unfocused | `source/electron-main/notifications/os-notification-manager.ts` |
| medium | Click an agent OS notification to restore/focus the window and open the agent | `source/electron-main/notifications/os-notification-manager.ts` |
| low | Agent events arriving while the window is focused show no notification | `source/electron-main/notifications/os-notification-manager.ts` |

## Spreadsheet viewer  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 스프레드시트 첨부를 열면 행 수가 헤더에 표시된 모달 표 뷰어가 렌더된다 | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| medium | Click a non-empty cell to open the cell-detail panel showing column/row label and full text | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| medium | Open a spreadsheet too large to preview and see the 'too large' message with a Download link | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| medium | Click a sheet tab to show that sheet's table (active tab marked aria-pressed) | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| low | Press Escape to close the spreadsheet viewer | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| low | Click the backdrop to close the spreadsheet viewer | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| low | Click the close (×) button to close the spreadsheet viewer | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| low | Observe the 'Loading spreadsheet…' status while the spreadsheet is loading | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| low | Observe 'File unavailable' / 'Couldn't read this spreadsheet' when the spreadsheet is missing or unreadable | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |
| low | View a sheet with no data rows and see 'This sheet is empty' | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer.tsx` |

## account  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Sign in to Cursor (open login URL in external browser) | `source/electron-main/account/cursor-auth.ts` |
| medium | Query Sand access status returning granted/unavailable/paymentRequired/unknown/checking with a block reason | `source/electron-main/account/access.ts` |
| medium | Revoke credentials and show 'Cursor sign-in expired. Sign in again…' when token refresh returns not-ok/expired | `source/electron-main/account/cursor-auth.ts` |
| medium | Store tokens and emit logged-in status (with profile) when the login poll completes with valid tokens | `source/electron-main/account/cursor-auth.ts` |
| medium | Emit logged-out with 'Cursor sign-in did not finish. Try again.' when login times out | `source/electron-main/account/cursor-auth.ts` |
| medium | Emit logged-out with 'couldn't remove the saved Cursor sign-in… may return after restart' when logout fails to remove credentials | `source/electron-main/account/cursor-auth.ts` |
| medium | Refuse sign-in with 'This computer is linked to another Cursor account…' when the machine is bound to a different account | `source/electron-main/account/cursor-auth.ts` |
| medium | Cancel an in-progress login to abort and return logged-out status | `source/electron-main/account/cursor-auth.ts` |

## webauthn  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Observe 'That PIN was not accepted.' with remaining-attempts count when a PIN is rejected and re-prompted | `source/electron-main/coordinator/coordinator-executors.ts` |
| medium | Enter a PIN and click Continue in the security-key PIN panel to submit and show 'Checking your PIN…' | `source/electron-main/coordinator/coordinator-executors.ts` |
| medium | Close the security-key consent prompt window (resolves as denied) | `source/electron-main/coordinator/coordinator-executors.ts` |
| low | A coordinator status update during the ceremony updates the prompt working-state text live via __sandStatus | `source/electron-main/coordinator/coordinator-executors.ts` |
| low | User clicks Cancel on the PIN prompt; PIN resolves null and shows 'Cancelling…' | `source/electron-main/coordinator/coordinator-executors.ts` |
| low | User presses Enter on the security-key consent prompt, triggering Approve | `source/electron-main/coordinator/coordinator-executors.ts` |
| low | User presses Escape on the security-key consent prompt, denying consent | `source/electron-main/coordinator/coordinator-executors.ts` |
| low | User submits an empty PIN and the submit is ignored without spending a key attempt | `source/electron-main/coordinator/coordinator-executors.ts` |

## 로스터  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Roster send blocked by CLOUD_AGENT_STORAGE_DISABLED/no_storage (shows 'Update Privacy Mode' dialog) | `frontend/src/recovered/features/roster/privacy-blocked.tsx` |
| medium | Click 'Open Privacy Settings' in the privacy-blocked dialog (opens cursor.com privacy URL externally) | `frontend/src/recovered/features/roster/privacy-blocked.tsx` |
| medium | Click 'Sign out' in the privacy-blocked dialog (runs logout) | `frontend/src/recovered/features/roster/privacy-blocked.tsx` |
| medium | Select an agent in the roster (selection saved per account, restored next run) | `frontend/src/recovered/features/roster/selection-state.ts` |
| medium | Saved selected agent no longer in roster (reconciled to the first agent) | `frontend/src/recovered/features/roster/selection-state.ts` |
| medium | All bots hidden (shows 'All bots are hidden' with a 'Show Hidden Bots' button) | `frontend/src/recovered/features/roster/status.tsx` |
| low | 재연결 재시도 중이면 Retry 버튼이 비활성화되고 'Retrying…'로 표시된다 | `frontend/src/recovered/features/roster/reconnect-notice.tsx` |
| low | 저장된 에이전트가 없으면 'No saved agents yet.' 빈 상태가 표시된다 | `frontend/src/recovered/features/roster/status.tsx` |

## 숨김대화  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 숨김 변경 RPC가 비-전송 오류로 실패하면 낙관적 변경이 이전 값으로 롤백된다 | `frontend/src/recovered/features/hidden-chats/overlay/mutation-controller.ts` |
| medium | 숨김 변경 RPC가 전송 실패하면 변경을 유지하고 재연결 시 자동 재시도한다 | `frontend/src/recovered/features/hidden-chats/overlay/mutation-controller.ts` |
| low | 숨김 봇 다이얼로그 바깥을 누르면 오버레이가 닫힌다 | `frontend/src/recovered/features/hidden-chats/overlay/view.tsx` |
| low | 숨김 봇 다이얼로그가 닫히면 이전 포커스 요소로 포커스가 복원된다 | `frontend/src/recovered/features/hidden-chats/overlay/view.tsx` |
| low | 숨김 봇 다이얼로그에서 Close 아이콘을 누르면 닫힌다 | `frontend/src/recovered/features/hidden-chats/overlay/view.tsx` |
| low | 숨김 봇 다이얼로그에서 Escape를 누르면 오버레이가 닫힌다 | `frontend/src/recovered/features/hidden-chats/overlay/view.tsx` |
| low | 숨김 봇 다이얼로그에서 Tab을 누르면 포커스가 내부 요소에서 순환된다 | `frontend/src/recovered/features/hidden-chats/overlay/view.tsx` |
| low | 숨김 봇이 없으면 eye-slash 아이콘과 'No hidden bots'가 표시된다 | `frontend/src/recovered/features/hidden-chats/overlay/view.tsx` |

## 정보-채널  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 액션 메뉴에서 'How to connect'를 눌러 연결 가이드 다이얼로그를 연다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| medium | 채널 조회 실패로 표시할 뷰가 없을 때 에러와 Retry 버튼을 확인한다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 가이드 다이얼로그에서 'Got it'을 누르면 닫히고 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 가이드 다이얼로그에서 Escape를 누르면 닫히고 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 가이드 다이얼로그 바깥을 클릭하면 닫히고 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 자격증명 팝오버에서 Cancel을 누르면 토큰이 지워지고 팝오버가 닫힌다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 채널 에러 상태에서 Retry를 누르면 채널 목록을 다시 로드한다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 채널 행의 액션(⋯) 메뉴를 누르면 'How to connect'와 연결 시 Refresh/Disconnect 메뉴가 열린다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 커넥터 목록이 비어 있으면 'No connectors available.'가 표시된다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |
| low | 해당 채널 작업이 진행 중이면 Connect/Reconnect/Disconnect/Refresh 버튼이 비활성화된다 | `frontend/src/recovered/features/agent-info/channels/view.tsx` |

## Voice  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Insert returned transcription text into the editor and refocus it | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| medium | See a 'Transcribing…' spinner replace the mic/send buttons while transcription is in progress | `frontend/src/recovered/features/conversation/workspace/composer.tsx` |
| medium | See a non-recoverable 'Microphone access denied…' error after denying microphone permission | `frontend/src/recovered/features/conversation/workspace/voice.tsx` |
| medium | Have recording auto-stop at the 300000ms ceiling and transcribe | `frontend/src/recovered/features/conversation/workspace/voice.tsx` |
| medium | Have a sub-500ms recording discarded and return to idle without transcribing | `frontend/src/recovered/features/conversation/workspace/voice.tsx` |
| medium | See a 'No microphone found…' error when starting voice with no microphone device | `frontend/src/recovered/features/conversation/workspace/voice.tsx` |
| low | Observe the waveform drawing a static bar pattern when there is no audio stream | `frontend/src/recovered/features/conversation/workspace/voice.tsx` |

## 정보-멤버  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 멤버 수가 최대(6명)에 도달하면 'up to 6 members' 안내를 확인한다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |
| medium | 멤버가 1명만 남으면 Remove 버튼이 비활성화된 것을 확인한다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |
| low | 제거 확인에서 Cancel을 누르면 제거되지 않고 알림이 닫힌다 | `frontend/src/recovered/features/agent-info/group-members/model.ts` |
| low | 멤버 추가/제거가 진행 중이면 'Add Member' 버튼이 비활성화된다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |
| low | 멤버 추가/제거가 진행 중이면 Remove가 막힌다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |
| low | 추가 메뉴 바깥을 누르면 메뉴가 닫힌다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |
| low | 추가 메뉴에서 Escape를 누르면 메뉴가 닫히고 트리거로 포커스가 복원된다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |
| low | 추가할 후보 봇이 없으면 'Create more Bots to add them here.' 안내가 표시된다 | `frontend/src/recovered/features/agent-info/group-members/view.tsx` |

## Cursor 계정  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Cursor Sand 체험을 취소하면 체험이 취소되고 결제/사용량 상태가 갱신된다 | `source/electron-preload/preload.ts` |
| high | Cursor 계정에서 로그아웃하면 인증 상태가 해제되고 cursor-auth-changed 이벤트가 발생한다 | `source/electron-preload/preload.ts` |
| high | Cursor 계정으로 로그인하면 로그인 흐름이 시작되고 인증 상태가 갱신된다 | `source/electron-preload/preload.ts` |
| medium | Cursor 계정 이름을 수정하면 계정 표시 이름이 갱신된다 | `source/electron-preload/preload.ts` |
| medium | PR 리뷰 환경설정 값을 조회해 선호값을 확인한다 | `source/electron-preload/preload.ts` |
| medium | 프라이버시 모드 on/off 상태를 조회해 확인한다 | `source/electron-preload/preload.ts` |
| medium | Sand 접근 권한(캐시/최신) 상태를 조회해 표시한다 | `source/electron-preload/preload.ts` |
| medium | 대시보드 액션을 실행해 결과를 받는다 | `source/electron-preload/preload.ts` |

## Mermaid viewer  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 렌더된 mermaid 다이어그램 또는 확장 버튼을 클릭하면 전체화면 다이어그램 뷰어가 열린다 | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| medium | 다이어그램 소스가 잘못되면 'Couldn't render this diagram.' 메모와 코드 폴백이 표시된다 | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Drag the mermaid diagram to pan it | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Press 0 or f to fit the mermaid diagram to the viewport | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Double-click the mermaid diagram to fit it to the viewport | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Click Fit to fit the mermaid diagram to the viewport | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Press Escape to close the mermaid diagram viewer | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Click Close to close the mermaid diagram viewer | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Scroll the wheel to zoom the mermaid diagram (0.1x–8x) | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Press +/- keys to zoom the mermaid diagram (0.1x–8x) | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |
| low | Click the zoom buttons to zoom the mermaid diagram (0.1x–8x) | `frontend/src/recovered/features/conversation/workspace/mermaid.tsx` |

## 정보-설정  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 그룹 에이전트에서 Title 필드와 Notifications 카드가 숨겨진 것을 확인한다 | `frontend/src/recovered/features/agent-info/settings/view.tsx` |
| medium | 설정 저장이 실패하면 aria-live 에러 메시지를 확인한다 | `frontend/src/recovered/features/agent-info/settings/view.tsx` |
| medium | 이름 필드를 공백으로 비우고 확정해 원래 값으로 되돌아가게 한다 | `frontend/src/recovered/features/agent-info/settings/view.tsx` |
| low | 저장이 진행 중이면 Notifications 스위치가 비활성화된다 | `frontend/src/recovered/features/agent-info/settings/view.tsx` |
| low | 편집 필드에서 Escape를 누르면 변경이 취소되고 원래 값으로 복원된다 | `frontend/src/recovered/features/agent-info/settings/view.tsx` |
| low | 한 줄 필드에서 Enter를 누르면 blur되어 값이 커밋된다 | `frontend/src/recovered/features/agent-info/settings/view.tsx` |

## Plugins/browser  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Press Arrow keys to move focus among the Filter menu radio options | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Press Home/End to move focus among the Filter menu radio options | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe 'No plugins match the current filters' when filters are active but nothing matches | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe 'marketplace isn't available' or 'No plugins match X' when no items match in Marketplace | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe 'Nothing installed yet' or 'No installed plugins match X' when no items match in Yours | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Press Escape in the Filter menu to close it and return focus to the trigger | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | View a plugin item row showing its status label (Added/Managed by team/Connected/Disconnected/Error/Auth required) | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## Cross-user sharing  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 릴레이 폴에서 room-post/room-entry 이벤트를 받으면 게스트 메시지/미러 항목이 전사에 추가되어 표시된다 | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts` |
| medium | 릴레이 호출이 429를 반환하면 'You're doing that too often. Try again in a minute.' 메시지를 본다 | `source/host/extensions/cross-user-sharing/xuser-relay.ts` |
| medium | 로그인하지 않고 공유 방을 만들려 하면 'Sign in to create shared groups.' 오류를 받는다 | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts` |
| medium | 존재하지 않는 에이전트로 방 생성을 시도하면 'That agent no longer exists.' 오류를 받는다 | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts` |
| low | Observe a remote participant added to the typing list on their typing event and auto-removed at expiry | `source/host/extensions/cross-user-sharing/xuser-sharing-service.ts` |

## Email draft card  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 편집 가능한 이메일 초안 카드에 To/Subject/Message 필드, 'Ready to send', Send/Discard 버튼이 표시된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx` |
| medium | 이메일 초안이 전송되면 'Sent to {recipient} — {subject}' 요약이 표시된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx` |
| medium | 수신자가 무효이거나 본문이 비면 Send email 버튼이 비활성화된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx` |
| low | Observe the email body collapse with a Show more/Show less toggle when it exceeds 8 visual lines | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx` |
| low | Observe the 'Sending…' status and disabled fields while an email draft is sending | `frontend/src/recovered/features/conversation/cards/transcript-card/views/email-draft.tsx` |

## Send delivery  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 큐잉된(오프라인) 메시지를 취소하면 낙관적 행이 제거되고 텍스트/첨부가 컴포저 초안으로 복구된다 | `frontend/src/production/ProductionRenderer.tsx` |
| high | 전송 실패한 메시지를 재전송하면 새 nonce로 pending 재진입 후 저널 수명주기로 재시도된다 | `frontend/src/production/ProductionRenderer.tsx` |
| high | 코디네이터 전송이 끊긴 상태에서 메시지를 보내면 큐잉되고 재연결 시 자동으로 flush·전송된다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | 실패한 메시지 행을 삭제하면 해당 낙관적 메시지가 트랜스크립트에서 제거된다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | 사용자 메시지가 전달되는 동안 행이 pending→queued/failed/sent 및 Working/idle 상태를 표시한다 | `frontend/src/production/ProductionRenderer.tsx` |

## 대화 오류  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Click 'Switch model' on a backend-error card to trigger the switch-model action | `source/host/extensions/transcript/agent-run-error.ts` |
| high | Click 'Request limit increase' on a limit-exceeded card | `source/host/extensions/transcript/agent-run-error.ts` |
| medium | View the sand_included_limit error (absolute reset time shown as relative 'resets in N ...') | `source/host/extensions/transcript/agent-run-error.ts` |
| medium | Click 'Upgrade' on a billing/limit error card (opens cursor.com checkout URL) | `source/host/extensions/transcript/agent-run-error.ts` |
| medium | View a backend error card with URL action buttons (only http/https buttons shown, max 3) | `source/host/extensions/transcript/agent-run-error.ts` |

## 모드  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Switch to Ask/Chat mode | `source/packages/agent/mode-processing.ts` |
| high | Switch to Debug mode | `source/packages/agent/mode-processing.ts` |
| high | Switch to Plan mode and send a message | `source/packages/agent/mode-processing.ts` |
| high | Switch to Project mode | `source/packages/agent/mode-processing.ts` |
| high | Switch to Triage mode | `source/packages/agent/mode-processing.ts` |

## Computer(forever-box)  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 자동 이미지 업데이트가 반복 실패하면 트레이에 'Computer update failed' 에러를 한 번 푸시한다 | `source/host/extensions/forever-box/forever-box-service.ts` |
| medium | 재생성 요청 시 업데이트 서비스에 닿지 못하면 오류를 던지고 컴퓨터를 그대로 유지한다 | `source/host/extensions/forever-box/forever-box-service.ts` |
| medium | 재생성 시도했으나 서비스가 시작을 거절하면 'Couldn't update/reset' 오류를 표시한다 | `source/host/extensions/forever-box/forever-box-service.ts` |
| medium | 추가 데스크톱 창(ensureWindow)을 요청해 해당 창의 vncUrl을 만들고 windows 목록을 갱신한다 | `source/host/extensions/forever-box/host-box.ts` |
| medium | 박스가 다중 창을 지원하지 않을 때 추가 데스크톱 창을 요청하면 미지원 오류를 던진다 | `source/host/extensions/forever-box/host-box.ts` |

## Computer/update-confirm  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트 작업 중 업데이트 확인창에서 작업중 안내와 'Update anyway' 파괴적 보조 버튼을 본다 | `frontend/src/recovered/features/computer/update/confirmation.ts` |
| low | Observe the 'update started, but X can't track its progress' message when confirm returns started-untrackable | `frontend/src/recovered/features/computer/update/confirmation.ts` |
| low | Observe the rejection reason message when the update confirm is rejected | `frontend/src/recovered/features/computer/update/confirmation.ts` |
| low | Observe the failed phase with error message when the update confirm throws | `frontend/src/recovered/features/computer/update/confirmation.ts` |
| low | View the "Update X's Computer?" confirmation with confirm/cancel labels for a ready action | `frontend/src/recovered/features/computer/update/confirmation.ts` |

## Conversation outline  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 아웃라인에 서브에이전트가 있으면 대화와 각 서브에이전트 탭이 상태 마커와 함께 렌더된다 | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |
| low | Drag the outline panel header to move the panel | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |
| low | Observe the 'No conversation activity yet.' message when the outline has no activity | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |
| low | Press Escape to close the outline panel | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |
| low | Click Close to close the outline panel | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |
| low | Press ArrowLeft/ArrowRight to move selection to the adjacent outline tab | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |
| low | Press Home/End to move selection to the first/last outline tab | `frontend/src/recovered/features/conversation/workspace/conversation-outline-view.tsx` |

## media  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Open the context menu on a link and choose 'Open link' | `source/electron-main/media/avatar-images.ts` |
| medium | Open the context menu on a link and choose 'Copy link address' | `source/electron-main/media/avatar-images.ts` |
| medium | Open the image context menu and choose 'Copy image' | `source/electron-main/media/avatar-images.ts` |
| medium | Open the image context menu and choose 'Save image…' | `source/electron-main/media/avatar-images.ts` |
| medium | Open the image context menu and choose 'Copy image address' | `source/electron-main/media/avatar-images.ts` |
| medium | Choose Undo from the editable-text context menu | `source/electron-main/media/avatar-images.ts` |
| medium | Choose Redo from the editable-text context menu | `source/electron-main/media/avatar-images.ts` |
| medium | Choose Cut from the editable-text context menu | `source/electron-main/media/avatar-images.ts` |
| medium | Choose Copy from the editable-text context menu | `source/electron-main/media/avatar-images.ts` |
| medium | Choose Paste from the editable-text context menu | `source/electron-main/media/avatar-images.ts` |
| medium | Choose Select All from the editable-text context menu | `source/electron-main/media/avatar-images.ts` |
| low | The context menu opened on non-editable selected text shows a single 'Copy' item | `source/electron-main/media/avatar-images.ts` |
| low | User clicks 'Save image…', confirms the dialog, and the image bytes are written with the correct extension | `source/electron-main/media/avatar-images.ts` |

## workflows/store  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Toggle a managed/plugin-source workflow enabled state (no-op, returns unchanged) | `source/host/workflows/workflow-store.ts` |
| medium | Delete a managed-source workflow (removal refused, returns false) | `source/host/workflows/workflow-store.ts` |
| medium | Delete a plugin-source workflow (removal refused, returns false) | `source/host/workflows/workflow-store.ts` |
| medium | Update a plugin workflow not published by the current user (edit refused, returns null) | `source/host/workflows/workflow-store.ts` |
| low | Creating a workflow from a spec with a trigger converts it to a cron automation stored as an automation | `source/host/workflows/workflow-store.ts` |
| low | Creating a workflow with an empty name returns null and the creation is rejected | `source/host/workflows/workflow-store.ts` |

## 대화 활동 표시  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot edits a file via shell redirect/tee/sed -i (edited filename extracted for activity detail, /dev/null excluded) | `source/host/sand-activity.ts` |
| medium | View the status bar during tool execution (per-tool name+detail: Read file, WebSearch query, WebFetch host, etc.) | `source/host/sand-activity.ts` |
| medium | A short tool call finishes instantly (named activity held up to 2.5s before reverting to Thinking, anti-flicker) | `source/host/sand-activity.ts` |
| low | A very long bot activity detail is truncated to 80 chars in the display | `source/host/sand-activity.ts` |
| low | A bot SendMessage tool call (and turn end) clears the activity display and is not shown as a tool activity | `source/host/sand-activity.ts` |

## 정보-비동기작업  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 비동기 작업 이벤트 수신 시 부모 에이전트 작업 목록이 갱신된 것을 확인한다 | `frontend/src/recovered/features/agent-info/async-tasks/provider.ts` |
| medium | 비동기 작업 조회가 malformed일 때 failed 상태와 이전 목록 유지 표시를 확인한다 | `frontend/src/recovered/features/agent-info/async-tasks/provider.ts` |
| low | 비동기 작업 패널 헤더를 드래그하면 패널이 이동한다 | `frontend/src/recovered/features/agent-info/async-tasks/view.tsx` |
| low | 비동기 작업 패널의 Close 버튼을 누르면 패널이 닫힌다 | `frontend/src/recovered/features/agent-info/async-tasks/view.tsx` |
| low | 진행 중인 비동기 작업이 없으면 'No async tasks in progress.' 빈 상태가 표시된다 | `frontend/src/recovered/features/agent-info/async-tasks/view.tsx` |

## Emoji picker  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click an emoji cell to select it for the reaction | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx` |
| low | Observe the fail-closed error live-region alert when the emoji catalog fails to load | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx` |
| low | Observe the 'Loading emoji…' status while the emoji catalog loads | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx` |
| low | Observe 'No emoji found' when an emoji search query has no matches | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx` |
| low | Use arrow keys to move focus across the 8-column emoji grid | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx` |
| low | Use Home/End to move focus to the destination emoji cell | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-picker-content.tsx` |

## 봇캐릭터  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | prefers-reduced-motion이거나 paused이면 캐릭터 애니메이션 프레임 루프가 실행되지 않는다 | `frontend/src/recovered/features/onboarding/signed-in/character.tsx` |
| low | 상태가 excited/happy/celebrate이면 캐릭터에 미소가 그려진다 | `frontend/src/recovered/features/onboarding/signed-in/character.tsx` |
| low | 상태가 sleeping이면 눈이 감긴 형태로 표시된다 | `frontend/src/recovered/features/onboarding/signed-in/character.tsx` |
| low | 페르소나 마크에 색/모양이 없으면 에이전트 id 해시로 결정론적 색·모양이 선택된다 | `frontend/src/recovered/features/onboarding/signed-in/character.tsx` |
| low | 포인터를 움직이면 캐릭터의 눈이 포인터 방향으로 시선을 따라간다 | `frontend/src/recovered/features/onboarding/signed-in/character.tsx` |

## Navigation shortcuts  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 이전/다음 에이전트 단축키를 누르면 인접한 보이는 사이드바 에이전트로 선택이 이동하고 대화가 열린다 | `frontend/src/production/ProductionRenderer.tsx` |
| high | 뒤로/앞으로 내비게이션을 실행하면 이전 방문 에이전트 히스토리를 단계별로 이동한다(사라진 것은 건너뜀) | `frontend/src/production/ProductionRenderer.tsx` |
| medium | Cmd/Ctrl+숫자를 누르면 고정→비고정 순서의 n번째 에이전트가 열린다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | new-chat 단축키로 새 에이전트를 만든다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | open-settings 단축키로 설정을 연다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | open-tools 단축키로 Plugins를 연다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | focus-prompt 단축키로 작성창에 포커스한다 | `frontend/src/production/ProductionRenderer.tsx` |
| medium | toggle-sidebar 단축키로 사이드바를 접거나 편다 | `frontend/src/production/ProductionRenderer.tsx` |

## VNC 뷰어  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Copy text in the VNC box so it appears on the host clipboard | `source/electron-preload/preload-vnc.ts` |
| high | Paste the host clipboard into the VNC box | `source/electron-preload/preload-vnc.ts` |
| medium | Use Mac Cmd+A/C/V/X/Z shortcuts inside VNC, mapped to Ctrl combinations | `source/electron-preload/preload-vnc.ts` |
| low | View the VNC screen with the noVNC control bar/status/logo hidden so only the clean remote screen shows | `source/electron-preload/preload-vnc.ts` |
| low | Press arrow keys inside the VNC viewer and have them forwarded to the host UI instead of being trapped | `source/electron-preload/preload-vnc.ts` |

## avatar  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Generate an avatar image from a text description | `source/electron-main/media/avatar-images.ts` |
| medium | Reject an avatar image larger than 25 MB with 'Choose an image smaller than 25 MB.' | `source/electron-main/media/avatar-images.ts` |
| low | User requests avatar generation with an empty description | `source/electron-main/media/avatar-images.ts` |
| low | User selects a file that is not a valid image for the avatar | `source/electron-main/media/avatar-images.ts` |

## session  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Clear a conversation (wipe transcript and transient state) | `source/host/extensions/session/agent-db.ts` |
| medium | Attempt a turn when stored conversation exceeds the hard limit and GC can't shrink it | `source/host/extensions/session/conversation-size-limits.ts` |
| medium | Restore the previously persisted active agent as the active session on boot | `source/host/extensions/transcript/session-runtime.ts` |
| low | Switching to the already-active agent returns the current transcript with no reload | `source/host/extensions/transcript/session-runtime.ts` |

## 첨부 (스프레드시트 뷰어)  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 표(CSV/TSV/XLSX) 첨부를 열어 미리 본다 | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer-model.ts` |
| medium | 매우 큰 표 첨부를 열어 too-large 상태와 최대 2000행 파싱/총행수 추정을 확인한다 | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer-model.ts` |
| medium | 표 뷰어에서 원본 파일을 원래 파일명으로 내려받는다 | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer-provider.ts` |
| low | 표가 아닌 첨부에서 표 뷰어를 시도하면 kind가 'table'이 아니라 스프레드시트 뷰어가 열리지 않는다 | `frontend/src/recovered/features/conversation/workspace/spreadsheet-viewer-provider.ts` |

## 컨텍스트 첨부  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 코드 선택 영역을 메시지에 첨부해 라인 번호와 함께 code_selection 블록으로 포함한다 | `source/packages/agent/context-processing-code-selection-renderer.ts` |
| high | 문서(docs)를 메시지에 첨부한다 | `source/packages/agent/context-processing-documentation.ts` |
| high | 폴더를 메시지에 첨부해 디렉터리 트리로 포함한다 | `source/packages/agent/context-processing-folders.ts` |
| medium | 문서/영상 첨부가 최대 크기를 넘으면 'exceeds maximum size' 오류로 거부된다 | `source/packages/agent/context-processing-hydration.ts` |

## Auto-review  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | auto-review 요청을 'Always allow'로 승인하면 리댁션된 허용 규칙이 추가된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/auto-review-actions.ts` |
| medium | 셸 명령 승인 카드에 실행 대상 정의와 sha256 해시(또는 nonce)를 첨부해 표시한다 | `source/host/runner/sand-shell-auto-review-enrichment.ts` |
| medium | Send a pending approval card and set an awaiting badge when an auto-review approval is created | `source/host/extensions/auto-review/auto-review-service.ts` |
| medium | Expire pending approvals (status expired) when the session ends | `source/host/extensions/auto-review/auto-review-service.ts` |

## Link card  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 링크 카드를 클릭하면 내부 이동 대신 provider.openExternal로 URL이 외부에서 열린다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/link-card.tsx` |
| medium | 단독 링크 메시지/첨부를 보면 제목·설명·이미지·호스트명이 있는 링크 카드가 렌더된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/link-card.tsx` |
| low | Observe watched failed link cards re-fetch metadata on reconnect or window focus | `frontend/src/recovered/features/conversation/cards/transcript-card/url-card.ts` |
| low | Observe the link card aria-busy and showing the URL until metadata resolves | `frontend/src/recovered/features/conversation/cards/transcript-card/views/link-card.tsx` |

## MCP  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 내가 게시하지 않은 플러그인의 스킬을 resync하려 하면 'belongs to a plugin you did not publish.' 오류가 발생한다 | `source/host/extensions/mcp/skill-publish.ts` |
| medium | 내가 게시하지 않은 플러그인의 스킬을 unpublish하려 하면 'belongs to a plugin you did not publish.' 오류가 발생한다 | `source/host/extensions/mcp/skill-publish.ts` |
| medium | 라이브러리에 없는 워크플로를 게시하려 하면 'That skill no longer exists in your library.' 오류가 발생한다 | `source/host/extensions/mcp/skill-publish.ts` |
| medium | 설명이 빈 스킬을 게시하려 하면 'Add a description before publishing...' 오류가 발생한다 | `source/host/extensions/mcp/skill-publish.ts` |
| low | The renderer invokes sand:mcp-plugin-logo with a url and receives the resolved logo (null if url not a string) | `source/electron-main/mcp/mcp-desktop.ts` |

## Permissions/local-tool  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 권한 해결 제출이 실패하면 'Your answer didn't go through. Check your connection and try again.'가 표시된다 | `frontend/src/recovered/features/permissions/local-tool/view.tsx` |
| low | Observe all action buttons disabled while a local-tool permission resolution is submitting | `frontend/src/recovered/features/permissions/local-tool/view.tsx` |
| low | View the outcome text (can/cannot/was not allowed/this time) when the ask is already resolved | `frontend/src/recovered/features/permissions/local-tool/view.tsx` |
| low | Observe 'Always allow' disabled with a tooltip explaining the team policy when a team ceiling blocks always | `frontend/src/recovered/features/permissions/local-tool/view.tsx` |

## Plugins/skill-detail  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Delete skill을 클릭하면 스킬이 삭제되고 목록 화면으로 돌아간다 | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Click Publish with an empty description and see 'Add a description first' | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Attempt to publish with targets unavailable and see the unavailable-reason alert | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Save a private skill that fails and see the error alert | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## Reactions  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 메시지의 확장 반응 선택기를 열면 검색 가능한 이모지 선택기(96개 상한·recents 우선)가 제공된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/emoji-catalog.ts` |
| medium | 메시지에 묶인 반응이 있으면 이모지와 count>1의 반응 pill이 렌더되고 내 반응이면 aria-pressed가 표시된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx` |
| low | Hover a reaction pill and see the 'X reacted with {emoji}' tooltip | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx` |
| low | Press Escape with the reaction picker open to close it and return focus to the trigger | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-picker.tsx` |

## trays  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Observe a new error tray appear when an error condition pushes it | `source/host/extensions/trays/trays-service.ts` |
| low | Deleting an agent dismisses all trays belonging to that agent | `source/host/extensions/trays/trays-service.ts` |
| low | pushError beyond the MAX_TRAYS (20) cap drops the oldest trays (emitting 'dismissed') to stay at 20 | `source/host/extensions/trays/trays-service.ts` |
| low | pushError with a dedupeKey matching an existing tray updates it in place and increments its count | `source/host/extensions/trays/trays-service.ts` |

## 첨부  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 원격 박스가 켜진 상태로 파일을 첨부해 /workspace/uploads 자동 스테이징과 경로 노트를 확인한다 | `source/host/runner/prompt-collector-glue.ts` |
| medium | 읽을 수 없는 이미지 첨부를 포함해 전송하면 해당 이미지만 건너뛰고 전송이 계속된다 | `source/host/selected-image-inputs.ts` |
| medium | 용량 제한을 초과한 파일을 첨부해 크기 초과 안내를 확인한다 | `source/shared/media/attachment-limits.ts` |
| medium | 동영상 파일을 첨부해 이미지/파일과 분리된 동영상으로 전송한다 | `source/host/extensions/transcript/send-message-shaping.ts` |

## Plugins/private  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe 'No private skills yet…' or 'No private skills match X' when the agent has no private skills | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe the private skill toggle disabled while its change is pending | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe the private section error alert when private skills fail to load | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe 'Open an agent to see its private skills' in the Yours tab when no agent is active | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## Access/cover  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 접근이 차단되면 사유 제목/본문이 담긴 액세스 커버 오버레이가 표시된다 | `frontend/src/recovered/features/access/cover/view.tsx` |
| medium | access cover 액션 버튼을 클릭해 온보딩 URL을 외부 브라우저로 연다 | `frontend/src/recovered/features/access/cover/view.tsx` |
| low | Observe the roster restored from persisted cache before live load, suppressing the access cover | `frontend/src/recovered/features/access/cover/roster-snapshot-store.ts` |

## Settings/usage  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 사용량 설정에서 Cancel Trial을 눌러 확인하면 체험이 취소되고 사용량이 갱신된다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| medium | 업그레이드 CTA(dashboard-action)를 클릭하면 대시보드 액션이 실행되고 사용량이 갱신되며 메시지가 표시된다 | `frontend/src/recovered/features/settings/overlay/panels.tsx` |
| low | Open the cancel-trial dialog so the parent Settings backdrop/escape/focus-trap are suspended | `frontend/src/recovered/features/settings/overlay/desktop-surface.tsx` |

## Slack draft card  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 편집 가능한 Slack 초안 카드에 Workspace/To/Thread 행, 메시지 필드, Send/Discard 버튼이 표시된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/slack-draft.tsx` |
| medium | Slack 초안이 전송 중이면 'Sending…', 전송되면 'Sent to {target}' 요약이 표시된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/slack-draft.tsx` |
| low | Observe the Send message button disabled when the Slack body is empty | `frontend/src/recovered/features/conversation/cards/transcript-card/views/slack-draft.tsx` |

## Tool result card  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 에이전트가 셸/터미널 도구를 실행하면 명령·작업 디렉토리·스트리밍 출력·상태(running/success/error/denied/rejected/cancelled/background)를 담은 셸 결과 카드가 표시된다 | `frontend/src/recovered/features/conversation/tool-results/model.ts` |
| high | 에이전트가 파일을 편집/작성하면 경로와 diff, 상태(success/rejected/error/denied)를 담은 카드가 표시된다 | `frontend/src/recovered/features/conversation/tool-results/proto-adapter.ts` |
| medium | Watch tool-result card output append live as deltas arrive, then settle to the final status | `frontend/src/recovered/features/conversation/tool-results/model.ts` |

## Transcript message  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Copy a transcript message's text to the clipboard | `frontend/src/recovered/features/conversation/message-card-seam.ts` |
| medium | Send a plain message that is a single bare https link to get an openable link-preview card | `frontend/src/recovered/features/conversation/message-card-seam.ts` |
| low | Send a message containing only a single emoji and see it rendered as an enlarged standalone emoji | `frontend/src/recovered/features/conversation/message-card-seam.ts` |

## 모델 선택  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Select and save the default AI model | `source/electron-preload/preload.ts` |
| high | Select and save the computer-use model | `source/electron-preload/preload.ts` |
| medium | Specify a disallowed model parameter combination/value (shows specific validation error) | `source/shared/agents/model-catalog.ts` |

## 봇  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Auto-name a default-named bot from the first 72 chars of its first message | `source/host/extensions/transcript/send-acceptance.ts` |
| medium | 봇 이름을 변경하면 대화 타임라인에 name-changed 이벤트가 표시된다 | `source/host/extensions/transcript/profile-watch.ts` |
| medium | 봇 프로필/아바타 파일이 디스크에서 바뀌면 50ms 디바운스 후 아바타 캐시가 무효화되고 사이드바가 자동 새로고침된다 | `source/host/extensions/transcript/profile-watch.ts` |

## Agent row menu  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 숨김 에이전트의 행 메뉴를 열면 액션이 없어 메뉴가 열리지 않는다 | `frontend/src/production/agent-row-actions-model.ts` |
| medium | 키보드(ContextMenu 키 또는 Shift+F10)로 에이전트 행 컨텍스트 메뉴를 연다 | `frontend/src/production/AgentRowActions.tsx` |
| medium | 'Copy conversation ID'를 선택해 대화 id를 클립보드에 복사한다 | `frontend/src/production/ProductionRenderer.tsx` |

## Chat header  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 설정 토글이 가능할 때 에이전트 정체성을 클릭해 에이전트 설정을 연다 | `frontend/src/recovered/features/conversation/workspace/chat-header.tsx` |
| medium | 컴퓨터/정보 컨트롤을 토글해 상세 패널을 연다/닫는다 | `frontend/src/recovered/features/conversation/workspace/chat-header.tsx` |
| low | View the conversation header showing the agent avatar, name, and 'Working' indicator when running | `frontend/src/recovered/features/conversation/workspace/chat-header.tsx` |

## Feedback/overlay  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 피드백 제출이 코드와 함께 실패하면 코드별(access-denied/rate-limited 등) 오류 메시지가 표시된다 | `frontend/src/recovered/features/feedback/overlay/view.tsx` |
| low | Toggle the include-conversation-id checkbox to include/exclude the conversation ID in the submission | `frontend/src/recovered/features/feedback/overlay/view.tsx` |
| low | Observe Cancel disabled and backdrop/escape close disabled while feedback is sending | `frontend/src/recovered/features/feedback/overlay/view.tsx` |

## Settings/notice  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 성공 설정 알림이 발생하면 체크 아이콘 토스트가 표시되고 3.5초 후 자동 소멸한다 | `frontend/src/recovered/features/settings/overlay/notice.tsx` |
| medium | 오류 설정 알림이 발생하면 닫기 아이콘 토스트가 표시되고 6초 후 자동 소멸한다 | `frontend/src/recovered/features/settings/overlay/notice.tsx` |
| low | Click Dismiss on a settings toast to hide it | `frontend/src/recovered/features/settings/overlay/notice.tsx` |

## Threads  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Open a thread via a message's thread chip; in-scope roots scroll to the entry, out-of-scope roots trigger open-thread navigation with focus restored | `frontend/src/recovered/features/conversation/cards/transcript-card/thread-summary-controller.ts` |
| medium | See a reply-count badge on a thread root once a message accrues branched replies | `source/shared/transcript-threads.ts` |
| medium | Open a thread on a branched message to view only that thread's descendants while the main transcript hides threaded messages | `source/shared/transcript.ts` |

## Timeline event card  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | View an automation-changed event card and use its 'Open routine {name}' button | `frontend/src/recovered/features/conversation/cards/timeline-event-automation.tsx` |
| medium | See a compact timeline event card when an agent's name changes | `frontend/src/recovered/features/conversation/cards/timeline-event-registry.ts` |
| medium | See a compact timeline event card when a channel connects | `frontend/src/recovered/features/conversation/cards/timeline-event-registry.ts` |
| medium | See a compact timeline event card when a channel disconnects | `frontend/src/recovered/features/conversation/cards/timeline-event-registry.ts` |
| medium | See a compact timeline event card (calendar icon) when an automation changes | `frontend/src/recovered/features/conversation/cards/timeline-event-registry.ts` |
| low | Observe the Open routine button disabled when the automation id or handler is missing | `frontend/src/recovered/features/conversation/cards/timeline-event-automation.tsx` |

## box  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Throw a blocked error carrying the backend block title/detail and hold for retry-after when connect is blocked | `source/electron-main/box/box-host-connector.ts` |
| low | Backend refuses a computer recreate/update and the unchanged-computer error is shown | `source/electron-main/box/box-host-connector.ts` |
| low | User resets the Computer (force recreate) with no backend connection | `source/electron-main/box/box-recreate-commands.ts` |

## cloud-agent-review  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Show an approval card for a cloud agent cancel in enforce mode | `source/host/runner/sand-cloud-agent-auto-review.ts` |
| medium | Show an approval card for a cloud agent archive in enforce mode | `source/host/runner/sand-cloud-agent-auto-review.ts` |
| medium | Show an approval card for a cloud agent unarchive in enforce mode | `source/host/runner/sand-cloud-agent-auto-review.ts` |
| medium | Show an approval card for a cloud agent rename in enforce mode | `source/host/runner/sand-cloud-agent-auto-review.ts` |
| medium | Require approval for a cloud agent delete with 'Deleting a cloud agent is permanent and cannot be undone' | `source/host/runner/sand-cloud-agent-auto-review.ts` |
| medium | Show an approval card summarizing a risky cloud agent launch in enforce mode | `source/host/runner/sand-cloud-agent-auto-review.ts` |
| medium | Show an approval card summarizing a risky cloud agent reply/follow-up in enforce mode | `source/host/runner/sand-cloud-agent-auto-review.ts` |

## inference  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Error with 'Claude Code is not installed…' when the claude-code provider CLI is missing | `source/host/extensions/inference/provider-session.ts` |
| medium | Error with 'Codex is not signed in with ChatGPT. Run codex login' when codex is not signed in | `source/host/extensions/inference/provider-session.ts` |
| medium | Error with 'OpenRouter needs OPENROUTER_API_KEY. Add it in Settings → Router.' when the key is missing | `source/host/extensions/inference/provider-session.ts` |

## local-tool-permission  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Set global permission to always and grant the request when the user resolves an ask with 'always' | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |
| medium | Set global permission to never and deny the request when the user resolves an ask with 'never' | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |
| medium | Settle a stale permission card, or throw 'no longer waiting for an answer', when resolving a no-longer-pending ask | `source/host/extensions/local-tool-permission/local-tool-permission-resolution.ts` |

## 대화 전송  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Send a message while the bot is awaiting-user-response (wait cleared, bot tray error dismissed) | `source/host/extensions/transcript/send-acceptance.ts` |
| medium | Switch conversation right after sending (entry persisted offscreen to the bot's store, reflected on bot update) | `source/host/extensions/transcript/send-acceptance.ts` |
| medium | Send an offline-composed message later (prompt prefixed '[Composed offline at <ISO>]') | `source/host/extensions/transcript/send-message-shaping.ts` |

## 도구 승인  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Approve the agent's GitHub SCM connection request | `source/packages/agent-core/interaction-queries.ts` |
| medium | Reject the agent's GitHub SCM connection request (with reason) | `source/packages/agent-core/interaction-queries.ts` |
| medium | Approve the agent's web-search request | `source/packages/agent-core/interaction-queries.ts` |
| medium | Reject the agent's web-search request (with reason) | `source/packages/agent-core/interaction-queries.ts` |
| medium | Approve the agent's image-generation request (description included) | `source/packages/agent-core/interaction-queries.ts` |
| medium | Reject the agent's image-generation request (with reason) | `source/packages/agent-core/interaction-queries.ts` |

## 질문 도구  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | allow_multiple 질문에서 여러 선택지를 동시에 고른다 | `source/packages/agent/tools/core/ask-question/index.ts` |
| medium | 질문에 선택 대신 자유 텍스트로 답한다 | `source/packages/agent/tools/core/ask-question/index.ts` |
| medium | 질문을 건너뛰거나 거절해 봇이 기존 정보로 계속하게 한다 | `source/packages/agent/tools/core/ask-question/index.ts` |

## Automations/routines  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click Back in the routines pane to close the editor | `frontend/src/recovered/features/automations/routines/view.tsx` |
| low | Click Close in the routines pane to fire the details-close callback | `frontend/src/recovered/features/automations/routines/view.tsx` |
| low | View the empty-state explanation and 'Create Routine' button when no routines exist | `frontend/src/recovered/features/automations/routines/view.tsx` |
| low | Observe the busy status placeholder while routines are loading | `frontend/src/recovered/features/automations/routines/view.tsx` |

## Plugins/setup  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the submit button disabled while the plugin setup form is busy/pending | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Submit the plugin setup form when it errors and observe the error alert | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Submit the setup form with missing required fields and see fields marked invalid with 'Fill in the required field(s)' | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## Plugins/tools  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe all tool toggle buttons disabled while a toggle is pending | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe the error alert when server tools fail to load | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe the status placeholder while server tools are still loading | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## deep-link  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | A deep link arriving before the renderer is ready is queued and flushed on markReady | `source/electron-main/deep-link/deep-link-controller.ts` |
| low | A deep link arriving while the renderer is not ready with 16 already queued is dropped | `source/electron-main/deep-link/deep-link-controller.ts` |
| low | The same deep link received twice within 2s is deduped and the second dropped | `source/electron-main/deep-link/deep-link-controller.ts` |

## Composer draft  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 작성 중인 초안(프롬프트+첨부)을 두고 다른 채팅으로 이동했다 돌아오면 에이전트/계정별로 보존된 초안이 복원된다 | `frontend/src/recovered/features/conversation/workspace/draft-state.ts` |
| medium | 전송이 실패하면 실패한 제출의 텍스트/첨부가 작성창 초안으로 복구된다 | `frontend/src/production/ProductionRenderer.tsx` |

## Connector card  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 커넥터를 연결한다(Connect) | `frontend/src/recovered/features/conversation/cards/transcript-card/connector-actions.ts` |
| high | 커넥터 플러그인을 설치한다(Install) | `frontend/src/recovered/features/conversation/cards/transcript-card/connector-actions.ts` |
| high | 커넥터 OAuth 인증을 시작해 인증 URL을 연다(Authenticate) | `frontend/src/recovered/features/conversation/cards/transcript-card/connector-actions.ts` |
| high | 커넥터 인증 창을 다시 연다(reopen auth) | `frontend/src/recovered/features/conversation/cards/transcript-card/connector-actions.ts` |
| medium | 추천 관련 커넥터(최대 4개)를 보고 하나를 클릭해 연결한다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connector.tsx` |

## Cursor 로그인  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Cursor 공급자 로그인을 시작해 브라우저 로그인 URL을 열고 승인하면 앱이 accessToken/refreshToken을 받아 로그인이 완료된다 | `source/packages/cursor-config/auth/login.ts` |
| medium | API 키를 입력해 Cursor 토큰으로 교환하면 유효 시 로그인되고 무효 시 실패로 표시된다 | `source/packages/cursor-config/auth/login.ts` |

## Usage & Billing  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Click the requestLimitIncrease upgrade CTA when at/near the usage limit | `source/shared/usage.ts` |
| medium | Click cancel trial on an active cancelable Sand trial to run cancelCursorSandTrial | `source/shared/rpc/main.ts` |

## WindowChrome/shortcuts  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Press Cmd/Ctrl+K to toggle the command palette | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts` |
| medium | Press Alt+Up to select the previous agent | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts` |
| medium | Press Alt+Down to select the next agent | `frontend/src/recovered/features/window-chrome/global-keyboard-shortcuts.ts` |

## wallpaper  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Repaint the desktop wallpaper to the current tone on scheduler start or tone boundary | `source/host/extensions/wallpaper/wallpaper-service.ts` |
| medium | Change the user time zone so the wallpaper re-syncs and repaints for the new local time | `source/host/extensions/wallpaper/wallpaper-service.ts` |

## 계정  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Click the 'Sign in' menu item to run login() | `frontend/src/recovered/features/account/session/menu.tsx` |
| medium | Set the user display name (injected into system prompt, up to 200 chars) | `source/host/sand-user-identity.ts` |

## 대화 작성기 (MCP 참조)  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Insert an MCP server as a tool reference in the composer | `frontend/src/recovered/features/conversation/workspace/editor-mcp-reference-provider.ts` |
| medium | Complete MCP server authentication (composer MCP reference list auto-refreshes on onAuthCompleted) | `frontend/src/recovered/features/conversation/workspace/editor-mcp-reference-provider.ts` |

## 멀티태스크  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Click 'Build in Parallel' to split the plan into parallel build stages | `source/packages/agent/multitask-action-prompt.ts` |
| high | Click 'Start Multitasking' to fork one async self subagent and end the response | `source/packages/agent/multitask-action-prompt.ts` |

## 설정/모델  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Select and save the agent default model | `source/electron-main/main-edge.ts` |
| high | Select and save the computer-use model (or null default) | `source/electron-main/main-edge.ts` |

## 컨텍스트 사용량  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 프롬프트 토큰 사용량 분해(breakdown)를 연다 | `source/packages/agent/utils/prompt-token-breakdown.ts` |
| medium | 컨텍스트 사용 트리에서 항목을 펼쳐 메시지·도구 정의·규칙·스킬·MCP·서브에이전트 노드로 드릴다운하고 토큰 추정치를 확인한다 | `source/packages/agent/utils/prompt-context-usage-tree.ts` |

## 컨텍스트 첨부 - Git diff  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 커밋되지 않은 변경 diff를 첨부한다 | `source/packages/agent/git-diff-processing.ts` |
| high | 현재 브랜치와 main 사이 diff를 첨부한다 | `source/packages/agent/git-diff-processing.ts` |

## 프롬프트 제안  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 턴이 끝나면 후속 프롬프트 제안을 받는다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |
| high | 턴이 끝난 뒤 다음 입력 제안을 받는다 | `source/packages/agent/prompt-suggestion/prompt-suggestion-handler.ts` |

## Agent delete  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | coordinator 호출 실패 상태로 삭제를 확인하면 인라인 실패 경고가 뜨고 다이얼로그가 유지된다 | `frontend/src/production/AgentDeleteConfirmation.tsx` |
| medium | 그룹 또는 단일 에이전트의 삭제 확인창을 열어 대상별 경고 문구를 본다 | `frontend/src/production/AgentDeleteConfirmation.tsx` |

## Computer/info-pane  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 정보 패널을 열면 상세 aside에 컴퓨터 미리보기가 표시된다 | `frontend/src/recovered/features/computer/shell/view.tsx` |
| low | Drag the resize handle to change the info pane width (clamped to min/max) | `frontend/src/recovered/features/computer/shell/view.tsx` |

## Links  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 메타데이터를 지원하는 URL이 채팅에 나타나면 getLinkMetadata가 이를 가져와 미리보기 카드(제목/설명/이미지)를 렌더한다 | `source/shared/rpc/main.ts` |
| medium | 메시지의 외부 링크를 클릭하면 openExternal로 시스템 기본 브라우저에서 열린다 | `source/shared/rpc/main.ts` |

## Plugins/overlay  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 플러그인 로드가 실패하면 오류 텍스트와 Retry 버튼이 표시된다 | `frontend/src/recovered/features/plugins/overlay/desktop-surface.tsx` |
| low | Observe 'Loading the marketplace…' while plugins load with no snapshot | `frontend/src/recovered/features/plugins/overlay/desktop-surface.tsx` |

## Transcript card  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | See a 'This message can't be shown in this version of Grok Bot' fallback for an unrenderable card type/chunk | `frontend/src/recovered/features/conversation/cards/transcript-card/resolver.ts` |
| low | Observe the registry-height placeholder while a lazy card leaf is still loading | `frontend/src/recovered/features/conversation/cards/transcript-card/root.tsx` |

## Transcript load error  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Click Retry on the transcript error to fire onRetry and reload the conversation | `frontend/src/recovered/features/conversation/workspace/transcript-load-error.tsx` |
| medium | See a 'Couldn't load conversation' alert with a Retry button when the transcript fails to load | `frontend/src/recovered/features/conversation/workspace/transcript-load-error.tsx` |

## WebAuthn proxy  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Decline security-key consent so the ceremony fails and consent_declined failure telemetry is recorded | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts` |
| medium | Send cancel to the provider and return a 'security key ceremony timed out…' error when the ceremony exceeds its timeout window | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts` |

## automations/store  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reject upsert/update (return null) when a routine has empty/invalid name, prompt, or trigger | `source/host/automations/automation-store.ts` |
| low | Reach the per-agent automation cap (50) so upsert returns null and the routine is not created | `source/host/automations/automation-store.ts` |

## dock-badge  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Set the dock badge count to the sum of per-agent unread counts (min 1 each) | `source/electron-main/notifications/dock-badge.ts` |
| low | An agent hidden from the sidebar is excluded from the dock badge total | `source/electron-main/notifications/dock-badge.ts` |

## groups/chat  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Select only mentioned members (or all) as responders when a group message uses @name/@everyone/@all | `source/host/groups/group-chat.ts` |
| medium | Raise SandGroupNestingError ('a group cannot contain another group') when nesting a group as a member | `source/host/groups/group-chat.ts` |

## send-message  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Type a free-text answer into a widget with allowCustom:true instead of picking an option | `source/host/runner/tools/send-message-schema.ts` |
| medium | Send a newer message without answering a widget with dismissOnMoveOn:true to auto-dismiss it | `source/host/runner/tools/send-message-schema.ts` |

## 권한 설정 파일  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Configure terminalAllowlist in permissions.json (matching shell commands auto-allowed) | `source/packages/cursor-config/permissions-file-provider.ts` |
| medium | Configure mcpAllowlist in permissions.json (matching MCP items auto-allowed) | `source/packages/cursor-config/permissions-file-provider.ts` |
| medium | Configure autoReview allow_instructions (auto-allow rules applied to auto-review) | `source/packages/cursor-config/project-permissions-file-provider.ts` |
| medium | Configure autoReview block_instructions (auto-block rules applied to auto-review) | `source/packages/cursor-config/project-permissions-file-provider.ts` |

## 대화  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Open a message reply thread (getAgentThread returns thread rooted at the given rootId) | `source/host/host-gateway-api.ts` |
| medium | Send a new message while the bot is responding (in-progress run superseded and replaced) | `source/host/extensions/transcript/send-turn-dispatch.ts` |

## 대화 (답장)  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Switch to a different bot then send (reply auto-detached when scope changes) | `frontend/src/recovered/features/conversation/workspace/reply-thread-controller.ts` |
| medium | View reply-target preview (renders per kind: user-text/assistant-text/image/file/link/missing) | `frontend/src/recovered/features/conversation/workspace/reply-thread-controller.ts` |

## 대화 (이전 기록 로드)  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Scroll to load older history when it fails or is disabled (unavailable hides 'more', other failures shown as olderFailure) | `frontend/src/recovered/features/conversation/workspace/pagination.ts` |
| medium | Load a previous history page (scroll anchor compensated so position holds) | `frontend/src/recovered/features/conversation/workspace/pagination.ts` |

## 대화 복구  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Open a conversation with a corrupted store.db (DB quarantined, rows salvaged/recovered or reset, search reindexed) | `source/host/extensions/session/agent-db-recovery.ts` |
| medium | Open a conversation with a missing store.db root blob (state recovered from last checkpoint, profile name restored) | `source/host/extensions/session/session-maintenance.ts` |

## 도구  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot runs the image generation tool (GENERATE_IMAGE call/result projected as an image card) | `source/host/extensions/transcript/client-side-tool-v2-projection.ts` |
| low | A bot shell command tool run renders a card with approval/deny/permission-denied/timeout/background state plus output and exit code | `source/host/extensions/transcript/client-side-tool-v2-projection.ts` |

## 로컬 도구 권한  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Clear recorded local-tool approval history (approvals reset, prompted again next run) | `source/electron-preload/preload.ts` |
| medium | Leave a local-tool approval request unanswered (shown as pending card, updated to expired after timeout) | `source/host/host-runner-composition.ts` |

## 봇 관리  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇 50개 상태에서 하나 더 만들면 'Agent limit of 50 reached' 오류로 거부된다 | `source/host/extensions/session/session-materialization.ts` |
| low | 이름 없이 새 봇을 만들면 이름이 'Grok'으로 설정되고 업데이트 알림이 기본 켜짐으로 시작한다 | `source/host/extensions/session/session-materialization.ts` |

## 비동기 작업  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | host 재시작 후 비동기 작업 목록을 열면 durable 원장에서 복원된 작업이 running 상태로 병합·정렬 표시된다 | `source/host/extensions/transcript/async-task-union.ts` |
| low | 호스트 재시작 후 남은 백그라운드 작업이 'reattached after a host restart' 설명과 함께 비동기 작업 목록에 시작 시각 순으로 표시된다 | `source/host/runner/turn-observation.ts` |

## 사이드바  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 사이드바에서 각 봇의 마지막 메시지 미리보기를 종류별(텍스트/링크/첨부/위젯/다중첨부)로 다르게 본다 | `source/host/extensions/session/session-projection.ts` |
| medium | 봇 로스터를 불러오면 최근 활동 내림차순으로 정렬되고 읽기 실패한 봇도 복구 요약으로 남는다 | `source/host/extensions/session/session-roster.ts` |

## 사이드바 (봇 미리보기)  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | host 연결이 끊긴 상태에서 봇 미리보기를 보면 working 표시가 억제되고 awaitingUserResponse 시 blocked 마커가 우선된다 | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-header.tsx` |
| medium | 사이드바 봇에 호버하면 아바타·이름·태그·고정·상태 점(working/needs attention/unread/typing)이 표시된다 | `frontend/src/recovered/features/conversation/workspace/sidebar-agent-preview-header.tsx` |

## 응답 스트림  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 멀티스텝 작업 진행 시 stepStarted/stepCompleted(소요시간 포함)로 단계 진행이 표시된다 | `source/packages/agent-core/interaction-updates.ts` |
| medium | 작업 중 활성 git 브랜치가 바뀌면 activeBranchChange 업데이트(경로+브랜치명)로 표시된다 | `source/packages/agent-core/interaction-updates.ts` |

## 자동화  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 수동/UI 트리거 자동화가 실패하면 트레이 알림(제목·상세·액션 버튼)으로 표시되고 반복 발생은 1·2·4·8… 회차에서만 다시 알린다 | `source/host/extensions/transcript/automation-run-path.ts` |
| medium | 자동화 실행 이력에서 host 업데이트로 중단되어 재시작 후 resume 대기로 기록된 상태를 확인한다 | `source/host/extensions/transcript/automation-run-path.ts` |

## Auto-review approval card  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the approval card action buttons disabled when the approval is stale or lacks agent scope | `frontend/src/recovered/features/conversation/cards/transcript-card/views/auto-review-approval.tsx` |
| low | View a settled/expired/failed approval showing a status label instead of action buttons | `frontend/src/recovered/features/conversation/cards/transcript-card/views/auto-review-approval.tsx` |

## Automations/editor  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the name input marked aria-invalid when it is left empty | `frontend/src/recovered/features/automations/routines/view.tsx` |
| low | Observe the "Couldn't save this routine." message when a save fails | `frontend/src/recovered/features/automations/routines/view.tsx` |

## Cloud agent card  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the cloud agent card action buttons disabled when the card is stale or its provider is missing | `frontend/src/recovered/features/conversation/cards/transcript-card/views/cloud-agent.tsx` |
| low | Observe the skeleton/aria-busy placeholder card while cloud agent info is loading | `frontend/src/recovered/features/conversation/cards/transcript-card/views/cloud-agent.tsx` |

## Computer/teach  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click Dismiss to clear the armed teach prompt | `frontend/src/recovered/features/computer/teach-recording/view.tsx` |
| low | View the peer recording label with 'Stop & save' and 'Discard' while recording another agent in preview | `frontend/src/recovered/features/computer/teach-recording/view.tsx` |

## DeepLinks/overlay  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View the deep link source label showing 'Custom protocol (sand://)' or 'HTTPS link' per the link source | `frontend/src/recovered/features/deep-links/overlay/model.ts` |
| low | Click Close (×) to close the deep link dialog | `frontend/src/recovered/features/deep-links/overlay/view.tsx` |
| low | Click Done to close the deep link dialog | `frontend/src/recovered/features/deep-links/overlay/view.tsx` |

## Find in chat  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the Prev/Next buttons disabled when the find-in-chat query has no matches | `frontend/src/recovered/features/conversation/workspace/find-in-chat.tsx` |
| low | Observe inputs, timestamps and reply quotes skipped and not highlighted during find-in-chat | `frontend/src/recovered/features/conversation/workspace/find-in-chat.tsx` |

## Listener connect card  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe 'Checking connection status' while the listener connection status loads | `frontend/src/recovered/features/conversation/cards/transcript-card/views/listener-connect.tsx` |
| low | Observe a 'Connected' status with check-circle when the platform is already connected | `frontend/src/recovered/features/conversation/cards/transcript-card/views/listener-connect.tsx` |

## Plugins/accounts  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the status detail alert on an account status error | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Press Escape in the rename input to cancel the rename | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## Plugins/detail  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click Back in plugin detail to return to the plugin list | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |
| low | Observe the plugin detail action buttons disabled while the item is busy | `frontend/src/recovered/features/plugins/overlay/browser.tsx` |

## Plugins/surface  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Remove a browser item and see the result notice (Removed / team-server / couldn't remove) | `frontend/src/recovered/features/plugins/overlay/desktop.ts` |
| low | Trigger Authenticate and see the success/error status notice | `frontend/src/recovered/features/plugins/overlay/model.ts` |

## RootResilience/connection  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Press Retry while transport is not connected so it is queued and re-run on reconnect with isRetrying held true | `frontend/src/recovered/features/root-resilience/connection-state.ts` |
| low | Observe the roster reconnect notice with Retry while the connection phase is reconnecting | `frontend/src/recovered/features/root-resilience/connection-state.tsx` |

## Secret request card  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the Save securely button disabled when the value is empty/whitespace or the request is pending/stale | `frontend/src/recovered/features/conversation/cards/transcript-card/views/secret-request.tsx` |
| low | View a secret request already provided and see the 'Saved securely and kept private' card with a Saved badge | `frontend/src/recovered/features/conversation/cards/transcript-card/views/secret-request.tsx` |

## Sidebar section delete  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Cancel the section delete dialog to close it without deleting and restore focus | `frontend/src/recovered/features/conversation/workspace/sidebar-section-delete-confirmation.tsx` |
| low | Observe the error alert with the failure message and the dialog staying open when section deletion fails | `frontend/src/recovered/features/conversation/workspace/sidebar-section-delete-confirmation.tsx` |

## WindowChrome/notifications  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click a tray dashboard-action to invoke it and see the success/error notice | `frontend/src/recovered/features/window-chrome/notification-host.tsx` |
| low | Click Copy request ID to copy the request ID and set the data-copied flag | `frontend/src/recovered/features/window-chrome/notification-host.tsx` |

## 정보-аба타  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 설명이 비어 있으면 Generate 버튼이 비활성화된다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |
| low | 크롭 스테이지에서 'Restart'를 누르면 초기 소스 선택 상태로 리셋된다 | `frontend/src/recovered/features/agent-info/avatar-editor/view.tsx` |

## Cloud agents  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 클라우드 에이전트를 취소한다(백그라운드 컴포저에 pause 적용) | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| high | 클라우드 에이전트 이름을 변경한다(rename) | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| high | 클라우드 에이전트를 보관한다(setArchived) | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| high | 클라우드 에이전트를 삭제한다(delete) | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |

## Cloud-agent card  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | cloud agent 카드를 보고 열면 상태/브랜치/변경파일·라인/PR 링크가 표시되고 'Open in Cursor'로 열리며 종료 상태까지 상태가 실시간 폴링된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/cloud-agent-provider.ts` |

## Hooks config / import  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Claude Code 훅 설정 파일을 가져오면 이벤트명을 매핑해 Cursor v1 훅 설정으로 변환한다 | `source/packages/hooks/claude-code-mapper.ts` |

## Terminal/output  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 터미널 출력 패널을 보면 명령·cwd·상태와 읽기전용 선택가능 출력이 표시된다 | `frontend/src/recovered/features/terminal/output/view.tsx` |

## WebAuthn 프록시  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Toggle the WebAuthn proxy on/off | `source/electron-preload/preload.ts` |

## egress 터널  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Toggle the egress tunnel on/off | `source/electron-preload/preload.ts` |
| high | Query the egress tunnel status | `source/electron-preload/preload.ts` |

## hooks/config  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Save a hooks config and get validation errors for an invalid hook type, matcher regex, timeout, or loop_limit | `source/packages/hooks/validators/hooksConfig.ts` |

## models  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Fetch and return the user's available models catalog | `source/electron-main/models/cursor-model-catalog.ts` |

## 계정/체험  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Cancel the Sand trial subscription | `source/electron-main/main-edge.ts` |

## 계획 실행  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Execute a saved plan to auto-generate todos from its phases/todos frontmatter | `source/packages/agent/actions/execute-plan-action-handler.ts` |

## 대화 작성기 (멘션)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Type @ in the composer to open the bot/group mention candidates | `frontend/src/recovered/features/conversation/workspace/editor-suggestion-provider.ts` |

## 대화 작성기 (워크플로)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Search and insert a workflow/automation reference in the composer | `frontend/src/recovered/features/conversation/workspace/editor-suggestion-provider.ts` |

## 대화 작성기 (이모지)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Search and insert an emoji in the composer | `frontend/src/recovered/features/conversation/workspace/editor-suggestion-provider.ts` |

## 레이아웃 (정보 패널)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Toggle the info pane (right panel) open/closed | `frontend/src/recovered/features/conversation/workspace/sidebar-layout-state.ts` |
| high | Adjust the info pane width (280-480 clamp) | `frontend/src/recovered/features/conversation/workspace/sidebar-layout-state.ts` |

## 박스 런타임  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Select and save the box computer runtime mode | `source/electron-preload/preload.ts` |

## 봇 아바타  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | AI-generate a bot avatar image from a text description | `source/electron-preload/preload.ts` |

## 봇/아바타  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | AI-generate a bot avatar image from a description | `source/electron-main/main-edge.ts` |

## 비밀 관리  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | List stored secret keys | `source/electron-preload/preload.ts` |
| high | Reveal a secret value | `source/electron-preload/preload.ts` |
| high | Add/upsert a secret | `source/electron-preload/preload.ts` |
| high | Delete/remove a secret | `source/electron-preload/preload.ts` |

## 설정 (Admin command denylist)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Validate an admin command-block rule and return a specific error (empty, over 512 chars, wildcard-only, colon-without-executable) | `source/packages/utils/admin-command-denylist.ts` |

## 설정/네트워크  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Toggle the egress tunnel on/off and emit the status-changed event | `source/electron-main/main-edge.ts` |

## 설정/박스 런타임  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Switch the box runtime to remote or local-docker | `source/electron-main/main-edge.ts` |

## 셸 명령  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Run a shell command directly via conversation shell-command mode | `source/packages/agent/actions/shell-command-action-handler.ts` |

## 소개(About)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Click 'Copy version info' to copy Version/Release Track/OS to the clipboard | `frontend/src/recovered/features/about/overlay/view.tsx` |

## 에이전트 모드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Pick a mode (Agent/Plan/Debug/Ask/Multitask) from the mode selector | `source/packages/agent/utils/agent-mode-guidance.ts` |

## 워크플로/멘션  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Send a message with a workflow (slash) reference that expands its body | `source/host/extensions/transcript/send-turn-dispatch.ts` |
| high | Send a message @mentioning another bot to inject its context | `source/host/extensions/transcript/send-turn-dispatch.ts` |

## 응답 비교  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Run the same prompt on an alternate model and display the two responses side by side | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |

## 자동화 트리거 (GitHub)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | GitHub 이벤트로 발동하는 자동화를 만든다(이벤트 종류·저장소·허용 목록 지정) | `source/host/extensions/automations/sand-automation-cloud-sync.ts` |

## 자동화 트리거 (Slack)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Slack 이벤트(멘션/키워드/모든 메시지/반응)로 발동하는 자동화를 만든다 | `source/host/extensions/automations/sand-automation-cloud-sync.ts` |

## 자동화 트리거 (외부 서비스)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Linear 이벤트로 발동하는 자동화를 만든다 | `source/host/extensions/automations/sand-automation-cloud-trigger.ts` |
| high | Sentry 이벤트로 발동하는 자동화를 만든다 | `source/host/extensions/automations/sand-automation-cloud-trigger.ts` |
| high | PagerDuty 인시던트 이벤트로 발동하는 자동화를 만든다 | `source/host/extensions/automations/sand-automation-cloud-trigger.ts` |
| high | Microsoft Teams 채널 메시지 이벤트로 발동하는 자동화를 만든다 | `source/host/extensions/automations/sand-automation-cloud-trigger.ts` |

## 전송 (오프라인 큐)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 연결이 끊긴 상태에서 메시지를 전송하면 queued로 대기하고 재연결 시 flush된다 | `frontend/src/recovered/features/conversation/workspace/submission.ts` |

## 창/외부 링크  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 앱 내에서 외부 URL 링크(또는 target=_blank)를 열면 시스템 기본 브라우저로 열린다 | `source/electron-main/main.ts` |

## 창/줌  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Cmd/Ctrl + 로 화면을 확대한다 | `source/electron-main/host-window-chords.ts` |
| high | Cmd/Ctrl - 로 화면을 축소한다 | `source/electron-main/host-window-chords.ts` |
| high | Cmd/Ctrl 0 으로 줌 배율을 초기화한다 | `source/electron-main/host-window-chords.ts` |

## 컨텍스트 요약  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 강제 요약(force)을 요청해 대화를 요약·압축한다 | `source/packages/agent/actions/summarize-action-handler.ts` |

## 컨텍스트 첨부 - Git 커밋  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | git 커밋을 컨텍스트로 첨부한다 | `source/packages/agent/git-commit-processing.ts` |

## 컨텍스트 첨부 - UI 요소  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 실행 중 화면에서 UI 요소(또는 React 컴포넌트)를 선택해 첨부한다 | `source/packages/agent/context-processing-ui-elements.ts` |

## 컨텍스트 첨부 - 브라우저  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 브라우저 탭을 컨텍스트로 첨부하고 전송한다 | `source/packages/agent/context-processing-selected-browsers.ts` |

## 컨텍스트 첨부 - 서브에이전트 위임  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 특정 서브에이전트에게 위임하도록 지정한다 | `source/packages/agent/context-processing-selected-subagents.ts` |

## 컨텍스트 첨부 - 스킬  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 스킬을 대화에 수동으로 첨부한다(/슬래시 또는 첨부) | `source/packages/agent/context-processing.ts` |

## 컨텍스트 첨부 - 외부 링크  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 외부 링크를 첨부한다 | `source/packages/agent/context-processing.ts` |

## 컨텍스트 첨부 - 터미널  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 터미널 출력을 컨텍스트로 첨부한다 | `source/packages/agent/context-processing-terminal.ts` |

## 컴퓨터/클립보드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 호스트 클립보드 텍스트를 봇 컴퓨터(VNC) 화면에 붙여넣는다 | `source/electron-preload/box-vnc-clipboard-paste.ts` |

## 프로젝트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Cursor Project 대화를 시작해 진행 요약(notes.md 작업 목록)을 채팅에서 본다 | `source/packages/agent/prompts/project-prompt.ts` |

## 피드백  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 응답 턴이 끝나면 모델 응답에 대한 피드백 요청 위젯을 본다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |

## Access  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 계정이 Sand를 쓸 수 없는 사유별 차단-접근 상태/메시지를 본다 | `source/shared/sand-access.ts` |

## automations/trigger  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 설정된 트리거 행을 보면 플랫폼별 사람이 읽을 문장으로 표시된다 | `frontend/src/recovered/features/automations/routines/trigger-schema.ts` |

## Connectors list card  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 커넥터 목록 메시지를 보면 커넥터별 상태/액션 카드가 렌더된다 | `frontend/src/recovered/features/conversation/cards/transcript-card/views/connectors.tsx` |

## MCP (Google Workspace OAuth)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Gmail MCP 서버를 연결해 지정 scopes로 OAuth 동의 흐름을 시작한다 | `source/packages/constants/mcp.ts` |
| medium | Drive MCP 서버를 연결해 지정 scopes로 OAuth 동의 흐름을 시작한다 | `source/packages/constants/mcp.ts` |
| medium | Calendar MCP 서버를 연결해 지정 scopes로 OAuth 동의 흐름을 시작한다 | `source/packages/constants/mcp.ts` |
| medium | Docs MCP 서버를 연결해 지정 scopes로 OAuth 동의 흐름을 시작한다 | `source/packages/constants/mcp.ts` |
| medium | Sheets MCP 서버를 연결해 지정 scopes로 OAuth 동의 흐름을 시작한다 | `source/packages/constants/mcp.ts` |
| medium | Slides MCP 서버를 연결해 지정 scopes로 OAuth 동의 흐름을 시작한다 | `source/packages/constants/mcp.ts` |

## MCP 인증  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | MCP OAuth 콜백이 성공하면 'Authorization complete! 이 탭을 닫아도 됩니다' 성공 페이지가 렌더된다 | `source/shared/mcp-oauth-callback-page.ts` |
| medium | MCP OAuth 콜백이 실패하면 'OAuth callback failed' 오류 페이지가 렌더된다 | `source/shared/mcp-oauth-callback-page.ts` |

## Overlays  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 오버레이/팔레트/find/async-tasks가 열린 상태에서 Escape를 누르면 최상위 표면이 find-in-chat→palette→overlay→async-tasks 순으로 닫힌다 | `frontend/src/production/ProductionRenderer.tsx` |

## PR review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | PR 리뷰 대상을 설정하면 사용자>팀 우선순위로 github/graphite/reviewCursor 중 하나로 라우팅된다 | `source/shared/pr-review.ts` |

## Question widget  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | dismissOnMoveOn=true 위젯을 두고 답하지 않은 채 새 메시지를 보내면 위젯이 비활성화되며 'Dismissed' 상태로 바뀐다 | `source/shared/sand-widgets.ts` |

## Security key  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | WebAuthn 요청 시 키를 가진 기기가 끊겨 있으면 'Your computer isn't connected right now, so the security key can't be reached...' 메시지가 표시된다 | `source/shared/webauthn-gateway.ts` |

## Settings overlay  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Settings 표면이 렌더 중 예외를 던지면 빈 화면 대신 Retry·Close 버튼이 있는 에러 바운더리 다이얼로그가 표시된다 | `frontend/src/production/ProductionRenderer.tsx` |

## Settings/overlay  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 설정 스냅샷 로드가 실패하면 패널에 오류 텍스트와 Retry 버튼이 표시된다 | `frontend/src/recovered/features/settings/overlay/desktop-surface.tsx` |

## Smart Mode 권한  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 사용자 수준 자동 실행 allow/block 규칙을 설정한다 | `source/packages/agent/utils/smart-mode-permissions-instructions.ts` |
| medium | 프로젝트 수준 자동 실행 allow/block 규칙을 설정한다 | `source/packages/agent/utils/smart-mode-permissions-instructions.ts` |
| medium | 관리자 수준 자동 실행 allow/block 규칙을 설정하면 사용자·프로젝트 규칙을 무시하고 관리자 override가 적용된다 | `source/packages/agent/utils/smart-mode-permissions-instructions.ts` |

## Timeline  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | See a timeline notice when a conversation is renamed | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when a channel is connected | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when a channel is disconnected | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when an automation is created | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when an automation is updated | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when an automation is enabled | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when an automation is disabled | `source/shared/sand-timeline-events.ts` |
| medium | See a timeline notice when an automation is deleted | `source/shared/sand-timeline-events.ts` |

## UI (모달 대화상자)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Press Escape to close the modal | `frontend/src/recovered/ui/overlay-primitives.tsx` |
| medium | Click the backdrop to close the modal (Ctrl+click excluded) | `frontend/src/recovered/ui/overlay-primitives.tsx` |
| medium | Tab within the modal to trap focus | `frontend/src/recovered/ui/overlay-primitives.tsx` |
| medium | Have previous focus restored when the modal closes | `frontend/src/recovered/ui/overlay-primitives.tsx` |
| medium | Have background scroll locked while the modal is open | `frontend/src/recovered/ui/overlay-primitives.tsx` |

## UI (컨텍스트 메뉴)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Right-click an element to open the context menu at the pointer | `frontend/src/recovered/ui/sand-floating-primitives.tsx` |
| medium | Press Shift+F10 to open the context menu (at element bottom) | `frontend/src/recovered/ui/sand-floating-primitives.tsx` |
| medium | Click outside to close the context menu | `frontend/src/recovered/ui/sand-floating-primitives.tsx` |
| medium | Press Escape to close the context menu | `frontend/src/recovered/ui/sand-floating-primitives.tsx` |

## UI (플로팅 패널 이동)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Drag a floating panel by its header to move it, clamped within viewport margins | `frontend/src/recovered/ui/movable-panel.ts` |
| medium | Press Escape to cancel an in-progress panel drag | `frontend/src/recovered/ui/movable-panel.ts` |
| medium | Have drag not start when grabbing a button inside the header | `frontend/src/recovered/ui/movable-panel.ts` |

## WebFetch 도구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reject a web fetch at the permission prompt so a rejection message is returned and nothing is fetched | `source/packages/agent/tools/core/web-fetch.ts` |

## WebSearch 도구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reject a web search at the permission prompt so a rejection message is returned | `source/packages/agent/tools/core/web-search.ts` |

## WindowChrome/app-alert  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | See a modal alert dialog with title/description/body/warning when an app alert is requested | `frontend/src/recovered/features/window-chrome/app-alert/view.tsx` |

## automation-auto-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Show an approval card summarizing a risky routine write's name/trigger/prompt in enforce mode | `source/host/runner/sand-automation-auto-review.ts` |

## browser-auto-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Show an approval card with a human summary and wait on the user for a risky mutating browser action in enforce mode | `source/host/runner/sand-browser-auto-review.ts` |

## computer-auto-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Show an approval card summarizing a risky mutating computer action and wait on the user in enforce mode | `source/host/runner/sand-computer-auto-review.ts` |

## groups/store  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Keep only the first 6 members via normalizeMemberIds when GROUP_MAX_MEMBERS is exceeded | `source/host/groups/group-store.ts` |

## local-exec/approvals  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Clear all local-tool approvals (delete the approvals file, cancelling every approval) | `source/host/local-exec/local-tool-approvals.ts` |

## mcp-auto-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Raise an approval card summarizing server/tool/args (secrets redacted) for a risky MCP tool call in enforce mode | `source/host/runner/sand-auto-review-tool-escalations.ts` |

## secrets  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Set box secrets that fail validation | `source/host/extensions/secrets/secrets-service.ts` |

## shell-auto-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Review the approval card shown for a shell command classified risky in enforce mode | `source/host/runner/sand-auto-review-tool-escalations.ts` |

## startup  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Launch the packaged macOS app from outside Applications to see the Move/Not Now dialog | `source/electron-main/startup/startup-move-check.ts` |

## stream-retry  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Observe the retry-with-backoff and 'retrying' indicator after a transient mid-turn error | `source/host/runner/stream-attempt.ts` |

## workflows/library  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Create a workflow when at the WORKFLOW_MAX_PER_AGENT limit (creation refused, returns null) | `source/host/workflows/workflow-library.ts` |

## 게이트웨이  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Manually force gateway reconnect (bot connection re-established immediately) | `source/electron-preload/preload.ts` |

## 계정/전환  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Log out (account-scoped MCP/gateway/settings state cleared) | `electron-main/coordinator/account-transition-cleanup.ts + production-root-provider.ts` |
| medium | Switch account (previous account state cleaned up) | `electron-main/coordinator/account-transition-cleanup.ts + production-root-provider.ts` |

## 네임드 에이전트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Send a message in the Named Agent home conversation (self document updated, subscription registered via MCP) | `source/packages/agent/prompts/cloud-meta-agent/index.ts` |

## 대화 (메시지 그룹핑)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | View consecutive same-sender messages (grouped bubble rendering; solo emoji/image-only/url-card excluded) | `frontend/src/recovered/features/conversation/workspace/transcript-adjacency.ts` |

## 대화 가져오기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Import external conversation history into a message (records restored as core messages, user_info replaced if replaceUserInfo) | `source/packages/agent/actions/user-message-action/conversation-history.ts` |

## 대화 데이터  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Open a conversation whose restore blob is missing (shows non-retryable 'data missing' message with blob id) | `source/packages/agent-kv/blob-not-found-error.ts` |

## 대화 작성기 (PR 참조)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | View composer PR reference candidates when history contains PR URLs (merged by node>cloud>text priority) | `frontend/src/recovered/features/conversation/workspace/editor-pr-reference-provider.ts` |

## 대화 작성기 (연결 끊김)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Connection drops while composer candidates load (request cancelled, candidates set unavailable and cleared) | `frontend/src/recovered/features/conversation/workspace/editor-suggestion-provider.ts` |

## 대화 작성기 (후보 랭킹)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Type a composer candidate search term (fuzzy-ranked, recent-first when empty, deduplicated) | `frontend/src/recovered/features/conversation/workspace/editor-suggestion-provider.ts` |

## 동영상 검토  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Attach a review video that is unreadable, over 100MB, or not a container format (fails with 'Cannot read video attachment') | `source/host/runner/prompt-collector-glue.ts` |

## 레이아웃 (경계값)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Adjust sidebar width beyond min/max (clamped to 240-400px expanded, 88px collapsed, saved) | `frontend/src/recovered/features/conversation/workspace/sidebar-layout-state.ts` |

## 링크/외부  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | View link metadata/preview for a URL | `source/electron-preload/preload.ts` |
| medium | Open a URL or cloud bot in the external browser | `source/electron-preload/preload.ts` |

## 메뉴  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Select Reload from the app menu (reloads) | `source/electron-main/application-menu.ts` |
| medium | Select Toggle Full Screen (toggles fullscreen) | `source/electron-main/application-menu.ts` |
| medium | Select Help Center (opens cursor.com/help externally) | `source/electron-main/application-menu.ts` |
| medium | Select Send Feedback (opens feedback overlay) | `source/electron-main/application-menu.ts` |
| medium | Select About (opens about overlay) | `source/electron-main/application-menu.ts` |

## 모델 선택/라우팅  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Set a routing model (default/premium/auto-*) as default model (applied without params, rejected if params added) | `source/shared/node/experiments/sand-model-config.ts` |

## 박스 저장소 (.sandignore)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Sync/archive a box workspace (default ignore patterns applied, overridable via .sandignore) | `source/packages/constants/sand-box-archive.ts` |

## 박스 차단  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Backend killswitch blocks box access (cover with reason/title/detail shown, incl. privacy-mode no_storage/access_denied) | `source/shared/gateway-reachability.ts` |

## 복구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot resume fails after host update (tray shows 'Agent failed to resume after host update') | `source/host/extensions/transcript/upgrade-recreate-resume.ts` |

## 봇 삭제  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇을 삭제하면 공유 항목이 정리된다 | `source/host/host-gateway-api.ts` |
| medium | 봇을 삭제하면 자동화 일정이 삭제된다 | `source/host/host-gateway-api.ts` |
| medium | 봇을 삭제하면 봇 컴퓨터가 해제된다 | `source/host/host-gateway-api.ts` |
| medium | 봇을 삭제하면 핸드오프가 망각된다 | `source/host/host-gateway-api.ts` |
| medium | 봇을 삭제하면 로컬 도구 권한이 망각된다 | `source/host/host-gateway-api.ts` |
| medium | 봇을 삭제하면 notification-agent-forgotten 이벤트가 발생한다 | `source/host/host-gateway-api.ts` |

## 봇 상태  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇 실행 모드(default/plan/debug/search)를 설정하면 메타데이터로 지속되어 다음 실행에 복원된다 | `source/packages/agent-kv/agent-store.ts` |

## 봇 생성  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | New 버튼을 같은 nonce로 중복 눌러도 clientNonce로 합쳐져 봇이 하나만 만들어진다 | `source/host/host-gateway-api.ts` |

## 사용량 (Auto-spillover)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 사용량 화면에서 'Cursor Models'/'Other Models' 두 묶음과 한도 문구·사용량 바 라벨을 본다 | `source/packages/constants/auto-spillover-ui.ts` |

## 사이드바 (섹션 쓰기 실패)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 사이드바 섹션 변경 저장이 실패하면 write-failed 오류를 노출하고 이전 상태로 롤백 후 재로드한다 | `frontend/src/recovered/features/conversation/workspace/sidebar-sections-state.ts` |

## 설정/보안  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | WebAuthn proxy를 켜면 미러 값이 최대 3회 재시도로 컴퓨터에 동기화된다 | `source/electron-main/main-edge.ts` |
| medium | WebAuthn proxy를 끄면 미러 값이 최대 3회 재시도로 컴퓨터에 동기화된다 | `source/electron-main/main-edge.ts` |

## 설정/컴퓨터  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇 컴퓨터 런타임을 remote로 설정하면 저장되어 다음 실행에 유지된다 | `source/shared/box-runtime.ts + source/shared/node/settings/sand-settings-store.ts` |
| medium | 봇 컴퓨터 런타임을 local-docker로 설정하면 저장되어 다음 실행에 유지된다 | `source/shared/box-runtime.ts + source/shared/node/settings/sand-settings-store.ts` |

## 승인  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 위젯/비밀요청/auto-review 승인 메시지를 보내면 턴이 awaitingUserSelection 상태로 전환된다 | `source/host/runner/sand-agent-runner.ts` |

## 시작/macOS  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | macOS에서 Applications 밖에서 처음 실행하면 이동 확인 대화상자를 띄우고 승인 시 이동 후 재실행한다 | `source/electron-main/production-binding-providers.ts` |

## 시작/단일 인스턴스  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 이미 실행 중인데 앱을 다시 실행하면 새 창 없이 기존 창을 복원·포커스한다 | `source/electron-main/main.ts` |

## 알림/OS  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | OS 알림을 클릭하면 해당 봇으로 포커스가 이동한다 | `source/electron-main/production-binding-providers.ts` |

## 알림/독  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 읽지 않은 항목이 있으면 독/작업표시줄에 미확인 수 배지가 표시되고 초기화 시 사라진다 | `source/electron-main/production-binding-providers.ts` |

## 업데이트/무결성  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 업데이트 파일을 다운로드하면 진행률을 보고하고 SHA256 불일치 시 실패 처리 후 파일을 삭제한다 | `source/electron-main/update/update-download.ts` |

## 오류 (박스 차단)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | kill-switch로 차단된 봇 컴퓨터 작업을 실행하면 box_blocked 실패의 사유/제목/상세가 표시용으로 파싱·노출된다 | `frontend/src/recovered/runtime/coordinator-source.ts` |

## 오류 (에이전트 한도)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇을 50개 초과해 만들려 하면 '50 is the maximum' 응답이 agent-limit-reached 오류로 변환되어 표시된다 | `frontend/src/recovered/runtime/coordinator-source.ts` |

## 외부 링크  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 메시지 안의 외부 URL을 열면 http/https/mailto/obsidian/tel 스킴만 열리고 그 외는 거부된다 | `source/shared/external-url-policy.ts` |

## 일시정지  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | client-pause 킬스위치가 켜지면 창 전체가 '일시정지된 컴퓨터' 커버로 대체되고 박스 연결이 끊기며, 꺼지면 자동 복귀한다 | `source/shared/gateway-reachability.ts` |

## 임베디드 브라우저  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 웹뷰 내 passkey 요청이 60초 이상 멈추면 NotAllowedError로 실패하고 sand:browser-passkey-stalled가 보고된다 | `source/electron-preload/preload-browser-base.ts` |

## 자동화 동기화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 클라우드 루틴 동기화 실패 트레이 오류 알림을 확인한다 | `source/host/extensions/automations/extension.ts` |

## 자동화 실행  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 자동화 실행 이력에서 Sand host 업데이트로 중단 후 박스 로컬 재개 상태를 확인한다 | `source/host/extensions/automations/sand-automation-fire-consumer.ts` |

## 자동화 트리거  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Slack 이벤트(멘션/키워드/메시지/반응) 트리거를 구성한다 | `source/shared/automations.ts` |
| medium | GitHub 이벤트(PR·CI·리뷰 등 14종) 트리거를 구성한다 | `source/shared/automations.ts` |
| medium | Microsoft Teams 이벤트 트리거를 구성한다 | `source/shared/automations.ts` |
| medium | Linear 이벤트 트리거를 구성한다 | `source/shared/automations.ts` |
| medium | Sentry 이벤트 트리거를 구성한다 | `source/shared/automations.ts` |
| medium | PagerDuty 이벤트 트리거를 구성한다 | `source/shared/automations.ts` |

## 자동화/채널  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 미연결 listener 플랫폼(Slack/GitHub) 트리거로 루틴을 저장해 연결 카드를 띄운다 | `source/host/host-runner-composition.ts` |

## 저장소 없음  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 저장소 없이 봇을 시작해 코드 작업을 요청하고 저장소 접근 안내를 받는다 | `source/packages/agent/prompts/cloud/no-repository-access.ts` |

## 전송 (승인 정리)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 메시지를 전송해 대기 중 승인이 자동 정리(clearApprovals)되게 한다 | `frontend/src/recovered/features/conversation/workspace/send-journal-approval-lifecycle.ts` |

## 전송 (직렬화)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 같은 봇에 연속으로 여러 메시지를 전송해 큐 직렬 전송되게 한다 | `frontend/src/recovered/features/conversation/workspace/submission.ts` |

## 중단 복구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 실행 중 도구를 중단해 중단 메시지와 수집된 부분 출력을 도구 결과로 확인한다 | `source/packages/agent/actions/user-message-action/interrupted-tool-reconstruction.ts` |

## 창/단축키  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | F11/Cmd+Ctrl+F로 전체화면을 토글한다 | `source/electron-main/window-shortcuts.ts` |
| medium | Cmd/Ctrl+R로 새로고침한다 | `source/electron-main/window-shortcuts.ts` |
| medium | Cmd/Ctrl+Q로 종료한다 | `source/electron-main/window-shortcuts.ts` |

## 창/크기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 창 가장자리를 드래그해 너비를 512dip~작업영역 폭으로 조절한다 | `source/electron-main/window-chrome.ts` |

## 창/플랫폼 수명주기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | macOS에서 모든 창을 닫아도 앱이 종료되지 않게 한다 | `source/electron-main/main.ts` |
| medium | macOS 독 아이콘을 다시 클릭해 창을 재생성한다 | `source/electron-main/main.ts` |

## 채널/리스너  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 연결 카드에서 Slack을 연결해 리스너가 자동 재개되게 한다 | `source/host/extensions/automations/listener-connect-watcher.ts` |
| medium | 연결 카드에서 GitHub를 연결해 리스너가 자동 재개되게 한다 | `source/host/extensions/automations/listener-connect-watcher.ts` |

## 첨부 (이미지 리사이즈)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 큰 이미지를 첨부해 전송하면 최대 1024px(webp 1280px)/1MB 이하로 자동 축소되어 전달된다 | `source/packages/utils/image-resize.ts` |

## 첨부/링크  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | URL을 붙여넣어 링크 제목/설명 등 미리보기 정보를 가져온다 | `source/electron-main/main-edge.ts` |

## 추론 오류  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 추론 중 인증 만료/미로그인 오류가 재로그인 유도 흐름으로 라우팅된다 | `source/packages/agent-client/errors.ts` |

## 컴퓨터 관리  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇 컴퓨터 디스크 압박 수준이 box-disk-pressure 이벤트로 데스크톱 배너에 표시된다 | `source/host/sand-host.ts` |

## 클라우드 봇  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 클라우드 봇을 시스템 브라우저에서 열어 cursor.com/agents URL로 이동한다 | `source/electron-main/main-edge.ts` |

## 턴 루프  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트 작업 중 후속 메시지를 보내 대기열에 넣고 새 턴으로 이어 처리한다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |

## 테스트/증거  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | /no-test 슬래시 명령을 써서 테스트를 생략한다 | `source/packages/agent/prompts/testing/parent.ts` |
| medium | 말로 테스트 생략을 요청해 테스트를 생략하고 /no-test 안내를 받는다 | `source/packages/agent/prompts/testing/parent.ts` |

## 플러그인 설치 실패  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | View a failed marketplace plugin shown in the list with its loadError message instead of appearing as loaded | `source/packages/cursor-plugins/loader.ts` |

## Account menu  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Choose Help Center from the account menu to open cursor.com/help in the external browser | `frontend/src/production/ProductionRenderer.tsx` |
| low | Choose Get Grok Bot for iOS from the account menu to open the iOS App Store listing | `frontend/src/production/ProductionRenderer.tsx` |
| low | Choose Usage from the account menu to open the spending dashboard | `frontend/src/production/ProductionRenderer.tsx` |

## Computer/fullscreen  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the 'needs you' label and attention dot on a monitor thumbnail requiring handoff attention | `frontend/src/recovered/features/computer/shell/view.tsx` |

## Computer/handoff-card  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View a non-waiting handoff card showing its status label (Done/Answered/Skipped/unavailable) and 'Open computer' | `frontend/src/recovered/features/computer/shell/model.ts` |

## Computer/header  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the computer header control showing the 'in use' label/state while the computer is active | `frontend/src/recovered/features/computer/shell/view.tsx` |

## ErrorBoundary  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click Copy error to copy the formatted error+stack and see the button show 'Copied' | `frontend/src/recovered/features/error-boundary/view.tsx` |

## Plugins/github-auth  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the Fix button showing 'Opening…' and disabled while launching | `frontend/src/recovered/features/plugins/overlay/github-auth-banner.tsx` |

## Send preview  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View the sidebar last-message preview showing a type-specific summary for a non-text last item | `source/shared/send-message-preview.ts` |

## Settings/router  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the provider select disabled while a router change is pending | `frontend/src/recovered/features/settings/overlay/panels.tsx` |

## Sidebar list  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the listStatus node shown in place of the agent list when provided | `frontend/src/recovered/features/conversation/workspace/sidebar.tsx` |

## Sidebar preview  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View an agent row whose non-text last entry renders as 'Sent a link · <url>' or 'Sent N file(s)' | `frontend/src/production/model.ts` |

## Transcript card frame  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View a card wrapped in the matching frame variant (tab/link/file/none) for its attachment class | `frontend/src/recovered/features/conversation/cards/transcript-card/root.tsx` |

## Update/pill  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the update pill progress spinner while an update is downloading/staging | `frontend/src/recovered/features/update/status/pill.tsx` |

## Widget card  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe widget options and dismiss disabled (canAct false) when the widget is stale/response pending or has no agent scope | `frontend/src/recovered/features/conversation/cards/transcript-card/views/widget.tsx` |

## Window  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Change the host zoom factor with Ctrl +/- and have the renderer apply the new zoom to the shell | `frontend/src/production/ProductionRenderer.tsx` |

## WindowChrome/root-shell  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View an empty workspace and see 'No chats yet' | `frontend/src/recovered/features/window-chrome/root-shell-state.tsx` |

## WindowChrome/status  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the status dot showing working/info/offline with a label for the transport state | `frontend/src/recovered/features/window-chrome/status-badge.tsx` |

## WindowChrome/workspace  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | View the header workspace name heading when a workspace label is present and not fullscreen | `frontend/src/recovered/features/window-chrome/workspace-indicator.tsx` |

## content-search  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Searching with an empty/whitespace query returns an empty result list | `source/host/extensions/transcript/roster-search.ts` |

## vnc  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | A pinch/keyboard zoom attempt in the box-VNC guest webview is pinned to 1x and routed to the host | `source/electron-main/vnc/vnc-trust.ts` |

## 계정/개인정보  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | getCursorPrivacyModeEnabled returns the privacy-mode on/off state for display | `source/electron-main/main-edge.ts` |

## 계정/대시보드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | invokeCursorDashboardAction executes the requested account dashboard action | `source/electron-main/main-edge.ts` |

## 계정/설정  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | getCursorPrReviewPreferences returns the user's PR review settings | `source/electron-main/main-edge.ts` |

## 대화 카드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Bot-sent draft/approval/permission cards are excluded from reply_to threading and rendered with type-specific fields | `source/host/extensions/transcript/send-message-shaping.ts` |

## 레이아웃 (손상 복구)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 손상된 레이아웃 저장값으로 앱을 열면 envelope가 삭제되고 기본 레이아웃으로 복구된다 | `frontend/src/recovered/features/conversation/workspace/sidebar-layout-state.ts` |

## 레이아웃 (이전 버전 이관)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 구버전 레이아웃 저장값으로 앱을 열면 현재 schema-3로 이관되고 옛 키가 제거된다 | `frontend/src/recovered/features/conversation/workspace/sidebar-layout-state.ts` |

## 메시지  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 봇 답변의 mermaid 코드블록이 채팅에서 다이어그램으로 렌더링된다 | `source/host/runner/system-prompt.ts` |
| low | 봇 답변의 수학이 KaTeX로 렌더링된다 | `source/host/runner/system-prompt.ts` |

## 봇 한도  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 봇을 50개 넘게 만들려 하면 '50 is the maximum' 한도 오류가 표시된다 | `source/shared/agents/agents.ts` |

## 설정 (프라이버시 모드)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 프라이버시 모드를 설정하면 모드에 따라 코드·경로·자격증명의 저장/학습 여부가 달라지고 민감 데이터가 리댁션된다 | `source/packages/redaction/privacy-mode.ts` |

## 업데이트/프롬프트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | footer pill에 업데이트 프롬프트가 나타난다 | `source/electron-main/update/update-telemetry.ts` |
| low | account menu에 업데이트 프롬프트가 나타난다 | `source/electron-main/update/update-telemetry.ts` |
| low | 커맨드 palette에 업데이트 프롬프트가 나타난다 | `source/electron-main/update/update-telemetry.ts` |
| low | settings에 업데이트 프롬프트가 나타난다 | `source/electron-main/update/update-telemetry.ts` |
| low | blocker 표면에 업데이트 프롬프트가 나타난다 | `source/electron-main/update/update-telemetry.ts` |

## 응답 스트리밍  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 응답 텍스트/사고/도구인자가 스트리밍되면 약 4자당 1토큰으로 tokenDelta가 실시간 갱신되어 사용 토큰이 증가 표시된다 | `source/packages/agent/interaction-handler.ts` |

## 창/타이틀바  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 컴퓨터 뷰로 전환하면 Windows 타이틀바 오버레이 높이/색이 컴퓨터 모드용으로 변경된다 | `source/electron-main/window-chrome.ts` |

## 첨부 요약  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 봇이 여러 파일을 보내면 '파일 N개 보냄 · 이미지 2개, PDF 1개'처럼 종류별 요약 문구로 표시된다 | `source/shared/media/attachment-summary.ts` |

## 컨텍스트 첨부 - PR  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Pull Request를 컨텍스트로 첨부하면 <attached_pull_requests>에 PR 번호/제목/URL/브랜치/설명(500자 절단)/파일 목록과 all.diff·diffs·summary.json 폴더 안내가 포함된다 | `source/packages/agent/git-pr-processing.ts` |

# [AGENT_REACHABLE] 모델(에이전트)  — 405행 / 441원자


## mcp-management  (16행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return a valid-https-endpoint validation message for AddMcpServer with an invalid or non-http(s) url | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Refuse AddMcpServer with credentials in the url, directing to pass them as headers instead | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Attempt any MCP mutation while a question widget is awaiting the user's selection | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call AuthenticateMcpServer on a server whose check endpoint is unreachable | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call AuthenticateMcpServer with force_reauth on an already-authed server | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call GetPlugin with an unknown plugin id | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call InstallPlugin where a bundled connector still needs authentication | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call UninstallMcpServer on a plugin-owned server | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call UninstallMcpServer on a team-provided server | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call UninstallMcpServer with an unknown server id | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| medium | Call UninstallPlugin on a team-required plugin | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| low | The agent calls AuthenticateMcpServer on an already-authenticated server and gets an 'already authenticated' card | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| low | The agent calls SearchPlugins with a non-matching query and gets 'No plugins match' | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| low | The agent calls SearchPlugins with no query and gets the whole catalog sorted by name | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| low | The agent calls SetMcpInstructions with an empty string and custom instructions clear to the connector default | `source/host/runner/tools/sand-mcp-management-tools.ts` |
| low | The agent calls UninstallPlugin on a plugin not installed and gets 'not installed — nothing to uninstall' | `source/host/runner/tools/sand-mcp-management-tools.ts` |

## Task/Subagent 도구  (15행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Task/Subagent의 model 파라미터로 서브에이전트 모델을 지정(또는 inherit)하면 허용 목록 내면 실행되고 미허용이면 유효성 오류가 난다 | `source/packages/agent/tools/task-cluster-internal.ts` |
| high | Task/Subagent의 resume 파라미터로 이전 에이전트에 후속 메시지를 보내 이전 컨텍스트를 이어 작업한다 | `source/packages/agent/tools/task-subagent-preparation.ts` |
| high | Task 도구로 subagent_type을 지정해 서브에이전트를 실행하면 작업 후 최종 응답을 반환한다 | `source/packages/agent/tools/task.ts` |
| medium | Return a 'connection closed, usually transient, retry' error when a subagent link drops before completion | `source/packages/agent/tools/task-client.ts` |
| medium | Return a 'must wait for completion' error (with interrupt-retry hint) when resuming a running async agent without interrupt | `source/packages/agent/tools/task-client.ts` |
| medium | Return a 'only valid when cloud' validation error when cloud_base_branch is set with environment≠cloud | `source/packages/agent/tools/task-cluster-internal.ts` |
| medium | Return a 'specify machine only' validation error when both machine and legacy environment are given | `source/packages/agent/tools/task-cluster-internal.ts` |
| medium | Return a no-usable-model error listing allowed model slugs when no model is available for the subagent | `source/packages/agent/tools/task-cluster-internal.ts` |
| medium | Return a 'server-side execution required, unsupported' error when a client-run Task requests self-hosted machine placement | `source/packages/agent/tools/task-cluster-internal.ts` |
| medium | Pass images/videos via file_attachments so files are read and attached to the subagent context | `source/packages/agent/tools/task-subagent-preparation.ts` |
| medium | Return a policy-model-mismatch validation error when resuming with a model disallowed by parentPin policy | `source/packages/agent/tools/task-subagent-preparation.ts` |
| medium | Fork the parent conversation into a new subagent via resume='self', seeding it with the full parent history | `source/packages/agent/tools/task-subagent-preparation.ts` |
| medium | Throw a 'video attachments only supported on Gemini models' error when a video is attached to a non-Gemini model | `source/packages/agent/tools/task-subagent-preparation.ts` |
| medium | Throw an 'attachment path not trusted' error when attaching a file from an untrusted path | `source/packages/agent/tools/task-subagent-preparation.ts` |
| medium | Specify environment=cloud to place the Task on a cloud VM | `source/packages/agent/tools/task-tool-schema.ts` |
| medium | Specify machine=own to run the Task on the user's own machine | `source/packages/agent/tools/task-tool-schema.ts` |
| medium | Specify machine placement on a self-hosted worker | `source/packages/agent/tools/task-tool-schema.ts` |
| medium | Specify machine placement into a worker pool | `source/packages/agent/tools/task-tool-schema.ts` |

## Transcript  (13행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Wake the agent and run a hidden turn when an inbound channel message arrives | `source/host/extensions/transcript/background-wakes.ts` |
| medium | Resume the agent to confirm the connection when a Slack/GitHub listener finishes connecting | `source/host/extensions/transcript/box-handoff-resume.ts` |
| medium | Resume the agent to report the server connected when an MCP server finishes authorizing | `source/host/extensions/transcript/box-handoff-resume.ts` |
| medium | Wake the agent with the command outcome when a background shell command finishes | `source/host/extensions/transcript/completion-revivals.ts` |
| medium | Wake the parent agent when a background subagent finishes so it may SendMessage the result | `source/host/extensions/transcript/completion-revivals.ts` |
| medium | Run a group turn so members respond in bounded round-robin and stream into the room | `source/host/extensions/transcript/group-chat-orchestrator.ts` |
| medium | Agent posts to a group it belongs to (returns 'Posted to "{group}".') | `source/host/extensions/transcript/shared-rooms.ts` |
| medium | Agent sends a message addressed to a channel for delivery to that channel | `source/host/extensions/transcript/turn-runtime.ts` |
| low | An agent messaging a nonexistent agent gets 'That agent no longer exists.' / 'No agent found with id …' | `source/host/extensions/transcript/agent-to-agent-messaging.ts` |
| low | An agent messaging itself gets "An agent can't message itself." | `source/host/extensions/transcript/agent-to-agent-messaging.ts` |
| low | Setting members on a shared-room-backed group makes no change and returns the current stamped summary | `source/host/extensions/transcript/group-chat-glue.ts` |
| low | An agent posting to a group it is not a member of gets "You can only post to a group you're a member of." | `source/host/extensions/transcript/shared-rooms.ts` |
| low | A turn ending without any SendMessage delivery runs up to 3 hidden reply-nudge turns to get the agent to deliver | `source/host/extensions/transcript/turn-runtime.ts` |

## send-message  (12행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | SendMessage with a channel address (text/attachment) to the messaging channel | `source/host/runner/tools/send-message-schema.ts` |
| high | SendMessage type=attachment with a url to send a standalone file/media | `source/host/runner/tools/send-message-tool.ts` |
| high | SendMessage type=widget to show an interactive question card with 1-6 options and end the turn | `source/host/runner/tools/send-message-tool.ts` |
| medium | Call SendMessage type=attachment with no or an invalid url | `source/host/runner/tools/send-message-schema.ts` |
| medium | Call SendMessage type=text with attached images | `source/host/runner/tools/send-message-schema.ts` |
| medium | Call SendMessage type=text with no content | `source/host/runner/tools/send-message-schema.ts` |
| medium | Call SendMessage with reply_to set to thread to an earlier message | `source/host/runner/tools/send-message-schema.ts` |
| medium | Call SendMessage type=cursor-agent with a bcId to show a Cursor cloud-agent card | `source/host/runner/tools/send-message-tool.ts` |
| medium | Call SendMessage type=secret-request to show a masked secure input | `source/host/runner/tools/send-message-tool.ts` |
| medium | Call SendMessage while the turn is already awaiting the user | `source/host/runner/tools/send-message-tool.ts` |
| low | A SendMessage carrying a field that doesn't match its type fails validation: nothing sent, re-send as separate typed messages | `source/host/runner/tools/send-message-schema.ts` |
| low | A SendMessage with images on a non-text type fails validation: images can only be set for type:text | `source/host/runner/tools/send-message-schema.ts` |

## Cloud agents  (11행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | cloud agent launch 후 awaitCompletion을 호출하면 10초 폴링으로 완료/에러/브랜치/PR/변경통계 요약을 받는다 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts` |
| high | cloud agent 산출물 목록(listArtifacts)을 조회해 경로와 크기(bytes) 목록을 받는다 | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| high | cloud agent 전사 덤프(getTranscriptDump)를 요청해 JSONL 문자열과 라인 수/상태를 받는다 | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| medium | 모델 카탈로그(listModels)를 조회하면 5분 캐시로 모델 목록을 반환한다 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts` |
| medium | 완료 대기 중 5시간이 지나도 끝나지 않으면 'still running' 타임아웃을 error로 반환한다 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts` |
| medium | 존재하지 않는 저장 환경 id/name으로 launch하면 사용 가능한 환경 목록 안내 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agent-poll-loop.ts` |
| medium | model 없이 model_params만 주고 launch하면 'model is required' 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agent-request-composition.ts` |
| medium | model 없이 model_params만 주고 reply하면 'model is required' 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agent-request-composition.ts` |
| medium | repo_url 없이(저장 환경도 없이) launch하면 'repo_url is required' 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agent-request-composition.ts` |
| medium | named private worker 환경에 starting_ref를 지정해 launch하면 특정 ref 시작 불가 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| medium | self-hosted pool 환경인데 활성 팀이 없으면 'requires an active team' 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |
| medium | 활성 팀이 여러 개인데 team_id 미지정으로 launch하면 team_id 지정 안내 오류를 던진다 | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |

## browser-tool  (11행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Mark the tool result isError with the driver's error text when a browser action returns ok:false | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Return 'The box has not assigned this agent a browser window yet; try again in a moment' when no window is assigned | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Return 'Could not install the browser driver on the box: ...' when the browser driver fails to install | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Deny browser_cdp Input.*/browser-wide/storage/cookie/target commands, directing to dedicated tools | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Fail browser_click validation with 'ref is required' when no ref is provided | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Fail browser_drag validation with 'sourceRef is required' when no sourceRef is provided | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Fail browser_mouse_click_xy validation with 'x is required'/'y is required' when x or y is missing | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Fail browser_navigate validation with 'url is required' when no url is provided | `source/host/runner/tools/sand-browser-tools.ts` |
| medium | Fail browser_tabs validation with 'action must be one of list, new, close, select' for an out-of-enum action | `source/host/runner/tools/sand-browser-tools.ts` |
| low | A browser action returns a screenshot and the result renders as an image (text otherwise) | `source/host/runner/tools/sand-browser-tools.ts` |
| low | The agent calls browser_navigate with newTab:true and the URL opens in a new tab | `source/host/runner/tools/sand-browser-tools.ts` |

## memory  (11행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Agent clears its own avatar via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent creates a project via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent joins a project via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent leaves a project via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent removes a memory by exact content via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent sets an avatar image over 5MB or empty via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent updates its own profile name or description via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent updates its own hiddenFromSidebar/notifyOnAgentUpdates settings via the state tool | `source/host/extensions/memory/agent-state.ts` |
| medium | Agent writes a memory in agent scope via the state tool | `source/host/extensions/memory/agent-state.ts` |
| low | The agent removes a memory whose text does not exactly match and gets 'no fact with exactly that text is recorded' | `source/host/extensions/memory/agent-state.ts` |
| low | The agent sets an avatar that is not a recognized image type and gets 'that file is not a recognized image' | `source/host/extensions/memory/agent-state.ts` |
| low | The agent writes a memory in project scope without having joined it and gets 'you haven't joined project … Join it first' | `source/host/extensions/memory/agent-state.ts` |
| low | The agent writes a memory that is empty or already recorded and gets 'nothing was saved … empty or already recorded' | `source/host/extensions/memory/agent-state.ts` |

## update-state  (9행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Save a routine whose trigger platform isn't connected to emit a listener-connect card and note | `source/host/runner/tools/listener-connect-cards.ts` |
| medium | Call update_state profile.set to change the agent's own name or description | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state project.create to create and join a project | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state project.join to join a project | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state project.leave to leave a project | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state routine.create classified risky in enforce mode (shows confirmation card) | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state routine.update classified risky in enforce mode (shows confirmation card) | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state routine.create/update passing both schedule and trigger (error) | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state routine.update with an id that doesn't exist | `source/host/runner/tools/sand-state-tool.ts` |
| medium | Call update_state while an auto-review approval is pending | `source/host/runner/tools/sand-state-tool.ts` |
| low | The agent calls update_state avatar.clear and the picture reverts to the default | `source/host/runner/tools/sand-state-tool.ts` |
| low | update_state with a target/action pair that isn't a valid route errors, listing the valid actions for that target | `source/host/runner/tools/sand-state-tool.ts` |

## 로컬 셸 도구  (8행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Bot runs a shell command and streams start/stdout/stderr/exit events | `source/packages/local-exec/shell-stream.ts` |
| high | Transition a BACKGROUND command to background on foreground timeout (backgrounded event) | `source/packages/local-exec/shell-stream.ts` |
| high | Force a running foreground shell to background by toolCallId | `source/packages/local-exec/shell-stream.ts` |
| high | Reject an admin-denylisted command with a block reason | `source/packages/local-exec/shell-stream.ts` |
| high | Block a permission-denied shell command (permissionDenied event with isReadonly) | `source/packages/local-exec/shell-stream.ts` |
| medium | Run a command under workspace_readonly/readwrite sandbox policy (cursor-ignore mapping merged, marked sandboxed=true) | `source/packages/local-exec/shell-stream.ts` |
| medium | Request a sandbox policy unsupported by the platform (sandboxUnsupported event returned, command not run) | `source/packages/local-exec/shell-stream.ts` |
| medium | Foreground command exceeds the 30s default timeout (aborted, exit marked TIMEOUT) | `source/packages/local-exec/shell-timeout.ts` |

## Shell 도구  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Auto-review(smart-mode) 분류기가 에이전트의 셸 명령을 차단하면 사유와 함께 거부된다 | `source/packages/agent/tools/core/shell/create-shell-tool.ts` |
| high | Shell 도구를 is_background=true 또는 block_until_ms=0으로 실행하면 백그라운드로 시작되고 Shell ID/PID/출력 파일 경로를 받는다 | `source/packages/agent/tools/core/shell/create-shell-tool.ts` |
| high | Shell 도구 required_permissions에 full_network/all/git_write를 요청하면 샌드박스 정책이 상향되어 명령이 실행된다 | `source/packages/agent/tools/core/shell/create-shell-tool.ts` |
| high | Shell 도구로 터미널 명령을 실행하면 exit code, stdout/stderr, 실행 시간이 포맷되어 반환된다 | `source/packages/agent/tools/core/shell/create-shell-tool.ts` |
| high | 셸로 UI 자동화 도구(xdotool/puppeteer/playwright/--remote-debugging 등)를 실행하면 차단하고 Computer 도구 사용을 지시하는 사유를 반환한다 | `source/packages/agent/tools/core/shell/model-facing-ui-automation-guard.ts` |
| medium | 명령 출력이 20000자를 넘거나 파일로 기록되면 truncate 표시 또는 출력 파일 경로(크기/라인 수)가 반환된다 | `source/packages/agent/tools/core/shell/formatters.ts` |
| medium | notify_on_output 패턴을 설정해 명령을 감시하면 stdout/stderr가 패턴에 매칭될 때 턴 종료 시 알림을 받는다 | `source/packages/agent/tools/core/shell/prompts/dsv3.ts` |

## cloud-agents/tool  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Launch a cloud agent via the CloudAgent tool with prompt/repo_url | `source/host/cloud-agents/cloud-agent-tool.ts` |
| high | List cloud agents with scope 'launched' via the CloudAgent tool | `source/host/cloud-agents/cloud-agent-tool.ts` |
| high | Reply to a running cloud-agent run with interrupt:true via the CloudAgent tool | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | Dump a cloud agent transcript to a box JSONL file and return path/bytes/line count | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | CloudAgent rename an agent and return the status message | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | CloudAgent cancel an agent and return the status message | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | CloudAgent archive an agent and return the status message | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | CloudAgent unarchive an agent and return the status message | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | CloudAgent delete an agent and return the status message | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | CloudAgent list_artifacts for an agent and return the results | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | Register a cloud agent watch that announces auto-revive on completion | `source/host/cloud-agents/cloud-agent-tool.ts` |
| medium | Return 'destructive; call again with confirm:true' when a CloudAgent destructive action is called without confirm | `source/host/cloud-agents/cloud-agent-tool.ts` |

## computer-tool  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Run a Computer call with a 'then' batch of up to 9 follow-up actions | `source/host/runner/tools/sand-computer-tool.ts` |
| medium | Return 'Computer action failed: <error>' when a Computer action returns an executor error | `source/host/runner/tools/sand-computer-tool.ts` |
| medium | Accept only reviewable (non-mutating-bypass) follow-up actions in a Computer 'then' batch in enforce mode | `source/host/runner/tools/sand-computer-tool.ts` |
| medium | Fail with 'Drag requires x, y, x2, and y2 or a path with at least 2 points' when a drag lacks coords and path | `source/host/runner/tools/sand-computer-tool.ts` |
| medium | Wait the given durationMs (capped at 30000) for a Computer action=wait | `source/host/runner/tools/sand-computer-tool.ts` |
| medium | Fail validation requiring a concise UI-target description for a Computer click/drag in enforce mode | `source/host/runner/tools/sand-computer-tool.ts` |
| low | A Computer call whose sequence does not end in screenshot gets a trailing screenshot appended | `source/host/runner/tools/sand-computer-tool.ts` |

## 이미지 생성 도구  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 봇이 이미지 생성 도구에서 aspect_ratio를 1:1/4:3/3:4/16:9/9:16 중 하나로 지정한다 | `source/packages/agent/tools/core/generate-image.ts` |
| high | 봇이 GenerateImage 도구로 텍스트 설명에서 이미지를 만든다 | `source/packages/agent/tools/core/generate-image.ts` |
| medium | 3단어 이하 또는 의심 키워드 포함 짧은 설명으로 이미지 생성을 호출하면 의도치 않은 호출로 보고 거부하며 재시도 말라고 안내한다 | `source/packages/agent/tools/core/generate-image.ts` |
| medium | reference_image_paths로 참조 이미지를 넣어 생성하면 참조를 반영한 새 이미지를 만든다 | `source/packages/agent/tools/core/generate-image.ts` |
| medium | 워크스페이스/프로젝트 폴더 없이 이미지 생성을 호출하면 저장 위치가 없다는 오류로 폴더를 열라고 안내한다 | `source/packages/agent/tools/core/generate-image.ts` |
| medium | 이미지 미지원 모델에서 GenerateImage를 호출하면 사용 불가하니 모델을 바꾸라는 오류를 표시한다 | `source/packages/agent/tools/core/generate-image.ts` |
| medium | 콘텐츠 안전 정책 위반 프롬프트로 생성하면 안전 정책 차단 오류를 표시한다 | `source/packages/agent/tools/core/generate-image.ts` |

## auto-review-controller  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Block a second agent side effect with 'Another action is waiting for Auto-review approval…' while an approval is pending | `source/host/runner/auto-review-gate.ts` |
| medium | Expire pending approvals on a surface when it switches to non-enforce, returning a retry message to the model | `source/host/runner/auto-review-gate.ts` |
| medium | Deny a 5th concurrent approval request for one agent with 'Too many actions are already waiting' | `source/host/runner/sand-auto-review.ts` |
| medium | Tell the model not to retry or route a blocked action around via another public file host/pastebin | `source/host/runner/sand-auto-review.ts` |
| medium | Deny a pending approval interrupted by a host update with a 'the user did NOT deny it' message | `source/host/runner/sand-auto-review.ts` |
| medium | Auto-expire an unanswered approval after the 10-minute TTL and deny with the block reason | `source/host/runner/sand-auto-review.ts` |
| medium | Expire pending approvals as user_redirect and deny them when the user sends a new message | `source/host/runner/sand-auto-review.ts` |

## Read 도구  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Read 도구에 offset/limit(또는 line_range)를 주어 지정 라인 범위만 읽고 생략 라인 수를 받는다 | `source/packages/agent/tools/core/read/read.ts` |
| high | Read 도구로 PDF를 읽어 텍스트로 추출해 받는다(경로별 캐시) | `source/packages/agent/tools/core/read/read.ts` |
| high | Read 도구로 로컬 파일 경로를 읽어 (선택적 라인 번호 포함) 내용을 받는다 | `source/packages/agent/tools/core/read/read.ts` |
| high | Read 도구로 이미지 파일을 읽어 MIME 감지 후 이미지 결과를 받는다(감지 실패 시 바이너리 안내) | `source/packages/agent/tools/core/read/read.ts` |
| medium | Jupyter 노트북(.ipynb)을 읽으면 셀/출력이 LLM용으로 포맷되어 반환된다 | `source/packages/agent/tools/core/read/read.ts` |
| medium | READ_CHAR_HARD_LIMIT를 초과하는 파일을 읽으면 내용 대신 offset/limit 또는 grep 사용을 안내하는 초과 메시지가 반환된다 | `source/packages/agent/tools/core/read/read.ts` |

## Local exec  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 권한 승인이 필요하나 액션을 설명할 수 없는 로컬 exec이면 SAND_LOCAL_TOOLS_UNDESCRIBABLE_MESSAGE 권한 거부 오류가 발생한다 | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts` |
| medium | 로컬 툴 권한 게이트가 차단된 상태에서 exec/업로드/다운로드하면 차단 사유를 담은 권한 거부 오류가 발생한다 | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts` |
| medium | 로컬 파일 업로드가 최대 파일 바이트를 넘으면 localExecFileTooLargeMessage 오류가 발생한다 | `source/host/extensions/local-exec/gateway-local-exec-sand-box.ts` |
| medium | 로컬 exec 응답이 응답 워치독 유휴 한도를 넘기면 cancel로 스트림이 닫히고 'computer unavailable' 오류가 발생한다 | `source/host/extensions/local-exec/local-exec-bridge.ts` |
| medium | 로컬 컴퓨터 exec를 실행했는데 등록된 제공자가 없으면 SAND_NO_LOCAL_MACHINE_MESSAGE 오류가 발생한다 | `source/host/extensions/local-exec/local-exec-bridge.ts` |
| medium | 연결된 로컬 컴퓨터 목록(id/label/connected)을 조회한다 | `source/host/extensions/local-exec/local-exec-bridge.ts` |
| medium | 현재 활성 컴퓨터를 조회한다 | `source/host/extensions/local-exec/local-exec-bridge.ts` |

## browser-auto-review  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Block a browser action with 'Browser Auto-review rejected oversized <field>' when url/text/value/key/params exceed caps | `source/host/runner/sand-browser-auto-review.ts` |
| medium | Block browser_click/mouse_click_xy/drag with 'require an element field...' when no element description is given | `source/host/runner/sand-browser-auto-review.ts` |
| medium | Block a browser action with 'The page changed after review; take a fresh browser_snapshot and retry' | `source/host/runner/sand-browser-auto-review.ts` |
| medium | Return the denial reason to the model (action not run) when the user denies or the approval times out on a browser action | `source/host/runner/sand-browser-auto-review.ts` |
| low | A mutating browser action runs in shadow mode; the classifier runs in the background and the action proceeds | `source/host/runner/sand-browser-auto-review.ts` |
| low | A non-mutating browser op skips auto-review and runs | `source/host/runner/sand-browser-auto-review.ts` |

## TodoWrite 도구  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | TodoWrite로 작업 목록을 만들거나 갱신하면 저장 후 최신 목록이 반환된다 | `source/packages/agent/tools/core/todo/todo.ts` |
| medium | Call TodoWrite with merge=true to merge into existing todos by id | `source/packages/agent/tools/core/todo/todo.ts` |
| medium | Call TodoWrite with merge=false to replace all todos | `source/packages/agent/tools/core/todo/todo.ts` |
| low | Agent saves a TodoWrite list with only pending todos and gets an 'in_progress required' reminder | `source/packages/agent/tools/core/todo/schema.ts` |
| low | Agent's todo list exceeds 20 completed/cancelled todos and gets the 'clean up old todos' system reminder | `source/packages/agent/tools/core/todo/schema.ts` |
| low | Agent merge-saves a new todo without content and the tool throws 'new todo needs content' | `source/packages/agent/tools/core/todo/todo.ts` |

## WebFetch 도구  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent fetches URL content via the WebFetch tool | `source/packages/agent/tools/core/web-fetch.ts` |
| medium | Truncate or write content to a file and return its path when fetched content exceeds 100000 chars / the threshold | `source/packages/agent/tools/core/web-fetch.ts` |
| medium | Return an 'inaccessible from isolated server' refusal when fetching a localhost/private-IP URL | `source/packages/agent/tools/core/web-fetch.ts` |
| medium | Return the error (or timeout error) instead of content for a non-200 / auth-required / timeout URL | `source/packages/agent/tools/core/web-fetch.ts` |
| low | Agent calls WebFetch with a non-http/https protocol or invalid URL and gets a protocol/URL validity error | `source/packages/agent/tools/core/web-fetch.ts` |

## 대기 도구  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Poll a background shell job via the Await tool | `source/packages/agent/tools/core/await.ts` |
| medium | Call Await with a regex pattern to wait for matching shell output (returns first match) | `source/packages/agent/tools/core/await.ts` |
| medium | Call Await with block_until_ms and no task id (sleeps, shows 'Slept briefly.') | `source/packages/agent/tools/core/await.ts` |
| medium | New user message arrives during Await (wait released early with new-message wake reason) | `source/packages/agent/tools/core/await.ts` |
| medium | Attempt to Await a subagent (returns error to use completion notification, or transcript path) | `source/packages/agent/tools/core/await.ts` |

## 메모리  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Bot writes or forgets a memory fact via update_state target memory | `source/host/runner/sand-memory.ts` |
| high | Bot creates a project via update_state | `source/host/runner/sand-memory.ts` |
| high | Bot joins a project via update_state | `source/host/runner/sand-memory.ts` |
| high | Bot leaves a project via update_state | `source/host/runner/sand-memory.ts` |
| high | Inject shared user memory into the prompt with [via <assistant>] attribution and priority ordering | `source/host/runner/sand-memory.ts` |
| medium | Bot remembers a fact (tagged profile/log/note with differing importance and 30-day half-life decay) | `source/host/runner/sand-memory.ts` |
| medium | Conversation reaches N turns (default 6) (auto episode summary saved as [episode] log) | `source/host/runner/turn-memory.ts` |

## 모드  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Reject a non-readonly tool call in Ask mode with a switch-to-agent-mode error | `source/packages/agent/tools/common.ts` |
| high | Reject editing a non-markdown/canvas file in Plan mode | `source/packages/agent/tools/core/edit/plan-mode-file-policy.ts` |
| medium | Change to a different mode (switch-mode reminder injected listing current/available modes) | `source/packages/agent/mode-processing.ts` |
| medium | Background/local agent environment transitions (transition reminder about commit/push vs self-managed git injected) | `source/packages/agent/mode-processing.ts` |
| medium | Workspace folder changes during work (prior->current folder change reminder injected, worktree note if applicable) | `source/packages/agent/mode-processing.ts` |

## computer-auto-review  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Block a computer action with 'The page changed after review; inspect the latest screenshot and retry' | `source/host/runner/sand-computer-auto-review.ts` |
| medium | Block a computer action with 'Computer Auto-review rejected oversized <field>' when text/key/path exceed caps | `source/host/runner/sand-computer-auto-review.ts` |
| medium | Block a computer action with the 'every desktop monitor is in use' message when no monitor is available | `source/host/runner/sand-computer-auto-review.ts` |
| medium | Return the denial reason to the model (action never runs) when the user denies a blocked computer action | `source/host/runner/sand-computer-auto-review.ts` |
| low | A bypass computer action skips auto-review and runs | `source/host/runner/sand-computer-auto-review.ts` |

## 브라우저 도구  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 박스 브라우저 CDP가 죽은 상태에서 브라우저 도구를 호출하면 box-chrome로 창을 띄우고 CDP 포트를 기다리며, 안 뜨면 오류를 낸다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| medium | 폐기된 탭이 있는 상태에서 브라우저 도구를 쓰면 연결 전 탭을 되살리고 원래 탭에 포커스를 되돌린다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| medium | 브라우저 도구 호출이 90초를 넘기면 watchdog가 타임아웃 결과를 반환하고 프로세스를 종료한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| medium | 스냅샷에 비밀번호/자격 입력 필드가 있으면 값이 <redacted>로 가려지고 최대 400개 요소로 잘린다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| low | 클릭에 우클릭(button) 옵션을 지정한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| low | 클릭에 중간 버튼(button) 옵션을 지정한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| low | 클릭에 수정키(modifiers)를 지정한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| low | 클릭을 더블클릭(doubleClick)으로 지정한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| low | 클릭에 홀드 시간(holdDurationMs)을 지정한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |
| low | 클릭 시 새 탭(newTab)으로 이동한다 | `source/host/runner/tools/sand-browser-driver-source.ts` |

## 컨텍스트 첨부  (5행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 런타임 콘솔 로그를 console_logs_context 블록으로 프롬프트에 포함한다 | `source/packages/agent/context-processing-console-logs.ts` |
| medium | 커서 커맨드를 cursor_commands 블록으로 프롬프트에 포함한다 | `source/packages/agent/context-processing-cursor-commands.ts` |
| medium | Slack 스레드를 slack_context 블록으로 렌더링한다 | `source/packages/agent/context-processing-invocation-platforms.ts` |
| medium | Microsoft Teams 스레드를 microsoft_teams_context 블록으로 렌더링한다 | `source/packages/agent/context-processing-invocation-platforms.ts` |
| medium | IDE 열린 파일/보는 PR 상태를 open_and_recently_viewed_files 블록으로 렌더링한다 | `source/packages/agent/context-processing-invocation-platforms.ts` |
| medium | 작업 중인 GitHub PR 컨텍스트(제목/설명/코멘트/CI 실패)를 github_pr_context 블록으로 포함한다 | `source/packages/agent/context-processing-invocation.ts` |
| medium | PR 리뷰 diff 선택을 pr_review_context 블록으로 포함한다 | `source/packages/agent/context-processing-pr-review.ts` |

## background-shell  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Wake the agent when a backgrounded shell command completes (success/error + exit code) | `source/host/runner/shell-terminal-watch.ts` |
| medium | Settle a watched background command after ~5 hours with 'still running... check its output file' | `source/host/runner/shell-terminal-watch.ts` |
| low | A watched command's terminal output file disappears and the watch settles with an error | `source/host/runner/shell-terminal-watch.ts` |
| low | Reading a background command's output becomes no longer permitted and the watch settles with a denial | `source/host/runner/shell-terminal-watch.ts` |

## 복구  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Redrive SendMessage (ack redrive) for an unanswered user message after an interrupted turn, up to 3 times | `source/host/extensions/transcript/ack-obligations.ts` |
| high | Notify the parent bot that a background subagent was interrupted by a host restart | `source/host/extensions/transcript/pending-wake-rearm.ts` |
| high | Auto-resume an interrupted bot turn after a host-update restart with a resume prompt | `source/host/extensions/transcript/upgrade-recreate-resume.ts` |
| medium | Recreate aborts a background shell command (guidance delivered that command was interrupted with no completion report) | `source/host/extensions/transcript/upgrade-recreate-resume.ts` |

## 서브에이전트  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Fail a subagent run's auto-review and return an error state releasing the session | `source/host/runner/agent-adapters.ts` |
| high | Run the launch-review classifier in shadow/enforce mode on a risky subagent launch | `source/host/runner/turn-agent-composition.ts` |
| medium | computerUse 서브에이전트가 실행 중일 때 또 하나를 띄우면 데스크톱 할당 실패 오류로 막힌다 | `source/host/runner/agent-adapters.ts` |
| medium | 실행 중인 서브에이전트를 resume로 다시 시작하면 거부되고 MessageSubagent/StopSubagent 안내 오류를 반환한다 | `source/host/runner/agent-adapters.ts` |

## 실행 환경  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Show the 'Workspace Disconnected — reload window' error when a tool runs while disconnected | `source/packages/agent/tools/core/connect-error.ts` |
| medium | 실행 백엔드가 다운된 상태에서 도구를 호출하면 이후 도구 호출을 건너뛴다 | `source/packages/agent/tool-stream-executor.ts` |
| medium | 도구 실행이 제한 시간을 초과하면 타임아웃 오류를 표시한다 | `source/packages/agent/tools/common.ts` |
| medium | 서비스가 rate limit/과부하 상태에서 도구를 호출하면 재시도 안내 오류를 표시한다 | `source/packages/agent/tools/core/connect-error.ts` |

## MCP  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 박스에서 MCP 툴 실행이 실패하면 'Box MCP execution failed for "{name}": ...' 오류 결과가 반환되고 오류 클래스가 기록된다 | `source/host/extensions/mcp/box-mcp-exec.ts` |
| medium | MCP 호출이 인증 필요로 실패하면 해당 서버 connect 카드가 자동으로 채팅에 뜨고 오류에 '인증 후 자동 재개' 안내가 서버당 1회 덧붙는다 | `source/host/runner/turn-agent-composition.ts` |
| low | Enable the multi-account prompt section instructing the agent to pass account_label verbatim when a multi-account MCP server is active | `source/host/runner/system-prompt-assembly.ts` |
| low | A routed MCP tool executed against the desktop app returns an McpError explaining tools run on the computer | `source/electron-main/mcp/desktop-mcp-manager.ts` |

## local-tool-permission  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Deny with SAND_LOCAL_TOOLS_ASK_UNAVAILABLE_MESSAGE when the ask surface cannot show a raised ask | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |
| medium | Expire an unanswered ask with SAND_LOCAL_TOOLS_ASK_EXPIRED_MESSAGE past its TTL | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |
| medium | Deny with SAND_LOCAL_TOOLS_TARGET_TOO_LARGE_MESSAGE when the tool target exceeds 10000 chars | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |
| medium | Settle with SAND_LOCAL_TOOLS_ASK_CANCELLED_MESSAGE when the tool-call request is aborted before an answer | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |

## subagent-runtime  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Revive the parent with a background subagent's trimmed result text on completion | `source/host/runner/subagent-runtime.ts` |
| medium | Revive the parent with the error message when a background subagent throws | `source/host/runner/subagent-runtime.ts` |
| medium | Restart a finishing subagent with the steer prompt prepended when a steer arrives | `source/host/runner/subagent-runtime.ts` |
| low | A background subagent finishing with no text yields '(the task finished without producing any text output)' | `source/host/runner/subagent-runtime.ts` |

## 턴 루프  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 단일 메시지 반복 루프 감지 시 리마인더 후 재시도, 재발 시 AgentLoopError로 중단한다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |
| medium | 모델 응답이 비면 최대 3회 재시도하고 필요 시 '계속하세요' 리마인더를 삽입한다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |
| medium | 응답이 출력 토큰 한도로 잘리면 계속 리마인더를 삽입하고 재시도한다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |
| medium | 턴이 최대 스텝 수(기본 512)에 도달하면 루프 방지 오류로 종료한다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |

## 파일 편집  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 디스크 공간이 없을 때 편집하면 'No space left on device' 오류를 표시한다 | `source/packages/agent/tools/core/edit/common.ts` |
| medium | 쓰기 권한이 없는/읽기전용 파일을 편집하면 권한 거부 오류를 표시한다 | `source/packages/agent/tools/core/edit/common.ts` |
| medium | Attempt to edit a file located outside the worktree via the edit tool | `source/packages/agent/tools/core/edit/common.ts` |
| medium | Edit a managed canvas (.canvas.tsx) via the edit tool and receive appended TypeScript diagnostics | `source/packages/agent/tools/core/edit/post-write-result-decoration.ts` |

## WebSearch 도구  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent searches the web via the WebSearch tool | `source/packages/agent/tools/core/web-search.ts` |
| medium | Classify a provider 429/5xx as a retryable 'transient error, retry' error | `source/packages/agent/tools/core/web-search.ts` |
| medium | Write large page text to a file and return a grep/read guidance path when a search result includes big body text | `source/packages/agent/tools/core/web-search.ts` |

## 목표(Goal)  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Auto-wake the agent with a synthetic goal-continuation message while a thread goal is active | `source/packages/agent/actions/goal-continuation-action-handler.ts` |
| medium | Three consecutive tool-less goal continuations (goalState set PAUSED with reason anti_spin) | `source/packages/agent/actions/goal-continuation-action-handler.ts` |
| medium | User message arrives with a paused goal (goalState returns ACTIVE, idle counter reset, excludes synthetic wakes) | `source/packages/agent/actions/user-message-action/reactivate-paused-goal.ts` |

## 자기 수정  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 봇이 update_state로 자신의 이름/설명/제목을 바꾼다 | `source/host/runner/system-prompt-assembly.ts` |
| medium | 봇이 update_state로 hidden_from_sidebar=true를 저장하면 사이드바에서 사라지되 대화·메시지·루틴·안읽음은 유지된다 | `source/host/runner/system-prompt-assembly.ts` |
| medium | 봇이 update_state target avatar action set path로 자기 프로필 사진을 설정한다 | `source/host/runner/system-prompt-assembly.ts` |
| medium | 봇이 update_state target avatar action clear로 자기 아바타를 기본값으로 되돌린다 | `source/host/runner/system-prompt-assembly.ts` |

## agent-messaging  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Refuse with 'You can't message yourself with SendToAgent…' when targeting your own agent id | `source/host/runner/tools/sand-agent-management-tools.ts` |
| medium | Return 'each images url must include a file:// or https:// scheme' when a SendToAgent image url lacks a valid scheme | `source/host/runner/tools/sand-agent-management-tools.ts` |
| medium | Send images via SendToAgent so a 1:1 recipient receives them with the message (groups are text-only) | `source/host/runner/tools/sand-agent-management-tools.ts` |

## box-readiness  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return 'The computer isn't responding — it may be wedged...' when a box tool runs against a wedged daemon | `source/host/runner/remote-box-resources.ts` |
| medium | Return 'The computer is still starting up (downloading its image or booting)...' when the box is still starting | `source/host/runner/remote-box-resources.ts` |
| medium | Return 'Every desktop monitor on the shared computer is in use right now...' when no monitor is free | `source/host/runner/remote-box-resources.ts` |

## file-transfer  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return 'Unknown computer "id". Connected computers: ...' for CopyToBox with an unknown computer id | `source/host/runner/tools/sand-file-transfer-tools.ts` |
| medium | Return 'No computer is connected right now...' for CopyToBox when no computer is connected | `source/host/runner/tools/sand-file-transfer-tools.ts` |
| medium | Return 'The computer is still starting up...' for CopyToBox/CopyFromBox while the box is preparing | `source/host/runner/tools/sand-file-transfer-tools.ts` |

## local-exec/ls  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return a sorted directory tree with per-extension counts when the agent lists a directory | `tool-results/b8vqfpmtc.txt` |
| medium | Return LsError 'Path does not exist'/'Path is not a directory' when the ls target is invalid | `tool-results/b8vqfpmtc.txt` |
| medium | Return an LsTimeout result with the partial directory tree when traversal exceeds the 5s timeout | `tool-results/b8vqfpmtc.txt` |

## 질문 위젯  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 비동기 답변 결과 도착 시 합성 메시지 또는 도구 결과로 턴을 재개한다 | `source/packages/agent/actions/async-ask-question-completion-action-handler.ts` |
| medium | 건너뛴/거절된 질문이 있으면 재질문 방지 숨김 노트를 프롬프트에 주입한다 | `source/host/runner/conversation-state.ts` |
| medium | 봇이 질문 위젯에 style danger/allowCustom/dismissOnMoveOn 옵션을 지정한다 | `source/host/runner/system-prompt.ts` |

## 채널  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 SendMessage에 채널 주소(platform:chat)를 지정해 외부 플랫폼으로 보낸다 | `source/shared/channel-messaging.ts` |
| medium | 연결된 채널에서 인바운드 메시지·반응을 받아 봇이 깨어나 같은 채널로 답한다 | `source/shared/channel-messaging.ts` |
| medium | 채널 전송이 실패하면 봇이 인앱 채팅에서 미전달 정정을 통지한다 | `source/shared/channel-messaging.ts` |

## CallMcpTool 도구  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | server+toolName+arguments로 MCP 도구를 호출해 텍스트/이미지 결과를 받는다 | `core/mcp/mcp.ts` |
| medium | project workspace 대화에서 워크스페이스 변경 도구를 호출하면 차단 오류가 반환된다 | `core/mcp/get-mcp-tools.ts` |

## GetMcpTools 도구  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | GetMcpTools로 MCP 서버/도구 목록(이름+짧은 설명)을 조회한다 | `core/mcp/get-mcp-tools.ts` |
| high | GetMcpTools에 server(또는 toolName)를 지정해 전체 입력 스키마와 전체 설명을 조회한다 | `core/mcp/get-mcp-tools.ts` |

## Hooks / preToolUse  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | preToolUse 훅이 {permission:"deny"}를 반환하면 도구 호출이 차단되어 실행되지 않는다 | `source/packages/hooks/validators/preToolUseResponse.ts` |
| high | preToolUse 훅이 updated_input(plain object)을 반환하면 실행 전 도구 입력 인자가 그 객체로 대체된다 | `source/packages/hooks/validators/preToolUseResponse.ts` |

## Smart Mode 권한  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 봇이 shell/mcp/컴퓨터/web_fetch 동작을 실행하려 하면 Smart Mode 분류기가 allow/block으로 판정해 자동 실행 여부를 결정한다 | `source/packages/agent/utils/smart-mode-classifier-measurement.ts` |
| medium | 분류기가 10초 내 응답하지 못하거나 오류 나면 한 번 재시도 후에도 실패 시 'An error occured while classifying this action. Please review manually.'로 수동 검토를 요구한다 | `source/packages/agent/utils/smart-mode-classifier-error-metadata.ts` |

## computer-subagent  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Delegate a desktop task to a computerUse subagent via Task | `source/host/runner/tools/sand-computer-use-subagent.ts` |
| medium | Disallow dispatching a second computerUse subagent while one is running (shared single screen) | `source/host/runner/tools/sand-computer-use-subagent.ts` |

## hooks/exec  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Block an agent tool action via a hook and return the blocked-by-hook message | `source/packages/hooks-exec/hook-error-handling.ts` |
| medium | Show '<action> was blocked because a configured hook failed to execute...' when a hook fails (fail-closed) | `source/packages/hooks-exec/hook-error-handling.ts` |

## inference  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent fetches a URL and returns page content (or an error with isTimeout) | `source/host/extensions/inference/cursor-web-tools.ts` |
| high | Agent runs a web search and returns an answer plus source documents | `source/host/extensions/inference/cursor-web-tools.ts` |

## 대화 스레딩  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Auto-stamp the bot's reply as a thread (reply_to) of the triggering user message | `source/host/extensions/transcript/send-thread-stamping.ts` |
| medium | Bot sets a non-existent or self reply_to (invalid reply_to removed to prevent bad threading) | `source/host/extensions/transcript/send-thread-stamping.ts` |

## 테스트/증거  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 봇이 스크린샷/비디오 walkthrough 아티팩트를 최종 응답에 인라인 첨부한다 | `source/packages/agent/prompts/testing/parent.ts` |
| high | 봇이 화면 녹화를 저장(SAVE_RECORDING)한다 | `source/packages/agent/prompts/testing/parent.ts` |

## Remote computer  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇 VNC 컴퓨터의 클립보드를 읽으면 readClipboard가 원격 컴퓨터의 현재 클립보드 내용을 반환한다 | `source/shared/rpc/vnc.ts` |
| medium | 봇 VNC 컴퓨터의 클립보드에 텍스트를 쓰면 writeClipboard가 원격 클립보드를 설정해 그곳에서 붙여넣기가 된다 | `source/shared/rpc/vnc.ts` |

## agent-management  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return 'No agent found with id <id>.' when UpdateAgent is called with an unknown agent id | `source/host/runner/tools/sand-agent-management-tools.ts` |
| medium | Return 'Nothing to update: provide a new name and/or description.' when UpdateAgent has neither field | `source/host/runner/tools/sand-agent-management-tools.ts` |

## local-exec/machine  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reject a path outside the local-exec root (including via symlink) with SandLocalExecPathError | `source/host/local-exec/local-exec-machine.ts` |
| low | A requested working directory absent on the machine falls back to root with a 'working directory does not exist' notice | `source/host/local-exec/local-exec-machine.ts` |

## 규칙·스킬 범위  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Set metadata.scopedTo email on a rule/skill frontmatter (rule applied only to that user's prompt, excluded for others) | `source/packages/agent/utils/scoped-rule-filtering.ts` |
| low | Cloud-only and local-only rules/skills are exposed only in their matching execution environment (BUGBOT is unfiltered) | `source/packages/agent/utils/environment-filtering.ts` |

## 에이전트 실행기 / 백그라운드 셸  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 백그라운드 셸을 띄우면 장기 실행 명령이 시작되고 핸들/식별자가 반환된다 | `source/packages/agent-exec/background-shell.ts` |
| medium | 에이전트가 실행 중인 백그라운드 셸에 표준입력을 보내면 프로세스가 반응한다 | `source/packages/agent-exec/background-shell.ts` |

## 에이전트 실행기 / 서브에이전트  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 subagent await 도구로 서브에이전트 완료를 기다리면 결과가 상위 턴에 반영된다 | `source/packages/agent-exec/subagent-await.ts` |
| medium | 에이전트가 서브에이전트를 강제 백그라운드로 전환하면 대기 중이던 서브에이전트가 넘어가고 제어가 반환된다 | `source/packages/agent-exec/subagent-control.ts` |

## 디렉터리 목록  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Running the LS tool on a directory with terminal files renders cwd/last-command/exit-code/runtime metadata in the tree | `source/packages/agent/tools/core/ls/formatters.ts` |
| low | 매우 큰 디렉터리를 LS 도구로 조회하면 문자 예산 내로 요약 렌더링한다 | `source/packages/agent/tools/core/ls/formatters.ts` |

## Auto-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 위험 도구 호출이 smart-mode 분류기 검토를 받아 BLOCK 시 사유·제안 규칙을, ALLOW/실패 시 allow/reject를 돌려준다 | `source/host/runner/sand-auto-review-classifier-run.ts` |

## CI 조사 서브에이전트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 실패한 CI 체크 하나를 서브에이전트에 조사시켜 CLI/MCP/WebFetch 순으로 로그를 읽어 근본원인 markdown 요약을 받는다 | `source/packages/agent/tools/core/subagent/ci-investigator-subagent.ts` |

## Hooks / beforeReadFile  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | beforeReadFile 훅이 permission allow/deny(+선택 user_message)를 반환해 파일 읽기를 허용/차단한다(allow/deny 외 값은 거부) | `source/packages/hooks/validators/beforeReadFileResponse.ts` |

## Hooks / beforeShellExecution  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | beforeShellExecution(또는 beforeMCPExecution) 훅이 permission allow/deny/ask(+메시지)를 반환해 셸/MCP 호출을 허용·차단·확인요청한다(유효하지 않은 값 거부) | `source/packages/hooks/validators/beforeCommandExecutionHookResponse.ts` |

## Hooks / beforeSubmitPrompt  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | beforeSubmitPrompt 훅이 {continue:false}를 반환하면 에이전트 실행 전 프롬프트 제출이 중단된다 | `source/packages/hooks/validators/beforePromptSubmitResponse.ts` |

## Hooks / beforeTabFileRead  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | beforeTabFileRead 훅이 permission allow/deny(+선택 user_message)를 반환해 열린 탭 파일 읽기를 허용/차단한다 | `source/packages/hooks/validators/beforeTabFileReadResponse.ts` |

## Hooks / sessionStart  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | sessionStart 훅이 문자열 값 env 맵을 반환하면 해당 환경변수가 세션에 주입된다(비문자열/비객체는 거부) | `source/packages/hooks/validators/sessionStartResponse.ts` |

## Hooks / stop  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | stop 훅이 followup_message 문자열을 반환하면 에이전트 정지 후 턴을 잇는 후속 메시지가 큐잉된다(비문자열은 거부) | `source/packages/hooks/validators/stopResponse.ts` |

## Hooks / subagentStart  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | subagentStart 훅이 permission allow/deny/ask(+선택 user_message)를 반환해 서브에이전트 시작을 허용·차단·확인요청한다(유효하지 않은 값 거부) | `source/packages/hooks/validators/subagentStartResponse.ts` |

## Hooks / workspaceOpen  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | workspaceOpen 훅이 비어있지 않은 문자열 pluginPaths 배열을 반환하면 워크스페이스 열 때 추가 플러그인 경로가 로드된다(비배열/비문자열/빈문자열은 인덱스별 오류로 거부) | `source/packages/hooks/validators/workspaceOpenResponse.ts` |

## attachments  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Generate and persist an image from a text description | `source/host/extensions/attachments/generate-image-service.ts` |

## browser-subagent  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Delegate a web task to a browserUse subagent via Task | `source/host/runner/tools/sand-browser-use-subagent.ts` |

## 동영상 검토  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Delegate video understanding to the watchVideo/videoReview subagent | `source/host/runner/system-prompt.ts` |

## 디렉터리 목록 도구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | List a directory path via the ls tool | `source/packages/local-exec/ls.ts` |

## 백그라운드 작업  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Wake the agent with a system_notification when a background shell/subagent task completes | `source/packages/agent/actions/background-task-completion-action-handler.ts` |

## 에이전트 실행기 / bash  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent runs a shell command via the mini-swe-agent bash tool | `source/packages/agent-exec/mini-swe-agent-bash.ts` |

## 에이전트 실행기 / 웹 fetch  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent fetches remote content via the fetch tool | `source/packages/agent-exec/fetch.ts` |

## 에이전트 실행기 / 파일 쓰기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent creates/overwrites a file via the write tool | `source/packages/agent-exec/write.ts` |

## 에이전트 실행기 / 파일 편집  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Agent partially edits an existing file via the pi edit tool | `source/packages/agent-exec/pi-edit.ts` |

## 이미지  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Generate an image via the GenerateImage tool and attach it via SendMessage | `source/host/runner/system-prompt.ts` |

## 이미지 생성  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 봇이 설명(및 참조 이미지)으로 이미지를 생성한다 | `source/shared/node/cursor-backend/cursor-generate-image.ts` |

## 턴 컨텍스트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 플러그인 설치 직후 봇이 플러그인의 스킬/서브에이전트/훅/규칙/명령/MCP 서버 개요를 자동 안내한다 | `source/packages/agent/state.ts` |

## Cross-user sharing  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 호스트가 원격 멤버 턴 요청을 받으면 '{name} is responding in {room}...' 활동 알림을 추가하고 원격 턴을 실행한다 | `source/host/extensions/cross-user-sharing/xuser-remote-turns.ts` |

## Diff 탭  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 명시적으로 스테이징된 파일이 있는 상태로 커밋하면 스테이징 목록만 권위로 커밋되고(30개 초과 절단) 언스테이징 파일은 제외된다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |

## Hooks / postToolUse  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | postToolUse/postToolUseFailure 훅이 additional_context를 반환하면 도구 성공/실패 후 추가 컨텍스트가 턴에 주입되고 비문자열은 거부된다 | `source/packages/hooks/validators/postToolUseFailureResponse.ts` |

## Hooks / preCompact  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | preCompact 훅이 빈 객체 또는 user_message를 반환하면 압축 전 사용자 메시지가 주입되며 빈 응답은 허용, 비문자열 user_message는 거부된다 | `source/packages/hooks/validators/preCompactResponse.ts` |

## MCP 도구 실행  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | MCP 도구가 컨텍스트 창을 넘는 큰 결과를 반환하면 결과가 agent-tools 파일로 spill되어 인라인 대신 파일로 제공된다 | `source/packages/agent/utils/mcp-metrics.ts` |

## MCP 도구 이미지 결과  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | MCP 도구가 이미지를 반환하면 이미지가 디스크에 저장되고 '이 이미지를 디스크에 저장했습니다 … SendMessage attachment로 전달' 안내가 결과에 추가된다 | `source/shared/node/mcp/mcp-image-assets.ts` |

## MCP 도구 탐색  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | catalog 모드로 전체 도구 목록을 조회한다 | `source/packages/agent/utils/mcp-metrics.ts` |
| medium | server_detail 모드로 특정 서버 상세를 조회한다 | `source/packages/agent/utils/mcp-metrics.ts` |
| medium | tool_detail 모드로 특정 도구 상세를 조회한다 | `source/packages/agent/utils/mcp-metrics.ts` |
| medium | search 모드로 pattern에 맞는 도구를 검색한다(잘못된 정규식/서버/도구는 각각의 사유로 거부) | `source/packages/agent/utils/mcp-metrics.ts` |

## Untrusted content  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Wrap tool-returned web/file content in a cursor_untrusted_data fence and instruct the agent to treat it as data, refusing embedded action requests | `source/shared/sand-spotlight.ts` |

## VNC 뷰어  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Report VNC user presence to the bot via mouse enter/move/leave and window focus (onVncUserPresence) | `source/electron-preload/preload-vnc.ts` |

## agent-exec/mcp  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Write aggregate MCP text to an agent-tools file and return an output-location reference when output exceeds 40KB | `source/packages/agent-exec/agent-tools-file.ts` |

## agent-exec/readonly  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Deny with 'This operation is not allowed in readonly mode…' when a readonly subagent attempts a write/delete/mcp/shell tool | `source/packages/agent-exec/readonly-resource-accessor.ts` |

## agent-exec/subagent  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return 'Sub-agent is currently running…' with the interrupt retry hint when a follow-up is sent without interrupt | `source/packages/agent-exec/subagent.ts` |

## background-cloud  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Wake the agent with the completed cloud agent's result text (or '(finished without producing any output)') | `source/host/runner/background-work.ts` |

## box-help  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Refuse request_box_help with 'The user still has the box... Do not ask again.' while a hand-off is pending | `source/host/runner/tools/box-help-tool.ts` |

## chat-inference/image-resize  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Resize an over-cap image in place, or drop it as '[image omitted: failed to process N bytes]' if resizing fails | `source/packages/chat-inference/middleware/image-resizing-middleware.ts` |

## cloud-agent-review  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Block a lifecycle action with 'needs Auto-review approval, which isn't available in this conversation' | `source/host/runner/sand-cloud-agent-auto-review.ts` |

## groups/chat  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Send '(pass)' to silently skip a group member turn when there is nothing to add | `source/host/groups/group-chat.ts` |

## large-output  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Spill over-threshold MCP/shell output to a box file (capped at 1MB) and reference it by path | `source/host/runner/large-output-spill.ts` |

## local-exec/background-shell  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return BackgroundShellSpawnSuccess with a shellId (and pid) when the agent spawns a background shell | `source/packages/local-exec/background-shell.ts` |

## local-exec/read  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return ReadSuccess with content, totalLines, fileSize, and truncated/rangeApplied flags when the agent reads a file | `source/packages/local-exec/read.ts` |

## local-exec/shell  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Stream a start event (with sandbox policy), stdout/stderr, then an exit event with code+cwd for a foreground shell command | `source/packages/local-exec/shell-stream.ts` |

## reaction  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Call ReactToMessage with an invalid message address | `source/host/runner/tools/sand-reaction-tool.ts` |

## shell-exec/output-suppress  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Produce shell output faster than the suppression threshold to trigger the too-much-output notice | `source/packages/shell-exec/output-suppression.ts` |

## shell-exec/run  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Agent runs a shell command via the stateful bash/zsh/powershell executor | `source/packages/shell-exec/bash.ts` |

## shell-exec/sandbox  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Run a sandboxed command that tries to write a protected file (.git/hooks, .cursor/*.json, .ssh, mcp.json, permissions.json) | `source/packages/shell-exec/sandbox/hardcoded-policy.ts` |

## subagent-management  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Call MessageSubagent when reviewSteer blocks the steer | `source/host/runner/tools/sand-subagent-management-tools.ts` |

## 검색(grep) 도구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Run grep whose results exceed client/ripgrep caps (returns truncated with truncation flags and totals) | `source/packages/local-exec/grep-output.ts` |

## 계획 동기화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot updates TODO state (latest plan .md frontmatter todo auto-synced with diff) | `source/packages/agent/tools/core/create-plan/backend-plan-utils.ts` |

## 구독 알림  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Handle arriving subscription notification via synthetic wake (notifications prepended, last as user message) | `source/packages/agent/actions/subscription-notification-action-handler.ts` |

## 긴 명령  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot runs a long-running shell command (block_until_ms=0 background execution with completion notification) | `source/host/runner/system-prompt.ts` |

## 대화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot message includes inline base64 images (up to 4/message saved to files and shown in conversation) | `source/host/extensions/transcript/inline-image-materialization.ts` |

## 대화 (Ask question timeout)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Ask-question times out with no user response (auto-answer recorded, proceeds with best judgment) | `source/packages/constants/ask-question.ts` |

## 로컬 실행  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot attempts a local command with the desktop disconnected (shows not-connected / computer-unavailable guidance) | `source/shared/local-exec-gateway.ts` |

## 로컬 실행/파일  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | local-exec single-file read exceeds 100MB (shows over-limit guidance to use offset/limit or grep/head/tail) | `source/shared/local-exec-gateway.ts` |

## 루프 감지  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Model repeats the same sentence/line/tool call (turn aborted with non-retryable 'Agent Looping Detected') | `source/packages/agent/loop-detection/agent-loop-detector.ts` |

## 멀티태스크  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Enter multitask mode (coordinator-delegation reminder injected) | `source/packages/agent/prompts/multitask-mode-user-reminder.ts` |
| medium | Stay in multitask mode (still-in reminder injected) | `source/packages/agent/prompts/multitask-mode-user-reminder.ts` |
| medium | Exit multitask mode (stop-aggressive-multitasking reminder injected) | `source/packages/agent/prompts/multitask-mode-user-reminder.ts` |

## 메시지  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Bot folds an auxiliary message into a thread (reply_to set to thread root, hidden behind 'N in thread' chip) | `source/host/runner/system-prompt.ts` |

## 사용자 정의 도구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 세션에 사용자 정의 도구를 등록하면 목록이 노출되고 discovery/invocation 메타 도구로 스키마 조회·호출이 가능하다 | `source/packages/agent/utils/mcp-custom-user-tools.ts` |

## 셸 상태 유지  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 연속된 셸 명령 실행 시 작업 디렉터리·환경변수·함수·별칭·셸 옵션이 다음 명령으로 유지된다 | `shell-exec/dump_bash_state.ts / dump_zsh_state.ts / dump_powershell_state.ts` |

## 셸 실행/샌드박스  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 샌드박스 정책이 insecure_none이 아닌데 helper 바이너리가 없으면 SandboxUnsupportedError로 실패하고 사유·안내를 던진다 | `source/packages/shell-exec/sandbox/sandbox.ts` |

## 스킬 카탈로그  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 스킬 설명 총량이 토큰 예산을 초과하면 단축→제거→생략 순으로 줄이고 생략 안내를 표시한다(canvas/env-setup/loop 보호) | `source/packages/agent/prompts/skill-catalog-budget.ts` |

## 승인 에스컬레이션  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 차단된 도구 호출을 승인 카드로 올릴 때 request_smart_mode_approval(Shell)/requestSmartModeApproval(MCP)로 재전송해 카드를 띄운다 | `source/host/runner/system-prompt.ts` |

## 승인 카드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 백그라운드 에이전트가 Auto-review 차단된 MCP 승인을 요청하면 승인 카드 없이 즉시 거부된다 | `core/mcp/mcp.ts` |

## 실행 한도  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 한 턴이 도구 호출 5000단계를 넘기면 'Agent exceeded 5000 steps.' 오류로 턴이 종료된다 | `source/host/runner/sand-agent-runner.ts` |

## 에이전트 노트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | agent_notes 컨텍스트와 노트 디렉터리 지침이 프롬프트에 포함되어 노트 작성 시 응답에 핵심 노트를 언급한다 | `source/packages/agent/actions/meta-agent-notes.ts` |

## 에이전트 모드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 대화 도중 다른 모드로 전환하면 'You are now in <Mode> mode…' 안내가 주입된다 | `source/packages/agent/utils/agent-mode-guidance.ts` |

## 에이전트 실행기 / adopt  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 adopt 도구로 기존 실행/박스를 인수하면 대상이 현재 실행으로 인수되고 결과가 반환된다 | `source/packages/agent-exec/adopt.ts` |

## 에이전트 실행기 / git  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 git diff 도구로 작업 트리 변경분을 조회하면 diff가 반환된다 | `source/packages/agent-exec/git-diff.ts` |

## 에이전트 실행기 / 검색  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 grep 도구로 파일 내용을 정규식 검색하면 일치 라인/파일 목록이 반환된다 | `source/packages/agent-exec/grep.ts` |

## 에이전트 실행기 / 대화 검색  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 conversation search 도구로 과거 대화를 검색하면 질의에 맞는 결과가 반환된다 | `source/packages/agent-exec/conversation-search.ts` |

## 에이전트 실행기 / 셸 스트리밍  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 셸을 실행하며 출력을 완료 전 조각 단위로 실시간 받는다 | `source/packages/agent-exec/shell-stream.ts` |

## 에이전트 실행기 / 셸 제어  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 실행 중인 셸을 강제 백그라운드로 전환하면 전경 셸이 넘어가고 제어가 반환된다 | `source/packages/agent-exec/shell-control.ts` |

## 에이전트 실행기 / 진단  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 diagnostics 도구로 코드 진단을 읽으면 진단 항목 목록이 반환된다 | `source/packages/agent-exec/diagnostics.ts` |

## 에이전트 실행기 / 찾기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 pi find 도구로 파일명을 찾으면 패턴에 맞는 경로 목록이 반환된다 | `source/packages/agent-exec/pi-find.ts` |

## 에이전트 실행기 / 파일 삭제  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 delete 도구로 파일을 삭제하면 지정 파일이 삭제되고 결과가 반환된다 | `source/packages/agent-exec/delete.ts` |

## 에이전트 실행기 / 파일 읽기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 pi read 도구로 파일 내용을 읽으면 내용이 반환되어 후속 작업에 쓰인다 | `source/packages/agent-exec/pi-read.ts` |

## 에이전트 실행기 / 화면 녹화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 에이전트가 record screen 도구로 화면을 녹화하면 경로/상태 결과가 반환된다 | `source/packages/agent-exec/record-screen.ts` |

## 에이전트 실행기 / 훅  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 수명주기 이벤트가 발생하면 hook executor가 등록된 훅을 대화/생성/모델/워크스페이스 컨텍스트와 함께 실행하고 결과를 반환한다 | `source/packages/agent-exec/hook-executor.ts` |

## 원격 훅  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | preToolUse 원격 훅이 도구 호출을 deny/ask하면 도구가 차단되고 훅 사유 메시지를 반환한다 | `source/packages/agent/tools/core/remote-hooks.ts` |

## 자동화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 그룹 봇에 걸린 자동화가 발화되면 그룹 대화에 seed 메시지가 추가되고 오케스트레이터가 전 멤버로 그룹 턴을 실행한다 | `source/host/extensions/transcript/automation-run-path.ts` |

## 자동화 채널  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 자동화 실행에서 SendSlackMessage 도구를 호출한다 | `source/packages/agent/automations/platform-communication-tools.ts` |
| medium | 자동화 실행에서 SendMicrosoftTeamsMessage 도구를 호출한다 | `source/packages/agent/automations/platform-communication-tools.ts` |
| medium | 자동화 실행에서 PostReviewCommentOnPr 도구를 호출한다 | `source/packages/agent/automations/platform-communication-tools.ts` |

## 전달 강제  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 결과 미전달 상태로 턴을 끝내려 하면 전달 유도 리마인더/플래그가 발생한다 | `source/host/runner/turn-shape.ts` |

## 중단 복구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 대화 재개 시 미완료 tool-call을 계약 검증 후 실행해 마무리한다 | `source/packages/agent/actions/user-message-action/resume-action-handler.ts` |

## 질문 도구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 조사 없이 첫 AskQuestion을 호출하면 거부된다 | `source/packages/agent/tools/core/ask-question/index.ts` |

## 컨텍스트 압축  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | preCompact 훅이 설정된 상태에서 압축이 일어나면 훅 반환 메시지가 표시된다 | `source/packages/agent/summarization-orchestrator.ts` |

## 컨텍스트 요약  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 토큰/이미지 한도 근접 시 백그라운드 또는 차단 요약을 자동 실행한다 | `source/packages/agent/actions/user-message-action/abstract-user-message-action-handler.ts` |

## 컨텍스트 첨부 - 최근 대화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 최근 다른 봇 대화들이 recent_agents_context 블록으로 노출되어 봇이 부분 조회한다 | `source/packages/agent/context-processing-recent-agents.ts` |

## 컴퓨터 UI  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 사람에게 handoff해 대기하면 awaiting 상태가 설정되고 종료 시 지워지거나 복원된다 | `source/host/sand-host.ts` |

## 테스트/서브에이전트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 videoReview 서브에이전트로 비디오 검증을 수행한다 | `source/packages/agent/prompts/testing/parent.ts` |
| medium | 봇이 Debug 서브에이전트로 가설기반 디버깅을 수행한다 | `source/packages/agent/prompts/testing/parent.ts` |
| medium | 봇이 computerUse 서브에이전트로 GUI 조작을 수행한다 | `source/packages/agent/prompts/testing/parent.ts` |

## 파일 도구 (Worktree guard)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 봇이 워크스페이스 worktree 밖 경로를 검색하려 하면 차단하고 오류를 표시한다 | `source/packages/utils/path-utils.ts` |

## 프로젝트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Write a kebab-case report with subagentId frontmatter under docs/ and cite its absolute path in the reply | `source/packages/agent/prompts/project-prompt.ts` |

## 플러그인 서브에이전트  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Load a plugin-defined subagent with its configured tools and model, applying readonly permissionMode as a read-only restriction | `source/packages/cursor-plugins/loader.ts` |

## MCP 지침  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Apply the default Hex custom instructions to the system prompt when the Hex connector is connected | `source/shared/mcp-custom-instructions.ts` |

## Question widget  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Agent supplies widget options with style and optional helpText so they render styled with help text and capped at 6 | `source/shared/sand-widgets.ts` |

## Time reporting  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Agent converts UTC timestamps (git/gh/mtime/log/schedule) to the user's timezone and labels them | `source/shared/timezone.ts` |

## connectors/attachment  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | A channel attachment passes a file:// local file and it is read and interpreted as an 'upload' transport with MIME | `source/host/connectors/channel-attachment.ts` |

## local-exec/provider  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | A local-exec upload file exceeding maxFileBytes is rejected with a file-error | `source/host/local-exec/local-exec-provider.ts` |

## ports/box  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Attempting computer-use in a no-monitor environment throws SandBoxNoMonitorAvailableError | `source/host/ports/box.ts` |

## session  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | A box handoff started while one is already pending returns already-pending with the live request id/instruction | `source/host/extensions/session/box-handoff-service.ts` |

## shell-exec/powershell-missing  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | When neither pwsh nor powershell is on PATH, a PowerShell-requiring exec throws a not-found error | `source/packages/shell-exec/platform-shell.ts` |

## toolset  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | A tool call exceeding its execution timeout returns a ToolCallExecutionTimeoutError | `source/host/runner/tools/turn-toolset.ts` |

## 노트북 읽기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Reading a Jupyter notebook formats cell source and outputs per cell, truncating each cell's output at 2000 chars | `source/packages/agent/tools/core/read/notebook-format.ts` |

## 동작 규칙  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | With Composer2 rules active, the bot treats 2026 as the current year and applies Vega frontend-design hardrules | `source/packages/agent/prompts/user-info-composer2-rules.ts` |

## 라우터 (Codex 공급자)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Codex 공급자로 도구 호출이 8단계를 넘으면 오류로 끝난다 | `source/host/extensions/inference/codex-direct-responses.ts` |
| low | 알 수 없는 도구·잘못된 인자 JSON을 성공으로 처리하지 않는다 | `source/host/extensions/inference/codex-direct-responses.ts` |

## 에이전트 실행기 / 목록  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 에이전트가 ls 도구로 디렉터리를 나열하면 항목 목록이 반환된다 | `source/packages/agent-exec/ls.ts` |

## 에이전트 실행기 / 캔버스 진단  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 에이전트가 canvas diagnostics 도구로 캔버스 상태 진단을 수행하면 결과가 반환된다 | `source/packages/agent-exec/canvas-diagnostics.ts` |

## 웹 읽기 보안  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 봇이 사설/루프백 IP 호스트로 웹 읽기를 시도하면 SSRF 경계에서 차단된다 | `source/packages/agent/utils/ip.ts` |

## 채널 - Slack  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Slack 채널로 메시지가 오면 봇 프롬프트에 발신자 식별 줄이 추가된다 | `source/packages/agent/utils/slack-sender-line.ts` |

## 파일 읽기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 이미지 파일을 Read 도구로 읽으면 바이트/확장자로 MIME 타입을 감지해 이미지로 처리한다(AVIF/HEIC/HEIF 폴백 포함) | `source/packages/agent/tools/core/read/image-utils.ts` |

# [GATED] 게이트(플래그/권한/기업)  — 45행 / 46원자


## box  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Refuse box connect/recreate with SandClientPausedError when the sand_client_pause gate is on | `source/electron-main/box/box-client-pause.ts` |
| medium | Force-remove and recreate the local VM container when force-resetting on local-docker runtime | `source/electron-main/box/local-docker-host-connector.ts` |
| medium | Return available:false with 'Docker is not running.'/'Docker is not installed.' on local-docker runtime | `source/electron-main/box/local-docker-host-connector.ts` |
| medium | Restart the local VM container and reconnect (started-untrackable) when recreating on local-docker runtime | `source/electron-main/box/local-docker-host-connector.ts` |
| medium | Throw 'Refusing to stop unowned container grok-bot-local-vm.' when stopping an unowned local Docker container | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Box connect reports cloud-agent storage disabled and throws the no-storage marker | `source/electron-main/box/box-host-connector.ts` |
| low | Box connect returns Unauthenticated/PermissionDenied and throws the access-denied marker | `source/electron-main/box/box-host-connector.ts` |

## teach-recording  (6행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Let a recording exceed the max duration cap so it auto-stops, saves, and sends the learning prompt | `source/host/extensions/teach-recording/teach-recording-service.ts` |
| medium | Recover undelivered completed recordings on startup and deliver their learning prompt | `source/host/extensions/teach-recording/teach-recording-service.ts` |
| medium | Start recording while one is already active (returns current status, no-op) | `source/host/extensions/teach-recording/teach-recording-service.ts` |
| medium | Start recording while the teach-recording feature gate is off | `source/host/extensions/teach-recording/teach-recording-service.ts` |
| medium | Start recording with no private monitor available | `source/host/extensions/teach-recording/teach-recording-service.ts` |
| medium | Stop with save when the learning workflow is unavailable | `source/host/extensions/teach-recording/teach-recording-service.ts` |

## account  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Emit logged-out with the sign-in policy violation message when MDM policy refuses login | `source/electron-main/account/cursor-auth.ts` |
| low | Cancel the Sand trial while the gate is off and get {ok:false, message:"This isn't available right now"} | `source/electron-main/account/cursor-auth-wiring.ts` |
| low | Invoke a dashboard action / cancel-trial while signed out and get {ok:false, message:'Sign in to Cursor to continue'} | `source/electron-main/account/cursor-auth-wiring.ts` |
| low | Request the usage summary while the usage-page gate is off and get null | `source/electron-main/account/cursor-auth-wiring.ts` |

## automations/trigger  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reject a trigger save via isValidGithubRepo when the repo is not owner/name format | `source/host/automations/automation-trigger.ts` |
| medium | Save a Slack trigger with reaction match + emoji filter + bySelf to fire only on the user's own specific emoji reaction | `source/host/automations/automation-trigger.ts` |

## Diff 탭  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Babysit v2(Autopilot) 플래그가 켜지면 충돌→코멘트→CI 우선순위로 매 패스 최신 상태를 새로 읽어 머지 준비까지 자동 진행하되 머지/자동머지/draft해제는 하지 않는다 | `source/packages/agent/diff-tab-git-action-prompt.ts` |

## Cloud agents  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 팀 관리자가 cloud agents를 비활성화한 계정이면 cloud agent 사용을 차단한다 | `source/host/extensions/cloud-agents/cloud-agents-service.ts` |

## Cross-user sharing  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 공유 게이트(sand_multiplayer)가 꺼진 상태에서 공유 API를 호출하면 'Sharing isn't enabled for your account.' 오류를 받는다 | `source/host/extensions/cross-user-sharing/extension.ts` |

## Cursor 로그인  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 조직 MDM 정책이 로그인을 제한하면 허용되지 않은 계정은 sign_in_policy_violation 메시지와 함께 로그인이 막힌다 | `source/packages/cursor-config/auth/mdm-sign-in-policy.ts` |

## Settings/overlay  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | showUsage가 false이면 sections 내비게이션에서 Usage & Billing 항목이 생략된다 | `frontend/src/recovered/features/settings/overlay/view.tsx` |

## WebAuthn proxy  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return NotAllowedError with SAND_NO_WEBAUTHN_MACHINE_MESSAGE when a ceremony is requested with no registered provider machine | `source/host/extensions/webauthn-proxy/webauthn-proxy-bridge.ts` |

## automations/listener-integrations  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Generate a scope-issue notice to invite @Cursor to the channel when a Slack listener exists but the bot is absent | `source/host/automations/listener-integrations.ts` |

## local-exec/shell  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reject a shell command matching the admin denylist with 'blocked by administrator policy (denylist rule: <pattern>)' | `source/packages/local-exec/services/admin-command-denylist.ts` |

## MCP  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return per-plugin team install counts (empty map if not in a team) for sand:mcp-team-popularity | `source/electron-main/mcp/mcp-desktop.ts` |

## memory  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Enable the memory dreaming/synthesis gate so turn exchanges feed background synthesis | `source/host/extensions/memory/memory-synthesis-service.ts` |

## shell-exec/sandbox-denies  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Capture macOS Sandbox deny events and surface them as a sandbox_denies event | `source/packages/shell-exec/sandbox/macos/seatbelt.ts` |

## 계정/모드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Launch with SAND_LOCAL_CODEX_MODE=1 (runs as 'Codex Local', Cursor token requests error) | `source/electron-main/adapters/account-oauth.ts` |

## 오류 (클라우드 저장 비활성)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 저장이 비활성인 상태에서 클라우드 봇 작업을 하면 no_storage가 CLOUD_AGENT_STORAGE_DISABLED로, access_denied가 재시도 가능한 sand-access-blocked로 변환된다 | `frontend/src/recovered/runtime/coordinator-source.ts` |

## 컨텍스트 첨부 - 비디오  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 파일시스템 저장이 아닌 비디오를 Gemini 아닌 모델에 첨부하면 거부된다 | `source/packages/agent/context-processing-video-data.ts` |

## 클라우드 봇  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 팀 관리자가 Cursor 클라우드 에이전트를 비활성화하면 CloudAgent 도구가 사라지고 프롬프트가 비활성 안내로 바뀐다 | `source/host/runner/system-prompt.ts` |

## 팀 필수 플러그인  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 팀 필수 플러그인(isTeamRequired)을 목록에 필수 항목으로 표시·설치한다 | `source/packages/cursor-plugins/backend-marketplace-client.ts` |

## 플러그인 컴포넌트 범위  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Have a plugin component activate only when the current environment matches its environments frontmatter and is not in disabled-environments | `source/packages/cursor-plugins/environment-filter.ts` |

## Router/로컬  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Report local inference CLI install/availability status so the local provider becomes selectable | `source/electron-main/main-edge.ts` |

## Settings/computer  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Click 'Refresh Anyway' in a dev build to force an update even when up to date | `frontend/src/recovered/features/settings/overlay/computer.ts` |

## Settings/updates  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Observe the auto-update-when-idle switch not rendered when its gate is disabled | `frontend/src/recovered/features/settings/overlay/panels.tsx` |

## Updates  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Open the update-track picker without internal unlock and see Nightly disabled and the dogfood track hidden while a managed/effective track still appears | `source/shared/update-track.ts` |

## WindowChrome  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | On macOS, render only the drag region and rely on native traffic lights | `frontend/src/recovered/features/window-chrome/view.tsx` |

## mcp-management  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | With multi-account disabled, the RemoveMcpAccount/RenameMcpAccount tools are not offered | `source/host/runner/tools/sand-mcp-management-tools.ts` |

## 계정  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | With the iOS link gate on, the iOS menu item shows and pressing it calls onOpenIos | `frontend/src/recovered/features/account/session/menu.tsx` |

## 계정 메뉴  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | With the iOS download gate on, opening the account menu shows the 'Get Grok Bot for iOS' row that opens the iOS download page | `source/shared/node/experiments/experiment-config.gen.ts` |

## 설정 위치  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | CURSOR_CONFIG_DIR 환경변수로 Cursor 설정 디렉터리 위치를 바꾼다 | `source/packages/cursor-config/paths.ts` |
| low | XDG_CONFIG_HOME 환경변수로 Cursor 설정 디렉터리 위치를 바꾼다 | `source/packages/cursor-config/paths.ts` |

# [NOT_APPLICABLE] 해당없음  — 9행 / 9원자


## box  (7행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Local Docker container name exists but is not owned by Grok Bot, shown as a status detail | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Local Docker VM container does not yet exist, shown as 'Ready to create the local VM' | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Local Docker VM container exists but is stopped, shown as a status detail | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Local Docker VM container running but gateway not yet healthy, shown as 'Container is starting' | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Local Docker VM is running with a healthy gateway, shown as ready with 'Local Docker VM is ready' | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Local Docker VM never exposes its gateway within three minutes and throws a timeout error | `source/electron-main/box/local-docker-host-connector.ts` |
| low | Starting the local Docker VM with the runtime bundle missing throws a refusal | `source/electron-main/box/local-docker-host-connector.ts` |

## notifications  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | When OS notifications are unsupported on the platform, none are shown and deltas are observed silently | `source/electron-main/notifications/os-notification-manager.ts` |

## wallpaper  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Wallpaper helper scripts absent at startup make the wallpaper feature report disabled with no painting | `source/host/extensions/wallpaper/box-wallpaper-commands.ts` |

# [INTERNAL_ONLY] 내부  — 72행 / 72원자


## 자동화  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 짧은 시간에 여러 번 발화된 자동화 이벤트를 750ms 디바운스로 한 배치로 합친다 | `source/host/extensions/transcript/automation-event-fires.ts` |
| high | 사용자 부재 중 자동화 실행 시각에 spend guard로 발화를 user_away_paused 사유로 중단한다 | `source/host/extensions/transcript/automation-run-path.ts` |
| medium | 이벤트 자동화 발화가 폭주하면 자동화당 대기 500건 초과분이 event_batch_overflow 사유로 버려진다 | `source/host/extensions/transcript/automation-event-fires.ts` |
| medium | 같은 자동화가 실행 중인데 또 발화되면 duplicate_in_flight 사유로 중복 발화가 버려져 한 번만 실행된다 | `source/host/extensions/transcript/automation-run-path.ts` |

## attachments  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return link-preview metadata with bounded preview image and favicon data URLs when the renderer requests it for a URL | `source/electron-main/attachments/attachments.ts` |
| medium | Transcode and serve an h264 playback rendition when reading an HEVC video chunk for playback | `source/host/extensions/attachments/video-playback-rendition.ts` |
| low | Reject a commit whose path is outside the staging dir by returning null | `source/electron-main/attachments/attachments.ts` |
| low | Return {kind:'too-large', size} when reading attachment bytes for a file larger than the byte cap | `source/electron-main/attachments/attachments.ts` |

## Transcript  (4행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Stamp and re-render a box-request card entry with its resolution | `source/host/extensions/transcript/box-request-entries.ts` |
| medium | Interrupt a wedged run via the scheduler watchdog when it passes the watchdog window | `source/host/extensions/transcript/run-lifecycle.ts` |
| medium | Throw RUNNER_UNATTACHED_MESSAGE when a prompt is sent with no turn executor attached | `source/host/extensions/transcript/send-pipeline.ts` |
| low | A newer send supersedes an in-flight turn and the stale turn is cancelled (superseded) with no error surfaced | `source/host/extensions/transcript/turn-runtime.ts` |

## 대화 전송  (3행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Resend differing content under the same client nonce (rejected with NONCE_DIGEST_MISMATCH) | `source/host/extensions/transcript/prompt-acceptance-ledger.ts` |
| medium | Retry a previously rejected send under the same nonce (original rejection replayed with rejectionCode) | `source/host/extensions/transcript/prompt-acceptance-ledger.ts` |
| medium | Send fails to persist because DB is locked/closed (explicit rejection so client can retry, not silently dropped) | `source/host/extensions/transcript/send-not-persisted-error.ts` |

## 임베디드 브라우저  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 허용 목록 IdP 호스트에서 local-network-access 권한을 granted로 폴리필한다 | `source/electron-preload/preload-browser-base.ts` |
| medium | 웹뷰의 alert/confirm/prompt를 스텁으로 대체해 alert는 무시, confirm은 true, prompt는 null을 반환한다 | `source/electron-preload/preload-browser-base.ts` |

## 큐/응답  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 멈춘(wedged) 선행 실행을 watchdog 타임아웃 후 중단하고 강제 해제해 대기 메시지를 실행한다 | `source/host/extensions/transcript/run-scheduler.ts` |
| medium | 큐에서 user 레인을 우선하고 group-member 소스를 뒤로 밀어 직접 사용자 메시지를 먼저 처리한다 | `source/host/extensions/transcript/run-scheduler.ts` |

## Cross-user sharing  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 공유된 에이전트를 삭제하면 이탈/멤버제거 의무가 원장에 기록·플러시되어 방에서 자동 이탈한다 | `source/host/extensions/cross-user-sharing/xuser-departure-obligations.ts` |
| medium | 공유 방에 이미지 메시지를 발행하면 이미지가 항목당 4장·총 1.1MB 한도 내에서 인라인 base64로 첨부된다 | `source/host/extensions/cross-user-sharing/xuser-entry-publisher.ts` |

## Disk pressure  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 볼륨 여유 공간이 소프트 임계(8GiB/15%) 아래로 떨어지면 disk pressure를 'soft'로 분류하고 transition 텔레메트리 보고 및 구독자에게 soft 통지한다 | `source/host/extensions/forever-box/disk-pressure-guard.ts` |
| medium | 디스크 압력 상태에서 에이전트가 리마인더 에피소드를 청구하면 미처리 에피소드 id가 배정되고 커밋 시 원장에 처리 완료로 영속화된다 | `source/host/extensions/forever-box/disk-pressure.ts` |

## Managed setup  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 인증되어 관리 스킬이 startup으로 갱신되면 백엔드에서 받은 관리 스킬이 캐시 디렉터리에 SKILL.md로 실체화된다 | `source/host/extensions/managed-setup/managed-skills-service.ts` |
| medium | 팀 규칙을 조회하면 Sand/ALL 대상 팀 규칙이 병합되어 Cursor 규칙 형식으로 반환된다(팀 없으면 빈 목록) | `source/host/extensions/managed-setup/team-rules.ts` |

## notifications  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 같은 에이전트+종류의 전환이 5초 내 여러 번 일어나면 첫 번째만 발생하고 이후는 SAND_OS_NOTIFICATION_THROTTLE_MS(5000ms) 동안 스로틀된다 | `source/shared/os-notification.ts` |
| medium | Suppress the mobile push when the window was focused within the last 5 minutes | `source/host/extensions/notifications/mobile-push-notifier.ts` |

## account  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Return true for privacy-mode-enabled while signed out (privacy on by default) | `source/electron-main/account/cursor-auth-wiring.ts` |
| low | Return {ok:false, message:"This action isn't supported by this version of Grok Bot"} for an unsupported dashboard action | `source/electron-main/account/cursor-auth-wiring.ts` |

## coordinator  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Automatically relaunch the coordinator utility process with backoff after an unexpected exit | `source/electron-main/coordinator/coordinator-runtime.ts` |
| low | A coordinator restart request launches a fresh coordinator and disposes the previous one | `source/electron-main/coordinator/coordinator-runtime.ts` |

## local-tool-permission  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Expire stale pending local-tool permission cards from before boot during the boot sweep | `source/host/extensions/local-tool-permission/extension.ts` |
| medium | Expire an agent's pending asks and retire outstanding approvals when a new turn begins | `source/host/extensions/local-tool-permission/local-tool-permission-controller.ts` |

## media  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Serve a 206 partial-content response for a sand-media:// request carrying a Range header | `source/electron-main/media/media-protocol.ts` |
| low | A sand-media:// request for a local media file without a Range header is served as a full 200 response | `source/electron-main/media/media-protocol.ts` |

## 복구  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Host restarts with in-progress cloud agent/bg shell watch (pending-wake re-armed, watch resumed) | `source/host/extensions/transcript/pending-wake-rearm.ts` |
| medium | Cloud agent watch present during computer recreate (watch carried over via recreate_carry and re-armed) | `source/host/extensions/transcript/upgrade-recreate-resume.ts` |

## 복구/재연결  (2행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reconnect to a box (immediate reconnect via encrypted gateway-descriptor cache, cache cleared on broker reject, 7-day expiry) | `source/electron-main/box/gateway-descriptor-cache.ts` |
| medium | System resumes from sleep (recentWake marker set for 60s to inform reconnect/diagnostics) | `electron-main/coordinator/desktop-connectivity.ts + adapters/coordinator-native.ts` |

## 에이전트 스토어 동기화 - 토큰  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | Stand down a store mint indefinitely and fire onSyncDisabledMint on a sync-disabled/legacy-privacy error | `source/packages/agent-store-sync/token-caching-client.ts` |

## 컨텍스트 압축  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 대화가 컨텍스트 한도에 다다르면 자동으로 요약되어 이어진다 | `source/packages/agent/summarization-orchestrator.ts` |

## 플러그인 훅  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| high | 플러그인이 제공하는 훅(cursor/claude-code 스키마)을 로드해 prompt형/command형 훅을 등록한다 | `source/packages/cursor-plugins/loader.ts` |

## Action audit  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | MCP 툴 호출/셸 명령/브라우저 이동/컴퓨터 사용 세션 발생 시 audit.jsonl에 액션 라인을 기록한다 | `source/host/extensions/action-audit/action-audit-service.ts` |

## Auto-review approval  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 승인 카드/도구 명령에 토큰·비밀·URL 인증정보가 있으면 표시 텍스트에서 '…'로 리댁션한다 | `source/shared/sand-auto-review-redact.ts` |

## Composer/Editor  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 저장된 rich text JSON이 손상되면 평문 프롬프트 내용으로 폴백한다 | `frontend/src/recovered/features/conversation/workspace/rich-text-editor.tsx` |

## Coordinator transport  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | coordinator 포트 종료/셧다운/버전 불일치 시 대기 호출을 거부하고 재연결 후 새 포트를 재확보한다 | `frontend/src/production/coordinator-client.ts` |

## MCP 안정성  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | MCP 도구 호출이 응답 없이 오래 걸리면 최대 총 타임아웃(60분) 후 호출이 종료된다 | `source/packages/mcp-core/config/mcp-tool-call-timeout.ts` |

## content-search  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Fall back to a linear scan across agent transcripts when the search index is not ready | `source/host/extensions/transcript/roster-search.ts` |

## session  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Reconstruct a minimal summary when store.db is missing but the folder has durable footprint | `source/host/extensions/session/session-mutations.ts` |

## shell-exec/cancel  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Abort a running shell command (SIGTERM, then SIGKILL after 1s, exit reports aborted=true) | `source/packages/shell-exec/core.ts` |

## shell-exec/state  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Preserve cwd/env state for the next command in the same shell session | `source/packages/shell-exec/bash.ts` |

## shell-exec/sudo  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Rewrite sudo to 'sudo -A' when SUDO_ASKPASS is set | `source/packages/shell-exec/sudo.ts` |

## zsh 상태 세션  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Initialize an interactive login zsh session and snapshot user env/alias/functions/cwd | `source/packages/shell-exec/zsh.ts` |

## 대화 복구  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Start a turn with unconfirmed prior user messages (prepended for recovery by watermark) | `source/host/runner/conversation-state.ts` |

## 복구/코디네이터  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | Coordinator process crashes (auto-restarted with exponential backoff 250ms-10s, <30s uptime classified as error) | `source/electron-main/coordinator/coordinator-telemetry.ts` |

## 복원력  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 대화 루트 blob이 없거나 손상되면 빈 ConversationStateStructure로 복구한다 | `source/packages/agent-kv/agent-store.ts` |

## 셸 실행 환경  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 셸 executor가 명령을 실행할 때 SHELL_ENV_OVERRIDES를 강제해 ANSI 색상/zoxide doctor 잡음을 제거한다 | `source/packages/shell-exec/types.ts` |

## 안정성  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | host에서 uncaughtException/unhandledRejection이 발생하면 잡아 로그만 남기고 프로세스를 살려 둔다 | `source/host/process-crash-guard.ts` |

## 업데이트/유휴  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| medium | 유휴 자동 업데이트는 화면 잠금/스크린세이버+시스템 유휴 10분+호스트 유휴 확인일 때만 재시작 설치하고 아니면 건너뛴다 | `electron-main/update/safe-relaunch-gate.ts + idle-relaunch-apply.ts + idle-relaunch-signals.ts` |

## Local tool permission card  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Render nothing for the local-tool permission card when store/RPC ownership is missing | `frontend/src/recovered/features/conversation/cards/transcript-card/views/local-tool-permission.tsx` |

## Reactions  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Silently swallow a failed reaction transport with no error copy | `frontend/src/recovered/features/conversation/cards/transcript-card/reaction-actions.ts` |

## auth  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Register the app as the default protocol client for the sand: deep-link scheme on packaged non-lab startup | `source/electron-main/auth/auth-callback-registration.ts` |

## local-exec/provider  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | An exec cancel frame aborts execution via executor.cancel and controller.abort | `source/host/local-exec/local-exec-provider.ts` |

## stream-retry  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | No first token within the stall deadline fires a FirstTokenStallError and the attempt is retried | `source/host/runner/stream-attempt.ts` |

## 데이터/마이그레이션  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | Upgrading from an old brand root migrates user data to the canonical 'Grok Bot' root (keeping the old root on conflict/running) | `electron-main/startup/startup-data-root-migration.ts + windows-user-data-migration.ts` |

## 사이드바 (섹션 동기화)  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | host-settings 이벤트에 sidebarSections가 포함되면 브리지에서 섹션을 자동 재로드한다 | `frontend/src/recovered/features/conversation/workspace/sidebar-sections-state.ts` |

## 시작/상태 동기화  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 앱 시작 시 sand:theme-get-sync 등 동기 IPC로 초기 테마/egress/webauthn 상태를 즉시 반영한다 | `source/electron-main/prefs/settings-ipc.ts` |

## 업그레이드 대기  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | quiesce 요청 상태에서 새 실행을 시도하면 즉시 빈 결과로 반환되고 배경 watch가 취소된다 | `source/host/runner/sand-agent-runner.ts` |

## 정보-비동기작업  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 30초 시계 틱이 발생하면 작업 행의 상대 시각이 갱신된다 | `frontend/src/recovered/features/agent-info/async-tasks/view.tsx` |

## 정보-설정  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 권위 있는 roster 이벤트로 에이전트가 갱신되면 설정 필드가 최신 값으로 반영된다 | `frontend/src/recovered/features/agent-info/settings/model.ts` |

## 지출 가드  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 지출 가드 상태(넛지 시각·스누즈 만료·옵트아웃·연결 카드·일시정지 자동화 ID)가 지속 저장되어 재진입 후에도 유지된다 | `source/host/extensions/session/agent-db-serde.ts` |

## 창 닫기 정책  (1행)

| 심각도 | 원자 행동 | 소스 |
| --- | --- | --- |
| low | 창 닫기 시 health가 busyOnlyAwaitingApproval을 구분해 승인만 대기 중인 경우와 진행 중 작업을 다르게 취급한다 | `source/host/sand-host.ts` |

## 후속 정규화 상태

원문 기능 행은 기준선 보존을 위해 그대로 두고 active 원장에서 보정한다. `G1707`은 `GBF-USR-000932`로 KEEP 연결됐고, 깨진/복합 소스 참조 16행은 실제 경로로 보정됐다. 1,500개 기능의 소스 참조가 모두 현재 트리에서 해석된다. 하위절 제목 75개의 원래 행 수와 원자 행 수 차이는 [heading count audit](audit/grok-feature-heading-counts.json)에 기록했다.
