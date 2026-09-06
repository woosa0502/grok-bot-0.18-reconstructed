# 작업 이어가기(task continuation) — 2026-09-05

## 왜

벨몬트의 턴은 "모델이 도구 호출을 멈추는 순간" 끝난다. 그래서 진행 보고 한 줄 쓰고 멈춘 봇과 일을 끝낸 봇이 런타임에는 똑같이 보였다.
브라우저봇이 쓰는 Aside 엔진은 반대다. 호스트가 작업표를 끊고 서비스가 `done`을 줄 때까지 폴링만 한다.

사건: 9/5 08:58 Gmail 정리(639통). 10개씩 4묶음 옮기고 속말만 남기고 종료. 닫힘 재촉(closing send nudge)은 감지기가 압축 이전 스냅샷을 봐서 한 번도 안 걸림.
집계(사용자 턴 130개): 열린 할 일을 남기고 끝난 턴 19개. 그중 약 8개는 사용자가 "다했니?", "이어서 진행해", "다시 줘"로 직접 밀어야 했던 미완 작업. 나머지는 다른 봇에게 넘긴 뒤 대기, 승인 카드 대기, 낡은 항목.

## 무엇을

1. 감지기 입력 고정 — `prompt-messages-snapshot-middleware.ts`. 모델 호출마다 실제로 넘긴 메시지를 기록하고, 턴 정산은 그 기록을 본다.
2. 닫힘 재촉 반복 — 최대 3회(`MAX_CLOSING_SEND_NUDGES`). 재촉 실행에서도 무음 감지를 켠다(`closingNudge`).
3. 작업 이어가기 — `turn-open-work.ts` + `turn-runtime.ensureUserReply`.
   - 끝났는가의 기준: 모델 자신의 TodoWrite 목록(대화 상태에 저장됨)에 `in_progress`/`pending`이 남았는가.
   - 사용자 턴이 끝나면 숨은 깨우기 `[task continuation]`로 턴을 돌려준다. 목록이 비면 끝.
   - 멈춤 조건: 취소됨 / 승인·질문 카드 대기 / 마지막 일이 다른 봇·서브에이전트에게 넘김(`SendToAgent`, `Task`) / 일 없는 실행 1회 / 24회 / 3시간.
   - 일을 하지 않은 턴(인사, 상태 질문, "잠깐 멈춰")은 그 자체로 "일 없는 실행"이라 멈춰 둔 작업을 되살리지 않는다.
   - 이어가기 실행이 보고 없이 끝나면 그다음 닫힘 재촉이 받는다.
   - 멈춘 작업 카드에 답이 없으면(같은 목록), 목록을 건드리지 않은 뒤 턴(잡일·질문)은 이어가기도 카드도 만들지 않는다(`hasUnansweredParkedTaskCard`, 실행 모양의 `todoWrites`). 카드에 답하거나 목록이 바뀌면 풀린다. 18:03~18:48 잡일마다 카드가 하나씩 더 생기던 것.
4. 숨은 깨우기(정기 실행·재촉·이어가기)에는 "먼저 인사부터 하라" 재촉을 걸지 않는다 — `start-of-turn-ack-reminder-middleware.ts`.
5. 정기 실행 깨우기 문구에 "사용자 작업이 진행 중이면 이 깨우기로 끝내지 말라"를 추가 — `automation.ts`.

6. 승인 대기가 도구 시간제한에 끊기지 않게 — `mcp-meta-tools.ts`. CallMcpTool의 840초 한도가 승인 카드 대기 중에도 돌아가 호출을 끊고, 승인 기록이 남아 "다른 작업이 승인 대기 중"으로 이후 호출을 전부 막았다(10:55, 13:26 두 번). 이제 승인 대기 동안 한도가 멈추고, 정말 초과하면 하위 컨텍스트를 취소해 대기 기록을 정리한다. 사용자가 몇 시간 뒤에 눌러도 그 자리에서 이어진다.
7. 멈춘 작업 카드 — 일하다가 항목을 남기고 멈추면(횟수·시간 한도, 답 없는 카드, 일 없는 이어가기) 대화에 "이어가기 / 그만두기" 카드를 남긴다. 눌러진 답이 다음 사용자 턴으로 들어와 이어가기 루프가 다시 돈다. 인사나 "잠깐 멈춰"처럼 일을 안 한 턴, 다른 봇에게 넘긴 턴은 카드를 남기지 않는다. 모바일 화면은 기존 위젯 카드 그대로 쓴다.

