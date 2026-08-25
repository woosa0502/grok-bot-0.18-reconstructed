# Grok Bot 전체 기능 실사용 검증 계획

- 상태: `IN_PROGRESS`
- 기준일: 2026-08-25 KST
- 대상: WSL에서 실행되는 실제 Grok Bot 프로필 하나
- 실제 프로필: `.cache/wsl-profile`
- 기능 원장: [grok-bot-atomic-feature-ledger-2026-08-25.md](grok-bot-atomic-feature-ledger-2026-08-25.md)
- 가확정 추출 기준선: [grok-bot-verified-gap-ledger-2026-08-25.md](grok-bot-verified-gap-ledger-2026-08-25.md), Git `0cc05f9`
- 실행 판정 기준: [grok-bot-user-test-standard-2026-08-25.md](grok-bot-user-test-standard-2026-08-25.md)
- 현재 단일 모델 실행서: [grok-bot-wsl-single-model-test-runbook-2026-08-25.md](grok-bot-wsl-single-model-test-runbook-2026-08-25.md)
- 현재 판정: active 기능 1,500개 중 실제 WSL 사용자 테스트 1,292개와 실행 불가능·Codex 제품 N/A 208개를 분리했다. 실사용 실행 전이므로 제품 통과 판정 금지

> 2026-08-25 범위 교정: 지금 먼저 검증할 것은 원본 Grok Bot의 WSL parity다. 아래의 Belmont식 Grok→워커→산출물 검증→보고 목표는 `POST_BASELINE_CUSTOMIZATION`으로 분리한다. 다만 원본의 agent-reachable 기능 자체는 1,292개 테스트 분모에 포함해 현재 빌드에서 실제로 실패하는지도 판정한다.

## 1. 목표

Grok Bot의 화면, 프로토콜, 에이전트 도구, 백그라운드 동작과 복구 동작을 가장 작은 사용자 관찰 단위까지 추출하고, 사용자가 실제로 쓸 단일 프로필에서 각 기능을 검증한다.

사용자가 체감할 장기 제품 최종 성공 상태는 다음과 같다. 이는 현재 원본 WSL parity 실행 뒤의 확장 목표다.

1. 사용자는 Grok하고만 대화한다.
2. Grok은 목표를 이해하고 직접 처리할지 다른 봇을 사용할지 결정한다.
3. 필요하면 Grok이 봇을 만들고, 작업을 전달하고, 진행과 실패를 관리한다.
4. 봇의 결과를 Grok이 확인한 뒤 사용자에게 필요한 결과만 보고한다.
5. 대화, 봇, 메모리, 설정과 진행 상태가 서로 섞이지 않고 재시작 후에도 보존된다.
6. 제공되는 모든 부가 기능은 정상·경계·실패 상태에서 정직하게 동작한다.

## 2. 검증 대상과 제외 대상

### 포함

- 시작, 온보딩, 계정, 창과 업데이트
- 대화 작성, 응답, 스트리밍, 기록, 검색, 첨부, 미디어와 반응
- 봇 생성, 수정, 복제, 분류, 숨김, 삭제와 그룹
- Grok의 봇 조회·생성·수정·작업 전달
- 서브에이전트 시작, 확인, 개입, 중단과 완료 회신
- 메모리 조회·삭제·전체 삭제
- 컴퓨터, 브라우저, 파일, 터미널과 권한 요청
- 플러그인, MCP, 인증, 계정과 스킬
- 자동화, 워크플로, 루틴과 예약 실행
- 채널, 공유 방, 에이전트 네트워크와 브로드캐스트
- Router, Codex/Claude Code/OpenRouter/Cursor, 사용량과 오류
- 박스, 로컬 실행, 저장소, 업데이트, 재연결과 복구
- 키보드, 포커스, 좁은 창, 로딩, 빈 상태, 오류 문구와 성능

### 현재 제외

