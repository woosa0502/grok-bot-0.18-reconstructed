# Belmont Memory 2.1 runtime 적용 handoff

작성일: 2026-09-11. 상태: **CODE_APPLIED / EXECUTION_UNVERIFIED**.

이 문서는 작성한 코드와 설계 경계를 기록한다. 테스트·typecheck·build·benchmark·retrieval 측정·browser E2E·실제 Aside task·production migration을 실행하지 않았다. 컴파일, 실행 결과, 품질 또는 production readiness 판정은 포함하지 않는다. 아래 명령은 다음 담당자가 별도로 실행할 항목이다.

기준은 `docs/belmont-memory-2.1/Belmont_Memory_2_1_Implementation.ko.md`, `Belmont_Memory_2_1_Validation.ko.md`, `belmont-memory-2.1/src/` 및 그 `integration/`이다. Reference `src/`의 모듈을 제품의 `source/host/extensions/memory/kernel/`로 옮겨 사용하고, Belmont 전용 처리는 바깥 adapter에 작성했다. Reference 문서의 기존 검증 주장을 이번 적용 결과로 인용하지 않는다.

## 1. 소스에서 구성한 ownership

```text
MemoryService (기존 UI/caller façade)
  └─ routeMemoryStore (persisted rollout 상태에 따라 writer 선택)
       ├─ legacy: FileMemoryStore / 기존 Markdown synthesis
       ├─ frozen..shadow-read: legacy read, Markdown write 차단
       │    └─ shadow-read: canonical 검색을 호출하되 prompt에는 주입하지 않음
       └─ canonical: BelmontMemoryLearningRuntime → MemoryKernel → canonical.sqlite
            ├─ authenticated user → evidence → episode → DreamingEngine
            ├─ UI 명시적 입력 → user principal → kernel proposal
            ├─ agent update_state → agent principal → kernel policy
            ├─ query → scope/type/time planning → sparse + optional dense → packet
            ├─ tool dispatch → field adapter → groundAction → 기존 schema/approval
            └─ Aside observation / graded outcome → ExperienceLoop
```

`rollout.json`이 없으면 기존 `legacy` 동작이 기본이다. 소스 변경 자체가 cutover나 데이터 migration을 수행하지 않는다. Canonical 모드의 Markdown은 더 이상 façade writer가 아니며, 이전 파일은 migration 원본으로 남는다. Markdown export generator는 추가하지 않았다.

Canonical authority는 `<sandRoot>/memory-2.1/canonical.sqlite`와 같은 위치의 `tombstone.key`이다. Vector SQLite와 readiness JSON은 재구성 가능한 파생 자료이고, checkpoint는 transcript 참조와 owner/epoch admission 정보이다. 별도의 대화 본문 DB를 만들지 않는다.

Principal은 Auth extension의 인증 subject에서 가져온다. Local Codex 모드는 기존 gateway authentication 경계와 현재 Belmont Pi OAuth 파일의 subject를 사용한다. subject가 없는 명시적 local 설정은 `SAND_MEMORY_LOCAL_PRINCIPAL_ID`가 필요하다. 기계명·고정 `local-codex`·Aside account ID를 사용자 identity로 추정하지 않는다.

Scope는 authenticated principal namespace와 실제 shard 상대경로를 각각 hash하여 만든다. Agent, user-author, project-author, legacy direct-root 및 `.shards`는 합치지 않는다. Project 공유 read는 현재 `AgentProjectMembership`을 읽는다. Subagent/automation read는 parent agent의 허용 scope를 사용하고, raw user admission 경로와 구분한다.

## 2. 실제 integration map

### User turn → learning

`transcript/send-message-shaping.ts:createUserMessage()`가 내부 UUID `memoryTurnId`를 실제 transcript entry에 넣는다. RPC/model 입력으로 UUID를 받지 않는다.

`transcript/send-pipeline.ts:SendPipeline`은 local human echo가 durable로 수락된 뒤, workflow/group 확장 전의 본문과 agent/conversation, UUID, entry ID, timestamp를 `MemoryService.onAuthenticatedUserTurn()`에 전달한다. Group/remote room 및 `memoryLearningSource: system`은 admission에서 제외한다.

`memory-learning-runtime.ts:onAuthenticatedUserTurn()`은 owner/scope/epoch와 transcript 참조, 본문 digest를 `learning-checkpoint.json`에 기록한다. 여기서 매 turn을 long-term memory로 승격하지 않는다. Episode close에서 실제 transcript를 다시 읽고 UUID·본문 digest·role·source·owner·epoch를 비교한 뒤 `MemoryLearningHostHooks.onAuthenticatedUserTurn()` → `onEpisodeClosed()` → `DreamingEngine.learn()` → canonical transaction을 호출한다. Reference의 bounded extractor/explicit-vs-inferred 정책을 사용한다.

