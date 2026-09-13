# Map-row disposition (GPT P1-3) — verify OR explicit scope-out; UNKNOWN/unrun NOT counted complete

GPT's rule: each untested map row must be dispositioned as **VERIFIED** (implemented + a real test PASS) or an
**explicit SCOPE-OUT** (with a reason); an UNKNOWN or unrun row must NOT be counted as complete. Below, rows are
classified honestly. "OPEN" rows are named as still-open (a next step given), never quietly marked done.

## VERIFIED (real test PASS)
| Row | Topic | Evidence |
|-----|-------|----------|
| L15 | gateway/daemon auth + Origin guard | r10 hardened matrix PASS — ev-l15-{origin-guard,bad-bearer,daemon-for-chrome}.json (every browser Origin→403, roster 14→14; auth-ON wrong→401 AND right→200; for-chrome web-origin→403 FORBIDDEN, no-Origin reached) |
| L26 | canonical memory authority (POSITIVE) | r10 PASS — ev-l26-canonical-{context-authority,reject-control-field,reject-malformed}.json (belmont mode: /memory/context 200; UNTRUSTED_MEMORY_CONTROL_FIELD; INVALID_BELMONT_MEMORY_CONTEXT) |
| L12/L27 | eval-isolation + sites-overlay secret battery | OFFLINE bwrap/fs test battery (belmont-browse/test/{bwrap-eval-isolation,eval-isolation,sites-overlay-contract,memory-search-sites-overlay}.test.mjs), wired in verify-eval-isolation.sh; live G2-document-read probe in the LIVE recipe |
| L16 (idempotency half) | createAgent idempotency | r8 ev-bot-group-discuss.json — same clientNonce returns the same agent, no duplicate |
| L13 | full approval flow (approve/deny/cancel) | r10 ev-l13-approval-flow.json — see the L13 batch (no side-effect before any decision; approve→external read result appears; deny/cancel→never appears) |

(Also closed outside this row list: L19 chrome-orphan closure + recovery re-verify (r10 supervised + orphan-adopt
traces), and a bot AUTONOMOUSLY creating a bot (r10 ev-bot-autonomous-createagent.json).)

## SCOPE-OUT (explicit, with reason)
| Row | Decision | Reason |
|-----|----------|--------|
| Telegram adapter | SCOPE-OUT (not implemented) | CONFIRMED ABSENT in the reconstruction (source/shared/channels.ts has Discord+Slack only; no product send/receive/auth adapter). Cannot be live-tested; would require implementing the adapter. Not a PASS. |
| Autopost pipeline | SCOPE-OUT (not implemented) | CONFIRMED ABSENT (no publisher adapter / job store / receipt / dedup). Cannot be live-tested; would require implementation. Not a PASS. |
| L41 | SCOPE-OUT (pairing-gated) | The NEW PWA `/api` requires device pairing (returns "pairing required" unpaired); the send-ledger cannot be exercised without real device pairing. Driver design-pwa-send-ledger.mjs exists but is unrunnable here. |
| L42 | SCOPE-OUT (pairing-gated) + recorded gap | PWA file-path policy is behind device pairing. R8 recorded a real finding: the NEW PWA `/api/filesystem` has no sensitive-file deny-list (in-root secrets servable) — a paired-user defense-in-depth gap (OLD PWA has a deny-list at belmont-adapter.mjs:40-45). Recommendation: add a deny-list. Not a fabricated PASS. |
| L37 | SCOPE-OUT (pairing/crypto-gated) | Vault/secrets is device-pairing + installation crypto (linux-installation.mjs ecdh/signing; session.mjs vault restore). Not safely live-testable without real device credentials/pairing; code is present but the live path needs a paired device. |

## OPEN — NOT counted complete (named, with next step)
| Row | State | Next step |
|-----|-------|-----------|
| L02 | PARTIAL | Browser lifecycle (browser-lifecycle-chrome/mini-cdp, browser-alive) + numeric-fill-parity are tested OFFLINE; the full LIVE fill/click/read/scroll tool matrix has not been run end-to-end. Next: a live browser-tool-matrix driver, or explicitly scope to the tested subset. |
| L10 | PARTIAL | The bwrap isolation SUBSTRATE is tested (bwrap-eval-isolation/eval-isolation); a dedicated subagent-isolation live assertion (a subagent cannot read the parent's isolated state/secrets) has not been run. Next: a live subagent-isolation driver. |
| L16 (durable-accept half) | PARTIAL | Idempotency is verified; the durable-accept queue (an accepted request survives a serve restart) has not been separately tested. Next: a restart-survival driver. |
| L38 | PARTIAL | Bundle-SHA integrity is verified (core.mjs bundleSha256 in eval-isolation); the ATTACHMENT sha/dedup path has not been separately live-tested. Next: an attachment upload/dedup driver. |
| L46–L50 | BLOCKED-UNDEFINED | No topic definition for these codes exists in the available repo map (r8/r9 list the range without topics). Cannot disposition without the source GPT-6 Pro plan's L-code table. Flag for the plan owner to supply the topics; do NOT count as complete. |

## Summary
Complete (VERIFIED or explicit SCOPE-OUT): L15, L26, L12/L27, L16(idempotency), L13, Telegram, autopost, L41,
L42, L37. Still OPEN (not counted complete): L02 (full matrix), L10 (dedicated), L16(durable-accept), L38
(attachment dedup), and L46–50 (undefined topics — needs the source plan). This is the honest disposition; the
OPEN rows are the remaining live-verification backlog, each with a defined next step, none marked done.
