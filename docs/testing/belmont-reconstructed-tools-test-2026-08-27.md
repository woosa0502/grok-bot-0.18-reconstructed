# Belmont 복원 도구 실사용 검증 — 2026-08-27

- 상태: `EXECUTOR_PROVISIONAL / INDEPENDENT_ACCEPTANCE_PENDING`
- 코드 기준 HEAD: `fbe3750` (+ 워킹트리 미커밋 수정 `source/packages/agent/tools/core/edit/edit.ts` — 아래 §5)
- 검증일: 2026-08-27 KST
- 저장소: `/home/hoon/_roots/labs/work/Belmont`
- 방법 정본: [belmont-user-test-method-2026-08-25.md](../belmont-user-test-method-2026-08-25.md)
- 증거 run: `data/artifacts/belmont-user-e2e-20260825/fbe3750-reconstructed-tools/`

이 문서는 이 저장소에서 복원한 에이전트 box 도구(edit_file / list_dir / grep / read / delete_file / glob_file_search)와
그에 영향받는 원장 케이스를, **정본 방법의 인가된 하네스**(`npm run wsl:cdp -- run --plan`)로 실사용 경로에서 판정한 결과다.
임의 `evaluate` 우회는 쓰지 않았고, 각 케이스는 화면 결과(assertion·스크린샷)와 **실제 효과**(디스크 재열기 / transcript 도구호출)를 분리해 교차검증했다.
실행기 결과이므로 독립 검토 전에는 최종 `PASS`가 아니다.

## 1. 요약

| 판정 | 개수 |
| --- | --- |
| `PROVISIONAL_PASS` | 10 |
| `UNREACHABLE_CURRENT_BUILD` | 2 |
| `REVIEW_REQUIRED` | 5 |
| `BLOCKED_EXTERNAL` | 2 |
| 합계 | 19 |

핵심 한 줄: **복원한 6개 도구의 정상경로·주요 오류경로는 실사용에서 모두 실제 동작**하며, 유일한 기능 공백은 **독립 write 도구 미복원(000338)**이다.

## 2. PROVISIONAL_PASS (10)

실사용 경로: composer에 실제 키 입력 → 실제 Send 클릭 → agent가 box 도구 호출 → 화면 결과. 각 행은 디스크 효과 또는 픽스처 고유 토큰(도구를 실제로 쓰지 않으면 화면에 나올 수 없는 값)으로 교차검증.

| caseId | 도구 | 관측된 결과 | 교차검증(실제 효과) |
| --- | --- | --- | --- |
| GBF-AGT-000339-N01 | edit_file | "Replaced 1 occurrence …std_editme.txt" | 디스크: STDCASE_ALPHA→STDCASE_BRAVO |
| GBF-AGT-000437-N01 | list_dir | aaa437.txt / bbb437.txt | 디렉터리 고유 파일명이 응답에 존재 |
| GBF-AGT-000334-N01 | list_dir | only334.txt | 디렉터리 고유 파일명 |
| GBF-AGT-000396-N01 | grep | GREPTOKEN396 file:line 일치 | 고유 토큰은 grep 없이 알 수 없음 |
| GBF-AGT-000403-N01 | read | "READTOKEN403UNIQUE …" | 파일 내용 정확 반환 |
| GBF-AGT-000402-N01 | delete_file | "Deleted …del_402.txt" | 디스크: 파일 제거됨(재열기: 없음) |
| BELMONT-GLOB-SMOKE-N01 | glob_file_search | gamma_glob987.ts | glob로만 얻는 고유 파일명 |
| GBF-AGT-000259-N01 | edit_file | "Error: Path escapes configured workspace root: /etc/os-release" | worktree 경계 강제, 외부 파일 불변 |
| GBF-AGT-000258-N01 | edit_file | "Error: Could not write edited file (permissionDenied)" | 0444 파일 불변 (§4 충실도 주석) |
| GBF-AGT-000161-N01 | read | "File content (120000 characters) exceeds maximum allowed characters (100000 …)" | 내용 대신 한도 안내 반환 |

## 3. UNREACHABLE_CURRENT_BUILD (2)

- **GBF-AGT-000338-N01 (write 도구)** — 실사용에서 agent가 **"MISSING TOOL: write"**로 응답, 파일 미생성.
  배선된 box 도구는 shell/read/ls/delete/grep/edit/glob/await뿐이고 **독립 write/create-file 도구가 복원 안 됨**.
  원본: `source/packages/agent-exec/write.ts`. 현재 파일 생성은 boxShell로만 가능.
  → **가장 유의미한 공백. edit_file의 write 경로를 그대로 재사용하면 쉽게 복원 가능.**
- **GBF-AGT-000260-N01 (canvas .canvas.tsx + TS 진단)** — 복원 edit은 결정적 search/replace라 Cursor fast-apply·canvas 진단 데코레이션이 없음.

