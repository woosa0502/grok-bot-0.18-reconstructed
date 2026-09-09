# LIVE-RESULT — 호스트·서비스를 올려서 한 라이브 확인 (2026-09-06)

담당: 라이브 확인. G1~G7이 "확장·데몬이 붙어야 보인다"며 남긴 항목을 **실제로 띄워서** 봤다.
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. 커밋 없음.

## 0. 한눈에

| | |
|---|---|
| 확인한 항목 | **11건** (G7 통합 목록 L1~L10 + G1 채팅·작업 행 진짜 데몬 재확인) |
| 통과 | **8건** — L1 · L2 · L4 · L5 · L6 · L9 · L10 · G1 |
| 부분 | **1건** — L8 (기제는 실물 확인, 비밀번호 관리자 확장 자체가 이 기계에 없음) |
| 불가 | **2건** — L3 (X11 합성 드래그로는 원리상 못 함, 실물로 확인) · L7 (기계에 Firefox/Safari 데이터 없음) |
| 라이브에서 찾아 고친 결함 | **3건** (2·3·4절) — 전부 "코드 근거만으로는 안 보이던" 것 |
| 마지막 빌드 | **2026-09-06 18:09:46**, `grep -c FAILED /tmp/aside-build-LIVE3.log` = **0** |

**핵심**: 라이브 확인은 도장 찍기가 아니었다. 세 항목(L1·L2·L6)은 코드 근거로는 "재현 완료"였지만
실제로 띄우니 **화면에서 틀렸다**. 그중 L2는 기능이 통째로 한 번도 안 돌고 있었다.

---

## 1. 환경 — 올리는 데 먼저 막힌 것

절차는 지시받은 대로였으나 **1번 단계가 실패한다**. `Xvfb :99`가 뜨긴 하는데 듣는 소켓이 하나도 없다:

```
_XSERVTransmkdir: Mode of /tmp/.X11-unix should be set to 1777
_XSERVTransSocketCreateListener: failed to bind listener
```

WSL이 `/tmp/.X11-unix`를 **읽기 전용 tmpfs**로 걸어 둬서(`none on /tmp/.X11-unix type tmpfs (ro,relatime)`)
Xvfb가 `X99` 소켓을 못 만든다. `-nolisten tcp`까지 줬으니 듣는 구멍이 0개가 되고, 프로세스는 살아 있지만
`DISPLAY=:99`는 아무것도 못 붙는다. 고친 방법(한 줄):

```
sudo mount -o remount,rw /tmp/.X11-unix && sudo chmod 1777 /tmp/.X11-unix
```

이후 `Xvfb :99` 정상, `xdpyinfo`가 답한다. **다음 사람이 같은 데서 막힌다** — 절차서에 넣어야 한다.

### 올린 것

| | pid | 비고 |
|---|---|---|
| `Xvfb :99` | **21967** | 1280x800x24 |
| 브라우저 서비스(Aside Daemon, `src/serve.mjs`) | **42046** | 9340 / 데몬 21420 / 진짜 확장 등록됨 |
| 포크 크롬 | **42056** | CDP 9333, 프로필 `.state/chrome-profile` |
| 벨몬트 호스트 | **23050** | tmux `belmont-bot`, gateway 45036, `/health` ok |

호스트가 봇용 가상 화면 `Xvfb :100`(23082) · `:101`(23575)을 자기가 띄운다 — 내가 띄운 것이 아니고
호스트의 자식이라 그대로 뒀다.

### 봇 경로에서 만난 것 (결함 아님, 기록용)

`drive.mjs`로 봇에 지시했더니 즉시 멈췄다. 원인은 **옛 세션(t34)이 남긴 승인 위젯**이었다 —
`파일 접근 .../memory/sites/naver.com.md` 승인이 안 끝난 채 매달려 있어 새 지시가 그 뒤에 줄 서 있었다.
`respondToWidget`으로 허용해 풀었고, 그 뒤로는 **서비스 API(`POST /sessions`)로 직접** Aside 세션을
만들어 썼다(에이전트 탭을 만드는 데는 이 길이 짧고, 봇 대화 상태를 안 건드린다).

