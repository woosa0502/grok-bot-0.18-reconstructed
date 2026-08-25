# Grok Bot WSL 단일 모델 연속 테스트 실행서

- 상태: `PREPARED_FOR_EXPLORATORY_HANDOFF / PROVISIONAL_EXECUTION_FILTER`
- 기준일: 2026-08-25 KST
- 목표: 원본 Grok Bot을 WSL로 옮긴 현재 빌드에서, 실제 사용자가 지금 도달 가능한 기능을 한 모델이 처음부터 끝까지 연속 검증한다.
- 현재 제외: iOS/macOS 전용, Docker 전용, Codex Local에서 쓰지 않는 Cursor 계정·로그인·결제·사용량·접근권한, WSL 고정 실행기에서 비활성인 앱 업데이트, 사용할 수 없는 마이크·인증 장치 성공 경로, 누락된 배경화면 helper, unpackaged 개발 빌드에서 우회된 단일 인스턴스 잠금, 현재 실행기가 지원하지 않는 host-only 재시작 연속성, 내부 구현 전용, N/A, 단일 실제 프로필에서 안전하게 만들 수 없는 최초 온보딩만
- 실행 원칙: 제품 기능은 실제 UI로만 시험한다. 제품 코드와 판정 기준은 실행 중 바꾸지 않지만, 테스트 하네스 자체의 결함은 아래 변경 절차에 따라 실행을 멈추고 수정할 수 있다.

## 1. 정본 입력

- 전체 분류 원장: [audit/grok-wsl-test-queue.jsonl](audit/grok-wsl-test-queue.jsonl)
- 지금 실행할 목록: [audit/grok-wsl-test-runnable.jsonl](audit/grok-wsl-test-runnable.jsonl)
- 실행하지 않을 목록과 사유: [audit/grok-wsl-test-excluded.jsonl](audit/grok-wsl-test-excluded.jsonl)
- 분류 수량·해시: [audit/grok-wsl-test-queue.meta.json](audit/grok-wsl-test-queue.meta.json)
- 원본 기능 분모: [audit/grok-feature-registry-active.jsonl](audit/grok-feature-registry-active.jsonl)
- 결과 기록 규칙: [grok-bot-user-test-standard-2026-08-25.md](grok-bot-user-test-standard-2026-08-25.md)
- 새 단일 모델 실행 디렉터리: `artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model/`
- 과거 UJ 증거 디렉터리: `artifacts/grok-bot-user-e2e-20260825/run-20260825-142437-kst/` — 읽기 전용, 새 결과를 append하지 않는다.

현재 생성 결과는 1,500개 기능 중 `RUNNABLE_NOW 1,292`개다. 나머지 208개만 실제 실행 불가능 또는 현재 Codex 제품에 적용되지 않는 사유와 함께 제외 원장에 보존했다. Docker와 함께 적힌 복합 기능 `GBF-USR-000732`은 remote-runtime 분기만 테스트한다. 이 수량은 테스트 분모이며, 실제 UI를 돌리기 전까지 제품 통과 수량이 아니다.

## 2. 이번 실행의 범위

이번 실행은 다음 질문만 판정한다.

> WSL 단일 실제 프로필에서 원본 Grok Bot의 지금 사용 가능한 UI 기능이 사용자 관점에서 실제로 동작하는가?

UJ-02~UJ-05의 Grok→워커→저장소 작업→검증→보고는 `POST_BASELINE_CUSTOMIZATION`이다. 기존 실패 증거는 보존하지만 이번 원본 기능 검증의 전체 차단 조건이나 완료 조건으로 사용하지 않는다.

### 2.1 테스트 하네스란

테스트 하네스는 Grok Bot 제품 기능이 아니라 **실제 앱을 한 세대로 실행하고, 사용자 조작의 진행·증거·결과를 잃지 않게 기록하고 검사하는 시험용 제어 장치**다. 일상적인 Grok Bot 사용자는 이 하네스를 조작할 필요가 없다.

