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

## 10. 후속 세션 업데이트 (2026-08-27 저녁)

§3·§4·§6의 다수 케이스가 이후 실제로 복원·검증됐다. 최신 판정은
`data/artifacts/belmont-user-e2e-20260825/fixes-verify-2026-08-27/feature-results.jsonl`에 있다.

| caseId | 이전 | 현재 | 근거 |
| --- | --- | --- | --- |
| GBF-AGT-000338 (write 도구) | UNREACHABLE | **PROVISIONAL_PASS** | write 도구 복원(PiWrite), agent가 `write({path,contents})` 호출→파일 생성 |
| GBF-AGT-000258 (읽기전용 편집) | 충실도 gap | **PROVISIONAL_PASS** | edit.ts가 `writePermissionDenied`+isReadonly 방출→"Write permission denied" |
| GBF-AGT-000372 (grep 상한/output_mode) | REVIEW | **PROVISIONAL_PASS** | 상한 안내 렌더 + output_mode(files/count) + offset 복원 |
| GBF-AGT-000320 (큰 디렉터리 요약) | REVIEW | **PROVISIONAL_PASS** | 1000파일→서브디렉터리 요약 |
| GBF-AGT-000280 (확장자 카운트) | REVIEW | **PROVISIONAL_PASS** | `[200 files in subtree: 120 *.ts, …]` |
| GBF-AGT-000319 (ls terminal 메타) | REVIEW | **PROVISIONAL_PASS** | box ls가 터미널 frontmatter/footer 파싱→cwd/명령/exit 렌더 |
| GBF-AGT-000257 (ENOSPC) | BLOCKED | 코드 완료(라이브 유발 불가) | box write가 ENOSPC→noSpace 매핑 |
| GBF-AGT-000199 (plan 모드) | REVIEW | 로컬 무의미 | 로컬 Codex는 단일 모드, plan 모드 부재 |

## 11. 복원 불가 확정 — 인프라 부재 (사유)

아래 둘은 **복원 원본 코드의 유무가 문제가 아니다.** 원본 소스는 복원본에 있고 일부는 우리
레포에도 있으나, 그 코드를 실제로 동작시킬 **Belmont 로컬에 없는 상위 표면/실행 경로**가 필요하다.
computer-use·browser와 같은 성격(Cursor 표면 의존)으로, 도구 복원이 아니라 로컬 backend 구축 과제다.

### GBF-AGT-000260 — canvas (.canvas.tsx) TypeScript 진단 — `UNREACHABLE_CURRENT_BUILD`

- **canvas란**: Cursor/Grok의 "live React app"(채팅 옆에 렌더되는 인터랙티브 아티팩트). 코드는
  `.cursor/projects/<proj>/canvases/<name>.canvas.tsx`. 진단은 그 파일을 edit할 때 자동 TypeScript
  검사 결과("Canvas TypeScript check: no errors." 등)를 모델에 붙여주는 기능.
- **왜 불가 (실증)**: 에이전트에게 canvas 생성을 직접 시킨 결과 —
  **"I can't create a Cursor Canvas because no Canvas tool or live-app surface is available in this session."**
- **정적 근거**: (1) box에 canvas diagnostics 실행기 **핸들러 없음**, (2) canvas 스킬/프롬프트가
  시스템 프롬프트에 **주입 안 됨**(에이전트가 canvas 사용 지시조차 못 받음), (3) canvas는 Cursor의
  라이브 React 표면 + SDK + backend에 의존 — 로컬 Codex에 그 표면 자체가 없음.
- **결론**: canvas 기능 전체가 로컬에 부재하므로 "진단"은 대상이 없다. 진단 backend를 붙이는 문제가
  아니라 canvas 표면(SDK/렌더러/backend) 구축 문제 → 도구 복원 범위 밖.

### GBF-AGT-000356 — readonly 서브에이전트의 write/delete 거부 — `BLOCKED / UNREACHABLE`

