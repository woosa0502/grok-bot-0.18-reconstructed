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

## Bucket A additions (r11 — product backlog progressed one by one)
| Row | Kind | Evidence |
|-----|------|----------|
| L02 | PARTIAL (r11, corrected per GPT) | ev-l02-browser-matrix.json — a local form server received the exact fill nonce and the heading nonce appeared in the session (navigate/read/fill/click on ONE page). GPT counterexample: HEAD and FILL share a nonce suffix and /submit records on a bare GET, so the driver alone does not INDEPENDENTLY prove the browser tools executed. Keep as local-form success; OPEN: independent HEAD/FILL nonces, tool-execution↔tab/DOM linkage, and the full plan-258 matrix (two tabs, long page, select/drag/keyboard/coordinate-click, wrong-tab, stale reference). |
| L16 durable-accept | PARTIAL (r11) | ev-l16-durable-accept.json — session DISK RECORD survives a serve restart (retained, restarted serve reconciled 1 persisted execution, GET /sessions/:id returns it). This is the session-record-restart-preservation sub-scope only. OPEN (plan 277): same-nonce concurrent submit, response loss, other-nonce queueing, accept-ledger + work-count + external-side-effect-count consistency, restart dedup. (createAgent idempotency half already verified r8.) |
| bot CreateRoutine | LIVE (r11) | ev-bot-autonomous-routine.json — a bot autonomously creates a routine via its updateState tool. |
| L38 | PARTIAL (r11, corrected per GPT) | ev-l38-attachment-sha-dedup.json — REAL-DATA scan: 20,427/20,439 stored ids == sha256(data) (12 exceptions = symbolic sand-live-* pointers), 20,407 distinct contents → 0 mapped to >1 id. CORRECTION: line 17's sha check is GC candidate selection in clearStaleCheckpointRoots(), NOT a write-time id==sha256 enforcement; setBlob stores the caller-supplied id. Schema (PRIMARY KEY + upsert) guarantees id UNIQUENESS; content-addressing is a PRODUCER contract the data shows is honored in practice. OPEN (plan 315): full attachment HTTP path — same name/different bytes across agents, upload response-loss+retry, chunked fetch, wrong-path rejection, source-vs-fetch SHA, per-agent isolation. |
| L10 | PARTIAL (r11, per GPT round-13 합의) | ev-l10-subagent-isolation.json — a PARENT dispatched TWO workers (Task ×2), one made to fail. VERIFIED (robust, real-data): two distinct terminal subagentIds; each worker's produced BODY carries only its own nonce (no cross-worker mixing); result attributed to the registered worker by TRUE-PREFIX task-title match (background shape); parent report never claims the failed worker succeeded (negative-guard anti-laundering across phrasings). Verifier ships all 11 of GPT's counterexamples (rounds 8-13) as --selftest regressions (13/13). RESIDUAL (why PARTIAL, per GPT): inlined-shape attribution is treated as unverifiable (never auto-passed) so full attribution holds only for the background-completion shape; and the report-guard is regex-based over free-text parent reports. GPT confirmed 합의 on the scorecard with L10=PARTIAL. Structural note: SubagentRunResult = {text,aborted}; completed/error assigned at settle (no structural anti-laundering guarantee — hence the parent-report check). |

## Bucket B additions (r11)
| Row | Decision | Reason |
|-----|----------|--------|
| bot CreateGroup | SCOPE-OUT (by design) | Not a bot tool — proto ToolCall union has createAgentToolCall but no createGroupToolCall; createGroup is a gateway/UI RPC only. Corroborated by xAI's public Grok Bot docs (groups are user-composed; bots then collaborate). A bot creates agents+routines, not groups. |