- 실행·재개: `scripts/run-grok-user-test.mjs`, `scripts/start-grok-user-test-session.sh`
- 단일 프로필·단일 runtime 제어: `scripts/run-wsl.mjs`, `scripts/setup-wsl.mjs`, `scripts/lib/grok-user-test-runtime.mjs`
- readiness 관찰: `scripts/check-grok-user-test.mjs`
- 결과 구조 검사: `scripts/check-grok-wsl-test-results.mjs`, `scripts/lib/grok-wsl-test-results.mjs`
- 실행 원장: `run.json`, `status.json`, `checkpoint.json`, `feature-results.jsonl`, `issues.jsonl`, `recovery/`, 로그·화면·산출물

하네스는 제품의 합격을 만들어 주는 기능이 아니다. 앱을 대신 조작하거나 내부 상태를 성공으로 바꾸지 않으며, checker 통과만으로 제품 `PASS`를 증명하지 않는다.

## 3. 실제 제외 분류

- `EXCLUDED_PLATFORM`: iOS, iPhone, iPad, macOS, Darwin, 모바일 push, Dock badge 전용
- `EXCLUDED_DOCKER`: Docker 또는 local-docker 전용
- `EXCLUDED_PROVIDER_AUTH`: Codex Local 제품에서 사용하지 않는 Cursor 로그인·계정·결제·사용량·접근권한·토큰 수명주기
- `EXCLUDED_HARDWARE`: 현재 WSL 세션에 없는 마이크 입력 성공 상태, 보안 키, WebAuthn 등 실제 하드웨어·인증 장치가 필요한 기능
- `EXCLUDED_INTERNAL`: 사용자 UI가 아닌 내부 명령·구현 전용
- `EXCLUDED_NOT_APPLICABLE`: `SAND_DISABLE_UPDATES=1`인 앱 업데이트, 누락된 배경화면 helper, unpackaged 개발 빌드에서 우회된 단일 인스턴스 잠금, 현재 실행기가 지원하지 않는 host-only 재시작 연속성처럼 이 WSL 제품 구성에 존재하지 않는 기능
- `EXCLUDED_PROFILE_STATE`: 이미 온보딩된 단일 실제 프로필에서 안전하게 재현할 수 없는 최초 실행·온보딩

이 일곱 가지 외에는 모두 테스트한다. 에이전트 기능, feature gate, 일반 플러그인 OAuth, 외부 브라우저, OS 알림, 원격 컴퓨터, 저장소 변경, 삭제, update·재시작, 실패·오프라인·timeout 상태도 사전 제외하지 않는다. 필요한 조건이 없으면 실제 진입을 시도한 증거와 함께 `BLOCKED_EXTERNAL` 또는 `UNREACHABLE_CURRENT_BUILD`로 판정한다. 현재 빌드의 `GB-CORE-001`도 제외 사유가 아니라 예상 실패를 검증할 대상이다.

## 4. 시작 명령

현재 확인된 Grok Bot·observer·CDP는 모두 종료 상태다. 실행자는 저장소 루트에서 정적 preflight를 먼저 통과시킨다.

```bash
mise x node@26.5.0 -- npm run wsl:setup
mise x node@26.5.0 -- npm run feature-registry:active-check
mise x node@26.5.0 -- npm run wsl-test-queue:check
```

`wsl:setup`은 앱을 시작하지 않고 현재 커밋에서 WSL runtime을 다시 빌드한다. 실행 harness는 이 산출물의 해시를 `run.json`에 고정한다.

그 뒤 장시간 명령을 유지할 수 있는 하나의 실행 세션에서 다음 명령을 시작하고 종료시키지 않는다.

```bash
mise x node@26.5.0 -- npm run user-test:run -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model --owner external-single-model-tester
```

이 명령이 정확히 한 실제 프로필·한 Electron 세대를 시작하고 heartbeat를 소유한다. `&`, `nohup`, 두 번째 launcher를 사용하지 않는다. 별도 명령 호출에서 다음 readiness를 확인한다.

