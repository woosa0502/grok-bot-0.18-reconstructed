# R9-AUDIT — closing GPT-6 Pro's whole-project completion review (P0 items)

GPT reviewed the whole repo on GitHub (HEAD 6397e57) and judged the project **NOT COMPLETE**, with a P0 list.
This dir closes those items one by one; each keeps the original evidence and records the correction separately.

## P0 (판정 신뢰성) — L19.PENDING false-PASS — FIXED
GPT found a real false-PASS: `verify-l19-pending-r5.mjs`'s `markerCount()` counts marker FILES (0/1), but B
appends with `>>`, so a DOUBLE execution left 2 lines in ONE file and `bNeverDuplicated = count<=1` stayed
true — the harness would PASS a double-run failure (GPT reproduced offline: real writes=2, markerCount=1,
verdict_pass=true).

- **Withdrawn**: the r5 L19.PENDING result's "never duplicated" claim rested on a broken metric — do not count
  it as a functional PASS.
- **Fix** (`verify-l19-pending-r14.mjs`): the external artifact is the EXECUTION COUNT (non-empty lines in the
  BSTART file); read-failure is UNKNOWN(-1); the verdict FAILS on >=2 executions, on a single uncontrolled
  execution, and on a read failure — PASSing only on 0 executions.
- **Offline self-test** (`test-pending-formula.mjs`): asserts the corrected verdict FAILS on 2-run / 1-run /
  read-failure and PASSes only on 0 — directly reproducing + closing GPT's counterexample. PASS.
- **Live re-run** (`ev-l19-pending-r14.json`): bExecCountBefore/After = 0/0 (B, cancelled while queued, never
  executes), b_not_lost, b_cancelled_terminal(stopped), C ran. The product behavior is correct AND the harness
  now catches a double-run. Verdict PASS.

Remaining P0 (per GPT, next): common harness hardening (inject failures ⇒ FAIL/UNKNOWN) across the other
drivers; Chrome creation/registration boundary (owner-polling can't do first-discovery — poll-gap leak);
whole-tree + supervisor-death + same-profile flock; recovery re-run via the real supported launch path
(supervised vs orphan-adopt separated); L13 full approval flow / canonical-mode L26 / L15 missing matrix;
bot autonomous-creation trace. Plus verify-or-scope-out the untested map areas (L41,L12/L27,L02,L16,L37,L38,
L42,L10,L46-50). Tracked in this thread with GPT.

## P0 (Chrome 소유권) — poll-gap first-discovery — FIXED (push registration at spawn)
GPT's whole-project review + rounds 10-13 kept reproducing a single-serve leak the owner-file-POLLING
supervisor could not close: `pin A → (within the 0.5s poll gap) A dies, B spawns+publishes owner, owner
deleted → SIGKILL` leaves B untracked (owner gone, never polled). Reducing the interval or adding a final
sweep does not fix the class — discovery cannot depend on a deletable file that is only sampled periodically.

Fix (the append-only registration GPT recommended): `chrome.mjs` now, at each owned chrome spawn, appends
`{pid,pgid,startTicks,servePid,ts}` to `$BELMONT_CHROME_REG` synchronously (before any await). The supervisor
sets that env to `<profile>/.belmont-chrome-reg.jsonl`, creates the fork with it inherited, and TAILS the log
every poll (+ a final drain at serve-exit), pidfd-pinning every newly-registered owned chrome (servePid==our
child, start-ticks verified, re-verified after pidfd_open). Owner-polling remains only as a secondary/compat
path. Regression `test_poll_gap_registered_chrome_reaped` (register B + delete owner within the poll window →
B reaped). Supervisor 8/8; Node orphan-ownership + lifecycle regressions still green.

Residual (spawn→append microgap): a crash in the ~microseconds between the OS spawn returning the pid and the
appendFileSync would still leave an unregistered chrome. Fully closing that needs the manager to OWN creation
(spawn chrome itself) or a per-run cgroup — the external-manager/cgroup architecture GPT named, tracked as the
remaining architectural item alongside whole-tree stragglers, the supervisor's own SIGKILL, and A-1 flock.