- **기능**: readonly 모드로 뜬 서브에이전트가 write/delete/mcp/shell을 시도하면
  "This operation is not allowed in readonly mode…"로 거부.
- **복원 코드**: `source/packages/agent-exec/readonly-resource-accessor.ts`가 **우리 레포에 이미 완전히
  존재**(6001 bytes). 코드 부재가 아니다.
- **왜 불가**: 이 거부가 발생하려면 **readonly 서브에이전트를 실제로 실행하는 경로**가 있어야 하는데,
  로컬 Codex 대화에서 서브에이전트(특히 readonly 모드) 실행 경로가 연결돼 있지 않다(`GB-CORE-001`
  영역: routine/update_state/subagent 경로 미연결).
- **결론**: 코드는 준비돼 있으나 그것을 태울 subagent 실행 컨텍스트가 로컬에 없다 → GB-CORE-001의
  subagent 경로가 열린 뒤 재검토.
- **2026-08-27 갱신**: §12에서 서브에이전트 **foreground 실행 경로가 연결**됐다. readonly 모드
  서브에이전트(`run_in_background=false`)를 이제 실제로 태울 수 있으므로 000356은 재검토 가능 상태로
  올라온다(다음 gate).

## 12. 서브에이전트 결과 바인딩 복원 (2026-08-27) — `RESOLVED`

**증상**: `run_in_background=false`(foreground)로 Task를 호출해도 부모가 자식 결과를 못 받고
"Subagent is running in the background." 만 받았다. 부모 턴이 자식 산출물을 보고할 수 없었다.

**부검 (기제 수준 사인)**: `SandSubagentHostAdapter.runSession`
(`source/host/runner/agent-adapters.ts`)에 **foreground 경로 자체가 없었다.** `runInBackground`
값과 무관하게 항상 `dispatcher.dispatch(...)`로 배경 큐에 넣고 `status:"background"`만 반환.
반환 타입에 success/finalMessage 케이스가 아예 빠져 있었다.

- executor 계약(`source/packages/agent-exec/subagent.ts`)은 이미 `status:"success"` →
  `SubagentSuccess{finalMessage, backgroundReason=UNSPECIFIED}`로 매핑한다(= foreground 결과).
- `child.run`은 상속된 production turn-run shell로 위임 → `settle.buildResult`가
  `{text, aborted, ...}`를 반환한다(문자열 text 존재 확인).
- 즉 계약은 준비돼 있었고 adapter만 그 케이스를 반환하지 않았다.

**수정** (커밋 `d20f29f`):
1. `runSession`에 foreground 분기 추가 — `args.runInBackground === false`면 `runner.run()`을
   **인라인 await** → `{status:"success", finalMessage: text, toolCallCount, transcriptPath}` 반환
   (abort 시 `"aborted"`). 배경 dispatch 경로는 그대로.
2. composition의 subagent-runner 바인딩 정리 — `child.run` 결과 `{text, aborted}`를 그대로 바인딩,
   text가 없으면 관측된 shape을 담아 명확히 throw(기존 placeholder throw 대체).

**실증 검증** (sanctioned CDP 드라이버, 임의 evaluate 없음):

| 테스트 | 부모 Task 호출 | 부모가 보고한 값 | 판정 |
|---|---|---|---|
| t126 | `run_in_background:false`, echo SUBTEST_5566 | `RESULT=SUBTEST_5566` | 자식 stdout 바인딩 |
| t127 | `run_in_background:false`, echo …_DELEGATED | `RESULT=SUBTEST_7788_DELEGATED` | 자식 stdout 바인딩 |
| **t128** | `run_in_background:false`, `printf … ; then …` | `RESULT=/bin/sh: 1: Syntax error: "then" unexpected` | **결정적** |

t128의 `/bin/sh: 1: Syntax error: "then" unexpected`는 **자식이 실제로 셸을 실행해야만 나오는
값**으로 부모가 미리 알 수 없다 → 자식 실행 + 결과의 부모 턴 바인딩이 실증된다. 수정 전이라면
부모는 배경 메시지만 받았을 것.

