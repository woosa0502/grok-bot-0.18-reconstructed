# Aside 데몬 1.26.909 (Windows·macOS) 대 우리 907 포트 — 비교 보고 (2026-09-10)

## 결론 먼저

1. **Windows 데몬과 macOS 데몬의 JS는 바이트 단위로 같다.** 909의 두 실행 파일(`aside-daemon.exe`, `Aside Daemon.app/.../aside-daemon`)에서 꺼낸 번들이 동일(10,744,442바이트, sha256 d3d791ce…). 플랫폼 차이는 JS 안의 `process.platform` 분기(907: 113곳 → 909: 126곳)와 **네이티브 모듈**(aside-native.node, moss-core.node, Windows 샌드박스 helper, macOS Computer Use 앱)에서만 난다. 따라서 "Windows 데몬 분석"은 곧 "같은 번들의 Windows 분기 읽기"다.
2. **원본은 지원 밖 플랫폼(=리눅스)에서 이렇게 한다**: 샌드박스는 `PassthroughBackend`(격리 없이 그냥 실행), 보안 저장소·생체 인증·폴더 선택은 "사용 불가" 반환, 플랫폼 스킬 없음. 우리 리눅스 패치는 이 자리를 bwrap 샌드박스, 설치 키 파일 저장소, 메모리 검색 훅으로 채운 것이라 **원본의 구조를 벗어나지 않는다.** Windows 분기는 우리에게 "제3의 플랫폼을 붙일 때 원본이 고른 자리"를 보여 주는 참고 자료다.
3. **907→909는 큰 변경이다.** DB 마이그레이션 3개(고정 채팅, 논리적 Turn으로 `session_runs`→`session_turns` 개편, 브라우저 바인딩 "regular"→"default" 모드), 확장 연결에 `browserMode` 도입, 메모리 backfill 함수 이름 변경, 브라우징 기록 검색 도구 교체, Context Awareness 도구 개편, 금고 조직 권한, Telegram 명령 버튼, 공급자 추가.
4. **우리 패치 체인은 909에 그대로 안 붙는다**: 6개 패치 중 메모리 라우팅 앵커 1개 실패, 라이프사이클 패치 앵커(`reconcileSessionTabs`) 실패, `session.mjs`가 부르는 `startSessionRunMemoryBackfill`은 `startSessionTurnMemoryBackfill`로 이름이 바뀜. 리눅스 패치(installation-v2)만 그대로 적용된다. 올리려면 앵커 재작업 + 세션 저장소 스키마(Turn) 대응이 필요하다.

## 1. 어떻게 확인했나

- 업데이트 서버(원본 Omaha 엔드포인트, protocol 4.0 + os 필드)가 준 909 구성요소 3개를 받아 서명값 대조: AsideDaemon mac-x64(61,270,430B, cdadde05…), win-x64(55,053,990B), AsideAgentManager(13,426,243B, 17ca0504…), AsidePasswordManager(1,755,660B, 2539ebbf…). 위치 `data/artifacts/aside-909-20260909/`(git 제외).
- 두 실행 파일 안의 NODE_SEA 구역(경로 문자열 `.../apps/daemon/build/sea/index.mjs` 뒤 8바이트 길이 + 코드)에서 JS를 꺼내 `export{createServer};`에서 잘랐다(907 추출과 같은 규칙). `node --check` 통과. 깨끗한 사본을 `research-archives/aside/original/AsideDaemon-win-x64-1.26.909.1820.mjs`(LFS)로 보관하고 `artifacts.json`·`SHA256SUMS`에 등록.
- 비교는 문자열 리터럴(따옴표·백틱) 집합 차이, 심볼 이름 존재 여부, 마이그레이션 코드 읽기, 우리 패치 스크립트를 사본에 적용해 본 결과로 했다.

## 2. Windows 데몬 구성 (우리와 대응)

