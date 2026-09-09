#!/bin/bash
# AsideAccountPasswordGate check: a standalone fork on Xvfb :98 with an ASIDE_HOME whose accounts.json has
# localBootstraps[0].isComplete=false must hide the normal window and show the "aside-account-password-popup"
# window on newtab.html#/onboarding/splash; flipping isComplete to true closes the popup and shows the window.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
SP=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad
EXT=/home/hoon/_roots/labs/work/Belmont/belmont-browse/vendor/aside-ext/AsideAgentManager
WORK=$(mktemp -d /tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/90cd48b9-4fa7-44e3-94f9-c7bc5cf8bf4e/scratchpad/gate-XXXX)
HOME_DIR=$WORK/aside-home; PROF=$WORK/profile; mkdir -p "$HOME_DIR" "$PROF"
cp "$SP/AsideInstallationKey" "$WORK/key" 2>/dev/null
NOW=$(date +%s000)
write_accounts() { cat > "$HOME_DIR/accounts.json" <<JSON
{"version":1,"currentAccountId":0,"accounts":[{"id":0,"name":"Gate Test","provider":"anonymous","mode":"local","authStatus":"active","userId":"u_gate","email":"gate@example.com","createdAt":$NOW}],"sessions":{"0":{"accessToken":"a","refreshToken":"b","expiresAt":$((NOW+86400000))}},"localBootstraps":{"0":{"isComplete":$1,"createdAt":$NOW}},"profileBindings":{},"profileAccountBindings":{}}
JSON
}
write_accounts false
export DISPLAY=:98
pgrep -x Xvfb -a | grep -q ':98' || (Xvfb :98 -screen 0 1280x900x24 >/dev/null 2>&1 &); sleep 1
cd /home/hoon/chromium/src
ASIDE_HOME=$HOME_DIR ASIDE_INSTALLATION_KEY=$WORK/key out/aside/chrome --user-data-dir="$PROF" --no-first-run --no-sandbox --disable-gpu \
  --window-size=1200,800 --window-position=0,0 --load-extension=$EXT --remote-debugging-port=9398 \
  --enable-logging=stderr --v=0 --vmodule=aside_account_password_gate=1,aside_profile_attributes_updater=1 "about:blank" > "$WORK/chrome.log" 2>&1 & CP=$!
for i in $(seq 1 30); do curl -s -m 1 http://127.0.0.1:9398/json/version >/dev/null 2>&1 && break; sleep 1; done
sleep 12
report() {
  echo "## $1"
  curl -s http://127.0.0.1:9398/json | python3 -c "import json,sys;print('  pages:',[t['url'][:80] for t in json.load(sys.stdin) if t['type']=='page'])"
  xdotool search --onlyvisible --name '' | while read w; do echo "  win $w '$(xdotool getwindowname $w 2>/dev/null | cut -c1-50)' $(xdotool getwindowgeometry $w 2>/dev/null | tr '\n' ' ')"; done
  grep -a "AsideAccountPasswordGate" "$WORK/chrome.log" | tail -3 | cut -c1-170 | sed 's/^/  /'
}
report "bootstrap incomplete (expect popup, normal window hidden)"
import -window root "$HERE/../../ui-shots/28-password-gate-popup.png"
write_accounts true; sleep 6
report "after isComplete=true (expect popup closed, normal window back)"
kill $CP 2>/dev/null; wait $CP 2>/dev/null; echo "log: $WORK/chrome.log"