---

## 2. 결함 ① — 에이전트 탭 개수 배지 글자가 회색으로 바랜다 (L1)

**증상**: 에이전트 탭 그룹이 생기면 머리에 스파클 아이콘 + 개수가 뜬다. 아이콘과 "Agent Tabs" 글자는
흰색인데 **개수 숫자만 칙칙한 회갈색**이다. 파란 그룹 바탕 위라 읽기 힘들다.

**측정**: 숫자 획의 실제 픽셀이 `(118, 118, 120)`. 옆의 제목 글자는 `(255, 255, 255)`.

**원인**: `TabGroupHeaderView`는 개수 라벨의 색을 제목과 **같은 `foreground_color`로 분명히 지정한다**
(`ai_badge_label_->SetEnabledColor(foreground_color)`). 그런데 `views::Label`의 **자동 가독성 보정**이
그 지정을 덮는다 — 라벨은 자기 배경을 모르니 위젯의 밝은 배경을 가정하고, "흰 글자는 안 보인다"며
회색으로 낮춘다. 형제인 제목 라벨(`TabGroupHeaderLabel`)은 **바로 그 이유로** 생성자에서
`SetAutoColorReadabilityEnabled(false)`를 부른다. 배지 라벨만 그걸 안 부르고 있었다.

**고침** (`tab_group_header_view.cc`, 1줄 + 주석):

```cpp
ai_badge_label_->SetAutoColorReadabilityEnabled(false);
```

**확인**: 고친 뒤 숫자 획이 `(255, 255, 255)`. `ui-shots/LIVE-01-agent-tabs-badge.png`.

> 코드만 읽어서는 절대 안 보인다 — 소스에는 "제목과 같은 색을 넣는다"고 정확히 적혀 있고,
> 실제로 그 줄이 실행된다. 뷰 프레임워크가 뒤에서 바꾼다.

---

## 3. 결함 ② — `AsideAiTabsViewport`가 **한 번도 안 돌고 있었다** (L2)

**증상**: 숨은 에이전트 탭에 `Emulation.setDeviceMetricsOverride`가 나가야 하는데, CDP로 모든 탭의
`screen.width/height`를 읽어 보면 전부 실제 화면 `1280x800`이다. 즉 덮어쓰기가 없다.

**원인 추적**: 임시 `LOG(ERROR)`를 넣어 빌드해 보니 `UpdateAiTabsViewport()`가 **단 한 줄도 안 찍힌다**.
호출자를 따라가니 이렇다 — `UpdateAiTabsViewport()`를 부르는 곳은 `MultiContentsView` 안의 세 자리뿐이고
(`SetWebContentsAtIndex`, `ShowSplitView`, `SetActiveIndex`), 그런데 **평범한 탭 전환은 그 길로 안 온다**:

```cpp
// browser_view.cc:2098 — 분할 보기가 아닌 보통의 활성 탭 전환
multi_contents_view_->GetActiveContentsView()->SetWebContents(new_contents);
```

`ContentsWebView`를 **직접** 부르고 `MultiContentsView`를 건너뛴다. `SetWebContentsAtIndex`는
`BrowserView::ShowSplitView`에서만 불린다. 결론: **분할 보기를 만들 때 말고는 뷰포트가 갱신되지 않는다.**
게다가 확장이 에이전트 그룹에 탭을 넣기만 하는 경우(활성 탭 안 바뀜)도 갱신 계기가 없다.

**고침** (`multi_contents_view.{h,cc}`): `MultiContentsView`를 `TabStripModelObserver`로 만들고
스트립 변화·그룹 변화에서 `UpdateAiTabsViewport()`를 부른다. 공유 파일(`browser_view.cc`)은 안 건드렸다.

```cpp
ai_tabs_tab_strip_observation_.Observe(browser_view_->browser()->tab_strip_model());
...
void MultiContentsView::OnTabStripModelChanged(...) { UpdateAiTabsViewport(); }
void MultiContentsView::OnTabGroupChanged(const TabGroupChange&) { UpdateAiTabsViewport(); }
```

