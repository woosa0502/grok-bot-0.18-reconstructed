# Aside(포크)·Belmont 실사용 검증 계획 — 다른 모델에게 맡기는 판

작성 2026-09-09 20:10 KST. 목적: **진짜 사용자처럼** Aside 포크와 Belmont 연동을 끝까지 써 보고, 원본 Aside와 다른 점·깨지는 점을 근거와 함께 남긴다. 지금까지의 점검은 대부분 계약·스텁 수준이거나 모델이 기계적으로 열어 본 경로였다. 이 문서는 그 빈틈을 사람 흐름으로 메우는 지시서다.

읽는 순서: §1 원칙 → §2 환경 사실 → §3 판정·근거 규칙 → §4 알려진 상태 → §5 시나리오 → §6 91-row 대응표 → §7 보고 형식. 진행은 `docs/progress-log-2026-09-09.md`에 한 줄씩 쌓는다(맨 아래가 최신).

---

## 1. 원칙 (어기면 결과를 버린다)

1. **사용자 행동으로만 판정한다.** 보이는 컨트롤에 실제 클릭·키 입력을 보내고, 화면과 실제 효과(파일·기록·재열기)를 따로 확인한다. 내부 API 직접 호출, DOM 수정, 로그 한 종류만으로 PASS를 주지 않는다. (기존 규칙: `docs/belmont-user-test-method-2026-08-25.md` §1, §7)
2. **원본 동일성이 기준이다.** 기대 결과는 "원본 Aside가 이렇게 한다"이다. 원본 동작을 모르면 `원본 확인 필요`로 적고 추측으로 PASS 주지 않는다. 원본 설치 파일은 `C:\Users\HOON\Desktop\Aside-원본-최신\`(Windows용 바이너리, 리눅스에서 실행 불가, 확장 JS·리소스는 참고 가능).
3. **고치지 않는다, 먼저 보고한다.** 결함을 찾으면 재현 절차·근거만 남긴다. 수정은 별도 결정. 특히 데몬(`vendor/aside-907/.../daemon.mjs`)과 확장 JS는 원본이라 손대지 않는다. 포크 C++도 원본 Chromium 패턴 재사용이 원칙이다("새로 만들지 마라").
4. **사용자 데이터를 보호한다.** 실 인스턴스(사용자 프로필)에서 테스트할 때는 사용자 승인 시각 안에서만, 테스트 산출물은 이름 앞에 `[test]`를 붙이고, 끝나면 정리(세션 archive, 루틴 pause, 북마크 삭제). 비밀번호 금고는 **테스트용 항목만** 만들고 실제 자격증명은 절대 기록·캡처하지 않는다. 캡처에 실제 계정 정보가 찍히면 그 캡처는 폐기.
5. **인스턴스를 함부로 죽이지 않는다.** 사용자 Aside(primary)와 Belmont 호스트 재기동은 사용자에게 알린 뒤에만. 재기동하면 열린 탭이 닫힌다.
6. **보고 표현은 평이하게.** 이 작업은 브라우저 자동화·자격증명·프로세스 제어를 다루므로, 보고서에 공격 도구처럼 읽히는 표현(강제 종료, 우회, 주입, 덤프, 탈취)을 쓰지 말고 "닫기", "재시작", "확인"처럼 적는다. 오류 원문은 파일에만 남기고 대화에는 한 줄 요약.

## 2. 환경 사실 (2026-09-09 20:00 기준)

| 항목 | 값 |
|---|---|
| 저장소 | `/home/hoon/_roots/labs/work/Belmont` (origin `woosa0502/Belmont`, main) |
| Node | `/home/hoon/.local/share/mise/installs/node/26.5.0/bin/node` (정확히 26.5) |
| Aside 포크 바이너리 | `/home/hoon/chromium/src/out/aside/chrome` (sha 37528b8c…, 2026-09-09 18:26 빌드) |
| 포크 소스 | `/home/hoon/chromium/src` (base cc5584af = 151.0.7922.171, 로컬 패치는 `belmont-browse/aside-fork/snapshot/chromium.patch`) |
| 사용자 Aside 실행 | `cd belmont-browse && BELMONT_BROWSE_DISPLAY=:0 bash run-fork.sh` (setsid로 분리). 지금 daemon 861840 / Chrome 861892 |
| Aside 화면 | WSLg `DISPLAY=:0` (사용자 화면). 창 크기 1280x800 시작 |
| Aside 상태 API | `http://127.0.0.1:9340` (토큰 `belmont-browse/.state/serve.json`의 `token`, `Authorization: Bearer`) · `/health`, `/aside/sessions` |
| Aside 데몬 API(원본 tRPC) | `http://127.0.0.1:21420` — 확장이 쓰는 것. 도구에서 쓰려면 설치 키 인증 필요(`belmont-browse/tools/verify-recurring-routine.mjs` 참고) |
| 브라우저 자동화 포트 | `127.0.0.1:9333` (실 인스턴스). 탭 조작·화면 캡처·페이지 값 읽기에 사용 |
| Aside 프로필/상태 | `belmont-browse/.state/chrome-profile`, 데몬 홈 `belmont-browse/.state/aside-home-907` (`u/0/state.db`, `logs/daemon-YYYY-MM-DD.log`) |
| Aside 로그 | `data/artifacts/aside-remaining-closure-20260908/logs/primary-relaunch-<UTC>-{serve,chrome}.log` (최신 파일이 현재 인스턴스) |
| Belmont 호스트 | tmux 세션 `belmont-bot` (`SAND_ASIDE_BROWSE=1 npm run wsl:start`), 게이트웨이 `http://127.0.0.1:45026`(인증 필요), 로그 `logs/host-restart-20260909T0712Z.log` |
| Belmont 데스크톱 앱 | Electron 창(DISPLAY :0). DevTools는 F12 또는 Ctrl+Shift+I |
| Belmont 프로필 | `.cache/belmont-wsl-profile/sand-data/` (settings.json, 대화 기록 `agent-transcripts/`) |
| 모바일 PWA | `http://127.0.0.1:4188` (tmux `orca-mobile-wsl`) |
| 모델 | Aside: openai-codex `gpt-5.5` high(사용자 ChatGPT 계정). Belmont: codex 기본 |
| 격리 인스턴스 도구 | `belmont-browse/tools/check-fork-ui-close-paths.mjs`, `check-fork-ui-popups.mjs`, `repro-minipopup-close.mjs` (별도 네트워크 이름공간 + Xvfb + 스크래치 프로필, 데몬 없음 → UI 껍데기만 검증 가능) |
| 화면 캡처 | `import -display :0 -window root out.png` (실 화면, 사용자 승인 필요) · 격리는 `SHOT_DIR` |
| 키/마우스 입력 | `xdotool`(`DISPLAY=:0`). 창 활성화는 `windowfocus`(WM이 `_NET_ACTIVE_WINDOW` 미지원) |