- 별도 테스트 프로필 또는 두 번째 Grok Bot 실행
- Docker 경로. 사용자가 Docker를 사용하지 않기로 했으므로 비활성·오류 안내만 확인한다.
- 계정이나 자격증명이 없는 외부 서비스의 실제 성공 호출. 비활성·인증 필요·실패 UX는 검증하되 성공 경로는 `BLOCKED`로 남긴다.
- 실제 사용자 데이터의 삭제·메모리 초기화·플러그인 제거·박스 리셋. 동일 프로필 안에서 만든 `QA-20260825-*` 대상만 조작하며, 실제 데이터에 영향을 줄 수 있는 동작은 별도 승인을 받는다.

## 3. 현재 상태 부트 기록

`direct_observation`, 2026-08-25 KST, 최신 갱신:

- Git 추출 기준선: `0cc05f9` (`Establish provisional Grok Bot feature extraction baseline`)
- 베이스라인 검증: frontend typecheck, source typecheck, 테스트 14/14 통과
- WSLg, Node `26.5.0`, Linux Electron, `.build/clean-runtime`과 실제 `.cache/wsl-profile`이 존재한다.
- 2026-08-25 15:36 KST preflight에서 실제 Grok Bot launcher/Electron/host, observer, daemon, CDP가 모두 종료된 상태로 확인됐다.
- CDP `127.0.0.1:9347`과 이전 host `127.0.0.1:36841`은 응답하지 않는다.
- `.cache/wsl-profile/sand-data/gateway.json`은 종료된 이전 host PID를 가리키므로 현재 readiness 증거로 사용할 수 없다.
- Linux `agent-browser`의 기존 CDP attach 성공 증거는 있으나 현재는 attach할 runtime이 없다.
- 앱·host·daemon을 새로 실행하거나 재시작하지 않았다.
- 기존 원자 기능 원장 1차 등록: 344개
- 가확정 신규 후보: 1,500개. 안정 ID·중복·출처 정규화 전이므로 기존 344개와 합산 금지
- gateway 명령 매핑: 123/123. 이는 소스 매핑 완료이며 실사용 PASS가 아니다.

## 4. 용어

- **기능 표면**: 사용자가 조작하거나 결과를 관찰할 수 있는 화면·명령·도구·백그라운드 경계.
- **원자 기능**: 하나의 사전조건, 하나의 사용자 행동, 하나의 관찰 가능한 결과로 판정할 수 있는 최소 기능.
- **시나리오**: 원자 기능을 정상·경계·실패·지속성 조건에서 실행하는 절차.
- **오라클**: PASS/FAIL을 결정하는 관찰 가능한 기준.
- **실사용 증거**: 실제 UI의 전후 스크린샷, 재현 영상, 콘솔 오류와 결과 산출물.
- **보조 증거**: 로그, 저장 파일, 프로세스와 내부 상태. UI 성공을 대신할 수 없다.

## 5. 기능 추출 방법

기능 원장의 분모는 다음 다섯 표면을 독립적으로 추출한 뒤 서로 대조해 고정한다.

1. **UI 상향식 추출**
   - 화면, 패널, 메뉴, 버튼, 입력, 키보드 동작, 빈 상태, 로딩 상태와 오류 상태를 추출한다.
2. **게이트웨이 하향식 추출**
   - `source/host/gateway-protocol.ts`의 123개 명령을 모두 사용자 기능 또는 내부 전용 기능에 매핑한다.
3. **에이전트 도구 추출**
   - Grok과 워커가 호출할 수 있는 생성·메시징·서브에이전트·브라우저·컴퓨터·파일·MCP 도구를 추출한다.
4. **Electron/백그라운드 추출**
   - IPC, 계정, 창, 업데이트, 로컬 실행, 알림, 자동화, 공유와 재연결 동작을 추출한다.
