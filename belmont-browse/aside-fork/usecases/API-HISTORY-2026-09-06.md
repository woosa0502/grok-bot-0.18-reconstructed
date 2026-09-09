# Aside 데몬·확장 24개 버전 API 시간표 (2026-09-06)

분석만 함. 설치·교체·실행 없음. 살아 있는 호스트·크롬·데몬·포트에 접근하지 않았다.
원자료와 도구: `/home/hoon/_roots/labs/work/Belmont/data/artifacts/aside_component_history_20260906/`

---

## 결론 먼저

**1. 포크의 API 목록은 어느 확장 버전에서 뽑은 것이 아니다. 24개 버전 전부를 덮는 상위 집합이다.**

포크가 선언한 것은 6 네임스페이스 · 함수 77 · 이벤트 20 = 멤버 97개다.
확장이 실제로 부르는 멤버는 가장 많을 때도 63개다. **24개 버전 중 어느 것도 포크에 없는 API를
부르지 않는다.** 즉 "포크 목록과 정확히 일치하는 버전"은 없고, 대신 **전 버전이 포크 안에 들어간다**.
이것은 `DIFFERENTIAL.md` 50행("바이너리 임베드 스키마와 일치")과 맞는다 — 목록의 출처는 확장이
아니라 브라우저 바이너리다. 바이너리는 DMG 1.0.825.1(내장 데몬·확장 1.26.824.2151)에서 나왔으니,
**목록의 기준점은 확장 1.26.824.2151 시점의 브라우저**다.

**2. 그 뒤 확장이 새로 부르기 시작한 API는 8개뿐이고, 8개 모두 포크에 이미 있다.**

**3. 지금 조합(확장 1.26.824.2151 + 데몬 1.26.902.1713)에 API 불일치는 없다.**
확장이 부르는 tRPC 경로 225개가 데몬 902.1713의 프로시저 318개 안에 전부 있다.
확장 API 61개도 전부 포크 안에 있다.

**4. 905.904로 올려도 포크에 새로 만들 API는 없다.** 벨몬트 데몬 패치 8개도 905에 그대로 붙는다
(앵커 8/8, 빠진 내보내기 심볼 0, `node --check` 통과).

---

## 받은 것

| | |
|---|---|
| 버전 수 | 24개 (1.26.804.1737 ~ 1.26.905.904) |
| 확장 | CRX3 → zip → `ext/<버전>/` |
| 데몬 | Mach-O `NODE_SEA/__NODE_SEA_BLOB` → `daemon/<버전>.mjs`, **24/24 `node --check` 통과** |
| 내장 스킬 | `skills/<버전>/skills/builtin/` |
| 추가 대조군 | 확장 1.26.824.2151 (우리 vendor 사본; CDN에 없다) |

추출 방법은 905를 푼 다른 담당의 결과와 **바이트 단위로 같다**(1.26.905.904 JS 10,560,725 바이트).
CRX 48개의 sha256·크기는 `raw/checksums.txt`.

---

## 1. 확장 비공개 API 시간표

세는 방법: acorn으로 파싱해 `chrome.aside*`가 흘러간 곳을 스코프 단위로 추적했다.
번들이 청크로 쪼개져 있어 `const C = () => chrome.asideBrowserPreferences` 같은 도우미가 다른
파일에서 import되므로, ES 모듈 import/export를 실제 내보내기 이름으로만 이어 붙여 전파했다
(이름 추측 금지). catch 인자·함수 인자 가림도 처리했다. 동적 `chrome[변수]` 접근은 0건이었다.

| 버전 | 부르는 멤버 | 변화 |
|---|---|---|
| 1.26.804.1737 ~ 1.26.822.2145 (13개) | 54 | 기준선. 네임스페이스 5개 |
| **1.26.824.1341** | **60** | `asideMiniPopup` 등장(+hide, pickDirectory, setOptionWindowSize, setState, switchProfile) · `asideAccount.getProfiles` |
| 1.26.824.1718 / 1.26.824.1930 | 60 | 변화 없음 |
| **1.26.824.2151 (우리 vendor)** | **61** | `asideMiniPopup.setSize` |
| **1.26.826.1414** | **63** | `asideMiniPopup.getShortcut`, `asideMiniPopup.setShortcut` |
| 1.26.827.1029 ~ **1.26.905.904** (8개) | **63** | **변화 없음** |

