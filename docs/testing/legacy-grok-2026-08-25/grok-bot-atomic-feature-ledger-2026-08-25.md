# Grok Bot 원자 기능 원장

- 상태: `PROVISIONAL_LEGACY_BASELINE`
- 기준일: 2026-08-25 KST
- 마스터 계획: [grok-bot-full-feature-user-test-plan-2026-08-25.md](grok-bot-full-feature-user-test-plan-2026-08-25.md)
- 실행 판정 기준: [grok-bot-user-test-standard-2026-08-25.md](grok-bot-user-test-standard-2026-08-25.md)
- 신규 안정 ID 기준선: [audit/grok-feature-registry.jsonl](audit/grok-feature-registry.jsonl)
- 원자 기능 등록: 344개
- 원장 분모: 미동결
- 실사용 테스트: 시작 전. 실제 앱 미실행 및 WSL CLI 연결 경로 정비 필요

이 344개는 초기 원장이다. 신규 가확정 후보 1,500개와 중복·포함 관계를 정규화하기 전에는 합산하거나 실사용 커버리지 분모로 사용하지 않는다.

이 문서는 소스에 존재하는 큰 기능 이름을 기록하는 목록이 아니다. 하나의 사용자 행동과 하나의 관찰 가능한 결과로 판정할 수 있는 최소 기능을 등록한다.

## 1. 추출 진행률

| 표면 | 관찰 규모 | 등록 상태 | 완료 조건 |
| --- | ---: | --- | --- |
| Renderer 기능 파일 | 251 | 추출 중 | 모든 진입점·컨트롤·상태 매핑 |
| 사용자 조작 표식 | 325 occurrences | 추출 중 | 중복 제거 후 모든 컨트롤 매핑 |
| 원자 기능 행 | 344 | 1차 등록 완료 | 나머지 표면 역대조 후 분모 동결 |
| Host gateway 명령 | 123 | 123/123 원자 매핑 완료 | 누락 0 검산 유지 |
| Host extension 기능 파일 | 283 | 대기 | 사용자/도구/백그라운드 매핑 |
| Electron main 기능 파일 | 185 | 대기 | IPC·창·계정·업데이트 매핑 |
| Coordinator 기능 파일 | 24 | 일부 추출 | 라우팅·이벤트·복구 매핑 |
| Grok/워커 도구 | 분모 추출 중 | 브라우저·컴퓨터·파일·봇·서브에이전트·MCP 1차 등록 | Shell/Read/meta/dynamic 도구까지 역대조 |
| 기존 자동 테스트 | 14 | 보조 증거만 | 실사용 PASS 대체 금지 |

## 2. 상태와 테스트 축

- 상태: `EXTRACTED`, `NEEDS_SPLIT`, `INTERNAL_ONLY`, `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED`, `NOT_APPLICABLE`, `PROVISIONAL`
- 축: `N` 정상, `B` 경계, `E` 오류, `P` 지속성, `I` 격리성, `U` 사용자 적합성

