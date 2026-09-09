# G1-vertical-tabs 결과 — 세로탭·탭 계통 14군데 (2026-09-06)

작성 모델: **Claude Opus 5 (1M context)** (모델 ID `claude-opus-5[1m]`).
1교대(코드·조사) + 2교대(검증·마무리) 모두 같은 모델.
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. 커밋 안 함(intent-to-add만).

**상태: 14/14 종결.** 6·8·9절이 2교대가 채운 부분이다 — 빌드한 크롬으로 직접 눌러 본 결과,
확인 중에 실제 결함 두 개를 찾아 고쳤고(6번 `aside://`, 12번 고정 칩 갱신), 12번의 가로 스트립
절반은 원인까지 좁힌 뒤 **미해결로 남긴다**(9절).

## 0. 원본 문자열을 어디서 찾았나 (뒤에 오는 사람을 위해)

원본의 UI 문구는 **바이너리 안의 UTF-16 리터럴 덩어리 한 곳**에 몰려 있다. 이걸 못 찾으면
"문자열이 없다"고 잘못 판단하게 된다. 실제 위치:

| 슬라이스 | 구역 | 내용 |
|---|---|---|
| arm64 | `0xd779ff4`–`0xd77b7f4` | 프로필 편집, 북마크 메뉴·대화상자, 채팅 메뉴·대화상자, 고정 항목, 알림 프롬프트 문구 전부 |
| x86_64 | `0xe9a68c2`–`0xe9a8144` | 같은 표(주소만 다름) |

찾는 법: 문자열을 `utf-16-le`로 인코딩해서 찾는다. ASCII로 찾으면 하나도 안 나온다.
클래스·함수 이름(ASCII)은 따로 `0xd6bbd80`–`0xd6bd141`(arm64)에 모여 있고, 여기서
`VerticalTabBookmarksView`, `VerticalPinnedTabEntriesView`, `TopContainerLoadingBar`,
`CrossSectionDragPreview`, `AsideTaskRowButton` 같은 이름을 전부 회수했다.

이 두 표를 뜬 뒤 `re-tools/xref.py`로 참조처를 찾고 `asdis.py`로 메뉴 항목 순서·명령 번호까지
읽었다. 그래서 아래 메뉴들은 **문구·순서·구분선·명령 번호가 원본과 같다**(추정이 아니다).

---

## 1. 항목별 결과 (14/14)

| # | 구간 start_hex | 이름표 | 이식 길 | 결과 |
|---|---|---|---|---|
| 1 | `0x04cab230` | 세로탭 스트립 — 작업/채팅 행, 채팅 이름 바꾸기 | 1+2 | 재현 완료 · 화면 확인 |
| 2 | `0x04c7cce0` | 북마크 메뉴·폴더 편집 대화상자 / AiTabs 뷰포트 / 상단 로딩바 | 1+2 | 재현 완료 · 화면 확인 (분할 보기 조각 2개는 G2 이관) |
| 3 | `0x04d0c8f0` | 알림 권한 프롬프트 문구 · CrossSectionDragPreview | 1+2 | 재현 완료 · 문구 2줄 화면 확인 (드래그 미리보기는 코드 확인만) |
| 4 | `0x04863470` | 탭 우클릭 메뉴 재구성 | 2 | 재현 완료 · 화면 확인 (토글까지) |
| 5 | `0x04cf7e80` | 세로탭 작업 섹션 — 채팅 보관·상태 문구 | 1+2 | 재현 완료 · 화면 확인 |
| 6 | `0x04d36f80` | 에이전트 탭 상태 버블 · `aside://` 스킴 처리 | 1 | 재현 완료 · 화면 확인 (2교대가 결함 1개 고침 — 8절 가) |
| 7 | `0x04d47880` | 탭 헤더/닫기 버튼/제목 뷰 | — | 차이 없음 확인 (아래 3절) |
| 8 | `0x0485d300` | 고정 탭 서비스 — 탐색 스로틀·재조정 | 3(이름은 1) | 재현 완료 · 동작 확인 (판정 규칙은 추정) |
| 9 | `0x0899efc0` | 세로탭 접기/펴기 지표 · 관리형 구성 | — | 차이 없음 확인 |
| 10 | `0x08715f40` | TabStripModel 활성 탭 전환 경로 | — | 차이 없음 확인 |
| 11 | `0x0d272740` | 탭 드래그 컨트롤러 — 드래그 목적지 | — | 차이 없음 확인 |
| 12 | `0x04c6a630` | 가로 탭 스트립 고정 탭 항목 뷰 | 1+2 | 세로판 재현 완료 · 화면 확인 / **가로판 미해결**(9절), 드래그 재배치 제외 |
| 13 | `0x0889bbd0` | 탭 그룹 헤더 접기/펴기 지표 | — | 차이 없음 확인 |
| 14 | `0x0d186f70` | 세로탭 hover 확장 — 마우스 속도 계산 | — | 차이 없음 확인 (문서 충돌 해소) |

