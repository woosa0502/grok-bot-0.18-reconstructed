# HEAL-RESULT — 트리 빌드 복구 (2026-09-06)

담당: 빌드 복구 (기능 추가 없음, 컴파일·링크 오류만).
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`, 작업 트리 그대로(커밋·stash·checkout·reset 없음).

## 한 줄 결론

**`chrome` 타깃 빌드·링크 성공. FAILED 0. 바이너리 실행·CDP 응답 확인.**
고친 컴파일 오류 17개 + 실행 중 죽던 문제 1개. 주석 처리한 미완성 편집 **0개** (전부 의도를 살려 고쳤음).

## 최종 상태

| 항목 | 값 |
|---|---|
| 마지막 실제 빌드 | 2026-09-06 11:37:48 시작 → 11:38:13 끝 (`/tmp/aside-build-heal4.log`) |
| 마지막 확인 빌드 | 2026-09-06 11:40:08 (`/tmp/aside-build-heal-final.log`, "no work to do") |
| 로그 `grep -c FAILED` | 0 (heal4, heal-final 둘 다) |
| `out/aside/chrome` mtime | 2026-09-06 11:38 (빌드 시작 11:37:48 뒤 → 정상) |
| 바이너리 크기 | 1,755,570,520 B |
| CDP 응답 | 예 — `Chrome/151.0.7922.171`, `ws://127.0.0.1:9417/devtools/browser/dd215804-...` |
| UI 렌더 | 예 — 세로탭(New Chat / Tidy / Organizer / Tab Groups / Bookmarks / Recent Chats & Threads / 프로필 발치) 정상 |
| 빌드 중 최대 메모리 | used 9,494 MB (전체 15 GB), 남은 여유 6,498 MB, swap 최대 479 MB (20초 간격 102 표본, `/tmp/aside-heal/mem.log`) |

빌드는 전부 `flock /tmp/aside-ninja.lock` 안에서 `gn gen out/aside` → `ninja -C out/aside chrome -j4 -l 6`. autoninja 안 씀. 빌드 중에는 호스트·서비스·크롬·Xvfb 안 띄움.

## 시작할 때 상황 — 옛 로그는 이미 낡아 있었다

넘겨받은 로그 4개(`/tmp/aside-build-G2/G3/G4/G6.log`)의 오류는 **재부팅 전에 담당들이 이미 고친 것**이었다. 파일을 하나씩 열어 확인한 결과:

| 옛 로그의 오류 | 현재 트리 |
|---|---|
| `aside_sync_refresh_watchdog.cc:80` TriggerRefresh 인자 부족 | 이미 2인자로 고쳐짐 |
| `aside_sync_encryption_controller.cc` / `aside_sync_auth_manager.cc` URLResponseHead 불완전 타입 | `url_response_head.mojom.h` 이미 포함됨 |
| `aside_sync_auth_manager.cc:266` `base::DoNothing` 없음 | `callback_helpers.h` 이미 포함됨 |
| `profile_monogram_avatar_view` ProfileThemeColors / ImageSkia / raw_ptr | 이미 include·RAW_PTR_EXCLUSION 들어감 |
| `aside_profile_menu_view.cc` ShouldNotBeVisible / LiveTabContext / Button 보호 생성자 | 이미 고쳐짐 |
| `pinned_tab_service.cc:101` OpenURLParams 생성자 | 이미 `content::Referrer(...)`로 고쳐짐 |

그래서 새로 빌드를 돌려 **실제로 지금 깨지는 것**을 찾았다(`/tmp/aside-build-heal.log`, 11:05:37). FAILED 24개, 뿌리는 9개 파일.

## 고친 오류 목록

`-k 50`으로 한 번에 여러 오류를 모은 뒤 뿌리부터 고쳤다. 빌드 3회(heal → heal2 → heal3) + 실행 중 죽는 문제 고치고 1회(heal4).

### 1. `chrome/browser/ui/views/frame/aside_toolbar_collapse_hover_monitor.h` — G6 (툴바 접기 호버 타이머)

- 오류: `:62:22`, `:63:22` `[chromium-rawptr] Use raw_ptr<T> instead of a raw pointer.`
- 파급: 이 헤더 하나 때문에 **16개 타깃**이 같이 깨졌다(browser_view, tab_strip_view, vertical_tab_strip_* 등). 24개 FAILED 중 대부분이 여기서 나왔다.
- 고침: `region_`, `collapse_button_` 두 멤버를 `raw_ptr<const views::View>`로 바꾸고 `base/memory/raw_ptr.h` 포함. 타이머 의도(구역·접기 버튼 두 뷰를 붙잡고 100 ms마다 포인터 위치를 본다)는 그대로.

