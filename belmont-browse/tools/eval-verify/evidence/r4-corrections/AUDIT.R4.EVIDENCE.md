# AUDIT.R4.EVIDENCE — GPT-6 Pro round-4 priority-0

Reconciliation of two disputed R4 evidence artifacts against the actual harness math and
raw fields. Originals are preserved verbatim under `../r4-originals/`; corrections are written
separately (this directory) and never overwrite the originals. Neither disputed item is counted
as a functional PASS.

## 1. L19.RUNNING.NO_CLEANUP — `auto_re_exec_after_unattended_restart: true`

- **Original claim:** verdict `recovery=PASS (unattended, no re-exec)`, yet the evidence field
  `auto_re_exec_after_unattended_restart` was `true` — a direct self-contradiction
  (GPT verdict: `UNKNOWN_EVIDENCE_CONFLICT`).
- **Root cause (confirmed in code):** the field was computed as `int(hbCount) > 2`, where
  `hbCount` is the *static* heartbeat line count read once after restart. The count was `3`
  (2 pre-crash heartbeat lines + 1 in-flight partial line the crash left behind). `3 > 2` → `true`.
  A static count threshold does **not** measure re-execution. "Did the interrupted session
  re-execute?" is a question about **growth after restart** (post-restart delta > 0 over a fixed
  window), which the harness never recorded.
- **Correction:** the field is reclassified **UNVERIFIED**, not flipped to `false` — the preserved
  bundle saved only the boolean and a summary string (`recovered_status: "interrupted (see
  log/snapshot)"`) with **no raw heartbeat trace and no session snapshot**, so "no re-exec" is
  equally unprovable from it. `recovered_status` is likewise **UNVERIFIED** (summary-only).
- **Effect:** L19.RUNNING.NO_CLEANUP is **removed from the live-PASS set** until re-run in R5
  with (a) a raw heartbeat trace showing the post-restart delta and (b) an actual recovered-session
  snapshot. Independent observations unaffected by the miscomputation stand: the box-exec singleton
  (1337) self-freed on crash, and the crash leaked **36 orphan Chrome processes** — tracked as
  `DEF-L19-CHROME-ORPHAN-001`.

## 2. L18.QUEUED — `verdict_pass: false`

- **Original verdict `false` is CORRECT.** The pass formula is
  `bQueued && !bStarted && TERMINAL(bAfterStop) && cStarted && aStarted`. The raw field
  `aStartedMarker` was **`false`**, forcing `pass=false`.
- **Meaning:** A's `ASTART` marker was never observed, so A's occupation of the `maxConcurrent=1`
  slot is **unconfirmed**, and A was force-stopped rather than allowed to complete — so the
  "slot frees *naturally* when A completes normally" path was never exercised.
- **What still stands (narrow):** a task observed in `queued` state, once cancelled, did not start
  (`BSTART` never appeared; `bStatusAfterCancel=stopped`), and a later fresh session C ran to
  completion (`cStarted=true`, `cFinal=done`).
- **What is NOT closed:** the full gate — *a cancelled QUEUED task must never start even after the
  slot frees via A completing normally*.
- **Effect:** L18.QUEUED remains **not a full functional PASS**. Re-run in R5 with A confirmed
  started (`ASTART` observed) **and allowed to complete normally** so the slot frees on its own,
  then confirm the cancelled B still never starts.

## Net effect on the PASS ledger

Both L19.RUNNING.NO_CLEANUP and L18.QUEUED are withdrawn from the live-PASS set pending corrected
re-runs in R5. This does not affect the other live PASSes (G1/G2/G3, L01, L04, L13.NATIVE_WRITE
deny/allow/stale, L18 cancel-no-growth, L28/L29/L31), which have independent external-artifact
evidence.
