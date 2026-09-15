# Belmont Memory 2.1 적용 — 테스트 보고 (2026-09-11, 근거 보완 v3)

상태: **PARTIAL_VALIDATION / FUNCTIONAL_VERDICT_PENDING**.

이 문서는 기존 테스트 실행 로그와 현재 소스를 대조한 보고서다. v3 보완 작업에서는 제품 코드·테스트 코드를 변경하거나 테스트·typecheck·build·benchmark·migration·Aside task를 실행하지 않았다. 이전 실행 결과와 이번 로그 검토를 구분한다.

## 1. 현재 결론과 증거 등급

- `direct_observation`: 보관된 root 테스트 로그는 **1081 tests / 1077 pass / 2 fail / 2 skipped / 0 cancelled / 0 todo**를 기록한다. 고유 실패는 2개이며 모두 소스를 정규식으로 검사하는 assertion에서 발생했다.
- `direct_observation`: 실패 입력과 현재 소스에는 기존 정규식이 허용하지 않는 공백·개행이 있다. 검사 대상 파일과 assertion 위치는 §3에 명시했다.
- `documented_prior_claim`: Reference prebuilt 157/157, frontend/source typecheck 통과, npm 종료 코드 1은 기존 작성자의 보고다. 이번에 확보한 root 테스트 로그에는 해당 별도 실행 결과나 npm 프로세스 종료 코드가 저장되어 있지 않다.
- `unverified`: 새 canonical 삭제·검색·학습·lifecycle·grounding·Aside 연결의 실제 동작과 기능 회귀 여부. 정규식 불일치 확인이나 reference 테스트 결과를 제품 통합 정상 판정으로 확대하지 않는다.

v1의 “실기능 회귀 아님 / 삭제 기능 정상” 결론은 철회 상태를 유지한다. v2의 집계 정정은 원본 로그에서 확인했으며, 남아 있던 검사 대상 파일·skip 설명·provenance 범위를 v3에서 보완했다.

## 2. 보존한 실행 근거와 재현 한계

임시 로그를 내용 변경 없이 다음 [근거 디렉터리](../data/artifacts/memory_2_1_report_review_20260911/README.md)에 복사했다.

| 근거 | 내용 / 범위 |
|---|---|
| [memtest-full.log](../data/artifacts/memory_2_1_report_review_20260911/raw/memtest-full.log) | 기존 ANSI 포함 원본. SHA-256 `23d79b99688891aa932e4f497b2cbaf2d832f2535c4772da21dba8a0ce6f6ea1` |
| [memtest-clean.log](../data/artifacts/memory_2_1_report_review_20260911/raw/memtest-clean.log) | 기존 ANSI 제거본. SHA-256 `b7e25c1b880e9cdeed01ab3c133df7b37dfc882e3675ae22ad9f4133d99e8979` |
| [log-observations.json](../data/artifacts/memory_2_1_report_review_20260911/log-observations.json) | 기존 로그의 footer·고유 실패 위치·skip 행 전사. 새 테스트 결과 아님 |
| [provenance.json](../data/artifacts/memory_2_1_report_review_20260911/provenance.json) | 원래 절대경로, 원본 mtime, 로그 해시, **검토 시점** source/config/test 파일 해시 |
| [report-before-v3.md](../data/artifacts/memory_2_1_report_review_20260911/report-before-v3.md) | 변경 전 v2 보존본 |

로그 2–3행은 npm script와 `node --test tests/*.test.mjs` 실행을 기록한다. 최종 집계는 clean 로그 1278–1285행, 고유 실패 상세는 1289행·1389행이다. 로그는 `✔/ℹ` 형식의 **Node 테스트 reporter 출력**이며 TAP이라고 표기하지 않는다.

검토 시점의 cwd는 `/home/hoon/_roots/labs/work/Belmont`, 브랜치는 `feat/skill-scope-fields`, HEAD는 `af95bcaecc2b964e91aa00f4bf69ab50aa617e61`이다. `git diff --no-ext-diff --binary`의 검토 시점 SHA-256은 다음과 같다.

```text
94d1c29dafc44ddb3ba2a9aea68f6b2c1f4981a98f2846ea29c680f3cb79a458
```