합계: **새로 만든 것 8군데, 차이 없음으로 닫은 것 6군데, 불가 0군데.**
그중 **화면으로 직접 확인한 것 8군데 전부**(7절). 남은 미해결은 12번 안의 가로 스트립 배치 하나뿐(9절).
2번 안의 분할 보기 조각 2개는 G2로 이관(아래 4절).

---

## 2. 만든 것 — 항목별 상세

### 1번 `0x04cab230` — 세로탭 작업/채팅 행

원본 근거: `vertical_tab_strip_region_view.cc`, 채팅 행 메뉴 빌더 `0x43d16dc`–`0x43d1a10`,
섹션 머리 메뉴 빌더 `0x43d2734`–`0x43d2864`, 이름 바꾸기 대화상자 `0x43da3b8`.

고친 파일:
- `chrome/browser/ui/views/frame/aside_vertical_tab_strip_additions.{h,cc}`
- `chrome/browser/ui/views/frame/aside_task_views.{h,cc}`

채팅 행 우클릭 메뉴를 원본과 **문구·순서·구분선·명령 번호까지** 같게 다시 짰다.

| 명령 번호 | 문구 | 우리 동작 |
|---|---|---|
| 0x7d0 | Rename chat | 이름 바꾸기 대화상자 |
| 0x7d1 | Archive Chat | "Archive session?" 확인 후 `/archive` |
| 0x7d2 | Bookmark chat | 세션 페이지를 북마크에 추가 |
| 0x7d3 | Mark as read | `/mark-read` |
| — | (구분선) | |
| 0x7d4 | Open folder in Finder | `/open-folder` |
| 0x7d5 | Copy session ID | 클립보드 + "Session ID Copied!" 말풍선 |
| — | (구분선) | |
| 0x7d6 | Open in a new tab | 세션 페이지 열기 |

"Recent Chats & Threads" 머리 우클릭 메뉴도 새로 붙였다: 0x834 `Mark all as read`,
0x835 `Archive all chats`, 구분선, 0x836 `Show all chats`.

이름 바꾸기는 임시로 쓰던 말풍선을 버리고 원본대로 `ui::DialogModel` 대화상자로 바꿨다.
제목 "New chat name", 부제 "Choose a short, recognizable name.", 버튼 "Save"/"Cancel",
내부 이름 `VerticalTabStripRenameChat`, 텍스트 칸 식별자 `kRenameChatFieldId`
(원본이 `vertical_tab_strip_region_view.cc:286`에 선언한 그 이름).

행 제목이 비면 "Untitled task"로 채우고, 목록 끝에 "Show more" 줄을 붙였다(전체보다 적게
보일 때만 보인다).

**전에 잘못 쓰던 문구를 고쳤다**: "Rename Chat"→"Rename chat", "Mark as Read"→"Mark as read",
"Archive All Chats"→"Archive all chats", "Open Folder"→"Open folder in Finder".

### 2번 `0x04c7cce0` — 북마크 우클릭 메뉴·대화상자·빈 상태·상단 로딩바

원본 근거: `vertical_tab_bookmarks_view.cc`(클래스 `VerticalTabBookmarksView`,
`VerticalBookmarkRowView`), 폴더 메뉴 빌더 `0x43c2700`, 북마크 메뉴 빌더 `0x43c2b80`–`0x43c2ee0`,
대화상자 `0x43c6c00`–`0x43c7c60`, 텍스트 칸 식별자 이름은 원본이 소스 148–150줄에
`kRenameFolderFieldId` / `kEditBookmarkNameFieldId` / `kEditBookmarkUrlFieldId`로 선언해 뒀다.

만든 파일:
- `chrome/browser/ui/views/frame/aside_bookmark_dialogs.{h,cc}` (새로 만듦)

고친 파일:
- `chrome/browser/ui/views/frame/aside_bookmarks_section_view.{h,cc}`

폴더 줄 우클릭 메뉴: 1 `Rename`, 2 `Delete`, 구분선, 3 `Manage Bookmarks`.
북마크 줄 우클릭 메뉴: 0x64 `Edit`, 0x65 `Delete`, 구분선, 0x66 `Open in Incognito window`,
0x67 `Open in new tab group`, 0x68 `Open in new tab`, 0x69 `Open in new window`,
0x6a `Open in split view`.

대화상자 4개를 원본 문구 그대로 만들었다(크로미움 `ui::DialogModel` 위에 얹음 — 이식 길 2).

| 대화상자 | 제목 | 본문/칸 | 확인 버튼 |
|---|---|---|---|
| 폴더 이름 바꾸기 | Rename Folder | Folder name | Rename |
| 폴더 삭제 | Delete Folder | `Delete "<이름>" and everything inside it?` (이름 없으면 `Delete this folder and everything inside it?`) | Delete |
| 북마크 편집 | Edit Bookmark | Name, URL | Save |
| 북마크 삭제 | Delete Bookmark | `Delete "<이름>"?` (이름 없으면 `Delete this bookmark?`) | Delete |

