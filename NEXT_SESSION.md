# 다음 세션 시작점 — Aside/Belmont (세션2 갱신 2026-09-09 19:20 KST)

**작업 완료 판정이 아니다.** 시간순 진행 상황은 진행 일지에 계속 쌓는다(맨 아래가 최신): [9/9](docs/progress-log-2026-09-09.md), [9/10](docs/progress-log-2026-09-10.md). 세션2가 인계 문서의 다음 순서를 실행했고, 아래는 그 결과와 현재 살아 있는 상태다.

먼저 [상세 인계 문서](data/artifacts/aside-remaining-closure-20260908/HANDOFF_20260909.md)를 읽되, 실행 상태는 이 문서와 [세션2 인계 부록](data/artifacts/aside-remaining-closure-20260908/HANDOFF_20260909_SESSION2.md), [적용된 테스트 수정 기록](data/artifacts/aside-remaining-closure-20260908/handoff-20260909/APPLIED_TEST_FIXES.md)이 우선한다.

## 세션2에서 바뀐 것

- 이전 세션 종료와 함께 runner603292, primary daemon622120/Chrome622195, Xvfb:99가 모두 죽어 있었다(로그에 종료 기록 없음). runner 상태는 `final-native-build/archive-orphaned-owner603292-20260909T0845Z/`에 보관.
- **원래 사용자 Aside를 다시 띄웠다**: `BELMONT_BROWSE_DISPLAY=:0 bash belmont-browse/run-fork.sh`를 setsid로 분리 실행. daemon **672760**, Chrome **672812**, engine1.26.907.1712, 실제 확장, CDP9333/API9340/daemon21420, health ok. 로그 `data/artifacts/aside-remaining-closure-20260908/logs/primary-relaunch-20260909T0851Z-{serve,chrome}.log`. 프로필/DB/credential은 건드리지 않았다. 이전 Settings 탭 정리 항목은 그 Chrome이 사라져 무의미해졌다.
- **테스트 fixture 수정 2곳 적용 → crash 소멸, 그러나 같은 두 테스트가 assertion 실패 → 원인 분석 후 assertion 2곳 수정 → targeted unit 20/20 PASS.** production C++ 변경 없음(chrome target no-op, Chrome SHA `de6261ca…` 동일). 현재 fingerprint `b5051935…`. 상세는 APPLIED_TEST_FIXES.md.
- **runner tests phase PASSED (01:18 UTC).** unit_tests/components_unittests/browser_tests 링크 완료, targeted 실행 unit 20/20 · components 2/2 · browser 2/2 · BrowserManagerServiceTest 7/7, 실패/crash/미실행 0. 상세 `final-native-build/final-summary.json`. runner는 종료됐고 `runner.pid`는 없다.
- `verification/check-ledger-integrity.py`를 외부 gate 6개·새 상태 값·evidence/currentEvidence/newExecutionEvidence 전 구간 검사로 갱신, `ledger-integrity.json` PASS 재생성. acceptance-units L02와 캠페인 status.json을 현재 결과로 갱신.

## 감사 보고서 조치 (같은 날 오후)

GPT Pro 감사 보고서의 F01~F07을 브랜치 `fix/audit-remediation`에서 조치했다. 상세는 `docs/audit-remediation-2026-09-09.md`. 요약: F02·F04·F05·F06·F07 해결, F01은 launcher 범위 해결, F03은 스트리밍·capability만(부분). clean-checkout CI가 브랜치 HEAD에서 성공(run 34308536647). 오후 후반: C01 sandbox 파싱, for-chrome 웹 Origin guard(의도된 차이), browser suite CI 게이트 편입(LFS archive), 반복 루틴 실제 실행 검증, 골든 E2E 근거 장부, 91-row 기계적 대조까지 처리. 남은 것은 골든 E2E 시나리오 자체 구현(특히 not-covered 5건)과 91-row의 missingGate 실행(사용자 흐름 관찰), 성능 빌드(기준선 없음). Claude tool bridge는 사용자가 Claude provider를 쓰지 않기로 해 보류. 오후: 원본 함수 재사용으로 부팅 시 메모리 backfill과 저장된 답의 자동 재개를 연결(문서 하단 참조). 켜져 있는 primary는 다음 실행부터 반영.

## 살아 있는 프로세스 (16:12 KST 재시작 후)

