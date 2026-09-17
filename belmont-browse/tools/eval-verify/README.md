# eval-verify — live G4–G7 verification harness (dev/test only)

Verifies the learn-measure / procedure-evaluation completion→cost→publish→terminate path against a real 909
engine, using an **external-artifact** observer (not the worker's status/answer). Dev profile + dev knowledge +
a local form server only — no real booking/payment/messaging, no operational data.

## Pieces
- `form-server.mjs` — local "booking form". Records what each trial actually submits, keyed by a per-trial
  token the observer rotates. Agent-facing `/page` (shows the token) and `/submit`; control `/control/reset`
  and `/control/observation` require the shared secret (`FORM_CTL_SECRET`) the observer holds, so a trial
  cannot reset or read the observation. This is the artifact the observer grades.
- `form-observer.mjs` — resettable `--verify` module. `beforeTrial` rotates/clears the form (token); `verify`
  reads the form server's received submission for THAT token and grades destination==NYC, seat==aisle,
  actually submitted. Never reads status, final answer, or a success string. Token match ties the observation
  to this exact trial, so a prior run's result can't be reused as success.
- `verify-live-g4g7.mjs` — driver. Cases: `g4g5-run1` (champion vs good candidate), `g4g5-run2` (champion vs
  a candidate that ends `done` without submitting), `g7-timeout`, `g7-suspended`, `g7-lostcreate`.

## Run (inside a maintenance window; the live bot is stopped first)
1. Start the eval-verify serve (see `belmont-browse/tools/verify-eval-isolation.sh` → LIVE recipe;
   `BELMONT_BROWSE_SITES_OVERLAY=1`, dev `BELMONT_KNOWLEDGE_DIR`). Confirm `readIsolation=true` +
   `sitesOverlay:true` + the bundle sha match the verified target before running.
2. `FORM_CTL_SECRET=<rand> FORM_STATE_FILE=/tmp/form.json node belmont-browse/tools/eval-verify/form-server.mjs &`
3. `FORM_STATE_FILE=/tmp/form.json FORM_CTL_SECRET=<same> BELMONT_KNOWLEDGE_DIR=<dev knowledge> \
    node belmont-browse/tools/eval-verify/verify-live-g4g7.mjs <case> <out.json>`

## Scope honesty
- These cases run against real 909 (real sessions, real tools). Record actual calls/errors/time — do not target
  a cost number and do not re-run to cherry-pick a favorable outcome. "Same goal met but not cheaper → REJECTED"
  is a correct result.
- The full G4/G5/G6/G7 **logic** matrix (drift-abort, publish-fail vs post-publish-audit-fail, comms failure,
  unconfirmed stop, ambiguous-POST-no-retry, success-string-cannot-fabricate-success, error/critical gates) is
  covered offline by `belmont-browse/test/procedure-evaluation.test.mjs` with an equivalent external-artifact
  observer; reuse those results labeled **offline**, never relabelled as live.
