#!/bin/bash
# Secure remote debugging + agent tabs UI check.
# usage: run-secure-ui.sh <tag> [xdotool-actions-script]
set -u
SP=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad
TAG=${1:-s1}; ACTIONS=${2:-}; [ -n "${ASIDE_HOME:-}" ] && export ASIDE_HOME
EXT=/home/hoon/_roots/labs/work/Belmont/belmont-browse/vendor/aside-ext/AsideAgentManager
PROF="$SP/fork-prof-$TAG"; rm -rf "$PROF"
if [ -n "${BOOKMARKS_FIXTURE:-}" ]; then mkdir -p "$PROF/Default"; cp "$BOOKMARKS_FIXTURE" "$PROF/Default/Bookmarks"; fi
cd /home/hoon/chromium/src
Xvfb :97 -screen 0 1400x900x24 >/dev/null 2>&1 & XP=$!; sleep 2
ASIDE_INSTALLATION_KEY=$SP/AsideInstallationKey DISPLAY=:97 out/aside/chrome --user-data-dir="$PROF" --no-first-run --no-sandbox --disable-gpu --window-size=1400,900 --window-position=0,0 --load-extension=$EXT,$SP/agent-tabs-test-ext --enable-logging=stderr --v=0 --vmodule=aside_profile_attributes_updater=1,aside_daemon_authorizer=1 ${EXTRA_CHROME_ARGS:-} "https://example.com" >"$SP/$TAG.log" 2>&1 & CP=$!
sleep 25
echo "## secure handshake test"; ASIDE_INSTALLATION_KEY=$SP/AsideInstallationKey python3 $SP/secure-cdp-test.py 2>&1 | tee "$SP/$TAG-secure.log" | tail -16
echo "## attach to agent tab"; ASIDE_INSTALLATION_KEY=$SP/AsideInstallationKey python3 $SP/agent-attach.py 40 > "$SP/$TAG-attach.log" 2>&1 & AP=$!
for i in $(seq 1 20); do grep -q 'ATTACHED\|agent targets: \[\]' "$SP/$TAG-attach.log" && break; sleep 1; done; head -3 "$SP/$TAG-attach.log"
sleep 3; DISPLAY=:97 import -window root "$SP/ui-$TAG-a.png"
if [ -n "$ACTIONS" ]; then bash "$ACTIONS"; fi
sleep 2; DISPLAY=:97 import -window root "$SP/ui-$TAG-b.png"
sleep 3; cat "$SP/$TAG-attach.log" | tail -2
kill $AP 2>/dev/null; kill $CP 2>/dev/null; wait $CP 2>/dev/null; kill $XP 2>/dev/null; wait $XP 2>/dev/null
grep -aiE 'FATAL|CHECK failed|Received signal' "$SP/$TAG.log" | head -3; echo "done $TAG"