(`base::ScopedObservation<TabStripModel, TabStripModelObserver>`는 크로미움이 **일부러 지운** 조합이다.
파생 타입을 두 번째 인자로 줘야 한다 — `<TabStripModel, MultiContentsView>`.)

**확인 — 두 방향 모두**:

| | 고치기 전 | 고친 뒤 |
|---|---|---|
| 브라우저 로그(임시) | 한 줄도 없음 | `UpdateAiTabsViewport agent_contents=yes` → `ApplyViewportToContents bounds=0,0 1039x753` → `EnsureAttached ok` → `setDeviceMetricsOverride 1039x753` |
| 숨은 에이전트 탭의 `screen` (CDP) | `1280x800` (= 실제 화면) | **`1039x753`** (= 콘텐츠 영역) |

숨은 탭 하나만 `1039x753`이고 나머지 탭은 전부 `1280x800`이다. 즉 **그 탭에만** 덮어쓰기가 걸렸다.
확인용 명령: `node /tmp/probe-viewport.mjs`(모든 page 대상의 `screen`/`inner` 크기를 읽는다).

> 이 결함은 "확장이 있어야 보인다"가 아니라 **"확장이 있어도 안 보였다"** 였다.
> G2의 코드는 맞게 쓰였고, 그 코드를 부르는 사람이 없었다.

---

## 4. 결함 ③ — 미니팝업 내용이 창의 왼쪽 위 구석에만 그려진다 (L6)

**증상**: Alt+Space로 미니팝업 창이 뜬다(창 크기는 맞다 — compact 420x220, expanded 420x640).
그런데 **웹 내용은 200x120만 그려지고 나머지는 까맣다**.

**측정** (팝업 페이지에서 CDP):

```
{"iw":200,"ih":120,"ow":420,"oh":220}    ← 창은 420x220인데 뷰포트는 200x120
```

**원인**: `MiniPopupView` 생성자가 `extension_view_->Init()`를 부른다. `ExtensionViewViews::Init()`은
호스트 타입이 팝업이면 **오직 한 가지 일만** 한다 — `EnableSizingFromWebContents(GetMinBounds(), GetMaxBounds())`.
즉 "뷰 크기를 페이지 내용이 정한다"로 뒤집는다. 미니팝업 페이지는 자기 크기를 스스로 안 정하므로
**최소값 200x120에 눌러앉는다.** 미니팝업은 `asideMiniPopup.setState/setSize`가 창 크기를 정하는
고정 크기 창이라 자동 리사이즈가 정반대다.

**고침** (`mini_popup_view.cc`): `Init()`을 부르지 않는다(그 함수의 유일한 효과가 위의 자동 리사이즈다).
그러면 이미 걸어 둔 `FillLayout`이 웹 뷰를 창에 꽉 채운다. 이유를 주석으로 남겼다.

**확인**: `{"iw":420,"ih":640,"ow":420,"oh":640}` — 뷰포트 = 창. 까만 영역 사라짐.
`ui-shots/LIVE-06-minipopup.png`.

---

## 5. 항목별 결과

