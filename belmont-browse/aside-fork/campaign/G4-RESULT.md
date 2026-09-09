# G4-RESULT — 광고차단 잔여·가져오기·미니팝업·보안 원격 디버깅·devtools (2026-09-06)

담당: 구간 5개(0x048c1ab0 / 0x043eda40 / 0x0488bd30 / 0x0498f6c0 / 0x046f6cb0) + 코드로 확인된 결함 7건(a~g).
트리 `~/chromium/src`, 브랜치 `aside-remediation-20260906`. 커밋·stash·checkout·reset 없음.
이번 회차는 **이어받기**다. 이전 G4 담당이 재부팅으로 죽기 전(09-06 11:32)까지 코드를 거의 다 넣어 두었고
결과 문서·검증·패치를 남기지 못했다. 그래서 이 문서는 (1) 넘겨받은 것의 실물 확인, (2) 확인 과정에서
드러난 **진짜 결함 1건의 원인 규명과 수정**, (3) 빠져 있던 배선·문자열 보완으로 이루어져 있다.

## 한 줄 결론

**5군데 전부 + 결함 7건 전부 처리. "불가"는 pq_v1 서명 알맹이 하나(맥 키체인 전용)뿐이고, 그것도
스킴 이름·거절 경로·오류 문구까지는 이식해 실물로 확인했다.**
확인 도중 **광고차단 코스메틱 주입이 실제 브라우징에서 통째로 죽는 버그**를 찾아 고쳤다(아래 §2).

| 항목 | 값 |
|---|---|
| 마지막 chrome 빌드 | 2026-09-06 14:14:21 시작 → 14:14:59 끝 (`/tmp/aside-build-G4-fix1.log`), `out/aside/chrome` mtime 14:14:59 |
| 그 빌드 `grep -c FAILED` | 0 |
| 검사 바이너리 빌드 | 2026-09-06 14:45 (`/tmp/aside-build-G4-tests.log`), FAILED 0 |
| 마지막 검사 빌드 | 2026-09-06 14:46:29 → 14:46:45 `ninja -C out/aside chrome` = **no work to do**, FAILED 0 (`/tmp/aside-build-G4-final.log`); 그 시점 `out/aside/chrome` mtime 14:45:25 (G3의 마지막 링크가 내 변경을 포함한 채 최신) |
| 광고차단 종단 검사 | **29/29** (`test/g4/adblock/result-G4-2026-09-06.json`) — 고치기 전 26/29 |
| 보안 CDP 악수 | **17/17** (`test/g4/secure-cdp-handshake.py`) |
| 설치 메타데이터 경우의 수 | **7/7** (`test/g4/secure-cdp-metadata.sh`, pq_v1 거절 포함) |
| C++ 테스트 바이너리 5개 | 엔진 **153/153** 어서션, 나머지 5+9+7+7 = **28건** 전부 통과 |
| 렌더러 코스메틱 스크립트 단위 검사 | 5/5 (`test/adblock/remediation/cosmetic-wakeup.test.mjs`) |
| 캡처 | `ui-shots/G4-adblock-internals.png`, `G4-adblock-page.png`, `G4-adblock-blockpage.png`, `G4-import-webui.png`, `G4-settings-import.png` |

독립 크롬 1개만 썼다: 화면 `:114`, `--user-data-dir=/tmp/aside-ui-G4`, CDP 9414(보안 CDP 확인 때만 포트 없이 45103).
검사용 http는 18791·18792. 라이브 포트(9333/9340/21420/18777)·화면 `:99`·호스트·서비스·tmux는 건드리지 않았다.

---

## 1. 넘겨받은 상태 표 (먼저 만든 것)

`git -C ~/chromium/src diff cc5584af0d --stat -- <G4 경로>` 와 파일 mtime으로 만든 표다.
"이미 됨"은 코드가 있고 배선까지 되어 있다는 뜻이고, 실물 확인은 이번 회차에서 했다.

