# R10 — live/product verification (post code-phase-complete): P1-1 recovery re-verify with per-stage traces

After GPT-6 Pro judged the code/regression phase COMPLETE at dbb96fb, this batch begins the remaining
live/product verification against the real dev stack. GPT flagged the r8 HEALTH.DEAD/DOUBLE_CRASH JSONs as
summary-only (no per-stage identity/termination trace). R10 re-runs recovery on the SUPPORTED path and captures
the full trace GPT asked for: per-stage `(pid, startTicks)`, health, termination status, and a mis-kill guard.

Run against the live dev stack in a maintenance window (the eval serve on singleton 21420/9333/9360 was stopped
by explicit pid first; the concurrent session on 1337 and the live legacy bot were untouched; rollout.json stays
absent on the live profile).

## Two paths, separated (per GPT: "supervised crash와 의도적인 orphan-adopt를 별도 시험")

### `ev-recovery-supervised.json` — SUPERVISED-CRASH (the supervisor's core guarantee) = PASS
Driver `../../recovery-reverify-supervised.mjs`. The REAL eval serve ran UNDER chrome-supervisor.py; the serve
was SIGKILLed (a crash with no in-process cleanup — the orphan window). Trace:
- serve-ready: chrome pid + startTicks captured, /health ready, chrome alive with matching startTicks.
- pre-crash: chrome alive, startTicks match.
- post-crash: the supervisor (serve's parent) regained control and REAPED the owned chrome via pidfd (exit 0,
  ~750ms), chrome `(pid,startTicks)` gone, the CONTROL process untouched (no mis-kill), reap logged.
- verdict: chromeReaped ∧ controlUntouched ∧ supExitClean → PASS.

### `ev-recovery-orphan-adopt.json` — ORPHAN-ADOPT (in-process reaper/adopt) = PASS
Driver `../../recovery-reverify-orphan-adopt.mjs`. serve1 ran DIRECTLY (no supervisor) and was SIGKILLed so its
detached chrome was ORPHANED; serve2 (also direct) adopted it; a normal stop reaped it. Trace:
- serve1-ready: chrome `(pid,startTicks)` captured.
- after-serve1-crash: serve1 dead, chrome STILL ALIVE (orphan survived), startTicks match, owner still names the
  dead serve1.
- serve2-adopt: serve2 adopted the SAME chrome instance — identical pid AND startTicks (adopted, not respawned)
  — owner now names serve2.
- after-serve2-stop: normal stop reaped the adopted chrome; CONTROL process untouched.
- verdict: orphanSurvived ∧ adoptedSameInstance ∧ reapedOnStop ∧ controlUntouched → PASS.

## `ev-bot-autonomous-createagent.json` — a BOT autonomously creates a BOT = PASS
Driver `../../design-bot-autonomous-createagent.mjs`, against the Host gateway (42611, auth-ON). GPT's P1-2
requirement: prove a bot AUTONOMOUSLY calls createAgent (not the harness calling the API) and verify cleanup by
exact roster ID-set restoration + no leftover group.
- **createAgent is a real model-facing tool** (source: sand-agent-management-tools.ts:92,202; turn-toolset.ts:1367).
- **Autonomy (causal proof)**: the harness NEVER calls the createAgent API for the child; the child's name
  carries a nonce known ONLY to the maker (via its prompt). A roster agent with that exact name appeared only
  after the maker's turn -> the maker executed its createAgent tool. childId a62e1546 created from one prompt.
- **Cleanup**: exact roster ID-SET restored (addedNotRemoved=[], removedFromBaseline=[], no leftover
  test-named agent/group) — not merely a count.
- **Honest limitation**: the literal `createAgentToolCall` frame is a transient streamed activity
  (sand-activity.ts). The gateway's transcript RPCs (getAgentTranscript/Thread/Tail/Window) return a redacted
  display view (message/send-message) that does NOT include it, so autonomy is proven causally rather than by
  the raw frame. Capturing the raw frame would require subscribing to the live turn activity SSE stream.

## `ev-l26-canonical-*.json` — L26 canonical-authority POSITIVE paths = PASS
Driver `../../design-memory-canonical-authority.mjs`, run against a serve started with
`BELMONT_MEMORY_AUTHORITY=belmont` UNDER the supervisor (the canonical daemon bundle daemon.memory-2.1.mjs is
already patched with the canonical guard; session.mjs:131 asserts it at boot). /health reported
`memoryAuthority: belmont, memoryProtocolVersion: 1`. GPT required the belmont-mode POSITIVE paths, not just the
legacy MEMORY_AUTHORITY_MISMATCH refusal.
- **context-authority** (`ev-l26-canonical-context-authority.json`): in belmont mode `/memory/context` returns a
  host-owned bounded context (single-URL 200, multi-URL 200) — PASS.
