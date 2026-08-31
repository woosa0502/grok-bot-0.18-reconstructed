# Belmont `c466160` Strict Code Review — 2026-08-31

## 1. Status

- Review status: `VERIFIED_CODE_REVIEW / RUNTIME_PARTIAL`
- Product verdict: `MATERIAL_IMPROVEMENT_CONFIRMED / FULL_0.18_PARITY_REFUTED`
- Reviewed Belmont commit: `c466160fc21990ca3016211a703dfadccc25e2aa`
- Original Grok Bot 0.18 baseline: `a9f633e09d49a85829b8236331b9e21f7e612634`
- Relationship: original baseline is the merge base; Belmont is 109 commits ahead and 0 commits behind
- Whole-tree delta: 246 files, approximately `+26,843 / -947`
- Verification: primary code-path review plus a separate refute-by-default adversarial review
- Mutation boundary: documentation only; no production source edit, runtime restart, DB/profile mutation, or live UI operation

The reviewed commit contains substantial working additions. It is not a stub-only reconstruction. Pi Codex inference, local tools, persistent-agent CRUD, foreground Task result return, memory recall, local cron, PDF Read, and local stdio MCP all have real implementation paths.

However, the build does not yet satisfy full Grok Bot 0.18 functional parity. The strongest blockers are fresh Pi login bootstrap, split credential paths, parent-owned child settlement, incomplete plugin/catalog wiring, non-durable agent messaging and cron, and WSL tool/isolation gaps.

The future goal in which one manager bot plans work, delegates it, reviews evidence, retries failures, and publishes only approved results is a separate Phase B. It is not an original 0.18 parity requirement and is not implemented by the current multi-bot primitives alone.

## 2. Evidence and Review Boundary

### 2.1 Evidence notation

Unless a live observation is explicitly named, source references in this report mean the committed blob:

```text
c466160:<repository-relative-path>:<line>
```

This is important because the working tree contained changes owned by another session. The review used `git show`, `git diff`, and clean detached-snapshot verification so those changes did not enter the verdict.

### 2.2 Excluded working-tree state

At review time, another session had uncommitted changes in test ledgers, host composition, shell/MCP code, attachment handling, notification code, WebFetch, and tests. The untracked user document below was also excluded and left untouched:

```text
docs/testing/belmont-grokbot-parity-first-scope-2026-08-30.md
```

### 2.3 Live runtime boundary

The WSL host, box daemon, Electron process, renderer, MCP test server, and local-exec daemon were running during the documentation pass. They were treated as `DO NOT TOUCH`. No process was stopped, restarted, attached to, or reconfigured for this document.

### 2.4 Provenance labels

- `direct_observation`: observed in committed source, raw command output, or an isolated live run
- `raw_recompute`: independently reproduced from primitives without importing the target assertion
- `inference`: conclusion derived from multiple observations; assumptions are stated
- `runtime_unverified`: code path exists, but the relevant product-level live flow was not executed

## 3. Executive Verdict

### 3.1 What is confirmed

The following are real improvements over the original baseline.

- Pi `openai-codex` inference path and credential store
- Live Pi model turn when the credential is already in the runtime-visible location
- Local Shell and core file-tool composition
- WebSearch and WebFetch local substitutes
- PDF text extraction connected to both Read paths
- Persistent-agent create/list/update paths and per-agent storage
- Temporary Task child ID, foreground result return, targeted cancellation, and runner disposal
- Memory persistence, explicit memory mutation, recall, and prompt injection
- Basic in-process local cron execution
- Local stdio MCP initialize/list/call round trip
- Preservation of the checksum-pinned original renderer, including the original thread/reply UI

### 3.2 What is refuted

The following claims are not supported by the current implementation.

- A fresh user can complete in-app Pi login without prior credential preparation
- The advertised CLI login and default WSL start command use one credential location
- A temporary subagent owns its complete durable transcript/checkpoint/blob/store state
- Persistent-agent messaging is a durable, retryable task handoff
- Local cron is crash-durable or idempotent
- Local plugin parity includes agent-facing catalog operations and custom skills
- WSL provides one independent Computer desktop per bot
- The 143 passing regression tests prove complete 0.18 product parity
- A specially designated central manager bot already exists

## 4. Architecture Reality

The current product is best described as:

