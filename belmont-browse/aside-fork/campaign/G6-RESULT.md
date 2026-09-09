# G6-RESULT — 정체 미상·겉만·덜 만듦 + 추가 후보 + 이관 (2026-09-06)

담당: G6 (세 번째 담당이 마무리). 트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`,
작업 트리 그대로(커밋·stash·checkout·reset 없음). 쓴 모델: **Opus 5 (1M context)**.

앞선 두 담당이 남긴 코드는 지우지 않고 이어받았다. 이 문서는 15개 항목 전부의 최종 상태다.

## 한 줄 결론

**15개 중 12개 재현 완료, 3개 불가(정체 미상).** 정체 규명은 5군데 중 1군데 성공(0x04c65910),
1군데 반쯤(0x0d145880), 3군데 실패. 마지막 빌드 2026-09-06 16:10:06 시작 → 16:10:39 링크 성공,
`grep -c FAILED` = **0**.

## 최종 상태 표

| 항목 | 값 |
|---|---|
| 마지막 빌드 | 2026-09-06 16:10:06 시작 → 16:10:39 끝 (`/tmp/aside-build-G6.log`) |
| 로그 `grep -c FAILED` | **0** |
| `out/aside/chrome` mtime | 2026-09-06 16:10:39 (빌드 시작 뒤 → 정상) |
| 바이너리 크기 | 1,755,961,560 B |
| CDP 응답 | 예 — `Chrome/151.0.7922.171`, 포트 9416 |
| 실행 중 크래시 | 없음 (`grep -c "SEGV\|FATAL\|Check failed" /tmp/aside-ui-G6.log` = 0) |
| 화면 | :116 (Xvfb), user-data-dir `/tmp/aside-ui-G6` — 확인 뒤 전부 종료·삭제 |
| 패치 | `patches/041-G6.patch` (55개 파일, 9,035줄) |

빌드는 `flock /tmp/aside-ninja.lock` 안에서 `gn gen out/aside` → `ninja -C out/aside chrome -j4 -l 6`.
autoninja 안 씀. 포트 9333/9340/21420은 건드리지 않았다.

---

## 1. 15개 항목별 결과

start_hex 있는 것은 `usecases/RESTORATION-MAP-2026-09-06.md` 60군데 표의 "우리 상태"를 이걸로 갱신할 수 있다.

| # | 구간·이름 | 이식 길 | 상태 | 확인 |
|---|---|---|---|---|
| 1 | `0x048f2710` 확장 API 구현 (browserImport / omnibox / browserPreferences) | 1+2 | **재현 완료** | 원본 함수 63개 전부 존재, 문자열 대조로 남은 8군데 채움 (아래 2절) |
| 2 | `0x04c65910` (미확인 18,336 B) | — | **불가 → 정체 규명 성공** | 링크 이웃·호출 대상으로 `horizontal_tab_strip_region_view.cc`(포크가 늘린 쪽)로 좁힘. 코드는 이미 `aside_pinned_entries_view.*`로 들어가 있음 (아래 3절) |
| 3 | `0x0d0013f0` WebUI 인터페이스 바인더 목록 (덜 만듦) | 2 | **재현 완료** | `tab_search::mojom::PageHandlerFactory`를 프레임 바인더 맵에 추가 (원본 133개 vs CFT 132개의 차이 하나) |
| 4 | `0x045dd200` (미확인 10,160 B) | — | **불가(정체 미상)** | 3절에 시도한 방법과 근거 |
| 5 | `0x049ca150` (미확인 7,728 B) | — | **불가(정체 미상)** | 3절 |
| 6 | `0x047c51f0` (미확인 3,856 B, 해시맵 인라인) | — | **불가(정체 미상)** | 3절 |
| 7 | `0x0d145880` (미확인 3,008 B) | — | **불가(정체 미상, 반쯤 좁힘)** | 3절 |
| 8 | 북마크가 열린 탭을 대표하는 구조 | 3 | **재현 완료** | `ui-shots/G6-bookmark-tab-representation*.png` |
| 9 | `chrome://settings`의 "Aside Account" 구역 | 1 | **재현 완료** | `ui-shots/G6-settings-aside-account.png` |
| 10 | 비밀번호 관리자 툴바 버튼 자동 고정 pref | 1+2 | **재현 완료** | 코드 근거 (아래 4절). 확장이 있어야 보임 → 라이브 확인 필요 |
| 11 | 확장 페이지 배경색 측정 | 3 | **재현 완료** | 코드 근거 (`contents_web_view.cc:216`), 라이브 확인 필요 |
| 12 | 툴바 접기 버튼 호버 타이머 | 1+3 | **재현 완료 (이번에 채움)** | 100 ms 감시 타이머만 있었고 **500 ms 종료 타이머가 없었다.** `ui-shots/G6-collapse-hover-*.png` |
| 13 | 프로필 지시 아이콘 | 3 | **재현 완료** | `ProfileIndicatorIconButton` / `ProfileIndicatorIconPickerPanel` 둘 다 트리에 있음 |
| 14 | `0x0474d900` 옴니박스 제안 UI의 두 번째 `searchbox.mojom.Page` 연결 (G2 이관) | 2+3 | **재현 완료 (이번에 속 채움)** | Page 메서드 22개 중 16개가 빈 함수였다. 스키마에 이미 선언된 이벤트로 전부 이었다 (아래 5절) |
| 15 | 확장 권한 문구 IDS 10347~10351 (G4 이관) | 1 | **재현 완료** | 여섯 개 넣음(10346 포함). 빌드된 `out/aside/locales/en-US.pak`에서 문자열 확인 |

