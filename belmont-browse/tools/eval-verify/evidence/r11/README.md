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

## `ev-l02-browser-matrix.json` — L02 browser tool matrix (navigate/read/fill/click) = PASS
Driver `../design-l02-browser-matrix.mjs`, against the eval serve (under the supervisor). A local HTTP server
serves a form page whose <h1> carries a nonce and whose /submit endpoint captures the field value. A guard-mode
browse session (autoApprove:true) is told to navigate, read the heading, fill the input, click Submit.
- **navigate+fill+click**: the local server RECEIVED the exact fill nonce (L02FILL<nonce>) — an EXTERNAL
  observable only reachable by actually submitting the form in the real browser (not the agent's self-report).
- **navigate+read**: the heading nonce (L02HEAD<nonce>) appeared in the session (the agent read the <h1>).
- Both proofs obtained -> PASS. Confirms the live browser tool matrix beyond the offline lifecycle/numeric-fill
  tests. (This closes the L02 OPEN row from MAP-DISPOSITION with a live end-to-end run.)

## `ev-l16-durable-accept.json` — L16 durable-accept = PASS
An accepted session created on the eval serve was made to survive a serve restart on the same state dir. Proof
(three ways): the on-disk aside session record was retained across the stop; the restarted serve's lifecycle
logged "reconciled 1 persisted executions"; and GET /sessions/:id after restart returns the record (task
preserved, status resolved to done). Closes the L16 durable-accept OPEN row. (The idempotency half was already
verified in r8 via createAgent clientNonce.)

## `ev-l38-attachment-sha-dedup.json` — L38 attachment SHA / content-dedup = PASS
Attachment blobs in the agent-isolation store are content-addressed: the row id IS `sha256(content)`, id is the
PRIMARY KEY, and inserts upsert `ON CONFLICT(id)`, so identical content collapses to one row.
- **Source proof**: `source/host/agent-isolation/conversation-blob-store.ts:17` verifies
  `createHash("sha256").update(data).digest("hex") === id`; `:11` is `INSERT INTO blobs(id,data) … ON CONFLICT(id)
  DO UPDATE`; schema is `blobs(id TEXT PRIMARY KEY, data BLOB NOT NULL) STRICT`.
- **Real-data proof**: a read-only scan of every agent's `conversation-blobs.db` — **20,439 real blobs** across 12
  DBs — recomputed `sha256(data)` per row. **20,427 / 20,439** ids equal `sha256(data)`. The 12 exceptions all
  begin `73616e642d6c6976652d` = `"sand-live-"` — symbolic root/pointer entries (one per DB), not content blobs.
- **Dedup**: 20,407 distinct contents → **0** contents mapped to more than one id (0 violations).
- Closes the L38 OPEN row with real-data verification (not just a synthetic unit test).

## `ev-l10-subagent-isolation.json` — L10 subagent isolation & result routing = PASS
Plan L10·P1 T8/H2: a PARENT delegates DIFFERENT tasks to TWO workers, collects results, one worker must fail;
pass = each worker's output matches its recipient, no failure-as-success laundering, no cross-worker mixing.
Drivers `../l10-phase.mjs` (create/poll/cleanup, run in SHORT phases so the harness never memory-reaps the poller
while the gateway runs the worker turns) + `../l10-verify-transcript.py` (verdict), Host gateway (42611, auth-ON).
- **Two distinct workers**: the parent invoked its `Task` tool twice → two distinct subagentIds
  (subagent-d783e3d0… "reply the OKA token"; subagent-4bb8e630… "read /nonexistent/<FAILB>.txt"), both terminal.
- **Output matches recipient**: worker A produced exactly `L10OKA<nonce>`; worker B produced
  `Error: Path escapes configured workspace root: /nonexistent/L10FAILB<nonce>.txt` — each result is its own task's.
- **No cross-worker mixing**: worker A's produced output carries ONLY its nonce (no FAILB); worker B's carries ONLY
  its nonce (no OKA). (Judged on each worker's *produced* items — the harness's own dispatch prompts, which quote
  both nonces, are `user` items and are excluded.)
- **No laundering**: worker B's outcome is a genuine failure (a read error), never relabelled as the success token;
  the parent's collected result for B is the error, not a success.
- **Architecture (honest)**: subagents are EPHEMERAL runtime sessions (distinct subagentId + SubagentSession +
  lineage), NOT top-level agents (`getAgentTranscript(subId)` = "does not exist") and with no per-subagent on-disk
  store — their results are COLLECTED into the parent's durable transcript, which is where verification is done.
- **Structural backing**: `SubagentRunResult = completed{text}|aborted|error{error}` and
  `BackgroundSubagentCompletion.status ∈ {completed,error}` keyed by subagentAgentId (subagent-runtime.ts) — a
  failure is structurally distinct from a success and un-launderable. Closes the L10 OPEN row.
- **Bonus**: worker B's file read was blocked by the box workspace-root guard ("Path escapes configured workspace
  root") — a subagent is confined to the box workspace and cannot read arbitrary host paths.

## Bot self-service creation summary
| Capability | Bot-autonomous tool? | Evidence |
|---|---|---|
| CreateAgent | YES | r10 ev-bot-autonomous-createagent.json (delegated-creation causal) |
| CreateRoutine (automation) | YES | r11 ev-bot-autonomous-routine.json (this batch) |
| CreateGroup | NO (by design) | proto has no createGroupToolCall; gateway/UI only — SCOPE-OUT |
