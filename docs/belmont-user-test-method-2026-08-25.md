# Belmont 전체 기능 실사용 검증 방법

- 상태: `PILOT_REMEDIATED_PROVISIONAL / 1292_QUEUE_READY / INDEPENDENT_ACCEPTANCE_PENDING`
- 기준일: 2026-08-25 KST
- 제품 기준 저장소: `/home/hoon/_roots/labs/work/Belmont`
- 제품 코드 기준 HEAD: `f17b324`. 이후 문서 전용 커밋은 별도로 기록한다. `run.json` schema 2는 endpoint와 Electron target뿐 아니라 runtime generation, Git/source 지문, 프로세스와 빌드 해시를 고정한다.
- 기존 기능 분모: Grok 0.18 원장 1,500개 중 WSL 실행 후보 1,292개
- 기존 실행 후보 해시: `def55dc8b269e86db6820764e9ca996d6e35bdd245c8b9f562501c1cb377643e`
- 새 관찰 명령: `npm run wsl:cdp -- ...`

이 문서는 Belmont를 실제 사용자가 조작하는 방식으로 1,292개 기능을 모두 판정하기 위한 현재 방법이다. 과거 GrokBot 하네스는 가져오지 않는다. 기존 기능 원장과 판정 원칙만 입력으로 사용하고, 제품 실행과 CDP 관찰을 분리한다.

## 1. 목표와 통과 기준

목표는 각 기능 ID마다 실제 Belmont 화면에서 사용자 행동을 수행하고, 화면 결과와 실제 효과를 분리해 증거를 남기는 것이다.

필수 통과 기준:

1. 1,292개 행 각각에 최종 판정이 하나 이상 존재한다.
2. `PASS`에는 실제 사용자 입력·클릭과 전후 화면, 실제 효과 또는 재열기 확인이 있다.
3. 내부 API 직접 호출, DOM 직접 수정, 로그 한 종류만으로 `PASS`를 주지 않는다.
4. 실행기가 만든 `PROVISIONAL_PASS`는 최종 `PASS`가 아니다. 검토자가 증거와 기대 행동을 대조해야 한다.
5. 제품 코드 또는 Electron target이 바뀌면 같은 run에 결과를 섞지 않는다.
6. 테스트 도구 오류는 `HARNESS_DEFECT`이며 제품 실패로 계산하지 않는다.

평가 축:

| 평가 축 | 통과 조건 | 증거 | 실패 시 처리 |
| --- | --- | --- | --- |
| 사용자 동작 | 보이는 컨트롤에 실제 pointer/keyboard 이벤트를 보냄 | step 기록, 전후 화면 | 재현 후 `FAIL` 또는 `HARNESS_DEFECT` 분리 |
| 화면 정직성 | 진행·완료·오류가 실제 상태와 일치 | 스크린샷, 제한된 DOM 관찰 | 거짓 성공은 `FAIL` |
| 실제 효과 | 파일·봇·설정·기록 등 기대 효과가 존재 | 재열기, 산출물, 보조 로그 | 효과가 없으면 `FAIL` |
| 격리·지속성 | 다른 대화·봇과 섞이지 않고 필요한 상태가 유지 | 대상 전후 비교, 승인된 재시작 | 데이터 혼합은 즉시 중단 |
| 재현성 | 같은 HEAD·target 세대·프로필·절차가 기록됨 | `run.json`, JSONL, checkpoint | 세대가 바뀌면 새 run 생성 |
| 비용 현실성 | 전체 DOM·모든 스크린샷을 매번 모델이 읽지 않음 | 출력 크기, 리뷰 대상 수 | 관련 요소와 실패 증거만 확대 |

## 2. 역할 분리

### Belmont 제품 실행기

```bash
mise x node@26.5.0 -- npm run wsl:setup
BELMONT_WSL_DEBUG_PORT=9347 mise x node@26.5.0 -- npm run wsl:start
```

제품 실행기는 앱, host, 로컬 프로필과 종료를 소유한다. `wsl:start`는 현재 source
identity가 마지막 `wsl:setup`의 build identity와 다르면 host/Electron을 띄우기 전에
중단한다. 코드 또는 문서 커밋 뒤에는 `wsl:setup`을 다시 수행한다. 테스트 중 임의
재시작하지 않는다.

### 작은 CDP 관찰 실행기