| 결함 | 이전 담당이 남긴 것 | 이번 회차 |
|---|---|---|
| (a) `$csp`가 URL 패턴만 키라 도메인 다른 규칙이 덮어씀 | **이미 됨** — CSP 규칙이 별도 지도가 아니라 metadata 색인(`metadata_->Matches`)에 들어가 도메인 조건이 살아 있고, `$badfilter` 동일성 키(`NetworkRuleKey`)가 정규화한 initiator/request 도메인·`csp`·`method`·`important`를 전부 포함 | 실물 확인 (엔진 테스트 + 종단 검사 `$csp: inline script blocked`) |
| (b) 렌더러가 빈 응답 20회 뒤 폴링 중단 | **이미 됨** — 주기 폴링을 없애고 코스메틱 스크립트의 MutationObserver가 `__asideAdBlockPending()`으로 깨우는 방식으로 바꿈(`poll_timer_`는 1회성) | 단위 검사 5/5 + 종단 `late-added .ADBAR hidden` |
| (c) 절차형 숨김 예외 `#@?#`가 무시됨 | **이미 됨** — 전처리기가 `#@?#`를 `#@#`+kProcedural로 접고, `CosmeticResourcesJson`이 도메인 조건까지 본 `procedural_exceptions`로 실제로 뺀다 | 엔진 테스트 2건 + 종단 `procedural :has-text` 2건 |
| (d) 미지의 스크립트 리소스가 빈 JS | **이미 됨** — ubol 원본 자원 40여 개를 `resources/ubol/`에 넣고 `aside_adblock_redirect_resources.h`로 묶었으며, `FindResource`는 모르는 이름에 **널**을 돌려준다(빈 스크립트 금지) | 엔진 테스트 `unknown JavaScript surrogate remains explicitly unavailable`, `Chartbeat surrogate provides its public API` |
| (e) `CancelImport`가 importer에 취소를 안 보냄 / `ImportEnded`가 실패도 성공 처리 | **이미 됨** — `ActiveHosts()`에 host 핸들을 두고 취소 때 `host->Cancel()`을 실제로 부르며, `ImportJob::Ended()`는 선택한 항목이 다 안 끝났으면 실패로 떨어진다 | `aside_native_contracts_tests` 5/5 |
| (f) 계정 API 프로필 번호(저장 순서) ≠ 미니팝업 해석(표시 순서) | **이미 됨** — `aside_account/aside_profile_index.h` 한 곳(`GetAllProfilesAttributes()`)을 두 쪽이 함께 쓴다 | 코드 확인. devtools `Browser.ensureProfile`도 같은 열거를 쓴다(§5) |
| (g) 옴니박스 `AddFileContext`가 이미지 데이터를 버림 / `OpenLensSearch`가 확인만 함 | **이미 됨** — `AddFile`이 바이트를 컨텍스트 저장소에 넣고 토큰을 돌려주며, `OpenLensSearch`는 `DecodeImageIsolated`로 진짜 디코드한 뒤 검색 공급자의 이미지 URL·POST 본문으로 실행 | `aside_omnibox_context_unittests` 7/7, `aside_omnibox_action_unittests` 7/7 |

즉 **결함 7건은 코드가 이미 들어와 있었다.** 이번 회차의 값어치는 "정말 도는가"를 증명한 것과,
증명하다가 나온 아래 버그다.

---

## 2. 확인하다 찾은 진짜 버그 — 코스메틱 주입이 통째로 사라진다

### 증상

종단 검사 첫 실행이 **26/29**. 떨어진 셋이 전부 `127.0.0.1` 호스트 전용 코스메틱이었다.

```
FAIL $generichide: site rule still hides      (site1 이 안 숨음)
FAIL procedural :has-text hides matching item (proc1 이 안 숨음)
FAIL procedural :style applies                (styled 색이 안 바뀜)
```

같은 브라우저에서 `127.0.0.2`의 일반 숨김은 멀쩡히 통과했다(`adoptedStyleSheets`도 1).

### 부검 (기제 수준)

1. 브라우저 쪽은 결백했다. 엔진에 같은 규칙을 넣고 페이로드를 뽑아 보니
   `{"generichide":true,"hideSelectors":[".aside-site-specific"],"proceduralActions":[2개]}` **357 바이트**,
   렌더러 로그의 `resources arrived (357 bytes)`와 정확히 같다.
2. 그 357바이트 페이로드를 붙인 **똑같은 스크립트를 CDP로 같은 격리 세계(Chrome-internal isolated world)에
   직접 넣으면 완벽히 동작한다**(`__asideAdBlock` 생김, 시트 1장, `site1: none`). 스크립트도 결백.
