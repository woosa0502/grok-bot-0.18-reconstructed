# Belmont 전체 기능·커밋·Pi 통합 재검토

> 날짜: 2026-08-28  
> 현재 기준: `feature/belmont-agent-tooling` / `f8a8a0502fc2222697a40bd0476e503d46ac79d4`  
> 원본 기준: `a9f633e09d49a85829b8236331b9e21f7e612634`  
> Pi 검토 기준: `c148f1edcd80e12107178789930e5e1a58beda8c` → `5993ec57320fc1922b5206f45b99804b5904d093` (PR #1)  
> 상태: **`REVIEW_REQUIRED / PI_OVERLAY_REJECTED_AS_IS / PRODUCT_ACCEPTANCE_UNVERIFIED`**  
> 독립 적대 검토: **`PARTIAL — merge 거부 확인, Pi 방향·실행 로그·제품 E2E 미승격`**

## 1. 최종 결론

1. **Pi를 Codex 인증·모델·전송 런타임으로 쓰는 방향은 타당하다.** `[inference]` 현재 Belmont가 `~/.codex/auth.json` 내부 형식, refresh, ChatGPT Codex transport를 직접 소유하는 것보다 책임 경계가 낫다.
2. **PR #1(`5993ec5`)은 그대로 병합하면 안 된다.** `[direct_observation]` 첫 packaged Codex 호출, checkpoint/compact, 이미지·reasoning 변환을 막는 P0 결함이 있다. 모델·system prompt 소유권도 불일치하며 최신 HEAD와 4개 파일에서 충돌한다.
3. **현재 HEAD도 Codex OAuth-only 제품으로 완성되지 않았다.** `[direct_observation]` Electron 계정은 고정 mock이고, 기본 provider는 Cursor이며, Web·voice·plugin marketplace·cloud agent 등 여러 기능이 Cursor backend에 남아 있다.
4. **구조 테스트가 녹색인 것과 제품 기능 완성은 별개다.** `[direct_observation]` clean HEAD는 76/76, Pi PR도 76/76이지만 어느 쪽도 실제 로그인→추론→도구→첨부→중단→재시작을 검증하지 않는다.
5. **과거 1,292건은 완료 원장이 아니다.** `[raw_recompute]` 산술은 84/484/656/68로 맞지만 durable CDP observation이 연결된 canonical case는 90건뿐이다. 1,202건은 durable case-linked CDP 관측이 없다.
6. **원본 `a9f633e`를 포함하면 79개, 원본 뒤에 추가된 커밋은 78개다.** `[raw_recompute]` 모든 커밋을 immutable SHA 기준으로 다시 분류했다. 유효한 좁은 수정은 많지만, 이를 전체 기능 완료로 승격한 문서 주장은 여러 곳에서 반증됐다.

따라서 구현 기준은 **“최신 HEAD 위에 Pi를 다시 이식하되, Belmont 소유 경계와 실제 스키마를 보존하고, Codex-only profile과 제품 E2E를 별도로 완성한다”**이다.

## 2. 검토 범위와 증거 규칙

### 포함

- 원본 `a9f633e`부터 현재 `f8a8a05`까지 79개 커밋
- Pi 0.84.3 오버레이 PR #1의 24개 변경 파일과 실제 WSL 산출물
- `STRUCTURE_COMPLETE_UNVERIFIED`, pilot/remediation, reconstructed-tools, code-review 문서
- 1,292 runnable queue, 208 excluded queue, 이후 438 AGENT sweep 및 823 USER surface sweep
- 인증, 추론, 모델, transcript, compact/resume, interrupt, subagent, hooks, MCP, Web, attachment/media, file/shell, plugins, browser/computer use, notifications, packaging

### 제외·보존

- 실행 중인 Belmont Host/Electron/box/MCP 프로세스는 **DO NOT TOUCH**로 두었다.
- source/runtime 코드는 수정하지 않았다.
- 작업 전부터 있던 미추적 복원 초안은 구현 판정에서 제외했다.
- 실제 OpenAI 계정으로 OAuth·Codex traffic을 발생시키는 live E2E는 수행하지 않았다.

### 증거 라벨

- `direct_observation`: 현재 파일, SHA, 명령 출력, 실제 산출물에서 확인
- `raw_recompute`: 원시 JSONL/commit graph를 독립 재계산
- `documented_prior_claim`: 기존 문서의 주장만 확인
- `inference`: 여러 직접 관측으로부터 도출
- `unverified`: 검증 증거 없음

## 3. 현재 상태와 테스트가 실제로 증명하는 것

### 3.1 현재 작업 상태

- `[direct_observation]` tracked HEAD: `f8a8a05`, remote branch와 동일
- `[direct_observation]` 실행 중인 `.build/belmont-wsl-runtime` lineage는 `a169fd8` 계열로 현재 HEAD보다 오래됐다. 현재 source의 live acceptance로 사용할 수 없다.
- `[direct_observation]` 다음 미추적 파일은 다른 작업자의 복원 초안이며 production import가 없어 `CODE_PRESENT_UNINTEGRATED`이다.

```text
docs/BELMONT_FUNCTIONAL_COMPLETION_ROADMAP.md
frontend/src/recovered/runtime/model-catalog-reconciliation.ts
source/host/runner/recovered-production-stream-retry.ts
source/host/runner/recovered-video-subagent-configs.ts
source/packages/agent/tools/cloud-agents/
tests/unimplemented-restoration-code.test.mjs
```

### 3.2 clean HEAD 검증

격리된 clean worktree, Node 26.5에서 확인했다.

```text
npm run check              PASS — TypeScript + 76/76 tests
npm run frontend:build     PASS — bundle-size/dynamic-import warnings 존재
npm run publication:check PASS — 2,195 files, tree 81089b363c2941956bfa25271d904b30e1fe646d
```

현재 dirty worktree에서 보이는 81/81은 미추적 테스트 5개를 포함한다. 기존 문서의 80/80은 어느 경계에도 맞지 않는다.

위 PASS와 tree hash는 이 감사의 main context에서 직접 관측했지만 별도 durable log 파일로 보존하지 않았다. 독립 verifier는 committed test 76개와 dirty +5개의 enumeration은 재현했으나 실행 결과 자체는 `INCONCLUSIVE`로 남겼다.

### 3.3 Pi PR 검증

격리된 `5993ec5` worktree에서 확인했다.

```text
npm run check              PASS — 76/76 tests
npm run frontend:build     PASS
npm run publication:check PASS — 2,196 files, tree 042516e6663936a5f0aefbb0c8a6dfb70c946a26
npm run wsl:setup          명령 성공, 그러나 Pi runtime 누락 산출물 생성
```

이 결과가 입증하는 것은 type/source/build/publication 구조뿐이다. 다음은 입증하지 않는다.

- 앱 OAuth login/refresh/logout
- packaged Host의 실제 Pi import와 Codex 호출
- Pi→Belmont tool/MCP loop
- 이미지·reasoning·tool-result image
- active HTTP/tool interrupt
- compact/checkpoint/restart/resume
- bot별 모델 선택
- Cursor egress 0건

Pi PASS/tree hash도 main context의 직접 관측이며 독립 실행 log는 남기지 않았다. 다만 verifier는 별도 in-memory esbuild 재계산으로 variable dynamic import가 bundle에 남고 `createPiCodexExecutor`가 포함되지 않는 핵심 package blocker를 확인했다.

## 4. Pi 전환 재검토

### 4.1 Pi가 담당해야 하는 경계

Pi가 맡을 기능은 다음으로 제한한다.

- OpenAI Codex OAuth login·refresh·account ID
- Codex model catalog와 capability 검증
- Codex SSE/WebSocket transport, retry, prompt cache
- request-level `AbortSignal`
- Pi-native image, thinking/signature, tool-result image, usage projection

Belmont가 계속 소유해야 하는 기능은 다음이다.

- renderer/Electron UI와 계정 상태 표시
- transcript, checkpoint, compact 정책과 restart 복구
- tool execution, permission/approval, Shell/file/MCP
- subagent lifecycle, bot별 설정, hooks
- background process, notifications, plugins, Web 도구

### 4.2 PR #1 병합 차단 결함

#### PI-P0-01 — packaged runtime 누락 (`BROKEN`)

`provider-session.ts`가 변수 기반 `import("./pi-codex-runtime.js")`를 사용한다. esbuild가 이를 번들하지 않았고, 실제 `dist/host/host-main.cjs`에는 import가 남았지만 `dist/host/pi-codex-runtime.js`는 없었다. 첫 packaged Codex prompt가 module-not-found로 실패한다.

#### PI-P1-02 — 모델 소유권 split (`PARTIAL/BROKEN_WIRING`)

초안의 “정상 기본 turn이 없는 모델 때문에 즉시 실패한다”는 주장은 적대 검토에서 **반증됐다**. Pi provider/session의 실제 fallback은 catalog에 존재하는 `gpt-5.4`다. 다만 Belmont turn static config에는 catalog에 없는 `gpt-5.5-high-fast`가 남고, production owner의 top-level `modelId`는 채워지지 않아 provider session으로 전달되지 않는다. 결과적으로 실제 추론은 Pi `gpt-5.4` fallback을 쓰면서 Belmont UI/usage/subagent model projection은 다른 정적 ID를 가리킬 수 있다. bot별 선택·표시·persist·실제 요청이 하나의 model ID로 수렴하지 않는 것이 확인된 결함이다.

확인된 Pi catalog는 `gpt-5.3-codex-spark`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.5`, `gpt-5.6-luna`, `gpt-5.6-sol`, `gpt-5.6-terra`였다.

#### PI-P0-03 — executor state 계약 파괴 (`BROKEN`)

Belmont의 `ProviderPromptExecutor.getState()` 소비자는 메시지 배열에 `.map()`과 `.length`를 적용한다. PR은 `{schemaVersion, messages, modelId}` 객체를 반환한다. checkpoint/compact에서 `plainMessages.map is not a function` 계열 실패가 가능하다. model ID는 배열 계약을 바꾸지 말고 별도 session metadata에 저장해야 한다.

#### PI-P0-04 — 실제 content/event 스키마 불일치 (`BROKEN`)

실제 Belmont는 다음을 사용한다.

```text
image:              { type: "image", image: dataUrl, mimeType }
reasoning:          { type: "reasoning", text, signature }
redacted reasoning: { type: "redacted-reasoning", data }
tool result image:  experimental_content
stream reasoning:   { type: "reasoning", textDelta }
```

PR은 `part.data`, `part.reasoning/part.thinking`, `result/content`, `reasoning-delta`를 사용하고 최종 part를 `{reasoning: ...}`로 만든다. 결과는 user image와 tool-result image 누락, reasoning/signature 손실, delta 무시이며, 최종 `part.text.trim()`에서 예외가 날 수 있다. PR 테스트 fixture가 실제 Belmont 형식이 아니어서 녹색이었다.

#### PI-P1-05 — Belmont 동적 system instruction 강등 (`PARTIAL`)

초안의 “Pi에 system prompt가 전혀 전달되지 않는다”는 주장은 **반증됐다**. PR은 별도 `GROK_ROUTER_SYSTEM_PROMPT`를 `Context.systemPrompt`로 전달한다. 그러나 `messagesToPi()`가 user 이외 모든 role을 assistant history로 처리하므로, Belmont가 매 turn 조립한 full production system message는 Pi system channel이 아니라 assistant history로 강등된다. 짧은 router prompt는 유지되지만 agent profile, tool 정책, routine/memory 안내 등 Belmont 동적 instruction authority가 보존되지 않는 것이 문제다.

### 4.3 PR #1의 추가 미완성

- Pi auth/CLI가 Electron account RPC와 연결되지 않아 UI는 계속 `local@codex` mock이다.
- Host readiness가 Pi credential을 authoritative source로 보지 않는다.
- Codex-only runtime profile, provider allowlist, Cursor fallback 차단이 없다.
- Pi model list가 renderer 또는 bot 설정에 연결되지 않는다.
- bot별 `modelId`는 실제 owner/session 경계까지 전달되지 않는다.
- 30초 stale credential lock은 heartbeat가 없어 느린 refresh 중 탈취될 수 있다.
- CLI store와 Host store가 서로 다른 lock을 써 동시 write가 덮어쓸 수 있다.
- AbortSignal 전달 코드는 있으나 model→tool→process 연쇄 취소 E2E가 없다.
- native Codex thread/resume가 아니라 `store:false` + Belmont 전체 replay이다.
- 최신 HEAD와 `mcp-stdio-client.ts`, `server.ts`, `host-runner-composition.ts`, `publication-packaging.test.mjs`가 충돌한다.

### 4.4 판정

**`Pi 선택 = 유지`, `5993ec5 = 참고 구현`, `현재 PR 병합 = 거부`.** 확정적인 merge blocker는 packaged runtime 누락, executor state 계약 파괴, 실제 content/event schema 불일치다. 모델과 system prompt는 즉시 module failure가 아니라 별도의 major integration gap으로 낮춰 판정한다.

최신 `f8a8a05` 위에서 다음 순서로 재구성해야 한다.

1. Pi module을 실제 Host bundle에 포함
2. Belmont system/image/reasoning/tool-result/event 계약에 맞는 adapter 작성
3. 기존 executor message-array state 계약 유지
4. model ID와 provider metadata를 별도 durable session state에 저장
5. Pi credential을 Host/Electron account의 단일 source of truth로 연결
6. Codex-only profile과 Cursor no-fallback 적용
7. direct transport와 Pi transport의 parity를 입증한 뒤에만 기존 transport 삭제

## 5. Codex OAuth-only 기준 전체 기능 이슈 레지스트리

### 5.1 P0 — 정상 제품 흐름을 막는 항목

- **AUTH-001 `STUB/MOCK`** — Electron account status가 고정 logged-in이며 login/logout/subscribe가 실제 credential과 무관하다.
- **PROFILE-001 `MISSING_REQUIRED`** — `SAND_LOCAL_CODEX_MODE`와 inference provider가 분리돼 있고 저장소 기본은 `cursor`다. Codex-only authoritative profile과 fail-closed provider allowlist가 없다.
- **PI-001 `REJECTED_AS_IS`** — PI-P0-01/03/04와 PI-P1-02/05가 해결되지 않아 현재 오버레이를 배포할 수 없다.
- **MODEL-001 `MISSING_REQUIRED`** — Pi catalog 기반 기본값 migration, renderer selector, bot별 model persist/restore/validation이 없다.
- **INTERRUPT-001 `BROKEN_CURRENT`** — 현재 direct Codex fetch는 turn AbortSignal을 받지 않는다. UI도 active turn stop보다 queued-send cancel 중심이다.
- **ATTACH-INFERENCE-001 `PARTIAL/BROKEN`** — staging은 되지만 current Codex projection이 file/reasoning part를 버린다. Pi PR projection도 실제 schema와 맞지 않는다.
- **ACCEPTANCE-001 `MISSING_REQUIRED`** — clean app에서 login→stream→tool→renderer→interrupt→restart의 단일 제품 E2E가 없다.

### 5.2 P1 — Belmont 소유 경계의 부분 구현·결함

#### Subagent

- foreground child result와 foreground dispose, 일부 parent-only tool gate는 복원됐다.
- child가 parent session/store/DB/MCP/audit/blob/conversation state를 공유한다.
- child cancel이 parent runner를 interrupt할 수 있다.
- Task `modelId`가 child runtime까지 유지되지 않는다.
- resume은 durable child checkpoint 없이 새 runner를 만든다.
- background settle은 runner를 dispose하지 않는다.
- `readonly`는 prompt/flag 수준이며 실제 executor enforcement가 없다.
- CloudAgent가 child tool surface에 남는다.

판정: **`SUBAGENT-001 PARTIAL/BROKEN_ISOLATION`**. Pi는 이 경계를 해결하지 않는다.

#### Hooks

- schema, merge, 일부 `preToolUse`, configuredSteps, foreground subagent markers는 존재한다.
- central gate가 unary box tools 중심이라 stream/background Shell, stdin, MCP, WebFetch 등을 포괄하지 않는다.
- `subagentStart`의 deny/ask와 `subagentStop`의 follow-up 반환값을 소비하지 않는다.
- 일반 post/failure/session/workspace/response lifecycle reachability가 입증되지 않았다.
- current Codex는 reasoning event를 올바르게 내지 않아 `afterAgentThought`가 도달하지 않는다. Pi PR 이벤트도 현재 계약과 다르다.

판정: **`HOOK-001 PARTIAL/BROKEN_SEMANTICS`**.

#### Local MCP

- stdio initialize/list/call, stderr drain, 기본 start error, pre-aborted signal, SIGTERM→SIGKILL 경로는 있다.
- in-flight end-to-end cancel, hanging initialize cleanup, pagination, `list_changed`, server request/notification, HTTP/SSE transport, restart/backoff/watcher가 없다.
- Host projection이 config `cwd`를 잃는다.
- local identifier와 positive-decimal API contract가 충돌할 수 있다.
- malformed config가 진단/last-known-good 없이 empty로 변한다.
- audio/blob/resource fidelity가 손실된다.
- MCP `isError:true`가 success telemetry로 기록될 수 있다.
- subagent MCP projection이 parent identity와 `isSubagentRunner:false`를 쓴다.

판정: **`MCP-001 STRUCTURAL_BASIC_PASS / LIFECYCLE_PARTIAL`**.

#### File tools

- grep context event를 parser가 버린다.
- global head cap 이후 per-file count/truncation 의미가 부정확하다.
- `list_dir` budget/readdir 오류가 partial/error marker 없는 성공처럼 반환된다.
- glob/grep/shell의 canonical symlink boundary가 완전하지 않다.
- protected-path helper가 `realpath` 모든 오류를 fail-open으로 삼킨다.
- write는 atomic write가 아니며 일부 세부 오류 fidelity가 부족하다.

판정: **`FILES-001 PARTIAL`**.

#### Background Shell

- process handoff, terminal record, status, Await 경로는 있다.
- handoff 이후 `hardTimeout`이 강제되지 않는다.
- handoff 전 early output이 terminal file에 없어 Await regex가 놓칠 수 있다.
- 매 호출이 새 shell이어서 cwd/env/session state가 유지되지 않는다.
- restart reattach, stdin, cancel lifecycle의 제품 E2E가 없다.

판정: **`SHELL-001 PARTIAL`**.

#### Transcript·compact·resume

- ownership-first transcript routing과 local checkpoint machinery는 방향상 맞다.
- 실제 WAL/sidecar 중간 실패·crash·restart 복구 테스트가 없다.
- current Codex는 전체 transcript를 매번 재전송하며 native response continuity를 사용하지 않는다.
- compact 후 bot model/session metadata가 유지되는 acceptance가 없다.

판정: **`TRANSCRIPT-001 LOGIC_PRESENT / CRASH_E2E_UNVERIFIED`**.

#### Attachment·media

- renderer→preload→Electron native-byte staging은 복원됐다.
- successful commit 후 staging file을 삭제하지 않아 최대 200MB video 등이 누적될 수 있다.
- attachment-only send, Host content store, inference input, transcript까지 E2E가 없다.
- PDF extractor worker가 없어 Read 경로가 실패한다.
- image는 current Codex input에서 drop된다.
- video analysis subagent와 direct video path가 production에 없다.
- audio dictation은 Cursor transcription backend에 의존한다.

판정: **`MEDIA-001 STAGING_PARTIAL / INFERENCE_AND_PROCESSING_MISSING`**.

#### Auto-review

non-Cursor provider이면 Host 시작 시 사용자 설정과 무관하게 effective off로 고정한다. UI 설정과 실제 동작이 다를 수 있고 runtime provider 변경도 반영하지 않는다. 이를 “사용자가 다시 켤 수 있다”고 주장한 테스트는 실제 extension을 실행하지 않는다.

판정: **`AUTOREVIEW-001 WORKAROUND / PROFILE_CAPABILITY_REQUIRED`**.

#### Skills·routines·memory/state

- local workflow/skill file store, per-agent enablement, managed/plugin skill cache projection, `update_state`, file automation store와 cron wake 경로는 코드상 존재한다.
- local `AGENTS.md`/`CLAUDE.md` import와 workflow create/update/delete의 저장 계층도 존재한다.
- managed/plugin skill fetch·publish·sync와 Slack/GitHub 등 event-listener 연결은 Cursor account/backend 경로가 남아 있다.
- cron routine의 create→fire→tool→run ledger→restart 흐름과 skill helper-script 실행은 현재 제품 E2E가 없다.
- 일부 과거 `update_state` case는 설정 파일 write만 확인하고 roster/title/conversation preservation까지 PASS로 확대했다.

판정: **`SKILL/ROUTINE-001 LOCAL_CORE_PRESENT / EXTERNAL_SYNC_AND_ACCEPTANCE_PARTIAL`**. “스킬 시스템이 없다”는 틀리지만 “제품에서 완전히 동작한다”도 입증되지 않았다.

#### Thread·reply·reaction·chat state

- editable frontend의 thread/reply source와 SSR/unit 계약, reaction toggle의 current code는 존재한다.
- checksum-pinned packaged renderer에 editable reconstruction이 포함돼 실제 click→persist→restart하는지는 확인되지 않았다.
- 과거 legacy transcript merge가 pagination/ID/reaction을 손상시켰다가 제거됐고, current full-history/restart 회귀는 없다.

판정: **`CHAT-STATE-001 SOURCE_PRESENT / PACKAGED_E2E_UNVERIFIED`**.

#### Packaging·Windows/WSL

- macOS bootstrap/checksum/sign/publication 경로는 구조적으로 구현됐다.
- WSL은 launcher와 hydrated fidelity runtime이지 Windows 설치 앱 패키지가 아니다.
- Windows distributable과 clean-machine installer acceptance는 없다.
- 현재 live WSL build는 current HEAD가 아니며, Pi PR의 WSL build는 명령 성공 후에도 Pi module을 누락했다.

판정: **`PACKAGE-001 MAC_STRUCTURE_PASS / WSL_CURRENT_STALE / WINDOWS_PACKAGE_MISSING`**.

### 5.3 교체 구현이 필요한 외부 기능

#### WebSearch·WebFetch

현재 두 production service는 Cursor `AiService`를 호출한다. `WebFetch`의 local 코드는 validation/truncation wrapper이며 HTTP fetch 구현이 아니다. current Codex transport는 hosted WebSearch를 쓰지 않는다. 여기서 `CURRENT_UNREACHABLE`은 **Codex-only/no-Cursor-token profile에서 도달할 수 없다**는 뜻이며 production source 자체가 없다는 뜻은 아니다.

- WebSearch: Pi/Codex native tool을 실제 entitlement·event·citation·interrupt traffic으로 입증하거나, Belmont가 독립 search backend tool을 구현해야 한다.
- WebFetch: Belmont local fetch + redirect/timeout/size/MIME/본문 추출 정책을 구현해야 한다.

판정: **`WEB-001 CURRENT_UNREACHABLE / REPLACEMENT_MISSING`**.

#### Plugins·Marketplace

local stdio MCP와 plugin UI surface는 존재한다. 그러나 Cursor marketplace 기반 검색·설치·인증·sync는 Codex credential로 동작하지 않는다. 확인해야 할 최소 lifecycle은 다음이다.

```text
검색 → 상세 → 설치 → 인증 → tool call → 재시작 유지 → 삭제
```

Codex-only 범위에서 marketplace를 제외한다면 UI·prompt·tool도 숨기고 `NOT_APPLICABLE_BY_PRODUCT_SCOPE`로 분류해야 한다. local plugin을 유지하려면 자체 manifest/loader/permission/persistence가 필요하다.

판정: **`PLUGIN-001 UI_PRESENT / PRODUCT_LIFECYCLE_UNVERIFIED`**.

#### Cloud·Computer·Browser·Notification

- Cursor CloudAgent는 external/unreachable이며 local Task 대체물이 아니다.
- Computer Use tool은 노출될 수 있지만 현재 WSL/profile의 box daemon은 `computerUseSupported:false`이고 execution case가 없어 unsupported다.
- Browser Use driver 코드는 있으나 현재 WSL/profile에서 Host Cursor experiment gate 기본 false라 도달하지 않는다.
- desktop OS notification manager는 코드상 존재하나 실제 delivery E2E가 없다. mobile push는 Cursor backend다.
- Cursor remote-box 추상화를 무작정 삭제하면 local Docker Shell/browser 경로도 함께 깨진다. product-owned Cursor client만 composition gate해야 한다.

판정: **`CLOUD/COMPUTER/BROWSER/NOTIFY = SCOPE_DECISION + REPLACEMENT_OR_HIDE`**.

## 6. 전체 테스트 문서 재계산

### 6.1 1,292 runnable 원장

최신 row 우선으로 산술은 재현된다.

```text
PROVISIONAL_PASS          84
REVIEW_REQUIRED          484
UNREACHABLE_CURRENT_BUILD 656
BLOCKED_EXTERNAL          68
합계                   1,292
```

queue/meta는 `74b146d18e73f48c9d73f507aed1d830e19d4ed4`에 고정돼 있다. `74b146d..f8a8a05`의 direct `sourceRef` 교집합만 계산해도 runnable 85건과 excluded 5건이 영향을 받았다. 이는 composition/provider의 transitive impact를 잡지 못하는 하한이다. Pi PR의 changed-file direct intersection도 8건(`USR 562,563,564,660,871`, `AGT 432,435,436`)이므로, 옛 terminal status를 현재 판정으로 승격할 수 없다.

그러나 “1,292개 모두 case별 terminal observation 완료”는 반증됐다. 아래 durable 수치는 physical row 전체가 아니라 `observationId`가 있는 true CDP row만 센 값이다.

```text
주요 5개 run: observation rows 142 / canonical cases 78 / 미연결 1,214
전체 durable 20260825~26: CDP rows 202 / canonical cases 90 / 미관측 1,202
```

즉 `STRUCTURE_COMPLETE_UNVERIFIED`의 의미는 **분류 구조가 채워졌다**는 것이지, 기능이 실행·검증됐다는 뜻이 아니다.

### 6.2 484 `REVIEW_REQUIRED`의 실제 의미

아래는 basis text에 적용한 감사용 classifier 분해이며 canonical status field가 아니다. 합계는 재현되지만 exact ID별 rule table이 보존되지 않았으므로 해석용으로만 사용한다.

```text
개별 시도 안 함/시간 제한             343
단일 attachment 사례에서 일괄 추론       59
부분 관측                            45
기타 harness/external review          21
fixture 누락                         10
대체 trigger/surface 부재               3
과거 core partial                      3
```

따라서 484는 “확정 버그 484개”도 아니고 “거의 통과 484개”도 아니다. 대부분 실제 수행이 필요한 미검증 case다. attachment에서 파생한 59건은 attachment-only 실패가 있었으므로 공통 PASS 추론이 무효다.

### 6.3 656 `UNREACHABLE_CURRENT_BUILD` 분해

```text
과거 GB-CORE zero-tools blanket        588
fixture/state 누락                      22
기타 surface state unreachable          22
VNC/profile 불일치                      12
surface/implementation 부재              12
```

588건의 blanket blocker는 이후 Host tool wiring으로 **역사적으로 superseded**됐다. 하지만 이는 588 PASS가 아니다. 최신 Pi/profile/build에서 각각 다시 실행해야 한다.

### 6.4 68 `BLOCKED_EXTERNAL`과 208 excluded

- 68 = Cursor-token 2건 + account/OAuth/team/gated 66건
- excluded 208 = `NOT_YET_REVIEWED_FOR_BELMONT`
  - INTERNAL 69, PROVIDER_AUTH 56, NOT_APPLICABLE 22, PROFILE_STATE 22, PLATFORM 17, DOCKER 12, HARDWARE 10

Codex-only scope에서는 이들을 그대로 N/A로 두면 안 된다. `교체 필요`, `제품 범위 제외`, `fixture 필요`, `실제 외부 차단`으로 재분류해야 한다.

### 6.5 이후 438 AGENT sweep

원시 결과 집계는 재현된다.

```text
PASS 87 / BLOCKED 275 / FAIL 50 / NO_VERDICT 11 / REVIEW 15
```

하지만 `/tmp/queue-results*.jsonl`의 model self-report 문자열을 판정으로 사용했고, case별 effect oracle·screenshot·durable repo artifact가 없다. documented FAIL 설명도 50개 중 41개만 다룬다. 따라서 모든 PASS는 provisional이며 resweep은 오염/불완전해 acceptance 자료로 쓸 수 없다.

추적 누락을 막기 위한 당시 exact non-pass set은 다음과 같다. 이 목록은 **현재 결함 판정이 아니라 historical self-report inventory**다.

```text
FAIL 50:
AGT 013,026,030,083,087,089,090,092,093,094,096,097,106,112,115,120,
    152,159,181,182,186,187,239,261,267,268,269,270,280,281,288,301,
    302,304,312,320,321,365,366,367,368,369,370,372,379,386,398,406,
    432,437

REVIEW 15:
AGT 017,018,028,038,039,225,233,250,252,283,317,335,357,375,380

NO_VERDICT 11:
AGT 116,247,248,249,259,260,263,265,319,433,441
```

모든 ID의 전체 형식은 `GBF-AGT-<6자리>-N01`이다. FAIL raw basis는 update_state/memory/self-mod 14, Shell semantics/policy 10, Web transport 6, file/list/read 7, attachment/subagent 2, 당시 Await 2, 기타 9로 묶인다. 문서가 설명하지 않은 정확한 9개는 원문에 ID mapping이 없어 확정할 수 없다. 잔여 집합으로 추정하면 `013,112,120,152,159,281,288,365,367`이지만 이는 `[inference]`이며 current HEAD에서 재실행해야 한다.

### 6.6 823 USER surface sweep

실제 증거는 8개 surface open과 9개 screenshot이다. 이는 **`9-SURFACE_RENDER_SMOKE_PASS`**만 입증하며 823 interaction pass가 아니다.

### 6.7 여전히 열린 harness/incident

- `HARNESS-0002`: hover/onPointerEnter
- `HARNESS-0005`: reload 후 CDP reconnect/hang
- `INCIDENT-0002`: 설명되지 않은 runtime process death
- attachment-only send: current Pi/profile에서 재검증 필요
- Cursor-token image/avatar subfeature: 교체 또는 제품 범위 제외 필요

원장에서 surface/implementation 계열 basis로 묶인 12건은 `USR 188~193, 195~198, 328, 879`이고, Cursor-token blocker 2건은 `USR 061, 457`이다. 전체 형식은 `GBF-USR-<6자리>-N01`이다. 단, 188~198은 194에서 관측한 Agent Network 진입점 부재의 공유 추론이고, 879는 native window border의 CDP harness 한계이므로 12건 모두를 독립 확인된 code-missing으로 읽으면 안 된다.

## 7. 기존 문서의 현재 판정

- `docs/testing/legacy-grok-2026-08-25/**` — immutable input/structure. 현재 Belmont 결과가 아니다.
- `docs/testing/README.md` — queue 준비 문서. GB-CORE blocker 설명은 현재 코드 기준 stale이다.
- `belmont-pilot-remediation-2026-08-26.md` — 당시 full continuous run 전의 정직한 provisional 기록. current status로 사용 불가.
- `STRUCTURE_COMPLETE_UNVERIFIED-2026-08-26.md` — 산술 분류는 재현되나 case-by-case acceptance 주장은 무효.
- `belmont-reconstructed-tools-test-2026-08-27.md` — 시간순 진단 log로만 유효. 438/823 완료 주장은 축소해야 한다.
- `belmont-code-review-2026-08-28.md` — useful input이지만 `eb5890b` 기준이고 remediation 후반이 앞부분과 모순된다. 80/80 표기도 폐기한다.
- 미추적 `BELMONT_FUNCTIONAL_COMPLETION_ROADMAP.md` — Pi 방향은 유효하지만 base가 오래됐고 “Cursor compatibility 유지”는 최신 Codex-only 목표와 충돌한다.

## 8. 79개 커밋 재검토 원장

아래 판정은 그 커밋의 좁은 효과와 현재 HEAD에서의 최종 도달점을 함께 본 것이다. `VALID`는 그 커밋 하나가 제품 기능 전체를 검증했다는 뜻이 아니다.

### 8.1 원본·WSL·Codex·초기 subagent (35개)

```text
a9f633e PARTIAL — installer 보존은 유효, 초기 기능 완료 주장은 과장
e7bb9eb PARTIAL — checksum bootstrap 유효, fresh network E2E 없음
bf70f46 PARTIAL — 초기 WSL tree 불완전, 후속 superseded
9dcdc57 PARTIAL — full staging 추가, activation은 후속 필요
f6d96d3 STUB/PARTIAL — synthetic account와 split source of truth 잔존
025411d VALID_DESIGN — clean composition/fallback guard, current build E2E 없음
3a018c6 PARTIAL — launcher ownership 유효, provider mismatch/shutdown gap
ed36511 PARTIAL — auth validator 유효, Pi 전환 시 manual credential 소유권 대체
ad406ab PARTIAL — bounded CDP observer, lineage/action 한계
74b146d INPUT_ONLY — immutable legacy corpus, 제품 증거 아님
18175fd STALE_INPUT — 1,292 mapping은 당시 구조상 유효, 현재 stale
795fe27 PARTIAL — lineage 강화, artifact/harness sealing 불완전
8468b2f PARTIAL — byte normalization 유효, 실제 staging root cause는 후속
9a8765e PARTIAL — source identity check, artifact/harness exact binding 아님
0371c49 SUPERSEDED — base64 IPC 우회, 후속 제거
9ecc7d3 VALID_FIX — randomUUID import로 실제 staging 오류 수정
f17b324 STAGING_VALID/E2E_PARTIAL — native IPC 복귀, inference 소비 미검증
932231b HISTORICAL_STALE — 당시 provisional 문서, current status 아님
a3e84aa PARTIAL — modifiers/F-keys 개선, press validation/hover 결함
a84059d PARTIAL — resize drag 관측, reorder/error release 미검증
d53a766 PARTIAL — Belmont tool delegation 유효, custom transport lifecycle 미완성
afe4961 VALID_FIX — tool schema unwrap은 Pi migration에서도 보존 필요
e9b655c VALID_DIRECTION/REGRESSION_REPAIRED — Host routing 유효, transcript regression은 후속 수정
7136c01 REGRESSION — user re-enable가 restart에서 덮임
742ab36 REGRESSION — legacy merge가 pagination/ID/reaction을 손상, 다음 commit 제거
2fd21ca REPAIR/PARTIAL — bad merge 제거, local auto-review는 후속 강제 off와 모순
0c9c2a6 PARTIAL — gate만 활성화, subagent engine 아님
bd57d7d PARTIAL — executor config 노출, lifecycle 미완성
d56c843 INERT — runStep binding이 실사용 효과 없음
3d0fe9c REGRESSION/SUPERSEDED — codex exec가 Belmont authority 우회
457cf84 PARTIAL — Belmont engine 복귀, isolated-state 주장은 거짓
341a942 PARTIAL — boundary prompt는 enforcement 아님
0abec7f PARTIAL — structured call 개선, current transport가 reasoning/file drop
d956258 PARTIAL — background handle 유효, timeout/output/restart gap
efa1064 REGRESSION_AT_COMMIT — workspace goal 유효, symlink escape는 후속 수정
```

### 8.2 도구·UI·MCP·hooks·최신 lifecycle (44개)

```text
fb246ac PARTIAL — list_dir 연결, partial/error 표기 결함
b251c81 MIXED — delete happy path 유효, grep fidelity 결함
bc2d5d4 PARTIAL — exact edit 유효, whitespace diagnostics 불완전
b54581c PARTIAL — glob 도달, cwd/canonical boundary 결함
295745d SOURCE_PASS/RUNTIME_UNVERIFIED — editable thread UI, pinned renderer E2E 없음
fbe3750 VALID_FIX — glob cwd 수정
2734e28 VALID_WITH_GAP — edit error/fallback 개선, 진단 fidelity 잔여
742d405 PARTIAL_VALID — write/delete OS errors 개선, ls ignore 축약
0cc24c7 HISTORICAL_FIX/WEAKENED — symlink carve-out 수정, broad fail-open 잔여
b47c222 PARTIAL_VALID — glob/list ignore 개선, 원본 계약 전체 아님
5be261e TEMP_WORKAROUND/PI_SUPERSEDED — fabricated model 제거, 정적 fallback 잔존
86d6d00 DOC_STALE_OVERCLAIM — 구조 smoke를 기능 완료로 확대
a0a7afd PARTIAL — write create/overwrite, atomicity/test gap
07310b9 PARTIAL_VALID — grep truncation 표시, backend fidelity 잔여
42fc909 DEFECTIVE — global cap 이후 per-file count 불완전
a33d462 VALID_FIX — grep offset/single-file 수정
9b9c8cb PROVISIONAL — terminal metadata 연결, behavior E2E 없음
b2b63ce MIXED_REFUTED — canvas infra 판정 가능, readonly는 구현 누락
d20f29f NARROW_VALID — foreground child result binding
73be6f0 DOC_OVERCLAIM — result binding을 lifecycle 전체 해결로 확대
68622fe PARTIAL — 세 증상 수정, ledger cases 전체 acceptance 아님
2f7d8ad COUNTS_VALID/ACCEPTANCE_INVALID — 집계 재현, self-report oracle
4386daa REFUTED — 코드 결함 3개뿐이라는 결론 반증
3e20f1f RENDER_SMOKE_ONLY — 9 screenshots ≠ 823 cases
a9a3e27 PARTIAL — WebSearch pre-hook happy path
21d4614 DOC_OVERCLAIM — 단일 hook을 전체 hook 해결로 확대
89830c4 PROVISIONAL_PARTIAL — local stdio echo/add, lifecycle 미완성
c148f1e DOC_OVERCLAIM — basic stdio를 MCP 전체 resolved로 확대
eb5890b CODE_PRESENT/ACCEPTANCE_UNTESTED — contract 수정, lifecycle E2E 없음
23f1b09 PARTIAL — 여러 개선 유효, fs/hook/MCP gaps 잔존
4c6926d PARTIAL_CLAIM_REFUTED — unary gate, stream/background/MCP 미포괄
09ae1a0 STRUCTURAL_TEST_ONLY — hook 2 + MCP client 4 cases 중심
a4c0c56 DOC_CORRECTION_REQUIRED — incomplete 결론 유효, 80/80/closed 주장은 오류
4bd6c89 PARTIAL_VALID — configuredSteps 연결, reasoning projection 미도달
f211d91 PARTIAL_VALID — foreground dispose만, background leak 잔존
b43517c DOC_SUPERSEDED — 후속 상태 미반영
9b547a8 PARTIAL/BROKEN — marker 실행, deny/follow-up 의미 버림
5928d83 DOC_STALE_CONTRADICTORY — done/open 문장이 충돌
5f50778 VALID_LOGIC/E2E_UNVERIFIED — transcript ownership 수정, crash test 없음
a169fd8 PARTIAL_VALID — tool hard-gate, child isolation 아님
6525a34 WORKAROUND/PROFILE_REQUIRED — Shell 차단 회피, UI/effective mismatch
976ae28 VALID — unreachable coordinator dead path 제거
2f718e8 SUPERSEDED_REVERT — provenance revert, runtime 가치 없음
f8a8a05 VALID_CLEANUP/E2E_UNVERIFIED — dead loop 제거, gateway E2E 없음
```

## 9. 권장 구현 순서와 완료 게이트

### Phase 0 — 기준 고정

- 최신 `f8a8a05` 위에서 Pi branch를 새로 만든다.
- 현재 MCP/hooks/transcript fixes를 보존하고 4개 merge conflict를 수동 의미 병합한다.
- untracked recovery 초안은 production import와 dedicated review 전까지 구현으로 계산하지 않는다.

### Phase 1 — Codex-only profile·auth

- 단일 `codex-oauth-only` profile resolver
- Pi credential = Host/Electron account/readiness의 단일 source of truth
- provider default/allowlist/model migration
- Cursor factory construction/egress를 profile에서 차단하되 local Docker/MCP OAuth 같은 공용 추상화는 보존
- login→refresh→logout 및 Cursor egress 0 negative test

### Phase 2 — Pi adapter parity

- packaged module 존재 검사
- real Belmont system/content/event fixture contract tests
- text, tool call/result order, image, tool-result image, reasoning/signature, authoritative final correction
- executor state array contract와 bot/session model metadata 분리
- direct transport parity 통과 전 기존 transport 삭제 금지

### Phase 3 — Belmont lifecycle

- active network + local tool/process interrupt
- compact/checkpoint/crash/restart/resume
- child-owned session/store/cancel/checkpoint/model/dispose
- hook deny/ask/follow-up/post/failure semantics
- MCP in-flight cancel/pagination/notifications/cwd/fidelity/restart
- attachment commit cleanup과 inference E2E

### Phase 4 — 기능 교체·범위 결정

- WebSearch native live proof 또는 독립 backend
- local WebFetch
- PDF/image/video/audio 처리
- local plugin lifecycle 또는 marketplace surface 제거
- Browser/Computer/Cloud/mobile notifications를 구현·교체하거나 UI/prompt/tool에서 제거

### Phase 5 — 제품 acceptance

다음 한 흐름을 clean profile과 packaged WSL runtime에서 통과해야 한다.

```text
login
→ model 선택 및 bot별 유지
→ streamed response
→ Shell/file/MCP tool loop
→ image/PDF attachment
→ active interrupt
→ compact/checkpoint
→ app/Host restart
→ transcript/subagent resume
→ logout/relogin
```

동시에 다음이 필요하다.

- product-owned Cursor/Anysphere DNS·HTTP 0건
- P0/P1 dedicated regression
- 재기준화한 1,292 + 208 scope queue
- case별 user action, expected effect, actual effect, durable artifact
- 최종 positive claim에 대한 독립 refute-by-default 재검증

## 10. 현재 판정과 판정을 바꿀 증거

### 실제 검증됨

- 79개 commit graph와 각 변경의 current endpoint 추적
- clean HEAD와 Pi PR의 구조 테스트/build/publication 결과
- 1,292/208/438 산술 및 observation coverage 재계산
- 현재 direct Codex split-brain, Cursor-backed 기능, Belmont-owned partial gaps
- Pi PR packaged import/state/schema blockers와 model/system-prompt integration gaps

### 아직 미검증

- 실제 ChatGPT OAuth entitlement와 token refresh
- 실제 Pi Codex streaming/tool/attachment/reasoning traffic
- 실제 Cursor egress 0
- packaged renderer에서 Codex-only account/model UI
- 최종 full Electron/WSL case-by-case acceptance

### 판정을 바꿀 조건

최신 HEAD 기반의 격리된 Codex-only build에서 네트워크 캡처와 durable artifacts를 남기며 Phase 5 흐름을 통과하고, Cursor egress가 0이며, Pi/Belmont schema·state·package 전용 회귀가 모두 통과하면 `PI_OVERLAY_REJECTED_AS_IS`를 새 구현에 한해 `LIVE_CANDIDATE`로 승격할 수 있다. 그 전에는 **기능 완성 또는 원본 parity를 주장하지 않는다.**

## 11. 독립 적대 검토 결과

별도 `adversarial-verifier`가 최신 문서를 틀렸다고 가정하고 원시 commit graph, queue/observation JSONL, Pi PR source와 esbuild 동작을 다시 검사했다.

### 확인됨

- 원본 뒤 78개 / 원본 포함 79개 commit 수
- committed 76 tests + untracked 5 tests의 경계
- 1,292/208/438/823 산술과 90 canonical observed cases
- Pi variable dynamic import package blocker
- Pi `getState()` object 대 Belmont array consumer 계약 파괴
- Belmont/Pi image/reasoning/tool-result/event schema 불일치
- `5993ec5 REJECTED_AS_IS`: package/state/schema 세 항목만으로 병합 거부에 충분

### 반증되어 본문을 수정한 항목

- “원본 이후 79개” → 원본 뒤 78개, inclusive 79개
- “없는 기본 모델 때문에 normal turn 즉시 실패” → actual Pi session은 `gpt-5.4`; 정적 표시/metadata와 actual model의 split-brain
- “Pi system prompt 없음” → 짧은 router system prompt는 존재; Belmont full dynamic system message가 assistant history로 강등

### 독립 승격 불가

- main context에서 관측한 76/76, build/publication tree hash는 durable log가 없어 독립 실행 판정 `INCONCLUSIVE`
- Pi 채택 방향은 합리적인 `[inference]`지만 아직 product result가 아님
- live OAuth/refresh/stream/tool/attachment/interrupt/restart와 Cursor egress 0은 미검증
- 79개 commit qualitative label 전부의 exhaustiveness는 최종 product E2E 없이 독립 확정 불가

독립 최종 판정은 **`PARTIAL`**이다. 현재 PR 병합 거부는 확인됐고, Pi 선택과 기능 완성은 corrected implementation의 durable E2E 전까지 provisional이다.

## 12. 재현 명령과 원시 근거

```bash
# 기준 SHA와 전체 commit 수
git rev-parse HEAD
git rev-list --count a9f633e^..f8a8a05
git log --reverse --oneline a9f633e^..f8a8a05

# clean/current 구조 검증
npm run check
npm run frontend:build
npm run publication:check

# 원장 크기와 durable observation inventory
wc -l docs/testing/belmont-wsl-test-queue.jsonl \
  docs/testing/belmont-wsl-test-mapping.jsonl \
  docs/testing/belmont-wsl-test-excluded-review.jsonl
find data/artifacts/belmont-user-e2e-20260825 \
  data/artifacts/belmont-user-e2e-20260826 \
  -type f -name observations.jsonl -print

# 현재 status 문서와 방법 계약
sed -n '1,220p' \
  data/artifacts/belmont-user-e2e-20260825/STRUCTURE_COMPLETE_UNVERIFIED-2026-08-26.md
sed -n '1,220p' docs/belmont-user-test-method-2026-08-25.md
```

핵심 근거 위치:

- 현재 원장: `docs/testing/belmont-wsl-test-{queue,mapping,excluded-review}.jsonl`
- 구조 분류: `data/artifacts/belmont-user-e2e-20260825/STRUCTURE_COMPLETE_UNVERIFIED-2026-08-26.md`
- 이후 진단: `docs/testing/belmont-reconstructed-tools-test-2026-08-27.md`
- 이전 review: `docs/testing/belmont-code-review-2026-08-28.md`
- 438 raw: `/tmp/queue-results.jsonl`, `/tmp/queue-results-rest.jsonl` — ephemeral, 저장소 외부
- 823 raw: `/tmp/ui-sweep-result.json`, `/tmp/ui-evidence/*.png` — ephemeral, 저장소 외부

이 문서 작성으로 변경한 것은 이 보고서 파일 하나뿐이다. source/runtime, DB, 실행 중 프로세스, 기존 미추적 복원 초안은 변경하지 않았다.
