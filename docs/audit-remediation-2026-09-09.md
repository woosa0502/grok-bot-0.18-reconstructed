# 감사 지적 사항 조치 기록 — 2026-09-09

기준: 외부 감사 보고서(main `c8e2079` 기준, GPT Pro 작성)의 결함 F01~F07과 작업 묶음 WP1~WP8. 이 문서는 무엇을 고쳤고 무엇이 남았는지를 커밋·테스트·CI 근거와 함께 적는다. **전체 parity 완료 선언이 아니다.**

브랜치: `fix/audit-remediation` (main `c8e2079` 위). 각 항목의 근거는 커밋과 CI run 번호다.

## 결과 요약

| 결함 | 상태 | 커밋 | 근거 |
|---|---|---|---|
| F02 clean-checkout CI 실패 (16 fail / 11 skip) | **해결** | `a42358f`, `a0c4889` | run 34307808982 success. root 997/995/0 fail/2 skip, 모바일 151/149/0 fail/2 skip |
| F04 Aside stop 실패 무시 | **해결** | `f53156b` | 중단 의도를 먼저 durable 저장, 서비스 확인 전엔 성공 선언 안 함, 실패 시 사용자 알림·재시도·새 작업 차단. 테스트 4건 |
| F05 timestamp cursor로 인한 메시지 유실 | **해결** | `f53156b` | 메시지 identity 기반 dedup + 되돌아보기 창, 메시지마다 atomic 저장, 손상 link는 격리·명시 복구. 테스트 6건 |
| F06 host 종료 시 정리 생략·exit 0 | **해결** | `f53156b` | `runCleanupSteps`로 모든 단계 시도, 단계별 timeout, 실패 시 exit 1. 시작 실패 경로도 같은 방식으로 되감기. 테스트 5건 |
| F03 Claude 경로 tool 미전달·비스트리밍 | **부분 해결 → 종결(사용자 미사용)** | `a4b7acf` | 부분 메시지 스트리밍 구현, tool 미지원을 명시(경고·capability·strict 모드), Claude/OpenRouter 전용 계정 readiness. **host tool loop를 Claude CLI에 넘기는 bridge는 미구현** |
| F07 Docker image mutable 태그 | **해결** | `82fdc99`, `99adb66` | manifest digest `sha256:6295e3ac…`로 고정, 컨테이너 라벨·상태에 digest, 옛 태그 컨테이너는 schema bump처럼 교체 |
| F01 native binary ↔ snapshot 계보 미확인 | **해결(launcher 범위)** | `82fdc99` | `native-build-identity.mjs`가 binary sha/mtime·snapshot 입력 hash·pinned daemon을 기록·검증, `run-fork.sh`가 실행 전 검증. 부정 대조 테스트 3건 |

부수 항목: 모바일 검사 2실패(감사 밖) 해결 `a0c4889`; `isReady` Cursor/Codex 편중 해결 `a4b7acf`; packaging 계약 테스트 갱신 `99adb66`.

## 작업 묶음 상태

| WP | 상태 | 비고 |
|---|---|---|
| WP1 CI 정상화 | 완료 | ffmpeg·poppler 설치, belmont-browse `npm ci`, `bootstrap:aside`(LFS 원본 2 + patched 2, sha 검증), 원본 경로 helper. browser 하위 suite는 **advisory 단계**(aside-ext·비교 자산 미보관) |
| WP2 중단·정리 확인 계약 | 완료 | F04, F06 |
| WP3 durable Aside inbox | 완료 | F05 |
| WP4 provider 동등화 | 종결 | 스트리밍·capability·readiness 완료. tool bridge는 사용자가 Claude를 쓰지 않기로 해 보류 |
| WP5 immutable runtime lineage | 완료(범위 내) | F01 launcher preflight, F07 digest pin. Chromium 재빌드 재현(E02)은 별도 머신 검증 없음 |
| WP6 golden E2E 18개 | 미착수 | 이번에 추가한 단위·계약 테스트는 E07·E08·E14·E03·E16의 일부 조건만 덮음 |
| WP7 원본 parity 종결 | 미착수 | 91-row ledger 그대로 |
| WP8 source-of-truth 정리 | 부분 | Aside 원본·patched 번들 manifest화. patched 907의 정확한 patch 순서는 탐색 중(아래) |