```text
WSL/Electron multi-agent desktop
  ├─ persistent local agents with profile, DB, transcript, memory, and attachments
  ├─ direct file/shell/web/PDF/MCP tools
  ├─ temporary Task child runners
  ├─ Pi Codex inference extension
  └─ original checksum-pinned Grok Bot renderer
```

It is not yet:

```text
single manager bot
  → durable goal/job/attempt ledger
  → worker progress and cancellation
  → result and evidence binding
  → review, rejection, retry, reassignment
  → approved-only publication
```

## 5. P0 Findings

### P0-01 — Fresh in-app Pi login has a circular bootstrap dependency

**Provenance:** `direct_observation`, independently confirmed.

Flow:

```text
Pi credential absent
→ account status = logged-out
→ coordinator slot is not launched
→ Sign in calls startProviderLogin through coordinator legs
→ coordinator legs reject because no coordinator is running
```

Evidence:

- `source/electron-main/adapters/account-oauth.ts:46-50` — no credential produces `logged-out`
- `source/electron-main/adapters/account-oauth.ts:77-98` — Sign in depends on coordinator legs
- `source/electron-main/coordinator/coordinator-account-runtime.ts:96-100,327-333` — logged-out has no coordinator slot
- `source/electron-main/coordinator/coordinator-main-legs.ts:4-8` — missing session rejects the call
- `source/electron-main/main-production-services.ts:801-804` — startup passes the current account status into coordinator lifecycle

An isolated fresh-login run failed with:

```text
Sand coordinator main-data leg "startProviderLogin" has no live coordinator session
(coordinator not launched)
```

An already configured credential did permit a real Pi turn and a real Shell tool call. The defect is specifically the first-login bootstrap, not every Pi invocation.

**False-green:** `tests/pi-codex-login.test.mjs` injects already-working fake coordinator legs and therefore bypasses the real logged-out lifecycle.

**Required correction:** move initial Pi login ownership outside the logged-in coordinator lifecycle or make a minimal unauthenticated login host available before account activation.

**Acceptance:** a fresh isolated profile completes Sign in, shows the device/user code, stores the credential, updates account status, executes one model turn, and survives restart without copying an existing credential.

### P0-02 — CLI login and WSL runtime use different default credential paths

**Provenance:** `direct_observation`.

Current defaults:

```text
npm run codex:auth:login
→ ~/.grokbot/pi-auth.json

npm run wsl:start
→ <repo>/.cache/belmont-wsl-profile/sand-data/pi-auth.json
```

Evidence:

- `scripts/pi-codex-auth.mjs:13-16`
- `scripts/run-wsl.mjs:26-32`
- `source/host/extensions/inference/pi-codex-runtime.ts:63-65`
- `package.json:30-32`

The desktop status path may see `~/.grokbot/pi-auth.json` while the host inference runtime reads the profile data root. This can produce a misleading “logged in” UI with unusable inference. Migration from `~/.codex/auth.json` can accidentally conceal the defect on an existing machine.

**Required correction:** define one authoritative credential path per profile and pass it explicitly to CLI, Electron, host, status, login, logout, refresh, and migration paths.

**Acceptance:** the documented default login command followed by the documented default start command works on a machine with no prior Codex or Belmont credentials.

### P0-03 — Temporary child identity is separate, but durable settlement remains parent-owned

**Provenance:** `direct_observation`; concrete data corruption remains `runtime_unverified`.

Correctly separated:

- child conversation and transcript IDs
- fresh initial in-memory state
- per-child runner/cancel mapping
- foreground result projection back to the Task call

Still parent-bound:

- settlement transcript ID
- checkpoint/blob operations
- `AgentStore`
- memory and snapshots
- episode progress
- automation/workflow/channel/MCP owner

Evidence:

- `source/host/host-runner-composition.ts:2481-2516` — settle host captures parent runner, store, and `session.id`
- `source/host/host-runner-composition.ts:2807-2823` — genuine child ID and initial state
- `source/host/host-runner-composition.ts:2842-2863` — result binding
- `source/host/host-runner-composition.ts:3006-3022` — child receives parent-owned durable services
- `source/host/runner/turn-settle.ts:231-289` — persistence uses those host-provided owners

After process restart, a pending child wake is not resumed. The parent receives a replacement error stating that the in-process subagent was interrupted and its final state is unknown:

- `source/host/extensions/transcript/pending-wake-rearm.ts:233-262`