### Session lifecycle → dreaming

- Open: session-runtime 및 agent create/clone/import에서 lifecycle open; canonical restart checkpoint 복구.
- Continuation: 동일 conversation의 참조를 유지하고 inactivity timer 갱신. 최대 128-turn admission 경계에 도달하면 앞 episode를 닫는다.
- Switch: 이전 session의 episode close.
- Close/retire: run-lifecycle의 session retirement에서 close.
- Inactivity: 기본 30분에서 episode close.
- Shutdown: TranscriptManager가 DB를 닫기 전에 shutdown hook; Memory runtime dispose에서 남은 참조 flush와 index queue 정리.
- Restart: 기존 transcript reader로 checkpoint가 가리키는 turn만 복원하여 episode close. 전체 과거 transcript를 새 사용자 동의로 재해석하지 않는다.
- Clear/delete: 실제 `conversation-cleared`/`agent-removed` mutation에서 pending 참조와 transient context를 버린다. 대화 clear 자체를 long-term memory clear로 바꾸지 않는다. Memory UI forget/clear는 kernel tombstone/epoch 경로를 별도로 사용한다.

Checkpoint는 atomic rename 전에 파일 fsync를 호출한다. Transcript append와 checkpoint는 하나의 cross-store transaction이 아니다. **Transcript append 직후, checkpoint 기록 전에 host가 종료되면 해당 turn admission은 복구되지 않는다.** UUID/source marker는 transcript에 있지만 principal/epoch admission은 checkpoint에만 있다. 이 구간을 추정으로 보충하는 history sweep은 작성하지 않았다.

### Query → retrieval → context

`runner/turn-run-shell.ts`의 `prepareMemoryTurn()` → façade의 `BelmontMemoryLearningRuntime.prepareMemoryTurn()` → 각 허용 scope의 `MemoryRetriever.retrieve()`.

Reference planner → FTS5/CJK sparse → optional E5/vector → RRF/rerank → current canonical item/version/time 재조회 → evidence/span packet을 사용한다. Host는 request/conversation/owner 및 scope snapshot key를 묶고 stale packet을 주입하지 않도록 작성했다.

`runner/system-prompt-assembly.ts`는 canonical일 때 agent/user/project의 raw recall 및 persisted Markdown prompt snapshot을 사용하지 않고, 현재 요청의 `getMemoryContext()` packet과 canonical knowledge 안내를 넣는다. Legacy/shadow-read의 기존 recall/prompt freeze 경로는 유지한다. UI list/count/recall 호환 API는 canonical record를 기존 `MemoryRecord` 형태로 보여 준다.

`knowledge_search`는 `MemoryService.queryKnowledge()`로 knowledge/procedural canonical packet과 `memory://<uuid>` read를 제공한다. Canonical query가 명시적으로 `null`을 반환하는 legacy 단계에서만 기존 Markdown reader가 fallback이다. Canonical 오류는 legacy fallback으로 바꾸지 않는다.

### Tool call → grounding → execution evidence

`host-runner-composition.ts`에서 실제 parent agent/conversation/request를 tool hook에 결합한다. `turn-toolset.ts` → `withMemoryToolAction()`은 streamed JSON argument를 읽고 `beforeToolAction()` 결과를 기존 concrete tool의 parser/approval 앞에 전달한다. Custom/opaque argument format은 기존 경로로 남긴다. 일반 tool 실행/승인 의미는 기존 tool이 담당한다.

`memory-tool-grounding.ts`는 실제 `sand-browser-turn-tools.ts` schema에 다음 매핑을 둔다.

- Accepted `fill` step + 같은 `ref` → 누락된 `browser_fill.value`.
- Accepted `fill` step + 같은 `ref` → 누락된 `browser_type.text`.
- `browser_navigate`/`browser_click`은 target 대응만 있으며 새 URL/ref를 채우지 않는다.
- 이미 존재하는 field는 빈 문자열이나 null이어도 덮어쓰지 않는다. `confirmed`, approval, account, recipient 등은 whitelist에 없다.

일반 browser 경로는 실제 `browser_snapshot` 결과의 driver header/domain/environment와 snapshot digest, operator site revision을 사용한다. Accepted procedure의 정확한 task/domain/environment/precondition 및 같은 snapshot digest가 있어야 fill 값 보완 대상으로 삼는다. Reused element ref를 과거 페이지와 동일한 것으로 추정하지 않는다. Browser 결과에서 관련 snapshot을 얻지 못하거나 error이면 transient browser state를 비운다.

