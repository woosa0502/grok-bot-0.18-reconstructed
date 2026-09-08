# Current validation boundary

Status: `SOURCE_REMEDIATION_IN_PROGRESS` (2026-09-06)

- Android reference: **1.5.0 / versionCode 120**. Grok Bot 0.18 is the desktop baseline.
- Normal mobile validation now writes only fresh `.build/mobile-validation/run-*` outputs; normal build writes `.build/mobile-source/dist`. Live mobile `dist`, sessions and profiles are preserved.
- The minimal asset manifest and copied screen inventory make build inputs independent of the raw APK extraction and user font paths. The root lockfile remains the dependency source of truth.
- User forms, profile-memory autofill, Bot templates and host feedback/report storage already have backend paths. They must not be classified as entirely device-local.
- Current remediation test evidence belongs under `data/artifacts/parity-remediation-20260906/` in the repository root. The counts below are historical; they are not today's regression count or live acceptance.
- No current device acceptance follows from source or fixture tests. Physical Android behavior and live-service promotion remain separate operations.

Use [BUILD_AND_DEPLOYMENT.md](BUILD_AND_DEPLOYMENT.md) for current commands.

---

# Historical rebuild status (September 3-5, 2026)

Verdict: `PROVISIONAL_REBUILT_CLIENT`

## Historical observations recorded by the original rebuild

- `direct_observation`: all implementation changes made by this campaign are contained under `grok-mobile-belmont-pwa/`. The legacy PWA uses `127.0.0.1:4173` and the isolated preview used `127.0.0.1:4187`.
- `direct_observation`: live read-only calls returned the current Belmont roster, host settings, routines, message/media search, 1,410 catalog skills, 27 routed tools, and attachment records.
- `direct_observation`: `readAttachmentText` returned the real 67-byte `doc.md`; the rebuilt preview rendered its actual heading, list, and code block instead of the former canned project brief.
- `direct_observation`: the 430 by 932 representative render passed for Home, Chat, Attachment, Routine, Plugins, Settings, Appearance, and Computer with PP Neue Montreal and Pretendard loaded, no horizontal overflow, and no console errors.
- `direct_observation`: one Chromium session mounted all 53 post-pairing surfaces after waiting for skeletons to settle; 53/53 had a rendered root, no horizontal overflow, and no console errors. Data-dependent detail routes used a real routine, catalog skill, text attachment, and image attachment. This is a route/render gate, not a claim that every action completed a live round trip. Onboarding remains the unpaired branch.
- `direct_observation`: the updated Chromium interaction audit passed 17/17. Its hardware-back check traversed Home -> Chat -> Computer -> Chat -> Home using `history.back()`, then the live skill, routed-tool, routine, attachment, message-search, media-search, and persistence checks also passed.
- `direct_observation`: `npm run check` passed 36/36 tests, strict TypeScript, and the Vite production build.
- `direct_observation`: the rebuilt Home toolbar has exactly one Windows display action before Search and New Chat. A 430 by 932 Chrome CDP run observed a 44 by 44 button, no horizontal overflow or console errors, and an injected native bridge received exactly `{ computerName: "DESKTOP-OFKCVOG", appName: "Desktop" }` after the click.
- `mock_test_verified`: the extended adapter regression exercises thread, reaction, profile, notifications, group creation/members, search, attachment preview/share, routine creation, skills/tools, and computer reset without mutating the live Belmont instance.
- `direct_observation`: the rebuilt 1,832 by 1,920 contact sheet was opened and inspected after one fix-and-rerender pass. It is a one-to-one montage of the eight files in `render-report.json`: Home, Chat, Routine, Plugins, Attachment, Settings, Appearance, and Computer. The routine duplication/density and premature plugin skeleton capture found in the first pass were corrected.

## Deliberate boundaries

- `intentional_device_local`: browser notification permission, drafts, user form, autofill, theme, language preference, haptics, report cache, feedback, and rating.
- `explicitly_unsupported`: aggregate usage counters, subscription/billing, granular auto-review rule editing, and app-store submission. These screens no longer invent numbers, plans, or successful connections.
- `unverified`: live write operations for group/profile/reaction/routine/file-share were not invoked against the user's running Belmont; their route-to-gateway contracts are covered by the isolated regression.
- `unverified`: recognizable live computer content plus pointer/keyboard round trip; no input was injected into the separately owned live desktop.
- `unverified`: physical-phone installation/use behind HTTPS and pixel parity for every APK screen.
- `unverified`: a physical Android tap successfully handing the explicit activity intent to Moonlight and opening the paired Sunshine Desktop stream. Browser render and payload routing are verified; Android app hand-off is not.
- `unverified`: the browser-history fix was exercised in Chromium mobile emulation, not yet by pressing the system Back button on the user's physical Android phone.
- `inference`: official screenshot hierarchy is materially reflected in the restrained toolbar, gray/black chat bubbles, document card treatment, type scale, and spacing, but pixel identity is not claimed.
- `external_state_change`: a separately owned `setup-wsl`/Belmont restart job restarted the host and legacy PWA while this audit was running. This campaign did not start, stop, or modify that job. The final read-only snapshot again returned HTTP 200 through the isolated gateway; the legacy process PID therefore differs from the boot snapshot for an external reason.
- `concurrent_workspace_state`: the final repository snapshot contains tracked diffs in `source/host/extensions/inference/provider-session.ts` and `source/host/runner/turn-run-shell.ts` from concurrent work. This campaign did not edit those paths, but their presence means a repository-wide "untouched" claim cannot be established from the final Git state alone.

## Current evidence

- `artifacts/rebuild_20260903/contact-sheet.png`
- `artifacts/rebuild_20260903/chat-documents-top/chat.png`
- `artifacts/rebuild_20260903/render-report.json`
- `artifacts/rebuild_20260903/all-surface-audit.json`
- `artifacts/rebuild_20260903/interaction-audit.json`
- `artifacts/mobile-back-navigation_20260903/interaction-audit.json`
- `artifacts/windows_stream_home_20260904/live-verification.json`
- `artifacts/windows_stream_home_20260904/home-windows-button.png`
- `tests/server.test.mjs`
- `tests/surface-coverage.test.mjs`

## Independent review

- `confirmed_with_boundaries`: an independent read-only adversarial pass recomputed the 53/53 settled-render gate, 8/8 representative render, 16/16 interaction audit, real two-page message lookup, real `doc.md`, and one-to-one contact-sheet composition.
- `confirmed_with_boundaries`: a separate read-only back-navigation pass independently reproduced Home -> Chat -> Computer -> Chat -> Home, direct Settings deep-link -> Home, and exit from the paired Home root. Physical Android and standalone resume behavior remain unverified.
- `status_unchanged`: the client remains `PROVISIONAL_REBUILT_CLIENT` because live mutation round trips, a recognizable VNC frame/input round trip, and physical-phone HTTPS use were deliberately not exercised.

## Historical reproduction commands (not current validation instructions)

```bash
cd /home/hoon/_roots/labs/work/Belmont/grok-mobile-belmont-pwa
PATH=/home/hoon/.local/share/mise/installs/node/26.5.0/bin:$PATH npm run check
PATH=/home/hoon/.local/share/mise/installs/node/26.5.0/bin:$PATH GROK_MOBILE_PORT=4187 npm start
```

Do not touch the legacy `belmont-mobile-pwa/` service while validating this client.