**Impact:** parent/child checkpoint divergence, misleading transcript paths, race risk across concurrent children, and no genuine resumable child lifecycle.

**Required correction:** give every child a durable child-owned store/transcript/checkpoint/blob namespace and bind result, cancel, recovery, and cleanup to that identity.

**Acceptance:** run two children concurrently, cancel only one, restart during the other, and prove that their transcript, checkpoint, blob, result, and parent Task binding never cross.

### P0-04 — Grep does not enforce the same canonical workspace boundary as other tools

**Provenance:** `direct_observation` plus `raw_recompute`.

`BoxRuntime.resolvePath()` performs lexical containment. Grep then invokes `rg` on that path without the canonical ancestor guard used by LS/Delete/Write.

Evidence:

- `source/box-exec-daemon/server.ts:455-475`
- `source/box-exec-daemon/server.ts:1031-1051`

A read-only recomputation through an existing workspace symlink targeting `/etc/hosts` returned matches from the external file. This established the underlying path behavior without changing the workspace or daemon.

**Required correction:** route Read, Grep, Glob, LS, Delete, Edit, Write, and Shell path operands through one canonical fail-closed policy, including symlinked ancestors.

**Acceptance:** direct paths, final-component symlinks, ancestor symlinks, broken symlinks, path replacement races, and IPv4/IPv6-like filename edge cases have explicit allow/deny tests against the real daemon.

### P0-05 — WSL Computer is not a default, per-agent capability

**Provenance:** `direct_observation`; cross-agent screen contamination is an `inference` until a concurrent live test is run.

- Local Computer requires `SAND_LOCAL_COMPUTER_USE=1`.
- The default WSL launcher does not set the flag.
- Setup does not establish all required Xvfb/xdotool/VNC/window-manager dependencies.
- When enabled, the implementation uses one module-global manager and fixed display `:99`.
- The system prompt nevertheless states that each agent owns a separate screen.

Evidence:

- `source/host/box/local-computer-use.ts:15`
- `scripts/lib/wsl-runtime.mjs:28-36`
- `source/host/box/production.ts:84-117,219-225`
- `source/host/runner/system-prompt.ts:167-175`

**Required correction:** either advertise a shared single desktop honestly or allocate a display/window/session owner per agent. Setup and readiness must check the required binaries rather than exposing an unusable tool.

## 6. P1 Findings

### P1-01 — Automatic long-term memory learning is not connected to production turn settlement

**Provenance:** `direct_observation`.

Working parts:

- persistent per-agent and shared memory stores
- explicit `update_state` mutation
- memory recall and prompt injection

Missing part:

- production turn settlement does not provide the callbacks needed for automatic memorable-exchange extraction
- `setMemoryStore()` stores a private field that is not consumed by the active settle path
- a frozen prompt snapshot can remain stale until compaction or a new runner lifecycle

Evidence:

- `source/host/host-runner-composition.ts:1501-1505,2971-2979`
- `source/host/runner/system-prompt-assembly.ts:158-196`
- `source/host/runner/turn-run-shell.ts:635-649`
- `source/host/runner/sand-agent-runner.ts:671-693`

Shared user/project memory is also broadly available to agents and temporary children. There is no manager-owned projection that sends a worker only the minimum relevant subset.

**Acceptance:** state a durable preference in normal conversation, restart, open a new conversation, prove recall changed behavior, correct the preference, and prove workers receive only the task-relevant projection.

### P1-02 — Context compaction and cache metrics exist, but stable conversation cache affinity does not

**Provenance:** `direct_observation`.

The product, like the original, resends the active conversation history on each model turn. It does not resend unlimited lifetime history forever: compaction eventually replaces older turns with a summary and recent tail.

Evidence:

- `source/host/extensions/inference/provider-session.ts:300-347`
- `source/host/extensions/inference/pi-codex-projection.ts:247-267`
- `source/host/runner/context-window.ts:1-27`

Pi usage records cache read/write token counts. However, the Pi request receives an invocation ID as `sessionId`, and the provider creates a new invocation UUID for each call. The Pi runtime maps that identity to prompt-cache affinity, so the current implementation does not provide a stable conversation-level cache key.

Evidence:

- `source/host/extensions/inference/pi-codex-runtime.ts:85-90,151-160,176-190`
- `source/host/extensions/inference/provider-session.ts:335-343`

