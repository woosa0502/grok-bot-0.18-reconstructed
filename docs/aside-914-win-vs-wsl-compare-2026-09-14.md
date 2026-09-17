# Aside 윈도우(914) ↔ 우리 WSL판 코드 비교 (2026-09-14)

목적: 윈도우 네이티브 Aside가 나왔으니 우리 grok-bot(WSL)과 코드로 비교. 특히 Computer Use.

## 확보한 비교 파일

작업 폴더: `~/aside-re-compare-2026-09-14/`

| 쪽 | 파일 | 크기 | 성격 |
|---|---|---|---|
| 공식 914 (윈도우) | `official-914-daemon/aside-daemon.exe` | 130MB | Node SEA(단일 실행파일) — JS가 안에 박힘 |
| 〃 | `official-914/daemon-914.js` | 4.3MB | 위 exe에서 뽑아낸 데몬 JS (extract-sea.py) |
| 〃 | `official-914-daemon/native/aside-native.node` | 7.5MB | Win32 데스크탑 제어 네이티브 |
| 〃 | `official-914-daemon/native/moss-core.node` | 14MB | 화면 스냅샷/캡처 엔진 |
| 〃 | `official-914-daemon/sandbox/AsideWindowsSandboxHelper.exe` | 0.4MB | 윈도우 샌드박스 헬퍼 |
| 우리 909 | `ours-909/daemon-909.mjs` | 10.8MB | 우리 데몬 번들(belmont-browse 커스텀 포함) |

crx 다운로드: `https://releases.aside.com/dev-updater/components/1.26.914.1644/AsideDaemon/win-x64/AsideDaemon-1.26.914.1644.crx`
(sha256 `e9135da2...` 확인 완료. Cr24 헤더 뒤 PK offset 2176부터 zip)

## 핵심 발견 — Computer Use는 "종류가 다르다"

두 시스템 다 Computer Use가 있지만 제어 대상이 다르다.

| | 우리 WSL판 | Aside 윈도우판 |
|---|---|---|
| 제어 대상 | **가상 리눅스 화면(Xvfb)** — WSL 안에 띄운 봇 전용 가상 데스크탑 | **진짜 윈도우 데스크탑** — 실제 화면·실제 앱 |
| 입력 | `xdotool` | `aside-native.node` → Win32 `SendInput` (확인됨) |
| 화면 캡처 | `ffmpeg` | Win32 `GetDC` / `moss-core.node`(Snapshot·capture 문자열 확인) |
| 창 포커스 | X11 | `SetForegroundWindow`/`GetForegroundWindow` (확인됨) |
| 봇별 격리 | 봇마다 별도 Xvfb + noVNC(폰에서 각 봇 화면 봄) | 하나의 실제 데스크탑 공유 |
| 근거 소스 | `source/host/box/local-computer-use.ts` | `aside-native.node` 심볼 grep |

결론: 우리 것은 **WSL 안 가상 화면**만 제어한다. 카톡 등 실제 윈도우 앱은 못 만진다.
Aside 윈도우판은 **실제 윈도우 화면**을 직접 만진다. 이게 사용자가 기다린 기능.

## 우리 WSL 런타임에 네이티브 데스크탑 바인딩 유무

`.build/belmont-wsl-runtime`의 `.node`는 전부 범용(tree-sitter, clipboard, better-sqlite3 등).
**aside-native.node / moss-core.node 없음** → 실제 윈도우 제어 능력이 코드로 존재하지 않음.

## Computer Use를 우리 봇에 넣는 길 (세 갈래)

1. **브리지(가장 가벼움)**: WSL 봇 → PowerShell/Win32 다리로 실제 윈도우 제어.
   탐침 이미 있음: `belmont-browse/tools/win-computer-use/winctl.ps1`
   (screenshot/click/type/key/foreground via SendInput 등). 아직 봇에 연결 안 함.
2. **네이티브 이식**: aside-native.node 방식(SendInput/GetDC/MSAA)을 우리 쪽에 직접 구현/포팅.
   무겁지만 Aside와 동급.
3. **Aside 데몬 그대로 얹기**: 윈도우 aside-daemon을 우리 게이트웨이에 물려 Computer Use만 위임.

## 전체 기능 비교 (데몬 JS 식별자 집합 차집합) — 완전본 기준 (정정)

⚠️ 정정: 최초 비교는 SEA 블롭에서 **40%만 잘못 추출한 daemon-914.js(4.3MB)** 기준이라 "914에만 28토큰"이
나왔는데 이는 **오류**다. SEA 블롭을 올바로 파싱해(경로 `D:\a\bro-components\...\sea\index.mjs` 뒤
size_t 길이 0xA5DFF0=10,870,768) **완전본 10.87MB**를 추출해 다시 비교했다.

방법: 미니파이는 지역변수만 축약하고 문자열·속성·API명은 보존됨. **긴 식별자(≥5자) 토큰 집합**의 차집합.

| 구분 | 개수 |
|---|---|
| 공통 토큰(같은 엔진) | 52,247 |
| 914(윈도우)에만 | **853** |
| 909(우리)에만 | 368 |

### 914 윈도우에만 있는 853개 = 세 묶음