빈 상태 줄 "Drag tabs here to add bookmarks"도 붙였다(구역이 펼쳐졌고 항목이 0개일 때만).

상단 로딩바: 원본 클래스 `LoadingBarView` / `TopContainerLoadingBar`와 메타데이터 속성
`LoadingProgress`(빌더 `0x43a978c`–`0x43a97f4`)를 그대로 써서
`chrome/browser/ui/views/frame/top_container_loading_bar.{h,cc}`를 새로 만들고
`top_container_view.{h,cc}`에 달았다. 활성 탭의 적재 진행률을 따라가고, 끝나면 사라진다.
브라우저 배치기는 이 자식을 모르므로 `TopContainerView::OnBoundsChanged`가 직접 자리를 잡는다
(G2의 배치 코드와 겹치지 않게 하려는 선택).

`Open in split view`는 크로미움의 `TabStripModel::AddToNewSplit`에 원본과 같은 출처값
`SplitTabCreatedSource::kBookmarkContextMenu`(원본 문자열 `BookmarkContextMenu`, `0xd3176da`)를
넘긴다.

### 3번 `0x04d0c8f0` — 알림 권한 프롬프트 문구 · CrossSectionDragPreview

원본 근거: 문구 두 줄이 권한 프롬프트 안에서 만들어진다(`0x4438f70`은
"Get notifications instantly, or let AI handle them for you.", `0x4438a14`는
"Allow once, or always allow for this site."). 드래그 미리보기 클래스 이름은
`VerticalTabStripRegionView::CrossSectionDragPreview`(`0xd6bc8ba`).

고친 파일:
- `chrome/browser/ui/views/permissions/permission_prompt_bubble_one_origin_view.cc`
- `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.{h,cc}`

알림 요청이면 첫 줄을, 그 밖에 "이번만 허용"을 줄 수 있는 요청이면 둘째 줄을
크로미움의 기존 `CreateExtraTextLabel()` 자리에 그대로 넣는다(이식 길 2 — 새 뷰를 만들지 않았다).

`CrossSectionDragPreview`는 `VerticalTabStripRegionView` 안의 중첩 클래스로 만들었다.
탭·링크를 끌 때 목적지가 탭 목록 밖(Aside 행·북마크 구역·고정 항목)이면 그 구역 위에
반투명 띠를 그린다. 목적지가 탭 목록 안이면 기존 드롭 화살표를 그대로 쓴다.

### 4번 `0x04863470` — 탭 우클릭 메뉴 재구성

원본 근거: 지표 이름 25개 중 우리에게 **딱 하나 없던 것**이
`Tab.ContextMenu.AddToBookmarks.SelectedTabsCount`였다(나머지 24개와 사용자 행동 17개는
크로미움 151에 이미 있다 — 3절 참고). 문구는 `Add bookmark` / `Remove bookmark`
(`0xd77b120` / `0xd77b0dc`).

고친 파일:
- `chrome/browser/ui/tabs/tab_strip_model.{h,cc}` — `CommandAddToBookmarks` 추가,
  지표·사용자 행동 기록, 고른 탭이 전부 북마크돼 있으면 지우고 아니면 넣는 토글,
  보조 함수 `AreAllTabsBookmarked()`
- `chrome/browser/ui/tabs/tab_menu_model.cc` — 읽기 목록 항목 옆에 메뉴 항목 추가

### 5번 `0x04cf7e80` — 채팅 보관·상태 문구

원본 근거: `Archive Chat`, `archive`, `archive-all-chats`, `Awaiting answer`,
`Awaiting approval`, `ProfileSearchButton`, `VerticalTabsResizeArea`.

고친 파일:
- `chrome/browser/ui/views/frame/aside_vertical_tab_strip_additions.{h,cc}`
- `chrome/browser/ui/views/frame/aside_task_views.{h,cc}`
- `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc`

보관 확인 대화상자 두 개를 원본 문구로 만들었다:
"Archive session?" / "This will archive this task" / 버튼 "Archive",
"Archive all chats?" / "This will archive all chats." / 버튼 "Archive".

행 상태 문구를 붙였다: 상태가 `awaiting-approval`이면 "Awaiting approval",
`awaiting-answer`면 "Awaiting answer"를 행 오른쪽에 작은 글씨로. 도구 설명에도 붙는다.
(전에는 점 색깔만 달랐고 글자는 없었다.)

크기 조절 손잡이에 원본 클래스 이름 `VerticalTabsResizeArea`를 주는 얇은 하위 클래스를 만들었다.
동작은 그대로다.

### 6번 `0x04d36f80` — `aside://` 스킴 처리