8. 자동 검토기 시간 초과 (17시 사후 점검) — `local-smart-mode-classifier-exec.ts`, `provider-session.ts`, `process-crash-guard.ts`.
   - 11:09~16:17 로그에서 검토기 10초 초과 66건. MCP·셸 경로는 시도 1회라, 초과 = 그 도구 호출 거부("Please review manually"). 반복 승인 카드와 Clerk의 헛돈 턴(192줄 중 상당수)의 직접 원인.
   - 로그에는 4배(264줄)로 찍혔다: Pi 실행기의 파생 약속 4개(response/usage/extendedUsage/providerMetadata)가 중단 사유로 거부되며 미처리로 새어 나왔다. 파생 약속을 처리됨으로 표시. "[object Object]" 16건도 같은 곳(4개 묶음 4건)이며 이제 내용이 찍힌다.
   - 검토기 기본 모델을 Codex 빠른 등급(gpt-5.6-luna)으로. 노력은 실행 스크립트 기본값 max(집 규칙, 사용자 지시 18:30~19:10: 루나는 thinking max가 기본, 최소 xhigh. Codex 모델 목록 `~/.codex/models_cache.json`에 luna 지원 단계 low·medium·high·xhigh·max, Pi의 openai-codex 모델표에도 max). 호스트의 노력 검증 5곳이 xhigh까지만 받던 것을 max까지 받게 고침(provider-session, turn-run-shell, 봇 생성 도구, 검토기). settings.json의 루나 봇 3개(Clerk·Scribe·모바일 테스트 봇)와 실행 서브에이전트는 max + maxMode true. 이 재구성판의 Codex 경로는 maxMode 값을 읽지 않는다(Cursor 경로 전용 플래그)라 실제 효과는 effort만 있다. 측정: xhigh에서 4.5초·3.3초. 판정은 JSON 한 줄이라 지연이 전부다. `SAND_AUTO_REVIEW_CLASSIFIER_MODEL`이 우선. 판정마다 `[sand][auto-review] classifier … in …ms` 한 줄을 남겨 예산(30초)과 모델을 로그로 조정한다.

9. 스킬 목록을 프롬프트에 — `workflow-model.ts` `renderWorkflowsSystemPrompt(location, skills)`, `system-prompt-assembly.ts`, `host-runner-composition.ts`.
   - 재구성판의 프롬프트 조립은 `workflowStore: () => null`이라 스킬 절이 아예 없었다(서재 위치 안내조차 없음). 브리핑 시험(20:07)에서 벨몬트가 스킬 본문을 찾느라 폴더 나열·jq·sed로 도구 호출 10번을 썼다.
   - 세션의 스킬 저장소를 조립에 연결하고, 그 봇에 켜진 스킬을 "이름: 설명 — file: 경로"로 나열하며 "맞는 일이면 SKILL.md를 먼저 Read하라"고 적는다. 같은 시험 재실행(20:20): 도구 호출 17→7, 첫 실제 조회 전 2번, 4분→2분.
   - 정기 실행(automationStore)과 채널(channelStore) 절은 여전히 null. 별도 판단.

10. 폰(PWA)에서 카드 답이 확정 표시되지 않음 — `grok-mobile-belmont-pwa/server.mjs`, `src/screens/ChatScreen.tsx`.
   - 모바일 서버가 카드를 내보낼 때 호스트가 기록한 답(`respondedValue`)을 빼고 있어, 그만두기를 눌러 벨몬트가 멈춘 뒤에도 두 단추가 그대로 보였다(20:50 화면).
   - 내보내기에 `answered`를 넣고, 화면은 답한 카드를 "답했습니다 / 선택: 그만두기"로 바꾸고 단추를 숨긴다. 누른 직후엔 화면이 먼저 바꾸고 다시 읽어 확정한다. 테스트 75개 통과, Windows 쪽 서버 재시작(pid 1772, 페어링 코드 유지).

## 검증

- `tests/silent-tail-detector.test.mjs`, `tests/closing-nudge-repeat.test.mjs`, `tests/task-continuation.test.mjs`, `tests/mcp-tool-timeout-suspension.test.mjs`. 사건의 실제 메시지 모양과 감사에서 나온 오탐 유형을 시나리오로 넣었다.
- 실제 대화 상태 blob에서 TodoItem을 해독해 상태값(1 대기, 2 진행 중, 3 완료, 4 취소)을 확인했다.

## 남은 것

- 사용자 메시지·정기 실행 프롬프트가 기록에 두 번씩 저장되는 중복.
- 정기 실행이 사용자 작업 턴 뒤에 줄을 서는 건 그대로다(이어가기 루프가 도는 동안 15분 정기 실행은 미뤄진다). 3시간 한도로 묶여 있다.
- 관리자 모델은 settings.json의 봇별 설정(벨몬트 gpt-5.6-sol high)으로 정한다. Codex CLI 설정(gpt-6-astra xhigh)은 읽지 않는다.