이는 v2에 적힌 prefix와 일치하지만 **검사 당시 worktree 전체를 고정한 증거는 아니다**. 일반 `git diff`는 untracked 파일의 내용을 포함하지 않는다. 이번 파일별 해시 역시 검토 시점의 관찰이며 검사 당시 상태로 소급하지 않는다. v2의 modified/untracked 개수·검사 당시 HEAD·종료 코드는 별도 run manifest가 확보될 때까지 이전 보고로 취급한다. 로그 mtime을 실제 시작/종료 시각으로 사용하지 않는다.

Node 버전은 clean 로그 **595행의 테스트 내부 진단**에 `"node":"v26.5.0"`으로 기록되어 있다(`direct_observation`). 이 진단이 npm 실행 파일 경로와 상위 프로세스의 Node 버전까지 고정하는 것은 아니다.

다음 실행 담당자는 명령별 cwd, 시작/종료 시각, Node 실행 경로·버전, 종료 코드, stdout/stderr, HEAD와 **untracked 구현을 포함한 입력 snapshot**을 함께 보존해야 한다. Runtime config는 secret 값을 제외한 feature/rollout stage를 기록한다. 이번 보고서 보완은 새로운 실행 증거를 만들지 않았다.

## 3. 실제 집계·고유 실패·skip

### 집계 — 기존 로그 관찰

```text
tests 1081
pass 1077
fail 2
cancelled 0
skipped 2
todo 0
```

1077 + 2 + 2 = 1081이다. 실행 목록과 마지막 실패 상세에 같은 테스트가 반복 출력되므로 중복을 추가 실패로 세지 않는다. npm 종료 코드 1은 v2의 보고를 유지하되, 이 로그에서 직접 관찰한 값으로 표시하지 않는다.

### 고유 실패 2건

| 테스트 선언 | 실제 실패 assertion / 검사 대상 | 로그와 소스에서 확인한 내용 |
|---|---|---|
| [host-wiring-parity.test.mjs:11](../tests/host-wiring-parity.test.mjs) — “system-prompt context receives the real memory stores and the shared roster providers” | 같은 파일 **25행**. 검사 대상은 **`source/host/extensions/memory/extension.ts`** | 공백 없는 `createUserMemory:(options:PromptUserMemoryOptions)=>createPromptUserMemory` 정규식과 현재 공백 포함 코드가 불일치. clean 로그 1291행/1376행 |
| [mobile-host-hooks.test.mjs:59](../tests/mobile-host-hooks.test.mjs) — “wiring: gateway methods, prompt section, request context, and memory add are connected” | 같은 파일 **73행**. 검사 대상은 **`source/host/extensions/memory/memory-service.ts`** | `remove(...): boolean { const key = id ?? memoryId;`의 한 줄 형태를 요구하지만 현재는 여는 중괄호 뒤 개행. clean 로그 1391행/1513행 |

첫 테스트는 host composition도 읽지만, 실제 실패한 assertion의 입력은 memory extension이다. v2의 `host-runner-composition.ts` 설명을 정정했다. 첫 테스트 26행의 project factory assertion은 25행에서 throw한 실행에서 도달하지 않는다. 두 번째 테스트 74행 이후 assertion도 이 실패 실행만으로 통과했다고 말하지 않는다.

### Skip 2건 — live fixture가 opt-in되지 않음

| 로그 행 / 테스트 | 소스의 skip 조건 |
|---|---|
| clean 219행: “live fixture rejects engine 907 against the installed 908 pair and unpinned reuse without stopping its owners” | [native-component-version 테스트](../tests/belmont-browse-native-component-version.test.mjs) 465–468행: `BELMONT_NATIVE_VERSION_LIVE !== "1"` |
| clean 220행: “live pinned fixture rejects reuse when the selected Aside account home is missing without stopping its owners” | 같은 파일 510–513행: `BELMONT_NATIVE_HOME_LIVE !== "1"` |

이 두 live fixture는 실행되지 않았다. 확인한 것은 로그의 skip 사유와 소스의 opt-in 조건이다. “Memory 2.1이 skip을 유발하지 않았다”는 변경 전체의 인과 판정이나, 이 로그에 없는 파일별 재실행 결과로 확대하지 않는다. 다음 검증에서도 skip을 없애기 위해 live flag를 무조건 켜지 말고 fixture/profile/PID의 소유권을 먼저 확인한다.

