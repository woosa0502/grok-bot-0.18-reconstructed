# G2-frame-toolbar 결과 — 프레임·툴바·주소창·분할 보기 12군데 (2026-09-06)

작성 모델: **Claude Opus 5 (1M context)** (모델 ID `claude-opus-5[1m]`).
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. 커밋 안 함(`git add -N`만).
앞 담당(재부팅으로 중단)이 남긴 편집을 이어받아 끝냈다.

## 0. 한 줄 결론

담당 12조각(10군데 + G1 이관 2조각) 전부 종결. **재현 완료 8, 차이 없음 확인 3, 불가 1.**
마지막 빌드 2026-09-06 12:40:07 → 12:40:36, `grep -c FAILED` = **0**, `out/aside/chrome` mtime 12:40:36.

---

## 1. 앞 담당이 남긴 것 — 이어받기 전 상태표

`git diff cc5584af0d --stat` 과 파일 mtime(09-06 09:56~10:38)으로 확인했다.

| # | 구간 | 앞 담당 상태 | 내가 한 일 |
|---|---|---|---|
| 1 | `0x04899120` | 반쯤 — 버블·셰브런·배지 코드는 있으나 버블이 화면에 안 뜸 | 안 뜨는 원인 찾아 고치고 인포바 제거, 실물 확인 |
| 2 | `0x04c52470` | 이미 됨 | 확인만 |
| 3 | `0x04c40660` | 이미 됨 | 확인만(그림자 확대 캡처) |
| 4 | `0x04c6d1f0` | 없음 | 새로 만듦 |
| 5 | `0x047ed7c0` | 반쯤 — 타이머·수치는 맞으나 화면에 안 그려짐 | 그려지게 고치고 실측 |
| 6 | `0x0487a6e0` | 없음 | 원본 대조 → 차이 없음으로 닫음 |
| 7 | `0x0474d900` | 없음 | 정체 규명 → 불가(이유 아래) |
| 8 | `0x04872550` | 없음 | 원본 대조 → 차이 없음으로 닫음 |
| 9 | `0x04875aa0` | 이미 됨 | 확인만 |
| 10 | `0x0afc71e0` | 없음(미확인 구간) | 디스어셈블로 정체 규명 → 차이 없음 |
| 이관 A | `AsideAiTabsViewport` | 없음 | 새로 만듦 |
| 이관 B | `FloatingTabDragView` | 없음 | 새로 만듦 |

남의(G1·G3·G6) 편집은 하나도 지우지 않았다.

---

## 2. 항목별 결과 (12/12)

| # | 구간 start_hex | 이름표 | 이식 길 | 결과 |
|---|---|---|---|---|
| 1 | `0x04899120` | page_info 재적재 버블 · TabExpandChevronView · AiTabsCountBadgeView | 1+2 | 재현 완료 |
| 2 | `0x04c52470` | contents_container_view — 포커스·모달 처리 | 2 | 재현 완료 |
| 3 | `0x04c40660` | 분할 보기 장식 — Split Pane Shadow / 세로탭 인접 페인 | 2+3 | 재현 완료 |
| 4 | `0x04c6d1f0` | 분할 보기 (MultiContentsView) 통합 | 2+3 | 재현 완료 |
| 5 | `0x047ed7c0` | 주소창 — AiMode · 페이지 로드 진행 표시 | 1+3 | 재현 완료 |
| 6 | `0x0487a6e0` | ToolbarView 재구성 | — | 차이 없음 확인 |
| 7 | `0x0474d900` | searchbox mojom (옴니박스 제안 UI) | — | **불가** |
| 8 | `0x04872550` | 고정 툴바 액션 컨테이너 | — | 차이 없음 확인 |
| 9 | `0x04875aa0` | 툴바 'Ask Aside' 액션 · 호버 카드 | 1+2 | 재현 완료 |
| 10 | `0x0afc71e0` | ToggleButton 변형 | — | 차이 없음 확인 |
| A | `AsideAiTabsViewport` (arm64 `0xd6bbe30`) | AI 탭 뷰포트 | 3(이름·동작은 1) | 재현 완료 |
| B | `FloatingTabDragView` (arm64 `0xd6bbfa4`) | 탭 끌기 미리보기 카드 | 3(이름은 1) | 재현 완료(라이브 확인 필요) |

