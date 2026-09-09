# G3-RESULT — 프로필 메뉴·프로필 페이저·알림·확장 UI (2026-09-06)

담당 10군데 전부 처리했다. **재현 완료 7, 상위 크로미움에 이미 있음 2, 불가(맥 전용) 1.**
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. 커밋·stash·checkout·reset 없음.

이 문서는 **이어받은 작업**이다. 앞 담당이 기계 재부팅으로 죽으면서 결과 문서를 못 남겼고,
편집 일부는 이미 트리에 들어가 있었다. 아래 표의 "이어받을 때" 열이 내가 시작한 시점의 상태다.
남의 코드는 지우지 않았고, 새 파일은 `git add -N` 했다(앞 담당이 빠뜨린 알림 파일 4개 포함).
`ui-shots/G3-*.png` 캡처 14장, 패치 `patches/041-G3.patch`, DIFFERENTIAL "(15) G3 …" 절.

## 한 줄 결론

프로필 메뉴 본문·아이콘 선택기·모노그램 아바타·메뉴 패널은 앞 담당이 만든 것이 **동작까지 정상**임을
독립 크롬(:113)에서 확인했다. **프로필 페이저는 코드만 있고 죽어 있었다** — 누르면 브라우저가
즉사하거나, 되돌아온 탭이 통째로 닫히거나, 탭이 두 배로 늘었다. 원인 네 개를 찾아 고쳤다.
웹스토어 테마 차단과 화면 공유 선택기(`BorderOnTopView`)는 새로 이식했다. 확장 팝오버는 맥 전용이라 불가, 확장 메뉴 지표·headless 판정·AppleScript 북마크는
상위 크로미움과 같음을 원본 대 기준선(cft-171) 대조로 확정했다.

## 항목별 표

| # | 구간(start_hex) | 이름 | 이어받을 때 | 이식 길 | 결과 |
|---|---|---|---|---|---|
| 1 | `0x04bd8b00` | 프로필 메뉴 본문 · 아이콘 선택기 | 이미 됨 | 1+2 | **재현 완료** — 동작 확인·캡처 |
| 2 | `0x04bf8a90` | 프로필 메뉴 뷰 · ProfileMonogramAvatarView | 이미 됨 | 1+2 | **재현 완료** — 동작 확인·캡처 |
| 3 | `0x047c9720` | Geist 폰트 · headless 판정 · AppleScript 북마크 | Geist만 됨 | 1 / 대조 | **재현 완료**(Geist) + 나머지 둘은 상위와 같음을 대조로 확정 |
| 4 | `0x04bc7560` | 프로필 페이저 (창 안 프로필 전환) | 코드만, **누르면 깨짐** | 2 | **재현 완료** — 치명 결함 4건 고침, 동작 확인·캡처 |
| 5 | `0x04bbe2f0` | 확장 팝오버(mac) · WebContents 표시 훅 | 없음 | — | **불가 — 맥 전용**(리눅스 대응 동작은 상위에 이미 있음) |
| 6 | `0x04892a00` | 화면 공유 선택기 탭 목록 | 없음 | 2+3 | **재현 완료** — `BorderOnTopView` 이식 |
| 7 | `0x047a84c0` | AsideInbox — 알림 SQLite 저장 | 이미 됨 | 1+2 | **재현 완료** — 표 정의 원문 일치·파일→SQLite 이주 포함 |
| 8 | `0x04bf5120` | AsideMenuPanel / AsideMenuItemButton | 이미 됨 | 2 | **재현 완료** — 동작 확인·캡처 |
| 9 | `0x07f8e140` | 웹스토어 설치 — 테마 차단 | 없음 | 1+2 | **재현 완료** — 문구·결과 코드까지 원본대로 |
| 10 | `0x085de3c0` | 확장 메뉴 지표 | 없음 | 대조 | **상위 크로미움에 이미 있음** — 지표 10개 전부 대조 |

---

## 1·2·8 — 프로필 메뉴 (본문 · 아이콘 선택기 · 뷰 · 패널)

구간 `0x04bd8b00`(82,384 B), `0x04bf8a90`(80,368 B), `0x04bf5120`(13,184 B).

앞 담당이 만든 파일(내가 만들지 않음):

- `chrome/browser/ui/views/profiles/aside_profile_menu_view.{h,cc}` (1,134줄)
- `chrome/browser/ui/views/profiles/profile_monogram_avatar_view.{h,cc}`
- `chrome/browser/profiles/profile_attributes_entry.{h,cc}` (`aside_profile_indicator_icon` 저장)
- 붙는 자리: `chrome/browser/ui/views/frame/aside_profile_footer_view.cc:120`

내가 한 일은 **살아 있는지 확인**이다. 셋 다 정상이었다.

**원본 문자열 대조 (이식 길 1).** 메뉴가 쓰는 UTF-16 문구가 원본 프레임워크에 그대로 있는지
12개를 찍어 확인했다 (전부 일치):

| 문구 | 원본 x86_64 주소 |
|---|---|
| `Profile indicator menu` | 0xe9a6d86 |
| `Change icon` | 0xe9a6db4 |
| `Profile submenu` | 0xe9a6dcc |
| `Extension submenu` | 0xe9a6d4c |
| `No recent tabs` | 0xe9a707e |
| `No installed extensions` | 0xe9a701e |
| `No recent downloads` | 0xe9a6f38 |
| `Profile actions` | 0xe9a6e96 |
| `" will be removed from this device.` | 0xe9a6a00 |
| `Delete profile?` | 0xe9a6a48 |
| `Edit profile` | 0xe9a690c |
| `Choose a short, recognizable name.` | 0xe9a6926 |

**지시 아이콘 47개도 이름·순서가 원본 그대로다.** 원본 `0xe9a6a76`부터 UTF-16 문자열이
연달아 47개 있고(그 뒤부터 `Profiles`·`Extension settings`… 메뉴 문구가 시작된다),
우리 `profile_monogram_avatar_view.cc`의 `kIndicatorIcons` 배열과 **47개 전부 일치**한다:

```
Sun Moon Cloud Zap Heart Flame Star "Magic wand" "Thumbs up" Diamond Book
"Magic book" Hourglass Clock Smile Slime Lock "Map pin" Pin Tag Flag
"Shopping bag" Suitcase Banknote Telescope Trophy Rocket Ticket Camera Folder
Bookmark Pencil Write Brush Palette "Half circle" Atom Headphones Bell Email
Chart Circle Square Flower Cursor Console Bubble
```