## 남은 것 (사용자 결정 필요)

1. **Claude tool bridge** — **보류 (사용자 결정 2026-09-09: Claude provider를 쓰지 않음).** 코드는 원본 parity 범위라 유지하며, 현재 상태(스트리밍 + 미지원 capability 표시)가 최종이다. 설계 메모(나중에 필요해질 때용): host runner는 stream에서 `tool-call`을 받아 직접 실행하고 결과를 append 후 다시 stream()을 부르는 구조다. Claude Agent SDK는 자체 loop 안에서 tool을 실행하므로, in-process MCP server(`createSdkMcpServer`)의 handler가 `tool-call` 이벤트를 방출하고 다음 stream() 호출에서 append된 tool-result로 handler를 풀어 주는 "차단형 bridge"가 필요하다. JSON schema→Zod 변환, abort·오류 전파, executor 수명 관리가 걸린다. 하루 이상 걸리는 설계 작업이라 이번엔 capability 표시로 대신했다.
2. **browser suite를 게이트에 넣기** — `vendor/aside-ext`(36MB)·extension-comparison 원본 자산을 LFS로 보관해야 advisory를 필수로 바꿀 수 있다.
3. **WP6/WP7** — golden E2E lane과 91-row ledger. 범위가 커서 별도 결정.
4. **patched 번들 recipe** — 탐색 결과(patch-daemon → linux/lifecycle/active-workloads/password-session/`--refresh-cdp-shutdown`의 모든 순서·부분집합) 907·906 모두 vendor 파일을 바이트 단위로 재현하는 순서는 없었다. 907은 CDP client 종료 패치가 든 minified 한 줄이 남고, 906은 vendor가 현재 chain보다 오래된 상태다. 둘 다 `research-archives/aside/artifacts.json`에 hash로 고정돼 있고, 재현 recipe는 다음 daemon 버전 갱신 때 chain을 다시 돌려 기록하는 것으로 미룬다.

## 검증 방법 (재현)

```bash
git fetch origin && git checkout fix/audit-remediation
npm ci && npm run bootstrap && npm run bootstrap:aside
npm run check          # root 997 tests + 모바일 151 tests
npm run test:browser   # belmont-browse 140 + 20 (로컬 자산 필요)
```

## 원본 기능 반영 (2026-09-09 오후, 원본 코드 재사용 원칙)

사용자 지시: 새로 만들지 말고 원본 daemon 코드를 그대로 쓸 것. 두 비교 문서(Aside 직접 분석, Belmont↔Aside 코드 비교)에서 "우리가 반영 안 한 것" 중 기능 관점에서 가치 있는 것만 원본 함수 호출로 연결했다.