즉 **2026-08-26 이후 확장의 비공개 API 사용은 멈춰 있다.** 905.904도 826.1414와 같은 63개다.

### 포크 대조

| | 개수 |
|---|---|
| 포크가 선언 | 97 (함수 77 + 이벤트 20) |
| 어느 버전이든 한 번이라도 부름 | 63 |
| **아무 버전도 부르지 않음** | **34** |
| 포크에 없는데 확장이 부름 | **0** (전 버전) |

부르지 않는 34개는 거의 다 옴니박스다: `activateMetricsFunnel, addTabContext, clearFiles,
deleteContext, getInputState, getPlaceholderConfig, getRecentTabs, getSearchEngines, getTabPreview,
setActiveModelMode, setActiveToolMode, submitQuery` + 이벤트 17개
(`onAim*`, `onThumbnail*`, `onTabStripChanged`, `onNavigationLikely` 등),
그리고 `asideBrowserImport.cancelImport`, `asideBrowserPreferences.{getKeepTasksRunningState,
setKeepTasksRunningEnabled, getSyncStatus}`, `asideMiniPopup.{getEnabled, setEnabled}`.

**DIFFERENTIAL.md 99행과의 차이(정직하게 기록):** 그 문서는 "확장이 실제 소비하는 모든 함수(75개)"라고
적었다. 내 계측은 63개(함수+이벤트)다. 세는 방법이 다르다 — 나는 수신자가 `chrome.aside*`로
확인되는 접근만 셌다. 토큰이 파일 어딘가에 나타나기만 해도 세면 65개다. 두 방법 어느 쪽도 75에
닿지 않는다. 어느 쪽이 맞는지는 그 문서의 계측 방법을 봐야 판정할 수 있다. 다만 **"포크에 없는 API를
확장이 부른다"는 사례는 어느 세는 법으로도 0건**이므로, 이 차이가 포크의 완결성 판정을 바꾸지는 않는다.

### manifest 변화 (버전 두 곳뿐)

| 전환 | 변화 |
|---|---|
| 824.1341 → **824.1718** | 권한 `at.studio.Aside.ext.private.launch-extension` 추가 |
| 831.1513 → **902.847** | 권한 `scripting`, `userScripts` 추가 · content script의 `all_frames: true` 제거 |

**주의 — 실제 위험 하나.** 포크의 `_api_features.json`은 `asideMiniPopup`을
`permission:at.studio.Aside.ext.private.launch-extension`에 매어 두었다. 그런데 확장이
`asideMiniPopup`을 **부르기 시작한 것은 824.1341**이고, 그 manifest에는 그 권한이 **없다**.
824.1341 ~ 824.1930 세 버전을 포크에 올리면 `chrome.asideMiniPopup`이 `undefined`가 된다.
우리 vendor 824.2151과 826 이후는 권한이 있으므로 문제없다.

### 파일 추가

| 버전 | 새 파일 |
|---|---|
| 810.1916 | `CRISP-LICENSE.txt` |
| 821.53 | `newtab-early-input.js` |
| 824.1341 | `minipopup.html`, `minipopup-options.html` |
| 902.847 | `remix.js` |

---

## 2. 데몬 API 시간표

원자료 `analysis/daemon-<버전>.json`, 증감표 `analysis/daemon-api-timeline.{json,csv}`.

| 표면 | 804.1737 | 905.904 |
|---|---|---|
| tRPC 프로시저 | 259 | 317 |
| HTTP 라우트 | 85 | 112 |
| 확장 브리지 명령(`Aside.*`) | 26 | 30 |
| SessionStore 메서드 | 30 | 38 |
| Aside 클래스 | 56 | 66 |
| SQLite 테이블 | 22 | 28 |
| 에이전트 도구 | 16 | 16 (불변) |
| 서스펜션 종류 | 3 | 3 (불변) |

### tRPC — 큰 사건만

