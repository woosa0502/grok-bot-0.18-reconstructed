# 원자 단위 실사용 테스트 결과 요약 — 2026-09-10 저녁 (엔진 909)

장부 원본: `data/artifacts/full-user-test-20260910-atomic/LEDGER.md` (컨트롤 하나 = 행 하나, 캡처 `shots/`, 로그 `state-logs/`). 도구: `tools/cdp.mjs`(CDP 보조), `tools/mini-mcp.mjs`(MCP 테스트 서버).

## 결론 먼저

- 실제 키·마우스로 **227개 컨트롤**을 눌렀다. PASS 185, FAIL 13, DIFFERS 5, ORIGINAL_UNKNOWN 4, BLOCKED 6, NOT_APPLICABLE 2, PARTIAL 2, NOT_DONE 10.
- 체크리스트 118행 중 69행을 컨트롤 단위로 건드렸다(구역별: S1 1, S2 13, S3 9, S4 2, S5 10, S6 18, S7 2, S8 3, S9 1, S10 5, S11 2, S12 1, S13 1, S14 1).
- 하네스: 사용자 Aside를 21:14에 멈추고 상태 복사본으로 격리 909를 Xvfb :97에 띄움(확장 등록 1초, 브리지 충돌 없음). 22:21에 사용자 Aside 복구(daemon 112992 / Chrome 113027, GPU 켬). 복사본은 삭제.
- 이전 테스터 보고의 "환경 제약 #3(Xvfb 격리 불가)"은 절차 오류였음이 재확인됨: 사용자 데몬을 멈추면 같은 절차로 전부 된다.

## 제품 결함으로 보이는 것 (FAIL)

| ID | 컨트롤 | 근거 |
|---|---|---|
| S2-07 | 채팅 메뉴 `Open folder in Finder` | 아무 일도 없음. 데몬 로그 `POST /session/for-chrome/<id>/open-folder – HTTP 500`. 리눅스에 폴더 열기 구현 없음. 개선안: WSL에선 `explorer.exe`로 연결 |
| S6-01 | `Import bookmarks` | 설정 페이지가 오류 화면으로 바뀜: "Something went wrong — d.data?.map is not a function — Copy message / Reload"(s6-01-general.png). 원인 후보: 리눅스 포크에서 브라우저 감지/북마크 가져오기 API 응답이 배열이 아님 |
| S6-01 | `Import from another browser` | 같은 오류 화면 "d.data?.map is not a function". 두 Import 진입점 모두 실패 |
| S6-02 / S2-15 | Dark 테마 시 네이티브 사이드바·툴바 | s6-02-theme-dark.png: 확장 페이지는 어두운데 네이티브 사이드바·툴바는 흰색 그대로. 원본(mac)은 네이티브도 함께 어두워지는 것으로 알려짐 → 포크의 테마 연동 확인 필요 |
| S6-02 | Customize sidebar 체크 항목(Chats/Bookmarks) 토글 | 팝오버는 열리고 항목(aria-checked=true)이 보이지만 클릭·Space로 상태가 바뀌지 않음. 버튼 문구 "Chats, Bookmarks" 유지 |
| S11-01 | 표시된 단축키 ⌘S/⌘E/⌘⇧E/⌘⇧C를 Ctrl·Alt로 눌러봄 | Ctrl+E, Ctrl+Shift+E, Alt+E, Alt+Shift+E: 변화 없음. Ctrl+Shift+C는 크로미움 DevTools가 열림(Copy URL 아님). Alt+Shift+C: 클립보드 변화 없음. 리눅스 키 매핑이 없거나 다른 키. 표시는 mac 글리프 그대로(DIFFERS) |
| S6-02 | `Advanced` 링크 클릭 | 새 탭이 `aside://settings/appearance`로 열리지만 내용 없는 빈 페이지(대상 URL이 비어 있음). 원본은 브라우저 고급 설정으로 연결되는 것으로 추정 → 포크에 aside:// 스킴 처리 없음 |
| S6-05 | 링크 대상 | View browsing history → `aside://history/`, Site settings → `aside://settings/content`, Advanced → `aside://settings/security`(Ads privacy만 `chrome://settings/adPrivacy`) |
| S6-05 | `View browsing history` 링크 | `aside://history/` 탭이 열림(내용은 아래 재확인) |
| S6-05 | `View browsing history` 결과 페이지 | `aside://history/`는 제목·본문 없는 빈 페이지(s6-05-aside-history.png). aside:// 링크 4개(Advanced×2·history·content) 모두 같은 증상 |
| S6-07 | `Open Project Folder` | 화면 변화 없음(S2-07과 같은 open-folder 500 계열) |
| S6-10 | Memory `Open folder` | 데몬 `tRPC meta.open – INTERNAL_SERVER_ERROR`(리눅스 폴더 열기 미구현, S2-07·S6-07과 같은 계열) |
| S6-14 | Enable Aside MCP server 스위치 | 클릭해도 aria-checked false 유지, 대화상자·설정 변화 없음 |