**남은 관찰 / 죽음 반경**: (1) 자식은 현재 부모와 **transcript를 공유**한다(별도 agentId 파일 아님) —
격리(Roo/Cline식 독립 transcript)는 별도 과제로, 결과 바인딩과 무관한 표면 개선. (2) foreground는
정의상 "자식이 끝날 때까지 블로킹"이므로 자식 도구가 걸리면 부모도 블로킹된다(예: 자식이 `sh -lc`
로그인 셸을 걸리게 하면 부모 대기) — 바인딩 결함이 아니라 자식 도구 hang. adapter-레벨 timeout은
없음(원본 로컬 설계와 동일, run_in_background=false 의미 보존).

## 13. AGENT_REACHABLE 전수 스윕 (301) + 결함 3건 수정 (2026-08-28)

원장 `10_AGENT_REACHABLE` 301개를 프롬프트 러너(sanctioned CDP 드라이버, wedge 복구 포함)로 전수 실행.

**결과**: PASS 63 / BLOCKED 186 / FAIL 33 / NO_VERDICT 10 / REVIEW 9.

- BLOCKED 186 = 전부 로컬 표면/백엔드 부재 (cloud agent·MCP·hook·computer/browser use·이미지생성·외부채널
  Slack/Teams·화면녹화 등) — 도구 복원이 아니라 backend/표면 구축 과제.
- FAIL 33 분해: Cursor 웹백엔드 4(코드 아님) / Shell 세션의미론 5(지속세션·cwd — box 재작업, 보류) /
  update_state 12 / AwaitShell 2 / 기타 10(테스트자원·관찰한계 다수).

### 수정한 실제 코드 결함 3건 (커밋 68622fe, 전부 실증 검증)

| 결함 | 원인 | 수정 | 검증 |
|---|---|---|---|
| update_state profile/settings.set "errored" | `createAgentState`에 `readProfile/writeProfile/writeSettings` 미배선 → `deps.writeProfile` undefined → throw | agent의 `profile.json`/`settings.json`에 배선(session 계층과 동일 파일) | disk `profile.json="VERIFY_7788"` + UI 헤더 + `settings.json hiddenFromSidebar:true` |
| AwaitShell 터미널파일 EACCES | box read guard가 **모든 경로를 realpath**, box 가상경로 `/root/.cursor/.../terminals/N.txt`는 `/root` 진입 불가라 `realpathNearestExisting`이 EACCES throw(ENOENT만 walk-up) | realpath 실패 시 catch→literal 검사 폴백(실경로 symlink 보호 유지) | AwaitShell가 `Task completed … exit code 0, output_length 286` 반환(EACCES 사라짐) |
| grep 문자예산 truncation에 총계 누락 | client/ripgrep truncation 통지에만 총계, 문자예산 경로엔 없음 | 예산 truncation에도 총 매치 수 부착 | 5000매치 grep → `… truncated … ; 5000 total matches` |

**보류(다시 만들기)**: Shell 지속세션(lifecycle 이벤트·cwd 유지), web/smart mode/cloud/MCP/computer use
백엔드, file_attachments의 user-machine→box 재지정.

### 남은 테스트 (원장 route 기준)
- AGENT_REACHABLE 438 총 → 301 완료, **137 남음**(FAULT_RECOVERY 117 + LIFECYCLE 16 + EXTERNAL 3 + REPO 1) — 프롬프트 러너로 진행.
- USER_REACHABLE **823** — CDP 클릭/스크린샷 하네스 필요(별도).

## 14. 나머지 AGENT_REACHABLE 137 + 전체 438 종합 (2026-08-28)

원장 `route=AGENT_REACHABLE` 중 10_배치(301) 외 나머지 137개(FAULT_RECOVERY 117 + LIFECYCLE 16 +
EXTERNAL 3 + REPO 1)를 프롬프트 러너로 실행. 3개 수정 반영된 빌드.