확인 명령:

```
python3 -c "b=open('.../Aside-Framework-1.0.825.1-x86_64','rb').read();
print(hex(b.find('Profile indicator menu'.encode('utf-16-le'))))"

# 47개 연속 열거
python3 -c "
b=open('.../Aside-Framework-1.0.825.1-x86_64','rb').read(); p=0xe9a6a76; out=[]
while len(out)<60:
    e=b.find(b'\x00\x00',p)
    if (e-p)%2: e+=1
    s=b[p:e].decode('utf-16-le','replace')
    if not s or len(s)>30: break
    out.append(s); p=e+2
print(out)"
```

**동작 확인 (독립 크롬 :113, CDP 9413, user-data-dir /tmp/aside-ui-G3).**

| 캡처 | 보이는 것 |
|---|---|
| `ui-shots/G3-01-profile-menu-root.png` | 머리(모노그램 아바타 + 이름 + `⋯` Profile actions) / 구분선 / Profiles·Extensions·Bookmarks·Downloads·History·Developers / 구분선 / Settings·New Tab·Incognito Window |
| `ui-shots/G3-02-profile-actions.png` | `‹ Profile actions` — Edit · Change Icon · Delete · Sign Out |
| `ui-shots/G3-03-icon-picker.png` | `‹ Change icon` — 47개 지시 아이콘을 6열 격자로 (Sun·Moon·Cloud·Zap·Heart·Flame·Star·Magic wand …) |
| `ui-shots/G3-04-icon-picked.png` | Rocket을 고른 뒤 그 칸이 강조되고 **머리 아바타가 이니셜 "Y" → 로켓으로 바뀜** |
| `ui-shots/G3-05-profiles-page.png` | `‹ Profiles` — 프로필 두 개(각자 지시 아이콘) + New profile |
| `ui-shots/G3-08-extensions-page.png` | `‹ Extensions` — "Installed extensions" / "No installed extensions" / "Manage all extensions" / "Import extensions" |
| `ui-shots/G3-09-downloads-page.png` | `‹ Downloads` — "No recent downloads" / "Show all downloads" |
| `ui-shots/G3-10-history-page.png` | `‹ History` — "Recent tabs" / "No recent tabs" / "All history" |

아이콘 선택이 실제로 저장되는 것도 확인했다 — 크롬을 끄고 `Local State`를 읽으면:

```
"Default": { ..., "aside_profile_indicator_icon": "Rocket", "name": "Your Chromium", ... }
```

**주의(캡처하다 알게 된 것).** 메뉴 거품은 세로 띠의 프로필 발치에 `BOTTOM_LEFT`로 붙는데,
**브라우저 창 안쪽으로 잘린다**. 발치가 창 바닥에 고정돼 있지 않고 목록 바로 아래에 있어서,
탭이 적으면 발치 위 공간(약 296 px)이 메뉴 높이(약 350 px)보다 작아 머리와 첫 줄이 잘린다.
탭을 6개 열어 발치를 내리면 전부 보인다. 세로 띠 배치는 G1 몫이라 손대지 않았고,
**G1에 넘긴다: 프로필 발치를 띠 바닥에 고정하거나 메뉴에 스크롤을 넣어야 한다.**

---

## 3 — Geist 폰트 · headless 판정 · AppleScript 북마크

구간 `0x047c9720`(60,064 B). 세 갈래인데 **하나만 Aside 것**이다.

| 갈래 | 판정 | 근거 |
|---|---|---|
| Geist 폰트 등록 | **재현 완료** (앞 세션) | 원본에만 있음 (cft-171에 `Geist` 0건) |
| `IsHeadlessMode` | 상위 크로미움 | `headless_mode_util.cc` 문자열이 cft-171에도 1건 — 인라인된 상위 코드가 이 구간에 섞인 것 |
| AppleScript 북마크 | 상위 크로미움 + 맥 전용 | `-[BookmarkFolderAppleScript removeFromBookmarkFoldersAtIndex:]` cft-171 2건 / Aside 2건 |

Geist 쪽 실물 확인 — 번들 TTF 18개가 바이너리 옆에 깔려 있고 fontconfig가 이름을 잡는다:

```
$ ls /home/hoon/chromium/src/out/aside/aside_fonts | wc -l
18
$ FONTCONFIG_FILE=<임시 conf, dir=out/aside/aside_fonts> fc-match "Geist"
Geist-Regular.ttf: "Geist" "Regular"
```

원본의 폰트 만드는 자리도 확인했다 — x86_64 `0x047cace0`이 `"Geist"` + 크기(double) +
굵기(edi)로 `gfx::FontList`를 만든다. 우리 `chrome/browser/ui/aside/aside_fonts.cc`의
`UiFontList(size, weight)`와 같은 모양이다.

---

## 4 — 프로필 페이저 (창을 새로 만들지 않고 탭을 보관·복원)

구간 `0x04bc7560`(57,696 B). **이 항목이 이번 작업의 핵심이다.**

### 이어받을 때: 코드는 있는데 누르면 깨졌다

앞 담당이 배선까지 해 뒀다 — `Browser::StashTabsForAsideProfileSwitch` /
`RestoreTabsForAsideProfileSwitch` / `SetProfileForAsideProfileSwitch` /
`ClearTabStripEmptySuppressionForAsideProfileSwitch`(browser.{h,cc}),
`chrome::SwitchProfileInPlaceForAside`(browser_commands.cc),
`TabStripModel::SetProfileForAsideProfileSwitch`(tab_strip_model.h),
`BrowserManagerService::ReleaseBrowserForAsideProfileSwitch`.
프로필 메뉴의 Profiles 줄이 이걸 부른다.

프로필을 두 개 만들고 실제로 눌러 봤더니 **연달아 네 번 깨졌다.** 넷 다 고쳤다.

### 결함 ① — 같은 관찰자를 두 번 등록해 즉사 (`AddBrowser`)