### 묶어서 보면

1. **aside:// 스킴 미처리** — 설정의 Advanced(Appearance·Security)·View browsing history·Site settings 링크가 빈 페이지. 포크에 aside://→chrome:// 매핑이 없음. (4건)
2. **폴더 열기 미구현(리눅스)** — 채팅 메뉴 Open folder in Finder, 프로젝트 Open Project Folder, 메모리 Open folder가 데몬 500/INTERNAL_SERVER_ERROR. WSL에선 `explorer.exe`로 연결하면 해결 가능. (3건)
3. **Import bookmarks / Import from another browser** — 설정 페이지가 `d.data?.map is not a function` 오류 화면으로 바뀜. (2건)
4. **Dark 테마가 네이티브 사이드바·툴바에 안 먹음**(의심) — 확장 페이지만 어두워짐. 원본 비교 필요. (1건)
5. **Customize sidebar 체크 항목이 안 눌림**(의심), **Enable Aside MCP server 스위치 무반응**(의심), **표시된 단축키 ⌘S/⌘E/⌘⇧E/⌘⇧C가 리눅스에서 동작하는 키 없음**(의심). (3건)

## 원본과 다르거나 원본을 모르는 것 (DIFFERS / ORIGINAL_UNKNOWN)

| ID | 컨트롤 | 근거 |
|---|---|---|
| S8-01 | 탭 검색 버블의 단축키 힌트 표기 | 리눅스에서 ⌘⇧A 글리프. 원본 mac 표기 그대로. 기능 영향 없음 |
| S2-07 | 메뉴 문구 "Open folder in Finder" | 리눅스에서 mac 문구 그대로. 동작은 아래 행에서 확인 |
| S3-03 | 상단 안내 막대 "You are using an unsupported command-line flag: --no-sandbox" | 우리 실행기가 --no-sandbox로 띄워서 원본엔 없는 막대가 뜸(s3-03-aimode-result.png). 사용자에게도 보임. 개선 후보: 플래그 제거 가능 여부 검토 |
| S6-01 | `Check for updates` | "Automatic updates are not configured for this build." 우리 빌드엔 업데이트 경로 없음(원본은 Omaha). Background service: "Current version is v1.26.909.1820. Running normally." |
| S3-03 | 주소창에 `aside://settings/appearance` 직접 입력 | 구글 검색으로 처리됨(스킴 미등록). 원본 동작 미확인 |
| S2-10 | 탭 행 가운데 클릭 | about:blank 탭 4→4, 닫히지 않음(s2-10-middleclick.png). 원본 동작 미확인 |
| S3-09 | 툴바 `+`(새 탭/새 작업) | s3-09-toolbar-right-zoom.png: 툴바 오른쪽 끝은 퍼즐·✨·구분선으로 끝나고 + 없음. 새 탭 +는 사이드바 Tabs 섹션에 있음(S2-09 PASS). mac 원본 툴바에 +가 있는지 미확인 |
| S6-01 | `Set as default` | 화면 변화·로그 없음. 리눅스에서 기본 브라우저 등록 동작이 비어 있음(원본 mac/win은 OS 대화상자) |
| S6-02 | `Advanced` 링크 | href `aside://settings/appearance`(target=_blank). 클릭해도 새 페이지 없음 → 포크가 aside:// 스킴을 처리하는지 확인 필요(아래 재시험) |