### 2. `chrome/browser/ui/views/frame/aside_toolbar_collapse_hover_monitor.cc` — G6

- 오류: `:20:46` `no member named 'GetScreen' in 'display::Screen'`
- 고침: 이 트리의 이름은 `display::Screen::Get()` 이라 그것으로 바꿈.

### 3. `chrome/browser/ui/views/frame/aside_bookmark_tab_representation.h/.cc` — G6 (북마크가 열린 탭을 대표)

- 오류 ①: `.h:80:48` `only virtual member functions can be marked 'override'` — 이 트리의 관찰자 콜백 이름이 `TabChangedAt(content::WebContents*, ...)`이 아니라 `OnTabChangedAt(tabs::TabInterface*, int, TabChangeType)`.
- 고침 ①: 선언·정의를 `OnTabChangedAt(tabs::TabInterface* tab, int index, TabChangeType change_type)`로 맞추고 `tabs::TabInterface` 전방 선언 + `components/tabs/public/tab_interface.h` 포함. 몸통(`kAll`이면 다시 계산)은 그대로.
- 오류 ②: `.cc:74:49` `no viable conversion from 'std::string_view' to 'std::string'` — 이 트리의 `GURL::host()`는 `std::string_view`를 돌려준다.
- 고침 ②: `std::string(url.host())`로 감쌈. `<string>` 포함 추가.

### 4. `chrome/browser/ui/views/frame/aside_bookmarks_section_view.cc` — G6 (북마크 구역)

- 오류: `:227:59` `no member named 'kColorIconActive' in namespace 'ui'`
- 고침: 열린 탭을 대표하는 북마크 줄의 아이콘을 눈에 띄게 칠하려는 의도이므로, 이 트리에 있는 강조색 `ui::kColorSysPrimary`로 바꿈. (같은 포크의 프로필 메뉴가 "현재 항목"에 강조색을 쓰는 방식과 같은 취지.)

### 5. `chrome/browser/notifications/aside_inbox_delivery.cc` — G3 (AsideInbox 알림 SQLite 저장)

- 오류 ①: `:112:9` `no member named 'FileEnumerator' in namespace 'base'` (+ 뒤따르는 `files` 미선언 2개)
- 오류 ②: `:125:47` `no member named 'JSONReader' in namespace 'base'`
- 고침 ①②: `base/files/file_enumerator.h`, `base/json/json_reader.h` 포함 추가.
- 오류 ③ (①② 고친 뒤 드러남): `:127:68` `too few arguments to function call, expected at least 2, have 1` — 이 트리의 `base::JSONReader::Read`는 `options`가 필수.
- 고침 ③: `base::JSONReader::Read(json, base::JSON_PARSE_RFC)`. 같은 파일의 다른 자리와 같은 파싱 방식.

### 6. `chrome/browser/ui/views/page_info/page_info_reload_bubble_view.cc` + `ui/views/bubble/bubble_dialog_delegate_view.h` — G2 (page_info 재적재 버블)

- 오류: `:67:7` `base class 'views::BubbleDialogDelegateView' has private default constructor`
- 원인: 이 트리에서 `BubbleDialogDelegateView(BubbleAnchor, Arrow, Shadow, autosize)` 생성자는 **private**이고, 쓰려면 친구(friend) 목록에 들어가야 한다. 상위 크로미움의 버블 30여 개가 전부 그렇게 등록되어 있다.
- 고침: 상위 코드의 방식 그대로 `bubble_dialog_delegate_view.h`에 전방 선언 `class PageInfoReloadBubbleView;`와 `friend class ::PageInfoReloadBubbleView;` 두 줄만 추가(`PageInfoBubbleViewBase` 바로 옆, 알파벳 자리). 버블 쪽 코드는 손대지 않음.
- 참고: 공유 파일이라 편집 직전에 다시 읽었고, 그 파일에는 다른 그룹의 hunk가 없었다(추가 2줄이 전부).

### 7. `chrome/browser/ui/webui/aside_import_data/aside_import_data_ui.cc` + 같은 폴더 `BUILD.gn` — G4 (가져오기 WebUI)