5. **문서·실제 화면 역대조**
   - README의 주장과 실제 UI 노출을 비교한다. 소스에는 있으나 접근 불가능한 기능, UI에는 있으나 명령과 연결되지 않은 기능을 별도 결함으로 기록한다.

추출 완료 조건:

- 게이트웨이 명령 123/123이 기능 원장 행 또는 내부 전용 사유에 연결됨
- 사용자 조작 컨트롤 100%가 기능 원장 행에 연결됨
- 에이전트 도구 100%가 기능 원장 행에 연결됨
- 설정·백그라운드 상태 전이 100%가 정상/오류/복구 시나리오에 연결됨
- 출처 없는 기능 행과 기능 행 없는 사용자 진입점이 0개

## 6. 단일 실제 앱 테스트 원칙

1. 실제 `.cache/wsl-profile` 하나만 사용한다.
2. 자동화는 기존 CDP `9347`에 연결만 하며 새 앱이나 새 프로필을 띄우지 않는다.
3. 실제 마우스·키보드·보이는 컨트롤로 조작한다.
4. DOM 직접 수정, 내부 함수 호출, 게이트웨이 직접 호출은 PASS 증거로 인정하지 않는다.
5. 테스트 데이터가 필요하면 동일 프로필에서 UI로 `QA-20260825-*` 객체를 만든다.
6. 기능별 테스트 전 기준 화면과 대상 수를 기록하고, 테스트 후 정리 여부를 기록한다.
7. 재시작 검증은 같은 앱·같은 프로필로 수행하며 사전 승인을 받는다.
8. 정적 문제는 스크린샷, 상호작용·타이밍 문제는 단계별 스크린샷과 재현 영상을 남긴다.
9. 문제를 찾으면 다음 기능으로 넘어가기 전에 즉시 재현 절차와 증거를 기록한다.

### 6.1 기능 하나의 폐쇄 루프

모든 기능은 다음 순서를 독립적으로 통과해야 한다.

1. 기능 ID와 시작 상태, 대상 수, 기대 결과를 기록한다.
2. 실제 UI에서 마우스·키보드로 한 가지 사용자 행동을 수행한다.
3. 즉시 화면 반응과 진행·오류 표시를 확인한다.
4. 생성된 데이터, 전달된 작업, 파일, 도구 호출 등 실제 효과를 확인한다.
5. 화면 이동·재열기로 상태 지속성과 다른 대화·봇과의 격리를 확인한다.
6. 적용 가능한 기능은 승인된 동일 앱 재시작 후 다시 확인한다.
7. 화면 증거와 보조 로그가 일치할 때만 `PASS`로 기록한다.

내부 API 응답, 소스 테스트 또는 로그 한 종류만으로는 실사용 `PASS`를 줄 수 없다. 화면은 성공처럼 보이지만 실제 효과가 없거나, 실제 효과는 생겼지만 화면이 거짓 상태를 보이는 경우 모두 `FAIL`이다.

## 7. 기능별 검증 축

각 원자 기능에 적용 가능한 축을 표시한다.

| 축 | 통과 조건 | 필수 증거 | 실패 처리 |
| --- | --- | --- | --- |
| 정상 | 사용자 행동 한 번으로 기대 결과가 보임 | 전후 화면과 결과 | FAIL 등록 |
| 경계 | 빈 값·긴 값·중복·빠른 전환이 데이터 손상 없이 처리됨 | 입력과 결과 화면 | FAIL 등록 |
| 오류 | 실패가 사라지거나 거짓 성공하지 않고 이해 가능한 상태로 표시됨 | 오류 화면·콘솔 | FAIL 등록 |
| 지속성 | 이동·재열기·승인된 재시작 뒤 상태가 보존됨 | 전후 비교 | FAIL 등록 |
| 격리성 | 다른 대화·봇·계정 상태가 섞이지 않음 | 두 대상 비교 | Critical/High 후보 |
| 사용자 적합성 | 로딩·취소·진행·완료가 사용자가 이해할 수 있게 표시됨 | 화면/영상 | UX 이슈 등록 |