**중요한 제약**: 데몬 포트 21420은 확장에 고정돼 있어 **완전한 두 번째 인스턴스를 동시에 띄울 수 없다.** 채팅·에이전트·메모리·루틴·금고처럼 데몬이 필요한 시나리오는 사용자 primary에서, 사용자 승인 아래 수행한다. UI 껍데기(팝업 열고 닫기, 단축키, 탭 검색, 새 탭)는 격리 인스턴스로 먼저 확인한다.

## 3. 판정과 근거 규칙

판정 값: `PASS` / `FAIL` / `DIFFERS_FROM_ORIGINAL`(동작은 하나 원본과 다름) / `ORIGINAL_UNKNOWN`(원본 동작 확인 필요) / `BLOCKED_EXTERNAL`(로그인·클라우드·외부 서비스) / `UNREACHABLE_CURRENT_BUILD` / `HARNESS_DEFECT`(도구 문제, 제품 실패 아님).

PASS 조건(전부): ① 실제 클릭·키 입력 기록 ② 전후 화면 ③ 실제 효과(재열기·파일·기록·API readback 중 하나 이상) ④ 같은 빌드(chrome sha)·같은 프로필에서 수행 ⑤ 데몬/serve/Chrome 로그에 FATAL·crash 없음.

근거 저장: `data/artifacts/real-use-test-<YYYYMMDD>/<시나리오ID>/` 아래 `steps.jsonl`(시각·행동·관찰), `before.png`/`after.png`, 관련 로그 발췌 `log.txt`. 개인정보·자격증명이 보이는 캡처는 저장 전에 가린다.

시간 기록은 KST와 UTC를 같이(로그는 UTC, serve 로그는 KST).

## 4. 알려진 상태 (테스트 전에 알고 시작)

오늘 고친 것(재검증 대상):
- 미니 팝업 닫기(`window.close()`/Escape)로 브라우저 전체가 죽던 문제 → 수정, 격리 인스턴스에서 전/후 확인. **실 인스턴스에서 사용자 손으로 재확인 필요**(S6-16).
- 탭 검색 창이 Escape·탭 선택 후 안 닫히던 문제 → 수정. **실 인스턴스 재확인 필요**(S6-12).
- 런처 health가 브라우저 사망을 숨기던 문제, 종료 후 프로세스가 남던 문제 → 수정(다음 기동부터).

알려진 미해결·비교 불가:
- 비밀번호 관리자 팝업 크기·위치의 원본 비교(원본 바이너리 없음). 지금은 600x432, 아이콘 아래 오른쪽 정렬, 창 안에 그려짐.
- 프로필 B 전환은 로그인 전제(클라우드) → `BLOCKED_EXTERNAL` 가능성.
- 번역, 관리형 북마크, F07 Ask 캡처, 모바일 필수 검사 2실패, 성능 기준선 없음.
- 미니 팝업 옵션 창 훅이 이전 빌드에서 2회 거절된 적 있음(원인 미확정). 재발 시 `--vmodule=mini_popup_service=1` 로그로 사유 확인.
- 환경 잡음(결함 아님): `dbus/bus.cc` 오류, 구글 구성요소 갱신 실패, `sessions.shareStatus UNAUTHORIZED`(클라우드 미로그인).

## 5. 시나리오 (깊게, 사용자 흐름 그대로)

각 시나리오: **행동** → **기대(원본 기준)** → **확인 방법** → **근거**. 우선순위 P0(죽음·데이터 손실) > P1(핵심 흐름) > P2(시각·부가).

### S0. 첫 실행·복구 (P0)

- S0-1 콜드 스타트: primary 재기동(사용자 승인) → 30초 안에 창·사이드바·확장 등록(`[engine] ... real extension` 로그) → `/health` `ready:true, browser.alive:true, memory.mode:native`.
- S0-2 이전 상태 복원: 재기동 전 열어 둔 탭·채팅 목록·루틴·메모리가 그대로인가. 원본은 세션 복원 + 답변 대기 중이던 작업을 자동 재개(`[lifecycle] ... handed to the original suspension recovery` 로그). 재기동 전 일부러 답변 대기 상태를 하나 만들어 두고 확인.
- S0-3 브라우저만 죽었을 때: (사용자 승인) Chrome 프로세스만 종료 → health `browser.alive:false`, 런처 로그에 안내 → run-fork.sh 재실행으로 복구. 원본은 앱 자체가 다시 뜨는 방식이라 `DIFFERS_FROM_ORIGINAL` 후보.
- S0-4 종료: 사용자가 창을 닫으면 데몬도 정리되고 프로세스가 남지 않는가(`ps`로 확인, 5초 이내).

