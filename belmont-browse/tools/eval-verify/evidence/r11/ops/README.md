# R11 ops batch — L46–L50 (maintenance-window / operations O1–O5)

The user asked for the full live verification "유지보수 창 포함" (including the maintenance window). These are the
plan's operations rows (belmont-gptpro-feature-test-plan lines 333–337). CORRECTION of the earlier map: they are
DEFINED, not "undefined". Each was progressed against its real code. These are OFFLINE integration tests (they
spawn the REAL daemon/owner, exercise the REAL installation/upgrade/drain code) — distinguished from LIVE product
runs the same way L12/L27 were. Where a piece genuinely needs an artifact we don't retain (a clean upstream daemon,
a signed update package), it is reported as a bounded finding/gap, not rubber-stamped.

| Row | Plan (O#) | Test(s) | Result |
|-----|-----------|---------|--------|
| L46 | O1 build/provenance, identity, duplicate-ownership | build-provenance-contracts (3/3), aside-native-build-identity (5/5), upgrade-resume-ownership (28/28) | **PARTIAL** (contract tests 36/36; real build→start→PID/provenance linkage not directly run) |
| L47 | O2/S4 box-exec-daemon owner lifecycle | box-exec-daemon-owner-lifecycle (4/4) | **PASS 4/4** (real daemon spawn) |
| L48 | O3 installation identity / key files | linux-installation (9/9) | **PASS 9/9** |
| L49 | O4 daemon patch/re-patch/anchor/start | reconstructed-updater-guard (1/1) + daemon-patch-contract | **PARTIAL (finding)** |
| L50 | O5/H7 quiesce→drain→update/reset→resume | aside-process-signal-drain (9/9) + upgrade-resume-ownership (28/28) | **PARTIAL** (drain/resume PASS; binary swap BLOCKED) |

## L46 — build / provenance / identity / duplicate ownership = PARTIAL (corrected per GPT)
Plan (line 333): clean-profile REAL build/start; make source/build identity differ; start the same profile twice →
only the correct build starts, mismatch/duplicate-ownership rejected, PID/binary/lineage consistent.
- **Contract tests = PASS 36/36**: `build-provenance-contracts` (3/3) — renderer runtime selection isolates
  pinned vs editable output+profile; editable staging REJECTS missing / substituted / artifact-mode renderer bytes
  (sha256 "staging drift"). `aside-native-build-identity` (5/5) — native build identity contracts. But its fixtures
  are 4KB byte arrays + a test daemon string (`aside-native-build-identity.test.mjs:8-24`), NOT a real Chrome
  binary. `upgrade-resume-ownership` (28/28) — duplicate/concurrent ownership → ONE attempt per agent (runner and
  neighbouring boundaries are doubles).
- **NOT directly performed**: the clean-profile REAL build/start → running PID/binary/provenance MATCH → reject
  mismatch/duplicate-start, end to end. The r10 recovery/supervisor work (per-profile flock single-ownership,
  chrome-supervisor identity/lineage, duplicate-start rejection) is SUPPORTING evidence but not the build→run
  linkage. Next: connect a real dev build/start's manifest + logs + PID as evidence.
- **Overall L46 = PARTIAL**: contract tests pass; the full build→start→provenance linkage remains.

## L47 — box-exec-daemon owner lifecycle = PASS (4/4)
Plan O2/S4: kill the owning Host before-ready / after-ready / during-shell-exec; daemon, shell and owned socket
must ACTUALLY terminate (not judged by ready-log alone). `box-exec-daemon-owner-lifecycle.test.mjs` compiles and
spawns the REAL box-exec-daemon + owner on an OS-assigned ephemeral port (never the live 1337):
- host SIGKILL releases the real daemon port and permits a fresh owned startup (repeated cycles);
- owner disconnect BEFORE daemon readiness leaves no listener;
- standalone daemon (no IPC) stays available until an explicit SIGTERM, then the port is released;
- owner death terminates its TERM-ignoring python descendant and closes an unfinished HTTP request (linux).

## L48 — installation identity / key-file handling = PASS (9/9)
Plan O3: concurrent first-start, normal restart, corrupt/incomplete key files → same identity reused; no silent
key reissue, no partial key adoption, no private-key log exposure. `linux-installation.test.mjs`:
- distinct persistent KEM preserves browser identity + native DER signatures;
- secure items survive restart, REJECT tamper / wrong identity, preserve corruption;
- mismatched private/public JWKs FAIL before signing or ECDH (no partial key adoption);
- whole transaction rolls back and re-enters; kernel transaction lock releases on SIGKILL preserving last commit;
- patch upgrade is idempotent and removes false Linux shortcuts; concurrent init/status never resets identity.

## L49 — daemon patch/re-patch/anchor/start = PARTIAL (bounded finding)
Plan O4: on a secured daemon copy, patch→re-patch→anchor-variant→syntax-check→real start; re-apply bytes unchanged,
wrong anchor fails preserving original, capability actually runs after start. See `l49-daemon-patch-contract.json`.
- **Verified on the real shipped aside-909 bundle**: bundle is SECURED (present → not BLOCKED); wrong-anchor FAILS
  CLOSED with no partial output written; shipped bundle is valid syntax (`node --check`); real start + capability
  actually runs (cited from the live harness r10 — the serve runs THIS bundle and its memory/eval/browser
  capabilities were verified live).
- **Finding (not a pass)**: the in-tree `patch-daemon.py` cannot RE-APPLY to the shipped 909 bundle — its memory-
  tool re-apply assertion expects `__belmontMemorySearch({accountId:Cn.accountId,…{queries:` but the shipped bundle
  carries the older `…{accountId:Cn.accountId,…` shape (patcher/artifact version skew). This is NOT a runtime
  defect (the serve consumes the bundle pre-patched and never re-patches it), but L49's "re-apply bytes unchanged"
  cannot be demonstrated on the shipped bundle, and the repo retains no clean upstream daemon to run the canonical
  clean→patch→re-patch cycle. Next step: re-obtain a clean Aside 909 daemon, or realign patch-daemon.py's memory
  re-apply anchor to the shipped bundle's shape.

## L50 — quiesce → drain → update/reset → resume = PARTIAL (corrected per GPT)
Plan O5/H7: quiesce, drain in-progress work, update/reset, resume; fail at each stage; running version/files/queue
state consistent; a failure is never marked complete and no duplicate work runs.
- **drain/resume CONTRACT = PASS**: `aside-process-signal-drain` (9/9) — signals await cleanup with the original
  signal-exit; a startup signal stays OWNED until cleanup finishes; a handle outliving the finished shutdown does
  not keep the process alive. `upgrade-resume-ownership` (28/28) — startup/run/getRunner/enqueue failure RETAINS
  the durable marker and retries exactly ONCE (failure not marked complete); a quiesced result keeps durable
  recovery without retrying inside the attempt; concurrent startup/direct/recreate calls share ONE attempt per
  agent; `resumeAfterRecreate([id,id]) → {resumed:0}` (no duplicate work).
- **real binary swap = BLOCKED** (not "an extra"): `aside-process-signal-drain.test.mjs:20-56` wires a fixture
  engine to the real adapter — it proves shutdown-ownership + drain, NOT swapping a real binary via a signed update
  package. Plan line 337 also requires the post-update running version/files/queue-state match and per-stage
  failure consistency, which needs a signed test update package we do not have.
- **Overall L50 = PARTIAL**: drain/resume contract PASS, real signed-package binary swap BLOCKED. (Corrected from
  the earlier "PASS with binary swap as an extra" framing.)