원본 근거: `status_bubble_views.cc` 안에서 표시 문자열이 `"chrome://"`(9글자)로 시작하면
`"aside://"`로 바꾼다(`0x4443950`–`0x444399c`, 그리고 `0x444368c`–`0x44436a4`).

고친 파일:
- `chrome/browser/ui/views/status_bubble_views.cc`

상태 말풍선(왼쪽 아래 링크 미리보기)이 브라우저 자체 페이지를 `aside://`로 보여 준다.
표시만 바뀐다 — 실제 스킴을 새로 등록하지 않는다.
에이전트 탭 버블의 `/newtab.html#/u/`·`/settings/general` 경로는 이미
`aside_agent_tabs_button.cc:293`에 재현돼 있었다.

### 8번 `0x0485d300` — 고정 탭 서비스

원본 근거: `pinned_tab_service.cc` 안의 `PinnedTabNavigationThrottle`(로그 이름을 돌려주는
함수가 `0x3fcaf60`)과 `SchedulePinnedTabsReconciliation`(`0x3fcaf6c`: `+0xc8` 바이트를
시험·설정한 뒤 작업 하나를 던진다).

고친 파일:
- `chrome/browser/ui/tabs/pinned_tab_service.{h,cc}`
- `chrome/browser/chrome_content_browser_client_navigation_throttles.cc` (등록 한 줄)

`SchedulePinnedTabsReconciliation()`은 원본과 같은 모양이다: bool 하나로 한 번만 예약,
작업에서 각 창의 고정 탭이 앞쪽에 연속으로 모이도록 되돌린 뒤 저장한다.

`PinnedTabNavigationThrottle`은 이름과 로그 이름이 원본과 같다. **판정 규칙은 추정이다**:
고정 탭에서 페이지가 스스로 시작한 링크 이동이 다른 사이트(등록 가능 도메인 기준)로 가면
그 이동을 취소하고 새 탭에서 연다. 원본의 정확한 조건식은 문자열로 복원되지 않는다
(검사 함수 네 칸이 모두 기본 구현을 가리켜서, 판정이 어느 함수에 있는지도 확정 못 했다).
이 점을 결과에 그대로 남긴다.

### 12번 `0x04c6a630` — 고정 탭 항목 뷰

원본 근거: `HorizontalPinnedTabEntriesView` / `::EntryView` / `FinishEntryDrag`
(`0xd6bb870`), 세로판은 `VerticalPinnedTabEntriesView`(`0xd6bc551`), 문구는
`Switch to `, `Paused`, `, Paused`, `Remove from pin`, `Remove from pin: `,
`Add bookmark`, `Add to bookmarks: `, `Remove bookmark`, `Remove bookmark: `.

만든 파일:
- `chrome/browser/ui/views/frame/aside_pinned_entries_view.{h,cc}` (새로 만듦, 가로·세로 공용)

고친 파일:
- `chrome/browser/ui/views/frame/horizontal_tab_strip_region_view.{h,cc}` (탭 스트립 앞에 달기)
- `chrome/browser/ui/views/frame/aside_vertical_tab_strip_additions.cc` (세로판에도 달기)

고정 탭 하나당 파비콘 칩 하나. 누르면 그 탭으로 간다(도구 설명 "Switch to <제목>",
잠든 탭은 "<제목>, Paused"). 우클릭 메뉴는 "Remove from pin"과
"Add bookmark"/"Remove bookmark"(이미 북마크면 뒤엣것). 접근성 이름은 원본의 접두사 형태
("Remove from pin: <제목>" 등)를 쓴다.

**재현 못 한 것**: 칩 끌어 옮기기(`PinnedEntryDragGhost`, `FinishEntryDrag`,
`CancelEntryDragFromCaptureLoss`)와 북마크를 칩 줄에 떨어뜨리기
(`OnBookmarkDroppedOnPinnedEntries`, `BookmarkDragPreview`). 이름만 남아 있고 동작을
복원할 근거가 없다.

---

## 3. 차이 없음으로 닫은 것 6군데 — 왜 그렇게 판정했나

이 여섯은 "덜 만듦/안 만듦"으로 적혀 있었지만, **원본 구간 안의 이름과 지표를 하나씩 우리
트리에서 찾아 본 결과 전부 있었다**. 즉 그 구간은 크로미움 151 상위 코드이고, 바이트가 안 맞는
이유는 원본이 그 코드를 훨씬 큰 파일 하나에 넣어 컴파일했기 때문이다(원본 추적 문자열이
`vertical_tab_strip_region_view.cc:15365`를 가리킨다 — 우리 파일은 1,200줄 남짓이다).