현재 일반 browser observation은 임의의 자연어 failure condition을 분류하지 않는다. 따라서 이 경로에서는 `failureConditions`가 비어 있는 accepted procedure만 자동 적용 대상으로 삼는다. Aside prepare도 nonempty failure conditions는 trusted context가 `conditionsObserved: "true"`를 제공할 때만 선택 대상으로 삼는다. 현재 built-in metadata producer는 이 값을 생성하지 않는다.

`afterToolAction()`은 실제 browser tool args/result/error를 `tool-outcome` evidence로 기록한다. 이 결과를 user-message로 취급하지 않는다. Reference 64k evidence 제한을 넘는 tool payload는 경고하고 생략한다. 일반 browser tool 한 호출을 전체 task 성공으로 자동 평가하지 않는다.

### Aside outcome → experience → procedure feedback

`browse-runtime/extension.ts`가 scoped `BrowseClient`에 `createBrowseMemoryHooks()`를 주입한다. Parent에서 Aside subagent를 만들 때 memory owner agent와 실제 child conversation을 별도로 전달한다.

`BrowseClient`는 `/health`의 `memoryAuthority=belmont`, protocol 1을 확인하고 `/memory/context`에서 execution metadata를 받는다. `MemoryService.prepareAsideTask()`가 canonical evidence와 accepted procedure를 선택하고, current owner/epoch/context snapshot/procedure version을 확인한다. 원래 task 문자열과 memory context는 별도 필드로 전달한다.

`belmont-browse/src/core.mjs`는 기존 `AgentSessionServer`의 동일 실행 owner에 `[memory system-message, user-message]`를 넣는다. Existing SessionStore runtimeConfig에 binding과 마지막 observation을 기록한다. Run event의 trajectory·usage delta·elapsed time·terminal status를 수집한다.

`done`은 성공 grade가 아니다. Terminal observation은 host가 canonical browser evidence로 수집한다. 명시적 outcome producer의 `BrowseClient.reportOutcome()` / `POST /sessions/:id/outcome` 또는 실제 execution error와 reference에 필요한 양의 usage/timing이 있을 때만 `ExperienceEnvelope`를 구성한다. Task/domain/environment, bounded candidate/schema, immutable grade 등을 transport에서 제한한다.

`createBrowseMemoryHooks.observe()` → `captureAsideObservation()` / `ingestAsideOutcome()` → `ExperienceLoop.ingest()` → episode/site knowledge/candidate evidence. Selected procedure ID가 있으면 `ExperienceLoop.feedback()`도 호출한다. Delivery cache 밖의 재전송은 kernel idempotency에 맡긴다. HTTP 직접 outcome 제출 후 host가 읽지 않은 경우에는 다음 host session read가 delivery 지점이다.

Acceptance는 host-only `MemoryService.evaluateProcedureCandidate()` → `ExperienceLoop.promote()` → reference evaluator이다. Supplied trial array를 agent/renderer/Aside RPC로 노출하지 않았다. 이번 작업은 evaluator 호출면을 제공하며 control/candidate 실행을 자동 시작하는 scheduler나 새로운 agent를 추가하지 않는다.

### Dense index lifecycle

`readMemoryRuntimeConfig()` → `HttpEmbeddingAdapter` / reference `VectorIndex`. Endpoint 부재 또는 dense disabled에서는 embedding 실행 경로를 만들지 않는다. Query timeout/error는 reference retriever의 sparse fallback으로 연결된다.

Canonical read/write 이후 `queueIndex()`가 단일 consumer chain으로 transactional outbox를 drain하도록 작성했다. Model identity 변경, missing index, readiness marker 부재 시 canonical ledger로 `VectorIndex.rebuild()` 후 synchronize한다. 파생 readiness marker는 index identity를 기록하고 canonical data를 담지 않는다. Embedding 오류는 pending job을 다음 요청에서 재시도할 대상으로 남긴다. 실제 다운로드/embedding/model 실행은 하지 않았다.

## 3. 변경 파일별 역할과 entrypoint

아래 목록은 이번 작업의 파일이다. 작업 전부터 있던 shopping 문서 변경, 다른 untracked 보고서, 제공된 reference 디렉터리 전체를 이번 변경으로 귀속하지 않는다.

### Belmont adapters / façade