This does not prove zero cache hits; provider-side opportunistic prefix caching can still occur. It does mean the product is not deliberately preserving stable per-conversation cache affinity.

The context limit also uses nominal model metadata unless manually pinned or capped. If the backend-effective limit is smaller, compaction can occur too late.

**Acceptance:** record prompt/cache keys and token accounting across repeated turns, compaction, restart, and branch changes; verify stable cache affinity where intended and trigger compaction before the actual backend limit.

### P1-03 — Persistent-agent messaging is fire-and-forget, not durable task orchestration

**Provenance:** `direct_observation`.

- inbound messages are held in an in-memory `Map`
- sender transcript is committed before enqueue
- queue entries are removed before target wake completes
- target-open or process failure has no durable replay record
- no message attempt ID or duplicate fence exists

Evidence:

- `source/host/extensions/transcript/agent-to-agent-messaging.ts:47-50,93-119,149-163,217-272`
- `source/host/runner/tools/sand-agent-management-tools.ts:96`

The file is unchanged from the original baseline. This is an inherited limitation, not a new c466160 regression.

### P1-04 — Background Task completion can be dropped before parent revival

**Provenance:** `direct_observation`.

- completion queue is an in-memory `Map`
- queued completions and wake marker are cleared before parent revival
- parent session/runner absence or revival failure does not restore them

Evidence:

- `source/host/extensions/transcript/completion-revivals.ts:91-95,130-156`

The child completion has a Task tool-call identity internally, but the revival contract does not provide a durable attempt/result ledger.

### P1-05 — Local cron is useful but not crash-durable or idempotent

**Provenance:** `direct_observation`.

- anchors and in-flight state are process memory
- the anchor advances before dispatch
- dispatch failure is logged but does not restore the slot
- restart can lose anchors
- historical slots can replay one per scheduler tick
- actual start time rather than scheduled due time can introduce interval drift

Evidence:

- `source/host/extensions/automations/local-cron-scheduler.ts:53-78,121-136`

Basic successful cron firing is real. Exactly-once execution, crash recovery, and local/cloud ownership are not established.

### P1-06 — Local plugin/MCP parity loses the agent-facing catalog and custom skills

**Provenance:** `direct_observation`.

The desktop local-plugin path can pass a catalog and persist local stdio MCP installs. The host builds a local catalog, but `CreateHostMcpOptions` has no catalog field and `createHostMcp()` does not pass it into `SandMcpManager`.

Evidence:

- `source/host/extensions/mcp/mcp-service.ts:53-70,97-110,244-255`
- `source/shared/node/mcp/mcp-manager.ts:97-105`

Custom local plugin normalization also hardcodes `skills: []`:

- `source/shared/node/mcp/local-mcp-store.ts:166-194`

Therefore a desktop install can appear successful while agent-facing SearchPlugins/GetPlugin/InstallPlugin cannot use the same local catalog. The currently working subset is local stdio MCP, not full original plugin/skill parity.

Additional protocol gaps include tools/list pagination, server requests and notifications, list-changed events, server-side cancellation, stderr draining, shutdown escalation, and full audio/resource content preservation.

### P1-07 — Shell cwd/env state is daemon-global rather than agent-owned

**Provenance:** `direct_observation`; exact concurrent corruption is `runtime_unverified`.

The newly persistent cwd/env state and terminal registry are global to the local daemon. Multiple bots can update the same state. A background child that exits late can overwrite newer cwd/env state, and abort can clear shared state.

Additional gaps:

- hard timeout is transported but not fully enforced
- no reliable SIGTERM-to-SIGKILL escalation
- terminal IDs can be reused after daemon restart
- a host crash can leave the local-exec daemon orphaned

An isolated run previously observed an orphaned local-exec daemon after interruption. The current test is sequential and does not exercise two agents, abort, background completion, or daemon restart.

### P1-08 — File tools have additional correctness gaps

**Provenance:** `direct_observation`.

- Grep context is handled as independent events, so offset/head-limit can retain context for discarded matches or omit trailing context.
- Delete reads the complete file before slicing the preview, creating large-file and FIFO risks.
- Atomic Write via temp+rename can change mode, owner, ACL, or xattrs.
- Edit has no compare-and-swap protection against concurrent changes.
- Whitespace fallback can modify an unintended occurrence.
- LS stops at depth/entry limits without a complete truncation contract.
- Glob inherits Shell/path-boundary behavior.