## 4. 소스 확인과 기능 검증의 경계

[transcript-manager.ts](../source/host/extensions/transcript/transcript-manager.ts) 395–398행은 `remove({ agentId, id: memoryId, memoryId })`를 호출하고, [memory-service.ts](../source/host/extensions/memory/memory-service.ts) 234–245행은 `id ?? memoryId`를 해석한다. **두 이름을 함께 처리하는 키 전달 형태는 현재 소스에 유지되어 있다.**

다만 새 canonical 분기는 `assertWritable()` → authenticated scope → canonical UUID 또는 legacy ID mapping → `session.forget()` → pending/context 변경 알림을 거친다. 삭제 직후 list/search/context, restart 이후 상태, tombstone/epoch, 다른 scope 보존까지 실행해야 삭제 기능을 판정할 수 있다. 이번에 확보한 실패 로그는 이를 검증하지 않는다.

| 실행 또는 보고 항목 | 이번에 확보한 근거 | 판정 범위 |
|---|---|---|
| Root `npm test` | 기존 원본 로그 확보 | 1077 pass / 2 fail / 2 skip 집계와 두 assertion 실패 위치 |
| Reference prebuilt 157/157 | v2의 실행 보고; 해당 실행 원본 미확보 | [reference tests](belmont-memory-2.1/belmont-memory-2.1/tests/learning.test.mjs)는 `../dist/index.js`를 import. 제품 adapter 실행 증거가 아님 |
| Source typecheck 통과 | v2의 실행 보고; 해당 실행 원본 미확보 | [source/tsconfig.json](../source/tsconfig.json)은 `**/*.ts` 범위. Aside `.mjs`와 Python daemon patch generator까지 포함하지 않음 |
| Frontend typecheck 통과 | v2의 실행 보고; 해당 실행 원본 미확보 | Frontend build·렌더링·제품 runtime 검증과 별개 |
| 별도 browser suite | 이번 root 명령에 미포함 | [package.json](../package.json)의 `test:browser`는 별도 명령. Root에 일부 browser 관련 테스트가 있는 것과 구분 |
| `mobile:check` | 이번 root 명령에 미포함 | `npm run check`에서는 `npm test` 뒤의 `&&` 단계. Root 실패 시 같은 호출에서 자동 진행하지 않음 |
| Canonical adapter 기능 / dense 실추론 / live host / migration / Aside E2E | v2에서 미실행으로 기록 | 통합 기능 회귀·성능·배포 준비 여부 미판정 |

