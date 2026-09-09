# UI 층 계획 (2번) — 원본 바이너리 인벤토리 기반 (2026-09-05)

## 발견
- 원본의 세로탭 pref(`vertical_tabs.enabled/expand_on_hover/collapsed_state/uncollapsed_width/enabled_first_time`)는 Chromium 151 내장 세로탭(`chrome/browser/ui/views/tabs/vertical/`)과 동일 → 세로탭 본체는 내장 기능. 포크는 `vertical_tabs.enabled` 기본 true(patch 026).
- Aside 고유 추가 pref: `vertical_tabs.strip_collapsed`, `vertical_tabs.strip_uncollapsed_width`, `tab_search.pinned_to_tabstrip`, `projects_panel.*`, `everything_menu.*`, `horizontal_tab_strip.shrink_to_fit_enabled`.
- Aside 전용 WebUI: `chrome://aside-adblock`(구현, 패치 035), `chrome://aside-import-data`(구현, 패치 032).

## Views/UI (28)
- AsideAgentTabsBubbleView
- AsideAgentTabsButton
- AsideAiTabsViewport
- AsideChromiumProfilePickerController
- AsideIconButton
- AsideMenuItemButton
- AsideMenuPanel
- AsideNewChatTabButton
- AsideProfileAvatar
- AsideSectionClipView
- AsideSectionHeaderButton
- AsideSectionRowButton
- AsideSectionView
- AsideSyncEncryptionController
- AsideSyntheticWindowShadowWindow
- AsideTabSearchBubbleContentsView
- AsideTabSearchWebView
- AsideTabSwitcherItemView
- AsideTabSwitcherView
- AsideTaskBadgeView
- AsideTaskPopoverCloseButton
- AsideTaskPopoverContentController
- AsideTaskRowButton
- AsideTaskStatusDotView
- AsideTaskThrobberView
- AsideTooltipContentView
- AsideTooltipController
- AsideUpdateBadgeButton

## Services (18)
- AsideAccountPasswordDownloadUiSuppressed
- AsideAccountPasswordGate
- AsideAdBlock
- AsideAdBlockCosmetic
- AsideAdBlockNavigationThrottle
- AsideAdBlockService
- AsideAgentManager
- AsideCookieSyncService
- AsideDaemon
- AsideDaemonSessionToken
- AsideInbox
- AsidePasswordManager
- AsideProfileAttributesUpdater
- AsideSecureToken
- AsideSessionToken
- AsideSyncRefreshWatchdog
- AsideUpdater
- AsideWebsiteStorageSyncService

## Other (6)
- AsideNewChatTabButtonContainer
- AsideOmniboxAPI
- AsideProfileMenuDeleteProfile
- AsideProfileMenuEditProfile
- AsideSectionDivider
- AsideSoftwareUpdate

## 단계 (RE 유도, 사용자 가시성 순)
1. 내장 세로탭 스트립 확인/보정: 기본 on, `strip_collapsed`/`strip_uncollapsed_width` 추가 pref, 확장 setTabStyle 연동 확인.
2. AsideNewChatTabButton(+Container): 세로탭 상단 '새 채팅' 버튼 → 확장 newtab/sidepanel 열기.
3. AsideAgentTabsButton + AsideAgentTabsBubbleView: 에이전트 탭 목록 버블.
4. AsideTabSwitcherView/ItemView: Ctrl+Tab 전환기(`aside.tab_switcher.sort_by_recently_used` 소비처).
5. AsideSection* (SectionView/HeaderButton/RowButton/Divider/ClipView): 세로탭의 북마크 섹션(`aside.vertical_tabs.bookmarks_section_enabled/expanded/expanded_bookmark_folder_ids` 소비처).
6. AsideTask* (BadgeView/StatusDot/Throbber/RowButton/PopoverContentController): 데몬 작업 상태 배지·팝오버.
7. AsideMenuPanel/MenuItemButton, AsideProfileAvatar, AsideUpdateBadgeButton, AsideTooltipController.
8. WebUI: aside-import-data(가져오기 페이지, browser-import-* 리스너), aside-adblock(AdBlock 서비스).
각 단계: 바이너리에서 클래스 문자열 xref → 생성/레이아웃 코드 RE → views 구현 → Xvfb 스크린샷 비교.