The core tools are genuinely wired. These are fidelity and concurrency defects, not evidence that the tools are absent.

### P1-09 — WebSearch/WebFetch are local substitutes with correctness gaps

**Provenance:** `direct_observation`.

WebSearch parses DuckDuckGo HTML. It collects titles and snippets separately, then joins them by array index. A missing middle snippet can attach a later source description to the wrong title/URL.

- `source/host/extensions/inference/codex-web-tools.ts:156-181`

WebFetch:

- treats every non-HTML content type as UTF-8 text, including binary/PDF responses
- follows redirects after checking only the initial URL
- does not re-check each resolved address/redirect hop
- converts HTML to plain text with regex rather than preserving link structure
- does not fully propagate caller cancellation

Evidence:

- `source/host/extensions/inference/codex-web-tools.ts:60,113`
- `source/packages/agent/tools/core/web-fetch.ts:64-72`

### P1-10 — PDF Read is wired but cache and process lifecycle are incomplete

**Provenance:** `direct_observation`.

PDF extraction is connected to both Read paths. The cache is process-global and keyed only by path. Replacing a PDF at the same path can return stale text indefinitely; there is no mtime/content-hash invalidation or eviction.

Evidence:

- `source/packages/agent/tools/core/read/read.ts:130,370`
- `source/host/host-runner-composition.ts:2204-2231`

The extractor has no complete timeout/AbortSignal/kill path, buffers complete stdout/stderr, and lets the pdfjs fallback process every page without a hard output/page cap. Scanned PDFs have no OCR path.

- `source/host/runner/local-pdf-text-extractor.ts:14,44-69`

### P1-11 — Attachment staging cleanup remains partial and multi-file commit is non-atomic

**Provenance:** `direct_observation`.

Successful `commitStaged()` uploads do not immediately delete staged files. Startup only sweeps files older than one hour. During long-running sessions, successful uploads accumulate. A later failure in a multi-file sequence can leave earlier uploads committed without rollback or durable idempotency.

Evidence:

- `source/electron-main/attachments/attachments.ts:5-20,89-92,122-126`

### P1-12 — Pi model catalog and existing profile migration are not production-complete

**Provenance:** `direct_observation`.

- global provider default remains Cursor
- new WSL profiles seed Codex, but an existing Cursor provider is preserved
- existing Cursor model IDs can remain selected and fail against the Pi catalog
- desktop available-model requests still use the Cursor catalog backend
- the Pi catalog/reconciliation module is not imported by the real model-list path
- local account mode rejects the Cursor token needed by the inherited catalog, avatar, and some MCP OAuth paths

Evidence:

- `source/shared/node/settings/sand-settings-store.ts:167-168`
- `scripts/lib/wsl-runtime.mjs:79-85`
- `source/electron-main/main-production-services.ts:721-727`
- `source/electron-main/models/cursor-model-catalog.ts:1-16`
- `source/host/extensions/inference/pi-codex-runtime.ts:94-102,138-141`
- `frontend/src/recovered/runtime/model-catalog-reconciliation.ts:193-220`

There is no automatic Codex-to-Cursor fallback in the Pi provider session, which is a positive property for a Codex-only WSL path. The remaining issue is that Cursor remains selectable/default in other composition paths and inherited Cursor-only features remain exposed.

## 7. P2, Dormant, and Release-Only Gaps

### P2-01 — Video analysis is dormant

`watchVideo` and `videoReview` configuration carriers exist but are intentionally not wired into live turn composition. The system prompt correctly says they are unavailable.

- `source/host/runner/recovered-video-subagent-configs.ts:4-12`
- `source/host/runner/system-prompt.ts:172`

### P2-02 — GenerateImage is unavailable in local Codex mode

The remaining generator requires the Cursor image backend and Cursor access token. Image input and tool-result screenshots are separate and are wired into Pi projection, but live vision E2E remains unverified.

### P2-03 — BrowserUse is not a normal WSL-local capability

BrowserUse and Computer are distinct. Computer has an optional local path; inherited browser/cloud paths remain Cursor/backend-dependent or dormant.

### RELEASE-01 — A relocated packaged app may not contain the Pi dependency closure

**Provenance:** source path is `direct_observation`; clean-machine failure remains `inference`.

