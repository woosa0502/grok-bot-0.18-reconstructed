# Aside 1.26.905.904 엔진 후보 분석 (2026-09-06)

상태: `candidate_extracted_not_installed` — 후보 파일만 만들었고 교체·설치·재시작은 하지 않았다.
분석 담당 모델: **Claude Opus 5 (1M context)** (모델 ID `claude-opus-5[1m]`).

## 결론 먼저

**조건부로 올려도 된다.** 902→905는 우리 서비스가 기대는 부분에서 사실상 변경이 없다.

- 우리 패치 6개(+리눅스 2개) **전부 앵커가 그대로 맞았다**. 정규식을 손볼 곳은 없었다.
- 서비스가 쓰는 데몬 내부 이름·함수 모양이 **전부 그대로**다. 격리 부팅도 통과했다.
- 905 확장이 부르는 `chrome.aside*` API 중 **포크에 없는 것은 0개**다. 824 확장이 부르던 것과 집합이 완전히 같다.
- tRPC 절차 215개, HTTP 경로 128개 — 902와 **차이 0**.

조건 세 가지:

1. 데몬 계정 홈을 **버전별로 새로 만든다**(`aside-home-905`). 905는 상태 DB 양식을 11 → 12로 올린다. 지금 쓰는 902 홈(양식 11, 세션 89개, `running` 2개)을 그대로 물리면 되돌리기 어렵다.
2. 905는 데몬이 켜질 때 **끊긴 실행을 되살린다**(902는 그냥 중단 처리했다). 되살리기가 우리 흐름과 부딪히는지 먼저 확인해야 한다. 아래 "위험 2" 참고.
3. 실제 브라우저 왕복 검증(`run.sh --engine 905`)은 **아직 안 했다**. 이건 오케스트레이터가 결정할 일이라 실행하지 않았다.

데몬과 확장은 **같은 버전끼리 묶여 있지 않아도 된다**. 확장↔데몬 계약(HTTP 경로, tRPC 절차, 확장 브리지 명령 스키마)이 902와 905에서 완전히 같기 때문에, 데몬만 올리든 확장만 올리든 계약은 깨지지 않는다.

---

## 1. 후보 파일 추출

CRX3 헤더(2,164바이트)를 잘라내고 zip을 풀어 `Aside Daemon.app`을 얻었다. 그 안의 Mach-O 실행 파일에서
`NODE_SEA` 세그먼트의 `__NODE_SEA_BLOB` 구역(파일 오프셋 104,673,280, 12,442,562바이트)을 떼어내고,
SEA 블롭 머리(경로 문자열 80바이트 + 길이 필드)를 지나 JavaScript 본문을 꺼냈다.

| 항목 | 값 |
|---|---|
| CRX | 61,208,783 B / `e6579c81…f39` (README의 값과 일치) |
| SEA 블롭 | 12,442,562 B / `04a2008e…c35` |
| 추출 JS | **10,560,725 B** / `d3cdc847…26b` |
| JS 끝 | `…export{createServer};` (902와 같은 경계) |
| `node --check` | Node **22.22.0 / 24.14.0 / 26.8.1 모두 통과** |
| 박힌 버전 문자열 | `1.26.905.904` 3곳 (`DAEMON_VERSION`, Codex `client_version`, `shouldReplaceExistingDaemon`) |
| 패치본 | `candidate/build/daemon.mjs` 10,563,528 B / `13b10b65…660` |

경로: `data/artifacts/aside_latest_engine_20260906/candidate/raw/AsideDaemon-mac-x64-1.26.905.904.mjs`

같은 방식으로 확장도 풀었다(파일 1,230개).

---

## 2. 패치 6개(+2) 적용 결과

원본 도구는 그대로 두고 `candidate/`에 복사본을 두었다. 복사본은 원본과 바이트 단위로 같다 —
**한 글자도 고칠 필요가 없었다.** 두 번 돌려도 같은 해시가 나온다.