**완료 12 / 불가 3.** 불가 3개는 전부 "정체 미상" 범주이고, 기능을 못 만든 것이 아니라
**무슨 기능인지 못 밝힌 것**이다.

---

## 2. 항목 1 — 확장 API 구간(`0x048f2710`)의 "겉만"이 정확히 무엇이었나

### 어떻게 잰 것인가

`re-tools/aside-run-analysis.json`은 원본 arm64에서 확장 함수 77개의 `Run()` 주소·참조 문자열·호출
순서를 뽑아 둔 표다. 여기서 세 이름공간 함수 **63개**를 골라, 각 함수가 참조하는 문자열이
우리 트리의 `chrome/browser/extensions/api` + `chrome/common/extensions/api` 소스 안에 있는지
기계로 대조했다.

- 함수 이름 기준 **63/63 전부 존재** (안 만든 함수 없음).
- 문자열 기준 **49개는 완전 일치**, 11개에서 차이가 나왔고 그중 8개가 진짜 빠진 것이었다
  (나머지는 `spellcheck::prefs::kSpellCheckEnable` 같은 **상수로 참조되는 pref 이름**이라 오탐).

### 채운 것 (전부 원본 역어셈블 근거)

| 함수 | 빠져 있던 것 | 원본 근거 | 고침 |
|---|---|---|---|
| `asideOmnibox.queryAutocomplete` | `cursorPosition` | RE 0x405bb40 | `AutocompleteInput`의 캐럿 인자로 전달. 상위 `SearchboxHandler::QueryAutocomplete`와 같은 클램프. 키워드 접두사가 붙으면 캐럿도 같이 밀린다 |
| `asideOmnibox.openAutocompleteMatch` | `areMatchesShowing`, `viaKeyboard` | RE 0x405c300 — 꼬리가 `(handler, line, url, areMatchesShowing, mouseButton, altKey, ctrlKey, metaKey, shiftKey, viaKeyboard)` **9인자 호출**, 즉 `SearchboxHandler::OpenAutocompleteMatch`와 서명이 같다 | 둘 다 읽어 세션에 기록(`NoteMatchOpened`). 매치를 열면 상위처럼 자동완성을 `kInteraction`으로 멈춘다 |
| `asideOmnibox.activateKeyword` | `isMouseEvent` | RE 0x405e0c0 — 읽고 **버린다**(꼬리 호출은 `(handler, line, url)` 3인자) | 읽되 타입만 검사. 원본과 같은 "받고 안 쓴다" |
| `asideOmnibox.onNavigationLikely` | `navigationPredictor` (그리고 함수 전체가 빈 응답이었다) | RE 0x405d580 — 문자열 `"mouseDown"` / `"upOrDownArrowButton"` / `"touchDown"`을 각각 1·2·3으로 접는 비교가 그대로 보인다 | `omnibox::mojom::NavigationPredictor`로 접고 `SearchPrefetchService` + `SearchPreloadService`의 `OnNavigationLikely`를 부른다 (상위 `SearchboxHandler`와 같은 두 호출) |
| `asideOmnibox.addFileContext` | `imageDataUrl`, `isDeletable`, `selectionTimeMs`, 오류 문구 `Invalid bytesBase64 payload` | RE 0x405ffc0 | `searchbox.mojom`의 `SelectedFileInfo` 나머지 필드를 컨텍스트 저장소에 넣었다. `isDeletable:false`인 컨텍스트는 `deleteContext`가 거부한다(그 필드의 뜻이 "UI에서 지울 수 있는가"이고 `deleteContext`가 그 UI 경로다). `imageDataUrl`은 `data:image/`가 아니면 거부 — 저장된 값이 네트워크 요청으로 변할 길을 막았다 |
| `asideBrowserImport.startImport` | `chatgpt-atlas` | RE 0x404f988 (`"chatgpt-atlas"`와 `"atlas"`가 같이 있다) | `chatgpt-atlas`를 `atlas`의 별칭으로 받는다 |