## 못 한 것 (NOT_DONE / BLOCKED / PARTIAL)

| ID | 컨트롤 | 사유 |
|---|---|---|
| S2-10 | 우클릭 메뉴 `Mute site` | about:blank 탭엔 사이트가 없어 라벨이 안 바뀜(s2-10-menu-after-mute.png). 실제 사이트 탭에서 재시도 예정 |
| S5-11 | 헤더 `Toggle pinned summary` 아이콘 | 요약이 아직 없는 채팅이라 화면 변화 없음(s5-11-pinned-summary.png). 요약이 생긴 채팅에서 재시도 필요 |
| S6-06 | Completion sound `Change` | 네이티브 파일 선택 창이라 자동화 보류 |
| S6-06 | `Rule precedence` | 팝오버 내용을 못 읽음(툴팁 형태 추정) |
| S6-06 | File permissions `Add`(Can view/Can edit) | 네이티브 폴더 선택 창 |
| S6-07 | 보관된 프로젝트 삭제 | 보관 후 프로젝트 화면에 톱니가 사라지고 삭제 진입점을 못 찾음(아래에서 목록 화면 재시도) |
| S6-10 | Overview / History(Dream now) / Configure / Statistics / Context Awareness | 909의 Settings › Memory는 파일 브라우저 단일 화면. memories/overview·history·configure 경로는 Not Found. 테스터가 본 History(Dream) 화면의 진입점 미확인 |
| S6-14 | Aside CLI `Install` / `CLI install options` | 화면 변화를 못 잡음(클립보드 복사형으로 추정). 로컬 CLI는 S11-03에서 별도 |
| S12-* | Belmont 데스크톱·모바일 연동 8행 | Belmont 호스트(tmux belmont-bot)가 꺼져 있고 별도 점검 창(§2.2 S12 절차)이 필요. 이번 창에서 제외 |
| S14-01 | 2시간 방치 | 이번 창 1시간 10분. RSS 위 행 참고 |
| S5-07 | 채팅 열 때 공유 상태 조회 | 채팅 페이지를 열면 `tRPC sessions.shareStatus – UNAUTHORIZED`가 ERROR로 기록됨(클라우드 공유 기능). 기능 영향 없음, 로그 소음 |
| S13-01 | 비밀번호 관리자 팝업 내용(로컬 계정) | "Aside requires sign-in — Sign in to create a secure password vault for this profile. [Sign in]". 코드상 `!isInitialized → /popup/setup-required`. 금고는 클라우드 로그인 필요 → S13-02~0 |
| S6-14 | Remote Control 스위치(PRO) | PRO 기능. 클릭해도 변화 없음(Upgrade to Pro 안내만) |
| S6-13 | Channels 페이지 | "Aside, Anywhere — Upgrade to Pro" 버튼만(PRO) |
| S6-03 | Account 페이지 | "You're using Aside in local mode — Sign in to sync your data" |
| S1-04 / S13-02~08 | 계정 암호·금고 | 클라우드 로그인 필요(로컬 계정) |
| S6-05 | `Ads privacy` 링크 | chrome://settings/ 루트로 열림(adPrivacy 하위 페이지로 안 감) |
| S6-09 | `Do not use this skill` 토글 | 버튼 문구가 바뀌는 것은 확인, 저장 위치는 미확인 |

## 다음 한 수