3. 그런데 브라우저가 주입한 뒤에는 그 세계에 `__asideAdBlock`이 **없다**. 예외도 안 뜬다.
   반면 `DidCreateScriptContext`가 심어 두는 `__asideAdBlockPending`은 있다.
4. 로그 순서를 두 호스트에서 비교하니 갈린 지점이 나왔다.

| | 127.0.0.1 (실패) | 127.0.0.2 (성공) |
|---|---|---|
| 로그 | `resources arrived (357 bytes) document_created=0` → `document element, payload_ready=1` → `inject` | `document element, payload_ready=0` → `resources arrived (17137 bytes) document_created=1` → `inject` |
| 주입을 부른 자리 | `DidCreateDocumentElement()` 안 | `OnCosmeticResources()` 안 |

**`DidCreateDocumentElement()` 콜백 안에서 부른 `ExecuteScriptInIsolatedWorld`는 아무 것도 실행하지 않는다.**
예외도, 반환값도, 로그도 없다. 그래서 "페이로드가 문서 요소보다 먼저 도착한 문서"는 코스메틱이 통째로 사라진다.

### 사망 반경

이건 테스트 픽스처만의 문제가 아니다. **엔진이 데워진 뒤(캐시가 있는 평상시)에는 페이로드가 거의 항상
먼저 도착한다.** 즉 실사용에서 요소 숨김이 대부분의 문서에서 죽어 있었고, 첫 실행처럼 엔진이 늦는
경우에만 우연히 살아났다. 09-05 기준선이 29/29였던 것은 그때 붙었던 라이브 브라우저가 큰 구독을
막 컴파일하던 상태여서 늘 "늦게 도착" 쪽이었기 때문이다.

### 고침 (이식 길 2 — 크로미움이 쓰는 자리를 그대로 씀)

크로미움의 확장 content script도 document_start 주입을 `DidCreateDocumentElement`가 아니라
`ContentRendererClient::RunScriptsAtDocumentStart(RenderFrame*)`에서 한다. 같은 자리로 옮겼다.

- `chrome/renderer/aside_adblock/aside_adblock_render_frame_observer.h/.cc`
  - 관찰자가 `content::RenderFrameObserverTracker<AsideAdBlockRenderFrameObserver>`를 함께 상속해
    `Get(render_frame)`으로 찾을 수 있게 함.
  - `RunScriptsAtDocumentStart()` 추가, `scripts_allowed_` 플래그 추가(내비게이션마다 초기화).
  - 주입 조건을 한 곳(`MaybeApplyCosmeticResources()`)으로 모음:
    `payload_ready_ && document_created_ && scripts_allowed_ && !applied_`.
  - `DidCreateDocumentElement()`에서는 더 이상 주입하지 않는다(왜인지 주석으로 남김).
  - 안전망: `DidDispatchDOMContentLoadedEvent()`·`DidFinishLoad()`에서도 `scripts_allowed_`를 세우고
    다시 시도한다. 어떤 이유로 document-start 콜백이 안 와도 숨김 규칙은 결국 들어간다.
- `chrome/renderer/chrome_content_renderer_client.cc`
  - `RunScriptsAtDocumentStart()`에서 확장 호출 **앞에** 광고차단 관찰자를 깨운다(확장 호출 뒤에는
    `render_frame`이 죽어 있을 수 있다는 상위 주석 그대로).

### 재발 방지

- 종단 검사의 위 세 항목이 그대로 회귀 감시다. 고치기 전 26/29 → 고친 뒤 **29/29**. 되돌리면 다시 3개가 깨진다.
  (127.0.0.1 쪽 페이로드가 357바이트로 작아 늘 "먼저 도착" 쪽이 되므로 재현이 안정적이다.)
- 브라우저 쪽 페이로드가 원인이 아님을 못 박기 위해 엔진 테스트에 `CheckCosmeticPayloadForIpHost()`를
  넣었다(IP 호스트 + `$generichide` 예외에서도 호스트 전용 숨김 1개와 절차형 2개가 반드시 나온다).

---

## 3. 구간별 결과

### (1) 0x048c1ab0 — 가져오기: Safari·Firefox·Chromium 프로필 마이그레이터 (173,504 B, "부분")

| | |
|---|---|
| 이식 길 | 2 (상위 크로미움 importer 재사용) + 3 (원본에만 있는 부분) |
| 파일 | `chrome/browser/ui/webui/aside_importer/{chromium_profile_migrator,firefox_cookie_importer,firefox_profile_importer,safari_archive}.{cc,h}`, `BUILD.gn`, `aside_importer_unittest.cc`; `chrome/browser/extensions/api/aside_browser_import/*` |
| 상태 | **재현 완료** |