- `source/host/extensions/memory/memory-learning-runtime.ts` — 신규. Host 학습/검색/행동/lifecycle composition을 두기 위해 작성. `BelmontMemoryLearningRuntime`, `onAuthenticatedUserTurn`, `prepareMemoryTurn`, `beforeToolAction`, `prepareAsideTask`, `ingestAsideOutcome`, `evaluateProcedureCandidate`.
- `source/host/extensions/memory/memory-runtime-config.ts` — 신규. Runtime env/identity 및 실제 shard scope 해석. `readMemoryRuntimeConfig`, `memoryOwnerNamespace`, `memoryScopeForDirectory`.
- `source/host/extensions/memory/memory-store-adapter.ts` — 신규. 기존 caller 호환과 writer 전환. `routeMemoryStore`, `writeCanonicalMemory`, `legacyMemoryView`.
- `source/host/extensions/memory/memory-tool-grounding.ts` — 신규. Reference action schema와 실제 browser schema 차이를 연결. `observeBrowserResult`, `groundBrowserTool`.
- `source/host/extensions/memory/memory-migration.ts` — 신규. Legacy 원본/marker/ID를 단계별 kernel import로 연결. `MemoryMigration`, `assertLegacyMemoryWritable`, `discoverMemoryMigrationShards`.
- `source/host/extensions/memory/memory-service.ts` — 기존 Markdown/UI owner → rollout에 따라 canonical adapter를 제공하는 façade. 기존 `list/add/remove/clear/createAgentStore` 유지; learning/migration/procedure host entrypoint 추가; legacy mutator guard.
- `source/host/extensions/memory/extension.ts` — 기존 synthesis/prompt factory → auth principal 주입과 canonical shard factory composition. `memoryExtension.start`, `createPromptUserMemory`, `createPromptProjectMemory`.
- `source/host/extensions/memory/agent-state.ts` — 기존 update_state의 독립 FileMemoryStore 생성 → 주입된 `createMemoryShard` 사용. `createSandAgentState`.
- `source/host/extensions/auth/extension.ts` — 기존 auth API에 host memory principal 조회 추가. `getAuthenticatedPrincipalId`.
- `source/host/extensions/auth/local-memory-principal.ts` — 신규. 현재 local auth source와 명시적 local principal 해석. `resolveLocalMemoryPrincipal`.
- `source/host/gateway-config.ts` — 기존 inline gateway auth 조건 → 공유 helper. `isGatewayAuthenticationRequired`; local memory identity의 동일 경계 사용 목적.

### Transcript / runner

- `source/host/extensions/transcript/send-message-shaping.ts` — 기존 user echo 생성 → 내부 UUID 및 synthetic source marker 보존. `createUserMessage`.
- `source/host/extensions/transcript/send-pipeline.ts` — 기존 durable user acceptance → memory admission hook. `SendPipeline`; client nonce/ack 계약 유지.
- `source/host/extensions/transcript/send-turn-dispatch.ts` — 기존 runner send 구성 → synthetic source marker 전달. Turn dispatch composition.
- `source/host/extensions/transcript/session-runtime.ts` — 기존 active/materialized session 관리 → open/switch lifecycle 전달. Session runtime owner.
- `source/host/extensions/transcript/run-lifecycle.ts` — 기존 runtime retirement → close lifecycle 전달. Session retirement path.
- `source/host/extensions/transcript/agent-lifecycle.ts` — 기존 create/clone/import/delete → open/clear lifecycle 전달. Agent lifecycle operations.
- `source/host/extensions/transcript/transcript-manager.ts` — 기존 transcript store/runtime owner → 실제 transcript reader 등록과 shutdown hook. `setMemory`, `dispose`.
- `source/host/extensions/transcript/extension.ts` — 기존 manager composition → committed transcript clear/remove mutation 구독. `transcriptExtension.start`/stop.
- `source/host/extensions/teach-recording/extension.ts` — 기존 synthetic user-like send → `memoryLearningSource: system` 지정. Recording completion send.
- `source/host/runner/memory-runtime-hooks.ts` — 신규. Runner용 optional façade 계약과 streamed tool wrapper. `MemoryRuntimeStore`, `withMemoryToolAction`.
- `source/host/runner/turn-memory.ts` — 기존 store interface → optional runtime hook 계약 포함. `TurnMemoryStore`.
- `source/host/runner/turn-run-shell.ts` — 기존 turn preparation → async retrieval 준비, synthetic source 전달. Turn shell.
- `source/host/runner/turn-settle.ts` — 기존 exchange synthesis 전달 → synthetic turn 제외 및 canonical façade 호환. `TurnSettleHost`/settle path.
- `source/host/runner/system-prompt-assembly.ts` — 기존 raw recall/persisted freeze → canonical에서는 request packet 사용. `getMemorySection`, `getSystemPrompt`.
- `source/host/runner/tools/turn-toolset.ts` — 기존 concrete toolset 구성 → tool hook wrapper와 optional canonical knowledge query 전달. `buildTurnTools`/knowledge tool factory.
- `source/host/runner/tools/knowledge-search-tool.ts` — 기존 Markdown search → canonical-first query, explicit null legacy fallback. `createKnowledgeSearchTool`.
- `source/host/runner/knowledge-store.ts` — 기존 knowledge prompt/reader → canonical query 계약과 evidence 안내 추가. `CanonicalKnowledgeQuery`, `renderCanonicalKnowledgePrompt`.
- `source/host/host-runner-composition.ts` — 기존 production runner 조립 → scoped memory hook/knowledge callback/Aside parent identity 및 request별 prompt 연결. `createHostRunnerComposition`.