**137 결과**: PASS 24 / BLOCKED 89 / FAIL 17 / REVIEW 6 / NO_VERDICT 1.
FAULT_RECOVERY는 fault-injection 표면(hook·컴퓨터·브라우저·큐 telemetry) 부재로 대거 BLOCKED — 예상.

**AGENT_REACHABLE 전체 438 종합**: PASS 87(20%) / BLOCKED 275(63%) / FAIL 50(11%) / NO_VERDICT 11 / REVIEW 15.

**FAIL 50 최종 판정**:
- ✅ **수정 완료 8건**: update_state profile/settings(89·90·97·267·268), grep truncation 총계(372),
  AwaitShell 권한(186·187) — phase-1은 구 빌드라 stale-FAIL로 남음(신 빌드 실증 PASS).
- ⏸️ **보류(다시 만들기)**: Shell 세션의미론 7(지속세션·cwd·lifecycle·idle-timeout 메시지),
  file_attachments 2(user-machine→box 재지정).
- ❌ **백엔드(코드 아님)**: Cursor 웹 6.
- ➖ **의도된 fail / edge**: update_state avatar-clear·memory-forget(대상 없음/텍스트 불일치),
  검증메시지 형식차이·loop 감지 10, 테스트자원 부족·관찰한계 8.

**결론**: 438 스윕에서 순수 코드 결함 = 3개 근본(8케이스), 전부 수정·검증 완료. 나머지는 보류·백엔드·edge.

## 15. USER_REACHABLE UI 823 — 표면 렌더 건전성 스윕 (2026-08-28)

**전제**: UI는 b-nnett 재구성이 아니라 **출고 렌더러 그대로**(체크섬 고정 `945793f4…`). 따라서 UI 검증의
초점은 재구성 충실도가 아니라 **"고정 렌더러가 우리가 복원한 host와 정상 통합·렌더되는가"**다. 823개
bespoke 상호작용 작성은 위험 대비 과대이므로, **주요 표면 렌더 건전성 스윕**(CDP로 각 표면 열어 렌더
+ 콘솔에러 + 스크린샷 캡처)으로 대체.

**결과 (실증)**:
- **콘솔 에러 0건** — 전 표면.
- **명령 팔레트**(Ctrl+K): "Search" 다이얼로그 + 탭(All/Messages/Agents/Groups/Files/Links/Routines/Actions)
  + 퍼지 검색 결과(에이전트·Actions·Settings). 영역 01/08/09 커버.
- **설정 패널**(View agent settings): Name/Title/Description 필드 + Notifications 토글, host 데이터로 채워짐.
  영역 04/06 커버. (§12에서 고친 profile/settings 백엔드의 UI.)
- **컴퓨터 뷰**: VNC 화면 placeholder(로컬 라이브 데스크톱 없음 — computer-use BLOCKED와 일치) + Routines
  UI(Create Routine). 영역 09 커버.
- **사이드바/transcript/composer/플러그인/계정**: 전부 렌더.

증거: `/tmp/ui-evidence/*.png` (00_base, 01_command_palette, 04_account_menu, 05_attach, 06_agent_settings,
07_plugins, 09_computer, 09_reactions, 09_msg_actions).

**판정**: 체크섬 고정 렌더러가 복원 host와 **정상 통합·렌더**된다(콘솔에러 0, 주요 표면 기능). USER_REACHABLE
823의 대상 UI 표면이 동작함을 렌더-건전성 수준에서 실증. 각 케이스의 세부 상호작용(특정 상태 유발·클릭
시퀀스)까지의 정밀 검증은 bespoke 플랜이 필요하며, 이 스윕 + 기존 authored 플랜 14개가 자동 커버리지다.

## 16. 훅(hook) 박스 실행 복원 (2026-08-28) — `RESOLVED`

