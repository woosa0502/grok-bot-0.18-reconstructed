# 라이브 확인 실행서 — 10건 (2026-09-06)

오늘 복원 작업(G1~G7)에서 **코드는 끝났지만 화면으로 못 본 것 10건**이다.
전부 **Aside 확장 또는 외부 서비스가 있어야 나오는 것**이라 오늘 규칙(확장 로드 금지)으로 미뤘다.

작성 모델: **Claude Opus 5 (1M context)** (모델 ID `claude-opus-5[1m]`).
근거는 `campaign/G7-RESULT.md` §6-2의 통합본 + 각 그룹 결과 문서. 한 장 표는
`usecases/RESTORATION-MAP-2026-09-06.md` §3.

---

## 0. 왜 오늘 못 했나

Aside 확장(`AsideAgentManager`)을 로드하면 확장이 **라이브 데몬 21420에 붙어 버린다.**
오늘은 여섯 그룹이 같은 기계에서 동시에 일했고, 라이브 환경을 건드리지 않는 것이 규칙이었다
(`campaign/COMMON.md`). 그래서 확장이 필요한 동작은 전부 **코드 근거 + 단위 검증**으로 대신하고
"라이브 확인 필요"로 표시했다.

**이제는 호스트를 올려도 된다.** 아래 10건을 순서대로 보면 된다.

---

## 1. 준비

빌드된 바이너리는 이미 있다. 새로 빌드할 필요 없다.

| 항목 | 값 |
|---|---|
| 실행파일 | `/home/hoon/chromium/src/out/aside/chrome` |
| 마지막 빌드 | 2026-09-06 17:02:50 (G7), FAILED 0 |
| 확장 | `belmont-browse/vendor/aside-ext/AsideAgentManager` |
| 데몬 | 902.1713 (라이브 21420) |

호스트를 띄우는 방법은 `HANDOFF-2026-09-05.md` §1과 같다.

```bash
pgrep -x Xvfb -a | grep -q ':97' || (Xvfb :97 -screen 0 1400x900x24 >/dev/null 2>&1 &)
cd /home/hoon/_roots/labs/work/Belmont/belmont-browse
(BELMONT_BROWSE_DISPLAY=:97 setsid nohup ./run-fork.sh > .state/serve.log 2>&1 < /dev/null &)
# 상태: .state/serve.json (port 9340, pid, chromePid)
# CDP:  http://127.0.0.1:9333/json/version
```

봇까지 같이 볼 것이면 tmux `belmont-bot`에서 `SAND_ASIDE_BROWSE=1 npm run wsl:start`.

**끄기** (자기 셸을 죽이는 `pkill -f` 패턴 금지 — HANDOFF §3·§7-5):

```bash
kill $(python3 -c "import json;d=json.load(open('.state/serve.json'));print(d['pid'],d.get('chromePid',''))")
sleep 2
pkill -f '[c]hrome-profile --window-size'
```

---

## 2. 확인 10건

순서는 **준비가 적게 드는 것부터**다. L1~L3, L8, L9는 확장만 있으면 되고,
L4~L7, L10은 조작이 더 든다.

### L1 — AI 탭 개수 배지 (`AiTabsCountBadgeView`)

| | |
|---|---|
| 왜 라이브인가 | 에이전트 탭 그룹은 Aside 확장이 만든다. `aside::IsAgentTabsGroup()`이 참일 때만 보인다 |
| 어느 화면 | 탭 스트립의 **탭 그룹 머리** (세로·가로 둘 다) |
| 어떤 조작 | 확장으로 에이전트 탭 그룹을 만든다 (Aside 화면에서 작업 하나를 띄우면 생긴다) |
| 기대 결과 | 그룹 머리에 **스파클 아이콘 + 개수 배지**가 붙는다. 일반 탭 그룹에는 안 붙는다 |
| 코드 | `chrome/browser/ui/views/tabs/tab_group_header_view.{h,cc}` |
| 근거 | G2-RESULT §3-1 (같은 구간의 셰브런은 이미 화면 확인됨) |
| 판정 | 배지가 보이고 개수가 그룹 안 탭 수와 맞으면 종결 |

### L2 — AI 탭 뷰포트 (`AsideAiTabsViewport`)

