# R6 — chrome re-fix (B1–B5), stricter harness, FINAL_REAP (answering GPT-6 Pro round-5)

Round-5 withheld sign-off on the chrome fix (five reproduced defects B1–B5), flagged false-PASS conditions in
the R5 harness, and corrected the L13.BROWSER framing. R6 closes the code defects, tightens the harness, and
proves the acceptance criterion GPT set. Source `chrome.mjs` + `browser-lifecycle.mjs` re-hardened; regression
`test/chrome-orphan-ownership.test.mjs` now covers B1–B5 (10 tests, all green; full lifecycle suite 21/21).

## Chrome re-fix (B1–B5)
- **B1** owner file deleted on shutdown *timeout* → now cleared only on confirmed full-tree exit AND generation match.
- **B2** adopted stop waited only on the root pid → now reaps the whole process **group**; SIGTERM→SIGKILL escalation continues until the group is empty (TERM-ignoring child covered).
- **B3** CDP-verified pid discarded, different owner pid killed → adopt now re-verifies identity (generation + start-ticks + CDP browser pid) right before killing; mismatch aborts without killing.
- **B4** `pgid` only integer-checked → group signals require **pgid>1**; otherwise fall back to the bare pid (never `kill(-1)`/`kill(0)`).
- **B5** no atomicity/locking → atomic owner file (temp→fsync→rename) with a generation token; per-profile lock (CAS) around read→plan→write; `planReuseOwnership` adds an **unknown** mode (corrupt / malformed servePid / reused pid ⇒ never touched); owner recorded immediately after spawn (spawn→ready gap closed).
- Also fixed a self-introduced bug: the graceful-wait phase used to consume the whole timeout budget and starve escalation → each phase now has its own bounded window and a refused graceful close is not waited on.

## Live evidence (real 909 serve, Aside chromium, mode:guard)
- **ev-l19-nocleanup-r6.json** — L19.RUNNING.NO_CLEANUP, STRICT formula = PASS. read-success required + exact BOOT 1→1; new serve pid == the spawned pid; full recovered snapshot preserved; recovered `interrupted`; **real host census** replaces the bogus `orphan_bounded` — single root browser, tree 34→34 (no accumulation); 8s observation window recorded.
- **ev-l19-chrome-finalreap-r6.json** — L19.CHROME.ADOPT.FINAL_REAP = PASS. crash → restart adopts same tree → **normal serve stop reaps the entire owned tree** (eval-profile census root=0/tree=0), owner cleared, and an unrelated **control browser survives**. This is GPT's acceptance criterion (not "adopt logged", but proven final tree cleanup with a survivor).
- **ev-l18-queued-r6.json** — L18.QUEUED, STRICT formula = PASS. Closes the three holes: `aRunningObserved` is required, B-after-cancel must be exactly `stopped`, and BSTART is re-checked **after C completes**.

Drivers are the exact scripts used, kept for re-run. Docs corrected: L13 finding downgraded to
`POLICY_CONTRACT_UNVERIFIED / NOT_EXERCISED` (r5/DEF-L13…md); DEF-L19 doc corrected ("36 ≠ 36 instances",
re-hardening + FINAL_REAP); AUDIT.R4 heartbeat-signal note added.
