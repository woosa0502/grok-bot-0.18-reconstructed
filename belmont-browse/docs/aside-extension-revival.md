# 원본 Aside 확장 프로그램 되살리기 (포크 없이) — 2026-09-04

## 결론
원본 Aside.app(1.0.825.1)의 "Aside Browsing Agent" 확장 프로그램(MV3, 1.26.824.2151)을 크로미움 포크 없이 봇 브라우저 안에서 그대로 돌린다. 사이드패널에서 보낸 작업이 세션 생성 → 데몬 → 브라우저 조작 → 결과 표시까지 완주했다(example.com 열고 "Example Domain" 보고, 16초).

## 원본의 실체 (DMG 분석)
- 크로미움 151.0.7922.171 + 확장 2개(`AsideAgentManager`, `AsidePasswordManager`, JS 원본) + C++ 접착(31개 파일) + 데몬(SEA) + 네이티브 모듈 2개(맥 전용).
- 확장이 실제로 부르는 비공개 API는 13개 호출: `asideAccount.getProfileContext/getProfiles/signDaemonAuthChallenge`, `asideNotification.requestPermission/revokePermission`, `asideMiniPopup.setState/setSize/hide/pickDirectory/switchProfile`, `asideBrowserPreferences.get/setAutoPipEnabled, get/setHorizontalTabShrinkEnabled`. 나머지 표준 Chrome API.
- 데몬 연결: `http://127.0.0.1:21420` HTTP/tRPC + WebSocket(`/extension-bridge`, `/ws/*`). 인증: `/auth/daemon/challenge` → 브라우저가 설치 개인키(P-256 또는 ML-DSA-65)로 `"Aside Daemon Auth v1\0"+challenge` 서명(DER) → `/auth/daemon/session` → JWT. 리눅스에서는 `assertAvailable()`이 던져서 그대로는 불가.

## 만든 것 (belmont-browse, git 밖)
| 파일 | 역할 |
|---|---|
| `tools/patch-daemon-linux.py` | 데몬 번들 패치 7·8: `BELMONT_INSTALL_SIG_PUB`가 있으면 `getPublicKeys`가 우리 P-256 공개키(p256_v1) 반환; `serve`/`WebSocketServer`/`createServer`를 `__belmontServer`로 내보냄 |
| `src/daemon-server.mjs` | `.state/installation-keys.json`(P-256 키쌍) 생성, 데몬의 Hono 앱 + WS 업그레이드로 21420 기동 |
| `src/core.mjs` | 계정 부트스트랩 뒤 데몬 서버 기동(`BELMONT_BROWSE_DAEMON_SERVER=0`으로 끔) |
| `vendor/aside-ext/AsideAgentManager` | DMG에서 꺼낸 확장 원본(36MB) |
| `tools/build-aside-ext.mjs` | `.state/aside-ext` 생성: 비공개 권한 7개 제거, `aside-shim.js`(위 13개 호출 대체, WebCrypto ECDSA 서명 raw→DER, 프로필 `belmont-ui`→계정 0) 를 background.js와 HTML 10개에 주입 |
| `src/chrome.mjs`, `src/cdp-relay.mjs` | `BELMONT_BROWSE_EXTENSION` 있으면 `--load-extension` 인자 |
| `.state/scripts/restart-browse.sh` | 확장 빌드 → Chrome for Testing 151(`~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome`) + 확장 + `:99`로 서비스 재시작 |

정식 Google Chrome은 137부터 `--load-extension`을 무시(플래그로도 안 됨, 실측). Chrome for Testing 151은 Aside 포크와 같은 크로미움 계열이고 이 컴퓨터에 이미 있었음. 되돌리기: `BELMONT_BROWSE_CHROME=/usr/bin/google-chrome BELMONT_BROWSE_EXTENSION= .state/scripts/restart-browse.sh`.

## 실측
- 인증: 챌린지→서명→세션 200(토큰 86400s), `/auth/daemon/verify` 200, tRPC `accounts.list` 200, 잘못된 서명 401.
- 사이드패널(`chrome-extension://fjdhphbdlfjogobdofoaagnlnkoibdge/sidepanel.html`): 원본 UI 렌더(New chat, Project·Guard, GPT-5.6 Luna·Max). 작업 전송 → 탭이 example.com으로 이동(21초) → 패널에 "Worked for 16s / Example Domain", 세션 제목 자동 생성.
- 첫 시도의 "Unable to connect ChatGPT server"는 OpenAI 장애(belmont 경로도 동시에 실패, 복구 후 둘 다 정상).
- belmont의 가짜 확장(`belmont-local` 프로필)과 진짜 확장(`belmont-ui` 프로필)은 같은 계정 0에 다른 프로필로 공존.