| # | 항목 | 확인 방법 | 결과 | 증거 |
|---|---|---|---|---|
| **L1** | `AiTabsCountBadgeView` (G2 1번) | 서비스 API로 Aside 세션을 만들어 에이전트 탭 그룹 생성 → 세로 띠 그룹 머리 캡처 · 픽셀 측정 | **통과 (결함 1건 고침)** | `LIVE-01-agent-tabs-badge.png`. 스파클 아이콘 + 개수, 숫자색 `(255,255,255)` |
| **L2** | `AsideAiTabsViewport` (G2 이관 A) | 에이전트 탭을 숨긴 상태로 만들고 모든 탭의 `screen` 크기를 CDP로 읽음 + 임시 로그 | **실패 → 통과 (결함 1건 고침)** | 숨은 에이전트 탭만 `screen 1039x753`, 나머지 `1280x800` |
| **L3** | `FloatingTabDragView` (G2 이관 B) | xdotool로 세로탭 행을 눌러 콘텐츠 영역까지 천천히 끌기(8단계) | **불가 — G2의 예측이 실물로 맞았다** | `LIVE-03-drag-tears-off-window.png`: 포인터가 띠를 벗어나는 순간 탭이 **새 창으로 떨어져 나가** 포인터를 따라다닌다. 분할 드롭 타깃이 겨냥되지 않으므로 카드가 뜰 계기 자체가 없다. 돌아와서 놓으면 원래 창에 다시 합쳐진다(부작용 없음) |
| **L4** | 알림 인박스 종단 (G3 8번) | `test/inbox-test.py` — 진짜 확장이 `asideNotification.requestPermission` → 페이지에서 `new Notification()` → SQLite 확인 | **통과** | 권한 `{"ok":true}`, 페이지 `perm:"granted"`, 시스템 알림 **안 뜸**. `Default/AsideInbox/inbox.db` 새로 생김. 표 정의가 G3 문서와 일치. 행 2개 — **1번은 옛 파일 인박스가 이주된 것**(`created_at 1788584245404` = 옛 json의 시각, json 파일은 삭제됨), 2번은 이번 알림. 페이로드는 `v10…` OSCrypt 암호문 |
| **L5** | 웹스토어 테마 설치 차단 (G3 9번) | 진짜 웹스토어(`chromewebstore.google.com`)를 열고 그 페이지 문맥에서 `webstorePrivate.beginInstallWithManifest3`에 **테마 매니페스트**를 넘김 | **통과 — 문구·결과 코드 전부 원본대로** | `LIVE-05-theme-blocked.png`: 탭 모달 제목 **"Theme installation failed"**, 본문 **"Aside browser does not support themes."**, 버튼 **OK**. API 응답 `{"result":"feature_disabled","lastError":"Themes are not supported by Aside browser"}` |
| **L6** | 미니팝업 창 실제 토글 (G4 47번) | `test/minipopup/minipopup-test.mjs`(DISPLAY :99) + `switchProfile` 별도 확인 | **통과 (결함 1건 고침)** | `getShortcut`=`Alt+Space`, 잘못된 조합은 원본 문구 `Invalid mini popup shortcut`로 거절. Alt+Space에 창 2097193(420x220) 뜸 → 한 번 더 누르면 사라짐. 옵션 창 500,300 360x240 → `setOptionWindowSize(400,300)`으로 400x300 → 닫으면 대상 0개. **프로필 전환**: `switchProfile(0)` 성공, `switchProfile(99)` → `Invalid Chromium profile index`, 음수는 스키마가 거절 |
| **L7** | Firefox·Safari 실제 데이터 이관 (G4 33번) | 리눅스·윈도우 양쪽에서 `places.sqlite`/`profiles.ini`/Safari 내보내기 검색 | **불가 — 그대로** | 이 기계와 `/mnt/c/Users/HOON` 어디에도 Firefox 프로필도 Safari ZIP도 없다. G4의 픽스처 검사 이상은 실물 프로필이 있는 기계에서만 |
| **L8** | 비밀번호 관리자 툴바 고정 pref (G6 10번) | 라이브 프로필의 `Preferences`를 읽어 pref와 고정 목록 확인 | **부분 — 기제는 실물 확인** | 같은 표(`kAsideAutoPinned`)가 도는 다른 항목인 **에이전트 확장**에서 실제로 동작한다: `extensions.settings.fjdhphbd….aside_agent_toolbar_pin_initialized` 기록됨, `extensions.pinned_extensions = ["fjdhphbdlfjogobdofoaagnlnkoibdge"]`, 툴바에 버튼 붙음(`LIVE-08-toolbar-pinned.png`). **비밀번호 관리자 확장(`clcdgiameigmljcbkkcbjiljinmfkncl`) 자체가 이 프로필에 설치돼 있지 않아** 그 줄은 실행될 수 없다 — 코드 결함이 아니라 대상 부재 |
| **L9** | 확장 페이지 배경색 측정 (G6 11번) | 확장 페이지 탭을 실제 클릭으로 전환 + 임시 로그 | **통과** | `extbg scheduled for chrome-extension://fjdhphbd…/newtab.html` → 50 ms 뒤 `extbg measured=ffeeeeee`. 불투명(`ff`)이라 `UpdateBackgroundColor()`가 그 색을 레이어·렌더 위젯에 적용한다. **주의**: CDP `json/activate`로는 안 돈다(콘텐츠 교체가 안 일어남). 세로 띠를 **진짜로 클릭**해야 `SetWebContents`가 불린다 |
| **L10** | `AsideTabSwitcherView` 새 팔레트 (G7) | Ctrl 누른 채 Tab 반복 → HUD 캡처 → 알파 역산 | **통과 — 팔레트 두 색이 픽셀로 맞다** | `LIVE-10-tab-switcher.png`. 판 배경: 파란 페이지 위 합성에서 역산한 알파 **0.719**, 기대 `0xB8/255 = 0.7216` (`kColorAsideTabSwitcherBackground` 라이트 `0xB8F8F8F8`). 흰 페이지 위 판은 `(250,250,250)` — 계산값 249.9. 선택 항목: 판 위에서 `(231,231,231)`, 기대 `0x14` 알파의 `0x0A` 검정 = **231.2** (`kColorAsideTabSwitcherItemBackgroundFocused` `0x140A0A0A`). Tab을 6번 더 누르면 강조 띠가 107~144행 → 359~396행으로 이동(= Advance 동작) |
| **G1** | 세로탭 채팅·작업 행 (G1 1번, 진짜 데몬으로 재확인) | 진짜 데몬의 세션 목록이 뜬 상태에서 채팅 행 우클릭 · 메뉴 실행 | **통과** | `LIVE-G1-chat-context-menu.png`: 7항목·구분선 2개가 원본 순서 그대로 — Rename chat / Archive Chat / Bookmark chat / Mark as read ‖ Open folder in Finder / Copy session ID ‖ Open in a new tab. **동작도 확인**: "Mark as read"를 누르니 그 행의 안읽음 점과 종 아이콘이 사라지고 제목이 왼쪽으로 밀렸다(`LIVE-G1-mark-as-read.png`), 다른 두 행은 그대로. G1이 가짜 응답기로 본 것과 진짜 데몬이 같다 |