- 유틸리티 프로세스 경로는 상위 `ExternalProcessImporterHost` / `ImporterList` 를 그대로 쓴다(길 2).
  Chromium 계열 프로필 통째 옮기기, Firefox 쿠키 저장소, Safari 내보내기 ZIP 분류는 원본에만 있어 새로 씀(길 3).
- Safari ZIP은 **이름이 아니라 확장자와 JSON 최상위 키**로 분류한다(원본·상위 파서와 같은 규칙).
  `Bookmarks.html` 같은 고정 이름을 찾으면 진짜 내보내기에서는 아무것도 못 찾는다는 것을 주석으로 남겨 두었다.
- 리눅스 탐지 실물 확인: `chrome://aside-import-data`가 이 기계의 `~/.config/google-chrome`을 찾아
  **Chrome 한 줄과 chrome.svg 아이콘**을 그렸다(`ui-shots/G4-import-webui.png`).
- 취소·실패 상태(결함 e)는 `aside_native_contracts_tests` 5/5로 못 박혀 있다.
- 이번 회차 보완: `aside_importer_unittest.cc`가 **어느 타깃에도 안 물려 있어 한 번도 컴파일된 적이 없었다.**
  물려서 돌리니 이 트리에 없는 `base::Value::Dict`/`::List`를 쓰고 있었고(치유 담당이 본체에서 고친 것과 같은 문제),
  `os_crypt_async::Encryptor` 불완전 타입으로 링크도 안 됐다. 둘 다 고치고 `executable("aside_importer_tests")`로
  실행 가능하게 만들었다 → **9/9 통과**.
- 남은 차이: 이 기계에 Firefox 프로필도 Safari 내보내기도 없어 **실제 데이터 이관은 픽스처 단위 검사까지만**이다
  (`FirefoxCookieReadTest`, `ChromiumProfileMigrationTest.CopiesAndScrubs` 등). 실기기 확인 필요.

### (2) 0x043eda40 — 보안 원격 디버깅 자격증명 / pq_v1 (64,528 B, "미재현")

| | |
|---|---|
| 이식 길 | 3 (파일 키 방식으로 옮겨 씀) + 원본 문자열 그대로 |
| 파일 | `chrome/browser/devtools/secure_remote_debugging_credentials.{cc,h}`, `remote_debugging_server.cc`, `chrome_devtools_manager_delegate.{cc,h}`, `content/browser/devtools/devtools_http_handler.{cc,h}`, `content/public/browser/devtools_agent_host_client.{cc,h}` |
| 상태 | **재현 완료(악수 전체) / 불가(pq_v1 서명 알맹이 — 맥 전용)** |

- `--remote-debugging-port`도 `--remote-debugging-pipe`도 없으면 **localhost:45103**에 항상 켜지는 DevTools
  서버가 뜨고, 그 서버의 모든 요청은 설치 서명 악수를 통과해야 한다. 실물로 확인했다.
- 악수 검사 **17/17**(`test/g4/secure-cdp-handshake.py`):

  | 확인 | 결과 |
  |---|---|
  | 인증 없는 `/json/version` → 401 `Missing or invalid Authorization header.` | PASS |
  | 발견 페이지(`/`)도 401 | PASS |
  | `GET /json/challenge` → `scheme: AsideSecureToken`, 32바이트 난수, 30초 | PASS |
  | 남의 키로 서명 → 403 `Invalid or expired challenge.` | PASS |
  | 설치 키로 서명 → 200, `token_type: AsideSessionToken`, 300초 | PASS |
  | 그 토큰으로 `/json/version`·`/json/list` 통과 | PASS |
  | 가짜 토큰 → 401 | PASS |
  | 챌린지 재사용 → 403 (1회용) | PASS |
  | `/json/auth/session`에 GET → 405 | PASS |

- 설치 메타데이터 경우의 수 **7/7**(`test/g4/secure-cdp-metadata.sh`, 경우마다 브라우저 재시작):
  메타 없음 → p256_v1 기본값으로 통과 / `p256_v1+file` 통과 / **`pq_v1+keychain` 거절** /
  모르는 스킴 거절 / `p256_v1+keychain` 거절 / 스킴 빠짐 거절 / JSON 아님 거절.