| 버전 | 일어난 일 |
|---|---|
| 806.238 | `meta.*`(copyFile/listOpenApps/openWith/resolvePath), `sessions.files.{delete,rename}`, `sessions.listRuns` |
| 815.2155 | `settings.{get,set,reset}CompletionSound` |
| 820.1844 | `agentRuntime.{install,job,status}`, `fullDiskAccess.{check,request}`, `sync.{status,resolveConflict}` |
| 824.1341 | `capture.{fullPage,viewport}` |
| 826.1414 | `remoteControl.{enable,disable,status}`, `sessions.{share,shareStatus,unshare}` |
| **902.847** | **비밀번호 관리자 대수술** — `passwordManager.*` 하위가 최상위 라우터로 흩어졌다(`vault`, `cipher`, `search`, `settings`, `import`, `sync`, `auditLog`). 동시에 `contextAwareness.*` 20개 신설, `memory.search` 신설, `models.{listAsideModelIds,searchAsideModels,setAsideModelIds}` |
| 902.1713 | `sessions.{queue,steer,moveToProject}`, `developers.refreshAsideBrowserSkills` |
| 903.1631 / 905.904 | tRPC 변화 없음 |

902.847의 이름 바뀜은 **경로만 바뀌고 내용은 남았다**. 예: `passwordManager.auth.biometricEnroll`은
`biometricAuthProcedures`라는 객체로 빠져나가 라우터에 펼쳐 넣는(spread) 방식이 되었을 뿐, 사라지지
않았다. 그래서 확장의 호출 경로는 그대로 맞는다.

### HTTP 라우트

`/auth/daemon/{challenge,verify,session}`, `/extension`, `/event-bus`, `/health`는 **24개 버전 전부에서
한 글자도 안 바뀌었다.** 우리 Linux 설치키 인증 패치(patch 7-8)가 905까지 유효한 근거다.

늘어난 것: 810.1916 `POST /stt/transcribe`; 820.1844에 OpenAI 호환 조직/영상 라우트 22개;
902.847 `GET /session/for-chrome/:sessionId/state`; 902.1713 `GET /session/for-chrome/projects`,
`POST /session/for-chrome/:sessionId/move-to-project`.

### 확장 브리지 명령 (`Aside.*`)

| 버전 | 추가 |
|---|---|
| 810.1916 | `Aside.playNotificationSound`, `Aside.resolveBindingWindow` |
| 815.2155 | `Aside.applePasswords.saveLogin` |
| 824.1341 | `Aside.openProfileUrl` |

826 이후 **변화 없음**. 프로토콜 스키마(`ExtensionBridgeProtocol` 11개: register/registered/ping/
runCommand/cancel/route 등)는 24개 버전 내내 동일하다.

### 세션 저장소

`sessions` 테이블 30개 칸(`browserBinding`, `permissionMode`, `suspension`, `routineId`,
`channelRouteKey`, `queuedMessages`, `steeringMessages`, `toolState`, `trigger` 등)은
**24개 버전 내내 변하지 않았다.** `session_runs`만 905.904에서 `resumeAttempts` 한 칸 늘었다.

`SessionStore` 메서드 증가: 806 `listRuns` → 818 `claimEphemeralForPurge`/`releaseEphemeralPurge`
→ 826 `listRunsForFeedback` → 831 `restore` → 902.847 `adoptMirrorState`
→ **905.904 `abortRunningSession`, `recordRunResumeAttempt`**.

`AgentSessionServer`(= GlobalAgentSessionServer 실체): 818 `hasLiveActivity` → 826
`refreshLoadedSessionModel`/`refreshLoadedSessionPolicy` → **902.1713 `queue`, `steer`, `isLoading`**
→ **905.904 `recoverInterruptedRuns`, `resumeRun`**.
`AgentSession`: 826 `applyExecutionModel`, 827 `hostDefaults`(static), **905.904 `resumeAfterCrash`**.

즉 **905의 새 이야기는 "죽었다 살아나기"다** — 중단된 run 복구·재시도 카운트.

### 서스펜션·도구·루틴·기억

- 서스펜션 종류는 3개로 고정: `action-confirmation`, `approval`, `ask-user-question`.
- 에이전트 도구 이름 16개 고정: `ask_user_question, bash, browsing_history_search, edit_file,
  get_time, memory_search, notification, read_file, repl, routine_update, subagent, subagent_wait,
  webfetch, websearch, write_file, write_todos`. 도구 **공장 함수**만 818.1059에서
  `createTerminalTool`·`createPowerShellTool`로 갈렸다(그전에는 bash 전용).