`scripts/belmont-cdp.mjs`와 `scripts/lib/belmont-cdp-observer.mjs`는 이미 실행 중인 loopback Belmont target에만 연결한다.

하는 일:

- `status`: target, URL, runtime/build lineage, 문서 준비 상태와 화면 크기 확인
- `snapshot`: 전체 HTML이 아닌 본문 일부와 보이는 상호작용 요소만 확인
- `run`: JSON plan의 클릭·hover·입력·키·명시적 파일 선택·스크롤·대기·assertion을 순서대로 실행
- 모든 case의 자동 전후 PNG와 제한된 JSON snapshot 저장
- 콘솔 error와 page exception 기록
- `observations.jsonl` append와 `checkpoint.json` 원자 갱신

하지 않는 일:

- Belmont 시작·종료·재시작
- 프로필 생성·삭제 또는 설정 변경
- 제품 내부 API나 임의 JavaScript 실행
- DB 직접 변경
- 최종 제품 `PASS` 결정
- 다른 Chrome/Electron 또는 원격 CDP 연결
- 둘 이상의 Belmont page가 노출된 상태에서 임의로 하나를 선택

## 3. 빠른 사용법

현재 Belmont 확인:

```bash
mise x node@26.5.0 -- npm run wsl:cdp -- status
```

토큰을 적게 쓰는 제한 snapshot:

```bash
mise x node@26.5.0 -- npm run wsl:cdp -- snapshot --max-text 2000 --output /tmp/belmont-snapshot.json
```

입력·삭제 pilot은 메시지를 보내지 않고 draft를 원상 복구한다.

```bash
mise x node@26.5.0 -- npm run wsl:cdp -- run \
  --plan docs/testing/examples/belmont-cdp-fill-clear-smoke.json \
  --run-dir /tmp/belmont-cdp-pilot
```

다른 포트를 쓸 때만 `--endpoint http://127.0.0.1:PORT`를 추가한다. 원격 endpoint는 거부한다.
본 실행을 열 때 `git rev-parse HEAD` 결과를 최종 보고서에 먼저 기록한다. 실행기는
`runtime-lineage.json`과 `wsl-build-lineage.json`을 검증해 source/build/target 세대를
고정한다. 이 lineage가 빠지거나 일치하지 않는 run은 시작하지 않는다.

## 4. Plan 형식

```json
{
  "schemaVersion": 1,
  "caseId": "GBF-USR-000210-N01",
  "description": "명령 팔레트 키보드 이동",
  "expectedBehavior": "ArrowDown 뒤 Enter로 강조된 항목을 실행한다.",
  "steps": [
    { "action": "press", "key": "k", "modifiers": ["CTRL"] },
    { "action": "assert", "locator": { "role": "dialog" }, "expect": { "visible": true }, "timeoutMs": 3000 },
    { "action": "press", "key": "ArrowDown" },
    { "action": "press", "key": "Enter" },
    { "action": "wait", "ms": 500 },
    { "action": "snapshot", "name": "palette-result", "maxText": 2000 },
    { "action": "screenshot", "name": "palette-result" }
  ]
}
```

지원 action:

- `click`, `hover`: CSS 또는 role/name/text locator의 화면 중앙에 pointer 이벤트 전송
- `fill`: 실제 포커스 후 Ctrl+A, Backspace, text 입력
- `press`: Enter, Escape, Tab, 화살표, Delete, Home/End, 영숫자, 일반 punctuation과 Ctrl/Shift/Alt/Meta 조합
- `upload`: CSS로 찾은 file input에 1~10개의 절대경로 일반 파일을 선택. native OS chooser는 열지 않고 표준 CDP `DOM.setFileInputFiles` 동작을 사용한다.
- `scroll`: viewport 중앙에 wheel 이벤트 전송
- `wait`: 최대 30초 고정 대기
- `assert`: visible, hidden, enabled, count, textIncludes, textEquals
- `snapshot`, `screenshot`: 이름이 붙은 추가 증거 저장

지원 locator 예:

```json
{ "css": "[data-testid='save']" }
{ "role": "button", "name": "Search", "exact": true }
{ "text": "Plugins", "exact": true }
{ "role": "button", "name": "New", "nth": 1 }
```

클릭·입력에는 role/name 또는 안정된 CSS를 우선한다. `text` 단독 locator는 일반
화면 문구도 찾되 가장 안쪽 일치 요소를 선택하므로, 중복 문구는 `exact`와 `nth`로
고정한다.