`getLanguageSettings` / `setSpellCheckEnabled`의 `browser.enable_spellchecking`은 **오탐**이었다 —
트리는 `spellcheck::prefs::kSpellCheckEnable` 상수로 같은 pref를 쓰고 있다.
`createSession`의 `Contextual search service is unavailable`는 **의도적 차이**다:
그 서비스가 이 포크에 없어서 오류 대신 `aimEligible:false`를 돌려주고, 그 판단은 코드 주석에 남아 있다.

---

## 3. 정체 미상 5군데 — 무엇을 알아냈고 왜 못 밝혔나

옛 담당들의 근거는 "문자열 참조 없음"뿐이었다. 이번에 **네 가지 방법**을 더 썼다.

1. **링크 이웃 괄호치기.** `analysis/function-match/aside825_text_path_refs.jsonl.gz`(원본 __text에서
   소스 경로 문자열을 참조하는 자리 15,872개)로 각 구간의 앞뒤를 가장 가까운 소스 파일로 묶었다.
   맥 링커는 같은 폴더의 오브젝트를 이름순으로 붙이므로 앞뒤를 알면 후보가 좁혀진다.
2. **호출 대상 해석.** 구간 안 블록만 정확히 디스어셈블(언와인드 블록 경계에서 시작해 skipdata
   오정렬을 피함)해 호출 대상을 모으고, 각 대상을 그 대상이 속한 언와인드 블록의 소스 경로로 풀었다.
3. **CFT 대조.** 같은 앵커 문자열이 상위 CFT 151.0.7922.171에 몇 자리 있는지 세어
   "포크가 늘린 자리"인지 판별.
4. **vtable/RTTI.** __DATA_CONST의 체인드 픽스업(36비트 마스크)을 풀어 구간을 가리키는 vtable 슬롯을
   찾았다. **RTTI가 없어 이름은 못 얻었다** — 크로미움은 `-fno-rtti`로 빌드된다. 이것이 이 다섯
   군데에서 이름을 못 얻은 근본 이유다.

### 2번 `0x04c65910`–`0x04c6a320` (18,336 B) — **정체 규명 성공**

- 앞: `contents_container_view.cc`(-0x125e1), 뒤: `horizontal_tab_strip_region_view.cc`(+0x18a5).
- 구간이 그 파일의 함수들(`0x04c6b500` `FinishEntryDrag`, `0x04c6c380` `HorizontalPinnedTabEntriesView::EntryView`)을 **9번 호출**한다.
- CFT에는 `horizontal_tab_strip_region_view.cc` 참조 자리가 **1군데**, 원본에는 **4군데**(그중
  `0x419ecd7`은 CFT의 `0x41a22b7`와 같은 자리, 나머지 3군데는 `0x4c6b`–`0x4c6c`의 새 무리).
  → 이 무리 전체가 포크가 덧붙인 코드다.
- 크기+명령수가 같은 상위 블록이 **26%**뿐 → 대부분 새 코드.
- 구간 머리는 `add rdi, -0x308 ; jmp <dtor>` 꼴의 **비가상 썽크 묶음**(다중 상속 View 파생 클래스),
  가운데에 7,680 B·5,632 B짜리 큰 블록 둘.

**결론**: 세로/가로 고정 탭 칩 계통의 문자열 없는 앞부분. 그 기능은 이미 트리에
`chrome/browser/ui/views/frame/aside_pinned_entries_view.{h,cc}`(`EntryView`, `FinishEntryDrag`,
드래그 고스트)로 들어가 있고 앞선 담당이 화면으로 확인했다(`ui-shots/G6-pinned-entries.png`,
`G6-pinned-drag-{before,ghost,after}.png`). **새로 만들 것은 없다.**