| # | 확인한 이름·지표 | 우리 트리 위치 |
|---|---|---|
| 7 | `TabTitle`, `TabIcon::PaintAttentionIndicatorAndIcon`, `TabIcon::PaintLoadingAnimation`, `TabIcon::MaybePaintFavicon`, `TabIconThrobberLayer`, `TabCloseButton`, `kDrawFocusRingBackgroundOutline`, `TabGroupHeader` | `views/tabs/tab/tab_title.h`, `tab_icon.cc`, `tab_close_button.h`, `tab_group_header.cc` — 전부 있음 |
| 9 | `VerticalTabs_TabStrip_ButtonToggleCollapsed/Uncollapsed`, `VerticalTabs_TabStrip_ResizeToCollapsed/Uncollapsed`, `VerticalTabs_TabStrip_ContextMenuToggleCollapsed/Uncollapsed`, `Tabs.VerticalTabs.TabStripSize`, `OriginManagedConfiguration` | `browser_actions.cc`, `vertical_tab_strip_region_view.cc`, `system_menu_model_delegate.cc`, `managed_configuration_store.cc` |
| 10 | `TabStripModel::ActivateTabAt` (이 구간의 유일한 문자열) | `tab_strip_model.cc`. 게다가 4번에서 이 클래스에 메뉴 명령을 하나 더 넣었으므로, 원본이 여기서 달랐던 이유(명령 추가로 인접 코드가 밀림)도 같이 맞춰졌다 |
| 11 | `TabStrip.%s.TabDragDestination`, `VerticalTabStrip`, `HorizontalTabStrip`, `TabDragController::OnWidgetBoundsChanged`, `EndMoveLoop in DragBrowserToNewTabStrip` | `views/tabs/dragging/tab_drag_controller.cc` (1953, 2285, 3097줄) |
| 13 | `TabGroups_TabGroupHeader_Expanded/Collapsed`, `TabGroups_SwitchGroupedTab`, `TabGroups.Shared.SwitchGroupedTab`, `TabStrip.Tab.Views.ActivationAction` | `browser_tab_strip_controller.cc`, `tab_strip_collection_controller.cc` |
| 14 | `CalculateMouseVelocityForExpandOnHover`, `RestartExpandOnHoverTimer`, `UpdateExpandOnHoverState`, `VerticalTabs_ExpandOnHover_Show/Hide`, `Tabs.VerticalTabs.ExpandOnHover.ShowDuration` | `vertical_tab_strip_region_view.cc` 1097–1200줄. 원본 역어셈블(`0xbfad5f0`–`0xbfad830`)과 우리 코드의 구조가 같다: 첫 표본 초기화 → 감시 타이머 → 표본 수 세기 → 시간차를 기능 매개변수와 비교 |

**14번 문서 충돌 해소**: 복원 지도는 "Aside가 이 자리를 고쳤다"고 봤고 VERSION-STEPS는
"재현 완료"라고 적었다. 실측 결과 **VERSION-STEPS가 맞다**. 함수 이름·지표·기능 매개변수
9개(`expand_on_hover_delay` 350ms, `..._velocity_heuristic_min_samples` 3,
`..._interval` 10ms, `..._threshold` 0.25, `..._distance_from_edge` 12,
`..._edge_delay` 200ms 등)가 우리 트리에 그대로 있고 기본값으로 켜져 있다.
원본의 매개변수 기본값 자체는 바이너리에서 읽어내지 못했다 — 이건 남은 미확인으로 적는다.

---

## 4. G2로 이관한 것

제 구간 2번(`0x04c7cce0`) 안에 분할 보기 파일의 심볼 두 개가 섞여 있다.
같은 파일을 G2가 담당(4번 `0x04c6d1f0` MultiContentsView 통합)하므로 넘겼다.

| 심볼 | 원본 경로 | 근거 주소 |
|---|---|---|
| `AsideAiTabsViewport` | `chrome/browser/ui/views/frame/multi_contents_view.h` | arm64 `0xd6bbe30` |
| `FloatingTabDragView` | `multi_contents_view_drop_target_controller.cc` 근처 | arm64 `0xd6bbfa4` |

## 5. G6과 겹치는 파일

G6이 `aside_bookmarks_section_view.{h,cc}`에 북마크-탭 대표 구조
(`AsideBookmarkTabRepresentation`)를 넣고 있다. 제 변경(우클릭 메뉴 2종, 대화상자 호출,
빈 상태 줄)은 같은 파일 안이지만 함수가 겹치지 않는다.

---

## 6. 빌드

2교대가 코드 세 군데를 더 고치고(8절) 다시 빌드했다. 전부 `flock /tmp/aside-ninja.lock` 안에서
`ninja -C out/aside chrome -j4 -l 6`. autoninja 안 씀.

