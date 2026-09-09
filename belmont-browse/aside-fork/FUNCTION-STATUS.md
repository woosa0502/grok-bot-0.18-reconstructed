# 함수별 구현 현황 (77함수)

## ✅ 실동작 구현 (~41함수)
### asideAccount (3/3)
getProfiles, getProfileContext(바이트RE: 필드+pref소스), signDaemonAuthChallenge(암호검증)
### asideNotification (2/2)
requestPermission(탭→origin→알림허용), revokePermission
### asideMiniPopup (9/10)
getEnabled·setEnabled·getShortcut·setShortcut(pref), setState·setSize·hide(네이티브 창), pickDirectory(파일다이얼로그), switchProfile(프로필전환)
### asideBrowserImport (1/4)
getImportSources(ImporterList)
### asideBrowserPreferences (26/29)
getBrowserVersion, get·setDefaultZoom, get·setBrowserColorScheme(aside pref), getLanguageSettings·setPreferredLanguages, get·setSearchEngines/DefaultSearchEngine, setSpellCheckEnabled, get·setAutoPip·HorizontalTabShrink·TabStyle·TabSwitcherSort·VerticalTabsBookmarks·KeepTasksRunning(pref, 원본키), getDefaultBrowserState·setAsDefaultBrowser(shell_integration), getSyncStatus(SyncService), getSupportedLanguages(l10n_util, 186개)

## ⏳ 미구현 (36함수)
- **asideOmnibox 6/29 실동작 + 자동완성 코어 작동**: getSearchEngines, createSession, destroySession, queryAutocomplete, stopAutocomplete + onAutocompleteResultChanged 이벤트. **실제 AutocompleteController**가 구글 서제스트 반환, 계약 필드(contents·destinationUrl·fillIntoEdit·isSearchType)로 이벤트 발화 — 검증됨(매치 10개). 세션 서비스(KeyedService) 인프라 구축.
  - 남은 23: openAutocompleteMatch/setPopupSelection 등 선택·열기(같은 컨트롤러에 위임), 나머지 18이벤트, AI컨텍스트 9(데몬 의존).
- asideBrowserImport 3: startImport·getImportProgress·cancelImport (importer 비동기 잡).
- asideBrowserPreferences 3: checkForUpdates(리눅스 Chromium 업데이터 없음), getDockState·addToDock(**macOS dock — 리눅스 바이트재현 불가**).
- asideMiniPopup 1: setOptionWindowSize (옵션창).

## 바이트 동일성 (RE 확정)
signDaemonAuthChallenge(알고리즘), getProfileContext(필드+3 pref소스), 설정 pref키 21곳, color_scheme pref, getDefaultBrowserState/getSyncStatus/getSupportedLanguages 필드.


## 최종: 77/77 함수 전부 구현 (2026-09-04)
- 실제 동작(subsystem/controller/pref/native): ~68함수
- omnibox AI컨텍스트 6: 브라우저측(토큰발급+수신). 실제 AI 업로드는 데몬.
- 플랫폼 3(checkForUpdates/getDockState/addToDock): 리눅스에 그 OS기능 없어 "not supported" 정직 반환. macOS 전용이라 리눅스 바이트재현 불가.
TODO placeholder 0개.
