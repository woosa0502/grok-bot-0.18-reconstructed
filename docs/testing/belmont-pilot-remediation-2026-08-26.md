# Belmont 단일 모델 pilot 필수조치 결과

- 상태: `PROVISIONAL / PILOT_REMEDIATED / INDEPENDENT_ACCEPTANCE_PENDING`
- 코드 기준: `f17b32445f247376b048a7bd9df6eed1d09e7739`
- 검증일: 2026-08-26 KST
- 저장소: `/home/hoon/_roots/labs/work/Belmont`
- 전체 1,292개 연속 실행: 아직 시작하지 않음

이 문서는 첫 10개 pilot 보고 뒤 발견된 하네스 결함, 런타임 계보 오류와 파일 첨부
결함을 수정하고 실사용 경로로 재검증한 결과다. 실행자가 작성한 결과이므로 독립 검토자가
증거를 다시 보기 전에는 최종 `VERIFIED` 또는 `PILOT_ACCEPTED`가 아니다.

## 1. 적용한 필수조치

### 1.1 단축키 하네스

- `Ctrl+[`, `Ctrl+]`, `Ctrl+=`, `Ctrl+-`를 포함한 punctuation key mapping을 추가했다.
- 첫 보고에서 `HARNESS_DEFECT`였던 000445, 000747, 000748은 실제 Electron target에
  키 이벤트가 도달했다.
- 000445는 두 에이전트 사이의 뒤로/앞으로 이동, 000747/000748은 확대/축소 화면을
  전후 증거로 다시 확인했다.

### 1.2 실행 바이너리와 소스 계보

- launcher가 `runtime-lineage.json`에 현재 Git HEAD만 적고 실제 바이너리가 어느
  소스에서 빌드됐는지는 확인하지 않던 false-green을 발견했다.
- `wsl:setup`은 HEAD, tracked diff, untracked content를 포함한 소스 지문을
  `dist/wsl-build-lineage.json`에 기록한다.
- `wsl:start`는 현재 소스 지문과 빌드 지문이 다르면 host/Electron을 띄우기 전에
  중단하고 `npm run wsl:setup`을 요구한다.
- CDP `run.json` schema 2는 runtime generation, source identity, 프로세스와 빌드
  해시를 함께 고정한다. 다른 generation은 같은 run 디렉터리에 섞지 않는다.

### 1.3 파일 선택과 첨부

- CDP plan에 절대경로의 일반 파일만 허용하는 `upload` action을 추가했다.
- 제품 첨부 실패의 실제 원인은 바이너리 전송이 아니라 Electron main의
  `crypto.randomUUID` 전역 의존이었다. WSL Electron main에서는 스테이징 파일명
  생성 시 이 참조가 실패했다.
- `node:crypto`의 `randomUUID`를 명시적으로 import했다. typed array IPC는 원래
  경로를 유지했다. 조사 중 넣었던 Base64 우회는 `f17b324`에서 제거했다.
- 다른 V8 context의 typed array와 ArrayBuffer view 정규화는 입력 경계 방어로 남겼다.

## 2. 직접 관찰 증거

### runtime

- HEAD: `f17b32445f247376b048a7bd9df6eed1d09e7739`
- runtime generation: `1e2a186d-ea75-4eb7-b84a-e9dd2236ed91`
- Electron target: `5679897513FC73FAFBAE2B9D814C0E82`
- profile: `.cache/belmont-wsl-profile`
- build source identity와 runtime Git identity가 일치했다.

### 첫 10개 영향 case

- 직접 재관찰: 000209, 000211, 000444, 000445, 000747, 000748
- 기존 pilot 증거만 재사용: 000009, 000210, 000604
- 현재 분류: `PROVISIONAL_PASS 8 / REVIEW_REQUIRED 1 / UNREACHABLE_CURRENT_BUILD 1`
  - `REVIEW_REQUIRED`: 000211의 "검색 비활성일 때 탭 숨김" 반대 조건
  - `UNREACHABLE_CURRENT_BUILD`: 000213. 등록 routine이 없고 Belmont 대화가
    routine 생성 도구에 도달하지 못한다.
- 이전 `HARNESS_DEFECT` 3건은 첫 10개 범위에서 해소됐다.

### 파일 첨부

- run: `data/artifacts/belmont-user-e2e-20260825/f17b324-pilot-remediation`
- 성공 observation: `OBS-20260825154754038-700311fb`
- UI에서 `belmont-e2e-fixture-2.txt`, 26 B 첨부 카드가 표시되고
  `Couldn't attach` 문구가 없음을 assertion과 PNG로 확인했다.
- 스크린샷:
  `evidence/BELMONT-FIXTURE-UPLOAD-FILE-2/OBS-20260825154754038-700311fb/file-staged.png`
- cleanup observation: `OBS-20260825154836435-00029794`
- 두 UI fixture와 direct bridge 진단 파일 4개를 모두 제품의 discard 경로로 제거했다.
  메시지는 보내지 않았다.

### false-green/false-fail 교훈

- `OBS-20260825151916632-124dd319`은 실패 안내에도 파일명이 포함되어 단순
  `text contains filename` assertion이 통과한 false-green이다.
- 첫 수정 뒤 `OBS-20260825154434536-0b417a11`은 실제 첨부 카드가 있었지만 shipped
  renderer가 이름과 `.txt`를 분리 렌더링해 단순 텍스트 locator가 실패한 false-fail이다.
- 최종 plan은 `role=list`, 접근성 이름과 오류 부재를 함께 확인했다. assertion 하나만
  제품 판정으로 승격하지 않는다.

## 3. 테스트

- 실제 저장소 `f17b324`에서 `npm run check`: 45 tests, 45 pass, 0 fail
- 파일 첨부는 unit test만이 아니라 실제 renderer → preload → main → staging → UI card
  경로와 cleanup까지 관찰했다.

## 4. 아직 남은 제품 P1

`GB-CORE-001`은 이번 조치로 해결되지 않았다.

- 로컬 Codex 대화 경로는 routed MCP 도구만 열거·실행한다.
- full host toolset의 `update_state`/routine, shell, state, subagent 경로가 Belmont 대화에
  연결되지 않아 routine fixture 생성 요청이 "도구가 제공되지 않는다"로 끝났다.
- 이는 테스트 fixture 부족이 아니라 제품 실행 경로 결함이다. 내부 DB/API로 routine을
  주입해 통과로 만들지 않는다.
- UI-only case는 계속 실행할 수 있지만 full-tool-dependent case를 대량 실행하면 같은
  blocker가 반복된다. 이 P1의 별도 설계·수정·live parity 뒤 해당 묶음을 재개한다.

## 5. 다음 gate

독립 검토자는 다음을 확인한 뒤 `PILOT_ACCEPTED` 여부를 결정한다.

1. `f17b324` 이후 최종 문서 커밋의 `npm run check` 결과
2. `run.json`의 build source identity와 runtime identity 일치
3. 성공·cleanup PNG와 JSON을 직접 열어 첨부/정리 상태 확인
4. 첫 10개 분류에서 documented prior claim과 이번 direct observation 분리
5. `GB-CORE-001`을 해결하지 않은 채 1,292개 전체가 완료됐다고 쓰지 않았는지 확인