| 항목 | 확인 결과 | 조치 |
|---|---|---|
| 의미 검색(Moss) | 이전 세션 probe 기록에서 **동작 확인**(의미 일치 질의가 단어 검색 0건일 때 정답 파일 1순위, 첫 질의 3.2s, 이후 7ms). 현재 "native-pending"은 이번 실행에서 아직 호출이 없었다는 뜻이지 실패가 아님. moss-core 바이너리에 `service.usemoss.dev`(토큰·인덱스·질의)와 `models.moss.link`(모델 내려받기) 주소가 있고, daemon 상수는 로컬 MiniLM 캐시(`moss-minilm-provenance-v1`)와 로컬 인덱스 네임스페이스를 쓴다. 외부 통신 범위(임베딩이 로컬인지, 문서가 서비스로 올라가는지)는 패킷 캡처 전까지 미확정 | 런타임에 이미 있던 `warm()`을 서비스 기동 시 호출(core.mjs)해 첫 사용을 미리 수행. 재기동 후 primary health가 `native`, `[memory] semantic search ready` 기록. 차단 실험: Moss 서비스 통신을 막아도 색인·질의 정상(로컬), Aside 익명 토큰까지 막으면 10초 후 단어 검색으로 대체 |
| 메모리 backfill·dreaming | 원본 MemoryHook(세션 종료 시)이 우리 쪽에서도 그대로 돌아 `.history.jsonl`(147KB, 오프셋 완료)·`.dream-state.json`(마지막 dreaming 기록, 세션 4회 누적)이 이미 있음. 빠진 것은 **부팅 시점 backfill 호출**뿐 | `startSessionRunMemoryBackfill`/`stopSessionRunMemoryBackfill`을 번들 export에 추가(`--refresh-exports`, 본문 무변경)하고 `initializeLocalLifecycle`이 원본 부트스트랩과 같이 시작·정리 시 stop 호출 |
| 저장된 답이 있는 중단 세션 자동 재개 (C02) | 원본 `recoverSuspensionsOnStartup`이 이미 export돼 있었음 | `initializeLocalLifecycle`이 답/오류가 저장된 suspended 세션을 원본 복구 함수에 그대로 넘김(원본 reentry 예약). 답 없는 질문은 그대로 대기, running 세션은 기존처럼 명시 이어가기. export 없는 번들은 이전 동작 유지 |

테스트: `tests/aside-session-restoration.test.mjs`에 5건 추가. patched 907 번들 pin(`research-archives/aside`)과 native build identity 갱신. **켜져 있는 primary는 다음 실행부터 반영**된다(번들은 기동 시 로드).

## 골든 E2E 장부 (WP6, 2026-09-09 오후)

완료 선언이 아니라 **지금 존재하는 근거의 분류**다. 상세 JSON: `docs/testing/golden-e2e-ledger-2026-09-09.json`.

| ID | 시나리오 | 상태 | 남은 공백 |
|---|---|---|---|
| E01 | 빈 머신에서 bootstrap→check→build | covered-by-ci | macOS 패키지 launch·실제 turn은 CI에 없음 |
| E02 | Aside native clean reconstruction | not-covered | 별도 머신에서 pinned base+snapshot 빌드 후 binary identity 대조 필요 |
| E03 | stale artifact negative control | covered-by-unit | 실제 launcher 실행 거절은 run-fork.sh 경로에서 수동 확인만 |
| E04 | 원본 Grok vs 재구성 host 동일 turn | not-covered | golden fixture/provider response corpus 없음 |
| E05 | provider별 message→tool→continuation→UI | partial | 실제 provider 왕복·UI 표시·저장 transcript 대조 없음 |
| E06 | provider 실패·중단·rate limit·auth 만료 | partial | rate limit·auth 만료·retry 범위 미검증 |
| E07 | 실행 중 사용자 cancel 확인 | covered-by-contract | native 쪽 외부 action 0회 관측은 미수행 |
| E08 | Aside 동일 timestamp 메시지 2개 | covered-by-contract | - |
| E09 | reconnect replay + crash boundary | partial | emit/DB/cursor 경계 crash 주입 없음 |
| E10 | 승인 대기 중 restart·stale approval | covered-by-contract | 실제 restart 사이클 없음 |
| E11 | 3 agents 동시 실행, 1개 cancel | not-covered | 동시성 E2E 없음 |
| E12 | browser crash 후 명시적 continuation | partial | 실제 browser crash 주입 없음 |
| E13 | host SIGKILL과 TERM 무시 descendant | covered-by-unit | 전체 앱 종료 경로는 별개 |
| E14 | cleanup 단계별 reject/hang | covered-by-unit | installShutdownHandlers 통합 실행은 미테스트 |
| E15 | 손상된 link/settings/run state | partial | settings·run state 손상은 미검증 |
| E16 | Docker clean install / image drift | not-covered | Docker daemon 없는 환경이라 실행 검증 불가 |
| E17 | 원본 Aside vs native fork browser action corpus | not-covered | 원본 macOS 실행 환경 없음 |
| E18 | Claude/OpenRouter-only 계정 routine/hook wake | partial | 실제 wake→turn 완료 E2E 없음 |