| 회차 | 로그 | 시작 | FAILED | 결과 |
|---|---|---|---|---|
| 1 | `/tmp/aside-build-G1.log` | 11:57:04 | 3 | **내 코드 아님** — G2가 그때 편집 중이던 `multi_contents_view.h:294`의 `ai_tabs_viewport_` 미선언이 뿌리. 같은 시각 내 `status_bubble_views.o`는 11:57:27에 정상 컴파일됨(단독 타깃으로 확인). 오케스트레이터에게 알림 |
| 2 | `/tmp/aside-build-G1.log` | 12:08:09 | 0 | 링크 성공, 바이너리 12:08:49 |
| 3 | `/tmp/aside-build-G1probe.log` | 12:20 대 | 0 | 임시 진단 로그(9절) 넣은 빌드, 바이너리 12:21:23 |
| 4 | `/tmp/aside-build-G1.log` | 12:23:30 | 0 | 가로 배치 시도 빌드, 바이너리 12:24:00 — 확인 결과 효과 없고 탭 검색 버튼만 밀려서 되돌림 |
| **5 (최종)** | `/tmp/aside-build-G1.log` | **12:26:40** | **0** | 되돌린 상태로 재빌드, **바이너리 `out/aside/chrome` mtime 12:27:15** |

성공 판정은 둘 다 봤다: 로그 `grep -c FAILED` = 0, 그리고 바이너리 mtime이 그 빌드 시작 시각보다 뒤.
최종 상태에서 `ninja -n` = no work to do.

## 7. 확인 증거 — 빌드한 크롬으로 직접 눌러 봤다

화면 `:111`(Xvfb 1400x900), 독립 크롬 1개
(`--no-sandbox --no-first-run --user-data-dir=/tmp/aside-ui-G1 --remote-debugging-port=9411`),
Aside 확장은 로드하지 않음. 캡처는 `aside-fork/ui-shots/G1-*.png` (34장, 번호 00·02~34).

확인을 위해 보조 장치 두 개를 썼다. 둘 다 라이브 환경을 건드리지 않는다.

1. **북마크 씨앗**: `/tmp/aside-ui-G1/Default/Bookmarks`에 북마크 1개 + 폴더 1개를 넣고 띄웠다.
2. **가짜 데몬**: 세로탭의 작업·채팅 행은 데몬의 `/session/for-chrome/*`에서 온다. 라이브 데몬
   (21420)은 금지라, `AsideDaemonAuthorizer::DaemonBaseUrl()`이 읽는 환경변수
   `ASIDE_DAEMON_BASE_URL=http://127.0.0.1:8712`로 **내가 만든 응답기**를 가리켰다
   (`/tmp/aside-g1-www/daemon.py`, 확인 끝나고 종료). 덕분에 채팅 행·상태 문구·이름 바꾸기·보관을
   전부 실제 UI로 확인했다. **"라이브 확인 필요"로 남긴 항목은 없다.**

| # | 확인한 것 | 방법 | 캡처 |
|---|---|---|---|
| 1 | 채팅 행 우클릭 메뉴 7항목·구분선 2개(Rename chat / Archive Chat / Bookmark chat / Mark as read ‖ Open folder in Finder / Copy session ID ‖ Open in a new tab) | 가짜 데몬 + 우클릭 | `G1-24` |
| 1 | 이름 바꾸기 대화상자: 제목 "New chat name", 부제 "Choose a short, recognizable name.", 칸 이름 "New chat name", Save·Cancel | 메뉴 → Rename chat | `G1-25` |
| 1 | 이름 바꾸기 **왕복**: 입력 → `POST /session/for-chrome/s-idle-1/rename {"title":"Renamed by G1"}` → 목록 갱신 | 가짜 데몬 호출 기록 | `G1-26` |
| 1 | "Untitled task"(제목 빈 항목)와 "Show more"(전체 10 > 보이는 8) | 가짜 데몬 목록 | `G1-23` |
| 1 | 섹션 머리 메뉴(Mark all as read / Archive all chats ‖ Show all chats) | "Recent Chats & Threads" 우클릭 | `G1-27` |
| 1 | "Session ID Copied!" 말풍선 | Copy session ID | `G1-31` |
| 2 | 북마크 줄 메뉴 8항목(Edit / Delete ‖ Open in Incognito window / Open in new tab group / Open in new tab / Open in new window / Open in split view) | 우클릭 | `G1-03` |
| 2 | 폴더 줄 메뉴(Rename / Delete ‖ Manage Bookmarks) | 우클릭 | `G1-05` |
| 2 | 대화상자 3개 문구 그대로: Edit Bookmark(Name/URL/Save), Delete Folder(`Delete "News Folder" and everything inside it?`), Rename Folder(Folder name/Rename) | 메뉴에서 열기 | `G1-04`, `G1-06`, `G1-07` |
| 2 | 빈 상태 줄 "Drag tabs here to add bookmarks" | 북마크 0개 상태 | `G1-00` |
| 2 | 상단 로딩바: 적재 중 보이고 끝나면 사라짐 | 12초 스트리밍 페이지 | `G1-22` |
| 3 | 알림 프롬프트 "Get notifications instantly, or let AI handle them for you." | `Notification.requestPermission()` | `G1-16` |
| 3 | 한 번 허용 프롬프트 "Allow once, or always allow for this site." | 위치 권한(localhost) | `G1-18` |
| 4 | 탭 우클릭 메뉴에 "Add bookmark"(읽기 목록 바로 아래) — 세로·가로 양쪽 | 우클릭 | `G1-08` |
| 4 | 토글: 누르면 북마크 생성 + 주소창 별표 채워짐 → 메뉴가 "Remove bookmark"로 바뀜 | 실제 클릭 | `G1-09`, `G1-10` |
| 5 | 행 상태 글씨 "Awaiting approval" / "Awaiting answer" + 상태 점 | 가짜 데몬 status 값 | `G1-23` |
| 5 | "Archive session?" / "This will archive this task" / Archive | 채팅 행 → Archive Chat | `G1-29` |
| 5 | "Archive all chats?" / "This will archive all chats." / Archive | 섹션 머리 → Archive all chats | `G1-28` |
| 5 | 보관 **왕복**: `POST .../s-idle-1/archive` 뒤 행이 사라지고 다음 항목이 올라옴 | 가짜 데몬 호출 기록 | `G1-30` |
| 6 | 상태 말풍선이 `chrome://settings`를 **`aside://settings`**로 보여 줌 (확장 지연 뒤에도 유지) | 링크 hover | `G1-33` |
| 8 | 고정 탭 안에서 같은 사이트 링크는 그 탭에서 이동 | `127.0.0.1:8711` → `/other` | `G1-20` |
| 8 | 고정 탭에서 다른 사이트 링크는 취소되고 **새 탭**에서 열림(고정 탭은 원래 주소 유지) | `127.0.0.1` → `localhost` | `G1-21` |
| 12 | 세로탭 고정 칩 도구 설명 "Switch to about:blank" / "Switch to G1 probe" | hover | `G1-13`, `G1-34` |
| 12 | 세로탭 고정 칩 메뉴(Remove from pin / Remove bookmark — 북마크된 탭이라 뒤엣것) | 우클릭 | `G1-12` |