- 루틴 스케줄러: **820.1844에서 갈아엎었다.** `workflowsSchedules*` 8개 함수가 통째로 사라지고
  `syncRoutines`/`toCloudRoutine`/`putRemoteRoutine`/`listRemoteRoutines`/`deleteRemoteRoutine`/
  `applyCloudRoutine`이 들어왔다(클라우드 동기화로 이전). 902.1713에 `reassignHeartbeatRoutines` 추가.
- 기억 검색: `MemoryManager.searchMany`와 tRPC `memory.search`는 **902.847에 처음 생겼다.**
  그 전에는 Moss 클라우드 경로뿐이다. 우리 patch 5(오프라인 FTS5 대체)가 902/903/905에만 붙고
  그 이전 번들에는 안 붙는 이유가 이것이다. 812.1644에 `MemorySearchUnavailableError`가 먼저 생겼고,
  810.1916에 `session_run_memory_extractions`·`memory_history_projection_state` 테이블이 들어왔다.
- 리눅스 샌드박스: `LinuxSandboxBackend` 클래스는 831.1513까지 있다가 **902.847에서 삭제됐다.**
  우리 patch 6(`globalThis.__belmontSandboxBackend`)이 필요한 정확한 이유이자 시점이다.
- `context-awareness`(화면 관찰) 전체가 902.847에 들어왔다: tRPC 20개, 테이블 4개,
  `NativeContextAwarenessHelperManager` 클래스, 스킬 1개.
- 원격 제어(`RemoteControlService`/`Mux`/`RelayClient`/`EnvelopeReassembler`)는 826.1414에 신설.

### 내장 스킬

| 버전 | 변화 |
|---|---|
| 804.1737 | 기준선 30개 (`tax`가 PDF 폼 180여 개를 끌고 있었다) |
| 812.1644 | `tax` 삭제 → 파일 236 → 55개로 급감 |
| 813.1554 | `proton-pass` 추가 |
| 820.1844 | `imagegen` 추가 + 스킬 22개 본문 일괄 개정 |
| 824.1341 | `imessage` 추가 → 824.1930 잠깐 제거 → 826.1414 복귀 |
| 829.1514 | `kakaotalk`, `onboarding` 추가 |
| 902.847 | `context-awareness` 추가 (총 35개, 905까지 동일) |

---

## 3. 지금 조합 점검 — 확장 824.2151 + 데몬 902.1713

28쌍(같은 버전 24쌍 + 우리 조합 4쌍)을 대조했다. 결과: **진짜 불일치 0건.**

| 짝 | 확장이 부르는 tRPC 경로 | 데몬 프로시저 | 없는 것 |
|---|---|---|---|
| 824.2151 + 824.1930 | 225 | 284 | 0 |
| **824.2151 + 902.1713 (지금)** | **225** | **318** | **0** |
| 824.2151 + 905.904 | 225 | 318 | 0 |
| 905.904 + 905.904 | 227 | 318 | 0 |

(도구 출력에는 3건이 "없음"으로 찍히는데, `options`라는 낱말 하나와 `trpc.` 접두사가 붙은 채로 뽑힌
두 경로다. 실제로는 `settings.getAll`·`models.listSettingsInventory`로 데몬에 다 있다. 추출 잡음이다.
표의 318은 공개 경로로 펼친 수, 위 데몬 표의 317은 라우터·프로시저 쌍의 수다. 차이 1은
`passwordManager.downloadAttachment` — 라우터가 아니라 프로시저를 직접 매단 자리다.)

확장 API 쪽도 61개 전부 포크 안에 있다. 브리지 명령도 824 확장이 처리하는 것과 902 데몬이 보내는 것이
어긋나지 않는다(902 데몬의 브리지 명령 30개는 824.1341 이후로 하나도 안 늘었다).

**데몬 902.1713에는 824 확장이 안 쓰는 프로시저가 109개 있다.** 이건 불일치가 아니라 여유분이다
(비밀번호 관리자 vault/cipher, contextAwareness 등 — 새 확장이 쓸 것들).

---

## 4. 905.904로 갈 때

