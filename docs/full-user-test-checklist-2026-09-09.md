# Aside(포크)·Belmont 전수 실사용 검증 체크리스트 — "테스터 = 사용자 본인"

작성 2026-09-09 22:30 KST. 이 문서는 **사용자 본인이 매일 쓰듯이** 모든 기능·버튼·명령·흐름을 끝까지 눌러 보라는 지시서다. 이전 계획서(`docs/real-use-test-plan-2026-09-09.md`)는 시나리오 골격이고, 이 문서는 그 위에 **전수 목록**과 **사용자 페르소나**, **실제 키 입력이 되는 환경 절차**를 얹은 완성판이다. 부록 `docs/full-user-test-inventory-2026-09-09.md`에 화면별 **모든 컨트롤 문구 목록**(확장 2,109개 + 네이티브 137개 + 비밀번호 관리자)이 체크박스로 있다. 부록의 항목 하나라도 안 눌러 봤으면 끝난 게 아니다.

진행 기록은 `docs/progress-log-2026-09-09.md`(한 줄씩, 맨 아래가 최신)와 `data/artifacts/full-user-test-<YYYYMMDD>/`에 남긴다.

---

## 0. 테스터는 이 사람이다 (페르소나)

- 한국어 사용자. Aside를 **기본 브라우저**로 하루 종일 쓴다. 네이버·유튜브·쿠팡·구글·GitHub·Gmail을 오간다.
- 브라우저 에이전트에게 실제 심부름을 시킨다: "오늘 IT 뉴스 3개 표로", "이 상품 3곳 가격 비교", "이 페이지 요약해서 메모리에 저장", "매일 아침 9시에 날씨·일정 브리핑 루틴".
- 메모리에 개인 사실을 쌓고 다음 날 회상되길 기대한다. 프로젝트별로 채팅을 정리한다.
- 비밀번호 관리자에 **테스트 사이트** 계정을 저장하고 자동채움을 쓴다(실제 계정은 절대 안 씀).
- 미니 팝업(Alt+Space)으로 아무 데서나 빠르게 묻고, 탭이 30개 넘으면 탭 검색으로 찾는다.
- Belmont 데스크톱과 폰(PWA)에서 같은 봇에게 "브라우저로 …" 작업을 시키고 결과를 받는다.
- 성격: 참을성 없음. 3초 넘게 반응 없으면 다시 누른다. 창을 갑자기 닫는다. 재기동 후 어제 상태가 그대로이길 바란다. **원본 Aside(Windows 설치본)를 써 본 사람이라 다른 점을 바로 알아챈다.**

테스터는 이 사람이 되어, 매 항목에서 "내가 이걸 눌렀을 때 원본이었다면 무엇이 보였을까"를 기준으로 판정한다.

## 1. 절대 규칙

1. **실제 클릭·키 입력**으로만 판정한다. 페이지 안 CDP 입력은 "실제 키가 안 되는 항목"에서만 보조로 쓰고 판정 라벨에 `CDP_ASSISTED`를 붙인다.
2. 기대 결과는 **원본 Aside**다. 모르면 `ORIGINAL_UNKNOWN`으로 두고 추측 PASS 금지. 원본 리소스는 `C:\Users\HOON\Desktop\Aside-원본-최신\`(확장 JS·HTML·아이콘은 참고 가능, 바이너리는 실행 불가).
3. 결함은 **고치지 않는다**. 재현 3회 + 근거만. 데몬 번들·확장 리소스는 원본이라 절대 수정 금지.
4. 사용자 데이터 보호: §2의 **상태 복사본**에서만 파괴적 조작. 실제 계정·카드·비밀번호 입력 금지. 캡처에 개인정보가 보이면 폐기.
5. 프로세스를 멈추거나 재기동할 때는 사용자에게 알린다. 점검 창(§2) 안에서는 자유.
6. 보고 표현은 평이하게(강제 종료·우회·주입·덤프 같은 단어 금지). 오류 원문·스택은 파일로만.
7. 한 컨트롤 = 한 판정. 캡처 한 장으로 여러 컨트롤 PASS 금지. 로그 한 줄로 PASS 금지.

## 2. 환경: 실제 키 입력이 되는 점검 창 절차 (필수)

살아 있는 사용자 화면(WSLg `:0`)에는 xdotool 키·마우스가 **전달되지 않는다**(2026-09-09 후속 검증에서 확인, `data/artifacts/real-use-test-20260909/FINDING-live-input-blocked.md`). 데몬 포트(21420)는 확장에 고정돼 두 번째 데몬을 동시에 못 띄운다. 그래서 **전체 스택을 Xvfb에 띄우는 점검 창**이 필요하다.

### 2.1 사전 사실

| 항목 | 값 |
|---|---|
| 저장소 | `/home/hoon/_roots/labs/work/Belmont` |
| Node | `/home/hoon/.local/share/mise/installs/node/26.5.0/bin/node` |
| 포크 바이너리 | `/home/hoon/chromium/src/out/aside/chrome` (`sha256sum … | cut -c1-16`으로 기록, 2026-09-09 저녁 기준 37528b8c) |
| Aside 실행 스크립트 | `belmont-browse/run-fork.sh` (env: `BELMONT_BROWSE_DISPLAY`, `BELMONT_BROWSE_STATE_DIR`, `BELMONT_BROWSE_CHROME_LOG`, `BELMONT_BROWSE_PORT`(9340), `BELMONT_BROWSE_CDP_PORT`(9333)) |
| 사용자 상태 | `belmont-browse/.state/` (chrome-profile, aside-home-907, serve.json) |
| 상태 API | `http://127.0.0.1:9340/health`, `/aside/sessions` (토큰 `serve.json`) |
| 페이지 읽기(보조) | `http://127.0.0.1:9333/json` |
| Belmont 호스트 | tmux `belmont-bot`: `SAND_ASIDE_BROWSE=1 npm run wsl:start` (프로필 `BELMONT_WSL_PROFILE`로 바꿀 수 있음, 기본 `.cache/belmont-wsl-profile`) |
| 모바일 PWA | `http://127.0.0.1:4188` (tmux `orca-mobile-wsl`), 화면: Home/Chat/Computer/NewBot/Onboarding/Settings/WindowsDesktop |
| 캡처·입력 도구 | `Xvfb`, `xdotool`, `import`(ImageMagick), `scrot` |

