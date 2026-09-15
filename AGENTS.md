# Belmont

## Naming — 리니어 (Linear) / 브라우저 (Browser)

Our own names for the two parts (use these in conversation, docs, and UI):
- **리니어 (Linear)** = the grok-bot base (this repo, `grok-bot-0.18-reconstructed`) — main runtime where **Belmont and the team bots**, gateway, memory, host, and PWA live. Belmont is a 리니어 agent.
- **브라우저 (Browser)** = Aside (`belmont-browse/` + reconstructed Aside daemon) — browser-automation layer bolted on; bots link to an Aside browse session for web/desktop work. Desktop-control/Computer-Use discussion = this 브라우저 side (macOS-only; real Windows control is ours to build).

Internal code/dir names (grok-bot, aside, belmont-browse) stay as-is; rename only in talk/docs/UI. Full note: `belmont-work/NAMING.md`.

Belmont reconstructs and extends Grok Bot 0.18. Runtime TypeScript is in `source/`: `electron-main/` owns Electron lifecycle, `electron-preload/` the trusted UI bridge, `host/` inference and tools, `node-agent-coordinator/` routing, and `shared/` contracts. `frontend/` is the editable React renderer; the packaged renderer is separately checksum-pinned. `belmont-browse/` contains the Aside browser integration. `grok-mobile-belmont-pwa/` has a separate Git boundary; check its status before editing it.

## Context and live state

- For continuing runtime or Aside work, consult the relevant part of `NEXT_SESSION.md`; its dated process IDs and status are historical until checked live. For Aside engine upgrades, use `belmont-browse/docs/UPGRADE.md`.
- Before actions that affect a running stack, identify its current processes, ports, and ownership. Preserve tmux `belmont-bot`, browser profiles, `belmont-browse/.state/`, `.cache/belmont-wsl-profile/`, and mobile sessions unless the requested action authorizes changing them. Rebuilding a shared runtime can affect the next launch even without a restart.
- Source edits and passing tests establish source behavior. A deployed claim also needs the actual build/runtime lineage; phone/PWA acceptance needs the user-visible result. For parity audits, distinguish official capability, implementation, production wiring, and actual execution.

## Development and verification

Use Node from `.node-version` (26.5.x); the shell may otherwise select Node 22. Follow existing ESM, strict TypeScript, two-space indentation, double quotes, semicolons, and naming conventions. Install the locked graph with `npm ci` when dependencies need installation.

- Runtime/routing/WSL changes: run the affected `node --test tests/<name>.test.mjs` regression, then `npm run check` before handoff.
- Editable frontend changes: run `npm run typecheck` and `npm run frontend:build`; observe the affected UI. Include `npm run check` when shared contracts or runtime behavior change.
- Aside browser changes: run the relevant suite for `belmont-browse/`; run the aggregate `npm run test:browser` from the Belmont root; use the upgrade guide for native build or bundle changes.
- Mobile changes: use the nested project's scripts and applicable instructions; `npm run mobile:check` checks source from the parent.
- Documentation or Codex instruction/configuration changes: inspect the diff, paths, syntax, and actual configuration loading as applicable. Application builds are unnecessary unless application behavior or build inputs changed.
- Packaging/publication changes: use the relevant `npm run package` or `npm run publication:check` workflow. Do not weaken checksums, bundle identity, signing, or clean-export checks to obtain a pass.

Local tests with disposable fixtures can be run, fixed, and rerun within the task without repeated approval. Check scripts before running a test that targets a live service. Add regressions for changed behavior where they catch a real failure; avoid tests that merely duplicate prose or implementation.

## Repository hygiene

Put Node regressions in `tests/`, docs in `docs/`, and pinned reconstruction metadata in `manifests/`. Keep commits focused and describe the affected boundary and validation in PRs; include screenshots for visible changes. Do not commit generated `.build/`, `.cache/`, `dist/`, `src/app/dist/`, credentials, or local forensic evidence. Preserve other contributors' edits.
