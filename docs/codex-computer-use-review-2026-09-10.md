# Codex 컴퓨터 유즈 조사 — 구조·오픈소스 비교·우리가 가져올 것 (2026-09-10)

## 결론 먼저

1. **Windows 네이티브 제어의 실행 층은 오픈소스 cua 드라이버(trycua/cua, MIT)를 쓴다.** Codex의 실행 파일은 설계 참고로만 본다. 두 쪽은 같은 설계(창 단위 접근성 트리 + 캡처, 번호로 클릭, 호스트가 권한을 쥠)이고, cua가 우리 목적에 결정적으로 유리한 점이 하나 있다: 사용자가 컴퓨터를 계속 쓰는 동안 봇이 뒤에서 일한다(백그라운드 전달). Codex 것은 실제 마우스·포커스를 잡는다.
2. **Codex의 진짜 자산은 실행 파일이 아니라 문서 층이다.** 런타임 안에 모델이 읽는 문서 30개(136KB, SKILL.md 3개 포함)가 있고, 확인 정책·REPL 규칙·완료 기준·탭 넘기기·봇 차단 분류가 촘촘하다. 전부 텍스트라 우리 도구 설명서로 옮겨 적으면 된다.
3. **브라우저는 Aside가 이미 같은 구조다.** REPL, `snapshot()`의 바뀐 부분만 반환, ref 번호 클릭, 사용자 탭 붙이기, 좌표 대체 경로, 사이트별 스킬 16개까지 있어서 Codex보다 나은 부분도 있다. Aside에 보탤 것은 글 4개뿐이고 데몬 코드는 안 건드린다.
4. **결정할 것 셋**: cua 드라이버 Windows 설치 승인, CAPTCHA를 계속 자동으로 풀지, Aside 정책 글을 넣을 자리(내장 스킬 vs 훅).

## 1. 조사 대상과 출처

| 항목 | 값 |
|---|---|
| Codex 데스크톱 앱 | MSIX `OpenAI.Codex 26.903.8094.0` (Windows에 설치돼 있음) |
| 컴퓨터 유즈 런타임 | `C:\Users\HOON\AppData\Local\OpenAI\Codex\runtimes\cua_node\b58ca2eaa616c2da\bin` |
| 패키지 | `@oai/cua 0.2.4`, `@oai/sky 0.6.26`, `@oai/browser-desktop 0.1.1` (셋이 서로 import, 한 묶음) |
| 실행 파일 | `codex-computer-use.exe` 1,549,616바이트(두 패키지에 각 1개, 코드 동일·서명 블록만 다름). `codex-computer-use-swift.exe` 54.8MB는 JS가 참조하지 않는 대체품 |
| 바탕 | 전용 `node.exe` v24.20.0 + 보조 패키지 25개(playwright, sharp, pixelmatch, classic-level 등) |
| 우리가 만든 팩 | `C:\Users\HOON\Desktop\codex-computer-use-runtime-20260910.zip` (51MB, 2,048개 파일, `MANIFEST.txt` 포함. node.exe·npm·corepack 제외) |
| 정적 분석 묶음 | 다른 모델이 위 zip을 읽고 쓴 보고서 5개 파일. 사본 `data/artifacts/codex-cua-20260910/analysis-bundle/` (git 제외) |

정적 분석 묶음의 주장은 아래 표대로 실제 파일과 대조했고 **전부 일치**했다.