## 3. 핵심 원자 기능

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| SYS-001 | 시작 | 실제 WSL 프로필로 앱을 시작한다 | WSL launcher | N,E,P,U | `scripts/run-wsl.mjs` | EXTRACTED |
| SYS-002 | 시작 | 중복 실행 시 기존 프로필과 충돌하지 않는다 | WSL launcher | B,E,I | `scripts/lib/wsl-runtime.mjs` | EXTRACTED |
| SYS-003 | 시작 | host 연결 중 로딩 상태를 표시한다 | 앱 시작 | N,E,U | root resilience/roster | EXTRACTED |
| SYS-004 | 시작 | host 연결 실패를 빈 정상 화면으로 위장하지 않는다 | 앱 시작 | E,U | roster access readiness | EXTRACTED |
| SYS-005 | 온보딩 | 봇이 없을 때 온보딩을 표시한다 | 최초 실행 | N,P,U | onboarding | EXTRACTED |
| SYS-006 | 온보딩 | 기존 봇이 있으면 온보딩을 건너뛴다 | 재실행 | N,P | `countAgents` | EXTRACTED |
| SYS-007 | 계정 | 현재 계정 정보를 표시한다 | Account menu | N,P,U | account/session | EXTRACTED |
| SYS-008 | 계정 | 사용자 이름을 입력·수정한다 | Account menu | N,B,P | account/session/menu | EXTRACTED |
| SYS-009 | 계정 | 로그아웃 전에 확인한다 | Account menu | N,E,U | confirm-logout | EXTRACTED |
| SYS-010 | 계정 | 로그아웃 취소가 현재 상태를 보존한다 | confirm-logout | N,P | confirm-logout | EXTRACTED |
| WIN-001 | 창 | 최소화한다 | Window chrome | N | window-chrome | EXTRACTED |
| WIN-002 | 창 | 최대화·복원한다 | Window chrome | N,P,U | window-chrome | EXTRACTED |
| WIN-003 | 창 | 닫기 동작이 진행 중 작업 정책을 따른다 | Window chrome | N,E,P | window-chrome | EXTRACTED |
| CHAT-001 | 대화 | 빈 입력에서는 전송할 수 없다 | Composer | B,U | conversation composer | EXTRACTED |
| CHAT-002 | 대화 | 일반 텍스트를 키보드로 입력한다 | Composer | N,U | conversation composer | EXTRACTED |
| CHAT-003 | 대화 | Enter로 메시지를 전송한다 | Composer | N,B | rich text editor | EXTRACTED |
| CHAT-004 | 대화 | Shift+Enter로 줄바꿈한다 | Composer | N,B | rich text editor | EXTRACTED |
| CHAT-005 | 대화 | 전송 버튼으로 메시지를 전송한다 | Composer | N | conversation composer | EXTRACTED |
| CHAT-006 | 대화 | 중복 전송이 한 메시지로 수락된다 | Composer | B,I | `promptAcceptanceStatus` | EXTRACTED |
| CHAT-007 | 대화 | 전송 직후 사용자 메시지가 표시된다 | Transcript | N,U | transcript event | EXTRACTED |
| CHAT-008 | 대화 | 응답 중 Working/Thinking 상태를 표시한다 | Transcript | N,E,U | inference activity | EXTRACTED |
| CHAT-009 | 대화 | 스트리밍 답변이 한 메시지로 갱신된다 | Transcript | N,B,U | transcript append/update | EXTRACTED |
| CHAT-010 | 대화 | 응답 완료 후 진행 표시를 제거한다 | Transcript | N,E,U | inference activity | EXTRACTED |
| CHAT-011 | 대화 | 공급자 오류를 오류 메시지로 표시한다 | Transcript | E,U | inference router | EXTRACTED |
| CHAT-012 | 대화 | 대화 전환 후 각 대화 기록이 분리된다 | Sidebar/chat | N,P,I | transcript window | EXTRACTED |
| CHAT-013 | 대화 | 새 대화에 이전 대화가 섞이지 않는다 | New | N,P,I | active transcript load | EXTRACTED |
| CHAT-014 | 대화 | 기존 대화를 다시 열면 마지막 기록이 복구된다 | Sidebar | N,P | openAgentTail/window | EXTRACTED |
| CHAT-015 | 대화 | 긴 기록에서 이전 페이지를 불러온다 | Transcript scroll | N,B,P | transcript page/window | EXTRACTED |
| CHAT-016 | 대화 | 대화 개요를 열고 항목으로 이동한다 | Conversation outline | N,U | `getConversationOutline` | EXTRACTED |
| CHAT-017 | 대화 | 메시지에 답장 대상을 붙인다 | Message actions | N,I,U | reply preview | EXTRACTED |
| CHAT-018 | 대화 | 답장 대상을 취소한다 | Composer | N,U | reply preview | EXTRACTED |
| CHAT-019 | 대화 | 메시지에 반응을 추가한다 | Message actions | N,P | `reactToMessage` | EXTRACTED |
| CHAT-020 | 대화 | 같은 반응을 다시 눌러 제거한다 | Message actions | N,P | reaction toggle | EXTRACTED |
| CHAT-021 | 대화 | 메시지 메뉴를 키보드로 연다 | Message actions | N,U | message actions | EXTRACTED |
| CHAT-022 | 대화 | 음성 입력을 시작한다 | Composer mic | N,E,U | voice session | EXTRACTED |
| CHAT-023 | 대화 | 음성 입력을 취소한다 | Composer mic/Escape | N,E,U | voice session | EXTRACTED |
| CHAT-024 | 대화 | 음성 변환 실패를 표시한다 | Composer | E,U | voice error | EXTRACTED |
| ATT-001 | 첨부 | 파일 선택기를 연다 | Attach file | N,U | composer | EXTRACTED |
| ATT-002 | 첨부 | 파일을 드래그해 추가한다 | Composer drop | N,B,U | composer | EXTRACTED |
| ATT-003 | 첨부 | 여러 파일 제한을 적용한다 | Composer | B,E | attachment limit | EXTRACTED |
| ATT-004 | 첨부 | 전송 전 첨부를 제거한다 | Attachment pill | N | composer | EXTRACTED |
| ATT-005 | 첨부 | 첨부 파일을 업로드하고 메시지에 연결한다 | Composer | N,E,P | `uploadAttachment` | EXTRACTED |
| ATT-006 | 첨부 | 이미지 첨부를 다시 열어 본다 | Transcript | N,E | `readAttachmentImage` | EXTRACTED |
| ATT-007 | 첨부 | 텍스트 첨부를 읽는다 | Transcript | N,E | `readAttachmentText` | EXTRACTED |
| ATT-008 | 첨부 | 큰 첨부를 청크 단위로 읽는다 | Transcript | N,B,E | `readAttachmentChunk` | EXTRACTED |
| BOT-001 | 봇 | New 버튼으로 새 봇을 만든다 | Sidebar New | N,E,P,U | `createAgent` | EXTRACTED |
| BOT-002 | 봇 | 생성된 봇이 사이드바에 표시된다 | Sidebar | N,P,U | agents event | EXTRACTED |
| BOT-003 | 봇 | 빈 섹션 설정에서도 봇이 숨지 않는다 | Sidebar | B,P,I | sidebar projection | EXTRACTED |
| BOT-004 | 봇 | 봇을 열면 해당 대화로 전환한다 | Sidebar row | N,I | `openAgent` | EXTRACTED |
| BOT-005 | 봇 | 봇 이름을 수정한다 | Row/settings | N,B,P | `updateAgent` | EXTRACTED |
| BOT-006 | 봇 | 봇 설명을 수정한다 | Agent settings | N,B,P | `updateAgent` | EXTRACTED |
| BOT-007 | 봇 | 봇 제목을 수정한다 | Agent settings | N,B,P | `updateAgent` | EXTRACTED |
| BOT-008 | 봇 | 봇 아바타를 수정한다 | Avatar editor | N,E,P,U | `setAgentAvatarBytes` | EXTRACTED |
| BOT-009 | 봇 | 봇 아바타를 다시 불러온다 | Sidebar/header | N,E,P | `getAgentAvatar` | EXTRACTED |
| BOT-010 | 봇 | 봇을 복제한다 | Row actions | N,E,P | `duplicateAgent` | EXTRACTED |
| BOT-011 | 봇 | 봇을 고정한다 | Row actions | N,P,U | sidebar state | EXTRACTED |
| BOT-012 | 봇 | 고정 순서를 바꾼다 | Sidebar drag | N,B,P,U | pinned reorder | EXTRACTED |
| BOT-013 | 봇 | 봇을 읽지 않음/읽음으로 바꾼다 | Row actions | N,P | `setAgentUnread` | EXTRACTED |
| BOT-014 | 봇 | 봇을 숨긴다 | Row actions | N,P,U | `setAgentHiddenFromSidebar` | EXTRACTED |
| BOT-015 | 봇 | 숨긴 봇 목록을 연다 | Hidden Bots | N,U | hidden-chats | EXTRACTED |
| BOT-016 | 봇 | 숨긴 봇을 복구한다 | Hidden Bots | N,P | hidden-chats | EXTRACTED |
| BOT-017 | 봇 | 봇 삭제 전에 확인한다 | Row actions | N,U | delete confirmation | EXTRACTED |
| BOT-018 | 봇 | 삭제 취소가 봇을 보존한다 | Delete dialog | N,P | delete confirmation | EXTRACTED |
| BOT-019 | 봇 | QA 봇 하나를 삭제한다 | Delete dialog | N,E,P | `deleteAgent` | EXTRACTED |
| BOT-020 | 봇 | 선택한 여러 QA 봇을 삭제한다 | Multi-select | N,B,E | `deleteAgents` | EXTRACTED |
| BOT-021 | 봇 | 사이드바 크기를 조절한다 | Resize handle | N,B,P,U | sidebar | EXTRACTED |
| BOT-022 | 봇 | 사이드바를 접고 펼친다 | Sidebar | N,P,U | sidebar layout | EXTRACTED |
| BOT-023 | 섹션 | 새 섹션을 만든다 | Sidebar move/new | N,E,P | sidebar sections | EXTRACTED |
| BOT-024 | 섹션 | 섹션 이름을 바꾼다 | Section actions | N,B,P | sidebar sections | EXTRACTED |
| BOT-025 | 섹션 | 봇을 섹션으로 이동한다 | Move/drag | N,B,P,I | sidebar sections | EXTRACTED |
| BOT-026 | 섹션 | 섹션을 접고 펼친다 | Section header | N,P,U | sidebar sections | EXTRACTED |
| BOT-027 | 섹션 | 섹션 순서를 바꾼다 | Section actions | N,B,P | sidebar sections | EXTRACTED |
| BOT-028 | 섹션 | 섹션을 삭제해도 봇은 보존된다 | Section actions | N,E,P,I | sidebar sections | EXTRACTED |
| ORCH-001 | 오케스트레이션 | Grok이 현재 봇 목록을 조회한다 | Grok tool | N,E | `ListAgents` | EXTRACTED |
| ORCH-002 | 오케스트레이션 | Grok이 전문 봇을 백그라운드 생성한다 | Grok tool | N,E,P | `CreateAgent` | EXTRACTED |
| ORCH-003 | 오케스트레이션 | 백그라운드 생성이 Grok 대화를 바꾸지 않는다 | Grok tool | N,I,U | `CreateAgent` | EXTRACTED |
| ORCH-004 | 오케스트레이션 | 중복 tool-call이 봇을 한 번만 만든다 | Grok tool | B,I | tool-call ledger | EXTRACTED |
| ORCH-005 | 오케스트레이션 | Grok이 다른 봇 이름을 수정한다 | Grok tool | N,E,P | `UpdateAgent` | EXTRACTED |
| ORCH-006 | 오케스트레이션 | Grok이 자기 프로필을 잘못 수정하지 않는다 | Grok tool | B,E,I | `UpdateAgent` guard | EXTRACTED |
| ORCH-007 | 오케스트레이션 | Grok이 대상 봇에 작업을 전달한다 | Grok tool | N,E | `SendToAgent` | EXTRACTED |
| ORCH-008 | 오케스트레이션 | 일반 위임이 비동기 수락으로 표시된다 | Grok tool | N,U | agent messaging | EXTRACTED |
| ORCH-009 | 오케스트레이션 | 우선 위임이 비사용자 작업을 중단·대체한다 | Grok tool | N,B,E | priority send | EXTRACTED |
| ORCH-010 | 오케스트레이션 | 봇이 위임 내용을 정확히 받는다 | Worker transcript | N,I | inbound wake | EXTRACTED |
| ORCH-011 | 오케스트레이션 | 봇이 Grok에게 결과를 회신한다 | Worker tool | N,E | `SendToAgent` | EXTRACTED |
| ORCH-012 | 오케스트레이션 | 봇 회신이 Grok을 새 턴으로 깨운다 | Grok transcript | N,E,P | inbound wake | EXTRACTED |
| ORCH-013 | 오케스트레이션 | 봇 회신 후 사이드바 전체가 사라지지 않는다 | Sidebar | N,E,I | agents event projection | EXTRACTED |
| ORCH-014 | 오케스트레이션 | Grok이 워커 결과를 검토한 뒤 보고한다 | Grok behavior | N,E,U | user journey | NEEDS_SPLIT |
| ORCH-015 | 오케스트레이션 | Grok이 직접 처리와 워커 사용을 구분한다 | Grok behavior | N,B,U | user journey | NEEDS_SPLIT |
| ORCH-016 | 오케스트레이션 | 필요 이상의 봇을 만들지 않는다 | Grok behavior | B,U | user journey | NEEDS_SPLIT |
| ORCH-017 | 오케스트레이션 | 복수 워커 결과를 대상별로 분리한다 | Grok behavior | N,B,I | user journey | NEEDS_SPLIT |
| ORCH-018 | 오케스트레이션 | 실패한 워커를 완료로 보고하지 않는다 | Grok behavior | E,U | user journey | NEEDS_SPLIT |
| ORCH-019 | 오케스트레이션 | 생성·휴면 봇의 첫 작업을 명시적으로 시작한다 | Grok/UI runtime | N,E | `kickstartAgent` | EXTRACTED |
| SUB-001 | 서브에이전트 | Grok이 백그라운드 서브에이전트를 시작한다 | Task | N,E | subagent runtime | EXTRACTED |
| SUB-002 | 서브에이전트 | 실행 중 서브에이전트 목록을 확인한다 | CheckSubagent | N,E | `CheckSubagent` | EXTRACTED |
| SUB-003 | 서브에이전트 | 특정 서브에이전트 진행을 확인한다 | CheckSubagent | N,E,U | `CheckSubagent` | EXTRACTED |
| SUB-004 | 서브에이전트 | 실행 중 서브에이전트에 개입 메시지를 보낸다 | MessageSubagent | N,E | `MessageSubagent` | EXTRACTED |
| SUB-005 | 서브에이전트 | 실행 중 서브에이전트를 중단한다 | StopSubagent | N,E | `StopSubagent` | EXTRACTED |
| SUB-006 | 서브에이전트 | 완료된 서브에이전트를 실행 중으로 오인하지 않는다 | CheckSubagent | E,U | subagent runtime | EXTRACTED |
| MEM-001 | 메모리 | 봇의 저장된 메모리 목록을 연다 | Agent settings | N,E | `getAgentMemories` | EXTRACTED |
| MEM-002 | 메모리 | 저장된 사용자 사실이 다음 관련 대화에 반영된다 | Grok conversation | N,P,I | memory extension | NEEDS_SPLIT |
| MEM-003 | 메모리 | 다른 봇의 메모리가 무관한 대화에 섞이지 않는다 | Two bots | I,P | memory extension | NEEDS_SPLIT |
| MEM-004 | 메모리 | QA 메모리 하나를 삭제한다 | Memory UI | N,E,P | `deleteAgentMemory` | EXTRACTED |
| MEM-005 | 메모리 | 전체 삭제 전에 확인한다 | Memory UI | N,U | memory UI | EXTRACTED |
| MEM-006 | 메모리 | 전체 삭제 취소가 메모리를 보존한다 | Memory UI | N,P | memory UI | EXTRACTED |
| MEM-007 | 메모리 | 승인 후 QA 봇 메모리를 전체 삭제한다 | Memory UI | N,E,P | `clearAgentMemories` | BLOCKED |

