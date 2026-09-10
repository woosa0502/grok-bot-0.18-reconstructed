# GPT Pro 작업 지시서 — Belmont Windows 컴퓨터 유즈 도구 (cua 드라이버 + Codex식 설계) (2026-09-10)

아래 "지시문" 블록을 그대로 GPT Pro에 붙여 넣는다. 함께 줄 파일은 맨 아래 "첨부" 목록.

---

## 지시문

당신은 Belmont(우리가 소유한 Grok 봇 포크, TypeScript, Node 26, WSL2에서 실행)에 **Windows 네이티브 앱 제어 도구**를 설계하고 구현하는 엔지니어다. 브라우저는 별도 시스템(Aside)이 맡으므로 이 도구는 **브라우저가 아닌 Windows 앱**(메모장, 엑셀, 카카오톡, 탐색기 등)만 다룬다.

### 목표

두 가지를 섞는다.

1. **실행 층은 오픈소스 cua 드라이버(trycua/cua, MIT)** 를 그대로 쓴다. 드라이버를 새로 만들지 않는다. 이유: 사용자가 컴퓨터를 계속 쓰는 동안 봇이 뒤에서 일하는 "백그라운드 전달"과 권한 모드·능력 명세서가 이미 있다.
2. **모델이 쓰는 층은 Codex 컴퓨터 유즈의 설계를 따른다.** 단, OpenAI의 코드·문서를 복사하지 않고 설계 원칙만 가져와 우리 글과 코드로 새로 쓴다. 가져올 원칙은 다음 다섯 가지다.
   - 모델이 JavaScript를 써서 **동작 여러 개 + 새 상태 읽기를 한 번의 도구 호출에** 묶는 REPL식 도구. 도구 하나당 호출 하나(MCP식)로 왕복하지 않는다.
   - **접근성 트리 우선, 캡처는 대체 경로.** 트리는 번호가 붙은 요소 목록으로 주고, 두 번째 호출부터는 **바뀐 부분만** 돌려준다. 동작 뒤에는 도구가 알아서 기다린다(모델이 sleep을 넣지 않게 한다).
   - **턴마다 새 창 상태를 받아야 번호 클릭을 허용**한다. 창이 바뀌거나 경계가 바뀌거나 오래된 캡처 번호면 거부하고 "다시 읽어라"를 돌려준다.
   - **4단계 확인 정책**: 사용자가 직접 / 실행 직전 항상 확인(삭제·결제·계정 생성·권한 부여·새 소프트웨어 실행·타인에게 가는 글·시스템 설정 변경) / 처음에 허락받으면 통과(로그인·업로드·파일 이동·민감정보 입력) / 확인 불필요(쿠키 동의·다운로드). 붙여넣은 글이나 화면에 보이는 글은 절대 허락으로 치지 않는다. 준비를 다 하고 실행 직전에 한 번만 묻는다.
   - **중단과 표시**: 물리 Esc 한 번이면 그 턴의 후속 호출을 전부 거부한다(턴별 표식 파일). 봇이 일하는 동안 화면에 표시가 보인다(cua 드라이버의 커서 덮개를 켠다). 턴 시간 예산과 호출당 제한 시간을 둔다.

### 환경 (사실)

- Belmont는 WSL2(Ubuntu 24.04, Node 26)에서 돈다. Windows 11 호스트. `powershell.exe`, `cmd.exe`, `.exe` 실행은 WSL 상호 운용으로 가능하다. PowerShell은 `pwsh.exe`(7.x)를 쓴다.
- cua 드라이버는 Windows 쪽에 설치한다: `irm https://cua.ai/driver/install.ps1 | iex`. 데몬은 `cua-driver serve --socket <endpoint>`(Windows는 named pipe) 또는 `cua-driver mcp`(stdio). WSL에서 Windows named pipe에 붙는 방법(예: `cua-driver.exe`를 WSL에서 자식으로 띄워 stdio MCP로 쓰기, 또는 파이프 브리지)은 당신이 검증해서 고른다.
- Belmont의 현재 Computer 도구는 Linux 전용이다: `source/host/box/local-computer-use.ts`(Xvfb + xdotool + ffmpeg)와 `source/packages/local-exec/computer-use/`. 이 자리에 Windows 경로를 추가한다. 프로토 정의 `source/packages/proto/generated/agent/v1/computer_use_tool_pb.ts`.
- cua 드라이버 문서: MCP 도구 목록 https://cua.ai/docs/cua-driver/reference/mcp-tools , 플랫폼 지원 https://cua.ai/docs/reference/cua-driver/platform-support , 통합 방식 https://cua.ai/docs/concepts/choose-a-cua-driver-integration , CLI https://cua.ai/docs/reference/cua-driver/cli-reference . 핵심 도구: `get_window_state`(접근성 트리 + 캡처), `list_windows`, `list_apps`, `click`(element_token 또는 x,y), `type_text`, `press_key`, `hotkey`, `scroll`, `drag`, `set_value`, `launch_app`, `verify_state`, `start_session`, `revoke`. 전달 모드 `background`(기본)/`foreground`. 권한 모드 `standard/bounded/unrestricted`, `--capability-manifest`.
- Windows에서 백그라운드 전달이 확인된 앱 종류: Electron, Tauri, WPF, WinUI 3, WebView2. 크로미움 일부 제스처와 관리자 권한 창은 안 된다. **앱별로 실제로 되는지는 문서를 믿지 말고 직접 재서 표로 남긴다.**