```
FATAL ... NOTREACHED  base::ObserverList<>::AddObserver()  [base/observer_list.h:371]
  TabStripModel::AddObserver()                 [tab_strip_model.cc:355]
  BrowserTabStripTracker::MaybeTrackBrowser()  [browser_tab_strip_tracker.cc:54]
  GlobalBrowserCollection::OnBrowserCreated()  [global_browser_collection.cc:54]
  BrowserManagerService::AddBrowser()          [browser_manager_service.cc:95]
  chrome::FinishAsideProfileSwitch()           [browser_commands.cc:1258]
```

원인: 페이저는 창을 **닫지 않는다**. 그래서 `GlobalBrowserCollection`과 거기 붙은 관찰자
(`BrowserTabStripTracker`)는 그 창을 계속 붙잡고 있다. 그런데 새 프로필 서비스의
`AddBrowser()`가 "창이 새로 생겼다"고 알리는 바람에, 이미 붙어 있는 탭띠 관찰자를 한 번 더
등록하려다 죽었다.

고침 — `BrowserManagerService::AddBrowserForAsideProfileSwitch()`를 새로 만들었다.
`AddBrowser()`와 몸통(`AddBrowserInternal`)을 공유하되 **"창 생성" 알림만 보내지 않는다**.
창은 원래 살아 있었으니 전역 목록은 이미 맞다.

- `chrome/browser/ui/browser_manager_service.{h,cc}` (+38/+17줄)
- `chrome/browser/ui/browser_commands.cc` 호출 자리 1줄

### 결함 ② — 보관해 둔 탭의 프로필이 파괴되어 즉사

①을 고치자 바로 다음이 나왔다:

```
FATAL ... NOTREACHED  settings::PeopleHandler::OnSyncShutdown()  [people_handler.cc:1165]
  syncer::SyncServiceImpl::Shutdown()
  ProfileImpl::~ProfileImpl()
  ProfileDestroyer::Timeout()
```

원인: 프로필 A에서 B로 넘어가면 창의 `profile_keep_alive_`가 B를 가리키게 된다. A를 붙잡는
것이 아무도 없어져 `ProfileDestroyer`가 A를 부순다 — 그런데 **A의 탭(WebContents)은 아직
`aside_stashed_tabs_`에 살아 있다.** 그 중 하나가 `chrome://settings`였고, 파괴되는 A의
SyncService가 아직 살아 있는 그 WebUI를 두드리며 죽었다.

고침 — 보관 중인 프로필마다 keep-alive를 하나씩 잡는다.

```cpp
// browser.h
std::map<base::FilePath, std::unique_ptr<ScopedProfileKeepAlive>>
    aside_stashed_profile_keep_alives_;   // aside_stashed_tabs_ 보다 먼저 선언
```

`StashTabsForAsideProfileSwitch()`에서 잡고 `RestoreTabsForAsideProfileSwitch()`에서 놓는다.
선언 순서를 보관 목록보다 **앞**에 둔 이유는 소멸 순서다 — 탭이 먼저 사라지고 keep-alive가 나중에
풀려야 한다.

### 결함 ③ — 되돌아온 탭이 통째로 닫히고 창까지 사라짐

①②를 고치니 전환은 되는데, **두 번째 전환에서 복원한 탭이 전부 닫히고 창이 사라졌다.**
크래시가 아니라 조용히 닫히는 것이라 임시 로그와 스택 추적을 넣어 잡았다:

```
ASIDEPAGER start session_id=675930746 tabs=2      (Work → Your Chromium)
ASIDEPAGER TabStripEmpty suppress=1               (보관하느라 비움 — 정상)
ASIDEPAGER finish old=Prof1 new=Default
ASIDEPAGER restored=9 strip=9                     (9개 복원 — 여기까지 정상)
ASIDEPAGER TabStripEmpty suppress=1               ← 복원 23 ms 뒤 또 비었다
ASIDEPAGER clear tabs=0                           ← 빈 띠 → window_->Close()
ASIDEPAGER ~Browser
```

두 번째 `TabStripEmpty`의 스택:

```
Browser::TabStripEmpty()
TabStripModel::SendDetachWebContentsNotifications()
TabStripModel::CloseTabs()
TabStripModel::CloseAllTabs()
UnloadController::ProcessPendingTabs()      [chrome/browser/ui/unload_controller.cc:483]
base::TaskAnnotator::RunTaskImpl()          (posted task)
```

원인: `UnloadController::TabStripEmpty()`가 탭띠가 비면 조건 없이
`is_attempting_to_close_browser_ = true`를 걸어 둔다("확장이 닫히는 창에 탭을 못 붙이게"). 보관은
일부러 띠를 비우므로 이 표시가 걸리고, **다음 보관 때** 탭을 하나 떼는 순간
`UnloadController::TabDetachedImpl → ClearUnloadState`가 `ProcessPendingTabs()`를 예약한다.
그 예약이 복원 직후에 깨어나 `CloseAllTabs()`로 방금 되돌린 탭을 전부 닫고, 이어서 빈 띠를 본
억제 해제가 창을 닫는다. 그래서 **첫 전환은 멀쩡하고 두 번째부터 터진다.**

고침 — `UnloadController::ResetForAsideProfileSwitch()`를 만들어 보관이 끝나는 자리
(`Browser::StashTabsForAsideProfileSwitch()` 끝)에서 그 표시를 푼다. `ProcessPendingTabs()`는
맨 앞에서 `if (!is_attempting_to_close_browser_) return;` 하므로 이미 예약된 것도 무해해진다.
진짜로 닫는 중(`is_calling_before_unload_handlers()`)이면 손대지 않고 정규 `CancelWindowClose()`로 넘긴다.

- `chrome/browser/ui/unload_controller.{h,cc}` (+13/+7줄)
- `chrome/browser/ui/browser.cc` — 보관 끝에서 호출

### 결함 ④ — 돌아오면 탭이 두 배가 됨

③까지 고치니 창은 살아남는데 **되돌아온 뒤 탭이 5개가 아니라 10개**였다(원래 것 + 지난 세션 것).

원인: 원본 이름을 따 만든 세션 재구축을 `SessionService::WindowOpened(browser)`로 했는데,
이 함수는 첫 줄에서 `RestoreIfNecessary(StartupTabs(), browser, false)`를 부른다
(`chrome/browser/sessions/session_service.cc:394`). 우리는 그 직전에 **옛 프로필** 쪽에
`WindowClosed(session_id)`를 보내 두었고, 그 프로필에 추적 중인 창이 하나도 없어져
(`has_open_trackable_browsers_ = false`) 나중에 그 프로필로 돌아올 때 "창이 새로 열렸으니 지난
세션을 복원하자"가 성립해 버린 것이다.