- **불가(맥 전용)**: pq_v1은 맥OS 26 ML-DSA 스킴이고 키가 키체인 접근 그룹
  `8CPD4K4TBB.at.studio.AsideBrowser.cryptography`에 들어 있어 리눅스에서는 서명 자체를 만들 수 없다.
  옮길 수 있는 것(스킴 이름 두 개, 키 저장 방식 두 개, 거절 경로, 원본 문구
  `pq_v1 installation signatures require macOS 26 or newer`, `Unsupported installation scheme.`,
  `Installation security is not initialized.` 등)은 전부 옮겼고 위 7/7로 확인했다.
  키는 원본과 같은 파일 키 방식(`$ASIDE_INSTALLATION_KEY` → `<user data dir>/AsideInstallationKey` →
  `.../Default/AsideInstallationKey`, 메타는 `<키 경로>.meta`)을 유지했다.

### (3) 0x0488bd30 — 가져오기 WebUI 자원·인트로 UI (24,528 B, "부분")

| | |
|---|---|
| 이식 길 | **1 (원본 자원 그대로)** |
| 파일 | `chrome/browser/resources/aside_import_data/*`(index.html, app.js, 아이콘 9개, 사파리 안내 png), `chrome/browser/ui/webui/aside_import_data/*` |
| 상태 | **재현 완료** |

- 825.1 패키지 `aside_resources.pak`의 16130–16141을 **바이트 그대로** 가져왔다
  (index.html 14,128 B, app.js 10,789 B가 원본 blob과 크기까지 일치).
- 지도 41번이 남겨 둔 숙제("자산을 pak에 넣어 원본 포장과 맞춘다")도 끝나 있다.
  `generate_grd`+`grit`로 `aside_import_data_resources.pak`을 만들어 리소스 번들에서 서빙한다.
  파일 디렉터리 서빙이 아니다.
- 페이지가 쓰는 메시지 3개(`importFirefoxData`, `showProfilePicker`, `selectSafariExportZipFile`)가 전부 등록돼 있다.
- 실물: `chrome://aside-import-data` 렌더 확인(`ui-shots/G4-import-webui.png`) — 제목 "Aside Importer",
  본문 "Quick import from your browser …", 아이콘이 `icons/chrome.svg`로 pak에서 나온다.
- 이번 회차 보완 — **원본 문자열 하나가 빠져 있었다.** 825.1 문자열표 7789번
  `Import data from another browser`가 트리에 없었다. 자리를 두 개의 독립 기준점으로 못박았다:
  `IDS_SETTINGS_PEOPLE`("You and Aside", 7744)에서 grdp 문서 순서로 45칸,
  `IDS_SETTINGS_MANAGE_GOOGLE_ACCOUNT`(7786)에서 3칸 → `IDS_SETTINGS_IMPORT_SETTINGS_TITLE`.
  상위 크로미움 문구는 "Import bookmarks and settings"이고 Aside가 바꾼 것이다.
  `chrome/app/settings_strings.grdp`에서 교체했고, 돌아가는 브라우저의 `chrome://settings/importData`에서
  실제로 "Import data from another browser"가 그려지는 것을 확인했다(`ui-shots/G4-settings-import.png`).
- 인트로 UI: 이 구간의 `intro_ui.cc`·`images/product-logo.svg`·`webui-refresh-2026` 흔적은 상위 크로미움의
  첫 실행 인트로 그대로이고 이 트리에 이미 있다. Aside가 바꾼 부분은 위 자원·문자열 쪽이다.

### (4) 0x0498f6c0 — mac CommandDispatcher preSendEvent 전역 단축키 경로 (13,760 B, "부분")

| | |
|---|---|
| 이식 길 | 2 (`ui::GlobalAcceleratorListener`) |
| 파일 | `chrome/browser/extensions/api/aside_mini_popup/mini_popup_shortcut.{cc,h}`, `mini_popup_service.cc`, `aside_mini_popup_api.cc` |
| 상태 | **재현 완료(리눅스 대응 경로) / 불가(맥 preSendEvent 그 자체)** |

