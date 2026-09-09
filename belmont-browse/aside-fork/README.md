# Aside 크로미움 포크 — 재현 작업

> **2026-09-07 실제 사용 기반 개선의 현재 판정**: [인수인계](usecases/PARITY-IMPROVEMENT-2026-09-07.md). 팝업·지식 경로·숫자 입력·local websearch를 수정하고 실제 UI로 재검증했다. 마지막 쇼핑 과제는 **PARTIAL**이며 전체 제품 동일성은 미검증이다. 아래 과거 복원율은 이번 실제 작업의 성공률이나 전체 동일성 수치로 사용하지 않는다.

> **2026-09-06 복원 작업 최종 (여기부터 읽을 것)**: 한 장 표 `usecases/RESTORATION-MAP-2026-09-06.md`(76군데 중 64군데 닫힘, 94.43%) · 라이브 확인 실행서 `usecases/LIVE-CHECK-2026-09-06.md`(10건) · 전체 패치 `patches/042-full-fork-2026-09-06.patch`(548파일, `Browser.pdl` 1개 누락 — 지도 §7-8) · 인수인계 `HANDOFF-2026-09-05.md` §7차 세션(2026-09-06) · 그룹 결과 `campaign/G1-RESULT.md`~`G7-RESULT.md`.

> 2026-09-06 개선 후보의 현재 판정은 저장소 루트 `REMEDIATION_HANDOFF_2026-09-06.md`와 `data/artifacts/parity-remediation-20260906/REPORT.md`를 따른다. 패치 041–044, 격리 Chromium 빌드, 네이티브 smoke 및 지연 cosmetic 검증이 추가됐다. 아래 날짜별 완료/동등성 문구는 당시 기록이며, 이번 후보의 전체 제품 동등성이나 현재 실행본 반영을 뜻하지 않는다.

> 원본 성능 기준표: `usecases/PARITY-CHECKLIST.md`(바로 시킬 지시문) · 근거 `usecases/USE-CASES-2026-09-05.md`
> **다음 세션은 `HANDOFF-2026-09-05.md`부터 읽을 것** — 남은 차이(A1~A9)·미구현 기능(B1~B7)·실행 절차·함정 정리.


원본 Aside 브라우저를 근접이 아니라 **동일하게** 재현하기 위해 크로미움을 직접 포크·빌드한다.

## 환경
- 소스: `~/chromium/src` (Chromium **151.0.7922.171**, 원본과 동일. 태그 commit `cc5584af0df9786f00efdb71f666c6664f836c2d`)
- 빌드 out: `~/chromium/out/aside` (args: `is_official_build=false, is_component_build=false, proprietary_codecs=true, ffmpeg_branding="Chrome", symbol_level=1`)
- 전체 빌드: `~/chromium/build.sh` (약 3시간, `third_party/ninja/ninja -C out/aside chrome -j8`. depot_tools autoninja 는 python 부트스트랩 문제로 쓰지 말 것)
- 증분 빌드: `~/chromium/build-incr.sh` (**패치 1건당 약 30초~수분**)
- 결과 실행파일: `~/chromium/src/out/aside/chrome` (1.7G)

## 검증된 패치 패턴 (Aside 비공개 권한 1건당 4~5곳)
원본은 비공개 권한을 확장 manifest에 직접 선언하고, **신뢰 확장 ID allowlist**로 제한한다. 재현 시 건드리는 곳:
1. `extensions/common/mojom/api_permission_id.mojom` — enum 값 추가
2. `chrome/common/extensions/permissions/chrome_api_permissions.cc` — `{APIPermissionID::kX, "at.studio..."}` **플래그 없이** (kFlagInternal 금지 — 붙이면 manifest 선언이 무시됨)
3. `chrome/common/extensions/api/_permission_features.json` — `"at.studio...": {channel:stable, extension_types:[extension], allowlist:[<확장ID의 SHA1대문자>]}`
4. (게이트가 있으면) 해당 지점에서 `HasAPIPermission(kX)` 우회 추가 — 예: tab_capture 의 제스처 게이트
5. (네임스페이스 API면) json 스키마 + `_api_features.json` allowlist + `browser/extensions/api/<name>/` 구현 + BUILD.gn

allowlist 해시: `python3 -c "import hashlib;print(hashlib.sha1('<extid>'.encode()).hexdigest().upper())"`