### S1. 사이드바 (A1~A15, P2→P1)

- S1-1 섹션 순서·헤더·구분선·바탕색(A1,A2,A4,A13): 캡처 1장 + 원본 확장 리소스의 스타일과 대조. 다크모드에서도 반복(C12).
- S1-2 접기/펼치기(A3,A14): 꺾쇠 클릭·키보드(Tab→Enter)로 접고 펼침, 재기동 후 상태 유지.
- S1-3 New Chat(A5,F4): 클릭 → 사이드패널 composer 열림 → 실제 메시지 전송 → 답변 스트리밍 → Chats 목록에 새 항목. 제목 자동 생성되는가.
- S1-4 New Tab(A6,F2): 클릭 → 새 탭 페이지(Search/Ask 전환) → 검색어 입력 → Enter → 결과 탭. Ask 모드 입력 → Enter → 채팅 생성.
- S1-5 탭 행(A7,A8): 탭 20개 열기 → 선택 탭 흰 카드, favicon·제목 갱신, 닫기 X, 가운데 클릭, pinned 재배치, hover.
- S1-6 북마크 드래그(A9,G22): 탭 행을 북마크 박스로 드래그 → 북마크 생성 → 클릭으로 열림 → 삭제. 리눅스 포인터 경로 실제 사용.
- S1-7 footer(A10~A12,C1,C2): 아바타 클릭 → 프로필 메뉴 항목·색, 꺾쇠, 검색 아이콘 → 탭 검색.
- S1-8 상단 아이콘(A15): organizer/grid/tab search 각각 클릭 효과. Tidy는 실제 AI 그룹핑 결과가 있는지(성공 boolean만으로 PASS 금지).

### S2. 툴바·주소창 (B1~B9)

- S2-1 뒤로/앞으로/새로고침 버튼 실제 클릭(B1~B3, G19): 3개 사이트 방문 후 버튼으로 이동, 자동화 포트로 URL readback.
- S2-2 주소창 표시(B4,B8,B9): `domain | title` 압축 표시, 무테두리, 별 없음. 긴 제목·한글 제목·https/http·about: 페이지에서 각각 캡처.
- S2-3 자동완성(B4,B8,G24): 방문 기록 5개 이상 만든 뒤 두 글자 입력 → 5 매치 → 방향키 선택 → Enter.
- S2-4 Ask Aside 버튼(B5,F1): 클릭 → 사이드패널 → 현재 페이지 맥락 질문("이 페이지 요약") → 답변에 페이지 내용 반영.
- S2-5 우측 key 아이콘(B6, G14): 비밀번호 관리자 팝업 → 테스트 금고 생성·잠금 해제 → 테스트 사이트(예: `https://the-internet.herokuapp.com/login`)에서 저장·자동채움 → 팝업 닫힘(Escape, 선택 후). 실제 계정 정보 사용 금지.
- S2-6 우측 card 아이콘(B7): 무엇이 열리는지 원본과 대조(원본 확인 필요).

### S3. 메뉴·모달 (C1~C12, D1)

- S3-1 탭 컨텍스트 메뉴(C4), 페이지 컨텍스트 메뉴의 "Aside Browsing Agent" 서브메뉴(C5): 각 항목 실제 실행 효과.
- S3-2 북마크 매니저(C6): 생성·이름 변경·폴더·삭제·재기동 유지.
- S3-3 Vaults 모달(C7): 새 금고 생성·전환·삭제(테스트 금고만).
- S3-4 미니 팝업 바(C8, G16): Alt+Space → 질문 입력 → 답변 → 상태(compact/expanded/attachments) 크기 변화 → 옵션 창(⋯) 열고 닫기 → Escape로 닫기 → 다시 Alt+Space. **브라우저가 살아 있는지 매번 확인.** 옵션 창이 별도 팝업 브라우저 창으로 뜨면 `FAIL`(훅 거절, 로그 사유 첨부).
- S3-5 Lasso(C9,E16,G17): 텍스트 선택 → 메뉴 → 실행 결과.
- S3-6 에이전트 탭 그룹(C10,G21): 에이전트 작업이 만든 탭이 파란 "N Agent Tabs" 그룹으로 묶이고, 작업 종료 후 정리되는가.
- S3-7 split view(C11,G20): 두 탭 분할 → 크기 조절 → 해제.
- S3-8 다크모드(C12,G25): 전환 → 사이드바·새 탭·팝업 색 → 재기동 유지.
- S3-9 플랫폼 메뉴(D1): Aside/File/Edit/View/History/Bookmarks/Profiles/Tab/Window/Help 각 항목 목록화 후 항목별 효과(리눅스에는 없는 항목은 `NOT_APPLICABLE` 근거 기재).

### S4. 설정 (E1~E17)