실행 plan에는 임의 `evaluate`가 없다. 제품 상태를 DOM 코드로 조작해서 실사용처럼 보이게 만드는 우회를 막기 위한 제한이다.

## 5. 1,292개 실행 순서

기존 queue의 batch 순서를 유지한다.

1. 화면·로컬 UI 572개
   - `01_WINDOW_NAVIGATION`부터 `09_OTHER_VISIBLE_UI`
2. 에이전트 도달 기능 301개
   - `10_AGENT_REACHABLE`
3. 외부·저장소 기능 51개
   - `95_EXTERNAL_REMOTE_OS`, `96_REPOSITORY_MUTATION`
4. 오류·게이트·복구 285개
   - `97_FAULT_RECOVERY_BOUNDARY`, `98_GATED_FEATURES`
5. 삭제·재시작 등 파괴적 기능 83개
   - `99_LIFECYCLE_DESTRUCTIVE`

각 batch는 같은 fixture를 재사용해 화면 이동을 줄인다. 그러나 결과는 반드시 case별 한 줄로 남긴다. 공통 결함이 여러 case를 막아도 각 진입점은 개별 확인하고 같은 issue ID를 참조한다.

## 6. 기존 문서와 원장 재사용 범위

입력 원본은 Belmont 저장소 안에 불변 legacy snapshot으로 이관했다.

```text
docs/testing/legacy-grok-2026-08-25/
├── grok-bot-atomic-feature-ledger-2026-08-25.md
├── grok-bot-full-feature-user-test-plan-2026-08-25.md
├── grok-bot-user-test-standard-2026-08-25.md
├── grok-bot-wsl-single-model-test-runbook-2026-08-25.md
├── grok-bot-wsl-single-model-tester-prompt-2026-08-25.md
└── audit/
    ├── grok-feature-registry-active.jsonl       # 1,500
    ├── grok-wsl-test-runnable.jsonl             # 1,292
    ├── grok-wsl-test-excluded.jsonl             # 208
    └── grok-wsl-test-queue.meta.json
```

[legacy snapshot 안내](testing/legacy-grok-2026-08-25/README.md)에 적힌 것처럼 이
파일들은 입력·계보 자료다. 옛 prompt와 runbook의 명령을 현재 Belmont에서 그대로
실행하거나 과거 결과를 현재 결과로 승격하지 않는다.

그대로 재사용:

- 안정 feature/test ID
- 기대 행동
- source reference
- batch와 우선순위
- required evidence와 safe attempt limit
- append-only 결과 원칙

반드시 갱신:

- Grok 이름과 현재 Belmont 진입점
- 예전 `.cache/wsl-profile` 경로
- 이전 clean-runtime, launcher, 하네스 명령
- 커밋·renderer·target 세대
- Cursor/업데이트/단일 인스턴스 제외 사유
- 과거 수정 코드에만 존재했던 routed agent tool 등의 현재 도달 가능성

과거 PASS/FAIL을 Belmont의 결과로 복사하지 않는다. 기존 1,292개를 현재 HEAD와
대조해 `RETAIN`, `REWORD`, `REQUIRED_ATTEMPT_CURRENT_BUILD` 중 하나로 매핑한다.
세 disposition 모두 실행 분모에 남으며 합계는 반드시 1,292다. 현재 구현에 없을
것으로 예상되는 기능도 UI 진입을 실제 시도한 뒤 `UNREACHABLE_CURRENT_BUILD`로
판정한다. legacy 제외 208개는 별도로 재검토하되, 1,292개를 사전 제외 목록으로
옮겨 분모를 줄이지 않는다.

## 7. 증거와 판정

권장 run 디렉터리:

```text
data/artifacts/belmont-user-e2e-20260825/<run-id>/
├── run.json
├── observations.jsonl
├── checkpoint.json
├── feature-results.jsonl        # 최종 검토자가 별도 작성
├── issues.jsonl
└── evidence/<case-id>/<observation-id>/
    ├── before.png
    ├── before.json
    ├── after.png
    ├── after.json
    └── 추가 증거
```

실행기 판정:

- `PROVISIONAL_PASS`: 명시된 기계 assertion이 모두 통과. 최종 검토 필요
- `PROVISIONAL_FAIL`: assertion 불일치. 제품 결함인지 계획 결함인지 검토 필요
- `REVIEW_REQUIRED`: 행동과 증거는 있으나 기계 assertion 없음
- `NO_PRODUCT_VERDICT`: CDP 연결·plan·파일 기록 등 도구 오류