고침 — 복원을 부르지 않는 조합으로 바꿨다:

```cpp
session->SetWindowType(b->session_id(), b->type());          // 창을 다시 추적 + 대기 중 close 커밋
session->SetSelectedTabInWindow(b->session_id(), active);
session->ResetFromCurrentBrowsers();                          // 살아 있는 창들로 커맨드 재작성
```

`ResetFromCurrentBrowsers()`가 이름 그대로 "세션 재구축"이라 원본의
`ScheduleSessionRebuildAfterAsideProfileSwitch`와 뜻이 맞는다.

### 원본에 맞춘 두 가지

원본 구간의 추적 이름을 전부 읽어(x86dis `str` 모드) 우리 것과 맞췄다:

```
0x04bc9242  "SwitchProfileInPlaceForAside"
0x04bc9131  "ScheduleSessionRebuildAfterAsideProfileSwitch"
0x04bcb405  "PostClearTabStripEmptySuppressionForAsideProfileSwitch"
0x04bcaeba  "Browser::StashTabsForAsideProfileSwitch.Fallback"
0x04bcaf3e  "Browser::RestoreTabsForAsideProfileSwitch.Fallback"
0x04bcc9e3  "Browser::MoveTabsPreservingCollections" (+ .DetachAll / .InsertAll)
```

- `Browser::StashTabsForAsideProfileSwitch.Fallback` 추적이 빠져 있어 넣었다(보관할 탭이 없을 때).
- 이름이 `Post…`인 것에서 알 수 있듯 원본은 **빈 탭띠 억제 해제를 posted task로** 한다.
  우리는 프로필 생성 콜백 안에서 바로 풀고 있었다(빈 띠면 그 자리에서 창을 닫는다).
  원본대로 posted task로 바꿨다 — `browser_commands.cc`만 고쳐서 헤더는 안 건드렸다.

### 동작 확인

프로필 두 개(`Default` = "Your Chromium"/Rocket, `Profile 1` = "Work"/Telescope).
탭 5개(about:blank, About Version, Settings, History, Download history)를 연 창에서
프로필 메뉴 → Profiles → **Work**를 눌렀다.

| 캡처 | 보이는 것 |
|---|---|
| `ui-shots/G3-06a-pager-before.png` | 전환 전 — "Your Chromium" 프로필, 탭 6개 |
| `ui-shots/G3-06-pager-switched.png` | 전환 후 — **같은 창**, 발치·머리 모두 "Work", Work 자신의 탭 |
| `ui-shots/G3-07-pager-back.png` | 다시 "Your Chromium"으로 돌아오면 **보관해 둔 탭 6개가 그대로, 중복 없이 복원** |

**같은 창인지 눈이 아니라 숫자로 확인했다.** CDP `Browser.getWindowForTarget`이 돌려주는 창 번호는
`Browser::session_id()`이고 `Browser`의 `session_id_`는 `const`다 — 번호가 그대로면 `Browser`
객체가 그대로라는 뜻이다.

```
전환 전            win 675931229  {left:20, top:20, width:1340, height:860}
→ Work            win 675931229   (같음)   + 보관된 탭 6개가 "창 없음"으로 살아 있음
→ Your Chromium   win 675931229   (같음)   + Work 탭 5개가 "창 없음"으로 살아 있음
```

이 "창 없음" 대상들이 곧 보관함(`aside_stashed_tabs_`)이다 — 탭이 파괴되지 않고 창에서만 떨어져
있다는 직접 증거다. 결함 ①②③④를 잡을 때 쓴 임시 로그와 스택 추적은 확인이 끝난 뒤 전부 지웠고,
지운 상태로 다시 빌드해 같은 왕복을 한 번 더 통과시켰다(위 숫자가 그 실행의 것이다).

### 남은 차이

세로 띠의 프로필 발치 이름은 `Browser::RegisterAsideProfileSwitched()` 콜백으로 다시 붙게 했지만,
같은 띠의 **북마크 구역·고정 항목 등 다른 프로필-딸림 부품은 아직 갱신되지 않는다**
(`aside_bookmarks_section_view.cc`, `aside_pinned_entries_view.cc`, `aside_tab_switcher.cc` —
전부 G1/G6 파일이다). 붙일 자리는 만들어 뒀으니 같은 콜백을 구독하면 된다:

```cpp
subscription_ = browser_->RegisterAsideProfileSwitched(
    base::BindRepeating(&MyView::OnProfileSwitched, base::Unretained(this)));
```

`BrowserWindowFeatures`도 전환할 때 다시 만들지 않는다. 원본도 `Browser::profile_`만 갈아끼우는
같은 구조라 이 차이는 원본과 공유한다. 프로필 A에 보관된 탭이 있는 동안 A가 keep-alive로 살아
있으므로 그 부품들이 가리키는 것도 매달린 포인터가 되지는 않는다.

---

## 5 — 확장 팝오버(mac) · WebContents 표시 훅 — **불가(맥 전용)**

구간 `0x04bbe2f0`(35,424 B). 구간 안의 Aside 고유 요소는 딱 두 개다.

| 문자열 | cft-171 | Aside |
|---|---|---|
| `../../chrome/browser/ui/views/extensions/extension_popover_mac.mm` | 0 | 1 |
| `ShowPopoverIfReady` | 0 | 1 |
| `WebContentsImpl::WasShown` | 1 | 1 (상위 TRACE_EVENT) |

`extension_popover_mac.mm:514`에서 부르는 코드(x86_64 0x04bc6386)다. `.mm` = Objective-C++,
`NSPopover` — **리눅스 포크에는 대응 파일이 없다.**

그리고 이 훅이 하는 일("문서 로딩이 끝나면 그때 팝오버를 띄운다")은 **리눅스 쪽에 이미 있다** —
`chrome/browser/ui/views/extensions/extension_popup.cc:225`
`ExtensionPopup::DocumentOnLoadCompletedInPrimaryMainFrame() → ShowBubble()`.
그러니 새로 만들 것이 없다. RESTORATION-MAP 14번을 "필요 없음"으로 옮기면 된다.