| 보고서 주장 | 대조 결과 |
|---|---|
| Windows JS가 헬퍼를 `--parent-pid`로 띄우고 파이프 모드·오디오 스위치·턴 종료·승인 요청·요청 예산 키가 있다 | 인용 문자열 13개 모두 JS 파일 3개(`computer_use_client.js`, `computer_use_client_base.js`, `helper_transport.js`)에 존재 |
| 네이티브 동작 16개 + 수명주기 2개 | 18개 이름 전부 존재 |
| 브라우저 API 문서: 인터페이스 22, 멤버 146, 보조 타입 65 | `browser-desktop/docs/api.json`에서 22 / 146 / 65 |
| 내부 명령 94개 | 94개 이름 모두 번들에 글자 그대로 존재 |
| exe 두 개는 코드가 같고 서명 블록만 다르다 | 1,549,616바이트 중 1,961바이트만 다름(머리 2 + 꼬리 1,959) |
| 빌드 시각 2026-09-02, 서명 주체 OpenAI OpCo | COFF 시각 `2026-09-02T19:19:54Z`, 문자열 확인 |
| swift 폴더 manifest가 실제 파일과 안 맞는다 | manifest는 `codex-computer-use.exe` 54,834,176바이트, 실제는 `-swift.exe` 54,849,840바이트. DLL 3개 크기도 다름 |
| `browser-client.mjs`는 두 사본이 같고 `browser-service.mjs`는 다르다 | 해시 대조 일치 |
| 동봉 스크립트는 캡처 파일만 읽고 연결하지 않는다 | 코드 확인. 파일 읽기·JSON 해석뿐 |

exe 내부 동작은 문자열 수준(UI Automation, SendInput, D3D11 캡처, named pipe, "Codex is using your computer" 문구)까지만 봤다. 그 이상은 보고서도 "미확정"으로 남겼고 그 선이 맞다.

## 2. 구조 요약 (확인된 것만)

```
에이전트 JS (cua_repl)
  ├─ nodeRepl.rpc("browser") → @oai/browser-desktop → 브라우저(IAB / 확장 / CDP)
  └─ nodeRepl.rpc("sky")     → @oai/sky
                                 └─ Windows 통신 층
                                      ├─ 자식 프로세스: 한 줄에 JSON 하나(stdin/stdout)
                                      └─ named pipe: 4바이트 길이 + JSON-RPC 2.0
                                            └─ codex-computer-use.exe (UI Automation·캡처·입력·승인)
```

- **관측**: `get_window_state` → 창 정보 + 캡처 여러 장(zIndex·url·원점·크기) + 접근성(텍스트 트리, 포커스, 선택, 문서 텍스트). 창·경계·캡처 번호가 바뀌면 exe가 거부한다(다른 창에 잘못 클릭하는 것을 막는 설계).
- **동작 16개**: `activate_window get_window_state click click_element scroll drag press_key type_text launch_app list_apps list_windows get_window perform_secondary_action set_value start/stop_audio_recording`. 수명주기 `end_turn close`.
- **승인**: 앱별 승인이 필요하면 결과 대신 `approvalRequest`가 오고 JS가 앱의 확인 창을 부른 뒤 같은 요청을 잇는다.
- **중단**: 물리 Esc가 눌리면 `$CODEX_HOME/cache/computer-use/interrupts/<대화>/<턴>`에 표식이 생기고 같은 턴의 후속 호출은 즉시 거부.
- **시간**: 기본 10초, 앱 실행 15초. 요청 예산 키 `x-oai-cua-request-budget-ms`.
- **WSL**: 통신 층에 `WSL_DISTRO_NAME`을 읽는 분기가 있다. WSL에서 부르는 경우를 이미 염두에 둔 것.
- **입력 방식**: Windows 창 API 문서에 "입력 동작은 대상 창을 자동으로 앞으로 가져온다"고 적혀 있다. 즉 실제 포커스·포인터를 잡는다.

OS 제어만 쓸 때의 최소 묶음은 `@oai/sky`의 Windows 부분(JS 44KB) + exe 1.5MB + Node 24다(statsig은 mac 원격 측정 파일 하나만 씀). 다만 앱 밖에서 돌릴 때 승인 흐름이 비어 있고 exe 안의 정책(금지 URL·인증서 검사)이 어떻게 반응할지는 실행해 봐야 안다. 이 묶음은 쓰지 않기로 했으므로 여기서 끝.

## 3. 오픈소스 cua 드라이버와 비교

