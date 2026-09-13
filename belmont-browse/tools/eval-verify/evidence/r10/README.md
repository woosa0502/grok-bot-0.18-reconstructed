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

## What this closes vs. leaves open
Closes GPT's P1-1 evidence-hardening: recovery is now re-verified on the supported path with per-stage identity
and termination traces (not summaries), separating the supervised and orphan-adopt guarantees, each with a
mis-kill control. Still open in the live phase: bot autonomous createAgent tool-call trace, L26 canonical
POSITIVE paths, L13 full approval flow, the L15 auth/Origin matrix, and map-row disposition.