- 오류 ①: `:51:10` `fatal error: 'ui/base/models/simple_menu_model.h' file not found` — 이 트리에서 그 헤더는 `ui/menus/simple_menu_model.h`로 옮겨졌고 타깃도 `//ui/menus`.
- 고침 ①: include 경로를 바꾸고 `BUILD.gn` deps에 `//ui/menus` 추가.
- 오류 ② (①을 고친 뒤 드러남): `:274:29` `incomplete type 'ui::mojom::MenuSourceType'`
- 고침 ②: `ui/base/mojom/menu_source_type.mojom.h` 포함 + deps에 `//ui/base/mojom:ui_base_types` 추가.
- 오류 ③: `:380:63` `too few arguments to function call, at least argument 'path' must be specified` — `base::GetDeletePathRecursivelyCallback(path)`는 이미 `OnceClosure`를 돌려주므로 `base::BindOnce`로 한 번 더 감쌀 수 없다.
- 고침 ③: `base::GetDeletePathRecursivelyCallback(target)`를 그대로 `PostTask`에 넘김. (프로필 폴더를 지우는 동작은 동일.)

### 8. `chrome/browser/ui/webui/aside_importer/chromium_profile_migrator.cc` — G4 (Chromium 계열 프로필 가져오기)

- 오류 ①: `base::Value::Dict` / `base::Value::List` 없음 (9자리, 오류 12개) — 이 트리의 이름은 `base::DictValue` / `base::ListValue`.
- 고침 ①: 이름만 바꿈 (같은 포크의 `aside_inbox_delivery.cc`가 이미 `base::DictValue`를 쓰고 있어 표기를 맞춘 것).
- 오류 ②: `:96:27` `unsafe buffer access [-Werror,-Wunsafe-buffer-usage]` — `HomeRelative(const char* const* segments, size_t count)`의 `segments[i]`.
- 고침 ②: 서명을 `HomeRelative(base::span<const char* const> segments)`로 바꾸고 범위 for로 순회. 호출 12곳에서 `std::size(segments)` 인자를 뺌(`base/containers/span.h` 포함 추가). 각 브라우저별 홈 상대 경로 표는 그대로.

### 9. `chrome/browser/ui/webui/aside_importer/safari_archive.cc` — G4

- 오류: `base::Value::List` / `base::Value::Dict` 없음 (2자리)
- 고침: 8번과 같은 이름 바꾸기.

### 10. `chrome/browser/extensions/api/aside_browser_preferences/aside_browser_preferences_api.cc` — G6 (browserPreferences 확장 API)

- 오류: `:524:32`, `:526:38` `no member named 'GetLocalDeviceNameForTest' in 'syncer::SyncService'` — 이 트리의 SyncService에는 그런 함수가 없다(테스트용 이름을 실제 코드에서 부르고 있었다).
- 고침: 의도(`getSyncStatus` 응답에 이 기기 이름 `deviceName`을 넣는 것)를 살려 정식 경로로 바꿈 — `DeviceInfoSyncServiceFactory::GetForProfile(profile)` → `GetLocalDeviceInfoProvider()` → `GetLocalDeviceInfo()->client_name()`. 셋 중 하나라도 없으면 빈 문자열.
- 배선: `chrome/browser/extensions/api/aside_browser_preferences/BUILD.gn` deps에 `//components/sync_device_info` 추가. `DeviceInfoSyncServiceFactory` 헤더를 다른 타깃에서 쓸 수 있도록 `chrome/browser/sync/BUILD.gn`의 `source_set("factories")` sources에 `device_info_sync_service_factory.h` 한 줄 추가(이미 `sync_service_factory.h`가 같은 방식으로 들어가 있음).

### 11. `chrome/browser/ui/tabs/pinned_tab_service.cc` — G1 (고정 탭 이동 차단) — **실행 중 죽던 문제**

컴파일은 통과했지만 **바이너리가 뜨자마자 SEGV로 죽었다.** CDP 확인이 여기서 막혀서 고쳤다.

- 증상: `Received signal 11 SEGV_MAPERR 000000000010`
- 스택: `PinnedTabNavigationThrottle::MaybeCreateAndAdd()` (`pinned_tab_service.cc:52`) → `tabs::TabInterface::GetFromContents()` → 널 참조. 부르는 쪽은 옴니박스 팝업 WebUI를 미리 띄우는 `WebUIContentsPreloadManager`로, **탭이 아닌 WebContents**다.
- 고침: 두 자리(`:52`, `:94`)를 `tabs::TabInterface::MaybeGetFromContents(...)`로 바꿈. 이 함수는 크로미움이 "탭인지 모르는 //content 근처 코드는 이걸 써라"라고 문서에 적어 둔 것이고, 뒤따르는 `if (!tab || !tab->IsPinned()) return PROCEED;` 검사가 이미 널을 받도록 쓰여 있었다. 고정 탭 판정 로직은 그대로.

