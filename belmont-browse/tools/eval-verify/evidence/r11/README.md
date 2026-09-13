# R11 — product backlog: bot self-service tools (routine) + CreateGroup provenance

Continuing the product backlog after GPT approved the live harness (r10). This batch verifies the bot's
self-service creation tools and settles what the bot can vs cannot autonomously create.

## `ev-bot-autonomous-routine.json` — a BOT autonomously creates a ROUTINE = PASS
Driver `../design-bot-autonomous-routine.mjs`, Host gateway (42611, auth-ON).
- **createRoutine is a model tool**: `updateState` with target=routine, action=create (sand-state-tool.ts;
  registered turn-toolset.ts:1378). Not the gateway createAgentAutomation API.
- **Autonomy (causal)**: the harness NEVER calls createAgentAutomation; the routine name carries a maker-only
  nonce. A routine with that exact name appearing in the maker's automations (getAgentAutomations) can only be
  the maker executing its updateState tool. Created from one prompt (routineId belmont-selftest-routine-<nonce>).
- **Cleanup**: routine deleted (deleteAgentAutomation) + maker deleted; roster ID-set restored from readable
  rosters, no leftover. PASS.

## CreateGroup — a bot does NOT have a group-creation tool (by design; SCOPE-OUT)
Settled from the protocol contract, not run as a test:
- The agent protocol ToolCall union (source/packages/proto/generated/agent/v1/agent_pb.ts) has
  `createAgentToolCall` but NO `createGroupToolCall`; the model tool inventory
  (client-side-tool-v2-inventory.ts) likewise lists createAgent, not createGroup.
- `createGroup` exists only as a gateway RPC (host-gateway-api.ts:318 — the app UI/user surface) plus group-chat
  plumbing (group-chat-glue.ts, shared-rooms.ts). Bot tools are sendToAgent ("post to a GROUP you belong to") +
  listGroups — group membership is user-granted, not bot-created.
- Conclusion: a bot can autonomously create AGENTS and ROUTINES, but NOT groups — groups are a user/UI action.
  This is an intentional design property (the proto union has no group-create case), inferred from the generated
  protocol contract in this repo (not from upstream Grok product docs). The R8 "bot group discussion" used the
  gateway createGroup API driven by the harness — never a bot's own tool (as R8's caveat already noted).

## `ev-l02-browser-matrix.json` — L02 local-form navigate/read/fill/click = PARTIAL (corrected per GPT)
Driver `../design-l02-browser-matrix.mjs`, against the eval serve. A local HTTP server serves a form page whose
<h1> carries a nonce and whose /submit endpoint captures the field value; a guard-mode browse session navigates,
reads the heading, fills the input, clicks Submit.
- **What the run showed**: the local server received the fill nonce and the heading nonce appeared in the session —
  a successful local-form navigate/read/fill/click.
- **CORRECTION (GPT round-8/9)**: this does NOT by itself prove the browser tools executed. HEAD/FILL originally
  shared a nonce suffix, and a bare `GET /submit?field=<FILL>` records the value with ZERO browser launches (GPT
  reproduced a driver PASS with no browser). The driver is now fixed to use INDEPENDENT HEAD/FILL nonces
  (`design-l02-browser-matrix.mjs:21-22`), but the STORED `ev-l02-browser-matrix.json` is the PRE-FIX run (shared
  suffix `4bd1bc`) — i.e. code fixed, no post-fix live rerun evidence yet.
- **Still OPEN (full L02, plan 258)**: link tool execution to tab/DOM/server result (assert the session's fill/click
  tool-calls ran with FILL), independent heading vs input nonces, and the rest of the matrix (two tabs, long page,
  select/drag/keyboard/coordinate-click, wrong-tab change, stale reference). Disposition: **PARTIAL**.

## `ev-l16-durable-accept.json` — L16 durable-accept = PARTIAL (corrected per GPT)
An accepted session created on the eval serve survived a serve restart on the same state dir: the on-disk aside
session record was retained across the stop; the restarted serve logged "reconciled 1 persisted executions"; and
GET /sessions/:id after restart returns the record (task preserved, status done).
- **Scope**: this is the session-record RESTART-PRESERVATION sub-test only.
- **Still OPEN (full L16, plan 277)**: same-nonce concurrent submit, response loss, other-nonce queueing, a durable
  accept-ledger with work-count + external-side-effect-count consistency, and restart dedup. The JSON has no
  request identifiers / accept ledger / execution counts / external receipts. (createAgent idempotency half was
  verified in r8.) Disposition: **PARTIAL**.

## `ev-l38-attachment-sha-dedup.json` — L38 attachment SHA / content-dedup = PARTIAL (corrected per GPT)
- **Real-data evidence**: a read-only scan of every agent's `conversation-blobs.db` — **20,439 real blobs** across
  12 DBs — recomputed `sha256(data)` per row. **20,427 / 20,439** stored ids equal `sha256(data)` (the 12
  exceptions begin `73616e642d6c6976652d` = `"sand-live-"`, symbolic root pointers). 20,407 distinct contents →
  **0** mapped to more than one id.
- **SOURCE INTERPRETATION CORRECTED (GPT round-8)**: the earlier claim that `conversation-blob-store.ts:17`
  enforces `id == sha256(data)` at write time was WRONG. `setBlob(id,data)` (line 14) stores the CALLER-SUPPLIED
  id + bytes; it does not compute the id. Line 17's `createHash("sha256")…!==id` lives inside
  `clearStaleCheckpointRoots()` and is used to pick stale checkpoint-root GC candidates, not to validate writes.
  The schema (line 11 upsert + `id TEXT PRIMARY KEY`) guarantees **id uniqueness**, not content-addressing — the
  same bytes under two ids would be two rows. Content-addressing (`id = sha256(content)`) is a **producer
  contract**; the 20k-blob scan is EMPIRICAL evidence the producer honors it, not proof the schema enforces it.