### 2.2 점검 창 열기 (사용자 승인 시각 안에서)

```bash
cd /home/hoon/_roots/labs/work/Belmont
# 1) 사용자 Aside 멈춤 (열린 탭이 닫힌다고 알린 뒤)
P=$(python3 -c "import json;print(json.load(open('belmont-browse/.state/serve.json'))['pid'])"); kill -TERM $P; sleep 8; ps -p $P || echo stopped
# 2) 상태 복사본 (실제 데이터는 손대지 않는다)
rm -rf /tmp/aside-test-state && cp -a belmont-browse/.state /tmp/aside-test-state && rm -f /tmp/aside-test-state/chrome-profile/Singleton* /tmp/aside-test-state/serve.json
# 3) 가상 화면 (WM 없음: 창 활성화는 xdotool windowfocus 사용)
Xvfb :97 -screen 0 1440x900x24 -nolisten tcp & sleep 2
# 4) 전체 스택(데몬+브라우저) 복사본으로 기동
cd belmont-browse && setsid nohup env BELMONT_BROWSE_STATE_DIR=/tmp/aside-test-state BELMONT_BROWSE_DISPLAY=:97 BELMONT_BROWSE_CHROME_LOG=/tmp/aside-test-chrome.log bash run-fork.sh > /tmp/aside-test-serve.log 2>&1 < /dev/null & cd ..
# 5) 준비 확인: "[engine] ... real extension" · "[memory] semantic search ready" · health ready:true browser.alive:true
sleep 15; grep -E 'real extension|semantic|listening' /tmp/aside-test-serve.log; TOK=$(python3 -c "import json;print(json.load(open('/tmp/aside-test-state/serve.json'))['token'])"); curl -s -H "Authorization: Bearer $TOK" http://127.0.0.1:9340/health
```

이제 `DISPLAY=:97 xdotool key ...`, `import -display :97 -window root shot.png`가 **진짜 키·마우스·화면**이다. 모델 호출(gpt-5.5)도 실제로 나간다(비용 발생).

Belmont까지 같이 볼 때(S12): tmux `belmont-bot`을 멈추고(`tmux send-keys -t belmont-bot C-c`), `cp -a .cache/belmont-wsl-profile /tmp/belmont-test-profile`, `DISPLAY=:97 BELMONT_WSL_PROFILE=/tmp/belmont-test-profile SAND_ASIDE_BROWSE=1 npm run wsl:start`. Electron이 가상 화면에서 안 뜨면 `ELECTRON_DISABLE_GPU=1`·`--disable-gpu`를 시도하고, 그래도 안 되면 S12는 사용자 손 방식(§2.4)으로.

### 2.3 점검 창 닫기 (반드시)