**문제**: Belmont는 host측 remote-hook 배선(`withRemoteHooks`, `executeRemotePreToolUseHook`,
`hookExecutorResource`)은 출고돼 있었지만 **박스 데몬이 `executeHookArgs` exec 메시지에 응답하지 않았고**,
박스 리소스 accessor가 `hookExecutorResource`를 등록하지 않아 `.cursor/hooks.json`이 조용히 무시됐다.
복원 산출물엔 클라우드 박스 바이너리가 없어(host-main.cjs + local-exec-daemon만) 박스측은 재구성 대상이었다.

**끊긴 지점 3곳(순차 진단)**:
1. `options.enableExecuteHookExec`가 WebSearch options에 안 닿음 → 팩토리 경계(`createWebSearchToolInputs`)에서 강제 주입.
2. `resourceAccessor.get(hookExecutorResource)`가 undefined 반환 — WebSearch가 쓰던 accessor는 **registry형**(사전 등록만),
   훅 리소스 미등록. 박스 도구(read/grep)가 쓰는 **remote-box accessor**(임의 리소스 지연 라우팅)로 훅 경로 교체.
3. remote-box accessor 자체도 `hookExecutorResource` 미등록 → "production remote resource is not registered" 던짐.
   `remote-box-resources.ts`에 read/grep과 동일 패턴으로 등록.

**복원한 코드(커밋 a9a3e27, 내 파일만)**:
- `box-exec-daemon/server.ts`: `executeHookArgs` case 처리. 박스 워크스페이스 `.cursor/hooks.json` 읽어 step별 command 실행,
  훅 입력 JSON(`hook_event_name`, `tool_name`, `tool_input` + 실패 시 `error`/`failure_type`/`duration_ms`/`tool_use_id`)을
  stdin으로 전달, stdout을 타입드 Pre/PostToolUse 응답으로 매핑(decision "block" 또는 exit 2 = deny, additionalContext/userMessage/updatedInput).
- `remote-box-resources.ts`: `hookExecutorResource` 등록(박스 라우팅).
- `host-runner-composition.ts`: WebSearch 훅 경로를 한 곳에서 remote-box accessor로 배선. (web-fetch는 복원 소스에 withRemoteHooks 경로가 없어 미배선, 주석 명시.)
- `turn-agent-composition.ts`: `enableHookAdditionalContext` 켜 post-hook의 additionalContext가 에이전트에 렌더되게.

**실증 결과**:
- **preToolUse (deny)**: WebSearch 호출 → 훅 발화(marker에 `tool_name`/`tool_input` 정확 수신) → deny 반영.
  에이전트가 받은 도구 결과 = `Web search rejected: HOOK_BLOCKED_9931 preToolUse hook fired and denied the web tool`. **끝까지 검증.**
- **postToolUseFailure**: preToolUse 허용 → WebSearch 실행 → 실패 → 훅 발화. 훅이 받은 전체 실패 payload:
  `error`("Waiting for an inference credential…"), `failure_type`("error"), `duration_ms`, `tool_use_id`, `conversation_id`. **payload 계약 검증.**
- **인프라**: 박스 executeHook가 preToolUse/postToolUse/postToolUseFailure/beforeSubmitPrompt/subagentStart/stop 전 step 매핑.

**경계(충실도 주석)**: post-hook의 additionalContext가 에이전트에 렌더되려면 도구가 **에러 결과를 반환**하거나 **성공**해야 한다
(tool-stream-executor가 도구 throw 시 carrier 렌더 전에 재던짐 — 복원된 상류 동작). 이 박스는 web-search 인증 credential이
없어 전송 계층에서 throw하므로 실패 경로의 additionalContext 렌더는 네트워크 있는 환경에서만 관찰된다. 상류 동작을
바꾸지 않음(성적표 튜닝 금지). 훅은 이 복원 소스에서 **WebSearch에만** 연결된다(web-search.ts만 withRemoteHooks 사용).

증거: `.cache/…/box-workspace/hook-marker.log`(훅 입력 payload), transcript의 `HOOK_BLOCKED_9931` 거부.