- 원본이 `CommandDispatcher::preSendEvent`를 후킹하는 이유는 맥의 전역 이벤트 감시가 **자기 앱 창으로 가는
  키는 못 본다**는 점 때문이다. 리눅스에서는 X11 전역 잡기가 루트 창 기준이라 창 안/밖 구분이 없고,
  그래서 별도의 창 안 경로가 필요 없다. 크로미움의 `ui::GlobalAcceleratorListener`(Ozone/X11 구현)를 그대로 쓴다.
- Local State 프리퍼런스 `aside.mini_popup.enabled` / `aside.mini_popup.shortcut`(기본 `Alt+Space`)를 관찰해
  등록·해제하고, 실패 문구는 원본 그대로 `Aside mini popup global shortcut unavailable`(전역 지원 없음),
  `This shortcut is unavailable`(이미 쓰는 조합), `Invalid mini popup shortcut`(파싱 실패).
- 지도 47번의 판단("리눅스 경로로 이미 대체. 더 할 것 없음")과 일치한다.
- **라이브 확인 필요**: 미니팝업 창을 실제로 띄우는 것은 Aside 확장이 있어야 하고, 확장을 로드하면 라이브
  데몬(21420)에 붙어 버려 이번 규칙상 금지다. 단축키 등록·해제·오류 문구는 코드 근거로 남긴다.

### (5) 0x046f6cb0 — devtools 다운로드 관리자 대리자 (5,200 B, "미재현")

| | |
|---|---|
| 이식 길 | 2 (상위 `DevToolsDownloadManagerDelegate` 수정) |
| 파일 | `content/browser/devtools/protocol/devtools_download_manager_delegate.{cc,h}` |
| 상태 | **재현 완료** |

원본과 상위의 차이는 두 가지였고 둘 다 넣었다.

1. 상위의 `ALLOW_AND_NAME`은 블로킹 작업을 건너뛰어 **다운로드 폴더가 없으면 실패**한다.
   포크는 두 동작(`ALLOW`, `ALLOW_AND_NAME`)을 같은 블로킹 경로로 보내 폴더를 먼저 만든다.
2. 상위의 `ALLOW_AND_NAME`은 사용자에게 보이는 이름까지 GUID가 된다.
   포크는 **디스크 파일 이름만 GUID**로 하고 표시 이름은 응답(URL·Content-Disposition·MIME)에서 뽑은 이름을 쓴다.

실물 확인(`test/g4/devtools-download.mjs`): 없는 폴더 `/tmp/aside-ui-G4-dl/fresh/deeper`를 지정하고
`Browser.setDownloadBehavior{behavior:"allowAndName"}` 뒤 파일을 받으면 —

```
dir created by delegate: True
file named by GUID     : ['d5beeee2-70ff-4cf2-8267-c080bdfe3636']
bytes                  : 'col_a,col_b\n1,2\n'
completed              : [{'state': 'completed'}]
chrome://downloads 이름 : "report.csv"
```

디스크는 GUID, 사용자에게 보이는 이름은 `report.csv`. 의도한 그대로다.

---

## 4. 광고차단 종단 검사 29/29 (구간 밖 보강)

`test/adblock/run-adblock-test.sh`는 라이브(9333/18777)용이라 실행 금지 대상이다.
**복사본**을 `test/g4/adblock/`에 만들어 내 크롬(9414)과 http 18791로 돌렸다.

```
cd aside-fork/test/g4/adblock && ./run-adblock-test.sh <출력.json>
```

29/29 전부 통과(결과 `test/g4/adblock/result-G4-2026-09-06.json`). 통과 항목에는 담당 결함이 직접 걸린 것들이 있다.

- (a) `$csp: inline script blocked`
- (c) `procedural :has-text hides matching item` / `leaves sibling` / `:style applies`
- (b) `generic: late-added .ADBAR hidden`, `cosmetic script adopted stylesheet present`
- (d) `$redirect=noopjs: script loads empty`, `$redirect=1x1.gif: 1x1 image`
- 그 외 `$important`, `$generichide`, `/regex/`, `$method`, `$popup`, `$document` 차단 페이지와 "한 번만 계속"

파싱·색인은 이번에 바꾸지 않았으므로 `kCacheVersion`은 이전 담당이 올려 둔 **7** 그대로 둔다
(6 → 7 상향이 이번 복원분에 포함되어 있다).

---

## 5. G6·G3와 겹치는 부분 (표시)

