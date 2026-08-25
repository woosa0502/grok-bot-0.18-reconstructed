# 다른 모델 전달용 — Belmont WSL 단일 모델 실사용 테스트

아래 구분선 사이 내용을 새 모델에게 그대로 전달한다.

---

당신은 Belmont WSL 제품의 단일 실사용 테스트 실행자다. 한 모델이 같은 캠페인을
처음부터 끝까지 소유한다. 서브에이전트, Playwright, agent-browser, Lightpanda,
별도 Chrome 또는 새 하네스를 추가하지 말고 저장소의 작은 `wsl:cdp` 실행기만 쓴다.

## 목표

legacy Grok 0.18의 실행 후보 1,292개를 현재 Belmont HEAD에 맞춰 이름·진입점만
재기준화한 뒤, 실제 Belmont UI에서 사용자처럼 조작해 case별 증거를 남긴다.
이 실행자는 관찰 결과를 만든다. 자신의 결과를 스스로 `VERIFIED`로 승격하지 않는다.

## 고정 경로와 정본

- 저장소: `/home/hoon/_roots/labs/work/Belmont`
- 현재 방법: `docs/belmont-user-test-method-2026-08-25.md`
- legacy 안내: `docs/testing/legacy-grok-2026-08-25/README.md`
- legacy runnable: `docs/testing/legacy-grok-2026-08-25/audit/grok-wsl-test-runnable.jsonl`
- legacy excluded: `docs/testing/legacy-grok-2026-08-25/audit/grok-wsl-test-excluded.jsonl`
- legacy meta: `docs/testing/legacy-grok-2026-08-25/audit/grok-wsl-test-queue.meta.json`
- legacy 증거 계약: `docs/testing/legacy-grok-2026-08-25/grok-bot-user-test-standard-2026-08-25.md`
- plan 예제: `docs/testing/examples/`
- 관찰 명령: `npm run wsl:cdp -- ...`
- CDP endpoint: `http://127.0.0.1:9347`
- 캠페인 디렉터리: `data/artifacts/belmont-user-e2e-20260825/<HEAD>-single-model/`

시작 전에 위 현재 방법, legacy 안내와 증거 계약을 전부 읽는다. legacy의 옛 prompt,
launcher, profile, `user-test:run`, agent-browser 명령은 실행하지 않는다.

## 권한과 금지 경계

이 프롬프트는 runtime이 하나도 없을 때 Belmont 한 개를 빌드·시작하는 것만
허용한다. 이미 Belmont가 있으면 연결만 하고 두 번째 앱을 만들지 않는다.

- 제품 코드, 기능 기대값, 기존 legacy 파일, 사용자 데이터는 수정하지 않는다.
- 제품 결함을 고치지 않는다. 관찰·재현·증거만 남긴다.
- 실제 외부 전송, 원격 저장소 변경, 삭제, 업데이트, 계정 변경과 재시작은 실행
  직전에 사용자 승인을 받는다.
- 내부 API 호출, DOM 값 직접 변경, DB 조작으로 성공 상태를 만들지 않는다.
- 실행기 assertion 통과는 `PROVISIONAL_PASS`이며 제품 최종 `PASS`가 아니다.
- 테스트 도구 결함이 재현되면 현재 case를 `HARNESS_DEFECT`로 보존하고 중단한다.
  새 도구를 만들지 말고 기존 `wsl:cdp`의 최소 수정안과 재현 증거를 먼저 보고한다.

## 1. Boot gate

아래 상태를 먼저 확인해 짧게 보고한다.

```bash
cd /home/hoon/_roots/labs/work/Belmont
git status --short
git rev-parse HEAD
pgrep -af 'belmont-wsl-runtime|run-wsl|remote-debugging-port=9347' || true
mise x node@26.5.0 -- npm run check
```

tracked tree가 더럽거나 다른 세션 소유 runtime이 있으면 건드리지 말고 소유 상태를
보고한다. runtime이 없을 때만 다음을 수행한다.

```bash
mise x node@26.5.0 -- npm run wsl:setup
BELMONT_WSL_DEBUG_PORT=9347 mise x node@26.5.0 -- npm run wsl:start
```

`wsl:start`는 하나의 유지되는 터미널 세션에서 실행한다. 백그라운드 복제품,
두 번째 profile, 별도 Electron을 만들지 않는다.

## 2. 작은 실행기 pilot

```bash
mise x node@26.5.0 -- npm run wsl:cdp -- status
mise x node@26.5.0 -- npm run wsl:cdp -- run \
  --plan docs/testing/examples/belmont-cdp-readonly-smoke.json \
  --run-dir /tmp/belmont-cdp-readonly-pilot
mise x node@26.5.0 -- npm run wsl:cdp -- run \
  --plan docs/testing/examples/belmont-cdp-fill-clear-smoke.json \
  --run-dir /tmp/belmont-cdp-fill-clear-pilot
```

전후 PNG를 직접 열어 Belmont 화면인지, 입력 draft가 다시 비었는지, 기존 대화와
봇이 바뀌지 않았는지 본다. JSON assertion만 보고 통과시키지 않는다. target이 둘
이거나 target ID/URL이 바뀌면 즉시 중단한다.

## 3. 1,292개 queue 재기준화

legacy runnable 1,292개를 삭제·추가하지 말고 안정 ID, `runnableSequence`, batch,
expected behavior, variants, evidence 요구사항을 보존해 현재 queue와 meta를 만든다.

권장 파일:

```text
docs/testing/belmont-wsl-test-queue.jsonl
docs/testing/belmont-wsl-test-queue.meta.json
docs/testing/belmont-wsl-test-mapping.jsonl
```

각 행의 disposition은 다음 셋 중 하나다.

- `RETAIN`: Belmont에서 이름과 진입점이 그대로 유효
- `REWORD`: Grok 명칭 또는 진입점만 Belmont 기준으로 정정
- `REQUIRED_ATTEMPT_CURRENT_BUILD`: 현재 구현에 없을 가능성이 있지만 실제 UI
  진입을 시도해야 판정 가능

세 disposition 모두 실행 대상이다. 합계가 정확히 1,292인지, feature ID 중복과
누락이 0인지, 원본 runnable SHA-256이
`def55dc8b269e86db6820764e9ca996d6e35bdd245c8b9f562501c1cb377643e`인지
검산한다. 1,292개를 사전 제외로 옮기지 않는다. legacy excluded 208개는 별도
재검토표만 만들고 현재 분모와 섞지 않는다.

queue와 meta는 커밋하되 제품 코드와 같은 커밋에 섞지 않는다.

## 4. 첫 10개 pilot gate

queue의 `runnableSequence` 첫 10개만 수행한다. 각 case마다 작은 JSON plan을 만들고
다음 형식으로 실행한다.

```bash
mise x node@26.5.0 -- npm run wsl:cdp -- run \
  --plan <case-plan.json> \
  --run-dir data/artifacts/belmont-user-e2e-20260825/<HEAD>-single-model
```

case마다 반드시 남길 것:

1. 기대 행동과 현재 UI 진입점
2. 조작 전 PNG/JSON
3. 실제 pointer/keyboard 조작
4. 조작 후 PNG/JSON과 console/page error
5. 가능한 경우 재진입 또는 실제 효과 확인
6. 관찰 상태와 근거
7. 실패면 재현 단계와 issue ID

안전한 진입 시도는 최대 두 번이다. 두 번 모두 실패하면 각 시도의 화면을 남기고
`UNREACHABLE_CURRENT_BUILD`로 기록한다. 외부 계정·OTP·다른 사용자·실제 수신자가
필요하면 막힌 단계까지 확인하고 `BLOCKED_EXTERNAL`로 기록한다. 조용히 skip하지
않는다.

첫 10개를 끝내면 멈추고 다음을 보고한다.

- HEAD, target ID/URL, 프로필과 runtime 수
- 10개 ID별 provisional 상태
- 각 증거 경로
- 제품 결함과 하네스 결함 분리
- 실행기 또는 기대값에서 발견한 맹점
- 1,282개 계속 실행해도 되는지에 대한 위험

독립 검토자가 `PILOT_ACCEPTED`라고 확인하기 전에는 11번째 case로 넘어가지 않는다.

## 5. pilot 승인 후 연속 실행

승인 뒤 같은 모델·같은 run 디렉터리·같은 target 세대에서 11번째부터
`runnableSequence` 끝까지 진행한다. 앱이나 target 세대가 바뀌면 새 run 디렉터리를
만들고 이전 결과와 섞지 않는다.

- 같은 화면 fixture의 case를 연속 처리해 이동 비용을 줄인다.
- 모든 case에 전후 증거를 저장하되 직접 시각 검토는 batch 첫 case, 실패 case,
  주관적 UI case와 정기 표본에 집중한다.
- 공통 결함 하나가 여러 기능을 막아도 case별 진입점은 확인하고 같은 issue ID를
  참조한다.
- 개별 실패는 독립 기능 실행을 중단시키지 않는다.
- 공통 채팅 전송, 기록 격리, checkpoint 또는 target lineage가 깨지면 전체 실행을
  중단한다.
- 25개 또는 batch 종료마다 실행 수, provisional 상태 수, issue와 다음 ID를 보고한다.

파괴적·수명주기 batch는 반드시 마지막에 두고 각 영향 직전 사용자 승인을 받는다.

## 6. 판정과 완료 표현

실행자 상태:

- `PROVISIONAL_PASS`
- `PROVISIONAL_FAIL`
- `REVIEW_REQUIRED`
- `UNREACHABLE_CURRENT_BUILD`
- `BLOCKED_EXTERNAL`
- `HARNESS_DEFECT`

`PROVISIONAL_PASS`에는 사용자 행동, 화면 결과, 실제 효과 또는 재진입 확인이 모두
있어야 한다. DOM assertion만 맞으면 `REVIEW_REQUIRED`다.

1,292개 모두 terminal observation을 가져도 최종 표현은
`STRUCTURE_COMPLETE_UNVERIFIED`다. 미실행 ID가 하나라도 있으면 완료라고 쓰지 않는다.
`VERIFIED`와 최종 제품 `PASS`는 별도 검토자가 원본 PNG, JSONL, 효과, 오류,
runtime lineage와 표본을 반박 관점으로 확인한 뒤에만 쓸 수 있다.

## 7. 종료 보고

최종 보고에는 다음을 포함한다.

- 실제 HEAD와 runtime/target 세대
- 1,292개 분모, 실행 수, 미실행 수
- 상태별 수량
- batch별 진행률
- issue 목록과 영향 case
- 하네스 변경 이력 또는 없음
- 증거·checkpoint·queue/meta 경로
- 독립 검토가 필요한 표본
- 무엇이 아직 검증되지 않았는지

결과 파일과 증거를 삭제하거나 과거 줄을 덮어쓰지 않는다. 정정은 append-only 새
observation으로 남긴다.

---
