# Aside 원본 기준 스냅샷과 차이 목록 — 2026-09-07

**요청한 기준 스냅샷·차이 목록 작성 완료. 제품 구현은 미착수다.** 파일 보존과 제한된 소스 관측은 독립 검증을 통과했다. 전체 동작 동일성, P0의 모든 실행 관측, P2의 모든 실행 경로 검증을 완료했다는 뜻은 아니다.

캠페인: [`data/artifacts/aside-restoration_20260907T041632Z`](../data/artifacts/aside-restoration_20260907T041632Z/README.md). 다음 담당자는 이 문서 → [기준 manifest](../data/artifacts/aside-restoration_20260907T041632Z/baseline/baseline-manifest.json) → [차이 목록](../data/artifacts/aside-restoration_20260907T041632Z/inventory/deviation-ledger.jsonl) 순서로 읽는다.

## 고정한 원본 구성

`direct_observation` — 기존 macOS VM을 읽어 **실제로 관측된 조합**을 보존했다. 실행 중 원본의 업데이트 설정을 잠근 것은 아니다. 다음 관측에서 버전이 달라지면 새 스냅샷으로 분리한다.

| 구성 | 원본 기준 | 근거의 범위 |
| --- | --- | --- |
| OS | macOS 14.8.9 / x86_64 | guest 명령 출력 |
| 브라우저 | Aside **1.0.825.1** | Info.plist, PID 1721의 실행파일·Framework 로드 경로 |
| 데몬 | **1.26.906.1714** | PID 8888의 실행파일·native 모듈 로드 경로, HTTP 200 / idle / ready |
| AgentManager 확장 | **1.26.906.1714** | Secure Preferences의 선택 경로와 해당 manifest |
| PasswordManager 확장 | **1.26.906.1714** | Secure Preferences의 선택 경로와 해당 manifest |
| 계정에서 선택한 모델 | `aside / gpt-5.6-terra / high` | 계정 설정 파일의 관측값 |
| 데몬 코드의 공장 기본값 | `aside / gpt-5.6-luna / medium` | 원본 906 `defaultModelSchema` |
| 추가 지침 | 77바이트 기본 AGENTS, `memory/sites` 없음 | 기본 seed와 해시 일치 |

앱에 동봉된 824 데몬·확장과 설치 후 갱신된 906 컴포넌트를 분리했다. 업데이트 로그에도 906 활성화 기록이 있다. 이 로그에 나오는 과거 재시작은 이번 작업에서 실행한 것이 아니다.

원본 앱의 `SCMRevision` 앞부분은 현재 native 포크의 로컬 공개 기준 commit `cc5584af0df9786f00efdb71f666c6664f836c2d`와 일치한다. 원본 고유 C++ 변경이나 동일 빌드까지 입증하는 값은 아니다. 네트워크에서 공개 tag를 새로 fetch하지 않았다.

**P0에 남은 관측:** 선택된 확장의 실제 background/page 실행과 현재 화면 배율·viewport는 확인하지 않았다. CDP의 비인증 조회는 403이었고, 저장된 창 위치만 확보했다. 따라서 [계획서](aside-restoration-plan-2026-09-07.md)의 “하나라도 불명확하면 P0 미완료” 조건을 그대로 유지한다. P0 상태는 `SNAPSHOT_FIXED / LOAD_AND_VIEWPORT_CONFIRMATION_PENDING`이다.

## 보존한 원문과 검증

`raw_recompute` — 다음 바이트·경계 검사는 별도 검증자가 원문을 직접 다시 읽어 확인했고, 주 담당자가 원시 출력을 검토했다.

- 원본 설치 앱, 갱신 컴포넌트, 배포 런타임 및 컴포넌트 컨테이너를 tar로 보존했다. **1,900,195,840바이트**, 일반 파일 12,588개, 디렉터리 2,241개, symlink 17개다. 각 멤버의 종류·모드·길이·해시·링크 대상에 불일치·누락·중복이 없었다.
- 2026-09-07 **04:23:20–04:23:42 UTC**와 **04:32:56–04:33:11 UTC**의 두 관측에서 manifest 14,848개 항목의 추가·삭제·변경이 없었다. 두 관측 사이 모든 순간이 원자적으로 고정됐다는 뜻은 아니다.
- 제외한 것은 런타임 `.npmrc` 두 파일의 **본문 101바이트와 0바이트**다. 경로·크기·해시는 남겼다. 사용자 DB·인증·프로필 전체 백업은 이 원문 보존 범위 밖이다.
- 실행 중 906 데몬의 전체 바이너리와 **10,560,831바이트 JS**를 분리 보존했다. JS 전체는 실행파일의 `[104673386, 115234217)` 구간과 바이트가 같다. SEA에는 WASM 자산도 있으므로 JS 하나를 전체 패키지라고 부르지 않는다.
- 원본 825.1 DMG도 별도로 보존했다. 설치 앱 파일과 기존 DMG 전개 트리의 비교는 수행했지만, 이번에 DMG 재전개·서명 검증을 새로 수행하지는 않았다.
- 현재 native 소스·설정·overlay·패치·참고 자원 **1,053파일 / 29,696,427바이트**를 보존했다. 공개 기준 대비 변경 548경로를 모두 포함하며, source·복사본·manifest 해시가 일치한다.