## 주석 처리한 미완성 편집

**없음 (0개).**

깨진 편집 전부가 "무엇을 하려 했는지"가 코드와 주석에 분명히 남아 있어서, 되돌리거나 `#if 0`으로 막지 않고 **그 의도를 살리는 최소 수정**으로 끝냈다. 남의 완성된 코드를 지운 곳도 없다. 그룹별로 이어받아야 할 미완성 hunk는 없다.

다만 아래 두 가지는 원 담당이 **확인해 두면 좋다** (동작은 하지만 판단이 필요한 자리):

| 그룹 | 자리 | 내가 고른 값 | 확인해 볼 것 |
|---|---|---|---|
| G6 | `aside_bookmarks_section_view.cc:227` | `ui::kColorSysPrimary` | 원본이 쓰던 강조색과 색조가 맞는지 (원본 값은 없어진 `kColorIconActive`) |
| G6 | `aside_browser_preferences_api.cc` `deviceName` | `DeviceInfo::client_name()` | 원본 `getSyncStatus`가 돌려주던 이름과 같은 문자열인지 |

## 빌드 기록

| 회차 | 로그 | 시작 | FAILED | 결과 |
|---|---|---|---|---|
| 1 | `/tmp/aside-build-heal.log` | 11:05:37 | 24 | 뿌리 파일 9개 확인 |
| 2 | `/tmp/aside-build-heal2.log` | 11:16:43 | 2 | 새로 드러난 오류 3개 |
| 3 | `/tmp/aside-build-heal3.log` | 11:32:55 | 0 | 링크 성공 (11:33) |
| 4 | `/tmp/aside-build-heal4.log` | 11:37:48 | 0 | SEGV 고치고 재링크 (11:38) |
| 5 | `/tmp/aside-build-heal-final.log` | 11:40:08 | 0 | 확인용, "no work to do" |

`gn gen out/aside`는 매 회차 같은 잠금 안에서 먼저 돌렸다(BUILD.gn 3개를 건드렸으므로).

## 실행 확인 (한 번만)

```
Xvfb :117 -screen 0 1280x800x24 &
DISPLAY=:117 /home/hoon/chromium/src/out/aside/chrome --no-sandbox --no-first-run \
  --user-data-dir=/tmp/aside-ui-heal --remote-debugging-port=9417 about:blank &
curl -s http://127.0.0.1:9417/json/version
```

응답:

```json
{
   "Browser": "Chrome/151.0.7922.171",
   "Protocol-Version": "1.3",
   "V8-Version": "15.1.206.21",
   "webSocketDebuggerUrl": "ws://127.0.0.1:9417/devtools/browser/dd215804-6f34-47b1-b5d0-3df9501b98fa"
}
```

- 처음에는 `--no-first-run` 없이 띄웠더니 최초 실행 약관 창("This Space Intentionally Blank")이 떠서 브라우저 시작이 거기서 멈췄고, DevTools 서버가 열리기 전이라 CDP가 비어 있었다. 확인용 실행이라 `--no-first-run`을 붙여 다시 띄웠다.
- 화면 캡처로 세로탭 UI가 정상 렌더되는 것도 확인(New Chat / Tidy / Organizer / Tab Groups / Bookmarks / Recent Chats & Threads / 프로필 발치). 로그에 SEGV 없음.
- 확인 끝나고 크롬·crashpad·Xvfb :117 전부 종료, `/tmp/aside-ui-heal` 삭제. 포트 9417 반납 확인. 포트 9333/9340/21420은 건드리지 않음.

## 안 한 것

- 커밋·stash·checkout·reset 없음. `git status`의 254개 변경은 그대로(+ 내가 고친 파일들).
- 기존 결과 문서(G1-RESULT.md, G5-RESULT.md)·패치·아티팩트 수정 없음. 이 문서 하나만 새로 씀.
- 기능 추가 없음. 새 파일 없음. BUILD.gn 변경 3개는 전부 "빠진 dep/소스 채우기"뿐.
