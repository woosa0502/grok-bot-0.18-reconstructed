#!/usr/bin/env bash
# Runs the adversarial-verification contract test on a fresh profile.
SP=/tmp/claude-1000/-home-hoon--roots-labs-work-Belmont/2534ba16-801e-4ada-9486-ce4d1be6622c/scratchpad
FORK=/home/hoon/_roots/labs/work/Belmont/belmont-browse/aside-fork
BIN=/home/hoon/chromium/src/out/aside/chrome; TD="$SP/aside-contract-test"
rm -rf "$TD"; cp -r "$FORK/test/aside-contract-test" "$TD"
PROF="$SP/fork-prof-contract"; rm -rf "$PROF"; PORT=22012; DISP=":93"
Xvfb "$DISP" -screen 0 1280x800x24 >/dev/null 2>&1 & XP=$!; sleep 2
DISPLAY="$DISP" "$BIN" --user-data-dir="$PROF" --load-extension="$TD" --remote-debugging-port=$PORT \
  --no-first-run --no-sandbox --disable-gpu --enable-logging=stderr about:blank >"$SP/contract.log" 2>&1 & CP=$!
R=""
for i in $(seq 1 40); do sleep 1
  R=$(curl -s "http://127.0.0.1:$PORT/json" 2>/dev/null | python3 -c "import sys,json,urllib.parse,html
try: d=json.load(sys.stdin)
except: sys.exit()
for t in d:
  ti=t.get('title','')
  if ti.startswith('CONTRACT '): print(html.unescape(urllib.parse.unquote(ti[9:]))); break" 2>/dev/null)
  [ -n "$R" ] && break
done
printf '%s' "$R" > "$SP/contract.raw"
if [ -n "$R" ]; then echo "$R" | python3 -m json.tool || { echo "RAW(300):"; head -c 300 "$SP/contract.raw"; echo; }
else echo TIMEOUT; grep -aiE "aside|fatal|check failed" "$SP/contract.log"|head -20; fi
kill $CP 2>/dev/null; wait $CP 2>/dev/null; kill $XP 2>/dev/null; wait $XP 2>/dev/null; exit 0