---

## 6 — 화면 공유 선택기 탭 목록 (`BorderOnTopView`)

구간 `0x04892a00`(21,568 B). 파일은 상위에도 있는
`chrome/browser/ui/views/desktop_capture/desktop_media_tab_list.cc`인데, Aside가 **클래스 하나를
끼워 넣고 전체를 다시 칠했다**.

### 원본에서 읽어낸 것

1. `BorderOnTopView`는 Aside 전용이다 (cft-171에 0건, Aside 1건). 클래스 메타데이터가
   `desktop_media_tab_list.cc:69`, 부모는 `ui/views/view.h:335`(= `views::View`)로 기록돼 있다.
2. 하는 일은 `PaintChildren` 재정의다. x86_64 `0x04895b30`:
   ```
   call 0x9e41b0                 ; views::View::PaintChildren(info)
   cmp  qword [this+0x208], 0    ; 테두리가 있으면
   je   ...
   … PaintRecorder(context, recording_size, scale_x, scale_y, &cache) …
   call [vtable+0x370]           ; OnPaintBorder(recorder.canvas())
   ```
   → **자식을 먼저 그리고 테두리를 그 위에 그린다.** 층(layer)을 쓰는 스크롤 뷰의 줄들이
   둥근 테두리를 덮어 버리는 것을 막는 용도다.
3. 다시 칠하는 함수(x86_64 `0x04895880`)는 다섯 개 뷰에
   `CreateRoundedRectBackground(color 0xed, 8)` + `CreateRoundedRectBorder(1, 8, color 0xd7)`를
   건다. 스크롤 뷰 자신은 `SetBackgroundColor(0xed)` + `SetBorder(nullptr)`이다.

### 색 번호를 이름으로 풀었다 — 그리고 큰 발견

원본 바이너리에 **색 이름표가 통째로 들어 있다**(0xe60f2d8부터 623개, 배열 순서 = ColorId 값,
0번 = `kColorRefPrimary0` = `kUiColorsStart`). 그래서 번호를 이름으로 바꿀 수 있다:

- `0xed` (237) = **`kColorAsideHoverCardBackground`**
- `0xd7` (215) = **`kColorAsideSurfaceBorder`**

**그런데 이 표에는 `kColorAside*` 색이 66개 들어 있고, 우리 포크 트리에는 하나도 없다**
(214 `kColorAsideSurfacePrimary` … 279 `kColorAsideToggleHover`). 이건 내 10군데 밖이고
어느 그룹에도 안 배정돼 있어 **오케스트레이터에 올린다** — 아래 "그룹 밖 발견" 절.

### 이식한 것

`chrome/browser/ui/views/desktop_capture/desktop_media_tab_list.{h,cc}`

- `BorderOnTopView`(익명 namespace, `views::View` 상속, `METADATA_HEADER`)를 원본 위치대로
  `TabListModel` 바로 앞에 넣고, `PaintChildren`을 위 기계 그대로 구현했다
  (`View::PaintChildren` → 테두리 있으면 `ui::PaintCache` + `ui::PaintRecorder` →
  `OnPaintBorder`).
- `BuildUI()`에서 스크롤 뷰를 `BorderOnTopView`로 감싸고(`list_wrapper_`), 상자 배치의
  늘어나는 칸을 그 감싸개로 옮겼다.
- `OnThemeChanged()`에서 감싸개·미리보기 상자·빈 미리보기 딱지에 둥근 배경 + 1 px 둥근 테두리를,
  스크롤 뷰에는 배경색만 + 테두리 없음을 건다(원본 구조 그대로).

### 동작 확인

`file:///tmp/aside-g3-share.html`(버튼 하나 → `navigator.mediaDevices.getDisplayMedia`)를 열고
버튼을 실제로 눌러 선택기를 띄웠다.

| 캡처 | 보이는 것 |
|---|---|
| `ui-shots/G3-11-media-picker.png` | "Choose what to share with file:///" — Chromium Tab / Window / Entire Screen 중 탭 목록. **목록 판에 둥근 1 px 테두리가 그려져 있다**(상위 크로미움은 이 판에 테두리가 없다 — 스크롤 뷰의 테두리를 `nullptr`로 지운다). 미리보기 자리 표시도 같은 둥근 테두리 |
| `ui-shots/G3-12-media-picker-border.png` | 목록 아래쪽 확대 — 줄들이 차 있는 상태에서도 테두리가 위에 남아 있다 |

**남은 차이(정직하게).** 색은 원본의 `kColorAsideHoverCardBackground` /
`kColorAsideSurfaceBorder`인데 우리 트리에 그 색이 없어 가장 가까운 상위 색
(`ui::kColorSysSurface4` / `ui::kColorSysNeutralOutline`)으로 두고 주석에 원본 이름과 번호를
적어 뒀다. 66색 팔레트가 들어오면 두 줄만 바꾸면 된다.
원본이 다시 칠하는 다섯 뷰 중 어느 것이 어느 멤버인지는 오프셋(0x320·0x328·0x330·0x340·0x350)까지만
읽었고, 그 중 하나가 Aside가 새로 넣은 멤버라 1:1 대응은 확정하지 못했다. 지금 이식한 것은
**감싸개·미리보기 상자·빈 미리보기 딱지 = 둥근 배경 + 테두리 / 스크롤 뷰 = 배경색만**이라는 구조다.

---

## 7 — AsideInbox: 알림을 SQLite에 저장

구간 `0x047a84c0`(16,256 B). 앞 담당이 파일 기반(`<프로필>/AsideInbox/<uuid>.json`,
DIFFERENTIAL (6))을 **원본과 같은 SQLite**로 바꿔 놓았고, 이주 코드까지 들어 있었다.
확인만 했다(내가 고친 것 없음). `git add -N`이 빠져 있어서 추가했다.

**표 정의가 원본과 글자까지 같다.** 원본 `0x047a84c0` 구간의 `__cstring`:

```
CREATE TABLE IF NOT EXISTS inbox_entries (id INTEGER PRIMARY KEY AUTOINCREMENT,
created_at INTEGER NOT NULL,site_url TEXT NOT NULL,encrypted_payload BLOB NOT NULL,
is_persistent INTEGER NOT NULL)
INSERT INTO inbox_entries (created_at, site_url, encrypted_payload, is_persistent)
VALUES (?, ?, ?, ?)
```