## 3.1 검색·그룹·알림

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| SEARCH-001 | 전역 검색 | 사이드바에서 검색을 연다 | Search | N,U | sidebar-search-trigger | EXTRACTED |
| SEARCH-002 | 전역 검색 | 키보드로 검색을 연다 | Search shortcut | N,B,U | sidebar-search-trigger | EXTRACTED |
| SEARCH-003 | 전역 검색 | 봇 이름·대화 내용으로 검색한다 | Search overlay | N,B,E | `searchAgents` | EXTRACTED |
| SEARCH-004 | 전역 검색 | 검색 결과에서 해당 봇과 대화를 연다 | Search result | N,I,U | `searchAgents`, `openAgent` | EXTRACTED |
| SEARCH-005 | 전역 검색 | 미디어를 검색한다 | Search media tab | N,B,E | `searchMedia` | EXTRACTED |
| SEARCH-006 | 전역 검색 | 미디어 결과를 원본 대화에서 연다 | Media result | N,E,I | `searchMedia`, attachments | EXTRACTED |
| SEARCH-007 | 전역 검색 | 결과가 없을 때 빈 상태를 표시한다 | Search overlay | B,U | search projection | EXTRACTED |
| SEARCH-008 | 전역 검색 | 검색 실패를 빈 결과로 위장하지 않는다 | Search overlay | E,U | search projection | EXTRACTED |
| SEARCH-009 | 전역 검색 | 검색 기능이 비활성일 때 진입점을 숨기거나 이유를 표시한다 | Search | E,U | `isGlobalSearchEnabled` | EXTRACTED |
| SEARCH-010 | 대화 내 검색 | 현재 대화에서 찾기를 연다 | Find in chat | N,U | find-in-chat-controller | EXTRACTED |
| SEARCH-011 | 대화 내 검색 | 다음·이전 일치 항목으로 이동한다 | Find in chat | N,B | find-in-chat-controller | EXTRACTED |
| SEARCH-012 | 대화 내 검색 | 검색을 닫으면 기존 스크롤·포커스를 복구한다 | Find in chat | N,P,U | find-in-chat-controller | EXTRACTED |
| GROUP-001 | 그룹 | 새 그룹을 만든다 | New/group action | N,E,P | `createGroup` | EXTRACTED |
| GROUP-002 | 그룹 | 생성한 그룹이 사이드바에 표시된다 | Sidebar | N,P,U | agents event | EXTRACTED |
| GROUP-003 | 그룹 | 그룹 멤버 목록을 연다 | Agent info | N,U | group-members | EXTRACTED |
| GROUP-004 | 그룹 | 그룹에 기존 봇을 추가한다 | Group members | N,E,P,I | `setGroupMembers` | EXTRACTED |
| GROUP-005 | 그룹 | 그룹에서 봇을 제거한다 | Group members | N,E,P,I | `setGroupMembers` | EXTRACTED |
| GROUP-006 | 그룹 | 같은 봇을 중복 멤버로 저장하지 않는다 | Group members | B,I | group-members model | EXTRACTED |
| GROUP-007 | 그룹 | 그룹 대화를 연다 | Sidebar/org chart | N,I | `openAgent` | EXTRACTED |
| GROUP-008 | 그룹 | 그룹 메시지가 지정 멤버 범위를 벗어나지 않는다 | Group composer | N,E,I | group routing | NEEDS_SPLIT |
| GROUP-009 | 그룹 | 그룹 멤버 변경 중 실패를 표시하고 이전 상태를 보존한다 | Group members | E,P | group-members controller | EXTRACTED |
| GROUP-010 | 그룹 | 그룹을 삭제해도 멤버 봇은 보존된다 | Delete dialog | N,E,P,I | `deleteAgent` | EXTRACTED |
| GROUP-011 | 그룹 | 에이전트 네트워크에서 그룹과 멤버 관계를 표시한다 | Agent network | N,B,U | org-chart workspace | EXTRACTED |
| NOTIFY-001 | 알림 | 봇별 알림을 켜고 끈다 | Agent settings | N,E,P | `setAgentNotificationsEnabled` | EXTRACTED |
| NOTIFY-002 | 알림 | 봇 업데이트 알림을 켜고 끈다 | Agent settings | N,E,P | `setAgentNotifyOnUpdates` | EXTRACTED |
| NOTIFY-003 | 알림 | 앱 포커스 상태를 host에 전달한다 | Window focus | N,P | `setWindowFocused` | EXTRACTED |
| NOTIFY-004 | 알림 | 포커스한 현재 봇을 읽음 처리한다 | Open/focus | N,I | unread projection | EXTRACTED |
| NOTIFY-005 | 알림 | 백그라운드 봇 업데이트를 현재 대화 메시지로 오인하지 않는다 | OS/sidebar notification | N,E,I | notifications/notify-bus | NEEDS_SPLIT |

## 3.2 자동화·워크플로

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| AUTO-001 | 자동화 | 현재 봇의 자동화 목록을 연다 | Agent settings/Routines | N,E | `getAgentAutomations` | EXTRACTED |
| AUTO-002 | 자동화 | 모든 봇의 자동화 목록을 연다 | Automations | N,E,I | `listAllAutomations` | EXTRACTED |
| AUTO-003 | 자동화 | 새 자동화를 만든다 | Routines | N,E,P | `createAgentAutomation` | EXTRACTED |
| AUTO-004 | 자동화 | 자동화 지시문을 수정한다 | Routines | N,B,E,P | `updateAgentAutomation` | EXTRACTED |
| AUTO-005 | 자동화 | 매시간 트리거를 추가한다 | Add trigger | N,P | schedule-editor | EXTRACTED |
| AUTO-006 | 자동화 | 고급 일정 트리거를 입력·저장한다 | Advanced trigger | N,B,E,P | schedule-editor | EXTRACTED |
| AUTO-007 | 자동화 | 트리거를 편집·취소한다 | Trigger row | N,P,U | trigger-draft-controller | EXTRACTED |
| AUTO-008 | 자동화 | 트리거를 제거한다 | Trigger row | N,P | schedule-editor | EXTRACTED |
| AUTO-009 | 자동화 | 허용된 최대 트리거 수를 넘기지 않는다 | Add trigger | B,E | schedule-editor | EXTRACTED |
| AUTO-010 | 자동화 | 자동화를 켜고 끈다 | Routine toggle | N,E,P | `setAgentAutomationEnabled` | EXTRACTED |
| AUTO-011 | 자동화 | 자동화를 즉시 한 번 실행한다 | Run now | N,E,U | `runAgentAutomationNow` | EXTRACTED |
| AUTO-012 | 자동화 | 실행 중·성공·실패 이력을 구분해 표시한다 | Run history | N,E,P,U | run-history-provider | EXTRACTED |
| AUTO-013 | 자동화 | 동일 실행 이벤트를 두 번 처리하지 않는다 | Background trigger | B,I | automation fire consumer | EXTRACTED |
| AUTO-014 | 자동화 | 비활성 자동화는 예약 시각에도 실행되지 않는다 | Background trigger | B,P,I | sand-trigger-hub | EXTRACTED |
| AUTO-015 | 자동화 | 시간대 변경 후 다음 실행 시각을 새 시간대로 계산한다 | Settings/Routine | B,P | schedule/time-zone | NEEDS_SPLIT |
| AUTO-016 | 자동화 | 자동화를 삭제한다 | Routine actions | N,E,P | `deleteAgentAutomation` | EXTRACTED |
| FLOW-001 | 워크플로 | 현재 봇의 워크플로 목록을 연다 | Agent settings/Plugins | N,E | `getAgentWorkflows` | EXTRACTED |
| FLOW-002 | 워크플로 | 새 워크플로를 만든다 | Skill/workflow editor | N,E,P | `createAgentWorkflow` | EXTRACTED |
| FLOW-003 | 워크플로 | 워크플로 이름·설명·본문을 수정한다 | Workflow detail | N,B,E,P | `updateAgentWorkflow` | EXTRACTED |
| FLOW-004 | 워크플로 | 워크플로를 켜고 끈다 | Workflow detail/list | N,E,P | `setAgentWorkflowEnabled` | EXTRACTED |
| FLOW-005 | 워크플로 | 워크플로를 즉시 실행한다 | Run now | N,E,U | `runAgentWorkflowNow` | EXTRACTED |
| FLOW-006 | 워크플로 | 텍스트에서 워크플로를 가져온다 | Import | N,B,E,P | `importAgentWorkflowText` | EXTRACTED |
| FLOW-007 | 워크플로 | URL에서 워크플로를 가져온다 | Import URL | N,B,E,P | `importAgentWorkflowUrl` | EXTRACTED |
| FLOW-008 | 워크플로 | 잘못된 텍스트·URL 가져오기 오류를 표시한다 | Import | E,U | workflow import | EXTRACTED |
| FLOW-009 | 워크플로 | 로컬 스킬을 대상 봇으로 포팅한다 | Port skills | N,E,P,I | `portAgentLocalSkills` | EXTRACTED |
| FLOW-010 | 워크플로 | 워크플로 실행 결과가 대상 봇 대화에 연결된다 | Workflow run | N,E,P,I | workflow runtime | NEEDS_SPLIT |
| FLOW-011 | 워크플로 | 워크플로를 삭제한다 | Workflow actions | N,E,P | `deleteAgentWorkflow` | EXTRACTED |
| FLOW-012 | 워크플로 | 실패한 워크플로를 성공·활성으로 표시하지 않는다 | Workflow detail | E,U | workflow controller | EXTRACTED |

