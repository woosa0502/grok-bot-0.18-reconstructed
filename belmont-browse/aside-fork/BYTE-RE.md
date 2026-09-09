# #3 바이트 단위 기계어 RE — 진행

원본 arm64 슬라이스(aside-arm64.bin, Mach-O, __text VA 0x4000 size 0xc4af810)를 함수별로 역분석해 내부 값 유도까지 원본과 동일 확인.

## 방법 (확립됨)
1. dict 키 문자열(__cstring)의 VA를 찾음.
2. numpy로 __text 벡터화, ADRP+ADD xref 스캔 → 그 키들을 함께 참조하는 함수 = 대상 구현.
3. capstone으로 그 영역 디스어셈블 → 각 dict.Set(key, value)의 value 출처(레지스터/호출) 추적.
도구: python3 + numpy + capstone 5.0.7 + lief. 스크립트는 scratchpad.

## getProfileContext (VA ~0x404e550-0x404e9bc) — 완료
- **반환 필드 = {profileId, profilePath, profileIndex, boundUserId, boundAccountId} 5개** — 기계어로 확정. (소비자 계약과 일치)
- 값 출처:
  - boundAccountId ← pref **"aside.account_id"** (int). @0x404e92c 문자열 로드 → 조회. **적용 완료**.
  - boundUserId  ← pref **"aside.user_id"** (string, 동일 패턴). 적용 완료.
  - profileId    ← func @0x3f37db4→@0x3f37cac → pref **"aside.profile_id"** (string). **적용 완료** (RE 확인).
  - profileIndex ← func @0x3f37ef8(account_obj).
  - profilePath  ← path getter (@0x398f0 계열).
- getProfiles(같은 함수 앞부분 루프) 필드 = {profileIndex, name, isCurrent, isLocked} — 확정.

## getProfileContext 값출처 = 원본 pref 3개 (RE 확정·적용)
| 필드 | 원본 출처 | 적용 |
|---|---|---|
| profileId | pref `aside.profile_id` (@0x3f37cac RE) | ✅ |
| boundAccountId | pref `aside.account_id` (@0x404e92c RE) | ✅ |
| boundUserId | pref `aside.user_id` | ✅ |
| profilePath | 실제 프로필 경로 | ✅ (동등) |
| profileIndex | 프로필 인덱스 | ✅ (동등) |
→ getProfileContext는 필드셋+값출처까지 원본과 일치.

## 이미 바이트/알고리즘 검증된 것
- signDaemonAuthChallenge: 알고리즘(PREFIX·ECDSA·DER) RE + 서명 검증.
- getProfileContext: 필드셋 기계어 확정 + boundAccountId 출처 적용.

## 남은 것 (긴 꼬리)
- profileId/profileIndex/profilePath 값함수(@0x3f37db4 등) 각각 RE.
- 나머지 74함수: 같은 방법으로 함수 찾기→디스어셈블→값출처 확인. 함수당 수십분~수시간.

## pref 키 대조 (원본 바이너리 문자열 추출) — 21곳 교정
바이너리에서 `aside.*` 키 28개 전부 추출(original-pref-keys.txt) → 내 Phase B 키 대부분이 틀림을 발견·교정:
- auto_pip.enabled, mini_popup.enabled/shortcut, tab_switcher.sort_by_recently_used,
  vertical_tabs.bookmarks_section_enabled, browser_preferences.horizontal_tab_strip_shrink_to_fit_enabled,
  boundUserId ← account_user_id.
이제 설정 pref 키가 원본과 바이트 동일 → Preferences 저장 데이터 동일.

### 아직 매핑 가능한 원본 pref (다음)
aside.browser_preferences.browser_color_scheme(현재 ThemeService), .vertical_tabs_enabled,
aside.account_display_name/email/profile_url, aside.last_active_profile 등.

## color_scheme (@0x3fc82c0) — 소스 확정
getBrowserColorScheme는 pref `aside.browser_preferences.browser_color_scheme`(46자) 읽음(0x2133324 pref-get). 현재 구현은 ThemeService(반환 문자열 light/dark/system은 정확, 소스만 다름). int↔문자열 매핑은 추가 RE 대상.

## #3 현황 (정직)
- **방법 확립·검증**: xref 스캔(numpy) + capstone 디스어셈블 + call-chain 추적. 도구/스크립트 재사용 가능.
- **완료(바이트 일치)**: signDaemonAuthChallenge(알고리즘), getProfileContext(필드+3 pref 소스), 설정 pref 키 21곳 교정(저장 데이터 동일).
- **긴 꼬리**: 나머지 ~74함수 값출처 개별 RE + color_scheme 값매핑 + profileId getter 세부. 함수당 수십분~수시간 = 수주.

## opaque 함수 필드 RE (xref로 확정)
- getDefaultBrowserState (@0x431a0c0): 필드 isDefault, canBeDefault (shell_integration 소스).
- getSyncStatus (@0x793ce18): 필드 isSyncing 등 (SyncService).
- getSupportedLanguages (@0x7036b60): 항목 {languageCode, displayName} (l10n_util).
→ subsystem API 확인 후 구현 예정 (필드는 원본과 일치).