### Aside / administration / handoff

- `source/host/extensions/browse-runtime/browse-memory.ts` — 신규. Authenticated host identity와 Aside observation delivery adapter. `createBrowseMemoryHooks`.
- `source/host/extensions/browse-runtime/browse-client.ts` — 기존 local service client → authority handshake, task context, observation 및 outcome API. `BrowseClient.create/get/continue/answer/steer/reportOutcome`.
- `source/host/extensions/browse-runtime/extension.ts` — 기존 Aside runner/subagent factory → Memory dependency/scoped client. `createSubagentSession`, `wrapRunner`.
- `belmont-browse/src/memory-belmont-runtime.mjs` — 신규. Bounded transport, daemon authority marker, unbound account lookup 거부, observation/grade 구성. `validateBelmontMemoryContext`, `createTaskObservation`, `applyOutcomeGrade`.
- `belmont-browse/src/core.mjs` — 기존 same-owner browser execution → task context/usage/trajectory/terminal observation/runtimeConfig persistence. `createSessionController`, `runHandle`, `memoryTaskContext`, handle `reportOutcome`.
- `belmont-browse/src/serve.mjs` — 기존 HTTP routes → `/memory/context`, `/sessions/:id/outcome`, memoryContext 전달. Request router.
- `belmont-browse/src/session.mjs` — 기존 pinned daemon/lifecycle bootstrap → canonical 파생 daemon 선택 및 native memory lifecycle off. `loadDaemon`, `ensureLocalAccount`, `initializeLocalLifecycle`, `createBrowseSession`.
- `belmont-browse/tools/patch-daemon-canonical-memory.py` — 신규. Recovered daemon 내부 memory writer/read prompt 경계와 runtimeConfig schema를 opt-in transform. `patch`; marker/anchor가 맞는 입력만 쓰도록 작성.
- `scripts/bootstrap-aside-inputs.mjs` — 기존 pinned input hydration → opt-in canonical 파생 daemon/lineage 출력. `BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE` branch. 기존 pinned target을 파생 결과로 덮어쓰지 않는다.
- `scripts/memory-migrate.mjs` — 신규. 명시적 phase만 수행하는 administrative CLI. 기존 locked esbuild로 이 adapter만 memory bundle한 뒤 호출하며 host/browser를 시작하지 않는다.
- `docs/memory-2.1-migration-notes.md` — 신규. Migration state, original→UUID mapping, crash/retry, rollback 경계와 tester TODO.
- `docs/memory-2.1-runtime-handoff.ko.md` — 신규. 이 파일; 전체 integration 및 validation 인수 목록.
- `source/host/extensions/memory/kernel/REFERENCE.md` — 신규. Reference 출처와 제품 adapter 분리 원칙.

### Reference kernel 파일

다음 파일의 이전 역할은 제공된 reference `src/` 모듈이며, 새 역할은 동일 구현을 제품 module boundary에서 사용하는 것이다. Belmont-specific 코드로 재작성하지 않고 source를 배치했다.