확인용 페이지·응답기는 `/tmp/aside-g1-www/`(`server.py` 8711, `daemon.py` 8712)에 있고 확인이
끝난 뒤 둘 다 종료했다.

## 8. 이어받아 고친 것 2가지 (검증하다 드러난 실제 결함)

### (가) `aside://` 표시가 곧바로 되돌아가던 문제 — 6번

첫 확인에서 링크 위에 커서를 올리니 말풍선이 여전히 `chrome://settings`였다.
원인: `StatusBubbleViews::SetURL`의 네 자리는 치환돼 있었지만, 잠시 뒤 도는
`StatusBubbleViews::ExpandBubble()`이 `url_text_`를 **다시** 계산하면서 치환을 건너뛴다.
전체 URL이 줄인 것보다 길면 항상 이 경로를 타므로 사실상 늘 원래 문자열로 되돌아갔다.

고침: `chrome/browser/ui/views/status_bubble_views.cc:1102` — `ExpandBubble()`의 재계산도
`AsideRewriteSchemeForDisplay(...)`로 감쌌다. 이제 다섯 자리가 모두 같은 함수를 지난다.
확인: 고치기 전 `G1-15`(`chrome://settings`로 보임), 고친 뒤 `G1-33`(hover 직후와 확장 지연 뒤
둘 다 `aside://settings`).

### (나) 고정 칩이 고정 상태 변화를 못 따라가던 문제 — 12번

`AsidePinnedEntriesView`는 `OnTabStripModelChanged`만 관찰했다. 그런데 **이미 제자리에 있는 탭을
고정하면 탭 목록 자체는 바뀌지 않아서** 그 알림이 오지 않는다. 고정은 별도 알림
`OnTabPinnedStateChanged`로 온다. 그래서 창을 새로 띄우거나 세션을 복원한 뒤에는 고정 탭이 있어도
칩이 하나도 안 나오는 상태가 유지됐다(맨 처음 확인 때 우연히 보였던 건 고정하면서 탭이 앞으로
옮겨져 목록 변경 알림이 같이 왔기 때문이다).

고침: `aside_pinned_entries_view.{h,cc}`에 두 관찰자를 추가 —
`OnTabPinnedStateChanged`(무조건 다시 그림), `OnTabChangedAt`(제목·파비콘이 바뀌는 `kAll`일 때만).
확인: `G1-34` (고정 직후 칩이 바로 생기고 도구 설명이 "Switch to G1 probe").

### 참고: HEAL 담당이 내 파일에 넣은 수정은 의도와 맞다