우리 `chrome/browser/notifications/aside_inbox_delivery.cc`의 `kCreateTableSql` /
`kInsertSql`이 이 두 줄과 동일하다. `sql::Database::Tag("AsideInbox")`도 원본 태그 그대로다.
두 문장을 sqlite3에 그대로 넣어 실행되는 것도 확인했다(행 1개 삽입·조회 성공).

- 저장 위치: `<프로필>/AsideInbox/inbox.db`
- payload는 `os_crypt_async`로 암호화한 BLOB (원본 `encrypted_payload`)
- 옛 파일 기반 인박스(`*.json`)는 첫 저장 때 한 번에 행으로 옮기고 파일을 지운다
  (`MigrateJsonInbox`, 트랜잭션 안)
- 실패하면 원본처럼 `inbox_store_failed`를 붙여 확장에 보낸다

가로채는 자리 둘 다 배선돼 있다 —
`platform_notification_service_impl.cc`의 `DisplayNotification` / `DisplayPersistentNotification`
맨 앞.

**라이브 확인 필요.** 종단 확인(`chrome.asideNotification.requestPermission` → `new Notification()`
→ 행 1개)은 **진짜 Aside 확장이 있어야** 한다 — `MaybeDeliverNotificationToAside()`가
`IsExtensionEnabled(profile)`(확장 ID로 판정)을 요구하기 때문이다. COMMON.md 규칙대로 확장은
띄우지 않았다. 앞 세션이 진짜 확장으로 파일 기반 버전을 확인한 기록이 DIFFERENTIAL (6)에 있다
(`test/inbox-test.py`, ui-shots/20). SQLite로 바뀐 뒤의 같은 확인은 벨몬트 통합 세션에서 해야 한다.

---

## 9 — 웹스토어 설치에서 테마 차단

구간 `0x07f8e140`(10,064 B). **원본을 끝까지 읽어 그대로 옮겼다.**

### 원본이 하는 일

`WebstorePrivateBeginInstallWithManifest3Function::ShowInstallDialog(contents)`
(x86_64 `0x07f8f3d0`)의 첫 줄이 이렇다:

```
mov  rax, [rdi + 0x370]      ; dummy_extension_
mov  rax, [rax + 0x228]      ; ->manifest()
cmp  dword [rax + 0x68], 2   ; type() == Manifest::TYPE_THEME ?
jne  ...                     ; 아니면 상위 코드(new ExtensionInstallPrompt::Prompt)
jmp  0x7f900c0               ; 맞으면 테마 거절 대화상자로 꼬리 점프
```

`0x07f900c0`은 `ui::DialogModel::Builder`로 대화상자를 만들어 `chrome::ShowTabModal()`로 띄운다:

| 자리 | 값 | 원본 주소 |
|---|---|---|
| 제목 | `Theme installation failed` (UTF-16) | 0xe998e42 |
| 본문 | `Aside browser does not support themes.` (UTF-16) | 0xe998e76 |
| 버튼 | `OK` (즉석 리터럴 `0x4b004f`) | — |
| 닫힘 콜백 | `0x07f903d0` | — |

닫힘 콜백(`0x07f903d0`)은 `BuildResponse(result=4, "Themes are not supported by Aside browser")`
→ `Respond()` → `Release()`를 한다. 결과 4 = `api::webstore_private::Result::kFeatureDisabled`
(webstore_private.json의 열거 순서로 0 = "", 1 success, 2 user_gesture_required,
3 unknown_error, **4 feature_disabled**). 오류 문자열은 `__cstring 0xd993b80`, 41자.

### 이식

- 새 파일 `chrome/browser/ui/extensions/aside_theme_install_blocked_dialog.cc` —
  상위의 `extension_install_blocked_dialog.cc`와 같은 모양으로
  `ShowAsideThemeInstallBlockedDialog(web_contents, done_callback)`.
- `chrome/browser/ui/extensions/extensions_dialogs.h`에 선언 추가,
  `chrome/browser/ui/extensions/BUILD.gn` `source_set("impl")` sources에 1줄.
- `webstore_private_api.{h,cc}` — `ShowInstallDialog()` 맨 앞에 테마 분기,
  `OnAsideThemeBlockedDialogDone()`이 `kFeatureDisabled` + `kAsideThemesUnsupportedError`로 답한다.

문구 세 개와 결과 코드가 전부 원본 그대로다. 빌드된 바이너리에 문자열이 들어간 것도 확인했다
(아래 "확인 명령").

**라이브 확인 필요.** 진짜 웹스토어에서 테마 설치를 눌러 보는 것은 이 환경(외부 호출 금지)에서
못 한다. 코드 경로(`is_theme()` 분기)와 문자열은 확인했다.

---

## 10 — 확장 메뉴 지표 — **상위 크로미움에 이미 있음**

구간 `0x085de3c0`(8,704 B). 세 가지로 확정했다.

1. 구간 안에 **Aside 고유 문자열이 하나도 없다**(x86dis `str` 모드로 전수).
2. 지표 이름 10개가 **원본과 기준선(cft-171)에서 글자까지 같다**(`grep -cx`로 각 1건씩).
3. 10개 **전부 우리 트리 소스에 이미 있다**:

| 지표 | 우리 트리 |
|---|---|
| `Extensions.Menu.OnClickSelected` | `chrome/browser/ui/extensions/extensions_menu_view_model.cc` |
| `Extensions.Menu.OnAllSitesSelected` | 〃 |
| `Extensions.Menu.OnSiteSelected` | 〃 |
| `Extensions.Toolbar.ExtensionActivatedFromAllowingRequestAccessInMenu` | 〃 |
| `Extensions.Toolbar.ExtensionRequestDismissedFromMenu` | 〃 |
| `Extensions.Menu.HideRequestsInToolbarPressed` | 〃 |
| `Extensions.Menu.ShowRequestsInToolbarPressed` | 〃 |
| `Extensions.Menu.AllowByExtensionSelected` | 〃 |
| `Extensions.Menu.ExtensionsBlockedSelected` | 〃 |
| `Extensions.Toolbar.ExtensionActivatedFromMenu` | `chrome/browser/ui/views/extensions/extensions_menu_button.cc` |