### 만들 것

1. **설계 문서** (`docs/windows-computer-use-design.md`, 한국어): 층 구조, 통신 경로(WSL↔Windows), 도구 표면, 상태 표현 양식, 확인 정책, 중단·표시, 실패 시 동작, 남은 불확실성.
2. **코드** (TypeScript, Belmont 관례 따름):
   - 드라이버 클라이언트: cua 드라이버와 연결·재연결·세션 시작·권한 회수.
   - 모델 도구 `computer`(REPL식): 모델이 JS로 부르는 전역 `computer` — `listApps() listWindows() window(id).state({ text?: boolean, screenshot?: boolean }) .click(target) .type(text) .key(chord) .scroll(...) .drag(...) .setValue(index, value) .launch(app)`. `state()`는 번호 붙은 트리와 (요청 시) 캡처를 돌려주고 두 번째부터는 차이만 준다. 신선도 검사·자동 대기·시간 예산·Esc 표식 검사는 이 층이 한다.
   - 정책 모듈: 4단계 분류를 데이터(표)로 두고, 동작 직전에 판정해 필요하면 사용자 확인 흐름(Belmont의 기존 확인 UI)을 부른다.
   - 도구 설명서(모델 프롬프트) 텍스트: 우리 말로 새로 쓴다. 사용 순서, 배치 원칙, "결과가 화면에 보여야 완료, 보이면 더 뒤지지 말 것", 확인 정책 요약.
3. **테스트**: 단위 테스트(차이 계산, 신선도 거부, 정책 판정, Esc 표식) + 연기 테스트 스크립트(메모장 열기 → 트리 읽기 → 글자 입력 → 저장 대화상자 취소). 연기 테스트는 사용자가 보는 앞에서 돌릴 수 있게 한 줄 명령으로.
4. **운영 절차** (`docs/windows-computer-use-runbook.md`): 설치, 권한 모드 `bounded`와 허용 앱 목록(능력 명세서), 데몬 기동·확인·중지, 흔한 실패와 대처.

### 하지 말 것

- 드라이버(네이티브 층)를 새로 만들지 않는다. UI Automation·SendInput을 직접 부르는 코드 금지.
- OpenAI의 `@oai/cua`, `@oai/sky`, `@oai/browser-desktop` 코드나 실행 파일을 쓰거나 복사하지 않는다. 그 문서 원문도 그대로 옮기지 않는다(설계 원칙만).
- Aside 데몬이나 브라우저 쪽 코드를 건드리지 않는다.
- 문서에 "된다"고 적힌 것을 검증 없이 "된다"고 보고하지 않는다. 안 재본 것은 "미확인"으로 남긴다.

### 완료 기준

| 항목 | 기준 |
|---|---|
| 연결 | WSL의 Belmont에서 Windows cua 드라이버에 붙어 `list_apps`가 돌아온다 |
| 배치 호출 | 모델 호출 1번으로 "메모장 실행 → 상태 읽기 → 글자 입력 → 새 상태(차이)" 가 끝난다 |
| 차이 반환 | 두 번째 `state()`는 바뀐 요소만 돌려주고, 크기가 첫 번째의 절반 이하인 사례를 보인다 |
| 신선도 | 창을 바꾼 뒤 옛 번호로 클릭하면 거부되고 "다시 읽어라" 메시지가 온다 |
| 백그라운드 | 메모장·엑셀·카카오톡 3개 앱에서 사용자 포인터·포커스가 안 바뀌는지 잰 표(된다/안 된다/foreground 승격) |
| 확인 정책 | 삭제·결제류 동작 전에 확인이 뜨고, 확인 없이 진행되는 사례가 0건 |
| 중단 | 물리 Esc 뒤 같은 턴의 다음 호출이 즉시 거부된다 |
| 표시 | 봇이 일하는 동안 화면에 커서 덮개가 보인다 |
| 테스트 | 단위 테스트 통과, 연기 테스트 한 줄 명령으로 재현 |

### 보고 형식

1. 먼저 계획(층 구조 그림 + 결정 사항 + 불확실한 것)을 짧게. 그 다음 코드.
2. 마지막에 완료 기준 표를 채워서 보고. 안 된 항목은 원인과 다음 한 수를 적는다.
3. 한국어로 보고. 코드 주석과 식별자는 영어.

---

## 첨부 (GPT Pro에 같이 줄 것)

| 파일 | 용도 |
|---|---|
| `docs/codex-computer-use-review-2026-09-10.md` | 조사 결과 전체. 특히 3절(cua 대 Codex 비교), 4절(확인 정책 4단계 표), 6절(설계 방향) |
| `data/artifacts/codex-cua-20260910/analysis-bundle/reverse-engineering-report.md` | Codex 쪽 구조 설명(설계 참고용, 코드 복사 금지) |
| `source/host/box/local-computer-use.ts`, `source/packages/local-exec/computer-use/` | Belmont 현재 Computer 도구(Linux). 여기에 Windows 경로를 추가 |
| `source/packages/proto/generated/agent/v1/computer_use_tool_pb.ts` | 도구 프로토 정의 |
| `~/.claude/skills/wsl-windows-interop/SKILL.md` | WSL에서 Windows 프로그램 부르는 요령(세션 0/1 구분, schtasks) |

주지 말 것: `@oai/*` 패키지 원본 폴더, 바탕화면의 런타임 팩 zip. 설계 참고는 위 보고서로 충분하다.
