# DEF-L13-BROWSER-APPROVAL-UNGATED-001 — guard-mode approval does not cover browser actions

> **CORRECTED after GPT-6 Pro round-5 (§A).** The original S1 framing is WITHDRAWN. Current disposition:
> `POLICY_CONTRACT_UNVERIFIED`, `L13.BROWSER.DENY/ALLOW = NOT_EXERCISED`. The observation (no approval
> suspension for a browser submit under guard/autoApprove:false, while write_file suspends) stands, but it
> does NOT by itself prove an approval *bypass*: "Guard" (folder-access mode) and per-tool permissions
> (Allow/Ask/Deny) are separate contracts, and the browser tool's *effective* permission was never pinned.
> If it is Allow, a no-suspension submit is consistent with policy — not a defect. The correct test pins the
> effective browser capability from the daemon schema first (see the R6 plan / L13.BROWSER.POLICY.* battery).
> Priority stays **P0** (core external-effect boundary) but as a POLICY test, not a confirmed defect.
> The overreach "local form submit ⇒ real purchases/bookings possible without approval" is withdrawn — that
> is beyond the tested scope, and 2/2 is a reproduction, not proof of determinism under all conditions.

- **Severity:** NOT S1-confirmed (insufficient basis). Disposition `POLICY_CONTRACT_UNVERIFIED`.
- **Status:** observation reproduced (2 runs) + same-serve write_file-gates control; the *contract* (whether
  browser approval should exist and what its effective value is) is UNVERIFIED and the boundary NOT_EXERCISED.
- **Answers (partially):** GPT-6 Pro's standing item "L13: 원래 브라우저 경계 OPEN" — the boundary is open to
  testing; a defect is not established.

## Claim

Under `mode:guard` + `autoApprove:false`, a live agent session performed a real browser
navigate → fill → click **Submit** on an HTML form and the session finished `done` with **no approval
suspension**, while native `write_file` **did** suspend under identical settings. That observation stands —
but see the CORRECTION banner above: the resolved contract is that browser `modify` **defaults to `allow`**
(so no suspension is the policy, not a bypass), and `write_file` suspended because `/tmp` is outside guard's
`writableRoots` (a folder-access `ask`, not a tool-rule `ask`).

**Consequence (corrected):** `L13.BROWSER.POLICY.ALLOW` is the observed default; the deny path was later
demonstrated live (a browser `modify` deny rule blocks the submit — see r6/L13-BROWSER-POLICY-CONTRACT.md).
There is no product approval *bypass*. The earlier claim that "a browser agent in guard mode can submit
forms / make bookings / purchases / message-sends with no human approval" is **WITHDRAWN** as an overreach —
it conflated the default-allow policy with a broken gate and went beyond the local-fixture scope tested.

## Evidence (`ev-l13-browser-ungated.json`) — observed behavior (interpret via the corrected contract)

- Two browser sessions (`635434f4…`, `93969a54…`), each with an **owned** CDP browser tab
  (`session_tabs.ownership="owned"`, real `target_id`, `url=…/submit`, DOM snapshot
  `"submitted destination=NYC seat=aisle"`) — proving a real browser, not a bash/curl fallback.
- External-artifact confirmation: the form server recorded a submit `{destination:NYC, seat:aisle}` under
  each trial's fresh token; both sessions `done`, `suspended:false` (consistent with browser `modify` = allow).
- **Control (same serve, same config):** a `write_file` session **SUSPENDED**
  (`kind:"approval"`, `scope:{type:"file",mode:"write"}`, file not created before the answer) — a
  folder-access `ask` for an out-of-`writableRoots` path, NOT evidence of a broken browser gate.

## Config

engine 1.26.909.1820, serve 9360 / CDP 9333 / daemon 21420, Aside chromium `out/aside/chrome` (Chromium 151),
dev profile + dev knowledge, patched daemon (eval-isolation). This session is an ordinary `/sessions` session
(not a learn-measure eval), so the eval-isolation permission wrapper does not apply to it.

## Reproduction

1. Serve the HTML form: `belmont-browse/tools/eval-verify/form-server-html.mjs`
   (`FORM_CTL_SECRET`, `FORM_STATE_FILE`, `FORM_PORT=0`).
2. Reset a token (`POST /control/reset`, secret header).
3. `belmont-browse/tools/eval-verify/probe-l13-browser.mjs <scratch-with-form.json>` — creates a
   `mode:guard, autoApprove:false` session that drives the browser to fill+submit; polls for a suspension.
4. Read `GET /control/observation` (external artifact) and `session_tabs` in the daemon DB
   (`aside-home-909/u/0/state.db`) for the owned-tab proof.

## Open questions for GPT-6 Pro (round-5)

1. Is browser-action approval **supposed** to exist in guard mode (defect), or are browser actions gated by a
   different mechanism (domain allowlist / computer-use confirmation) that this eval config doesn't trigger?
2. If it is a defect, what is the correct gate boundary — every state-changing DOM action, only navigations to
   non-allowlisted origins, or form submits specifically?
3. Severity ruling given the Aside threat model.