## 8. 핵심 사용자 여정 승인 시나리오

### UJ-01 직접 처리

사용자가 구현 방법을 지정하지 않고 목표만 말한다. Grok이 불필요한 봇을 만들지 않고 직접 처리해 결과를 보고한다.

### UJ-02 단일 워커

사용자가 목표만 말한다. Grok이 필요한 전문 봇을 백그라운드에서 만들거나 기존 봇을 선택하고, 작업을 전달하고, 결과를 받은 뒤 검토하여 사용자에게 보고한다. 활성 대화는 Grok에서 바뀌지 않아야 한다.

### UJ-03 복수 워커

독립된 두 작업이 필요한 목표를 말한다. Grok이 필요한 수만큼만 병렬 위임하고, 중복 작업 없이 결과를 취합·검토한다.

### UJ-04 워커 실패

한 워커가 실패하거나 잘못된 결과를 보낸다. Grok이 실패를 성공으로 보고하지 않고 재시도·대체·사용자 보고 중 적절한 행동을 선택한다.

### UJ-05 중간 재시작

작업 중 동일 앱을 승인 후 재시작한다. 대화, 봇, 위임 기록과 완료 결과가 유실되거나 다른 대화로 섞이지 않아야 한다.

## 9. 증거 구조

실사용 테스트를 시작할 때 다음 경로를 만든다.

```text
artifacts/grok-bot-user-e2e-20260825/
├── README.md
├── run.json
├── status.json
├── feature-results.jsonl
├── issues.md
├── manifest.sha256
├── logs/
│   ├── test-run.log
│   ├── electron.log
│   ├── host.log
│   ├── browser-console.jsonl
│   ├── network.jsonl
│   ├── process-health.jsonl
│   └── local-exec-daemon.log
├── screenshots/
├── videos/
└── recovery/
```

### 9.1 실행 메타데이터

`run.json`에는 최소한 다음을 고정한다.

- 실행 ID, 시작·종료 시각과 실행 주체
- Git commit `bf5256e` 또는 실제 테스트 시점 HEAD
- 실제 프로필의 절대 경로
- Electron·host·local-exec PID와 시작 시각
- CDP port와 동적으로 발견한 host endpoint
- 테스트 대상 기능 분모와 시작 시 `NOT_RUN` 수
- 승인받은 상태 변경 범위와 금지 대상

### 9.2 기능 결과 레코드

`feature-results.jsonl`은 한 줄에 한 기능·한 시나리오를 기록한다.

```json
{"runId":"...","featureId":"ORCH-007","axis":"N","startedAt":"...","precondition":"...","action":"...","expected":"...","actual":"...","status":"PASS","evidence":["screenshots/ORCH-007-03.png"],"supportingLogs":["logs/host.log#..."]}
```

필수 필드는 실행 ID, 기능 ID, 검증 축, 시작 상태, 실제 사용자 조작, 기대 결과, 실제 결과, 증거 경로, 판정, 재검증 여부다. 원본 레코드는 수정하지 않고 재검증 결과를 새 줄로 추가한다.

### 9.3 로그 수집 범위

- `test-run.log`: 기능 시작·종료, 사용자 조작, 판정 변경을 사람이 읽을 수 있게 기록
- `electron.log`, `host.log`: launcher가 현재 터미널로 내보내는 stdout/stderr를 파일에도 동시에 보존
- `browser-console.jsonl`: renderer console 오류와 경고
- `network.jsonl`: 실패 요청, 상태 코드, 소요 시간. 인증 헤더와 본문 비밀값은 기록 금지
- `process-health.jsonl`: Electron·host·daemon PID, endpoint readiness와 비정상 종료
- `local-exec-daemon.log`: 실제 프로필의 기존 daemon 로그를 실행 범위만 복사하거나 offset으로 참조
- 스크린샷·영상: 정적 문제는 주석 스크린샷, 상호작용·타이밍 문제는 단계별 화면과 재현 영상