원본 tar SHA256: `5be6c4b2bb9b4c5b8647ebb8dae948137b6ebfd226d4ee21bbcad8e6ac84bad5`.

906 JS SHA256: `98f9f8d507965eb95527ae345513e76102a5e909d003e7423841b0d6a9701529`.

근거: [원문 보존 검사](../data/artifacts/aside-restoration_20260907T041632Z/inventory/extraction-manifest.json), [전후 비교](../data/artifacts/aside-restoration_20260907T041632Z/baseline/source-stability.json), [원본·wrapper·확장 독립 검토](../data/artifacts/aside-restoration_20260907T041632Z/adversarial/source-wrapper-extension-verdict.json), [native 독립 검토](../data/artifacts/aside-restoration_20260907T041632Z/adversarial/native-inventory-verdict.json).

P1의 **선언한 원문 보존 범위**는 검증됐다. 전체 동적 의존성, 깨끗한 별도 환경에서의 재구성·빌드, 사유 개발 소스 전체 복원은 미완료다. 범위와 제외 항목은 [source availability](../data/artifacts/aside-restoration_20260907T041632Z/reports/source-availability.md)에 적었다.

## 차이 목록에서 먼저 볼 항목

전체 목록은 **wrapper 35개 경계, native 25개 기능군, 확장 2개 항목**이다. 겹치는 책임 영역이 포함되며, 62개 버그나 기능 완성률이 아니다. 전체 실행 경로를 실행해 대조하지 않았으므로 P2 상태는 `SOURCE_INVENTORY_WRITTEN / RUNTIME_COVERAGE_PENDING`이다.

| 항목 | 현재 차이와 영향 | 우선 처리 제안 |
| --- | --- | --- |
| 버전 조합 — W01/W35/E01 | 기본 포크는 데몬 902 + 확장 824. 관측 원본은 906 컴포넌트 | 별도 후보에서 원본 조합에 맞춘 후 비교 |
| 모델·설정 — W03/W04 | 시작 시 전달된 모델로 계정 설정을 덮어쓴다. 생략 시 `openai-codex/gpt-5.5/high`. 단수 `routineSuggestion` 기록은 원본의 복수 `routineSuggestions`와 다름 | 원본 계정값·공장 기본값·CLI override를 분리하고 parser 계약 확인 |
| 초기화·복구 — W08/W14/W15 | 일부 초기화와 수동 복구를 선택하며, 원본 전체 bootstrap 진입 경로를 호출하지 않음 | 원본의 계정 초기화·복구·ready/shutdown 순서부터 추적 |
| 프롬프트·지식 — W16–W18 | AGENTS 규칙과 사이트 지식을 넣고 읽기 경로를 확장 | 원본 기준과 포크 선택 기능을 분리 |
| 검색·메모리 — W05/W24–W27 | 기본 API 주소를 비활성 주소로 두고 Google 화면 검색, SQLite FTS5 검색으로 대체 | 원본 계약과 대체 기능을 각각 표시·검사 |
| native 동작 — N01–N25 | 비공개 API, 설정, 탭·창, 가져오기, 알림, sync, updater 등 별도 재구현·이식 포함 | 원본 906 caller의 입력·반환·이벤트를 먼저 연결 |
| 확장 수정 — E02/N09 | 824 원본과 같은 버전 비교 시 두 JS 자산에 `resultSequenceId` 처리 추가 | 기존 수정은 보존하고 906/native 계약과 회귀 확인 후 유지 여부 결정 |

위 영향의 해석과 유지·수정 제안은 **PROVISIONAL**이다. 코드가 있다는 사실과 실제 동작은 구분한다. 현재 소스의 기본 실행 경로는 vendor 확장과 port CDP이며, FakeExtension·stock Chrome shim·pipe 경로는 별도 조건 분기다. 소스 추적상 도구 실행 경로는 복원한 원본 데몬과 공유 세션 서버를 재사용한다.

`ASIDE_API_URL`은 클라우드 API 기준 주소다. `DAEMON_URL`은 in-process 확장 연결이 없을 때 쓰는 HTTP 데몬 fallback이다. 두 주소의 목적을 합치지 않았다. 모델 출력이나 작업 성공률은 이번에 측정하지 않았다.