### 덤으로 확인된 것

- **포크 + 진짜 확장 + 진짜 데몬 + 봇 경로가 종단으로 돈다.** 서비스 API로 낸 지시
  ("https://example.com 을 열어서 페이지 제목과 첫 문단을 알려줘")가 `status: done`으로 끝나고
  제목·첫 문단을 정확히 답했다. 그 과정에서 세로 띠에 **Agent Tabs 그룹 · Aside Tasks 줄 ·
  Recent Chats & Threads 줄**이 전부 실물로 그려졌다.

---

## 6. 남은 차이 (고치지 않음 — 원본 근거가 없어서)

| 자리 | 무엇 | 왜 안 고쳤나 |
|---|---|---|
| `AsideTabSwitcherView` | 판 높이에 **상한이 없다**. `GetPreferredSize()`가 `탭 수 × (항목높이+2)`라 탭이 26개면 판이 창보다 커져 위아래가 잘리고, **선택된 항목이 화면 밖일 수 있다**(첫 Ctrl+Tab에서 실제로 안 보였다) | 원본이 최대 높이나 스크롤을 두는지 바이너리에서 못 봤다. 추측으로 상한을 넣는 것은 성적표 튜닝이다 |
| `AiTabsCountBadgeView` | 팔레트에 `kColorAsideTabGroupCountChipBackground`(`0x4D090B0C`)와 `kColorAsideTabGroupForeground`가 있는데 배지는 **칩 배경 없이** 아이콘+글자만 그린다 | 그 두 색이 이 배지 자리에 쓰인다는 근거(G7 표의 "쓰는 자리"가 `—`)가 없다. 색 이름만으로 칠하면 근거 없는 변경 |

---

## 7. 빌드