| 항목 | Codex (보고서·문서 기준) | 오픈소스 cua 드라이버 (문서 기준) |
|---|---|---|
| 입력 전달 | 실제 마우스·키보드를 잡음(SendInput). 화면 덮개 표시, 사용자는 손 뗌 | 기본이 백그라운드 전달(UIA 동작·창 메시지). 사용자 포인터·포커스 그대로. 보이는 커서는 별도 덮개. 안 되는 앱만 foreground로 명시 승격 |
| 관측 | 창 상태 1종(창·캡처 여러 장·텍스트 트리·선택) | 창 상태 + 바탕화면 전체 캡처 + 확대(zoom) + 창 목록 + 앱 목록 + `verify_state`(조건 검사) |
| 동작 | 16개 | 그 16개를 다 덮고 더 있음(더블·우클릭, 단축키, 메뉴 경로 실행, 창 위치 지정, 강제 종료, 클립보드, 녹화·재생). 오디오 녹음만 없음 |
| 안전장치 | 앱별 승인, 창·경계·캡처 번호 바뀌면 거부, 물리 Esc로 턴 중단, 요청 시간 예산 | 권한 모드 3단계(standard/bounded/unrestricted), 능력 명세서로 좁히기, 세션별 권한 회수, 캡처 번호 규칙(턴마다 새로), 모호하면 실패로 닫힘 |
| 에이전트 접점 | 모델이 JS를 써서 API를 부르는 REPL | MCP 도구(한 호출에 한 동작), CLI, SDK |
| 통신 | JS가 exe를 자식으로 띄워 줄 단위 JSON, 또는 named pipe JSON-RPC | 데몬 `cua-driver serve --socket`(Windows는 named pipe) 또는 stdio MCP |
| Windows 지원 범위 | 미확인(앱 내부용) | Electron·Tauri·WPF·WinUI3·WebView2 백그라운드 확인. 크로미움 일부 제스처와 관리자 권한 창은 안 됨 |
| 설치 | 앱에 포함 | `irm https://cua.ai/driver/install.ps1 \| iex`, `cua-driver mcp` |

- Codex가 나은 점: 단순함(파일 두 개, 호출 16개, "화면 바뀌면 다시 읽어라" 규칙이 명확).
- cua가 나은 점: 사용자가 컴퓨터를 계속 쓰면서 봇이 뒤에서 일하는 구조. Belmont 봇이 옆에서 일하는 우리 목적에는 이게 결정적.

