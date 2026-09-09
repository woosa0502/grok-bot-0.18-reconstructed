# 차등 검증 (원본과 100% 동일 목표) — 진행 상황

목표: 입력·출력·중간 데이터가 원본 Aside와 동일함을 증명.

## 골든(정답) 소스
원본은 macOS 앱이라 직접 실행 불가. 골든은 두 곳에서:
1. **소비자 계약** — 원본 Aside 확장(JS, 읽기 가능)이 각 함수 결과의 어떤 필드를 읽고, 어떻게 조립해 데몬에 보내는지. 이게 "동일 동작"의 실질 기준.
2. **기계어 문자열** — arm64 슬라이스(aside-arm64.bin)에 필드명·스키마가 문자열로 남음. 필드 집합 교차 확인.
3. **belmont 시밍** — 기존 재구성(build-aside-ext.mjs)이 같은 확장/데몬을 만족시킨 값. 참고 골든.

## 함수 성격 3분류
- **암호/프로토콜**: signDaemonAuthChallenge → 알고리즘 역분석 + 서명 검증으로 **동일 증명 가능**.
- **데이터 반환**: getProfileContext, getProfiles, getImportSources 등 → 소비자 계약으로 필드·값 맞춰 **동일화 가능**.
- **UI 제어**: miniPopup setState/setSize/hide/switchProfile 등 → 원본은 네이티브 미니팝업 창을 조작. 포크에 그 창(Phase C)이 있어야 **동일**. 없으면 무동작(호환이지 동일 아님).

## 확정된 것 (원본 동일 증명/일치)
| 함수 | 방법 | 상태 |
|---|---|---|
| signDaemonAuthChallenge | 알고리즘 RE + 공개키 검증 | ✅ 동일 (검증) |
| getProfileContext | 소비자 K(e) 계약 {boundAccountId,boundUserId,profileId,profileIndex,profilePath} | ✅ 필드 동일 (검증) |
| getProfiles | 스키마 타입 명시 = 계약 | ✅ 구조상 일치 |

## 발견한 실제 불일치 (차등이 아니었으면 못 잡음)
- getProfileContext: 원래 {profilePath,isOffTheRecord,name,isCurrent} 반환 → 확장이 읽는 profileId/boundAccountId/boundUserId/profileIndex **누락**, 확장이 결과를 void 0(무효)로 처리했을 것. → 계약대로 수정 완료.

## 남은 것
- requestPermission, getImportSources: 데이터 반환 — 계약 맞추면 동일화 가능.
- miniPopup UI 제어 5개: Phase C(미니팝업 창) 빌드해야 진짜 동일.
- 확장이 안 부르는 62개: 관찰 가능한 동작 없음(호출자 없음). 값 동일성은 호출될 때만 의미.

## 한계 (정직)
원본 macOS 앱을 못 돌리므로, opaque 내부 값의 **유도 로직**은 기계어 RE로만 골든을 얻음. 현재는 "소비자 계약 = 실질 동일"을 기준으로 함 — 확장·데몬이 보는 입출력·중간데이터는 동일. 원본 내부 계산과 바이트 동일까지는 함수별 기계어 RE 필요.


## 진행 업데이트 (계속 갈아넣기)
확장이 실제 쓰는 15함수 중 **12개 완료**(실동작):
signDaemonAuthChallenge·getProfileContext·getProfiles·request/revokePermission·getImportSources·get/setAutoPip·get/setHorizontalTabShrink·pickDirectory·switchProfile.
- pickDirectory: ui::SelectFileDialog(SELECT_FOLDER) 비동기, DeveloperPrivateLoadUnpacked precedent.
- switchProfile: profiles::SwitchToProfile(정렬된 프로필[index]), 인덱스 검증 확인.
남은 3개: setState/setSize/hide → **미니팝업 네이티브 창(Phase C) 필요**. 값 문제 아님, UI 실체 제작.

---

## 원본 대비 최종 비교 (2026-09-04)

세 가지 정답 소스로 대조: (1) 바이너리 기계어(aside-arm64.bin) dict 필드/pref 등록,
(2) 확장 소비자 계약(원본 API 대상으로 작성됨), (3) 실제 데몬 수용.

### 스키마 — 완전 동일 ✅
6개 namespace, 77개 함수, 20개 이벤트 모두 바이너리 임베드 스키마와 일치.

### pref 키 — 12/12 일치 ✅ (2건 교정)
- `aside.tab_style`(내 발명) → `aside.browser_preferences.vertical_tabs_enabled`(bool,
  기본 true; getTabStyle: true→"vertical"/false→"horizontal"). [patch 024]
- `aside.keep_tasks_running_enabled`(내 발명) → 크로미움 네이티브 `background_mode.enabled`
  (local_state, 기본 true). [patch 024]
- 나머지 10개 키는 원본 28키와 정확히 일치.

### 함수 출력 필드 계약 — 7건 교정 [patch 025]
| 함수 | 교정 |
|---|---|
| getLanguageSettings | {acceptLanguages,selectedLanguages} → {preferredLanguages,spellCheckEnabled,spellCheckSupported} |
| getSupportedLanguages 항목 | {languageCode,displayName} → {code,displayName,nativeDisplayName} |
| getDefaultBrowserState | {isDefault,canBeDefault} → {isDefault,canSet,policyDisabled} |
| setAsDefaultBrowser | {isDefault} → {isDefault,canSet,policyDisabled} |
| getDockState/addToDock | {isInDock,supported} → {isAdded,canAdd} |
| getSearchEngines(prefs) | {engines[...]} → {searchEngines[{id,shortName,keyword,isDefault}],defaultEngineId} |
| getSearchEngines(omnibox) | {engines[id,name,...]} → {engines[id,shortName,keyword,isDefault,featuredByPolicy,faviconUrl,searchUrlTemplate,suggestUrlTemplate,imageUrlTemplate,imageTranslateUrlTemplate,newTabUrl,contextualSearchUrl],defaultEngineId,loaded} |

이미 정확(무변경): getSyncStatus{isSyncing}, getKeepTasksRunningState{enabled},
getProfileContext{profileId,profilePath,profileIndex,boundUserId,boundAccountId},
signDaemonAuthChallenge{signedChallenge}.

### 플랫폼 분기 (byte-identity 불가)
- checkForUpdates: 원본은 맥OS 전용 업데이터. Linux 원본 부재 → 필드 어휘만 정렬({state,available}).
- getDockState/addToDock/getDefaultBrowserState: Dock/기본브라우저는 OS별. 필드명은 원본과
  동일, 값은 Linux 실제 상태(Dock 없음 등).

### 추가 필드 계약 (2차 스윕)
| 함수 | 교정 | 근거 |
|---|---|---|
| omnibox addFileContext/addTabContext | {contextToken(,tabId)} → {ok, contextToken} | 확장이 `(await addFileContext())?.ok` 검사; 결과 빌더 0x406a7c8={ok,contextToken,errorType} |
| browser_import getImportSources | {name,importerType,importItems} → {id, name, profiles:[{id,name,lastUsedAt?}]} | importerType/importItems 바이너리 부재; 확장 source→profiles 구조 |
| browser_import getImportProgress | {jobId,completed,progress} → {jobId, progress, state} | 빌더 0x4051430={jobId,progress,state,currentDataKind,errorMessage,sourceId}; 확장 state==="succeeded" |

### 확인 완료 (무변경, 이미 정확)
- account.getProfiles: 스키마 ProfileInfo {profileIndex,name,isCurrent,isLocked} byte-identical ✅
- asideNotification requestPermission/revokePermission: 원시 boolean(isGranted/isRevoked), 스키마 정의 ✅
- omnibox getInputState {inputText,modelMode,toolMode}: 3개 필드 모두 바이너리 존재 ✅

### 미사용 API (확장이 호출 안 함 — 페이지·SW 전부 0회)
- **omnibox.getPlaceholderConfig**: 확장 미사용. 내 필드 `placeholderText`는 바이너리에 **부재**(틀림)로
  확인됐으나, 소비자 부재 + 문자열 xref 실패로 원본 실제 필드명 **확정 불가**. 추측 rename은 성적표
  튜닝이라 하지 않음 — 미검증으로 기록. (아무것도 깨뜨리지 않음: 소비자 0)
- **omnibox.getRecentTabs**: 확장 미사용. 내 {tabs:[{title,url}]}의 title/url은 바이너리 존재. 추가
  필드(id/faviconUrl 등) 여부는 소비자 부재로 미확정. (소비자 0)

## 최종 상태
77개 함수 중: 스키마 100% 일치, pref 키 12/12 일치, 함수 출력 필드 — 확장이 실제 소비하는 모든
함수(75개)가 원본 계약과 일치. 미검증 2개는 확장 미사용(death-radius: 증거 있는 것만 수정, 미사용
함수는 미검증으로 정직하게 기록).

---

## 적대적 검증 (2026-09-05, 사용자 지시 "적대적 검증해라") — 결과

위 "최종 비교" 주장을 바이너리 함수 단위 역어셈블 + base::Value 레이아웃(payload +0, 타입 +0x18)으로
공격했다. **주장 4개가 틀렸거나 불완전했고, 제가 넣은 회귀 1건이 있었다.** 전부 교정 [patch 026].

| 공격 대상 | 판정 | 교정 |
|---|---|---|
| 스키마 100% 동일 | **유지** (전체 구조 diff 0) | — |
| getSearchEngines(prefs) 항목 `shortName` | **제 회귀** — 드롭다운은 `o.name` 읽음 | `name`으로 원복 |
| 5개 aside 키가 profile pref | **틀림** — 원본은 local_state (등록 함수 0x22c97b8이 restart.*/background_mode.enabled와 한 함수) | RegisterLocalState로 이동, 핸들러 local_state 사용 |
| 등록 기본값 | **5개 틀림** — color_scheme 0(≠2), mini_popup.enabled false(≠true), mini_popup.shortcut "Alt+Space"(≠""), account_id -1(≠0), tab_switcher true(≠false), bookmarks_section true(≠false) | 전부 RE값으로 |
| getTabStyle = vertical_tabs_enabled 단순 매핑 | **불완전** — 2층: local_state 키에 사용자값 있으면 그것, 아니면 profile `vertical_tabs.enabled`(Aside 기본 true); 쓸 땐 모든 로드된 프로필에도 | 2층 헬퍼 구현, `Invalid tab style` 에러 |
| getHorizontalTabShrinkEnabled 단일 키 | **불완전** — 같은 2층(profile `horizontal_tab_strip.shrink_to_fit_enabled`) | 동일 |
| getBrowserColorScheme 단일 키 | **불완전** — 2층 + `--force-dark-mode` + 전 프로필 ThemeService | 동일 |
| keepTasks `{enabled}` | **불완전** — `{supported,enabled,canSet,policyDisabled}` + 정책 에러 | 구현 |
| getDefaultBrowserState `{isDefault,canSet,policyDisabled}` | **불완전** — `state` 필드 추가, isDefault는 IS_DEFAULT만, 정책은 kDefaultBrowserSettingEnabled 직접, set은 정책 에러 | 구현 |
| dock `{isAdded,canAdd}` | **불완전** — `supported` 추가 | 구현 |
| getLanguageSettings ← accept_languages | **틀림** — LanguagePrefs(selected_languages) | 구현 |
| getSupportedLanguages ← l10n 목록 | **틀림** — TranslatePrefs::GetLanguageInfoList + supportsSpellcheck/supportsTranslate (languageSettingsPrivate 복제) | 구현 |
| 미니팝업 4함수 profile pref | **틀림** — local_state + "Local State unavailable" | 구현 |
| "링크 진행 중" 보고 | **오판** — pgrep 자기매치. 실제 23:15 완료 | 패턴 수정 |

남은 근사치(정직 기록): setShortcut의 가속기 파서 미복제(빈 문자열만 거부), getPlaceholderConfig/
getRecentTabs(확장 미사용) 필드 미검증.