구간에서 나가는 호출 92개의 착지점을 patch-map 구간에 대 봤더니 2개가 "광고 차단 서비스"로
찍혔는데, 그 구간(`0x04815ff0`, 243 KB)의 `top_source_paths`에
`chrome/browser/ui/extensions/extension_action_view_model.cc`가 들어 있다.
실제로 `0x04816d00` 근처 문자열은 `Extensions.Toolbar.InvocationSource`다 —
**광고 차단이 아니라 상위 확장 코드**이고, 구간 이름표가 거칠어서 생긴 착시다.

즉 이 구간의 "덜 만듦"은 컴파일 차이로 블록이 안 맞은 것이고, 우리가 만들 것은 없다.

---

## 그룹 밖 발견 (오케스트레이터에게)

### ① `kColorAside*` 색 66개가 통째로 빠져 있다

원본 바이너리의 색 이름표(x86_64 `0xe60f2d8`, 623개, 배열 순서 = `ui::ColorId` 값)에
**Aside 전용 색이 214번부터 279번까지 66개** 있다. 우리 트리에는 **하나도 없다**.

```
214 kColorAsideSurfacePrimary        215 kColorAsideSurfaceBorder
216 kColorAsideSurfaceBorderStrong   217 kColorAsideAdjacentPaneBorder
218 kColorAsideSurfaceSecondary      219 kColorAsideSurfaceTertiary
...
237 kColorAsideHoverCardBackground   240 kColorAsideFloatingSidebarBackground
242 kColorAsideMenuItemBackgroundHover  243 kColorAsideMenuItemBackgroundSelected
250 kColorAsideTooltipBackground     255 kColorAsideControlProminentBackground
276 kColorAsideToggleThumb           279 kColorAsideToggleHover
```

(전체 66개 이름은 아래 명령으로 그대로 뽑힌다.)

```
python3 -c "
b=open('.../Aside-Framework-1.0.825.1-x86_64','rb').read()
p=0xe60f2d8; out=[]
while True:
    e=b.find(b'\x00',p); s=b[p:e]
    if not s.startswith(b'kColor'): break
    out.append(s.decode()); p=e+1
print([(i,n) for i,n in enumerate(out) if 'Aside' in n])
"
```

세로 띠·프로필 메뉴·툴바·미니팝업 색이 전부 여기 걸려 있으므로, 지금 각 그룹이 쓰는
`ui::kColorSys*` 대체색은 전부 근사치다. **한 그룹에 팔레트 자체를 배정할 가치가 있다**
(`ui/color/color_id.h`에 이름 추가 + `chrome/browser/ui/color/`에 혼합기).
번호가 상위 색과 겹치지 않게 Aside 전용 구간으로 잡아야 하는 점만 주의.

### ② 프로필 발치가 세로 띠 바닥에 고정돼 있지 않다 (G1)

1·2·8 절의 "주의" 참고. 탭이 적을 때 프로필 메뉴 위쪽이 잘린다.

### ③ 세로 띠의 다른 프로필-딸림 부품이 전환을 따라오지 않는다 (G1·G6)

발치 이름은 고쳤지만 북마크 구역·고정 항목·탭 전환기는 옛 프로필을 계속 본다.
`Browser::RegisterAsideProfileSwitched()`를 구독하면 된다 — 자리는 만들어 뒀다
(4번 항목 "남은 차이" 참고).

### ④ 겹치는 자리 — 넘긴 것

- 미니팝업의 프로필 전환 → **G4**. `chrome::SwitchProfileInPlaceForAside()`를 그대로 부르면 된다
  (`chrome/browser/ui/browser_commands.h:123`).
- 세로 띠 발치의 "프로필 지시 아이콘" 표시, 설정의 Aside Account 구역 → **G6**.
  아이콘 이름표는 `aside::ProfileIndicatorIcons()`
  (`chrome/browser/ui/views/profiles/profile_monogram_avatar_view.h:41`)에서 가져다 쓰면 된다 —
  원본과 이름·순서가 47개 전부 같다.

### ⑤ 상위 크로미움 파일 두 개에 Aside 전용 hunk가 들어갔다 (충돌 주의)

- `chrome/browser/ui/unload_controller.{h,cc}` — `ResetForAsideProfileSwitch()` 추가.
- `chrome/browser/ui/browser_manager_service.{h,cc}` — `AddBrowserForAsideProfileSwitch()` 추가.

둘 다 페이저 없이는 불필요한 코드라, 상위 리베이스 때 이 두 함수가 페이저와 세트임을 기억해야 한다.

---

## 만든/고친 파일

내가 이번에 만든 것 (새 파일 1개):

| 파일 | 항목 |
|---|---|
| `chrome/browser/ui/extensions/aside_theme_install_blocked_dialog.cc` (신규) | 9 |

내가 이번에 고친 것:

| 파일 | 항목 |
|---|---|
| `chrome/browser/ui/extensions/extensions_dialogs.h` | 9 |
| `chrome/browser/ui/extensions/BUILD.gn` | 9 |
| `chrome/browser/extensions/api/webstore_private/webstore_private_api.{h,cc}` | 9 |
| `chrome/browser/ui/views/desktop_capture/desktop_media_tab_list.{h,cc}` | 6 |
| `chrome/browser/ui/browser_manager_service.{h,cc}` | 4 (결함 ①) |
| `chrome/browser/ui/browser.{h,cc}` | 4 (결함 ②③, 추적 이름, 프로필 전환 콜백) |
| `chrome/browser/ui/unload_controller.{h,cc}` | 4 (결함 ③) |
| `chrome/browser/ui/browser_commands.cc` | 4 (호출 자리, posted 해제) |
| `chrome/browser/ui/views/frame/aside_profile_footer_view.{h,cc}` | 4 (전환 뒤 프로필 이름 갱신) — 파일 자체는 G1 것, 내 hunk는 pref 재등록 + 콜백 구독 |

앞 담당이 만들어 두고 내가 확인만 한 것 (패치에는 함께 들어간다):