**포크에 새로 만들 확장 API는 없다.** 905가 부르는 63개는 전부 포크의 97개 안에 있다.
우리 vendor 824.2151(61개)과 905(63개)의 차이는 `asideMiniPopup.getShortcut` /
`asideMiniPopup.setShortcut` 두 개뿐이고, 둘 다 포크의 `aside_mini_popup.json`에 이미 선언돼 있다.

벨몬트 데몬 패치를 905.904 JS에 실제로 돌려 봤다(작업 폴더 안 사본, `belmont-browse/`는 안 건드림):

| 패치 | 905.904 |
|---|---|
| 1 CDP URL / 2 스크린샷 인자 버그 / 4 bash 옵트아웃 / 5 memory_search / 6 샌드박스 백엔드 / 7 설치키 공개키 / 8 serve·WebSocket | **앵커 8/8 정확히 1회** |
| `__belmont` 내보내기 심볼 56개 | **빠진 것 0개** |
| `node --check` | **통과** |

결과물: `analysis/patch-test/out.mjs`.

패치 앵커를 24개 버전 전부에 대 봤다(`raw` 아님, 계측 결과):

| 앵커 | 붙는 버전 |
|---|---|
| 1 CDP, 2 스크린샷, 7 공개키, 8b WebSocket | 804.1737부터 전부 |
| 4 bash 옵트아웃, 6 샌드박스 | **818.1059부터** |
| 8a serve | **831.1513부터** |
| 5 memory_search | **902.847부터** |

즉 벨몬트 데몬 패치 묶음은 **902.847 이상에서만 온전히 붙는다.** 905.904는 그 조건을 만족한다.

### 905로 갈 때 확인해야 할 것 (API 아닌 부분)

- `AgentSessionServer.recoverInterruptedRuns` / `resumeRun` / `AgentSession.resumeAfterCrash`가
  905에서 새로 생겼다. 우리 러너가 `startRun/waitForIdle/steer/abort`로 세션을 몰고 있으므로,
  데몬이 부팅 때 중단된 run을 스스로 되살리려 들 수 있다. 실측 필요.
- `session_runs.resumeAttempts` 칸이 늘었다 → 상태 DB 마이그레이션이 한 번 돈다.
- 확장을 905.904로 같이 올릴 경우에만 `asideMiniPopup.{get,set}Shortcut` 경로가 실제로 쓰인다.
  포크 구현이 이미 있으니 값·형식이 맞는지만 보면 된다.

---

## 5. 못 한 것 / 한계

- **실행 검증 없음.** 데몬 JS는 `node --check`(구문)만 했다. 어떤 버전도 띄우지 않았다.
- **확장은 난독화 번들이다.** "부르지 않는다"는 판정은 정적 분석의 한계 안에 있다.
  주 계측은 스코프 정확한 AST + 모듈 import 해석(63개)이고, 독립된 두 번째 방법(수신자 토큰이
  `chrome.aside*`에 묶였는지 보는 선형 스캔)은 그 부분집합만 찾았을 뿐 **AST가 놓친 것을 하나도
  더하지 못했다**. 낱말이 파일에 나타나기만 해도 세는 느슨한 상한은 65개다. 그러니 참값은 63~65
  사이다. 동적 `chrome[변수]` 접근은 24개 버전 전부 0건이었다. `eval`이나 문자열 조립 접근이
  있다면 놓친다.
- **함수 시그니처(인수 형태)는 부분만.** 호출 지점의 인수 원문을 `analysis/ext-ast-<버전>.json`에
  담았지만, 24개 버전 전체에 대한 시그니처 변화 표는 만들지 못했다. 멤버 집합이 826 이후 고정이라
  우선순위를 낮췄다.
- **데몬 클래스 비공개 메서드는 이름이 난독화돼 있다**(`#Be`, `#He` 등). 개수 변화는 시간표에
  들어 있지만 무슨 일을 하는지는 안 봤다.
- **`asideMiniPopup` 권한 구멍(824.1341~824.1930)은 코드로 확인했을 뿐 실제로 로드해 보지 않았다.**
- 브라우저 바이너리(aside-arm64.bin)와 대조하지 않았다. 포크 목록의 출처가 바이너리라는 것은
  `DIFFERENTIAL.md`의 기존 기록에 의존한 판단이다.