## 3.3 공유·채널·네트워크

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| SHARE-001 | 공유 | 현재 봇의 공유 상태를 조회한다 | Share/agent info | N,E | `getSharingState` | EXTRACTED |
| SHARE-002 | 공유 | 일반 봇에서 공유 방을 만든다 | Share | N,E,P | `createRoomFromAgent` | EXTRACTED |
| SHARE-003 | 공유 | 새 공유 방을 직접 만든다 | Share | N,E,P | `createSharedRoom` | EXTRACTED |
| SHARE-004 | 공유 | 공유 방 초대 링크를 만든다 | Invite | N,E,U | `createRoomInvite` | EXTRACTED |
| SHARE-005 | 공유 | 초대 링크로 공유 방 가입을 요청한다 | Deep link | N,E,P | `joinSharedRoom` | EXTRACTED |
| SHARE-006 | 공유 | 공유 방 가입 요청을 승인한다 | Join request | N,E,P | `respondToRoomJoinRequest` | EXTRACTED |
| SHARE-007 | 공유 | 공유 방 가입 요청을 거절한다 | Join request | N,E,P | `respondToRoomJoinRequest` | EXTRACTED |
| SHARE-008 | 공유 | 공유 방에 내 봇을 추가한다 | Room members | N,E,P,I | `addOwnAgentToSharedRoom` | EXTRACTED |
| SHARE-009 | 공유 | 공유 방에서 내 봇을 제거한다 | Room members | N,E,P,I | `removeOwnAgentFromSharedRoom` | EXTRACTED |
| SHARE-010 | 공유 | 공유 방 입력 중 상태를 보낸다 | Shared composer | N,B | `setSharedRoomTyping` | EXTRACTED |
| SHARE-011 | 공유 | 입력 중 상태가 멈추면 해제된다 | Shared composer | B,E | shared-room typing | NEEDS_SPLIT |
| SHARE-012 | 공유 | 공유 방을 나가기 전에 대상을 명확히 표시한다 | Leave room | N,U | shared-room UI | EXTRACTED |
| SHARE-013 | 공유 | 공유 방을 나가면 로컬 목록과 상태가 갱신된다 | Leave room | N,E,P | `leaveSharedRoom` | EXTRACTED |
| SHARE-014 | 공유 | egress tunnel 사용 가능 여부를 표시한다 | Settings/Updates | N,E | `isEgressTunnelAvailable` | EXTRACTED |
| SHARE-015 | 공유 | 외부 영향 작업은 실제 호출 전에 승인 경계를 통과한다 | Invite/broadcast | E,U | user-test approval gate | NEEDS_SPLIT |
| NET-001 | 네트워크 | 에이전트 네트워크 기능 사용 가능 여부를 확인한다 | Org chart | N,E | `isAgentNetworkEnabled` | EXTRACTED |
| NET-002 | 네트워크 | 네트워크에서 봇·그룹 노드를 표시한다 | Org chart | N,B,U | org-chart graph | EXTRACTED |
| NET-003 | 네트워크 | 노드를 선택해 상세를 연다 | Org chart node | N,U | org-chart inspector | EXTRACTED |
| NET-004 | 네트워크 | 상세에서 해당 채팅·방을 연다 | Inspector | N,I,U | org-chart inspector | EXTRACTED |
| NET-005 | 네트워크 | 여러 봇에 브로드캐스트한다 | Grok/network action | N,E,I | `broadcastToAgents` | EXTRACTED |
| NET-006 | 네트워크 | 브로드캐스트 대상과 비대상이 섞이지 않는다 | Multiple agents | B,I | broadcast routing | NEEDS_SPLIT |
| NET-007 | 네트워크 | 비동기 작업 목록과 상태를 조회한다 | Agent info/runtime | N,E,U | `getAsyncTasks` | EXTRACTED |
| CHANNEL-001 | 채널 | 봇의 채널 목록과 연결 상태를 불러온다 | Agent info/Channels | N,E | `getAgentChannels` | EXTRACTED |
| CHANNEL-002 | 채널 | 사용 가능과 출시 예정 채널을 구분한다 | Channels | N,U | channels model | EXTRACTED |
| CHANNEL-003 | 채널 | 토큰으로 채널을 연결한다 | Channel setup | N,B,E,P | `connectChannel` | EXTRACTED |
| CHANNEL-004 | 채널 | 빈·잘못된 토큰 오류를 표시한다 | Channel setup | B,E,U | channels controller | EXTRACTED |
| CHANNEL-005 | 채널 | 채널 상태를 갱신한다 | Refresh | N,E,P | `refreshChannel` | EXTRACTED |
| CHANNEL-006 | 채널 | 채널 연결을 해제한다 | Disconnect | N,E,P | `disconnectChannel` | EXTRACTED |
| CHANNEL-007 | 채널 | listener 통합과 연결 상태를 불러온다 | Automation/listener | N,E | `getListenerIntegrations` | EXTRACTED |
| CHANNEL-008 | 채널 | listener 연결 URL을 연다 | Connect listener | N,E,U | `getListenerConnectUrl` | EXTRACTED |