- **옴니박스 제안 UI의 두 번째 `searchbox.mojom.Page` 연결(0x0474d900)**: 주인이 확장 API 구간(0x048f2710, G6)이다.
  G4는 `AddFileContext`/`OpenLensSearch`의 **네이티브 쪽**(컨텍스트 저장, 이미지 디코드, 검색 공급자 실행)만 봤고
  연결 자체는 손대지 않았다.
- **확장 권한 문구 10347–10351**: 다섯 개가 한 식구인데 트리에 하나도 없다
  (`Aside: Read and change omnibox suggestions and search context`, `... browser profile account context`,
  `... browser preferences`, `Aside: Import data from installed browsers`, `... extension toolbar actions`).
  권한 자체는 `chrome_api_permissions.cc`에 다 있고 **경고 문구만** 빠졌다.
  10350이 G4 것이지만 한 식구를 하나만 넣으면 `chrome_permission_message_rules.cc`가 어색해지고
  나머지 넷의 주인이 G6라, **G6에 넘긴다**. 이번 회차에서는 넣지 않았다(의도적 미포함, 이유 명시).
- **`Browser.ensureProfile`**: devtools 쪽에서 프로필 번호를 `GetAllProfilesAttributes()`로 푼다.
  결함 (f)에서 통일한 `aside_account/aside_profile_index.h`와 **같은 열거**지만 헤더를 공유하지는 않는다
  (devtools 타깃이 확장 타깃에 의존하게 만들지 않으려고). 프로필 쪽을 만지는 G3가 열거를 바꾸면 여기도 같이 봐야 한다.

---

## 6. 이번 회차에 내가 바꾼 파일

| 파일 | 왜 |
|---|---|
| `chrome/renderer/aside_adblock/aside_adblock_render_frame_observer.h/.cc` | §2 코스메틱 주입 시점 버그 |
| `chrome/renderer/chrome_content_renderer_client.cc` | 같은 버그 — document-start 자리에서 관찰자를 깨움 (+10줄) |
| `chrome/app/settings_strings.grdp` | 원본 문자열 7789 `Import data from another browser` |
| `chrome/browser/aside_adblock/aside_adblock_engine_tests.cc` | IP 호스트 + `$generichide` 페이로드 회귀 4건 |
| `chrome/browser/ui/webui/aside_importer/BUILD.gn` | 고아 `unit_tests`를 실행 가능한 `aside_importer_tests`로 |
| `chrome/browser/ui/webui/aside_importer/aside_importer_unittest.cc` | `base::Value::Dict`→`base::DictValue`, Encryptor 헤더 (한 번도 컴파일된 적 없던 파일) |
| `chrome/browser/extensions/api/aside_browser_import/BUILD.gn` | `aside_native_contracts_tests`에 gtest main이 없어 링크가 안 됐다 |
| (추적) | 이전 담당이 `git add -N`을 못 한 새 파일 24개를 intent-to-add 해 패치에 들어가게 함 |

검사 자료(트리 밖): `aside-fork/test/g4/` — `adblock/`(9414·18791 복사본, 픽스처, 프로브 4개),
`secure-cdp-handshake.py`, `secure-cdp-metadata.sh`, `devtools-download.mjs`, `shots.mjs`, `settings-import-string.mjs`.

---

## 7. 재현 방법 (그대로 따라 하면 됨)

