# R5 live re-runs — closing the AUDIT.R4 evidence debt

Run against the real 909 eval serve (Aside chromium `out/aside/chrome`, engine 1.26.909.1820, CDP 9333,
daemon 21420, serve 9360; dev profile + dev knowledge; `mode:guard`, `autoApprove:false`). Evidence is
external artifacts (per-session marker files) + process/owner-file state, never the worker's status text alone.

## ev-l18-queued-r5.json — L18.QUEUED (full gate) — PASS
Closes the R4 gap (`aStartedMarker=false`, A force-stopped). Here A starts (ASTART marker) and is observed
running, then **completes normally** (status `done`, ADONE marker) so the `maxConcurrent=1` slot frees on its
own; a B cancelled while `queued` never starts (BSTART marker absent even after the slot frees); a fresh C runs
to completion. Driver: `verify-l18-queued-r5.mjs`.

## ev-l19-nocleanup-r5.json — L19.RUNNING.NO_CLEANUP — PASS
Closes the R4 `UNKNOWN_EVIDENCE_CONFLICT`. Re-execution is measured by a `BOOT-<nonce>` marker the session
writes ONCE at bash start (immune to the SIGKILL-orphaned-child heartbeat confound): `bootBefore=1`,
`bootAfter=1` → **no re-execution**. The recovered session is captured as a real snapshot: `interrupted`
(`resumed:null`, `error:null`). The run also live-validates DEF-L19-CHROME-ORPHAN-001: SIGKILL the serve →
Chrome orphaned (owner serve dead) → unattended restart **adopts** the same Chrome (`adoptLogged`,
`ownerAfter.adoptedFrom=<dead serve>`, `freshChromeStarted=false`, and serve.json now records the adopted pid).
Across the R5 runs the one Chrome (pid 1540795) was adopted through four serve generations as exactly one
process — never leaked. Driver: `verify-l19-nocleanup-r5.mjs`.

Both drivers are the exact scripts used, kept for re-run. They read `belmont-browse/.state/serve.json` and drive
`procedure-evaluation.mjs`'s evaluation API against the live serve.