각 설정 페이지에서 **컨트롤 목록을 먼저 만든 뒤**(드롭다운·토글 전부), 바꾸고 → 효과 → 재기동 후 유지 확인. 한 장 캡처로 전체 OK 금지.
- E1 General, E2 Appearance(Theme/Zoom/TabStyle/단축키), E5 Security & Privacy(+Site settings; 실제 브라우징 데이터 삭제는 테스트 프로필에서만).
- E3 Account, E4 Plan & Usage: 클라우드 로그인 전제 → 상태만 기록(`BLOCKED_EXTERNAL`), 로컬 부트스트랩을 로그인으로 대체하지 않기.
- E6 Agents(드롭다운 각각), E8 Models(선택·추론 레벨·Connect) → 새 세션·기존 세션 적용 → 재기동.
- E7 Projects(+Create) → 채팅을 프로젝트에 넣기(G10b).
- E9 Plugins & MCPs: MCP 서버 하나 실제 연결·호출·오류·refresh(파일 개수나 toast로 완료 금지).
- E10 Memory(files/Overview/History/Configure): 항목 추가·삭제·검색 → 한국어 검색 → 의미 검색이 실제로 native인지(`/health` memory.semantic.state, 로그 `[memory] semantic search ready`), 어휘 fallback을 native 성공으로 보고 금지(G6, G26, G26b).
- E11 Passwords(AutoLock/Biometrics/Vaults): 자동 잠금 시간 바꾸고 실제 잠기는지.
- E12 Routines(Create/Scan): S6-15와 연결.
- E13 Channels(Slack/Discord/Telegram): 외부 토큰 없으면 `BLOCKED_EXTERNAL`, UI 입력 검증만.
- E14 Developers(CLI/Skills/MCP/Remote), E15 Mini popup(Enable/Shortcut 변경 → 실제 단축키 반영), E17 Archived chats(archive/unarchive 실제 동작).

### S5. 확장 페이지 (F1~F9)

- F1 사이드패널: 열기/닫기/크기, 탭 전환 시 세션 따라가기(`use-sidepanel-session-on-tab-change`).
- F2 새 탭: Chats/Routines 목록 표시·클릭 이동.
- F3 챗 상세: steps 펼치기, Share(클라우드 → 상태만), ⋯ 메뉴(rename/archive/project) 각각 효과(G10b).
- F5 minipopup.html, F7 tabsearch.html: S3-4, S6-12.
- F6 notification.html: 실제 토스트가 뜨는 이벤트(작업 완료·승인 요청) → 클릭 → 부모 닫힘·중복 없음.
- F8 account-password.html: 계정 암호 설정/복구 화면(로컬에서 도달 가능한 범위만).
- F9 tab-preview-player: 탭 미리보기 재생.

### S6. 기능 실행 — 가장 깊게 (G1~G26b, P1)

각 작업은 **실제 사이트**와 **실제 모델 호출**을 쓴다(비용 발생, 사용자 승인). 작업 제목에 `[test]`.
- S6-1 에이전트 작업 전체 수명(G1): "네이버 뉴스에서 오늘 IT 기사 3개 제목과 링크 표로" → run → 진행 표시 → 중간 steer("경제 기사로 바꿔") → stop → continue → 완료. 사이드바 상태·자동화 포트 탭 readback·데몬 로그(`sessions.*`) 일치.
- S6-2 Guard 승인(G2): 로그인·결제처럼 승인이 필요한 행동을 유도(테스트 사이트의 form 제출) → suspend → 알림 토스트 → allow/deny 각각 → 결과. deny 후 작업이 정직하게 끝나는가.
- S6-3 도구별(G3~G9): 브라우징(repl)·bash·webfetch·파일 읽기/쓰기·websearch·subagent 각각을 자연어 작업으로 유도하고 도구 오류가 사용자에게 어떻게 전달되는지(G4 "기존 pass 문자열 금지").
- S6-4 세션 목록/메시지(G10): 만든 세션이 사이드바·새 탭·`/aside/sessions`에서 일치.
- S6-5 모델·추론 레벨(G11,E8): 바꾼 뒤 다음 메시지가 실제로 그 모델로 나가는지(데몬 로그 `models.*`, 응답 속도·표기).
- S6-6 스킬(G12): 존재하는 스킬 하나를 실제로 불러 쓰는 작업.
- S6-7 MCP(G13): S4 E9.
- S6-8 금고(G14): S2-5.
- S6-9 루틴(G15,E12): "매 1분" 루틴 생성(브라우저 바인딩 포함) → 자동 발화 2회 관찰(원본 스케줄러 30초 tick) → 수동 Trigger now 별도 → pause → 재기동 후 유지/재개 → 정리(pause, 삭제 UI). 오늘 도구가 남긴 "[belmont recurring-routine check, paused]" 2개는 UI에서 삭제 가능한지 확인.
- S6-10 미니 팝업 실행(G16): S3-4 + 실제 답변.
- S6-11 Lasso 실행(G17).
- S6-12 탭 검색(G18 일부, A12, C3, F7): 탭 20개 → 검색 아이콘/단축키(Ctrl+Shift+A) → 입력 → 방향키 → Enter → 해당 탭 활성·창 닫힘 → 다시 열어 Escape → 닫힘. 긴 결과 스크롤.
- S6-13 네이티브 탭(G18): 열기/닫기/이동을 사용자 조작으로, 자동화 포트로 탭 모델 readback 대조.
- S6-14 프로필(G23,C2): 새 프로필 추가 → 전환 → 되돌아오기 → 창 닫힘·비동기 실패 없음. 로그인 전제면 `BLOCKED_EXTERNAL`.
- S6-15 메모리 회상(G26b): 오늘 세션에서 사실 3개를 말해 두고(예: "내 테스트 프로젝트 이름은 X") → 재기동 → 새 세션에서 회상 질문 → 답에 반영 + 데몬 로그에 의미 검색 흔적. 한국어로도.
- S6-16 미니 팝업 닫힘(오늘 수정 재확인): 열고 Escape, 옵션 창 열고 닫기, 다시 열기 ×3 → 브라우저 생존(`/health` browser.alive).

### S7. Belmont 연동 (P1)

