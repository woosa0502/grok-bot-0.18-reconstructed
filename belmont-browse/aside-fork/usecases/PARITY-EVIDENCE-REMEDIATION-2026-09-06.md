# Parity evidence remediation — 2026-09-06

Status: first independent review found two false PASS cases and a provenance overclaim; the corrected contract and regression evidence are recorded below. Final independent approval is recorded separately by the remediation coordinator. This document does not promote any historical Aside/Grok performance claim.

Scope: `test/parity/drive.mjs`, pure grading/fixture helpers, explicit read-only session observation, offline verification. All development checks used virtual time or an ephemeral task-owned fake HTTP server. No live gateway, browser, model, fixture port 18777, or ongoing parity run was used or modified. Historical result documents, JSON, logs and screenshots remain unchanged. The older `watch.mjs` is not this corrected harness and its `done` output is not completion evidence.

## What the new result means

The v2 result has separate fields:

- `execution.status`: `QUIET` means output became quiet and the host reported idle; `COMPLETED` additionally requires a fresh terminal state correlated to this prompt nonce; `TIMEOUT`, `ERROR`, `FAILED`, and `STOPPED` remain distinct. Reaching a deadline never stops the remote task.
- `verification.status`: `PASS`/`FAIL` only from an independent outcome oracle. No oracle, insufficient observations or unsupported text formatting gives `UNVERIFIED`. A model saying “PASS” is not an oracle.
- `verdict`: this implementation does not establish executed runtime identity, so an oracle `PASS` remains aggregate `UNVERIFIED`. Selected-file hashes, declared model labels and manually set `complete/unchanged` booleans cannot supply that missing identity. A confirmed fixture defect can still produce `FAIL`; supplied-observation correctness and aggregate runtime readiness are separate fields.
- `timing.firstAnswerMs`, `lastAnswerMs`, `terminalObservedMs`, `quietObservedMs`, `driverExitMs`: separate millisecond observations on a monotonic clock, starting immediately before prompt dispatch. Baseline collection and post-run hashing/oracle work are excluded. Polling resolution is not original server generation time. In-place streaming edits update the last-answer time.
- `interventions`: attempted and accepted automatic responses, external widget responses/dismissals observed in the transcript, and `otherHumanInterventions: not-observed`. The driver cannot establish zero outside intervention. Auto responses default off. Explicit answers must match an offered label/value; it never picks the first option as a fallback.

Actual Belmont bot output is `kind=send-message` with no role; normal user entries use `kind=message, role=user` and top-level content. The new parser handles these contracts, excludes remote-author messages, and also rejects message-shaped user text as an answer. The latter is a defensive regression case, not evidence that the current normal gateway was echoing user prompts as answers.

## Explicit target and provenance

No profile, gateway path, Aside port or browser port is assumed. A future authorized run against an isolated target takes an explicit gateway JSON (`port` and `token`) and a **new** result path:

```sh
node belmont-browse/aside-fork/test/parity/drive.mjs fixture-agent 'Fixture-only task' \
  --gateway-file=/absolute/task-owned/gateway.json \
  --out=/absolute/task-owned/new-result.json \
  --nonce=unique-fixture-run-id --quiet=5 --poll=0.5 --max=60 \
  --pin-file=/absolute/task-owned/runtime-source.mjs \
  --build-file=/absolute/task-owned/executed-build \
  --model-label=provider/model/effort
```

`--build-file` and `--pin-file` can repeat. Code and build files are SHA-256 hashed before and after observation. The `driverEnvironmentSha256` hashes only the driver's Node version, platform and architecture. `declaredModelLabel` is stored separately as an operator declaration, never as a verified execution fact. The full environment and credential file are not copied. `provenance.scope=selected-file-hashes-only` records hashes of the selected files; even selecting README.md as `--build-file` does not identify an executed build. `runtimeIdentity.status` remains UNVERIFIED and there is no supported runtime-attestation reader in this harness. Aggregate PASS is intentionally unavailable until such a reader is independently implemented and verified.

Result creation uses exclusive creation before sending the prompt, so an existing raw artifact prevents dispatch. Default output omits task/answer contents, widget values, HTTP error bodies and credentials. `--include-content=true` is an explicit choice for non-sensitive fixture answers needed by the structured audit oracle. API tokens remain only in request headers.

Original reported times can be retained with `--reference-seconds=7`; they are always labeled `UNCONTROLLED_REFERENCE`. No speed ratio or original-parity PASS is calculated. Original/fork comparisons need the same task and input state, model/effort, build identity, clock boundary, interventions, repetitions and outcome oracle. The historical “elapsed” figures must not be silently reinterpreted as last-answer time.

## Terminal-state observation

The host `sendPrompt` contract only returns `{accepted:true}`. Global `/health.isBusy=false` proves neither this prompt's success nor exact task completion.

