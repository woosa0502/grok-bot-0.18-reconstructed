# 다음 세션 시작점 — Aside/Belmont (세션2 갱신 2026-09-09 19:20 KST)

## 지금 상태 요약 (2026-09-10 23:30 KST, 세션3 종료 직전 — compaction용)

**살아 있는 것**
- 사용자 Aside: daemon **129705** / Chrome **129742**, 엔진 1.26.909.1820, 홈 `belmont-browse/.state/aside-home-909`, GPU 켬(GALLIUM_DRIVER=d3d12 + --ignore-gpu-blocklist), 포크 빌드 **c3209e2f**(9/10 23:19 링크). 23:22에 setsid로 띄움. health `http://127.0.0.1:9340/health`(토큰 `belmont-browse/.state/serve.json`).
- Belmont 호스트(tmux `belmont-bot`)는 **꺼져 있음**(테스터가 껐고 다시 안 켬). 필요하면 `SAND_ASIDE_BROWSE=1 npm run wsl:start`.
- 격리 점검 창(Xvfb :97, `/tmp/aside-test-state`)은 닫고 지웠음.

**오늘 한 일(순서)** — 상세는 `docs/progress-log-2026-09-10.md`
1. Codex 컴퓨터 유즈 조사 → `docs/codex-computer-use-review-2026-09-10.md`, GPT Pro 지시서 `docs/gpt-pro-brief-windows-computer-use-2026-09-10.md`(바탕화면 zip으로도 전달). 결론: 실행 층은 trycua/cua 드라이버, Codex는 문서만 참고.
2. CI 실패 원인(909 구성요소 압축 폴더 구조) 수정 → 9764f95.
3. 테스터 MASTER-COVERAGE 검토 → `data/artifacts/full-user-test-20260909/MASTER-COVERAGE-REVIEW.md`(핵심: 확장 포트 21420 고정이라 격리 검증은 사용자 데몬을 멈추고 해야 함).
4. 원자 단위 실사용 테스트 직접 실행(227 컨트롤) → `docs/atomic-sweep-summary-2026-09-10.md`, 장부 `data/artifacts/full-user-test-20260910-atomic/LEDGER.md`.
5. FAIL 13건 전부 수정·재검 → 6cad6b8(CI 성공). 포크 9파일(aside:// 스킴, Import 배열, 가속기 Ctrl+S/E/Shift+E/Shift+C/Shift+-, 메뉴 문구), 데몬 패치(WSL 폴더 열기, 907·909 재고정), 자산 패치 도구 `belmont-browse/tools/patch-linux-platform-glyphs.py`.

**사용자 결정 대기**
- cua 드라이버 Windows 설치 승인(연기 테스트는 사용자가 보는 앞에서).
- CAPTCHA 정책: 계속 자동 / Codex처럼 묻기.
- Aside에 보탤 정책 글 4개(확인 정책·로그인/탭 넘기기·봇 차단 분류·완료 기준)를 내장 스킬로 넣을지, 훅으로 붙일지.
- 실행기에 데몬 포트 치환(확장 사본의 21420 → 지정 포트) 추가 여부: 넣으면 사용자 Aside를 안 끄고도 격리 검증 가능.

**다시 시작할 때 주의**
- 포크 소스를 바꾸면: 빌드(`third_party/ninja/ninja -C out/aside -j3 chrome`, `chrome_command_ids.h` 건드리면 379단계·약 15분) → `python3 belmont-browse/tools/regenerate-source-checkpoint.py` → `cd belmont-browse && node tools/native-build-identity.mjs record --chrome /home/hoon/chromium/src/out/aside/chrome --engine 909`.
- 확장 자산 패치를 바꾸면 살아 있는 프로필의 `belmont-browse/.state/chrome-profile/aside_component/agent-manager/1.26.909.1820`을 지운 뒤 재기동해야 반영됨(준비 도구가 같은 버전의 다른 내용을 덮어쓰지 않음).
- 데몬 패치 체인은 원본에서 다시 돌린다(`belmont-browse/docs/UPGRADE.md` 체인 순서). `patch-daemon-linux.py`는 입력을 제자리에서 덮어씀.
- `pkill -f`에 자기 명령줄이 매칭돼 셸이 죽는 사고가 두 번 있었음. PID로 죽일 것.
- 테스트는 Node 26(`/home/hoon/.local/share/mise/installs/node/26.5.0/bin/node`)으로. nvm의 Node 22로 돌리면 `node --check`류가 잘못 실패함.
- 점검 창 절차는 `docs/full-user-test-checklist-2026-09-09.md` §2.2/§2.3 그대로(사용자 데몬 정지 → 상태 복사 → Xvfb :97 → 전체 스택). 실키·마우스는 xdotool, DOM 확인은 `data/artifacts/full-user-test-20260910-atomic/tools/cdp.mjs`(`front`/`visible`/`eval id:<targetId>`).

**남은 항목**
- 원자 테스트 NOT_DONE 10(S12 Belmont 연동 8행, 2시간 방치, 완료 소리 Change 등)·BLOCKED 6(클라우드 계정·PRO)·DIFFERS 5(`--no-sandbox` 안내 막대, 원본 미확인 항목).
- 저장소에 남의 미커밋 파일: `docs/shopping-bot-plan-2026-09-08.md`(수정), `docs/shopping-bot-memory-init.md`, `docs/taobao-account-safety-2026-09-10.md`(신규). 내 작업 아님, 손대지 않음.


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
- Aside primary: **엔진 1.26.909.1820**, daemon 129705 / Chrome 129742 (9/10 23:22 수정 빌드 c3209e2f로 재기동, GPU 켬; 22:21 기동분 112992/113027은 이전 빌드; 그 전 76304/76363은 20:33 테스터 재기동, GALLIUM_DRIVER=d3d12 --ignore-gpu-blocklist
--ignore-gpu-blocklist; 13:59 기동분 44335/44370은 GPU 켬이었음; 홈 `belmont-browse/.state/aside-home-909`; 907 홈은 되돌리기용). 이전(907): daemon 931697 (21:15 KST 후속 모델 재기동; 18:29, `BELMONT_BROWSE_DISPLAY=:0 bash belmont-browse/run-fork.sh`, setsid), **미니 팝업 크래시 + 탭 검색 닫힘 수정 빌드(chrome sha 37528b8c…)**. 포크 소스를 바꾸면 빌드 후 `python3 belmont-browse/tools/regenerate-source-checkpoint.py` → `node tools/native-build-identity.mjs record` 순서. health의 memory.semantic available. 16:51 크래시·원인·검증은 `docs/audit-remediation-2026-09-09.md` 맨 아래.
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

**전수 테스트 현황(9/10 21시)**: 테스터 `data/artifacts/full-user-test-20260909/MASTER-COVERAGE.md`는 PASS 24/118. 그 "환경 제약 3개"는 검토 결과(`MASTER-COVERAGE-REVIEW.md`) 대부분 절차 오류다: 확장 포트 21420 고정 때문에 격리 인스턴스는 사용자 데몬을 끄고 돌려야 한다(또는 실행기에 포트 치환 추가). 메시지 메뉴 등 5건은 `#/u/0/...` 경로로 재검.

**원자 단위 실사용 테스트(9/10 저녁, Claude 직접)**: 컨트롤 227개 실측, PASS 184·FAIL 13. 요약 `docs/atomic-sweep-summary-2026-09-10.md`, 장부 `data/artifacts/full-user-test-20260910-atomic/LEDGER.md`. 결함 묶음은 aside:// 스킴·폴더 열기·Import·Dark 테마 네이티브·단축키. 남은 것: S12(Belmont 연동), 클라우드 BLOCKED, 2시간 방치.

**9/10 밤 수정**: 원자 테스트 FAIL 13건을 다 고쳤다(aside:// 스킴, 폴더 열기→Windows 탐색기, Import 오류, 리눅스 단축키 5개, Ctrl/File Explorer 표기). 포크 빌드 c3209e2f, 데몬 907/909 재고정, 자산 패치 도구 `patch-linux-platform-glyphs.py`. 확장 자산 패치를 바꾸면 살아 있는 프로필의 `aside_component/agent-manager/<ver>`를 지워야 반영된다. 상세 `docs/atomic-sweep-summary-2026-09-10.md` 재검 절.