현재 실제 프로필에는 `local-exec-daemon.log`, `inference-router-transcript.json`, 봇별 SQLite 저장소가 존재한다. 소스에는 봇별 `audit.jsonl` 기록 기능도 있으나 실제 테스트 run에서 파일 생성과 이벤트 범위를 다시 확인하기 전에는 활성 로그로 간주하지 않는다.

로그에는 비밀번호, OAuth code, token, secret 입력값, 인증 헤더를 남기지 않는다. 마지막에 `manifest.sha256`으로 증거 파일의 해시를 고정한다.

### 9.4 CLI 관찰 경로

CLI는 새 브라우저나 새 프로필을 실행하지 않고 실제 Electron CDP에 연결만 한다.

```sh
agent-browser --cdp 9347 snapshot -i
agent-browser --cdp 9347 screenshot --annotate screenshots/current.png
agent-browser --cdp 9347 diff snapshot
agent-browser --cdp 9347 console
agent-browser --cdp 9347 errors
curl http://127.0.0.1:9347/json/list
```

테스트 실행 중 사용자는 다음 파일로 진행을 확인할 수 있다.

```sh
tail -f artifacts/grok-bot-user-e2e-20260825/logs/test-run.log
watch -n 1 cat artifacts/grok-bot-user-e2e-20260825/status.json
tail -f artifacts/grok-bot-user-e2e-20260825/feature-results.jsonl
```

CLI readiness 통과 조건:

1. 실제 프로필을 쓰는 Electron 프로세스가 정확히 한 세대다.
2. CDP `/json/list`에 실제 Grok Bot renderer target이 하나 이상 보인다.
3. `agent-browser --cdp 9347 snapshot -i`가 보이는 앱 UI를 반환한다.
4. host `/health`와 gateway discovery의 PID가 실제 프로세스와 일치한다.
5. stdout/stderr, console, network, process health가 같은 실행 ID 디렉터리에 기록된다.
6. CLI가 DOM 변경·내부 함수·gateway 직접 호출 없이 화면 조작만 수행한다.

## 10. 판정

- `NOT_RUN`: 기능은 추출됐지만 아직 실행하지 않음
- `PASS`: 실제 UI와 결과 증거로 통과
- `FAIL`: 기대와 다른 결과를 재현함
- `BLOCKED`: 외부 계정·승인·환경이 없어 실행 불가
- `NOT_APPLICABLE`: 현재 WSL/비Docker 제품 범위에 적용되지 않으며 근거가 있음
- `PROVISIONAL`: 한 번 관찰했지만 재시작·오류·독립 확인이 남음

이번 WSL 원본 기능 실행 `COMPLETE` 조건:

1. `grok-wsl-test-runnable.jsonl`의 1,292개 ID가 모두 terminal 판정을 가짐
2. runnable 범위 내 미실행 ID 0개
3. FAIL·UNREACHABLE·BLOCKED_EXTERNAL에 기능별 증거가 기록됨
4. 실제 제외 208개의 사유와 수량이 meta 원장과 일치함
5. 실행 증거가 `manifest.sha256`으로 동결됨
6. WSL 원본 parity와 post-baseline customization 결과를 분리함

UJ-02~UJ-05와 Belmont식 워커 관리는 위 `COMPLETE` 뒤 별도의 제품 확장 검증에서 판정한다.

## 11. 승인 경계

다음은 실행 전에 사용자 승인을 받는다.

- 실제 앱 재시작
- 실제 사용자 데이터 삭제 또는 전체 메모리 삭제
- 플러그인·MCP 설치/제거와 외부 계정 연결
- 알림 발송, 공유 방 초대, 브로드캐스트 등 외부 영향
- 박스 초기화·업데이트·저장소 전체 삭제