`chrome/browser/ui/views/profiles/aside_profile_menu_view.{h,cc}`,
`profile_monogram_avatar_view.{h,cc}`, `chrome/browser/profiles/profile_attributes_entry.{h,cc}`,
`chrome/browser/profiles/aside_account_password_gate*.{h,cc}`,
`chrome/browser/notifications/aside_inbox_delivery.{h,cc}`,
`aside_notification_sync_service_factory.{h,cc}`,
`chrome/browser/notifications/{BUILD.gn, platform_notification_service_impl.cc}`,
`chrome/browser/ui/tabs/tab_strip_model.h`, `chrome/browser/ui/browser_commands.h`,
`chrome/browser/profiles/chrome_browser_main_extra_parts_profiles.cc`.

패치 스냅샷: `aside-fork/patches/041-G3.patch`.
(`aside_profile_footer_view.{h,cc}`는 트리에서 추적되지 않은 상태였다 — `git add -N` 해 두었으므로
패치에는 **파일 전체**가 들어간다. 내용 자체는 G1/이전 세션 것이고 내 변경은 위 표의 hunk뿐이다.)

## 확인 명령 모음

```
# 원본 문구 대조 (UTF-16)
python3 -c "b=open('.../Aside-Framework-1.0.825.1-x86_64','rb').read();
print(hex(b.find('Aside browser does not support themes.'.encode('utf-16-le'))))"

# Aside 전용인지 기준선 대조
strings -a '.../cft-171/.../Google Chrome for Testing Framework' | grep -c BorderOnTopView   # 0
strings -a '.../aside/Aside-Framework-1.0.825.1-x86_64'          | grep -c BorderOnTopView   # 1

# 원본 코드 읽기
python3 re-tools/x86dis.py 0x7f900a0 0x7f90260          # 테마 거절 대화상자
python3 re-tools/x86dis.py 0x4895b30 0x4895c20          # BorderOnTopView::PaintChildren
python3 re-tools/x86dis.py 0x4bc7560 0x4bd6b20 str      # 페이저 추적 이름

# 빌드된 바이너리에 문구가 들어갔는지
strings -a /home/hoon/chromium/src/out/aside/chrome | grep -c "Themes are not supported by Aside browser"
```

## 빌드

전부 `flock /tmp/aside-ninja.lock` 안에서 `./third_party/ninja/ninja -C out/aside chrome -j4 -l 6`.
autoninja 안 씀. 빌드 중에는 크롬·Xvfb를 띄우지 않았다.

| 회차 | 시각 | 무엇 | FAILED |
|---|---|---|---|
| 1 | 12:55–12:56 | 테마 차단 + BorderOnTopView 첫 빌드 | 0 |
| 2 | 13:04–13:05 | 페이저 결함 ①(`AddBrowserForAsideProfileSwitch`) | 0 |
| 3 | 13:06–13:27 | 페이저 결함 ②(보관 프로필 keep-alive) | 0 |
| 4 | 13:29–13:30 | 원본 추적 이름 · posted 억제 해제 | 0 |
| 5 | 13:36–13:53 | 발치 재바인딩(`RegisterAsideProfileSwitched`) | 0 |
| 6–8 | 14:14 / 14:18 / 14:19 | 진단용 임시 로그·스택 추적 | 0 |
| 9 | 14:24–14:45 | 페이저 결함 ③(`UnloadController::ResetForAsideProfileSwitch`) | 0 |
| 10 | 14:49 | 페이저 결함 ④(세션 재구축에서 복원 제거) | 0 |
| **11 (최종)** | **14:56:26 → 14:57:27** | **임시 로그 전부 제거** | **0** |

최종 빌드 로그 `/tmp/aside-build-G3.log`, 그때의 `out/aside/chrome` mtime **2026-09-06 14:57**
(빌드 시작 14:56:26 뒤 → 정상), 크기 1,755,722,208 B.
최종 바이너리에 진단 로그 문자열(`ASIDEPAGER`)이 **0개**임을 `strings`로 확인했고,
그 바이너리로 프로필 왕복을 한 번 더 통과시켰다(위 캡처가 그 실행의 것이다).

**넘길 때의 트리 상태**: 15:25 잠금 안에서 `ninja … chrome` → `no work to do`, FAILED 0,
`out/aside/chrome` 15:20(다른 그룹들이 그 사이 커밋 없이 빌드한 것). **트리는 빌드되는 상태로 남긴다.**

동시에 도는 다른 그룹의 반쯤 저장된 파일 때문에 두 번 잠깐 깨졌다 — 둘 다 그 그룹 파일이고
손대지 않았으며, 잠시 뒤 다시 돌리니 통과했다.

| 시각 | 깨진 것 | 누구 |
|---|---|---|
| 14:13 | `chrome/renderer/aside_adblock/aside_adblock_render_frame_observer.cc` 컴파일 오류 | G4 |
| 15:03–15:18 | 링크: `aside::SearchboxPageMirror::Get()` / `::AutocompleteResultChanged()` 미정의 | G4 |

## 정리

- 독립 크롬(:113, CDP 9413, `/tmp/aside-ui-G3`)과 Xvfb :113은 작업 끝에 종료했고
  프로필 폴더도 지웠다. 다른 그룹의 화면(:100·:101·:106)과 크롬은 건드리지 않았다.
- 라이브 데몬(21420)·호스트·서비스·tmux는 만지지 않았다. Aside 확장은 한 번도 로드하지 않았다.
- 커밋·stash·checkout·reset 없음. 새 파일은 `git add -N`만 했다
  (내 새 파일 1개 + 앞 담당이 빠뜨린 알림 파일 4개 + G1의 발치 파일 2개).
- 진단용 임시 로그는 전부 지웠고, 지운 상태로 다시 빌드해 동작을 한 번 더 확인했다.
- 트리는 성공 상태로 남긴다 — 최종 빌드 FAILED 0, `out/aside/chrome` 14:57.

### 라이브 확인이 남은 것 (정직하게)

| 무엇 | 왜 여기서 못 하나 |
|---|---|
| 알림 인박스 종단(권한 → 알림 → SQLite 행 1개) | `IsExtensionEnabled()` 관문 때문에 **진짜 Aside 확장**이 필요하다. COMMON.md가 확장 로드를 금지 |
| 웹스토어 테마 차단 대화상자 실물 | `webstorePrivate.beginInstallWithManifest3`은 웹스토어 출처에서만 불린다. 외부 호출 없이 못 띄운다. 코드 경로(`is_theme()` 분기)와 문자열 4개는 확인 |