---

## 3. 만든 것 — 항목별 상세

### 1번 `0x04899120` — page_info 재적재 버블

원본 근거:
- 클래스 `PageInfoReloadBubbleView`(`0xe55944a`), 파일 `../../chrome/browser/ui/views/page_info/page_info_reload_bubble_view.cc`(`0xe559402`, 참조 `0x489a1a6`·`0x489a6b7`).
- 함수 `ShowAction` — 소스 265줄(`0x489a1a6`의 `ecx=0x109`).
- 요소 식별자 `ActionButton` — 소스 66줄(`0x489a6c6`의 `ecx=0x42`).
- **결정적 근거**: 원본 바이너리에 `PageInfoInfoBarDelegate` 문자열이 **하나도 없다**. 원본은 크로미움의 권한 변경 인포바를 없애고 이 버블로 바꿨다.

고친/만든 파일:
- `chrome/browser/ui/views/page_info/page_info_reload_bubble_view.{h,cc}` (앞 담당이 만든 것, 내가 고침)
- `chrome/browser/ui/views/page_info/BUILD.gn`
- `chrome/browser/ui/views/location_bar/location_bar_view.cc` (버블 띄우는 자리)
- `chrome/browser/ui/page_info/chrome_page_info_delegate.cc` (인포바 제거)

**앞 담당 코드가 화면에 안 뜨던 이유와 고침**(실행 중 로그로 확인):
1. 버블이 만들어지자마자 사라졌다. `OnPageInfoBubbleClosed`가 버블을 띄운 **직후** `FocusLocation()`으로 주소창에 포커스를 주는데, `BubbleDialogDelegateView`는 기본값이 "포커스 잃으면 닫기"다. → `set_close_on_deactivate(false)` + `ShowInactive()`로 고침. 이 버블은 사용자가 누르거나 페이지가 바뀔 때까지 남아 있는 안내다.
2. 크로미움 인포바가 같이 떠서 두 개가 겹쳤다. `ChromePageInfoDelegate::CreateInfoBarDelegate()`가 인포바를 만들지 않고 **true만 돌려주도록** 바꿨다. true를 유지해야 `PageInfo::OnUIClosing()`의 `reload_prompt`가 참으로 남아 버블 띄우는 콜백이 계속 돈다. 원본에 `PageInfoInfoBarDelegate`가 없는 것과 같은 상태가 된다.

확인(실측):
```
DISPLAY=:112 out/aside/chrome --no-sandbox --no-first-run \
  --user-data-dir=/tmp/aside-ui-G2 --remote-debugging-port=9412 http://127.0.0.1:8714/geo
# 위치 권한 허용 → 주소창 ⓘ 클릭 → Location 토글 끄기 → 버블 닫기
```
로그(진단용, 지금은 제거함):
```
LocationBarView::OnPageInfoBubbleClosed reload_prompt=1
PageInfoReloadBubbleView::ShowBubble anchor=0x...fc08 contents=0x...a400
bubble widget=0x...2600 visible=1 bounds=410,45 322x160
```
캡처: `ui-shots/G2-07-page-info-reload-bubble.png`(전체), `...-crop.png`(확대).
문구는 원본과 같은 자원(`IDS_PAGE_INFO_INFOBAR_TEXT` / `IDS_PAGE_INFO_INFOBAR_BUTTON`) — "Reload this page to apply your updated settings on this site" + "Reload". 인포바는 더 이상 뜨지 않는다.

**같은 구간의 나머지 둘** (앞 담당이 만든 것, 코드 확인만 했다):
- `TabExpandChevronView` — `chrome/browser/ui/views/tabs/common/tab_expand_chevron_view.{h,cc}`. 원본 클래스 이름·헤더 경로(`tab_expand_chevron_view.h`, `0xe8d...`)를 그대로 쓰고 `TabGroupHeaderView`의 접기 아이콘을 이 클래스로 바꿨다. `Expanded`/`IconColor`/`IconSize` 세 속성.
- `AiTabsCountBadgeView` — `tab_group_header_view.{h,cc}` 안에 스파클 아이콘 + 개수/배지 라벨로 들어가 있고 `aside::IsAgentTabsGroup()`일 때만 보인다. **라이브 확인 필요**(에이전트 탭 그룹은 Aside 확장이 만들어야 생기고, 확장은 라이브 데몬 21420에 붙으므로 규칙상 안 띄웠다).