- Belmont 호스트: tmux 세션 `belmont-bot`, runner 795498 / host 795526 / electron 795611, 게이트웨이 127.0.0.1:45026, 새 번들(settings 격리·provider promise 정착 포함). 로그 `data/artifacts/aside-remaining-closure-20260908/logs/host-restart-20260909T0712Z.log`. 죽어 있으면 `tmux new-session -d -s belmont-bot -c <repo> 'SAND_ASIDE_BROWSE=1 npm run wsl:start'`(Node 26.5, `tmux kill-server` 하지 말 것).
- Aside primary: **엔진 1.26.909.1820**, daemon 44335 / Chrome 44370 (9/10 13:59 기동, GPU 렌더링 켬; 홈 `belmont-browse/.state/aside-home-909`; 907 홈은 되돌리기용). 이전(907): daemon 931697 (21:15 KST 후속 모델 재기동; 18:29, `BELMONT_BROWSE_DISPLAY=:0 bash belmont-browse/run-fork.sh`, setsid), **미니 팝업 크래시 + 탭 검색 닫힘 수정 빌드(chrome sha 37528b8c…)**. 포크 소스를 바꾸면 빌드 후 `python3 belmont-browse/tools/regenerate-source-checkpoint.py` → `node tools/native-build-identity.mjs record` 순서. health의 memory.semantic available. 16:51 크래시·원인·검증은 `docs/audit-remediation-2026-09-09.md` 맨 아래.
- 사용자가 본 "cyber" API 오류는 Claude Code 세션의 안전장치 메시지였다(Aside/Belmont 무관, 조치 없음).
- 골든 E2E는 스텁·계약 수준이다. 포크 UI 실동작 점검(미니 팝업·옵션 창·탭 검색·PW 팝업·단축키)은 `belmont-browse/tools/check-fork-ui-*.mjs`로 격리 인스턴스에서 수행했고 결과는 `docs/audit-remediation-2026-09-09.md` 하단. 남은 것: PW 팝업 크기·위치의 원본 비교(원본 바이너리 필요), Escape 실제 키 입력.

## 실사용 검증을 맡길 때

**전수판** `docs/full-user-test-checklist-2026-09-09.md`(+부록 `docs/full-user-test-inventory-2026-09-09.md`)를 지시서로 준다. 시나리오 골격은 `docs/real-use-test-plan-2026-09-09.md`. 데몬이 필요한 시나리오는 사용자 primary에서 승인 아래 수행한다.

## Aside 신규 버전 (2026-09-09 밤 확인)

원본은 1.26.908.1846(changelog)과 1.26.909.1820(업데이트 서버 제공)까지 나와 있다. **2026-09-10 00:57에 909로 올렸다.** 백업 `data/artifacts/backups/state-before-909-20260910T0042Z.tgz`. 909 CRX 3개는 `data/artifacts/aside-909-20260909/`에 받아 풀어 뒀다(미커밋). 올릴지는 사용자 결정. 절차 `belmont-browse/docs/UPGRADE.md`. 909 데몬과 우리 907 포트 비교·패치 체인 영향은 `docs/aside-909-daemon-comparison-2026-09-10.md`.

## 새 세션이 먼저 할 일

```bash
cd /home/hoon/_roots/labs/work/Belmont
cat data/artifacts/aside-remaining-closure-20260908/final-native-build/status.json
cat data/artifacts/aside-remaining-closure-20260908/final-native-build/runner.pid
ps -p $(cat data/artifacts/aside-remaining-closure-20260908/final-native-build/runner.pid) 672760 672812 -o pid,stat,etime,args
```

- status는 PASSED여야 한다(세션2 종료 시점). L02는 닫혔다. 남은 것은 **91-row workflow ledger와 F/V 최종 정리**이며, native 테스트 결과는 사용자 흐름 row를 닫는 근거가 아니다. 새 빌드를 띄울 이유가 없다.
- runner를 다시 띄울 때는 반드시 `PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python`과 setsid 분리 실행. 테스트 소스를 바꾸면 `--phase chrome`을 먼저 돌려 fingerprint를 갱신한다.
- 남은 미해결 범위(B-profile 반복 전환의 로그인 전제, PW popup resize, 모바일 필수 검사 2실패, 91-row 최종 ledger)는 인계 문서 그대로다. 전체 parity 완료로 보고하지 않는다.

**Windows 네이티브 제어(컴퓨터 유즈) 조사 결과**는 `docs/codex-computer-use-review-2026-09-10.md`. 결론: 실행 층은 오픈소스 cua 드라이버, Codex 런타임은 문서만 참고, Aside 브라우저 층에는 정책 글 4개만 보탬. 사용자 결정 대기: cua 설치 승인·CAPTCHA 정책·정책 글 자리.