## 3.4 Grok 도구·컴퓨터·권한

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| BROWSER-001 | 브라우저 도구 | URL로 이동한다 | `browser_navigate` | N,E | agent-runner browser tools | EXTRACTED |
| BROWSER-002 | 브라우저 도구 | 현재 페이지 접근성 스냅샷을 읽는다 | `browser_snapshot` | N,E | agent-runner browser tools | EXTRACTED |
| BROWSER-003 | 브라우저 도구 | 스냅샷 참조 요소를 클릭한다 | `browser_click` | N,E | agent-runner browser tools | EXTRACTED |
| BROWSER-004 | 브라우저 도구 | 좌표로 마우스를 클릭한다 | `browser_mouse_click_xy` | N,B,E | agent-runner browser tools | EXTRACTED |
| BROWSER-005 | 브라우저 도구 | 포커스한 요소에 텍스트를 입력한다 | `browser_type` | N,B,E | agent-runner browser tools | EXTRACTED |
| BROWSER-006 | 브라우저 도구 | 폼 필드를 채운다 | `browser_fill` | N,B,E | agent-runner browser tools | EXTRACTED |
| BROWSER-007 | 브라우저 도구 | 선택 항목을 고른다 | `browser_select_option` | N,B,E | agent-runner browser tools | EXTRACTED |
| BROWSER-008 | 브라우저 도구 | 키보드 키를 누른다 | `browser_press_key` | N,B | agent-runner browser tools | EXTRACTED |
| BROWSER-009 | 브라우저 도구 | 페이지를 스크롤한다 | `browser_scroll` | N,B | agent-runner browser tools | EXTRACTED |
| BROWSER-010 | 브라우저 도구 | 요소를 드래그한다 | `browser_drag` | N,B,E | agent-runner browser tools | EXTRACTED |
| BROWSER-011 | 브라우저 도구 | 요소 경계 상자를 얻는다 | `browser_get_bounding_box` | N,E | agent-runner browser tools | EXTRACTED |
| BROWSER-012 | 브라우저 도구 | 대상 요소를 강조한다 | `browser_highlight` | N,E,U | agent-runner browser tools | EXTRACTED |
| BROWSER-013 | 브라우저 도구 | 제한된 CDP 명령을 실행한다 | `browser_cdp` | N,B,E | agent-runner browser tools | EXTRACTED |
| BROWSER-014 | 브라우저 도구 | 탭을 조회·전환·닫는다 | `browser_tabs` | N,B,E,I | agent-runner browser tools | NEEDS_SPLIT |
| BROWSER-015 | 브라우저 도구 | 페이지 스크린샷을 만든다 | `browser_take_screenshot` | N,E | agent-runner browser tools | EXTRACTED |
| COMPUTER-001 | 컴퓨터 도구 | 현재 화면 스크린샷을 읽는다 | `Screenshot` | N,E | agent-runner computer tools | EXTRACTED |
| COMPUTER-002 | 컴퓨터 도구 | 마우스·키보드 컴퓨터 동작을 실행한다 | `Computer` | N,B,E | agent-runner computer tools | NEEDS_SPLIT |
| COMPUTER-003 | 컴퓨터 UI | 현재 봇의 컴퓨터 화면을 연다 | Computer preview | N,E,U | computer shell | EXTRACTED |
| COMPUTER-004 | 컴퓨터 UI | 로딩·준비·오류·재시도 상태를 구분한다 | Computer preview | N,E,U | computer status-store/view | EXTRACTED |
| COMPUTER-005 | 컴퓨터 UI | 여러 워커 화면 사이를 전환한다 | Monitor strip | N,B,I,U | computer shell | EXTRACTED |
| COMPUTER-006 | 컴퓨터 UI | 넘치는 워커 화면 목록을 연다 | More screens | B,U | computer shell/view | EXTRACTED |
| COMPUTER-007 | 컴퓨터 UI | 화면을 전체 화면으로 열고 닫는다 | Computer preview | N,P,U | computer shell/view | EXTRACTED |
| COMPUTER-008 | 컴퓨터 UI | 사람에게 넘긴 작업을 건너뛴다 | Handoff banner | N,E | `handBackForeverBox`, shell | EXTRACTED |
| COMPUTER-009 | 컴퓨터 UI | 사람 작업 완료 후 봇에 제어를 돌려준다 | Handoff banner | N,E,P | `handBackForeverBox`, shell | EXTRACTED |
| FILE-001 | 파일 도구 | 로컬 파일을 봇 컴퓨터로 복사한다 | `CopyToBox` | N,B,E | agent-runner file tools | EXTRACTED |
| FILE-002 | 파일 도구 | 봇 컴퓨터 파일을 로컬로 복사한다 | `CopyFromBox` | N,B,E | agent-runner file tools | EXTRACTED |
| FILE-003 | 파일 도구 | 복사 실패를 성공으로 보고하지 않는다 | File tool result | E,U | file tool boundary | NEEDS_SPLIT |
| PERM-001 | 권한 | 로컬 도구 요청을 승인한다 | Permission widget | N,E,P | `resolveLocalToolPermission` | EXTRACTED |
| PERM-002 | 권한 | 로컬 도구 요청을 거절한다 | Permission widget | N,E,P | `resolveLocalToolPermission` | EXTRACTED |
| PERM-003 | 권한 | 로컬 도구 승인 대기 중 실행하지 않는다 | Permission widget | B,E,U | local-tool-permission | EXTRACTED |
| PERM-004 | 승인 | auto-review 승인 요청을 승인한다 | Approval widget | N,E | `resolveAutoReviewApproval` | EXTRACTED |
| PERM-005 | 승인 | auto-review 승인 요청을 거절한다 | Approval widget | N,E | `resolveAutoReviewApproval` | EXTRACTED |
| PERM-006 | 위젯 | 질문 위젯에 응답한다 | Transcript widget | N,B,E | `respondToWidget` | EXTRACTED |
| PERM-007 | 위젯 | 위젯을 닫는다 | Transcript widget | N,P | `dismissWidget` | EXTRACTED |
| PERM-008 | 비밀 | 비밀값을 보이는 대화에 노출하지 않고 제출한다 | Secret widget | N,B,E,I | `submitSecret` | EXTRACTED |
| PERM-009 | 비밀 | 봇 컴퓨터용 비밀값을 저장한다 | Settings/secret flow | N,B,E,P,I | `setBoxSecrets` | EXTRACTED |
| PERM-010 | 비밀 | 비밀값 내용 없이 설정 여부만 표시한다 | Settings/secret flow | N,E,I,U | `getBoxSecretsStatus` | EXTRACTED |
| TOOL-001 | 도구 | 환경 상태를 읽고 다음 작업에 사용한다 | `state` | N,E | agent-runner state tool | EXTRACTED |
| TOOL-002 | 도구 | 박스 도움이 필요할 때 사용자 요청을 만든다 | `request_box_help` | N,E,U | agent-runner box help | EXTRACTED |
| TOOL-003 | 도구 | 사용자에게 중간·최종 메시지를 보낸다 | `SendMessage` | N,E,U | agent-runner user messaging | EXTRACTED |
| TOOL-004 | 도구 | 사용자 메시지에 반응을 보낸다 | reaction tool | N,E | agent-runner user messaging | EXTRACTED |
| TOOL-005 | 도구 | connector card를 대화에 추가한다 | Connector result | N,E,U | `appendConnectorCard` | EXTRACTED |
| TOOL-006 | 도구 | 등록된 routed agent tool 목록을 실행 경계와 일치시킨다 | Grok tool runtime | N,E,I | `executeRoutedAgentTool` | EXTRACTED |
| TOOL-007 | 도구 | 알 수 없는 도구를 성공으로 처리하지 않는다 | Tool runtime | E,U | routed-agent-tools | EXTRACTED |

## 3.5 플러그인·MCP·스킬

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| PLUGIN-001 | 플러그인 | 플러그인 창을 열고 닫는다 | Plugins | N,U | plugins overlay | EXTRACTED |
| PLUGIN-002 | 플러그인 | Marketplace와 Yours 탭을 전환한다 | Plugins tabs | N,P,U | plugins browser | EXTRACTED |
| PLUGIN-003 | 플러그인 | 이름으로 플러그인을 검색한다 | Search plugins | N,B,E | `SearchPlugins`, browser | EXTRACTED |
| PLUGIN-004 | 플러그인 | 유형과 소유권 필터를 적용한다 | Filter plugins | N,B | plugins browser | EXTRACTED |
| PLUGIN-005 | 플러그인 | 플러그인 상세를 연다 | Plugin row | N,E,U | `GetPlugin`, browser | EXTRACTED |
| PLUGIN-006 | 플러그인 | 설정값 없는 플러그인을 설치한다 | Add | N,E,P | `InstallPlugin` | EXTRACTED |
| PLUGIN-007 | 플러그인 | 필수·비밀 설정값을 입력해 설치한다 | Setup form | N,B,E,P,I | `InstallPlugin` | EXTRACTED |
| PLUGIN-008 | 플러그인 | 설치된 플러그인 설정값을 수정한다 | Edit Values | N,B,E,P | plugins browser | EXTRACTED |
| PLUGIN-009 | 플러그인 | GitHub 인증 필요 상태와 복구 행동을 표시한다 | Auth banner | E,U | github-auth-banner | EXTRACTED |
| PLUGIN-010 | 플러그인 | QA 플러그인을 제거한다 | Uninstall | N,E,P | `UninstallPlugin` | BLOCKED |
| MCP-001 | MCP | 사용자 MCP 서버를 추가한다 | Add server | N,B,E,P | `AddMcpServer` | EXTRACTED |
| MCP-002 | MCP | MCP 서버 상태와 오류 상세를 표시한다 | Server detail | N,E,U | `GetMcpServerStatus` | EXTRACTED |
| MCP-003 | MCP | 인증 필요한 서버의 인증을 시작한다 | Authenticate | N,E,P | `AuthenticateMcpServer` | EXTRACTED |
| MCP-004 | MCP | OAuth 완료 결과를 해당 MCP 서버에 연결한다 | Browser/deep link | N,E,I | `completeMcpOAuth` | EXTRACTED |
| MCP-005 | MCP | MCP 서버를 새로고침한다 | Refresh | N,E | `refreshMcp` | EXTRACTED |
| MCP-006 | MCP | 전체 MCP 서버를 재시작한다 | Settings/tool | N,E,P | `RestartMcpServers` | EXTRACTED |
| MCP-007 | MCP | 서버별 사용자 지침을 저장한다 | Server detail | N,B,E,P | `SetMcpInstructions` | EXTRACTED |
| MCP-008 | MCP | 서버 도구 목록을 펼쳐 본다 | Tools | N,E,U | plugin server-tools | EXTRACTED |
| MCP-009 | MCP | 서버 도구 하나를 끄고 켠다 | Tools | N,E,P,I | plugin server-tools | EXTRACTED |
| MCP-010 | MCP | 계정을 하나 더 연결한다 | Add Another Account | N,B,E,P,I | plugins account manager | EXTRACTED |
| MCP-011 | MCP | 계정 이름을 바꾼다 | Accounts/Edit | N,B,E,P | `RenameMcpAccount` | EXTRACTED |
| MCP-012 | MCP | QA 계정을 확인 후 제거한다 | Accounts/Remove | N,E,P | `RemoveMcpAccount` | BLOCKED |
| MCP-013 | MCP | QA MCP 서버를 제거한다 | Remove | N,E,P | `UninstallMcpServer` | BLOCKED |
| MCP-014 | MCP | routed MCP 도구 목록과 disabled 상태를 읽는다 | Grok tool runtime | N,E,I | `listRoutedMcpTools` | EXTRACTED |
| MCP-015 | MCP | 허용된 routed MCP 도구를 실행한다 | Grok tool runtime | N,E,I | `executeRoutedMcpTool` | EXTRACTED |
| MCP-016 | MCP | box MCP 서버 목록을 읽는다 | Grok/tool runtime | N,E | `listBoxMcpServers` | EXTRACTED |
| MCP-017 | MCP | WebAuthn 인증식을 요청하고 결과를 원 요청에 연결한다 | Security key | N,E,I | `requestWebAuthnCeremony` | EXTRACTED |
| SKILL-001 | 스킬 | 스킬 카탈로그를 연다 | Plugins/Skills | N,E | `skillsCatalog` | EXTRACTED |
| SKILL-002 | 스킬 | 설치 플러그인의 스킬을 동기화한다 | Plugins | N,E,P | `syncPluginSkills` | EXTRACTED |
| SKILL-003 | 스킬 | 스킬 동기화 진행·성공·실패를 표시한다 | Plugins | N,E,U | `getPluginSyncStatus` | EXTRACTED |
| SKILL-004 | 스킬 | private 스킬을 봇별로 켜고 끈다 | Yours/Private | N,E,P,I | plugins browser | EXTRACTED |
| SKILL-005 | 스킬 | private 워크플로 스킬을 편집·저장한다 | Skill detail | N,B,E,P | plugins browser | EXTRACTED |
| SKILL-006 | 스킬 | 스킬 게시 대상을 불러온다 | Publish | N,E,I | `getSkillPublishTargets` | EXTRACTED |
| SKILL-007 | 스킬 | 스킬을 선택 팀에 게시한다 | Publish | N,E,P | `publishSkill` | BLOCKED |
| SKILL-008 | 스킬 | 게시 스킬을 원본과 재동기화한다 | Sync | N,E,P | `resyncPublishedSkill` | BLOCKED |
| SKILL-009 | 스킬 | 게시를 취소하고 로컬 워크플로로 복원한다 | Unpublish | N,E,P | `unpublishSkill` | BLOCKED |
| SKILL-010 | 스킬 | 스킬 링크를 클립보드에 복사한다 | Copy link | N,E,U | plugins browser | EXTRACTED |