### 2번 `0x04c52470` — contents_container_view 포커스·모달

원본 근거: `PostFocusAfterActivation`, `kIsBlockedByModalKey`(구간 top_strings).
파일: `chrome/browser/ui/views/frame/contents_container_view.{h,cc}` (앞 담당).
활성 페인이 되면 포커스를 **바로 주지 않고 작업 하나 던져서** 준다(위젯 활성화 정리가 끝난 뒤에 들어가게). 탭 모달 대화상자가 떠 있으면(`views::kIsBlockedByModalKey`) 포커스를 페이지로 끌어오지 않는다. 이름·조건이 원본 문자열과 같다. 코드 확인만 했고 따로 고치지 않았다.

### 3번 `0x04c40660` — 분할 보기 장식

원본 근거: 레이어 이름 `Split Pane Shadow`, 클래스 `VerticalTabStripAdjacentPaneDecorationView`, 함수 `ResampleSplitToolbarColorAfterCommittedNavigation` (전부 이 구간 top_strings).
파일: `contents_container_view.{h,cc}`(그림자·재표집), `browser_view.{h,cc}`(세로탭 인접 페인 이음새), `contents_web_view.{h,cc}`(커밋 뒤 색 재표집 호출) — 앞 담당.

- 그림자: `ui::Shadow`(elevation 6, 모서리 12)를 레이어 전용 자식에 얹고 레이어 이름을 원본과 같은 `"Split Pane Shadow"`로 준다. 분할이 아니면 없앤다.
- 인접 페인: 세로탭과 앞쪽 페인이 만나는 자리의 홈을 메우는 얇은 뷰. 클래스 이름이 원본과 같다.
- 색 재표집: 새 페이지가 커밋된 시점에는 그 페이지 색을 못 읽으므로, 작업을 하나 던져서 분할 미니 툴바 색을 다시 읽는다.

확인: `ui-shots/G2-04-splitview.png`(분할 두 페인), `ui-shots/G2-04-split-pane-shadow.png`(오른쪽 페인 모서리 250% 확대 — 둥근 모서리 바깥으로 퍼지는 회색 그림자가 보인다).

### 4번 `0x04c6d1f0` + 이관 A — MultiContentsView 통합 · AsideAiTabsViewport

**원본이 무엇을 하는지 먼저 밝혔다.**

이 구간에서 크로미움에 없는 것은 세 갈래였다.

| 원본 자리 | 내용 |
|---|---|
| `0x04c797b0` (도우미) | GURL이 `chrome-extension` + 호스트 32글자 `fjdhphbdlfjogobdofoaagnlnkoibdge` 인지 검사. 부르는 쪽에서 세 곳(직접 URL, 목록 안 탭, 다른 멤버)을 같은 방법으로 본다 |
| `0x04c78900` (2,272 B) | `WebContentsImpl::Resize` 1회, 관찰자 등록 1회, 위 검사 3회, `Emulation.clearDeviceMetricsOverride` 6회, `Emulation.setDeviceMetricsOverride` 1회 |
| `0x04c7dbd0` / `0x04c7dee0` | `{"id":N,"method":...,"params":{...}}`를 만들어 DevTools 세션으로 보낸다. params 키: `width` `height` `deviceScaleFactor` `mobile` `scale` `screenWidth` `screenHeight` `positionX` `positionY` `dontSetVisibleSize` |
| `0x04c7dca0` | 위 JSON을 직렬화해 `DevToolsAgentHost` 세션에 넣는다(오류 문자열 `Session with given id not found.`) |
| `0x04c7d670` | 클래스 이름 `AsideAiTabsViewport` (헤더 `multi_contents_view.h`) |