동일 실행 디렉터리에 체크포인트가 있고 runtime이 완전히 종료된 뒤에만 다음처럼 명시적으로 재개한다.

```bash
mise x node@26.5.0 -- npm run user-test:run -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model --owner external-single-model-tester --resume
```

`--resume`은 같은 owner, `FAILED`/`STOPPED` 상태, `activeCaseId: null`, 기존 supervisor·launcher 종료, 필수 원장 파일 존재를 모두 검사한다. 기존 결과 원장을 초기화하지 않고 `recovery/<runtime-generation>.json`에 새 HEAD·runtime 해시와 직전 checkpoint 해시를 남긴다. 빌드가 달라진 재개 캠페인은 `PROVISIONAL_MIXED_RUNTIME_CAMPAIGN`이며 단일 빌드의 최종 인증 결과로 승격하지 않는다. `RUNNING` 상태나 처리 중 case가 남은 상태에서는 재개하지 말고 먼저 소유 세션과 case를 정리한다.

```bash
mise x node@26.5.0 -- npm run user-test:check -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model
agent-browser --cdp 9347 snapshot -i
```

정적 preflight 또는 runtime readiness가 실패하면 기능 테스트를 시작하지 않는다. 임의로 두 번째 앱·프로필·브라우저를 만들지 말고 실패 명령과 원문 출력을 새 실행 디렉터리에 먼저 기록한다.

## 5. 한 모델의 연속 실행 루프

`grok-wsl-test-runnable.jsonl`을 `runnableSequence` 오름차순으로 처리한다. 배치는 다음 순서를 고정한다.

1. 창·내비게이션
2. 채팅·작성기
3. transcript 렌더링
4. 봇 UI
5. 첨부·뷰어
6. 로컬 설정
7. 플러그인 로컬 UI
8. 자동화 로컬 UI
9. 기타 사용자 가시 UI
10. agent-reachable 기능
11. 외부 계정·원격·OS 통합
12. 저장소 변경
13. 실패·복구·경계 상태
14. feature-gated 기능
15. 종료·재시작·업데이트·삭제 기능

각 기능마다 다음을 모두 수행한다.

1. `checkpoint.json`에 현재 feature ID, 시작 시각, 예상 결과를 갱신한다. observer가 heartbeat로 덮어쓰는 `status.json`은 읽기만 한다.
2. 조작 전 화면을 캡처한다.
3. 실제 사용자가 할 수 있는 UI 조작만 수행한다.
4. 조작 후 화면과 콘솔·페이지 오류를 캡처한다.
5. 가능하면 같은 화면 재진입 또는 새로고침으로 실제 효과가 유지되는지 확인한다.
6. `run.json.currentRuntimeGenerationId`를 `runtimeGenerationId`로 복사해 `feature-results.jsonl`에 즉시 append한다.
7. 실패면 같은 `runtimeGenerationId`와 재현 절차·증거를 `issues.jsonl`에 즉시 append한다.
8. 다음 feature ID로 진행한다.

`requiredVariants`가 있는 기능은 각 variant를 별도 subcase로 실행하고 `variantResults`에 variant별 상태·관찰·고유 증거를 남긴다. 모든 variant가 기록되지 않으면 해당 feature는 terminal로 인정되지 않는다. 각 기능 실행 전에는 queue의 `expectedBehavior`를 그대로 `expected`에 복사하고, 보이는 UI만으로 선택한 사전조건·진입점·사용자 행동을 먼저 `checkpoint.json`에 기록한다.

한 기능 진입점을 찾는 안전한 UI 시도는 최대 두 번이다. 두 번 모두 진입 불가하면 서로 다른 두 시도의 설명과 각 UI 증거를 `entrypointAttempts`에 남긴 뒤 `UNREACHABLE_CURRENT_BUILD`로 기록한다. 소스를 읽어 숨은 selector나 내부 명령을 찾아 우회하지 않는다.

