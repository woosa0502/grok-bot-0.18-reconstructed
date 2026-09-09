# 진행 일지 — 2026-09-09 (시간순, 이어서 작업할 때 여기부터)

읽는 법: 맨 아래가 최신. 각 항목은 `시각 KST · 한 일 · 결과 · 근거 위치`. 상세 근거는 `docs/audit-remediation-2026-09-09.md`, 살아 있는 프로세스와 첫 명령은 `NEXT_SESSION.md`.

| 시각 | 한 일 | 결과 | 근거 |
|---|---|---|---|
| 08:51 | 원래 사용자 Aside 재기동(이전 세션 종료로 죽어 있었음) | daemon/Chrome 기동, health ok | logs/primary-relaunch-20260909T0851Z-* |
| 오전 | Chromium 테스트 fixture 수정 2곳, native 테스트 runner 완료 | unit 20/20 · components 2/2 · browser 2/2 | final-native-build/final-summary.json |
| 오후 | GPT Pro 감사 F01~F07 조치, CI 통과 | F03 부분(사용자 결정) | audit-remediation §초반 |
| 오후 | 원본 함수 재사용으로 메모리 backfill·저장된 답 재개 연결, Moss 의미 검색 활성 | health memory.mode native | audit-remediation §원본 기능 반영 |
| 오후 | 골든 E2E 시나리오 구현(E05~E12, E15, E18), 결함 2건 수정 | 빌드·실행 계보(E01~E03, E16) 사용자 보류 | docs/testing/golden-e2e-ledger-2026-09-09.json |
| 16:12 | Belmont 호스트 재빌드·재기동(호스트 쪽 수정 반영) | 게이트웨이 45026, lineage 갱신 | logs/host-restart-20260909T0712Z.log |
| 16:51 | **사용자 테스트 중 Aside Chrome 크래시** 발견 | 미니 팝업 닫기 처리기 누락이 원인 | audit-remediation §미니 팝업 크래시 |
| 17:14 | 옛 빌드로 사용자 Aside 복구 재기동 | — | logs/primary-relaunch-20260909T0814Z-* |
| 17:23 | 미니 팝업 수정 빌드, 격리 인스턴스에서 수정 전/후 재현 | 전: 죽음, 후: 정상 | tools/repro-minipopup-close.mjs |
| 17:37 | 수정 빌드로 사용자 Aside 재기동(2회차) | 체크포인트·빌드 신원 재기록 | commit 890041 |
| 18:1x | 포크 UI 닫힘 경로 점검: 탭 검색 창이 Escape/선택 후 안 닫힘 발견·수정 | 수정 후 3/3 닫힘 | tools/check-fork-ui-close-paths.mjs |
| 18:29 | 사용자 Aside 재기동(3회차, 탭 검색 수정 포함). 이전 데몬이 종료 후 남아 정리 | 런처에 종료 마무리 보강 | commit a457c7f, c76f57f |
| 19:0x | 툴바 팝업·미니 팝업 단축키·주소창 캡처 점검 | 모두 정상, 원본 비교는 불가 | commit 004511e, shots-20260909/ |
| 19:3x | "cyber" API 오류 = Claude Code 안전장치 확인. 표현 방식 변경 약속 | Aside/Belmont 조치 없음 | audit-remediation §cyber |
| 19:4x | 사용자 질문 "개발자 모드였나?" 확인: 포크 소스에 DevTools 자동 열기 없음, 두 프로필 모두 확장 개발자 모드 꺼짐, 새 탭(Ctrl+T) 열어도 DevTools 대상 없음. 새 탭은 Aside 새 탭 페이지(검색/Ask) 정상 | 로그의 오류는 WSL 잡음 | shots-20260909/04-newtab.png |
| 19:5x | 데몬 로그 error 47줄 원인 확인 | BAD_REQUEST 39줄(sessions.list 33 + routines 6)은 전부 15:06~15:13 KST, 이전 데몬 768546, 오류 문구 "accountId expected number, received undefined" = 반복 루틴 검증 도구 v1이 입력을 잘못 감싸 보낸 것(v2로 고친 뒤 15:15 실제 실행 성공). 사용자 흐름 아님, 현재 데몬엔 없음. 나머지 8줄은 클라우드 공유 미인증 4 + 존재하지 않는 세션 mark-read 시험 2 + 기타 | 조치 없음 | daemon-2026-09-09.log |
| 20:1x | 실사용 검증 계획서 작성(다른 모델에게 맡길 지시서): 원칙·환경·판정·알려진 상태·시나리오 S0~S8·91-row 대응표·보고 형식 | `docs/real-use-test-plan-2026-09-09.md` | — |
| 21:3x | 후속 모델(Opus)의 실사용 검증 보고서 검토(`data/artifacts/real-use-test-20260909/REPORT.md`) | 계획 68항목 중 12항목 실행, 실 인스턴스 PASS는 CDP 페이지 입력 기반(실제 키 아님). 환경 벽: WSLg :0 창에 xdotool 키가 안 닿음, 데몬 포트 고정으로 두 번째 전체 스택 불가. S7 Belmont·S8 장시간·S1~S5 손 조작·루틴·금고·도구별·Guard 실제 승인 미실행. 사용자 primary는 21:15 재기동됨(daemon 931697, 종료 보강 포함) | 다음 한 수: 점검 창에서 전체 스택을 Xvfb로 띄워 실제 키로 수행, 또는 사용자 손+모델 관찰 | REPORT.md |
| 22:3x | 전수 실사용 체크리스트 작성(테스터=사용자 페르소나, 실제 키가 되는 점검 창 절차, S1~S14 전수 표) + 부록 컨트롤 목록(확장 문구 2,109 + 네이티브 137 + 단축키·명령) | `docs/full-user-test-checklist-2026-09-09.md`, `docs/full-user-test-inventory-2026-09-09.md` | — |
| 23:0x | Aside 신규 버전 조사 | 우리 기준 1.26.907.1712(데몬·확장 2개), 앱 dmg 1.0.825.1. 공식 changelog 최신 v1.26.908.1846(9/8: 채팅 고정, 채팅 UI 개편, 비밀번호 관리자 개편, Telegram 명령 버튼, Lasso 단축키, 계정 수정). 업데이트 서버(Omaha, protocol 4.0 + os 필드 필요)는 **1.26.909.1820**을 제공(mac x64/arm64, win x64; linux는 noupdate). 909 CRX 3개 내려받아 sha 확인·풀어 둠(`data/artifacts/aside-909-20260909/`, 미커밋). 페이지 구성은 907과 동일, 자산 파일만 변경 | 업그레이드는 사용자 결정(UPGRADE.md 절차) | omaha 응답 `scratchpad/omaha-909.json` |