즉 **AsideAiTabsViewport는 "에이전트(AI) 탭이 화면에 없을 때 크기를 대신 주는 자리"** 다. 에이전트 탭은 지금 보이는 탭이 아니라서 렌더러가 자기 크기를 못 갖는다. 원본은 그 탭의 WebContents를 뷰포트 크기로 `Resize` 하고, 그 탭 자신의 DevTools 세션에 `Emulation.setDeviceMetricsOverride`를 넣어 준다. 일이 끝나면 `clearDeviceMetricsOverride`로 되돌린다.

만든 것 (이식 길 3 — 이름·params·순서는 원본 그대로):
- `chrome/browser/ui/views/frame/multi_contents_view.h` — `class AsideAiTabsViewport : views::View, content::WebContentsObserver, content::DevToolsAgentHostClient` 를 **원본과 같은 헤더**에 선언.
- `chrome/browser/ui/views/frame/multi_contents_view.cc` — 구현. 경계가 바뀌면 `WebContents::Resize(bounds)` + 크기가 달라졌을 때만 `Emulation.setDeviceMetricsOverride`. 대상이 바뀌거나 없어지면 `Emulation.clearDeviceMetricsOverride` 뒤 세션을 뗀다. `IsTrusted()`는 true(Emulation 도메인은 믿는 세션에서만 열린다).
- `MultiContentsView` 배선: 자식으로 하나 두고(그리지 않음·이벤트 없음), 배치에서 콘텐츠 영역 전체 크기를 준다. `SetWebContentsAtIndex` / `SetActiveIndex` / `CloseSplitView` 에서 `UpdateAiTabsViewport()`를 부른다. 이 함수는 탭 목록에서 `aside::IsAgentTabsGroup()`인 그룹의 탭 중 **지금 두 페인 어디에도 안 보이는** 첫 탭을 골라 뷰포트에 물린다.

남은 차이: 원본이 세 곳을 검사하던 대상 중 두 번째·세 번째(`[obj+0x294]` 색인의 탭, `[obj+0x8d8]`)가 각각 무엇인지는 확정 못 했다. 우리 쪽은 "탭 목록에서 안 보이는 에이전트 탭"이라는 한 가지 규칙으로 골라 준다.

### 이관 B — `FloatingTabDragView`

원본 근거: 클래스 이름 `FloatingTabDragView`(`0xe8d694d`), 선언 파일 `../../chrome/browser/ui/views/frame/multi_contents_view_drop_target_controller.cc` 180줄(메타데이터 183줄 — `0x4c82456`의 `ecx=0xb4`, `0x4c7f4c6`의 `ecx=0xb7`). 만드는 자리는 탭 끌기 갱신 경로 `0x04c7edd0`(5,584 B, 같은 블록에서 `StartDropTargetHideTimer`·`Layer::SetElementId`도 부른다).

만든 것:
- `chrome/browser/ui/views/frame/multi_contents_view_drop_target_controller.cc` — 원본과 같은 파일에 `FloatingTabDragView`(파비콘 + 제목, 둥근 카드, 자체 레이어) 추가.
- 같은 파일 `OnTabDragUpdated`에서 끌리는 탭의 WebContents를 찾아 카드에 담고 포인터 위에 띄운다. `OnTabDragExited` / `OnTabDragEnded` / 소멸자에서 없앤다.
- `.h`에 `ShowFloatingTabDragView` / `HideFloatingTabDragView`와 `floating_tab_drag_view_` 추가.

**라이브 확인 필요**: X11에서 세로탭 행을 xdotool로 끌면 크로미움이 탭을 즉시 **새 창으로 떼어 내** 커서를 따라가게 만든다(캡처 `/tmp/g2-drag2.png`). 그러면 원래 창의 분할 드롭 타깃이 겨냥되지 않아 `OnTabDragUpdated`가 안 불린다. 코드 경로는 크로미움 `TabDragTarget` 위에 그대로 얹혀 있고 빌드·링크는 된다.

### 5번 `0x047ed7c0` — 주소창 로드 진행 표시 · AI 모드

