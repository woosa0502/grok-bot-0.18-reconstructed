# 성능 동일성 검사 결과 (2026-09-05, 1차)

환경: 벨몬트 호스트 `SAND_ASIDE_BROWSE=1`(tmux `belmont-bot`), 포크 서비스 `run-fork.sh`(:99 = 브라우저 봇 화면), 봇 "브라우저"(`4cf461d4…`), 드라이버 `test/parity/drive.mjs`(호스트 게이트웨이 `sendPrompt` → 답 올 때까지 2초마다 확인).
시간 = 지시 보낸 시각 → 마지막 답 도착 시각. 원본 보고치는 Aside 화면에서 직접 잰 값이라 우리 쪽은 봇 턴 시작·2초 확인 간격이 더해진다.

## 먼저 잡은 문제 (검사 전에 고침)
| # | 증상 | 원인 | 고친 곳 |
|---|---|---|---|
| F1 | 브라우저 봇이 Aside를 안 쓰고 혼자 답함 | 호스트가 `SAND_ASIDE_BROWSE=1` 없이 떠 있었음 | 호스트를 플래그 켜서 재시작 (`tmux new-session -d -s belmont-bot … SAND_ASIDE_BROWSE=1 npm run wsl:start`). 런타임이 "stale"이라 `npm run wsl:setup` 재빌드 필요했음(원인: 미추적 문서 1개 수정) |
| F2 | 봇 화면(:99)이 빈 탭만 보임, 브라우저가 안 움직이는 것처럼 보임 | Aside 에이전트가 뒷탭(Agent Tabs)에서 일함 | `src/core.mjs` "stage": 실행 중 가장 최근에 바뀐 페이지 탭을 1초마다 앞으로 올림(`Target.setDiscoverTargets`+`Target.activateTarget`). 끄기 `BELMONT_BROWSE_STAGE=0` |
| F3 | Aside 화면/CLI에서 만든 채팅을 봇이 이어받으면 "This task is not bound to a browser profile" | 그 세션에 browserBinding 없음(또는 지난 Chrome 창 번호) | `src/core.mjs` runHandle: 실행 전 `SessionStore.update(…browserBinding)` + `refreshLoadedSessionBrowserBinding`로 현재 프로필·창에 묶음 |
| F4 | 봇 채팅에 `<citation refs=…>` 표시가 그대로 찍힘 | Aside 답의 인용 표식 미처리 | `aside-bot-runner.ts` `stripAsideCitations` (미러·최종 답 둘 다) |
| F5 | 승인 카드 뒤에 봇이 자기 지시문을 `[Aside에서 입력]`으로 되비침 | 서스펜션에서 턴이 끝날 때 미러 커서를 안 옮김 | `aside-bot-runner.ts` 서스펜션 분기에서도 커서를 마지막 저장 메시지로 이동 |
| F6 | 승인 카드 내용이 "approval:"뿐 | 요청에 title/description 없음 | `src/session.mjs` describeSuspension: 없으면 요청 JSON 300자 |
| F7 | 검사 드라이버가 카드에 라벨("허용")을 보내 실제로는 deny로 처리됨 | 실제 UI는 option.value("allow")를 보냄 | `drive.mjs`가 value로 답함 |

| F8 | 루틴(자동화)이 브라우저 봇에서 아무것도 안 함(실행 기록은 ok, 답 없음) | 루틴 깨우기는 숨은 턴이라 실행기가 "찌르기"로 보고 무시 | `aside-bot-runner.ts` `parseAutomationWake`: `automationWake` 옵션이 있으면 저장된 지시문을 꺼내 Aside 작업으로 실행, 채팅에 `[루틴 "이름" 실행] …` 표시 |

F4·F5·F8은 벨몬트 소스(`source/host/extensions/browse-runtime/aside-bot-runner.ts`) 수정 → `npm run wsl:setup` 재빌드 후 적용. typecheck·단위 테스트 통과. 커밋은 안 함.

## B6 실사용 미러링
| 방향 | 결과 |
|---|---|
| 벨몬트 → 봇 → Aside | 통과. 예시 페이지 제목·첫 문단 30초. 포크 화면 Agent Tabs에 작업 탭, Aside Tasks에 진행 표시 |
| Aside 화면 → 벨몬트 | 통과. Aside 쪽에서 만든 채팅(수도 질문)이 다음 턴에 `[Aside에서 입력] …` + "서울"로 봇 채팅에 나타남. 봇이 그 채팅을 이어받아 답함 |