- **reject-control-field** (`ev-l26-canonical-reject-control-field.json`): a session-create carrying an injected
  `authorityOverride` control field is refused with `UNTRUSTED_MEMORY_CONTROL_FIELD` (memory-belmont-runtime.mjs:31)
  — PASS.
- **reject-malformed** (`ev-l26-canonical-reject-malformed.json`): a memory context missing required fields is
  refused with `INVALID_BELMONT_MEMORY_CONTEXT` (memory-belmont-runtime.mjs:30) — PASS.
These are the belmont-authority-specific codes (not the legacy mismatch), so they prove the canonical mode is
active and enforcing, closing the R8 caveat that legacy-mode MISMATCH did not stand in for these paths.

## `ev-l15-*.json` — L15 auth/Origin matrix (hardened driver) = PASS
Driver `../../design-gateway-origin-auth.mjs` (now backed by the fail-closed graders in
gateway-origin-auth-lib.mjs — no false-PASS paths), against the Host gateway (42611, auth-ON) + the serve's
Aside daemon (21420).
- **origin-guard** (`ev-l15-origin-guard.json`): every browser Origin → 403 (generic 403, pinned-aside-extension
  403, localhost 403); roster 14→14 (rosterReadable=true, a real integer both sides). PASS.
- **bad-bearer** (`ev-l15-bad-bearer.json`): gateway auth is ON — wrong Bearer → 401 AND correct Bearer → 200
  (both proven; the hardened grader refuses to PASS on the wrong→401 check alone). PASS.
- **daemon-for-chrome** (`ev-l15-daemon-for-chrome.json`): a web-origin mutation on /session/for-chrome/* → 403
  FORBIDDEN ("Browser-side session changes are accepted only from the Aside extension or the browser itself");
  the no-Origin request reached the daemon (404 for the bogus path, not guard-blocked); bothReached=true. PASS.

## `ev-l13-approval-flow.json` — L13 full approval flow = PASS
Driver `../../design-l13-approval-flow.mjs`, guard mode / autoApprove:false. The gated action is a file READ
outside the allowed roots (/etc/hostname), which suspends with kind:"approval", scope {type:"file",...,mode:"read"}
(session.mjs:382-388); the observable external result is the file CONTENTS (the host hostname) appearing in the
session — only possible if the read actually ran. Three scenarios, all invariants hold (result PASS):
- **suspends before effect**: all three suspend on approval before any read.
- **no side-effect before the decision**: the contents are ABSENT while suspended in every scenario.
- **approve** (`{verdict:"allow"}` via /answer with expectedToolCallId): the read result APPEARS only AFTER the
  approval; session → done.
- **deny**: the read result NEVER appears (the gated read does not run). Honest note: `{verdict:"deny"}` returned
  HTTP 400 (that exact string isn't the daemon's decision enum), and the session stayed suspended — i.e.
  fail-safe default-deny: an unrecognized/deny decision does NOT grant the action. The confirmed GRANT path is
  `{verdict:"allow"}`.
- **cancel** (/stop while suspended): the read result never appears; session → stopped.

## Map-row disposition
See `MAP-DISPOSITION.md` — each untested map row (L02, L10, L12/L27, L16, L37, L38, L41, L42, L46-50, plus
Telegram/autopost) is dispositioned as VERIFIED (test PASS), explicit SCOPE-OUT (with reason), or named OPEN
(not counted complete, with a next step) per GPT's rule.

## What this closes vs. leaves open
Closes GPT's live-phase P1 items that are exercisable against the dev stack: P1-1 recovery re-verify (supervised
+ orphan-adopt, per-stage traces), a bot AUTONOMOUSLY creating a bot (causal + ID-set-exact cleanup), L26
canonical POSITIVE paths, the L15 auth/Origin matrix (hardened), and the L13 full approval flow. Remaining
(named in MAP-DISPOSITION.md, not counted complete): L02 full browser tool matrix, L10 dedicated subagent
isolation, L16 durable-accept, L38 attachment dedup, and L46-50 (undefined topics — needs the source plan);
Telegram/autopost/L37/L41/L42 are explicit scope-outs.