```bash
P=$(python3 -c "import json;print(json.load(open('/tmp/aside-test-state/serve.json'))['pid'])"); kill -TERM $P; sleep 8
for p in $(pgrep -f 'Xvfb :97'); do kill $p; done
# 사용자 Aside 복구
cd belmont-browse && setsid nohup env BELMONT_BROWSE_DISPLAY=:0 bash run-fork.sh > ../data/artifacts/aside-remaining-closure-20260908/logs/primary-relaunch-$(date -u +%Y%m%dT%H%MZ)-serve.log 2>&1 < /dev/null & cd ..
# Belmont 호스트도 멈췄다면: tmux new-session -d -s belmont-bot -c $PWD 'SAND_ASIDE_BROWSE=1 npm run wsl:start'
```
복사본 `/tmp/aside-test-state`는 근거로 필요한 로그(`aside-home-907/logs`)만 `data/artifacts/full-user-test-<날짜>/state-logs/`로 옮기고 나머지는 지운다(비밀번호 금고 파일 포함이므로 남기지 않는다).

### 2.4 대체: 사용자 손 + 모델 관찰

사용자가 `:0`에서 직접 누르고, 모델은 `/health`·`/aside/sessions`·데몬 로그·`import -display :0 -window <창id>`(사용자 승인)로 판정만 한다. 항목마다 "지금 X를 눌러 주세요 → 무엇이 보였나요"를 한 번에 하나씩.

## 3. 판정·근거

라벨: `PASS` · `PASS(CDP_ASSISTED)` · `FAIL` · `DIFFERS_FROM_ORIGINAL` · `ORIGINAL_UNKNOWN` · `BLOCKED_EXTERNAL` · `UNREACHABLE_CURRENT_BUILD` · `HARNESS_DEFECT` · `NOT_APPLICABLE`(리눅스에 없는 항목, 근거 필수).

PASS 조건(전부): 실제 입력 기록 · 전후 캡처 · 실제 효과(재열기/파일/기록/API readback) · 같은 빌드·프로필 · FATAL 0.

저장: `data/artifacts/full-user-test-<YYYYMMDD>/<섹션>/<항목ID>/{steps.jsonl, before.png, after.png, log.txt}`. 결과 표는 `RESULTS.md`(항목ID·라벨·한 줄 근거). 결함은 `FINDINGS.md`(재현 3회·근거 경로·원본 대비·사망 반경).

## 4. 전수 체크리스트

각 표의 행은 **한 컨트롤 또는 한 흐름**이다. `ID`는 보고서에서 그대로 쓴다. 표에 없는 문구가 화면에 보이면 부록에서 찾아 그 행으로 기록한다. 부록에도 없으면 새 행을 만들고 `NEW`라고 표시한다.

### S1. 처음 켜기·온보딩·로그인 게이트

| ID | 컨트롤/흐름 | 사용자 행동 | 기대(원본) | 확인 |
|---|---|---|---|---|
| S1-01 | 콜드 스타트 | 점검 창 기동 | 30초 내 창·사이드바·확장 등록 | serve 로그, health |
| S1-02 | 온보딩(Welcome to Aside / Start onboarding / Get started / Set Aside as your default browser / Help improve Aside) | 새 프로필(`New profile`)로 온보딩을 처음부터 | 각 단계 넘어가고 마지막에 브라우징 시작 | 캡처 단계별 |
| S1-03 | 로그인 게이트(account-password.html: Sign in to Aside / Email / Verification code / Forgot password) | 화면 도달·입력 검증만 | 클라우드 로그인은 `BLOCKED_EXTERNAL`, 로컬 부트스트랩으로 대체 금지 | 캡처 |
| S1-04 | 계정 암호 설정/복구(Set up an account password / Enter your recovery key / Reset your account password) | 화면 도달·검증 메시지 | 원본 문구·검증 규칙 | 캡처 |
| S1-05 | 재기동 후 복원 | 탭 5개·채팅 3개·루틴 1개 만들고 재기동 | 전부 그대로, 답변 대기 작업 자동 재개 | `/aside/sessions`, `[lifecycle]` 로그 |
| S1-06 | 창 닫기로 종료 | 마지막 창 X | 데몬까지 종료, 5초 내 프로세스 없음 | `ps` |

### S2. 사이드바(세로 스트립) — 네이티브