- `kernel/index.ts` — public exports; product adapter import boundary.
- `kernel/types.ts` — evidence/proposal/item/principal/snapshot 및 5종 memory 계약.
- `kernel/schema.ts` — canonical SQLite schema/FTS/outbox/revision/dependency/tombstone 구조.
- `kernel/repository.ts` — `MemoryKernel`, `MemorySession`; capture/propose/batch/forget/clear/CAS/idempotency.
- `kernel/policy.ts` — `decide`; actor/authority/explicit-vs-inferred policy.
- `kernel/text.ts` — normalization, Korean CJK bigram 및 rank fusion primitives.
- `kernel/retrieval.ts` — reference sparse/revalidation retrieval helpers.
- `kernel/frozen-prompt.ts` — reference snapshot-key/frozen-prompt helpers; kernel export 유지, product canonical prompt는 request packet 사용.
- `kernel/host-bridge.ts` — reference `BelmontMemoryBridge` 호환 export; 제품 root는 `BelmontMemoryLearningRuntime`.
- `kernel/legacy-import.ts` — `inspectLegacyMarkdown`; migration source parse.
- `kernel/knowledge-paths.ts` — reference knowledge path confinement helper 유지.
- `kernel/learning/contracts.ts` — atomic/episode/procedure 및 structured details 계약.
- `kernel/learning/validate.ts` — structured memory details validation.
- `kernel/learning/extract.ts` — bounded stated-memory extraction; general NLU 모델 추가 없음.
- `kernel/learning/dreaming.ts` — `DreamingEngine`, `segmentEpisodes`, `allMemories`.
- `kernel/learning/action.ts` — `groundAction`, `DigitalSelf`; current args/whitelist/evidence grounding.
- `kernel/learning/runtime.ts` — `createLearningRuntime`; reference learning/retrieval/experience composition.
- `kernel/learning/host-hooks.ts` — `MemoryLearningHostHooks`; in-memory episode buffer.
- `kernel/semantic/planner.ts` — `planQuery`, `contextMatches`; query/type/time/context planning.
- `kernel/semantic/embedding.ts` — `HttpEmbeddingAdapter`, model identity/deadline/vector helpers.
- `kernel/semantic/vector-index.ts` — `VectorIndex`; identity manifest, derived cosine index, rebuild/outbox consumer.
- `kernel/semantic/retriever.ts` — `MemoryRetriever`; sparse/dense/RRF/rerank/revalidation/evidence packet.
- `kernel/semantic/navigation.ts` — `NavigationIndex`; 기존 hierarchy/graph 구현 유지, default OFF.
- `kernel/experience/loop.ts` — `ExperienceLoop`; ingest/select/promote/feedback 및 reference measurement helper. Measurement helper는 이번 작업에서 호출하지 않음.
- `kernel/experience/http.ts` — reference HTTP adapter export 유지. 제품 wire는 기존 authenticated local BrowseClient/serve routes.
- `kernel/procedures.ts` — `evaluateProcedure`; reference bounded procedure acceptance rule.

위 `kernel/` 상대경로의 prefix는 모두 `source/host/extensions/memory/`이다. Reference tests/dist/bench/services는 제품 source로 복사하거나 실행하지 않았다.

## 4. Configuration

Rollout authority는 `<sandRoot>/memory-2.1/rollout.json`이다. Env 변경만으로 canonical에서 legacy로 되돌아가지 않는다.

| 설정 | 기본값 / 역할 |
|---|---|
| `SAND_MEMORY_EMBEDDING_ENDPOINT` | 없음; 기존 E5 service의 embedding URL |
| `SAND_MEMORY_EMBEDDING_TOKEN` | 없음; endpoint bearer token |
| `SAND_MEMORY_EMBEDDING_MODEL` | `intfloat/multilingual-e5-small` |
| `SAND_MEMORY_EMBEDDING_REVISION` | `fd1525a9fd15316a2d503bf26ab031a61d056e98` |
| `SAND_MEMORY_EMBEDDING_DIMENSION` | `384` |
| `SAND_MEMORY_EMBEDDING_RECIPE` | `e5-prefix-mean-l2-512-v1` |
| `SAND_MEMORY_INDEX_VERSION` | `cosine-flat-f32-v1`; 다른 version은 현재 adapter가 거부 |
| `SAND_MEMORY_DENSE` | endpoint가 있으면 `1`, 없으면 `0` |
| `SAND_MEMORY_DENSE_TIMEOUT_MS` | `1000` |
| `SAND_MEMORY_INDEX_TIMEOUT_MS` | `30000`; reference batch/job timeout |
| `SAND_MEMORY_CONTEXT_BUDGET` | `2048`; reference UTF-8 token 추정 budget |
| `SAND_MEMORY_RETRIEVAL_LIMIT` | `10` |
| `SAND_MEMORY_INACTIVITY_MS` | `1800000` |
| `SAND_MEMORY_HIERARCHY` | `0` |
| `SAND_MEMORY_GRAPH` | `0` |
| `SAND_MEMORY_SITE_REVISIONS_JSON` | `{}`; 일반 Belmont browser domain→operator revision |
| `SAND_MEMORY_LOCAL_PRINCIPAL_ID` | 없음; authenticated local mode에서 OAuth subject를 얻지 못할 때만 명시적 ID |
| `SAND_PI_CODEX_AUTH_PATH` | 기존 local Pi auth 파일 해석; 새 credential 파일 생성 없음 |
| `BELMONT_MEMORY_AUTHORITY` | 미설정 시 `aside-legacy`; `belmont`는 canonical guarded daemon 요구 |
| `BELMONT_BROWSE_SITE_REVISIONS_JSON` | `{}`; Aside task domain→operator revision |
| `BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE` | 미설정; bootstrap 시 파생 daemon 생성할 engine 선택, 예 `909` |

Boolean env는 `0`/`1`만 받는다. Planning은 ON이다. Site revision을 현재 URL/시간만으로 발명하지 않는다. Aside environment는 실제 engine/profile identity로 구성된다. Exact URL 하나를 task에서 얻지 못하면 domain-dependent procedure 선택은 하지 않는다.