| | |
|---|---|
| 왜 라이브인가 | 물릴 에이전트 탭이 있어야 Emulation 명령이 나간다 |
| 어느 화면 | **화면 없음** — CDP 로그로 본다 |
| 어떤 조작 | 에이전트 탭이 있는 상태에서 창 크기를 바꾼다. 그 탭을 보이게 했다가 감춘다 |
| 기대 결과 | 안 보이는 에이전트 탭의 DevTools 세션에 `Emulation.setDeviceMetricsOverride`가 들어간다(params: `width` `height` `deviceScaleFactor` `mobile` `scale` `screenWidth` `screenHeight` `positionX` `positionY` `dontSetVisibleSize`). 대상이 없어지면 `Emulation.clearDeviceMetricsOverride` |
| 코드 | `chrome/browser/ui/views/frame/multi_contents_view.{h,cc}` |
| 근거 | G2-RESULT §3-4 (원본 `0x04c78900`의 호출 횟수까지 대조함) |
| 판정 | 두 명령이 실제로 나가면 종결. **남은 차이**: 원본은 대상 후보를 세 곳에서 찾는데 둘째·셋째가 무엇인지 미확정. 우리는 "탭 목록에서 안 보이는 에이전트 탭" 한 규칙 |

### L3 — 탭 끌기 미리보기 카드 (`FloatingTabDragView`)

| | |
|---|---|
| 왜 라이브인가 | **X11 합성 드래그(xdotool)로는 안 된다.** 크로미움이 탭을 즉시 새 창으로 떼어 내 커서를 따라가게 만들어서, 원래 창의 분할 드롭 타깃이 안 겨냥되고 `OnTabDragUpdated`가 안 불린다 |
| 어느 화면 | 세로탭 + 분할 보기 |
| 어떤 조작 | **진짜 마우스로** 세로탭 행을 잡아 분할 드롭 타깃 위로 끈다 |
| 기대 결과 | 파비콘 + 제목이 든 **둥근 카드**가 포인터 위에 뜬다. 드래그를 벗어나거나 끝내면 사라진다 |
| 코드 | `chrome/browser/ui/views/frame/multi_contents_view_drop_target_controller.cc` |
| 근거 | G2-RESULT §이관 B (원본 클래스 이름·선언 파일·줄번호까지 대조) |
| 판정 | 카드가 뜨면 종결 |

### L4 — 알림 인박스 종단 (SQLite)

| | |
|---|---|
| 왜 라이브인가 | `MaybeDeliverNotificationToAside()`가 `IsExtensionEnabled(profile)`(확장 ID로 판정)을 요구한다 |
| 어느 화면 | 아무 사이트 (예전 검사는 `test/inbox-test.py`) |
| 어떤 조작 | `chrome.asideNotification.requestPermission` → 권한 허용 → `new Notification(...)` |
| 기대 결과 | `<프로필>/AsideInbox/inbox.db`의 `inbox_entries`에 **행 1개**. `encrypted_payload`는 `os_crypt_async`로 암호화된 BLOB |
| 확인 명령 | `sqlite3 <프로필>/AsideInbox/inbox.db 'select id, created_at, site_url, is_persistent from inbox_entries;'` |
| 코드 | `chrome/browser/notifications/aside_inbox_delivery.{h,cc}` |
| 근거 | G3-RESULT §7. 표 정의 두 문장이 원본과 **글자까지 같다**. 파일 기반 시절의 종단 확인 기록은 DIFFERENTIAL (6), `ui-shots/20` |
| 판정 | 행이 1개 들어가면 종결. **덤으로 볼 것**: 옛 파일 기반 인박스(`*.json`)가 있으면 첫 저장 때 행으로 옮겨지고 파일이 지워진다(`MigrateJsonInbox`) |

### L5 — 웹스토어 테마 설치 차단 대화상자