| ID | 컨트롤 | 행동 | 기대 | 확인 |
|---|---|---|---|---|
| S2-01 | 접기/펼치기 버튼(좌상단) | 클릭, 단축키(Appearance→Toggle Sidebar) | 접힘/펼침, 재기동 유지 | 캡처 |
| S2-02 | 상단 아이콘 3개(organizer/grid/tab search) | 각각 클릭 | organizer: `Organize tabs with AI`(Tidy) 실행 → 실제 그룹 생성; grid: 탭 그리드; tab search: S8 | 결과 탭 모델 |
| S2-03 | Bookmarks 섹션 헤더·꺾쇠 | 클릭 | 섹션 접힘/펼침 | 캡처 |
| S2-04 | `Drag tabs here to add bookmarks` | 탭 행을 드래그해 놓기 | 북마크 생성 | 재열기 |
| S2-05 | 북마크 행 우클릭(Edit Bookmark / Rename / Delete Bookmark / Remove bookmark / Open in new tab / Open in new window / Open in Incognito window / Open in split view / Open in new tab group / Add to bookmarks / Delete Folder / Rename Folder / Folder name / Manage Bookmarks / Bookmark All Tabs…) | 각 항목 실행 | 각 효과, 확인 대화상자(`Delete this bookmark?`, `Delete this folder and everything inside it?`) | 재열기 |
| S2-06 | Chats 섹션: `New Chat` | 클릭 | 사이드패널 composer | 캡처 |
| S2-07 | 채팅 행 클릭/우클릭(Rename chat / New chat name / Bookmark chat / Archive Chat / Archive session? / Archive all chats(?) / Copy session ID → `Session ID Copied!` / Delete / Show all chats) | 각각 | 효과 + 확인 대화상자 문구 | `/aside/sessions` |
| S2-08 | 채팅 상태 배지(Awaiting answer / Awaiting approval / Paused / Failed / Cancelled / Untitled task) | 해당 상태 만들기 | 배지 정확 | 캡처 |
| S2-09 | Tabs 섹션: `New Tab` | 클릭 | 새 탭 페이지 | |
| S2-10 | 탭 행(favicon·제목·X), 선택 카드, 가운데 클릭, 드래그 순서, 핀(`Remove from pin`) | 탭 30개로 | 원본과 같은 시각·동작 | 캡처+탭 모델 |
| S2-11 | 탭 우클릭 메뉴(Open in new window / Open in split view / Open in new tab group / Create split view / Group All Tabs / Bookmark this tab / Close / Close all / Reopen Closed Tab / Name Window…) | 각각 | 효과 | 탭 모델 |
| S2-12 | 에이전트 탭 그룹(`Agent Tabs` / `Tabs controlled by Aside while it works` / `Background tabs Aside opened` / `Configure auto close`) | 에이전트 작업 중·후 | 파란 그룹, 작업 후 자동 정리(Agents 설정 `Clean up agent tabs` 시간) | 캡처+시간 |
| S2-13 | footer 아바타 → 프로필 메뉴(Profile actions / Current profile / Switch to … / Edit profile / Profile name / Change icon / New profile / Delete profile? / Sign Out / Sign-in paused / Settings / Downloads / History / Extensions / Task Manager / Performance / Developer tools / Remote debugging / Review App Update) | 각 항목 | 각 화면 열림·효과. `Delete profile?`는 복사본에서만 | 캡처 |
| S2-14 | footer 꺾쇠, 검색 아이콘 | 클릭 | 메뉴 / 탭 검색 | |
| S2-15 | 다크모드에서 S2 전체 반복 | Appearance→Dark | 색·대비 원본 | 캡처 |
| S2-16 | `Show Tabs Horizontally`(Appearance Tab style San Francisco) | 전환 | 가로 탭바로 바뀜, 사이드바 내용 유지 | 캡처 |

### S3. 툴바·주소창·툴바 액션

| ID | 컨트롤 | 행동 | 기대 | 확인 |
|---|---|---|---|---|
| S3-01 | 뒤로/앞으로/새로고침 | 사이트 3개 방문 후 클릭·길게 누르기(히스토리 목록) | 이동, 목록 | URL readback |
| S3-02 | 주소창 `domain \| title` 표시 | 긴 제목·한글·http·about:·chrome:// | 압축 표시 규칙 원본과 동일 | 캡처 |
| S3-03 | 주소창 입력·자동완성(5 매치)·`Ctrl + Enter for AI Mode` | 두 글자 입력, 방향키, Enter, Ctrl+Enter | 검색 / AI 모드(Ask)로 분기 | 결과 탭·세션 |
| S3-04 | 사이트 정보(ⓘ) 버튼 | 클릭 | 권한 패널 | 캡처 |
| S3-05 | `Ask Aside`(✨) 버튼 | 클릭 | 사이드패널, 현재 탭 맥락 | 세션 생성 |
| S3-06 | 비밀번호 관리자 아이콘 / Ctrl+Shift+Y | 클릭·키 | 팝업 600x432 아이콘 아래(원본 크기·위치 `ORIGINAL_UNKNOWN` — 원본 캡처 있으면 대조) | 캡처 |
| S3-07 | 확장 아이콘(퍼즐) 메뉴(Extensions / Installed extensions / Manage all extensions / Manage extension / Extension settings / Import extensions / No installed extensions) | 각 항목 | 효과 | |
| S3-08 | 우측 카드 아이콘(agent_action) | 클릭 | 원본과 같은 것이 열리는가(`ORIGINAL_UNKNOWN`) | 캡처 |
| S3-09 | `+`(새 탭/새 작업) | 클릭 | 새 탭 | |
| S3-10 | 다운로드 표시(Downloads / Show all downloads / No recent downloads) | 파일 하나 내려받기 | 표시·목록 | |
| S3-11 | 알림(Get notifications instantly… / Mark as read / Mark all as read) | 작업 완료 후 | 알림 배지·읽음 처리 | |