각 배치 끝에는 누락·증거 문제를 즉시 확인한다.

```bash
mise x node@26.5.0 -- npm run wsl-test-results:progress -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model
```

## 6. 허용 판정

- `PASS`: 사용자 행동, 보이는 결과, 실제 효과 또는 재진입 확인이 모두 맞음
- `FAIL`: 사용자가 진입했지만 기대 효과가 틀리거나 오류·거짓 성공·상태 유실이 관찰됨
- `UNREACHABLE_CURRENT_BUILD`: 실행 목록에 있지만 안전한 UI 진입 시도 두 번 후에도 현재 빌드에서 도달 불가
- `BLOCKED_EXTERNAL`: 실행 중에야 외부 계정·다른 사용자·OTP가 필수임이 확인됨
- `PROVISIONAL`: 화면 결과는 보였지만 실제 효과 또는 지속성 증거가 부족함

`PROVISIONAL`은 중간 관찰일 뿐 terminal 결과가 아니다. `PASS`는 별도 `effectCheck`, effect evidence, console/page-error/network/process evidence를 모두 요구한다. `FAIL`은 재현 단계·심각도·증거가 있는 연결 issue가 필요하다. `SKIP`, 빈 결과, 근거 없는 `BLOCKED`는 허용하지 않는다.

## 7. 실패 후 진행 규칙

- 개별 기능 실패는 전체 실행 중단 사유가 아니다.
- 실패가 같은 상태를 공유하는 후속 기능을 오염시키면 그 의존 묶음만 중단하고 나머지 배치로 이동한다.
- 앱·observer·CDP가 예상 밖으로 죽으면 현재 기능에서 중단하고 마지막 정상 heartbeat와 로그를 보존한다.
- 재시작·업데이트·삭제·Git 변경은 QA fixture와 같은 단일 앱·프로필 범위에서 뒤쪽 배치로 실행한다.
- 실제 사용자 데이터, 실제 원격 저장소, 실제 외부 수신자에 돌이킬 수 없는 영향을 주기 직전에는 멈추고 `BLOCKED_EXTERNAL`로 남긴다.
- 로그인·OTP·다른 사용자가 없으면 진입·인증 필요·실패 UX까지 확인하고 `BLOCKED_EXTERNAL`로 남긴다.
- 테스트 중 제품 코드를 수정하지 않는다. 제품 수정이 필요하면 현재 case와 runtime을 중단하고 증거를 고정한 뒤, 수정·빌드·새 runtime 세대를 분리한다.
- `GBF-USR-000878`은 전체 큐의 마지막 항목이다. 실행 직전 `checkpoint.lifecycleFinale`에 `EXPECTED_STOP`, `run.json.currentRuntimeGenerationId`, 마지막 정상 증거, 종료 증거 경로를 기록하고 Cmd/Ctrl+Q를 실행한다. 현재 runtime 세대와 일치하는 이 계획된 종료만 runtime이 내려간 상태의 완료 게이트를 통과할 수 있다.

### 7.1 테스트 중 하네스 변경 규칙

하네스 결함 때문에 앱을 시작·관찰·기록·재개할 수 없거나 하네스가 거짓 판정을 만들 위험이 있으면 **테스트 도중에도 하네스를 변경할 수 있다.** 다음 경계를 지킨다.

