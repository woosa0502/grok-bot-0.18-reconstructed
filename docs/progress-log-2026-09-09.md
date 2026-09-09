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

## 지금 상태 (19:40)

- 사용자 Aside: daemon 861840 / Chrome 861892, 수정 빌드(chrome sha 37528b8c…). Belmont 호스트: tmux `belmont-bot`, 게이트웨이 45026.
- 로그에 보이는 "Chromium 오류"는 개발자 모드가 아니라 WSL 환경 잡음이다: Electron/Chromium이 시스템 D-Bus를 못 찾는 `ERROR:dbus/bus.cc`(호스트 로그 13줄, Aside 로그 24줄), 구글 구성요소 갱신/GCM 접속 실패(`MtcAnchorData`, `DEPRECATED_ENDPOINT`). 동작에 영향 없음. Belmont 앱의 DevTools는 F12 또는 Ctrl+Shift+I를 눌러야만 열린다.
- Aside 데몬 로그의 error 47줄은 거의 전부 클라우드 기능 미인증(`sessions.shareStatus UNAUTHORIZED`) 반복이다(분류):

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