### 4번 `0x045dd200`–`0x045e03a0` (10,160 B) — 불가

- 앞뒤 가장 가까운 경로 참조가 **-0x42689a**(components/autofill 렌더러)와 **+0x1cea**(perfetto)로
  양쪽 다 아주 멀거나 무관하다. 소스 경로 귀속은 `none`.
- 호출 대상 상위가 `components/sync/model/*`, `components/prefs/pref_value_store.cc`,
  `base/task/sequenced_task_runner.h`로 흩어져 있어 한 계통으로 안 모인다.
- 크기+명령수 쌍둥이가 상위에 67% 있으나 작은 블록이라 우연 일치 구간.
- **시도했으나 안 된 것**: vtable RTTI(없음), 문자열(없음), 호출자 역추적(0xE8 바이트 스캔이라
  오탐이 대부분 — 스키아·블링크·미디어로 흩어짐).
- **다음에 해볼 것**: 같은 리비전의 크로미움을 맥 x86_64로 직접 빌드해 오브젝트 파일 단위 배치를
  비교하는 것. 이 트리에서 맥 빌드를 돌릴 수 없어 이번 회차에는 못 했다.

### 5번 `0x049ca150`–`0x049cc670` (7,728 B) — 불가

- 뒤 +0x6bc에 `gpu/command_buffer/client/internal/mappable_buffer_io_surface.cc`(맥 IOSurface),
  앞 -0x54f0에 crashpad. GPU/크래시패드 사이의 빈 자리다.
- 호출 대상 대부분이 `0xd6eee40`대(스텁 구역)와 mojo 헬퍼 — 계통 정보가 없다.
- 크기+명령수 쌍둥이 100%(작은 블록 25개)라 "상위에 같은 모양이 있다"는 약한 신호는 있으나
  판별력이 없다(쌍둥이 부류가 25,470개뿐이라 우연 일치가 흔하다).

### 6번 `0x047c51f0`–`0x047c6600` (3,856 B, 해시맵 인라인) — 불가

- 앞 -0x1526에 `chrome/browser/performance_manager/policies/best_effort_task_inhibiting_policy.cc`,
  뒤 +0x3623에 `chrome/browser/ui/cocoa/applescript/bookmark_folder_applescript.mm`.
- 구간이 `chrome/browser/picture_in_picture/auto_pip_setting_overlay_view.cc` 근처 함수를 20번 호출.
- 원본 근거 문자열이 `raw_hash_set.h`의 반복자 오류 문구뿐이라 **템플릿 인스턴스화 덩어리**일
  가능성이 높다. 즉 "기능"이 아니라 빌드 산물일 수 있다. 그 가설을 증명할 방법(같은 리비전 맥 빌드)이
  이번 회차에 없었다.

### 7번 `0x0d145880`–`0x0d146b10` (3,008 B) — 불가(반쯤 좁힘)

- 앞 -0x122d에 `chrome/browser/ui/views/extensions/extensions_request_access_button.cc`,
  뒤 +0x6cc에 `chrome/browser/ui/views/find_bar_host.cc` — 즉 `chrome/browser/ui/views/`의
  `extensions/…`와 `find_bar_host.cc` **사이**다.
- 구간이 바로 앞 `0xd145010`(find_bar_host.cc 블록)을 **8번**, 그리고
  `extensions_toolbar_desktop.h` · `extension_popup.h` · `ui/views/controls/button/button.h`
  근처를 호출한다.
- **여기까지가 한계**: 이름을 붙일 문자열도 RTTI도 없고, 확장 툴바와 찾기 막대 양쪽에 걸쳐 있어
  하나의 기능으로 못 좁혔다.

### 덤 — 이번에 만든 이름표 목록

원본에만 있는 문자열 13,368개에서 클래스 이름꼴 88개를 뽑아 트리와 대조했다.
**전부 트리에 있다.** 특히 이 항목들과 직접 얽힌 것:

| 원본 문자열 | 주소 | 우리 트리 |
|---|---|---|
| `ProfileIndicatorIconButton` | 0x4bff2ea | `aside_profile_menu_view.cc:267` |
| `ProfileIndicatorIconPickerPanel` | 0x4bfef3a | `aside_profile_menu_view.cc:297` |
| `StartToolbarCollapseButtonHoverMonitorTimer` | 0x4cd84a5 | `aside_toolbar_collapse_hover_monitor.cc` (100 ms) |
| `StartToolbarCollapseButtonHoverExitTimer` | 0x4cc8e2f | **이번에 추가** (500 ms) |
| `ScheduleTargetExtensionBodyBackgroundProbe` | 0xd172c05 | `contents_web_view.cc:216` |
| `HorizontalPinnedTabEntriesView` | 0x4c6c48d | `aside_pinned_entries_view.cc` |

이 대조 결과가 "이름 있는 UI 클래스는 남은 것이 없다"는 증거다.

---

## 4. 추가 후보 6개 — 항목별 근거

### (8) 북마크가 열린 탭을 대표하는 구조 — 재현 완료

`aside_bookmark_tab_representation.{h,cc}` + `aside_bookmarks_section_view.cc`.
원본 키 이름 `bookmark_tab_representation_node_id` / `bookmark_tab_representation_host`,
갱신 함수 `ScheduleRefreshTabsRepresentedByBookmarks`가 계약이다.

**화면 확인.** 북마크 막대에 `chrome://settings/`(열려 있는 탭)와 `chrome://version/`(안 열린 탭)을
넣고 세로탭의 Bookmarks 구역을 폈다. 열린 탭을 대표하는 `Settings` 줄만 다른 색으로 그려진다
(`ui-shots/G6-bookmark-tab-representation-crop.png`). 툴팁에는 `bookmark_tab_representation_host: …`가 붙는다.

**HEAL이 물어본 색 문제 — 답.** HEAL은 `ui::kColorIconActive`(없는 이름)를 `ui::kColorSysPrimary`로
바꿨다고 적어 두었다. 그 뒤 담당이 이미 `ui::kColorPrimaryForeground`로 다시 고쳤고, 코드에
그 이유가 남아 있다. 이번에 그 판단을 검증했고 **맞다**고 본다:

- 색 id는 **컴파일 시점 enum 값**이라 바이너리에 값의 흔적이 남지 않는다. 원본 이름만 알 수 있다.
- 크로미움 151에 있는 유일한 "…IconActive"인 `ui::kColorHelpIconActive`가
  `kColorPrimaryForeground`로 풀린다 → 이 트리에서 "활성 아이콘"의 뜻이 그것이다.
- 이 줄들은 `MdTextButton`이라 `UpdateIconColor()`가 벡터 아이콘을 **버튼의 글자색**으로 다시
  래스터화한다. 그래서 `SetImageModel()`에만 색을 주면 버려진다 — `SetEnabledTextColors()`로
  줘야 실제로 보인다. 위 캡처가 그것이 보인다는 증거다.
- 다른 줄들이 강조색(파랑)을 쓰고 있으므로 `kColorSysPrimary`를 주면 **차이가 안 난다.**
  전체 강도 전경색이 원본의 "튀게 한다"는 의도에 맞다.

### (9) `chrome://settings`의 "Aside Account" 구역 — 재현 완료

`settings_localized_strings_provider.cc`의 `AddAsideAccountStrings()`(+47줄) +
`people_page.html`/`people_page.ts`. 원본 문자열 8개(`asideAccountBadgeLabel`,
`asideAccountSignedInLabel`, `asideAccountSettingsRowLabel`, `manageAsideAccount`,
`asideAccountNotSyncedYet`, `asideAccountWaitingForFirstSync`, `asideAccountSyncErrorPrefix`,
`asideAccountSettingsUrl`)가 그대로 계약이다. 이식 길 1(원본 문자열 그대로).

**화면 확인**: `ui-shots/G6-settings-aside-account.png` — "You and Google" 안에
`Aside Account / Not synced yet`, `Manage Aside Account / Aside account settings` 두 줄이 뜬다.

### (10) 비밀번호 관리자 툴바 버튼 자동 고정 pref — 재현 완료 (라이브 확인 필요)

`toolbar_actions_model.cc`:

```
constexpr char kAsidePasswordManagerExtensionId[] = "clcdgiameigmljcbkkcbjiljinmfkncl";
constexpr char kAsidePasswordManagerToolbarPinInitializedPref[] =
    "aside_password_manager_toolbar_pin_initialized";
```