- S7-1 Belmont 데스크톱에서 "브라우저로 …" 작업 → aside-browse 하위 봇 생성(호스트 로그 `[browse-runtime]`) → Aside 사이드바에 같은 세션이 미러링(`/aside/sessions`) → 답이 Belmont 대화에 돌아옴.
- S7-2 실패 시 재시도: 작업이 error로 끝나면 `gpt-5.5/high`로 한 번 재시도하고 알리는가(README "기본 모델과 재시도").
- S7-3 취소: Belmont에서 중단 → Aside 세션도 멈춤(`requestStop`).
- S7-4 모바일 PWA(4188): 같은 대화가 폰에서 보이고 보낼 수 있는가, 아바타 렌더.
- S7-5 호스트 재기동 후 링크 유지(`AsideLink`), 손상 시 정직한 오류.

### S8. 장시간·안정성 (P0)

- S8-1 2시간 방치 + 30분마다 가벼운 사용: FATAL 0, 메모리 사용량 추이(`ps -o rss`), 데몬 error 증가분 분류.
- S8-2 탭 50개·세션 30개 상태에서 사이드바·탭 검색 반응 시간.
- S8-3 네트워크 끊김(WSL에서 잠시 인터넷 차단은 사용자 승인) 중 작업 → 복구 후 이어짐.

## 6. 91-row 대응표 (행 ID → 시나리오, 남은 gate)

아래 표의 `missingGate`는 그 행을 닫으려면 반드시 관찰해야 하는 것이다. 표는 `data/artifacts/aside-remaining-closure-20260908/workers/workflow-ledger.json`에서 생성했다.