## 확장이 제공하는 UI 표면 (manifest)
- `chrome_url_overrides.newtab = newtab.html` → 새 탭 = Aside 채팅 페이지 (네이티브 "새 채팅" 버튼은 새 탭 생성으로 충분할 가능성).
- `side_panel.default_path = sidepanel.html`, 명령 `_execute_action` Alt+Shift+B "Open Aside sidepanel".
- 페이지: newtab / sidepanel / minipopup(+options) / tabsearch / notification / main / account-password / iframe / tab-preview-player.
- `tabsearch.html`이 web_accessible → 네이티브 AsideTabSearchBubbleContentsView/WebView가 이 페이지를 버블에 띄움 (chrome://tab-search 대체).
- 원본 리소스 pak의 SVG/PNG는 임포터 WebUI용 브라우저 로고(chrome/edge/firefox/atlas/comet/dia/safari) — 세로탭 아이콘은 코드 내 벡터 아이콘.

## 원본 소스 파일 지도 (바이너리의 CHECK 경로 문자열, original-resources/binary-source-paths.txt)
### Aside 추가 파일 (31)
- chrome/browser/component_updater/aside_component_installer.cc
- chrome/browser/component_updater/aside_component_update_service.cc
- chrome/browser/component_updater/aside_component_update_service_helpers.cc
- chrome/browser/extensions/api/aside_browser_import/aside_browser_import_api.cc
- chrome/browser/extensions/api/aside_browser_preferences/aside_browser_preferences_api.cc
- chrome/browser/extensions/api/aside_omnibox/aside_omnibox_api.cc
- chrome/browser/profiles/aside_account_password_gate.cc
- chrome/browser/profiles/aside_accounts_state_reader.cc
- chrome/browser/signin/aside_daemon_authorizer.cc
- chrome/browser/signin/aside_profile_attributes_updater.cc
- chrome/browser/sync/aside_cookie_sync_service.cc
- chrome/browser/sync/aside_sync_auth_manager.cc
- chrome/browser/sync/aside_sync_encryption_controller.cc
- chrome/browser/sync/aside_sync_refresh_watchdog.cc
- chrome/browser/ui/views/frame/aside_mini_popup_coordinator.cc
- chrome/browser/ui/views/frame/aside_mini_popup_focus_restorer_mac.mm
- chrome/browser/ui/views/frame/aside_tab_search_bubble.cc
- chrome/browser/ui/views/frame/aside_tab_switcher.cc
- chrome/browser/ui/views/frame/aside_tab_switcher_view.cc
- chrome/browser/ui/views/frame/aside_tab_switcher_view.h
- chrome/browser/ui/views/profiles/aside_profile_menu_view.cc
- chrome/browser/ui/views/tabs/aside_agent_tabs_button.cc
- chrome/browser/ui/views/tabs/aside_agent_tabs_button.h
- chrome/browser/ui/views/tabs/aside_update_badge_button.cc
- chrome/browser/ui/views/tabs/aside_update_badge_button.h
- chrome/browser/ui/webui/aside_importer/aside_importer_ui.cc
- chrome/browser/ui/webui/aside_importer/chromium_profile_migrator.cc
- chrome/browser/ui/webui/aside_importer/firefox_cookie_importer.cc
- chrome/browser/ui/webui/aside_importer/firefox_profile_importer.cc
- components/aside_adblock/content/browser/aside_adblock_service.cc
- components/aside_adblock/content/renderer/aside_adblock_render_frame_observer.cc

### Chromium 151 트리에 없는 파일 (14; 세로탭 추가 뷰 + mac 전용)
- chrome/app/geist_font_registration_mac.mm
- chrome/browser/devtools/secure_remote_debugging_credentials_mac.mm
- chrome/browser/ui/views/extensions/extension_popover_mac.mm
- chrome/browser/ui/views/frame/top_container_loading_bar.h
- chrome/browser/ui/views/frame/vertical_pinned_tab_entries_view.cc
- chrome/browser/ui/views/frame/vertical_pinned_tab_entries_view.h
- chrome/browser/ui/views/frame/vertical_tab_bookmarks_view.cc
- chrome/browser/ui/views/page_info/page_info_reload_bubble_view.cc
- chrome/browser/ui/views/page_info/page_info_reload_bubble_view.h
- chrome/browser/ui/views/profiles/profile_monogram_avatar_view.h
- chrome/browser/ui/views/tabs/common/tab_expand_chevron_view.h
- chrome/browser/ui/views/tabs/groups/tab_group_editor_menu_controller.cc
- chrome/browser/ui/views/tabs/vertical/vertical_new_tab_button.h
- chrome/utility/importer/nss_decryptor_mac.mm

핵심: Aside 고유 세로탭 UI(NewChatTabButton/Section*/Task* 등)는 `chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc`(원본 3675행+) 안에 정의. 탭 스위처는 `aside_tab_switcher(_view).cc`, 에이전트 탭 버튼은 `tabs/aside_agent_tabs_button.cc`, 프로필 메뉴는 `profiles/aside_profile_menu_view.cc`, 미니팝업 좌표는 `frame/aside_mini_popup_coordinator.cc`, 탭 검색 버블은 `frame/aside_tab_search_bubble.cc`.

## 진행 상태 (2026-09-05, 세션 3)
| 증분 | 내용 | 상태 | 증거 |
|---|---|---|---|
| 1 | 세로탭 기본 on, 119 아이콘, 새 채팅/Tidy/Organizer/섹션 | 완료 | ui-shots/01~04 |
| 2 | 탭 검색 버블(확장 tabsearch.html), 네이티브→확장 메시지(`aside.verticalTabsTidy` onMessageExternal), `main.html#/u/<account_id>/tasks/*` 경로, 조직기 탭 목록 아래 배치 | 완료 | ui-shots/05, ui8 실행(New Chat → main.html#/u/0/tasks/new) |
| 2.5 | **보안 원격 디버깅**(45103, challenge/session, AsideSessionToken) + `Browser.ensureProfile`/`setAiTabsMetadata` | 완료(12/12 검증) | DIFFERENTIAL.md (3), test/secure-cdp-test.py |
| 3 | 에이전트 탭: AsideAgentTabsButton+버블, AiTabsCountBadgeView(그룹 헤더), "Aside is controlling the tab/Take over" 띠 | 완료 | ui-shots/06~08 |
| 4 | 탭 전환기(AsideTabSwitcherView/ItemView) | 완료 | ui-shots/09~10 |
| 5 | 북마크 섹션(`aside.vertical_tabs.bookmarks_section_*`) | 완료 | ui-shots/12~13 |
| 6 | AsideTask* 배지/점/스로버/팝오버 + 우클릭 메뉴 + 계정 등록부 감시/데몬 인증/프로필 바인딩 | 완료(팝오버는 데몬 suspended 세션이 없어 화면 미검증) | ui-shots/11, DIFFERENTIAL (4) |
| 7 | 프로필 버튼(푸터)·검색 버튼 | 완료(단일 프로필; 메뉴 패널·업데이트 배지·프로필 페이저 미구현) | ui-shots/14 |
| 8 | WebUI aside-import-data, aside-adblock, Geist 폰트 | 완료(aside-adblock은 패치 035) | ui-shots/14, 16 |

## 2026-09-05 세션 4 추가
- 미니팝업 창 실기동 확인: `asideMiniPopup.setState` → 프레임 없는 항상-위 창에 `minipopup.html` 렌더링, 확장이 `setSize`로 440×93 지정(ui-shots/25). 남은 것: 전역 단축키 트리거, 옵션 창 크기(`setOptionWindowSize`).
- 광고 차단 문법 확장(patch 036): `$popup`·`$generichide`/`$elemhide`·정규식·`$important`·`$redirect`·`$csp`·`$method` — DIFFERENTIAL (8).
- 세션 5(patch 039): 미니팝업 전역 단축키(Alt+Space)·옵션 창(window.open 가로채기, ui-shots/26), Aside 프로필 메뉴(ui-shots/27), 계정 비밀번호 게이트 팝업(ui-shots/28). 프로필 페이저는 창 구조 변경이라 미착수.
