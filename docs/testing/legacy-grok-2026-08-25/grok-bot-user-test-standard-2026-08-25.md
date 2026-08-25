# Grok Bot 실사용 테스트 실행 기준

- 상태: `ACTIVE_STANDARD`
- 기준일: 2026-08-25 KST
- 적용 범위: WSL에서 사용하는 실제 Grok Bot 단일 프로필 `.cache/wsl-profile`
- 가확정 추출 기준선: Git `0cc05f9`
- 안정 ID 기준선: [audit/grok-feature-registry.jsonl](audit/grok-feature-registry.jsonl)
- 현재 materialized 원장: [audit/grok-feature-registry-active.jsonl](audit/grok-feature-registry-active.jsonl)
- 마스터 계획: [grok-bot-full-feature-user-test-plan-2026-08-25.md](grok-bot-full-feature-user-test-plan-2026-08-25.md)
- 현재 실행서: [grok-bot-wsl-single-model-test-runbook-2026-08-25.md](grok-bot-wsl-single-model-test-runbook-2026-08-25.md)
- 원칙: 소스 존재·단위 테스트 통과·내부 API 응답만으로 실사용 `PASS`를 주지 않는다.

> 현재 실행 범위는 원본 Grok Bot WSL parity다. Belmont식 워커 확장은 `POST_BASELINE_CUSTOMIZATION`으로 분리하지만, 원본 agent·gate·외부·failure·restart 기능은 1,292개 runnable 분모에 포함한다. Cursor 로그인·계정·결제·사용량·접근권한 수명주기와 WSL에서 비활성인 앱 업데이트는 Codex Local 제품 N/A다. 사용할 수 없는 마이크·인증 장치 성공 상태, 누락된 배경화면 helper, unpackaged 빌드의 단일 인스턴스 잠금, 지원되지 않는 host-only 재시작 연속성도 현재 제품 구성에서 N/A로 별도 원장화한다.

## 1. 사용자가 체감할 장기 제품 최종 성공 상태

1. 사용자는 Grok하고만 대화한다.
2. Grok은 목표를 보고 직접 처리할지 워커를 사용할지 스스로 결정한다.
3. 워커가 필요하면 Grok이 생성·선택·지시·진행 관리·실패 처리를 맡는다.
4. Grok은 워커의 완료 신호만 전달하지 않고 실제 산출물을 열어 확인하거나 검증한 뒤 보고한다.
5. 대화·워커·산출물·기억이 다른 대화나 봇과 섞이지 않고 재실행 후에도 보존된다.
6. 작고 부수적인 기능까지 사용자에게 보이는 정상·경계·실패 상태가 정직하게 동작한다.

## 2. 문서와 증거의 권한 순서

충돌하면 아래 순서로 판정한다.

1. 실제 실행의 `feature-results.jsonl`, 화면, 영상, 로그와 결과 산출물
2. 이 실행 기준서의 PASS/FAIL 규칙
3. [전체 기능 실사용 검증 계획](grok-bot-full-feature-user-test-plan-2026-08-25.md)의 범위와 승인 경계
4. [검증 누락 원장](grok-bot-verified-gap-ledger-2026-08-25.md)과 [기존 원자 기능 원장](grok-bot-atomic-feature-ledger-2026-08-25.md)의 테스트 대상 후보
5. 소스 주석, README, 기존 단위 테스트

기능 원장은 “무엇을 시험할지”의 입력이다. 기능 원장 자체는 제품 동작이나 실사용 통과의 증거가 아니다.

### 2.1 테스트 하네스의 정의와 변경 권한

테스트 하네스는 제품 기능이 아니라 단일 실제 Grok Bot runtime을 실행·관찰하고, checkpoint·결과 JSONL·로그·화면·산출물을 연결하며, 재개와 구조 검사를 수행하는 시험 인프라다. 사용자가 일상적으로 쓰는 Grok Bot UI나 에이전트 기능과 구분한다.