## 12. TODO

상태는 `DONE`, `IN_PROGRESS`, `PENDING`, `BLOCKED`, `APPROVAL_REQUIRED`로 관리한다.

### Phase 0 — 기준선과 분모

- [x] `T-000 DONE` 마스터 계획·기존 344개 원장 생성
- [x] `T-001 DONE` 신규 1,500개 후보와 감사 산출물을 Git `0cc05f9`에 가확정 기준선으로 고정
- [x] `T-001A DONE` 실사용 PASS/FAIL·증거·심각도·실패 처리 기준서 작성
- [x] `T-002 DONE` 신규 후보 1,500개에 안정 `GBF-*` ID를 부여한 불변 기계 판독 레지스트리 생성·재현성 검사
- [x] `T-003 DONE` `G1707`, 깨진 참조 8행과 복합 참조 8행, 제목/원자 수 불일치 75개를 append-only 보정·active 원장으로 정규화
- [ ] `T-004 PENDING` 기존 344개와 신규 1,500개의 중복·포함·split/merge lineage 대조
- [ ] `T-005 PENDING` 모든 UI·gateway·agent tool·Electron/배경 진입점 역대조 후 기능 분모 동결
- [ ] `T-006 PENDING` 모든 READY 기능에 정상·경계·오류·지속성·격리성·사용자 적합성 중 적용 축과 오라클 연결

### Phase 1 — 단일 앱 관찰 하네스

- [ ] `T-100 IN_PROGRESS` 실행 ID 디렉터리·메타데이터·append-only JSONL 생성 완료, 종료 시 SHA256 manifest 동결 남음
- [x] `T-101 DONE` 실제 `.cache/wsl-profile`의 단일 launcher/Electron/host, daemon, CDP renderer 일치 preflight 통과
- [x] `T-102 DONE` Linux `agent-browser` 바이너리가 기존 Electron CDP `9347`에 attach-only로 연결됨
- [ ] `T-103 IN_PROGRESS` process-health와 console/page-error 관찰은 수집 중; attach 이전 Electron/host stdout과 UJ-01 network trace는 없음
- [x] `T-104 DONE` 사용자의 `시작해` 승인 뒤 이미 실행 중인 실제 단일 프로필에 attach; 불필요한 재시작은 하지 않음
- [x] `T-105 DONE` `GB-CORE-001` read-only 경로 분리: 실제 프로필 `mcpBoxServers=[]`, Codex fast path의 native 도구 4개 한계, full host toolset 우회, Plugins Cursor-token 결함을 각각 확인; live routed-tool 총목록과 실행 PID 커밋은 미확인
- [x] `T-106 DONE` 독립 refute-by-default 검증 `PARTIAL`: 핵심 source trace 확인, account-backed MCP 0개 단정은 기각, runtime/current-HEAD 인과는 `PROVISIONAL` 유지

### Phase 2 — WSL 원본 기능 단일 모델 연속 실행

- [x] `T-200A DONE` active 1,500개를 runnable 1,292개와 실행 불가능·Codex N/A 208개로 재현 가능하게 분류
- [ ] `T-200B PROVISIONAL` 단일 모델 실행서·전달 프롬프트·terminal 판정 규칙과 명시적 다중분기 variant 84개 기능을 준비했다. 다만 active registry의 action·observableResult·entrypoint는 여전히 0/1,500이므로 queue는 탐색형 기능 목표 목록이며 완전한 클릭별 scripted case는 아니다.
- [ ] `T-200B1 PENDING` 필요 시 1,292개 전부의 feature별 precondition·entrypoint·userAction·effectCheck를 append-only 보정 원장으로 정규화
- [ ] `T-200C PENDING` 한 모델이 `runnableSequence` 순서로 1,292개 실제 UI 검증
- [ ] `T-200D PENDING` 미실행 0·구조 누락 0·수량·해시 대조 후 `STRUCTURE_COMPLETE_UNVERIFIED`로만 동결하고, 별도 검토자가 1,292개 각 결과의 원본 화면·효과·로그와 runtime lineage를 재검토해 `VERIFIED` 승격 여부 결정