| 행 | 제목 | 흐름 | 시나리오 | 남은 gate (요약) |
|---|---|---|---|---|
| A1 | 섹션 순서 Bookmarks→Chats→Tabs | sidebar_visual | S1-1 | 현재 primary의 대응 상태 1회 관찰 및 원본 같은 상태 대조; screenshot 존재만으로 클릭 동작을 승인하지 않는다. |
| A2 | 섹션 헤더 텍스트(회색) | sidebar_visual | S1-1 | 현재 primary의 대응 상태 1회 관찰 및 원본 같은 상태 대조; screenshot 존재만으로 클릭 동작을 승인하지 않는다. |
| A3 | 섹션 헤더 꺾쇠 오른쪽 ^(위) | disclosures | S1-2 | 텍스트/아이콘 두 hit target, keyboard focus, populated/empty, restart persistence를 현재 native 입력으로 확인. |
| A4 | 섹션 사이 구분선 | sidebar_visual | S1-1 | 현재 primary의 대응 상태 1회 관찰 및 원본 같은 상태 대조; screenshot 존재만으로 클릭 동작을 승인하지 않는다. |
| A5 | New Chat 행 (연필+어두운글자) | new_chat | S1-3 | native click->route->composer는 로컬로 먼저 확인; 실제 전송/완료는 현재907 model gate와 함께 확인. |
| A6 | New Tab 행 (+아이콘+어두운글자) | new_tab | S1-4 | 현재 click/tab-count/navigation readback; footer 잔존 원인 수정 뒤 render 관찰. |
| A7 | 탭 행 (favicon+title, 투명) | tab_rows | S1-5 | 현재 native click/keyboard 및 탭 모델 readback; pinned 재배치·hover exit·긴 목록 포함. |
| A8 | 선택 탭 흰 카드 | tab_rows | S1-5 | 현재 native click/keyboard 및 탭 모델 readback; pinned 재배치·hover exit·긴 목록 포함. |
| A9 | 빈 북마크 점선 박스 "Drag tabs here to add bookmarks" | bookmark_drag | S1-6 | drag 코드·독립 source review 후 실제 Linux pointer path, only-tab/multi/group/split, 스크롤 경계, >40행을 검증. |
| A10 | footer 아바타 | profile_menu | S1-7 | 수정된 메뉴 실제 render+hit target·long names·light/dark·닫기 수명주기; sign-out navigation을 sign-out 완료와 구분. |
| A11 | footer 꺾쇠 | profile_menu | S1-7 | 수정된 메뉴 실제 render+hit target·long names·light/dark·닫기 수명주기; sign-out navigation을 sign-out 완료와 구분. |
| A12 | footer 검색 아이콘 | tab_search | S6-12 | 907 native trigger->tabsearch 내용->selection/navigation; 키보드/긴 결과/닫기 수명주기. |
| A13 | 사이드바 바탕색 회색 | sidebar_visual | S1-1 | 현재 primary의 대응 상태 1회 관찰 및 원본 같은 상태 대조; screenshot 존재만으로 클릭 동작을 승인하지 않는다. |
| A14 | 사이드바 접힘/펼침 | collapse | S1-2 | 저장 이미지의 3상태 외 현재 native transition/keyboard/short-window/first attach/재시작 확인. |
| A15 | 상단 아이콘(organizer/grid/tab search) | tidy_clear | S1-8 | Tidy success boolean은 fallback도 true라 불충분; 실제 AI group membership·duplicate 제거·last-focused 창을 확인. Clear co-se… |
| B1 | 뒤로 버튼 | history_nav | S2-1 | CDP history 호출 대신 toolbar click을 포함해 현재 native back/forward/reload effect 확인. |
| B2 | 앞으로 버튼 | history_nav | S2-1 | CDP history 호출 대신 toolbar click을 포함해 현재 native back/forward/reload effect 확인. |
| B3 | 새로고침 버튼 | history_nav | S2-1 | CDP history 호출 대신 toolbar click을 포함해 현재 native back/forward/reload effect 확인. |
| B4 | 로케이션바 `domain / title` 압축표시 | omnibox | S2-2/S2-3 | 이전 shared-label 충돌은 source 분리됨; 현재 rich autocomplete enabled+nonempty 추가텍스트를 만들어 UI 회귀 검증. |
| B5 | Ask Aside(✨ sparkles = kActionAskAside) | ask_route | S2-4 | 마지막 route-fix 빌드 이후 실제 버튼 click->render가 HANDOFF에서 미완료. URL 존재만으로 통과 금지. |
| B6 | 우측 key 아이콘 | password_action | S2-5 | payload/service worker 존재 이후 실제 native toolbar action 렌더·클릭·popup readback 필요. |
| B7 | 우측 card 아이콘(📋) | agent_action | S2-6 | B7의 모호한 아이콘 이름을 real action identity와 원본에 먼저 연결하고 실제 sidePanel route/내용 확인. |
| B8 | 옴니박스 무테두리/flat 배경 | omnibox | S2-2/S2-3 | 이전 shared-label 충돌은 source 분리됨; 현재 rich autocomplete enabled+nonempty 추가텍스트를 만들어 UI 회귀 검증. |
| B9 | star 없음 | omnibox | S2-2/S2-3 | 이전 shared-label 충돌은 source 분리됨; 현재 rich autocomplete enabled+nonempty 추가텍스트를 만들어 UI 회귀 검증. |
| C1 | 프로필 메뉴(footer) 항목·색 | profile_menu | S1-7 | 수정된 메뉴 실제 render+hit target·long names·light/dark·닫기 수명주기; sign-out navigation을 sign-out 완료와 구분. |
| C2 | 프로필 전환기(footer 아바타→메뉴) | profile_switch | S6-14 | 실제 profile 생성/전환/재조회; async load 실패·창 닫힘·교차 callback; getProfiles만으로 통과 금지. |
| C3 | 탭 검색 버블(tabsearch) | tab_search | S6-12 | 907 native trigger->tabsearch 내용->selection/navigation; 키보드/긴 결과/닫기 수명주기. |
| C4 | 탭 컨텍스트 메뉴(표준 크로미움) | tab_context | S3-1 | 공통 Chromium source 존재와 별개로 Aside vertical row hit target/disabled state/반복split 방어 확인. |
| C5 | 페이지 컨텍스트 메뉴("Aside Browsing Agent" 서브메뉴) | page_context | S3-1 | 메뉴 표시만 확인한 기존 기록을 effect 검증으로 승계하지 않기; 각 실제 original 메뉴 action inventory 필요. |
| C6 | 북마크 매니저(표준 크로미움) | bookmarks | S3-2 | 실제 native CRUD+model persistence; 관리정책·중첩cycle·취소·pending callback invalidation은 fixture에서 확인. |
| C7 | Vaults 모달(Passwords 설정 내) | vault | S2-5/S3-3 | fresh never-bound local fixture에서 검증; 기존 cloud-bound 계정의 sign_in_required branch를 우회하지 않기. Installation crypto… |
| C8 | Mini popup 플로팅 바(⌥Space) | minipopup | S3-4/S6-16 | pref roundtrip와 실제 popup workflow 분리; 현재907 native shortcut과 model response 필요. |
| C9 | Lasso 선택 메뉴 | lasso | S3-5 | Linux Alt 충돌/focus, 실제 선택·popup·fast model transform·적용을 확인; 원본 blank screenshot은 oracle로 쓰지 않는다. |
| C10 | 에이전트 탭 그룹(파란 "2 Agent Tabs") | agent_groups | S3-6 | 예전 파란 group 이미지 대신 실제 agent ownership->탭 생성/사용/정리 readback. |
| C11 | split view | split | S3-7 | 현재 native 메뉴 hit target과 pane별 effect, 프로필 왕복 보존까지 실제 검증. |
| C12 | 다크모드 전환 | theme | S3-8 | 과거906 roundtrip와 별도로 현재907 UI+restart+대응 render 확인. |
| D1 | Aside/File/Edit/View/History/Bookmarks/Profiles/Tab/Window/Help | platform_menu | S3-9 | D1 전체 기능 OK를 하나의 N/A로 통과시키지 않기; 명령별 mapping과 미구현 여부 inventory가 아직 없음. |
| E1 | General | general | S4 | 렌더 한 장으로 모든 control OK를 승인하지 않기; 변경 가능한 설정은 reload/restart readback, import/default-browser는 격리 범위에서만. |
| E2 | Appearance (+Theme/Zoom/TabStyle/Advanced/단축키) | appearance | S4 | 모든 dropdown/toggle을 control inventory로 고정하고 native effect 확인; 기존 theme 값만으로 전체 행을 닫지 않기. |
| E3 | Account (+Devices/Delete) | account | S4 | local bootstrap을 클라우드 로그인으로 대체하지 않기; 외부 로그인/기기해제/삭제는 대상 계정과 사용자 의도 확인 필요. |
| E4 | Plan & Usage | plan_usage | S4 | 외부 account entitlement readback 필요; local redirect만으로 기능 완료 또는 영구불가 판정 금지. |
| E5 | Security & Privacy (+Site settings) | privacy | S4 | 설정 저장과 브라우저 효과 각각 확인; 실제 사용자 browsing data 삭제는 이 계획의 fixture 밖. |
| E6 | Agents (+드롭다운들) | agent_settings | S4 | 각 control 저장+새/기존 session 적용 및 restart; UI dropdown 표시와 lifecycle fixture test를 E2E로 혼합하지 않기. |
| E7 | Projects (+Create) | projects | S4 | 실제 original tRPC path UI mutation->readback; current serve convenience endpoint 부재는 missing feature가 아님. |
| E8 | Models (+선택/추론레벨/Connect) | models | S4/S6-5 | source/fixture tests는 보존 통과; catalog fetch failed 해결 및 실제 request metadata를 현재907에 연결해야 함. |
| E9 | Plugins & MCPs (Skills/MCPs/Import) | skills_mcp | S4/S6-7 | 파일 개수나 testConnection toast로 완료 금지; MCP 실제 실행/설정 refresh/오류/삭제까지 확인. |
| E10 | Memory (files/Overview/History/Configure) | memory_ui | S4/S6-15 | English native ranking fixture를 UI CRUD/primary search/Korean/watcher의 대체 증거로 사용하지 않기. |
| E11 | Passwords (+AutoLock/Biometrics/Vaults) | vault | S2-5/S3-3 | fresh never-bound local fixture에서 검증; 기존 cloud-bound 계정의 sign_in_required branch를 우회하지 않기. Installation crypto… |
| E12 | Routines (+Create/Scan) | routines | S6-9 | manual Trigger now와 자동 발화 별도; original binding/model rules 유지; routineSuggestions 설정·Scan은 독립 검증. |
| E13 | Channels (Slack/Discord/Telegram) | channels | S4 | local API를 cloud-locked라 제외하지 않기; 실제 서비스 credential/user authorization은 별도 gate이며 메시지 전송은 허가된 fixture 대상만. |
| E14 | Developers (CLI/Skills/MCP/Remote) | developers | S4 | 13 fake-service tests 이후 actual daemon/browser 통합 필요; Remote requires account/plan gate, CLI와 혼합해 전체 pass 금지. |
| E15 | Mini popup (Enable/Shortcut) | minipopup | S3-4/S6-16 | pref roundtrip와 실제 popup workflow 분리; 현재907 native shortcut과 model response 필요. |
| E16 | Lasso (text/lasso 선택) | lasso | S3-5 | Linux Alt 충돌/focus, 실제 선택·popup·fast model transform·적용을 확인; 원본 blank screenshot은 oracle로 쓰지 않는다. |
| E17 | Archived chats | archived | S4 | E17 cloud-locked 주장은 폐기. 실제 original sessions archive/unarchive UI path와 readback만 남음. |
| F1 | 챗 사이드패널(sidepanel) | ask_route | S2-4 | 마지막 route-fix 빌드 이후 실제 버튼 click->render가 HANDOFF에서 미완료. URL 존재만으로 통과 금지. |
| F2 | 새 탭(newtab) Chats/Routines | new_tab | S1-4 | 현재 click/tab-count/navigation readback; footer 잔존 원인 수정 뒤 render 관찰. |
| F3 | 챗 상세(steps/Share/⋯메뉴) | chat_detail | S5 | 과거906 상세 화면과907 source 동일성 대신 현재 UI action별 readback; Share 외부 게시를 자동 실행하지 않기. |
| F4 | New Chat 생성 | new_chat | S1-3 | native click->route->composer는 로컬로 먼저 확인; 실제 전송/완료는 현재907 model gate와 함께 확인. |
| F5 | minipopup.html | minipopup | S3-4/S6-16 | pref roundtrip와 실제 popup workflow 분리; 현재907 native shortcut과 model response 필요. |
| F6 | notification.html(빈 토스트 컨테이너) | notification | S5 | 현재907 실제 toast 발행/렌더/click 및 parent close/중복close; 외부 notification 연동은 별도. |
| F7 | tabsearch.html | tab_search | S6-12 | 907 native trigger->tabsearch 내용->selection/navigation; 키보드/긴 결과/닫기 수명주기. |
| F8 | account-password.html(로그인 게이트) | account_password | S5 | F8은 계정 암호 설정/link/repair 화면이며 PWM unlock은 E11/G14에서 검증. localBootstrap query와 backup 후 setupLocalBootstrap mut… |
| F9 | tab-preview-player | preview_player | S5 | candidate Unexpected end of JSON input의 producer/empty-payload 조건을 좁혀 수정 후 실제 renderer 관찰. |
| G1 | 에이전트 태스크 실행(run/stop/steer/continue) | agent_lifecycle | S6-1 | 906 trace 및 idle shutdown pass를907 active-run/pipe/복구 E2E로 승격하지 않기. |
| G2 | Guard 승인(suspend/allow/deny) | guard | S6-2 | native UI 표시/입력과 실제 제한 행동 결과를 모두 확인; mock resolver pass 또는 API answer만으로 전체 UX 통과 금지. |
| G3 | Tools: repl(브라우징) | tool_repl | S6-3 | 906 Example Domain 기록 대신 동일 최종907 구성에서 재실행; compound task 품질은 별도. |
| G4 | Tools: bash | tool_bash | S6-3 | 기존 pass 문자열 대신 현재907 실제 도구 경로/오류 전달 확인. |
| G5 | Tools: webfetch | tool_fetch | S6-3 | 현재907 HTTP 요청/결과 raw 필요. |
| G6 | Tools: memory_search(어휘 FTS) | lexical_memory | S6-15 | 907 fallback을 native semantic 성공으로 보고하지 않기; 오래된906 lexical 결과는 baseline. |
| G7 | Tools: read/write file | tool_files | S6-3 | 907 실제 agent 경로 검증; fixture file만 사용. |
| G8 | Tools: websearch | tool_search | S6-3 | 단순 label 대신907 실제 backend/evidence lineage; 외부 검색은 root 소유 budget에서 실행. |
| G9 | Tools: subagent | subagent | S6-3 | 906 SUBAGENT_OK_42 trace 대신907 현재 구성 실행; spawn 요청만으로 통과 금지. |
| G10 | 챗 세션 list/messages | session_read | S6-4 | 실제907 created session으로 UI/API reconciliation; 최근 항목 화면만으로 messages completeness 승인 금지. |
| G10b | 챗 rename/archive/project | session_manage | S5 | serve 편의 route 부재는 기능 부재가 아님. 과거 세 skipped atom을 실제907 UI readback으로 닫기. |
| G11 | 모델 선택/추론레벨 | models | S4/S6-5 | source/fixture tests는 보존 통과; catalog fetch failed 해결 및 실제 request metadata를 현재907에 연결해야 함. |
| G12 | 스킬 로드/사용(50개 존재) | skill_use | S6-6 | 기존50개 존재/count와 별개로 실제 load/use를 확인; prior skip는 나중 raw read trace와 조건별로 구분. |
| G13 | MCP 서버 연결 | skills_mcp | S4/S6-7 | 파일 개수나 testConnection toast로 완료 금지; MCP 실제 실행/설정 refresh/오류/삭제까지 확인. |
| G14 | 비번 금고 저장/언락/자동채움 | vault | S2-5/S3-3 | fresh never-bound local fixture에서 검증; 기존 cloud-bound 계정의 sign_in_required branch를 우회하지 않기. Installation crypto… |
| G15 | 루틴 생성/스케줄 실행 | routines | S6-9 | manual Trigger now와 자동 발화 별도; original binding/model rules 유지; routineSuggestions 설정·Scan은 독립 검증. |
| G16 | Mini popup 실행(⌥Space) | minipopup | S3-4/S6-16 | pref roundtrip와 실제 popup workflow 분리; 현재907 native shortcut과 model response 필요. |
| G17 | Lasso 실행 | lasso | S3-5 | Linux Alt 충돌/focus, 실제 선택·popup·fast model transform·적용을 확인; 원본 blank screenshot은 oracle로 쓰지 않는다. |
| G18 | 네이티브 탭 open/close/nav(CDP) | native_tabs | S6-13 | 대상 목록만으로 동작 승인 금지; actual tab management path와 profile context를 맞춤. |
| G19 | 네이티브 back/forward | history_nav | S2-1 | CDP history 호출 대신 toolbar click을 포함해 현재 native back/forward/reload effect 확인. |
| G20 | split view 실행 | split | S3-7 | 현재 native 메뉴 hit target과 pane별 effect, 프로필 왕복 보존까지 실제 검증. |
| G21 | 탭 그룹 생성 | agent_groups | S3-6 | 예전 파란 group 이미지 대신 실제 agent ownership->탭 생성/사용/정리 readback. |
| G22 | 북마크 추가/관리(사이드바 드래그) | bookmark_drag | S1-6 | drag 코드·독립 source review 후 실제 Linux pointer path, only-tab/multi/group/split, 스크롤 경계, >40행을 검증. |
| G23 | 프로필 전환/추가(getProfiles OK) | profile_switch | S6-14 | 실제 profile 생성/전환/재조회; async load 실패·창 닫힘·교차 callback; getProfiles만으로 통과 금지. |
| G24 | 옴니박스 자동완성(5 매치) | omnibox | S2-2/S2-3 | 이전 shared-label 충돌은 source 분리됨; 현재 rich autocomplete enabled+nonempty 추가텍스트를 만들어 UI 회귀 검증. |
| G25 | 테마 전환(light/dark 라운드트립) | theme | S3-8 | 과거906 roundtrip와 별도로 현재907 UI+restart+대응 render 확인. |
| G26 | Memory 어휘검색(memory_search) | lexical_memory | S6-15 | 907 fallback을 native semantic 성공으로 보고하지 않기; 오래된906 lexical 결과는 baseline. |
| G26b | Memory 시맨틱(moss 임베딩) | semantic_memory | S6-15 | English6 ranks1,1,1,2,1,1은 scoped evidence; primary native-pending 미종결. symlinked shared knowledge는 원본 travers… |