Python 파일은 E5 generator가 아니라 `belmont-browse/tools/patch-daemon-canonical-memory.py`이며, 기존 daemon에 canonical memory 경계를 추가하는 소스 변환기다. 제품 구성 및 실제 미연결 항목은 [runtime handoff §6](memory-2.1-runtime-handoff.ko.md#6-유지--대체--아직-미연결)을 따른다. 자동 outcome grading/paired-trial producer, native Aside REPL 내부 인자 재작성, 내부 action별 Belmont 재검증 등의 미연결을 단순 “테스트 대기”로 바꾸지 않는다.

## 5. 개선 작업과 다음 검증의 완료 조건

이번에 반영한 개선은 **보고서와 근거 보존**이다. 아래 production/test 개선은 다음 담당자가 수행할 항목이며, 이 문서에서 완료로 처리하지 않는다.

| 우선순위 | 개선 / 검증 항목 | 남길 근거 또는 완료 조건 |
|---|---|---|
| 1 | 실패한 두 정적 검사 보완 | 공백 변화에는 견디되 factory 연결·`id/memoryId` 계약이 제거되면 실패하도록 검사한다. 단순 문자열 위치 변경만으로 canonical 정상 판정 금지 |
| 1 | 기존 삭제 회귀와 canonical 기능 검증 분리 | `id` 입력, `memoryId` 입력, canonical UUID, migrated legacy ID, unknown ID, wrong principal/scope, frozen/paused stage를 개별 fixture로 검증 |
| 1 | 삭제→재검색→restart 검증 | 대상 scope의 list/sparse/dense/context에서 삭제 반영, stale pending/outcome 재주입 제한, restart 후 tombstone 유지, 다른 scope 보존을 관찰 |
| 1 | User admission/lifecycle | UUID persistence, clear 후 ID 재사용, synthetic 제외, open/switch/retire/inactivity/shutdown/restart, checkpoint 앞뒤 crash와 알려진 admission gap |
| 1 | Migration fixture | freeze → inventory → **barriers** → import → **validation-ready** → shadow-read → cutover. Tombstone-only shard, marker provenance, scope 분리, stable mapping, source drift 및 crash/retry 포함 |
| 2 | Retrieval/grounding | Current args 우선, whitelist, snapshot/site/environment/version mismatch, failure condition, auth/membership 변경, packet budget 및 canonical revalidation |
| 2 | Aside source/experience | 별도 browser suite, generator/guarded loader, native memory 경계, same-run context, ungraded outcome, duplicate/late delivery, procedure acceptance/feedback |
| 2 | Dense 연결 | Endpoint 부재·timeout fallback, pinned identity, missing vector DB/rebuild/outbox ACK, pause/shutdown. Reference benchmark와 제품 adapter 경유 검증 분리 |
| 3 | 전체 검사·빌드·실제 runtime | 아래 명령의 개별 결과 및 source→build→process lineage. Live/E2E는 별도 운영 범위에서 수행 |

정적 배선 검사와 canonical 동작 fixture는 서로 대체하지 않는다. Skip이나 미연결 상태를 통과로 바꾸지 않고 각각 기록한다. 상세 시나리오는 [기존 handoff TODO](memory-2.1-runtime-handoff.ko.md#7-테스트-에이전트-todo--실행-결과-없음)와 [migration notes](memory-2.1-migration-notes.md)를 함께 사용한다.

## 6. 다음 담당자용 명령 — 이번 보완에서 실행하지 않음

제품 저장소 root에서 개별 결과를 수집한다.

```bash
cd /home/hoon/_roots/labs/work/Belmont
node --test tests/host-wiring-parity.test.mjs
node --test tests/mobile-host-hooks.test.mjs
npm run check
npm run frontend:build
npm run test:browser
```

`npm run check`는 frontend typecheck → source typecheck → root tests → `mobile:check` 순서다. 앞 단계 실패로 건너뛴 단계는 “미실행”으로 기록한다. 이를 분리 확인할 때만 `npm run mobile:check`를 별도로 실행한다. 기존 live service가 사용하는 build/profile을 덮어쓰지 않는 실행 경계를 먼저 정한다.

Reference dense benchmark는 **키트 디렉터리**에서 수행하며, 이미 준비된 승인된 E5 endpoint와 pinned identity가 필요하다.

```bash
cd /home/hoon/_roots/labs/work/Belmont/docs/belmont-memory-2.1/belmont-memory-2.1
BELMONT_REQUIRE_DENSE=1 node bench/ablation.mjs
```

이 명령 전에 `BELMONT_EMBED_URL`, `BELMONT_EMBED_MODEL`, `BELMONT_EMBED_REVISION`, `BELMONT_EMBED_DIM` 및 필요 시 `BELMONT_EMBED_TOKEN`을 설정해야 한다. `BELMONT_REQUIRE_DENSE=1`만으로 endpoint가 구성되지는 않는다. 키트의 `BELMONT_EMBED_*`와 제품의 `SAND_MEMORY_EMBEDDING_*`는 이름이 다르므로 [runtime 설정](memory-2.1-runtime-handoff.ko.md#4-configuration)에 맞춘 제품 경유 검증을 따로 한다. 이 문서 보완에서는 모델 다운로드나 서비스 실행을 하지 않았다.

## 7. 남은 판정

**기존 root 테스트 로그의 집계·실패 위치·skip 사유를 확인했다.** Typecheck/reference의 별도 원본 증거, 검사 당시 전체 입력 snapshot, 새 canonical 기능 검증은 아직 확보하지 않았다. 기존 로그 보존과 보고서 정정을 제품 기능 완료·배포 승인으로 사용하지 않는다.