Two explicit options exist:

1. `--aside-config-file=/absolute/task-owned/serve.json --aside-session-id=EXACT_ID` reads only `GET /sessions/EXACT_ID`. It captures id/status and excludes task/message/auth contents. The current Aside response has no prompt nonce; its state is therefore **unbound**. The driver does not manufacture a nonce from the prompt text, current profile or newest chat.
2. `--task-state-file=/absolute/task-owned/observer-state.json` consumes an independent observer's `{taskId, agent, clientNonce, status}`. The observer must establish the complete accepted prompt nonce → bot turn → actual Aside session mapping from independent records. Copying the driver's nonce into an arbitrary session observation is not valid evidence. Missing state is unknown; malformed state is an observation error. A session already `done` before dispatch is not accepted as this run's completion.

An injected `readTaskState` is available to isolated tests/integrations. This change does not add a new host/session correlation API or a live observer, so the current default live contract correctly remains UNVERIFIED even if an exact session says done.

## Independent fixture outcome oracles

The oracle is a declarative evaluator of independently collected raw data; it never drives the agent, imports the agent's page-reading code or treats the agent's verdict as a check. Browser collection must be a separate task-owned process controlled by the evaluator, not a file the tested agent is allowed to fill in. Collection was **not** performed on the user's running tests.

Before an oracle runs, `evidence-contract.mjs` validates accepted=true, nonempty agent/nonce/task hash, a finite ordered run window, matching prompt acceptance and terminal records, answer/quiet timing, event/state windows and the selected-file provenance schema. A schema-version label or caller-supplied booleans alone are insufficient. Undefined matching undefined, NaN, Infinity, missing admission, stale terminal and malformed hashes are rejected as UNVERIFIED with no oracle checks.

All input observations require:

- schema version 1 and source `independent-browser-observer`;
- the exact run agent, nonce, task SHA-256 and fixture SHA-256;
- observation coverage beginning before prompt dispatch and ending after driver exit, with no collection gaps;
- a final DOM snapshot at or after driver exit, on the named loopback fixture;
- full raw journals appropriate to the scenario.

Source/coverage fields are attestations. The evaluator does not authenticate a collector or protect against deliberately forged input files. Preserve the observer implementation, deployment/process ownership and raw logs for independent review; JSON labels alone cannot prove browser behavior.

### Form: `form-filled-unsubmitted`

Fixture: `test/adblock/page/form.html`.

Required observation structure (timestamps are illustrative):

```json
{
  "schemaVersion": 1,
  "source": "independent-browser-observer",
  "agent": "fixture-agent",
  "clientNonce": "unique-fixture-run-id",
  "taskSha256": "64-lowercase-hex-sha256-of-exact-task",
  "fixtureSha256": "64-lowercase-hex-sha256-of-exact-form.html",
  "coverage": {
    "startedAtEpochMs": 100,
    "endedAtEpochMs": 301,
    "gaps": [],
    "network": "all-requests",
    "dom": "final-snapshot",
    "inputEvents": "capture-click-submit-and-form-api",
    "formActions": "all-action-method-changes",
    "formSubmissions": "browser-navigation-and-form-api"
  },
  "snapshot": {
    "observedAtEpochMs": 301,
    "url": "http://127.0.0.1:YOUR_ISOLATED_PORT/form.html",
    "form": {"id": "contact", "action": "http://127.0.0.1:YOUR_ISOLATED_PORT/submitted.html", "method": "GET"},
    "fields": [
      {"name": "name", "value": "Test"},
      {"name": "email", "value": "test@example.com"},
      {"name": "phone", "value": "01012345678"},
      {"name": "kind", "value": "일반"},
      {"name": "message", "value": "Fixture inquiry"},
      {"name": "agree", "checked": true}
    ]
  },
  "requests": [],
  "inputEvents": [],
  "formHistory": [
    {"atEpochMs": 100, "formId": "contact", "documentURL": "http://127.0.0.1:YOUR_ISOLATED_PORT/form.html", "action": "http://127.0.0.1:YOUR_ISOLATED_PORT/submitted.html", "method": "GET"}
  ]
}
```

`requests` contains `{atEpochMs, method, url, documentURL, resourceType, isFormSubmission}` for every request, including failed requests. The form-submission fact must come from browser navigation/form API observation, not an endpoint-name heuristic or a constant false. A true form submission fails regardless of its URL, host, method or submitter override: POST to `/other-sink` is caught. `formHistory` starts before dispatch and records every action/method change; its last state must agree with the final DOM. Changing either action or method fails this fill-only task. `inputEvents` records click, submit, submit-call and request-submit-call, including attempts blocked by client validation. Every journal timestamp must be finite, ordered where applicable and inside coverage. Missing submission facts, action history, DOM state or collection windows gives UNVERIFIED, not zero submissions. The six fields must actually be filled, email/kind must be valid, and the submit button/form must never be activated.

