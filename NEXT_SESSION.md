# 다음 세션 시작점 — Aside/Belmont (세션2 갱신 2026-09-09 09:05 KST)

**작업 완료 판정이 아니다.** 세션2가 인계 문서의 다음 순서를 실행했고, 아래는 그 결과와 현재 살아 있는 상태다.

먼저 [상세 인계 문서](data/artifacts/aside-remaining-closure-20260908/HANDOFF_20260909.md)를 읽되, 실행 상태는 이 문서와 [적용된 테스트 수정 기록](data/artifacts/aside-remaining-closure-20260908/handoff-20260909/APPLIED_TEST_FIXES.md)이 우선한다.

## 세션2에서 바뀐 것

- 이전 세션 종료와 함께 runner603292, primary daemon622120/Chrome622195, Xvfb:99가 모두 죽어 있었다(로그에 종료 기록 없음). runner 상태는 `final-native-build/archive-orphaned-owner603292-20260909T0845Z/`에 보관.
- **원래 사용자 Aside를 다시 띄웠다**: `BELMONT_BROWSE_DISPLAY=:0 bash belmont-browse/run-fork.sh`를 setsid로 분리 실행. daemon **672760**, Chrome **672812**, engine1.26.907.1712, 실제 확장, CDP9333/API9340/daemon21420, health ok. 로그 `data/artifacts/aside-remaining-closure-20260908/logs/primary-relaunch-20260909T0851Z-{serve,chrome}.log`. 프로필/DB/credential은 건드리지 않았다. 이전 Settings 탭 정리 항목은 그 Chrome이 사라져 무의미해졌다.
- **테스트 fixture 수정 2곳 적용 → crash 소멸, 그러나 같은 두 테스트가 assertion 실패 → 원인 분석 후 assertion 2곳 수정 → targeted unit 20/20 PASS.** production C++ 변경 없음(chrome target no-op, Chrome SHA `de6261ca…` 동일). 현재 fingerprint `b5051935…`. 상세는 APPLIED_TEST_FIXES.md.
- runner tests phase를 setsid로 다시 시작했다(`final-native-build/runner.pid`, `status.json` 기준). 순서: build-unit-tests(no-op) → build-components-unittests(458) → build-browser-tests(2439) → run-unit-targeted → run-components-targeted → run-browser-targeted → run-browser-manager-suite.
- `verification/check-ledger-integrity.py`를 외부 gate 6개·새 상태 값·evidence/currentEvidence/newExecutionEvidence 전 구간 검사로 갱신, `ledger-integrity.json` PASS 재생성. acceptance-units L02와 캠페인 status.json을 현재 결과로 갱신.

## 새 세션이 먼저 할 일

```bash
cd /home/hoon/_roots/labs/work/Belmont
cat data/artifacts/aside-remaining-closure-20260908/final-native-build/status.json
cat data/artifacts/aside-remaining-closure-20260908/final-native-build/runner.pid
ps -p $(cat data/artifacts/aside-remaining-closure-20260908/final-native-build/runner.pid) 672760 672812 -o pid,stat,etime,args
```

- status가 RUNNING이고 owner PID가 살아 있으면 중복 실행하지 않는다. PASSED면 `final-native-build/logs/run-*.log`로 targeted 결과를 읽고 L02/ledger를 마무리한다. FAILED면 `status.json.error`와 해당 stage 로그를 먼저 분석한다(동일 실행 반복 금지).
- runner를 다시 띄울 때는 반드시 `PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION=python`과 setsid 분리 실행. 테스트 소스를 바꾸면 `--phase chrome`을 먼저 돌려 fingerprint를 갱신한다.
- 남은 미해결 범위(B-profile 반복 전환의 로그인 전제, PW popup resize, 모바일 필수 검사 2실패, 91-row 최종 ledger)는 인계 문서 그대로다. 전체 parity 완료로 보고하지 않는다.