### S4. 새 탭 페이지(newtab.html)

| ID | 컨트롤 | 행동 | 기대 |
|---|---|---|---|
| S4-01 | `Search or type a URL` + `Search`/`Ask` 토글 + `Tab to switch` | 검색어→Enter, Ask→Enter, Tab으로 전환 | 검색 탭 / 새 채팅 |
| S4-02 | Chats·Routines 목록 | 항목 클릭 | 해당 채팅/루틴 열림 |
| S4-03 | New tab mode 설정(General→Open new tabs in Search or Ask) | 바꾸고 새 탭 | 기본 모드 반영 |

### S5. 채팅·작업 화면 (사이드패널 / main.html)

| ID | 컨트롤 | 행동 | 기대 |
|---|---|---|---|
| S5-01 | composer: 입력, Enter 전송, Shift+Enter 줄바꿈, `Send message`, `Dictate`, `Upload photos & file`, `Attach folder`, `Incognito mode`(메모리 미사용) | 각각 | 전송/첨부/모드 표시 |
| S5-02 | 모델 선택(Fast / Standard / Deep / Visual, Search models, Reasoning, Speed) | 바꾸고 전송 | 데몬 로그에 그 모델로 요청 |
| S5-03 | 권한(Allow / Ask / Deny), Guard 기본 | 각 모드로 같은 작업 | Ask/Guard에서 승인창(`Allow Aside to do this action?` / Custom answer / Cancel / Copy diff) 실제 발화 → allow/deny 결과 |
| S5-04 | 실행 중: `Stop`, `Steer`, `Send now`, `Send message at the next tool call`, `Clear queue`, Queue paused because you interrupted, `Interrupted - What should Aside do instead?` | 긴 작업 중 각각 | 원본 동작(중단·조향·큐) |
| S5-05 | 메시지 메뉴: Copy / Edit / Edit message / Branch / Branched from / Delete / Copy file / Copy path / Open with… | 각각 | 효과 |
| S5-06 | Todos / Subagents / Running / Completed / Outputs / Output artifacts / Streaming / Todo list / Switch to tab | 복합 작업으로 유도 | 패널 표시·전환 |
| S5-07 | 채팅 ⋯ 메뉴: Rename / Rename chat / Archive / Archive chat? / Delete / Delete chat? / Copy session ID / Send feedback / Share(Don't share / Anyone with the link) / Remove from project / Start a new project / Filter projects… | 각각 | Share는 클라우드 → `BLOCKED_EXTERNAL` 상태만 |
| S5-08 | utils: Clear / Clear chat? / Compact(Summarize this chat) / Feedback / New | 각각 | 효과 |
| S5-09 | 오류 상태(Task was aborted / Request rate limited / Model tool call failed / usage limit / out of credits / Disk full / Reconnect) | 유도 가능한 것만(예: 네트워크 끊김) | 정직한 문구·복구 |
| S5-10 | 첨부 미리보기(Loading preview / No rows to preview / text preview) | CSV·이미지 첨부 | 표시 |
| S5-11 | `Memory updated` 배지, `Sent via routine`, `System Notification`, `Agent self reviewed.` | 해당 상황 | 표시 |
| S5-12 | 탭 전환 시 세션 따라가기(Ask Aside on tab switch: New chat per tab / Keep current chat) | 설정 두 값 | 동작 차이 |
| S5-13 | 제목 자동 생성, 목록 정렬(Newest first / Oldest first), List/Card 보기, Search.. | 각각 | 효과 |

### S6. 설정(Settings) — 17페이지, 컨트롤 전수

각 페이지: ① 부록의 그 페이지 문구 전부를 화면에서 찾는다 ② 바꿀 수 있는 컨트롤은 바꾼다 → 효과 → 재기동 후 유지 ③ 드롭다운은 모든 값.

| ID | 페이지 | 핵심 확인 |
|---|---|---|
| S6-01 | General: Preferred languages, Default search engine, New tab mode(Search/Ask), Auto Picture-in-Picture, Screenshot, Spell check, Set as default, Check for updates, Background service, Import bookmarks / Import from another browser(Detected browser·No browsers found·Import complete.) | 각 저장·효과 |
| S6-02 | Appearance: Theme(System/Light/Dark), Tab style(San Francisco 가로 / New York 세로), Shrink tabs to fit, Zoom level, Customize sidebar(Chats/Bookmarks), Tab switcher order(Recently used/Tab order), Keyboard shortcuts(Toggle Sidebar / Ask Aside / New Task / Copy URL / Split tab / Split tab alternate), Extension shortcuts | 단축키 실제 키로 확인 |
| S6-03 | Account: Profile(Avatar / Your name / Email), Devices, Sync, Sign out device, Delete account | 클라우드 → 상태 기록, 삭제 금지 |
| S6-04 | Plan & Usage / Billing: Plan, Credits, Buy credits, Auto-reload, Billing portal, Download CSV | `BLOCKED_EXTERNAL` 상태 기록 |
| S6-05 | Security & Privacy: Delete browsing data(Period 6종 × Items 6종), Site settings, Ads privacy, Allow third-party cookies(Allow/Block all), Help improve Aside, View browsing history | 복사본에서 실제 삭제 효과 |
| S6-06 | Agents: Tool permissions(Allow/Ask/Deny), Completion sound(Preview/Change/Reset), Agent runtime(Current version), Clean up agent tabs(After 5 min…2 hours), Task notifications(Needs attention/Task completions/Routine completions), Follow-up behavior(Queue/Steer), Sandbox(Enable/Disable sandbox?), File permissions(Project root/Add/Remove file root?), Ask Aside on tab switch | 각 값이 S5 동작에 반영 |
| S6-07 | Projects: Create, 프로젝트 화면(Working directory / Instruction / AGENTS.md / Files / Add a file / Chats / Routines / Personalize / icon·color / archived) | 채팅·루틴 소속 |
| S6-08 | Models: Providers(catalog 전부: Aside/Anthropic/OpenAI/ChatGPT/Grok/…/Ollama/LM Studio/Add custom provider), Connect(API Key / Base URL / Authorization code), Task models(Fast/Standard/Deep/Visual), Default model, Reasoning, Speed, Set models, Disconnect, Reauthenticate | 사용 중인 ChatGPT 연결 유지; 다른 공급자는 UI 검증만 |
| S6-09 | Plugins & MCPs: Skills(My Skills / Built-in Skills / Create new skill / Import / Edit skill / Delete / Copy to customize), MCPs(Servers / Presets(Notion·Linear·PostHog·Sentry·Atlassian·Granola) / Transport(Local stdio·Streamable HTTP) / Command / Env / URL / Authentication / Headers / Test connection / View tools / Refresh tools) | MCP 하나 실제 연결·도구 호출 |
| S6-10 | Memory: Memory files / Overview / History(Dream now / Revert / Open session / Trigger·Duration·Model·Tokens·Cache·Cost) / Configure, Statistics(Total Sessions…Activity heatmap), Context Awareness(Enable / Capture / Capture typed text / Retention / Summary model / Never observe / Clear all…) | 파일 추가·삭제·검색, 회상(S9) |
| S6-11 | Passwords: Use Aside as my password manager(Disable default password manager? / Reload tabs), Account password, AutoLock(Never…), Biometrics, Vaults, Export(Format CSV/JSON/1Password/Browser; passwords/notes/2FA), Import(Apple Passwords/Bitwarden/Proton Pass/Dashlane/LastPass/Chrome/Firefox/Edge/CSV), Access policy for AI agents | 테스트 금고만 |
| S6-12 | Routines: My routines / Create / Scan / Suggestions / Scan automatically / Frequency(Weekly/Monthly…) / Schedule(Once/Hourly/Daily/Weekly/Custom, Days, Time, Run at) / Trigger(Push message received, Event source) | S10 |
| S6-13 | Channels: Slack/Telegram/Discord(Bot Token / App Token / Application ID / Public Key / Manual setup / Ask Aside to set it up / Pairing / Access(Paired people only/Everyone) / Chat behavior / Follow-up / Disconnect) | 토큰 없으면 입력 검증만 |
| S6-14 | Developers: Aside CLI(Copy command, Codex/Claude Code/Cursor/OpenCode), Aside Skills(Add skill to… / Download / Install to all agents), Enable Aside MCP server, Remote Control(PRO) | CLI 명령 실제 실행(S11) |
| S6-15 | Mini popup: Enable, Shortcut(변경 → 실제 키) | S7 |
| S6-16 | Lasso: Enable on text selection / Enable on lasso selection(Press Option twice…) / Actions(Summarize / Translate / Copy code / Search image / Open URL / Prompt / Add shortcut) | 리눅스 키 매핑 확인 |
| S6-17 | Archived chats: Unarchive / Delete / Retry | 왕복 |
| S6-18 | Communications(Gmail/Slack/LinkedIn/Discord/Telegram/WhatsApp, Allow sending, Ask before sending, Follow up, Match my tone, Custom instructions), Payment Use(Cards / Allow payments / Auto-approve under / Spending limit / Period), Experimental(Onboarding / Features / Detect tools / Sync / KakaoTalk) | 외부 연결 없이 UI·저장 검증, 결제는 카드 추가 금지 |
| S6-19 | Send feedback / Join community / Invite friends / About Aside | 열림·문구 |

### S7. 미니 팝업 (Alt+Space)

| ID | 컨트롤 | 행동 | 기대 |
|---|---|---|---|
| S7-01 | 단축키 열기/토글 숨김 | 어느 사이트에서든 | 420x220 창, 두 번째 누르면 숨김 |
| S7-02 | 질문 → 답 | "이 페이지 한 줄 요약" | 답 표시, 세션 생성 |
| S7-03 | 상태 전환(compact/expanded/attachments) | 긴 답, 첨부 | 크기 420x220→420x640/360 |
| S7-04 | Options(⋯): Fast mode / Effort / Permission / Final confirm / Developer / Disable memory extraction / Password access / Switch browser profile / Projects & permissions / Search models | 각각 | 옵션 창(frameless, 팝업 아래)·저장 |
| S7-05 | New session / Open in browser / Close / Escape / `window.close()` | 각각 | 닫힘, 브라우저 생존(오늘 수정) |
| S7-06 | Incognito mode, Upload photos & file, Attach folder | 각각 | 효과 |

### S8. 탭 검색 (Ctrl+Shift+A / footer 아이콘)

| ID | 확인 |
|---|---|
| S8-01 | 열림, `Search tabs, chats, history, bookmarks or extensions` 입력 → 섹션(Open Tabs / Recently Closed / Bookmarks / History / Extensions) 결과 |
| S8-02 | 방향키·Enter → 해당 탭 활성·창 닫힘(오늘 수정) |
| S8-03 | Escape → 닫힘. 바깥 클릭 → 닫힘 |
| S8-04 | 탭 50개·긴 제목·한글 검색 |

### S9. 메모리·컨텍스트

| ID | 흐름 | 기대 |
|---|---|---|
| S9-01 | 채팅에서 사실 3개("내 테스트 프로젝트 이름은 X" 등) → `Memory updated` → Memory files에 반영 | 파일·색인 |
| S9-02 | 재기동 → 새 세션에서 한국어로 회상 질문 | 3개 정확, 의미 검색 로그 |
| S9-03 | Memory files 편집·삭제 → 회상 안 됨 | 정직 |
| S9-04 | Incognito mode 세션에서는 메모리 미사용 | 로그로 확인 |
| S9-05 | History → Dream now → 결과·Revert | 원본 동작 |
| S9-06 | Context Awareness 켜고 브라우징 → Summaries → 관련 질문 | (원본 macOS 전용 기능이면 `NOT_APPLICABLE`) |

### S10. 루틴

| ID | 흐름 | 기대 |
|---|---|---|
| S10-01 | Create: 프롬프트·스케줄(1분)·모델·권한·브라우저 바인딩 | 저장, 목록 |
| S10-02 | 자동 발화 2회(원본 30초 tick) → Tasks에 `Sent via routine` 세션 | 시각 기록 |
| S10-03 | Trigger now / Resume first / Pause / Pause reason / Next run / Last ran | 각 상태 |
| S10-04 | 재기동 후 유지·재개 | |
| S10-05 | Delete routine?(Historical task runs stay in Tasks) | 삭제, 과거 실행 유지 |
| S10-06 | Scan(Find routines from repeated work) → Suggestions → Create/Dismiss | 원본 동작 |
| S10-07 | Heartbeat 종류(Wakes an existing chat) | 기존 채팅 재개 |
| S10-08 | Push message received 트리거 | 외부 없으면 UI만 |

### S11. 명령·단축키·CLI 전수

| ID | 명령 | 기대 |
|---|---|---|
| S11-01 | Alt+Shift+B(사이드패널), Alt+Space(미니 팝업), Ctrl+Shift+A(탭 검색), Ctrl+Shift+Y(비밀번호 관리자), Ctrl+Shift+L(자동채움), Ctrl+Shift+G(비밀번호 생성), Ctrl+Shift+\(split view), Ctrl+T/W/Shift+T, Ctrl+Enter(AI Mode), F12 | 각 효과. 충돌(리눅스 Alt) 기록 |
| S11-02 | Appearance→Keyboard shortcuts에서 바꾼 키 | 즉시 반영 |
| S11-03 | Developers→Aside CLI `Copy command` → 터미널에서 실행(Codex/Claude Code/Cursor/OpenCode 각 명령) | 원본 CLI 동작(설치·실행 결과) |
| S11-04 | Enable Aside MCP server → 외부 클라이언트에서 도구 목록 | 목록·호출 |
| S11-05 | 컨텍스트 메뉴 "Aside Browsing Agent" 하위 항목 전부 | 각 효과 |
| S11-06 | 플랫폼 메뉴(Aside/File/Edit/View/History/Bookmarks/Profiles/Tab/Window/Help) 항목 전수 | 리눅스 부재 항목은 `NOT_APPLICABLE` |

### S12. Belmont 데스크톱·모바일

| ID | 흐름 | 기대 |
|---|---|---|
| S12-01 | Belmont 채팅에서 "브라우저로 네이버 날씨 확인해" → aside-browse 하위 봇 → Aside 사이드바에 같은 세션 미러링 → 답 | 호스트 로그 `[browse-runtime]`, `/aside/sessions` |
| S12-02 | 승인·질문 카드가 Belmont에 뜨고 답이 Aside 서스펜션을 품 | |
| S12-03 | 작업 error → gpt-5.5/high 재시도·알림 | |
| S12-04 | Belmont에서 중단 → Aside도 멈춤 | |
| S12-05 | "브라우저" 봇(runtime aside-browse)에게 직접 대화 | 세션 1:1 |
| S12-06 | 호스트 재기동 후 링크 유지, 손상 시 정직한 오류 | |
| S12-07 | 모바일 PWA: Home / Chat(같은 대화) / Computer(봇 화면) / NewBot / Settings / WindowsDesktop 각 화면·전송·푸시 | |
| S12-08 | 지식 저장소(knowledge_search)·학습 루프가 브라우저 봇 답에 반영 | |

### S13. 비밀번호 관리자 (테스트 데이터만)

| ID | 흐름 | 기대 |
|---|---|---|
| S13-01 | 팝업(Ctrl+Shift+Y): All Items / All Vaults / Search / Lock vault now / Manage vaults… / Create / Sign in to Aside / Your vault is empty | 각 화면 |
| S13-02 | 항목 만들기(Item name / Credentials / Username / Password / Website / Matching(Domain/Host/Starts with/Exact URL/Regular expression/Never fill) / Agent access(Always allow/While unlocked/Never) / Custom Section / 카드·신원 유형) | 저장·편집·삭제 |
| S13-03 | 테스트 사이트 로그인 폼에서 인라인(iframe) 저장 제안(Save in Aside / Save credential / Update existing / Generate Password / Use generated password / Unlock / Tap to unlock) | 원본 흐름 |
| S13-04 | 자동채움(Ctrl+Shift+L, 항목 선택) → 폼 채워짐 → `window.close()` | 팝업 닫힘, 브라우저 생존 |
| S13-05 | Password Generator(Password/Passphrase, 문자 종류, Avoid ambiguous, Separator, Capitalize, Include number, Regenerate, Copy) | |
| S13-06 | 잠금·자동 잠금·PIN·계정 암호 재입력 | |
| S13-07 | 에이전트의 금고 접근(`Password access` 옵션, 접근 정책) → 작업 중 실제 사용/차단 | Guard 발화 여부 기록 |
| S13-08 | Export(CSV/JSON)·Import(CSV) 왕복 | 테스트 금고만 |

### S14. 장시간·스트레스

| ID | 확인 |
|---|---|
| S14-01 | 2시간 방치 + 30분마다 사용: FATAL 0, `ps -o rss` 추이, 데몬 error 증가분 |
| S14-02 | 탭 50·세션 30·북마크 30 상태의 반응 시간 |
| S14-03 | 네트워크 끊김 중 작업 → 복구 후 이어짐 |
| S14-04 | 창 크기 최소/최대, HiDPI 배율 변경 |

## 5. 실행 순서·시간

1. 점검 창 열기(§2.2) → S1 → S7·S8(오늘 수정 재확인) → S5-03/04(승인·중단) → S9 → S10 → S13 → S2·S3·S4 → S6(17페이지) → S11 → S14 → 점검 창 닫기(§2.3).
2. S12는 Belmont 호스트까지 가상 화면에 띄울 수 있으면 같은 창에서, 아니면 사용자 손 방식.
3. 예상 시간: S1~S11 6~8시간, S12 1시간, S14 2시간(방치). 모델 호출 비용은 작업 40~60회 분량.

## 6. 보고서

`data/artifacts/full-user-test-<YYYYMMDD>/REPORT.md`: 결론 먼저(전체 항목 수·PASS·FAIL·원본 미확인 수와 비율) → 결함 목록(재현·근거·원본 대비·사망 반경) → `ORIGINAL_UNKNOWN` 목록(원본에서 확인해야 할 질문 형태로) → 부록 체크리스트의 미수행 항목 → 91-row 갱신안. 진행 일지와 `NEXT_SESSION.md` 갱신 후 커밋.
