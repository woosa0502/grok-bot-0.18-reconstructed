# Belmont Mobile PWA

An isolated, dependency-free mobile vertical slice that ports OpenMausBot's public iOS visual system and interaction model to a Belmont-only PWA.

## Implemented

- Installable PWA shell and offline app-shell cache
- QR-first native-style pairing screen with platform camera detection, platform-supported QR-image selection, fail-closed invite parsing, confirmation, and nested manual pairing
- Demo mode requiring no running Belmont service
- Belmont-only conversation routing for actions; worker transcripts are readable (read-only, agent-to-agent traffic visible there) while send/respond stay Belmont-only
- Read-only worker status/details with a transcript viewer
- Paginated transcript client boundary
- Retry-safe send identifier
- Approval, denial, and narrow always-allow actions
- Fetch-based resumable SSE parser with reconnect backoff
- Same-origin Node gateway with HttpOnly paired sessions and a narrow API allowlist
- Exponential pairing backoff (doubling wait, 60s cap) so the six-digit code cannot be brute forced
- Coalesced event-driven refresh (one refetch per 400ms window) instead of a refetch per SSE event
- Network-first app-shell fetch so a redeploy shows on the next load while offline still serves the cache
- OpenMaus mascot silhouette and exact idle/listening/working/happy face geometry, exact ten-color named palette, single-shape native bubble geometry, roster geometry, approval card, dictation control, glass controls and light/dark surfaces
- Byte-identical preserved Grok Bot renderer icon source wired as the favicon/Apple touch icon, with same-artwork 192px/512px PWA install derivatives
- New-goal, work-status, computer placeholder, and transcript export sheets
- Belmont gateway adapter that reads the existing WSL `gateway.json` and `manager.json` without modifying the Belmont checkout
- Exact mobile projection for roster, manager transcript, pagination, send, widget answers, auto-review decisions, local-tool permission decisions, and state-refresh SSE

## Run

From the repository root:

```bash
python3 -m http.server 4173 --directory belmont-mobile-pwa
```

Open `http://127.0.0.1:4173`, then choose **Not now** for the isolated demo.

To use a running companion-compatible upstream instead of demo data:

```bash
BELMONT_MOBILE_UPSTREAM=http://127.0.0.1:8810 node belmont-mobile-pwa/server.mjs
```

Open `http://127.0.0.1:4173`, leave the gateway address blank, and enter the pairing code. The browser receives an HttpOnly session cookie; the upstream device token is not returned to JavaScript.

When, and only when, the gateway is behind a trusted reverse proxy that overwrites forwarded headers and blocks direct gateway access, add `BELMONT_MOBILE_TRUST_PROXY=1`. This allows an HTTPS browser origin to pair through TLS termination using `X-Forwarded-Proto`.

Run the dependency-free contract tests:

```bash
node --test belmont-mobile-pwa/tests/*.test.mjs
```

## Verified snapshot

Checked on 2026-09-01:

- JavaScript syntax checks passed.
- Node contract suite: 23/23 passed (includes the pairing-backoff brute-force test).
- The adapter was attached read-only to the running WSL Belmont profile and projected its designated manager, roster, latest transcript page, and older-page cursor through the complete PWA session boundary.
- Chromium at 430×932: QR-first pairing/scanner/validated confirmation → roster → Belmont chat/approval → message send rendered from the final source with zero page/console errors.
- Service worker controlled the page and the demo roster reloaded while the browser context was offline.
- Independent refute-by-default review found and closed worker-route, event-redaction, cursor-poisoning, and stale-cursor reconnect gaps. A separate raw pass injected 300 filtered worker/unknown events and confirmed that the manager cursor remained valid, opaque, and correctly mapped.

Current evidence: [`artifacts/20-openmaus-scanner-final.png`](./artifacts/20-openmaus-scanner-final.png), [`artifacts/22-openmaus-qr-confirmation-final.png`](./artifacts/22-openmaus-qr-confirmation-final.png), [`artifacts/26-openmaus-message-run-final.png`](./artifacts/26-openmaus-message-run-final.png), [`artifacts/29-grok-icon-gradient-light.png`](./artifacts/29-grok-icon-gradient-light.png), [`artifacts/30-grok-icon-gradient-dark.png`](./artifacts/30-grok-icon-gradient-dark.png).