| 회차 | 시각 | 무엇 | 결과 |
|---|---|---|---|
| 1 | 17:42 | 배지 색 + 미니팝업 + 임시 진단 로그 | 첫 시도 FAILED 2 (`base/logging.h` 누락) → 넣고 **FAILED 0**, `out/aside/chrome` 17:43:09 |
| 2 | 18:03–18:05 | 뷰포트 옵저버 | 첫 시도 FAILED 4 (`ScopedObservation<TabStripModel, TabStripModelObserver>`가 삭제된 조합) → 파생 타입으로 바꿔 **FAILED 0**, 18:05:18 |
| 3 | 18:09 | **임시 로그 제거** (최종) | **FAILED 0**, `out/aside/chrome` **18:09:46** |

명령: `flock /tmp/aside-ninja.lock sh -c './third_party/ninja/ninja -C out/aside chrome -j4 -l 6 …'`.
최종 바이너리에 `ASIDE_LIVE_PROBE` 문자열이 **0개**인 것으로 임시 로그 제거를 확인했다.
최종 빌드로 서비스를 다시 올려 세 고침(배지 흰색 · 뷰포트 `1039x753` · 미니팝업 420x640 꽉 참)을 다시 봤다.

---

## 8. 고친/만든 파일

| 파일 | 무엇 |
|---|---|
| `chrome/browser/ui/views/tabs/common/tab_group_header_view.cc` | 배지 라벨 자동 가독성 보정 끄기 (2절) |
| `chrome/browser/extensions/api/aside_mini_popup/mini_popup_view.cc` | `ExtensionViewViews::Init()` 호출 제거 — 자동 리사이즈가 창 크기를 무시하게 만들고 있었다 (4절) |
| `chrome/browser/ui/views/frame/multi_contents_view.h` | `TabStripModelObserver` 상속 · 두 override · `ScopedObservation` 멤버 · include 2개 (3절) |
| `chrome/browser/ui/views/frame/multi_contents_view.cc` | 생성자에서 스트립 관찰 시작 · 두 override 구현 (3절) |

패치 스냅샷: `aside-fork/patches/041-LIVE.patch`.
캡처: `ui-shots/LIVE-01-agent-tabs-badge.png`, `LIVE-03-drag-tears-off-window.png`,
`LIVE-05-theme-blocked.png`, `LIVE-06-minipopup.png`, `LIVE-08-toolbar-pinned.png`,
`LIVE-10-tab-switcher.png`, `LIVE-G1-chat-context-menu.png`, `LIVE-G1-mark-as-read.png`.

## 9. 지도(RESTORATION-MAP) 갱신용

| 구간 start_hex | 새 상태 |
|---|---|
| `0x04899120` (AiTabsCountBadgeView) | **라이브 통과** — 배지 글자색 결함 고침 |
| `0x04c78900` / `0x04c7dee0` (AsideAiTabsViewport · Emulation 덮어쓰기) | **라이브 통과** — 갱신 계기가 없어 한 번도 안 돌던 것을 고침 |
| `0x04c7edd0` (FloatingTabDragView) | 라이브 불가 — X11 합성 드래그가 탭을 새 창으로 떼어냄 |
| `0x047a84c0` (AsideInbox) | **라이브 통과** — 종단(권한→알림→SQLite), 옛 파일 인박스 이주 포함 |
| `0x07f8e140` (웹스토어 테마 차단) | **라이브 통과** — 진짜 웹스토어에서 문구·결과 코드 일치 |
| `0x0498f6c0` (미니팝업 전역 단축키) | **라이브 통과** — 창 토글·옵션 창·프로필 전환. 내용 크기 결함 고침 |
| 비밀번호 관리자 툴바 고정 pref | 라이브 부분 — 같은 표의 에이전트 확장 항목으로 기제 확인 |
| 확장 페이지 배경색 측정 | **라이브 통과** — `measured=ffeeeeee` |
| `0x04c3079b` / `0x04c30d09` (탭 전환기 두 색) | **라이브 통과** — 픽셀 역산으로 `0xB8`·`0x14` 알파 일치 |
| `0x04cab230` (세로탭 채팅·작업 행) | **라이브 통과** — 진짜 데몬으로 메뉴 7항목 + Mark as read 동작 |