### Read-only audit: `page-readonly-audit`

Fixture: `test/adblock/page/index.html`. The observer supplies complete console events, image completion/natural-width facts, scroll/client widths, visible H1/title, before/final DOM hashes and attributed mutations. It must record `coverage.console=all-events`, `coverage.dom=before-and-after`, plus `beforeSnapshot.observedAtEpochMs` no later than dispatch. Unattributed changes or changed DOM with an empty mutation journal are UNVERIFIED.

The task's final answer must be a JSON object with `title`, `h1`, `brokenImages` (count), `horizontalOverflow` (boolean), `consoleErrors` (count). Each reported value is compared with the raw observation. Correctly reporting a real broken image or console error can pass the audit; blindly reporting all PASS cannot. The evaluator separately rejects agent-caused DOM changes. The fixture's own scripts can change the DOM and must be attributed as page activity. Historical freeform PASS tables do not automatically satisfy this structured contract.

### Offline grading

The preferred sequence is observation → stop/save independent observer after driver exit → offline grading into a **new** artifact:

```sh
node belmont-browse/aside-fork/test/parity/verify.mjs \
  /absolute/task-owned/new-result.json \
  /absolute/task-owned/observer-evidence.json \
  form-filled-unsubmitted \
  /absolute/task-owned/new-verified-result.json
```

Offline grading has no network access or browser actions. It preserves the source result, hashes both inputs and the verifier, and cannot upgrade a legacy v1 result that lacks the measurement contract. The optional driver's `--oracle=... --evidence-file=...` path is intended for an observer that can supply complete coverage when observation ends; insufficient/stale files remain UNVERIFIED, not implicit zero failures.

CLI exit codes: 0 is reserved for a future independently supported aggregate PASS; 2 UNVERIFIED; 1 failure/error/timeout/stopped. Current selected-file provenance cannot produce exit 0 even when the fixture oracle passes. Correctness and original-product parity remain separate claims.

## Reproduce isolated verification

From the remediation checkout:

```sh
PARITY_EVIDENCE_ARTIFACT_DIR=data/artifacts/parity-remediation-20260906/evidence \
  node --test tests/parity-evidence.test.mjs
```

The focused suite includes original-driver replay under a fake gateway/virtual clock, real transcript shapes, timing revisions, rejected widgets, automatic/external interventions, unbound/stale terminal states, failure/timeout distinctions, missing/mismatched evidence, six-field form failures, prevented submit attempts, misleading model PASS, negative audit findings, changing file hashes, no-secret output, and exclusive result preservation. The only actual HTTP listener is allocated with `listen(0)` and closed by its own test.

Artifacts: `data/artifacts/parity-remediation-20260906/evidence/focused-tests.log`, `before-after-replay.json`, and `drive.before.mjs`. These verify the harness behavior under isolated controls; they do not rerun or validate the live Aside product.

## Independent review remediation — round 1

The first verifier reproduced two false PASSs: a skeletal v2 object with missing identity/timestamps, and a form POST to an alternate endpoint. Both were reproduced before changing the code; `evidence/review-round1/before-false-pass.json` records the earlier PASS results.

The new run contract rejects 30 malformed-record variants before any oracle runs. Browser-observed submission facts, action/method history and programmatic form calls reject alternate-sink submission or incomplete evidence. README.md hashes plus an arbitrary model label remain explicitly selected-file provenance; the fixture observation can pass while aggregate runtime verification stays UNVERIFIED.

Round-1 artifacts under `data/artifacts/parity-remediation-20260906/evidence/review-round1/`: `focused-tests.log`, `invalid-record-regressions.json`, `submission-regressions.json` (raw fixture inputs and results), `selected-file-provenance-regression.json`. The corrected focused suite has 22 tests. These are isolated controls, not a replay of the user's live product tests.

## Text integrity review — round 2

Included `task` and `final` strings must match their recorded SHA-256 values before grading. The page oracle additionally requires actual final text bound to `finalSha256`; missing text is UNVERIFIED, not a fabricated/default answer. A text-only edit can no longer turn an incorrect reported console-error count from FAIL into PASS while retaining the original event/hash record. This is internal evidence consistency, not authentication against somebody deliberately replacing the entire record and its hashes.

`evidence/review-round2/text-integrity-regressions.json` records the incorrect original answer (FAIL), text-only final/task tampering (UNVERIFIED before oracle), and a correctly recorded answer control (oracle PASS). The focused suite passes 23 tests on Node 26.8.1. Source changes were frozen after this focused verification; broader checks remain owned by the coordinator.