`pinned_tab_service.cc`의 두 자리를 `tabs::TabInterface::GetFromContents` →
`MaybeGetFromContents`로 바꾼 것(HEAL-RESULT 11번)은 **맞는 수정이다**. 이 스로틀은 탭이 아닌
WebContents(옴니박스 팝업 미리 띄우기 등)에도 불려 오고, 바로 뒤 `if (!tab || !tab->IsPinned())`
검사가 이미 널을 받도록 쓰여 있었다. 고정 탭 판정 논리는 하나도 바뀌지 않았다.
8번 확인(`G1-20`/`G1-21`)이 이 수정 위에서 통과했다.

## 9. 남은 미해결 하나 — 12번 가로 탭 스트립의 칩 배치

세로판은 된다(`G1-12`·`G1-13`·`G1-34`). **가로 탭 스트립에서는 칩이 안 보인다.**

확정한 사실(추측 아님):

1. 칩 뷰는 **정상적으로 붙어 있다.** 생성자에 임시 로그를 넣고 빌드해 확인했다 —
   `ASIDE_G1_PROBE added chips view=0x... parent=0x...` 한 줄이 창을 띄울 때마다 찍힌다.
   (로그는 확인 뒤 제거했고 최종 트리에 없다.)
2. 배치에는 들어간다. 고정 탭을 하나 더 만들면 탭 스트립의 x가 칩 하나 너비만큼 밀린다.
3. 그런데 **그 자리에 아무것도 그려지지 않고 마우스도 안 잡힌다**(`G1-32`). 칩이 있어야 할 왼쪽 구역을
   700%로 확대해도 배경색 한 가지뿐이고, 그 위에 커서를 올려도 "Switch to ..." 도구 설명이 안 뜬다.
4. UI DevTools(`--enable-ui-devtools`)로 뷰 트리를 뜨면 `HorizontalTabStripRegionView`의 자식은
   `TabStrip` / `TabStripControlButton` / `TabStripComboButton` / `FrameGrabHandle` 넷뿐이고
   칩 뷰는 목록에 없다. 1번과 어긋나므로 이 도구의 목록이 실제 자식 전부는 아닌 것으로 본다.

시도했다가 **되돌린 것**: 이 파일은 앞쪽 버튼들을 `kViewIgnoredByLayoutKey`로 배치에서 빼고 자기
레이어에 그린 뒤 그 자리를 *탭 스트립의 왼쪽 여백*으로 벌충한다. 칩은 배치에 들어가는 정상
자식이라 그 여백보다 앞(x=0 예약 구역)에 깔린다고 보고, `UpdateTabStripMargin()`에서 앞쪽 여백을
칩에 옮기고 `AdjustViewBoundsRect()`의 기준점을 칩의 x로 바꿔 빌드해 봤다(4회차 빌드).
**칩은 여전히 안 보였고 탭 검색 버튼만 왼쪽으로 밀렸다** — 눈에 보이는 퇴행이라 두 hunk 모두
되돌렸다. 지금 트리의 `horizontal_tab_strip_region_view.{h,cc}` 변경은 1교대가 넣은 배선 그대로다.

남기는 이유: 여기서 더 가려면 가로 스트립의 그리기·레이어 순서를 파고들어야 하는데, 그 파일은
G2(프레임·툴바)가 같은 시간에 편집 중이었다. 검증 안 된 배치 변경을 공유 파일에 남기는 것보다
**원인을 좁힌 상태로 넘기는 편이 낫다고 판단**했다. 다음 사람이 볼 곳:
`HorizontalTabStripRegionView::Layout(PassKey)`(390줄 근처)와 `AdjustViewBoundsRect()`(756줄 근처),
그리고 `UpdateTabStripMargin()`의 `kViewIgnoredByLayoutKey` 처리.

참고: Aside는 세로탭이 기본이고 가로 스트립은 대체 모드다. 원본 문자열
`HorizontalPinnedTabEntriesView`가 있으니 기능 자체는 원본에 존재한다.

## 10. 산출물

| 것 | 경로 |
|---|---|
| 패치 스냅샷 | `aside-fork/patches/041-G1.patch` (26개 파일, +3,182 −8) |
| 캡처 | `aside-fork/ui-shots/G1-00` ~ `G1-34` (34장) |
| 차등 기록 | `aside-fork/DIFFERENTIAL.md` "(12) G1 세로탭 복원" 절 |

패치에 대한 주의 두 가지:

- `aside_vertical_tab_strip_additions.{h,cc}`, `aside_task_views.{h,cc}`,
  `aside_bookmarks_section_view.{h,cc}`는 `cc5584af0d`에 없는 파일인데 여태 `git add -N`이 안 돼
  있어서 diff에 안 잡히고 있었다. 이번에 intent-to-add 했다. 그래서 패치에는 이 여섯 파일이
  **통째로** 들어간다(G1 변경분만이 아니라 이전 세션 작업까지).
- `chrome_content_browser_client_navigation_throttles.cc`의 hunk에는 광고차단 담당이 넣은
  `AsideAdBlockNavigationThrottle::MaybeCreateAndAdd` 한 줄이 같은 자리에 붙어 있어 함께 들어간다.