집계: covered-by-ci 1, not-covered 5, covered-by-unit 3, partial 6, covered-by-contract 3. not-covered 5건(E02·E04·E11·E16·E17)은 별도 머신·원본 macOS 실행·Docker daemon·동시성 하네스가 필요하다.

## 91-row 장부 기계적 대조 (WP7, 2026-09-09 오후)

원본 91개 사용자 흐름 row를 범위 한정 검증 단위(L01~L14)에 연결하고 source/test 포인터 존재를 확인했다. **row 결론은 하나도 바꾸지 않았다.** row를 닫으려면 각 row의 missingGate(현재 primary에서 원본과 같은 상태를 1회 관찰·대조)를 실행해야 하는데, 오늘은 그 실행이 없었다.

| 분류 | row 수 |
|---|---|
| 범위 한정 근거가 있는 흐름의 row | 47 |
| 부분 근거만 있는 흐름의 row | 10 |
| 연결된 검증 단위가 없는 row | 34 |

source 포인터가 하나라도 없는 row: 0개. 상세: `data/artifacts/aside-remaining-closure-20260908/workers/workflow-ledger-reconciliation-20260909.json`(캠페인 디렉터리, git 무시). L14(필수 검사)는 모바일 2실패 해결로 `verified_scoped`로 갱신했고 ledger 무결성 검사는 PASS.

## 성능 빌드 판단 (2026-09-09 오후)

우리 Chromium은 `is_official_build=false`, `use_thin_lto=false`, PGO 없음이다(링크 메모리 때문에 선택). 원본 macOS official 빌드 대비 차이를 **측정할 기준이 없다**: 같은 플랫폼의 official 빌드가 없고 원본은 macOS 전용이다. 의미 있는 측정은 "현재 빌드 vs LTO+PGO 재빌드"뿐인데, 그 재빌드는 이 20GB 머신에서 링크가 버틸지 미지수이고 PGO 프로필 생성까지 수 시간이 든다. 결정: 지금은 진행하지 않는다. 필요해지면 (1) `use_thin_lto=true`만 켜서 링크 가능 여부를 먼저 확인하고, (2) Speedometer 3 로컬 사본으로 전후를 비교하는 순서로 한다.

## 남은 항목 처리 (2026-09-09 오후, "남은거 다해라")