원본 근거(전부 이 구간 문자열, 파일 `location_bar_view.cc`):
`StartPageLoadProgressTrickle`(소스 **2800**줄 — `0x47f762a`의 `ecx=0xaf0`), `StartPageLoadProgressHideTimer`, `ScheduleDeferredLocationBarRefresh`, `ScheduleBromiumLocationBarRefreshRetries`, `RunBromiumLocationBarRefreshRetry`, `should_hide_page_actions`, `AiMode`.

역어셈블로 확인한 수치·구조:
- 되풀이 타이머 간격 `0x7a120` µs = **500 ms** (`0x47f76ca`). 앞 담당이 쓴 값과 같다.
- 진행값은 double 두 개(`this+0x8e8` 현재, `this+0x8f0` 목표)로 들고, `this+0x690`의 애니메이션과 `Tween::CalculateValue(1 /*EASE_OUT*/, ...)`로 그 사이를 보간한다.
- `IsBromiumPage` 판정(`0x47facb0`): scheme `chrome-extension`(16글자) + host 32글자 `fjdhphbdlfjogobdofoaagnlnkoibdge` + path 12글자 `/newtab.html`. 앞 담당 구현과 정확히 같다.
- 그 위에 있는 `0x47fadd0`은 "AI 모드 새 탭이냐"를 보는 함수다: 질의·조각이 없거나 / 질의에 `mode=`가 있거나 / 조각이 `new-tab`·`/new-tab` 이거나 `new-tab/`·`/new-tab/`·`new-tab?`·`/new-tab?`를 담고 있으면 참. 부르는 쪽은 `0x02213100`·`0x028850f0`(우리 구간 밖, content 쪽)이라 이번 담당 범위가 아니다.
- `AiMode`는 크로미움 151에 이미 있는 페이지 액션 지표 이름이다(`ai_mode_page_action_icon_view.cc:51`, `page_action_properties_provider.cc:22`). 포크 고유가 아니다.

**앞 담당 코드가 화면에 안 그려지던 이유와 고침**:
채움을 `OnPaintBackground`에서 그렸는데, 주소창 글자칸(`OmniboxViewViews`)이 자기 배경을 **불투명**으로 칠해서(`location_bar_view.cc:1790` `SetBackgroundColor(background_color_)`) 그 위를 덮었다. 픽셀로 재 보니 로딩 중에도 주소창 가로줄이 전부 같은 색(237,242,250)이었다.
→ 레이어를 가진 자식 뷰 `LocationBarView::PageLoadProgressView`를 만들어 **맨 위에 쌓아** 그리도록 바꿨다(`layer()->parent()->StackAtTop()`). 타이머·감쇠·숨김 시각(1초)은 앞 담당 것 그대로 두고, 상태가 바뀔 때마다 `UpdatePageLoadProgressView()`로 폭·보임·쌓임을 맞춘다.

확인(실측): 0.5초마다 조금씩 보내는 로컬 서버(`http://127.0.0.1:8713/`)로 재 봤다. 주소창 y=33 가로줄의 색 경계 위치:

| 프레임(2초 간격) | 채움 끝 x | 바탕 |
|---|---|---|
| 1 | 835 | 1120까지 원래색 |
| 2 | 1075 | 1120까지 원래색 |
| 3~6 | 1120(끝) | — |

채움색 (239,242,247), 바탕 (237,242,250). 왼쪽에서 오른쪽으로 자란다.
캡처: `ui-shots/G2-05-omnibox-load-progress.png`, `...-crop.png`(200% 확대).

남은 차이: 원본은 값을 `gfx::Animation` + `Tween::EASE_OUT`으로 **부드럽게** 잇는다. 우리는 500 ms 눈금마다 남은 거리의 25%씩 바로 옮긴다(중간 보간 없음). 색·투명도(우리 0x66)는 원본 값이 바이너리에서 안 나와 추정이다.

### 9번 `0x04875aa0` — 툴바 'Ask Aside' 액션 · 호버 카드