1. 실행기에 데몬 포트 치환(확장 사본의 21420 → 지정 포트)을 넣어 사용자 Aside를 안 끄고도 격리 검증이 되게 한다.
2. FAIL 1·2·3은 포크/훅 수정 대상. 1은 스킴 매핑, 2는 WSL explorer.exe 연결, 3은 브라우저 감지 API 응답 확인.
3. S12(Belmont 연동 8행)는 Belmont 호스트를 띄운 별도 점검 창에서. S13·S1-04·S6-03/04/13은 클라우드 계정이 없는 한 BLOCKED.

## 수정 후 재검 (2026-09-10 23:15~23:22, 빌드 c3209e2f · 데몬 59976fd7 · 자산 패치)

FAIL 13건을 원인 5묶음으로 고치고 같은 격리 창 절차로 다시 눌러 봤다(장부 하단 "재검" 행).

| 묶음 | 고친 곳 | 재검 결과 |
|---|---|---|
| A. `aside://` 링크 빈 페이지(4) | 포크: `aside` 표준 스킴 등록 + `HandleAsideSchemeRewrite`(aside://→chrome://) + 주소창 분류 | Advanced → "Settings - Appearance", View browsing history → History, Site settings → "Settings - Site settings", 주소창 `aside://history/` 입력 → History. 4/4 PASS |
| B. 폴더 열기 500(3) | 데몬 패치 `patch-daemon-linux.py`: WSL이면 `wslpath -w` → `explorer.exe`, 아니면 `xdg-open`. 907·909 번들 재생성·재고정 | 채팅 행 메뉴·메모리 Open folder → Windows 파일 탐색기 창이 실제로 열림(세션 폴더·memory 폴더). 3/3 PASS. 네이티브 메뉴 문구도 "Open folder in File Explorer"로 |
| C. Import 오류 화면(2) | 포크: `asideBrowserImport.getImportSources`가 `{sources}` 대신 배열 반환 | 두 진입점 모두 "Detected browser: woosa0502" 대화상자. 2/2 PASS |
| D. Dark 테마 네이티브 미적용(1) | 재검만(코드 변경 없음) | Dark에서 사이드바 (31,31,31)·툴바 (60,60,60)로 어두워짐 → 앞선 판정은 캡처 타이밍 오판. PASS |
| E. 무반응 컨트롤(3) | 단축키: 포크 가속기 Ctrl+S/Ctrl+E/Ctrl+Shift+E/Ctrl+Shift+C/Ctrl+Shift+- 추가(`IDC_ASIDE_*`) + 설정 표기 패치(`patch-linux-platform-glyphs.py`). 사이드바 체크: 재검(Bookmarks 항목이 맞는 대상; Chats는 원래 고정). MCP 서버 스위치: 원본 설계(Aside CLI 설치 시만 활성) | 단축키 5/5 실키 PASS(표기도 Ctrl로), Bookmarks 끄기/켜기 PASS, MCP 스위치는 NOT_APPLICABLE로 정정 |

재검 뒤 장부: 242행, PASS 199 · FAIL 13(모두 재검 PASS 행이 짝으로 붙음) · DIFFERS 5 · ORIGINAL_UNKNOWN 4 · BLOCKED 6 · NOT_DONE 10 · NOT_APPLICABLE 3 · PARTIAL 2. 남은 DIFFERS 중 `--no-sandbox` 안내 막대와 ⌘ 표기(탭 검색 힌트는 이제 Ctrl+⇧A)는 별도 항목.

사용자 Aside는 23:22에 새 빌드로 다시 켰다(daemon 129705 / Chrome 129742, GPU 켬). 살아 있는 프로필의 확장 사본은 `aside_component/agent-manager/1.26.909.1820`을 지우고 다시 준비했다(준비 도구는 내용이 다른 같은 버전을 덮어쓰지 않으므로, 자산 패치를 바꾸면 이 폴더를 지워야 반영된다).