## 3.6 설정·업데이트·박스·데스크톱

| ID | 영역 | 원자 기능 | 사용자 진입점 또는 주체 | 축 | 소스 근거 | 상태 |
| --- | --- | --- | --- | --- | --- | --- |
| SET-001 | 설정 | 설정 창을 열고 닫는다 | Settings | N,U | settings overlay | EXTRACTED |
| SET-002 | 설정 | General·Router·Usage & Billing·Updates를 전환한다 | Settings navigation | N,P,U | settings view | EXTRACTED |
| SET-003 | 설정 | 시스템·밝게·어둡게 테마를 전환한다 | General/Theme | N,B,P,U | ThemePreferencePicker | EXTRACTED |
| SET-004 | 설정 | 앱 재진입 후 선택한 테마를 유지한다 | Relaunch/navigation | P | host settings | EXTRACTED |
| SET-005 | 설정 | 시간대를 시스템 기본값으로 둔다 | General/Time zone | N,P | time-zone panel | EXTRACTED |
| SET-006 | 설정 | 명시적 시간대를 선택한다 | General/Time zone | N,B,E,P | time-zone panel | EXTRACTED |
| SET-007 | 설정 | 로컬 실행을 항상 허용으로 설정한다 | General/Agent | N,E,P | local tool permission | EXTRACTED |
| SET-008 | 설정 | 로컬 실행을 매번 묻기로 설정한다 | General/Agent | N,E,P | local tool permission | EXTRACTED |
| SET-009 | 설정 | 로컬 실행을 허용하지 않음으로 설정한다 | General/Agent | N,E,P | local tool permission | EXTRACTED |
| SET-010 | 설정 | 관리자 허용 상한보다 넓은 권한을 선택하지 못한다 | General/Agent | B,E,U | LocalToolPermissionState | EXTRACTED |
| SET-011 | 설정 | 하드웨어 보안키 미지원 플랫폼을 비활성 상태로 설명한다 | General/Security Key | E,U | SecurityKeySettingsGroup | EXTRACTED |
| SET-012 | 설정 | host 설정을 불러와 각 패널에 투영한다 | Settings open | N,E,P | `getHostSettings` | EXTRACTED |
| SET-013 | 설정 | 변경한 host 설정만 저장하고 다른 설정은 보존한다 | Settings control | N,B,E,P,I | `setHostSettings` | NEEDS_SPLIT |
| REVIEW-001 | Auto-review | auto-review를 켜고 끈다 | General/Agent | N,E,P | auto-review panel | EXTRACTED |
| REVIEW-002 | Auto-review | 자동 허용 규칙을 추가한다 | Add Rule | N,B,E,P | auto-review panel | EXTRACTED |
| REVIEW-003 | Auto-review | 먼저 묻기 규칙을 추가한다 | Add Rule | N,B,E,P | auto-review panel | EXTRACTED |
| REVIEW-004 | Auto-review | Ctrl/Cmd+Enter로 규칙을 추가한다 | Rule draft | N,B | auto-review panel | EXTRACTED |
| REVIEW-005 | Auto-review | 규칙을 편집하고 저장한다 | Rule row | N,B,E,P | auto-review panel | EXTRACTED |
| REVIEW-006 | Auto-review | 규칙 편집을 취소한다 | Rule row | N,P | auto-review panel | EXTRACTED |
| REVIEW-007 | Auto-review | 규칙을 삭제한다 | Rule row | N,E,P | auto-review panel | EXTRACTED |
| REVIEW-008 | Auto-review | 빈 규칙과 규칙 수 상한을 거부한다 | Rule draft | B,E,U | auto-review panel | EXTRACTED |
| ROUTER-001 | Router | 현재 공급자를 표시한다 | Router settings | N,P,U | router panel | EXTRACTED |
| ROUTER-002 | Router | Cursor 공급자로 전환한다 | Provider select | N,E,P | router provider map | EXTRACTED |
| ROUTER-003 | Router | Claude Code 공급자로 전환한다 | Provider select | N,E,P | router provider map | EXTRACTED |
| ROUTER-004 | Router | Codex 공급자로 전환한다 | Provider select | N,E,P | router provider map | EXTRACTED |
| ROUTER-005 | Router | OpenRouter 공급자로 전환한다 | Provider select | N,E,P | router provider map | EXTRACTED |
| ROUTER-006 | Router | 공급자 전환 실패를 이전 공급자 유지와 함께 표시한다 | Provider select | E,P,U | settings/controller | NEEDS_SPLIT |
| ROUTER-007 | Router | 실제 응답 공급자가 선택값과 일치한다 | Conversation/provider evidence | N,E,P,I | inference router/provider session | NEEDS_SPLIT |
| USAGE-001 | 사용량 | 선택 공급자의 사용량 상태를 불러온다 | Usage & Billing | N,E,U | usage panel | EXTRACTED |
| USAGE-002 | 사용량 | 주간·체험·온디맨드 사용량을 구분한다 | Usage meters | N,B,U | usageMetersFromSummary | EXTRACTED |
| USAGE-003 | 사용량 | 사용량 조회 실패에 재시도를 제공한다 | Usage & Billing | E,U | usage panel | EXTRACTED |
| UPDATE-001 | 업데이트 | 현재 버전과 업데이트 트랙을 표시한다 | Updates | N,U | updates panel | EXTRACTED |
| UPDATE-002 | 업데이트 | Stable 등 허용된 트랙을 선택한다 | Update Track | N,E,P | updates panel | EXTRACTED |
| UPDATE-003 | 업데이트 | 정책 관리 트랙을 사용자가 바꾸지 못한다 | Update Track | B,E,U | updates panel | EXTRACTED |
| UPDATE-004 | 업데이트 | 업데이트를 확인한다 | Check for Updates | N,E,U | updates panel | EXTRACTED |
| UPDATE-005 | 업데이트 | 확인·다운로드·스테이징·준비 상태를 구분한다 | Updates | N,E,U | updateStatusMessage | EXTRACTED |
| UPDATE-006 | 업데이트 | 업데이트 상태 로드 실패에 재시도를 제공한다 | Updates | E,U | updates panel | EXTRACTED |
| UPDATE-007 | 업데이트 | 유휴 자동 업데이트를 켜고 끈다 | Updates | N,E,P | updates panel | EXTRACTED |
| UPDATE-008 | 업데이트 | 준비된 업데이트의 재시작 설치를 요청한다 | Restart to Update | N,E,P | updates panel | BLOCKED |
| UPDATE-009 | 업데이트 | 필수 업데이트 화면에서 설치·재시도 상태를 표시한다 | Required update | N,E,U | update/required | EXTRACTED |
| UPDATE-010 | 업데이트 | host 업데이트를 요청하고 상태를 다시 읽는다 | Updates | N,E,P | `updateHostNow`, `getHostStatus` | BLOCKED |
| BOX-001 | 컴퓨터 관리 | 봇 컴퓨터 상태를 조회한다 | Settings/Computer | N,E | `getForeverBoxStatus` | EXTRACTED |
| BOX-002 | 컴퓨터 관리 | 필요할 때 봇 컴퓨터를 준비한다 | Computer | N,E,P | `ensureForeverBox` | EXTRACTED |
| BOX-003 | 컴퓨터 관리 | QA 컴퓨터 초기화를 요청한다 | Settings/Computer | N,E,P | `resetForeverBox` | BLOCKED |
| BOX-004 | 컴퓨터 관리 | 봇 컴퓨터 이미지 업데이트를 요청한다 | Settings/Computer | N,E,P | `updateForeverBox` | BLOCKED |
| BOX-005 | 컴퓨터 관리 | 가능한 이미지 자동 업데이트를 즉시 실행한다 | Background/Settings | N,E,P | `autoUpdateBoxNow` | BLOCKED |
| BOX-006 | 컴퓨터 관리 | 컴퓨터 재구축 진행률을 표시한다 | Rebuild banner | N,E,U | computer rebuild | EXTRACTED |
| BOX-007 | 컴퓨터 관리 | 재구축 중 이동해도 진행 배너로 복귀한다 | Rebuild banner | N,P,U | rebuild transport store | EXTRACTED |
| BOX-008 | 컴퓨터 관리 | 재연결 실패를 재시도 가능한 상태로 표시한다 | Computer preview | E,U | reconnect banner/shell | EXTRACTED |
| BOX-009 | 컴퓨터 관리 | 디스크 절약 점검을 요청하고 결과를 정직하게 표시한다 | Settings/background | N,E,U | `requestDiskSaverAudit` | EXTRACTED |
| STORE-001 | 박스 저장소 | 저장소 스냅샷을 즉시 만든다 | Settings/Computer | N,E,P | `snapshotBoxStoreNow` | BLOCKED |
| STORE-002 | 박스 저장소 | 저장소 상태와 마지막 동기화를 표시한다 | Settings/Computer | N,E,U | `getBoxStoreStatus` | EXTRACTED |
| STORE-003 | 박스 저장소 | QA 저장소를 확인 후 비운다 | Settings/Computer | N,E,P | `clearBoxStoreNow` | BLOCKED |
| STORE-004 | 박스 저장소 | 마이그레이션 중 상태를 표시한다 | Rebuild | N,E,P | `setBoxMigrating` | EXTRACTED |
| STORE-005 | 박스 저장소 | 재생성 전 보존 준비를 수행한다 | Rebuild | N,E,P | `prepareBoxForRecreate` | BLOCKED |
| STORE-006 | 박스 저장소 | 재생성 후 작업을 재개한다 | Rebuild | N,E,P | `resumeBoxAfterRecreate` | BLOCKED |
| TEACH-001 | 작업 가르치기 | 화면에서 녹화를 시작한다 | Start recording/Teach a task | N,E,U | `startTeachRecording` | EXTRACTED |
| TEACH-002 | 작업 가르치기 | 녹화를 중지하고 저장한다 | Stop & save | N,E,P | `stopTeachRecording` | BLOCKED |
| TEACH-003 | 작업 가르치기 | 녹화를 중지하고 버린다 | Discard recording | N,E,P | `stopTeachRecording` | EXTRACTED |
| TEACH-004 | 작업 가르치기 | 녹화 시간과 상태를 표시한다 | Recording overlay | N,E,U | `getTeachRecordingStatus` | EXTRACTED |
| TRAY-001 | 알림 트레이 | 현재 트레이 알림을 불러온다 | App shell | N,E | `getTrays` | EXTRACTED |
| TRAY-002 | 알림 트레이 | 트레이 알림 하나를 닫는다 | Tray | N,P | `dismissTray` | EXTRACTED |
| TRAY-003 | 알림 트레이 | QA 트레이 알림을 모두 지운다 | Tray | N,P | `clearTrays` | BLOCKED |
| DESKTOP-001 | 데스크톱 | deep link를 해당 화면·방·인증으로 라우팅한다 | OS/deep link | N,E,I | deep-links overlay, deep-link main | NEEDS_SPLIT |
| DESKTOP-002 | 데스크톱 | 처리할 수 없는 deep link를 오류 없이 설명한다 | Deep link overlay | E,U | deep-links overlay | EXTRACTED |
| DESKTOP-003 | 데스크톱 | 피드백을 입력·취소·전송한다 | Feedback | N,B,E,U | feedback overlay | NEEDS_SPLIT |
| DESKTOP-004 | 데스크톱 | 앱 정보와 버전을 표시한다 | About | N,U | about overlay | EXTRACTED |
| DESKTOP-005 | 데스크톱 | 창 크기·위치를 다음 실행에 복구한다 | Relaunch | N,B,P | window-state-persistence | EXTRACTED |
| DESKTOP-006 | 데스크톱 | 렌더러 오류를 빈 화면 대신 오류 경계로 표시한다 | Root | E,U | error-boundary | EXTRACTED |
| DESKTOP-007 | 데스크톱 | 다운로드 결과를 사용자에게 찾을 수 있게 남긴다 | Download | N,E,P,U | electron-main/downloads | NEEDS_SPLIT |
| DESKTOP-008 | 데스크톱 | 운영 빌드에서 승인되지 않은 DevTools 진입을 막는다 | Keyboard/menu | B,E | devtools-gate | INTERNAL_ONLY |
| CLOUD-001 | 클라우드 봇 | 클라우드 봇 연결·상태 정보를 읽는다 | Agent info/runtime | N,E,U | `getCloudAgentInfo` | EXTRACTED |