원본 근거: `Ask Aside`, `PinnedToolbarActionsContainer`, `UpdateHoverCard`.
파일(앞 담당): `browser_actions.cc`(액션 등록), `pinned_toolbar_actions_model.cc`(첫 실행 때 고정), `toolbar_action_view.cc`·`toolbar_action_hover_card_controller.cc`(번들 확장 두 개의 이름을 매니페스트 대신 `Ask Aside` / `Aside Password Manager`로), `toolbar_controller.cc`(액션 이름표 `PinnedAskAsideButton`).

확인: 툴바 스파클 버튼에 마우스를 올리면 도구 설명 **"Ask Aside"** 가 뜬다.
캡처: `ui-shots/G2-08-ask-aside-hover.png`, `...-crop.png`.

---

## 4. 차이 없음으로 닫은 것 3군데 — 판정 근거

먼저 **매처가 헛짚는다는 것을 실제로 증명**했다(10번). 그 뒤 6·8번을 같은 방법으로 봤다.

### 10번 `0x0afc71e0` — ToggleButton 변형 (원래 "못 알아냄")

디스어셈블 결과 이 구간은 `views::ToggleButton`의 **메타데이터 등록 + 소멸자 + 잉크드롭/하이라이트 경로**다.

| 원본 | 우리 트리 |
|---|---|
| `0x0afc71e0`: `new (0x68)` → `("../../ui/views/controls/button/toggle_button.h", len 0x2e, line 0x1d)` | `toggle_button.h:29` (`class` 선언 28줄, `METADATA_HEADER` 29줄) — 같음 |
| `0x0afc7250`: 속성 `IsOn`, `InnerBorderEnabled`, `AcceptsEvents` (bool 셋, 이 순서) | `toggle_button.cc:515-518` 같은 셋, 같은 순서 |
| 크로미움 기준선(CfT 151.0.7922.171) `0x0ab84e70` | `edi=0x68`, `edx=0x2e`, `ecx=0x1d` — **원본과 완전히 같은 모양** |

포크 고유 문자열 0개, 속성 추가 0개. **차이 없음.**
그런데 이 구간의 블록 분류는 `unmatched 16 / matched 6`이다. 즉 **언와인드 블록 매처는 이런 코드에서 헛짚는다**. 아래 두 판정은 이 사실을 기준으로 삼았다.

### 6번 `0x0487a6e0` — ToolbarView 재구성

- 구간 47,232 B 안의 문자열 전부가 우리 트리에 **같은 자리**로 있다: `glic.pinned_to_tabstrip`(glic_pref_names.h:106), `browser.show_forward_button`/`browser.show_home_button`(toolbar_view.cc:625,632), `browser_labs_enabled`(chrome_labs_prefs.cc:16), `ResponsiveToolbar.OverflowButtonShown/Hidden`(toolbar_view.cc:1434-1435), `kCascadingBackgroundColor`(toolbar_view.cc:281), `WebUIToolbarWebView`(views/toolbar/webui_toolbar_web_view.cc). **Aside 고유 문자열은 0개.**
- 크기 대조: `ToolbarView::Init` — 원본 `0x0487c9a0` **18,336 B** vs CfT `0x03a29f80` **17,728 B** (+608 B, +3.4%). 구조를 갈아엎은 크기가 아니다.
- 이 구간에 걸린 포크 고유 동작(고정 `Ask Aside` 액션, 그 이름표·호버 카드)은 8·9번에서 이미 복원돼 있다.

→ **차이 없음으로 닫음.** 남은 608 B가 무엇인지는 문자열이 없어 못 밝힌다.

### 8번 `0x04872550` — 고정 툴바 액션 컨테이너

- 문자열은 `RemoveButton` 하나뿐이고 우리 트리의 `pinned_toolbar_actions_container.cc:610`에 같은 이름으로 있다.
- 크기 대조: 그 추적 구역을 담은 블록 — 원본 `0x048756a0` **640 B** vs CfT `0x082dd730` **496 B**.
- 이 구간이 부르는 것도 전부 상위 코드(`DeveloperPrivateAPI`, `location_bar_view.h`, `toolbar_button.h`). Aside 고유 문자열 0개.

→ **차이 없음으로 닫음.**

---

## 5. 불가 1군데 — 7번 `0x0474d900` (searchbox mojom)

