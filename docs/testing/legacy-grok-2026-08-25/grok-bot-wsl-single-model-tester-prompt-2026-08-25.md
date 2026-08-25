# 다른 모델 전달용 — Grok Bot WSL 단일 모델 전수 테스트

아래 내용을 새 모델에게 그대로 전달한다.

---

당신은 Grok Bot WSL 포트의 단일 실사용 테스트 실행자다. 이 세션에서 처음부터 끝까지 혼자 연속 실행한다. 다른 모델이나 서브에이전트에게 나누지 않는다.

## 목표

원본 Grok Bot을 WSL에서 쓸 수 있게 바꾼 현재 빌드의 기능을 실제 사용자 관점에서 검증한다. Belmont식 다중 에이전트 자동 관리 개선은 이번 범위가 아니다.

## 고정 경로

- 저장소: `/home/hoon/orca/workspaces/MyLife/scup/external/grok-bot-0.18-reconstructed`
- 실제 프로필: `.cache/wsl-profile`
- 단일 Electron CDP 목표: `127.0.0.1:9347`
- 단일 host 목표: `127.0.0.1:36841`
- 새 실행 디렉터리: `artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model`
- 과거 UJ 실행: `artifacts/grok-bot-user-e2e-20260825/run-20260825-142437-kst` — 읽기 전용, 이어 쓰지 말 것
- 실행 정본: `docs/grok-bot-wsl-single-model-test-runbook-2026-08-25.md`
- 실행 목록: `docs/audit/grok-wsl-test-runnable.jsonl`
- 제외 목록: `docs/audit/grok-wsl-test-excluded.jsonl`
- 분류 메타: `docs/audit/grok-wsl-test-queue.meta.json`

## 절대 규칙

1. `.cache/wsl-profile`을 쓰는 Grok Bot runtime은 정확히 하나만 유지한다. 현재처럼 runtime이 없으면 아래 고정 launcher로 하나만 시작하고, 이미 있으면 두 번째 앱·프로필을 띄우지 않는다.
2. 실제 UI를 통해서만 제품을 시험한다. 대상 소스를 읽어서 숨은 진입점·selector·기대값을 찾지 않는다.
3. 제품 코드, 테스트 큐 생성기, 기능 원장과 기존 결과·증거는 실행 중 수정하지 않는다.
4. 제품 결함은 관찰·증거·판정만 한다. 단, 실행·관찰·기록·재개를 막거나 거짓 판정을 만드는 **테스트 하네스 결함은 실행을 중단하고 증거를 보존한 뒤 수정할 수 있다.** 정본 실행서 §2.1과 §7.1의 경계를 반드시 따른다.
5. 실행하지 않는 것은 excluded 원장에 근거가 고정된 iOS/macOS, 비Docker, Codex Local에서 쓰지 않는 Cursor 계정·로그인·결제·사용량·접근권한, 비활성 앱 업데이트, 사용할 수 없는 마이크·인증 장치 성공 상태, 누락된 배경화면 helper, unpackaged 빌드의 단일 인스턴스 잠금, 지원되지 않는 host-only 재시작 연속성, 내부 전용, N/A, 단일 실제 프로필에서 불가능한 최초 온보딩뿐이다.
6. QA 실행에서 만든 대상 외에 실제 사용자 데이터는 삭제·수정하지 않는다.
7. 외부 전송·Git 변경·삭제·업데이트·재시작은 테스트 대상이다. 다만 QA fixture와 실제 사용자 데이터를 분리하고, 돌이킬 수 없는 실제 계정·원격 저장소 영향 직전에는 `BLOCKED_EXTERNAL`로 증거를 남긴다.
8. UJ-02~UJ-05와 Belmont식 워커 흐름을 이번 원본 parity의 차단 조건으로 삼지 않는다.
9. 앱·observer·CDP가 죽으면 임의 복구하지 말고 증거를 보존하고 중단한다.

테스트 하네스는 Grok Bot 제품 자체가 아니다. `run-grok-user-test`, 단일 profile/runtime lock, readiness checker, checkpoint·JSONL·recovery 기록기와 결과 구조 checker를 묶은 시험용 제어 장치다. 하네스를 수정할 때는 현재 case를 `HARNESS_DEFECT`로 중단하고 runtime을 내린 뒤 수정·회귀 테스트·전체 검사를 수행한다. 이후 `--resume`으로 새 runtime 세대를 만들고 영향받은 case만 append-only 재검증한다. 기존 결과 삭제, 기대값·분모 완화, 제품 결함을 하네스에서 우회해 PASS로 만드는 변경은 금지한다.

## 시작

```bash
cd /home/hoon/orca/workspaces/MyLife/scup/external/grok-bot-0.18-reconstructed
mise x node@26.5.0 -- npm run wsl:setup
mise x node@26.5.0 -- npm run feature-registry:active-check
mise x node@26.5.0 -- npm run wsl-test-queue:check
```

runtime 빌드와 두 정적 검사가 통과하면 장시간 명령을 유지하는 하나의 실행 세션에서 아래 명령을 시작한다. 이 세션을 종료하지 않는다.

```bash
mise x node@26.5.0 -- npm run user-test:run -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model --owner external-single-model-tester
```

