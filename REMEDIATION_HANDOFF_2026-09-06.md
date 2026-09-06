# Grok / Aside remediation handoff — 2026-09-06

Status: VERIFIED_SOURCE_CANDIDATE. The source candidate and scoped isolated checks passed final independent artifact reconciliation. Existing running tests and original source remain protected. This is not a deployed release or an original-product parity approval.

Read `data/artifacts/parity-remediation-20260906/REPORT.md` first, then `source-delta-inventory.json` and `work-items.json` in that directory. Earlier worker reports are point-in-time evidence; this handoff and the parent report describe the integrated candidate.

## Candidate locations

- Belmont: `/home/hoon/_roots/labs/work/Belmont-remediation-20260906`.
- Chromium: `/home/hoon/chromium-remediation-20260906/src`.
- Compiled browser: `/home/hoon/chromium-remediation-20260906/src/out/aside/chrome`.
- Host/Electron source bundles: `.build/runtime-bundle-check-N02IZW/` in the Belmont candidate; these bundles were built and parsed, not launched.
- Audited editable renderer: `.build/editable-renderer/dist/renderer/`.
- Parent evidence: `data/artifacts/parity-remediation-20260906/`.

## Reproduction

Use Node 26.5.0. The isolated candidate has the locked SDK 1.30.0 dependency installed; the original dependency tree was not changed.

```bash
cd /home/hoon/_roots/labs/work/Belmont-remediation-20260906
export PATH="/home/hoon/.local/share/mise/installs/node/26.5.0/bin:$PATH"
npm run check
npm run frontend:build
npm run frontend:build:audited
node --test belmont-browse/tests/omnibox-consumer-generation.test.mjs
node data/artifacts/parity-remediation-20260906/build-provenance/runtime-bundle-check.mjs
```

The full check includes mobile validation in a unique output directory. Its optional browser UI case is skipped by default; independent mobile browser evidence is under `mobile-adversarial/`, and the observed screenshot is `mobile-client/thread-cards.png`.

```bash
cd /home/hoon/chromium-remediation-20260906/src
/home/hoon/depot_tools/ninja -C out/aside -j2 chrome aside_adblock_engine_tests aside_native_contracts_tests aside_omnibox_context_unittests aside_omnibox_action_unittests
out/aside/aside_adblock_engine_tests
out/aside/aside_native_contracts_tests
out/aside/aside_omnibox_context_unittests
out/aside/aside_omnibox_action_unittests
```

Native modifications are also preserved as patches 041–044 under `belmont-browse/aside-fork/patches/`. They target the protected original Chromium snapshot after its existing changes. Do not apply them to the already-patched candidate. Patch 044 registers the native test and WebUI implementation in shared GN files. Patch 043 must be staged together with both generation-aware extension assets; `tools/patch-omnibox-generation.py` validates their exact original/output bytes. `tools/build-aside-ext.mjs` patches the copied staging assets before shim/manifest changes.

The browser acceptance runner intentionally refuses an existing profile. Preserve its recorded profile and evidence; use a new task-owned output directory for any later rerun. Its wrapper records PID, command, heartbeat, logs and its own stop command. It never targets the protected live ports.

## Application boundary

No original source, live binary, database, credentials, existing profile, active tests or mobile/Windows deployment was replaced. Never overlay this entire worktree onto the original: it contains pre-existing user edits. Reconcile only the source-delta inventory and verify each original hash before applying a later approved change. The inventory preserves the captured Belmont baseline and distinguishes the Chromium comparison against the protected original snapshot.

The original processes observed during this task were Belmont host 272127, Aside daemon 274866, Chrome 274878 and fixture 226119, on ports 21420, 9340, 9333 and 18777. These remain externally owned. A live restart, profile migration, real account/model run or physical phone acceptance needs its own authorized operation after current tests finish.

## Limits that must travel with the candidate

- Cross-process child checkpoint recovery, an entire group-room stop and long live unattended turns are not newly implemented or established by these checks.
- Memory's lexical path is verified; genuine Moss semantic search still needs a separately configured ready model/index. Codex OAuth alone does not configure image generation or transcription. Those routes require the explicit documented provider and API key.
- Real media APIs, OS notification actions, locked/background physical Android Web Push and Windows/mobile deployment were not exercised.
- Native import/PiP/secure DevTools ownership changes have independent source review and selected tests. The additional 23 Chromium integration tests compiled successfully but were not linked into and run as the full `unit_tests` binary. Browser smoke covers a fresh single-profile index, PiP preferences, disabled updater, context/session bounds and generation guards; it does not prove a full real import, automatic video PiP or nonempty search navigation.
- Multi-tab/PDF contextual query submission, original cloud/team/billing/card/skill-marketplace services, semantic activation and a configured updater backend remain separate capabilities. Unsupported operations now fail explicitly where this campaign touched them; they are not represented as implemented product parity.
- Adblock passes the selected independent engine/dialect controls and real delayed/late DOM cases. This is not a claim of complete uBlock or original Aside behavior equivalence.

Any new failing reproduction, source/hash drift, different build/runtime binding or physical-device evidence invalidates the affected scoped verdict and should reopen that boundary rather than reusing these totals as a new release approval.