| | |
|---|---|
| 왜 라이브인가 | `webstorePrivate.beginInstallWithManifest3`은 **웹스토어 출처에서만** 불린다. 외부 호출 없이 못 띄운다 |
| 어느 화면 | 크롬 웹스토어 |
| 어떤 조작 | 아무 **테마**의 "Chrome에 추가" |
| 기대 결과 | 제목 `Theme installation failed` / 본문 `Aside browser does not support themes.` / 버튼 `OK`. 닫으면 확장 쪽에 결과 `feature_disabled` + 오류 문구 `Themes are not supported by Aside browser` |
| 코드 | `chrome/browser/ui/extensions/aside_theme_install_blocked_dialog.cc`, `webstore_private_api.{h,cc}` |
| 근거 | G3-RESULT §9. 원본 꼬리 점프(`0x07f900c0`)까지 읽어 문구 3개·결과 코드 4를 그대로 옮겼다. 빌드된 바이너리에 문자열이 들어간 것은 `strings`로 확인함 |
| 판정 | 대화상자 문구 세 개가 그대로 뜨면 종결 |

### L6 — 미니팝업 창 실제 토글

| | |
|---|---|
| 왜 라이브인가 | 창을 띄우는 것은 Aside 확장이다(`chrome.asideMiniPopup.setState`) |
| 어느 화면 | 데스크톱 전역 |
| 어떤 조작 | `Alt+Space` (기본 단축키, pref `aside.mini_popup.shortcut`) |
| 기대 결과 | 프레임 없는 항상-위 창이 뜨고 확장 `minipopup.html`이 렌더링된다. 다시 누르면 숨는다 |
| 같이 볼 것 | **미니팝업에서 프로필 전환** — G3이 G4에 넘긴 항목. `chrome::SwitchProfileInPlaceForAside()` (`browser_commands.h:123`)를 부르면 된다. 지금 배선이 있는지부터 확인 |
| 코드 | `chrome/browser/extensions/api/aside_mini_popup/mini_popup_shortcut.{cc,h}`, `mini_popup_service.cc` |
| 근거 | G4-RESULT §3(4). 단축키 등록·해제·실패 문구 3개는 코드로 확인. 창 자체는 patch 011/012/039로 이미 뜬 기록이 있다(`ui-shots/25`, `ui-shots/26`) |
| 판정 | 창이 뜨고 숨으면 종결. 프로필 전환은 별건으로 적을 것 |

### L7 — 파이어폭스·사파리 실제 데이터 이관

| | |
|---|---|
| 왜 라이브인가 | 이 기계에 **Firefox 프로필도 Safari 내보내기 ZIP도 없다.** 픽스처 단위 검사까지만 했다 |
| 어느 화면 | `chrome://aside-import-data` |
| 어떤 조작 | 실물 프로필이 있는 기계에서 Firefox 선택 → 가져오기 / Safari 내보내기 ZIP 지정 |
| 기대 결과 | 북마크·쿠키·비밀번호가 실제로 옮겨진다. 취소를 누르면 importer에 실제로 취소가 가고, 일부만 끝나면 **실패**로 떨어진다 |
| 이미 확인된 것 | 리눅스 탐지는 실물로 됨 — 이 기계의 `~/.config/google-chrome`을 찾아 Chrome 한 줄과 아이콘을 그렸다(`ui-shots/G4-import-webui.png`). 취소·실패 상태는 `aside_native_contracts_tests` 5/5. 픽스처 검사 `aside_importer_tests` 9/9 |
| 주의 | Safari ZIP은 **이름이 아니라 확장자와 JSON 최상위 키**로 분류한다. `Bookmarks.html` 같은 고정 이름을 찾으면 진짜 내보내기에서는 아무것도 못 찾는다 |
| 근거 | G4-RESULT §3(1) |
| 판정 | 한 브라우저라도 실제 데이터가 옮겨지면 종결 |

### L8 — 비밀번호 관리자 툴바 버튼 자동 고정