| 구성요소 | Windows 909 | macOS 909 | 우리 리눅스 907 |
|---|---|---|---|
| 데몬 본체 | `aside-daemon.exe` 122MB (Node + 같은 JS) | `aside-daemon` 151MB | 꺼낸 JS를 Node 26.5로 직접 실행 |
| 네이티브 helper | `native/aside-native.node` 7MB (+ `Microsoft.WindowsAppRuntime.Bootstrap.dll`) | `aside-native.node` 9MB | 없음 → 원본 규칙대로 "사용 불가" 경로 |
| 의미 검색 | `native/moss-core.node` 13MB | 9MB | 리눅스용 moss-core(동일 엔진) |
| 셸 샌드박스 | `sandbox/AsideWindowsSandboxHelper.exe` + AppContainer + pwsh | macOS seatbelt | bubblewrap(우리 backend를 `__belmontSandboxBackend`로 주입) |
| 화면 관찰 | 없음 | `Aside Computer Use.app` | 없음(원본과 동일) |
| 내장 스킬 | 33개(apple-passwords·context-awareness·imessage 제외) | 35개 | 907의 35개 |

## 3. 플랫폼 분기: 원본이 고른 자리 vs 우리

| 기능 | darwin | win32 | 그 외(원본의 리눅스) | 우리 리눅스 패치 |
|---|---|---|---|---|
| `createSandboxBackend()` | `MacOSSandboxBackend` | `WindowsSandboxBackend`(AppContainer, `windowsIsolation`, `New-PSDrive AsideWorkspace`, `Set-Location`) | `PassthroughBackend`(spawn 그대로) | `__belmontSandboxBackend` → bwrap |
| 보안 저장소(`runNativeSecureStorageCommand`) | helper binding | helper binding(임베디드 win32-x64 자산) | `null` | `__belmontLinuxInstallation`(설치 키 파일) |
| 세션 키체인(`saveSessionToKeychain`) | 키체인 | Windows 보안 저장소 | 원본: 미지원 | installation-v2 저장 |
| 생체 인증(`resolveBiometryType`) | Touch ID | `windowsHello` | `none` | `none` |
| 폴더 선택(`pickDirectory`) | native | native, 없으면 `unavailable` | `unavailable` | 동일 |
| 파일 권한 | 규칙 | `windowsFullFileAccess`(full-access 모드) | 규칙 | 규칙 |
| 스킬 플랫폼(`currentSkillPlatform`) | `mac` | `windows` | `null` | `null` |
| 데스크톱 라벨(`getDesktopPlatform`) | `macos` | `windows` | — | `linux` 추가 |
| 셸 경로(`resolveShellPath`) | `$SHELL` 로그인 셸 | 건너뜀(pwsh) | `$SHELL` | `$SHELL` |
| 프리빌트 바인딩 이름 | darwin-universal/x64 | win32-x64 | 없음 | 없음 |

읽는 법: 원본은 지원 밖 플랫폼에서 **조용히 기능을 끄는** 쪽을 택했고, 우리는 끄지 않고 대체물을 넣었다. 대체물이 원본과 같은 인터페이스(backend 객체, 저장소 명령)를 쓰는지가 유지 기준이다.

## 4. 907 → 909 변경 (근거 있는 것만)

