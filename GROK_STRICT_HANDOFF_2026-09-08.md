# Grok Bot strict remediation handoff — 2026-09-08

Start with [the campaign report](data/artifacts/grok-strict-remediation-20260908/REPORT.md) and [machine-readable status](data/artifacts/grok-strict-remediation-20260908/status.json). Those task-local artifacts carry the latest verification verdict, pending gates, exact evidence and limitations. This pointer file is fixed before the final source-identity capture so that completing the report does not invalidate the built checkout.

The user authorized direct improvements in the current Belmont checkout based on `858c16f090de8b3a0624741842bd7a28a9f817e3`. Existing `transcript-manager.ts` edits are preserved separately. Source changes and fixture validation do not authorize a live restart or establish complete upstream Grok parity. Deployment status is recorded separately in the report.

Read next:

1. `data/artifacts/grok-strict-remediation-20260908/PREREG.md` — scope, acceptance criteria and preservation boundaries.
2. `candidate-source-manifest.json`, `tracked-source.patch`, `candidate-source-files.tar.gz` — final hashes, tracked changes and current source files, including the separately ignored mobile tree. The archive is a change snapshot for the stated base checkout, not a standalone application or an automatic apply command.
3. `final-check-status.json`, `final-check.log`, `frontend-build-status.json` and the final selected build/runtime evidence in `REPORT.md` — exact validation observations. Earlier failed or drifting runs remain available and must not be substituted for final acceptance.
4. Component reports selected by `REPORT.md` — original reproducers, independent controls, scope limits and excluded reviews.

Reproduce source checks with Node 26.5.0 from this repository root. Preserve existing evidence first; the task supervisor uses label-based log filenames:

```sh
python3 data/artifacts/grok-strict-remediation-20260908/run-validation.py next-check npm run check
python3 data/artifacts/grok-strict-remediation-20260908/run-validation.py next-frontend npm run frontend:build -- --outDir /tmp/belmont-strict-next-frontend
```

The final build report gives the exact fixture commands and outputs. Do not run `wsl:setup`, `wsl:start`, packaging/signing, account operations or provider inference as substitutes for the isolated reproduction.

Preserve existing profiles, DBs, credentials, Aside and externally owned services. The initial protected process and port inventory is in `PREREG.md`; later observations and the limits of preservation evidence are in `REPORT.md`. Do not terminate a process merely because an old PID appears in these documents. Only task-owned fixture processes have cleanup authority. Externally authored Aside restoration tests and the baseline external docs/scratch tree are excluded from this campaign's edit attribution.

No governance file, dependency installation, Git commit or live deployment is implied by this handoff. Any relevant source drift, failed pinned case or mismatched running artifact reopens the affected verification gate. The report distinguishes verified source cases, provisional corrections and unverified external acceptance.