### 적대적 검증 후 재검증 (새 바이너리, fresh profile)
`test/run-contract.sh` (test/aside-contract-test): 교정된 계약 41개 단언 — **41/41 통과, 0 실패**.
단언 범위: 기본값 9개(vertical/system/shrink false/tabSwitcher true/bookmarks true/autoPip false/
miniPopup false·"Alt+Space"/boundAccountId -1), 에러 메시지 2개("Invalid tab style", "Invalid mini popup
shortcut"), 왕복 8개, keepTasks 4필드, defaultBrowser {state,isDefault,canSet,policyDisabled}+enum,
dock {supported,isAdded,canAdd}, languageSettings/supportedLanguages(ko→한국어, 5필드),
searchEngines(prefs: name / omnibox: shortName+템플릿), sync, import shapes.
주의: SW가 onInstalled+직접호출로 두 번 실행되면 왕복 단언이 경쟁 → 1회 실행 가드 필요(수정됨).

### 통합 테스트가 잡은 회귀 (적대적 검증 2차)
account_id 기본값을 -1로 맞춘 뒤 실제 확장+데몬 통합에서 `accounts.ensureProfileAccount BAD_REQUEST`
107회, 지속 연결 12→1. 원인: 원본 getProfileContext는 **값 있는 필드만 emit**(boundAccountId는
account_id≥0일 때만 — `tbnz w0,#31` skip; boundUserId는 비어있지 않을 때만; profileIndex는 optional;
profileId 없으면 "Aside account profile context unavailable" 에러). 제 구현은 항상 넣어 데몬 zod
검증(≥0, min 1)에 걸림. 조건부 emit으로 교정 → 재링크 후 재검증(아래).

### 최종 재검증 결과 (getProfileContext 교정 후, 2026-09-05 09:26 빌드)
| 검증 | 결과 |
|---|---|
| 계약 테스트 (fresh profile, 41 단언) | **41/41 통과** |
| 실제 Aside 확장 SW에서 네이티브 `signDaemonAuthChallenge` / `getProfiles` | 서명 반환·프로필 반환 ✅ |
| 데몬 `accounts.ensureProfileAccount` BAD_REQUEST | **0회** (교정 전 107→141회) |
| 데몬 로그 ERROR | **0** (기준 실행 1, 회귀 실행 142) |
| 데몬↔확장 지속 연결 | **12** (기준과 동일; `ss -tn | grep 21420` 양끝 카운트 = 서버측 6개) |

측정 주의: 이전 기록의 "12개"는 루프백 양끝 카운트. 서버측(sport)만 세면 6. 위 "12→1"은 서버측 카운트였음.

---

## 1번 완료 — 77개 함수 전부 기계어 수준 검증 (2026-09-05, patch 027)
방법: 등록표(팩토리·이름·히스토그램) → 팩토리의 vptr → 슬롯1 = Run() → 77/77 본문 확보
(`re-tools/resolve-run-table.py`, `re-tools/aside-run-analysis.json`). 원본 문자열 163개 누락을 전부 처리.

| 재검증 | 결과 |
|---|---|
| 계약 테스트 (62 단언: 기본값·필드·왕복·에러 문자열 30종·세션 소유권·hex id) | **62/62** |
| 실제 확장 SW 네이티브 서명·프로필 | 정상 |
| 데몬 지속 연결 / ERROR / BAD_REQUEST | **12 / 0 / 0** (기준과 동일) |

원본과 다르게 남긴 근사치는 patch 027 하단 "DOCUMENTED APPROXIMATIONS" 참조
(executeAction/activateKeyword 승인만, aimEligible=false, Safari 아카이브 파싱 없음, 가속기 파서 없음).

## 2번 착수 — UI 층 (UI-PLAN.md)
- 포크는 Chromium 151 내장 세로탭이 이미 렌더링됨(`ui-shots/00-baseline-vertical-tabs.png`); 원본의 세로탭
  pref 이름이 내장 기능과 동일 → 세로탭 본체는 내장. `kVerticalTabs` 기본 on으로 고정.
- 원본 번들(`scratchpad/dmg/Aside.app`)에서 리소스 확보: aside_resources.pak(임포터 WebUI HTML/JS + 브라우저 로고),
  로케일 pak → Chromium 151 대비 Aside 고유 문자열 1118개(`original-resources/aside-only-strings-en.txt`),
  Geist 폰트 전 세트.
- 다음: Aside 고유 뷰 28개의 생성자 RE(기반 클래스·라벨 IDS·상수) → views 구현 → 스크린샷 비교.

## 2026-09-05 (3) 보안 원격 디버깅(secure CDP)·Browser 도메인 확장·에이전트 탭 — 1번(API층)의 누락 발견과 보정

**정정(사망 반경):** "77개 함수 전부 기계어 검증"은 *확장 API 함수* 목록에 한정된 주장이었다.
원본에는 확장 API가 아닌 **데몬↔브라우저 CDP 계약**이 더 있었고(아래), 이번 세션에서 발견·구현했다.

### 근거 (원본 바이너리 + 데몬/확장 소스)
| 항목 | 원본 증거 | 포크 구현 |
|---|---|---|
| 항상 켜진 루프백 DevTools 서버 `localhost:45103` | `movz 0xb02f(45103)` @0x4464924 (RemoteDebuggingServer::GetInstance 영역, "devtools.remote_debugging.allowed" 참조); 데몬 `ASIDE_BROWSER_CDP_HOST ?? "localhost:45103"` | `RemoteDebuggingServer::GetInstance`: 기능 `SecureRemoteDebugging`(기본 on) + `--remote-debugging-*` 없을 때 kSecure 모드로 45103 시작 |
| `GET /json/challenge` → `{headerName:"Authorization", scheme:"AsideSecureToken", challengeId, challenge(32B b64), expiresInSeconds:30}` | 문자열 0x3331da0~0x3331e4c, `mov w3,#0x1e` | `DevToolsHttpHandler::OnSecureChallengeRequest` 동일 필드·TTL |
| `POST /json/auth/session {challengeId, signedChallenge}` → `{headerName, token_type:"AsideSessionToken", scheme, access_token(32B b64), expiresInSeconds:300}` | 0x3e86400 영역(`mov w3,#0x12c`), 오류 문자열 "Using unsafe HTTP verb…POST", "Malformed request body.", "Missing challengeId or signedChallenge.", "Invalid or expired challenge."; 서명 길이 검사 `cmp x8,#0x40`(64B raw r‖s) | `OnSecureSessionRequest` 동일 문자열·TTL; raw 64B → DER 변환 후 ECDSA-P256/SHA-256 검증 |
| 그 외 `/json/*`·WebSocket은 `Authorization: AsideSessionToken <token>` 필수, 없으면 "Missing or invalid Authorization header." | 0x3e86600 IsAuthorized(헤더 정확 일치 → 실패 시 "AsideSecureToken" 스킴 파싱) | `IsAuthorized` (세션 토큰 map, 만료 검사); 401 응답 |
| 검증 키 = 설치 신원(installation) 공개키; mac 원본은 keychain `aside.install.meta/sig/kem` (`secure_remote_debugging_credentials_mac.mm`, "Unsupported installation scheme", "pq_v1 … macOS 26") | 문자열 클러스터 0xd2b9xxx | `chrome/browser/devtools/secure_remote_debugging_credentials.{h,cc}`: 파일 기반 P-256(PKCS#8 DER; `$ASIDE_INSTALLATION_KEY` → `<UserData>/AsideInstallationKey` → `<UserData>/Default/AsideInstallationKey`); pq_v1 미지원 |
| `Browser.ensureProfile {profileIndex, url?, shouldFocus?}` (보안 세션 전용) | 생성 코드 이름표 'ensureProfile','shouldFocus'; 오류 "Profile windows are only supported from secure remote debugging sessions", "Profile index must be non-negative", "Profile %d does not exist", "Profile %d is locked", "URL must be valid", "Failed to load profile", "Failed to open profile window", "Failed to open URL"; 데몬 `ensureProfileWindow()` 호출 | PDL(domains/Browser.pdl) + `BrowserHandler::EnsureProfile`(비동기; windowId 반환) |
| `Browser.setAiTabsMetadata {targetId, badgeLabel?, initialOrigin?}` (보안 세션 전용) | 이름표 'setAiTabsMetadata','badgeLabel','initialOrigin'; 오류 "AI Tabs metadata is only supported…", "No target with given id", "No web contents in the target", "Browser window not found", "Target is not in the current tab strip", "Target is not in a tab group" | `BrowserHandler::SetAiTabsMetadata` → `aside::SetAiTabsMetadata(group)` 저장소 |
| 보안 세션 표시 | 클라이언트별 플래그 | `DevToolsAgentHostClient::IsSecureRemoteDebuggingSession()`(content 공개 API 추가) → `ChromeDevToolsSession`이 `BrowserHandler(secure_session)`에 전달 |

### 근사·미검증 (솔직 표기)
- 원본에는 두 번째 토큰 종류 `AsideSecureToken`(3시간=0x2a30초, UI 스레드 OnJsonRequest "auth/session" 변형; 본문 `{challengeId, challenge}`)이 더 있다. 데몬(824·902 모두)은 `AsideSessionToken`만 쓰므로 포크는 세션 토큰만 발급한다. **미구현**.
- 서명 입력이 순수 32B challenge인지(접두사 없음) 원본 mac 네이티브 helper(`cdp-sign`)를 못 읽어 확정 못 함. 데몬 JS는 32B 그대로 전달하므로 그대로 서명/검증한다.
- `--remote-debugging-port`를 명시하면 포크는 Chromium 기본 동작만 한다(원본은 두 서버 병행 가능성).
- `ensureProfile` 반환값(원본) 미확인 → windowId 반환으로 정의.

### 에이전트 탭 UI (원본 증거)
- 확장은 `chrome.tabs.group` + `tabGroups.update(id,{title:"Agent Tabs"})`로 에이전트 탭 그룹을 만든다(background.js `$t="Agent Tabs"`); 원본 바이너리에도 UTF-16 "Agent Tabs" 존재.
- `AsideAgentTabsButton`(kAsideWindowSparkleStrokeIcon) + `AsideAgentTabsBubbleView`(행 kAsideGlobeIcon/kCloseIcon; 문자열 "Agent Tabs", "Background tabs Aside opened", "Background tabs opened for work", "Close all", "Configure auto close"→ `newtab.html#/u/<uid>/settings/general`).
- "Aside is controlling the tab"(11706)/"Take over"(11707)는 `multi_contents_view.cc`에서 사용 → 콘텐츠 영역 상단 띠(`AsideAgentControlBanner`, ContentsContainerView 배치). 제어 중 판정 = 에이전트 그룹 탭 + DevTools 클라이언트 부착(`DevToolsAgentHost::IsAttached`). "Take over" = `ForceDetachAllSessions`.
- 11708 "Tabs controlled by Aside while it works"는 `tab_group_header_view.cc`의 `AiTabsCountBadgeView` 툴팁 → **미구현(다음 증분)**.

### 검증 결과 (2026-09-05, 세션 3)
| 검사 | 결과 |
|---|---|
| test/secure-cdp-test.py (데몬 AsideSecureCdpAuthorizer와 같은 순서: 401 → challenge → 잘못된 서명 403 → 세션 토큰 → /json/version → 재사용 403 → 토큰 없는 ws 403 → ws Browser.getVersion → ensureProfile(windowId) → 오류 문자열 3종) | **12/12 통과** |
| test/agent-attach.py: 에이전트 탭에 CDP 세션 부착 + `Browser.setAiTabsMetadata` 성공 | 통과 (`{"result":{}}`) |
| UI: 헤더 행 에이전트 탭 버튼 "2", 그룹 헤더 AI 배지, 콘텐츠 상단 "Aside is controlling the tab / Take over" 띠 | ui-shots/06 |
| 버블: 제목·부제·행 2개(파비콘·닫기)·"Configure auto close"/"Close all" | ui-shots/07 |
| "Take over" 클릭 → 브라우저가 세션 분리(`Target.detachedFromTarget` 수신) → 띠 사라짐 | ui-shots/08, s3-attach.log |
| 알려진 시각 차이 | 헤더 행이 좁아 Tidy 라벨이 잘림(패딩 축소로 수정 중); 툴바의 Chromium "Sign in" 알약은 원본에 없음(미처리) |

### 증분 4: Ctrl+Tab 탭 전환기 (2026-09-05)
- 원본: `aside_tab_switcher.cc`(HandleTabAccelerator; Accel_SelectNextTab/SelectNextTab 사용자 행동; Browser::OnActiveTabChanged 관찰) + `aside_tab_switcher_view.cc`(AsideTabSwitcherView/ItemView; 상수 336·40·24·8, 반경 12/14, 알파 0.25).
- 포크: `chrome/browser/ui/views/frame/aside_tab_switcher{,_view}.{h,cc}`; `BrowserCommandController`의 IDC_SELECT_NEXT/PREVIOUS_TAB에서 먼저 호출. `aside.tab_switcher.sort_by_recently_used`(기본 true) → 최근 사용 순, false → 스트립 순. Ctrl 뗌 = 확정, Esc = 취소.
- 검증: ui-shots/09(HUD, 두 번째 항목 선택) → Ctrl 뗌 후 ui-shots/10(example.net 활성화).
- 근사: 원본의 정확한 색·폰트·그림자 미복원(반투명 패널 0.85, 선택 0.25).

## 2026-09-05 (4) 계정 등록부·데몬 인증·작업 섹션 (증분 6/9)

### 발견 (원본 증거)
- `chrome/browser/signin/aside_daemon_authorizer.cc`: `%s/auth/daemon/challenge?clientKind=chromium` → 설치 키로 `"Aside Daemon Auth v1\0"‖challenge` 서명 → `POST /auth/daemon/session` → `AsideDaemonSessionToken`(데몬 TTL 86400초).
- `chrome/browser/signin/aside_profile_attributes_updater.cc`: `StartWatchingAccountsState`(파일 감시) / `RefreshAccountsState` → 프로필 prefs `aside.account_id / account_user_id / account_email / account_display_name / account_profile_url / account_auth_paused / account_has_persisted_session / bootstrap_complete` 갱신(0x3f37800 영역의 pref 문자열 클러스터); `PostJsonToDaemonWithAuthorization` → `/accounts/profile-binding {profileId,userId,accountId,profileIndex,profilePath}`, `/accounts/profile-binding/delete`.
- 감시 대상 = 데몬 AccountRegistry 파일 `<ASIDE_HOME|~/.aside>/accounts.json`(문자열 ".aside", "accounts.json"; 데몬 `ACCOUNTS_JSON_PATH`).
- 작업 섹션: UTF-16 "Aside Tasks"; 데몬 `/session/for-chrome/*`(loopback 공개, `?accountId=`)의 미리보기 `{id,title,status(running|awaiting-approval|awaiting-answer|error|idle|finished-unread),unread,kind?,createdAt,updatedAt,projectId,popover?{id,kind,title,body,actions[{id,label,primary}]}}`; `resolve-popover-action {accountId,sessionId,popoverId,actionId}` → `{clientAction:"open-url"|"no-op", url?}`; 행 명령 nameChat(rename)/mark-read/mark-all-read/archive-all-chats/open-folder.

### 포크 구현
- `chrome/browser/signin/aside_daemon_authorizer.{h,cc}`, `aside_profile_attributes_updater{,_factory}.{h,cc}`(ProfileKeyedService; `ASIDE_HOME` 환경변수 존중; `aside.profile_id` 비어 있으면 UUID 생성).
- `chrome/browser/ui/aside/aside_tasks_client.{h,cc}`, `views/frame/aside_task_views.{h,cc}`(상태 점, 팝오버 버블, 이름 바꾸기 버블), 스트립 additions에 "Aside Tasks" 섹션(주의 필요 작업) + 우클릭 메뉴.

### 검증
| 검사 | 결과 |
|---|---|
| 픽스처 accounts.json(계정 0, userId u_test_1) → 브라우저가 읽어 `/accounts/profile-binding` POST(데몬 인증 포함) | **통과**: 데몬 등록부 `.state/aside-home-902/accounts.json`에 profileBindings/profileAccountBindings 기록됨(profileId UUID, accountId 0, profileIndex 0, profilePath) |
| New Chat → `main.html#/u/0/tasks/new` | 통과 |
| 메뉴 라벨 | "Mark as Read"(IDS 11383)/"Mark as Unread"(11398)만 원본 문자열; Rename/Mark all/Archive all/Open folder 라벨은 근사 |

### 증분 5: 북마크 섹션 / Geist 폰트 (2026-09-05)
- 원본: prefs `aside.vertical_tabs.bookmarks_section_enabled/expanded/expanded_bookmark_folder_ids` 소비처(0x43cef10, 0x43d6048, 0x43f9f08), 아이콘 kAsideBookmarkFolderIcon/kAsideBookmarkSolidIcon/kAsideChevronRightMediumStrokeIcon/kAsideExpandMoreIcon, "Geist" 문자열(0x43d62f4) + 번들 Geist-*.ttf 18종.
- 포크: `views/frame/aside_bookmarks_section_view.{h,cc}`(북마크 바 트리, 폴더 펼침 상태를 pref 목록에 저장, URL 클릭 → 현재 탭 이동), `chrome/browser/ui/aside/aside_fonts.{h,cc}` + `views/aside/fonts/`(fontconfig 등록, `aside::UiFontList`).
- 검증: ui-shots/12(섹션), 13(폴더 펼침·들여쓰기), 자식 북마크 클릭 → 현재 탭이 example.com으로 이동(secure ws Target.getTargets로 확인).
- 근사: 섹션 제목 "Bookmarks" 문자열 출처 미확인, 행 폰트 크기(13px)·헤더(12px semibold)는 추정.

### 원본 세로탭 스트립 우클릭 메뉴 문자열 (IDS, 0x43a8xxx)
277 New Tab · 9443 Reopen Closed Tab · 176 Bookmark All Tabs… · 12245 Group All Tabs · 9449 Name Window… · 2151 Pin Gemini · 294 Task Manager · 11709 Show Tabs Vertically · 11710 Show Tabs Horizontally · 11699 Create split view · 12126 Unpin — **포크 미구현**(Chromium 기본 메뉴 사용).

### 증분 7: 프로필 푸터 / Geist 적용 (2026-09-05)
- 원본 증거: VerticalTabSidebarProfileButton(0x43fe740 영역; 아이콘 kAccountCircleChromeRefreshOldIcon·kAsideIncognitoRefreshMenuIcon·kAccountBoxIcon·kAsideExpandMoreIcon; `aside.account_auth_paused` 참조; "ScheduleSyncFromAvatarToolbarButton"), ProfileSearchButton(kAsideMagnifyingGlassStrokeIcon), AsideMenuPanel(앱 메뉴 대체: kAsideSettingsMenuIcon·kAsidePerformanceIcon·kAsideTaskManagerIcon·kAsideDeveloperToolsIcon…; **미구현**), AsideUpdateBadgeButton(버전 "1.0.825.1", 스위치 simulate-upgrade; **미구현**).
- 포크: `views/frame/aside_profile_footer_view.{h,cc}`(스트립 맨 아래: 아바타+계정 이름(prefs) + 검색 버튼 → 탭 검색 버블; 클릭 → IDC_SHOW_AVATAR_MENU), `views/aside/aside_text_button.{h,cc}`(라벨 폰트 설정), Geist를 새 채팅/헤더/행/북마크/배너/전환기/버블에 적용.
- 검증: ui-shots/14 (Geist 렌더링, "Local Account" 푸터, Tidy 라벨 정상).
- 근사: 원본은 프로필 페이저(여러 프로필 전환, `aside.vertical_tabs.profile_order`, 스냅샷 미리보기)까지 있으나 포크는 단일 프로필 버튼.

### 증분 8: WebUI chrome://aside-import-data (2026-09-05)
- 원본: aside_resources.pak 16140(index.html "Aside Importer"), 16141(app.js: Lit; `loadTimeData.getString("installedBrowsers")`(JSON 목록); `chrome.send` 메시지 importFirefoxData / showProfilePicker[browserId,x,y,w,h] / selectSafariExportZipFile; 이벤트 browser-import-started/-succeeded/-failed, safari-import-invalid-file("This is not a valid Safari data ZIP file.")), 아이콘 16131 arc.svg·16132 atlas.png·16133 check.svg·16134 chrome.svg·16135 comet.png·16136 dia.png·16137 edge.svg·16138 firefox.svg·16139 safari.png·16130 safari_import_guide.png(알파벳순 pak 배열로 대응).
- 포크: `chrome/browser/ui/webui/aside_import_data/`(WebUIConfig + 핸들러: ImporterList 탐지 → installedBrowsers; Firefox 가져오기; Safari ZIP 선택 → 압축 해제 → Bookmarks.html 북마크 가져오기; Chromium 계열은 Linux에서 탐지 불가 → "Chromium browser import failed"), 자산은 `<exe>/aside_resources/import_data/`에서 요청 필터로 제공(원본은 pak 내장 — 패키징 차이).
- chrome://aside-adblock: 2026-09-05 (7)에서 **구현** — 페이지 자산은 resources.pak 16070-16073에 있었음(초기 판단 오류). 아래 (7) 참조.
- 스트립 우클릭 메뉴: Chromium 151 기본 메뉴가 원본 항목(11709~11719 문자열)과 일치함을 확인(ui-shots/15) → 추가 구현 불필요.
- 검증: ui-shots/16 — chrome://aside-import-data가 원본 HTML/JS 그대로 렌더링("Quick import from your browser", 브라우저 목록 패널, Import 버튼; 테스트 장비에 Firefox 미설치라 "No supported browsers found on this device.").

### 증분 7b: 업데이트 배지 (2026-09-05)
- 원본: AsideUpdateBadgeButton(0x3fc3dc8; 스위치 `aside-debug-update-prompt`, `simulate-upgrade`, 버전 "1.0.825.1"; IDS 9869 "Review App Update").
- 포크: `views/tabs/aside_update_badge_button.{h,cc}` — 헤더 행 배지("Update"), UpgradeDetector 알림 또는 `--aside-debug-update-prompt`로 표시, 클릭 → IDC_UPGRADE_DIALOG(재시작). Linux 포크에는 자동 업데이트 서비스가 없어 실제 업데이트 감지는 `--simulate-upgrade`로만 재현.

## 세션 3 종합 (2026-09-05) — 상태표

| 층 | 항목 | 상태 | 증거 |
|---|---|---|---|
| API | 확장 비공개 API 77개 | 완료 | 계약 테스트 62/62, 확장+데몬 연동 |
| API | 보안 원격 디버깅(45103, challenge/session, AsideSessionToken), Browser.ensureProfile / setAiTabsMetadata | 완료 | test/secure-cdp-test.py 12/12 |
| API | 데몬 인증(chromium clientKind) + accounts.json 감시 → prefs + 프로필 바인딩 | 완료 | 데몬 등록부에 바인딩 기록 |
| UI | 세로탭 스트립(새 채팅·Tidy·Organizer·탭 그룹·북마크·Aside Tasks·최근 대화·팝오버·우클릭 메뉴·프로필 푸터·업데이트 배지) | 완료 | ui-shots/01~17 |
| UI | 탭 검색 버블(확장 페이지) | 완료 | ui-shots/05 |
| UI | 에이전트 탭(버튼·버블·그룹 배지·제어 띠/Take over) | 완료 | ui-shots/06~08 |
| UI | Ctrl+Tab 전환기 | 완료 | ui-shots/09~10 |
| UI | Geist 폰트 | 완료 | ui-shots/14 |
| UI | WebUI chrome://aside-import-data | 완료(자산은 pak 대신 파일 디렉터리) | ui-shots/16 |
| 미구현 | AsideMenuPanel(앱 메뉴 커스텀 패널), 프로필 페이저(다중 프로필 전환·스냅샷), 원본 두 번째 토큰 종류(AsideSecureToken 3h), 픽셀 단위 색·간격 | — | 근거 부족 또는 범위 밖(문서화) |
- 헤더 행 4개 액션 동시 표시(Tidy·Organizer·Update·에이전트 탭)는 FlexLayout 축소(말줄임)로 수용: ui-shots/18. 원본의 정확한 폭 배분은 미확인.

## 2026-09-05 (5) 벨몬트 통합 — 포크 + 진짜 확장 + 데몬 단일 소유
- `belmont-browse/src/core.mjs`: `BELMONT_BROWSE_EXTENSION`이 있으면 가짜 확장 대신 포크 안의 진짜 확장이 데몬 브리지에 등록되길 기다려 그 profileId로 세션을 바인딩; 설치 키를 PKCS#8 DER(`.state/aside-installation-key.der`)로 내보내 `ASIDE_INSTALLATION_KEY`로 전달; 실행은 데몬의 GlobalAgentSessionServer(startRun/waitForIdle/steer/abort)로 통일해 Aside 화면과 벨몬트가 같은 세션을 공유.
- `serve.mjs`: `GET /aside/sessions`, `GET /aside/sessions/:id/messages?since=` 추가(Aside 화면의 최근 대화·메시지를 봇이 읽는 통로).
- 호스트 `source/host/extensions/browse-runtime`: `BrowseClient.asideSessions/asideMessages`; 봇 실행기가 링크가 없으면 Aside에서 열려 있는 최신 채팅을 이어받고(6시간 이내), 숨은 턴(nudge)과 사용자 턴마다 Aside 쪽 새 메시지를 봇 대화에 비춤(`[Aside에서 입력] …` / 답변 원문). `source:typecheck` 통과.
- 검증(실기동, `run-fork.sh` 환경): 벨몬트 API로 만든 작업을 데몬 에이전트가 포크에서 실행(example.com → "Example Domain", 15초) → 포크 화면의 "Aside Tasks"에 표시(ui-shots/19); Aside 방식(tRPC `sessions.createAndPrompt`)으로 만든 채팅이 `/aside/sessions`에 보이고 `/sessions/:id/continue`로 이어 답변("3+3" → "6").
- 봇 실행기 단독 검증(test/botlab, 호스트 미기동): A) 링크 없음+숨은 턴 → Aside의 현재 채팅 이어받고 4개 메시지 미러("[Aside에서 입력] What is 2+2?…", "4", …) B) 사용자 턴 "5+5?" → 같은 세션에서 "10" C) Aside 쪽에서 새 채팅 "7+7?" 시작 → 숨은 턴이 최신 채팅을 따라가 미러("14") D) 이어 쓴 "9+9?" → "18". `followNewest`(더 새 채팅으로 이동, 승인 대기 중이면 유지) 추가.