## 4. 게이트웨이 명령 전수 원시 분류

다음 123개 명령은 모두 원자 기능 행 또는 `INTERNAL_ONLY` 근거에 연결해야 한다. 현재는 원시 분류만 완료했다.

### 4.1 대화·승인·반응 17

`getTranscript`, `getAgentTranscript`, `getAgentTranscriptPage`, `openAgentWindowed`, `getAgentTranscriptWindow`, `openAgentTail`, `getAgentTranscriptTail`, `getAgentThread`, `sendPrompt`, `promptAcceptanceStatus`, `respondToWidget`, `resolveAutoReviewApproval`, `resolveLocalToolPermission`, `dismissWidget`, `submitSecret`, `reactToMessage`, `appendConnectorCard`

### 4.2 봇·검색·메모리 26

`listAgents`, `countAgents`, `searchAgents`, `searchMedia`, `createAgent`, `kickstartAgent`, `requestDiskSaverAudit`, `createGroup`, `setGroupMembers`, `updateAgent`, `deleteAgent`, `deleteAgents`, `duplicateAgent`, `setAgentUnread`, `setAgentNotificationsEnabled`, `setAgentNotifyOnUpdates`, `setAgentHiddenFromSidebar`, `openAgent`, `setWindowFocused`, `getAgentMemories`, `deleteAgentMemory`, `clearAgentMemories`, `getAgentAutomations`, `listAllAutomations`, `isAgentNetworkEnabled`, `isGlobalSearchEnabled`

### 4.3 공유·자동화·워크플로 26

`isEgressTunnelAvailable`, `getSharingState`, `createRoomFromAgent`, `createRoomInvite`, `joinSharedRoom`, `respondToRoomJoinRequest`, `createSharedRoom`, `addOwnAgentToSharedRoom`, `removeOwnAgentFromSharedRoom`, `setSharedRoomTyping`, `leaveSharedRoom`, `setAgentAutomationEnabled`, `createAgentAutomation`, `updateAgentAutomation`, `deleteAgentAutomation`, `runAgentAutomationNow`, `broadcastToAgents`, `getAgentWorkflows`, `createAgentWorkflow`, `updateAgentWorkflow`, `setAgentWorkflowEnabled`, `deleteAgentWorkflow`, `runAgentWorkflowNow`, `importAgentWorkflowText`, `importAgentWorkflowUrl`, `portAgentLocalSkills`

### 4.4 개요·스킬·채널·워커·아바타 19

`getConversationOutline`, `skillsCatalog`, `syncPluginSkills`, `getPluginSyncStatus`, `getSkillPublishTargets`, `publishSkill`, `resyncPublishedSkill`, `unpublishSkill`, `getAgentChannels`, `connectChannel`, `disconnectChannel`, `refreshChannel`, `getListenerIntegrations`, `getListenerConnectUrl`, `getSubagents`, `getAsyncTasks`, `setAgentAvatarBytes`, `getAgentAvatar`, `getCloudAgentInfo`

### 4.5 박스·업데이트·저장소 18

`getForeverBoxStatus`, `ensureForeverBox`, `resetForeverBox`, `updateForeverBox`, `autoUpdateBoxNow`, `snapshotBoxStoreNow`, `getBoxStoreStatus`, `clearBoxStoreNow`, `updateHostNow`, `getHostStatus`, `setBoxMigrating`, `prepareBoxForRecreate`, `resumeBoxAfterRecreate`, `handBackForeverBox`, `startTeachRecording`, `stopTeachRecording`, `getTeachRecordingStatus`, `getTrays`