1. **QuickJS 샌드박스 엔진 (최대 묶음, ~108토큰).** `quickjs-emscripten`(WASM로 컴파일된 QuickJS JS
   엔진)이 통째로 들어있다. `QTS_*`/`_QTS_*` 281회(909엔 0회), `OperatorOverloading` `BigDecimal`
   `BigFloat` `Intrinsics*` `HostRef` `EvalFlags` `ModuleMemory` `WasmOffsetConverter` 등.
   → **격리된 JS 실행**(안전한 스킬/코드 실행)용. 윈도우 `AsideWindowsSandboxHelper.exe`와 짝.
2. **외부 비밀번호 관리자 확장 (67토큰).** `PwmAccountRegistry`(78회) `PwmAccountRegistryStore`
   `ExternalPasswordManagerStore` `ExternalPasswordManagersRepl` + 이전에 봤던 계정 수명주기/공급자.
   1password/bitwarden/dashlane/lastpass 등 외부 비번관리자 연동 + Windows Hello 잠금해제.
3. **ContextMemory** (914=3, 909=0) 등 소규모 기타.

### 909 우리에만 있는 368개 = 우리 커스텀(빠진 게 아니라 더 가진 것)

전부 `__belmont*`/`BELMONT_*`/`__aside*`: `__belmontEvalIsolate` `__belmontEvalPermission`
`__belmontLifecycle*`(다수) `__belmontMemoryApi/Search` `__belmontLocalWebSearch` `BELMONT_CDP_URL`
`__asideAuth*` 등 — 우리 lifecycle·eval격리·메모리·CDP·로컬웹검색 커스텀. + mac 스킬 2개(apple-passwords, imessage).

## 종합 결론 (GPT Pro FULL 감사로 재정정 2026-09-15)

⚠️ 아래 4개는 GPT Pro가 원문(바이트 오프셋·AST·대역 실행)으로 **교정**한 것. 이전 서술은 틀렸다.

1. **같은 엔진.** 공통 토큰 52,247 + 스킬 47개 동일. 914가 0.84%(90,852 B) 큼. 909-only 368개 중 우리
   커스텀은 74개(`__belmont`/`__aside`)뿐 — "909-only=우리 우위"는 과장.
2. **Computer Use는 두 판 다 mac 전용 (교정).** `runComputerUseCommand`는 909·914 **바이트 동일**,
   `if(process.platform!=="darwin") throw "Computer Use Helper is only available on macOS"`.
   → 914-win에 "가져올 윈도우 데스크탑 제어 기능"은 **없다.** aside-native.node의 SendInput/GetForegroundWindow
   import는 존재하나 공개 command/runtime dispatch에 **연결돼 있지 않음**(Windows Hello/PIN/vault·PDF 용도 추정).
   aside-native export는 2개(napi_register+version)뿐.
3. **moss-core = 검색/벡터 인덱스 엔진 (교정, 화면캡처 아님).** SessionIndex·embedding·index.mossvec·
   simsimd 계열 91 export. "화면 스냅샷 엔진" 서술 철회.
4. **ContextMemory = QuickJS 포인터 수명관리 클래스 (교정, 에이전트 기억 아님).** QTS_Dup/FreeValuePointer.

### 914의 진짜 채택 후보 (통째 교체 금지 — 골라 이식)
- **QuickJS 실행층**: 데스크탑 REPL을 Node vm → QuickJS-WASM 브리지로 교체(createDesktopRepl). 단 QuickJS는
  보안 경계가 아님(Node vm 문서) — 기존 bwrap/OS 격리·승인 유지.
- **계정 경계 이벤트 fanout**: 16ms coalesce + account 필터 + toWireSession의 systemPrompt 제거.
- **provider 오류 진단**(createProviderErrorDiagnostic): 모든 모델 provider(Anthropic/Codex/OpenAI).
- **ASTRA_FOLLOW_THROUGH_PROMPT**(gpt-6-astra 전용) — 우리 Belmont가 astra라 직접 관련.
- **background 모델 resolver**(dreaming/요약) — 우리 summary env·Luna 하한·purpose=summary 계측 덮어쓰지 말 것.
- PWM 외부 vault + 계정 수명주기 — 실제 외부 vault 요구 있을 때.

### ⚠️ 전체 914 교체 위험 (확인됨)
우리 커스텀 훅 `__belmontSandboxBackend`(createSandboxBackend), `__belmontEvalIsolate`(createBashTool)는
909=1, **914=0**. 통째 바꾸면 WSL 통합·eval 격리가 사라진다. 개별 변경으로만 이식.

### 실제 윈도우 제어(카톡 등)의 답
네이티브 복사(PE .node는 Linux에서 실행 불가)나 데몬 전체 위임이 아니라, **WSL↔윈도우 브리지**
(`belmont-browse/tools/win-computer-use/winctl.ps1`)로 `computerUseExecutorResource` backend만 윈도우
사용자 세션 helper에 좁은 인증 IPC로 연결. Belmont 모델·승인·계측·job 원장은 유지. (GPT Pro 1순위 권고)

근거 자료: GPT Pro FULL 감사 `aside914_full_audit`(REPORT.md, results/, excerpts/). 검증 12/12(정적+대역 실행).