기존 `sand_memory_dreaming` experiment는 legacy synthesis에만 적용한다. Canonical에서는 lifecycle hook이 reference dreaming을 소유한다. 새로운 graph DB, RL, multi-vector, cloud-sync 설정은 없다.

## 5. Migration entrypoint / rollback

상세는 [memory-2.1-migration-notes.md](memory-2.1-migration-notes.md). 현재 작업은 아래 명령을 실행하지 않았다.

```bash
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase status
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase freeze
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase inventory
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase barriers
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase import
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase validation-ready
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase shadow-read
```

`freeze`는 cooperative writer barrier이며, **현재 실행 중인 예전 host 바이너리에 새 guard를 소급 적용하지 않는다**. 별도 배포/운영 담당자가 writer 소유권과 quiescence를 먼저 다뤄야 한다. 이 작업에서는 서비스 stop/restart를 하지 않았다.

별도 validation/운영 승인 이후의 cutover 입력 형태:

```bash
node scripts/memory-migrate.mjs --sand-root '<actual sand root>' --principal '<exact host principal>' --phase cutover --approved-by '<operator>' --validation-artifact '<external report>' --inventory-digest '<frozen digest>'
```

`validationArtifact`는 operator가 제공하는 외부 근거 참조이다. CLI가 그 보고서의 테스트 결과를 실행하거나 진위를 인증하는 기능은 없다. Inventory/accounting gate와 같은 의미로 혼동하지 않는다.

Rollback은 stale Markdown 재활성화가 아니다. `--phase pause`는 canonical stage를 유지하며 새 canonical mutation admission을 멈추는 경계다. In-flight async index 작업을 중단시키는 전역 cancellation은 없으므로 운영 quiescence가 필요하다. DB, tombstone key, barrier/epoch, mapping을 함께 보존해야 한다. 자동 unfreeze/resume/삭제/복원 기능은 작성하지 않았다.

Guarded Aside 입력을 별도 build 담당자가 생성하는 entrypoint:

```bash
BELMONT_ASIDE_CANONICAL_MEMORY_ENGINE=909 npm run bootstrap:aside
```

이 소스 경로는 pinned input을 확인한 뒤 sibling `daemon.memory-2.1.mjs`와 lineage JSON을 생성하도록 작성했다. 이번 작업에서는 generator/bootstrap을 실행하지 않았고 pinned archive, 기존 daemon, running profile을 교체하지 않았다. Canonical mode 서비스 실행은 별도 운영 단계다.

## 6. 유지 / 대체 / 아직 미연결

유지: MemoryService의 UI record/CRUD 계약, 기존 transcript persistence/agent session owner, legacy mode의 recall/synthesis/frozen prompt, 실제 tool schema/approval, Aside의 기존 same-owner AgentSessionServer 및 browser profile, reference kernel 정책/transaction/data semantics.

Canonical stage에서 대체: Markdown 독립 memory write, legacy settle synthesis의 long-term writer 역할, raw memory prompt snapshot 주입, old knowledge Markdown 검색 fallback, Aside native personal MemoryHook/extraction/dreaming/backfill/account-wide lookup. Scope 없는 Aside account search를 Belmont user scope로 연결하지 않는다.

아직 실행 또는 producer 연결이 필요한 경계:

- Source type compatibility, module loading, actual Electron/Node SQLite support, extension startup/shutdown order는 실행 미확인.
- Source build/runtime 배포와 production migration은 미실행. 기존 실행 중인 host/Aside/PWA가 이 소스를 사용한다는 주장은 하지 않는다.
- Actual E5 endpoint/model 운영과 dense retrieval 품질·속도는 미확인.
- 기존 curated knowledge Markdown의 자동 canonical import/export는 추가하지 않았다. Canonical 전환 후 별도 approved ingestion이 필요하다.
- Aside의 성공 grade/site knowledge/candidate를 자동 생성하는 새 agent/evaluator는 없다. Submission API와 host acceptance/feedback 호출면이 있으며 실제 grading/paired trial producer 연결은 별도이다.
- Aside native tool은 JavaScript REPL이다. 임의 JavaScript를 분석하여 내부 browser argument를 host가 다시 쓰는 adapter는 없다. Aside는 bound evidence/accepted procedure를 prompt context로 받고, 일반 Belmont browser tools는 위 whitelist argument adapter를 사용한다.
- Actual dynamic page failure-condition observer는 추가하지 않았다. 현재 built-in context producer가 관측하지 못하는 조건을 가진 procedure는 자동 선택에서 제한한다.
- Native Aside task가 실행 중인 동안 매 내부 REPL action마다 Belmont에 epoch를 재조회하는 callback은 없다. Host create/answer/steer 및 refreshed continue 경계의 revalidation과 outcome admission이 작성된 범위다. 진행 중 forget/revision race는 testing/운영 판단 항목이다.
- Persisted Aside binding/observation은 기존 SessionStore record에 남는다. Canonical forget이 이미 전송된 Aside transcript의 과거 packet까지 지우는 cross-store redaction은 구현하지 않았다.
- Canonical UI record는 기존 profile/log 투영이다. 5종 type/details/authority를 편집하는 새 UI나 agent `review_required` 전용 승인 UI는 만들지 않았다. UI의 명시적 add를 user proposal로 연결했다.
- Raw user content가 reference capture limit를 넘거나 checkpoint admission 중 오류가 나면 정상 학습을 보장하지 않는다. Source limit/error/retry 및 위 transcript→checkpoint crash gap은 tester가 다룰 항목이다.

