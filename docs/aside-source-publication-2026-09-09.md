# Aside and Belmont source publication — 2026-09-09

Status: **SOURCE CHECKPOINT / PRODUCT VERIFICATION INCOMPLETE**.

This checkpoint publishes the four previously local Belmont/PWA commits through
`4d60b0bdd0830ad3cacd1749d20803238bd35434`, the pending transcript execution binding
edit, Aside regression tests and plans, and the authored `belmont-browse` runtime,
patch tools, test fixtures and native reconstruction sources.

## Source and runtime boundaries

- [Current Chromium snapshot](../belmont-browse/aside-fork/snapshot/README.md)
  includes the full native source delta from the public base, including changes
  newer than the historical patches and overlay. Its manifest pins exact bytes.
- [Aside host](../belmont-browse/README.md) now has versioned source. Prior statements
  that the entire directory is local-only describe its earlier publication policy.
- Chromium remains a separate local checkout. Export does not commit or stage in
  that checkout because the active build fingerprints its HEAD, diff and untracked
  inputs. A future source change requires a new snapshot before it is published.
- Profiles, databases, credentials, generated extension shims, logs, screenshots,
  local forensic extracts, caches, downloaded vendor payloads and executables are
  excluded. The generated shim can contain an installation private key; only its
  generator is published.

## External inputs and setup

The root project uses Node `26.5.0` and its existing lockfile. `belmont-browse` has
its own `package-lock.json`; install that locked dependency graph separately when
preparing a new checkout (`npm ci --prefix belmont-browse`). Launch scripts retain
their existing local path defaults; supply their documented environment overrides
on another host.

Aside's extracted daemon and component bundles remain external prerequisites under
`belmont-browse/vendor/`. Source publication does not prove that downloading current
upstream releases reproduces the historical input bytes. Tests requiring these
local inputs may need those inputs provisioned before they can run in a fresh clone.

The current daemon customization chain is:

1. `tools/patch-daemon.py` (including `patch-password-session.py`).
2. `tools/patch-daemon-linux.py`.
3. `tools/patch-daemon-lifecycle.py`.
4. `tools/patch-daemon-active-workloads.py`.

Run version-specific patchers only on separately prepared inputs with their expected
anchors and hashes. `tools/build-aside-ext.mjs` also invokes
`tools/patch-omnibox-generation.py`. `tools/prepare-native-components.mjs` prepares
the original 907 component pair. The older [upgrade notes](../belmont-browse/docs/UPGRADE.md)
describe input recovery but do not cover this entire current chain.

## Checks in this publication task

Using Node `26.5.0`:

- `npm run check`: **exit 1**. Both TypeScript checks pass; repository tests report
  980 pass, 0 fail and 2 skip. Mobile tests report 147 pass, 2 fail and 2 skip.
- The mobile failures remain `recovered APK assets are direct build inputs` and
  `recovered character states and mobile interaction affordances stay present`.
  Their assertions and the mobile implementation were not changed for publication.
- `npm run frontend:build`: **exit 0**. No runtime deployment or restart was performed.
- Native patch reconstruction, independent inspection and fresh-history publication
  checks are recorded in the local publication artifact report.

Reproduce the repository checks with `npm run check`, `npm run frontend:build` and
`npm run publication:check`. Native source verification commands are in the snapshot
README. Full native test completion and overall Aside parity are not implied.

## Handoff

The other session's native test build and original Aside environment remain owned
by that session. Read [NEXT_SESSION.md](../NEXT_SESSION.md) for its latest handoff.
Links there under `data/artifacts/` refer to local evidence intentionally excluded
from Git; they are not downloadable source dependencies.

Local publication evidence: `data/artifacts/aside-source-publication-20260909/`.
Remaining product work includes the native components/browser test completion,
mobile failures, repeated B-profile switching prerequisites, password toolbar popup
resize behavior and final workflow-ledger reconciliation. Historical completion
statements in older development documents are not promoted by this source push.
