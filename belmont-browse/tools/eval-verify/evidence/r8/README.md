# R8 — "셋다" batch: chrome kernel closure + recovery re-runs + new product-area live tests

Three parallel streams the user asked for ("셋다해라"), all against the real dev stack.

## Stream 1 — chrome kernel-primitive closure (the A-1/A-3 TOCTOU floor)
`belmont-browse/tools/chrome-supervisor.py` + `test-chrome-supervisor.py`. cgroup v2 needs root and
systemd-run has no user bus here, but **pidfd works without root** and binds to a process *instance*. The
supervisor runs serve as its child, pins the owned Chrome via a pidfd, and reaps it on serve exit (incl.
SIGKILL) — closing the SIGKILL-orphan window (boundary #1) and the PID-reuse mis-kill (A-3). Test PASS
(reaps a SIGKILL-orphaned fake chrome; a dead-instance pidfd raises ProcessLookupError so a reused pid is
never signaled). Dogfooded: the eval serve ran under it during HEALTH.DEAD.

## Stream 3 — GPT D-2 recovery re-runs (live)
- `ev-l19-chrome-health-dead.json` — **HEALTH.DEAD**: owned path already correct; the ADOPTED path masked a
  dead chrome (`browserAlive(null)=null`). Fixed in core.mjs (isProcessAlive(pid) when child=null). Live:
  adopted chrome alive → `/health` ready:true/alive:true; killed → ready:false/alive:false. PASS.
- `ev-l19-chrome-double-crash.json` — **DOUBLE_CRASH**: two consecutive serve crashes; serve2 and serve3
  both re-adopt the SAME chrome (owned range never lost); serve3 normal stop reaps it. PASS.

## Stream 2 — untested product areas (map + live tests)
A 5-sub-agent map verified every plan-doc feature area against real code (HEAD 1f4e446). Live-run this batch:
- `ev-l15-origin-guard.json` / `ev-l15-bad-bearer.json` / `ev-l15-daemon.json` — **L15 gateway+daemon auth =
  PASS**: Host gateway (42611) rejects every browser Origin (generic, pinned-extension, localhost) → 403 with
  the roster count unchanged (14→14); gateway auth is ON (wrong Bearer → 401, correct → 200); the Aside
  daemon (21420) refuses a web-origin mutation on `/session/for-chrome/*` → 403 FORBIDDEN, no-Origin exempt.
- `ev-l26-*.json` — **L26 canonical-memory authority = PASS** (legacy-refusal boundary): on the default
  (aside-legacy) serve, `/memory/context` and a session-create carrying an injected control field or a
  malformed memory context are all refused with `MEMORY_AUTHORITY_MISMATCH`, session count unchanged. (The
  belmont-authority POSITIVE paths need a serve regenerated with `patch-daemon-canonical-memory.py` —
  the driver auto-detects mode and grades accordingly rather than faking a PASS.)
- Drivers kept: `../../design-memory-canonical-authority.mjs`, `../../design-gateway-origin-auth.mjs`,
  `../../design-pwa-send-ledger.mjs` (L41 PWA send-ledger; the NEW PWA API requires device pairing, so L41
  was not run this batch).

### Findings from the map (independent of the tests)
- **Telegram adapter — CONFIRMED ABSENT** in the reconstruction (source/shared/channels.ts has Discord+Slack
  only; no product send/receive/auth adapter anywhere; "telegram" appears only as MCP telemetry tags).
- **Autopost pipeline — CONFIRMED ABSENT** (no publisher adapter / job store / receipt / dedup; only
  skill-publish + bot-template generation + generic browser automation).
  → These were assumptions from the "whole product" framing; they are not implemented here, so they cannot be
  live-tested. Do NOT substitute a fake PASS.
- **NEW PWA `/api/filesystem` has no sensitive-file deny-list** (roots at belmontRoot/windowsMountRoot;
  traversal is blocked but in-root secrets like serve.json/.sessions.json are servable) — GATED behind device
  pairing (the live API returns "pairing required" unpaired), so it is a paired-user defense-in-depth gap, not
  an unauthenticated hole. The OLD PWA has a real deny-list (belmont-adapter.mjs:40-45). Worth a deny-list.

Remaining high-value untested areas (see the map): eval-isolation/sites-overlay secret battery (L27/L12),
browser tool matrix (L02), attachments SHA/dedup (L38), PWA file-path policy (L42, ties to the deny-list gap),
idempotency/durable-accept (L16), vault/secrets (L37), subagent isolation (L10).

## Stream 2 (follow-up) — "봇이 봇 만들기" + "봇끼리 그룹 토론" = LIVE PASS
`ev-bot-group-discuss.json` (driver `../../design-bot-group-discuss.mjs`), against the Host gateway (42611, auth-ON):
- **createAgent (bot makes bots)**: two test agents created (roster 14→16); same clientNonce is idempotent (no dup).
- **createGroup (bots form a group)**: a group room with both members (isGroup:true, memberCount 2).
- **group discussion (bots debate)**: sendPrompt to the room drove BOTH members' turns; each posted ONE
  in-character SendMessage to the room — Alice argued apples, Bob argued bananas. External artifact = the room
  transcript authored by two distinct agent ids (entry shape {kind,id,message:{type:"text",content},timestampMs,author:{id,name}}).
- **cleanup**: the two test agents + group deleted; roster restored to 14, zero leftover; the 14 real agents untouched.
Both features exist and work end-to-end (unlike Telegram/autopost which are confirmed-absent). Verdict PASS.

## Evidence-scope caveats (GPT-6 Pro round-9 §2) — claims tightened to what the JSON proves
- **L15 / L26**: the committed evidence set is complete in this repo (ev-l15-{origin-guard,bad-bearer,daemon}.json,
  ev-l26-{context-authority,reject-control-field,reject-malformed}.json), but the round-9 review package only
  carried a subset, so GPT could verify only the Origin-403 and one L26 rejection. The auth-ON/for-chrome/
  /memory-context/malformed cases are evidenced by the other JSONs here, not by that partial package.
- **HEALTH.DEAD / DOUBLE_CRASH**: the JSONs record the summarized values/booleans (health ready/alive; same
  chrome pid across crashes; reaped-on-stop). They do NOT embed an independent per-stage (pid,startTicks) +
  termination-status trace; the live checks made those observations but only the summary was persisted.
- **bot-group-discuss**: this proves the **capability** — createAgent/createGroup/group-chat all function and
  two bots really debated in-character in the room (distinct agent ids, real content). It does NOT prove a
  bot AUTONOMOUSLY called createAgent (I drove the gateway API directly, which is the same surface a bot's
  tool would call), nor does it capture the members' internal tool-call trace. Cleanup shows the roster COUNT
  returned to 14; it does not assert the exact ID-set was preserved or that the groupId is gone (both were
  true in practice — no `selftest`-named leftovers — but the JSON records the count, not the ID diff).
Next evidence hardening (no new features): persist req/resp, per-stage (pid,startTicks)+termination, the bot's
tool-call trace, and cleanup before/after roster ID-set equality + groupId absence.