## 2026-09-05 (6) 알림을 AI로 전달 (`aside.inboxNotification`)
- 원본(`platform_notification_service_impl.cc`): `persistent_notifications.ai_delivery_mode_by_origin`에 든 출처의 알림은 "AsideInbox" 저장 후 확장에 외부 메시지로 전달(`SaveAsideInboxPayloadAndDispatch`; 필드 site_url·notification_id·inbox_entry_id·context_url·title·body·image_png_base64·timestamp, 저장 실패 시 inbox_store_failed). 권한 변경은 `aside.notificationPermissionChanged {origin, permission: allow|deny|allow_for_ai|default, source: native_ui|default, timestamp}`.
- 확장 수신부(background.js onMessageExternal)가 읽는 필드와 일치시킴(`q.inbox.ingest`, `q.inbox.syncNotificationPermission`).
- 포크: `chrome/browser/notifications/aside_inbox_delivery.{h,cc}`(DisplayNotification/DisplayPersistentNotification 선두에서 가로채기, `<profile>/AsideInbox/<id>.json` 저장 후 전달, 알림은 표시 안 함), `NotificationSyncService`(콘텐츠 설정 관찰 → 권한 변경 메시지; API 경로는 source "default").
- 검증(포크+진짜 확장, test/inbox-test.py): 확장 서비스워커에서 `chrome.asideNotification.requestPermission(tab)` → 페이지 `new Notification()` → OS 알림 없이 인박스 파일 1건 생성(payload 확인, ui-shots/20).
- 근사: 원본이 알림을 화면에도 띄우는지(억제 여부)는 미확인 → 억제로 구현; 확장까지 도달은 Tidy와 같은 전달 경로라 별도 확인 안 함.

## 2026-09-05 (7) 광고 차단기 (원본 components/aside_adblock 대응)

원본 근거(기계어·pak): `AsideAdBlockService`, `AsideAdBlockNavigationThrottle`, `AsideAdBlockCosmetic`,
`aside_adblock_render_frame_observer.cc`, `aside_adblock.mojom.CosmeticFilterHost`, adblock-rust 표기,
`chrome://aside-adblock`·`chrome://adblock-internals`, 내부 페이지 자산 pak 16070(css)/16071(html)/16072(js)/
16073(mojom-webui.js), `AdblockInternalsPageHandler` 메서드 11개와 인자 이름, 차단 페이지 문자열
("Page blocked by Aside" / "Aside blocked this page" / "A content filter matched this address before it was loaded" /
"Go back" / "Continue once"), 구독 64개 한도·사용자 규칙 4 MiB 한도.

포크 구현 (패치 035):

