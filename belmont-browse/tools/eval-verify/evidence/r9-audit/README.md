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
