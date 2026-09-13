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
| L02 | LIVE (r11) | ev-l02-browser-matrix.json — navigate/read/fill/click end-to-end: a local server received the exact fill nonce (navigate+fill+click), the heading nonce appeared in the session (navigate+read). Now VERIFIED (was OPEN). |
| L16 durable-accept | LIVE (r11) | ev-l16-durable-accept.json — an accepted session survived a serve restart (disk record retained, restarted serve reconciled 1 persisted execution, GET /sessions/:id returns it). Now VERIFIED (was OPEN). |
| bot CreateRoutine | LIVE (r11) | ev-bot-autonomous-routine.json — a bot autonomously creates a routine via its updateState tool. |

## Bucket B additions (r11)
| Row | Decision | Reason |
|-----|----------|--------|
| bot CreateGroup | SCOPE-OUT (by design) | Not a bot tool — proto ToolCall union has createAgentToolCall but no createGroupToolCall; createGroup is a gateway/UI RPC only. Corroborated by xAI's public Grok Bot docs (groups are user-composed; bots then collaborate). A bot creates agents+routines, not groups. |

## Bucket C — OPEN (named, NOT counted complete, next step given)
| Row | State | Next step |
|-----|-------|-----------|
| L10 | OPEN (partial) | bwrap isolation SUBSTRATE tested OFFLINE (bwrap-eval-isolation/eval-isolation). A dedicated LIVE subagent-isolation assertion needs the GATEWAY's box-dispatch subagent tool (agent-adapters/dispatcher + remote box) — the lightweight eval serve does not expose a subagent/Task tool, so this needs the full product harness. |
| L38 | OPEN (partial) | Bundle-SHA integrity verified (eval-isolation). ATTACHMENT sha/dedup lives in the agent-isolation blob store (conversation-blob-store.ts, upsert ON CONFLICT(id)); a live check needs the agent-isolation worker/store in action (not in the eval serve). Next: a unit test of ConversationBlobStoreDb dedup, or a gateway attachment round-trip. |
| L46–L50 | BLOCKED-UNDEFINED | No topic definition in the repo map; needs the source plan's L-code table. Do NOT count as complete. |

## Summary (buckets kept separate)
- VERIFIED: L15, L26, L12/L27 (offline), L16(idempotency), L13, recovery, bot delegated-creation.
- EXCLUDED/BLOCKED (not product-complete): Telegram, autopost, L41, L42(+open gap), L37.
- OPEN: L02 (full matrix), L10 (dedicated), L16 (durable-accept), L38 (attachment dedup), L46-50 (undefined).
The three buckets are NOT summed into a single "complete" figure. The live-verification backlog is Bucket C plus
the L42 filesystem deny-list gap and the paired-device acceptance tests for L41/L42/L37.