| 항목 | 결과 | 근거 |
|---|---|---|
| C01 sandbox 옵션 파싱 | 해결. `0/false`로 끄면 정말 꺼지고, 알 수 없는 값은 거부. 기본값은 유지: 이 WSL에서는 sandbox 켠 실행이 멈춤(15초 headless 실행 미완료, `chrome_sandbox` 없음) | commit 173a573, `belmont-browse/test/chrome-sandbox-option.test.mjs` |
| Moss 업로드 호출 지점 | daemon은 `.pushIndex(`를 이름으로 부르지 않는다(SDK wrapper 정의 1곳뿐). MemoryManager가 부르는 것은 `addDocs/deleteDocs/query/queryText/saveToDisk/loadFromDisk/loadIndex/close`. Moss 서비스 통신을 막아도 색인·질의가 정상이므로 업로드는 적어도 필수 경로가 아님. Rust 내부 자동 동기화 여부는 패킷 복호화 없이는 미확정 | 차단 실험 3종(문서 상단) |
| `for-chrome` 인증 예외 | **의도된 차이로 보강.** native 탭 스트립(우리 Chromium 패치)과 확장이 토큰 없이 이 경로를 부르므로 토큰 요구는 불가. 대신 **웹 Origin이 붙은 변경 요청을 403**으로 거부(확장 origin·Origin 없는 native/CLI는 통과, GET/OPTIONS 무관). `BELMONT_BROWSE_FOR_CHROME_GUARD=enforce|report|off` | commit b728c79, `tests/aside-for-chrome-origin-guard.test.mjs` |
| browser 테스트 게이트 편입 | 완료. 확장 자산·vendor 트리 6개를 LFS archive(56MB)로 고정, bootstrap이 없을 때만 풀어 놓음, CI에서 필수 단계로 전환. clean runner에서 160개 중 bwrap 3개가 user namespace 제한으로 실패 → sysctl 완화 + 실제 namespace probe 게이트 | commit 16d795c, 후속 commit |
| 반복 루틴 실제 실행 | **검증됨.** 원본 스케줄러(`startRoutineScheduler`, 30초 tick)가 `FREQ=MINUTELY` 루틴을 06:15:37Z와 06:17:07Z에 두 번 실행(90초 간격: 첫 세션이 도는 동안의 tick은 원본 규칙대로 건너뜀), 두 세션 모두 정상 완료. 브라우저 binding 없이 만들면 원본이 "browser binding is missing"으로 스스로 일시정지함도 확인. 사용한 루틴은 일시정지·이름 표시, 세션은 보관 처리 | `belmont-browse/tools/verify-recurring-routine.mjs`, daemon 로그 |
| guard 실제 동작 | primary 재기동 후 curl: 웹 Origin POST 403(로그 기록), 확장 Origin POST와 Origin 없는 POST는 원본 핸들러로 통과(404: 없는 id), 웹 Origin GET 200, 비-loopback Host 403(원본). health ready, memory native 유지 | `logs/primary-relaunch-20260909T1530Z-serve.log` |
| 성능 빌드 | 진행 안 함(기준선 부재·링크 메모리). 위 "성능 빌드 판단" 참조 | |
| 골든 E2E 18개 | 근거 분류 장부 작성(1 CI, 3 unit, 3 contract, 6 partial, 5 not-covered). 시나리오 자체 구현은 아님 | `docs/testing/golden-e2e-ledger-2026-09-09.json` |
| 91-row 장부 | 기계적 대조만(결론 무변경): 근거 있는 흐름 47, 부분 10, 연결 없음 34 | 캠페인 `workers/workflow-ledger-reconciliation-20260909.json` |

이 시점의 primary: daemon은 재기동으로 PID가 바뀌었고(`belmont-browse/.state/serve.json` 참조), guard·C01·warm-up·원본 복구 경로가 모두 적용된 상태다.

## 골든 E2E 2차 (2026-09-09 저녁, 빌드·실행 계보 제외)

사용자 지시로 E01~E03·E16(빌드·실행 계보)은 미루고, 이 환경에서 만들 수 있는 나머지를 실제 검사로 만들었다. E04(원본 Grok 응답 기록)·E17(원본 macOS)은 환경상 불가.

| ID | 새 상태 | 검사 |
|---|---|---|
| E05 | e2e-stub | 실제 AI SDK 클라이언트 + 실제 실행기 ↔ 로컬 OpenAI 호환 SSE 스텁. tool 정의 전달, tool-call 파싱, tool 결과 이어서 최종 답 |
| E06 | e2e-stub | 429/401은 오류로 드러나고 답·tool 없음, 중단 시 즉시 거절·상류 요청 닫힘. **결함 발견·수정**: AI SDK 4.3은 스트림 실패 뒤 response/usage/providerMetadata 약속을 영원히 pending으로 두어 이를 기다리는 코드가 멈출 수 있었음 → 실행기가 실패와 함께 settle |
| E07 | contract | 확정 중단 뒤 엔진 활동이 세션에 귀속되지 않음, 중단 미확인은 STOP_FAILED |
| E09 | contract | emit과 저장 사이 crash 후 재시작해도 누락·중복 0 |
| E10 | contract | 재시작 뒤 stale tool-call 답변 거부, 현재 카드 재표시 |
| E11 | contract | 봇 3개 중 1개 취소(성공·실패 모두) 시 나머지 상태 바이트 동일 |
| E12 | contract | 브라우저 crash → interrupted + 명시 이어가기, 옛 프롬프트 자동 재실행 없음 |
| E15 | unit | 손상된 settings.json은 사유와 함께 격리(원본 바이트 보존), 기본값으로 계속. **이전엔 조용히 초기화됐음** |
| E18 | e2e-stub | provider별 readiness (openrouter 키 유무, cursor, codex, claude CLI 유무) |