테스트 중 하네스 결함을 발견하면 하네스는 변경할 수 있다. 다만 실행 중인 case/runtime을 먼저 중단하고 원본 증거를 보존하며, 하네스 수정과 제품 수정은 분리한다. 변경 후에는 새 runtime 세대에서 재개하고 영향받은 case를 append-only로 재검증한다. 기능 분모·기대 결과·기존 판정·기존 증거를 통과에 유리하게 소급 변경하는 것은 하네스 수정이 아니다. 상세 절차와 허용 파일 경계는 [단일 모델 실행서 §2.1·§7.1](grok-bot-wsl-single-model-test-runbook-2026-08-25.md)를 따른다.

## 3. 현재 기준선의 해석

`direct_observation`, 2026-08-25 KST:

- Git `0cc05f9`에 감사 문서와 후보 1,500개를 변경 없이 기준선으로 고정했다.
- 감사 대상 1,763개 파일의 해시 매니페스트는 `sha256sum -c`를 통과했다.
- 2026-08-25 15:36 KST preflight에서 실제 Grok Bot, observer, CDP `9347`, host `36841`과 daemon이 모두 종료된 상태로 확인됐다.
- 프로필의 gateway·daemon PID 파일은 종료된 PID를 가리킨다. 다음 모델은 새 `run-wsl-parity-single-model` 실행에서 정확히 한 runtime만 시작한다.

`documented_prior_claim`:

- 후보 2,475건에서 원자 행동 1,500개를 추출했다는 결과와 도달경로 분류는 감사 문서의 선행 주장이다.
- 파일별 정독 행위를 증명하는 워크플로 저널은 현재 커밋에 없으므로 “1,763파일 100% 정독”은 이 실행에서 독립 확인하지 못했다.

`PROVISIONAL_BASELINE` 제한:

- 기존 344개와 신규 1,500개를 단순 합산하지 않는다. 중복·포함 관계를 먼저 정규화한다.
- 신규 후보에는 안정 ID가 없고, 일부 행은 제목의 행 수와 실제 원자 수가 다르다.
- `verdict-ledger.csv`에는 `G1707`이 `UNJUDGED`로 남아 있다.
- 소스 참조 8건은 현재 저장소 경로와 일치하지 않는다.
- 기존 344개의 도달경로가 확정되지 않아 26~27% 커버율은 제품 완성도나 실사용 커버리지로 사용하지 않는다.

위 제한은 테스트 시작을 막지 않는다. 다만 분모 동결이나 “전체 검증 완료” 판정을 막는다.

## 4. 기능 ID와 원장 정규화 규칙

### 4.1 안정 ID

- 기준 레지스트리: `docs/audit/grok-feature-registry.jsonl` 1,500개
- 생성 메타데이터: `docs/audit/grok-feature-registry.meta.json`
- append-only 보정: `docs/audit/grok-feature-registry-updates.jsonl`
- 테스트 입력 원장: `docs/audit/grok-feature-registry-active.jsonl`
- 정규 원장 ID: `GBF-<경로>-<6자리>`
- 경로: `USR` 사용자 직접, `AGT` Grok/워커, `GAT` 게이트, `INT` 내부, `NAP` 현재 범위 제외
- 최초 등록 후 ID는 삭제하거나 재번호화하지 않는다.
- 기능을 분할하면 새 ID를 발급하고 `splitFrom`에 부모 ID를 남긴다.
- 중복을 합치면 기존 ID를 `SUPERSEDED`로 남기고 `supersededBy`를 기록한다.
- 새로 발견한 기능은 마지막 번호 뒤에 추가한다. 기존 번호를 밀어내지 않는다.
- 테스트 사례 ID: `<기능ID>-<축><2자리>`, 예: `GBF-USR-000013-E01`.
- 기준 레지스트리는 불변이다. `T-003`부터의 출처 수정·action/result 분리·split/merge는 append-only 보정 원장에 기록하고 materialized active registry를 별도로 만든다.

### 4.2 정규 원장 필수 필드

```json
{"featureId":"GBF-USR-000001","route":"USER_REACHABLE","severity":"P1","area":"Composer","action":"...","observableResult":"...","entrypoint":"...","sourceRefs":["..."],"inventoryStatus":"READY","splitFrom":null,"supersededBy":null}
```

`inventoryStatus`와 실행 판정을 분리한다.

