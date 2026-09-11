# 최종 답 뒤 빈 왕복 제거 — `SendMessage final: true` (2026-09-11)

## 증상

폰 PWA 에서 Belmont 가 답을 다 보냈는데도 캐릭터가 "응답 후 처리 중"으로 몇 초 더 남았다.
원인은 표시가 아니라 호스트였다. 답장은 `SendMessage` 도구 호출이라, 도구 결과를 받은 모델이
"더 할 일 없음"이라는 빈 마지막 메시지를 한 번 더 만들어야 턴이 끝났다. 테스트 봇 기록의 사고 요약이
그대로 보여 준다: "Preparing final invisible assistant message / Deciding on minimal final assistant text".

실측(테스트 봇, gpt-5.6-luna/max, 0.4초 간격으로 게이트웨이 `listAgents` 상태를 찍음):

| | 접수 | 답 도착 | 실행 종료 | 답 이후 꼬리 |
|---|---|---|---|---|
| 변경 전 (07:40) | 07:40:54.06 | 07:41:06.69 | 07:41:14.06 | **7.4초** |
| 변경 후 (08:02) | 08:02:38.36 | 08:02:42.17 | 08:02:42.45 | **0.3초** |

## 변경

- `SendMessage` 입력에 `final?: boolean` 추가. 결과를 전달하는 마지막 메시지에만 붙인다. 위젯·secret-request 와는
  같이 못 쓴다(이미 사용자를 기다리며 턴을 끝내므로). 보내는 메시지 객체에는 들어가지 않는다.
- 도구 실행: 전송 성공 뒤 `final` 이면 `onFinalDelivery()` 호출. 턴별 의존성(`host-runner-composition.ts`)이
  소유자 내부 신호 `{ type: "final-delivery" }` 를 중계기로 보낸다.
- 중계기(`production-turn-run-shell-adapter.ts`): 이 신호는 transport 로 넘기지 않고 `completeAfterDelivery()` 만 부른다.
- 실행 껍데기(`turn-run-shell.ts`): 다음 체크포인트가 저장된 직후(도구 결과 포함) 스트림을 의도적으로 끊는다.
  이 끊김은 중단이 아니라 **완료**다: 마지막 저장 체크포인트를 최종 상태로 삼아 settle(기억 근거 기록·라벨링·
  열린 todo 읽기)과 최종 저장을 그대로 수행하고, 결과에 `completedOnFinalDelivery: true` 를 남긴다.
  체크포인트 전에 사용자가 끊으면 지금처럼 중단으로 처리한다.
- 프롬프트: "5. Close the loop" 에 `final: true` 규칙 한 줄, 도구 설명에도 같은 내용.

## 검증

- `tests/final-send-ends-turn.test.mjs` 7건: 체크포인트 뒤 끊김·완료 settle, 스트림이 정상 반환해도 완료,
  `final` 없으면 그대로 진행, 체크포인트 전 사용자 중단은 중단, 양식·도구·배선.
- 전체 단위 테스트 1035건 중 1033 통과, 실패 0, 건너뜀 2 (`belmont-browse/.state/logs/unit-tests-20260910T2259Z.log`).
- 실사용: 위 표. 원시 기록에 `"final":true` 가 첫 시도부터 찍혔고 그 뒤 빈 assistant 항목이 없다.

## 남은 것

- 사용자 Belmont(gpt-5.6-sol/high)는 같은 프롬프트를 받으므로 같은 효과를 기대하지만 아직 실측 전이다.
- 옛 경로(`SandAgentRunner` 의 비프로덕션 실행)는 `final` 을 무시한다 — 오늘과 같은 동작.
- 위젯의 "도구 직후 턴 종료"(`awaitingUserSelection`) 경로는 프로덕션 어댑터에서 사실상 죽어 있다
  (`pauseForUser` 호출자 없음, `#activeRun` 이 null 이라 플래그가 안 선다). 별도 항목.
- 15분마다 도는 "Job sweeper" 루틴은 매번 12~15초 동안 캐릭터를 "작업 중"으로 만든다. 사용자 결정 대기.
