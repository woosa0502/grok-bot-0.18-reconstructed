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

## Regression

`belmont-browse/test/chrome-orphan-ownership.test.mjs` — spawns a real detached sleeper as a stand-in
Chrome (no real Chrome/CDP needed), and asserts:
1. owner file with a **dead** servePid → decision `adopt`; the adopted stop actually terminates the
   process group (process is gone afterward).
2. owner file with a **live** servePid → decision `shared`; stop is a noop (process survives).
3. no owner file → decision `foreign`; stop is a noop (process survives).