### 정체는 밝혔다

- 구간 문자열은 `searchbox.mojom.Page`(9회) · `Receive mojo message` · `Receive mojo reply` · `null in array expecting valid pointers` 뿐. 즉 **mojo가 자동 생성한 직렬화·수신 코드**다.
- 원본 전체에서 `searchbox.mojom.Page`를 가리키는 자리는 **22곳**, 크로미움 기준선(CfT)은 **10곳**. 앞 10곳은 두 바이너리에서 1:1로 대응한다.
- 남는 12곳 중 **9곳이 이 구간 안**(한 블록 `0x0474dd80`, 5,312 B)이고, **2곳은 `0x048f2710` 구간**(= `aside_omnibox_api.cc` 등 확장 API 구현, **다른 그룹 담당**, 지도 상태 "재현(표면)")에 있다.
- 대조로, 원본의 표준 `Page` 스텁 블록은 `0x034511d0` 8,448 B이고 CfT는 `0x03483050` 9,792 B다. 즉 원본은 표준 한 벌 **말고 한 벌을 더** 들고 있다.

정리하면: **Aside는 `searchbox.mojom.Page`를 한 번 더 물린다. 그 두 번째 연결의 주인은 `asideOmnibox` 확장 API다.**

### 왜 못 만드는가

1. mojo 생성 코드에는 **메서드 이름도 필드 이름도 안 남는다**(전부 서수와 오프셋). 그래서 원본이 `Page` 인터페이스에 무엇을 더했는지, 아니면 같은 인터페이스를 두 번 물렸을 뿐인지 바이트로는 못 가른다.
2. 두 번째 연결의 **주인 쪽(확장 API `0x048f2710`)이 내 담당이 아니다.** 그쪽이 어떤 결과를 어떤 모양으로 옴니박스 팝업에 밀어 넣는지 정해지기 전에는 mojo 배선만 먼저 만들 수 없다.
3. 우리 트리에는 `components/omnibox/browser/searchbox.mojom`(Page 메서드 20개)과 표준 바인딩이 이미 있다. 없는 것은 **두 번째 소비자**뿐이다.

### 다음 한 수 (스택 하단에 남김)

`chrome/browser/extensions/api/aside_omnibox/aside_omnibox_session`이 `AutocompleteController` 결과를 받는 자리에서 `mojo::Remote<searchbox::mojom::Page>`로 옴니박스 팝업에 밀어 넣게 잇는다. 그 작업은 확장 API 구간(`0x048f2710`) 담당과 같이 해야 한다. 기각선: 원본 `0x0474dd80` 블록이 `AutocompleteResult`/`AutocompleteMatch` 구조체의 **읽기** 코드이므로, 우리 쪽 두 번째 소비자가 같은 구조체를 받도록 만들면 이 구간이 채워진다.

---

## 6. 빌드

전부 `flock /tmp/aside-ninja.lock` 안에서 `./third_party/ninja/ninja -C out/aside chrome -j4 -l 6`. autoninja 안 씀. BUILD.gn은 안 건드렸으므로 `gn gen`은 안 돌렸다.

| 회차 | 시각 | 내용 | FAILED |
|---|---|---|---|
| 1 | 12:01:07 → 12:02:18 | AsideAiTabsViewport + FloatingTabDragView | 0 |
| 2 | 12:09:28 → 12:13:07 | 주소창 진행 표시 겹침 오버레이 | 0 |
| 3 | 12:20:43 → 12:21:24 | 재적재 버블 닫힘 문제 고침 | 0 |
| 4 | (진단용 2회, 로그 제거함) | | 0 |
| 5 | 12:29:25 → 12:30:14 | 인포바 제거 + 진단 로그 제거 | 0 |
| 6 | 12:39:26 → 12:40:01 | 공유 헤더 확인 — G1이 지목한 오브젝트 3개를 지우고 강제 재컴파일 (browser_view.o / tab_modal_dialog_host.o / browser_focus_controller_views.o) | 0 |
| 7 | **12:40:07 → 12:40:36** | 재링크 (**최종**) | **0** |