The clean host keeps Pi packages external, root `node_modules` provides them in a source checkout, and `src/app/package.json` does not declare the complete Pi runtime closure. WSL works from inside the repository, but a relocated `.app` has no proven dependency closure.

This is a release blocker for a standalone package, not a P0 for personal WSL source-checkout use.

### RELEASE-02 — Package and verifier disagree about patched renderer provenance

The default package flow mutates selected original renderer chunks with the Router patch. One verifier expects the original inventory without accounting for that extension, while the extension-aware verifier is not the default package verifier. This creates a provenance/verification conflict even if the packaged UI works.

### UI-01 — Editable frontend is not the WSL UI authority

The WSL setup copies the checksum-pinned original renderer. `frontend/` is an editable reconstruction but is not the normal WSL renderer. Consequently:

- `frontend:build` success does not prove WSL UI behavior
- changes to `frontend/src/production/ProductionRenderer.tsx` do not automatically appear in WSL
- thread/reply is already present in the original WSL renderer
- every UI claim must identify its authority: original renderer, narrow minified patch, or editable frontend

## 8. Test Assessment

### 8.1 Verified regression gate

A separate clean snapshot of `c466160` ran the repository-defined check successfully:

```text
npm run check
→ frontend typecheck passed
→ source typecheck passed
→ node:test: 143 passed, 0 failed, 0 skipped
```

This proves the committed source satisfies the current regression suite. It does not prove complete product parity.

### 8.2 False-green classes

#### Pi login

The test injects already-live coordinator legs and never exercises the real fresh logged-out startup cycle.

#### Plugin and production wiring

Several tests assert source strings or regular-expression anchors instead of invoking the production composition. They do not detect the catalog being dropped between `mcp-service` and `SandMcpManager`.

#### Cron

Tests cover due-time calculation and successful in-process execution. They do not cover dispatch failure, process death, restart, replay, duplicate prevention, or local/cloud double ownership.

#### Shell state

Tests are sequential and do not run two persistent bots, background completion, abort, daemon restart, or late state overwrite.

#### Memory

Tests cover stores and initial recall, not automatic production extraction or mutation after a frozen prompt snapshot.

#### PDF and attachments

Tests use a small PDF and staging sweep. They do not cover same-path replacement, timeout, huge/scanned PDFs, commit success cleanup, partial upload failure, or retry duplication.

#### Subagent ownership

There is no product-level test that proves child-owned checkpoint/transcript/blob/store state across two children, cancellation, bot switching, parent retirement, and restart.

#### Product runtime

CI does not perform:

- WSL Electron startup
- fresh Pi OAuth login
- live Pi model call and tool-result continuation
- two persistent bots executing concurrently
- child crash/restart recovery
- actual WSL renderer behavior
- relocated packaged-app Pi import
- Cursor/Anysphere outbound audit

### 8.3 Interpretation rule

Use this evidence ladder for every parity claim:

```text
documented feature
→ source exists
→ production path wired
→ focused test executes the production path
→ live WSL product flow verified
→ restart/failure behavior verified
```

A claim must stop at the highest level actually observed. Test count alone must not promote it.

## 9. Functional Status Matrix

| Area | Current classification | Key remaining gap |
|---|---|---|
| WSL source checkout build/start | `PARTIAL` | fresh OAuth default flow broken |
| Pi Codex inference | `RUNTIME_VERIFIED_NARROW` | credential/bootstrap/catalog/profile consistency |
| Persistent-agent CRUD | `VERIFIED_CODE_PATH` | per-agent execution profile absent |
| Temporary Task child | `PARTIAL` | durable state owner and restart recovery |
| Agent-to-agent messaging | `PARTIAL` | durable delivery/result contract absent |
| Memory store/recall | `PARTIAL` | automatic learning and minimum disclosure |
| Context compaction | `VERIFIED_CODE_PATH` | backend-effective limit measurement |
| Prompt cache accounting | `PARTIAL` | stable conversation cache affinity |
| Shell | `PARTIAL` | per-agent state, timeout, cleanup |
| File tools | `PARTIAL` | canonical boundary and fidelity edge cases |
| WebSearch/WebFetch | `PARTIAL` | parser, binary, redirect/DNS, abort fidelity |
| PDF Read | `PARTIAL` | cache invalidation, cancellation, OCR/resource caps |
| Image input | `CODE_PRESENT` | live vision E2E |
| GenerateImage | `MISSING_LOCAL_CODEX` | Cursor-only implementation |
| Video analysis | `DORMANT` | no live composition |
| Local cron | `PARTIAL` | durability, idempotency, ownership |
| Local stdio MCP | `PARTIAL` | protocol breadth, catalog propagation, skills |
| HTTP/SSE MCP | `INCOMPLETE_LOCAL_PATH` | Cursor/backend dependence |
| Computer | `CONFIG_DEPENDENT_PARTIAL` | default setup and per-agent desktop |
| Original WSL renderer | `PRESERVED` | editable frontend is a separate authority |
| Standalone packaged app | `RELEASE_UNVERIFIED` | Pi dependency closure and verifier consistency |
| Central manager orchestration | `PHASE_B_MISSING` | designation, job, review, retry, publication gate |