- **DB 마이그레이션 13·14·15**: `sessions.pinned_at`(고정 채팅), `session_runs` → `session_turns` + `turn_id` 인덱스("persist logical Turns and rename run projections"), `sessions`/`routines`의 브라우저 바인딩 "regular" → "default" 모드. 우리 `session.mjs`·`serve.mjs`가 `state.db`를 직접 읽는 곳이 있으면 전부 재확인 대상.
- **확장 연결 키에 `browserMode`**: `getConnectionKey(accountId, profileId, browserMode)`; 잘못된 값이면 `Invalid browser mode` 400. 우리 daemon-server(21420 대행)와 확장 등록 경로가 `default`를 넘겨야 한다.
- **이름 변경**: `startSessionRunMemoryBackfill`/`stop…` → `startSessionTurnMemoryBackfill`/`stopSessionTurnMemoryBackfill`(+ `runSessionTurnMemoryBackfill`). `session.mjs`(4곳), `patch-daemon.py` 내보내기 목록, `patch-daemon-active-workloads.py`(3곳) 수정 필요. `reconcileSessionTabs` 시그니처 변경(라이프사이클 패치 앵커 실패).
- **도구**: "Browsing History Search" 제거 → "History Search"(`history_search`, `from/to` 로컬 날짜, 페이지 크기), Context Awareness용 "Read History"·"Record summary" 도구, "Screen overlay (a dialog over the page)" 승인 분류, "Run code"/"Run command" 결과 라벨, `console.log(x: any)` REPL 안내.
- **Turn 단위 오류 문구**: "This Turn failed/has ended/was interrupted", "Turn not found" — 세션 상태 표기가 Turn 기준으로 바뀜(사이드바·Belmont 미러링 표기 영향 가능).
- **금고**: 조직 소유자/관리자만 금고 추가, sealed vault key, 다른 계정의 잔여 로컬 금고 폐기, 항목 이력은 클라우드 금고만.
- **채널·모델**: Telegram `/model`·`/effort`·세션 선택을 버튼으로("Pick a provider:", "Choose thinking effort:"), 공급자 LM Studio·Xiaomi MiMo·X/Twitter 문구, Free 플랜 루틴 한도.
- 제거된 문구: "Chrome extension not connected"/"Extension not connected"(연결 오류 표현 변경), "Context Awareness settings can only be changed from the Settings UI" 등.
- 심볼 확인: `AgentSession`·`AsideBrowser`·`CdpClient`·`globalCdpClient`·`globalExtensionBridge`·`ExtensionBridgeServer`·`SessionStore`·`AccountRegistry`·`recoverSuspensionsOnStartup`·`startRoutineScheduler`·`startContextAwareness`·`MemoryManager.searchMany`는 909에도 있다.

## 5. 우리 패치 체인을 909에 적용해 본 결과

| 도구 | 결과 |
|---|---|
| `patch-daemon-linux.py` (installation-v2) | 적용됨 |
| `patch-daemon.py` (6패치) | `902 memory UI date range` 앵커 0건으로 중단(메모리 라우터 입력 스키마 변경). 그 뒤 앵커는 미확인 |
| `patch-daemon-lifecycle.py` | `async function reconcileSessionTabs(Cn,ei){` 앵커 0건으로 중단 |
| `patch-daemon-active-workloads.py` | 앞 단계 실패로 미실행. `startSessionRunMemoryBackfill` 참조 3곳은 확실히 실패 |
| `src/session.mjs` | backfill 함수 이름 4곳 수정 필요, 마이그레이션 14·15 반영 확인 |

예상 작업: 앵커 재작업(반나절), 세션 저장소 Turn 스키마 대응과 browserMode(반나절), 907과 같은 검증(UPGRADE.md 6단계) + 전수 테스트 재실행. 주의: `patch-daemon-linux.py`는 **입력 파일을 제자리에서 덮어쓴다**(출력 인자 없음). 원본 사본을 먼저 만들 것. 이번에 그 때문에 909 mac 추출본 하나가 오염돼 다시 뽑았다.

## 6. 근거

- 구성요소·추출본: `data/artifacts/aside-909-20260909/` (`AsideDaemon-1.26.909.1820.crx`, `AsideDaemon-win-x64-1.26.909.1820.crx`, `AsideAgentManager-…`, `AsidePasswordManager-…`, `daemon-909-clean.mjs`, `daemon-909-win.mjs`, 풀어 둔 디렉터리)
- 보관본: `research-archives/aside/original/AsideDaemon-win-x64-1.26.909.1820.mjs` (LFS, artifacts.json 등록)
- 문자열 차이 목록: 세션 scratchpad `909-new-strings.txt`/`909-removed-strings.txt` (317 추가 / 60 제거)
- 업데이트 서버 응답: scratchpad `omaha-909.json`