1. 현재 case를 완료로 쓰지 말고 `HARNESS_DEFECT`로 중단하며, 마지막 정상 heartbeat·로그·checkpoint와 원장 해시를 먼저 보존한다.
2. 실행 중인 Grok Bot과 기록기를 종료한 뒤 하네스를 수정한다. 제품 UI·대화·에이전트 동작 코드와 하네스 수정은 같은 runtime 세대에서 섞지 않는다.
3. 변경 가능 범위는 위 §2.1의 실행·관찰·기록·검사 도구, 그 테스트와 문서다. WSL launcher/build 파일은 단일 runtime·lock·재개 같은 제어 기능에 한해 하네스 범위로 본다.
4. 기능 원장, runnable/excluded 분모, `expectedBehavior`, 이미 기록한 JSONL 줄과 기존 증거는 통과를 쉽게 만들기 위해 수정하지 않는다. 필요한 정정은 append-only 보정·재검증 레코드로 남긴다.
5. 하네스 변경 후 구문 검사, 관련 회귀 테스트, 전체 `npm run check`를 통과시키고 기존 원장 파일이 보존됐는지 해시로 확인한다. 판정이나 증거 계약을 바꾸는 수정은 별도 반박 검토를 받는다.
6. 재개 시 `--resume`을 사용해 새 `runtimeGenerationId`와 recovery 기록을 만든다. 변경의 영향을 받은 case는 기존 결과를 삭제하지 않고 새 `retestOf`/`supersedesResultId` 레코드로 다시 시험한다.

하네스 수정 전 결과는 자동으로 무효가 되지 않는다. 다만 수정된 결함의 영향을 받은 결과만 `PROVISIONAL`로 낮추고 재시험한다. 하네스 변경 사실을 숨긴 채 이전·이후 세대 결과를 하나의 동일 빌드 결과처럼 보고하면 안 된다.

## 8. 구조 완결 조건과 실제 검증 조건

다음을 모두 만족하면 이번 실행의 파일 묶음을 `STRUCTURE_COMPLETE_UNVERIFIED`로만 말할 수 있다.

1. 1,292개 runnable feature ID마다 terminal 결과가 정확히 하나 이상 있다.
2. runnable 목록의 미실행 ID가 0개다.
3. 모든 `FAIL`·`UNREACHABLE_CURRENT_BUILD`·`BLOCKED_EXTERNAL`에 화면 또는 로그 증거가 있다.
4. 실제 제외 208개의 수량과 사유가 meta 파일과 일치한다.
5. `feature-results.jsonl`, `issues.jsonl`, 화면·로그·산출물에 최종 `manifest.sha256`를 만든다.
6. 보고서는 원본 WSL parity 결과와 post-baseline customization 결과를 섞지 않는다.

최종 구조 게이트는 다음 명령이 exit 0이어야 한다.

```bash
mise x node@26.5.0 -- npm run wsl-test-results:check -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model
```

이 exit 0은 수량·필드·현재 HEAD·runtime preflight·PNG/로그·manifest의 **형식만** 갖춰진 `STRUCTURE_COMPLETE_UNVERIFIED` 판정이다. 적대 검사에서는 실제 앱을 전혀 띄우지 않고 1,292개 결과·고유 640×480 단색 PNG·ISO 로그·manifest·계획 종료 파일을 자체 작성해 구조 게이트를 통과시켰다. 따라서 이 명령은 실제 실행, 화면의 진위, owner 신원, 결과 해석을 보증하지 않는다.

현재 구조에서 캠페인을 `VERIFIED`로 승격하려면 별도 검토자가 다음을 독립적으로 확인해야 한다.

1. 시작·종료 시점의 실제 runtime lineage, CDP, host, daemon 원문 로그
2. 1,292개 각 결과와 연결된 전후 화면·효과·오류 증거의 실제 내용
3. `BLOCKED_EXTERNAL`·`UNREACHABLE_CURRENT_BUILD`가 실제 UI 시도에서 나온 판정인지
4. headline 수량을 원본 JSONL에서 재계산한 결과

이 독립 확인이 끝나기 전에는 “전체 기능 테스트 완료”라고 쓰지 않는다. 현재 구조 완결은 iOS, Docker, 외부 서비스 성공, Belmont식 에이전트 관리가 동작한다는 뜻도 아니다. 알려진 반례는 [checker 적대 감사](grok-bot-wsl-checker-adversarial-audit-2026-08-25.md)에 기록한다.