## 4. REVIEW_REQUIRED (5) — 코드 경로는 존재하나 user-CDP로 깨끗한 기계 assertion 불가 / 이번에 미수행

| caseId | 사유 |
| --- | --- |
| GBF-AGT-000320-N01 | 큰 디렉터리 요약: box handler `budget=2000` + `renderDirectoryTreeWithinBudget`. 잘림은 proto/렌더 세부 → proto/unit 검증 필요 |
| GBF-AGT-000372-N01 | grep 상한: `headLimit=200`, `clientTruncated`. 플래그가 proto에만 있고 agent 화면 텍스트로 안 나옴 → proto/unit 검증 |
| GBF-AGT-000319-N01 | ls terminal-file 메타데이터: box terminal 파일 필요, 이번 미구성 |
| GBF-AGT-000280-N01 | 확장자별 카운트: box ls가 `fullSubtreeExtensionCounts` 반환(구현됨). 카운트 렌더 assertion 모호 |
| GBF-AGT-000199-N01 | Plan 모드에서 비-md 편집 거부: 모드 의존, 이번 Plan 모드 미전환 |

### 4-1. 충실도 주석 (000258)
읽기전용 편집은 **동작상 정상**(권한거부 + 파일 불변)이지만, 원본은 `EditWritePermissionDenied`("Write permission denied: <path>")를 내는 반면
복원 edit_file은 writeExecutor의 permissionDenied를 일반 `EditError` 문구("Could not write edited file (permissionDenied)")로 뭉갠다.
이는 `isReadonly` 필드를 담는 `EditWritePermissionDenied` case를 edit.ts가 방출하지 않기 때문 — 경미한 표면 차이(기능 결함 아님).

## 5. edit.ts 타입 회귀 수정 (이번 세션)

- 증상: `source:typecheck` 6건 실패 — `isReadonly`를 `EditError`(해당 필드 없음)에 잘못 지정. 실제 소속은 `EditWritePermissionDenied`.
- 조치: edit.ts의 6곳에서 잘못된 `isReadonly: false` 제거. `tsc --project source/tsconfig.json` → **0 에러**.
- 이 수정은 타입 전용(런타임 무변): 위 GBF-AGT-000339/259/258 실사용 결과가 런타임 무해함을 확인.
- 상태: **워킹트리 미커밋** (다른 세션의 미추적 파일과 분리해 edit.ts만 커밋 예정).

## 6. BLOCKED_EXTERNAL (2)

- **GBF-AGT-000257-N01** — 'No space left on device': 공유 WSL 파일시스템에서 ENOSPC를 안전하게 유도 불가.
- **GBF-AGT-000356-N01** — readonly 서브에이전트의 write/delete 거부: 로컬 Codex 대화에서 readonly 서브에이전트 경로 도달 불가(`GB-CORE-001` 영역).

## 7. GB-CORE-001과의 관계

[pilot remediation](belmont-pilot-remediation-2026-08-26.md)의 `GB-CORE-001`은 "full host toolset이 Belmont 대화에 연결 안 됨"을 지적했다(f17b324 시점).
이번 결과는 **box 파일 도구(edit/ls/grep/read/delete/glob)가 대화에서 실제로 열거·호출·실행됨**을 라이브로 입증한다 — 도구 복원+배선의 효과.
단 `GB-CORE-001`이 지목한 `routine/update_state/subagent/readonly-subagent` 경로는 이번에 검증하지 않았으므로 **"GB-CORE-001 해결"로 단정하지 않는다.** 파일 도구 하위집합만 입증.

## 8. 증거와 재현

- run 디렉터리: `data/artifacts/belmont-user-e2e-20260825/fbe3750-reconstructed-tools/`
  - `feature-results.jsonl` — 19행 실행기 판정
  - `evidence/<case>/…/before.png,after.png,after.json` — 케이스별 전후 스크린샷·snapshot
  - `lineage.json` — runtime/build 지문(HEAD fbe3750, build↔runtime identity 일치)
  - `raw-camp-results.jsonl` — 러너 원시 출력
- console/page error: 전 케이스 `[]`
- 하네스: `npm run wsl:cdp -- run --plan <plan> --run-dir <dir>` (인가된 관찰기, 임의 evaluate 없음)

## 9. 다음 gate

1. edit.ts 수정 커밋(단일 파일) 후 `npm run check`
2. write 도구 복원 여부 결정(000338 공백) — 결정 시 edit_file write 경로 재사용
3. REVIEW_REQUIRED 5건: proto/unit 수준 검증 또는 전용 plan(Plan 모드 000199)
4. 독립 검토자가 `feature-results.jsonl`과 PNG를 대조해 최종 `PASS` 승격 여부 결정
5. 문서 커밋으로 트리가 바뀌었으므로, 추가 라이브 run 전 `npm run wsl:setup` 재빌드 필요