- **Still OPEN (full L38, plan line 315)**: the real attachment HTTP path — same name + DIFFERENT bytes across
  agents, upload response-loss + retry, chunked fetch, wrong-path rejection, source-vs-fetch SHA match, per-agent
  target isolation. The stored-data scan is supporting evidence, not a substitute for that acceptance test.

## `ev-l10-subagent-isolation.json` — L10 subagent isolation & result routing = PASS (v3 verifier)
> **v3 (GPT round-9)**: closed four verifier holes GPT found by running `main()` with counterexamples and shipped
> all of them as permanent `--selftest` regressions (`selftest_ok=true`):
> (A) a `thinking`-only "report" with no real message no longer counts — the parent report is read ONLY from
> `send-message`/`assistant-text` items; (B) `status: SUCCESS` for B and "FAIL" inside the `L10FAILB…` nonce no
> longer fool detection — nonces are masked and each worker's claim is scoped to its OWN clause (no fixed window
> bleed, period-proof); (C) `parentReportsA_success` is now enforced (a report that misreports the succeeding
> worker A as "failed" now FAILs); (D) worker-id↔result linkage — the subagent whose TASK (title) carries the OKA
> nonce must be a distinct terminal worker and that nonce must appear in a worker-result unit (`resultAttributedToWorkerId`).
> The verifier is also representation-robust: this run's results arrived as "[A background task just completed]"
> items (`taskItemsInlined=0`), and the verdict handled it. Self-test: 4 adversarial→FAIL, 1 faithful→PASS.

Plan L10·P1 T8/H2: a PARENT delegates DIFFERENT tasks to TWO workers, collects results, one worker must fail;
pass = each worker's output matches its recipient, no failure-as-success laundering, no cross-worker mixing.
Drivers `../l10-phase.mjs` (create; workers dispatched per-worker via curl to dodge the model's todo-loop; each
phase SHORT so the harness never memory-reaps the poller while the gateway runs the worker turns) +
`../l10-verify-transcript.py` v2 (verdict + built-in regression), Host gateway (42611, auth-ON).
- **Two distinct workers**: the parent invoked `Task` twice → two distinct terminal subagentIds
  (subagent-3dded993… "reply the OKA token"; subagent-1a6461ee… "read /nonexistent/<FAILB>.txt").
- **Output matches recipient**: worker A produced exactly `L10OKA<nonce>`; worker B produced
  `Error: Path escapes configured workspace root: /nonexistent/L10FAILB<nonce>.txt`.
- **No cross-worker mixing**: worker A's produced output carries ONLY its nonce; worker B's ONLY its nonce.
  (Judged on each worker's *produced* items — the harness's own dispatch prompts, which quote both nonces, are
  `user` items and are excluded.)
- **No laundering — verified on the PARENT'S ACTUAL FINAL REPORT** (this is the GPT-round-8 fix): after both
  workers finished, the parent was asked to report results and produced: *"Worker A exact result: `L10OKA…`. A
  succeeded. Worker B exact result: `Error: Path escapes configured workspace root: /nonexistent/L10FAILB….txt`. B
  failed."* The verifier now gates on `parentReportsB_failure=true` AND `parentDoesNotClaimB_success=true` (read
  from `send-message.message.content`, not just `text`) — not merely "an error word appears in B's segment".
- **Verifier regression (`--selftest`)**: GPT's counterexample is shipped as a permanent regression — a parent
  final report of *"Worker B succeeded. Both workers completed successfully."* (while B errored) now correctly
  yields `noFailureLaundering=false` → FAIL; a faithful "Worker B failed" report → PASS. `selftest_ok=true`.
- **Architecture (honest)**: subagents are EPHEMERAL runtime sessions (distinct subagentId + SubagentSession +
  lineage), NOT top-level agents (`getAgentTranscript(subId)` = "does not exist"), no per-subagent on-disk store —
  results are COLLECTED into the parent's durable transcript, where verification is done.
- **Structural note (CORRECTED per GPT)**: `SubagentRunResult = { text: string; aborted: boolean }`
  (subagent-runtime.ts:33-36); completed/error is assigned at settle time — normal return → `completed`, a thrown
  error → `error` (262-273). So a worker that honestly reports a file-read failure and finishes its turn can be
  `done`; that is NOT a defect. Crucially there is NO structural guarantee that the PARENT won't misreport a
  result — which is exactly why the parent's final report is checked directly (the earlier "un-launderable union"
  claim was wrong and is withdrawn). Closes the L10 OPEN row.
- **Bonus**: worker B's read was blocked by the box workspace-root guard ("Path escapes configured workspace
  root") — a subagent is confined to the box workspace and cannot read arbitrary host paths.

## Bot self-service creation summary
| Capability | Bot-autonomous tool? | Evidence |
|---|---|---|
| CreateAgent | YES | r10 ev-bot-autonomous-createagent.json (delegated-creation causal) |
| CreateRoutine (automation) | YES | r11 ev-bot-autonomous-routine.json (this batch) |
| CreateGroup | NO (by design) | proto has no createGroupToolCall; gateway/UI only — SCOPE-OUT |