- 원장 상태: `EXTRACTED`, `NEEDS_NORMALIZATION`, `READY`, `SUPERSEDED`, `OUT_OF_SCOPE`
- 실행 상태: `NOT_RUN`, `RUNNING`, `PASS`, `FAIL`, `BLOCKED`, `NOT_APPLICABLE`, `PROVISIONAL`

## 5. 평가 축과 판정 기준

모든 기능은 적용 가능한 축을 명시한다. 적용하지 않는 축에는 사유를 기록한다.

| 평가 축 | 통과 조건 | 필수 증거 | 실패 시 처리 |
| --- | --- | --- | --- |
| 도달성 | 사용자가 실제 화면에서 접근하거나 Grok이 사용자 요청에서 해당 도구 경로를 선택한다 | 진입 전후 화면, 사용자 입력 | 숨은 소스 기능은 `BLOCKED` 또는 결함 등록 |
| 정확성 | 한 행동이 기대한 화면 변화와 실제 효과를 정확히 한 번 만든다 | 전후 화면, 결과물, 관련 로그 | `FAIL`, 실제·기대 차이 기록 |
| 정직성·인과성 | 성공·진행·실패 표시가 실제 작업 상태와 일치하고 직접 내부 호출로 결과를 조작하지 않는다 | 화면과 독립 보조 로그/산출물 대조 | 거짓 성공은 P0/P1 후보 |
| 지속성·격리성 | 화면 이동·재열기·적용 가능한 재시작 후 보존되며 다른 대화·봇·작업과 섞이지 않는다 | 두 대상 비교, 재열기 전후 화면 | 혼합·유실은 P0/P1 후보 |
| 재현성·증거성 | 같은 사전조건과 조작으로 재현되며 실행 ID와 원본 증거가 연결된다 | JSONL 레코드, 스크린샷/영상, 로그, 해시 | 증거 부족 시 `PROVISIONAL`, PASS 금지 |
| 사용자 적합성 | 사용자가 로딩·승인·취소·완료·오류와 다음 행동을 이해할 수 있다 | 실제 렌더 화면/영상 | 기능은 되더라도 UX 결함 등록 |

## 6. 도달경로별 PASS 규칙

### 6.1 USER_REACHABLE

다음을 모두 만족해야 `PASS`다.

1. 실제 `.cache/wsl-profile`의 보이는 UI에서 마우스·키보드로 실행한다.
2. 조작 전 상태, 조작, 즉시 반응, 실제 효과, 재열기 상태를 기록한다.
3. renderer console과 실패 network 요청을 같은 실행 ID에서 확인한다.
4. DOM 직접 수정, 내부 함수 호출, gateway 직접 호출은 PASS 증거로 쓰지 않는다.

### 6.2 AGENT_REACHABLE

이번 원본 WSL parity에서는 사용자가 실제 Grok 대화창에 목표를 입력해 해당 기능의 사용자 가시 결과와 도구 효과를 확인한다. 워커를 직접 열거나 내부 함수를 호출해 성공을 만들지 않는다.

- 개별 기능의 `expectedBehavior`가 위임·서브에이전트·워커를 요구할 때만 그 생성·전달·결과 반환을 해당 기능의 PASS 조건으로 삼는다.
- 그 외 agent-reachable 기능은 그 기능 자체의 프롬프트, 도구 호출, 화면 결과, 파일·네트워크·상태 효과만 검증한다.
- Belmont식 “Grok이 항상 직접처리/위임을 선택하고 모든 산출물을 재검증해 최종 보고” 폐쇄루프는 `POST_BASELINE_CUSTOMIZATION`이며 이번 원본 기능 전체의 공통 PASS 조건이 아니다.
- 검증할 방법이 없는 결과를 성공으로 단정하면 `FAIL`; 실제 효과가 아직 확인되지 않았으면 `PROVISIONAL`이다.

### 6.3 GATED

- 계정·권한·기능 플래그가 없으면 게이트 표시와 실패 UX를 검증하고 `BLOCKED`로 남긴다.
- 실제 외부 효과가 있는 성공 경로는 해당 승인과 자격증명이 있을 때만 실행한다.
- 게이트를 내부 상태 조작으로 우회한 결과는 PASS가 아니다.