## 진행 상황
| 권한/기능 | 상태 |
|---|---|
| 비공개 권한 **7개 전부** (capture-tab, account, browser-import, notification, omnibox, pref-get-set, launch-extension) | **✅ 권한 계층 검증 완료** (7개 선언 확장 경고 없이 로드, capture 실동작) |
| capture-tab 게이트 우회 (제스처 없이 탭 캡처) | **✅ 실제 동작 검증** (양성+음성) |
| **asideAccount** 네임스페이스 (getProfiles/getProfileContext/signDaemonAuthChallenge) | **✅ 배선+구현+실동작 검증** (getProfiles 진짜 프로필 반환) |
| **나머지 네임스페이스 5종** (notification·browserImport·miniPopup·preferences·omnibox) | **✅ 표면 완성**: 74함수 배선+빌드+호출 검증. 동작은 골격(placeholder), 실동작은 함수별 채우는 중 |

## 진행 요약 (2026-09-04)
- **비공개 API 전체 표면 완성**: 6 네임스페이스 **77함수** 모두 포크에 존재·호출됨, 신뢰 확장에만 노출
- **실동작 구현(13함수)**: asideAccount(getProfiles·getProfileContext) / asideBrowserPreferences(getBrowserVersion·get·setDefaultZoom·get·setBrowserColorScheme·getLanguageSettings·setPreferredLanguages·get·setSearchEngines/DefaultSearchEngine·setSpellCheckEnabled) / asideNotification(revokePermission) — 실제 크로미움 subsystem(zoom·theme·prefs·TemplateURLService·content-settings)에서 진짜 데이터. 나머지 64개 = placeholder
- 생성기 `gen_ns.py` — 스키마 1개 주면 배선+골격 자동 생성 (검증된 recipe)
- 남은 일: (1) 함수별 실제 동작 구현 (prefs·notification 등 표준 크로미움 매핑 가능한 것부터) (2) 이벤트 20개 발화 (3) Aside 고유 UI(미니팝업 창·탭 스위처 등 — API가 제어하는 실체)

## 네임스페이스 API 배선 recipe (검증됨 — asideAccount 기준)
새 네임스페이스 1개당 건드리는 곳:
1. `chrome/common/extensions/api/<name>.json` — 스키마. **반드시 배열 `[{...}]`로 감쌀 것.** 타입 id/$ref는 **접두사 없이**(같은 네임스페이스 내). JsonObject(additionalProperties any)는 `base::DictValue`로 다룸
2. `chrome/common/extensions/api/api_sources.gni` — `schema_sources_`에 알파벳순 추가
3. `chrome/common/extensions/api/_api_features.json` — `"<ns>": {channel, contexts:[privileged_extension], extension_types:[extension], dependencies:[permission:at.studio...], allowlist:[해시]}` **단일 객체(리스트 아님)**
4. `extensions/browser/extension_function_histogram_value.h` — ENUM_BOUNDARY 앞에 함수당 enum(끝번호+1). enums.xml 동기화는 presubmit용이라 **빌드엔 불필요**(생략함)
5. `chrome/browser/extensions/api/<name>/<name>_api.{h,cc}` — 클래스명 `<Ns><Func>Function` (자동 등록됨, 수동 등록 불필요). C++ 타입: `base::DictValue`(구 base::Value::Dict), 반환 `RespondNow(WithArguments(std::move(dict)))` 또는 `ArgumentList(...Results::Create(...))`
6. `chrome/browser/extensions/api/<name>/BUILD.gn` + `chrome/browser/extensions/api/BUILD.gn` public_deps에 추가
7. 스키마/BUILD 변경 후 `./buildtools/linux64/gn gen out/aside` 먼저, 그다음 증분 빌드

빌드 시행착오에서 잡은 것: json은 배열, 타입 ref 접두사 제거, features는 단일객체, `base::Value::Dict`→`base::DictValue`(151에서 개명).

## 검증 방법 (실제 동작)
```
bash test/run-capture-test.sh <포트> ""            # 시나리오 A: 순수 권한 경로 → OK (제스처 없이 스트림ID)
bash test/run-capture-test.sh <포트> <확장ID>      # 시나리오 B: allowlist 플래그 → OK (기준)
# 음성: key 없앤 확장 → FAIL (allowlist에 없으니 막힘) — "신뢰 확장에만" 확인
```
확장 ID `fjdhphbdlfjogobdofoaagnlnkoibdge` (원본 Aside 확장 key 기반), 해시 `4A76B267556C299D3719FF535FC6011CF9674AC0`.

## 되돌리기/재적용
- 패치: `patches/001-*.patch` — `git -C ~/chromium/src apply patches/001-*.patch`
- 원본 확장: `../vendor/aside-ext/AsideAgentManager` (manifest 에 7개 at.studio 권한 선언 원본 그대로)