최종 판정:

- `PASS`
- `FAIL`
- `BLOCKED_EXTERNAL`
- `UNREACHABLE_CURRENT_BUILD`
- `HARNESS_DEFECT`
- `NOT_APPLICABLE` — 1,292 재분류 단계에서만, 근거 필수

최종 검토자는 기대 행동, 실제 행동, 전후 화면, 실제 효과, console/page error를 대조한다. 시각 배치·가림·애니메이션·문구 품질은 스크린샷을 직접 본다. 단순 속성·텍스트·count는 assertion 결과를 이용하되 실패와 표본을 다시 본다.

## 8. 비용 절감 규칙

- 기본 snapshot 본문은 4,000자, 필요할 때만 최대 20,000자
- 전체 HTML과 전체 네트워크 본문은 수집하지 않음
- PNG는 로컬 저장하고 정상 case마다 모델에 다시 넣지 않음
- batch별 최초·실패·주관적 UI와 정기 표본만 직접 시각 검토
- 같은 fixture를 유지하고 관련 case를 연속 실행
- 에이전트 응답은 짧고 고정된 검증 문구 사용
- 실패 시 전체 로그가 아니라 관련 시각·console error·효과만 확대

비용 절감은 증거 삭제가 아니다. 모든 case의 전후 화면은 저장하되 읽을 대상을 선별한다.

## 9. 중단과 수정 규칙

즉시 중단:

- 앱·host·Electron이 예기치 않게 종료
- CDP target ID 또는 URL 변경
- 다른 프로필이나 두 번째 Belmont 발견
- 대화·봇·파일 데이터가 다른 case와 섞임
- 메시지 전송, 봇 작업 전달 등 공통 핵심 경로가 실패
- 실행기가 제품 상태를 잘못 조작하거나 증거를 덮어씀

수정 절차:

```text
현재 case 증거 저장
→ 제품과 도구 중 결함 소유자 분리
→ 실행 종료
→ 별도 수정·커밋·검증
→ 제품 재빌드
→ 새 run 디렉터리와 새 Electron target으로 시작
→ 영향을 받은 case부터 재검증
```

테스트 중 제품 코드와 실행기를 동시에 고치지 않는다. 실행기 결함 수정 커밋은 제품 결과 원장과 분리하고, 이전 observation은 삭제하지 않는다.

## 10. 현재 제한과 다음 gate

현재 실행기가 직접 처리하지 않는 항목:

- native OS 파일 선택창 자체와 외부 앱 창. 다만 명시적 local fixture를 file input에
  선택하는 `upload` action은 지원한다.
- 실제 drag-and-drop data transfer
- 마이크, Passkey, 하드웨어 입력
- 외부 브라우저 OAuth
- 동영상 녹화
- 네트워크 request/response 전체 수집

이 항목은 해당 batch에서 실제 OS 조작 또는 수동 관찰 절차를 별도로 기록한다. CDP로 우회한 내부 함수 호출을 성공으로 인정하지 않는다.

본 실행 전 gate:

1. 실행기 단위 테스트 통과 — 현재 직접 관찰 기준 통과
2. 현재 Belmont에서 `status`, `snapshot`, fill→assert→clear pilot 통과 — 현재 직접 관찰 기준 통과
3. pilot 전후 대화·봇·설정 불변 확인 — draft가 비고 기존 대화가 유지된 화면을 확인
4. 기존 1,292행 current-HEAD 재분류 완료 — 1,282 RETAIN / 10 REQUIRED_ATTEMPT
5. 첫 10개 필수조치 재검증 — 8 PROVISIONAL_PASS / 1 REVIEW_REQUIRED / 1 UNREACHABLE
6. 첫 10개 case의 계획과 판정 독립 검토

1~5는 실행자 직접 관찰 기준으로 완료했지만 독립 검토 전이므로 `PROVISIONAL`이다.
`GB-CORE-001` 때문에 Belmont 대화가 full host toolset의 routine/state/subagent 도구에
도달하지 못한다. UI-only case는 진행 가능하지만 tool-dependent batch는 이 P1을
해결하고 live parity를 확인한 뒤 재개한다. 근거는
[pilot 필수조치 결과](testing/belmont-pilot-remediation-2026-08-26.md)에 있다.
