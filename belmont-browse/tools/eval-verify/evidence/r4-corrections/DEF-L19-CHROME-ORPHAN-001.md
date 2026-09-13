# DEF-L19-CHROME-ORPHAN-001 — orphan Chrome processes leak on hard crash / restart

- **Severity:** S2 / Major · **Priority:** P1 (blocks R5 recovery-batch sign-off)
- **Found by:** GPT-6 Pro round-4 adversarial review, quantified in R4 (`orphan_chrome_leaked_on_crash: 36`)
- **Scope:** `belmont-browse` eval/browse engine (the reconstruction + eval harness). The live legacy
  bot runs from `source/` → `.build/belmont-wsl-runtime`, a **separate** launch path, so this defect
  does not affect the running legacy bot. Fixed here in the eval path.

## Root cause (confirmed in code)

Two compounding causes:

1. **Reuse path returns a noop stop.** `chrome.mjs` `ensureChrome()` — when CDP is already up on the
   port it returns `{ baseUrl, child: null, stop: async () => {}, detach: async () => {} }`
   (old line 44). A serve that *reuses* / adopts an existing Chrome takes **zero termination
   ownership**: its `stop()` does nothing, so an adopted orphan is never reaped.
2. **`detached: false` + no owner tracking.** Owned Chrome was spawned with `detached: false` and no
   record of which serve owns it. On `SIGKILL` of serve, no in-process handler runs; Chrome and its
   renderer/gpu/zygote children (the counted ~36) reparent to `init(1)` and survive. The next serve
   sees CDP up and reuses it — via the noop stop above — so orphans **accumulate across restarts**.

## Fix (this change)

Boundaries #2 (unified ownership on the reuse path) and #3 (restart adopts the prior owner's tree):

- Owned Chrome is now spawned **`detached: true`** → it leads its own process group, so the whole
  renderer/gpu tree can be reaped with a single group signal.
- On owned launch, an **owner file** `<profileDir>/.belmont-chrome-owner.json`
  `{ servePid, chromePid, pgid, startedAt }` is written; cleared on graceful stop.