| # | 패치 | 앵커 | 905 결과 |
|---|---|---|---|
| 1 | `globalCdpClient`이 `BELMONT_CDP_URL`을 봄 | `globalCdpClient=new CdpClient}` | 그대로 1회 일치 |
| 2 | 요소 스크린샷 `margin` 자리 버그 고침 | `` `function(margin) { `` | 그대로 1회 일치 (**윗물 버그가 905에도 남아 있다**) |
| 3 | `__belmont` 게터 붙이기 | 심볼 39개 조회 | 39/39 발견, 빠진 것 0 |
| 4 | `BELMONT_BROWSE_NO_BASH`로 셸 도구 빼기 | `createReadFileTool…createTerminalTool` | 그대로 1회 일치 |
| 5 | `memory_search` → 우리 FTS5 훅 | `MemoryManager.forAccount(…).searchMany(…)` | 그대로 1회 일치 |
| 6 | 리눅스 샌드박스 훅 | `createSandboxBackend` switch | 그대로 1회 일치 |
| 7 | `BELMONT_INSTALL_SIG_PUB`로 설치 인증 | `async function getPublicKeys(){` | 그대로 1회 일치 |
| 8 | `__belmontServer` 내보내기 | `serve=…createAdaptorServer`, ws | 그대로 1회 일치 |

`createSandboxBackend`는 902와 글자까지 같다(리눅스 backend는 905에도 없다). 6번이 여전히 필요하다.

로그: `candidate/logs/patch-apply.log`

---

## 3. 데몬 902 → 905, 서비스가 기대는 부분

### 3.1 전체 크기의 차이

줄 단위 해시 비교로 8,974줄 중 **41줄만 바뀌었다**. 함수 이름은 5개 추가, 사라진 것 0.
클래스 38개, `init_*` 2,384개 모두 그대로다.

새 함수: `composeVaultSnapshotRevision`, `getVaultRevisionStats`, `logFirstRunEvent`,
`vaultExistsLocally`, `withOpenCodeSessionHeaders`.

바뀐 41줄의 대부분은 우리와 무관한 곳이다 — 비밀번호 금고 동기화, 기억 파일 입출력의 동기→비동기 전환,
Slack 자격 확인 시간 제한, Gemini 모델 이름 재지정(3.7-flash → 3.8-flash).

### 3.2 서비스가 직접 쓰는 것

| 항목 | 902 | 905 | 판정 |
|---|---|---|---|
| `__belmont` 게터 39개 | 39 | 39 | 같음 |
| `session.mjs`가 부르는 초기화 12개 | `$` 번호 포함 전부 존재 | **본문까지 글자 단위로 같음** | 같음 |
| `SessionStore` 멤버 | 40 | 42 | **추가만** (`abortRunningSession`, `recordRunResumeAttempt`) |
| `SessionStore.insert/get/update/list/listAllMessages/listMessagesForAgentContext` | — | — | 같음 |
| `AgentSession.create(accountId, session, opts)` | 3인자 | 3인자 | 같음 |
| `AgentSessionServer` 공개 메서드 | 34 | 36 | **추가만** (`resumeRun`, `recoverInterruptedRuns`) |
| `steer/queue/abort/interrupt/handleCommand/removeQueuedMessage` 본문 | — | — | 비공개 필드 이름만 바뀜, 논리는 같음 |
| `GlobalAgentSessionServer` 선언 모양 | `var …,GlobalAgentSessionServer` + `=new AgentSessionServer(...)` | 같음 | 같음 |
| `resolveSuspension` / `getActiveSuspension` / `liveSuspensionRegistry` | — | — | 글자까지 같음 |
| 서스펜션 저장 방식 (`SessionStore.update(…,{suspension})`) | — | — | 같음 |
| `restoreCliBrowserBinding` / `resolveCliBrowserBinding` / `browserBinding` 스키마 | — | — | 글자까지 같음 |
| `globalExtensionBridge` · `ExtensionBridgeServer` 등록 | — | — | 글자까지 같음 |
| `ExtensionBridgeCommand` 스키마 4개 | — | — | 같음 |
| `startRoutineScheduler` | 30초 간격 | 같음 | 같음 |
| `memory_search` 호출 지점 | — | — | 글자까지 같음 (패치 5 그대로 통함) |
| `daemonAuthMiddleware` / `getPublicKeys` / `/auth/daemon/challenge` / "Aside Daemon Auth v1" | — | — | 글자까지 같음 |
| HTTP 경로 | 128 | 128 | **차이 0** |
| tRPC 최상위 라우터 27개 · 절차 215개 | 215 | 215 | **차이 0** |

`AgentSessionServer`의 비공개 필드 이름이 섞였다(`#s→#l`, `#c→#u`, `#l→#d`, `#h→#_`, `#r→#i` 등).
우리는 공개 메서드만 부르므로 영향이 없다. 다만 **비공개 필드 이름에 기대는 패치를 새로 만들면 905에서 깨진다.**

### 3.3 시그니처가 바뀐 곳 — 딱 두 군데

**(가) 데몬 시동 시 실행 복구.** 902는 `running`으로 남은 세션을 그냥 중단시켰다.

```
// 902  initializeSessionLifecycles
let ei=SessionStore.abortRunningSessions(Cn);
ei>0&&logger.debug(`[SessionLifecycle] Recovered ${ei} stale running session(s) after daemon restart (account ${Cn})`)

// 905
GlobalAgentSessionServer.recoverInterruptedRuns(Cn).catch(ei=>{
  logger.error(`[SessionLifecycle] Run recovery failed (account ${Cn})`,{error:String(ei)})})
```

새 `recoverInterruptedRuns(accountId)`는 `running` 세션을 전부 모아 `resumeRun`을 돌린다.
`resumeRun`은 `session_runs.resume_attempts`를 올리고 3회를 넘으면
`"The run could not be resumed after 3 server restarts."`로 접는다.

**(나) 상태 DB 양식 11 → 12.** 이주 12번이 `session_runs`에 `resume_attempts INTEGER NOT NULL DEFAULT 0`을
붙인다. 격리 홈에서 이주가 정상 동작함을 확인했다(양식 12, 열 14개).

그 밖에 눈에 띄는 동작 변화(우리와 직접 상관은 적음):

- `isCliSession`이 `trigger.client==='cli'`도 CLI로 본다. 우리는 `source:"belmont"`라 해당 없음.
- `remixSettingsSchema`가 기본값 `enabled:true`로 바뀌었다(사용자 스크립트 기능이 기본 켜짐).
- 비밀번호 금고 동기화에 쪽 넘김 상한 1,000쪽과 커서 정체 감지가 붙었다.
- 기억 파일 읽기·쓰기가 대부분 비동기로 바뀌었다(`existsSync`+`readFileSync` → `nodeFs.readFile().catch`).

---

## 4. 확장 902/824 → 905

### 4.1 manifest

| 항목 | 824 | 902 | 905 |
|---|---|---|---|
| version | 1.26.824.2151 | 1.26.902.1713 | 1.26.905.904 |
| permissions | 30개 | 32개 | 32개 (902와 동일) |
| 902/905에서 추가된 권한 | — | `scripting`, `userScripts` | 같음 |
| content_scripts | 본문 스크립트에 `all_frames:true` | 없음 | 없음 |
| 나머지 12개 항목 | — | — | 셋 다 동일 |

`chrome.userScripts`는 `background.js`에서 한 번만 쓰이고 `if (r)`로 감싸져 있다.
브라우저가 그 API를 안 내주면 조용히 건너뛴다.

### 4.2 `chrome.aside*` 호출 대조

네임스페이스는 정확히 6개 — `asideAccount`, `asideBrowserImport`, `asideBrowserPreferences`,
`asideMiniPopup`, `asideNotification`, `asideOmnibox`. 포크가 구현한 것과 같다.
(`asideModelCatalog`, `asideSurface`, `asideAuthCallback` 등은 설정 키·DOM 속성이지 확장 API가 아니다.)

| 대조 | 개수 |
|---|---|
| 포크 구현 (`chrome/common/extensions/api/aside_*.json`) | 함수 **77개** + 이벤트 **20개** |
| 905 확장이 부르는데 **포크에 없는 것** | **0개** |
| 824 대비 **새로 부르는 것** | **0개** |
| 824 대비 **없어진 것** | **0개** |
| 시그니처가 달라진 것 | **0개** (호출 자리 문자열이 824와 동일) |
| 포크가 구현했지만 905가 안 부르는 것 | 57개 (그중 26개는 번들에 이름은 있음 — 간접 호출) |
| manifest의 `at.studio.Aside.ext.private.*` 권한 7개 | 7/7 포크에 등록됨 |

표: `analysis/ext-aside-api-matrix.csv` / `.json`

### 4.3 파일 구성

이름의 내용 해시를 지우고 비교했을 때:

| 비교 | 추가 | 삭제 |
|---|---|---|
| 902 → 905 | 5 | 3 |
| 824 → 905 | 121 | 101 |

902→905는 `use-browser-importer.js`, `routes.js`, `pending-component.js`와 그림 2개가 전부다.

---

## 5. 스킬 61개

905 꾸러미의 `Resources/static/skills/builtin`과 우리 `vendor/aside-902/apps/daemon/src/skills/builtin`을
`diff -rq`로 비교 → **차이 0줄**, 양쪽 61개 파일. 어젯밤 결과와 같다.
(`SKILL.md`는 50개, 902와 같다.)

---

## 6. 격리 부팅 검증

`candidate/probe-905-daemon.mjs` — 별도 홈, CDP를 죽은 포트(65534)로, `ASIDE_API_URL`을 127.0.0.1:9로.
살아 있는 크롬·데몬·서비스는 건드리지 않았다.

| 항목 | 결과 |
|---|---|
| 초기화 12개 | 9개 호출됨, 3개 부재(`init_store$3`, `init_store$1`, `init_skills$5`) — **902 실물과 같다**(패치 도구가 원래 안 내보낸다. `session.mjs`가 `?.()`로 부른다) |
| 로컬 계정 | id 0 / mode `local` 생성 |
| 상태 DB | 새로 만들고 양식 **12**까지 이주 |
| 내장 스킬 동기화 | **61개 파일** |
| 세션 레코드 | 생성됨(status `idle`) |
| `__belmont` 게터 중 서비스가 쓰는 13개 | 전부 존재 |
| `__belmontServer` | `serve`, `WebSocketServer`, `createServer` 셋 다 |
| `SessionStore` 메서드 10개 | 전부 함수 |
| `GlobalAgentSessionServer` | **없음** — 902 실물과 같다(아래 7장) |

로그: `candidate/logs/isolated-probe-905.log`

---

## 7. 다른 담당이 902에 넣고 있는 수정이 905에서도 통하는가

**넷 다 통한다.** 근거는 이렇다.

| 수정 | 905에서 필요한 것 | 상태 |
|---|---|---|
| `GlobalAgentSessionServer`를 `__belmont`로 노출 | 최상위 바인딩이고 `GlobalAgentSessionServer=new AgentSessionServer({…})` 모양 | 902와 **같음**. 패치 도구의 존재 확인 정규식 `(?<![\w$.])이름(?=[=,;(])`에도 그대로 걸린다 |
| 큐 취소 | `AgentSessionServer.removeQueuedMessage(a,s,id)`, tRPC `sessions.removeQueuedMessage` | 둘 다 **존재**, 본문 동일(비공개 필드 이름만 다름) |
| 실행 중 continue → steer | `steer(a,s,msg)` / `queue(a,s,msg)` / `handleCommand` 안의 `isStreaming` 분기 | **본문 동일** |
| 서스펜션 복구 | `recoverSuspensionsOnStartup`, `resolveSuspension`, `getActiveSuspension`, `liveSuspensionRegistry`, `SessionStore.update(…,{suspension})` | **전부 글자까지 동일** |

주의 두 가지:

1. **비공개 필드에 기대지 말 것.** `#s`, `#c`, `#l`, `#h`, `#r`이 905에서 각각 `#l`, `#u`, `#d`, `#_`, `#i`로 바뀌었다.
   902에서 비공개 필드 이름을 앵커로 쓴 패치는 905에서 조용히 안 맞는다(정규식이 0회 일치 → assert로 멈추면 다행, 아니면 무음 실패).
2. **시동 복구가 겹칠 수 있다.** 905는 이미 `recoverInterruptedRuns`로 `running` 세션을 되살린다.
   우리 서스펜션 복구가 같은 세션을 또 건드리면 중복 실행이 될 수 있다. 902에 만든 복구 로직을 905로 옮길 때
   `SessionStore.listFull(a,{statuses:['running']})` 결과가 이미 되살아나는 중인지 먼저 봐야 한다.

---

## 8. 교체 위험도

### 데몬만 905로 (확장은 824 유지)

| 위험 | 정도 | 근거 |
|---|---|---|
| 확장↔데몬 계약 깨짐 | **없음** | HTTP 128개, tRPC 215개, 브리지 스키마 4개 모두 902와 차이 0. 824 확장이 부르는 경로 21개도 전부 그대로 |
| 상태 DB 되돌리기 불가 | **중간** | 양식 11 → 12. 새 홈(`aside-home-905`)을 쓰면 없어짐 |
| 시동 시 실행 재개 | **중간** | 위 3.3(가). 새 홈이면 되살릴 세션 자체가 없어 첫 전환에선 문제 없음 |
| 패치 안 맞음 | **없음** | 8개 전부 1회 일치 확인 |
| 리눅스에서 못 도는 부분 | **없음(902와 동일)** | 아래 참고 |

### 확장만 905로 (데몬은 902 유지)

| 위험 | 정도 | 근거 |
|---|---|---|
| 포크에 없는 API 호출 | **없음** | 0개. 824가 부르던 것과 집합이 완전히 같다 |
| 새 권한(`scripting`, `userScripts`) | **낮음** | 둘 다 표준 크롬 권한. `chrome.userScripts`는 `if` 로 감싸져 있어 없으면 건너뜀 |
| 데몬 계약 | **없음** | 905 확장이 부르는 경로·절차가 902 데몬에 전부 있음 |
| 본문 content script의 `all_frames` 없어짐 | **낮음** | 824에만 `all_frames:true`가 있었다. 902 확장도 이미 없으므로 새 회귀는 아니다. iframe 안 페이지에서 내용 스크립트가 안 붙는 차이가 생길 수 있음 |
| 빌드 도구 | **확인 필요** | `tools/build-aside-ext.mjs`가 824 구조를 전제하는지 안 봤다 |

### 둘 다 905로

위 두 표의 합. 새로 생기는 위험은 없다. 오히려 같은 릴리스끼리 묶이므로 계약 위험이 가장 낮다.

### 리눅스에서 못 쓰는 부분 (902 때와 같은가)

| 파일 | 종류 | 902 처리 | 905 |
|---|---|---|---|
| `Contents/MacOS/aside-daemon` | Mach-O x86_64, 158,920,928 B | 안 씀 (JS 본문만 꺼내 씀) | **같음** |
| `Resources/native/aside-native.node` | Mach-O x86_64, 9,842,672 B | 안 씀. 번들이 늦게 `require`하고 실패하면 넘어감 | **로드 경로 문자열까지 같음** |
| `Resources/native/moss-core.node` | Mach-O x86_64, 10,151,216 B | 위와 같음 | **같음** |
| `Aside Computer Use.app` | Mach-O x86_64, 2,096,880 B | 안 씀 (macOS 전용 도우미) | **같음** |
| `Applications/Aside Password Importer.app` | macOS 앱 | 안 씀 | **같음** |

격리 부팅이 이 다섯 개 없이 통과했다는 것이 실증이다. 902 REPORT의 판단이 905에도 그대로 적용된다.

---

## 9. 확인하지 못한 것

- **실제 브라우저 왕복(E2E)을 하지 않았다.** `run.sh --engine 905`도, `serve.mjs` 전환도 안 했다.
  걸음 수·오류 수를 902와 비교한 표가 없다. 교체 권고는 이 검증을 전제로 한 "조건부"다.
- **905 확장을 포크 크롬에 실제로 붙여 보지 않았다.** API 대조는 정적 분석이다.
  간접 호출(별칭을 함수 인자로 넘기는 형태)까지 전부 따라가지는 못했다. 다만 `chrome.aside*`로 시작하는
  네임스페이스가 6개뿐이고 그 6개가 포크 구현과 일치하므로, 빠진 API가 있을 여지는 작다.
- **함수 출력 필드 수준의 대조는 안 했다.** 이름과 인자 개수만 봤다. 포크가 돌려주는 필드가 905 확장의
  기대와 어긋나는지는 `DIFFERENTIAL.md`의 계약 테스트를 905 확장으로 다시 돌려야 안다.
- **`tools/build-aside-ext.mjs`가 905 확장 구조를 받아들이는지 안 봤다.**
- macOS 실기에서의 동작은 902 때와 마찬가지로 확인 대상이 아니다.

---

## 10. 다음 작업 순서 (제안)

1. `src/session.mjs`의 `ENGINES`에 `"905": { bundle: "../vendor/aside-905/apps/daemon/build/daemon.mjs", home: "aside-home-905", version: "1.26.905.904" }` 추가. **홈은 반드시 새 폴더.**
2. `vendor/aside-905/apps/daemon/{build/daemon.mjs, src/skills/builtin}` 배치
   (`candidate/build/daemon.mjs`와 `candidate/apps/daemon/src/skills/builtin`을 그대로 복사).
3. `./run.sh --engine 905 --task "https://example.com 제목"` → 부산 날씨 → 구글 콘솔. 902 표와 비교.
4. `--mode guard`로 승인 흐름 1회 (패치 4·6과 서스펜션 경로 확인).
5. 다른 담당의 902 수정(큐 취소·steer·서스펜션 복구·`GlobalAgentSessionServer` 노출)을 905에 얹고,
   `recoverInterruptedRuns`와 겹치지 않는지 확인.
6. 905 확장을 시험 프로필에 붙여 `DIFFERENTIAL.md`의 계약 테스트 62개를 다시 돌린다.
7. 통과하면 `BELMONT_BROWSE_ENGINE=905`로 `serve.mjs` 재시작.

---

## 만든 파일

```
data/artifacts/aside_latest_engine_20260906/
  candidate/
    raw/AsideDaemon-mac-x64-1.26.905.904.{sea,mjs}     추출 SEA 블롭 / JavaScript
    raw/daemon-1.26.905.904/                            CRX 푼 것 (앱 번들, 스킬 61개)
    raw/agent-manager-1.26.905.904/                     확장 푼 것 (파일 1,230개)
    build/daemon.mjs                                    패치 8개 적용본
    apps/daemon/{build/daemon.mjs, src/skills/builtin}  SOURCE_ROOT 규칙에 맞춘 배치
    patch-daemon.py, patch-daemon-linux.py              원본 도구 복사본 (수정 없음)
    probe-905-daemon.mjs                                격리 부팅 검사기
    probe-home/, workspace/, probe-knowledge/           검사기가 만든 격리 홈
    logs/{patch-apply,isolated-probe-905,skills-diff,line-delta-trimmed,sha256}.*
  analysis/
    daemon-identifier-diff-902-905.json                 최상위 식별자 차이
    daemon-trpc-procedures.json                         라우터 27개 · 절차 215개 (902/905)
    fork-implemented-aside-apis.json                    포크 구현 77함수 + 20이벤트
    ext-aside-api-matrix.{csv,json}                     확장 호출 × 포크 구현 대조표
    ext-aside-namespace-members.json                    824/902/905 네임스페이스별 멤버
```