### 4.6 트레이·첨부·설정·MCP 17

`dismissTray`, `clearTrays`, `uploadAttachment`, `readAttachmentImage`, `readAttachmentText`, `readAttachmentChunk`, `getHostSettings`, `setHostSettings`, `setBoxSecrets`, `getBoxSecretsStatus`, `completeMcpOAuth`, `requestWebAuthnCeremony`, `refreshMcp`, `listRoutedMcpTools`, `executeRoutedMcpTool`, `executeRoutedAgentTool`, `listBoxMcpServers`

### 4.7 명령→원자 기능 매핑 123/123

이 매핑은 명령 존재 여부의 소스 감사 결과다. 실제 UI 도달성과 동작 PASS를 뜻하지 않는다.

#### 대화·승인·반응 17/17

- `getTranscript` → CHAT-014; `getAgentTranscript` → CHAT-014; `getAgentTranscriptPage` → CHAT-015
- `openAgentWindowed` → CHAT-014, CHAT-015; `getAgentTranscriptWindow` → CHAT-015
- `openAgentTail` → CHAT-014; `getAgentTranscriptTail` → CHAT-014; `getAgentThread` → CHAT-016
- `sendPrompt` → CHAT-005; `promptAcceptanceStatus` → CHAT-006
- `respondToWidget` → PERM-006; `resolveAutoReviewApproval` → PERM-004, PERM-005
- `resolveLocalToolPermission` → PERM-001, PERM-002, PERM-003; `dismissWidget` → PERM-007
- `submitSecret` → PERM-008; `reactToMessage` → CHAT-019, CHAT-020; `appendConnectorCard` → TOOL-005

#### 봇·검색·메모리 26/26

- `listAgents` → ORCH-001; `countAgents` → SYS-005, SYS-006; `searchAgents` → SEARCH-003, SEARCH-004; `searchMedia` → SEARCH-005, SEARCH-006
- `createAgent` → BOT-001, BOT-002, ORCH-002; `kickstartAgent` → ORCH-019; `requestDiskSaverAudit` → BOX-009
- `createGroup` → GROUP-001, GROUP-002; `setGroupMembers` → GROUP-004, GROUP-005, GROUP-006
- `updateAgent` → BOT-005, BOT-006, BOT-007, ORCH-005; `deleteAgent` → BOT-019, GROUP-010; `deleteAgents` → BOT-020; `duplicateAgent` → BOT-010
- `setAgentUnread` → BOT-013; `setAgentNotificationsEnabled` → NOTIFY-001; `setAgentNotifyOnUpdates` → NOTIFY-002
- `setAgentHiddenFromSidebar` → BOT-014, BOT-016; `openAgent` → BOT-004, GROUP-007; `setWindowFocused` → NOTIFY-003, NOTIFY-004
- `getAgentMemories` → MEM-001; `deleteAgentMemory` → MEM-004; `clearAgentMemories` → MEM-005, MEM-006, MEM-007
- `getAgentAutomations` → AUTO-001; `listAllAutomations` → AUTO-002
- `isAgentNetworkEnabled` → NET-001; `isGlobalSearchEnabled` → SEARCH-009

#### 공유·자동화·워크플로 26/26

- `isEgressTunnelAvailable` → SHARE-014; `getSharingState` → SHARE-001
- `createRoomFromAgent` → SHARE-002; `createRoomInvite` → SHARE-004; `joinSharedRoom` → SHARE-005; `respondToRoomJoinRequest` → SHARE-006, SHARE-007
- `createSharedRoom` → SHARE-003; `addOwnAgentToSharedRoom` → SHARE-008; `removeOwnAgentFromSharedRoom` → SHARE-009
- `setSharedRoomTyping` → SHARE-010, SHARE-011; `leaveSharedRoom` → SHARE-012, SHARE-013
- `setAgentAutomationEnabled` → AUTO-010, AUTO-014; `createAgentAutomation` → AUTO-003; `updateAgentAutomation` → AUTO-004
- `deleteAgentAutomation` → AUTO-016; `runAgentAutomationNow` → AUTO-011
- `broadcastToAgents` → NET-005, NET-006
- `getAgentWorkflows` → FLOW-001; `createAgentWorkflow` → FLOW-002; `updateAgentWorkflow` → FLOW-003
- `setAgentWorkflowEnabled` → FLOW-004; `deleteAgentWorkflow` → FLOW-011; `runAgentWorkflowNow` → FLOW-005
- `importAgentWorkflowText` → FLOW-006, FLOW-008; `importAgentWorkflowUrl` → FLOW-007, FLOW-008; `portAgentLocalSkills` → FLOW-009

#### 개요·스킬·채널·워커·아바타 19/19

- `getConversationOutline` → CHAT-016
- `skillsCatalog` → SKILL-001; `syncPluginSkills` → SKILL-002; `getPluginSyncStatus` → SKILL-003
- `getSkillPublishTargets` → SKILL-006; `publishSkill` → SKILL-007; `resyncPublishedSkill` → SKILL-008; `unpublishSkill` → SKILL-009
- `getAgentChannels` → CHANNEL-001, CHANNEL-002; `connectChannel` → CHANNEL-003, CHANNEL-004
- `disconnectChannel` → CHANNEL-006; `refreshChannel` → CHANNEL-005
- `getListenerIntegrations` → CHANNEL-007; `getListenerConnectUrl` → CHANNEL-008
- `getSubagents` → SUB-002, SUB-003, SUB-006; `getAsyncTasks` → NET-007
- `setAgentAvatarBytes` → BOT-008; `getAgentAvatar` → BOT-009; `getCloudAgentInfo` → CLOUD-001

#### 박스·업데이트·저장소 18/18

- `getForeverBoxStatus` → BOX-001; `ensureForeverBox` → BOX-002; `resetForeverBox` → BOX-003
- `updateForeverBox` → BOX-004; `autoUpdateBoxNow` → BOX-005
- `snapshotBoxStoreNow` → STORE-001; `getBoxStoreStatus` → STORE-002; `clearBoxStoreNow` → STORE-003
- `updateHostNow` → UPDATE-010; `getHostStatus` → UPDATE-010
- `setBoxMigrating` → STORE-004; `prepareBoxForRecreate` → STORE-005; `resumeBoxAfterRecreate` → STORE-006
- `handBackForeverBox` → COMPUTER-008, COMPUTER-009
- `startTeachRecording` → TEACH-001; `stopTeachRecording` → TEACH-002, TEACH-003; `getTeachRecordingStatus` → TEACH-004
- `getTrays` → TRAY-001

#### 트레이·첨부·설정·MCP 17/17

- `dismissTray` → TRAY-002; `clearTrays` → TRAY-003
- `uploadAttachment` → ATT-005; `readAttachmentImage` → ATT-006; `readAttachmentText` → ATT-007; `readAttachmentChunk` → ATT-008
- `getHostSettings` → SET-012; `setHostSettings` → SET-003~SET-010, SET-013, REVIEW-001~REVIEW-008, ROUTER-001~ROUTER-006, UPDATE-002, UPDATE-007
- `setBoxSecrets` → PERM-009; `getBoxSecretsStatus` → PERM-010
- `completeMcpOAuth` → MCP-004; `requestWebAuthnCeremony` → MCP-017; `refreshMcp` → MCP-005
- `listRoutedMcpTools` → MCP-014; `executeRoutedMcpTool` → MCP-015; `executeRoutedAgentTool` → TOOL-006, TOOL-007; `listBoxMcpServers` → MCP-016

## 5. 아직 원자 분해가 필요한 기능군

- 전역 검색과 미디어 검색의 정상·빈 결과·오류·페이지 이동
- 그룹 생성, 멤버 추가·제거, 그룹 메시징과 그룹 삭제
- 봇별 알림, 업데이트 알림, 앱 포커스와 읽음 상태
- 자동화와 워크플로의 생성·수정·활성화·즉시 실행·삭제
- 스킬 카탈로그, 동기화, 게시, 재동기화와 게시 취소
- 채널 연결·해제·갱신, listener 연결과 인증
- 공유 방 생성·초대·가입·요청 응답·타이핑·나가기
- agent network, org chart, broadcast와 async tasks
- 컴퓨터 화면, 복수 화면, 브라우저, 터미널과 파일 전송
- 로컬 도구 승인, auto-review, 질문 widget, secret request
- Plugins UI와 MCP 검색·설치·인증·계정·제거
- Router 공급자 전환, 인증, 사용량, 캐시와 실패 복구
- Forever Box, box store, host update와 teach recording
- tray, deep link, feedback, about, required update와 error boundary
- 키보드, 포커스, 접근성, 좁은 창, 성능과 콘솔 오류

## 6. 다음 추출 순서

1. UI 컨트롤 325 occurrences를 중복 제거하고 원자 기능에 연결
2. 게이트웨이 123개 명령을 각 원자 기능 ID에 연결
3. Grok/워커 도구를 전수 추출하고 사용자 여정과 연결
4. Electron IPC와 백그라운드 상태 전이를 원자 분해
5. 분모를 동결한 뒤 실사용 시나리오와 증거 경로를 부여