- The **reuse branch** reads the owner file and decides:
  - **adopt** — owner file names a live `chromePid` whose owning `servePid` is **dead** → this is an
    orphan from a crashed owner. Return a **real adopted stop** that sends `Browser.close` (graceful)
    then escalates `SIGTERM`→`SIGKILL` to the **process group** and verifies exit.
  - **shared** — owning `servePid` is alive → a legitimately shared browser; keep a noop stop
    (do not kill someone else's live browser).
  - **foreign** — no/þmismatched owner file → unknown browser; keep a noop stop and log (never kill a
    browser we did not launch).
- Net: orphan accumulation is bounded to **≤1** (each restart adopts the single orphan and reaps it on
  graceful exit) instead of unbounded growth, and graceful shutdown reaps the full tree via group kill.

## Residual (boundary #1, documented, not in this change)

In-process handlers cannot run on `SIGKILL`; to bound the orphan window to ~0 even between a crash and
the next startup, run serve under an external supervisor / cgroup / systemd scope that reaps the scope
on serve death. The owner-file reaper above closes the accumulation defect for the eval workflow (a new
serve always starts for the next eval and adopts+reaps). Production hardening = a cgroup scope.

## Round-5/6 corrections (GPT-6 Pro adversarial review)

- **"36 orphan Chrome processes" is not 36 browser instances.** That count includes renderer/gpu/zygote/
  utility children of the tree. And observing the *same* Chrome reused across restarts does not by itself
  prove "each restart accumulated a new tree" — that causal claim is withdrawn. The accurate, measured
  metric is the R6 host census: **exactly one root browser** (profile + no `--type=`) and a **tree that does
  not grow** across crash→restart→adopt (`evidence/r6/ev-l19-nocleanup-r6.json`: root 1, tree 34→34).
- **The first fix was incomplete.** GPT round-5 reproduced five real defects in it (B1–B5): the owner file
  was deleted even on a shutdown *timeout* (live browser left unowned); the adopted stop waited only on the
  root pid (a surviving child reported success and skipped SIGKILL); the CDP-verified pid was discarded and a
  different owner pid was killed (mis-kill on PID reuse / endpoint swap); `pgid` was only integer-checked so
  `kill(-1)`/`kill(0)` were reachable; and there was no atomicity/locking across create→adopt→delete.
- **Re-hardened fix (this branch):** atomic owner file (temp→fsync→rename) with a **generation token** and
  **process start-ticks**; `planReuseOwnership` returns adopt/shared/foreign/**unknown** (corrupt, malformed
  servePid, or a reused pid ⇒ unknown ⇒ never touched); a per-profile **lock** guards read→plan→write (CAS)
  so two serves cannot both adopt; a unified `createChromeTreeStop` reaps the **whole process group** (not
  just the root), guards **pgid>1** before any group signal, re-verifies identity (generation + start-ticks +
  CDP browser pid) right before killing, and clears the owner **only** on confirmed full-tree exit **and**
  generation match (a stale stop cannot delete a newer owner). Owned launch records the owner immediately
  after spawn (closing the spawn→ready gap).
- **Accepted acceptance criterion** (GPT): not "adopt logged" but a **normal shutdown that reaps the entire
  owned tree** while a control browser survives — verified live in `L19.CHROME.ADOPT.FINAL_REAP`
  (`evidence/r6/ev-l19-chrome-finalreap-r6.json`: after normal stop, eval-profile census root=0/tree=0, owner
  cleared, control browser alive).

## Round-6/7 re-hardening (GPT-6 Pro round-6 reproduced A-1..A-6)

Round-6 accepted B4 (the pgid>1 guard) but reproduced further defects; all fixed and regressed:

- **A-1 lock not exclusive** → replaced the O_EXCL+PID lock (empty-file window + `Number("")===0` stale-steal +
  no ownership check on delete) with a **link-based lock**: content ({pid,token}) is fsync'd to a temp then
  `linkSync`-published (no empty window); release unlinks only when the lock still carries OUR token (no ABA
  delete); a stale lock is stolen by an atomic rename-aside. Regression: a real second process holding the
  lock blocks acquisition.
- **A-2 CDP wrong-close** → the adopt graceful close now verifies the CDP browser pid and sends `Browser.close`
  **on the same connection**; a lookup failure or pid mismatch throws without closing (OS tree-kill handles the
  owned range). Verified-close and OS-kill are separated.
- **A-3 wrong-PGID mis-kill** → a group signal is sent only after **proving the pgid is the owned root's actual
  `pgrp`** while the root is alive (cached so survivors are still reaped after the root dies); otherwise only the
  bare root pid is signalled — never a wrong group. Identity is re-verified before EACH escalation signal.
  Regression: an owner file carrying a *control* group's pgid does not kill the control group.
- **A-4 census UNKNOWN→EMPTY** → `processGroupMembers` returns `{status,members}`; a read error counts as
  possibly-alive, so an observation failure is never mistaken for "tree gone". Regression covers it.
- **A-5 CDP-down / publish-failure** → the owner write is under the lock, and a failed publish reaps the
  just-spawned child and throws (no untracked browser returned as success).
- **A-6 no total deadline** → the stop enforces an overall monotonic deadline across verify/CDP-close/TERM/KILL
  (an unresolving `requestClose` can no longer hang the stop). Regression covers it.

Live: `L19.CHROME.ADOPT.FINAL_REAP` still PASSes on the round-7 code (adopt → normal stop → eval-profile census
root=0/tree=0, owner cleared, control browser survives). Regression suite: 14/14; lifecycle 11/11.

## Round-7 residual (GPT-6 Pro): the pure-Node floor — remaining races need kernel primitives

After the A-1..A-6 fixes, GPT's focused re-review found two residual **TOCTOU** races that pure-Node userspace
cannot fully close (GPT flagged this class in round-6 too):

- **A-1 lock — two-stealer window.** Two processes can read the same genuinely-dead lock; one steals+acquires,
  the other's `renameSync` can still move the winner's fresh lock aside. Narrowed this round (never steal a
  *live* holder on age; after stealing, restore if the removed record's token ≠ the one judged stale), but the
  microsecond rename window remains. The robust fix is a kernel `flock(2)` on a fixed lock file — Node exposes
  no native flock without an addon/helper binary.
- **A-3 signal binding — PID/PGID reuse window.** Between `reverify()` and the actual `kill`, if the owned
  group fully dies AND the kernel reuses the same pid/pgid, a group signal could reach the new group. Narrowed
  (ownership proven on the live root, re-verified before each signal), but a check→signal gap is inherent in
  userspace. The robust fix is `pidfd_open(2)` + `pidfd_send_signal(2)` to bind the signal to a specific
  process *instance* — again not exposed by Node without native code.

**Assessment (proportionality).** The *core* defect this record was opened for — unbounded orphan accumulation
across restarts — is fixed and proven (census stays root=1/tree-stable across crash→restart→adopt;
`FINAL_REAP` reaps the whole owned tree on normal stop with a control browser surviving). The residuals are
narrow races that (a) require the eval harness to hit a sub-millisecond PID-reuse window or two concurrent
serves stealing the same dead lock on one profile, and (b) are only fully closable with kernel primitives
(`flock`/`pidfd`) or an external **cgroup/systemd-scope supervisor** — the architecture GPT identified as the
correct end state and a *separate task* from the in-process reaper. Recorded here as known limitations; the
in-process reaper is at its pure-Node floor.

## Kernel-primitive closure (external pidfd supervisor) — closes the A-1/A-3 floor

The residual TOCTOU races above are closed at the architecture level by an **external supervisor**, since the
in-process reaper cannot. In this environment cgroup v2 needs root and systemd-run has no user bus, but
**`pidfd` is available without root** — a pidfd binds to a specific process INSTANCE, so a signal through it
can never reach a reused PID.

`belmont-browse/tools/chrome-supervisor.py` launches the eval serve as its child, learns the owned Chrome's
`(pid, startTicks)` from the owner file, opens a **pidfd bound to that exact instance**, waits for serve to
exit (any cause, including SIGKILL — the supervisor is serve's parent, so it always regains control), and if
the instance is still alive reaps it through the pidfd (SIGTERM→SIGKILL). This closes the two windows the
in-process reaper cannot: the **SIGKILL-orphan window** (boundary #1) and the **PID-reuse mis-kill** (A-3) —
it never signals by raw pid/pgid, so it cannot mis-kill a number-inheriting process.

Verified: `belmont-browse/tools/test-chrome-supervisor.py` — a self-crashing fake serve (SIGKILL) orphans a
detached fake chrome; the supervisor reaps that exact instance via pidfd (PASS). Plus pidfd instance-binding
safety: a dead instance's pidfd raises `ProcessLookupError`, so a reused pid is never signaled (PASS).

To run the eval serve under the supervisor: `python3 belmont-browse/tools/chrome-supervisor.py <profileDir>
-- <NODE> belmont-browse/src/serve.mjs <serve args...>`. The in-process reaper remains the fast path; the
supervisor is the kernel-backed backstop.

### Round-8 (GPT-6 Pro focused review of the supervisor) — mis-kill closed; residual documented

GPT reproduced real holes in the first supervisor cut. Fixed (test-chrome-supervisor.py now covers them):
- **Ownership mis-kill (reproduced: it SIGTERM'd another serve's control process)** → the supervisor now pins
  only a chrome whose owner record names OUR serve child (`owner.servePid == serve_pid`) and carries a
  start-ticks identity; a foreign serve's chrome is never pinned or killed. Regression: `test_ownership_no_miskill`.
- **verify→open TOCTOU (pid reused between the start-ticks check and `pidfd_open`)** → after `pidfd_open` we
  RE-READ the pid's start-ticks and confirm they still match; a wrong initial binding is closed and the fd
  dropped.
- **early-death orphan (chrome recorded then serve died before the next poll → orphan alive, exit 0)** → a
  final sweep after serve exit re-attempts the identity-verified pin+reap.

Still open (documented, not closed by this cut):
- **whole-tree stragglers**: the supervisor signals the root instance via its pidfd; a child that left the
  root's group (setsid) is not guaranteed reaped by the pidfd alone.
- **supervisor's own death**: if the supervisor is SIGKILLed, its cleanup does not run (no PR_SET_PDEATHSIG /
  scope tying the tree's lifetime to it). A cgroup/systemd scope (needs root/user-bus here) is the real fix.
- **A-1 lock**: the supervisor does not serialize the in-process owner lock; that still needs a kernel
  `flock` on a fixed file shared by all ownership paths.
- The in-process `createChromeTreeStop` raw pid/pgid path still has its own (narrowed) TOCTOU independent of
  the supervisor.

### Round-9 (GPT-6 Pro closeout) — a regression I introduced, then fixed

GPT reproduced two more holes caused by my round-8 cut overloading `serve_pid` with `None` on serve exit:
- **null/missing `servePid` mis-kill**: `None != None` was false, so an owner record with no servePid passed
  the ownership check and a foreign process was reaped.
- **valid-owner early-death miss**: after serve exit, the final sweep compared `owner.servePid != None` and
  rejected a legitimate owner (orphan alive, exit 0).
Fix: the forked `child_pid` is now IMMUTABLE, exit is tracked by a separate flag, and ownership requires
`owner.servePid` to be a valid integer equal to `child_pid`. Regressions added: `test_null_servepid_no_miskill`
(+ the existing wrong-integer `test_ownership_no_miskill`); supervisor tests 4/4. With these closed, the
remaining scope is again just **whole-tree stragglers / the supervisor's own SIGKILL / A-1 flock** (needs
root/cgroup) — a genuine external-architecture task.

Net: the **dangerous mis-kill** (killing an unrelated/foreign process) is closed at both layers; the core
accumulation defect stays fixed+proven; the remaining items are narrow reap-completeness/liveness gaps whose
full closure needs `flock` + a cgroup/systemd scope (root), tracked as the external-supervisor architecture task.

## Regression

`belmont-browse/test/chrome-orphan-ownership.test.mjs` — spawns a real detached sleeper as a stand-in
Chrome (no real Chrome/CDP needed), and asserts:
1. owner file with a **dead** servePid → decision `adopt`; the adopted stop actually terminates the
   process group (process is gone afterward).
2. owner file with a **live** servePid → decision `shared`; stop is a noop (process survives).
3. no owner file → decision `foreign`; stop is a noop (process survives).

## Round-10 (GPT-6 Pro) — re-pin miss fixed; flock claim corrected

GPT confirmed round-9's two supervisor defects are closed, and reproduced one more + a factual correction:
- **Chrome re-pin miss (fixed)**: the supervisor pinned Chrome A, then the SAME serve killed A and restarted
  as B (owner updated atomically to B); the supervisor kept the stale A-fd, saw A dead, and exited 0 leaving
  B alive. Fix: at serve-exit the AUTHORITATIVE reap target is the CURRENT owner file — discard the poll-time
  fd and re-pin from the current owner, looping to drain a chain of owned live chromes. Regression:
  `test_repin_reaps_current_chrome` (A→B same-serve restart → B reaped). Supervisor tests 5/5.
- **flock ≠ root (correction)**: my earlier notes said A-1 "needs root/cgroup". That is WRONG for the lock:
  `flock(2)` is **unprivileged**. Correcting the residual split:
  - **A-1 (owner lock)**: closable with **unprivileged `flock`** on a fixed shared lock file — no root. The
    current link-based lock is a valid unprivileged userspace lock whose only residual is a microsecond
    two-stealer window reachable solely by two serves starting concurrently on the SAME profile (not the
    eval workflow, which runs one serve at a time). `flock` is the clean strict upgrade; Node has no native
    flock binding, so it needs a small helper (flock CLI holder / addon) — still unprivileged.
  - **Only** the whole-tree-straggler reaping and the supervisor's own SIGKILL benefit from a **cgroup/
    systemd scope** (which does need root/user-bus here); those remain the genuine root-requiring items.

## Round-11 (GPT-6 Pro) — poll-fd leak fixed; wording corrected (no overclaims)

- **poll-fd leak (fixed)**: round-10's fix discarded the poll-time fd; GPT showed that if the owner file is
  DELETED between pin and serve-exit, re-pin fails and the pinned chrome A is orphaned (exit 0, A alive). Fix:
  reap the poll-pinned instance FIRST (it was verified ours; owner deletion must not orphan it), THEN reap the
  current owner + restart chain. Regression `test_polled_chrome_reaped_after_owner_deleted`. Supervisor 6/6.
- **wording corrected** (my overclaims, per GPT):
  - The link-lock residual is a two-concurrent-stealer race whose window is **NOT time-bounded** ("microsecond
    only" was wrong — scheduling can delay execution between stale-check and steal). Single-serve operation
    **avoids** the race but is **not a proof** of the lock's exclusivity.
  - **cgroup is not inherently root**: a *delegated* cgroup v2 subtree is usable unprivileged; only THIS
    environment's undelegated root requires root. And a cgroup does not auto-clean on supervisor SIGKILL —
    that still needs a **live external manager**.

## Agreed remaining scope (accurate, non-overclaiming)

Closed + regressed: the accumulation defect, and every supervisor misdirection/leak path found through
round-11 (mis-kill on foreign/null servePid, verify→open reuse, early-death, A→B re-pin, owner-deleted poll-fd).
Genuinely open (acknowledged, not disputes):
1. **A-1 owner lock**: fully closed by **unprivileged `flock`** on one shared lock file (all participants).
   Node has no native flock binding, so it needs a small helper; not yet implemented. The link-lock is the
   current valid unprivileged interim (residual: concurrent same-profile stealers, outside the eval workflow).
2. **whole-tree stragglers + the supervisor's own SIGKILL**: need a **live external manager** (a cgroup —
   delegated=unprivileged, else root — plus a survivor that reaps the scope). Not closable by the in-process
   reaper or a self-terminating supervisor alone.