집계: covered-by-ci 1, not-covered 4, covered-by-unit 4, covered-by-e2e-stub 3, covered-by-contract 6. root 1027 tests / 0 fail.

## 호스트 재시작 (2026-09-09 16:12 KST, "재시작해서 확인해라")

- 재시작 전 상태: 어제 23:34 KST에 띄운 호스트(runner 26784 / host 26813 / electron 27008)는 이미 죽어 있었다. 남은 것은 봇 데스크톱 Xvfb :100/:101/:108(설계상 분리 유지)과 모바일 서버(4188)뿐. 옛 번들에는 `quarantineUnreadable`가 없었다(호스트 쪽 수정 미반영).
- `npm run wsl:setup`(Node 26.5)로 런타임 재빌드(약 60초). 새 번들 확인: settings 격리(`quarantineUnreadable`) 포함, provider 실패 시 파생 promise 정착(`Promise.race([promise, failure3.promise])`, esbuild가 이름 변경), `SAND_OPENROUTER_BASE_URL`, `runCleanupSteps`, `AsideLinkCorruptError` 모두 포함.
- 기동: `tmux new-session -d -s belmont-bot -c <repo> 'SAND_ASIDE_BROWSE=1 npm run wsl:start'`. 로그 `data/artifacts/aside-remaining-closure-20260908/logs/host-restart-20260909T0712Z.log`.
- 결과: runner 795498 / host 795526 / box-exec-daemon 795564(1337) / electron 795611. 게이트웨이 `http://127.0.0.1:45026`(auth required). `runtime-lineage.json` capturedAt 2026-09-09T07:12:01Z, git.head 106f69e. 호스트 로그에 `[browse-runtime] aside-browse subagent type enabled (service found)`. 로컬 데스크톱은 기존 :100을 재사용(x11vnc 5901 / websockify 6081 인수). settings.json 정상(version 1, provider codex), 격리 파일 없음. dbus 오류는 WSL Electron 상시 잡음.
- Aside 쪽(primary daemon 777293 / Chrome 777327, 15:18 KST 기동)은 이미 새 코드로 돌고 있었다: `/health`의 memory.mode native, semantic.state available; serve 로그 `reconciled 0 persisted executions; 0 handed to the original suspension recovery`, `[memory] semantic search ready`.
- 확인하지 않은 것: settings 격리의 실동작(사용자 설정 파일을 고의로 깨야 해서 단위 테스트 E15로만 확인), 실제 provider 턴에서의 promise 정착(스텁 E05/E06/E18로만 확인).

### E2E와 실동작 테스트의 차이 (사용자 질문)

| 구분 | 오늘 만든 골든 E2E | 실동작 테스트 |
|---|---|---|
| 외부 상대 | 스텁·계약(가짜 SSE 서버, 가짜 세션 스토어) | 진짜 OpenRouter/Codex, 진짜 Chromium, 진짜 사용자 흐름 |
| 확인 대상 | 코드 경로가 계약대로 반응하는가 | 실제 환경에서 결과가 맞는가 |
| 오늘 수행 | E05/E06/E18(스텁), E07~E12(계약), E13~E15(단위) | primary 재기동 + guard curl, Moss 실검색, 반복 루틴 실제 실행, 호스트 재시작 |
| 미수행 | E02/E16(사용자 보류), E04/E17(환경상 불가) | 실제 provider 턴 오류 복구, 실제 브라우저 crash 복구, 사용자 흐름 91-row missingGate |