```bash
# 1) 빌드
cd ~/chromium/src && flock /tmp/aside-ninja.lock sh -c \
  './third_party/ninja/ninja -C out/aside chrome -j4 -l 6 2>&1 | tail -5'

# 2) C++ 검사 5개
flock /tmp/aside-ninja.lock sh -c './third_party/ninja/ninja -C out/aside \
  aside_adblock_engine_tests aside_native_contracts_tests aside_importer_tests \
  aside_omnibox_context_unittests aside_omnibox_action_unittests -j4 -l 6'
cd out/aside && for t in aside_adblock_engine_tests aside_native_contracts_tests \
  aside_importer_tests aside_omnibox_context_unittests aside_omnibox_action_unittests; do ./$t; done

# 3) 화면과 브라우저 (자기 화면 :114, CDP 9414)
Xvfb :114 -screen 0 1400x900x24 &
setsid nohup env DISPLAY=:114 ~/chromium/src/out/aside/chrome --no-sandbox --no-first-run \
  --user-data-dir=/tmp/aside-ui-G4 --remote-debugging-port=9414 --window-size=1280,800 about:blank &

# 4) 광고차단 종단 29/29
cd aside-fork/test/g4/adblock && ./run-adblock-test.sh /tmp/g4-adblock.json

# 5) devtools 다운로드
mkdir -p /tmp/g4-dl-src && printf 'col_a,col_b\n1,2\n' > /tmp/g4-dl-src/report.csv
(cd /tmp/g4-dl-src && setsid python3 -m http.server 18792 --bind 127.0.0.1 &)
node aside-fork/test/g4/devtools-download.mjs

# 6) 보안 CDP (포트 스위치 없이 다시 띄워야 45103이 열린다)
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -outform DER \
 | openssl pkcs8 -topk8 -nocrypt -inform DER -outform DER \
   -out /tmp/aside-ui-G4/AsideInstallationKey     # PKCS#8 이어야 한다
setsid nohup env DISPLAY=:114 ~/chromium/src/out/aside/chrome --no-sandbox --no-first-run \
  --user-data-dir=/tmp/aside-ui-G4 --window-size=1280,800 about:blank &
python3 aside-fork/test/g4/secure-cdp-handshake.py /tmp/aside-ui-G4/AsideInstallationKey 45103
aside-fork/test/g4/secure-cdp-metadata.sh
```

---

## 8. 남은 차이 / 못 한 것

| 무엇 | 왜 |
|---|---|
| pq_v1 서명 알맹이 | **불가.** 맥OS 26 ML-DSA + 키체인 접근 그룹 전용. 리눅스에 만들 수 있는 물건이 아니다. 스킴 판정·거절 경로·문구까지는 이식·확인 완료 |
| 미니팝업 창 실제 토글 | Aside 확장이 필요하고, 확장을 로드하면 라이브 데몬(21420)에 붙는다. 규칙상 금지 → **라이브 확인 필요** |
| Firefox·Safari 실제 데이터 이관 | 이 기계에 Firefox 프로필도 Safari 내보내기 ZIP도 없다. 픽스처 단위 검사(9/9)까지만 |
| 확장 권한 문구 5개(10347–10351) | 한 식구의 주인이 G6(0x048f2710). §5에 넘김 |
| `aside_native_contracts_unittest.cc` | `chrome/test:unit_tests`에 등록은 되어 있으나(patch 044) 그 타깃을 빌드하면 메모리·시간이 규칙(16GB, `-j4 -l 6`)을 넘는다. 같은 내용의 가벼운 부분은 `aside_native_contracts_tests`로 돌려 5/5 확인 |

---

## 9. 산출물 경로

| 무엇 | 어디 |
|---|---|
| 결과 문서 | `belmont-browse/aside-fork/campaign/G4-RESULT.md` (이 파일) |
| 패치 스냅샷 | `belmont-browse/aside-fork/patches/041-G4.patch` (170개 파일, 958 KB) |
| DIFFERENTIAL 절 | `belmont-browse/aside-fork/DIFFERENTIAL.md` "(16) G4 …" |
| 검사 자료 | `belmont-browse/aside-fork/test/g4/` |
| 종단 결과 JSON | `belmont-browse/aside-fork/test/g4/adblock/result-G4-2026-09-06.json` |
| 캡처 | `belmont-browse/aside-fork/ui-shots/G4-*.png` (5장) |
| 빌드 로그 | `/tmp/aside-build-G4-base.log`, `-fix1.log`, `-tests.log`, `-final.log` |

## 10. 지도(RESTORATION-MAP) 갱신용 한 줄 요약

| # | start_hex | 새 상태 |
|---|---|---|
| 33 | `0x048c1ab0` | 재현 완료 (리눅스 탐지·마이그레이터·취소/실패 상태 실물 확인, 실제 Firefox/Safari 데이터 이관은 픽스처까지) |
| 7 | `0x043eda40` | 재현 완료(악수 전체 17/17 + 메타데이터 7/7) / pq_v1 서명 알맹이만 불가(맥 전용) |
| 41 | `0x0488bd30` | 재현 완료 (자원을 pak으로, 원본 문자열 7789 복원) |
| 47 | `0x0498f6c0` | 재현 완료(리눅스 전역 단축키 경로로 대체) / 미니팝업 창 토글은 라이브 확인 필요 |
| 27 | `0x046f6cb0` | 재현 완료 (폴더 생성 + GUID 파일명 / 응답 기반 표시 이름, 실물 확인) |
