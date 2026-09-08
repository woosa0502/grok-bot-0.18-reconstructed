# Build inputs and deployment boundaries

## Reproducible source selection

The root `package.json` / `package-lock.json` provides tools and shared runtime libraries. Mobile source imports may use those declared packages and the small root Bot-template helper; they may not reach a user font installation or raw recovery artifact.

Select these mobile paths for source review/version control:

- `src/`, `public/`, `tests/`, `docs/`
- `package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `.gitignore`
- `server.mjs`, `codex-usage.mjs`, and other explicitly reviewed runtime helpers

Do not bulk-add the directory. Exclude `dist/`, `.sessions*.json`, profiles, `.state/`, artifacts, screenshots, credentials, full APKs and extracted research bundles. The original local checkout has an additional `.git/info/exclude` rule; source integration must explicitly stage the reviewed allowlist rather than remove local evidence exclusions wholesale.

`docs/asset-provenance.json` lists the seven copied runtime/evidence inputs. It records exact bytes and SHA-256, original Android version, embedded font notices, and unresolved licenses. The two PP Neue Montreal fonts came from a personal installation; their embedded notice directs users to Pangram Pangram Foundry for license details. Cursor icon and geometry recovery does not itself supply a redistribution license. Pretendard declares SIL OFL 1.1 in its font name table. No full vendor distribution is bundled by this change.

## Validation without deploying

From the root, using the Node version in `.node-version`:

```bash
npm run mobile:check
npm run frontend:build:audited
```

Mobile validation creates `.build/mobile-validation/run-*/validation.json` and `dist/`. The tests receive an empty `GROK_MOBILE_SESSION_FILE` and an output-local `BELMONT_PROFILE_DIR`; fixture servers use their own ephemeral ports. `npm --prefix grok-mobile-belmont-pwa test` uses the same isolation without a production bundle.

The audited desktop renderer build writes `.build/editable-renderer/dist/renderer` and `renderer-source-provenance.json`. It preserves the existing graph, asset, route, lazy-chunk and checksum checks. Neither command installs or launches the resulting app.

## Selectable desktop renderer

The default workflow preserves the shipped checksum-pinned renderer:

```bash
npm run wsl:setup
npm run wsl:start
```

An explicit editable workflow builds the existing audited source renderer and stages a different runtime:

```bash
npm run wsl:setup:editable
npm run wsl:start -- --renderer editable
```

Default paths are distinct:

| Selection | Runtime | Profile |
| --- | --- | --- |
| pinned | `.build/belmont-wsl-runtime` | `.cache/belmont-wsl-profile` |
| editable | `.build/belmont-editable-runtime` | `.cache/belmont-editable-profile` |

Both launches enforce build/source lineage and acquire the profile lock. `BELMONT_RENDERER=editable` is equivalent to the launch flag; an explicit flag takes precedence. An explicit `BELMONT_WSL_PROFILE` overrides the default, so retain the separate profile when reviewing editable code. Editable setup requires existing recovered inputs and a prepared root dependency graph. The existing clean build may compile Node native helpers in its repository-local cache; this is a setup operation, outside source-only validation. Building/staging is separate from the operational decision to launch.

The editable renderer does not recreate unavailable original cloud services. Feature acceptance still depends on the host contracts and actual isolated/live results; source provenance alone is not product parity.

## Mobile promotion

The server still serves `grok-mobile-belmont-pwa/dist`. `npm run build` now prepares `.build/mobile-source/dist`; copying that reviewed output into the serving directory is a separate deployment action. Preserve pairing state, profile, service ownership and the previous serving directory for rollback. Do not rebuild or replace a directory used by somebody else's ongoing test.

Current remediation prepares source and isolated build artifacts only. It does not promote those artifacts into the original live checkout or restart the PWA, Belmont, Aside or Windows stream services.