출처: [MCP Tools](https://cua.ai/docs/cua-driver/reference/mcp-tools), [Platform Support](https://cua.ai/docs/reference/cua-driver/platform-support), [Choose a Cua Driver integration](https://cua.ai/docs/concepts/choose-a-cua-driver-integration), [Drive your first app](https://cua.ai/docs/tutorials/drive-your-first-app), [CLI Reference](https://cua.ai/docs/reference/cua-driver/cli-reference).

## 4. Codex 문서 층 (모델이 읽는 글)

| 문서 묶음 | 내용 | 가져올 가치 |
|---|---|---|
| `sky/docs/skills/oai_sky_lib/{linux,macos,windows}/SKILL.md` + 창 API 문서 3개 | "앱 목록 → 창 고르기 → 창 상태(텍스트 트리 포함) → 번호로 클릭" 순서와 각 호출의 인자 설명 | 중. cua 문서와 겹침 |
| `cua/docs/tinysky-alt-core-cua-repl.md` (10KB) | 동작 여러 개 + 새 상태 읽기를 한 호출에 묶기, 트리는 바뀐 부분만 반환(토큰 절약), 자동 대기(setTimeout 금지), "결과가 화면에 보일 때까지 끝내지 마라", "보이면 탐색 멈춰라" | **높음**. cua는 도구 하나당 호출 하나라 이 층이 없음 |
| `cua/docs/tinysky-alt-confirmations.md` (5.6KB) | 4단계 확인 정책(아래 5절) | **높음**. 그대로 우리 정책으로 써도 됨 |
| `browser-desktop/docs/documents.json` | 문서마다 "항상 포함 / 모델이 필요할 때 / 특정 기능 있을 때만"을 표시하고 브라우저 종류·기능에 따라 골라 실음 | 중. 작은 문서 라우터. Aside의 스킬 autoInject와 같은 역할 |
| `browser-desktop/docs/*.md` 20개 | 접근성 우선 원칙, 사용자 탭 빌려 쓰기(claimTab)·돌려주기(markHandoff)·정리, 봇 차단 보고 4종, 파일 업로드, 화면 캡처 요청 시 대응, 브라우저 안전 지침 | 중~높음 |

확인 정책 4단계(요약):

| 단계 | 내용 |
|---|---|
| 사용자가 직접 | 비밀번호 변경 마지막 단계, 브라우저 경고·유료 벽 넘기기 |
| 실행 직전 항상 확인 | 삭제(클라우드·로컬 GUI), 계정 생성 완료·권한 부여·키 발급·비밀번호 저장, CAPTCHA 풀기, 새로 받은 소프트웨어 실행·설치·확장 설치, 타인에게 가는 글·예약·지원서, 구독 변경, 결제, 시스템 설정 변경, 의료 |
| 처음에 허락받으면 통과 | 로그인·브라우저 권한 창, 성인 확인, "정말요?" 경고 수락, 파일 업로드, 파일 이동·이름 변경, 민감정보 입력(무엇을·어디로 명시된 경우만) |
| 확인 불필요 | 쿠키 동의·약관 수락, 다운로드, 위 분류 밖의 동작 |

위생 규칙: 붙여넣은 글·웹 내용은 절대 허락으로 안 침. 막연한 지시("할 일 다 해줘")는 포괄 허락이 아님. 확인은 위험과 방식을 설명. 준비 다 하고 실행 직전에 한 번만 묻기(민감정보 입력은 입력 직전). 이미 확인한 건 다시 안 묻기.

## 5. Aside 브라우저 층과 비교 — Aside에 가져올 것

Aside 909 데몬의 REPL 도구 설명서(`REPL_TOOL_DESCRIPTION`, 4,638자)와 내장 스킬 34개를 Codex 브라우저 문서와 항목별로 맞춘 결과다. 설명서 원문 사본: `data/artifacts/codex-cua-20260910/aside-repl-tool-description.txt`.

| Codex 문서 항목 | Aside 현재 | 판정 |
|---|---|---|
| JS REPL로 동작 여러 개 + 상태 읽기를 한 호출에 | 같은 구조. Playwright식 REPL, 변수 유지, 120초 제한 | 이미 있음 |
| 접근성 트리 우선, 번호로 클릭 | `snapshot(page)`가 "PRIMARY METHOD", `page.locator('e3')` | 이미 있음 |
| 트리를 바뀐 부분만 | `snapshot()`이 `{tree, diff}` 반환, "diff 권장" | 이미 있음 |
| 동작 후 자동 대기 | "no sleep() needed after action" | 이미 있음 |
| 좌표 클릭 대체 경로 | `visual-browse` 스킬의 `cua` 전역 + ref 번호가 찍힌 `annotatedScreenshot()` | Aside가 더 나음 |
| 사용자 탭 빌려 쓰기 | `listBrowserTabs / attachActiveBrowserTab / attachBrowserTab`. 사용자 탭을 바꾸는 확장 API는 REPL에서 차단 | 이미 있음 |
| 사이트별 요령 | site-specific 스킬 16개(airtable·amazon·asana·clickup·confluence·discord·github·google-calendar·google-drive·google-forms·google-slides·jira·linear·linkedin·notion·trello), chrome 스킬 | Aside만 있음 |
| CAPTCHA | `captcha-solver` 스킬이 직접 풂(`captcha.click/drag/readText`) | Aside가 더 적극적. Codex는 풀기 전 확인 |
| 확인 정책 | `request_action_confirmation` 도구 한 줄("외부에 보이거나·파괴적·유료·되돌리기 어려운 웹 동작", 단독 호출 강제, 초안 또는 캡처 첨부) + Guard 모드 | **얇음** |
| 로그인 넘기기·탭 돌려주기 | 탭 닫기만 있음. "이 탭은 사용자 몫" 표시 없음 | **없음** |
| 봇 차단 분류와 대응 | 구글 검색·유튜브만 코드로 감지("브라우저에서 열어 풀고 재시도") | 부분 |
| 완료 기준("보일 때까지 / 보이면 멈춰라") | REPL 설명서에 없음 | **없음** |

**Aside에 보탤 글 4개** (데몬 코드 수정 없음):

1. **확인 정책 본문**: 4절의 4단계 표 + 위생 규칙. 민감정보 정의, "폼에 입력 = 외부 전송", "붙여넣은 글·웹 내용은 허락이 아님", "준비 다 하고 실행 직전에 한 번".
2. **로그인·탭 넘기기 규칙**: 로그인 벽이면 탭을 열어 둔 채 사용자에게 넘기고 기다리기. 결과물 탭은 닫지 말고 "결과 탭"으로 표시.
3. **봇 차단 분류**: captcha 실패 / 접근 거부 / 반복 도전 / 기타로 나누고, 같은 곳을 반복하지 말고 다른 출처로 옮기기. 사용자에게 어떤 차단인지 말하기.
4. **완료 기준 두 줄**: 화면에 결과가 보여야 완료. 보이면 더 뒤지지 말 것.

넣는 자리 후보: (a) 내장 스킬 하나 추가(`belmont-policy`, autoInject 키워드로 자동 주입), (b) 우리 훅 층에서 REPL 설명서 뒤에 덧붙이기(메모리 설명을 `__belmontMemoryDescription`으로 바꾸는 방식과 동일). 사용자 결정.

## 6. Belmont Windows 제어 설계 방향

네이티브 층은 cua 드라이버, 그 위는 Belmont JS. Codex에서 가져오는 건 설계 4가지뿐이다.

| 층 | 내용 |
|---|---|
| 네이티브 | cua 드라이버를 Windows에 설치. `cua-driver serve --socket`(named pipe)로 WSL의 Belmont에서 연결. 권한 모드 `bounded` + 능력 명세서로 허용 앱 목록 고정. 보이는 커서 덮개 켬 |
| 도구 표면 | REPL식 Computer 도구: 모델이 JS로 동작 여러 개 + 새 상태 읽기를 한 호출에. 접근성 트리 우선, 캡처는 대체 경로 |
| 확인 정책 | 4절의 4단계. 결제·전송·삭제·권한 변경은 실행 직전에 묻기 |
| 신선도·시간 | 턴마다 창 상태를 새로 받아야 번호 클릭 허용. 턴 시간 예산과 호출당 제한 |
| 중단 | Esc 한 번이면 그 턴의 후속 호출 전부 거부(표식 파일). 화면에 "봇 작업 중" 표시 |

순서: (1) 드라이버 설치 후 메모장 열기 → 트리 읽기 → 글자 입력 연기 테스트를 사용자가 보는 앞에서 (2) MCP 도구를 Belmont Computer 도구(현재 Xvfb + xdotool)의 Windows 경로로 연결 (3) 정책 글 (4) 실사용 시나리오(쇼핑·문서 작업).

## 7. 결정이 필요한 것

| 결정 | 선택지 | 권고 |
|---|---|---|
| cua 드라이버 Windows 설치 | 승인 / 보류 | 승인. 연기 테스트는 사용자가 보는 앞에서 |
| CAPTCHA | 계속 자동으로 풀기 / Codex처럼 묻고 풀기 | 쇼핑 봇은 자동, 남의 계정을 다루면 묻기. 사이트 목록으로 나누는 것도 가능 |
| Aside 정책 글 자리 | 내장 스킬 / 훅으로 설명서 뒤에 붙이기 | 내장 스킬(원본 구조 그대로, 패치 없음) |

## 8. 관련 파일

- 런타임 원본: `C:\Users\HOON\AppData\Local\OpenAI\Codex\runtimes\cua_node\b58ca2eaa616c2da\bin`
- 팩: `C:\Users\HOON\Desktop\codex-computer-use-runtime-20260910.zip`
- 정적 분석 묶음 사본과 대조 기록: `data/artifacts/codex-cua-20260910/` (git 제외)
- Aside REPL 설명서 사본: `data/artifacts/codex-cua-20260910/aside-repl-tool-description.txt`
- 앞선 조사: `docs/progress-log-2026-09-10.md` 14:5x 행, `docs/aside-909-daemon-comparison-2026-09-10.md`
- Belmont Computer 도구 현재 구현: `source/host/box/local-computer-use.ts`와 `source/packages/local-exec/computer-use/` (Xvfb + xdotool + ffmpeg)