| 원본 | 포크 | 동일성 |
|---|---|---|
| 내부 페이지 html/css/js | pak에서 꺼낸 **원본 그대로** 서비스 (`aside_resources/adblock/`) | 동일 |
| 원본 생성 mojom JS 바인딩 | 원본 파일 그대로, 메시지 ID 11개만 0..10으로 치환 | 인터페이스·인자 동일, ID만 다름(아래) |
| `AdblockInternalsPageHandler` 11개 메서드 | `adblock_internals.mojom` 같은 모듈·이름·인자 순서로 C++ 구현 | 동일 |
| 상태 JSON(overview/subscriptions/custom/engines) | 원본 JS가 읽는 키 전부 채움 | 동일(값 의미는 근사) |
| adblock-rust 엔진 | Chromium `subresource_filter` 규칙 파서 + `url_pattern_index` 색인 | **근사** |
| 요청 차단 | `WillCreateURLLoaderFactory`에 프록시 팩토리 삽입 → `ERR_BLOCKED_BY_CLIENT` | 결과 동일 |
| `$document` 차단·차단 페이지 | `AsideAdBlockNavigationThrottle` + 같은 문구의 차단 페이지, Continue once는 오류 문서에서의 사용자 제스처 탐색을 한 번 허용(리디렉션 포함) | 문구 동일, 시각 근사 |
| 요소 숨김(렌더러 옵저버 + mojom) | 브라우저에서 격리 월드로 CSS 주입(`__aside_adblock_hide`, `__asideAdBlock` 심) | 결과 동일, 경로 다름 |
| 구독 내려받기(ETag/Last-Modified, UTF-8 검사) | `SimpleURLLoader`, 304 처리, 24h 자동 갱신 | 동일 |
| engine0/1.dat 캐시 | 미구현(항상 재컴파일, cacheHit=false; 150-230 ms) | 다름 |

검증 (`test/adblock/`, `result-2026-09-05.json`, ui-shots 22-24):

| 항목 | 결과 |
|---|---|
| EasyList/EasyPrivacy 내려받기·컴파일 | ready, 네트워크 규칙 109,905 / 요소 숨김 24,279, 229 ms |
| testRule(adsbygoogle.js) | shouldBlock=true, `\|\|pagead2.googlesyndication.com^` (EasyList) |
| 시험 페이지(127.0.0.1): 광고 script/pixel/GTM/GA | 4건 모두 `ERR_BLOCKED_BY_CLIENT`, example.com은 허용 |
| 요소 숨김 `.ADBox` `.ADBAR` / 대조군 | none / none / block |
| 광고 iframe | 하위 프레임 탐색 차단 |
| naver.com 실사이트 | 요청 209건 중 24건 차단(ntm.pstatic.net, tivan.naver.com) |
| `\|\|example.org^$document` 사용자 규칙 | 차단 페이지 표시 → Continue once → https://example.org 로드 |
| 끄기/켜기 | 끄면 전부 로드·숨김 해제, 켜면 복귀 |