### 6.4 INTERNAL_ONLY

- UI PASS로 계산하지 않는다.
- 통합 테스트, 프로세스·로그 대조, 오류 주입과 복구 관찰로 검증한다.
- 사용자 상태에 영향을 주는 재시작·장애 주입은 사전 승인을 받는다.

### 6.5 NOT_APPLICABLE

- 현재 WSL·비Docker·보유 자격증명 범위에 적용되지 않는 이유와 소스 진입점을 함께 기록한다.
- 단순히 실행하기 어렵다는 이유로 `NOT_APPLICABLE`을 쓰지 않는다. 그 경우는 `BLOCKED`다.

## 7. 중간 검증과 최종 검증

### 7.1 중간 검증

- 기능 ID와 소스 참조가 정규 원장에 존재한다.
- preflight에서 단일 프로필·단일 Electron 세대·CDP target·host PID가 일치한다.
- 테스트 직전 기대 결과와 금지 조작을 기록한다.
- 조작 직후 화면, 결과, console/network/log를 확인한다.

중간 검증 통과만으로 `PASS`를 주지 않는다.

### 7.2 기능별 최종 검증

- 모든 필수 평가 축이 통과한다.
- 화면과 독립 보조 증거가 일치한다.
- 증거 파일이 실행 레코드에 연결되고 해시 매니페스트에 포함된다.
- 발견한 결함을 수정했다면 같은 테스트 사례 ID의 새 실행 레코드로 재검증한다.
- 주관적인 UI·문구 판정은 실제 렌더를 사람이 확인하기 전 `PROVISIONAL`로 둔다.

### 7.3 제품 전체 최종 검증

다음을 모두 만족하면 자동 도구는 `STRUCTURE_COMPLETE_UNVERIFIED`까지만 판정한다. 별도 검토 전에는 이번 WSL 원본 기능 실행을 `COMPLETE`라고 부르지 않는다.

1. `grok-wsl-test-runnable.jsonl`의 1,292개 feature ID에 terminal 결과가 있다.
2. runnable 범위 내 미실행 ID와 근거 없는 판정이 0개다.
3. FAIL·UNREACHABLE_CURRENT_BUILD·BLOCKED_EXTERNAL에 재현 증거가 있다.
4. 현재 runnable 범위의 P0·P1 미해결 결함이 0개이거나 명시적으로 전체 verdict를 낮춘다.
5. 실행 불가능·Codex N/A로 제외된 208개의 수량과 사유가 `grok-wsl-test-queue.meta.json`과 일치한다.
6. 실행 결과와 증거가 최종 `manifest.sha256`에 포함된다.
7. 최종 사용 화면을 확인하고 WSL parity와 post-baseline customization 결론을 분리한다.

자동 checker의 exit 0은 `STRUCTURE_COMPLETE_UNVERIFIED` 구조 판정이다. 실제 runtime 없이 자체 작성한 1,292개 결과·고유 단색 PNG·로그·manifest가 이 게이트를 통과하는 반례가 확인됐다. 실행자가 만든 화면·로그의 진위와 의미, runtime lineage, headline 결과는 별도 검토자가 각 결과의 원본 증거를 다시 읽어야 `VERIFIED`로 승격할 수 있다.

## 8. 증거 계약

실행 루트는 `artifacts/grok-bot-user-e2e-20260825/<run-id>/`다.

필수 파일:

- `run.json`: HEAD, 프로필 절대 경로, PID, CDP/host endpoint, 승인 범위, 기능 분모
- `status.json`: 현재 기능 ID, 상태, 마지막 heartbeat, 다음 행동
- `feature-results.jsonl`: append-only 기능 판정 원장
- `issues.jsonl`: 결함, 심각도, 재현 절차, 연결된 기능 ID
- `logs/`: Electron, host, daemon, browser console, network, process health
- `screenshots/`, `videos/`, `outputs/`: 사용자 화면과 실제 산출물
- `manifest.sha256`: 실행 종료 시 모든 증거 해시