## 검사표 결과
| 번호 | 걸린 시간 | 원본 보고치 | 개입 | 결과 | 판정 |
|---|---|---|---|---|---|
| ★1 HN 상위 3개 요약 | 70초 | 18초 | 0 | 3개 기사 소제목·요점·링크 정확 | 내용 통과, 시간 초과(3.9배) |
| ★2 Aside Pro 요금 | 28초 | 39초 | 0 | $20/month | 통과 |
| ★3 example.com 세 줄 | 28초 | 7초 | 0 | TITLE/SUMMARY/LINKS 형식 정확 | 내용 통과, 시간 초과 |
| ★4 폼 채우고 미제출 | 80초 | — | 0 | 6칸 채움, `/submitted` 요청 0건 | 통과 |
| ★5 읽기 전용 점검 | 94초 | — | 0 | 5항목 PASS 표 | 통과 |
| ★6 5개 페이지 표 | 122초 | — | 승인 1 | 5행 표 정확 | 통과 |
| ★7 네이버 경쟁 제품 5개 | 291초 | 캡차 자력 통과 | 승인 1 | 5개 제품 × 카페/블로그/스토어 노출 표, 가격·리뷰 수 포함. 캡차 안 나옴(미검증) | 통과 |
| ★8 네이버 블로그 파도타기 8개 + 캡처 | 604초 | 6분50초급 | 승인 2 | 최근 30일 글 8개 표(제목·작성일·URL·한 줄) + 캡처 8장 저장(`…/artifacts/agoda-blog-captures/`) | 통과 |
| ★9 아침 9시 루틴 | 등록 즉시, 즉시 실행 54초 | 매일 무인 | 승인 1 | `createAgentAutomation` → "Every day at 9:00 AM"(다음 09-06 09:00). 첫 즉시 실행은 아무것도 안 함(F8) → 고친 뒤 재실행: 네이버 IT·hada 새 소식 5개 표 | 통과(F8 수정 후). 3일 연속은 아직 |
| ★10 경쟁 블로그 5곳 비교 | 241초 | 월 1~2회 | 0 | 비교표 + 제목 후보 10개. 4곳은 RSS로 확인(브라우저로 글 10개씩 열지는 않음) | 통과(방법은 지름길) |
| ★13 업비트 공지 20개 | 174초 | — | 0 | 20행 표, 유의 종목 지정 2건 표시 | 통과 |
| ★14 링크·이미지 점검 | 114초 | 주 1회 | 0 | 링크 5개 상태(200/404/응답 없음) 정확, 이미지 2개 정확 | 통과 |
| ★11·★12 국립공원 23곳 표 + 깨진 URL 복구 | 257초 | 2h48m급 무인(축소) | 0 | 23행 표(면적·지정연도·소재지) 전부 채움. 일부러 깨 둔 월악산 URL과 실제로 없는 팔공산 문서 모두 대체 문서·목록 표로 스스로 보강하고 표 밑에 보고. 문서를 하나씩 열지 않고 목록 표를 주로 씀 | 통과(방법은 지름길) |
| ★15 미니팝업 Alt+Space | — | 창 표시 | 0 | test/minipopup 통과(:99) | 통과 |
| ★16 텔레그램 사진 → 폼 | — | 19초 | — | 브라우저 봇에 텔레그램 채널 연결 없음(`getAgentChannels` connections 0) | 미실행 |
| B1~B8 계정 필요 항목 | — | — | — | 네이버·스레드·쿠팡·구글·홈택스 계정이 포크 프로필에 없음 | 미실행 |

## 판정 요약
- 계정 없이 되는 16개 중 15개 실행, 15개 모두 결과 정확·개입 0(승인 카드 제외). 시간은 짧은 일에서 원본 보고치보다 느림(★1 3.9배, ★3 4배). 긴 일(★7 5분, ★8 10분, ★11 4분)은 원본 사례 범위 안.
- 느린 이유는 브라우저 층이 아니라 앞뒤 경로: 벨몬트 턴 시작 → 서비스 → Aside 모델 호출(gpt-5.5/high) → 2초 간격 확인. 원본은 화면에서 바로 잰 값.
- 브라우저 층(탭·세션·캡처·폼·팝업)에서 막힌 검사는 없다. 막힌 것은 전부 연결 층이었고(F1~F8) 모두 고쳤다.

## 다음
- ★9 루틴은 매일 09:00에 브라우저 봇 채팅으로 보고가 온다(3일 연속 확인은 09-08까지 기다려야 함). 필요 없으면 `deleteAgentAutomation`(id `it`)로 지운다.
- 계정 항목(B1~B8)은 사용자가 포크 프로필(:99 화면)에서 로그인해 두면 같은 드라이버로 바로 돌릴 수 있다.
- 시간 차이를 줄이려면: 드라이버 확인 간격 2초 → 0.5초, Aside 모델을 짧은 일엔 luna/낮은 thinking으로(서비스 `--model`).
