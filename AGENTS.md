# Repository Guidelines

## Project Structure & Module Organization

This repository reconstructs and extends the Grok Bot 0.18 desktop app. Runtime TypeScript lives in `source/`: Electron lifecycle code is under `electron-main/`, the trusted UI bridge under `electron-preload/`, inference and tools under `host/`, routing under `node-agent-coordinator/`, and shared contracts under `shared/`. `frontend/` is the editable React/TypeScript reconstruction; it is not the checksum-pinned packaged renderer. Build, packaging, recovery, and verification utilities live in `scripts/`. Place Node regression tests in `tests/`, documentation and images in `docs/`, and pinned reconstruction metadata in `manifests/`. Do not commit generated trees such as `.build/`, `.cache/`, `dist/`, or `src/app/dist/`.

## Build, Test, and Development Commands

Use Node.js 26.5.x (see `.node-version`) and install the locked graph with `npm ci`.

- `npm run check` — run both TypeScript checks and all regression tests.
- `npm test` — run `node:test` suites in `tests/*.test.mjs`.
- `npm run frontend:build` — compile the editable Vite frontend.
- `npm run bootstrap` — hydrate verified upstream build inputs.
- `npm run package` — check, build, sign, and verify the macOS app.
- `npm run publication:check` — validate that a clean-history export is lossless.

Before sharing a change, run `npm run check` and `npm run frontend:build`.

## Coding Style & Naming Conventions

Use ESM, strict TypeScript, two-space indentation, double quotes, semicolons, and trailing commas in multiline literals. Prefer `camelCase` for functions and variables, `PascalCase` for React components and types, and descriptive kebab-case filenames such as `router-settings.test.mjs`. No repository-wide formatter or linter is configured, so match nearby code and keep modules focused.

## Testing Guidelines

Write focused `node:test` regressions named `*.test.mjs`; use `node:assert/strict`. Add coverage for changed routing, packaging, publication, or WSL contracts. There is no numeric coverage threshold, but every behavior change should have a reproducible regression. Run a targeted test with `node --test tests/<name>.test.mjs`, then run the full check.

## Commit & Pull Request Guidelines

Recent commits use short, imperative subjects, for example `Fix settings persistence...` or `Route Codex native tool calls...`. Keep commits focused. Pull requests should describe the affected boundary (runtime source, editable frontend, packaged renderer, or packaging), list verification commands, and link relevant issues. Include screenshots for visible UI changes. Never weaken checksum, bundle-identity, signing, or clean-export checks to obtain a pass, and never commit credentials or local forensic evidence.
