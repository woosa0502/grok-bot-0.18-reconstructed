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

## Bot self-service creation summary
| Capability | Bot-autonomous tool? | Evidence |
|---|---|---|
| CreateAgent | YES | r10 ev-bot-autonomous-createagent.json (delegated-creation causal) |
| CreateRoutine (automation) | YES | r11 ev-bot-autonomous-routine.json (this batch) |
| CreateGroup | NO (by design) | proto has no createGroupToolCall; gateway/UI only — SCOPE-OUT |
