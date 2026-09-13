# Map-row disposition (GPT P1-3, round-2) — three SEPARATE buckets, never merged

Per GPT's correction, VERIFIED, EXCLUDED-FROM-THIS-BATCH, and OPEN/BLOCKED are kept as **separate** buckets and
NOT summed into one "complete" count. An UNKNOWN/unrun row is never counted complete. OFFLINE test coverage is
distinguished from LIVE evidence.

## Bucket A — VERIFIED (a real test PASS this program)
| Row | Kind | Evidence |
|-----|------|----------|
| L15 | LIVE | r10 ev-l15-* — every browser Origin→403, roster 14→14 (readable both sides); auth-ON wrong→401 AND right→200; for-chrome web-origin→403 FORBIDDEN, no-Origin reached (404, a control observation — not a mutation-success claim) |
| L26 | LIVE | r10 ev-l26-canonical-* — authorityMode=belmont; /memory/context 200; UNTRUSTED_MEMORY_CONTROL_FIELD; INVALID_BELMONT_MEMORY_CONTEXT. NOTE: the two rejections are HTTP **500** (validation-error refusal), not a 4xx contract; the canonical tally always also checks authorityMode. |
| L12/L27 | **OFFLINE** | belmont-browse/test/{bwrap-eval-isolation,eval-isolation,sites-overlay-contract,memory-search-sites-overlay}.test.mjs (real bwrap/fs), wired in verify-eval-isolation.sh. LIVE G2-document-read remains a separate LIVE line in the recipe (not asserted here). |
| L16 (idempotency only) | LIVE | r8 ev-bot-group-discuss — same clientNonce returns the same agent (durable-accept is a SEPARATE OPEN row below) |
| L13 | LIVE | r10 ev-l13-approval-flow — allow→effect; VALID deny ({verdict:"deny",always:false})→no effect; invalid-decision ({verdict bogus})→400 fail-closed, suspension kept; cancel→stopped, no effect. Verdict gates decision-status + observation-read success. |
| recovery (L19 supervised + orphan-adopt) | LIVE | r10 ev-recovery-* — per-stage (pid,startTicks)+termination; supervised reap via pidfd; orphan-adopt same-instance (owner names the SPAWNED serve2); mis-kill control preserved |
| bot delegated-creation | LIVE | r10 ev-bot-autonomous-createagent — a bot given only NL performs a successful CREATION when delegated (strong INDIRECT causal evidence; NOT an exclusive tool-call proof — the createAgent wrapper frame is a communicateUpdateToolCall not exposed by the gateway transcript RPCs) + ID-set-exact cleanup from readable rosters |

## Bucket B — EXCLUDED FROM THIS BATCH (not counted as product-complete)
| Row | Status | Reason |
|-----|--------|--------|
| Telegram | EXCLUDED — unimplemented | No product adapter in the reconstruction (channels manifest has Discord+Slack coming-soon, no Telegram). A backlog/implementation item, not a completed feature. |
| Autopost | EXCLUDED — unimplemented | No publisher/job-store/receipt/dedup. Backlog item, not complete. |
| L41 (PWA send-ledger) | EXCLUDED — not run this batch | The NEW PWA blocks unpaired requests (401 pairing required), but an ISOLATED test path EXISTS: grok-mobile-belmont-pwa/server.mjs:1048-1110 (GROK_MOBILE_SKIP_PAIRING skipPairing + preview identity), documented at design-pwa-send-ledger.mjs:12-16. Not run here to avoid changing the paired environment; a real paired-device acceptance test is separate. Correction of the earlier claim: it is testable in isolation, not "untestable without real pairing". |
| L42 (PWA file-path policy) | EXCLUDED (batch) + OPEN gap | Same isolated preview path applies. AND R8's recorded finding stands: the NEW PWA /api/filesystem has no sensitive-file deny-list (in-root secrets servable behind pairing). Scope-out does NOT resolve it — it remains an OPEN fix-or-explicit-risk-acceptance item. |
| L37 (vault/secrets) | BLOCKED — needs credentials/paired fixture | Installation-key/ECDH/secure-storage code is present, but the live vault path needs real credentials/a paired fixture. Not "verified"; BLOCKED, not complete. |

## Bucket C — OPEN (named, NOT counted complete, next step given)
| Row | State | Next step |
|-----|-------|-----------|
| L02 | OPEN (partial) | Lifecycle + numeric-fill tested OFFLINE; the full LIVE fill/click/read/scroll tool matrix is not run. Next: a live browser-tool-matrix driver, or explicitly scope to the tested subset. |
| L10 | OPEN (partial) | bwrap isolation SUBSTRATE tested OFFLINE; a dedicated LIVE subagent-isolation assertion (a subagent cannot read the parent's isolated state/secrets) is not run. |
| L16 (durable-accept) | OPEN (partial) | Idempotency verified; an accepted request surviving a serve restart is not tested. Next: a restart-survival driver. |
| L38 | OPEN (partial) | Bundle-SHA integrity verified; the ATTACHMENT sha/dedup path is not separately tested. Next: an attachment upload/dedup driver. |
| L46–L50 | BLOCKED-UNDEFINED | No topic definition in the repo map; needs the source plan's L-code table. Do NOT count as complete. |

## Summary (buckets kept separate)
- VERIFIED: L15, L26, L12/L27 (offline), L16(idempotency), L13, recovery, bot delegated-creation.
- EXCLUDED/BLOCKED (not product-complete): Telegram, autopost, L41, L42(+open gap), L37.
- OPEN: L02 (full matrix), L10 (dedicated), L16 (durable-accept), L38 (attachment dedup), L46-50 (undefined).
The three buckets are NOT summed into a single "complete" figure. The live-verification backlog is Bucket C plus
the L42 filesystem deny-list gap and the paired-device acceptance tests for L41/L42/L37.
