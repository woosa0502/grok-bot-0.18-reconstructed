#!/usr/bin/env bash
# Reproduce the eval-session document-read isolation verification (G2-document-read) and the eval harness
# execution path (G4-G7 plumbing). SANITIZED: no tokens, install keys, account state, or operational profile.
# Paths that vary per host are env placeholders. The OFFLINE section runs as-is; the LIVE section is a
# documented recipe that needs a maintenance window (singleton ports 21420/1337/9333) and is NOT run by default.
#
# Scope honesty (see handoff §15): the live learn-measure below uses a DETERMINISTIC STATUS observer
# (status==done -> succeeded). That proves the observer->decision->adopt/reject PLUMBING, NOT goal achievement.
# A real G4/G5 close needs an observer that checks an EXTERNAL per-trial artifact (see examples/file-observer.mjs
# and the "remaining verification bundle" in the handoff), and G7 needs abnormal-lifecycle cases.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

NODE="${BELMONT_TEST_NODE:-$HOME/.nvm/versions/node/v26.8.1/bin/node}"   # node:sqlite built-in
DAEMON="${BELMONT_DAEMON:-belmont-browse/vendor/aside-909/apps/daemon/build/daemon.mjs}"  # derived, gitignored

echo "== OFFLINE: unit + integration tests (real bwrap, real temp fs) =="
"$NODE" --test \
  belmont-browse/test/bwrap-eval-isolation.test.mjs \
  belmont-browse/test/eval-isolation.test.mjs \
  belmont-browse/test/sites-overlay-contract.test.mjs \
  belmont-browse/test/memory-search-sites-overlay.test.mjs \
  belmont-browse/test/learn-measure-adoption.test.mjs

echo "== OFFLINE: chrome-orphan supervisor closure (DEF-L19-CHROME-ORPHAN-001; real fork+pidfd, no live stack) =="
python3 belmont-browse/tools/test-chrome-supervisor.py

echo "== OFFLINE: chrome adopt-path registration (REAL ensureChrome() producer, stub CDP; C-2) =="
"$NODE" belmont-browse/tools/test-chrome-adopt-registration.mjs

echo "== OFFLINE: eval-harness fail-closed self-tests (L19.PENDING + L15 graders; shared modules) =="
"$NODE" belmont-browse/tools/eval-verify/evidence/r9-audit/test-pending-formula.mjs
"$NODE" belmont-browse/tools/eval-verify/test-gateway-origin-auth.mjs

echo "== OFFLINE: patch applies clean + idempotent + parses (on a COPY, never the live bundle) =="
TMP="$(mktemp -d)"; cp "$DAEMON" "$TMP/daemon.copy.mjs"
python3 belmont-browse/tools/patch-daemon-eval-isolation.py "$TMP/daemon.copy.mjs"
python3 belmont-browse/tools/patch-daemon-eval-isolation.py "$TMP/daemon.copy.mjs"   # idempotent (prints "already patched")
"$NODE" --check "$TMP/daemon.copy.mjs" && echo "PARSE OK"
rm -rf "$TMP"

echo "== OFFLINE: typecheck =="
npm run --silent source:typecheck

cat <<'LIVE'

== LIVE recipe (maintenance window; requires stopping the live bot; NOT run by this script) ==
# 1. Stop the live bot by EXPLICIT pid (run-wsl supervisor first, then host-main). Never `pkill -f`.
#    Confirm ports 21420/1337/9333 free.
# 2. Apply the patch to the derived bundle(s):
#    python3 belmont-browse/tools/patch-daemon-eval-isolation.py "$DAEMON"
#    python3 belmont-browse/tools/patch-daemon-eval-isolation.py <...>/daemon.memory-2.1.mjs   # if canonical
# 3. Serve eval-verify (dedicated profile + eval knowledge so the live profile is untouched).
#    SUPPORTED LAUNCH PATH: run serve UNDER the chrome supervisor so the DEF-L19-CHROME-ORPHAN-001 closure
#    (C-1 fail-closed registration, C-2 spawn+adopt registration, A-1 per-profile flock, pidfd reaping on any
#    serve exit incl. SIGKILL) is actually in force. Launching `node serve.mjs` DIRECTLY leaves the supervisor
#    backstop out of the loop and is NOT the supported path. The supervisor's <profileDir> MUST be serve's chrome
#    profile dir, which is "$EVAL_STATE_DIR/chrome-profile" (core.mjs: path.join(stateDir,"chrome-profile")).
#    Non-zero supervisor exits are fail-closed by design: 3 = registration channel could not be established;
#    4 = another supervised serve already holds this profile's lock.
#    BELMONT_BROWSE_ENGINE=909 BELMONT_BROWSE_TRANSPORT=port BELMONT_BROWSE_NATIVE_COMPONENTS=1 \
#    BELMONT_BROWSE_CHROME="$BELMONT_BROWSE_CHROME" BELMONT_BROWSE_CHROME_ARGS=--ignore-gpu-blocklist \
#    BELMONT_BROWSE_DISPLAY=:0 DISPLAY=:0 \
#    BELMONT_BROWSE_STATE_DIR="$EVAL_STATE_DIR" \
#    BELMONT_KNOWLEDGE_DIR="$EVAL_KNOWLEDGE_DIR" \
#    BELMONT_BROWSE_SITES_OVERLAY=1 \
#    python3 belmont-browse/tools/chrome-supervisor.py "$EVAL_STATE_DIR/chrome-profile" -- \
#      "$NODE" belmont-browse/src/serve.mjs --port 9360 --engine 909 --transport port --cdp-port 9333 --relay-port 9361
#    -> startup log must show: [eval-probe] ... readIsolation=true ... read{overlayBash:true,overlayRead:true,
#       opBashTried:true,opReadTried:true,opLeak:false}   (G2-document-read)
#    -> GET /health (Bearer token from $EVAL_STATE_DIR/serve.json) must show sitesOverlay:true
#    -> on serve exit the supervisor logs "[supervisor] reaping ..." and exits 0 with no owned chrome left.
# 4. Harness execution path (learn-measure vs the live engine). See scope-honesty note at the top.
#    "$NODE" belmont-browse/src/learn-measure.mjs --domain <d> --task "<t>" --model gpt-5.5 --thinking high \
#      --runs 1 --verify <observer.mjs> [--publish] --state-dir "$EVAL_STATE_DIR"
# 5. Restore the live bot: npm run wsl:setup && npm run wsl:start ; confirm rollout.json ABSENT (legacy) and /health ok.
LIVE
echo "done."
