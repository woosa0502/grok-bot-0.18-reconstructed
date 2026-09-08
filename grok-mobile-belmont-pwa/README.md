# Linear Grok Mobile PWA

A React mobile client reconstructed from **Grok Bot Android 1.5.0 (versionCode 120)** interface evidence and connected to the Belmont desktop gateway. The desktop reconstruction has a separate Grok Bot **0.18** baseline. Neither identifier is a claim of current upstream product parity.

`Linear` is the application identity; `Belmont` is the chief bot. This client does not import or run the separate legacy `belmont-mobile-pwa` implementation.

## Source and build contract

The root `package-lock.json` owns the exact Node/React/TypeScript/Vite dependency graph. Install the root locked graph with `npm ci` using the repository's Node 26.5.0 version. No independent mobile dependency installation is required.

Runtime geometry, four fonts, the icon fallback and the screen identifier inventory are now mobile-owned inputs. Their byte sizes, SHA-256 hashes, source locations and license status are in [docs/asset-provenance.json](docs/asset-provenance.json). The build does not need a user font directory or the APK recovery tree. The original APK and full forensic extraction remain outside the runtime source manifest.

Run from the repository root:

```bash
npm run mobile:check
npm run mobile:build
```

Or from this directory:

```bash
npm run check
npm run build
```

- `check` runs the mobile tests, TypeScript and Vite in a fresh `../.build/mobile-validation/run-*` directory. It disables persistent pairing sessions and uses a separate test profile.
- `build` validates input hashes, checks TypeScript and writes `../.build/mobile-source/dist`.
- Neither command empties the `dist` directory used by a running mobile server. Validation does not deploy or restart a service.
- Node tests start only their own fixture servers on ephemeral ports. They do not call the live Belmont or Aside host.

See [docs/BUILD_AND_DEPLOYMENT.md](docs/BUILD_AND_DEPLOYMENT.md) for source selection, deployment boundaries and desktop renderer selection.

## Product flow and persistence

The recovered 54 screen identifiers have route/layout coverage; that count is not backend feature parity or a live write success rate. Implemented flows include pairing, roster, chat and threads, approvals/widgets, files, profiles/groups, bot templates, routines, skills/connectors, and a desktop computer view. A Windows session uses embedded Moonlight Web through same-origin WSS; Sunshine remains the media host.

Persistence depends on the operation:

- Bot state, transcript, approvals, attachments, profile/group edits, routines, skills and host notification preferences use the desktop gateway.
- Forms send structured input to a selected Bot. Autofill retains a phone cache and synchronizes saved profile memories when a manager Bot is available.
- Templates export/import actual Bot settings, enabled skills and paused routines. Feedback, reports and ratings are recorded in the desktop profile's `mobile-feedback.jsonl`; they are not submissions to the original vendor.
- Drafts, theme, haptics and browser permission state remain device-local. Language and notification controls distinguish local preferences from host settings.
- Usage reads the configured Codex account's usage; it does not recreate original vendor billing or subscription management.

[docs/RECOVERY_MAP.md](docs/RECOVERY_MAP.md) records source evidence and service substitutions. [docs/STATUS.md](docs/STATUS.md) separates historical render evidence from current isolated checks and physical-device acceptance.

## Running and deployment

`npm start` starts `server.mjs`, serves this directory's `dist`, and uses a pairing session store. It is an operational action, not a validation step. Preserve the existing profile and sessions when promoting a reviewed build.

Defaults and overrides:

- Bind: `127.0.0.1:4187`; override with `GROK_MOBILE_HOST` / `GROK_MOBILE_PORT`.
- Profile: `../.cache/belmont-wsl-profile/sand-data`; override with `BELMONT_PROFILE_DIR`.
- Pairing code: printed on startup; optionally set `GROK_MOBILE_PAIRING_CODE`.
- `GROK_MOBILE_TRUST_PROXY=1` is for the configured HTTPS reverse proxy.
- `GROK_MOBILE_SKIP_PAIRING=1` is for isolated fixture rendering; it is not a deployment setting.

Physical-phone HTTPS use, Android system Back/gesture behavior, locked-phone notification delivery and Windows stream input must be accepted on the actual devices. Isolated browser tests do not establish those results.