## 버전 차이와 포크 수정을 분리한 증거

- 원본 902 JS를 원본 902 실행파일에서 확보했다. [902 원본 → 902 포크 diff](../data/artifacts/aside-restoration_20260907T041632Z/analysis/902-fork-modifications.diff)와 [원본 902 → 원본 906 릴리스 diff](../data/artifacts/aside-restoration_20260907T041632Z/analysis/902-to-906-release.diff)를 따로 보존했다. 주 기준은 계속 906이다.
- 확장도 원본 824, 포크 824, 원본 906을 별도 보존했다. 같은 버전 824의 1,204파일 중 **1,202파일 동일 / 두 파일 다름 / 추가·누락 없음**이며 manifest는 원본과 같다. 두 수정은 `assets/-page-DIRMOM6u.js`, `assets/search-view-DIBnKvBo.js`다.
- 확장 두 수정은 결과 세대 전달과 오래된 선택 방어 목적이라는 소스 해석이다. 수정 효과와 native 연동 성공은 이번에 실행 검증하지 않았다. 원본 824→906의 해시 파일명 변경을 기능 삭제로 세지 않는다.

근거: [wrapper 상세](../data/artifacts/aside-restoration_20260907T041632Z/reports/wrapper-deviations.md), [확장 비교](../data/artifacts/aside-restoration_20260907T041632Z/inventory/extension-comparison.json).

## 현재 native 소스가 재구성 기준

현재 Chromium HEAD는 `1d00f53b564d073e80d6c90be81fb1ac0f90327f`, 공개 기준은 그 parent다. HEAD 대비 변경만 보면 공개 기준 대비 추가 100경로를 놓치므로 **공개 기준 + 전체 diff + 이번 원문 snapshot**을 다음 재구성 기준으로 삼는다.

기존 overlay 276개 중 현재 파일과 같은 것은 211개, 다른 것은 63개이며 같은 target path가 없는 것은 2개다. 기존 overlay를 통째로 복사하면 최신 수정을 덮을 수 있다. 54개 patch의 번호순은 재적용 순서로 검증되지 않았다.

이전 문구와 달리 `Browser.pdl`은 현재 소스·snapshot·전체 diff·042 full patch에 있다. 현재 빌드된 chrome 파일 해시도 별도로 남겼지만, 이 소스와의 빌드 대응이나 실행 중 프로세스 연결은 주장하지 않는다.

자세한 파일·제외 의존성·패치 검사·기능군 대응은 [native 인벤토리](../data/artifacts/aside-restoration_20260907T041632Z/reports/native-inventory.md)에 있다. 이전 76구간/G1–G7의 통과 수와 퍼센트는 과거 문서 주장으로 보존했으며 이번 복원율로 승계하지 않았다.

## 검증 상태와 다음 작업

- **VERIFIED:** 선언한 원문 보존, 관측 전후 파일 일치, 원본 SEA JS 경계, 동버전 확장 파일 차이, 현재 native 소스·diff 보존.
- **PROVISIONAL:** 소스 차이의 기능 영향, native 기능군 mapping, 유지·수정 우선순위.
- **UNVERIFIED:** 확장 실제 실행·현재 화면 조건, 모든 동적 로드 대상, 외부 서비스 응답 계약, 동일 입력의 실행·상태·화면 비교, 깨끗한 재구성 빌드.

다음에는 먼저 남은 P0 실행 관측과 P2 동적 경로를 격리 검증 환경에서 보완한다. 이후 **906 조합 후보 → 모델·설정·bootstrap 경계 → 지식·검색·메모리 경계 → native API 계약** 순서로 진행한다. 기존 숫자 입력·크래시·omnibox 수정은 일괄 되돌리지 않는다. 이 단계에서 구현을 시작하지 않았다.

원본 VM/QEMU PID 7850, Aside·데몬, Orca PID 36754, 사용자 프로필·DB·계정과 무관한 저장소 변경을 유지했다. 빌드·설치·서비스 재시작·모델 호출·탭 조작을 수행하지 않았다. 여기서 “빌드 미수행”은 Chromium/product candidate 빌드이며, 저장소 지침에 따른 TypeScript 검사·회귀 검사·editable frontend 컴파일은 별도 검증 로그로 기록한다.

재검사 명령, 저장소 검사 결과, 실패·미확인 항목과 작업 소유권은 [캠페인 README](../data/artifacts/aside-restoration_20260907T041632Z/README.md)에 있다. 검증 결과가 원문 해시·구성·관측 경로의 차이를 드러내면 해당 관측 판정부터 다시 연다.
