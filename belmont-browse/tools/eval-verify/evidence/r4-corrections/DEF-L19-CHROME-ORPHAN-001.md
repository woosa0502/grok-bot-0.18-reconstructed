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

## Regression

`belmont-browse/test/chrome-orphan-ownership.test.mjs` — spawns a real detached sleeper as a stand-in
Chrome (no real Chrome/CDP needed), and asserts:
1. owner file with a **dead** servePid → decision `adopt`; the adopted stop actually terminates the
   process group (process is gone afterward).
2. owner file with a **live** servePid → decision `shared`; stop is a noop (process survives).
3. no owner file → decision `foreign`; stop is a noop (process survives).