원본 근거는 `ExtensionPrefs::ReadPrefAsBoolean @0x285f0d3` / `UpdateExtensionPref @0x285f128`이
같은 46바이트 키를 쓰는 것, 그리고 확장 id 리터럴이 `0xd8e6b40`에서 `extensions.pinned_extensions`
바로 옆에 있는 것. 같은 방식으로 에이전트 확장(`fjdhphbdlfjogobdofoaagnlnkoibdge`)도 처리한다.
pref는 확장별 pref라 `browser_prefs.cc`에 등록하지 않는 것이 맞고, 그 이유가 주석으로 남아 있다.

**화면 확인은 못 함**: 그 확장이 있어야만 보이고, COMMON.md가 Aside 확장 로드를 금지한다
(라이브 데몬 21420에 붙는다). **라이브 확인 필요.**

### (11) 확장 페이지 배경색 측정 — 재현 완료 (라이브 확인 필요)

`contents_web_view.{h,cc}`의 `ScheduleTargetExtensionBodyBackgroundProbe()` /
`RunTargetExtensionBodyBackgroundProbe()`. 원본 문자열은 `0xd172c05`에 있고 같은 파일
(`contents_web_view.cc`)을 가리킨다. 확장 페이지가 떠야 도는 경로라 화면 확인은 못 했다.

### (12) 툴바 접기 버튼 호버 타이머 — **이번에 채운 것**

기존에는 100 ms 감시 타이머(`StartToolbarCollapseButtonHoverMonitorTimer`, 주기 0x186a0 µs)만
있었다. 원본에는 **두 번째 타이머**가 있다:

`0x4cc8e00` = `VerticalTabStripRegionView::StartToolbarCollapseButtonHoverExitTimer`
(`vertical_tab_strip_region_view.cc:11817`, `mov ecx, 0x2e29`):

- `[rdi+0x900]`이 널이 아니면 vtable +0x10(실행 중?)을 물어보고 **참이면 그냥 돌아간다** (중복 방지).
- 아니면 `rbx+0x8d0`의 타이머를 **`0x7a120` µs = 500 ms**로 건다.
- 부르는 쪽(`0x4cc8de0`)은 미리보기 플래그 `[rdi+0x99b]`가 1일 때만 이걸 부른다.

**고침**: `AsideToolbarCollapseHoverMonitor`에 `kExitDelay = 500 ms`짜리 `base::OneShotTimer`와
`StartExit()` / `CancelExit()` / `IsExitPending()`을 넣고, `vertical_tab_strip_region_view.cc`의
감시 콜백을 바꿨다 — 포인터가 밖으로 나가면 **바로 닫지 않고** 종료 타이머를 걸고,
그 사이에 돌아오면 `CancelExit()`로 취소한다. 타이머가 터질 때 한 번 더 위치를 확인한다.

**화면 확인** (`ui-shots/G6-collapse-hover-*.png`, 4장):

| 파일 | 상태 |
|---|---|
| `G6-collapse-hover-0-collapsed.png` | 세로 띠 접힘 |
| `G6-collapse-hover-1-preview-open.png` | 포인터를 접힌 띠 위에 두면 미리보기 펼침 |
| `G6-collapse-hover-2-after-pointer-left.png` | 포인터를 밖(600,300)으로 옮긴 **직후** — 미리보기 그대로 (유예 시간) |
| `G6-collapse-hover-3-closed.png` | 2초 뒤 — 닫힘 |

1번과 2번 캡처는 픽셀 평균까지 같다(59782.9). 3번은 다르다(60181.1). 즉 "포인터가 나가도 곧바로
닫히지 않고, 유예 시간이 지나면 닫힌다"가 실제로 관찰된다. 심볼도 확인:
`nm -C out/aside/chrome | grep -c "AsideToolbarCollapseHoverMonitor::StartExit"` = 1.

### (13) 프로필 지시 아이콘 — 재현 완료

`ProfileIndicatorIconButton`(아이콘 격자 한 칸)과 `ProfileIndicatorIconPickerPanel`(47칸 격자)
둘 다 `aside_profile_menu_view.cc`에 있고, 선택값은 프로필 속성
`aside_profile_indicator_icon`을 거쳐 `profile_monogram_avatar_view.cc:144`
(`GetAsideProfileIndicatorIcon()`)에서 그려진다. 원본에도 문자열 두 개가 각각 한 자리씩 있고
(0x4bff2ea, 0x4bfef3a) 우리 쪽과 1:1이다. 파일 자체는 G3의 프로필 메뉴와 겹친다.

