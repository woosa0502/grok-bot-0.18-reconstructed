# Belmont strict remediation and personal workflow completion

Date: 2026-09-08

Baseline commit: `858c16f090de8b3a0624741842bd7a28a9f817e3`

Verdict: `VERIFIED_DEPLOYED` for the stated personal workflow, with separately scoped source and runtime limits below.

## Completed scope

This change set combines the September 8 strict Grok Bot remediation candidate with the verified personal Belmont workflow deployment. It covers the host, renderer, preload, local execution, persistence, automation, memory, search, workflow import, packaging lineage, and focused regression tests that were changed during those campaigns.

The deployed personal workflow was verified on the existing WSL profile with the editable renderer and local Pi route. The operational host, Electron app, and Windows-served PWA were observed after deployment without replacing the user's profile or PWA sessions.

The following user-visible flows were observed:

- local Pi Read, Shell interruption, continuation, image, and PDF turns;
- per-bot desktop allocation, input separation, VNC frame refresh, and cleanup;
- Grok Bot template adaptation into a local skill and paused routine with isolated bindings;
- normal Electron rendering and shutdown, including the recovered sidebar and notice layout;
- explicit Retry after an ordinary transport outage, followed by one `RETRY_OK` response;
- the deployed PWA at `http://127.0.0.1:4173` in visible Chrome at 390x844 and 1280x900, including composition guards, Shift+Enter, file selection, one user message and response, browser-history draft retention, and post-reply offline/online duplicate stability;
- acknowledged state and attachment recovery across task-owned host SIGKILL/restart cycles.

## Verification

The final personal deployment candidate passed its required checks:

- `build/check-v5-status.json` records `npm run check` exit 0. Its log records 962 root tests passed and 143 mobile tests passed, with two isolated optional UI tests skipped.
- `build/frontend-v4-status.json` records `npm run frontend:build` exit 0.
- `build/mobile-v4-status.json` records the mobile source build exit 0.
- personal candidate-v3 and candidate-v4 both record combined source identity `45e916e6272a44e296d28ac51228328ed39df4a98d43e48aecaaad57b9836f11`; the deployment status names candidate-v4 as the promoted candidate.
- candidate-v4 was prepared with stable before/after source identity and clean host/main activation checks, without a blocked fallback.

The earlier strict-remediation campaign has its own final checks, accepted editable build, runtime smoke, and independent recomputation under `data/artifacts/grok-strict-remediation-20260908/`. Those measurements describe the pre-personal strict candidate and are not the deployed personal candidate's lineage.

Independent refute-by-default reviews confirmed the scoped runtime, persistence, UI, automation, memory, search, file mutation, media, workflow, deployment lineage, Retry, and PC PWA observations recorded in the campaign evidence. The initial PC PWA Shift+Enter failure is retained: its CDP probe used `rawKeyDown` without text, so Chromium did not perform default textarea insertion. A corrected `keyDown` observation produced a newline and zero message POSTs.

## Operational state

At the final deployment observation:

- supervisor PID `1245562` owned runner `1245574`, host `1245638`, and Electron `1245798`;
- host `http://127.0.0.1:44810/health` returned healthy for PID `1245638`;
- Windows PWA PID `30592` served localhost port 4173;
- the canonical imported bot was `2e8e5c41-af17-40e0-94cc-67392854c5ce`;
- the reusable Windows launcher was `C:\Users\HOON\Desktop\Belmont-Personal.bat`;
- existing Aside services, profiles, and ports were preserved.

These process identifiers are a recorded deployment snapshot and may change after a later restart. After the deployed source identity was captured, this commit added documentation, began tracking the previously local-excluded PWA source tree, and removed one extra EOF blank line from each of two PWA source files to satisfy `git diff --check`. The tracking operation did not change file bytes, and the EOF normalization does not change runtime behavior. No rebuild or operational restart was performed for those final commit-preparation changes, so the commit identity must not be presented as the already running binary's source fingerprint.

## Evidence and recovery

Primary local evidence, intentionally excluded from Git:

- `data/artifacts/grok-strict-remediation-20260908/REPORT.md`
- `data/artifacts/grok-strict-remediation-20260908/final-evidence-verdict.json`
- `data/artifacts/grok-strict-remediation-20260908/candidate-source-manifest.json`
- `data/artifacts/grok-strict-remediation-20260908/build/accepted-editable-v3-build-summary.json`
- `data/artifacts/grok-strict-remediation-20260908/build/accepted-workflow-smoke-v3/summary.json`
- `data/artifacts/personal-workflow-closure-20260908/REPORT.md`
- `data/artifacts/personal-workflow-closure-20260908/HANDOFF.md`
- `data/artifacts/personal-workflow-closure-20260908/remaining-verification/RECONCILIATION.md`
- `data/artifacts/personal-workflow-closure-20260908/pwa-pc-verification/REPORT.md`
- `data/artifacts/personal-workflow-closure-20260908/pwa-pc-verification/reconciled-result.json`

The pre-apply recovery archive is `.cache/personal-deployment-backups-20260908/before-apply.tar`, with SHA-256 `59fab94f6b887c3cbdb6232aa47cfb5339704eb385736d89165178a5b4cedcb4`. The previous staged runtime and PWA distribution are retained at `.build/belmont-editable-runtime.candidate-v3-before-v4` and `grok-mobile-belmont-pwa/dist.before-personal-deploy-20260908`.

The PWA source tree had only a workspace-local `.git/info/exclude` entry and is not a separate Git repository or submodule. Because the root package scripts build and test it as a repository input, this commit explicitly tracks its complete operational source: configuration, documentation, public runtime assets, scripts, application source, server modules, and tests. Generated distributions, screenshots, historical artifacts, sessions, caches, logs, and credentials remain excluded.

## Limits

The PC PWA input checks used synthetic CDP composition/key events and DOM file selection. They do not establish native Android or native OS IME behavior. Offline mode was applied after the assistant reply, so offline-submit replay remains unverified. The captured Computer screen reached `Connecting`; it proves navigation and rendering, not a completed remote-desktop connection.

Physical Android keyboard and Back/gesture behavior and power-loss recovery remain unverified. The persistence experiments used controlled SIGKILL/restart, not power removal. The source campaign also retains its documented provisional boundaries for the independently blocked main coordinator delivery/retry and Aside upgrade review; those results are not promoted here beyond their evidence.

Existing credential refresh, connector degradation, missing `csnaps`, D-Bus warnings, and the coordinator disposal warning observed in the isolated smoke remain recorded limitations. No live-provider, macOS, or Docker platform acceptance claim is made.

## Handoff

Read the personal workflow `REPORT.md` and `HANDOFF.md` paths above before changing the running deployment. Preserve `.cache/belmont-wsl-profile`, PWA session files, the Windows PWA ownership checks, and the existing Aside processes. Rebuild and restart only when a later behavioral source change needs deployment; the final documentation, tracking, and EOF-normalization changes in this commit do not require it.