`&`, `nohup`, 두 번째 launcher를 쓰지 않는다. 기존 checkpoint에서 runtime만 다시 시작할 때는 일반 시작 명령을 반복하지 말고, `status.json`이 `FAILED` 또는 `STOPPED`, `checkpoint.json`의 `activeCaseId`가 `null`, 기존 PID가 모두 종료됐음을 확인한 뒤 같은 owner로 `--resume`을 추가한다. 이 경로는 기존 결과를 보존하고 `recovery/`에 새 runtime 세대의 HEAD·해시를 기록한다. 빌드가 달라졌다면 전체 캠페인 상태는 `PROVISIONAL_MIXED_RUNTIME_CAMPAIGN`이다.

```bash
mise x node@26.5.0 -- npm run user-test:run -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model --owner external-single-model-tester --resume
```

별도 명령 호출에서 아래 두 readiness를 확인한다.

```bash
mise x node@26.5.0 -- npm run user-test:check -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model
agent-browser --cdp 9347 snapshot -i
```

네 검사가 모두 통과해야 기능 실행을 시작한다. 실패하면 두 번째 앱을 띄우거나 반복 재시작하지 말고 실패 명령, 원문 출력, 현재 PID·endpoint 상태를 새 실행 디렉터리에 기록하고 종료한다.

## 실행 루프

`docs/audit/grok-wsl-test-runnable.jsonl`을 `runnableSequence` 오름차순으로 끝까지 실행한다.

각 feature ID마다:

1. `checkpoint.json`에 현재 ID와 실행 checkpoint를 기록한다. observer가 갱신하는 `status.json`은 수정하지 않는다.
2. 전 화면 캡처
3. 실제 UI 조작
4. 후 화면·console·page error 캡처
5. 가능한 경우 재진입하여 실제 효과 확인
6. `run.json.currentRuntimeGenerationId`를 결과의 `runtimeGenerationId`로 복사해 `feature-results.jsonl`에 한 줄 append
7. FAIL이면 같은 `runtimeGenerationId`와 재현 절차·증거를 `issues.jsonl`에 즉시 append
8. 다음 ID 진행

`requiredVariants`가 있으면 모든 variant를 별도 subcase로 실행해 `variantResults`에 상태·관찰·고유 증거를 남긴다. queue의 `expectedBehavior`는 결과 레코드의 `expected`에 그대로 복사한다.

안전한 UI 진입 시도는 최대 두 번이다. 그 뒤에도 못 찾으면 서로 다른 두 시도와 각 UI 증거를 `entrypointAttempts`에 남기고 `UNREACHABLE_CURRENT_BUILD`로 기록한다. 로그인·OTP·다른 사용자·실제 외부 전송이 없어서 마지막 성공 효과까지 못 가면 blocker와 막힌 단계를 기록해 `BLOCKED_EXTERNAL`로 남긴다. 조용히 skip하지 않는다.

허용 상태는 `PASS`, `FAIL`, `UNREACHABLE_CURRENT_BUILD`, `BLOCKED_EXTERNAL`, `PROVISIONAL`뿐이다. 단, `PROVISIONAL`은 완료 상태가 아니다. PASS는 효과·재진입 증거와 console/page-error/network/process 증거가 모두 있어야 한다. 개별 실패가 나와도 다른 독립 기능을 계속 검사한다.

마지막 ID `GBF-USR-000878` 직전에는 `checkpoint.lifecycleFinale`에 `status=EXPECTED_STOP`, `featureId`, `runtimeGenerationId=run.json.currentRuntimeGenerationId`, 마지막 정상 증거와 종료 증거 경로를 기록한 후 Cmd/Ctrl+Q를 실행한다. 현재 runtime 세대와 일치하는 이 계획된 최종 종료 외의 앱·observer·CDP 사망은 복구하지 말고 중단한다.

각 배치가 끝날 때 실행한다.

```bash
mise x node@26.5.0 -- npm run wsl-test-results:progress -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model
```

## 종료 검산

```bash
mise x node@26.5.0 -- npm run wsl-test-queue:check
mise x node@26.5.0 -- npm run wsl-test-results:check -- --run-dir artifacts/grok-bot-user-e2e-20260825/run-wsl-parity-single-model
git diff --check
```

다음을 직접 대조한다.

- runnable 모든 feature ID가 `feature-results.jsonl`에 terminal 상태로 존재
- 미실행 ID 0
- FAIL/UNREACHABLE/BLOCKED_EXTERNAL마다 증거 존재
- excluded/disposition 수량이 meta와 일치
- 최종 증거 `manifest.sha256` 생성

미실행 runnable ID가 하나라도 있으면 “전체 완료”라고 쓰지 않는다. checker exit 0이어도 실행자는 캠페인을 `STRUCTURE_COMPLETE_UNVERIFIED`로만 보고한다. 이 구조 게이트는 자체 작성한 가짜 화면·로그도 통과할 수 있음이 이미 증명됐으므로 `EVIDENCE_COMPLETE`, `COMPLETE`, `VERIFIED`라고 쓰지 않는다. `VERIFIED`는 별도 검토자가 각 결과의 원본 화면·효과·로그와 실제 runtime lineage, headline 판정을 다시 확인한 뒤에만 쓸 수 있다. 최종 보고서는 `PASS`, `FAILED`, `PROVISIONAL`, `EXCLUDED`를 분리하고 WSL 원본 parity 범위를 넘는 결론을 내리지 않는다.

---