`out/aside/chrome` mtime 2026-09-06 **12:40:36** — 빌드 시작(12:40:07) 뒤. 정상.
확인 빌드 12:37:01 → "no work to do", FAILED 0 (`/tmp/aside-build-G2-final.log`).

**공유 헤더 사고 하나**: `multi_contents_view.h`를 두 번에 나눠 편집하는 사이(12:07~12:08)에
접근자 `ai_tabs_viewport_for_testing()`만 들어가고 멤버 `ai_tabs_viewport_`가 아직 없는 상태가
잠깐 있었다. 그때 G1이 빌드를 돌려 `use of undeclared identifier 'ai_tabs_viewport_'`로 세 타깃이
깨졌다. 지금 헤더는 멤버가 401행에 있고, 그 세 오브젝트를 지우고 강제로 다시 컴파일해 통과를
확인했다(회차 6). **공유 헤더는 선언과 사용을 한 hunk에 같이 넣어 저장 시점마다 컴파일되는
상태로 둘 것.**
실행 확인에서 SEGV·FATAL·CHECK 실패 0건(`/tmp/chrome-G2.log`).

---

## 7. 확인 증거 (캡처)

| 파일 | 무엇 |
|---|---|
| `ui-shots/G2-01-startup.png` | 시작 화면(세로탭·툴바·주소창 정상) |
| `ui-shots/G2-02-appmenu.png` | 앱 메뉴 |
| `ui-shots/G2-03-tabmenu.png` | 탭 우클릭 메뉴("Add tab to new split view", G1의 "Add bookmark") |
| `ui-shots/G2-04-splitview.png` | 분할 보기 두 페인 |
| `ui-shots/G2-04-split-pane-shadow.png` | 페인 그림자 250% 확대 (3번) |
| `ui-shots/G2-05-omnibox-load-progress.png` | 로드 중 주소창 (5번) |
| `ui-shots/G2-05-omnibox-load-progress-crop.png` | 같은 것 200% 확대 |
| `ui-shots/G2-07-page-info-reload-bubble.png` | 권한 바꾼 뒤 재적재 버블 (1번) |
| `ui-shots/G2-07-page-info-reload-bubble-crop.png` | 같은 것 확대 — 인포바 없음 |
| `ui-shots/G2-08-ask-aside-hover.png` | 툴바 "Ask Aside" 도구 설명 (9번) |
| `ui-shots/G2-08-ask-aside-hover-crop.png` | 같은 것 확대 |

확인 환경: `Xvfb :112 -screen 0 1400x900x24`, 독립 크롬 1개(user-data-dir `/tmp/aside-ui-G2`, CDP 9412). Aside 확장은 안 올렸다. 확인 끝나고 크롬·Xvfb 정리.

---

## 8. 라이브 확인이 남은 것

| 항목 | 왜 |
|---|---|
| `AiTabsCountBadgeView` (1번) | 에이전트 탭 그룹은 Aside 확장이 만든다. 확장을 올리면 라이브 데몬(21420)에 붙으므로 규칙상 안 띄웠다 |
| `AsideAiTabsViewport` (이관 A) | 위와 같음. 물릴 에이전트 탭이 있어야 Emulation 명령이 나간다 |
| `FloatingTabDragView` (이관 B) | X11 합성 드래그는 탭을 새 창으로 떼어 내 버려서 분할 드롭 타깃이 안 겨냥된다 |

---

## 9. 다른 그룹과 겹치는 파일

- `chrome/browser/ui/views/frame/browser_view.{h,cc}` — 내 hunk는 `VerticalTabStripAdjacentPaneDecorationView`와 그 배치 세 군데뿐. 편집 직전 다시 읽고 넣었다.
- `chrome/browser/ui/views/frame/multi_contents_view*` — 내 것.
- `chrome/browser/ui/page_info/chrome_page_info_delegate.cc` — 내가 처음 건드림(hunk 1개).
- G1이 만든 `TopContainerLoadingBar`(상단 로딩바)와 내 주소창 진행 표시는 서로 다른 뷰다. 둘 다 동시에 보인다(캡처 `/tmp/g2-p2-2.png`에서 상단 파란 막대 + 주소창 채움).