## 지금 상태 (19:40)

- 사용자 Aside: daemon 931697 / Chrome 931737 (21:15 재기동, 후속 모델), 수정 빌드(chrome sha 37528b8c…), 런처 종료 보강 포함. Belmont 호스트: tmux `belmont-bot`, 게이트웨이 45026.
- 로그에 보이는 "Chromium 오류"는 개발자 모드가 아니라 WSL 환경 잡음이다: Electron/Chromium이 시스템 D-Bus를 못 찾는 `ERROR:dbus/bus.cc`(호스트 로그 13줄, Aside 로그 24줄), 구글 구성요소 갱신/GCM 접속 실패(`MtcAnchorData`, `DEPRECATED_ENDPOINT`). 동작에 영향 없음. Belmont 앱의 DevTools는 F12 또는 Ctrl+Shift+I를 눌러야만 열린다.
- Aside 데몬 로그의 error 47줄: 39줄은 오후 반복 루틴 검증 도구 v1의 잘못된 입력(아래 일지 19:5x 항목), 4줄은 클라우드 공유 미인증, 나머지는 시험 호출. 사용자 흐름의 오류는 없다(분류):

```
33 tRPC sessions.list – BAD_REQUEST
      4 tRPC sessions.shareStatus – UNAUTHORIZED
      4 tRPC routines.update – BAD_REQUEST
      2 POST /session/for-chrome/does-not-exist/mark-read – HTTP 404 Not Found
      1 tRPC routines.list – BAD_REQUEST
```

## 남은 것

- PW 팝업 크기·위치의 원본 비교(원본 바이너리 필요), Escape 실제 키 입력 경로.
- native 테스트 캠페인 fingerprint는 수정 전 소스 기준(unit/browser_tests 재빌드 안 함).
- 91-row 사용자 흐름 장부 missingGate, 성능 빌드(기준선 없음), Claude tool bridge(보류).
