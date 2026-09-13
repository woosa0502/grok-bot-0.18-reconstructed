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

## `ev-bot-autonomous-createagent.json` — a BOT creates a BOT when delegated = PASS (claim narrowed round-2)
Driver `../../design-bot-autonomous-createagent.mjs`, against the Host gateway (42611, auth-ON). GPT's P1-2
requirement + round-2 correction on the claim scope and the frame explanation.
- **createAgent is a real model-facing tool** (source: sand-agent-management-tools.ts:92,202; turn-toolset.ts:1367).
- **Delegated-creation (strong INDIRECT causal evidence)**: the harness NEVER calls the createAgent API for the
  child; the child's name carries a nonce known ONLY to the maker (via its prompt). In this controlled run a
  roster agent with that exact name appeared after delegating to the maker -> strong evidence the maker created
  it. This is NOT claimed as an exclusive tool-call proof (the test alone does not exclude every other actor).
- **Cleanup**: exact roster ID-SET restored from GENUINELY-READABLE rosters (round-2: an unreadable baseline/final
  can no longer collapse to [] and masquerade as restored) — addedNotRemoved=[], removedFromBaseline=[], no
  leftover test-named agent/group.
- **Corrected frame explanation**: the createAgent trace is NOT a transient `createAgentToolCall`. CreateAgent is
  wrapped by `defineCommunicateTool`, so its frame is a `communicateUpdateToolCall` whose args.currentStep is
  {"__sand_tool__":true,"tool":"CreateAgent",...} (communicate-tool.ts:19-31,124-165; agent-messaging.ts:7). The
  gateway transcript RPCs return a redacted display view (message/send-message) that omits it, so the raw wrapper
  frame was not captured; upgrading to an exclusive tool-call proof means capturing the wrapper's start/complete
  under one toolCallId matched to the returned child id.

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
NOTE (round-2): the two rejections are returned as HTTP **500** (a validation-error refusal), NOT a 4xx contract;
the claim is "the specified validation refused execution", not "a clean 4xx error contract". The canonical tally
always also checks authorityMode=belmont (the driver would record verdict_pass on legacy too, so mode is required).

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

## `ev-l13-approval-flow.json` — L13 approval flow (four decisions) = PASS
Driver `../../design-l13-approval-flow.mjs`, guard mode / autoApprove:false. The gated action is a file READ
outside the allowed roots (/etc/hostname), which suspends with kind:"approval", scope {type:"file",...,mode:"read"}
(session.mjs:382-388); the observable external result is the file CONTENTS (the host hostname) appearing in the
session — only possible if the read actually ran. FOUR distinct decisions, each verified as its own property
(round-2, per GPT: a VALID deny is separate from an invalid-decision fail-closed):
- **suspends before effect** + **no side-effect before the decision**: all four suspend on approval and the
  contents are ABSENT while suspended (observed via a successful read, not an HTTP error — the verdict gates
  observation-read success).
- **approve** (`{verdict:"allow",always:false}`): decision 200, the read result APPEARS only AFTER approval.
- **valid deny** (`{verdict:"deny",always:false}`): decision **200** (a valid, accepted denial — the earlier
  400 was a missing `always` field, i.e. an invalid request), the read NEVER runs, session → done.
- **invalid decision** (`{verdict:"__bogus__"}`): decision **400** (schema-rejected), suspension KEPT, no effect
  — fail-closed against a malformed decision.
- **cancel** (/stop while suspended): decision 200, session → stopped, no effect.
The verdict gates decision-status and finalStatus for each case (a failed cancel/observation can no longer pass).
Honest bound: "no effect" is observed over a finite window as the contents not appearing (result-exposure), which
in this driver stands in for the read not running; it is not an unbounded NEVER nor an independent instrumentation
of the read syscall.

## Map-row disposition
See `MAP-DISPOSITION.md` — each untested map row (L02, L10, L12/L27, L16, L37, L38, L41, L42, L46-50, plus
Telegram/autopost) is dispositioned as VERIFIED (test PASS), explicit SCOPE-OUT (with reason), or named OPEN
(not counted complete, with a next step) per GPT's rule.

## Round-2 harness hardening (from GPT's live-phase review)
The new live drivers' verdicts and cleanups were hardened after GPT found gaps (the SUBMITTED successes still
stand; these fix the drivers so they can't PASS on a failure path):
- **recovery signal safety (round-3+4, pidfd, ALL paths)**: EVERY signal in both recovery drivers — the serve
  crash injection, the serve2 stop injection, the ABORT/early-exit cleanup, and the final cleanup — now routes
  through `belmont-browse/tools/safe-pidfd-kill.py` (`os.pidfd_open` + `signal.pidfd_send_signal`, re-verifying
  /proc startTicks across the open, REFUSING on absent/mismatched identity — no raw-PID or group fallback). This
  closes the check→signal reuse race AND the round-3 "ABORT bypass" GPT found (the early-exit paths still used
  raw `process.kill`/`child.kill`). Same kernel primitive as the product supervisor. Re-ran PASS with the
  pidfd-bound crash (crashed:true) and stop (stopped2:true).
- **L13 approve gate**: `approveGrantsEffect` now also requires `allReadsOk === true`, so EVERY scenario
  uniformly gates observation-read success (GPT round-3).
- **orphan-adopt verdict**: now requires serve1 actually died, the owner names the SPAWNED serve2 pid
  (jsonMatchesSpawned + ownerIsSpawnedServe2), and gates every stage in the final result.
- **bot cleanup**: idSetRestored now requires GENUINELY-READABLE baseline AND final rosters (an HTTP error can no
  longer collapse to [] and read as restored).
- **L13 verdict**: gates decision-status + finalStatus + observation-read success per scenario.

## What this closes vs. leaves open (buckets kept separate — see MAP-DISPOSITION.md)
VERIFIED live this batch: P1-1 recovery (supervised + orphan-adopt, per-stage traces, hardened), L26 canonical
POSITIVE paths (rejections are 500), L15 auth/Origin matrix (hardened), L13 approval flow (allow / valid-deny /
invalid-fail-closed / cancel), and bot DELEGATED-creation (strong indirect causal, claim narrowed). EXCLUDED/
BLOCKED (not product-complete): Telegram, autopost, L41, L42 (+ its open filesystem deny-list gap), L37. OPEN
(named, not counted complete): L02 full browser tool matrix, L10 dedicated subagent isolation, L16 durable-accept,
L38 attachment dedup, L46-50 (undefined topics — needs the source plan). The three buckets are NOT summed.