The exact browser-port scope and native-only exclusions are recorded in [`brand-spec.md`](./brand-spec.md) and [`design-parity.md`](./design-parity.md).

## Real connection boundary

The PWA client speaks the OpenMaus companion-shaped routes:

- `POST /api/pair`
- `GET /api/bots?messages=50`
- `GET /api/threads/:threadId/messages`
- `POST /api/bots/:botId/messages`
- `POST /api/threads/:threadId/respond`
- `POST /api/bots/:botId/always-allow`
- `GET /api/events`

OpenMausBot's current native companion deliberately rejects browser `Origin` requests and serves no HTML. Do not solve that by broadly enabling CORS or persisting its bearer token in local storage. The intended production boundary is:

```text
Phone PWA
  -> same-origin HTTPS/Tailscale Belmont mobile gateway
  -> paired HttpOnly browser session
  -> Belmont-only action guard + read-only worker transcripts + filtered SSE
  -> narrow route allowlist
  -> Belmont loopback coordinator/gateway
```

This folder does not modify or restart the live Belmont runtime. `belmont-adapter.mjs` now exposes the existing Belmont coordinator through the narrow mobile route contract, and `belmont-server.mjs` composes that adapter with the same-origin PWA gateway.

Gateway sessions are intentionally memory-only in this vertical slice. Restarting `server.mjs` requires the phone to pair again.

## Attach directly to the existing Belmont WSL runtime

No Belmont source change is required. Start Belmont normally, then run the dedicated adapter from this folder:

```bash
BELMONT_WSL_PROFILE=/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile \
BELMONT_MOBILE_HOST=127.0.0.1 \
node belmont-mobile-pwa/belmont-server.mjs
```

The process prints a six-digit mobile pairing code. Open the PWA, leave the computer address blank when the PWA is served from that same address, and enter the printed code. To keep a stable code across restarts, set it explicitly:

```bash
BELMONT_MOBILE_PAIR_CODE=246810 \
BELMONT_WSL_PROFILE=/home/hoon/_roots/labs/work/Belmont/.cache/belmont-wsl-profile \
node belmont-mobile-pwa/belmont-server.mjs
```

Supported data-root inputs, in priority order:

1. `BELMONT_DATA_ROOT=/path/to/sand-data`
2. `SAND_DATA_ROOT=/path/to/sand-data`
3. `BELMONT_WSL_PROFILE=/path/to/profile`
4. `BELMONT_REPO_ROOT=/path/to/Belmont`

The adapter re-reads `gateway.json` for every request, so a Belmont host restart and dynamic gateway port change do not require rewriting the PWA. The Belmont gateway bearer token stays between the two loopback Node servers and is never returned to browser JavaScript.

The following surfaces are deliberately not presented as connected functionality:

- A fresh Belmont conversation/job: **New goal** only prepares text in the current manager conversation.
- A durable reviewed task ledger: the roster shows runtime status, not review completion.
- User turn interruption: the current Belmont gateway has no public interrupt command.
- Mobile computer streaming/control: only the Belmont computer status boundary exists; the PWA remains a placeholder.
- Auto-review **always allow**: the desktop flow also updates auto-review instructions, which the current gateway does not expose. Mobile only offers one-time allow/deny for that card.
- Secret, connector, email-draft, Slack-draft, and attachment actions: these are rendered as safe summaries and remain desktop actions.

## Provenance

The design and wire-contract reference is OpenMausBot at commit `6140532ea63e50bc234c34c488a79ff908bfc7f5`. The mascot silhouette and reference app-icon vector are copied under the upstream Apache-2.0 license and NOTICE in `third-party/openmausbot/`; the installed icon artwork is derived from a byte-identical preserved 256px Grok Bot renderer source. The browser application code is a Belmont-specific port. It is not the official OpenMausBot or Grok Bot mobile app.