| | |
|---|---|
| 왜 라이브인가 | 그 확장(`clcdgiameigmljcbkkcbjiljinmfkncl`)이 있어야 보인다 |
| 어느 화면 | 툴바 |
| 어떤 조작 | 확장을 **처음 설치한 상태로** 브라우저를 시작한다 |
| 기대 결과 | 버튼이 툴바에 **한 번만** 자동 고정된다. 사용자가 떼면 다시 안 붙는다. 확장별 pref `aside_password_manager_toolbar_pin_initialized`가 켜진다 |
| 확인 | `<프로필>/Preferences`의 그 확장 항목에서 pref 확인 |
| 코드 | `chrome/browser/extensions/toolbar_actions_model.cc` |
| 근거 | G6-RESULT §4(10). 원본이 같은 46바이트 키를 `ExtensionPrefs::ReadPrefAsBoolean`/`UpdateExtensionPref`로 쓰는 자리까지 대조 |
| 판정 | 처음 한 번만 붙으면 종결. 에이전트 확장(`fjdhphbdlfjogobdofoaagnlnkoibdge`)도 같은 방식이니 같이 볼 것 |

### L9 — 확장 페이지 배경색 측정

| | |
|---|---|
| 왜 라이브인가 | 확장 페이지가 떠야 도는 경로다 |
| 어느 화면 | 확장 페이지를 연 탭 |
| 어떤 조작 | Aside 확장의 페이지(예: `newtab.html`, 설정 페이지)를 연다 |
| 기대 결과 | `ScheduleTargetExtensionBodyBackgroundProbe()`가 페이지 `body` 배경색을 재고, 브라우저 크롬 색이 거기에 맞춰진다. **확장 페이지와 크롬 사이에 색이 튀지 않는다** |
| 코드 | `chrome/browser/ui/views/frame/contents_web_view.{h,cc}` (216행) |
| 근거 | G6-RESULT §4(11). 원본 문자열 `ScheduleTargetExtensionBodyBackgroundProbe`(`0xd172c05`)가 같은 파일을 가리킨다 |
| 판정 | 색이 맞으면 종결. 눈으로 보는 항목이라 라이트·다크 둘 다 볼 것 |

### L10 — 탭 전환기 새 팔레트

| | |
|---|---|
| 왜 라이브인가 | 전환기를 띄우는 경로가 확장·단축키에 걸려 있다. **Ctrl+Tab은 전환기가 아니라 탭 순환이다**(G7이 이것 때문에 헛짚었다 — `ui-shots/G7-10`) |
| 어느 화면 | 탭 전환기 패널 |
| 어떤 조작 | 전환기를 띄운다 (실제 트리거를 먼저 찾을 것) |
| 기대 결과 | 패널 배경 `kColorAsideTabSwitcherBackground` — 라이트 `0xB8F8F8F8`, 다크 `0xB3171717`. 선택 항목 배경 `kColorAsideTabSwitcherItemBackgroundFocused` — 라이트 `0x140A0A0A`, 다크 `0x14FAFAFA` |
| 코드 | `chrome/browser/ui/views/frame/aside_tab_switcher_view.cc` |
| 근거 | G7-RESULT §3 (증거 등급 **A** — 원본 `0x04c3079b`·`0x04c30d09`의 `mov esi,0xee`/`0xef`를 직접 읽음. 알파 조작이 없다 = 색에 알파가 이미 들어 있다) |
| 판정 | 픽셀을 재서 위 값과 맞으면 종결. 라이트·다크 둘 다 |

---

## 3. 확인 결과를 어디에 적나

- 항목별 결과: 이 문서에 "결과" 열을 붙이거나, 해당 그룹의 `campaign/G*-RESULT.md`에 이어 적는다.
- 한 장 표: `usecases/RESTORATION-MAP-2026-09-06.md` §3의 L1~L10 줄과 §2 본 표의 증거 열을 갱신한다.
- 실사용 검사 기록은 예전대로 `usecases/PARITY-RESULTS-2026-09-05.md`에 이어 적는다.

## 4. 안전 규칙 (라이브를 켠 뒤에도 유지)

- **커밋하지 않는다.** 크로미움 트리는 오늘 커밋이 없다(브랜치 `aside-remediation-20260906`,
  HEAD `1d00f53b`는 일부만). 커밋 여부는 사용자가 정한다.
- **빌드는 잠금 안에서 `-j4 -l 6`.** 기계 메모리 16 GB다. 오늘 재부팅을 두 번 겪었다.
- **`pkill -f`는 앞을 고정한다.** 패턴이 자기 명령줄과 겹치면 셸이 죽는다.
- 확인이 끝나면 자기가 띄운 Xvfb·크롬은 정리하고 포트를 반납한다.