## Bucket C — OPEN (named, NOT counted complete, next step given)
| Row | State | Next step |
|-----|-------|-----------|
| L10 | VERIFIED (r11) | Moved to Bucket A — LIVE parent→two-worker dispatch, failure-attribution + no-mixing + no-laundering confirmed on the gateway (ev-l10-subagent-isolation.json). The offline bwrap substrate (bwrap-eval-isolation) remains a separate corroborating fs-isolation test. |
| L38 | PARTIAL (r11) — see the L38 row above | (Superseded, per GPT round-8/9: the earlier "VERIFIED / moved to Bucket A" wording was withdrawn. Real-data scan is empirical producer-contract evidence; schema enforces id-uniqueness only; full attachment HTTP path remains OPEN. The authoritative L38 disposition is the PARTIAL row above.) |
| L46 | PARTIAL (r11 ops, corrected per GPT) | Contract tests PASS 36/36 (build-provenance-contracts 3/3, aside-native-build-identity 5/5, upgrade-resume-ownership 28/28), but fixtures are 4KB byte arrays + a test daemon string, not a real Chrome build. The clean-profile REAL build/start → PID/binary/provenance MATCH → reject mismatch/duplicate-start end to end is NOT directly run (r10 supervisor/flock is supporting only). OPEN: connect a real dev build/start manifest+logs+PID. evidence/r11/ops/. |
| L47 | VERIFIED (r11 ops, real daemon spawn) | box-exec-daemon-owner-lifecycle 4/4 — kill owner before-ready/after-ready/during-shell-exec; real port release + TERM-ignoring descendant reaped (ephemeral port, never live 1337). evidence/r11/ops/. |
| L48 | VERIFIED (r11 ops, OFFLINE integration) | linux-installation 9/9 — persistent KEM identity reuse; tamper/wrong-identity rejected; mismatched JWKs fail before signing (no partial key adoption); lock releases on SIGKILL. evidence/r11/ops/. |
| L49 | PARTIAL + FINDING (r11 ops) | Verified on the real shipped aside-909 bundle: not BLOCKED (bundle secured), wrong-anchor fails closed (no partial output), shipped bundle valid syntax, real-start+capability runs (cited r10). FINDING: in-tree patch-daemon.py cannot re-apply to the shipped 909 bundle (memory-hook version skew, not a runtime defect); canonical clean→patch→re-patch untestable (no clean upstream daemon retained). ev-l49 + ops/README. |
| L50 | PARTIAL (r11 ops, corrected per GPT) | drain/resume CONTRACT PASS: aside-process-signal-drain 9/9 + upgrade-resume-ownership 28/28 (failure retains marker + retries once, quiesced keeps durable recovery, concurrent → one attempt, no duplicate work). Real signed-package BINARY SWAP + post-update version/files/queue match = BLOCKED (needs a test update package). Overall PARTIAL (not "PASS with an extra"). evidence/r11/ops/. |

## Summary (buckets kept separate; corrected per GPT round-8 review of cf6572b)
- VERIFIED (full): L15, L26, L12/L27 (offline), L16(idempotency), L13, recovery, bot delegated-creation,
  L47 (real daemon spawn), L48 (offline integration).
- PARTIAL (real progress, scope honestly bounded — NOT full completion):
  - L10: real-data VERIFIED for two-distinct-workers, no-cross-mixing, output-matches-recipient, registered-worker
    attribution (background shape), and negative-guard anti-laundering; RESIDUAL — inlined-shape attribution is
    unverifiable (safe-FAIL) and the report-guard is regex over free text. GPT confirmed 합의 with L10=PARTIAL.
  - L02: local-form navigate/read/fill/click PASS; full tool matrix + independent nonces + tool↔DOM linkage OPEN.
  - L16 durable-accept: session-record restart preservation PASS; full accept-path (concurrent nonce, response
    loss, side-effect/work-count ledger, restart dedup) OPEN.
  - L38: real-data shows stored blobs are content-addressed + dedup'd (empirical producer contract); schema
    enforces id-uniqueness only; full attachment HTTP acceptance path OPEN.
  - L46: build/provenance/identity/ownership contract tests 36/36; real build→start→PID/provenance linkage OPEN.
  - L49: wrong-anchor fail-closed + shipped-bundle syntax + real-start(cited) verified; re-apply idempotency is a
    confirmed patcher/bundle version-skew FINDING; canonical clean→re-patch cycle supply-gated (no clean upstream).
  - L50: drain/resume contract PASS; real signed-package binary swap BLOCKED.
- EXCLUDED/BLOCKED (not product-complete): Telegram, autopost (unimplemented); L37 (paired fixture); L41/L42
  (pairing acceptance; L42 filesystem deny-list gap still open).
- The buckets are NOT summed into one "complete" figure. GPT round-13 verdict (합의 CONFIRMED): R10 live-harness
  approval stands; R11 adds real partial verification. Mutual agreement is on the accurate scope above (L10 =
  PARTIAL), NOT on "full product-backlog complete". Residual gaps (L02/L16-durable/L38/L46/L49/L50 partials,
  L37/L41/L42 pairing, L42 deny-list, Telegram/autopost unimplemented, L10 report-guard/inlined-attribution) are
  each named and NOT counted complete.