## 데몬 인증 (Phase D — 검증 완료)
`chrome.asideAccount.signDaemonAuthChallenge(challenge)` 실제 P-256 서명 구현. **확장이 데몬에 붙는 핵심 함수** (없으면 확장이 에러 던짐).
- 계약: 입력 challenge(base64) → `"Aside Daemon Auth v1\0" || challenge_bytes` → ECDSA-SHA256 → DER → base64 → `{signedChallenge}`
- 키: `ASIDE_INSTALLATION_KEY` 환경변수(PKCS#8 DER 파일 경로), 없으면 `<profile>/AsideInstallationKey`. 이 키를 데몬이 신뢰함.
- 키 파일 만들기: `node make-installation-key.mjs .state/installation-keys.json <out>` (JWK→PKCS#8 DER)
- **검증**: 포크가 서명한 것을 공개키로 verify → 통과. 데몬이 받아들임 = 인증 성공.
- 포크 실행 시: `ASIDE_INSTALLATION_KEY=/path/to/key chrome ...` 로 띄우면 네이티브로 데몬 인증됨.

### "돌리는 데 문제 없나?" 답
1. 브라우저 실행 ✅  2. 확장 로드(크래시 없음) ✅  3. **데몬 인증·연결 ✅** — 봇의 핵심 경로가 실제로 작동. 나머지(고유설정 B·UI C)는 있으면 좋은 것이지 실행 조건 아님.

## Phase B — Aside 고유 설정 (검증 완료)
스톡 크로미움에 없는 Aside 설정을 실제 pref로 등록. `chrome/browser/prefs/browser_prefs.cc`의 RegisterProfilePrefs에 8개 등록(`aside.*`), get/set 16함수가 `profile->GetPrefs()`로 연결.
- browserPreferences: tabStyle·horizontalTabShrink·tabSwitcherSort·autoPip·verticalTabsBookmarks·keepTasksRunning
- miniPopup: enabled·shortcut
- **검증**: 설정→조회 정확, `Default/Preferences`에 `aside:{...}`로 영구 저장 확인.
- 주의: pref 키 문자열은 browser_prefs.cc 등록과 aside_* API 구현에서 동일해야 함(공유 헤더 없이 리터럴 일치).

## 실동작 누적 (~30함수)
A(표준매핑 13) + B(고유설정 16) + D(데몬서명 1). 남은 placeholder: 주로 C(옴니박스 29+19ev·미니팝업 UI·탭스위처 — Aside 고유 UI 실체 필요), import subsystem, sync/defaultBrowser/dock 등.

## 통합 테스트 통과 (2026-09-04) — "돌아간다" 확정
포크 + **원본 Aside 확장(비시밍)** + **실제 데몬(21420)** 을 함께 띄워 검증:
- 원본 AsideAgentManager가 포크에서 로드(권한 전부 인식) ✓
- 데몬 ↔ 확장 지속 연결 12개 (인증 성공의 증거) ✓
- 원본 확장 SW 안에서 signDaemonAuthChallenge → 실제 서명, getProfiles → 실제 프로필 ✓
- 세부·재현: test/integration/README.md
- belmont-browse 변경: cdp-relay.mjs·chrome.mjs에 `BELMONT_BROWSE_NO_SANDBOX` env 게이트(WSL 포크용) 추가.

## 최종 상태 (2026-09-04) — 기능 재현 완료
확장이 실제 쓰는 15함수 전부 실동작 + 미니팝업 네이티브 창(프레임 없음) 작동 + 통합 테스트 통과.
- 패치 12개, overlay, WIP, 문서. 트리 클린 빌드.
- 미니팝업 창: 이 리팩터 트리의 API(ForEachCurrentBrowserWindowInterface, FrameView/CreateFrameView 개명, WidgetDelegate)를 역분석해 완성.

## 남은 로드맵 (각각 큰 별도 작업)
1. 미니팝업 다듬기: 전역 단축키 트리거(X11/Ozone 핫키) — popup은 이미 프로그램적으로 뜸.
2. asideOmnibox(29함수+19이벤트)·탭 스위처: 브라우저 옴니박스 통합. 확장 SW가 호출 안 하는(사용자 주소창 입력이 트리거) 대형 기능. 표면은 존재, 실동작 구현은 수주급.
3. 77함수 바이트 단위 기계어 RE: opaque 내부값까지 원본 바이트 동일. 차등검증 방법 확립(3함수 완료), 나머지는 함수별 arm64 역분석 — 가장 큰 영역.