---

## 5. 이관 2건

### (14) 두 번째 `searchbox.mojom.Page` 연결 (`0x0474d900`) — **이번에 속을 채웠다**

G2가 밝힌 정체: 원본은 `searchbox.mojom.Page`를 22곳에서 가리키고 CFT는 10곳,
앞 10곳은 1:1로 대응한다. 즉 **Aside가 Page를 한 번 더 문다.** 그 두 번째 소비자가
`asideOmnibox` 확장 API다. G4는 이 연결을 손대지 않고 넘겼다.

트리에는 앞선 담당이 만든 두 조각이 이미 있었다:

- `chrome/browser/ui/webui/cr_components/searchbox/aside_searchbox_page_mirror.{h,cc}` — 원본
  0x048ffcbc·0x04901890의 두 번 바인딩에 대응하는 미러 허브. `searchbox_handler.cc`가 결과를
  여기로도 흘린다.
- `chrome/browser/extensions/api/aside_omnibox/aside_omnibox_searchbox_page.{h,cc}` —
  브라우저 쪽 `searchbox::mojom::Page` 수신기.

**이번에 찾은 결함**: 그 수신기의 Page 메서드 22개 중 **`AutocompleteResultChanged` 하나만**
구현돼 있고 나머지 21개가 빈 함수였다. 그런데 `chrome/common/extensions/api/aside_omnibox.json`은
이미 그 메서드들에 1:1 대응하는 이벤트를 **22개 선언해 두고 있었다** — 즉 계약은 있는데
브라우저 쪽에서 아무도 그 이벤트를 보내지 않는 상태였다(전체 트리에서 실제로 보내지던 것은
`onAutocompleteResultChanged` / `onKeywordSelectedChanged` / `onSelectionUpdated` 셋뿐).

**고침**: 대응하는 이벤트가 선언된 Page 메서드 **16개**를 전부 이었다.

| Page 메서드 | 보내는 이벤트 |
|---|---|
| `UpdateSelection` | `onSelectionUpdated` |
| `StepSelection` | `onStepSelection` |
| `OpenCurrentSelection` | `onOpenCurrentSelection` |
| `SetAimButtonVisible` | `onAimButtonVisibilityChanged` |
| `SetKeywordSelected` | `onKeywordSelectedChanged` |
| `SetInputText` | `onInputTextChanged` |
| `SetThumbnail` | `onThumbnailChanged` |
| `OnContextualInputStatusChanged` | `onContextualInputStatusChanged` |
| `OnTabStripChanged` | `onTabStripChanged` |
| `OnInputStateChanged` | `onInputStateChanged` |
| `AddFileContext` | `onFileContextAdded` |
| `UpdateAutoSuggestedTabContext` | `onAutoSuggestedTabContextChanged` |
| `UpdateLensSearchEligibility` | `onLensSearchEligibilityChanged` |
| `UpdateContentSharingPolicy` | `onContentSharingPolicyChanged` |
| `UpdateAimPopupEligibility` | `onAimEligibilityChanged` |
| `UpdateSmartTabSharingActive` | `onSmartTabSharingActiveChanged` |

미러로 들어온 사본에는 `source: "searchbox"`를 붙여 세션 자신의 결과와 구분할 수 있게 했다
(원래 있던 `AutocompleteResultChanged`가 쓰던 표기 그대로).
`OnPermissionPromptChanged` / `SetRestoredTabIds` / `SetAimThreadRestoredTabs` 셋은 대응 이벤트가
스키마에 없어 **받고 버린다**(결과만 듣는 리스너가 하는 일). `OnInputStateChanged`는
`omnibox::InputState`의 스칼라 부분만 넘긴다 — proto 목록은 반쯤 번역하느니 빼고,
필요하면 `asideOmnibox.getInputState`로 받으라고 주석에 적었다.

`AddFileContext`가 실어 오는 `SelectedFileInfo`의 `image_data_url` / `is_deletable` /
`selection_time`은 2절에서 컨텍스트 저장소에 넣은 필드와 **같은 이름**으로 나간다. 확장이
자기가 붙인 파일과 서치박스가 붙인 파일을 한 어휘로 볼 수 있다.

### (15) 확장 권한 문구 IDS 10347~10351 — 재현 완료