`run.json`에는 실제 실행자, Git HEAD, 단일 실제 프로필, CDP 포트와 queue/runnable 해시·수량을 고정한다. `preflight.json`, `status.json`, `checkpoint.json`도 최종 manifest에 포함한다. `PROVISIONAL`은 관찰 레코드일 뿐 terminal 완료로 계산하지 않는다.

기능 결과 최소 형식:

```json
{"resultId":"RUN-...-GBF-AGT-000001-N01-001","runId":"RUN-...","caseId":"GBF-AGT-000001-N01","featureId":"GBF-AGT-000001","axis":"N","precondition":"...","userAction":"...","expected":"queue expectedBehavior 원문","actual":"...","status":"PASS","effectCheck":"재열기 또는 실제 효과 대조","uiEvidence":["screenshots/...before.png","screenshots/...after.png"],"effectEvidence":["outputs/..."],"supportingEvidence":["logs/host.jsonl#..."],"variantResults":null,"retestOf":null,"observedAt":"..."}
```

`requiredVariants`가 있는 기능은 `variantResults`에 모든 variant의 이름·상태·실제 관찰·variant 고유 증거를 정확히 한 번씩 기록한다. `UNREACHABLE_CURRENT_BUILD`는 서로 다른 두 `entrypointAttempts`와 각 UI 증거, `BLOCKED_EXTERNAL`은 `blocker`와 `blockedAt`, `PROVISIONAL`은 `openEvidenceGaps`가 필요하다. 원본 레코드는 수정하지 않는다. 오판·재검증은 새 줄로 추가하고 직전 `resultId`를 `supersedesResultId` 또는 `retestOf`로 연결한다. token, password, OAuth code, 인증 헤더는 기록하지 않는다.

## 9. 결함 심각도

- `P0`: 사용자 데이터 손상·교차 대화/봇 혼합·거짓 완료 보고·복구 불능
- `P1`: 핵심 대화/위임/검증/보고 흐름 실패, 주요 결과 오류, 지속적인 작업 유실
- `P2`: 개별 기능 실패나 불명확한 오류지만 우회 가능
- `P3`: 기능 효과는 맞으나 문구·정렬·시각 피드백 등 품질 저하

P0/P1을 발견하면 관련 후속 기능의 결과를 오염시킬 수 있는지 먼저 판단한다. 오염되면 해당 묶음을 중단하고 결함 재현과 범위를 고정한다.

## 10. 실패 처리

- `FAIL`: 재현 절차와 원본 증거를 즉시 고정하고 다음 기능과의 의존성을 기록한다.
- `BLOCKED`: 막힌 외부 조건, 확인한 우회 불가 근거, 해제 조건을 기록한다.
- `PROVISIONAL`: 부족한 축이나 증거를 명시하고 PASS 집계에서 제외한다.
- 앱·host·daemon 비정상 종료: 현재 case를 중단하고 마지막 정상 heartbeat·PID·로그 offset을 보존한다. 임의 재시작하지 않는다.
- 테스트가 원장 원자성을 깨뜨리는 경우: 기존 ID를 덮어쓰지 않고 split/merge lineage를 등록한 뒤 재실행한다.

## 11. 실행 순서

1. active registry와 WSL queue의 재현성 검사
2. 기존 단일 실제 프로필·CDP·observer preflight
3. `RUNNABLE_NOW` 1,292개를 `runnableSequence` 순서로 실제 UI 실행
4. 각 기능 즉시 terminal 판정·화면·오류·실제 효과 기록
5. 미실행 0·증거 누락 0·제외 수량·manifest 해시 대조
6. WSL 원본 parity 보고서 동결
7. agent·external·fault·gate·restart·destructive 후반 배치까지 같은 테스트 실행에서 검증

현재 다음 작업은 [단일 모델 실행서](grok-bot-wsl-single-model-test-runbook-2026-08-25.md)에 따라 다른 한 모델이 1,292개 runnable 기능을 연속 실행하는 것이다. 제품 소스 수정은 테스트 runtime과 섞지 않는다. 하네스 결함은 실행을 중단하고 §2.1 절차로 별도 수정·검증한 뒤 새 runtime 세대에서 재개할 수 있다.