남은 차이(정직 보고): (1) mojo 메시지 ID — 원본은 공식 빌드의 ID 뒤섞기(`enable_mojom_message_id_scrambling`,
//chrome/VERSION 기반)라 1838076500 등; 포크는 순차 ID. 원본 JS를 살리기 위해 JS 쪽 숫자만 바꿈. 같은 VERSION으로
뒤섞기를 켜면 동일해질 수 있으나 mojom 전체 재생성 필요. (2) 엔진 문법 범위 — EasyList 3,172줄이 파서 미지원
(`$redirect`, `$csp`, `$removeparam`, 정규식 규칙, `:-abp-*`·`:style()` 절차형 선택자 등). adblock-rust는 이들을 처리.
(3) 기본 구독(EasyList+EasyPrivacy)은 포크가 첫 실행 때 넣음 — 원본이 어떤 목록을 기본으로 넣는지는 기계어에 URL이 없어 미확인.
(4) 캐시 파일 미구현. (5) 차단 페이지의 색·여백은 원본 스크린샷이 없어 근사.

## 2026-09-05 (8) 세션 4 — 광고 차단 문법 확장 · mojo ID 원본화 · 원본 문자열 정렬 · 미니팝업 실체 확인

### A1. 버려지던 규칙 전수 분류 → 구현 (patch 036)
분류 도구: `components/subresource_filter/tools/aside_rule_classifier_main.cc`(엔진과 같은 파서 경로, `ninja -C out/aside aside_rule_classifier`)
+ `test/adblock/classify/aggregate.py`. 입력은 포크가 실제 내려받은 목록(`test/adblock/classify/easylist.txt`·`easyprivacy.txt`). 상세: `test/adblock/classify/README.md`.

| | EasyList(81,650줄) | EasyPrivacy(56,803줄) |
|---|---|---|
| 확장 전 거부 | **3,172** = `$popup` 2,938 · `$generichide` 168 · 정규식 29 · `$rewrite` 7 · `$csp` 3 · 절차형 선택자 27 | **49** = `$redirect(-rule)` 22 · `$important` 10 · 정규식 7 · `:style()` 4 · `$csp` 2 · `$rewrite` 1 · `$method` 1 · `~document` 1 · `:has-text` 1 |
| 확장 후 거부 | **294** = 절차형 선택자(`#?#`·`:-abp-`·`:has-text`·`:has()`안의 절차형) 293 · `~document,~subdocument` 1 | **5** = `:style()` 4 · `:has-text` 1 |

정정: 전달 문서가 추정한 `$removeparam`은 두 목록에 없다. 거부의 93%는 파서가 아니라 `url_pattern_index`가 popup element type·generichide/elemhide activation을
색인하지 않아 생긴 것(`url_pattern_index.cc:48-77`). 또 `#?#` 줄 255개가 URL 규칙으로 잘못 색인되고 있었다(`##`로 정규화해 선택자로 처리하도록 고침 → 절차형이면 거부).

구현(`aside_adblock_rule_preprocessor.{h,cc}` 전처리 + 엔진 보조 색인 8개 + RE2):
`$popup`(탐색 스로틀에서 `HasOpener()`+초기 항목인 창의 첫 탐색 평가, 차단 시 창 닫음) · `$generichide`/`$elemhide`(`HidingStylesheet`) · 정규식(`RegexRuleMatches`, 대소문자 무시) ·
`$important`(예외보다 먼저) · `$redirect`/`$redirect-rule`/`$rewrite=abp-resource:`(내장 noop 자원 `aside_adblock_resources.h` + manual 디렉터리 `resources.json`; 프록시 `ResourceLoader`가 본문 응답) ·
`$csp`(탐색 URLLoaderFactory 프록시 `NavigationClient`가 문서 응답에 `Content-Security-Policy` 추가, `parsed_headers` 재계산) · `$method`. TestRule 결과에 `redirectResource`, 상태 JSON `engines[]`에 `compiledRegexCount`/`regexes`/`popupRuleCount`/`cspRuleCount`.

검증(`test/adblock/run-adblock-test.sh` → `result-2026-09-05-ext.json`, **22/22**): 기존 항목(내부 페이지·차단·숨김·$document·끄기) + `$redirect=noopjs`(빈 스크립트 로드, 실제 스크립트 미실행) ·
`$redirect=1x1.gif`(1×1 이미지) · `$important`가 예외를 이김 · 정규식 차단 · `$method=post`(GET 통과/POST 차단) · `$generichide`(generic 숨김 해제, 사이트 규칙 유지) · `$csp`(인라인 스크립트 미실행) ·
`$popup`(`&popunder=` 팝업 닫힘, 대조 팝업 열림) · 차단 페이지 셋째 문장. naver.com: 요청 237건 중 26건 차단(이전 209/24).
근사: uBO 대리 스크립트(chartbeat.js 등)는 빈 스크립트로 응답. 절차형 선택자 294줄은 렌더러 실행기(A6) 몫.

### A2. mojo 메시지 ID — 빌드 없이 원본화
원본 ID 11개 = `sha256(//chrome/VERSION 파일 바이트 + "AdblockInternalsPageHandler" + i)[:4] & 0x7fffffff`(`mojom_bindings_generator.py` `ScrambleMethodOrdinals`, salt는 이 트리의 `chrome/VERSION` 그대로) — Python 재계산으로 11/11 일치 확인.
→ `adblock_internals.mojom`에 명시 ordinal(`GetState@1838076500()` …)을 적어 생성 헤더 `kGetState = 1838076500` 등이 나오게 했고, 원본 `mojom-webui.js`(pak 16073)를 **바이트 동일**하게 복원(`cmp` 통과). 전체 트리 뒤섞기 빌드는 불필요.

### A4. `setAdBlockingEnabled` — Aside 경로 아님
바이너리에서 이 문자열은 CDP `Page` 도메인 메서드 목록(`setDocumentContent`·`setFontFamilies`… 사이) 안에 있다 = 표준 `Page.setAdBlockingEnabled`. 데몬/확장 경로 없음으로 종료.
기본 구독 목록: 바이너리에 `easylist` 문자열 없음 → 데몬/확장/컴포넌트 쪽. 포크의 EasyList+EasyPrivacy 기본값은 그대로(근사).

### A5·A7. 원본 문자열(바이너리 0xd30d5f3–0xd30e2b2)로 교체
적용: "Filter subscriptions must use a valid HTTPS URL." / "Filter URLs cannot contain credentials or fragments." / "Local and loopback filter hosts are not allowed." / "Private, local, and reserved IP addresses are not allowed." /
"A maximum of 64 filter subscriptions is supported." / "This filter URL has already been added." / "Filter name is too long." / "Filter subscription was not found." / "Ad blocker service is disabled." / "Enter a valid request URL." /
"The profile network service is not available." / "Custom rules must be valid UTF-8 text without NUL bytes." / "Filter download exceeded five redirects." / "Unsafe redirect rejected: " / "Filter server returned HTTP %d." /
"Downloaded content is not a valid UTF-8 filter list." / "The compiled candidate engine could not be installed." / "failed to read manual adblock file: " / 차단 페이지 6문장(제목 "Page blocked by Aside", "Aside blocked this page",
"A content filter matched this address before it was loaded.", "Go back", "Continue once", "Continuing allows only this navigation in the current tab.").
미배정(원본에 있으나 포크 경로 없음): "Another filter update is currently compiling.", "Subscription metadata is too large or unreadable.", "Subscription metadata is not valid JSON.", "Stored filter file is unreadable.",
"Custom rules file is too large or unreadable.", manual 디렉터리 한도 3종, "engine0.dat"/"engine1.dat"(A3), "adblock-rust returned an empty serialized engine", "provider ID must not be empty", "filter source stable ID must not be empty",
"filter source digest mismatch: ", "duplicate filter source stable ID: ". 검사 순서·이름 길이 한도(200)는 추정.

### A6 근거 추가
바이너리 문자열: `aside_adblock_render_frame_observer`, `AsideAdBlockCosmetic`, `CosmeticFilterHost::TakePrefetchedResources`, `GetCosmeticResources`, `GetHiddenSelectors` → 렌더러 옵저버 + mojom `CosmeticFilterHost`(선택자·자원 요청) 구조 확정.

### B1 정정 — 미니팝업 창은 이미 있다
patch 011/012(`chrome/browser/extensions/api/aside_mini_popup/mini_popup_service.cc`): 프레임 없음(`MiniPopupFrameView`), 항상 위(`kFloatingWindow`), `ForEachCurrentBrowserWindowInterfaceOrderedByActivation`으로 브라우저 창 탐색.
이번 세션 실기동: 확장 SW에서 `chrome.asideMiniPopup.setState("expanded")` → 창 생성, `minipopup.html#/u/0/minipopup` 렌더링("Ask Aside" 입력), 확장이 `setSize`로 440×93 지정(ui-shots/25). 전달 문서 B1의 "창 없음"은 오래된 기술.
남은 것: 전역 단축키(getShortcut/setShortcut) 트리거, 옵션 창(B2), 그림자·모서리 등 픽셀.

### A6. 렌더러 요소 숨김 — 원본 스크립트 그대로 (patch 037)
바이너리 0xc79e54b에 원본의 **요소 숨김 스크립트 전문(14,719바이트)**이 문자열로 들어 있어 그대로 추출했다(`original-resources/aside_adblock_cosmetic.js` →
`chrome/renderer/aside_adblock/aside_adblock_cosmetic_script.h`, 바이트 동일). 스크립트가 정의하는 것: `payload = {hideSelectors, proceduralActions(JSON 문자열 배열), generichide}`,
`adoptedStyleSheets`로 표준 선택자 적용(1st-party URL을 품은 요소는 자동 해제 `reviewStandardSelectors`), 절차 연산자 `css-selector`·`has-text`·`matches-attr`·`matches-css(-before/-after)`·
`matches-path`·`min-text-length`·`upward`·`xpath`, 동작 `remove`·`style`·`remove-attr`·`remove-class`, MutationObserver로 class/id 수집(`takePending`) → 브라우저가 generic 선택자 회신(`addHideSelectors`),
`scheduleProcedural`(50ms 디바운스), pagehide/pageshow 정지·재개, `W.__asideAdBlock` 재주입 시 갱신.
렌더러 C++ 문자열(`aside_adblock_render_frame_observer.cc` 이웃): `ApplyCosmeticResources`, `WasShown`/`DidSetPageLifecycleState` → `scheduleProcedural();`, `takePending() || '';`, `addHideSelectors(`, JSON 키 `hideSelectors`/`proceduralActions`/`generichide`. mojom `aside_adblock.mojom.CosmeticFilterHost`(`GetCosmeticResources`·`GetHiddenSelectors`·`TakePrefetchedResources`).

포크 구현: `chrome/common/aside_adblock/aside_adblock.mojom` + `chrome/browser/aside_adblock/aside_adblock_cosmetic_filter_host.{h,cc}`(프레임별, `chrome_browser_interface_binders.cc` 등록) +
`chrome/renderer/aside_adblock/aside_adblock_render_frame_observer.{h,cc}`(`ReadyToCommitNavigation`에서 페이로드 요청 → `DidCreateDocumentElement`에서 격리 월드에 스크립트 주입 → 300ms 폴링으로 `takePending`→`GetHiddenSelectors`→`addHideSelectors`, DOMContentLoaded/load/WasShown 훅).
엔진: generic 선택자를 선두 `.class`/`#id`로 키 분리(`generic_by_class_`/`generic_by_id_`/`generic_misc_`), 절차형 규칙 파서 `aside_adblock_procedural.cc`(`:-abp-has`→`:has`, `:-abp-contains`→`has-text` 별칭), `CosmeticResourcesJson`/`HiddenClassIdSelectors`.
브라우저 쪽 DOMContentLoaded CSS 주입(구 tab helper)은 제거 — 이제 첫 페인트 전(문서 요소 생성 시점)에 숨긴다.
분류 도구 재측정: EasyList 거부 294 → **72**(`:has(…:has-text())` 중첩 65 — 원본 스크립트의 허용 연산자에 `has`가 없어 원본도 못 돌림, `:-abp-properties` 7), EasyPrivacy 6 → **1**. 절차형 227줄 수용.
근사: 원본이 `TakePrefetchedResources`로 탐색 시점에 미리 계산해 두는지 vs 요청 시 계산하는지는 미확인(포크는 ReadyToCommit에서 비동기 요청 — 문서 요소 생성 전에 대개 도착). 폴링 주기 300ms·유휴 20회 중단은 추정.
검증(A6, `run-adblock-test.sh` 29항목 **29/29**, `result-2026-09-05-ext.json`): 기존 22 + 절차형 `:has-text`(일치 요소 숨김·형제 유지) · `:style()` 적용 · 127.0.0.2 페이지에서 generic `.ADBox`가
class 조회 경로로 숨김 · 800ms 뒤 추가된 `.ADBAR`도 숨김(MutationObserver→takePending→addHideSelectors) · `adoptedStyleSheets` 1개(431 규칙). 로그(`--vmodule=aside_adblock*=2`): 요청→17,137B 페이로드→문서 요소 생성 시 주입(31,854B 스크립트)→2 classes/2 ids 조회→1 선택자.
정직 기록: 새 바이너리로 첫 실행 때 generic 페이지 3항목이 실패(26/29)했고 서비스 재기동 후 두 번 연속 통과. 재현 못 함 — 첫 실행 직후의 색인/프로세스 상태 문제로 추정, 미확정.

### A3. 엔진 캐시 engine0.dat / engine1.dat (patch 038)
`Engine::Serialize/Deserialize`(`base::Pickle`): 헤더(형식 버전·소스 digest·본문 SHA-256) + 본문(출처 통계, 색인 flatbuffer 10개, 규칙 표, 정규식(proto+패턴), 자원, 선택자 표). 소스 digest = 각 소스(id·title·본문 SHA-256) + resources.json + 형식 버전.
서비스는 컴파일 전에 `<profile>/AsideAdBlock/Cache/engine{0,1}.dat` 중 digest가 같은 파일을 찾아 복원하고(`cacheHit=true`), 없으면 컴파일 후 `engine<generation%2>.dat`에 원자적으로 기록(원본 문자열 "engine0.dat"/"engine1.dat" 두 슬롯). `ClearEngineCache`는 디렉터리 삭제 후 재컴파일.
검증(`test/adblock/cache-check.mjs`): 첫 기동 cacheHit=false·컴파일 306ms·`engine1.dat` 18.8MB 생성 → 재기동 cacheHit=true·복원 81ms, 규칙 수 동일(112,823/24,507/정규식 31/절차형 227). 전체 테스트 29/29 유지.
근사: 원본 캐시의 내부 형식(adblock-rust 직렬화)은 다르며 파일 이름·슬롯 교대·cacheHit 보고만 맞춘 것. 캐시 무효 조건(digest 비교 기준)은 원본 문자열 "filter source digest mismatch"/"duplicate filter source stable ID"에서 유추.

## 2026-09-05 (9) 세션 5 — 미니팝업 단축키·옵션 창, Aside 프로필 메뉴, 계정 비밀번호 게이트 (patch 039)

### B1 잔여 — 전역 단축키
원본 `aside_mini_popup_coordinator.cc`(문자열 0xd6ba1a7): `CreateWidget`·`SetSize`·`SetOptionWindowSize`·`OpenOptionsWindow`·`ActivateOptionsWindow`·`CloseOptionsWindowAndRestoreFocus`·`FinishOptionsWindowFocusTransfer`·`CloseOptionsWindow`·`OpenFolderPicker`·`RequestHide`/`FinishHide`·`PreHandleKeyboardEvent`·`AddNewContents`·`ApplyTransparentWebContentsBackground`, 오류 "Aside mini popup global shortcut unavailable".
Local State pref `aside.mini_popup.shortcut`(기본 "Alt+Space")·`aside.mini_popup.enabled`; 확장은 실패 시 "This shortcut is unavailable"을 띄운다(mini-popup-*.js).
포크: `mini_popup_shortcut.{h,cc}` — `ui::GlobalAcceleratorListener`(Ozone X11 = XGrabKey)에 `extensions::Command::StringToAccelerator`로 파싱한 가속키를 등록, pref 변경을 따라 재등록. 누르면 마지막 활성 창의 프로필 `MiniPopupService::ToggleFromShortcut()`(보이면 숨김, 아니면 생성·표시·포커스). `setShortcut`은 파싱·등록 가능 여부를 검사해 "Invalid mini popup shortcut" / "Aside mini popup global shortcut unavailable" / "This shortcut is unavailable"을 돌려준다. 서비스는 프로필 생성과 함께 만들어져 시작 시 등록.
검증(`test/minipopup/minipopup-test.mjs`, X11 `xdotool key alt+space`): 등록 로그 → 1회 누름에 420×640 창 표시(minipopup.html 타깃) → 2회 누름에 숨김. 근사: 토글 동작(원본이 표시만인지 토글인지 미확인).

### B2 — 옵션 창
확장 minipopup.js: `window.open(chrome.runtime.getURL("minipopup-options.html")+"?left&top&width&height", "_blank", "popup=yes")` → 열린 창의 `chrome.asideMiniPopup.setOptionWindowSize(w,h)`(기본 360×240) → `close()`.
포크: `ChromeExtensionHostDelegate::CreateTab`에서 opener가 미니팝업 문서인 `popup=yes` 창을 `MiniPopupService::MaybeOpenOptionsWindow`가 가로채 프레임 없는 항상-위 반투명 Widget(`views::WebView`, 페이지 배경 투명 = `ApplyTransparentWebContentsBackground`)에 띄운다. 위치·크기는 URL 쿼리(원본 확장이 넣는 값), `setOptionWindowSize`가 옵션 창을 조정, `window.close()` → `CloseContents` → 창 정리 후 미니팝업 재포커스(`CloseOptionsWindowAndRestoreFocus`). 이전 포크는 이 API로 본 창을 늘리고 있었다(오류).
검증: 500,300 360×240에 생성 → 400×300으로 조정 → 닫힘(타깃 0), ui-shots/26.

### B4 — Aside 프로필 메뉴
원본 `chrome/browser/ui/views/profiles/aside_profile_menu_view.cc`(문자열 0xd6b558a): `AsideMenuPanel`·`AsideMenuItemButton`·`ProfileIndicatorIconPickerPanel`·`ProfileIndicatorIconButton`·`kEditProfileNameFieldId`·히스토그램 `AsideProfileMenuEditProfile`/`AsideProfileMenuDeleteProfile`, 경로 "/newtab.html#/u/"+"/settings/general", 지시 아이콘 28종(moon·flame·magic_wand·…·bubble). pak 문자열 "Other Aside Profiles"(1184) "Manage Aside Profiles"(1185) "Add Aside Profile"(1187) "Customize Profile"(2382) "Open Guest Profile"(2379).
포크 `aside_profile_menu_view.{h,cc}`: 푸터 프로필 버튼 → 위로 뜨는 버블(머리: 아바타·이름·이메일, 연필 → 인라인 이름 편집 Textfield(Enter 확정 = `ProfileAttributesEntry::SetLocalProfileName`+`aside.account_display_name`) / Customize Profile → `chrome-extension://…/newtab.html#/u/0/settings/general` 탭 / Other Aside Profiles(다른 프로필 → `profiles::SwitchToProfile`) / Add Aside Profile·Manage Aside Profiles(`ProfilePicker`) / Open Guest Profile). ui-shots/27.
미구현(증거 부족): 프로필 삭제 항목(히스토그램만 확인, 문구·확인 절차 미확인), 지시 아이콘 선택기(저장 위치 미확인; 아이콘 28종 중 11종은 포크 아이콘 세트에 없음).

### B3 — 프로필 페이저 (미구현, 범위 확정)
문자열 `SchedulePreloadVisibleProfilesForProfilePager`·`SchedulePendingProfilePageSwitchAfterCompositorCommit`·`ScheduleCaptureProfilePageSnapshot`·`RefreshProfilePageIndicatorAccountEmails`(세로탭 스트립 영역), pref `aside.vertical_tabs.profile_order`·`aside.last_active_profile`.
= 한 창 안에서 프로필별 "페이지"를 넘기고 전환 시 스냅샷을 찍는 다중 프로필 창 구조. Chromium 창은 단일 프로필이라 창 구조를 바꾸는 큰 작업이며, 원본 화면 증거(스크린샷)도 없어 착수하지 않음. 전환 자체는 B4 메뉴가 담당.

### B5 — 계정 비밀번호 게이트
원본 `chrome/browser/profiles/aside_account_password_gate.cc`(문자열 0xd305f6e): `IsBootstrapWindowRequired`·`RefreshBootstrapState`·`PostHideNormalBrowsers`·`PostMaybeShowBootstrapWindow`·`PostCloseStaleBootstrapPopupAfterExtensionReload`·`PostMaybeOpenFreshBrowserAfterBootstrapReset`; 게이트 함수 영역(0x3f78e00~)이 참조하는 문자열: `aside.automatic_password_gate_suppressed`(9회), `aside.account_password_extension_available`(8회), `aside.bootstrap_complete`(6회), 확장 ID, `aside-account-password-popup`, `profile.ephemeral_mode`, `is_ephemeral`. 확장 경로 `/newtab.html#/onboarding/splash`(0xc78df95; splash가 `localBootstrap` 상태를 보고 `/onboarding/setup-account/password`로 보냄). accounts.json `localBootstraps[id].isComplete`는 포크 updater가 이미 `aside.bootstrap_complete`로 옮기고 있었다.
포크 `aside_account_password_gate.{h,cc}` + factory(프로필 생성 시): 필요 조건 = 계정 바인딩(`aside.account_id`≥0) ∧ ¬`bootstrap_complete` ∧ ¬suppressed ∧ 확장 사용 가능 ∧ ¬auth_paused ∧ 일반 프로필. 필요해지면 일반 창 숨김 + `aside-account-password-popup` 팝업 창(`Browser::CreateForAppPopup`)에 splash 표시; 완료되면 팝업 닫고 숨긴 창 복귀(없으면 새 창). 확장 언로드 시 팝업 정리 후 재평가.
검증(`test/password-gate/run-gate-test.sh`, 별도 인스턴스 :98, ASIDE_HOME의 accounts.json isComplete=false): 일반 창 숨김·팝업에 "Welcome to Aside" 온보딩(ui-shots/28) → isComplete=true로 바꾸면 6초 안에 팝업 닫히고 일반 창 복귀. 근사: 팝업 크기(원본 미확인), `account_password_extension_available`을 별도 컴포넌트가 아니라 AsideAgentManager 설치 여부로 둠, 게이트 중 새로 열리는 창은 감시하지 않음.

### A9 — 두 번째 토큰(AsideSecureToken 3h): 미구현 유지
요청 본문 `{challengeId, challenge}`의 `challenge` 의미(서명인지 원문인지)를 데몬 코드로 확정할 수 없고 데몬은 쓰지 않는다. 추측 구현은 하지 않음.

### B6 — 벨몬트 실제 호스트 미러링: 실행 안 함
사용자의 호스트가 지금 떠 있다(`.build/belmont-wsl-runtime/dist/host`, 127.0.0.1:1337). 사용자 세션에 작업을 밀어 넣는 검사라 이 세션에서는 하지 않았다. 절차는 전달 문서 B6 그대로.

### A6 추가 — 남은 72줄을 원본 엔진으로 직접 대조 (patch 040)
원본이 쓰는 adblock-rust(crates.io 0.13.3, `cargo`로 빌드)에 포크가 거부하던 EasyList 72줄을 넣었다(`test/adblock/adblock-rust-check/`):
**72줄 전부 수락, procedural_actions 0, 전부 `hide_selectors`(일반 CSS 문자열)**. `validate_css_selector`가 절차 연산자를 최상위 compound에서만 찾고
`:has()` 안쪽은 보지 않기 때문. 원본 스크립트는 그 문자열을 `replaceSync`에 넣고 브라우저 CSS 파서가 버린다(오류로 세지 않음).
포크 `aside_adblock_procedural.cc`를 같게 고침(최상위 절차 연산자 없으면 일반 선택자). EasyPrivacy의 `~document,~subdocument` 1줄은 adblock-rust도 `NegatedDocument`로
거부하므로 포크도 거부 유지(`~subdocument`만 있는 규칙은 다른 타입 전체 목록으로 풀어 수용). 분류 도구: **EasyList 거부 0, EasyPrivacy 1 — 원본 엔진과 같은 수**.

## (10) 6차 세션 (2026-09-05 밤) — 실사용 검증에서 고친 것
- 호스트 실행 조건: 브라우저 봇이 Aside를 쓰려면 호스트 환경변수 `SAND_ASIDE_BROWSE=1`이 필수. 없으면 봇이 벨몬트 자체 도구로 혼자 답한다(증상만 보면 "Aside가 안 쓰임"). 호스트는 tmux `belmont-bot`에서 `npm run wsl:start`, 소스가 바뀌면 `npm run wsl:setup` 재빌드(미추적 문서 하나만 바뀌어도 "stale").
- 서비스 `src/core.mjs`: (a) stage — 실행 중 최근에 바뀐 페이지 탭을 앞으로 올려 봇 화면(:99)이 에이전트를 따라감(`BELMONT_BROWSE_STAGE=0`으로 끔); (b) 실행 전 세션의 browserBinding을 현재 프로필·창으로 갱신(Aside UI/CLI에서 만든 채팅, 또는 Chrome 재시작 뒤 창 번호가 죽은 채팅 대비).
- 서비스 `src/session.mjs` describeSuspension: 승인 요청에 제목·설명이 없으면 파일 경로/대상/JSON을 보여 준다.
- 벨몬트 `aside-bot-runner.ts`: 인용 표식 제거(`stripAsideCitations`), 서스펜션에서 턴이 끝날 때도 미러 커서 이동(자기 지시문 되비침 방지), 루틴(automationWake 숨은 턴)의 저장 지시문을 Aside 작업으로 실행(`parseAutomationWake`). 단위 테스트 6개 통과, typecheck 통과.
- 검사 결과: `usecases/PARITY-RESULTS-2026-09-05.md`.

## (12) G1 세로탭 복원 (2026-09-06, patch 041-G1)

담당 구간 14개(`campaign/G1-vertical-tabs.md`, 788,800 B) 전부 종결. 결과 문서
`campaign/G1-RESULT.md`, 캡처 `ui-shots/G1-00`~`G1-34`(34장).

**원본 문자열의 위치**: UI 문구는 바이너리 안의 UTF-16 리터럴 덩어리 한 곳에 몰려 있다
(arm64 `0xd779ff4`–`0xd77b7f4`, x86_64 `0xe9a68c2`–`0xe9a8144`). ASCII로 찾으면 하나도 안 나온다.
클래스·함수 이름은 따로 `0xd6bbd80`–`0xd6bd141`(arm64). 이 두 표를 뜬 뒤 `re-tools/xref.py`로
참조처를, `asdis.py`로 메뉴 항목 순서와 명령 번호를 읽었다. 그래서 아래 메뉴들은 문구·순서·구분선·
명령 번호가 원본과 같다.

**새로 만든 것 8군데**: 세로탭 채팅 행 우클릭 메뉴(0x7d0~0x7d6)와 이름 바꾸기 대화상자
(`VerticalTabStripRenameChat`), 섹션 머리 메뉴(0x834~0x836) / 세로탭 북마크 줄·폴더 줄 메뉴와
대화상자 4개(`aside_bookmark_dialogs.{h,cc}` 신규) + 빈 상태 줄 + 상단 로딩바
(`top_container_loading_bar.{h,cc}` 신규, 원본 클래스 `TopContainerLoadingBar`, 속성
`LoadingProgress`) / 알림 권한 프롬프트 문구 2줄과 `CrossSectionDragPreview` / 탭 우클릭 메뉴의
`CommandAddToBookmarks`(지표 `Tab.ContextMenu.AddToBookmarks.SelectedTabsCount`) / 채팅 보관
대화상자 2종과 행 상태 문구("Awaiting approval"·"Awaiting answer") / 상태 말풍선의 `aside://`
표시 / 고정 탭 서비스(`PinnedTabNavigationThrottle`, `SchedulePinnedTabsReconciliation`) /
고정 탭 칩(`aside_pinned_entries_view.{h,cc}` 신규, 가로·세로 공용).

**차이 없음으로 닫은 것 6군데**(7·9·10·11·13·14): 구간 안의 이름과 지표를 하나씩 트리에서 찾아 본
결과 전부 이미 있었다. 원본 바이트가 다른 이유는 원본이 그 코드를 훨씬 큰 파일 하나에 넣어
컴파일했기 때문(추적 문자열이 `vertical_tab_strip_region_view.cc:15365`를 가리킨다). 14번은
복원 지도와 VERSION-STEPS가 엇갈렸는데 **VERSION-STEPS가 맞다**(마우스 속도 계산 함수·지표·기능
매개변수 9개가 그대로 있음).

**검증**: 빌드한 크롬을 화면 :111에 독립 실행해 직접 눌러 봤다. 데몬이 있어야 보이는 작업·채팅
행은 라이브 데몬(21420)을 건드리지 않고 `ASIDE_DAEMON_BASE_URL`로 가짜 응답기를 물려 확인했다.
이름 바꾸기·보관은 대화상자 → `POST /session/for-chrome/<id>/rename|archive` → 목록 갱신까지
왕복으로 확인. 고정 탭 스로틀은 같은 사이트 링크는 그대로, 다른 사이트 링크는 취소 후 새 탭으로
열리는 것을 실제로 확인.

**검증하다 찾아 고친 결함 2개**:
- `StatusBubbleViews::ExpandBubble()`이 `url_text_`를 다시 계산하면서 스킴 치환을 건너뛰어
  `aside://` 표시가 곧바로 `chrome://`로 되돌아가고 있었다. 그 자리도 같은 함수를 지나게 고침.
- `AsidePinnedEntriesView`가 `OnTabStripModelChanged`만 보고 있어서, 제자리 탭을 고정할 때처럼
  탭 목록이 안 바뀌는 경우 칩이 갱신되지 않았다. `OnTabPinnedStateChanged`·`OnTabChangedAt` 추가.

**남긴 것**: 고정 칩의 **가로 탭 스트립** 배치. 뷰는 붙어 있고(임시 로그로 확인) 배치 폭도
차지하는데 그려지지도 마우스에 잡히지도 않는다. 앞쪽 버튼을 배치에서 빼고 탭 스트립 여백으로
벌충하는 이 파일 구조가 원인으로 보여 여백·기준점을 옮겨 봤으나 효과가 없고 탭 검색 버튼만
밀려서 되돌렸다. 세로판은 정상. 그 밖에 재현 못 한 것: 칩 끌어 옮기기(`PinnedEntryDragGhost`,
`FinishEntryDrag`)와 북마크를 칩 줄에 떨어뜨리기(`BookmarkDragPreview`) — 이름만 남아 있고 동작
근거가 없다. 고정 탭 스로틀의 판정 규칙도 추정이다(원본 조건식이 문자열로 복원되지 않음).

## (13) G2 프레임·툴바·주소창·분할 보기 복원 (2026-09-06, patch 041-G2)

담당 12조각(구간 10 + G1 이관 2) 전부 종결: **재현 완료 8, 차이 없음 확인 3, 불가 1.**
자세한 내용은 `campaign/G2-RESULT.md`. (절 번호는 G1이 (12)를 이미 쓴 뒤라 (13).)

**새로 만든 것**: `AsideAiTabsViewport`(원본과 같은 헤더 `multi_contents_view.h`) — 화면에 없는
에이전트 탭에 크기를 대신 주는 뷰. 그 탭의 WebContents를 뷰포트 크기로 `Resize` 하고 그 탭 자신의
DevTools 세션에 `Emulation.setDeviceMetricsOverride`(width/height/deviceScaleFactor/mobile/scale/
screenWidth/screenHeight/positionX/positionY/dontSetVisibleSize)를 넣는다. 대상이 빠지면
`Emulation.clearDeviceMetricsOverride`. 근거: 원본 `0x04c78900`(Resize 1 + 검사 3 + clear 6 +
set 1), `0x04c7dbd0`/`0x04c7dee0`(명령 조립), `0x04c7dca0`(JSON 직렬화 → DevTools 세션).
`FloatingTabDragView`(원본과 같은 파일 `multi_contents_view_drop_target_controller.cc`) — 탭을
콘텐츠 영역 위로 끌 때 포인터 아래 뜨는 파비콘+제목 카드.

**앞 담당 코드에서 화면에 안 나오던 것 2개를 실행 중 로그로 찾아 고쳤다**:
- page_info **재적재 버블**이 만들어지자마자 사라졌다. 버블을 띄운 직후 주소창이 포커스를 가져가
  `close_on_deactivate` 기본값에 걸린 것. `set_close_on_deactivate(false)` + `ShowInactive()`.
  덤으로 크로미움 인포바가 겹쳐 뜨고 있어서 `ChromePageInfoDelegate::CreateInfoBarDelegate()`가
  인포바를 만들지 않고 true만 돌려주게 바꿨다(원본 바이너리에 `PageInfoInfoBarDelegate` 문자열이
  **하나도 없다** — 원본은 인포바를 버리고 이 버블로 바꾼 것).
- **주소창 로드 진행 표시**가 안 그려졌다. 배경에 칠했는데 주소창 글자칸이 자기 배경을 불투명으로
  덮고 있었다. 레이어를 가진 자식 `LocationBarView::PageLoadProgressView`를 맨 위에 쌓아 그리게
  바꿈. 로컬 지연 서버로 재 보니 채움이 x=835 → 1075 → 끝까지 자란다.

**역어셈블로 확정한 수치**: 진행 표시 되풀이 타이머 500 ms(`0x47f76ca`의 `0x7a120` µs),
`StartPageLoadProgressTrickle`은 `location_bar_view.cc:2800`, `PageInfoReloadBubbleView::ShowAction`은
`page_info_reload_bubble_view.cc:265`, 요소 식별자 `ActionButton`은 같은 파일 66줄,
`IsBromiumPage` 판정은 scheme `chrome-extension` + host 32글자 Aside 확장 id + path `/newtab.html`.

**차이 없음으로 닫은 3군데**(ToolbarView `0x0487a6e0`, 고정 툴바 액션 컨테이너 `0x04872550`,
ToggleButton `0x0afc71e0`): 세 구간 모두 Aside 고유 문자열이 0개이고, 안에 있는 이름·지표·설정
이름이 전부 우리 트리에 같은 자리로 있다. 먼저 ToggleButton 구간에서 **언와인드 블록 매처가
헛짚는다는 것을 증명**했다 — 그 구간은 `unmatched 16 / matched 6`으로 표시되지만 메타데이터
등록 함수가 크로미움 기준선(CfT `0x0ab84e70`)과 같은 모양(`edi=0x68`, `edx=0x2e`, `ecx=0x1d`,
속성 `IsOn`/`InnerBorderEnabled`/`AcceptsEvents` 같은 순서)이다. 크기 대조도 했다:
`ToolbarView::Init` 원본 18,336 B vs 기준선 17,728 B(+3.4%).

**불가 1군데**(searchbox mojom `0x0474d900`): 정체는 밝혔다 — 원본은 `searchbox.mojom.Page`를
**한 벌 더** 물리고(참조 자리 원본 22곳 vs 기준선 10곳, 남는 9곳이 이 구간의 한 블록
`0x0474dd80` 5,312 B), 그 두 번째 연결의 주인은 `0x048f2710` 구간, 즉 `asideOmnibox` 확장 API다
(**다른 그룹 담당**). mojo 생성 코드에는 메서드·필드 이름이 안 남아 인터페이스가 무엇을 더
받는지 바이트로 못 가르고, 주인 쪽이 정해지기 전에 배선만 먼저 만들 수 없다.

**라이브 확인이 남은 것**: `AiTabsCountBadgeView`와 `AsideAiTabsViewport`(에이전트 탭 그룹은 Aside
확장이 만든다 — 확장을 올리면 라이브 데몬 21420에 붙으므로 규칙상 안 띄웠다), `FloatingTabDragView`
(X11 합성 드래그는 탭을 새 창으로 떼어 내 분할 드롭 타깃이 안 겨냥된다).

## (14) G5 sync·업데이터·컴포넌트 업데이터·데몬 인증 복원 (2026-09-06, patch 041-G5)

담당 14군데 **전부 종결 — 완료 10, 불가 4(전부 맥/윈 전용)**. 결과 문서
`campaign/G5-RESULT.md`, 로그·검증 장치 `campaign/G5-logs/`.

**sync 데이터 타입 `ASIDE_WEBSITE_STORAGE`를 바이트 단위로 되찾았다.** 원본은 `kDataTypeInfoMap`
표가 통째로 데이터 구역(x86_64 0xf51dd08)에 남아 있어서 88바이트 항목을 그대로 읽었다 — 열거 번호
50(쿠키 49 바로 뒤), specifics 필드 번호 1776013, `kAlwaysEncrypted`, `kRegular`.
독립 검산으로 `DataTypeHistogramValue()`의 **64바이트 점프표**를 우리가 방금 빌드한 바이너리
(0x4653050)에서 뽑아 원본(0xdecfc70)과 맞췄다 — 64바이트 전부 일치, 상위 크로미움의 63바이트 판은
양쪽 다 없음. 실행 중 크롬 `chrome://sync-internals`의 Encrypted Types 줄에
`… Cookies, Aside Website Storage`가 나오는 것까지 화면으로 확인했다.

**컴포넌트 업데이터를 실물 CRX로 처음부터 끝까지 돌렸다.** 로컬 응답기(18790)에 원본 Omaha 응답과
Aside가 서명한 진짜 CRX3 두 개를 물려, 상태 확인 관문 → Omaha 요청(원본 앱 ID 세 개) → 내려받기 →
crx3 검증 → 설치 → 데몬 우아한 종료 → 강제 종료 후보 검사 → 재기동 → 활성 버전 확인까지
전부 실측했다. 라이브 데몬(21420)에는 한 번도 닿지 않았다(`ASIDE_DAEMON_BASE_URL`).

이 실측에서 **1교대가 "재현 완료"로 적었지만 실제로는 CRX가 한 개도 설치되지 않던 결함 세 개**를
찾아 고쳤다.

1. **Aside 자체 publisher 키.** 크로미움은 컴포넌트 CRX에 구글 publisher 서명을 요구한다
   (`CRX3_WITH_PUBLISHER_PROOF`). Aside가 배포한 CRX 두 개는 모두 앱 키 + **자기 publisher 키**
   `f8c46537…9dd4`로 서명돼 있고, 같은 32바이트가 원본 바이너리의 Aside 컴포넌트 업데이터 상수 뭉치
   (x86_64 0xd9c1d78 / arm64 0xc7997be)에 있으며 arm64 0x4075134의 한 줄짜리 getter가 그걸 벡터로
   돌려준다. 구글 키와 crx3 테스트 키는 원본에도 그대로 남아 있으므로(0xe9775e0) Aside는 상수를
   바꾼 게 아니라 자기 키를 하나 더 인정한 것이다. `components/crx_file/crx_verifier.cc`에 그 키를
   더했다.
2. **Aside Password Manager 서명 키를 되찾았다.** 1교대는 "배포 CRX를 못 구해 자료 없음"으로 두고
   등록조차 안 했는데, 원본 컴포넌트 표(0xd9c1cf8)에 `"AsidePasswordManager"` 바로 뒤 32바이트로
   들어 있었다 — 앱 ID `clcdgiameigmljcbkkcbjiljinmfkncl`. 이제 Omaha 요청에 앱 ID 세 개가 전부 나간다.
3. **`aside_component_update.log`가 한 줄도 안 쓰였다.** `base::AppendToFile`은 파일이 없으면
   실패하는 함수라 새 프로필에서는 항상 경고만 났다. 없으면 만들도록 고쳤고, 지금은 실제로 쌓인다.

**데몬 인증 악수를 실측했다.** `GET /auth/daemon/challenge?clientKind=chromium` → 설치 개인키로
`"Aside Daemon Auth v1\0"+challenge` ECDSA 서명 → `POST /auth/daemon/session` →
그 뒤 데몬 호출에 `Authorization: AsideDaemonSessionToken …`. 이 앞단은 `AsideSyncAuthManager`·
`AsideSyncEncryptionController`가 쓰는 것과 같은 `AsideDaemonAuthorizer`다.
진단 pref(`aside.sync_encryption_diagnostic_message`)가 원본 문구대로 전이하는 것도 확인했다.

**서버 없이 못 간 곳(정직하게)**: `/auth/access-token`·`/auth/sync-passphrase` 왕복은 방아쇠
(sync 인증 오류 / 암호문구 필요 / 2분 정체)가 Aside 계정 로그인에서만 생겨 실측하지 못했다.
**남은 차이**: 원본이 이 타입을 어디서 켜는지 못 찾았고(UserSelectableType 묶음에도
AlwaysPreferredUserTypes에도 50번 비트가 없다), `AsideWebsiteStorageSyncService` 브리지와
`AsideCookieSyncService`는 이번 범위 밖이며, 데몬이 준 access token을 sync 엔진에 물리는 배선이
아직 없다.

**불가 4군데는 전부 맥/윈 전용이다**: 업데이터 mojo 프록시·등록/버전 확인(`enable_updater &&
(is_mac || is_win)` 빌드 게이트, 리눅스 구현은 `NOTREACHED()` 껍데기), 맥 업데이터 클라이언트
(AuthorizationCreate·SMJobBless·NSXPCConnection), 업데이터 번들 경로(Mach 부트스트랩
`at.studio.AsideUpdater.update-internal.`). "못 알아냄"이던 0x081c9f90은 정체를 밝혔다 —
`updater_service.mojom`의 생성 바인딩이고 우리 포크에 이미 컴파일돼 들어 있다.

## (15) G3 프로필 메뉴·프로필 페이저·알림 인박스·확장 UI 복원 (2026-09-06, patch 041-G3)

담당 10군데 **전부 종결 — 재현 완료 7, 상위 크로미움에 이미 있음 2, 불가 1(맥 전용)**.
결과 문서 `campaign/G3-RESULT.md`, 캡처 `ui-shots/G3-*.png`.
앞 담당이 재부팅으로 죽어 결과 문서 없이 남긴 편집을 이어받아 끝냈다.

**프로필 페이저는 코드만 있고 죽어 있었다 — 눌러 보고 네 군데를 고쳤다.** 앞 담당이
`Browser::StashTabsForAsideProfileSwitch` / `RestoreTabsForAsideProfileSwitch` /
`chrome::SwitchProfileInPlaceForAside`까지 배선해 뒀지만, 프로필을 두 개 만들어 실제로 전환하면
브라우저가 즉사했다. ① `BrowserManagerService::AddBrowser()`가 "창이 새로 생겼다"고 알리는 바람에
`BrowserTabStripTracker`가 **이미 붙어 있는 탭띠 관찰자를 두 번 등록**하다 NOTREACHED —
창은 닫힌 적이 없으니 전역 목록은 이미 맞다. 알림을 보내지 않는
`AddBrowserForAsideProfileSwitch()`를 만들어 갈랐다. ② 그걸 고치자 이번엔 **보관해 둔 탭의 프로필이
파괴**됐다 — A→B로 넘어가면 A를 붙잡는 것이 없어져 `ProfileDestroyer`가 A를 부수는데, A의
`chrome://settings` WebContents가 아직 보관함에 살아 있어 `PeopleHandler::OnSyncShutdown()`에서
죽었다. 보관 중인 프로필마다 `ScopedProfileKeepAlive`를 잡도록 했다(소멸 순서 때문에 보관 목록보다
먼저 선언). 원본 추적 이름을 전부 읽어(`0x04bcb405 "PostClearTabStripEmptySuppressionForAsideProfileSwitch"`)
빈 탭띠 억제 해제도 원본처럼 posted task로 바꿨고, 전환 뒤 세로 띠 프로필 발치가 옛 프로필 이름을
계속 보이던 것도 `Browser::RegisterAsideProfileSwitched()` 콜백으로 다시 붙게 했다.
③ 두 번째 전환에서 **되돌아온 탭이 통째로 닫히고 창까지 사라졌다** — 보관하느라 탭띠를 비우면
`UnloadController::TabStripEmpty()`가 "이 창은 닫히는 중"이라는 표시를 걸어 두고, 다음 보관 때의
탭 분리가 `ProcessPendingTabs()`를 예약해 방금 복원한 탭을 전부 닫아 버린다(스택으로 확인:
`UnloadController::ProcessPendingTabs → TabStripModel::CloseAllTabs`). 보관이 끝나면 그 표시를 푸는
`UnloadController::ResetForAsideProfileSwitch()`를 넣었다(진짜 닫는 중이면 정규 취소 경로로 넘긴다).
④ 돌아온 뒤 **탭이 두 배로 늘었다** — 세션 재구축을 `SessionService::WindowOpened()`로 했는데
그 안의 `RestoreIfNecessary()`가, 앞서 옛 프로필 쪽에 `WindowClosed()`를 보내 그 프로필에 창이
없어진 상태였던 탓에 **지난 세션을 되살린 탭 위에 또 얹었다.** 복원을 부르지 않는 조합
(`SetWindowType` + `SetSelectedTabInWindow` + `ResetFromCurrentBrowsers`)으로 바꿨다.
확인: 같은 창(CDP `Browser.getWindowForTarget` 창 번호 동일)에서 탭 6개 → 다른 프로필 → 돌아오면
6개 그대로, 중복 없이 복원. 보관 중인 탭은 CDP 대상 목록에 "창 없음"으로 살아 있는 것까지 확인했다.

**웹스토어 테마 차단을 원본 기계 그대로 옮겼다.** 원본
`WebstorePrivateBeginInstallWithManifest3Function::ShowInstallDialog`(x86_64 `0x07f8f3d0`)은
첫 줄에서 `dummy_extension_->manifest()->type() == 2`(TYPE_THEME)를 보고 `0x07f900c0`으로 꼬리
점프한다. 거기서 `ui::DialogModel::Builder`로 제목 `Theme installation failed`(UTF-16 `0xe998e42`) ·
본문 `Aside browser does not support themes.`(`0xe998e76`) · `OK` 버튼을 만들어
`chrome::ShowTabModal()`로 띄우고, 닫힘 콜백(`0x07f903d0`)이
`BuildResponse(Result=4, "Themes are not supported by Aside browser")`(`__cstring 0xd993b80`)로
답한 뒤 `Release()` 한다. 결과 4 = `kFeatureDisabled`. 문구 넷과 결과 코드를 그대로 옮겼다.

**화면 공유 선택기의 `BorderOnTopView`를 되찾았다.** 이름은 Aside 전용이고(cft-171에 0건),
클래스 메타데이터가 `desktop_media_tab_list.cc:69`로 기록돼 있다. 하는 일은 `PaintChildren`
재정의로 — `views::View::PaintChildren()` 뒤에 `PaintRecorder`를 열어 `OnPaintBorder()`를
호출한다(x86_64 `0x04895b30`). 즉 **층을 쓰는 스크롤 목록 위에 테두리를 덧그린다.** 스크롤 뷰를
이 감싸개에 넣고, 다시 칠하는 함수(`0x04895880`)대로 감싸개·미리보기 상자·빈 미리보기 딱지에
둥근 배경 + 1 px 둥근 테두리를 걸었다.

**원본 색 이름표를 통째로 찾아냈다 — `kColorAside*` 66개가 우리 트리에 없다.** 원본 바이너리
`0xe60f2d8`에 `ui::ColorId` 순서 그대로 623개 색 이름이 들어 있고, 214번
`kColorAsideSurfacePrimary`부터 279번 `kColorAsideToggleHover`까지 **66개가 Aside 전용**이다.
덕분에 선택기가 쓰던 `0xed`/`0xd7`이 `kColorAsideHoverCardBackground` /
`kColorAsideSurfaceBorder`임을 이름으로 확정했다. 우리 포크에는 이 색이 하나도 없어 지금 각 그룹이
쓰는 `ui::kColorSys*`는 전부 근사치다 — **팔레트 자체를 한 그룹에 배정할 값어치가 있다**
(자세한 목록은 `campaign/G3-RESULT.md` "그룹 밖 발견").

**알림 인박스는 파일에서 SQLite로 이미 넘어가 있었고, 표 정의가 원본과 글자까지 같다.**
`CREATE TABLE IF NOT EXISTS inbox_entries (…encrypted_payload BLOB NOT NULL…)`와 INSERT 문,
`sql::Database::Tag("AsideInbox")`까지 원본 `__cstring` 그대로다. 옛 `<프로필>/AsideInbox/*.json`은
첫 저장 때 트랜잭션 하나로 행으로 옮기고 파일을 지운다. 종단 확인은 진짜 확장이 있어야 한다
(`IsExtensionEnabled()` 관문) — 벨몬트 통합 세션 몫으로 남긴다.

**대조로 닫은 두 군데.** 확장 메뉴 지표(`0x085de3c0`)는 지표 이름 10개가 원본과 기준선(cft-171)에서
같고 10개 전부 우리 트리 소스에 이미 있다 — 우리가 만들 것이 없다. `0x047c9720`의 headless 판정과
AppleScript 북마크도 기준선에 그대로 있어 Aside 것이 아니다(그 구간에서 Aside 것은 Geist뿐이고,
Geist는 이미 되어 있다 — TTF 18개 배치 + fontconfig 이름 해석 확인).

**불가 1군데는 맥 전용이다.** `extension_popover_mac.mm` / `ShowPopoverIfReady`(`0x04bbe2f0`).
`.mm` + `NSPopover`라 리눅스에 대응 파일이 없고, 이 훅이 하는 일("문서 로딩이 끝나면 팝오버를 띄운다")은
`ExtensionPopup::DocumentOnLoadCompletedInPrimaryMainFrame()`으로 리눅스 쪽에 이미 있다.

**넘긴 것**: 프로필 발치가 세로 띠 바닥에 고정돼 있지 않아 탭이 적으면 프로필 메뉴 위쪽이 잘린다(G1).
미니팝업의 프로필 전환은 `chrome::SwitchProfileInPlaceForAside()`를 부르면 된다(G4).
발치의 프로필 지시 아이콘은 `aside::ProfileIndicatorIcons()`를 쓰면 된다(G6).

## (16) G4 광고차단 잔여·가져오기·보안 원격 디버깅·미니팝업·devtools 복원 (2026-09-06, patch 041-G4)

담당 구간 5개(`0x048c1ab0` 가져오기 마이그레이터, `0x043eda40` pq_v1 설치 서명,
`0x0488bd30` 가져오기 WebUI 자원, `0x0498f6c0` 맥 전역 단축키 경로, `0x046f6cb0` devtools 다운로드
대리자)와 어제 코드로 확인된 결함 7건을 전부 닫았다. 상세는 `campaign/G4-RESULT.md`.

**확인하다 찾은 진짜 버그(이 절의 핵심).** 광고차단 코스메틱 스크립트를 렌더러가
`DidCreateDocumentElement()` 콜백 안에서 주입하고 있었는데, 블링크는 그 자리에서 요청한
`ExecuteScriptInIsolatedWorld`를 **예외도 없이 그냥 버린다.** 그래서 "코스메틱 페이로드가 문서 요소보다
먼저 도착한 문서"는 요소 숨김이 통째로 죽어 있었다 — 엔진이 데워진 평상시가 바로 그 경우다.
호스트 하나(작은 페이로드)는 실패하고 다른 호스트(17 KB 페이로드)는 성공하는 것이 단서였고,
같은 격리 세계에 같은 스크립트를 CDP로 직접 넣으면 완벽히 도는 것으로 스크립트·페이로드의 결백을
증명한 뒤 로그 순서 대조로 갈린 지점을 잡았다. 고침은 크로미움이 자기 content script를 넣는 자리와
같은 곳으로 옮긴 것이다 — `ChromeContentRendererClient::RunScriptsAtDocumentStart()`에서
`RenderFrameObserverTracker`로 찾은 관찰자를 깨우고, 주입 조건을 한 곳으로 모았으며,
DOMContentLoaded·load를 안전망으로 뒀다. 종단 검사 26/29 → **29/29**.

그 밖에: pq_v1은 맥 키체인 전용이라 서명 알맹이는 영구 불가로 두되 스킴 판정·거절 경로·원본 문구를
파일 키 방식으로 이식해 악수 17/17·메타데이터 경우의 수 7/7로 확인했다(포트 45103, 챌린지 1회용,
`AsideSessionToken` 300초). devtools 다운로드 대리자는 상위와의 차이 두 가지(폴더 자동 생성,
디스크 이름만 GUID·표시 이름은 응답에서 뽑은 이름)를 넣고 실물로 확인했다. 825.1 문자열표 7789번
`Import data from another browser`(상위의 "Import bookmarks and settings"를 Aside가 바꾼 것)를
`IDS_SETTINGS_IMPORT_SETTINGS_TITLE`에 되돌렸다 — 자리는 7744·7786 두 기준점으로 못박았다.
한 번도 컴파일된 적 없던 테스트 3파일을 타깃에 물려 돌렸다(엔진 153/153, 나머지 28건 통과).

## (17) G6 정체 미상·겉만·덜 만듦 + 추가 후보 + 이관 복원 (2026-09-06, patch 041-G6)

담당 15개(패치 지도 7군데 + 옛 버전 짝 비교 추가 후보 6개 + G2·G4 이관 2건)를
**12개 재현 완료 / 3개 불가(정체 미상)** 로 닫았다. 상세는 `campaign/G6-RESULT.md`.

**겉만 재현이 정확히 무엇이었는지 잰 것이 이 절의 핵심.** 확장 API 구간(`0x048f2710`)은
`re-tools/aside-run-analysis.json`의 원본 함수 63개와 우리 소스를 문자열 단위로 대조했다 —
이름은 63/63 다 있었고, 문자열은 49개가 완전 일치, 8군데가 진짜로 비어 있었다.
원본 역어셈블로 하나씩 채웠다: `queryAutocomplete`의 `cursorPosition`,
`openAutocompleteMatch`의 `areMatchesShowing`·`viaKeyboard`(꼬리가
`SearchboxHandler::OpenAutocompleteMatch`와 **서명이 같은 9인자 호출**이라는 것이 근거),
`activateKeyword`의 `isMouseEvent`(원본도 읽고 버린다 — 꼬리 호출이 3인자),
`onNavigationLikely`(문자열 `"mouseDown"`/`"upOrDownArrowButton"`/`"touchDown"`을 1·2·3으로 접는
비교가 그대로 보여서 `SearchPrefetchService`·`SearchPreloadService` 두 호출까지 이식),
`addFileContext`의 `imageDataUrl`·`isDeletable`·`selectionTimeMs`,
`startImport`의 `chatgpt-atlas` 별칭.

**두 번째 `searchbox.mojom.Page` 연결(G2 이관, `0x0474d900`)의 속을 채웠다.** 수신기의
Page 메서드 22개 중 하나만 구현돼 있었는데, 확장 스키마에는 그 메서드에 1:1 대응하는 이벤트가
이미 22개 선언돼 있었다 — 계약만 있고 보내는 쪽이 없던 상태다. 대응 이벤트가 있는 16개를 전부 이었고,
미러로 들어온 사본은 `source: "searchbox"`로 세션 자신의 결과와 구분된다.

**툴바 접기 호버는 타이머가 하나 모자랐다.** 기존 100 ms 감시 타이머
(`StartToolbarCollapseButtonHoverMonitorTimer`) 옆에 원본은 500 ms 종료 타이머
(`StartToolbarCollapseButtonHoverExitTimer`, `0x4cc8e00`, 지연 `0x7a120` µs)를 하나 더 건다.
그것이 없어 포인터가 띠와 접기 버튼 사이 틈을 지나면 미리보기가 닫혔다. 넣고 화면으로 확인했다 —
포인터가 나간 직후 캡처는 미리보기가 그대로(픽셀 평균까지 동일), 2초 뒤 캡처는 닫혀 있다.

**정체 미상 5군데는 1군데를 밝히고 1군데를 반쯤 좁혔다.** 옛 근거는 "문자열 참조 없음"뿐이었는데,
소스 경로 참조 15,872자리로 구간 앞뒤를 괄호치고, 언와인드 블록 경계에서 정확히 디스어셈블해
호출 대상을 소스로 풀고, 같은 앵커의 CFT 자리 수를 세는 세 방법을 더 썼다.
`0x04c65910`(18,336 B)은 `horizontal_tab_strip_region_view.cc`의 포크가 늘린 무리 — 그 기능은 이미
`aside_pinned_entries_view.*`로 들어가 있어 새로 만들 것이 없다. `0x0d145880`은
`ui/views/extensions/…`와 `find_bar_host.cc` 사이까지 좁혔다. 나머지 셋은 불가다.
**근본 이유는 RTTI가 없다는 것** — 크로미움은 `-fno-rtti`로 빌드돼서, __DATA_CONST의 체인드 픽스업을
풀어 vtable을 찾아도 타입 이름이 없다. 다음 한 수는 같은 리비전을 맥 x86_64로 직접 빌드해
오브젝트 배치를 대조하는 것이고, 이 트리에서 맥 빌드를 못 돌려 이번 회차에는 못 했다.

덤으로 원본에만 있는 문자열 13,368개에서 클래스 이름꼴 88개를 뽑아 트리와 대조했고 **전부 있다** —
`ProfileIndicatorIconButton`·`ProfileIndicatorIconPickerPanel`(프로필 지시 아이콘),
`ScheduleTargetExtensionBodyBackgroundProbe`(확장 페이지 배경색), `HorizontalPinnedTabEntriesView`
포함. 이름 있는 UI 클래스는 남은 것이 없다는 뜻이다.

## (18) G7 — 원본 색 이름표 66개와 그룹 밖 잔여 결함

**원본 팔레트를 통째로 되찾았다.** G3가 색 이름표(x86_64 `0x0e60f2d8`, 623개, 배열 순서 =
`ui::ColorId`)에서 `kColorAside*` 66개가 있다는 것까지 밝혔지만 값은 몰랐다. 이번에 믹서 함수
자체를 찾았다: `__text`에서 214~279가 전부 든 4 KB 창을 훑어 `0x035f9240`을 얻었고,
그 안의 `mov esi,<색번호> ; call ColorMixer::operator[]` 66자리를 순서대로 읽었다.
두 번째 인자가 "다크인가"라는 것은 부르는 쪽 두 자리가 `cmp [rsi],1 ; sete`로 만든다는 데서
확정했다. 레시피는 전부 항이 하나다 — **알파 혼합도 대비 보정도 없다.** 58개는 리터럴 SkColor,
8개는 다른 Aside 색의 별칭. 라이트/다크는 `cmovne` 한 쌍으로 갈린다. **66/66 값 확보, 미확인 0.**

트리에는 상위 색 번호를 하나도 밀지 않는 쪽으로 넣었다. 원본은 `ui/color/color_id.h` 한가운데에
끼워 넣었지만, 우리는 `chrome_color_id.h`에 `ASIDE_COLOR_IDS`를 두고 크롬 구간 뒤에 붙인 뒤
`chrome/browser/ui/color/aside_color_mixer.{h,cc}`를 상위 믹서와 같은 꼴로 새로 만들었다.

**근사치 16자리를 원본 이름표로 바꿨다.** 증거 등급을 붙여서만 바꿨다 — 원본의 그 함수를 직접
읽은 것(화면 공유 선택기, 상단 로딩바, 탭 전환기)과, 원본 구간에 그 색만 있는 것(업데이트 배지,
작업 상태점, 북마크 섹션)이다. 근거가 없는 다섯 자리는 **바꾸지 않고 남겼다.**
상단 로딩바는 색만이 아니라 구조도 틀렸었다 — 원본은 바탕 전체를
`kColorAsideControlSubtleBackground`로 채우고 그 위에 진행분을
`kColorAsideControlProminentBackground`로 채운다(`FillRect` 두 번, 안티에일리어싱 없음).

**가로 탭 스트립 고정 칩이 안 보이던 진짜 원인은 배치가 아니라 z 순서 목록이었다.**
`HorizontalTabStripRegionView::GetChildrenInZOrder()`가 그릴 자식을 손으로 나열하는데 칩 뷰가
그 목록에 없었다. 크로미움은 이 목록으로 그리기와 히트 테스트를 둘 다 하므로
"배치에는 들어가서 폭은 차지하는데 그려지지도 잡히지도 않는다"가 한꺼번에 설명된다.
목록 맨 앞에 넣자 칩이 그려지고 도구 설명도 뜬다.

**프로필 발치가 뜨던 것은 남는 높이를 발치 *아래* 칸이 먹고 있었기 때문이다.** 발치 앞에 빈 칸을
넣어 flex 순서 1로 남는 높이를 먹게 하고 바닥 버튼 칸을 순서 2로 내렸다. 빈 칸의 기본 크기를
0으로 두면 아무 일도 안 일어난다 — `flex_layout.cc`의 `FilterZeroSizeChildreIfNeeded`가 기본 크기
0인 자식을 주 배분 패스에서 빼기 때문이라, 1×1 DIP를 줬다.

**정체 미상 구간은 vtable의 *이웃 칸*으로 한 군데를 더 좁혔다.** 구간을 가리키는 `__DATA_CONST`
슬롯 둘레의 다른 포인터를 소스 경로로 귀속시키면, 같은 번역 단위에 붙은 이웃 vtable의 주인이
나온다. `0x0d145880`은 이웃이 `extensions_request_access_button.cc` 207 ·
`extensions_toolbar_button.h` 159로 압도적이라 **확장 툴바 버튼 계열**로 확정했다(G6가 남긴
"확장 툴바냐 찾기 막대냐"의 애매함이 풀렸다). `0x047c51f0`은 자동 PiP 계통으로 좁혔고,
G6의 "템플릿 인스턴스화 덩어리" 가설은 약해졌다. 나머지 둘은 그대로 불가다. 이름은 넷 다 못 얻는다 —
원본은 심볼도 벗겨져 있고(`llvm-nm`이 3개만 낸다) RTTI도 없다.

## (19) 라이브 확인 — 호스트·서비스를 올려서 본 것 (2026-09-06, patch 041-LIVE)

앞선 일곱 그룹은 "Aside 확장을 올리면 라이브 데몬에 붙는다"는 규칙 때문에 11군데를 **코드 근거로만**
끝내고 "라이브 확인 필요"로 남겼다. 이번에 호스트·서비스를 실제로 올려 그 11군데를 봤다.
결과 문서: `campaign/LIVE-RESULT.md`.

**라이브 확인은 도장 찍기가 아니었다.** 코드 근거로 "재현 완료"였던 세 항목이 화면에서 틀렸고,
그중 하나는 기능이 통째로 한 번도 안 돌고 있었다. 셋 다 코드를 읽어서는 보이지 않는 종류다.

**`AsideAiTabsViewport`는 부를 사람이 없었다.** 숨은 에이전트 탭에 뷰포트 크기를 주고
`Emulation.setDeviceMetricsOverride`를 보내는 코드는 G2가 원본대로 옮겨 놨는데,
그 갱신 함수 `UpdateAiTabsViewport()`를 부르는 자리가 `MultiContentsView` 안의 세 곳뿐이고
**전부 분할 보기 경로**다. 보통의 활성 탭 전환은 `browser_view.cc:2098`에서
`GetActiveContentsView()->SetWebContents()`로 `ContentsWebView`를 직접 부르며 `MultiContentsView`를
건너뛴다. 확장이 그룹에 탭만 넣는 경우도 계기가 없다. 그래서 CDP로 모든 탭의 `screen`을 읽으면
전부 실제 화면 크기였다. `MultiContentsView`를 `TabStripModelObserver`로 만들어 스트립·그룹 변화에서
부르게 고쳤고(공유 파일은 안 건드렸다), 그 뒤 **숨은 에이전트 탭만** `screen 1039x753`으로 바뀐다.

**뷰 프레임워크가 지정한 색을 뒤에서 덮는다.** 에이전트 탭 개수 배지의 숫자만 회갈색으로 바랬는데,
소스에는 제목과 같은 `foreground_color`를 넣는 줄이 분명히 있고 실제로 실행된다.
`views::Label`의 자동 가독성 보정이 "위젯 배경은 밝다"고 가정하고 흰 글자를 회색 `(118,118,120)`으로
낮추고 있었다. 형제인 제목 라벨은 **바로 그 이유로** 생성자에서 그 보정을 끈다 — 배지 라벨만 안 껐다.
한 줄 추가로 `(255,255,255)`가 됐다.

**상위 헬퍼의 "초기화"가 정반대 정책을 켠다.** 미니팝업 창은 크기가 맞는데 내용이 왼쪽 위 200x120에만
그려졌다. `ExtensionViewViews::Init()`이 팝업 호스트에 대해 하는 일은 오직 하나 —
`EnableSizingFromWebContents(min, max)`, 즉 "페이지 내용이 뷰 크기를 정한다"로 뒤집는 것이다.
미니팝업은 `asideMiniPopup.setState/setSize`가 창 크기를 정하는 고정 크기 창이라 정반대이고,
페이지가 스스로 크기를 안 정하니 최소값 200x120에 눌러앉았다. `Init()`을 안 부르면 이미 걸린
`FillLayout`이 채운다.

**팔레트는 픽셀로 검산했다.** 탭 전환기 판을 파란 페이지 위에 띄워 합성색에서 알파를 역산하니
**0.719**, 되찾은 값 `0xB8/255 = 0.7216`과 맞는다. 선택 항목은 판 위에서 `(231,231,231)`,
`0x140A0A0A`의 계산값 231.2와 맞는다. G7이 바이너리에서 읽은 값이 화면에서 재현된다.

**절차서에 없던 걸림돌**: WSL이 `/tmp/.X11-unix`를 읽기 전용 tmpfs로 걸어 둬서 `Xvfb :99`가
소켓을 못 만든다(프로세스는 살아 있지만 듣는 구멍이 0개). `sudo mount -o remount,rw /tmp/.X11-unix &&
sudo chmod 1777 /tmp/.X11-unix` 먼저 해야 한다.

**확인 방법에도 함정이 있다**: 확장 페이지 배경색 측정은 CDP `json/activate`로는 안 돈다 —
콘텐츠 교체가 안 일어나 `ContentsWebView::SetWebContents`가 안 불린다. 세로 띠를 진짜로 클릭해야 한다.
`FloatingTabDragView`는 G2의 예측대로 X11 합성 드래그로는 원리상 못 본다 — 포인터가 띠를 벗어나는
순간 탭이 새 창으로 떨어져 나가 분할 드롭 타깃이 겨냥되지 않는다(실물로 확인).