`generated_resources.grd`에 원본 pak 문자열 그대로 **여섯 개**(G4가 넘긴 다섯 개 + 10346
`Aside: Read and change inbox`)를 넣었다. 한 식구를 쪼개면
`chrome_permission_message_rules.cc`가 어색해진다는 G4의 지적대로 같이 넣었다.

```
Aside: Read and change inbox
Aside: Read and change omnibox suggestions and search context
Aside: Read browser profile account context
Aside: Read and change browser preferences
Aside: Import data from installed browsers
Aside: Launch installed extension toolbar actions
```

배선은 `chrome_permission_message_rules.cc:617`–`632`, 권한 id는
`extensions/common/mojom/api_permission_id.mojom`의 `kAside*` 271~276.

**확인**: `out/aside/gen/chrome/grit/generated_resources.h`에 IDS 심볼 6개
(10397~10402 — 이 트리의 자원 번호 공간이라 원본 번호와 다르다),
빌드된 `out/aside/locales/en-US.pak`에 문자열 존재
(`strings -a out/aside/locales/en-US.pak | grep -c "Aside: Read and change omnibox"` = 1).

---

## 6. HEAL이 남긴 확인 항목 두 가지 — 답

| 자리 | HEAL이 고른 값 | 판정 |
|---|---|---|
| `aside_bookmarks_section_view.cc` 아이콘 색 | `ui::kColorSysPrimary` | **바꿔야 했고 이미 바뀌었다** → `ui::kColorPrimaryForeground`. 근거는 4절 (8)번. 다른 줄이 이미 강조색이라 `kColorSysPrimary`로는 차이가 안 난다 |
| `aside_browser_preferences_api.cc`의 `deviceName` | `DeviceInfo::client_name()` | **맞다.** 원본 `getSyncStatus`(RE 0x406d1c8)가 참조하는 문자열은 한 개뿐이고, 값은 sync 쪽에서 온다. `GetLocalDeviceNameForTest`는 이 트리에 없는 테스트 전용 이름이었고, 정식 경로 `DeviceInfoSyncService → GetLocalDeviceInfoProvider → GetLocalDeviceInfo()->client_name()`가 그 기기 이름의 유일한 공개 출처다. 그대로 둔다 |

---

## 7. 이번에 고친 파일

| 파일 | 무엇 |
|---|---|
| `chrome/browser/extensions/api/aside_omnibox/aside_omnibox_api.cc` | queryAutocomplete `cursorPosition`, openAutocompleteMatch `areMatchesShowing`/`viaKeyboard`, activateKeyword `isMouseEvent`, onNavigationLikely 실구현, deleteContext의 `isDeletable` 존중 |
| `.../aside_omnibox_session.{h,cc}` | `Query(..., cursor_position)`, `NoteMatchOpened()` |
| `.../aside_omnibox_context_store.{h,cc}` | `image_data_url` / `is_deletable` / `selection_time` 필드, 원본 오류 문구 |
| `.../aside_omnibox_searchbox_page.cc` | 빈 Page 메서드 16개 → 선언된 이벤트로 연결 |
| `.../aside_omnibox/BUILD.gn` | `//chrome/browser/preloading/prefetch/search_prefetch`, `//chrome/browser/preloading/search_preload`, `//components/omnibox/common` |
| `chrome/browser/extensions/api/aside_browser_import/aside_browser_import_api.cc` | `chatgpt-atlas` 별칭 |
| `chrome/browser/ui/views/frame/aside_toolbar_collapse_hover_monitor.{h,cc}` | 500 ms 종료 타이머 |
| `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc` | 종료 타이머 배선 |

BUILD.gn을 건드렸으므로 같은 잠금 안에서 `gn gen out/aside`를 먼저 돌렸다.

## 8. 안 한 것

- 커밋·stash·checkout·reset 없음. 새 파일은 `git add -N`만.
- 다른 그룹 파일 되돌리기 없음. 공유 파일(`chrome/browser/ui/BUILD.gn`,
  `chrome/browser/BUILD.gn`)은 이번에 안 건드렸다 — 그래서 `patches/041-G6.patch`에도 없다.
  G6 소스가 그 파일들에 등록된 것은 앞선 담당이 넣었고 그대로다.
- 캐시 버전(`aside_adblock_engine.cc`의 kCacheVersion)은 광고차단을 안 건드려서 안 올렸다.
- Aside 확장 로드 안 함(라이브 데몬 보호). 그래서 10·11번은 라이브 확인이 남는다.