## 10. Recommended Correction Order

### Wave 1 — Make first use truthful and functional

1. Break the logged-out coordinator/login cycle.
2. Unify the Pi credential source of truth.
3. Connect actual Pi auth state to the renderer.
4. Wire the Pi model catalog into the real desktop path.
5. Migrate or reject existing Cursor provider/model settings explicitly.

**Gate:** fresh profile → login → model selection → one turn → one tool call → restart.

### Wave 2 — Repair ownership and isolation

1. Give Task children independent durable stores and settlement identity.
2. Keep model/type/cancel mapping for the entire child lifecycle.
3. Prevent parent retirement while child-owned work still requires parent coordination.
4. Namespace Shell cwd/env/terminal state by agent.
5. Apply one canonical workspace policy to every file/path tool.
6. Decide whether Computer is shared or truly per-agent and make prompt/UI match.

**Gate:** two children and two persistent agents run concurrently; cancel and restart tests show zero cross-owner writes.

### Wave 3 — Complete parity surfaces

1. Pass the local plugin catalog into the host MCP manager.
2. Preserve custom plugin skills or explicitly declare them unsupported.
3. Complete MCP pagination, notifications, content types, cancellation, and shutdown.
4. Make cron dispatch durable and idempotent.
5. Make Task completion and agent inbound delivery durable.
6. Finish Web/PDF/attachment lifecycle correctness.
7. Connect automatic memory learning and snapshot invalidation.
8. Give cache identity and context limits measurable runtime contracts.

**Gate:** production-path integration tests plus WSL E2E, not source-string checks.

### Wave 4 — Close release-only boundaries

1. Stage the complete Pi dependency closure.
2. Reconcile original-renderer patch provenance with default package verification.
3. Run a relocated package on a clean machine through auth, inference, and one tool call.

### Phase B — Add the actual manager product

Only after the parity foundation is stable:

1. first-class `managerAgentId`
2. user-to-manager-only routing
3. durable goal/job/attempt/result/review schema
4. structured persistent-worker dispatch and guaranteed result return
5. progress, timeout, cancellation, and restart reconciliation
6. evidence-aware review, reject, retry, and reassignment
7. approved-only user publication gate
8. per-agent model/tool/MCP/workspace/memory-sharing profile
9. manager-owned user-memory projection to workers

## 11. Verdict-Changing Evidence

The following would materially upgrade the current verdict:

- a fresh-profile in-app Pi login E2E using only documented commands
- a real two-child ownership test proving separate transcript/checkpoint/blob/store state
- crash/restart tests for agent messaging, Task completion, and cron with duplicate fences
- an agent-facing local plugin search/install/use E2E including a skill-bearing plugin
- two-agent Shell and Computer isolation tests
- automatic memory capture, correction, restart recall, and minimum-disclosure E2E
- stable cache-key/token measurements across repeated turns and compaction
- relocated packaged-app Pi import/auth/turn/tool verification

Until those exist, the accurate product label is:

```text
substantially improved local WSL multi-agent foundation
with several verified narrow paths,
but incomplete Grok Bot 0.18 functional parity
and no completed central manager orchestration layer
```

## 12. Reproduction Commands

Read the committed snapshot without importing another session's WIP:

```bash
git show c466160:<path>
git diff --stat a9f633e..c466160
git diff --name-status a9f633e..c466160
```

Run the committed source regression gate in a clean detached worktree or archive, not in the dirty live checkout:

```bash
npm ci
npm run check
npm run frontend:build
```

These commands verify source/build regressions only. Product acceptance additionally requires the Wave 1–4 and Phase B gates above.