## 7. 실행 순서·보고

1. 시작 전: `git rev-parse HEAD`, chrome sha(`sha256sum /home/hoon/chromium/src/out/aside/chrome | cut -c1-16`), `/health` 결과, 사용자 승인 시각을 `run.json`에 적는다.
2. 순서: S0 → S6-16·S6-12(오늘 수정 재확인) → S6-1·S6-2(핵심) → S7 → S3-4 → S2-5 → 나머지 S1~S5 → S8. 격리 인스턴스로 되는 것(S3-4 껍데기, S6-12 껍데기)은 먼저 돌려 두고, 실 인스턴스 시간은 데몬이 필요한 것에 쓴다.
3. 결함을 만나면: 재현 3회, 근거 저장, `docs/progress-log-2026-09-09.md`에 한 줄, 그 자리에서 고치지 않는다(원칙 3). 브라우저가 죽으면 즉시 사용자에게 알리고 `run-fork.sh`로 복구한다.
4. 보고서 `data/artifacts/real-use-test-<YYYYMMDD>/REPORT.md`: 시나리오별 판정 표 → 결함 목록(재현 절차·근거 경로·원본 대비) → `BLOCKED_EXTERNAL`/`ORIGINAL_UNKNOWN` 목록 → 91-row 갱신안(`newExecutionEvidence`에 넣을 문장). 결론 먼저, 숫자는 절대값+비율.
5. 마지막에 `NEXT_SESSION.md`의 "살아 있는 프로세스"와 진행 일지를 갱신하고 커밋한다(`Co-Authored-By` 규칙은 세션 안내 따름).

## 8. 하지 말 것

- 데몬 번들·확장 리소스 수정, 포크에 새 구조 추가.
- 사용자 승인 없는 재기동·프로필 삭제·실제 자격증명 입력.
- 스텁·모의 응답으로 PASS. 로그 한 줄로 PASS. 캡처 한 장으로 여러 컨트롤 PASS.
- 보고서에 오류 원문·스택 전체 붙여넣기(파일로만).