## 7. 테스트 에이전트 TODO — 실행 결과 없음

1. Node 26.5.x 및 실제 Electron host runtime의 `node:sqlite`/ESM import 호환성을 확인하고 `npm run check`, `npm run frontend:build`를 실행한다. Reference tests와 제품 regression 사이의 import path 차이를 다룬다. 이번 작업에서 테스트 파일을 추가/실행하지 않았다.
2. Reference kernel 계약 회귀: evidence/revision/dependency/tombstone/CAS/idempotency/batch/outbox, CJK/BM25, temporal validity, explicit/inferred, memory_details, packet span, five memory types, hierarchy/graph OFF.
3. Auth와 scope: valid/expired/missing principal, local Pi subject, explicit local fallback, account switch, user/project shard 분리, membership 변경, parent/subagent/automation/group/remote room propagation.
4. Lifecycle: normal/duplicate user send, UUID persistence, clear 후 reused t0u, synthetic teach send, attachment-only, cold transcript reader, open/switch/retire/inactivity/shutdown/restart, paused writes, crash before/after checkpoint. Raw transcript 재생이 새 승인을 만들지 않는지 검증한다.
5. Façade: legacy/frozen/shadow/canonical 전환과 materialized store, UI add/remove/clear 및 stale legacy ID mapping, synthesis/direct shard writes, mixed principal/session context cache, canonical prompt packet budget/revalidation, knowledge_search explicit-null fallback.
6. Migration: 별도 임시 fixture에서 모든 phase를 수행하고 tombstone-only shard, explicit marker, duplicate ID, invalid dates/lines/symlink, fact-before-barrier 거부, source drift, partial receipts, crash/retry, inventory-bound cutover, pause/rollback boundary를 검증한다. Production data에는 별도 운영 승인 전 적용하지 않는다.
7. Grounding: streamed JSON 및 opaque tool format, existing/current args 보존, whitelist 외 field, ambiguous ref/step, snapshot/site/environment/version mismatch, nonempty unknown failure conditions, deleted/expired/unaccepted procedure, existing schema/approval 순서, tool result evidence provenance를 검증한다.
8. Aside source generator를 별도 입력으로 실행하여 exact anchor/lineage 및 guarded loader를 확인한다. Native memory paths, no-account-fallback, same-run message-array handling, SessionStore field persistence를 검증한다. 기존 live daemon/profile을 시험 대상으로 임의 재시작하지 않는다.
9. Aside fixture/integration: authority handshake, task context/identity spoofing, terminal ungraded observation, immutable outcome grade, usage/timing absent, oversize trajectory/candidate, environment/site revision 변경, interrupted/hydrated session, repeated and late delivery, owner/epoch drift, procedure feedback 및 deprecated 상태를 검증한다.
10. 별도 trusted evaluator fixture에서 paired trials→accept/reject→selection→outcome→feedback 흐름을 검증한다. Trial 배열을 agent/Aside가 직접 승인 근거로 넣지 못하는지 확인한다.
11. E5/derived vector: no endpoint/offline/timeout fallback, identity mismatch, deleted derived DB, rebuild readiness, outbox retries/ACK, per-scope isolation, query cancellation 및 index pause/shutdown. 실제 model download/run과 retrieval benchmark는 테스트 담당 범위다.
12. Build 이후 source→build artifact→actual process lineage를 기록하고, isolated browser E2E 및 실제 Aside task로 user-visible flow를 관찰한다. 일반 browser argument adapter와 native Aside REPL 경계를 별도로 보고한다. 마지막으로만 실제 배포/migration 여부를 결정한다.

이 작업에서 시작한 detached job은 없다. 작업 전 존재한 host/Electron/Aside/Chrome/PWA/tmux session은 이 작업의 소유가 아니다. 다음 담당자는 이 문서와 migration notes를 먼저 읽고, 사용자 파일·DB·profile·pinned inputs를 보존한 상태로 검증 범위를 정한다.