### Phase 2B — POST_BASELINE_CUSTOMIZATION 핵심 사용자 여정

- [ ] `T-200 IN_PROGRESS` UJ-01 실동작 성공 관찰, 런타임 로드 코드 불명·network trace 누락으로 공식 판정은 `PROVISIONAL`
- [ ] `T-201 BLOCKED` UJ-02 실행 결과 저장소 도구 부재로 실패; 현재 HEAD의 Codex fast path도 full host repository toolset을 합성하지 않음 (`GB-CORE-001`)
- [ ] `T-202 BLOCKED` UJ-03은 `GB-CORE-001`이 동일하게 오염하므로 반복 실행 중단
- [ ] `T-203 BLOCKED` UJ-04는 정상 워커 시작 경로가 먼저 복구되어야 실패 처리 검증 가능
- [ ] `T-204 APPROVAL_REQUIRED` UJ-05 동일 프로필 재시작 중 지속성·격리성·복구

### Phase 3 — POST_BASELINE_CUSTOMIZATION 및 유예 기능 검증

- [ ] `T-300 PENDING` USER_REACHABLE P0/P1 후보 전수 실행
- [ ] `T-301 PENDING` AGENT_REACHABLE P0/P1 후보 전수 실행
- [ ] `T-302 PENDING` 나머지 USER_REACHABLE 전수 실행
- [ ] `T-303 PENDING` 나머지 AGENT_REACHABLE 전수 실행
- [ ] `T-304 PENDING` GATED의 게이트·실패 UX 검증, 외부 성공 경로는 승인별 분리
- [ ] `T-305 PENDING` INTERNAL_ONLY 통합·로그·복구 검증과 N/A 근거 확정

### Phase 4 — 결함과 종료 판정

- [ ] `T-400 IN_PROGRESS` `GB-CORE-001` P1, `GB-UI-001` P2, `GB-OBS-001` P2 후보를 기능 ID·증거와 연결
- [ ] `T-401 PENDING` 수정된 결함을 같은 case ID의 새 레코드로 재검증
- [ ] `T-402 PENDING` runnable 미실행 0, 근거 없는 terminal 판정 0, 현재 범위 P0/P1 0 확인
- [ ] `T-403 PENDING` 실행 증거 해시·최종 분모·판정 보고 동결
- [ ] `T-404 PENDING` 사용자의 최종 핵심 화면·흐름 확인

## 13. 현재 다음 행동

다음 행동은 다른 한 모델이 [단일 모델 실행서](grok-bot-wsl-single-model-test-runbook-2026-08-25.md)에 따라 새 `run-wsl-parity-single-model` 실행에서 정확히 한 실제 앱을 시작하고 `grok-wsl-test-runnable.jsonl` 1,292개를 `runnableSequence` 순서로 끝까지 실행하는 것이다. 사전 제외는 iOS/macOS, 비Docker, Codex Local에서 쓰지 않는 Cursor 계정·로그인·결제·사용량·접근권한, 비활성 앱 업데이트, 사용할 수 없는 마이크·인증 장치 성공 상태, 누락된 배경화면 helper, unpackaged 빌드의 단일 인스턴스 잠금, 지원되지 않는 host-only 재시작 연속성, 내부 전용, N/A, 단일 실제 프로필에서 불가능한 최초 온보딩 208개뿐이다.

기존 UJ-01·UJ-02 실행과 `GB-CORE-001` 원인 분석은 삭제하지 않는다. 다만 이는 `POST_BASELINE_CUSTOMIZATION` 증거이며 현재 원본 WSL parity의 차단 조건이 아니다. 앱 재시작·소스 수정은 여전히 별도 승인 경계다.