## 남은 빈틈
- 클릭 없는 탭 캡처(원본 권한 `capture-tab-without-userinteraction`): 일반 크로미움은 사용자 제스처 필요 → 탭 미리보기 스트림 확인 필요. `captureVisibleTab`(정지 화면)은 `<all_urls>`로 가능.
- 광고 차단(포크 내장): 없음. uBlock 계열로 대체 가능.
- 미니팝업은 네이티브 창 대신 대체 계층의 no-op(닫기만 동작).
- 데몬의 자기 호출 주소 `DAEMON_URL`은 아직 127.0.0.1:9(막힘)로 둠. 확장 경로가 완주했으므로 당장은 불필요하나, 확장 브리지 명령이 HTTP로 자기 서버를 부르는 경로가 있으면 21420으로 바꿔야 함.

## 같은 작업 비교 (2026-09-04) — "네이버에서 오늘 부산 날씨(현재 기온, 하늘 상태)를 확인해서 알려줘"
| | 우리 경로 (Belmont 브라우저 봇, 9340 API) | 원본 사이드패널 |
|---|---|---|
| 도구 순서 | memory_search → read_file ×3 → repl(탭 확인) → repl(openTab 네이버) | memory_search → repl(탭 확인) → read_file ×3 → repl(openTab 네이버) |
| 답 | 부산 중구 남포동 현재 25.7°C, 흐림 | 동일 |
| 시간 | 39초, 승인 없음 | 첫 파일 읽기 승인창(Guard) → 사람이 Allow → 두 번째 읽기 승인이 패널에 안 그려져 정지 → API로 승인 후 18초 만에 완료 |
| 차이 원인 | 같은 Guard 모드인데 우리 경로는 파일 읽기에 승인이 안 걸림(세션 생성 방식 차이). 원본 패널은 파일 읽기마다 승인창을 띄우며, 병렬 읽기 3건 중 두 번째 승인창을 안 띄우는 문제가 우리 환경에서 재현됨(세션 상태는 `suspended`로 정확히 남아 있었고 `sessions.resolveSuspension` API로 풀림) |

## 광고 차단 (원본과 동일 결과, 2026-09-04)
- 기계어(arm64 슬라이스) 분석으로 원본 구조 확정: 자체 엔진 아님. 크로미움 `subresource_filter`(네트워크) + `CosmeticFilterHost`/`declarative_net_request`(규칙) 위에 EasyList를 컴포넌트 업데이터로 얹은 것. 서비스 초기화 함수(0x3f96fe0, 0x2d77eac)에서 설정 키 `aside-adblock-manual-dir`, `safebrowsing.enabled` 연동 확인.
- 첫 시도 uBlock Origin(MV2) 실패: 크롬 151이 MV2를 비활성. 기계어의 `declarative_net_request`가 MV3 단서였음.
- uBlock Origin Lite(MV3, `vendor/ubol/`)로 교체 → 원본과 같은 declarativeNetRequest 방식. CNN에서 상단 배너·영상 광고·표시형 광고 전부 제거, 요청 19~25건 차단. 파이프 서비스에서도 확장 2개(uBOL + Aside) 로드·차단 확인.
- `restart-browse.sh`가 `vendor/ubol`이 있으면 자동으로 함께 로드. 끄려면 `BELMONT_BROWSE_EXTENSION=$DIR/.state/aside-ext`만 지정.

## 탭 미리보기 (원본과 동일 결과, 2026-09-04)
- 원본 확장 `tab-preview-player.js`: `tabCapture.getMediaStreamId`+`getUserMedia`로 탭 라이브 스트림(최대 1440×900, 24fps)을 `<video>`→캔버스로 렌더. 비공개 권한 `capture-tab-without-userinteraction`으로 제스처 면제.
- 기계어에서 권한 등록 테이블(0x350edac) 확인: 캡처 자체는 순정 크로미움, 권한은 제스처 게이트 면제용.
- 우리 우회: 봇이 CDP로 브라우저를 조종하므로 `Page.captureScreenshot`으로 클릭 없이 배경 탭까지 캡처. 실측: 초점 밖 배경 탭 2개(example, naver) 정상 캡처, 약 19fps(원본 24fps 목표에 근접), 확장 권한·재빌드 불필요.

## 결론
원본이 크로미움 포크 안에 컴파일해 둔 두 기능(광고 차단, 클릭 없는 탭 캡처)을, 포크 재빌드 없이 밖에서 동일 결과로 재현 완료. 광고 차단=같은 엔진(uBOL MV3) 확장, 탭 캡처=CDP 스크린샷.
